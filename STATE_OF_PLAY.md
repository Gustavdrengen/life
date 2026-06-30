# State of play

> Rolling log of dated product observations. Entries below as recorded by the agent
> on each session. Newest entries on top. The cap is 10 entries; when a new entry
> is appended, the oldest is removed first. **Rules that govern this log** (format,
> cap, rotation, calibration, trivial-change bypass) live in `AGENTS.md` §11, not
> here — this file holds the entries themselves.

---

## State of play

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
    confirm the user-visible result.
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
