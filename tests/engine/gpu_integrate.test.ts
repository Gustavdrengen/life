/**
 * WGSL integrate shader — string surface pin.
 *
 * Spec: specs/gpu_pipeline.md §4.3.
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
  'integrate.wgsl'
);

describe('WGSL integrate shader', () => {
  it('exists at the expected path', () => {
    expect(() => readFileSync(SHADER_PATH, 'utf8')).not.toThrow();
  });

  it('declares read_write storage for positions, velocities, energies', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    expect(src).toMatch(/@group\(0\)\s+@binding\(1\)\s+var<storage,\s*read_write>\s+positions/);
    expect(src).toMatch(/@group\(0\)\s+@binding\(2\)\s+var<storage,\s*read_write>\s+velocities/);
    expect(src).toMatch(/@group\(0\)\s+@binding\(3\)\s+var<storage,\s*read_write>\s+energies/);
  });

  it('declares the dust-slot buffers and an atomic counter', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The dust emission path atomically increments a counter to
    // reserve a slot in `dustSlots`. This is the GPU's analogue
    // of the CPU reference's `spawnDust` allocator call.
    expect(src).toMatch(/@group\(0\)\s+@binding\(7\)\s+var<storage,\s*read_write>\s+dustSlots/);
    expect(src).toMatch(/@group\(0\)\s+@binding\(8\)\s+var<storage,\s*read_write>\s+dustCounter/);
    expect(src).toMatch(/atomic<u32>/);
  });

  it('declares an IntegrateParams uniform with fixedDt + maxDust', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    expect(src).toMatch(/struct\s+IntegrateParams/);
    expect(src).toMatch(/fixedDt:\s*f32/);
    expect(src).toMatch(/maxDust:\s*u32/);
  });

  it('skips dead and dust particles', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*alive\[i\]\s*==\s*0u\s*\)/);
  });

  it('updates velocity with drag^dt + force·dt', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The CPU reference's velocity update is
    //   newVx = vx * pow(drag, dt) + fx * dt
    // Pin the same shape in WGSL.
    expect(src).toMatch(/newVx\s*=\s*vx\s*\*\s*dragFactor\s*\+\s*fx\s*\*\s*params\.fixedDt/);
    expect(src).toMatch(/newVy\s*=\s*vy\s*\*\s*dragFactor\s*\+\s*fy\s*\*\s*params\.fixedDt/);
  });

  it('bounces off world bounds with 20% impact dissipation', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The CPU reference's wall bounce dissipates 20% of the
    // impact velocity. Pin the same coefficient in WGSL.
    expect(src).toMatch(/newX\s*=\s*-newX/);
    expect(src).toMatch(/cvx\s*=\s*-cvx\s*\*\s*0\.8/);
  });

  it('emits dust on motion (1 energy per world-unit of distance)', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The dust emission cost is `min(distance, energy)`. The
    // GPU pass atomically reserves a dust slot and writes
    // (pre-step x, pre-step y, cost) into it.
    expect(src).toMatch(/dustSlots\[slot\]\.x\s*=\s*x/);
    expect(src).toMatch(/dustSlots\[slot\]\.y\s*=\s*y/);
    expect(src).toMatch(/dustSlots\[slot\]\.energy\s*=\s*cost/);
    expect(src).toMatch(/energies\[i\]\s*=\s*energies\[i\]\s*-\s*cost/);
  });
});
