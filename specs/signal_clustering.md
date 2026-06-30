# Spec — signal-driven clustering acceptance

> Behavioral source of truth for VISION §Success #3 acceptance test.
> Spec required by `AGENTS.md §14` before Tier 2 tests are written.
>
> @see VISION.md §Success #3 ("Adjusting the per-property signal
>   response of a population produces a visible change in how that
>   population clumps with others within seconds.")
> @see specs/ROOT.md §10 row #3

## 1. Purpose

VISION §Success #3 promises that tuning per-property signal response
(`add[*][axis]`, `mul[*][axis]`) produces a visible change in
clustering shape over a few seconds. The DriftMetric module
(`genomeStats`/`genomeDrift`) answers "did population positions
change?" — this one answers "did the *shape* of clustering change?"
under a controlled comparison.

## 2. Inputs

- Two `SimulationState` instances built from the same founder
  positions + genomes, identical except that one population has its
  `mul[*][axis]` coefficients scaled by a known factor (e.g. `2`)
  and the other has them scaled by `0`. That is the "responsive vs
  unresponsive" comparison.
- A short step window (`~30 ticks`) that is enough time for the
  signal-driven force to bend trajectories but short enough that
  dust emission + bounce hasn't shuffled founders out of the
  initial cluster geometry.

## 3. Outputs

`clusterSignature(state)` — a deterministic shape descriptor:

- `memberCount: number`
- `pairwiseDistanceSq: Float64Array` — sorted ascending list of
  `O(N²)` pairwise squared distances for alive non-dust slots.
  Sorted so the signature is rotation- and permutation-invariant.
- `interiorMass: number` — number of (i, j) pairs whose pairwise
  distance is below the median; an integer in `[0, N(N-1)/2]`.
  Bins tighter clustering at higher counts.

## 4. Behavior

- `clusterSignature(state)` is deterministic — same `state` ⇒
  byte-identical output.
- The signature ignores dust; pairwise distances only consider
  alive non-dust slots.
- The signature is discarded when `memberCount < 2` (no pairwise
  distances exist).
- The "responsive vs unresponsive" comparison asks: under the
  same starting geometry + step window, do the two populations
  see different `clusterSignature` images? At minimum, the
  signatures' `interiorMass` must differ; ideally several
  significant differences in the pairwise-distance distribution
  (e.g. > 25% pairwise distance changes by median).

## 5. Acceptance criteria (Tier 2)

1. A fresh state, stepped, has a `clusterSignature` whose
   `memberCount` matches `genomeStats(state).count`.
2. Two states seeded with identical positions + identical
   genomes — no parameter difference at all — have byte-identical
   cluster signatures after stepping. (Determinism sanity gate.)
3. Two states seeded identically except that one population has
   `mul[0..7][0..2] = 0` ("no response") and the other has them
   at the default seeded value, after a 30-tick window have
   measurably different `interiorMass`: the responding population
   must show a different clustering shape from the non-responding
   one. The exact value of "different" depends on the seed and
   population size; the test pins `interiorMassA !==
   interiorMassB`.
4. The pairwise distance distribution delta between the two
   populations is ≥ 1% of distance entries by at least one epsilon
   band — confirms the shape change is *not* a single-bit edge
   case but a real distribution shift.

## 6. Constraints

- The signature module is a thin shape comparator — it does NOT
  derive motion, signal force, or fission behavior. The clamp is
  on `pairwiseDistanceSq` which is ≤ O(N²) over alive non-dust
  slots; same cost regime as `detectClusters`.
- The signal-driven acceptance test sticks to multi-cell small
  populations (target ≤ 24, capacity headroom as in the drift
  tests) so the collision pass stays under one second on commodity
  CPU. Larger populations drift runtime into O(N²) minutes and
  are deferred to the GPU pipeline acceptance gate.
