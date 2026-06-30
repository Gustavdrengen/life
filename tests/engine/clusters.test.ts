/**
 * Cluster detection tests — VISION §11 cluster-detection overlays.
 * Geometric union-find over alive non-dust particles within
 * `neighborRadius`.
 */
import { describe, expect, it } from 'vitest';
import {
  Rng,
  DEFAULT_WORLD_CONFIG,
  createSimulationState,
  spawnParticle,
  detectClusters,
  DEFAULT_CLUSTER_OPTIONS,
  nearestParticleSlot
} from '$engine/core/index.js';
import { GENOME_LENGTH } from '$engine/core/genome.js';

function makeState() {
  return createSimulationState(64, {
    ...DEFAULT_WORLD_CONFIG,
    width: 400,
    height: 400,
    latticeResolution: 16,
    signalCutoff: 32,
    fixedDt: 1 / 60,
    targetPopulation: 64,
    seed: 42
  });
}

describe('detectClusters', () => {
  it('returns empty array when no particles alive', () => {
    const s = makeState();
    expect(detectClusters(s, { ...DEFAULT_CLUSTER_OPTIONS, minClusterSize: 1 })).toHaveLength(0);
  });

  it('groups nearby particles into one cluster', () => {
    const s = makeState();
    s.rng = new Rng(42);
    // Four particles clustered tightly.
    spawnParticle(s, 100, 100, 0, 0, 1, false, -1);
    spawnParticle(s, 102, 100, 0, 0, 1, false, -1);
    spawnParticle(s, 100, 102, 0, 0, 1, false, -1);
    spawnParticle(s, 102, 102, 0, 0, 1, false, -1);
    spawnParticle(s, 300, 300, 0, 0, 1, false, -1); // isolated
    // Override minClusterSize so the isolated particle survives — the
    // default of 2 (multi-cell organisms only) would prune it.
    const clusters = detectClusters(s, {
      ...DEFAULT_CLUSTER_OPTIONS,
      neighborRadius: 8,
      minClusterSize: 1
    });
    expect(clusters.length).toBe(2);
    // Largest first.
    expect(clusters[0]!.slots.length).toBe(4);
    expect(clusters[1]!.slots.length).toBe(1);
  });

  it('respects minClusterSize and drops singletons by default', () => {
    const s = makeState();
    s.rng = new Rng(42);
    spawnParticle(s, 300, 300, 0, 0, 1, false, -1);
    expect(detectClusters(s)).toHaveLength(0); // minClusterSize=2 default
  });

  it('centroid matches mean of member positions', () => {
    const s = makeState();
    s.rng = new Rng(42);
    spawnParticle(s, 100, 100, 0, 0, 1, false, -1);
    spawnParticle(s, 110, 102, 0, 0, 1, false, -1);
    const clusters = detectClusters(s, { ...DEFAULT_CLUSTER_OPTIONS, neighborRadius: 50 });
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.centroid[0]).toBeCloseTo(105);
    expect(clusters[0]!.centroid[1]).toBeCloseTo(101);
  });

  it('mean energy matches total / size', () => {
    const s = makeState();
    s.rng = new Rng(42);
    spawnParticle(s, 100, 100, 0, 0, 2, false, -1);
    spawnParticle(s, 102, 100, 0, 0, 4, false, -1);
    const clusters = detectClusters(s, { ...DEFAULT_CLUSTER_OPTIONS, neighborRadius: 50 });
    expect(clusters[0]!.totalEnergy).toBe(6);
    expect(clusters[0]!.meanEnergy).toBe(3);
  });

  it('genomeSum sums every genome slot across members', () => {
    const s = makeState();
    s.rng = new Rng(42);
    spawnParticle(s, 100, 100, 0, 0, 1, false, -1);
    spawnParticle(s, 102, 100, 0, 0, 1, false, -1);
    const clusters = detectClusters(s, { ...DEFAULT_CLUSTER_OPTIONS, neighborRadius: 50 });
    expect(clusters[0]!.genomeSum.length).toBe(GENOME_LENGTH);
  });

  it('ignores dust particles', () => {
    const s = makeState();
    s.rng = new Rng(42);
    // Spawn a dust particle in the cluster — it should be excluded.
    spawnParticle(s, 100, 100, 0, 0, 1, true, -1);
    spawnParticle(s, 102, 100, 0, 0, 1, false, -1);
    const clusters = detectClusters(s, { ...DEFAULT_CLUSTER_OPTIONS, neighborRadius: 50 });
    expect(clusters.length).toBe(0); // 1 alive non-dust
    // Force minClusterSize=1 to still see the non-dust member
    expect(
      detectClusters(s, { ...DEFAULT_CLUSTER_OPTIONS, neighborRadius: 50, minClusterSize: 1 })
        .length
    ).toBe(1);
  });
});

describe('nearestParticleSlot', () => {
  it('returns the slot whose world position is closest', () => {
    const s = makeState();
    s.rng = new Rng(42);
    spawnParticle(s, 50, 50, 0, 0, 1, false, -1);
    spawnParticle(s, 200, 200, 0, 0, 1, false, -1);
    expect(nearestParticleSlot(s, 51, 51, 5)).toBe(0);
    expect(nearestParticleSlot(s, 199, 200, 5)).toBe(1);
  });

  it('returns -1 when no particle is within searchRadius', () => {
    const s = makeState();
    s.rng = new Rng(42);
    spawnParticle(s, 50, 50, 0, 0, 1, false, -1);
    expect(nearestParticleSlot(s, 500, 500, 2)).toBe(-1);
  });
});
