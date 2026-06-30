/**
 * Cluster-seeded founders — shapes of motion / lineage contrast versus
 * uniform seeding.
 *
 * Specifically, after a single tick we expect:
 *  - many sibling pairs to have similar emitBase triples (so users see
 *    visible hue clusters on first paint);
 *  - founder positions to be concentrated rather than evenly distributed.
 */
import { describe, expect, it } from 'vitest';
import {
  scatterClusteredFounders,
  Rng
} from '$engine/core/index.js';

describe('scatterClusteredFounders', () => {
  it('produces the requested total count', () => {
    const rng = new Rng(1234);
    const founders = scatterClusteredFounders(
      200,
      rng,
      { width: 800, height: 600 },
      10
    );
    expect(founders.length).toBe(200);
  });

  it('founder spatial spread within each cluster is below the world size', () => {
    const rng = new Rng(1234);
    const founders = scatterClusteredFounders(
      200,
      rng,
      { width: 800, height: 600 },
      10
    );
    // Build spatial buckets via 80x80 cells. Several cells will share
    // a cluster if SIBLINGS are visibly close (within ~50 px of each
    // other). Max bucket size ≥ clusterSize/2 if the seeded centers are
    // non-adjacent.
    const bucketKey = (x: number, y: number): number => {
      const cx = Math.floor(x / 80);
      const cy = Math.floor(y / 80);
      return cy * 100 + cx;
    };
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < founders.length; i++) {
      const k = bucketKey(founders[i]!.x, founders[i]!.y);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(i);
    }
    // At least one bucket should hold ≥ 8 siblings — those would have
    // come from the same cluster.
    let maxBucket = 0;
    for (const indices of buckets.values()) {
      if (indices.length > maxBucket) maxBucket = indices.length;
    }
    expect(maxBucket).toBeGreaterThanOrEqual(8);
  });

  it('within a cluster, siblings share emitBase hue', () => {
    // 5 clusters, 100 founders each → 500 founders
    const rng = new Rng(7777);
    const founders = scatterClusteredFounders(
      500,
      rng,
      { width: 800, height: 600 },
      5
    );
    // Bucket siblings by approximate location (clustered spatially, but
    // we use a heuristic — nearest-neighbor on 2D). For testing the
    // genome-shared-with-sibling invariant simpler: group by 80x80 cells.
    const bucketKey = (x: number, y: number): number => {
      const cx = Math.floor(x / 80);
      const cy = Math.floor(y / 80);
      return cy * 100 + cx;
    };
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < founders.length; i++) {
      const k = bucketKey(founders[i]!.x, founders[i]!.y);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(i);
    }
    let seenClusterWithHueSpread = false;
    for (const indices of buckets.values()) {
      if (indices.length < 3) continue;
      // Check: the spread of emitBase[0] (signal A) across indices is
      // much smaller than the spread across the entire population.
      const aVals = indices.map((i) => founders[i]!.genomeRow[71]!);
      const loA = Math.min(...aVals);
      const hiA = Math.max(...aVals);
      const clusterRange = hiA - loA;
      if (clusterRange < 0.35) seenClusterWithHueSpread = true;
    }
    expect(seenClusterWithHueSpread).toBe(true);
  });
});
