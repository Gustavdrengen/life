# Spec — GPU compute + render pipeline

> Behavioral source of truth for `src/engine/gpu/` — the WebGPU compute
> pipeline that drives MVP performance at the 50,000-particle vision cap.
> The spec is required by `AGENTS.md §14`: specs precede implementations
> for Tier 2 features. The CPU reference in `src/engine/core/` remains
> the spec-authoritative source for per-step state transitions; this
> document specifies the GPU surface on top.
>
> @see VISION.md §Core features #1 ("WebGPU particle simulation engine (MVP)")
> @see VISION.md §Constraints (≥ 30 FPS at 50k on a typical desktop)
> @see specs/ROOT.md §10 row #1 (acceptance #1)
> @see specs/ROOT.md §3 (signal field — the most expensive shared work)

## 1. Purpose & scope

The current CPU reference is O(N²) in the collision pass. At the
50,000-particle vision cap and a fixed `dt = 1/60`, the collision pass
alone approaches 2.5 × 10⁹ comparisons per tick, which is minutes of
wall-clock on commodity hardware and exceeds any reasonable frame
budget. The GPU pipeline replaces the inner loops with WebGPU compute
shaders without changing engine semantics — the headless CPU reference
is the spec-authoritative source for "what the per-tick state transition
is," and the GPU is a separately-implemented surface that must produce
the same transition under the same inputs (within WebGPU floating-point
non-determinism per VISION §Determinism).

## 2. Surface

`src/engine/gpu/` exports a single factory:

```ts
export interface GpuEngine {
  /** Push one fixed-Dt tick. Mutates all internal GPU buffers. */
  stepOnce(): void;
  /** Snapshot the SoA buffers to typed arrays in CPU memory. */
  readState(): SimulationState;
  /** Re-upload an externally-prepared state (snapshot load path). */
  writeState(state: SimulationState): void;
  /** Optional: hint the scheduler before/after a render frame. */
  beginRenderFrame(): void;
  endRenderFrame(): void;
  /** Free all GPU resources. */
  destroy(): void;
}

export function createGpuEngine(
  state: SimulationState,
  device: GPUDevice
): GpuEngine;
```

The `GpuEngine` is a *drop-in replacement* for the CPU step function
inside `App.svelte`. It does not own the `SimulationState` itself; the
caller (HUD, snapshot path) is the spec-authoritative owner and reads the
GPU's buffers back into the same shape.

## 3. Buffer layout

The single SoA storage buffer (per VISION §Genome layout) holds:

| Region | Item | Stride | Count | Notes |
|--------|------|--------|-------|-------|
| 0 | genome | GENOME_LENGTH × 4 | capacity | float32 × 77 |
| 1 | positions | 2 × 4 | capacity | float32 × 2 |
| 2 | velocities | 2 × 4 | capacity | float32 × 2 |
| 3 | energies | 4 | capacity | float32 |
| 4 | ages | 4 | capacity | uint32 |
| 5 | alive | 4 | capacity | uint32 (0/1 only) |
| 6 | isDust | 4 | capacity | uint32 (0/1 only) |
| 7 | ids | 4 | capacity | uint32 |
| 8 | parent | 4 | capacity | int32 |

The 3-axis signal-field lattice (per `specs/ROOT.md §3`) is a separate
buffer sized `latticeResolution² × 3`. The field is recomputed every
tick after emitters deposit.

Total payload at 50k capacity: per-particle ~348 B × 50,000 ≈ 17 MB.
The field lattice is ≤ 384 KiB on its own.

## 4. Compute pipeline pass order

Per tick:

1. **Clear field.** `clearSignalField` shader — `[latticeResolution², 3]`.
2. **Deposit.** For every alive particle: sample current signal at its
   pre-step position; compute effective personality; compute emission;
   deposit into the lattice cells within `signalCutoff`. `[capacity]` ×
   `≤9 cells` workgroup — the inner loop walks the 3×3 cell neighborhood
   bounded by cutoff.
3. **Integrate.** For every alive particle: sample field at its
   position; compute gradient of Σ p' across the 6-neighborhood;
   update velocity, position; emit dust on motion (per `specs/ROOT.md
   §6`). `[capacity]`.
4. **Collision.** Spatial hash bucket pass: bucketize every particle
   into a 2D grid of cell size `2 × contactSeparation`. Per cell,
   compare the inner bucket and 8-neighborhood — O(N) average cost.
   Apply bounce and predation as in `specs/ROOT.md §7`.
5. **Fission.** Per the §8 rule. Free slots are recycled in place; the
   field is re-deposited next tick (intermediate values are not visible).

The deposit, integrate, collision, and fission shaders depend on the
field having been recursively re-deposited before any particle samples
the field — the field is recomputed once per tick and stale within a
tick, which matches the CPU reference.

## 5. Determinism

WebGPU floating-point ordering is implementation-defined. Per VISION
§Determinism, the GPU output matches the CPU reference **only on the
same machine + browser**. Headless CI cannot reproduce a frame bit-
exactly against a desktop GPU run; the regression suite asserts on
energy conservation, population count, and clustered-detection shape
only. Bit-identical SoA equality is the CPU reference's contract; its
mirror on GPU is implicit (same inputs, same machine) and not
testable across machines.

## 6. Render path

A separate render pipeline draws the lattice as a colored background
texture (per the existing Canvas2D `Renderer.drawFieldBackground`
shader semantics) and the alive particles as a `[capacity]` instanced
draw call. The renderer is not the spec's primary concern — the
compute pipeline is; the renderer just consumes its outputs.

## 7. Acceptance criteria

1. With `targetPopulation = 50_000` and `dt = 1/60`, `GpuEngine.stepOnce`
   completes in ≤ 33 ms wall-clock at the 95th percentile across a
   30-tick run on a typical desktop GPU. (VISION §Constraints.)
2. `GpuEngine.readState()` returns a `SimulationState` whose
   `state.storage.activeCount` matches the CPU reference's count at
   the same tick under the same seed.
3. Total energy (`Σ alive energy`, excluding dust) is conserved to the
   same tolerance as the CPU reference within WebGPU float noise. The
   consumption check (>= initial − 1e-4) and the predation check (equal
   predator + prey = initial) are the regression tests, both with the
   loose tolerance appropriate for a GPU implementation.
4. Cluster detection (`detectClusters`) over `readState()` produces
   clusters of shape compatible with the CPU reference on the same
   seed + steps. "Compatible" = same slot sets to within ±1 slot for
   each cluster.

## 8. Constraints

- The GPU surface is **not** a rewrite of `src/engine/core/`. The CPU
  reference remains canonical — every shader reads from the same gene
  layout, field layout, and step rules documented in `specs/ROOT.md`.
  A GPU implementation that disagrees with the CPU reference is a
  regression, not a refactor.
- No adaptive population scaling, no frame interpolation, no dynamic
  throttling (VISION §Constraints). The 50k bar is hit at full
  fidelity or it isn't.
- The single-file `.html` export (VISION §Core features #12) must work
  on the GPU pipeline — the export bundles the same WGSL strings the
  dev build compiles, no network fetches at runtime.
