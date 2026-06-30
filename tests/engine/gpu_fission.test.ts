/**
 * WGSL fission shader — string surface pin.
 *
 * Spec: specs/gpu_pipeline.md §4.5 (fission pass).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'url';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(here, '..', '..');
const SHADER_PATH = resolve(
  projectRoot,
  'src',
  'engine',
  'gpu',
  'shaders',
  'fission.wgsl'
);

describe('WGSL fission shader', () => {
  it('exists at the expected path', () => {
    expect(() => readFileSync(SHADER_PATH, 'utf8')).not.toThrow();
  });

  it('declares a DaughterSlot struct with a 77-slot genome array', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The fission pass writes daughter metadata + full genome
    // row. The genome length must match GENOME_LENGTH in
    // src/engine/core/genome.ts.
    expect(src).toMatch(/struct\s+DaughterSlot/);
    expect(src).toMatch(/genome:\s*array<f32,\s*77>/);
  });

  it('declares an atomic daughter counter', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The fission pass atomically reserves two daughter slots
    // per fission event so multiple workgroups don't collide.
    expect(src).toMatch(/@group\(0\)\s+@binding\(7\)\s+var<storage,\s*read_write>\s+daughterCounter/);
    expect(src).toMatch(/atomicAdd\s*\(\s*&daughterCounter/);
  });

  it('declares a FissionParams uniform with fixedDt + maxDaughters + tick', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    expect(src).toMatch(/struct\s+FissionParams/);
    expect(src).toMatch(/fixedDt:\s*f32/);
    expect(src).toMatch(/maxDaughters:\s*u32/);
    expect(src).toMatch(/tick:\s*u32/);
  });

  it('skips dead, dust, and zero-energy particles', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*alive\[i\]\s*==\s*0u\s*\)/);
    expect(src).toMatch(/if\s*\(\s*isDust\[i\]\s*==\s*1u\s*\)/);
    expect(src).toMatch(/if\s*\(\s*energies\[i\]\s*<=\s*0\.0\s*\)/);
  });

  it('applies signal-modulated fission threshold (signal · 0.1 offset)', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The CPU reference's effective threshold is
    //   max(0.1, fissionThreshold - signal * 0.1)
    expect(src).toMatch(/max\(0\.1,\s*fissionThreshold\s*-\s*signal\s*\*\s*0\.1\)/);
  });

  it('splits remaining energy evenly between two daughters', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    expect(src).toMatch(/halfEnergy\s*=\s*remaining\s*\*\s*0\.5/);
  });

  it('uses a PCG-style hash for the per-particle PRNG', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The PRNG is a portable PCG-style hash because WGSL has
    // no builtin RNG. The constants in the hash (747796405,
    // 2891336453) are the standard PCG-XSH-RR constants.
    expect(src).toMatch(/fn\s+pcgHash\s*\(/);
    expect(src).toMatch(/747796405u/);
  });

  it('uses Box-Muller to produce N(0,1) draws for mutation', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The Gaussian noise is produced by the Box-Muller transform
    // (CPU reference uses the same algorithm in
    // src/engine/core/rng.ts `gaussian`).
    expect(src).toMatch(/fn\s+gaussianF32\s*\(/);
    expect(src).toMatch(/sqrt\(-2\.0\s*\*\s*log\(u1\)\)/);
  });

  it('leaves velAxisBias categorical (no Gaussian noise applied)', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The CPU reference's `mutateInheritance` skips the
    // `velAxisBias` slot because it's categorical. The WGSL
    // pass does the same — pin the guard.
    expect(src).toMatch(/if\s*\(\s*k\s*==\s*GENOME_VEL_AXIS_BIAS_OFFSET\s*\)/);
  });

  it('marks the parent slot as dead', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The parent is freed (alive = 0) so the allocator can
    // reuse the slot on the next tick.
    expect(src).toMatch(/alive\[i\]\s*=\s*0u/);
  });
});
