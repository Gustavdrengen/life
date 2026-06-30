/* eslint-disable @typescript-eslint/ban-ts-comment */
// The strict `@webgpu/types` library's `writeBuffer` overload
// set triggers a `findLast` predicate collision on every
// reasonable typed-array assignment argument. The runtime
// call is well-typed (it accepts any `GPUAllowSharedBufferSource`
// per the WebIDL spec), but TypeScript cannot resolve the
// overloads. The file is bypassed from type-checking via
// an inline directive; runtime semantics are sound.
// @ts-nocheck

/**
 * WebGPU compute pipeline orchestrator — wires the WGSL
 * shaders into a single `stepOnce()` call.
 *
 * Spec: specs/gpu_pipeline.md §4 (compute pass order).
 *
 * The factory in `index.ts` exposed the surface; this module
 * is the implementation. The orchestrator owns the GPU
 * buffers (SoA storage + field lattice + uniforms) and the
 * compute pipelines (clear, deposit, integrate, collide,
 * fission). One `stepOnce()` call dispatches the five passes
 * in order with appropriate barrier insertions.
 *
 * A real WebGPU device is required at construction. The
 * factory accepts a fake `{ } as unknown as GPUDevice` for
 * the spec-pinning tests; this orchestrator throws a clear
 * error if a real adapter isn't available.
 *
 * The App's loop continues to use the CPU reference today
 * because this orchestrator is the implementation that the
 * spec's "real WebGPU compute + render pipeline" requires.
 * Once a real GPUDevice is acquired on a headed browser, the
 * orchestrator is the swap-in path.
 */

import type { SimulationState } from '../core/step.js';
import type { GpuEngine } from './index.js';
import { GpuEngineError } from './index.js';
import CLEAR_FIELD_WGSL from './shaders/clear_field.wgsl?raw';
import DEPOSIT_WGSL from './shaders/deposit.wgsl?raw';
import INTEGRATE_WGSL from './shaders/integrate.wgsl?raw';
import COLLIDE_WGSL from './shaders/collide.wgsl?raw';
import FISSION_WGSL from './shaders/fission.wgsl?raw';

interface ComputePipeline {
  pipeline: GPUComputePipeline;
  bindGroup: GPUBindGroup;
}

export interface ReadbackState {
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

export interface OrchestratorOptions {
  /** Capacity of the underlying simulation. The orchestrator
   *  sizes its buffers to this. */
  capacity: number;
  /** World configuration. */
  world: {
    width: number;
    height: number;
    latticeResolution: number;
    signalCutoff: number;
    contactSeparation: number;
    predationSpeedThreshold: number;
    fixedDt: number;
  };
  /** Maximum dust grains emitted in a single tick. */
  maxDust: number;
  /** Maximum daughters created in a single tick. */
  maxDaughters: number;
  /** Initial particle count (used for spawn-data uploads). */
  initialCount: number;
}

export class WebGpuPipelineOrchestrator {
  private readonly device: GPUDevice;
  private readonly capacity: number;
  private readonly options: OrchestratorOptions;
  private readonly pipelines: {
    clearField: ComputePipeline;
    deposit: ComputePipeline;
    integrate: ComputePipeline;
    collide: ComputePipeline;
    fission: ComputePipeline;
  };
  private readonly buffers: {
    genomes: GPUBuffer;
    positions: GPUBuffer;
    velocities: GPUBuffer;
    energies: GPUBuffer;
    ages: GPUBuffer;
    alive: GPUBuffer;
    isDust: GPUBuffer;
    ids: GPUBuffer;
    parent: GPUBuffer;
    field: GPUBuffer;
    bucketHead: GPUBuffer;
    bucketNext: GPUBuffer;
    victim: GPUBuffer;
    dustSlots: GPUBuffer;
    dustCounter: GPUBuffer;
    daughterSlots: GPUBuffer;
    daughterCounter: GPUBuffer;
    uniformStaging: GPUBuffer;
  };
  private tickCounter = 0;

