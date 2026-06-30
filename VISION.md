# Particle Ecosystem Simulator

## Purpose

A browser-based, WebGPU-powered particle simulation in which thousands of particles emit, sense, hunt, split and evolve in a continuous property-space ecosystem. Each particle carries a small fixed-length **genome** — a vector of numerical properties — and *all* behavior emerges from that vector. There are no hard-coded "predator" or "prey" types, no scripting layer, no rule editor. Particles emit a continuous three-component **signal field** that fills the simulation volume; every genome property is warped in response to that field by an inheritable, per-property combination of additive offsets and exponential multipliers. Energy is conserved per event and bleeds out of moving particles as low-grade "dust" particles that any sufficiently fast particle can absorb on contact. Predation is purely kinetic: only particles moving above a threshold speed can absorb slower neighbors, and when two qualifying particles collide the faster one wins — so a particle whose lineage is genetically identical to a slower cluster-mate cannot be eaten by it, but two entirely unrelated genomes can decisively cooperate or compete.

The product is a single-tab toy: tune parameters, drop initial conditions, watch lineages of self-signaling, self-replicating particle "cells" emerge, cluster into multi-cell organisms, hunt, go extinct, and evolve — fast enough to feel like a live ecosystem, deep enough that the same seed surprises you a week later.

## Target user

The user themselves. This is a personal creative-coding toy for someone who already enjoys fiddling with particle systems and artificial-life work — Ventrella's Particle Life, Lenia emulators, generative shadertoy sketches. They iterate alone, in private, adjusting parameters and watching emergent behavior until it produces the kind of motion that is interesting to look at and surprising in its origins. Sharing, if it ever happens, is by handing a friend a single `.html` file. There is no commercial audience, no onboarding uplift, and no second user type.

## Core features

1. **WebGPU particle simulation engine (MVP).** Tens of thousands of particles updated and rendered each frame using WebGPU compute and render pipelines. State lives in GPU buffers; rendering uses the same buffers the simulator writes to.
2. **Genome-driven particle (MVP).** Each particle carries an inheritable genome of roughly two dozen base numerical slots plus their per-property signal-response coefficients and modulation coefficients. No runtime-defined schemas, no category types. A particle *is* its vector. What the particle does is determined entirely by where that vector sits in parameter space.
3. **Three-component continuous signal field (MVP).** Every particle constantly emits a 3-axis signal vector. The signal at any point in the simulation volume is the sum of nearby emitters, attenuated by distance, with a hard cutoff. The field is computed on a fixed spatial lattice: emitters deposit into nearby lattice cells each frame, and particles sample the interpolated field value at their location — cost is grid-dependent rather than particle-count-dependent. The lattice is optionally rendered as a colored background layer so signal gradients are directly visible.
4. **Per-property signal response (MVP).** Each inheritable genome property carries three multiplicative coefficients and three additive offsets — one pair per signal axis. The effective value of property `p` at the particle's location is

   `p' = (p + ax·sx + ay·sy + az·sz) · exp(mx·sx + my·sy + mz·sz)`

   where `sx, sy, sz` are the three signal components at the particle's position, `ax, ay, az` and `mx, my, mz` are the inheritable additive and multiplicative response coefficients, and `(·)` is element-wise. Exponential ensures smooth, strictly-positive response for positive `p`; additive offsets let mutation shift the base value rather than only scale it. This is the mechanism that lets particles evolve sensitivity and asymmetry toward specific signal axes.
