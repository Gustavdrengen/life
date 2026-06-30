/**
 * WGSL collide shader — string surface pin.
 *
 * Spec: specs/gpu_pipeline.md §4.4 (collision pass).
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
  'collide.wgsl'
);

describe('WGSL collide shader', () => {
  it('exists at the expected path', () => {
    expect(() => readFileSync(SHADER_PATH, 'utf8')).not.toThrow();
  });

  it('declares the spatial-hash bucket buffers (bucketHead, bucketNext)', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The collision pass uses a 2D spatial hash with cell size
    // `2 × contactSeparation`. Each particle is linked into
    // its bucket via `bucketNext`. Pin the binding slots.
    expect(src).toMatch(/@group\(0\)\s+@binding\(5\)\s+var<storage,\s*read>\s+bucketHead/);
    expect(src).toMatch(/@group\(0\)\s+@binding\(6\)\s+var<storage,\s*read>\s+bucketNext/);
  });

  it('declares a victim buffer for absorbed slots', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The collision pass marks absorbed slots in `victim`; the
    // fission pass later turns those slots into daughters of
    // the predator.
    expect(src).toMatch(/@group\(0\)\s+@binding\(7\)\s+var<storage,\s*read_write>\s+victim/);
  });

  it('declares a CollideParams uniform with contactSeparation + predationSpeedThreshold', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    expect(src).toMatch(/struct\s+CollideParams/);
    expect(src).toMatch(/contactSeparation:\s*f32/);
    expect(src).toMatch(/predationSpeedThreshold:\s*f32/);
  });

  it('skips dead particles', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*alive\[i\]\s*==\s*0u\s*\)/);
  });

  it('walks a 3×3 bucket neighborhood', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    expect(src).toMatch(/for\s*\(\s*var\s+dy:\s*i32\s*=\s*-1;\s*dy\s*<=\s*1/);
    expect(src).toMatch(/for\s*\(\s*var\s+dx:\s*i32\s*=\s*-1;\s*dx\s*<=\s*1/);
  });

  it('reflects velocities along the contact normal (elastic bounce)', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The CPU reference's bounce: v' = v - 2·(v·n)·n. Pin the
    // same shape in WGSL.
    expect(src).toMatch(/vx\s*-\s*2\.0\s*\*\s*viDotN\s*\*\s*nxN/);
  });

  it('absorbs the slower particle when one is above predationSpeedThreshold', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The faster predator gains the prey's energy; the prey
    // is marked as a victim.
    expect(src).toMatch(/energies\[i\]\s*=\s*energies\[i\]\s*\+\s*energies\[j\]/);
    expect(src).toMatch(/victim\[j\]\s*=\s*1u/);
  });

  it('handles the both-predators case (faster wins)', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // When both particles exceed the threshold, the faster one
    // wins — same as the CPU reference's `iSpeedSq < jSpeedSq`
    // branch.
    expect(src).toMatch(/jSpeed\s*>\s*mySpeed/);
  });
});
