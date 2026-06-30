# Spec — genome drift metric

> Source of truth for the population-level "lineage divergence" measurement
> that closes `VISION.md` "Success criteria" #2 and #9. The spec owns the
> mathematical contract; the implementation lives in
> `src/engine/core/drift.ts` and is exercised by
> `tests/engine/drift.test.ts`.

## 1. Purpose

`VISION.md` §Success #2 ("Within minutes of seeding, particle genome centers
visibly drift") and #9 ("A single global parameter change produces visible
behavioral consequence within one minute") both depend on a quantitative
diversity metric the engine currently does not export. Without it, the only
evidence a tier-auditor can read is a visual-confirmation PNG and an
adjective; with it, every bench / visual capture / state-of-play sweep can
cite a number.

## 2. Inputs

- `state: SimulationState` — the engine snapshot at one tick. Only the
  alive, **non-dust** subpopulation contributes (dust always carries the
  dust genome `DUST_GENOME` whose nonzero variance would drown the
  signal).
- `slotMask: Uint8Array | undefined` — optional bitmask restricting
  measurement to a subset. Reserved for future per-cluster / per-archetype
  metrics. `undefined` ⇒ measure all alive non-dust slots.

## 3. Outputs

`genomeStats(state, slotMask?)` returns:

- `count: number` — slots sampled.
- `mean: Float32Array(GENOME_LENGTH)` — per-slot mean of the alive non-dust
  genome rows.
- `variance: Float32Array(GENOME_LENGTH)` — per-slot population variance
  (`Σ(x − mean)² / N`, not `N − 1` because the population is the engine
  state itself, not a sample from a larger pool).
- `centroidNorm: number` — L2 magnitude of `mean` (all slots, including
  foundation slots whose mean is always ≈1 because founders carry
  `mass=1, radius=1, drag=0.95, …`). Useful as a single number that
  changes with population mean drift in the personality slots on top
  of the foundation floor.

`genomeDrift(from, to)` returns:

- `slottedL2: number` — `Σ_s (mean_to[s] − mean_from[s])²` summed over
  every genome slot. The headline number; it is zero iff the population
  means are identical across the two calls, and grows monotonically with
  per-slot mean drift.
- `meanShiftSign: Int8Array(GENOME_LENGTH)` — sign of the per-slot mean
  delta in `{-1, 0, +1}`. Useful for plotting the *direction* of drift
  per axis without losing the noise floor.
- `maxSlotDelta: number` — `max_s |mean_to[s] − mean_from[s]|`. The
  "loudest single axis" view.

## 4. Behavior

- The math is a deterministic, allocation-light reduction. Same `state` ⇒
  same stats bit-identically.
- Cost is `O(N × GENOME_LENGTH)` over alive non-dust slots. That is the
  same order as one population pass, so the metric is fit for an
  in-the-loop HUD readout at a sub-second cadence.
- The metric ignores dust entirely. Dust variance would dominate any
  realistic population because dust contributes `DUST_GENOME` to a slot
  count that already changes with the per-tick absorption rate.
- Empty input ⇒ `count = 0`, all `mean = 0`, all `variance = 0`,
  `centroidNorm = 0`. Drift against an empty snapshot has `slottedL2 = 0`,
  `maxSlotDelta = 0`, `meanShiftSign = 0`. This keeps downstream
  visualizations "show nothing" rather than "throw."
- `slotMask` follows engine convention: a parallel array of length
  `state.storage.capacity` where `mask[i] === 1` includes slot `i`.
  Slots where `slotMask[i] !== 1` are skipped the same way as dead
  slots.
- **Stepping a population does not, by itself, drift its mean.** The
  fission mutation is unbiased Gaussian (`mutSigma · 𝓝(0, σ)`) so the
  expected mean stays at the founder mean in the absence of selection
  pressure. Drift requires either a comparison **between** populations
  (different founders → different means) OR long-running selection
  effects, which are an emergent post-MVP property. This is what the
  acceptance criteria pin.

## 5. Acceptance criteria (Tier 2)

1. Two `genomeStats` calls on the same `state` return bit-identical
   arrays. (Determinism.)
2. On a freshly-seeded engine with `scatterClusteredFounders(seed)` and
   zero steps taken, `slottedL2 === 0` and `maxSlotDelta === 0` against
   itself.
3. Two simulation runs whose founder populations differ produce `slottedL2
   > 0` after stepping. **Self-comparison after stepping does NOT
   produce drift** — `mutSigma` is unbiased Gaussian noise applied at
   fission, so a population's mean stays at its founder mean in the
   absence of selection pressure. The metric compares **two** genomes,
   not "this population now vs. before."
4. Running the engine for two divergent seeds (`seed = 0xA` and
   `seed = 0xB`) produces drift vectors whose L2 distance is strictly
   positive even before stepping — the two founder distributions have
   zero-mean Gaussian distributions around `DEFAULT_DISTRIBUTION`, but
   their noise draws differ, so their per-slot means differ.
5. `centroidNorm` for any foundered world is always **strictly
   positive** because of the foundation-slot floor — even founders
   whose `prop`/`mod`/`mul`/`add` etc. are pinned to zero still carry
   `mass=1, radius=1, drag=0.95, …`. The metric that moves with
   *personality* modulation is the sub-norm over the personality
   slots (`GENOME.propOffset..modOffset`): zeroed personality ⇒ 0;
   standard seeded personality ⇒ positive. The acceptance test pins
   that sub-norm so the personality-vs-foundation split is
   observable.
6. A new visual capture (`tests/engine/visual_capture.test.ts`) prints
   the per-snapshot drift value next to the PNG path so future
   state-of-play entries can cite it. This converts the existing black-box
   headless capture into a tier-2 acceptance witness.
