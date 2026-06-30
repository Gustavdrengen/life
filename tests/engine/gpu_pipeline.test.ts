/**
 * GPU pipeline factory surface — pins the factory's contract so
 * the App shell can adopt a `GpuEngine` instance today and the
 * real WebGPU implementation can land behind the same surface.
 *
 * The spec (specs/gpu_pipeline.md §7) acceptance gate requires
 * the real WebGPU implementation to hit ≤ 33 ms / step at 50k
 * capacity. The current module is a CPU-backed stub that throws
 * on `stepOnce()`. These tests pin the stub's contract:
 *  - factory accepts a SimulationState + GPUDevice
 *  - factory throws on missing arguments
 *  - readState returns a fresh SimulationState with matching
 *    config
 *  - writeState enforces capacity matching
 *  - isGpu flag is false (CPU stub) — when the real WebGPU
 *    implementation lands, the test moves to assert true
 *  - destroy is a no-op and doesn't throw
 */
import { describe, expect, it } from 'vitest';
import {
  createGpuEngine,
  GpuEngineError,
  BYTES_PER_PARTICLE
} from '$engine/gpu/index.js';
import { DEFAULT_WORLD_CONFIG, createSimulationState } from '$engine/core/index.js';

/** A minimal `GPUDevice` stub. The real `GPUDevice` is a
 *  WebGPU-side interface — for the factory surface tests we
 *  only need an object that satisfies `typeof === 'object'`
 *  and is not null. */
function fakeDevice(): GPUDevice {
  return {} as unknown as GPUDevice;
}

describe('GpuEngine factory surface', () => {
  it('throws on missing state', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createGpuEngine(null as any, fakeDevice())
    ).toThrow(/state/);
  });

  it('throws on missing device', () => {
    const s = createSimulationState(8, { ...DEFAULT_WORLD_CONFIG });
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createGpuEngine(s, null as any)
    ).toThrow(/GPUDevice/);
  });

  it('returns a CPU-backed stub with isGpu = false', () => {
    const s = createSimulationState(8, { ...DEFAULT_WORLD_CONFIG });
    const engine = createGpuEngine(s, fakeDevice());
    expect(engine.isGpu).toBe(false);
  });

  it('stepOnce throws with a clear "not implemented" message', () => {
    const s = createSimulationState(8, { ...DEFAULT_WORLD_CONFIG });
    const engine = createGpuEngine(s, fakeDevice());
    expect(() => engine.stepOnce()).toThrow(/not yet implemented/);
  });

  it('readState returns a fresh SimulationState with matching config', () => {
    const s = createSimulationState(8, { ...DEFAULT_WORLD_CONFIG, seed: 0xc0de });
    const engine = createGpuEngine(s, fakeDevice());
    const r = engine.readState();
    expect(r.storage.capacity).toBe(8);
    expect(r.world.seed).toBe(0xc0de);
  });

  it('writeState enforces capacity matching', () => {
    const s = createSimulationState(8, { ...DEFAULT_WORLD_CONFIG });
    const engine = createGpuEngine(s, fakeDevice());
    const bigger = createSimulationState(64, { ...DEFAULT_WORLD_CONFIG });
    expect(() => engine.writeState(bigger)).toThrow(/capacity/);
  });

  it('beginRenderFrame / endRenderFrame / destroy are no-ops', () => {
    const s = createSimulationState(8, { ...DEFAULT_WORLD_CONFIG });
    const engine = createGpuEngine(s, fakeDevice());
    expect(() => {
      engine.beginRenderFrame();
      engine.endRenderFrame();
      engine.destroy();
    }).not.toThrow();
  });

  it('GpuEngineError is a typed error class', () => {
    const e = new GpuEngineError('test');
    expect(e.name).toBe('GpuEngineError');
    expect(e.message).toBe('test');
    expect(e).toBeInstanceOf(Error);
  });

  it('BYTES_PER_PARTICLE matches the spec\'s SoA layout', () => {
    // Per specs/gpu_pipeline.md §3 the SoA buffer is 348 bytes
    // per particle: 77*4 (genome) + 2*4 (pos) + 2*4 (vel) +
    // 4 (energy) + 4 (age) + 4 (alive) + 4 (isDust) + 4 (id) +
    // 4 (parent) = 308 + 8 + 8 + 4 + 4 + 4 + 4 + 4 + 4 = 348.
    // This matches the per-particle payload noted in
    // src/engine/core/particles.ts (~348 bytes including
    // position/vel/age/energy runtime state). Pin the constant
    // so the layout doesn't drift silently if the spec is
    // updated.
    expect(BYTES_PER_PARTICLE).toBe(348);
  });
});
