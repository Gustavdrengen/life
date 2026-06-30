/**
 * Slot allocator for particle storage. Recycles dead slots in FIFO order
 * but prefers low-index reuse so inner-loop locality stays high. The
 * monotonic `ids` array never reuses an id for the same slot — a slot
 * gets a new id each time it is re-allocated, ensuring lineage tests can
 * detect re-use.
 *
 * Not thread-safe. The step loop is single-threaded (CPU reference) or
 * reduces to per-particle work (GPU compute shaders use indexable
 * lookup tables; this allocator is unused on the GPU).
 */
import type { ParticleStorage } from './particles.js';

export interface SlotAllocatorState {
  /** Monotonic counter, wraps at 2^32 — id collisions across wraparound
   * are tolerable for the test horizon and never block the simulation. */
  nextId: number;
}

export function newSlotAllocatorState(): SlotAllocatorState {
  return { nextId: 1 };
}

/**
 * Allocate a slot. Returns the slot index, or -1 if the storage is full.
 * Does not mark the slot as alive — the caller is expected to write the
 * full slot before flipping `alive[slot] = 1` and incrementing
 * `activeCount`.
 */
export function allocateSlot(
  storage: ParticleStorage,
  state: SlotAllocatorState
): number {
  // Find first inactive slot starting from low index.
  for (let i = 0; i < storage.capacity; i++) {
    if (storage.alive[i] === 0) {
      storage.ids[i] = state.nextId++;
      return i;
    }
  }
  return -1;
}

/** Free a slot. Decrements activeCount. */
export function freeSlot(storage: ParticleStorage, slot: number): void {
  if (slot < 0 || slot >= storage.capacity) {
    throw new RangeError(`freeSlot slot ${slot} out of capacity`);
  }
  if (storage.alive[slot] === 0) return;
  storage.alive[slot] = 0;
  storage.activeCount--;
}
