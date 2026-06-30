/**
 * World configuration — all the parameters that govern simulation behavior.
 *
 * Single source of truth for tunable constants. The HUD mutates a shallow
 * clone of this object; the engine reads it once per tick (it is held by
 * reference inside the step module to keep inner-loop lookups cheap).
 *
 * @see specs/ROOT.md §3 "Signal field" and §6-7 for the corresponding physics.
 */
export interface WorldConfig {
  /** Simulation volume width / height (cells draw on a 2D view volume). */
  width: number;
  height: number;

  /** Lattice cells per axis (signal field resolution). Total cells = n^2 × 3. */
  latticeResolution: number;

  /** Cutoff distance beyond which an emitter contributes nothing. */
  signalCutoff: number;

  /** Minimum separation before a contact is considered (sum of radii). */
  contactSeparation: number;

  /** Relative velocity threshold above which faster particle can absorb slower. */
  predationSpeedThreshold: number;

  /** Energy/sec absorbed from nearby dust when moving above dustAbsorbSpeed. */
  dustAbsorbSpeed: number;

  /** Snapshots are taken every N ticks (and on every user action). */
  snapshotInterval: number;

  /** Fixed time step per tick, seconds. */
  fixedDt: number;

  /** Optional seed for reproducibility. */
  seed: number;

  /** Target population at MVP. */
  targetPopulation: number;
}

export const DEFAULT_WORLD_CONFIG: Readonly<WorldConfig> = Object.freeze({
  width: 800,
  height: 600,
  latticeResolution: 32,
  signalCutoff: 60,
  contactSeparation: 2.0,
  predationSpeedThreshold: 1.0,
  dustAbsorbSpeed: 0.5,
  snapshotInterval: 60,
  fixedDt: 1 / 60,
  seed: 0xcafe_babe,
  targetPopulation: 50_000
});

export function cloneWorldConfig(src: WorldConfig): WorldConfig {
  return { ...src };
}
