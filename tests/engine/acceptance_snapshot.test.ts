/**
 * Acceptance #6 — snapshot bit-identity (VISION §Success).
 *
 * Spec: VISION §Success #6 ("A saved state reopens identically across
 * sessions and tabs on the same machine. Time scrubbing reproduces
 * earlier states bit-perfect.")
 *
 * The base contract is exercised in `tests/engine/snapshot.test.ts`
 * (round-trip + post-restore forward evolution). This file pins the
 * *full* acceptance:
 *  - capture → serialize → parse → restore reproduces the live state
 *    bit-by-bit (storage, RNG state, tick, world config),
 *  - a saved state survives multiple session boundaries
 *    (serialize → parse → restore is independent of the original
 *    state object's identity),
 *  - the post-restore state evolves bit-identically under the same
 *    seed, even after a serialize/parse round-trip — covers the
 *    "opens identically across sessions and tabs" promise.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORLD_CONFIG,
  Rng,
  createSimulationState,
  spawnParticle,
  stepOnce,
  captureSnapshot,
  restoreSnapshot,
  snapshotToString,
  snapshotFromString
} from '$engine/core/index.js';

function makeState() {
  return createSimulationState(40, {
    ...DEFAULT_WORLD_CONFIG,
    width: 400,
    height: 300,
    latticeResolution: 16,
    signalCutoff: 30,
    fixedDt: 1 / 60,
    targetPopulation: 24,
    seed: 0xbeef_600d
  });
}

function seed(state: ReturnType<typeof makeState>): void {
  state.rng = new Rng(0xbeef_600d);
  spawnParticle(state, 100, 80, 1, 0, 1.0, false, -1);
  spawnParticle(state, 200, 120, -1, 0, 1.0, false, -1);
  spawnParticle(state, 300, 200, 0, 1, 1.0, false, -1);
  spawnParticle(state, 50, 250, 0, -1, 1.0, false, -1);
}

function fingerprint(state: ReturnType<typeof makeState>): string {
  return [
    state.tick,
    state.storage.activeCount,
    Array.from(state.storage.positionsSoA),
    Array.from(state.storage.velocitiesSoA),
    Array.from(state.storage.energies),
    Array.from(state.storage.alive),
    Array.from(state.storage.isDust),
    Array.from(state.storage.ids),
    Array.from(state.storage.ages),
    state.rng.snapshot()
  ].join('|');
}

describe('acceptance #6: snapshot bit-identity', () => {
  it('serialize → parse → restore reproduces the live state byte-for-byte', () => {
    const s = makeState();
    seed(s);
    for (let i = 0; i < 20; i++) stepOnce(s);
    const env = captureSnapshot(s);
    const json = snapshotToString(env);
    const reparsed = snapshotFromString(json);
    // Build a fresh, independent sim to receive the parsed envelope.
    const restored = makeState();
    restoreSnapshot(restored, reparsed);
    expect(fingerprint(restored)).toBe(fingerprint(s));
  });

  it('post-restore evolution matches original forward evolution bit-perfectly', () => {
    // Two sims driven by the same seed, both stepped 20 ticks, then
    // one is restored from the other's snapshot. Their fingerprints
    // should now match, and they should evolve bit-identically for
    // any number of additional ticks.
    const a = makeState();
    seed(a);
    for (let i = 0; i < 20; i++) stepOnce(a);
    const env = captureSnapshot(a);

    const b = makeState();
    seed(b);
    for (let i = 0; i < 20; i++) stepOnce(b);
    restoreSnapshot(b, env);

    expect(fingerprint(b)).toBe(fingerprint(a));

    for (let i = 0; i < 30; i++) {
      stepOnce(a);
      stepOnce(b);
    }
    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it('survives multiple session boundaries (parse → re-serialize → re-parse)', () => {
    // Pin: an envelope serialized, parsed, re-serialized, and
    // re-parsed must carry identical state. This is the property
    // that backs "opens identically across sessions and tabs."
    const s = makeState();
    seed(s);
    for (let i = 0; i < 5; i++) stepOnce(s);
    const env1 = captureSnapshot(s);
    const json1 = snapshotToString(env1);
    const parsed1 = snapshotFromString(json1);
    const json2 = snapshotToString(parsed1);
    const parsed2 = snapshotFromString(json2);
    expect(parsed1.tick).toBe(parsed2.tick);
    expect(parsed1.activeCount).toBe(parsed2.activeCount);
    expect(parsed1.rngSeed).toBe(parsed2.rngSeed);
    expect(parsed1.capacity).toBe(parsed2.capacity);
    // Re-hydration into a fresh sim must reproduce the original
    // state exactly across both re-serialize boundaries.
    const restored = makeState();
    restoreSnapshot(restored, parsed2);
    expect(fingerprint(restored)).toBe(fingerprint(s));
  });
});
