/**
 * Population-level genome drift metric — closes VISION §Success #2
 * ("genome centers visibly drift") and #9 ("a global parameter change
 * produces visible behavioral consequence within one minute").
 *
 * Without a quantitative reading the only tier-2 evidence is an
 * adjective next to a PNG. With it, every bench, capture, and
 * state-of-play sweep can cite a number.
 *
 * Spec: specs/genome_drift.md.
 *
 * Dust is excluded — emitting dust into the population variance would
 * dominate any signal because dust carries the canonical mute genome
 * regardless of how much of it is currently flowing through the world.
 */

import { GENOME, GENOME_LENGTH } from './genome.js';
import type { SimulationState } from './step.js';

export interface DriftStats {
  /** Number of alive, non-dust slots sampled. */
  count: number;
  /** Per-slot mean across sampled rows. Length `GENOME_LENGTH`. */
  mean: Float32Array;
  /** Per-slot population variance across sampled rows. */
  variance: Float32Array;
  /** L2 magnitude of `mean` — single-number tractable proxy. */
  centroidNorm: number;
}

export interface DriftVector {
  /** `sqrt(Σ_s (mean_to[s] − mean_from[s])²)` over all slots. */
  slottedL2: number;
  /** Per-slot sign of the mean delta: -1, 0, or +1. */
  meanShiftSign: Int8Array;
  /** `max_s |mean_to[s] − mean_from[s]|` — loudest single axis. */
  maxSlotDelta: number;
}

/**
 * Mean and variance of genome positions across alive non-dust slots.
 * Deterministic — same `state` ⇒ byte-identical outputs.
 *
 * The `slotMask` parameter lets callers restrict the measurement
 * (e.g. per cluster, per archetype). `undefined` ⇒ measure all alive
 * non-dust slots. Skipped slots behave the same as dead slots.
 */
export function genomeStats(
  state: SimulationState,
  slotMask?: Uint8Array
): DriftStats {
  let count = 0;
  const mean = new Float32Array(GENOME_LENGTH);
  const variance = new Float32Array(GENOME_LENGTH);
  // Two-pass: we need the mean before the variance; blends the sums
  // straight onto Float64 accumulators for accuracy on large N.
  const sum = new Float64Array(GENOME_LENGTH);

  const storage = state.storage;
  for (let i = 0; i < storage.capacity; i++) {
    if (storage.alive[i] !== 1) continue;
    if (storage.isDust[i] === 1) continue;
    if (slotMask !== undefined && slotMask[i] !== 1) continue;
    const row = storage.genomesSoA.subarray(
      i * GENOME_LENGTH,
      (i + 1) * GENOME_LENGTH
    );
    for (let k = 0; k < GENOME_LENGTH; k++) sum[k]! += row[k]!;
    count++;
  }

  if (count === 0) {
    return { count: 0, mean, variance, centroidNorm: 0 };
  }
  const inv = 1 / count;
  for (let k = 0; k < GENOME_LENGTH; k++) {
    mean[k] = sum[k]! * inv;
  }

  // Second pass for variance — only one walk, store as Float32 to
  // match the rest of the genome surface.
  for (let i = 0; i < storage.capacity; i++) {
    if (storage.alive[i] !== 1) continue;
    if (storage.isDust[i] === 1) continue;
    if (slotMask !== undefined && slotMask[i] !== 1) continue;
    const row = storage.genomesSoA.subarray(
      i * GENOME_LENGTH,
      (i + 1) * GENOME_LENGTH
    );
    for (let k = 0; k < GENOME_LENGTH; k++) {
      const d = row[k]! - mean[k]!;
      variance[k]! += d * d;
    }
  }
  for (let k = 0; k < GENOME_LENGTH; k++) variance[k]! *= inv;

  let centroidNormSq = 0;
  for (let k = 0; k < GENOME_LENGTH; k++) centroidNormSq += mean[k]! * mean[k]!;
  return { count, mean, variance, centroidNorm: Math.sqrt(centroidNormSq) };
}

/**
 * L2 magnitude of the per-slot mean over the personality slots only —
 * the 8 `prop` values, the 24 `add` coefficients, the 24 `mul`
 * coefficients, and the 8 `mod` coefficients. This sub-norm is the
 * "how much personality signal does this population carry" readout;
 * `centroidNorm` is contaminated by the foundation-slot floor
 * (`mass=1, radius=1, drag=0.95, …`).
 *
 * Cheap: walks the already-computed `mean` once. Pass the
 * `genomeStats` result, not the raw state.
 */
export function personalityNorm(stats: DriftStats): number {
  let sq = 0;
  const m = stats.mean;
  for (let k = GENOME.propOffset; k < GENOME.modOffset + 8; k++) {
    const v = m[k] ?? 0;
    sq += v * v;
  }
  return Math.sqrt(sq);
}

/**
 * Drift between two snapshots. Both inputs must come from the same
 * `Slot length` — `genomeStats` keeps them consistent. Drift is
 * symmetric and sign-aware.
 */
export function genomeDrift(from: DriftStats, to: DriftStats): DriftVector {
  if (from.mean.length !== GENOME_LENGTH || to.mean.length !== GENOME_LENGTH) {
    throw new RangeError(
      `genomeDrift: mean length must be ${GENOME_LENGTH}, got ${from.mean.length} / ${to.mean.length}`
    );
  }
  const sign = new Int8Array(GENOME_LENGTH);
  let slottedL2Sq = 0;
  let maxAbs = 0;
  for (let k = 0; k < GENOME_LENGTH; k++) {
    const d = to.mean[k]! - from.mean[k]!;
    slottedL2Sq += d * d;
    const ad = Math.abs(d);
    if (ad > maxAbs) maxAbs = ad;
    sign[k] = d > 0 ? 1 : d < 0 ? -1 : 0;
  }
  return {
    slottedL2: Math.sqrt(slottedL2Sq),
    meanShiftSign: sign,
    maxSlotDelta: maxAbs
  };
}
