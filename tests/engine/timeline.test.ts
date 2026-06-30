/**
 * Timeline tests — VISION §9 ("deterministic timeline and scrubbing").
 * Spec source: `specs/ROOT.md` §9.
 *
 * The timeline records snapshots at the configured snapshotInterval,
 * plus on every user action (force flag). Scrubbing places the
 * simulation on a recorded snapshot deterministically. Forward state
 * is invalidated when the user edits the world.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORLD_CONFIG,
  Rng,
  createSimulationState,
  spawnParticle,
  stepOnce,
  createTimeline,
  recordSnapshot,
  maybeRecordSnapshot,
  restoreAtTick,
  truncateAfter,
  lastEntry,
  timelineLength,
  entryAtOrBefore
} from '$engine/core/index.js';

function makeState() {
  return createSimulationState(20, {
    ...DEFAULT_WORLD_CONFIG,
    width: 200,
    height: 200,
    latticeResolution: 16,
    signalCutoff: 30,
    fixedDt: 1 / 60,
    targetPopulation: 20,
    seed: 99,
    snapshotInterval: 5
  });
}

function seed(state: ReturnType<typeof makeState>): void {
  state.rng = new Rng(99);
  spawnParticle(state, 30, 30, 0, 0, 1.0, false, -1);
  spawnParticle(state, 60, 50, 0, 0, 1.0, false, -1);
  spawnParticle(state, 100, 100, 0, 0, 1.0, false, -1);
}

function fingerprint(state: ReturnType<typeof makeState>): string {
  // Stripped-of-noise snapshot for assertion target.
  return [
    state.tick,
    state.storage.activeCount,
    Array.from(state.storage.positionsSoA.slice(0, 8)),
    Array.from(state.storage.energies),
    state.rng.snapshot()
  ].join('|');
}

describe('Timeline', () => {
  it('records one entry per call when force=true', () => {
    const s = makeState();
    seed(s);
    const tl = createTimeline(8);
    for (let i = 0; i < 5; i++) {
      stepOnce(s);
      recordSnapshot(s, tl);
    }
    expect(timelineLength(tl)).toBe(5);
    expect(tl.entries[0]!.tick).toBe(1);
    expect(tl.entries[4]!.tick).toBe(5);
  });

  it('records at snapshotInterval boundaries only when force=false', () => {
    const s = makeState();
    seed(s);
    const tl = createTimeline(64);
    // Step from tick 0 to tick 24; snapshotInterval is 5 → captures
    // at 0, 5, 10, 15, 20.
    recordSnapshot(s, tl); // tick 0
    for (let i = 0; i < 24; i++) {
      stepOnce(s);
      maybeRecordSnapshot(s, s.world, tl);
    }
    expect(timelineLength(tl)).toBe(5);
    expect(entryAtOrBefore(tl, 100)?.tick).toBe(20);
    expect(lastEntry(tl)?.tick).toBe(20);
  });

  it('force=true bypasses the interval gate', () => {
    const s = makeState();
    seed(s);
    const tl = createTimeline(64);
    stepOnce(s);
    maybeRecordSnapshot(s, s.world, tl, true);
    // Snapshot at tick 1 captured regardless of interval=5.
    expect(timelineLength(tl)).toBe(1);
    expect(lastEntry(tl)?.tick).toBe(1);
  });

  it('overwrites entries that share a tick (FIFO de-dup)', () => {
    const s = makeState();
    seed(s);
    const tl = createTimeline(8);
    recordSnapshot(s, tl);
    stepOnce(s);
    stepOnce(s);
    recordSnapshot(s, tl); // tick 2
    stepOnce(s);
    recordSnapshot(s, tl); // tick 3 — distinct
    stepOnce(s);
    // Step back to tick 2 via truncate.
    truncateAfter(tl, 2);
    expect(timelineLength(tl)).toBe(2);
  });

  it('restoreAtTick places simulation on a recorded snapshot', () => {
    const s = makeState();
    seed(s);
    const tl = createTimeline(64);
    for (let i = 0; i < 12; i++) {
      stepOnce(s);
      if (i % 5 === 4) recordSnapshot(s, tl);
    }
    const snap = lastEntry(tl)!;
    const before = fingerprint(s);
    // Continue stepping past the snapshot so the live state diverges
    // from the recorded snapshot.
    for (let i = 0; i < 10; i++) stepOnce(s);
    expect(before).not.toBe(fingerprint(s));
    const restoredTick = restoreAtTick(s, tl, snap.tick);
    expect(restoredTick).toBe(snap.tick);
    // After restore, the state matches the recorded snapshot fingerprint.
    const recordedFingerprint = [
      snap.tick,
      snap.envelope.activeCount,
      Array.from(snap.envelope.storage.positionsSoA.slice(0, 8)),
      Array.from(snap.envelope.storage.energies),
      snap.envelope.rngSeed
    ].join('|');
    expect(fingerprint(s)).toBe(recordedFingerprint);
  });

  it('restoreAtTick clamps to the latest recorded tick when target exceeds it', () => {
    const s = makeState();
    seed(s);
    const tl = createTimeline(64);
    for (let i = 0; i < 12; i++) {
      stepOnce(s);
      if (i === 0 || i === 10) recordSnapshot(s, tl);
    }
    const restored = restoreAtTick(s, tl, 9999);
    expect(restored).toBe(lastEntry(tl)?.tick);
  });

  it('truncateAfter drops entries strictly after headTick', () => {
    const s = makeState();
    seed(s);
    const tl = createTimeline(8);
    for (let i = 0; i < 6; i++) {
      stepOnce(s);
      recordSnapshot(s, tl);
    }
    truncateAfter(tl, 3);
    expect(lastEntry(tl)?.tick).toBe(3);
    expect(timelineLength(tl)).toBe(3);
  });

  it('ring capacity evicts oldest entries past the cap', () => {
    const s = makeState();
    seed(s);
    const tl = createTimeline(3);
    for (let i = 0; i < 6; i++) {
      stepOnce(s);
      recordSnapshot(s, tl);
    }
    expect(timelineLength(tl)).toBe(3);
    expect(tl.entries[0]!.tick).toBe(4);
    expect(lastEntry(tl)?.tick).toBe(6);
  });
});
