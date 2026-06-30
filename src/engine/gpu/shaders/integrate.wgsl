// WebGPU compute shader — integrate motion and emit dust.
//
// Spec: specs/gpu_pipeline.md §4.3 (compute pass: integrate).
//
// One thread per alive particle. Each thread:
//   1. Samples the field at its position (post-deposit lattice).
//   2. Computes the force as a finite-difference gradient of the
//      effective personality sum across the 6-neighborhood.
//   3. Updates velocity (`v' = v · drag^dt + force·dt`).
//   4. Updates position.
//   5. Emits dust on motion (1 energy unit per world-unit of
//      distance, per VISION §6).
//
// Dust is emitted by atomically incrementing a per-tick dust
// counter (read by the next pass). Each dust grain needs its own
// slot — we use a simple "next free slot" atomically-incremented
// counter. The CPU reference's passD/refresh path runs the
// fission; the GPU pass emits the dust and lets pass E handle
// the slot recycling.
//
// Bindings:
//   @binding(0..4) — same as deposit (genomes, positions,
//                    velocities, alive, isDust)
//   @binding(5) — field (read-only here; written by deposit)
//   @binding(6) — positions_rw (read_write; the integrated
//                 position is written back)
//   @binding(7) — velocities_rw (read_write)
//   @binding(8) — energies_rw (read_write; dust emission debits)
//   @binding(9) — dustSlots (read_write; the dust grains emitted
//                 this tick — their data is written here)
//   @binding(10) — dustCounter (atomic u32; next free slot)
//   @binding(11) — IntegrateParams (latticeResolution, capacity,
//                  worldWidth, worldHeight, fixedDt, maxDust)

@group(0) @binding(0) var<storage, read> genomes: array<f32>;
@group(0) @binding(1) var<storage, read_write> positions: array<f32>;
@group(0) @binding(2) var<storage, read_write> velocities: array<f32>;
@group(0) @binding(3) var<storage, read_write> energies: array<f32>;
@group(0) @binding(4) var<storage, read> alive: array<u32>;
@group(0) @binding(5) var<storage, read> isDust: array<u32>;
@group(0) @binding(6) var<storage, read> field: array<f32>;

struct DustSlot {
  x: f32,
  y: f32,
  energy: f32,
  _pad0: f32,
};

@group(0) @binding(7) var<storage, read_write> dustSlots: array<DustSlot>;
@group(0) @binding(8) var<storage, read_write> dustCounter: atomic<u32>;

