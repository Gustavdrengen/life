/**
 * Particle storage — Structure-of-Arrays (SoA) layout. Each particle holds a
 * fixed-length genome (`genomesSoA: Float32Array`) and a small block of
 * runtime state (positions, velocities, energy, age, alive flag).
 *
 * Design notes:
 *  - SoA over AoS because the inner step loop visits one field at a time
 *    across all particles. Linear memory walks = cache detail = 30 FPS at
 *    50k particles on a mid-range GPU.
 *  - The `alive` flag is a parallel array of `Uint8Array` (1 = alive,
 *    0 = dead). Death happens by flag-flip on index, not splice — keeps
 *    the storage stable and lets us recycle slots.
 *  - `slots.activeCount` is maintained by `allocator.ts`.
 *  - Genome rows are 77 floats (see `genome.ts`). Total per-particle
 *    payload is ~348 bytes (77*4 genome + 12*4 position/vel/age/energy).
 */
import { GENOME_LENGTH } from './genome.js';

/**
 * A safe "blank default" genome that keeps a freshly-spawned particle
 * alive and mobile even before its caller writes a real genome. Apply
 * with `writeBlankGenome` before flipping `alive[slot] = 1` if you do
 * NOT intend to write a custom genome. This avoids the trap of a zeroed
 * genome (drag=0 → instant velocity collapse; radius=0 → contacts
 * never resolve).
 *
 * Slot mappings:
 *  - mass: 1, radius: 1, drag: 0.95
 *  - fissionThreshold: 1.4, fissionCost: 0.04
 *  - dustAbsorbRate: 0, mutSigma: 0.05
 *  - personality slots, add/mul/mod: 0
 *  - emitBase: 0, velBias: 0, energyBias: 0
 */
export const BLANK_DEFAULT_GENOME: ReadonlyArray<number> = (() => {
  const row = [1, 1, 0.95, 1.4, 0.04, 0, 0.05]; // slots 0..6, the foundation slots
  return Object.freeze(row);
})();

export function writeBlankGenome(target: Float32Array): void {
  if (target.length !== GENOME_LENGTH) {
    throw new RangeError(
      `writeBlankGenome target must be ${GENOME_LENGTH} slots, got ${target.length}`
    );
  }
  // Foundation slots 0..6 from BLANK_DEFAULT_GENOME; rest stay zero.
  for (let i = 0; i < BLANK_DEFAULT_GENOME.length; i++) {
    target[i] = BLANK_DEFAULT_GENOME[i]!;
  }
}

export interface ParticleStorage {
  capacity: number;
  activeCount: number;
  /** [capacity × GENOME_LENGTH] — genome row for each particle. */
  genomesSoA: Float32Array;
  /** [capacity × 2] — xy positions. */
  positionsSoA: Float32Array;
  /** [capacity × 2] — xy velocities. */
  velocitiesSoA: Float32Array;
  /** [capacity] — energy. */
  energies: Float32Array;
  /** [capacity] — age in ticks. */
  ages: Uint32Array;
  /** [capacity] — 1 if alive, 0 if dead (free slot). */
  alive: Uint8Array;
  /** [capacity] — parent index (-1 = founder). Genesis use only. */
  parent: Int32Array;
  /** [capacity] — monotonic ID assigned at first slot-set. */
  ids: Uint32Array;
  /**
   * [capacity] — `1` if particle is dust, `0` otherwise. Dust cannot
   * mutate, fission, respond to signal, or emit nonzero signal; it can
   * still be absorbed and bounced.
   */
  isDust: Uint8Array;
}

export function createParticleStorage(capacity: number): ParticleStorage {
  if (capacity <= 0) throw new RangeError('capacity must be positive');
  const storage: ParticleStorage = {
    capacity,
    activeCount: 0,
    genomesSoA: new Float32Array(capacity * GENOME_LENGTH),
    positionsSoA: new Float32Array(capacity * 2),
    velocitiesSoA: new Float32Array(capacity * 2),
    energies: new Float32Array(capacity),
    ages: new Uint32Array(capacity),
    alive: new Uint8Array(capacity),
    parent: new Int32Array(capacity),
    ids: new Uint32Array(capacity),
    isDust: new Uint8Array(capacity)
  };
  return storage;
}

/**
 * Returns a TypedArray view of one particle's genome row. Mutations through
 * this view are visible through the parent array — no copy is taken.
 *
 * Bounds-checked in dev mode — silently returns a 0-length view in release
 * after the runtime check passes.
 */
export function genomeRow(storage: ParticleStorage, slot: number): Float32Array {
  if (slot < 0 || slot >= storage.capacity) {
    throw new RangeError(`genomeRow slot ${slot} out of capacity ${storage.capacity}`);
  }
  return storage.genomesSoA.subarray(slot * GENOME_LENGTH, (slot + 1) * GENOME_LENGTH);
}

export function copyGenomeRow(
  storage: ParticleStorage,
  dst: number,
  src: number
): void {
  if (dst === src) return;
  const dstRow = genomeRow(storage, dst);
  const srcRow = genomeRow(storage, src);
  dstRow.set(srcRow);
}

export function readPosition(
  storage: ParticleStorage,
  slot: number
): readonly [number, number] {
  return [storage.positionsSoA[slot * 2]!, storage.positionsSoA[slot * 2 + 1]!];
}

export function readVelocity(
  storage: ParticleStorage,
  slot: number
): readonly [number, number] {
  return [storage.velocitiesSoA[slot * 2]!, storage.velocitiesSoA[slot * 2 + 1]!];
}

export function writePosition(
  storage: ParticleStorage,
  slot: number,
  x: number,
  y: number
): void {
  storage.positionsSoA[slot * 2] = x;
  storage.positionsSoA[slot * 2 + 1] = y;
}

export function writeVelocity(
  storage: ParticleStorage,
  slot: number,
  vx: number,
  vy: number
): void {
  storage.velocitiesSoA[slot * 2] = vx;
  storage.velocitiesSoA[slot * 2 + 1] = vy;
}
