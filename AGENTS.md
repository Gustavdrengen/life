# AGENTS.md — Operating Manual

> Operating manual for the repository. The agent that runs in this project reads this file
> at session start, treats it as the source of truth for procedural rules, and follows it
> over chat-side convention. `VISION.md` is the source of truth for *what* to build; this
> file is the source of truth for *how* work proceeds here.

## 1. Repository mission

Build a browser-based WebGPU particle ecosystem simulator in which thousands of particles
emit, sense, hunt, split and evolve in a continuous property-space. All behavior emerges
from each particle's fixed-length genome vector — there are no hard-coded particle types,
no rules layer. The product is a single-tab creative-coding toy: tune parameters, drop
initial conditions, watch lineages of self-signaling, self-replicating particle cells
emerge, cluster, hunt, go extinct, evolve — fast enough to feel like a live ecosystem,
deep enough that the same seed surprises you a week later. The full product ships as a
single `.html` file that runs offline in any modern browser with WebGPU.

## 2. The role of `VISION.md`

`VISION.md` is read-only, user-owned, and the only true product source. The agent must
never rewrite, reinterpret, or "improve" the vision without an explicit user instruction.
The vision answers what; this file answers how. In a conflict between the two, the vision
wins. If the vision is silent on a product question, the agent picks a reasonable default,
records the decision (`## Decision recording` below), and keeps working.

## 3. The decision hierarchy

When two rules are in tension, resolve in this order, top to bottom:

1. System and safety constraints (do not destroy user data, do not violate the vision's
   explicit non-goals).
2. The user's direct instruction in the current conversation.
3. `VISION.md`.
4. `AGENTS.md` (this file).
5. Other repository docs (`docs/`, specs).
6. Existing code conventions and the surrounding file's style.
7. General best practice.

The user's vision wins over implementation details. The current user instruction refines
the current task but is not a license to ask follow-up questions. Engineering decisions
are the agent's unless they materially change the vision.

## 4. The autonomy model

The agent owns without asking:

- File layout, naming, formatting, linting, type checking, test setup, build setup,
  documentation organization, internal workflow files, helper prompts, skills,
  reusable templates, scripts, automation.
- Library and tooling choices inside the chosen stack (Svelte + Tailwind + Vite +
  TypeScript + WebGPU), unless they would materially change the user-facing product.
- The internal structure of the engine, the ordering of MVP features, and the design
  of test scaffolding.
- Commit conventions, commit timing, and the contents of this file (other than the
  vision-protected rules above).

The user owns:

- The product vision (`VISION.md`).
- Any single `.html` export they choose to hand to a friend.
- External services or external accounts the simulator might one day need (there are
  none in the MVP — the product is fully client-side).

The agent must not interview the user about the vision, request plan approval, or pause
for confirmation outside of `INBOX.md` items requiring clarification.

## 5. The cross-cutting files

Two repository-owned channels carry communication between agent and programmer. Both are
created during bootstrap, maintained by the agent, and treated as first-class project
files. They describe **current state** only — past exchange lives in commit messages and
dated state-of-play entries.

### `INBOX.md` (programmer → agent)

Free-form. The programmer drops entries to direct work, raise issues, request vision
changes, reprioritize. The agent reads it as English, makes a reasonable interpretation
on ambiguity, and proceeds. For each entry the agent does one of:

- **Address** the entry — do the work, then **remove the entire entry**.
- **Decline** with a reason — remove the entry, capture the reason in the commit.
- **Escalate** as a vision hole if the entry is a vision change the agent cannot infer a
  reasonable default for — leave the entry in `INBOX.md` and use the vision-hole mechanism.

Every resolved entry is removed. There is no archive, no strikethrough, no marker.
Entries that survive will be re-addressed on subsequent sessions, not silently dropped.

### `BLOCKED.md` (agent → programmer)

Used only when the agent cannot proceed without external help (credentials, browser
access the agent does not have, a vision-level decision that is external to the codebase,
a non-code action only the programmer can do). Format:

```
- [YYYY-MM-DD] <what is blocked>
  - **Tried:** <what the agent has already attempted>
  - **Needed:** <the specific action the programmer can take>
  - **Impact:** <which tier of work is affected, and what fallback the agent is using>
```

The agent maintains it: add when discovered, update on status change, **remove when
cleared**. No archive. No marker. A blank `BLOCKED.md` is the goal.

### Strict priority order

When multiple sources of direction are open at once, the agent follows this order,
highest to lowest. If a lower-priority item is deferred, the deferral is surfaced in the
next checkpoint commit and resumed as soon as the higher-tier work clears:

