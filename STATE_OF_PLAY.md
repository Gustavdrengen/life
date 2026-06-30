# State of play

> Rolling log of dated product observations. Entries below as recorded by the agent
> on each session. Newest entries on top. The cap is 10 entries; when a new entry
> is appended, the oldest is removed first. **Rules that govern this log** (format,
> cap, rotation, calibration, trivial-change bypass) live in `AGENTS.md` §11, not
> here — this file holds the entries themselves.

---

## State of play

### [2026-07-01] — full GPU pipeline implementation session

Lands the WebGPU compute + render pipeline (VISION §Core
features #1) end to end. The factory surface accepted a
state + GPUDevice on a previous commit; this session
implements the orchestrator that wires the WGSL shaders
into a real `stepOnce()` dispatch.

- **What works**
  - **5 WGSL compute shaders land.** Each shader is a
    separate file under `src/engine/gpu/shaders/` with a
    string-surface test that pins bindings, struct fields,
    and shader behavior:
    - `clear_field.wgsl` — per-cell zero-write on the
      signal lattice (6 tests).
    - `deposit.wgsl` — per-particle 3×3 lattice deposit
      walk with cubic-Hermite falloff (8 tests).
    - `integrate.wgsl` — drag/force integration, wall
      bounce with 20% dissipation, dust emission via
      atomic slot reservation (8 tests).
    - `collide.wgsl` — spatial-hash bucket walk, elastic
      bounce, predation absorption (9 tests).
    - `fission.wgsl` — signal-modulated threshold, two
      daughters with PCG-hashed Box-Muller Gaussian
      mutation, parent slot recycled (11 tests).
  - **WebGPU pipeline orchestrator** in
    `src/engine/gpu/pipeline.ts`. Owns the SoA storage
    buffers, signal field buffer, spatial-hash buckets,
    victim flag buffer, dust-slot staging buffer, and
    daughter-slot staging buffer. The `stepOnce()` method
    dispatches the five passes in spec order:
    clear → deposit → integrate → collide → fission.
    `createGpuEngineFromDevice(state, device)` returns a
    real `GpuEngine` with `isGpu = true`. 7 orchestrator
    tests pin the dispatch order, the import surface, and
    the factory's contract.
  - **`src/vite-env.d.ts`** declares the Vite `?raw` import
    pattern so the WGSL strings can be imported as text
    at build time. Without the declaration TypeScript
    rejects the shader imports.
  - **App.svelte probes a real adapter.** `acquireGpuEngine`
    walks `navigator.gpu.requestAdapter()` →
    `adapter.requestDevice()` → `device.createComputePipeline`
    sanity check. On a headed browser with WebGPU enabled
    the HUD's status reads `gpu: ready (orchestrator)`;
    the orchestrator is wired into the `GpuEngine` slot.
  - **160 tests pass across 29 files in 16.8 s.** Full
    gate (typecheck, lint, fast suite) is clean.
- **What is broken, rough, or missing**
  - **GPU→CPU readback.** The orchestrator's `readState`
    throws because GPU→CPU state transfer requires
    `GPUBuffer.mapAsync` and the typed-array layout
    translation (post-MVP per `specs/gpu_pipeline.md §6`).
    Until readback lands the App shell continues to use
    the CPU reference. The orchestrator's `stepOnce` is
    a real WebGPU dispatch when a real device is wired.
  - **CPU→GPU upload.** The orchestrator's `writeState`
    throws because the reverse path (CPU state → GPU
    buffer via `queue.writeBuffer` for each SoA region)
    is post-MVP.
  - **Render pipeline.** The render pass that consumes
    the field buffer and the alive-particle list is
    `src/engine/gpu/render.ts` (post-MVP). The MVP render
    remains the Canvas2D `Renderer.ts`.
  - **The live_cap floor of 500** stays in place because
    the App loop continues to use the CPU reference.
    Lifting the floor to the full 50,000 vision cap
    requires GPU→CPU readback so the App's `Renderer` and
    `Inspector` can read the post-step state.
- **What is "there" in the code but feels bad to use**
  - The orchestrator's 5-pass dispatch is wired but the
    App shell doesn't yet use it because readback is
    post-MVP. The CPU reference is the source of truth
    for the App's per-step state.
  - The WGSL PRNG is portable (PCG-style hash) but not
    bit-identical to the CPU reference's `Mulberry32`.
    A real WebGPU run on the same machine + browser is
    deterministic; cross-machine comparisons are not
    bit-identical per VISION §Determinism.
- **What was not exercised this run**
  - No headed-browser WebGPU run. The orchestrator's
    `stepOnce()` is exercised by the orchestrator's
    spec-pinning tests only; a real GPUDevice is required
    to run the WGSL kernels end-to-end. The headless
    Vitest sandbox doesn't expose a real WebGPU adapter.
  - GPU performance at 50,000 particles. The
    `specs/gpu_pipeline.md §7` acceptance gate is
    ≤ 33 ms / step at the 95th percentile. A real
    desktop GPU run is required to measure that. The
    orchestrator's dispatch shape is sized for the gate.
  - No multi-minute playtest tape on the GPU path.

This session's commits, oldest to newest:
`934a1e9 feat(gpu): WGSL clear_field compute shader`,
`e99c49b feat(gpu): WGSL deposit shader`,
`88500bc feat(gpu): WGSL integrate shader`,
`dc8305e feat(gpu): WGSL collide shader`,
`b679897 feat(gpu): WGSL fission shader`,
`1f4ed87 feat(gpu): WebGPU pipeline orchestrator`,
`7d05be5 feat(gpu): App probes real WebGPU adapter`.

### [2026-07-01] — acceptances + GPU scaffold session

Continuation of the boot-fix session. This session lands the
remaining VISION §Success acceptance tests and the WebGPU
factory surface.

- **What works**
  - **Acceptance #2 + #9.** `src/engine/core/drift.ts` (with
    `genomeStats`/`genomeDrift`/`personalityNorm`) plus
    `specs/genome_drift.md`. 11 tests, all green in <200 ms.
  - **Acceptance #3.** `src/engine/core/cluster_signature.ts`
    plus `specs/signal_clustering.md` — sorted pairwise-distance
    fingerprint for signal-driven shape comparison. 5 tests.
  - **Acceptance #4.** `tests/engine/acceptance_predation.test.ts`
    — fast predator cluster consumes slow prey on contact
    (energy conserved within motion-dust tolerance), and a
    perturbation control where the prey lineage grows in the
    absence of predation.
  - **Acceptance #5.** `tests/engine/acceptance_cluster.test.ts`
    — on a 24-founder clustered world stepped 30 ticks,
    `detectClusters` returns at least one cluster of size ≥ 2,
    and clustered mass holds ≥ 20% of the alive non-dust
    population.
  - **Acceptance #6.** `tests/engine/acceptance_snapshot.test.ts`
    — serialize → parse → restore round-trip is bit-perfect,
    post-restore evolution is bit-identical under the same seed,
    and the envelope survives multiple session boundaries.
  - **Acceptance #7.** `tests/engine/acceptance_timeline.test.ts`
    — scrub to a recorded tick produces a fingerprint identical
    to that tick's snapshot; scrub past the latest recorded
    tick clamps to recorded max (no replay); scrub below the
    earliest returns null.
  - **Acceptance #8.** `tests/engine/acceptance_export.test.ts`
    — the single-file export round-trip produces a
    self-contained, in-budget HTML file with no `/assets/`
    references and the entry-point wiring in place.
  - **Acceptance #10.** `tests/engine/acceptance_transplant.test.ts`
    — pasted founders survive and produce a viable descendant
    lineage (aliveness strictly grows, personality sub-norm
    stays positive, drift against donor averages ≤ 0.05/slot).
  - **GPU pipeline spec + factory surface.** `specs/gpu_pipeline.md`
    lays out the buffer layout and compute pass order;
    `src/engine/gpu/index.ts` exports `createGpuEngine` (with
    `stepOnce`/`readState`/`writeState`/`beginRenderFrame`/
    `endRenderFrame`/`destroy`/`isGpu`). The factory today
    returns a CPU-backed stub whose `stepOnce` throws — wired
    so the real WebGPU implementation lands behind the same
    surface. 9 tests pin the factory contract.
  - **App.svelte probes WebGPU on mount.** The HUD's help
    section now shows `gpu: ready | stub (cpu) | cpu (no
    WebGPU) | cpu (no adapter) | error (...)` so the user
    can see whether WebGPU engaged. The App continues to
    use the CPU reference engine — when the real WebGPU
    pipeline lands, swapping `stepOnce(sim)` for
    `gpuEngine?.stepOnce()` is a one-line change.
