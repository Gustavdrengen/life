/**
 * WebGPU compute + render pipeline (VISION §Core features #1).
 *
 * Spec: specs/gpu_pipeline.md.
 *
 * This file is the *factory surface* — a typed drop-in for the
 * CPU reference's `stepOnce` path. Shaders and buffer upload
 * logic land in subsequent commits as the build target sharpens.
 *
 * The factory accepts a `SimulationState` from the CPU reference
 * and a `GPUDevice`, and returns a `GpuEngine` with the same
 * step/IO surface. The CPU state remains the spec-authoritative
 * source for "what the per-tick state transition is"; the GPU
 * surface is a separate implementation of the same transition
 * (per VISION §Determinism, GPU is bit-stable only on the same
 * machine + browser).
 *
 * The first cut of this module is a CPU-backed stub that throws
 * "GPU pipeline not yet implemented" on `stepOnce()`. The
 * factory's other surface — `readState`, `writeState`,
 * `beginRenderFrame`, `endRenderFrame`, `destroy` — is wired
 * so the App shell can hold a `GpuEngine` instance today and
 * adopt real WebGPU buffers as the shader implementations land.
 *
 * Acceptance gate (per spec §7): a real WebGPU device at
 * targetPopulation = 50,000 must complete `stepOnce` in ≤ 33 ms
 * at the 95th percentile. The CPU reference can't hit that — the
 * GPU implementation is required for the VISION §Constraints
 * performance target.
 */

import type { SimulationState } from '../core/step.js';
import { GENOME_LENGTH } from '../core/genome.js';

export interface GpuReadback {
  genomesSoA: Float32Array;
  positionsSoA: Float32Array;
  velocitiesSoA: Float32Array;
  energies: Float32Array;
  ages: Uint32Array;
  alive: Uint8Array;
  isDust: Uint8Array;
  ids: Uint32Array;
  parent: Int32Array;
  field: Float32Array;
}

export interface GpuEngine {
  /** Push one fixed-Dt tick. Mutates all internal GPU buffers. */
  stepOnce(): void;
  /** Snapshot the SoA buffers to typed arrays in CPU memory.
   *  Returns a fresh readback; the App's CPU-side Renderer
   *  and Inspector read from this. */
  readState(): Promise<GpuReadback>;
  /** Re-upload an externally-prepared state (snapshot load path). */
  writeState(state: GpuReadback): void;
  /** Hint the scheduler before/after a render frame. */
  beginRenderFrame(): void;
  endRenderFrame(): void;
  /** Free all GPU resources. */
  destroy(): void;
  /** Whether the underlying implementation is the WebGPU path
   *  (true) or the CPU reference stub (false). The App shell
   *  uses this to choose between CPU and GPU render options. */
  readonly isGpu: boolean;
}

/** Errors raised by the GPU surface. */
export class GpuEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GpuEngineError';
  }
}

/** The number of bytes per particle in the SoA storage buffer
 *  (per specs/gpu_pipeline.md §3). The GPU buffer is sized
 *  `capacity * BYTES_PER_PARTICLE` + 3 × latticeResolution² for
 *  the signal field. */
export const BYTES_PER_PARTICLE =
  GENOME_LENGTH * 4 + // genome (Float32)
  2 * 4 + // positions (Float32 x 2)
  2 * 4 + // velocities (Float32 x 2)
  4 + // energies (Float32)
  4 + // ages (Uint32)
  4 + // alive (Uint32)
  4 + // isDust (Uint32)
  4 + // ids (Uint32)
  4; // parent (Int32) = 320 bytes total

/**
 * The MVP factory — returns a CPU-backed stub that throws on
 * `stepOnce()`. The real WebGPU implementation is the next
 * multi-session build target.
 *
 * Throws if `state` is null/undefined or if `device` is not
 * a real GPUDevice. The factory is intentionally cheap: the
 * real work is in `writeState` once a buffer-backed
 * implementation lands.
 */
export function createGpuEngine(
  state: SimulationState,
  device: GPUDevice
): GpuEngine {
  if (!state) {
    throw new GpuEngineError('createGpuEngine: state is required');
  }
  if (!device) {
    throw new GpuEngineError('createGpuEngine: GPUDevice is required');
  }
  // Capture the original state's RNG seed for readState()
  // rehydration. The GPU implementation would rehydrate from its
  // own buffers; the stub returns a fresh SimulationState to keep
  // the App shell's readState path functional.
  const seedSnapshot = state.rng.snapshot();
  void seedSnapshot;
  return {
    isGpu: false,
    stepOnce(): void {
      throw new GpuEngineError(
        'GpuEngine.stepOnce: WebGPU compute pipeline not yet implemented. ' +
          'See specs/gpu_pipeline.md §7 for the acceptance gate; the ' +
          'CPU reference in src/engine/core/ is the spec-authoritative ' +
          'source for per-tick state transitions in the meantime.'
      );
    },
    async readState(): Promise<GpuReadback> {
      // CPU-backed stub returns an empty readback matching the
      // input's capacity + world shape. The real GPU path
      // rehydrates from its own GPU buffers.
      const cap = state.storage.capacity;
      const lat = state.world.latticeResolution;
      return {
        genomesSoA: new Float32Array(cap * 77),
        positionsSoA: new Float32Array(cap * 2),
        velocitiesSoA: new Float32Array(cap * 2),
        energies: new Float32Array(cap),
        ages: new Uint32Array(cap),
        alive: new Uint8Array(cap),
        isDust: new Uint8Array(cap),
        ids: new Uint32Array(cap),
        parent: new Int32Array(cap),
        field: new Float32Array(lat * lat * 3)
      };
    },
    writeState(next: GpuReadback): void {
      if (next.genomesSoA.length / 77 !== state.storage.capacity) {
        throw new GpuEngineError(
          `GpuEngine.writeState: capacity mismatch ` +
            `(${state.storage.capacity} vs ${next.genomesSoA.length / 77})`
        );
      }
      // CPU-backed stub accepts the state but does nothing with
      // it. The real GPU path uploads `next.storage` to the GPU
      // buffer via `queue.writeBuffer`.
      void next;
    },
    beginRenderFrame(): void {
      // No-op in the stub.
    },
    endRenderFrame(): void {
      // No-op in the stub.
    },
    destroy(): void {
      // No resources to release in the stub.
    }
  };
}

// The seed is captured for documentation purposes only — the
// stub doesn't preserve state across calls. The real GPU
// implementation will manage its own state through the buffer
// surface. Kept at module scope (declared as a local in
// `createGpuEngine`) so the parameter is consumed and the linter
// doesn't trip on an unused variable in a future refactor.
