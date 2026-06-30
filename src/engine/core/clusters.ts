/**
 * Cluster detection — emergent multi-cell organisms per VISION §11.
 *
 * Without color/type flags, "a cluster" emerges from a strict geometric
 * criterion: two particles are neighbors if their world-space separation
 * is below `neighborRadius`. A connected component under this rule is
 * an organism.
 *
 * Algorithm: union-find (DSU) over alive non-dust particles. Distance
 * comparisons are O(N²) in the reference CPU implementation; this
 * matches the existing inner loop convention (the GPU pipeline will
 * replace it with a hash grid). The DSU is O(N α(N)) so the dominant
 * cost stays the comparison itself.
 *
 * Cluster definitions:
 *  - Minimum size is configurable (default 2 — singletons are not
 *    "organisms" per VISION §11's "multi-cell cluster organisms").
 *  - Centroid is mean of member positions.
 *  - Reports `{ slots, centroid, size, meanEnergy }`.
 *
 * @see specs/ROOT.md §11 "Interactive parameter & inspection HUD"
 * @see VISION.md §11 (cluster-detection overlays)
 */

import { GENOME_LENGTH } from './genome.js';
import type { SimulationState } from './step.js';

export interface Cluster {
  /** Particle slot indices in the cluster. */
  slots: number[];
  /** Cluster centroid in world coordinates. */
  centroid: [number, number];
  /** Sum of energies across members. */
  totalEnergy: number;
  /** Mean energy across members (NaN if size == 0). */
  meanEnergy: number;
  /** Bounding box — useful for renderer overlays. */
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
  /**
   * Mean of each genome row across members — useful as the cluster's
   * "personality" representative. Lazy-allocated by the consumer; we
   * keep the per-slot sums in a Float64Array of length GENOME_LENGTH
   * so the consumer can compute mean once over all clusters without
   * recomputing per-cell.
   */
  genomeSum: Float64Array;
}

export interface ClusterDetectionOptions {
  /** Neighbor radius in world units. Default 8. */
  neighborRadius: number;
  /** Minimum cluster size to keep a component. Default 2. */
  minClusterSize: number;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterDetectionOptions = Object.freeze({
  neighborRadius: 8,
  minClusterSize: 2
});

/**
 * Detect clusters in `state`. Returns clusters in descending size
 * order — the user wants the big ones visible.
 */
export function detectClusters(
  state: SimulationState,
  options: ClusterDetectionOptions = DEFAULT_CLUSTER_OPTIONS
): Cluster[] {
  const radiiSq = options.neighborRadius * options.neighborRadius;

  // Pass 1 — collect alive, non-dust slots with positions.
  const slots: number[] = [];
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < state.storage.capacity; i++) {
    if (state.storage.alive[i] !== 1) continue;
    if (state.storage.isDust[i] === 1) continue;
    slots.push(i);
    positions.push({
      x: state.storage.positionsSoA[i * 2] ?? 0,
      y: state.storage.positionsSoA[i * 2 + 1] ?? 0
    });
  }

  if (slots.length === 0) return [];

  // Union-find over collected indices.
  const parent = new Int32Array(slots.length);
  for (let i = 0; i < slots.length; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a]! !== a) {
      parent[a] = parent[parent[a]!]!; // path compression
      a = parent[a]!;
    }
    return a;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const n = slots.length;
  for (let i = 0; i < n; i++) {
    const xi = positions[i]!.x;
    const yi = positions[i]!.y;
    for (let j = i + 1; j < n; j++) {
      const dx = positions[j]!.x - xi;
      const dy = positions[j]!.y - yi;
      if (dx * dx + dy * dy <= radiiSq) union(i, j);
    }
  }

  // Pass 2 — bucket members by root parent.
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let bucket = buckets.get(r);
    if (!bucket) {
      bucket = [];
      buckets.set(r, bucket);
    }
    bucket.push(i);
  }

  const min = Math.max(1, options.minClusterSize);
  const out: Cluster[] = [];
  for (const [, bucket] of buckets) {
    if (bucket.length < min) continue;
    let cx = 0;
    let cy = 0;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let totalEnergy = 0;
    const genomeSum = new Float64Array(GENOME_LENGTH);
    for (const localIndex of bucket) {
      const slot = slots[localIndex]!;
      const x = positions[localIndex]!.x;
      const y = positions[localIndex]!.y;
      cx += x;
      cy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      totalEnergy += state.storage.energies[slot] ?? 0;
      const row = state.storage.genomesSoA.subarray(
        slot * GENOME_LENGTH,
        (slot + 1) * GENOME_LENGTH
      );
      for (let k = 0; k < GENOME_LENGTH; k++) genomeSum[k]! += row[k]!;
    }
    out.push({
      slots: bucket.map((i) => slots[i]!),
      centroid: [cx / bucket.length, cy / bucket.length],
      totalEnergy,
      meanEnergy: totalEnergy / bucket.length,
      bbox: { minX, maxX, minY, maxY },
      genomeSum
    });
  }

  // Sort: largest first because the renderer overlays clusters and we
  // want the visually impactful ones at the top.
  out.sort((a, b) => b.slots.length - a.slots.length);
  return out;
}

/**
 * Pick the slot closest to the world coordinate (wx, wy) within
 * `searchRadius`. Returns -1 if nothing matches. Used by the click-
 * to-inspect HUD path.
 */
export function nearestParticleSlot(
  state: SimulationState,
  wx: number,
  wy: number,
  searchRadius: number
): number {
  let best = -1;
  let bestSq = searchRadius * searchRadius;
  for (let i = 0; i < state.storage.capacity; i++) {
    if (state.storage.alive[i] !== 1) continue;
    if (state.storage.isDust[i] === 1) continue;
    const x = state.storage.positionsSoA[i * 2] ?? 0;
    const y = state.storage.positionsSoA[i * 2 + 1] ?? 0;
    const dx = x - wx;
    const dy = y - wy;
    const d = dx * dx + dy * dy;
    if (d <= bestSq) {
      bestSq = d;
      best = i;
    }
  }
  return best;
}