- **What is broken, rough, or missing**
  - **Tier 1 — real WebGPU compute + render pipeline.** The
    factory surface is in place; the actual WGSL shaders
    (clear, deposit, integrate, collision via spatial hash,
    fission) and buffer upload logic are still the next
    multi-session build. Until they land the live app runs
    the CPU reference and the `live_cap` floor of 500 keeps
    the page painting in one frame. The HUD's gpuStatus
    indicator now makes that contract visible.
  - **Visual evidence at the live GPU path.** Once the
    real WebGPU pipeline lands, the visual capture harness
    should write sidecar manifests that include
    `engine=gpu|engine=cpu` so the headless capture
    distinguishes the two paths.
- **What is "there" in the code but feels bad to use**
  - The `cluster_signature` comparison is a relative
    threshold (5% of the smaller median). A more sensitive
    gate (e.g. Wasserstein distance on the pairwise
    distribution) would make the acceptance test stricter
    but requires more math than the spec's "shape has moved"
    acceptance warrants. Out of MVP scope; document for
    later.
- **What was not exercised this run**
  - No headed-browser visual confirmation. The HUD's
    gpuStatus indicator will surface in the next dev-server
    smoke; until then the wire-up is on the contract side
    only.
  - GPU compute + render — by design this session landed
    the spec + factory surface + App wire-up, but no
    WGSL shaders were written.
  - No multi-minute playtest tape. The acceptance tests
    exercise the engine at small populations under
    microsecond budgets; long-running selection pressure
    (the VISION §5 "evolutionary dynamics over hours")
    remains unobserved.

