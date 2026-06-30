/**
 * Cluster shape signature — VISION §Success #3 ("Adjusting the
 * per-property signal response of a population produces a visible
 * change in how that population clumps with others within seconds").
 *
 * Spec: specs/signal_clustering.md.
 *
 * The drift metric answers "did population means change?" — this
 * one answers "did the *shape* of clustering change?" under a
 * controlled comparison. Cheap pairwise-distance distribution as
 * a deterministic, byte-stable fingerprint that two populations
 * can be compared against.
 */
import type { SimulationState } from './step.js';

export interface ClusterSignature {
  memberCount: number;
  /** Sorted ascending squared distances, length = (N*(N-1))/2. */
  pairwiseDistanceSq: Float64Array;
  /** Count of pairs whose distance is below the median. */
  interiorMass: number;
}

/**
 * Build a deterministic shape fingerprint for the alive non-dust
 * subpopulation. The pairwise distance list is sorted ascending so
 * the signature is invariant under rotation, translation, and
 * permutation of slot indices.
 *
 * Members < 2 ⇒ returns null. Pairwise distances don't exist for a
 * singleton or empty population.
 */
export function clusterSignature(state: SimulationState): ClusterSignature | null {
  const storage = state.storage;
  type Pt = { x: number; y: number };
  const points: Pt[] = [];
  for (let i = 0; i < storage.capacity; i++) {
    if (storage.alive[i] !== 1) continue;
    if (storage.isDust[i] === 1) continue;
    points.push({
      x: storage.positionsSoA[i * 2] ?? 0,
      y: storage.positionsSoA[i * 2 + 1] ?? 0
    });
  }
  const n = points.length;
  if (n < 2) {
    return null;
  }
  const totalPairs = (n * (n - 1)) / 2;
  const distances = new Float64Array(totalPairs);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const x0 = points[i]!.x;
    const y0 = points[i]!.y;
    for (let j = i + 1; j < n; j++) {
      const dx = points[j]!.x - x0;
      const dy = points[j]!.y - y0;
      distances[k++] = dx * dx + dy * dy;
    }
  }
  distances.sort();
  // Median via Float64Array — even-length convention picks the
  // lower of the two middle entries. Stable across permutations.
  const median = distances[Math.floor(totalPairs / 2)] ?? 0;
  let interiorMass = 0;
  for (let i = 0; i < totalPairs; i++) {
    if (distances[i]! < median) interiorMass++;
  }
  return { memberCount: n, pairwiseDistanceSq: distances, interiorMass };
}
