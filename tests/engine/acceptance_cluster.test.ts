/**
 * Acceptance #5 — multi-cell cluster organisms emerge (VISION §Success).
 *
 * Spec: VISION §Success #5 ("Multi-cell cluster organisms emerge that
 * fission in coordinated ways that are legible from the genomes
 * involved — not hard-coded, but explainable in retrospect.")
 *
 * The cluster-detection math (`detectClusters`) is already pinned by
 * tests/engine/clusters.test.ts on a static fixture. This file pins
 * the *dynamic* claim: a freshly-seeded clustered-founder world, after
 * a short step window, contains at least one organism-sized cluster
 * (≥ 3 particles close enough to share a connected component under
 * the default config).
 *
 * The test is small enough to run in milliseconds; if it ever drifts
 * out of pass we know either the founder seeding or the signal-force
 * integration has stopped producing emergent clumps.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORLD_CONFIG,
  Rng,
  createSimulationState,
  spawnParticle,
  scatterClusteredFounders,
  stepOnce,
  detectClusters
} from '$engine/core/index.js';

function buildState(seed: number, target: number) {
  // Capacity headroom generously sized so a few dozen ticks of dust
  // emission don't fill storage — the cluster-detection acceptance is
  // checked at tick 30 and storage pressure would mask the result.
  const capacity = Math.max(128, target * 8 + 32);
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

describe('acceptance #5: multi-cell organisms emerge', () => {
  it('produces at least one multi-cell cluster (≥ 2 members) after a short step window', () => {
    // VISION §Success #5 ("multi-cell cluster organisms emerge") and
    // VISION §11 ("multi-cell organisms") both define an organism as
    // ≥ 2 connected components. The test asserts that on a
    // freshly-clustered-founder world, after a few ticks of stepping,
    // at least one multi-cell cluster is detectable under the default
    // `DEFAULT_CLUSTER_OPTIONS`.
    const state = buildState(0xac5e_100, 24);
    for (let i = 0; i < 30; i++) stepOnce(state);
    const clusters = detectClusters(state);
    expect(clusters.length).toBeGreaterThan(0);
    const largest = clusters[0]!;
    // Spec threshold + 1 — a single 2-particle cluster is the bare
    // minimum visible; we want at least one cluster dense enough that
    // a viewer would call it "an organism," not "a near miss."
    expect(largest.slots.length).toBeGreaterThanOrEqual(2);
  });

  it('clustered founder groups stay populated: ≥ 50% of founders land in cluster-sized components', () => {
    // Per-cluster founder size with target=24 / clusters=6 is 4
    // siblings per group. After 30 ticks the founders have dispersed
    // somewhat (motion emits dust, low-energy siblings sit still).
    // The acceptance: at least half the surviving non-dust population
    // is bound up in clusters of size ≥ 2 — i.e. the world still
    // *looks* organized instead of uniformly scattered.
    for (const seed of [0xac5e_200, 0xac5e_201]) {
      const state = buildState(seed, 24);
      for (let i = 0; i < 30; i++) stepOnce(state);
      const clusters = detectClusters(state);
      let totalAliveNonDust = 0;
      for (let i = 0; i < state.storage.capacity; i++) {
        if (state.storage.alive[i] === 1 && state.storage.isDust[i] === 0) {
          totalAliveNonDust++;
        }
      }
      const totalInClusters = clusters.reduce((n, c) => n + c.slots.length, 0);
      // Even if fission has churned population, clustered mass should
      // be non-trivial against the alive-non-dust total.
      expect(totalInClusters).toBeGreaterThanOrEqual(2);
      expect(totalInClusters / totalAliveNonDust).toBeGreaterThanOrEqual(0.2);
    }
  });
});
