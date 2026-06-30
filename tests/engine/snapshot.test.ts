/**
 * Snapshot tests — VISION §10 success criterion #6: state save/load
 * reproduces earlier states bit-perfect on the same machine. Specified
 * in `specs/ROOT.md` §9.
 *
 * We capture a snapshot at tick T, step a few more ticks, restore the
 * snapshot, and assert the live state matches what we captured. The
 * same steps after restore must also reproduce bit-by-bit, validating
 * the env-rng-seed plumbing.
 */
import { describe, expect, it } from 'vitest';
import {
  Rng,
  createSimulationState,
  stepOnce,
  spawnParticle,
  DEFAULT_WORLD_CONFIG,
  captureSnapshot,
  restoreSnapshot,
  snapshotToString,
  snapshotFromString
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
    seed: 1234
  });
}

function seed(state: ReturnType<typeof makeState>): void {
  state.rng = new Rng(1234);
  spawnParticle(state, 30, 30, 0, 0, 1.0, false, -1);
  spawnParticle(state, 60, 50, 0, 0, 1.0, false, -1);
  spawnParticle(state, 100, 100, 0, 0, 1.0, false, -1);
  spawnParticle(state, 130, 70, 0, 0, 1.0, false, -1);
}

function fingerprint(state: ReturnType<typeof makeState>): string {
  return [
    state.tick,
    state.storage.activeCount,
    Array.from(state.storage.positionsSoA),
    Array.from(state.storage.velocitiesSoA),
    Array.from(state.storage.energies),
    Array.from(state.storage.alive),
    state.rng.snapshot()
  ].join('|');
}

describe('captureSnapshot + restoreSnapshot', () => {
  it('round-trips the live state bit-perfect at capture time', () => {
    const s = makeState();
    seed(s);
    for (let i = 0; i < 30; i++) stepOnce(s);
    const env = captureSnapshot(s);
    const restored = makeState();
    restoreSnapshot(restored, env);
    expect(fingerprint(restored)).toBe(fingerprint(s));
  });

  it('restored state evolves bit-identically from the same seed', () => {
    const a = makeState();
    seed(a);
    for (let i = 0; i < 30; i++) stepOnce(a);
    const env = captureSnapshot(a);

    const b = makeState();
    seed(b);
    for (let i = 0; i < 30; i++) stepOnce(b);
    restoreSnapshot(b, env);
    // Step both forwarded by the same number of post-restore ticks.
    for (let i = 0; i < 30; i++) stepOnce(a);
    for (let i = 0; i < 30; i++) stepOnce(b);
    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it('snapshotToString then snapshotFromString round-trips', () => {
    const s = makeState();
    seed(s);
    for (let i = 0; i < 10; i++) stepOnce(s);
    const env = captureSnapshot(s);
    const json = snapshotToString(env);
    const restored = snapshotFromString(json);
    expect(restored.tick).toBe(env.tick);
    expect(restored.capacity).toBe(env.capacity);
    expect(restored.world).toEqual(env.world);
    expect(restored.storage.alive.length).toBe(env.storage.alive.length);
  });

  it('rejects envelopes with wrong format', () => {
    const s = makeState();
    seed(s);
    const env = captureSnapshot(s);
    const bad = { ...env, format: 'wrong-format' };
    expect(() => snapshotFromString(JSON.stringify(bad))).toThrow(/format/);
  });

  it('rejects envelopes with mismatched capacity', () => {
    const s = makeState();
    seed(s);
    const env = captureSnapshot(s);
    const other = createSimulationState(40, {
      ...DEFAULT_WORLD_CONFIG,
      width: 200,
      height: 200,
      latticeResolution: 16,
      signalCutoff: 30,
      fixedDt: 1 / 60,
      targetPopulation: 40,
      seed: 1234
    });
    expect(() => restoreSnapshot(other, env)).toThrow(/capacity/);
  });
});