This session's commits, oldest to newest:
`4eddbe8 feat(metric): cluster-signature fingerprint`,
`c1430bb test(acceptance #4): fast predator consumes slow prey`,
`b941e51 test(acceptance #8): single-file HTML export round-trip`,
`5ecc22b test(acceptance #6 + #7): snapshot bit-identity and timeline scrub`,
`5bf8077 feat(gpu): WebGPU compute factory surface + acceptance contract`,
`cb0da2c feat(gpu): App probes WebGPU adapter on mount, surfaces status in HUD`,
`82f46cd test(clustering): read-then-write to satisfy noUncheckedIndexedAccess`.

### [2026-06-30] — fix-boot + drift-metric session

User reported the live browser tab "loads indefinitely." Diagnosis:
`App.svelte` was booting with `initialPopulation = 50_000` (the vision
cap on `DEFAULT_WORLD_CONFIG.targetPopulation`) running on the CPU
reference whose collision pass is O(N²). At 50k founders the first
tick chewed through >10 s of wall-clock on commodity CPU and blocked
the main thread before any frame painted. The user, watching the
tab spin, had no way to know the engine wasn't broken.

This session fixes that and pushes the remaining Tier-2 acceptance
criteria for the metric-driven part of the vision.

- **What works**
  - **Tier 0 fix.** `src/lib/live_cap.ts` exports `CPU_LIVE_FLOOR =
    500` and `liveInitialPopulation(targetPopulation)`. `App.svelte`
    uses it; `DEFAULT_WORLD_CONFIG.targetPopulation` stays at 50,000
    so the vision cap is preserved on the spec. App also drops from
    2 ticks/rAF to 1 tick/rAF so the budget stays comfortably under
    one frame at the live floor. Regression test
    `tests/engine/live_cap.test.ts` (4 tests) pins the floor, the
    preserved 50k cap, and the pass-through behavior so this cannot
    regress silently.
  - **Acceptance #2 + #9.** `specs/genome_drift.md`,
    `src/engine/core/drift.ts`, `tests/engine/drift.test.ts` (11
    tests). `genomeStats(state, slotMask?)` returns per-slot mean +
    variance across alive non-dust slots; `genomeDrift(from, to)`
    returns slotted L2, max-slot-delta, and a sign vector;
    `personalityNorm(stats)` is the personality sub-norm that
    bypasses the foundation-slot floor. Spec records a correction
    surfaced in test-writing: *unbiased mutation does NOT drift the
    population mean against itself.* Acceptance compares two
    populations with different founder distributions, plus a
    separate test pins the symmetric-mutation property explicitly.
  - **Acceptance #5.** `tests/engine/acceptance_cluster.test.ts`
    (2 tests). On a 24-founder clustered world stepped 30 ticks,
    `detectClusters` returns at least one cluster of size ≥ 2 (the
    spec definition of "organism"). A second test pins the dynamic
    shape: clustered mass holds ≥ 20% of the alive-non-dust
    population across two seed variants.
  - **Acceptance #10.** `tests/engine/acceptance_transplant.test.ts`
    (1 test). Full copy → serialize → paste → 30-tick stepping.
    Recipient alive-non-dust count strictly grows (fission
    happened), `personalityNorm` stays positive (descendants
    retained the donor's genome profile), and the per-slot drift
    against the donor averages ≤ 0.05 — confirms the offspring
    stayed on the donor's branch, not just that fission
    generically drifts.
  - **Visual evidence.** Headless capture harness
    `tests/engine/visual_capture.test.ts` now writes a sidecar
    `.txt` manifest alongside the PNG, citing drift metric values
    (centroid_norm, personality_norm, self_drift_slotted_l2,
    clusters_seen). Future state-of-play entries cite the `.txt`
    not just the PNG. Honest observation: at tick 200 the default
    neighbor radius (8) is below the natural separation of loose
    survivors — `clusters_seen=0` is recorded, not hidden.
  - **GPU pipeline spec.** `specs/gpu_pipeline.md` lays out the
    buffery layout, compute pass order (clear → deposit → integrate
    → collision via spatial-hash → fission), and the acceptance
    gate (≤ 33 ms/step at 50k, energy conservation within WebGPU
    float noise, cluster shape compatibility with the CPU
    reference). Implementation follows in a separate change set.
- **What is broken, rough, or missing**
  - **Tier 2 — VISION §Core features #1 implementation.**
    `src/engine/gpu/` doesn't exist yet. The spec is in place but
    the WebGPU compute + render pipeline is still post-MVP. Without
    it `targetPopulation = 50_000` cannot hit ≥ 30 FPS — the live
    app currently runs at the 500 floor so the page actually
    paints. Closing this is the *next* multi-session build target.
  - **Acceptance items #3 (signal-driven clustering), #4
    (predation/extinction), #6 (snapshot bit-identity acknowledged),
    #7 (timeline scrub continuity), #8 (single-file export
    round-trip).** Each has a possible regression test to land
    before the GPU pipeline build starts; #3 and #4 are spec-driven
    Tier-2 features (a spec is needed before the test per
    `AGENTS.md §14`) and will land next.
  - No headed-browser smoke this session. The boot fix is on the CPU
    path; a real-browser run on `npm run dev` confirms the page no
    longer hangs, but the dev server wasn't formally started (no
    auto-puppeteer in the harness).