5. **Self-modulated signal emission (MVP).** Each particle's emitted signal is `base_signal · exp(sum_k mod_k · prop_k)` further multiplied by realtime state: low-energy particles attenuate their output (a dying cell naturally falls quiet); high-velocity particles shift their emission along an inheritable axis so motion leaves a characteristic wake. Both modulator coefficients and state-response coefficients are inheritable and mutate at fission.
6. **Movement-energy dust trail (MVP).** Every unit of distance a particle moves, that particle loses exactly 1 unit of energy. That energy is not destroyed — it is deposited as a new **dust** particle carrying exactly the spent energy, located at the parent's pre-step position. Dust particles are real, first-class particles: they occupy space, emit a fixed `(0, 0, 0)` signal, and have the canonical default genome vector — quiet, never signaling, never modulating, never replicating, never mutating. They are valid prey and can be absorbed or bounced against like any other particle. Dust is not removed from the world; a long-running simulation accumulates it, and that accumulation is part of the medium — slow lineages sit in dust, moving lineages churn through it. The world does not have a heat-death mechanic; energy is conserved among ordinary particles and never destroyed.
7. **Kinetic predation + zero-cost elastic bounce (MVP).** When two particles come within a small minimum separation, they elastically bounce — separating them geometrically without changing either particle's speed or energy. Bounce has no metabolic cost. Independent of bounce, on contact: a particle can absorb another *only if* it is moving faster than the system's **predation speed threshold** (default 1 unit per second). When both contacting particles are above threshold, the faster one absorbs the slower one and acquires its energy. When neither is moving fast enough, nothing is absorbed and the bounce alone separates them. A particle whose speed is below the threshold is therefore defensively unmoveable against itself — slow lineages cannot eat each other even when touching, only conglomerating by sticking — and is undefended against anything faster that touches them. This rule gives the user explicitly what they asked for: completely unrelated lineages can coexist, cooperate, or eat each other without immunity markers. Self-protection is purely *behavioral*: stay still, or stay slow. Predation is also emergent — lineages whose genomes favor high velocity can and will feed on anything they reach. The same rule cleanly produces multi-cell organisms from unrelated lineages when those lineages happen to converge toward similar genome regions: the geometry of the cluster is the organism, not a flag.
8. **Fission with inheritable mutation (MVP).** A particle splits when its current energy exceeds its genome-encoded fission threshold (which is itself modulated by the local signal environment — this is how coordinated reproduction emerges from evolution). Two daughters inherit the parent's genome, energy is split between them, and each inheritable property is perturbed by Gaussian noise whose scale is set by the parent's genome-encoded per-property mutation rate. Lineages tune mutation rate, signal sensitivity, marker profiles, and fission thresholds over generations in real time.
9. **Deterministic timeline and scrubbing (MVP).** Snapshots are taken at fixed intervals plus at every user action. Time scrubbing reconstructs the nearest snapshot, then plays forward cached steps with linear interpolation across snapshot boundaries so playback is visibly continuous. Edits invalidate forward state and resume. Determinism is required *within a single machine and browser*; this is what makes scrubbing work and what makes saved states reproducible.
10. **State save / restore and "organism cloning" (MVP).** Full simulation states can be saved, restored, exported, and reloaded. Users can select any cluster of particles (an emerging organism), copy them to a clipboard-like archive, and paste them into any saved world to seed a new lineage or transplant an interesting catch.
11. **Interactive parameter & inspection HUD (MVP).** Dense control panel along edges of the canvas exposes every inheritable parameter category, lattice resolution, cutoff radius, dust lifetime, bounce constants, world bounds, and fission defaults. Click on any particle to inspect its full genome, its current effective property values, and the local 3-axis signal vector at its position. Cluster-detection overlays highlight emergent multi-cell organisms; click on a cluster for a per-organism panel showing mean genome, energy distribution, age, and population trajectory over time.
12. **Single-file HTML export (MVP).** The current world can be exported as a single `.html` file bundling engine, UI scaffold, and world state. Open in any modern browser with WebGPU, no installation, no server, no build step.

## Constraints

- Runs entirely client-side in a modern browser using WebGPU compute and render. No backend, no server, no installed dependencies, no network calls at runtime. Offline-capable once loaded.
- Renders the signal field as a colored background layer by default — signal is a first-class visible element, not just a physics input.
- The full game state fits in a single `.html` file under ~5 MB even at the agreed target population.
- Maintains interactive frame rate (≥ 30 FPS at the agreed target population on a typical desktop GPU; see Open questions for the specific target).
- Determinism is required within a single machine/browser combination. Cross-hardware reproducibility is an aspirational goal: WebGPU floating-point ordering is implementation-defined, so the same seed on two different machines is not guaranteed to be bit-identical.
- Genome length is fixed at compile time. No runtime-defined properties, types, or schemas.
- Energy is per-particle and conserved at the per-event level across all ordinary interactions. Total energy is constant within the world: motion deposits dust, predation transfers energy from prey to predator, and absorption of dust does likewise. Dust is never dissipated — it accumulates.
- UI is built with **Svelte** and **Tailwind CSS**.
- No external AI/ML, no learned or evolved "AI" inside the simulation (evolution is selection on Gaussian-perturbed inheritance — no gradient descent, no neural network, no learning loop).
- Keyboard navigation of timeline, save/snapshot, and basic simulation controls is required. UI panels read at WCAG AA contrast on the default dark theme. No functionality is locked behind precise mouse input.
- Engine is closed: no plugin or extension API, no custom-shaders-by-user, no scripting.

