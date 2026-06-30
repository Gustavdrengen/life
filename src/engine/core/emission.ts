/**
 * Self-modulated signal emission.
 *
 * The signal each particle emits in component axis `c` is:
 *
 *   emit_c = emitBase_c
 *          · exp( Σ_k mod_k · prop_k_effective )
 *          · energyAtten
 *          · velocityBias_c(speed)
 *
 * Where:
 *  - `emitBase_c` is the inheritable base per axis.
 *  - `mod_k` is slot k's modulator coefficient (one per personality).
 *  - `prop_k_effective` is the *effective* (signal-responded) value of
 *    personality slot k at the particle's location. Modulation is
 *    applied on top of response, so emission scales with both the
 *    genome and the local field — not the raw genomic personality.
 *  - `energyAtten = exp(-energyBiasStrength · max(0, 1 - energy / E_ref))`.
 *    Low-energy particles decay smoothly toward 0 output. A dying cell
 *    naturally falls quiet.
 *  - `velocityBias_c` is a 3-vector added to the emission in proportion
 *    to the particle's current speed. The wake shape evolves because
 *    `velAxisBias` (which axis to bias along) and `velBiasStrength` are
 *    inheritable.
 *
 * Dust emits (0, 0, 0) always — the dust genome pins `emitBase = 0` and
 * `energyBiasStrength` to a very large value. This is captured by reading
 * the dust row, which has every inheritable coefficient at zero.
 *
 * @see specs/ROOT.md §5 "Self-modulated signal emission"
 */
import { GENOME_LENGTH, GENOME, PERSONALITY_SLOTS } from './genome.js';
import type { ParticleStorage } from './particles.js';

/** Reference energy used by `energyAtten`. Tuneable from the HUD. */
export const ENERGY_REFERENCE = 1.0;

export interface EmissionResult {
  emit: readonly [number, number, number];
}

/**
 * Compute the emit vector for one particle at the local signal, with the
 * supplied effective-personality array (already signal-responded — see
 * `response.effectivePersonality`).
 */
export function computeEmission(
  storage: ParticleStorage,
  slot: number,
  _signal: readonly [number, number, number],
  effective: Float32Array,
  velocity: readonly [number, number]
): EmissionResult {
  // Dust short-circuits to silence. Cheaper than threading through the
  // full math and matches the spec: dust is first-class but quiet.
  if (storage.isDust[slot] === 1) {
    return { emit: [0, 0, 0] };
  }
  const start = slot * GENOME_LENGTH;
  const emitBase = [
    storage.genomesSoA[start + GENOME.emitBaseOffset]!,
    storage.genomesSoA[start + GENOME.emitBaseOffset + 1]!,
    storage.genomesSoA[start + GENOME.emitBaseOffset + 2]!
  ] as const;
  const velAxisBias = storage.genomesSoA[start + GENOME.velAxisBias]!;
  const velBiasStrength = storage.genomesSoA[start + GENOME.velBiasStrength]!;
  const energyBiasStrength = storage.genomesSoA[start + GENOME.energyBiasStrength]!;
  // Sum over the personality slots, modulator-weighed.
  let modArg = 0;
  for (let i = 0; i < PERSONALITY_SLOTS; i++) {
    const mod = storage.genomesSoA[start + GENOME.modOffset + i]!;
    modArg += mod * effective[i]!;
  }
  // Clamp exponent for numerical safety.
  if (modArg > 50) modArg = 50;
  if (modArg < -50) modArg = -50;
  const baseExp = Math.exp(modArg);
  // Energy attenuation.
  const energy = storage.energies[slot] ?? 0;
  const energyAtten = Math.exp(
    -energyBiasStrength * Math.max(0, 1 - energy / ENERGY_REFERENCE)
  );
  // Velocity-scaled wake along a chosen axis. `velAxisBias` in 2D is a
  // scalar in [-1, 1]; values < 0 bias the wake along -x, > 0 along +x,
  // and large magnitude biases the wake toward -y / +y. We use a tidy
  // decomposition so the wake has visible both axes.
  const speed = Math.sqrt(velocity[0]! * velocity[0]! + velocity[1]! * velocity[1]!);
  const biasClamped = Math.max(-1, Math.min(1, velAxisBias));
  const xWake = biasClamped * speed * velBiasStrength;
  const yWake = (1 - Math.abs(biasClamped)) * speed * velBiasStrength;
  return {
    emit: [
      emitBase[0]! * baseExp * energyAtten + xWake,
      emitBase[1]! * baseExp * energyAtten + yWake,
      emitBase[2]! * baseExp * energyAtten
    ]
  };
}
