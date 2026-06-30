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
    readState: () => {
      throw new GpuEngineError(
        'readState: GPU → CPU state readback not yet implemented ' +
          '(requires GPUBuffer mapping; post-MVP per specs/gpu_pipeline.md §6).'
      );
    },
    writeState: () => {
      throw new GpuEngineError(
        'writeState: CPU → GPU state upload not yet implemented ' +
          '(requires queue.writeBuffer for each SoA region; post-MVP).'
      );
    },
    beginRenderFrame: () => {
      // Render pass lands in src/engine/gpu/render.ts (post-MVP).
    },
    endRenderFrame: () => {
      // Render pass lands in src/engine/gpu/render.ts (post-MVP).
    },
    destroy: () => orchestrator.destroy()
  };
}
