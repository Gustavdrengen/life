# Root spec — Particle Ecosystem Simulator

> The behavioral source-of-truth for the engine. Cross-references `VISION.md` for
> what the product is; this document locks down **how** the engine implements
> that vision. Implementation traceable back to this spec lives in
> `src/engine/`. Tests derived from this spec live in `tests/`.

## 1. Purpose and scope

The simulator is a discrete-time, real-valued particle system. There are no
particle types — every particle is a fixed-length **genome vector** plus
mutable runtime state (position, velocity, energy, age, parentage). All
behavior — emission, signal response, fission, predation — is a derived
function of that vector.

The headless CPU implementation in `src/engine/core/` is the spec-authoritative
reference for everything in the simulation step. GPU compute and render
pipelines (`src/engine/gpu/`) layer on top and must reproduce the same
per-step state transitions when given the same input frame.

## 2. Genome layout

Genome length is fixed at compile time. Slot names and indices are exported
from `src/engine/genome.ts` as the `GenomeLayout` constant — never as
scattered magic numbers.

The MVP genome has 8 personality slots per VISION's "roughly two dozen base
numerical slots…plus per-property signal-response coefficients and modulation
coefficients." 8 is plenty for emergent lineage divergence in MVP while
keeping buffer pressure low enough to clear the 30 FPS budget at 50k
particles.

| Range | Slot | Type | Inh? | Notes |
|------|------|------|------|-------|
| 0 | `mass` | f32 | I | Affects collision response (MVP: equal mass). |
| 1 | `radius` | f32 | I | Visual + collision. |
| 2 | `drag` | f32 | I | Per-second velocity attenuation. |
| 3 | `fissionThreshold` | f32 | I | Energy above which fission is allowed. |
| 4 | `fissionCost` | f32 | I | Energy spent per fission event. |
| 5 | `dustAbsorbRate` | f32 | I | Energy/sec absorbed from nearby dust. |
| 6 | `mutSigma` | f32 | I | Gaussian σ (per-slot scale basis) at fission. |
| 7..14 | `prop[0..7]` | f32 | I | 8 personality slots. |
| 15..38 | `add[0..7][0..2]` | f32 | I | 8 × 3 = 24 additive response per signal axis. |
| 39..62 | `mul[0..7][0..2]` | f32 | I | 8 × 3 = 24 multiplicative response per signal axis. |
| 63..70 | `mod[0..7]` | f32 | I | 8 modulator coefficients (per-slot influence on emission). |
| 71..73 | `emitBase[0..2]` | f32 | I | Base 3-axis emitted signal. |
| 74 | `velAxisBias` | f32 | I | Axis (0..1) the velocity wake biases along. |
| 75 | `velBiasStrength` | f32 | I | Scaling of that shift. |
| 76 | `energyBiasStrength` | f32 | I | Scaling of low-energy output attenuation. |

Genome bit width: **77 slots × 4 bytes = 308 bytes** per particle for the
genome alone. With per-particle runtime state (~40 bytes), total payload
per particle is **~348 bytes** — sized deliberately to fit in a single
contiguous WebGPU storage buffer stride.

Dust carries a shared const reference (`DUST_GENOME`) — `mass=radius=0`,
all `prop=0`, all `add=0`, all `mul=0`, all `mod=0`, all `emitBase=0`,
`velAxisBias=velBiasStrength=energyBiasStrength=0`. Dust genome never
mutates.

Dust carries a shared const reference (`DUST_GENOME`) — a zero-modulator,
zero-R, zero-emit genome that never mutates. Dust is a real first-class
particle; it occupies a slot in SoA buffers and is validated like any
other particle, only with a few rules stripped.

## 3. Signal field

The simulation volume is a closed rectangular box. The signal field is a
3-component continuous vector that exists on a fixed spatial lattice. Each
component is computed independently.

**Emitter deposit (per emitter per tick):** for each particle, the signal
emitter iteration visits the lattice cells within world `signalCutoff`. The
contribution decays as a smooth falloff (default: cubic Hermite, equivalent
to `f(r) = (1 - r/cutoff)² · (1 + 2r/cutoff)` for `r ∈ [0, cutoff]`,
zero for `r ≥ cutoff`).

**Signal at a point:** trilinear interpolation across the 8 nearest
lattice cell corners (in 3D) / bilinear across 4 corners (in 2D).
Out-of-bounds queries clamp to the nearest in-bounds lattice cell.
Wrap-around behavior on world bounds: **clamp** — particles do not see a
toroidal world.

**Lattice resolution:** configurable via `WORLD.latticeResolution`
(default: 32 cells per axis, 32³ = 32768 cells × 3 components × 4 bytes
≈ 384 KiB). Resolution is a per-axis scalar in MVP; anisotropic lattice is
post-MVP. The lattice is recomputed every tick after emitters are
deposited.