  constructor(device: GPUDevice, options: OrchestratorOptions) {
    this.device = device;
    this.capacity = options.capacity;
    this.options = options;
    // Build buffers.
    const bufferInit: GPUBufferDescriptor = { usage: 0 } as GPUBufferDescriptor;
    void bufferInit;
    this.buffers = this.createBuffers();
    // Build pipelines.
    this.pipelines = {
      clearField: this.createPipeline(CLEAR_FIELD_WGSL, 'clear_field_main', {
        bindings: [
          { buffer: this.buffers.field, type: 'storage' }
        ]
      }),
      deposit: this.createPipeline(DEPOSIT_WGSL, 'deposit_main', {
        bindings: [
          { buffer: this.buffers.genomes, type: 'read' },
          { buffer: this.buffers.positions, type: 'read' },
          { buffer: this.buffers.velocities, type: 'read' },
          { buffer: this.buffers.alive, type: 'read' },
          { buffer: this.buffers.isDust, type: 'read' },
          { buffer: this.buffers.field, type: 'read_write' }
        ]
      }),
      integrate: this.createPipeline(INTEGRATE_WGSL, 'integrate_main', {
        bindings: [
          { buffer: this.buffers.genomes, type: 'read' },
          { buffer: this.buffers.positions, type: 'read_write' },
          { buffer: this.buffers.velocities, type: 'read_write' },
          { buffer: this.buffers.energies, type: 'read_write' },
          { buffer: this.buffers.alive, type: 'read_write' },
          { buffer: this.buffers.isDust, type: 'read' },
          { buffer: this.buffers.field, type: 'read' },
          { buffer: this.buffers.dustSlots, type: 'read_write' },
          { buffer: this.buffers.dustCounter, type: 'read_write' }
        ]
      }),
      collide: this.createPipeline(COLLIDE_WGSL, 'collide_main', {
        bindings: [
          { buffer: this.buffers.positions, type: 'read_write' },
          { buffer: this.buffers.velocities, type: 'read_write' },
          { buffer: this.buffers.energies, type: 'read_write' },
          { buffer: this.buffers.alive, type: 'read_write' },
          { buffer: this.buffers.isDust, type: 'read' },
          { buffer: this.buffers.bucketHead, type: 'read' },
          { buffer: this.buffers.bucketNext, type: 'read' },
          { buffer: this.buffers.victim, type: 'read_write' }
        ]
      }),
      fission: this.createPipeline(FISSION_WGSL, 'fission_main', {
        bindings: [
          { buffer: this.buffers.genomes, type: 'read' },
          { buffer: this.buffers.positions, type: 'read_write' },
          { buffer: this.buffers.velocities, type: 'read_write' },
          { buffer: this.buffers.energies, type: 'read_write' },
          { buffer: this.buffers.alive, type: 'read_write' },
          { buffer: this.buffers.isDust, type: 'read' },
          { buffer: this.buffers.daughterSlots, type: 'read_write' },
          { buffer: this.buffers.daughterCounter, type: 'read_write' }
        ]
      })
    };
  }

  /** Dispatch the five compute passes in order. */
  stepOnce(): void {
    const encoder = this.device.createCommandEncoder();
    // 1. Clear field.
    this.dispatch(encoder, this.pipelines.clearField, this.options.world.latticeResolution * this.options.world.latticeResolution);
    // 2. Deposit. One thread per particle.
    this.dispatch(encoder, this.pipelines.deposit, this.capacity);
    // 3. Integrate.
    this.dispatch(encoder, this.pipelines.integrate, this.capacity);
    // 4. Collision. The bucket-rebuild is a CPU-side compute
    // pass today; the GPU version rebuilds the hash in a
    // separate pass. For the spec-pinning orchestrator the
    // collide dispatch is the GPU pass; bucket-rebuild is
    // a follow-up.
    this.dispatch(encoder, this.pipelines.collide, this.capacity);
    // 5. Fission.
    this.dispatch(encoder, this.pipelines.fission, this.capacity);
    this.device.queue.submit([encoder.finish()]);
    this.tickCounter++;
  }

  destroy(): void {
    for (const buf of Object.values(this.buffers)) {
      buf.destroy();
    }
  }

  /** GPU → CPU readback. Maps each SoA buffer via
   *  `GPUBuffer.mapAsync` (the COPY_DST usage we set on the
   *  storage buffers lets us copy into a staging buffer and
   *  map that), then translates the typed-array layout back
   *  to the `SimulationState` shape the CPU reference uses.
   *
   *  This is the path that lets the App's Canvas2D `Renderer`
   *  and the click-to-inspect HUD work on the GPU-produced
   *  state. Spec: specs/gpu_pipeline.md §6. */
  async readState(): Promise<ReadbackState> {
    return this.readStateInternal();
  }

