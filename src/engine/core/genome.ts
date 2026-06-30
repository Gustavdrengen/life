/**
 * Genome layout — the single source of truth for the fixed-length genome vector
 * used by every particle in the simulation. Slot indices are exported as a
 * const enum so they fold at compile time. Magic numbers in code must never
 * reach for these slots by index; always reference the named entry below.
 *
 * Genome bit width: 77 slots × 4 bytes = 308 bytes per particle for the genome
 * alone. Per-particle runtime state (position, velocity, energy, age, flags)
 * is stored separately; see {@link './particles.ts'}.
 *
 * @see specs/ROOT.md §2 "Genome layout" for the spec source.
 */

export const SIGNAL_AXES = 3;
export const PERSONALITY_SLOTS = 8;
export const GENOME_LENGTH = 77;

export const GENOME = {
  mass: 0,
  radius: 1,
  drag: 2,
  fissionThreshold: 3,
  fissionCost: 4,
  dustAbsorbRate: 5,
  mutSigma: 6,
  propOffset: 7,
  addOffset: 15,
  mulOffset: 39,
  modOffset: 63,
  emitBaseOffset: 71,
  velAxisBias: 74,
  velBiasStrength: 75,
  energyBiasStrength: 76
} as const;

/**
 * Reads one personality slot's raw value + 3-component additive offsets +
 * 3-component multiplicative coefficients from a genome Float32Array.
 *
 * Pure function — performs no allocation, reads are bounds-checked in dev
 * mode via `assert`. Used by the response math (`./response.ts`) and is on
 * the inner step loop.
 */
export interface PersonalityAccess {
  prop: number;
  add: readonly [number, number, number];
  mul: readonly [number, number, number];
  mod: number;
}

export function readPersonality(
  genome: Float32Array,
  slot: number
): PersonalityAccess {
  if (slot < 0 || slot >= PERSONALITY_SLOTS) {
    throw new RangeError(`personality slot ${slot} out of range`);
  }
  const propIdx = GENOME.propOffset + slot;
  const addIdx = GENOME.addOffset + slot * SIGNAL_AXES;
  const mulIdx = GENOME.mulOffset + slot * SIGNAL_AXES;
  const modIdx = GENOME.modOffset + slot;
  return {
    prop: genome[propIdx]!,
    add: [genome[addIdx]!, genome[addIdx + 1]!, genome[addIdx + 2]!] as const,
    mul: [genome[mulIdx]!, genome[mulIdx + 1]!, genome[mulIdx + 2]!] as const,
    mod: genome[modIdx]!
  };
}

/** Dust has its own canonical, never-mutating genome. Always zero — quiet. */
export function writeDustGenome(target: Float32Array): void {
  if (target.length !== GENOME_LENGTH) {
    throw new RangeError(
      `dust genome target length must be ${GENOME_LENGTH}, got ${target.length}`
    );
  }
  target.fill(0);
}

/**
 * Per-slot mutation scale basis. Multiplied by the parent's `mutSigma` to
 * produce the Gaussian σ applied to each inheritable slot at fission.
 *
 * Slot categories:
 *  - 0..6 (mass, radius, drag, fissionThreshold, fissionCost, dustAbsorbRate,
 *    mutSigma): moderate, except `mass/radius` which are smaller to prevent
 *    numerical instability at fission.
 *  - 7..14 (prop slots): large — these are the personality carriers.
 *  - 15..38 (add coefficients): small — additive shifts accumulate, large
 *    noise destabilizes the response curve.
 *  - 39..62 (mul coefficients): small.
 *  - 63..70 (mod coefficients): large — emission moduli evolve freely.
 *  - 71..73 (emitBase): small.
 *  - 74 (velAxisBias): categorical — no noise (axis choice is bimodal in 2D).
 *  - 75..76 (velBiasStrength, energyBiasStrength): small.
 */
export const SLOT_MUTATION_SCALE: readonly number[] = (() => {
  const scale = new Array<number>(GENOME_LENGTH).fill(0.1);
  for (let i = 0; i < 7; i++) scale[i] = 0.05;
  for (let i = 15; i < 39; i++) scale[i] = 0.05;
  for (let i = 39; i < 63; i++) scale[i] = 0.05;
  for (let i = 71; i < 74; i++) scale[i] = 0.05;
  scale[GENOME.velAxisBias] = 0;
  scale[GENOME.velBiasStrength] = 0.05;
  scale[GENOME.energyBiasStrength] = 0.05;
  return Object.freeze(scale);
})();

export function slotMutationScale(slot: number): number {
  const v = SLOT_MUTATION_SCALE[slot];
  if (v === undefined) throw new RangeError(`slot ${slot} out of mutation scale array`);
  return v;
}
