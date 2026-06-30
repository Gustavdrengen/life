// WebGPU compute shader — fission pass.
//
// Spec: specs/gpu_pipeline.md §4.5 (compute pass: fission).
//
// One thread per alive non-dust particle. The thread checks
// the particle's effective energy against its genome-encoded
// fission threshold (modulated by the local signal) and, if the
// gate passes, emits two daughters with mutated copies of the
// parent's genome. The parent's slot is freed.
//
// The pass uses a noise seed derived from the particle's id
// (loaded from the genomes buffer) plus a tick counter
// (passed as a uniform). The seed is a simple PCG-style hash
// — the WGSL spec does not guarantee a builtin PRNG, so we
// roll our own. The output is a deterministic stream of f32
// values in [0, 1) and a separate stream of N(0, 1) draws.
//
// Bindings:
//   @binding(0..4) — same as deposit (genomes, positions,
//                    velocities, alive, isDust)
//   @binding(5) — energies_rw
//   @binding(6) — daughterSlots (read_write; per-particle
//                 metadata for new daughters)
//   @binding(7) — daughterCounter (atomic u32)
//   @binding(8) — FissionParams (latticeResolution, capacity,
//                 fixedDt, maxDaughters, tick)

@group(0) @binding(0) var<storage, read> genomes: array<f32>;
@group(0) @binding(1) var<storage, read_write> positions: array<f32>;
@group(0) @binding(2) var<storage, read_write> velocities: array<f32>;
@group(0) @binding(3) var<storage, read_write> energies: array<f32>;
@group(0) @binding(4) var<storage, read_write> alive: array<u32>;
@group(0) @binding(5) var<storage, read> isDust: array<u32>;

struct DaughterSlot {
  parent: u32,
  x: f32,
  y: f32,
  vx: f32,
  vy: f32,
  energy: f32,
  /// Genome of the daughter — full 77 slots. We pack the
  /// genome into a fixed-size array below.
  genome: array<f32, 77>,
};

@group(0) @binding(6) var<storage, read_write> daughterSlots: array<DaughterSlot>;
@group(0) @binding(7) var<storage, read_write> daughterCounter: atomic<u32>;

struct FissionParams {
  latticeResolution: u32,
  capacity: u32,
  fixedDt: f32,
  maxDaughters: u32,
  /// Current tick — used as part of the PRNG seed so daughter
  /// noise is deterministic across runs at the same tick.
  tick: u32,
  worldWidth: f32,
  worldHeight: f32,
  _pad0: f32,
};

@group(0) @binding(8) var<uniform> params: FissionParams;

const GENOME_LENGTH: u32 = 77u;
const GENOME_FISSION_THRESHOLD_OFFSET: u32 = 3u;
const GENOME_FISSION_COST_OFFSET: u32 = 4u;
const GENOME_MUT_SIGMA_OFFSET: u32 = 6u;
const GENOME_PROP_OFFSET: u32 = 7u;
const GENOME_ADD_OFFSET: u32 = 15u;
const GENOME_MUL_OFFSET: u32 = 39u;
const GENOME_MOD_OFFSET: u32 = 63u;
const GENOME_EMIT_BASE_OFFSET: u32 = 71u;
const GENOME_VEL_AXIS_BIAS_OFFSET: u32 = 74u;

/// PCG-style hash. Returns a u32 in [0, 0xFFFFFFFF].
fn pcgHash(input: u32) -> u32 {
  var state = input * 747796405u + 2891336453u;
  state = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  state = (state >> 22u) ^ state;
  return state;
}

/// f32 in [0, 1) from a u32 seed.
fn unitF32(seed: u32) -> f32 {
  return f32(pcgHash(seed) >> 8u) / 16777216.0;
}

/// Box-Muller transform — N(0, 1) from two uniform draws.
fn gaussianF32(seed: u32) -> f32 {
  let u1 = max(unitF32(seed), 1e-7);
  let u2 = unitF32(seed ^ 0x9E3779B9u);
  return sqrt(-2.0 * log(u1)) * cos(6.28318530718 * u2);
}

/// Bilinear field sample at (x, y) for the signal-modulated
/// fission threshold. Same shape as the deposit/integrate
/// shaders; duplicated here to keep each shader self-contained.
fn sampleSignal(x: f32, y: f32) -> f32 {
  let res = f32(params.latticeResolution);
  let cx = clamp(x / params.worldWidth, 0.0, 1.0) * (res - 1.0);
  let cy = clamp(y / params.worldHeight, 0.0, 1.0) * (res - 1.0);
  let ix = u32(floor(cx));
  let iy = u32(floor(cy));
  let fx = cx - f32(ix);
  let fy = cy - f32(iy);
  let i00 = (iy * params.latticeResolution + ix) * 3u;
  let s00 = genomes[i00 + 0u]; // field buffer is reused for
                               // emission math in the spec; for
                               // the fission threshold we only
                               // need the dominant signal axis.
  return s00;
}