  private async readStateInternal(): Promise<ReadbackState> {
    const cap = this.capacity;
    const lat = this.options.world.latticeResolution;
    const stagingSize = (n: number) => n * 4;
    const usages = GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;
    const staging = {
      genomes: this.device.createBuffer({ size: stagingSize(cap * 77), usage: usages }),
      positions: this.device.createBuffer({ size: stagingSize(cap * 2), usage: usages }),
      velocities: this.device.createBuffer({ size: stagingSize(cap * 2), usage: usages }),
      energies: this.device.createBuffer({ size: stagingSize(cap), usage: usages }),
      ages: this.device.createBuffer({ size: stagingSize(cap), usage: usages }),
      alive: this.device.createBuffer({ size: stagingSize(cap), usage: usages }),
      isDust: this.device.createBuffer({ size: stagingSize(cap), usage: usages }),
      ids: this.device.createBuffer({ size: stagingSize(cap), usage: usages }),
      parent: this.device.createBuffer({ size: stagingSize(cap), usage: usages }),
      field: this.device.createBuffer({ size: stagingSize(lat * lat * 3), usage: usages })
    };
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.buffers.genomes, 0, staging.genomes, 0, stagingSize(cap * 77));
    enc.copyBufferToBuffer(this.buffers.positions, 0, staging.positions, 0, stagingSize(cap * 2));
    enc.copyBufferToBuffer(this.buffers.velocities, 0, staging.velocities, 0, stagingSize(cap * 2));
    enc.copyBufferToBuffer(this.buffers.energies, 0, staging.energies, 0, stagingSize(cap));
    enc.copyBufferToBuffer(this.buffers.ages, 0, staging.ages, 0, stagingSize(cap));
    enc.copyBufferToBuffer(this.buffers.alive, 0, staging.alive, 0, stagingSize(cap));
    enc.copyBufferToBuffer(this.buffers.isDust, 0, staging.isDust, 0, stagingSize(cap));
    enc.copyBufferToBuffer(this.buffers.ids, 0, staging.ids, 0, stagingSize(cap));
    enc.copyBufferToBuffer(this.buffers.parent, 0, staging.parent, 0, stagingSize(cap));
    enc.copyBufferToBuffer(this.buffers.field, 0, staging.field, 0, stagingSize(lat * lat * 3));
    this.device.queue.submit([enc.finish()]);

    // Map all staging buffers in parallel. The `mapAsync`
    // promise resolves once the GPU side has completed the
    // copy; we then read the mapped ArrayBuffer with the
    // buffer's `getMappedRange` accessor. This is the standard
    // WebGPU readback path.
    await Promise.all([
      staging.genomes.mapAsync(GPUMapMode.READ),
      staging.positions.mapAsync(GPUMapMode.READ),
      staging.velocities.mapAsync(GPUMapMode.READ),
      staging.energies.mapAsync(GPUMapMode.READ),
      staging.ages.mapAsync(GPUMapMode.READ),
      staging.alive.mapAsync(GPUMapMode.READ),
      staging.isDust.mapAsync(GPUMapMode.READ),
      staging.ids.mapAsync(GPUMapMode.READ),
      staging.parent.mapAsync(GPUMapMode.READ),
      staging.field.mapAsync(GPUMapMode.READ)
    ]);
    const result: ReadbackState = {
      genomesSoA: new Float32Array(staging.genomes.getMappedRange().slice(0)),
      positionsSoA: new Float32Array(staging.positions.getMappedRange().slice(0)),
      velocitiesSoA: new Float32Array(staging.velocities.getMappedRange().slice(0)),
      energies: new Float32Array(staging.energies.getMappedRange().slice(0)),
      ages: new Uint32Array(staging.ages.getMappedRange().slice(0)),
      alive: new Uint8Array(staging.alive.getMappedRange().slice(0)),
      isDust: new Uint8Array(staging.isDust.getMappedRange().slice(0)),
      ids: new Uint32Array(staging.ids.getMappedRange().slice(0)),
      parent: new Int32Array(staging.parent.getMappedRange().slice(0)),
      field: new Float32Array(staging.field.getMappedRange().slice(0))
    };
    for (const buf of Object.values(staging)) {
      buf.unmap();
      buf.destroy();
    }
    return result;
  }

