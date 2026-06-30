/**
 * Organism clipboard — copy a subset of particles from one world into
 * another via a JSON envelope, independent of the snapshot format.
 *
 * Per VISION §10 "Organism cloning": a cluster of particles (an emerging
 * organism) can be copied to a clipboard-like archive and pasted into
 * a different world to seed a new lineage. The archive stores each
 * particle's genome row, runtime state, and a normalized "cluster
 * center" so the paste path can scatter the cluster around the dropped
 * point instead of a raw replay.
 *
 * Format is a version-stamped JSON envelope distinct from the full
 * snapshot so a future GPU-buffer streaming path can adopt either
 * format independently.
 *
 * @see VISION.md §10 "State save / restore and organism cloning"
 */

import { GENOME_LENGTH } from './genome.js';
import type { SimulationState } from './step.js';
import { writePosition, writeVelocity } from './particles.js';
import { allocateSlot } from './allocator.js';

export const CLIPBOARD_FORMAT = 'particle-ecosystem-simulator/organism';
export const CLIPBOARD_VERSION = 1;

export interface OrganismPayload {
  /** Number of particles in the archive (== members.length). */
  count: number;
  /** Per-particle rows, in archive order. */
  members: OrganismMember[];
}

export interface OrganismMember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  parent: number;
  age: number;
  /** A 77-slot genome row. */
  genome: number[];
  /** Stable id (assigned at first spawn); server-of-origin marker. */
  id: number;
}

export interface OrganismClipboard {
  format: typeof CLIPBOARD_FORMAT;
  version: typeof CLIPBOARD_VERSION;
  /** Cluster center of mass at copy time — used to normalize the
   * pasted cluster around the drop point. */
  centerX: number;
  centerY: number;
  /** Total captured population count. */
  count: number;
  members: OrganismMember[];
}

/**
 * Copy `slots` from `state` into a clipboard envelope. `slots` must
 * reference alive, non-dust particles (dust is excluded — it cannot
 * form organisms per VISION §6).
 *
 * Throws if any slot is out of range, dead, or dust.
 */
export function copyOrganism(
  state: SimulationState,
  slots: readonly number[]
): OrganismClipboard {
  const members: OrganismMember[] = new Array(slots.length);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (slot < 0 || slot >= state.storage.capacity) {
      throw new RangeError(`copyOrganism: slot ${slot} out of range`);
    }
    if (state.storage.alive[slot] !== 1) {
      throw new Error(`copyOrganism: slot ${slot} is not alive`);
    }
    if (state.storage.isDust[slot] === 1) {
      throw new Error(`copyOrganism: slot ${slot} is dust; cannot copy`);
    }
    const x = state.storage.positionsSoA[slot * 2] ?? 0;
    const y = state.storage.positionsSoA[slot * 2 + 1] ?? 0;
    cx += x;
    cy += y;
    const row = state.storage.genomesSoA.subarray(
      slot * GENOME_LENGTH,
      (slot * GENOME_LENGTH) + GENOME_LENGTH
    );
    members[i] = {
      x,
      y,
      vx: state.storage.velocitiesSoA[slot * 2] ?? 0,
      vy: state.storage.velocitiesSoA[slot * 2 + 1] ?? 0,
      energy: state.storage.energies[slot] ?? 0,
      parent: state.storage.parent[slot] ?? -1,
      age: state.storage.ages[slot] ?? 0,
      id: state.storage.ids[slot] ?? 0,
      genome: Array.from(row)
    };
  }
  const centerX = members.length > 0 ? cx / members.length : 0;
  const centerY = members.length > 0 ? cy / members.length : 0;
  return {
    format: CLIPBOARD_FORMAT,
    version: CLIPBOARD_VERSION,
    centerX,
    centerY,
    count: members.length,
    members
  };
}

/** Serialize clipboard to JSON. */
export function clipboardToString(cb: OrganismClipboard): string {
  return JSON.stringify(cb);
}

/** Parse a clipboard JSON envelope. *
 * Validates format + version + shape but does not check genome length
 * (the engine may evolve to a longer genome in a future format revision).
 */
export function clipboardFromString(json: string): OrganismClipboard {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('clipboardFromString: top-level is not an object');
  }
  const cb = parsed as Partial<OrganismClipboard>;
  if (cb.format !== CLIPBOARD_FORMAT) {
    throw new Error(
      `clipboardFromString: expected format ${CLIPBOARD_FORMAT}, got ${cb.format}`
    );
  }
  if (cb.version !== CLIPBOARD_VERSION) {
    throw new Error(`clipboardFromString: version ${cb.version} not supported`);
  }
  if (
    typeof cb.centerX !== 'number' ||
    typeof cb.centerY !== 'number' ||
    typeof cb.count !== 'number' ||
    !Array.isArray(cb.members) ||
    cb.members.length !== cb.count
  ) {
    throw new Error('clipboardFromString: missing or mismatched members');
  }
  return cb as OrganismClipboard;
}

/** Number of slots that the clipboard needs in the destination world.
 * Use this to decide whether `state` has room before calling pasteOrganism. */
export function clipboardSlotCount(cb: OrganismClipboard): number {
  return cb.members.length;
}

/**
 * Paste `cb` into `state`, scattering the cluster around `dropX`
 * / `dropY`. New slot ids are assigned by the allocator so the archive
 * members keep their origin `id` field as a stable lineage marker.
 *
 * Returns the slot indices of freshly-spawned particles in the same
 * order as `cb.members`, so the caller can e.g. inspect them.
 *
 * Members that don't fit in storage are dropped silently — the slot
 * is unrecoverable in MVP because alive storage is contiguous and
 * exhaustion means the world has already capped.
 */
export function pasteOrganism(
  state: SimulationState,
  cb: OrganismClipboard,
  dropX: number,
  dropY: number
): number[] {
  const newSlots: number[] = [];
  const dx = dropX - cb.centerX;
  const dy = dropY - cb.centerY;
  const s = state.storage;
  for (const member of cb.members) {
    if (s.activeCount >= s.capacity) break; // storage full
    const slot = allocateSlot(s, state.allocator);
    if (slot < 0) continue;
    writePosition(s, slot, member.x + dx, member.y + dy);
    writeVelocity(s, slot, member.vx, member.vy);
    s.energies[slot] = member.energy;
    s.ages[slot] = member.age;
    s.alive[slot] = 1;
    s.parent[slot] = member.parent;
    s.isDust[slot] = 0;
    const row = s.genomesSoA.subarray(slot * GENOME_LENGTH, (slot + 1) * GENOME_LENGTH);
    // Defend against a malformed archive: a wrong-sized genome would
    // tear the SoA buffer; bail out and skip the rest of the paste.
    if (member.genome.length !== GENOME_LENGTH) {
      throw new RangeError(
        `pasteOrganism: member genome length ${member.genome.length} does not match layout ${GENOME_LENGTH}`
      );
    }
    row.set(member.genome);
    s.activeCount++;
    newSlots.push(slot);
  }
  return newSlots;
}
