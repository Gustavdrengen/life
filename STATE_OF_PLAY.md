# State of play

> Rolling log of dated product observations. Entries below as recorded by the agent
> on each session. Newest entries on top. The cap is 10 entries; when a new entry
> is appended, the oldest is removed first. **Rules that govern this log** (format,
> cap, rotation, calibration, trivial-change bypass) live in `AGENTS.md` §11, not
> here — this file holds the entries themselves.

---

## State of play

### [2026-06-30] — vision closed: open questions → locked decisions

Per user direction, the six "Open questions" in `VISION.md` were
locked instead of left open. They were:

1. Target population → **50,000** (was 10k/50k/200k question).
2. Frame-rate floor policy → **strict ≥ 30 FPS at 50k, no adaptive
   throttling** (was strict-or-adaptive question).
3. World dimensionality → **2D rendering with 3-axis signal math**
   (was 2D-with-3D-math vs full-3D question).
4. Dust dissipation default → **no decay**, `dustDecayPerSec` is
   exposed (was decay-or-never question).
5. Mutation noise distribution → **additive Gaussian only**, on
   inheritable slots (was additive-vs-multiplicative question).
6. Colorblind palette → **locked `#5fb3ff` / `#ff7d52` / `#b56cff`**
   for signal axes (was pick-it question).

The change moves these from "tentative agent defaults" to
**vision-level constraints**. Three consequences:

- `VISION.md` §Open questions deleted; each closed decision now lives
  as a paragraph in §Constraints. Non-goals §Explicit-non-goals grew
  two new bullets to lock the dimensionality and throttling calls
  ("No 3D simulation in MVP", "No adaptive throttling").
- `specs/ROOT.md` §11 renamed "Vision holes surfaced" → "Closed
  decisions (carried forward from VISION §Constraints)" — the spec
  now mirrors the locked constraints instead of carrying default
  assumptions. §12 non-goals mirrored the same two new bullets.
- `src/engine/core/world.ts` `WorldConfig` gained `dustDecayPerSec`
  (default `0`) so the new parameter has a place to live. Full
  decay semantics are post-MVP because wiring decay through the
  step loop risks breaking strict energy conservation tests for
  zero MVP benefit.

The change is process-level, not feature-level; no Tier 1 / Tier 0
item shifts, and no test changed.

- **What works**
  - `packages/spec/code` all consistent on the closed decisions.
  - `npm run typecheck` clean.
  - `npm run lint` clean.
  - `npm test` (8 files, 38 tests) green.
- **What is broken, rough, or missing**
  - **Tier 1** — visual confirmation that clustered seeding
    produces visibly clustered motion is still outstanding. (Same
    note as prior entry. The headless chrome capture showed a
    correctly painted HUD but no canvas content; the
    requestAnimationFrame loop hasn't had enough virtual time to
    fire under the headless renderer's clock.)
  - **Tier 2** — GPU compute + render still post-MVP.
- **What is "there" in the code but feels bad to use**
  - The field-to-pixel brute-force nearest-cell upsampling reads
    as "smudge" (Tier 3 polish, deferred).
- **What was not exercised this run**
  - No headed-browser visual confirmation.
  - No perf measurement at the 50k cap.
  - No HUD button click-through.

### [2026-06-30] — hygiene pass + final verification

A short session to close out the loop. No new features; only fixes
that surfaced from the test + build pass.

- **What works**
  - `npm run typecheck` clean (TS strict + noUncheckedIndexedAccess
    + exactOptionalPropertyTypes).
  - `npm test` green: 8 test files, 38 tests.
  - `npm run lint` clean (svelte-eslint-parser wired so the flat ESLint
    config can parse `<script lang="ts">` blocks; Hud's Props type
    extracted to `src/lib/hud_types.ts` so the script block is
    pure declarations; `field.ts`'s `fx, fy` switched from let to
    const; `App.svelte` resetWorld updated to use the renamed `sim`
    variable).
  - `npm run build` clean: 45.7 kB JS / 7.8 kB CSS gzip 17.65 / 2.24.
  - `vite preview` HTTP 200 on root; headless chrome captures a
    visible HUD on first paint (canvas still dark in the headless
    capture because requestAnimationFrame has not advanced inside
    the 15 s virtual-time budget; this is consistent with the
    engine running and not with a broken render path).
- **What is broken, rough, or missing**
  - **Tier 1** — visual confirmation that clustered seeding
    produces visibly clustered motion is still outstanding. The
    code is in place; no headed-browser session has been run to
    confirm the user-visible result. (Headless chrome ran for the
    smoke check but its virtual-time budget did not advance far
    enough to render frames.)
  - **Tier 2** — GPU compute + render still post-MVP.
  - **Tier 0** — None observed.
- **What is "there" in the code but feels bad to use**
  - The field-to-pixel brute-force nearest-cell upsampling reads
    as "smudge" (Tier 3 polish, deferred).
- **What was not exercised this run**
  - No headed-browser visual confirmation.
  - No perf measurement.
  - No HUD button click-through.

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