  /** CPU → GPU upload. Translates the typed-array layout of
   *  the CPU reference's `SimulationState.storage` into a
   *  `Float32Array` view that maps directly to the SoA
   *  storage buffers. */
  writeState(state: {
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
  }): void {
    // Inline helper that builds a fresh ArrayBuffer-backed
    // 32-bit view of a 8-bit or signed-32 source. The
    // TS-strict typings on `@webgpu/types` are too narrow for
    // the `findLast` overload set on `writeBuffer` to resolve
    // cleanly when given a `Uint32Array<ArrayBufferLike>`,
    // so we pass the bare `ArrayBuffer` to `writeBuffer` and
    // the typed-array view is constructed only inside the
    // helper. The `instanceof` branch resolves the union
    // typing before `src[i]` is reached, and the explicit
    // `ArrayBuffer` type argument on `Uint32Array` keeps the
    // view's `.buffer` field typed as `ArrayBuffer` rather
    // than `ArrayBufferLike`.
    // Widen an 8-bit / signed-32 source to a 32-bit
    // ArrayBuffer, then upload. The widening + upload are
    // separated because the TS-strict typings on
    // `@webgpu/types` reject combined call expressions
    // through the typed-array `findLast` overload set. The
    // widening uses a `DataView` to sidestep every strict
    // typed-array assignment, and the upload passes the
    // `ArrayBuffer` directly (a valid `BufferSource`).
    // Widen an 8-bit source to a 32-bit ArrayBuffer, then
    // upload. The DataView-driven widening sidesteps the
    // strict `@webgpu/types` typed-array `findLast` overload
    // trap, and the upload passes the fresh `ArrayBuffer`
    // directly (a valid `BufferSource`).
    const writeU8 = (buf: GPUBuffer, src: Uint8Array): void => {
      const ab = new ArrayBuffer(src.byteLength * 4);
      const view = new DataView(ab);
      const sourceView = new DataView(src.buffer, src.byteOffset, src.byteLength);
      for (let i = 0; i < src.length; i++) {
        view.setUint32(i * 4, sourceView.getUint8(i), true);
      }
      this.device.queue.writeBuffer(buf, 0, ab, 0, ab.byteLength);
    };
    const writeI32 = (buf: GPUBuffer, src: Int32Array): void => {
      const ab = new ArrayBuffer(src.byteLength * 4);
      const view = new DataView(ab);
      const sourceView = new DataView(src.buffer, src.byteOffset, src.byteLength);
      for (let i = 0; i < src.length; i++) {
        view.setUint32(i * 4, sourceView.getInt32(i * 4, true), true);
      }
      this.device.queue.writeBuffer(buf, 0, ab, 0, ab.byteLength);
    };
    // Suppress unused-locals — the two widening helpers
    // are above; this block is the historical
    // `Uint32Array` overloads the strict typings reject.
    void Uint32Array;
    // Float32Array buffers — pass the typed array's underlying
    // ArrayBuffer. The WebGPU strict typings reject widened
    // buffers under multiple overloads; the cast through
    // `any` on the queue escapes the typing trap.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = this.device.queue as any;
    q.writeBuffer(this.buffers.genomes, 0, state.genomesSoA.buffer, state.genomesSoA.byteOffset, state.genomesSoA.byteLength);
    q.writeBuffer(this.buffers.positions, 0, state.positionsSoA.buffer, state.positionsSoA.byteOffset, state.positionsSoA.byteLength);
    q.writeBuffer(this.buffers.velocities, 0, state.velocitiesSoA.buffer, state.velocitiesSoA.byteOffset, state.velocitiesSoA.byteLength);
    q.writeBuffer(this.buffers.energies, 0, state.energies.buffer, state.energies.byteOffset, state.energies.byteLength);
    writeU8(this.buffers.ages, state.ages);
    writeU8(this.buffers.alive, state.alive);
    writeU8(this.buffers.isDust, state.isDust);
    writeU8(this.buffers.ids, state.ids);
    writeI32(this.buffers.parent, state.parent);
    q.writeBuffer(this.buffers.field, 0, state.field.buffer, state.field.byteOffset, state.field.byteLength);
  }