## Explicit non-goals

- **No scripting or rule layer.** No visual scripting, no Lua, no DSL, no clause-based if-then editor. The genome is the only knob.
- **No particle types.** There is no engine concept of "predator," "prey," or "plant." All of those are emergent from genome position.
- **No branched timelines or undo trees.** Linear history. Edits invalidate forward state.
- **No multiplayer, no networking, no cloud state, no analytics.**
- **No plugin or extension system.** Engine is closed.
- **No cellular automaton.** Particles move continuously in space; the signal lattice holds the field, never particle positions.
- **No learned behavior.** Mutation is Gaussian noise applied to inherited genome values; selection is energy balance; there is no optimizer running inside the simulation.
- **No game-like objective.** No win condition, no scoring, no progression, no level-up.
- **No physics accuracy goal** — just visually plausible emergent behavior.
- **No external AI APIs** — no hosted LLMs, no remote inference, no model access.

## UX and style goals

The feel is closer to a scientific sandbox than a game: dense, structured, with a large central viewport and parameter panels pinned to the edges. Visual style is high-contrast scientific visualization — think Particle Life, Lenia emulators, modern shadertoy sketches: a clean dark background, signal field as a soft colored gradient underneath, particles as small saturated shapes, organisms outlined as low-saturation clusters. Interactions are deliberate and immediate: parameter changes are reflected in the field within a frame; time scrubbing feels like scrubbing a video timeline, with no visible stepping at snapshot boundaries. The signal field is the most important visual element — most of the time, the user is watching signal gradients propagate, with particles as the moving vectors of those gradients.

The interface voice is technical, terse, and assumes the user knows what a genome is. No on-screen tutorials, no hand-holding, no friendly mascots. Every common action has a keyboard shortcut. The mouse exists for inspection and cluster selection.

Accessibility floor: keyboard-navigable controls across the timeline and full simulation control surface, WCAG AA contrast on UI panels in the dark theme, no functionality that requires precise mouse input, default palette is colorblind-friendly.

## Success criteria

A working product is observed when **all** of the following are visibly true:

1. **Real-time, non-stuttering interaction.** Running the engine and adjusting parameters stays ≥ 30 FPS at the agreed target population on the user's main machine.
2. **Emergent lineages.** Within minutes of seeding, particle genome centers visibly drift — natural selection pushes populations in different directions; lineages diverge.
3. **Visible signal-driven clustering.** Adjusting the per-property signal response of a population produces a visible change in how that population clumps with others within seconds.
4. **Real predation and extinction.** Long-running worlds show predator-like lineages consuming prey-like lineages, and ecosystem collapse on perturbation (kill a prey cluster, predators starve; kill a predator cluster, prey explode).
5. **Self-organized reproduction.** Multi-cell cluster organisms emerge that fission in coordinated ways that are legible from the genomes involved — not hard-coded, but explainable in retrospect.
6. **Determinism within a machine.** A saved state reopens identically across sessions and tabs on the same machine. Time scrubbing reproduces earlier states bit-perfect.
7. **Time-scrub continuity.** Scrubbing the entire history is continuous — no visible stepping at snapshot boundaries, no hitching on large state jumps.
8. **Single-file export round-trips.** Export a world as `.html`, open it on the same machine in a fresh browser profile, see the same world.
9. **Iteration under one minute.** A single global parameter change produces visible behavioral consequence within one minute at the agreed target scale.
10. **Transplant isolation.** An interesting organism can be selected mid-run, copied into a fresh empty world, and produce a viable descendant lineage on its own.

## Open questions

- **Target population at MVP.** Is it 10,000, 50,000, 200,000, or higher? Sets the FPS target and informs the saved-state file size budget.
- **Frame-rate floor policy.** Strict ≥ 30 FPS for any population up to the cap, or adaptive (higher FPS at lower counts)?
- **World dimensionality.** 2D rendering with 3D signal math (faster, easier to read) or full 3D simulation and 3D rendering (heavier, but more "real")? The genome, signal field, and predation model work the same either way — this is purely a render question and a position-update question.
- **Dust dissipation rate default.** Whether dust has any decay at all (released as a free parameter, defaulting to never).
- **Mutation noise distribution.** Gaussian is proposed; whether some properties should mutate multiplicatively (e.g., `prop' = prop · (1 + noise)`) rather than additively is undecided. Distribution may matter for emergent stability.
- **Colorblind-friendly palette choice.** Needs to be picked, not left at the framework default.