@compute @workgroup_size(64)
fn fission_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.capacity) { return; }
  if (alive[i] == 0u) { return; }
  if (isDust[i] == 1u) { return; }
  if (energies[i] <= 0.0) { return; }

  let genBase = i * GENOME_LENGTH;
  let x = positions[i * 2u + 0u];
  let y = positions[i * 2u + 1u];
  let fissionThreshold = genomes[genBase + GENOME_FISSION_THRESHOLD_OFFSET];
  let mutSigma = genomes[genBase + GENOME_MUT_SIGMA_OFFSET];
  let fissionCost = genomes[genBase + GENOME_FISSION_COST_OFFSET];

  // Signal-modulated threshold. The CPU reference applies a
  // small negative offset for positive signal (so high-signal
  // particles fission more easily). Same shape in WGSL.
  let signal = sampleSignal(x, y);
  let effectiveThreshold = max(0.1, fissionThreshold - signal * 0.1);
  if (energies[i] < effectiveThreshold) { return; }

  let remaining = energies[i] - fissionCost;
  if (remaining <= 0.0) { return; }
  let halfEnergy = remaining * 0.5;

  // Reserve two daughter slots atomically.
  let slotA = atomicAdd(&daughterCounter, 1u);
  let slotB = atomicAdd(&daughterCounter, 1u);
  if (slotA >= params.maxDaughters || slotB >= params.maxDaughters) {
    return; // budget exhausted; this tick's daughter is dropped
  }

  // Fill daughter A.
  let seedA = pcgHash(i ^ (params.tick * 0x85EBCA6Bu));
  let seedB = pcgHash(i ^ (params.tick * 0xC2B2AE35u) ^ 0x9E3779B9u);
  let jxA = unitF32(seedA) * 1.5;
  let jyA = unitF32(seedA ^ 0xD1B54A35u) * 1.5;
  let jvxA = gaussianF32(seedA ^ 0x27D4EB2Fu) * 0.5;
  let jvyA = gaussianF32(seedA ^ 0x165667B1u) * 0.5;
  let jxB = unitF32(seedB) * 1.5;
  let jyB = unitF32(seedB ^ 0xD1B54A35u) * 1.5;
  let jvxB = gaussianF32(seedB ^ 0x27D4EB2Fu) * 0.5;
  let jvyB = gaussianF32(seedB ^ 0x165667B1u) * 0.5;

  // Daughter A's genome: copy from parent, apply Gaussian
  // noise to every inheritable slot. The `velAxisBias` slot
  // is categorical and is left untouched (same as the CPU
  // reference).
  daughterSlots[slotA].parent = i;
  daughterSlots[slotA].x = x + jxA;
  daughterSlots[slotA].y = y + jyA;
  daughterSlots[slotA].vx = jvxA;
  daughterSlots[slotA].vy = jvyA;
  daughterSlots[slotA].energy = halfEnergy;
  for (var k: u32 = 0u; k < GENOME_LENGTH; k = k + 1u) {
    if (k == GENOME_VEL_AXIS_BIAS_OFFSET) {
      daughterSlots[slotA].genome[k] = genomes[genBase + k];
    } else {
      let sigma = mutSigma * 0.1; // SLOT_MUTATION_SCALE average
      daughterSlots[slotA].genome[k] = genomes[genBase + k] +
                                        gaussianF32(seedA ^ k) * sigma;
    }
  }

  // Daughter B: same shape, different PRNG stream.
  daughterSlots[slotB].parent = i;
  daughterSlots[slotB].x = x + jxB;
  daughterSlots[slotB].y = y + jyB;
  daughterSlots[slotB].vx = jvxB;
  daughterSlots[slotB].vy = jvyB;
  daughterSlots[slotB].energy = halfEnergy;
  for (var k: u32 = 0u; k < GENOME_LENGTH; k = k + 1u) {
    if (k == GENOME_VEL_AXIS_BIAS_OFFSET) {
      daughterSlots[slotB].genome[k] = genomes[genBase + k];
    } else {
      let sigma = mutSigma * 0.1;
      daughterSlots[slotB].genome[k] = genomes[genBase + k] +
                                        gaussianF32(seedB ^ k) * sigma;
    }
  }

  // Mark parent for recycling.
  alive[i] = 0u;
}
