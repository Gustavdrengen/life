/**
 * WebGPU pipeline orchestrator — string surface + factory
 * contract.
 *
 * The orchestrator (`src/engine/gpu/pipeline.ts`) wires the
 * five WGSL compute passes into a single `stepOnce()` call.
 * The module is the implementation that the spec's "real
 * WebGPU compute + render pipeline" promises; today the App
 * continues to use the CPU reference because real WebGPU
 * devices aren't available in the Vitest sandbox.
 *
 * These tests pin the orchestrator's *surface* without
 * running a real GPUDevice — the same WGSL-string and
 * factory contract tests as the per-shader files, but
 * consolidated into one place.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'url';
import {
  GpuEngineError,
  createGpuEngine
} from '$engine/gpu/index.js';
import { DEFAULT_WORLD_CONFIG, createSimulationState } from '$engine/core/index.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(here, '..', '..');
const SHADER_DIR = resolve(projectRoot, 'src', 'engine', 'gpu', 'shaders');
const ORCHESTRATOR = resolve(projectRoot, 'src', 'engine', 'gpu', 'pipeline.ts');

describe('WebGPU pipeline orchestrator', () => {
  it('orchestrator module exists at the expected path', () => {
    expect(existsSync(ORCHESTRATOR)).toBe(true);
  });

  it('all 5 WGSL shader files exist', () => {
    const expected = ['clear_field.wgsl', 'deposit.wgsl', 'integrate.wgsl', 'collide.wgsl', 'fission.wgsl'];
    for (const f of expected) {
      expect(existsSync(resolve(SHADER_DIR, f))).toBe(true);
    }
  });

  it('orchestrator imports all 5 shaders as ?raw Vite assets', () => {
    const src = readFileSync(ORCHESTRATOR, 'utf8');
    expect(src).toMatch(/import\s+CLEAR_FIELD_WGSL\s+from\s+['"].\/shaders\/clear_field\.wgsl\?raw['"]/);
    expect(src).toMatch(/import\s+DEPOSIT_WGSL\s+from\s+['"].\/shaders\/deposit\.wgsl\?raw['"]/);
    expect(src).toMatch(/import\s+INTEGRATE_WGSL\s+from\s+['"].\/shaders\/integrate\.wgsl\?raw['"]/);
    expect(src).toMatch(/import\s+COLLIDE_WGSL\s+from\s+['"].\/shaders\/collide\.wgsl\?raw['"]/);
    expect(src).toMatch(/import\s+FISSION_WGSL\s+from\s+['"].\/shaders\/fission\.wgsl\?raw['"]/);
  });

  it('stepOnce dispatches all 5 compute passes in order', () => {
    const src = readFileSync(ORCHESTRATOR, 'utf8');
    // The orchestrator's `stepOnce` method should dispatch
    // the five passes in spec order. Pin the call order so a
    // refactor doesn't silently reorder the passes.
    const clearIdx = src.indexOf('this.pipelines.clearField');
    const depositIdx = src.indexOf('this.pipelines.deposit');
    const integrateIdx = src.indexOf('this.pipelines.integrate');
    const collideIdx = src.indexOf('this.pipelines.collide');
    const fissionIdx = src.indexOf('this.pipelines.fission');
    expect(clearIdx).toBeGreaterThan(0);
    expect(depositIdx).toBeGreaterThan(clearIdx);
    expect(integrateIdx).toBeGreaterThan(depositIdx);
    expect(collideIdx).toBeGreaterThan(integrateIdx);
    expect(fissionIdx).toBeGreaterThan(collideIdx);
  });

  it('factory throws on missing state', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createGpuEngine(null as any, {} as GPUDevice)
    ).toThrow(/state/);
  });

  it('factory stub still throws "not yet implemented" on stepOnce', () => {
    // The factory in src/engine/gpu/index.ts returns a CPU
    // stub whose stepOnce throws. The real implementation
    // lives in pipeline.ts (createGpuEngineFromDevice). The
    // App shell wires the factory, not createGpuEngineFromDevice,
    // so the spec is the CPU stub for now.
    const s = createSimulationState(8, { ...DEFAULT_WORLD_CONFIG });
    const engine = createGpuEngine(s, {} as GPUDevice);
    expect(() => engine.stepOnce()).toThrow(/not yet implemented/);
    expect(engine.isGpu).toBe(false);
  });

  it('GpuEngineError is a typed error class', () => {
    const e = new GpuEngineError('test');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('GpuEngineError');
  });
});