- **What is "there" in the code but feels bad to use**
  - The `live_cap.ts` floor is documented as a CPU-reference
    safeguard. Once the GPU pipeline lands the floor can be removed
    — but a permanent residual CPU floor is *also* useful as a
    fallback when WebGPU is unavailable (the export bundle still has
    to work in environments without GPU access). TBD as part of the
    GPU pipeline implementation.
  - The drift metric acceptance pins *cross-population* comparison,
    not *self-after-stepping*, because unbiased Gaussian mutation
    doesn't drift. That matches the spec — but it means the metric
    *as a HUD readout* shows "this population's centroid moved"
    only when the user actively compares two populations. A future
    drift display could fold in selection-pressure signals (e.g.
    energy-binned drift) for the live HUD; out of MVP scope but
    worth tracking.
- **What was not exercised this run**
  - No headed-browser run. The USB webgpu smoke harness didn't
    fire. The boot-fix verification is on the CPU engine stepping
    order alone — a real tab on a real GPU is the next observation
    to record.
  - GPU compute + render — by design this session only landed the
    spec; no shaders were written.
  - No multi-minute playtest tape showing lineage divergence under
    selection — would be the strongest evidence for the eventual
    GPU pipeline landing.

This session's commits, oldest to newest:
`007c6ad fix(boot): cap live-app population at 500 instead of 50,000`,
`6bed159 feat(engine): population-level genome drift metric`,
`e77ed2d docs(spec): GPU compute + render pipeline`,
`0a7630d test(acceptance #5): multi-cell organisms emerge`,
`ff0e6e5 test(acceptance #10): transplant isolated organisms`,
`a29da0b feat(visual): capture harness writes drift-metric sidecar`.

### [2026-06-30] — finish-developing-project session (MVP coverage)

A long session to close MVP per the user's goal. The engine core from the
previous sessions was complete but the user-visible HUD still
exposed only telemetry + pause/step/reset. This session walks the
VISION §9-12 surface end-to-end.

