/**
 * WGSL clear_field shader — WGSL string presence + structural
 * pin.
 *
 * The shader is the smallest piece of real WebGPU work per
 * `specs/gpu_pipeline.md §4.1`. We don't have a headless WebGPU
 * adapter in the Vitest sandbox, so this test pins the *string
 * surface* of the shader — the WGSL must contain the bindings
 * and entry point the GPU pipeline calls. A real headed-browser
 * smoke test (post-MVP) runs the shader against a GPUDevice and
 * asserts on buffer contents.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(here, '..', '..');
const SHADER_PATH = resolve(
  projectRoot,
  'src',
  'engine',
  'gpu',
  'shaders',
  'clear_field.wgsl'
);

describe('WGSL clear_field shader', () => {
  it('exists at the expected path', () => {
    expect(() => readFileSync(SHADER_PATH, 'utf8')).not.toThrow();
  });

  it('declares the field storage buffer at @binding(0)', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The clear shader writes to a single field buffer — the
    // binding slot is 0 because subsequent shaders (deposit,
    // integrate) read from the same slot. Pin the binding index
    // so the buffer layout doesn't drift silently.
    expect(src).toMatch(/@group\(0\)\s+@binding\(0\)\s+var<storage,\s*read_write>\s+field/);
  });

  it('declares a uniform params struct with cellCount + components', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The uniform carries the lattice shape so the shader can
    // skip threads past cellCount. Pin the field names so the
    // TypeScript side that uploads uniforms doesn't drift.
    expect(src).toMatch(/struct\s+ClearParams/);
    expect(src).toMatch(/cellCount:\s*u32/);
    expect(src).toMatch(/components:\s*u32/);
  });

  it('exposes a compute entry point with @workgroup_size(64)', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // Workgroup size 64 covers two columns of a 32-cell lattice
    // in a single workgroup — a common particle-life GPU
    // convention. The size also has to be a power of two to
    // match GPU hardware's preferred workgroup shape.
    expect(src).toMatch(/@compute\s+@workgroup_size\(64\)/);
  });

  it('clears all 3 components per cell', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The lattice holds 3 components per cell (sx, sy, sz). The
    // shader must write 0.0 to all three offsets. The exact
    // arithmetic is `base + 0u/1u/2u`.
    expect(src).toMatch(/field\[base \+ 0u\]\s*=\s*0\.0/);
    expect(src).toMatch(/field\[base \+ 1u\]\s*=\s*0\.0/);
    expect(src).toMatch(/field\[base \+ 2u\]\s*=\s*0\.0/);
  });

  it('bails early when global_invocation_id.x >= cellCount', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // Threads past the lattice size must not write — a stray
    // thread would corrupt the buffer. The early-return guard
    // is the standard WGSL pattern for this.
    expect(src).toMatch(/if\s*\(\s*i\s*>=\s*cellCount\s*\)/);
  });
});
