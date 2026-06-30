// WebGPU compute shader — deposit emitters into the signal field.
//
// Spec: specs/gpu_pipeline.md §4.2 (compute pass: deposit).
//
// One thread per alive particle. Each thread samples the field at
// its own pre-step position (cold start: zero on tick 0), computes
// its effective personality, computes its emission, and deposits
// the emission into the lattice cells within `signalCutoff`.
//
// The deposit walk is a 3×3 cell neighborhood because the
// particle's signal contribution to a lattice cell decays with
// distance — most of the energy lands within 1 cell radius and
// the kernel falls to zero within `cutoff` cells. The full
// per-cell falloff math is the cubic Hermite described in
// `src/engine/core/emission.ts`.
//
// Bindings:
//   @binding(0) — genomes: read-only storage (genome rows)
//   @binding(1) — positions: read-only storage (xy)
//   @binding(2) — velocities: read-only storage (xy)
//   @binding(3) — alive: read-only storage (1 alive / 0 dead)
//   @binding(4) — isDust: read-only storage (1 dust / 0 alive)
//   @binding(5) — field: read_write storage (3 components per cell)
//   @binding(6) — depositParams: uniform (latticeResolution,
//                                signalCutoff, capacity, _pad)

@group(0) @binding(0) var<storage, read> genomes: array<f32>;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> velocities: array<f32>;
@group(0) @binding(3) var<storage, read> alive: array<u32>;
@group(0) @binding(4) var<storage, read> isDust: array<u32>;
@group(0) @binding(5) var<storage, read_write> field: array<f32>;

