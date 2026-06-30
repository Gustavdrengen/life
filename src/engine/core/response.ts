/**
 * Per-property signal response math.
 *
 * For every inheritable slot `p` and current signal `s ∈ ℝ³` at the
 * particle's position, the effective value is:
 *
 *   p' = (p + a₀·s₀ + a₁·s₁ + a₂·s₂) · exp(m₀·s₀ + m₁·s₁ + m₂·s₂)
 *
 * Additive shifts the base value, multiplicative scales (positive for
 * positive inputs by construction). Both coefficient families are
 * inheritable — evolution tunes them.
 *
 * Implementation notes:
 *  - The response is applied at sample time (before each event the
 *    particle acts on), not at fission time. The parent genome is
 *    invariant; the *effective* genome shifts with location.
 *  - The math is bounded: `exp` overflow guards clip m·s above ~50.
 *  - For dust, response is a no-op — dust emits silence regardless of
 *    the local field, so its effective genome does not matter.
 *
 * @see specs/ROOT.md §4 "Per-property signal response"
 */
import {
  PERSONALITY_SLOTS,
  SIGNAL_AXES,
  readPersonality,
  type PersonalityAccess
} from './genome.js';

const MAX_EXP_ARG = 50;

/**
 * Compute the effective value of one personality slot at the local signal.
 * Pure, allocation-free, bounds-checked in dev mode via `readPersonality`.
 */
export function effectiveSlotValue(
  slot: PersonalityAccess,
  signal: readonly [number, number, number]
): number {
  let additive = slot.prop;
  let expArg = 0;
  for (let axis = 0; axis < SIGNAL_AXES; axis++) {
    additive += slot.add[axis]! * signal[axis]!;
    expArg += slot.mul[axis]! * signal[axis]!;
  }
  // Hard-clip exp argument to avoid `Infinity`. Visual math tolerates the
  // clip because effective genome values above ~e^50 are not actionable.
  if (expArg > MAX_EXP_ARG) expArg = MAX_EXP_ARG;
  if (expArg < -MAX_EXP_ARG) expArg = -MAX_EXP_ARG;
  return additive * Math.exp(expArg);
}

/**
 * Apply the response across all 8 personality slots for one particle.
 * Writes the result into a pre-allocated `out` array.
 */
export function effectivePersonality(
  genome: Float32Array,
  signal: readonly [number, number, number],
  out: Float32Array
): void {
  if (out.length !== PERSONALITY_SLOTS) {
    throw new RangeError(
      `effectivePersonality out length must be ${PERSONALITY_SLOTS}, got ${out.length}`
    );
  }
  for (let i = 0; i < PERSONALITY_SLOTS; i++) {
    out[i] = effectiveSlotValue(readPersonality(genome, i), signal);
  }
}