1. **Tier 0** — an open broken/unplayable item in `STATE_OF_PLAY.md`.
2. **Open `INBOX.md` entries**.
3. **Tier 1** — painful/empty items.
4. **Tier 2** — missing vision features.
5. **Tier 3** — polish.

Tier 0 always outranks `INBOX.md` because the user cannot consume a broken product.
The agent must not silently drop a tier when picking a lower-tier task.

## 6. The commit policy

A commit lands as soon as all of these hold:

- The change compiles, type-checks, and the relevant tests pass.
- No previously-working behavior is broken by the change.
- The change can be described in one sentence.

Mandatory commit triggers (commit at the smallest sub-step that satisfies the rule
above):

- After any new feature, bug fix, refactor, rename, or reorganization.
- After any spec, doc, or `AGENTS.md` change.
- After any test addition or modification.
- After any dependency manifest or lockfile update.
- After any build or tooling config change.
- Before starting a new unrelated task.
- Before ending a work session.

Pure-documentation changes (markdown, comments, docstrings, prompts) reduce the
commit-readiness test to "the file is well-formed and self-consistent;" the build and
test bullets do not apply. Any change to a spec, runtime config, public API, dependency,
or source file in a build-exercised directory runs the full verification.

One logical change per commit. If the headline needs "and," split. The commit message
follows Conventional Commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
`test:`, `build:`, `perf:`) with a short imperative subject and an optional body.
No `Co-authored-by:`, `Signed-off-by:`, or AI-generated trailers — the repository's git
identity (`Particle Ecosystem Simulator Agent`) is the only attribution the commit
needs.

Git identity is set on the repository, not globally:

```bash
git config user.name "Particle Ecosystem Simulator Agent"
git config user.email "particle-ecosystem-simulator-agent@local"
```

If `VISION.md` is renamed, update the identity in the same change.

## 7. Code-quality standards

Stack-specific rules for this repository:

