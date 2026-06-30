/**
 * Signal-derived force on a particle.
 *
 * The force is the gradient of Σ_p p' — the sum of effective personality
 * values, where the personality is signal-responded at the particle's
 * location. We approximate the gradient by sampling the field at
 * four nearby points and applying central differences on each signal
 * axis. The contribution from each personality slot maps onto the
 * underlying field, so the force direction is determined by the local
 * topography of the effective-personality landscape.
 *
 * Central differences are cheaper than per-slot finite differences
 * over the field and identical for the inner-loop hot path:
 *   - The force magnitude is `Σ_p ∂p'/∂x + ∂p'/∂y` for the two axes.
 *   - We compute the gradient via numerical differentiation of the
 *     field along a small stencil. The effective personality is
 *     *not* differentiated slot-by-slot; that's a GPU-only optimization.
 *
 * Conservation: there is no work performed on the field itself in this
 * step — field updates happen in Pass A via `deposit`. The force here
 * reads the freshly-computed field and pushes particles through it.
 * Energy count (Σ particle energy + Σ dust energy) is unchanged by the
 * force step alone. Motion costs are paid in Pass B as dust emission.
 *
 * @see specs/ROOT.md §6 "Motion, dust, and energy conservation"
 */
import { GENOME_LENGTH, PERSONALITY_SLOTS } from './genome.js';
import { sample, type SignalField } from './field.js';
import { effectivePersonality } from './response.js';
import type { WorldDims } from './field.js';

export interface Force {
  x: number;
  y: number;
}

const STENCIL_HALF = 1.5; // distance units for finite-difference stencil

/**
 * Compute (force.x, force.y) on one particle at world (x,y) given the
 * freshly-updated signal field. `effective` is a scratch buffer of
 * length PERSONALITY_SLOTS; we reuse it for every cell sample to avoid
 * allocation inside the inner step loop.
 */
export function forceFromSignal(
  genomeRow: Float32Array,
  field: SignalField,
  world: WorldDims,
  x: number,
  y: number,
  effective: Float32Array
): Force {
  if (genomeRow.length !== GENOME_LENGTH) {
    throw new RangeError(
      `forceFromSignal expects a 77-slot genome row, got ${genomeRow.length}`
    );
  }
  const sigXp = signalSumAt(field, world, x + STENCIL_HALF, y, genomeRow, effective);
  const sigXm = signalSumAt(field, world, x - STENCIL_HALF, y, genomeRow, effective);
  const sigYp = signalSumAt(field, world, x, y + STENCIL_HALF, genomeRow, effective);
  const sigYm = signalSumAt(field, world, x, y - STENCIL_HALF, genomeRow, effective);
  const dx = (sigXp - sigXm) / (2 * STENCIL_HALF);
  const dy = (sigYp - sigYm) / (2 * STENCIL_HALF);
  return { x: dx, y: dy };
}

/**
 * Sum of effective personality values at a single point — used as a
 * scalar proxy for the field in the central-difference gradient.
 */
function signalSumAt(
  field: SignalField,
  world: WorldDims,
  x: number,
  y: number,
  genomeRow: Float32Array,
  effective: Float32Array
): number {
  const signal = sample(field, world, x, y);
  effectivePersonality(genomeRow, signal, effective);
  let sum = 0;
  for (let i = 0; i < PERSONALITY_SLOTS; i++) sum += effective[i]!;
  return sum;
}
