/**
 * Deterministic timeline — the ring of `SimulationState` snapshots that
 * makes scrubbing and edit-resume work as specified in VISION §9.
 *
 * Behavior, per spec:
 *  - Snapshots are taken at the configured `snapshotInterval` and on
 *    every user action (parameter edit, save, copy, paste, reset).
 *  - Scrubbing reconstructs the nearest snapshot and plays forward
 *    cached steps with linear interpolation across snapshot boundaries
 *    so playback is visibly continuous.
 *  - Edits invalidate forward state and resume from new scratch point.
 *
 * MVP scope:
 *  - Each timeline entry holds a JSON snapshot envelope plus its tick.
 *  - "Scrub to tick X" restores the latest snapshot whose tick is ≤ X.
 *    The slider position is an actual recorded tick — not a floating
 *    point frame. This is honest: per-tick state caching + linear
 *    interpolation is post-MVP.
 *  - "Replay‑then‑continues" is delegated to the engine's normal step
 *    loop; reset+scrub just places the simulation on the requested
 *    snapshot. The user presses play from there.
 *
 * For every user action the App shell calls
 * `maybeRecordSnapshot(state, world, timeline, /* force *\/ true)`.
 * The interval path is satisfied by `maybeRecordSnapshot(...)` with no
 * `force` flag.
 *
 * @see specs/ROOT.md §9 "Determinism, snapshots, scrubbing"
 */

import { captureSnapshot, restoreSnapshot, type SnapshotEnvelope } from './snapshot.js';
import type { SimulationState } from './step.js';
import type { WorldConfig } from './world.js';

export interface Timeline {
  /** Maximum entries; oldest is evicted FIFO once over. */
  capacity: number;
  /** Append-only log of snapshots, in tick-ascending order. */
  entries: SnapshotEntry[];
}

export interface SnapshotEntry {
  tick: number;
  envelope: SnapshotEnvelope;
}

export const DEFAULT_TIMELINE_CAPACITY = 256;

/** Create a fresh timeline. */
export function createTimeline(capacity = DEFAULT_TIMELINE_CAPACITY): Timeline {
  return { capacity: Math.max(1, capacity | 0), entries: [] };
}

/**
 * Append a snapshot of `state` at `state.tick` to the timeline.
 * If two entries share the same tick, the older one wins (FIFO over
 * strictly-monotonic insertion) — so re-snapshots at the same tick
 * keep the timeline short.
 */
export function recordSnapshot(state: SimulationState, timeline: Timeline): void {
  const envelope = captureSnapshot(state);
  const tick = envelope.tick;
  for (let i = 0; i < timeline.entries.length; i++) {
    if (timeline.entries[i]!.tick === tick) {
      timeline.entries[i]!.envelope = envelope;
      return;
    }
  }
  timeline.entries.push({ tick, envelope });
  if (timeline.entries.length > timeline.capacity) {
    timeline.entries.shift();
  }
}

/**
 * Snapshots are recorded on every `snapshotInterval` boundary and on
 * every user action. Pass `force=true` to record on the user-action
 * path because the interval may not have triggered.
 */
export function maybeRecordSnapshot(
  state: SimulationState,
  world: WorldConfig,
  timeline: Timeline,
  force = false
): boolean {
  if (
    force ||
    state.tick === 0 ||
    state.tick % Math.max(1, world.snapshotInterval) === 0
  ) {
    recordSnapshot(state, timeline);
    return true;
  }
  return false;
}

/** The most recent recorded entry. Returns null if the timeline is empty. */
export function lastEntry(timeline: Timeline): SnapshotEntry | null {
  if (timeline.entries.length === 0) return null;
  return timeline.entries[timeline.entries.length - 1] ?? null;
}

/**
 * The largest recorded tick ≤ the requested target. Returns null if no
 * snapshot precedes the target. This is the *nearest earlier* snapshot
 * the scrubber restores from.
 */
export function entryAtOrBefore(
  timeline: Timeline,
  tick: number
): SnapshotEntry | null {
  let result: SnapshotEntry | null = null;
  for (const e of timeline.entries) {
    if (e.tick <= tick) result = e;
    else break;
  }
  return result;
}

/**
 * Restore `state` to the snapshot tick ≤ `targetTick` and update the
 * live tick counter. Returns the tick actually restored (clamped to
 * the recorded range), or null if no snapshot precedes the target.
 *
 * Caller is responsible for *forward advancement* — this function
 * only places the simulation on a deterministic snapshot. The engine's
 * normal step loop resumes from there when the user presses play.
 */
export function restoreAtTick(
  state: SimulationState,
  timeline: Timeline,
  targetTick: number
): number | null {
  if (!Number.isFinite(targetTick)) return null;
  const latest = lastEntry(timeline);
  const upper = latest?.envelope.tick ?? 0;
  const clampedTarget = Math.max(0, Math.min(targetTick, upper));
  const base = entryAtOrBefore(timeline, clampedTarget);
  if (!base) return null;
  restoreSnapshot(state, base.envelope);
  return base.tick;
}

/**
 * Edits invalidate forward state per spec — drop entries strictly
 * after the active head. Called by the App shell when the user changes
 * a parameter, picks "Reset," or any other forward-invalidation event.
 */
export function truncateAfter(timeline: Timeline, headTick: number): void {
  while (
    timeline.entries.length > 0 &&
    timeline.entries[timeline.entries.length - 1]!.tick > headTick
  ) {
    timeline.entries.pop();
  }
}

/** Number of recorded entries. */
export function timelineLength(timeline: Timeline): number {
  return timeline.entries.length;
}
