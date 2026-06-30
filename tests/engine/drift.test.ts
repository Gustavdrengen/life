/**
 * Genome drift metric — `src/engine/core/drift.ts`.
 *
 * Spec: specs/genome_drift.md §5 acceptance criteria.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORLD_CONFIG,
  GENOME,
  GENOME_LENGTH,
  Rng,
  createSimulationState,
  spawnParticle,
  scatterClusteredFounders,
  stepOnce,
  genomeStats,
  genomeDrift,
  personalityNorm
} from '$engine/core/index.js';

/** Build a small engine with clustered founders under the given seed.
 *  Capacity is sized generously (`target * 8 + 32`) so a few dozen
 *  ticks of stepping don't fill storage with dust — the collision pass
 *  is O(N²) and a full storage at non-toy populations balloons the
 *  test wall-clock. The drift metric is alignment-independent so the
 *  extra headroom doesn't change what the spec pins.
 *  `scatterClusteredFounders` floors to the per-cluster size, so a
 *  target of 24 yields 24 founders. */
function buildState(seed: number, target: number) {
  const capacity = Math.max(64, target * 8 + 32);
  const state = createSimulationState(capacity, {
    ...DEFAULT_WORLD_CONFIG,
    width: 800,
    height: 600,
    targetPopulation: target,
    seed,
    snapshotInterval: 1_000_000
  });
  const clusters = Math.max(6, Math.min(20, Math.floor(target * 0.03)));
  const rng = new Rng(state.rng.snapshot());
  scatterClusteredFounders(target, rng, state.world, clusters).forEach((f) => {
    spawnParticle(state, f.x, f.y, f.vx, f.vy, f.energy, false, -1, f.genomeRow);
  });
  return state;
}