**Visualization:** the lattice is rendered as a colored background layer.
The RGB mapping is the three signal components clamped to ±1, mapped via
a fixed palette in `src/ui/palette.ts`. Any single component saturating
shows a pure hue; balanced contributions show neutral gray.

## 4. Per-property signal response

For every inheritable slot `p` and current signal `s ∈ ℝ³` at the
particle's position, the effective value is:

> `p' = (p + a₀s₀ + a₁s₁ + a₂s₂) · exp(m₀s₀ + m₁s₁ + m₂s₂)`

Additive offsets (`a₀..a₂`, slot's `add` coefficients) shift the base
value. Multipliers (`m₀..m₂`, slot's `mul` coefficients) warp
*p multiplicatively and are guaranteed strictly positive for positive
inputs (exp is positive). Both coefficients are inheritable.

This is how a particle "senses" the field — without explicit sensory slots
in the genome, the response itself evolves. Critically, **the response is
applied at sample time** (before each event the particle acts on), not at
fission time. Evolution tunes the response, and the response varies with
the particle's location.

## 5. Self-modulated signal emission

The signal each particle emits in component axis `c` is:

> `emit_c = emitBase_c · exp(Σ_k mod_k · prop_k) · energyAtten · velocityBias_c`

Where:

- `emitBase_c` is the inheritable base.
- `mod_k` is the modulator coefficient for personality slot `k` (one of
  `prop[0..15]`'s modulator). Modulator coefficients are inheritable.
- `prop_k` is the *effective* (signal-responded) value of slot `k` at
  the particle's current location — not the raw genomic value.
- `energyAtten = exp(-energyBiasStrength · max(0, 1 - energy/E_ref))`.
  Low-energy particles decay smoothly toward `0` output.
- `velocityBias_c` injects `(v · velocityAxisBias)` through the particle's
  velocity, scaled by `velocityBiasStrength`. The result is motion leaving
  a characteristic wake.

Dust emits `(0, 0, 0)` always — the dust genome pins `emitBase = (0,0,0)`
and `energyBiasStrength` to a very large value so dust naturally goes
quiet.

## 6. Motion, dust, and energy conservation

Each particle's velocity integrates as `v' = v · drag^dt + signalForce/mass`.
Signal force is derived from the gradient of the effective genome in the
field — for the MVP, force on the particle is `∇(Σ_p p')`, summed via
finite differences across the 6-neighborhood.

**Dust emission (per particle per tick, applied AFTER position update):**
every unit of distance traveled by a particle, that particle loses exactly
1 unit of energy. That energy is conserved as a new dust particle at the
particle's pre-step position with `energy = distance · 1` and the
canonical dust genome. The dust particle's velocity is set to zero on
spawn (energy stays in the world; wake shape comes from the parent's
trajectory through space).

**Energy conservation invariant:**

> `Σ particles energy = constant − Σ dust emitted (never decays)`

Across all interactions:

- Motion: parent loses `|Δd|` energy, dust gains `|Δd|` energy.
- Predation: predator gains `prey.energy`, prey is destroyed, dust
  emission from the kill is governed by `predationDustRate` (default: 0
  for MVP — no dust from predation events beyond motion).
- Fission: parent spends `fissionCost`, two daughters receive the rest
  split evenly. No dust emitted.
- Elastic bounce: no energy cost, exactly mirrored velocities along the
  contact normal.
- Dust absorption by a moving particle: dust disappears, particle gains
  `dustEnergy`.

The total is allowed to be non-constant across the boundary (because the
world can spawn new particles from initial conditions and lose legacy
particles to age caps, but in MVP there is no age cap and no spawn
shortcut). All of these invariants are covered by `tests/engine/energy.test.ts`.

## 7. Predation and bounce

On contact (separation < `r_a + r_b`):

1. Always: elastic bounce — particles are projected back to the boundary
   of contact, velocities are reflected along the contact normal with
   equal mass (MVP). No energy spent.

2. After bounce, **if** both particles exist and the relative speed along
   the contact normal exceeds `WORLD.predationSpeedThreshold` (default 1),
   the faster particle absorbs the slower one. The slower particle's
   entire energy is added to the faster one. The faster particle's
   energy is decremented by `predationCost` (default 0). The absorbed
   particle is removed.

3. If the relative speed is below the threshold, no absorption occurs;
   only bounce separates the two. **Two slow particles in contact cannot
   eat each other, even when genetically identical.**

Velocity impulse on bounce is exact — relative speed is preserved. The
bounce has zero metabolic cost.

## 8. Fission

A particle fissions when its effective energy (after signal modulation of
`fissionThreshold`) exceeds the genome-encoded threshold AND any gating
constraint passes (MVP gating: minimum age 5 ticks to prevent spawning
mid-update).

Each daughter receives a copy of the parent's genome with per-slot
Gaussian noise applied to inherit properties. The noise scale for slot
`i` is `mutSigma · slotNoiseScale[i]`. The `mutSigma` is itself inheritable
and noisy at fission — lineages can evolve their effective mutation rate.

Daughter positions: half the contact-distance away from the parent along
the gradient direction (or a random unit vector if no signal is
discernible). Daughter velocities: equal-split of the parent velocity
plus a small random kick (default `±0.5` m/s) along the separation axis.

## 9. Determinism, snapshots, scrubbing

A simulation state snapshot is the entire SoA buffer contents plus the
RNG state and current tick. Snapshots are taken at
`WORLD.snapshotInterval` (default every 60 ticks) and on every user action
(parameter change, save, scratch, paste).

Scrubbing reconstructs the nearest snapshot and plays forward cached
intermediate states with linear interpolation between them so the visible
playback is continuous. Edits invalidate forward state and resume the
playback from the new scratch point.

**Determinism is required within a single machine/browser combination.**
This MVP does **not** try to be cross-hardware bit-identical (WebGPU float
ordering is implementation-defined), and the headless CPU spec uses a
diff authoritatively for tests. The CPU reference computes the same
physics, but expected regression tests run on CPU only.

## 10. Acceptance criteria (tied to VISION §Success)

| # | Success criterion | Verifiable as |
|---|--------------------|----------------|
| 1 | ≥ 30 FPS at MVP target population | Headless benchmark in `tests/perf/` + GPU smoke |
| 2 | Genome centers visibly drift | 60-tick evolution sweep with diversity metric |
| 3 | Signal response produces visible clustering | Life-cluster detection after parameter sweep |
| 4 | Long-running worlds show predation + extinction | Multi-thousand-tick run with cluster histogram |
| 5 | Multi-cell organisms emerge | Cluster detection on controlled seed |
| 6 | State save/load is bit-identical (CPU) | Snapshot equality test |
| 7 | Time scrub is continuous | Snapshot interpolation spec compliance |
| 8 | Single-file `.html` export round-trips | File round-trip test (`tools/export-singlefile.mjs`) |
| 9 | Global parameter change visible within 1 minute | Parameter sweep + diversity metric |
| 10 | Transplant isolated organisms | Save/restore cluster + reseed harness |

## 11. Closed decisions (carried forward from VISION §Constraints)

These were previously listed as vision "open questions" and have been
locked by the user (see `VISION.md` §Constraints). The spec must
match; deviations are recorded inline as Decisions on a per-change
basis.

- **Target population at MVP.** **50,000** particles, hard cap. The
  engine refuses to spawn above the cap; saved-state file-size budget
  is sized accordingly. Below the cap, the simulation runs without
  hitting any artificial throttle.
- **Frame-rate floor.** Strict **≥ 30 FPS at 50k** is the bar. No
  adaptive population scaling, no dynamic FPS interpolation — if the
  host GPU cannot sustain it the user reduces the target via the HUD
  before launching.
- **World dimensionality.** **2D rendering with 3-axis signal math**.
  Positions, velocities, contacts, and elastic bounce are 2D; the
  signal-field lattice holds 3 components per cell so per-property
  response coefficients aren't pruned. The engine math is pure
  function of the 3-axis field — a future 3D simulation is a
  rendering + integration expansion, not a semantics rewrite.
- **Dust dissipation.** **No decay** by default. A `dustDecayPerSec`
  parameter is exposed (default `0`) so the user can dial decay up
  if they want heat-death-like behavior; the MVP itself never invokes
  decay on default settings, consistent with the explicit non-goal
  "no heat-death mechanic."
- **Mutation noise distribution.** Fission applies **additive
  Gaussian** perturbation to every inheritable slot at scale
  `mutSigma · SLOT_MUTATION_SCALE[slot]`. Multiplicative inheritance
  is post-MVP.
- **Colorblind palette.** Signal axes use the perceptually balanced
  triple `#5fb3ff` / `#ff7d52` / `#b56cff` (signal-A/B/C), verified
  discriminable under deuteranopia, protanopia, and tritanopia
  simulations. Dust is `#3b4252`; organism outlines are `#7a8aa0`.

## 12. Non-goals (mirror of VISION §Explicit non-goals)

- No scripting or rule layer. The genome is the only knob.
- No particle types. Predator/prey/plant are emergent.
- No branched timelines or undo trees.
- No multiplayer or networking.
- No plugin or extension system.
- No cellular automaton — particles move continuously.
- No learned behavior. Mutation is Gaussian inheritance.
- No win condition or progression.
- No physics accuracy goal.
- No external AI APIs.
- No 3D simulation in MVP. 2D rendering with 3-axis signal math is
  the locked dimensionality; 3D simulation is post-MVP.
- No adaptive throttling. The cap is the cap and the FPS floor is
  the floor — either both hold or neither.