struct IntegrateParams {
  latticeResolution: u32,
  capacity: u32,
  worldWidth: f32,
  worldHeight: f32,
  fixedDt: f32,
  /// Maximum dust grains that can be emitted in a single tick.
  /// Bounded so the buffer is sized deterministically.
  maxDust: u32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(9) var<uniform> params: IntegrateParams;

/// Genome layout constants — must match src/engine/core/genome.ts.
const GENOME_LENGTH: u32 = 77u;
const GENOME_DRAG_OFFSET: u32 = 2u;
const GENOME_RADIUS_OFFSET: u32 = 1u;

/// Bilinear field sample. Same as the deposit shader's
/// `sampleField` — duplicated here to keep each shader file
/// self-contained (WGSL doesn't have a header mechanism).
fn sampleField(x: f32, y: f32, out: ptr<function, vec3<f32>>) {
  let res = f32(params.latticeResolution);
  let cx = clamp(x / params.worldWidth, 0.0, 1.0) * (res - 1.0);
  let cy = clamp(y / params.worldHeight, 0.0, 1.0) * (res - 1.0);
  let ix = u32(floor(cx));
  let iy = u32(floor(cy));
  let fx = cx - f32(ix);
  let fy = cy - f32(iy);
  let i00 = (iy * params.latticeResolution + ix) * 3u;
  let i10 = i00 + 3u;
  let i01 = i00 + params.latticeResolution * 3u;
  let i11 = i01 + 3u;
  let s00 = vec3<f32>(field[i00 + 0u], field[i00 + 1u], field[i00 + 2u]);
  let s10 = vec3<f32>(field[i10 + 0u], field[i10 + 1u], field[i10 + 2u]);
  let s01 = vec3<f32>(field[i01 + 0u], field[i01 + 1u], field[i01 + 2u]);
  let s11 = vec3<f32>(field[i11 + 0u], field[i11 + 1u], field[i11 + 2u]);
  let v0 = mix(s00, s10, vec3<f32>(fx, fx, fx));
  let v1 = mix(s01, s11, vec3<f32>(fx, fx, fx));
  *out = mix(v0, v1, vec3<f32>(fy, fy, fy));
}

/// Approximate force as the gradient of `signal` (the field)
/// with respect to position. The CPU reference's
/// `forceFromSignal` walks the 6-neighborhood of the effective
/// personality; the GPU pass uses a simpler field-gradient
/// approximation that satisfies the visual contract.
fn forceFromField(x: f32, y: f32, drag: f32,
                  fx: ptr<function, f32>, fy: ptr<function, f32>) {
  // Sample field at the particle's position.
  var s = vec3<f32>(0.0, 0.0, 0.0);
  sampleField(x, y, &s);
  // Sample at +eps in x and y. The finite-difference gradient
  // gives a force vector pointing up the field gradient.
  let eps = 0.5;
  var sx = vec3<f32>(0.0, 0.0, 0.0);
  sampleField(x + eps, y, &sx);
  var sy = vec3<f32>(0.0, 0.0, 0.0);
  sampleField(x, y + eps, &sy);
  // Force is the negative of the gradient. The sign convention
  // here is "particles climb the gradient" — the same as the
  // CPU reference's sign.
  let gradX = -(sx.x - s.x) / eps;
  let gradY = -(sy.y - s.y) / eps;
  // Drag scales force too — a heavily-damped particle is less
  // affected by external field.
  *fx = gradX * (1.0 - drag);
  *fy = gradY * (1.0 - drag);
}

@compute @workgroup_size(64)
fn integrate_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.capacity) { return; }
  if (alive[i] == 0u) { return; }

  let posBase = i * 2u;
  let x = positions[posBase + 0u];
  let y = positions[posBase + 1u];
  let vx = velocities[posBase + 0u];
  let vy = velocities[posBase + 1u];

  let genBase = i * GENOME_LENGTH;
  let drag = genomes[genBase + GENOME_DRAG_OFFSET];

  // Compute force (dust is force-free; it coasts with a fixed
  // drag of 0.96 in the CPU reference).
  var fx = 0.0;
  var fy = 0.0;
  if (isDust[i] == 0u) {
    forceFromField(x, y, drag, &fx, &fy);
  }

  // Update velocity: v' = v · drag^dt + force·dt.
  let dragFactor = pow(drag, params.fixedDt);
  let newVx = vx * dragFactor + fx * params.fixedDt;
  let newVy = vy * dragFactor + fy * params.fixedDt;

  // Update position.
  var newX = x + newVx * params.fixedDt;
  var newY = y + newVy * params.fixedDt;

  // Bounce off world bounds (clamp + reflect). The wall
  // dissipates 20% of the impact velocity.
  var cvx = newVx;
  var cvy = newVy;
  if (newX < 0.0) {
    newX = -newX;
    cvx = -cvx * 0.8;
  } else if (newX > params.worldWidth) {
    newX = 2.0 * params.worldWidth - newX;
    cvx = -cvx * 0.8;
  }
  if (newY < 0.0) {
    newY = -newY;
    cvy = -cvy * 0.8;
  } else if (newY > params.worldHeight) {
    newY = 2.0 * params.worldHeight - newY;
    cvy = -cvy * 0.8;
  }

  // Write back position + velocity.
  positions[posBase + 0u] = newX;
  positions[posBase + 1u] = newY;
  velocities[posBase + 0u] = cvx;
  velocities[posBase + 1u] = cvy;

  // Dust emission: 1 energy per world-unit traveled. The CPU
  // reference deposits a real particle; the GPU pass deposits
  // into a flat `dustSlots` buffer that the next pass (fission)
  // will turn into slot allocations.
  if (isDust[i] == 0u) {
    let ddx = newX - x;
    let ddy = newY - y;
    let dist = sqrt(ddx * ddx + ddy * ddy);
    if (dist > 0.0) {
      let cost = min(dist, energies[i]);
      if (cost > 0.0) {
        // Reserve a dust slot atomically.
        let slot = atomicAdd(&dustCounter, 1u);
        if (slot < params.maxDust) {
          dustSlots[slot].x = x;
          dustSlots[slot].y = y;
          dustSlots[slot].energy = cost;
          energies[i] = energies[i] - cost;
        }
      }
    }
  }
}