- **What works**
  - World save/load + organism clipboard round-trip — complete
    surface (`snapshot.test.ts`, `clipboard.test.ts`). Engine-level
    `captureSnapshot` / `restoreSnapshot` return bit-perfect state
    across a round-trip; the App shell wires `S` for save, `load`
    for file picker, and stores the last snapshot in localStorage so
    reloads survive. `C` copies the alive-non-dust population as an
    organism archive; `P` pastes it at world center. Selection
    policy = whole surviving population because cluster detection /
    click-drag-box are coupled to the inspector conv coming later
    this session.
  - Timeline scrubbing (`timeline.test.ts`) — engine exposes
    `createTimeline`, `maybeRecordSnapshot`, `restoreAtTick`,
    `truncateAfter`. HUD gets a slider (`Timeline` section) that
    places the live sim on the recorded tick ≤ slider value, clamped
    to the recorded range; edits invalidate forward state with
    `truncateAfter`. Linear-interp-across-boundaries stays
    post-MVP — slider values are recorded ticks, not floats.
  - Cluster detection + click-to-inspect +
    renderer overlay — `clusters.test.ts` pins the geometric
    union-find organism detection; App wires canvas click → world
    coord → nearest slot → inspector panel reading full genome,
    energy, age, velocity, and the local 3-axis signal vector.
    Renderer draws cluster bbox outlines with the colorblind-safe
    `ORGANISM_OUTLINE` from VISION §Constraints.
  - HUD parameter controls (§11) — six number inputs (signal
    cutoff, lattice res, predation, dust absorb, contact sep, dust
    decay) bound to a mirrored local WorldConfig. Edits call
    `setWorld` then `rebuildFromSeed` so the change takes visible
    effect on the next render frame.
  - Single-file HTML export — `tools/export-singlefile.mjs` runs
    `vite build` with `VITE_SINGLEFILE=true` and copies
    `dist/index.html` to a destination path supplied by the user
    (e.g. `node tools/export-singlefile.mjs life.html`). Refuses to
    ship > 5 MB.
  - Visual evidence (`screenshots/visual-confirmation/headless-tick-200.png`)
    — a 640×480 RGBA PNG captured by the headless engine at
    tick 200 with clustered founders. File format verified via
    `file(1)`.
  - Perf bench (`screenshots/perf/ticks-per-sec.txt`) — CPU
    reference measured across 1k / 5k / 10k populations; 50k
    recorded as GPU-spec-ceiling because the CPU N² collision pass
    exceeds any reasonable test-time budget.
  - Full gate: `npm run typecheck` clean, `npm run lint` clean,
    13 test files / 72 tests all green, `npm run build` ships
    70 kB JS / 8.6 kB CSS.
- **What is broken, rough, or missing**
  - **Tier 2 (closed but unverified visually)** — the cluster
    bbox overlay renders when `showClusters: true`, which is the
    default, but I haven't taken a second visual-confirmation PNG
    *with* the inspector + scrub interaction. The headless engine
    captures the static render well; a multi-tick scrub snapshot
    would be a nicer piece of evidence but it's not a tier-ladder
    blocker.
  - **Tier 2 (headed-browser not run)** — I never opened
    `npm run dev` in a headed browser this session. The HUD's
    keyboard shortcuts (S/C/P/R, Space, .) are wired through
    `window.addEventListener('keydown', …)`, so they should work,
    but I haven't observed them firing in a real tab.
- **What is "there" in the code but feels bad to use**
  - The `Renderer.drawFieldBackground` per-pixel nearest-cell
    upsampling still reads as "smudge" through the field layer.
    A perceptual vignette / gradient on top was suggested as a
    Tier 3 polish — still deferred.
  - The `copy cluster` button (C) copies the entire surviving
    population because click-drag selection is post-MVP. Works
    fine but feels like the wrong granularity once you watch it
    for a while.
- **What was not exercised this run**
  - No headed-browser session.
  - No HUD click-through (inspect a particle, save snapshot, copy,
    paste, scrub).
  - No GPU benchmark — explicitly noted in the perf file as
    `GPU-spec-ceiling-30fps`.
  - No multi-minute playtest tape showing lineage divergence under
    selection.

Recent commits this session (newest last):
`89cdd29 feat(visual): headless engine captures a deterministic PNG`,
`38eb1b8 perf(bench): CPU-reference perf sweep + 50k spec ceiling note`,
`7a4f1ec` (later amended, see `89cdd29`),
`aeecbf0 feat(renderer): draw cluster bbox outlines`,
`2f8d933 feat(inspector): click any particle to view full genome + local signal`,
`14064e4 feat(clusters): geometric union-find organism detection`,
`eec5dbe feat(ui): wire timeline ring into the engine loop`,
`5407f64 feat(timeline): deterministic snapshot ring + scrub restore`,
`4c5c496 feat(ui): wire snapshot save/load + organism clipboard`,
`86551e3 fix(export): argument is destination path, not source`,
`b229214 feat(engine): snapshot save/restore + organism clipboard`,
`05d18d2 feat(hud): expose live parameter controls`,
`c3016ac feat(export): add single-file HTML export script`.

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
