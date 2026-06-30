# State of play

> Rolling log of dated product observations. Entries below as recorded by the agent
> on each session. Newest entries on top. The cap is 10 entries; when a new entry
> is appended, the oldest is removed first. **Rules that govern this log** (format,
> cap, rotation, calibration, trivial-change bypass) live in `AGENTS.md` §11, not
> here — this file holds the entries themselves.

---

## State of play

### [2026-06-30] — Tier 1 fix: cluster-based founder seeding

The first-30-seconds Tier 1 issue from the prior entry is resolved
this session. Founders spawn as ~10 spatial clusters whose siblings
share an archetype genome (with mild per-slot noise), so each cluster
renders as a single visible hue blob on first paint instead of a
nearly-empty uniform distribution.

- **What works**
  - New `scatterClusteredFounders(n, rng, world, clusterCount)`
    exported from `src/engine/core/seeds.ts`. Archetype noise is
    per-slot Gaussian σ=0.05; mutSigma of the archetype is gently
    reduced to keep clusters coherent for the first few generations.
  - App shell wires `initialClusters = clamp(initialPopulation*0.03,
    6, 20)` and passes it to the seeding helper on first mount and
    on every `R` reset.
  - 3 new tests pass (`tests/engine/cluster_seed.test.ts`): the
    total count is correct, founders spatially distribute into
    bucket-clusters (≥ 8 in at least one 80×80 cell), and within a
    cluster siblings share the emitBase hue.
- **What is broken, rough, or missing**
  - **Tier 1** — `screenshots/visual-confirmation/` is empty: no
    automated visual confirmation was run this session. Confirmed
    by HTTP smoke (200 on root) only. The hypothesis "clustered
    founders produce visibly clustered motion within 30 s" is
    supported by code review but not yet observed end-to-end.
  - **Tier 2** — GPU compute + render still post-MVP.
  - **Tier 0** — None observed.
- **What is "there" in the code but feels bad to use**
  - The field-to-pixel brute-force nearest-cell upsampling still
    reads as "smudge" (Tier 3 polish, deferred).
- **What was not exercised this run**
  - No headed-browser visual confirmation — `vite preview` HTTP
    smoke only.
  - No perf measurement.
  - No HUD button click-through.

### [2026-06-30] — first end-to-end smoke build

This is the opening observation. Captured immediately after the
bootstrapping session concluded, before any user-facing polish pass.

- **What works**
  - Headless CPU engine core: 7 modules (`src/engine/core/`), 35 Vitest
    tests pass. Energy conservation is bit-tight under founder-only,
    dust emission, bounce, and predation scenarios.
  - Vite + Svelte 5 + TS strict build produces a 45 kB JS bundle and
    8 kB CSS, served on `vite preview` with HTTP 200 on the root
    document. The head placeholder loads clean.
  - HUD mounts with telemetry (fps, population, dust, tick), pause / step
    / reset buttons, and Space / `.` / R keyboard shortcuts bound.
  - Canvas + Renderer scaffolding runs: initial founders populate, the
    requestAnimationFrame loop ticks the simulation.
- **What is broken, rough, or missing**
  - **Tier 1** — First 30 seconds of play are visually quiet: the
    default population (50k) all spawn simultaneously at coordinates
    drawn from a wide uniform distribution, so neighbors are far and the
    initial signal field diffuses. A user opening the page sees a
    uniform smear of dust before any visible clustering kicks in. A
    tighter founder distribution (clustered + low-energy) would
    noticeably improve the first impression.
  - **Tier 0** — None observed in this run.
  - **Tier 2** — GPU compute + render pipeline is post-MVP. MVP runs
    the CPU path; visual conformance to the FPS budget at 50k has not
    yet been measured. A perf benchmark is needed before we can claim
    the 30 FPS target.
  - Cluster-detection overlay + particle click inspector are not
    wired — VISION §11 promise, MVP deferral is intended.
- **What is "there" in the code but feels bad to use**
  - The page renders the canvas, but the visual texture reads as
    "smudge" more than "gradient." A perceptual overlay or vignette
    on top of the field color would help — Tier 3 polish, deferred.
- **What was not exercised this run**
  - No browser opened in headed mode. Static HTML smoke only.
  - No automated end-to-end click-through of HUD buttons.
  - No perf measurement at MVP target population (50k).
  - No long-running tape (≥ 5 minute playtest) to watch for lineage
    divergence under VISION success criterion #2.

<!-- Newest entries above this line. Rotate oldest out at the 10-entry cap. -->