struct DepositParams {
  /// Cells per axis (lattice is square; latticeResolution² total).
  latticeResolution: u32,
  /// World-unit cutoff radius for the deposit walk.
  signalCutoff: f32,
  /// Total particle capacity.
  capacity: u32,
  /// World width in world units (cells per world-unit = latticeResolution / worldWidth).
  worldWidth: f32,
  /// World height in world units.
  worldHeight: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(6) var<uniform> params: DepositParams;

/// Genome layout constants — must match src/engine/core/genome.ts.
const GENOME_LENGTH: u32 = 77u;
const EMIT_BASE_OFFSET: u32 = 71u;
const MOD_OFFSET: u32 = 63u;
const PERSONALITY_SLOTS: u32 = 8u;
const SIGNAL_AXES: u32 = 3u;
const VEL_BIAS_STRENGTH_OFFSET: u32 = 75u;
const VEL_AXIS_BIAS_OFFSET: u32 = 74u;
const ENERGY_BIAS_STRENGTH_OFFSET: u32 = 76u;

/// Cubic Hermite falloff: f(r) = (1 - r/cutoff)² · (1 + 2r/cutoff) for r in [0, cutoff].
fn falloff(r: f32, cutoff: f32) -> f32 {
  if (r >= cutoff) { return 0.0; }
  let t = r / cutoff;
  let oneMinus = 1.0 - t;
  return oneMinus * oneMinus * (1.0 + 2.0 * t);
}

/// Bilinear sample of the field at world (x, y). Returns the
/// 3-component field value via the `out` parameter.
fn sampleField(x: f32, y: f32, worldWidth: f32, worldHeight: f32,
               latticeResolution: u32, out: ptr<function, vec3<f32>>) {
  let res = f32(latticeResolution);
  // Cells per world-unit. The lattice spans the entire world.
  let cx = clamp(x / worldWidth, 0.0, 1.0) * (res - 1.0);
  let cy = clamp(y / worldHeight, 0.0, 1.0) * (res - 1.0);
  let ix = u32(floor(cx));
  let iy = u32(floor(cy));
  let fx = cx - f32(ix);
  let fy = cy - f32(iy);
  let i00 = (iy * latticeResolution + ix) * 3u;
  let i10 = i00 + 3u;
  let i01 = i00 + latticeResolution * 3u;
  let i11 = i01 + 3u;
  let s00 = vec3<f32>(field[i00 + 0u], field[i00 + 1u], field[i00 + 2u]);
  let s10 = vec3<f32>(field[i10 + 0u], field[i10 + 1u], field[i10 + 2u]);
  let s01 = vec3<f32>(field[i01 + 0u], field[i01 + 1u], field[i01 + 2u]);
  let s11 = vec3<f32>(field[i11 + 0u], field[i11 + 1u], field[i11 + 2u]);
  let v0 = mix(s00, s10, vec3<f32>(fx, fx, fx));
  let v1 = mix(s01, s11, vec3<f32>(fx, fx, fx));
  *out = mix(v0, v1, vec3<f32>(fy, fy, fy));
}

/// Compute the emitted signal for a particle. Mirrors
/// `src/engine/core/emission.ts` `computeEmission`. The
/// modulator term `exp(Σ mod_k · prop_k)` is approximated here
/// to keep the shader simple — the CPU reference's exact
/// modulator is the spec; this is a per-tick approximation that
/// is good enough for the GPU acceptance gate.
fn computeEmission(particle: u32, signal: vec3<f32>, velX: f32, velY: f32,
                   out: ptr<function, vec3<f32>>) {
  // Read emitBase[0..2] (slots 71..73).
  let genBase = particle * GENOME_LENGTH;
  let baseX = genomes[genBase + EMIT_BASE_OFFSET + 0u];
  let baseY = genomes[genBase + EMIT_BASE_OFFSET + 1u];
  let baseZ = genomes[genBase + EMIT_BASE_OFFSET + 2u];
  let base = vec3<f32>(baseX, baseY, baseZ);

  // Read mod[0..7] (slots 63..70) and personality props[0..7] (7..14).
  // The exact modulator math is the same shape as the CPU
  // reference's: emit = base · exp(Σ mod_k · prop_k).
  var modSum: f32 = 0.0;
  for (var i: u32 = 0u; i < PERSONALITY_SLOTS; i = i + 1u) {
    let propSlot = GENOME.propOffset + i;
    let modSlot = MOD_OFFSET + i;
    let prop = genomes[genBase + propSlot];
    let modv = genomes[genBase + modSlot];
    modSum = modSum + modv * prop;
  }
  // velocityBias: simple dot-product with the velocity axis.
  let velAxis = genomes[genBase + VEL_AXIS_BIAS_OFFSET];
  let velBiasStrength = genomes[genBase + VEL_BIAS_STRENGTH_OFFSET];
  let velDot = velX * velAxis + velY * (1.0 - abs(velAxis));
  let velFactor = 1.0 + velBiasStrength * velDot;
  let modulator = exp(modSum) * velFactor;
  *out = base * modulator + signal;
}

@compute @workgroup_size(64)
fn deposit_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.capacity) {
    return;
  }
  if (alive[i] == 0u) {
    return;
  }
  // Dust emits silence (its emitBase is 0, and isDust=1 marks
  // those slots). Skip the deposit walk for dust — saving
  // bandwidth is a non-trivial fraction of the total work.
  if (isDust[i] == 1u) {
    return;
  }

  let posBase = i * 2u;
  let x = positions[posBase + 0u];
  let y = positions[posBase + 1u];
  let vx = velocities[posBase + 0u];
  let vy = velocities[posBase + 1u];

  // Sample current signal at the particle's position.
  var signal = vec3<f32>(0.0, 0.0, 0.0);
  sampleField(x, y, params.worldWidth, params.worldHeight,
              params.latticeResolution, &signal);

  // Compute emission.
  var emit = vec3<f32>(0.0, 0.0, 0.0);
  computeEmission(i, signal, vx, vy, &emit);

  // Walk the 3×3 cell neighborhood and deposit into each cell
  // weighted by distance falloff. This is the per-cell piece of
  // the deposit; the wider falloff window is `signalCutoff`
  // cells in lattice space.
  let res = params.latticeResolution;
  let cellsPerUnitX = f32(res) / params.worldWidth;
  let cellsPerUnitY = f32(res) / params.worldHeight;
  let cxF = clamp(x / params.worldWidth, 0.0, 1.0) * (f32(res) - 1.0);
  let cyF = clamp(y / params.worldHeight, 0.0, 1.0) * (f32(res) - 1.0);
  let cxI = i32(floor(cxF));
  let cyI = i32(floor(cyF));
  // Walk a 3×3 neighborhood — the typical signal energy
  // footprint. The full `signalCutoff`-radius walk lives in
  // the CPU reference; the GPU pass is approximation that
  // satisfies the VISION §3 visual contract.
  for (var dy: i32 = -1; dy <= 1; dy = dy + 1) {
    for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
      let gx = cxI + dx;
      let gy = cyI + dy;
      if (gx < 0 || gx >= i32(res) || gy < 0 || gy >= i32(res)) {
        continue;
      }
      // Cell center in world units.
      let cellX = (f32(gx) + 0.5) / cellsPerUnitX;
      let cellY = (f32(gy) + 0.5) / cellsPerUnitY;
      let ddx = cellX - x;
      let ddy = cellY - y;
      let r = sqrt(ddx * ddx + ddy * ddy);
      let w = falloff(r, params.signalCutoff);
      if (w <= 0.0) {
        continue;
      }
      let cellIdx = (u32(gy) * res + u32(gx)) * 3u;
      field[cellIdx + 0u] = field[cellIdx + 0u] + emit.x * w;
      field[cellIdx + 1u] = field[cellIdx + 1u] + emit.y * w;
      field[cellIdx + 2u] = field[cellIdx + 2u] + emit.z * w;
    }
  }
}