describe('genome drift metric (VISION §Success #2 + #9)', () => {
  it('returns identical stats for the same state (determinism)', () => {
    const state = buildState(0xcafe_babe, 24);
    const a = genomeStats(state);
    const b = genomeStats(state);
    expect(a.count).toBe(b.count);
    expect(a.centroidNorm).toBeCloseTo(b.centroidNorm, 6);
    for (let i = 0; i < GENOME_LENGTH; i++) {
      expect(a.mean[i]).toBe(b.mean[i]);
      expect(a.variance[i]).toBe(b.variance[i]);
    }
  });

  it('reports zero drift against itself on a fresh seed', () => {
    const state = buildState(0xfeed_face, 24);
    const stats = genomeStats(state);
    const drift = genomeDrift(stats, stats);
    expect(drift.slottedL2).toBe(0);
    expect(drift.maxSlotDelta).toBe(0);
    for (let i = 0; i < GENOME_LENGTH; i++) expect(drift.meanShiftSign[i]).toBe(0);
  });

  it('detects strictly positive drift when founder distributions differ', () => {
    // Two populations seeded with different distributions: the
    // metric must report nonzero drift even before stepping because
    // the founder means differ. The spec documents that unbiased
    // mutation does not by itself drift the population mean, so the
    // comparison target is a *different* population, not the same
    // population after time has passed.
    const a = buildState(0xaaaa_aaaa, 24);
    const b = buildState(0xbbbb_bbbb, 24);
    const statsA = genomeStats(a);
    const statsB = genomeStats(b);
    const drift = genomeDrift(statsA, statsB);
    expect(drift.slottedL2).toBeGreaterThan(0);
    expect(drift.maxSlotDelta).toBeGreaterThan(0);
    // Sign vector must agree with the per-slot delta — pins the
    // Int8Array correctness independently of drift magnitude.
    let perSlotDeltaNonZero = 0;
    for (let i = 0; i < GENOME_LENGTH; i++) {
      const d = (statsB.mean[i] ?? 0) - (statsA.mean[i] ?? 0);
      if (d !== 0) perSlotDeltaNonZero++;
      const expected = d > 0 ? 1 : d < 0 ? -1 : 0;
      expect(drift.meanShiftSign[i]).toBe(expected);
    }
    // At least *some* slot must have a nonzero delta — guards against
    // an accidentally-identical founder distribution.
    expect(perSlotDeltaNonZero).toBeGreaterThan(0);
  });

  it('unbiased mutation does not by itself drift the population mean', () => {
    // Per the spec: fission applies zero-mean Gaussian noise, so a
    // population stepping against itself should report zero drift
    // *in the metric's expectation*. (The metric is deterministic
    // on this input — the daughter draw is symmetric — so this is
    // a hard zero, not just "small on average.")
    // We drive a sufficient number of ticks to make fission
    // observable in `state.storage.activeCount`, but the test
    // asserts that the mean stays put because mutation is unbiased.
    const state = buildState(0xbeef_1234, 24);
    const before = genomeStats(state);
    for (let i = 0; i < 60; i++) stepOnce(state);
    const after = genomeStats(state);
    expect(state.storage.activeCount).toBeGreaterThan(24); // fission happened
    expect(genomeDrift(before, after).slottedL2).toBe(0);
  });

  it('produces divergent drift vectors across two seeds after stepping', () => {
    const a = buildState(0xaaaa_aaaa, 24);
    for (let i = 0; i < 60; i++) stepOnce(a);
    const b = buildState(0xbbbb_bbbb, 24);
    for (let i = 0; i < 60; i++) stepOnce(b);
    const statsA = genomeStats(a);
    const statsB = genomeStats(b);
    const drift = genomeDrift(statsA, statsB);
    // The two seed lineages remain distinct even after stepping,
    // because their founder means differ and unbiased mutation
    // preserves that gap.
    expect(drift.slottedL2).toBeGreaterThan(0);
  });

  it('personalityNorm is zero on a zeroed-personality population', () => {
    const state = createSimulationState(16, {
      ...DEFAULT_WORLD_CONFIG,
      width: 800,
      height: 600,
      targetPopulation: 8,
      seed: 9,
      snapshotInterval: 1_000_000
    });
    for (let i = 0; i < 8; i++) {
      const row = new Float32Array(GENOME_LENGTH);
      row[GENOME.mass] = 1;
      row[GENOME.radius] = 1;
      row[GENOME.drag] = 0.95;
      row[GENOME.fissionThreshold] = 1.4;
      row[GENOME.fissionCost] = 0.04;
      row[GENOME.mutSigma] = 0.05;
      spawnParticle(state, 100 + i, 100, 0, 0, 1, false, -1, row);
    }
    const stats = genomeStats(state);
    expect(stats.centroidNorm).toBeGreaterThan(0);
    expect(personalityNorm(stats)).toBe(0);
  });

  it('personalityNorm is positive under the standard seeded distribution', () => {
    const state = buildState(0x1234_5678, 24);
    const stats = genomeStats(state);
    expect(personalityNorm(stats)).toBeGreaterThan(0);
  });

  it('excludes dust from the metric (dust would otherwise dominate variance)', () => {
    const state = buildState(0x5555_5555, 24);
    const founderCount = state.storage.activeCount;
    // Add a small dust cloud — capacity is generous so this won't
    // fill storage.
    for (let i = 0; i < founderCount * 2; i++) {
      spawnParticle(state, 200 + i, 200, 0, 0, 1, true, -1);
    }
    const stats = genomeStats(state);
    expect(stats.count).toBe(founderCount);
  });

  it('reports zero on an empty storage', () => {
    const state = createSimulationState(16, {
      ...DEFAULT_WORLD_CONFIG,
      seed: 1
    });
    const stats = genomeStats(state);
    expect(stats.count).toBe(0);
    expect(stats.centroidNorm).toBe(0);
    const drift = genomeDrift(stats, stats);
    expect(drift.slottedL2).toBe(0);
    expect(drift.maxSlotDelta).toBe(0);
  });

  it('throws if means are the wrong length (defensive)', () => {
    const state = buildState(0x9999_9999, 24);
    const stats = genomeStats(state);
    const tampered = {
      ...stats,
      mean: new Float32Array(stats.mean.length - 1)
    };
    expect(() => genomeDrift(stats, tampered)).toThrow(/length/);
  });

  it('slotMask restricts measurement to the requested subset', () => {
    const state = buildState(0x7777_7777, 24);
    const mask = new Uint8Array(state.storage.capacity);
    let marked = 0;
    for (let i = 0; i < state.storage.capacity && marked < 8; i++) {
      if (state.storage.alive[i] === 1 && state.storage.isDust[i] === 0) {
        mask[i] = 1;
        marked++;
      }
    }
    const all = genomeStats(state);
    const masked = genomeStats(state, mask);
    expect(masked.count).toBe(8);
    expect(all.count).toBeGreaterThan(8);
    let differ = 0;
    for (let i = 0; i < GENOME_LENGTH; i++) {
      if (masked.mean[i] !== all.mean[i]) differ++;
    }
    expect(differ).toBeGreaterThan(0);
  });
});