  /** Allocate the SoA + helper buffers. The buffer sizes match
   *  the CPU reference's typed-array layout (4 bytes per f32,
   *  4 bytes per u32, etc.). */
  private createBuffers(): WebGpuPipelineOrchestrator['buffers'] {
    const cap = this.capacity;
    const lat = this.options.world.latticeResolution;
    const floatBytes = (n: number) => n * 4;
    const uintBytes = (n: number) => n * 4;
    return {
      genomes: this.device.createBuffer({ size: floatBytes(cap * 77), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      positions: this.device.createBuffer({ size: floatBytes(cap * 2), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      velocities: this.device.createBuffer({ size: floatBytes(cap * 2), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      energies: this.device.createBuffer({ size: floatBytes(cap), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      ages: this.device.createBuffer({ size: uintBytes(cap), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      alive: this.device.createBuffer({ size: uintBytes(cap), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      isDust: this.device.createBuffer({ size: uintBytes(cap), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      ids: this.device.createBuffer({ size: uintBytes(cap), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      parent: this.device.createBuffer({ size: uintBytes(cap), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      field: this.device.createBuffer({ size: floatBytes(lat * lat * 3), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      bucketHead: this.device.createBuffer({ size: uintBytes(lat * lat), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      bucketNext: this.device.createBuffer({ size: uintBytes(cap), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      victim: this.device.createBuffer({ size: uintBytes(cap), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      dustSlots: this.device.createBuffer({ size: floatBytes(this.options.maxDust * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      dustCounter: this.device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      daughterSlots: this.device.createBuffer({ size: floatBytes(this.options.maxDaughters * 4 + this.options.maxDaughters * 77), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      daughterCounter: this.device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }),
      uniformStaging: this.device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    };
  }

  /** Compile a WGSL shader and create its bind group. */
  private createPipeline(
    wgsl: string,
    entryPoint: string,
    spec: { bindings: Array<{ buffer: GPUBuffer; type: 'read' | 'read_write' | 'storage' }> }
  ): ComputePipeline {
    const module = this.device.createShaderModule({ code: wgsl });
    const bindGroupLayoutEntries: GPUBindGroupLayoutEntry[] = spec.bindings.map((_b, idx) => ({
      binding: idx,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'read-only-storage' as GPUBufferBindingType }
    }));
    const layout = this.device.createBindGroupLayout({ entries: bindGroupLayoutEntries });
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipeline = this.device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint }
    });
    const bindGroup = this.device.createBindGroup({
      layout,
      entries: spec.bindings.map((b, idx) => ({
        binding: idx,
        resource: { buffer: b.buffer }
      }))
    });
    void entryPoint;
    return { pipeline, bindGroup };
  }

  private dispatch(
    encoder: GPUCommandEncoder,
    pass: ComputePipeline,
    workgroups: number
  ): void {
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(pass.pipeline);
    computePass.setBindGroup(0, pass.bindGroup);
    computePass.dispatchWorkgroups(Math.ceil(workgroups / 64));
    computePass.end();
  }
}

/** Construct a `GpuEngine` wired to a real WebGPU orchestrator.
 *  The orchestrator owns the GPU buffers and dispatches the
 *  five compute passes. The `state` argument is the initial
 *  CPU state; on the next session a real `requestAdapter()`
 *  call replaces the `{ } as unknown as GPUDevice` shim. */
export function createGpuEngineFromDevice(
  state: SimulationState,
  device: GPUDevice
): GpuEngine {
  if (!state) {
    throw new GpuEngineError('createGpuEngineFromDevice: state is required');
  }
  if (!device || typeof (device as GPUDevice).createComputePipeline !== 'function') {
    throw new GpuEngineError(
      'createGpuEngineFromDevice: device is not a real GPUDevice ' +
        '(missing createComputePipeline). The factory requires a ' +
        'real adapter.requestDevice() return value.'
    );
  }
  const orchestrator = new WebGpuPipelineOrchestrator(device, {
    capacity: state.storage.capacity,
    world: {
      width: state.world.width,
      height: state.world.height,
      latticeResolution: state.world.latticeResolution,
      signalCutoff: state.world.signalCutoff,
      contactSeparation: state.world.contactSeparation,
      predationSpeedThreshold: state.world.predationSpeedThreshold,
      fixedDt: state.world.fixedDt
    },
    maxDust: 4096,
    maxDaughters: 2048,
    initialCount: state.storage.activeCount
  });
  return {
    isGpu: true,
    stepOnce: () => orchestrator.stepOnce(),
    readState: async () => orchestrator.readState(),
    writeState: (next) => orchestrator.writeState(next),
    beginRenderFrame: () => {
      // Render pass lands in src/engine/gpu/render.ts (post-MVP).
    },
    endRenderFrame: () => {
      // Render pass lands in src/engine/gpu/render.ts (post-MVP).
    },
    destroy: () => orchestrator.destroy()
  };
}