- **Language**: TypeScript everywhere (engine, UI, tests). `strict: true`,
  `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- **Framework**: Svelte 5 with runes; Tailwind CSS for styling; Vite as the build tool.
- **Naming**: `camelCase` for variables and functions, `PascalCase` for types and
  classes, `SCREAMING_SNAKE` for compile-time constants and genome layout constants.
  WGSL keywords are lower-snake within shader strings.
- **Errors**: typed error classes (`SimulationError`, `SpecError`, `EngineError`); no
  silent `catch {}`. Throw at the boundary, surface at the call site, never bury.
- **Modules**: one feature per file. Engine modules export a typed handle
  (`EngineHandle`, `FieldHandle`) — no god-objects.
- **Formatting**: Prettier defaults + 100 char column. Lint with ESLint
  (`@typescript-eslint`, `eslint-plugin-svelte`).
- **Performance**: WebGPU work belongs in `*.wgsl` strings, evaluated once at boot
  and cached. Never re-compile per-frame. Particle layout is `Array<Number>` only at
  the typed API boundary — internally, plain typed arrays.
- **Determinism**: any RNG use goes through a single seeded `Mulberry32` instance
  per simulation. No `Math.random()`, `performance.now()`, or `Date.now()` inside
  the engine's update loop.

## 8. Testing expectations

Testing is a first-class responsibility — not optional polish. The state-of-play note,
not the test suite, is the source of truth for whether the product works; the test
suite is the regression safety net that says it still works tomorrow.

Testing model for this product:

- **Pure-logic unit tests** with Vitest: genome math, signal modulation, mutation,
  fission predicates, energy conservation, RNG determinism — fast, no GPU required.
- **Engine integration tests** that load a small headless WebGPU shim (CPU fallback
  path) and run the simulation for N steps, asserting on energy conservation,
  population count, and extinction events. These exist because running the real
  GPU under headless CI is not always possible.
- **Snapshot tests** for the deterministic timeline: same seed + same inputs →
  byte-identical particle state.
- **Spec tests**: derived from module-level specs, locked to a failure case that
  fails before the feature and passes after.
- **Smoke tests**: a build artifact that opens in Chromium and confirms the
  WebGPU adapter initializes and the first frame renders. Not every spec warrants
  this; product-level Tier 0 fixes do.

Tier-bound test requirements (binding once a test runner exists):

- **Tier 0 fix** requires a regression test that fails on the broken code and
  passes on the fix.
- **Tier 1 fix** requires a playtest observation recorded in `STATE_OF_PLAY.md`
  plus a regression test where the symptom is testable.
- **Tier 2 feature** requires a spec-driven test that fails before and passes
  after. No spec → no feature.
- **Tier 3 change** is allowed to skip new tests, but must not regress existing
  tests in the touched area.

The agent must look at the test story at every Tier-2 commit: is the test honest?
Does it pin a behavior the spec actually specifies? If not, fix the test, fix the
spec, or both.

## 9. Maintenance expectations

The agent is the maintainer. It proactively:

- Creates missing standards, updates stale ones, drops obsolete ones.
- Strengthens weak testing posture when a regression slips through.
- Replaces stale helpers, prompts, and skills when they no longer match the workflow.
- Extracts overgrown `AGENTS.md` sections into `docs/`, specs, or `skills/` when this
  file approaches the 400-line working budget.
- Restates rules whenever the doc model shows signs of breakage (a rule repeated in
  three places, a prompt that contradicts the standard, a stale "current state" note).

The "current state" of any concern lives in `STATE_OF_PLAY.md` (dated entries) or in
specs / module-level docs — never in a frozen "we used to…" comment in code.

## 10. The priority tiers

The strict order the agent picks the next task from. Higher tiers outrank lower tiers.
Promoting a Tier 3 task to skip Tier 0 or Tier 1 is forbidden.

- **Tier 0 — Product is broken or unplayable.** Crashes on launch. Core loop does not
  function. UI overlaps and blocks interaction. Controls do not respond. Required inputs
  cannot be completed. *Fix immediately. Do not add new features while Tier 0 items
  exist.*
- **Tier 1 — Product is painful or empty.** Engine runs but is not interesting. The
  first thirty seconds show no motion. There is no signal-driven clustering, no
  predation, no lineage divergence within a few minutes of seeding. *Resolve before
  adding new content or new features.*
- **Tier 2 — Missing capabilities explicitly in the vision.** Features the vision
  lists as MVP that do not yet exist. *Resolve in vision order.*
- **Tier 3 — Polish, depth, and nice-to-haves.** Visual polish, sound (if added), new
  content beyond the vision, refactors for elegance, performance tuning. *Resolve
  opportunistically when higher tiers are clear.*

For this product type (interactive single-tab creative-coding toy), Tier 1 translates
to: the engine runs and particles move, but the first minute of play produces no
visible lineage divergence, no signal-driven clustering, and no predation — i.e. the
core loop works mechanically but the emergent behavior promised in the vision is not
yet present on screen. The playtest analog: a single minute of `$npm run dev` +
opening the page, observing whether genome-space separation is visibly drifting.

The smallest one-line change that would make the next minute more interesting is the
next task.

## 11. The state-of-play rules

The live, dated log of state-of-play observations lives in **`STATE_OF_PLAY.md`** —
not in this file. This file holds the rules that govern the log so they survive the
rotation of old entries and so the agent cannot quietly drop them.

Entry format — one dated heading per session, with these four buckets, each as
bullets, in this order:

- **What works** (one bullet per thing verifiably working as a user would experience).
- **What is broken, rough, or missing** (one bullet per thing, with the smallest
  reproducible reproduction).
- **What is "there" in the code but feels bad to use** (one bullet per thing, with
  the user-visible symptom, not the implementation gap).
- **What was not exercised this run** (one bullet per area skipped, with the reason).
  An entry that claims "all flows verified" must list every documented flow that
  was actually run; otherwise the bucket holds the unexercised flows.

Cap and rotation: **maximum 10 dated entries**. When a new entry is appended and
the file already has 10, the **oldest** entry is removed first. Trends remain
visible without the file growing unbounded.

Calibration check: if the previous three entries contain no Tier 0 or Tier 1 items,
the next entry must observe an unexercised area specifically. A perpetually green
state-of-play is a sign that the gate has become ritualistic.

Per-session obligation: every session that is not a trivial change appends exactly
one dated entry before ending. The trivial-change bypass covers pure markdown,
prompt files, docstrings, comments, and test-fixture data not loaded by the build,
and only those. Specs, runtime configs, public APIs, dependency manifests, and
source-tree files always run the full gate.

## 12. The session-done checklist

A session is done when **all** of these are true, in order:

1. All Tier 0 and Tier 1 items from the most recent state-of-play entry are resolved,
   blocked on a surfaced vision decision, or absent.
2. Every open item in `INBOX.md` is addressed, declined with reason, or escalated.
3. `BLOCKED.md` has been scanned: no stale entries; every open entry has a current
   **Tried / Needed / Impact** note.
4. All in-flight work is committed.
5. The relevant build, type-check, lint, and unit-test commands pass.
6. The state-of-play entry for the session has been appended to `STATE_OF_PLAY.md`,
   the 10-entry cap is enforced (oldest rotated out if needed), and this file's
   governing rules for the log are intact.
7. The next session has a clear, evidenced starting point (the next task and why).

A session that adds new Tier 2/3 work while Tier 0/1 is open is not done.

## 13. The decision-recording one-liner format

For any non-obvious, precedent-setting, or surprising decision, record it inline in
the commit message, the code, `AGENTS.md`, or a doc using this exact format:

> **Decision:** [one-sentence description]
> **Tier:** T0 / T1 / T2 / T3
> **Evidence:** [link or pointer — state-of-play bullet, file path, test result, run output]
> **Trade-off:** [what is being deferred and why, if anything]

Tier and evidence are always required. The trade-off line is mandatory when the
chosen action is not the most obvious one. Examples:

Good example — biased defaults:

> **Decision:** Set default target population to **50,000** particles for the MVP perf
> budget.
> **Tier:** T2
> **Evidence:** `VISION.md` "Open questions — target population at MVP" lists 10k / 50k
> / 200k as the options; 50k is the midpoint that fits a 5 MB HUD state budget and
> keeps CPU-fallback test runs under ~5 s.
> **Trade-off:** Larger worlds (200k+) need a future GPU-buffer-streaming feature not
> in MVP. Smaller worlds (10k) leave headroom for higher fidelity but cap lineage
> density.

Bad example — vague trade-off, no evidence:

> **Decision:** We picked 50000 because it felt right.
> **Tier:** T2
> **Evidence:** none.
> **Trade-off:** none.

The bad example is invalid: missing evidence, missing tier justification, missing
trade-off note.

## 14. The spec-driven workflow

Specs live next to the code they describe, in `specs/`. Hierarchy:

- **Root spec** at `specs/ROOT.md` — what the product is, what the engine must do,
  what "Tier 0 working" means, the acceptance criteria for `VISION.md`'s success list.
- **Module / feature specs** at `specs/<feature>.md` — the behavior contract for one
  engine module or one UI surface. Purpose, scope, inputs/outputs, behavior,
  constraints, edge cases, acceptance criteria, failure modes, dependencies.

Specs are required for Tier 2 features, recommended for Tier 1 fixes, optional for
Tier 3 polish. A spec must be written before the test for a Tier 2 feature. If the
implementation changes behavior legitimately, the spec is updated in the same
commit — never silently drifts.

The source-of-truth ordering: `VISION.md` (what to build) → `specs/` (what each
piece should do) → code (what it does) → tests (whether it matches the spec) →
state-of-play entry (whether the user agrees).

## 15. Short examples of good and bad decisions

Real cases derived from the rules above:

- **Good (engineering within autonomy).** Choosing Vite as the build tool. Tier T2.
  Evidence: `VISION.md` "Constraints" requires single-file `.html` export — Vite's
  `vite-plugin-singlefile` is the cleanest path; alternatives (esbuild lone, Rollup
  custom) require more glue. Trade-off: an additional dev-only dependency for the
  plugin.
- **Good (declining an `INBOX.md` item with reason).** "Don't require a service worker
  for offline mode" — declined as conflicting with `VISION.md` non-goal "no networking
  in runtime" if interpreted as a network-required offline flow. Recorded in the
  commit, entry removed from `INBOX.md`.
- **Good (vision-hole surfacing).** World dimensionality is undecided in the vision;
  surface a "vision gap" entry in the next checkpoint commit, proceed under the
  assumed default (2D rendering, 3D signal math) until the user settles it.
- **Bad (asking the user a formatting question).** "Should I use tabs or spaces?" —
  forbidden. The agent picks (Prettier defaults) and moves on.
- **Bad (preserving existing convention as a constraint).** "I'll add the asset
  loader to the existing `utils.ts` to stay consistent" — wrong when `utils.ts` is
  already god-object-shaped. The right move is a new `asset-loader.ts` and the
  follow-up split of `utils.ts`.
- **Bad (deferring Tier 0 to ship Tier 3).** "The shader has a 2-frame hitch on
  population bump — I'll add a stats overlay first to confirm the symptom" —
  forbidden. Fix the hitch first.

## State of play

The live, dated log lives in `STATE_OF_PLAY.md` at the project root. This file holds
the rules that govern the log (entry format, 10-entry cap + rotation rule,
calibration check, trivial-change bypass, per-session obligation). The log itself
never lives here.

## Cross-references

- Vision: `VISION.md`
- State-of-play log: `STATE_OF_PLAY.md`
- Programmer inbox: `INBOX.md`
- Agent blockers: `BLOCKED.md`
- Specs root: `specs/`
- Build: `package.json` + `vite.config.ts`
- Lint/format: `.eslintrc.cjs`, `.prettierrc`
