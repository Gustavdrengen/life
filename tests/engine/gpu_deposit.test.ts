/**
 * WGSL deposit shader — string surface pin.
 *
 * Spec: specs/gpu_pipeline.md §4.2.
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
  'deposit.wgsl'
);

describe('WGSL deposit shader', () => {
  it('exists at the expected path', () => {
    expect(() => readFileSync(SHADER_PATH, 'utf8')).not.toThrow();
  });

  it('declares read-only storage for genomes, positions, velocities, alive, isDust', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    expect(src).toMatch(/@group\(0\)\s+@binding\(0\)\s+var<storage,\s*read>\s+genomes/);
    expect(src).toMatch(/@group\(0\)\s+@binding\(1\)\s+var<storage,\s*read>\s+positions/);
    expect(src).toMatch(/@group\(0\)\s+@binding\(2\)\s+var<storage,\s*read>\s+velocities/);
    expect(src).toMatch(/@group\(0\)\s+@binding\(3\)\s+var<storage,\s*read>\s+alive/);
    expect(src).toMatch(/@group\(0\)\s+@binding\(4\)\s+var<storage,\s*read>\s+isDust/);
  });

  it('declares the field buffer as read_write at @binding(5)', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    expect(src).toMatch(/@group\(0\)\s+@binding\(5\)\s+var<storage,\s*read_write>\s+field/);
  });

  it('declares a uniform DepositParams with latticeResolution + signalCutoff', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    expect(src).toMatch(/struct\s+DepositParams/);
    expect(src).toMatch(/latticeResolution:\s*u32/);
    expect(src).toMatch(/signalCutoff:\s*f32/);
  });

  it('mirrors the genome layout constants from src/engine/core/genome.ts', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The deposit shader reads emitBase[0..2] (slots 71..73) and
    // mod[0..7] (slots 63..70). These match the GENOME constants
    // in src/engine/core/genome.ts. Pin them so a refactor
    // in either file doesn't drift silently.
    expect(src).toMatch(/EMIT_BASE_OFFSET:\s*u32\s*=\s*71u/);
    expect(src).toMatch(/MOD_OFFSET:\s*u32\s*=\s*63u/);
    expect(src).toMatch(/PERSONALITY_SLOTS:\s*u32\s*=\s*8u/);
  });

  it('skips dead and dust particles', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The shader must early-return for `alive[i] == 0u` and
    // `isDust[i] == 1u` to save the per-cell deposit walk.
    expect(src).toMatch(/if\s*\(\s*alive\[i\]\s*==\s*0u\s*\)/);
    expect(src).toMatch(/if\s*\(\s*isDust\[i\]\s*==\s*1u\s*\)/);
  });

  it('deposits into a 3×3 cell neighborhood with falloff weighting', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The 3×3 walk is the GPU approximation of the wider
    // `signalCutoff`-radius walk. Pin both the loop bounds and
    // the per-component field write.
    expect(src).toMatch(/for\s*\(\s*var\s+dy:\s*i32\s*=\s*-1;\s*dy\s*<=\s*1/);
    expect(src).toMatch(/for\s*\(\s*var\s+dx:\s*i32\s*=\s*-1;\s*dx\s*<=\s*1/);
    expect(src).toMatch(/field\[cellIdx \+ 0u\]\s*=\s*field\[cellIdx \+ 0u\]\s*\+\s*emit\.x\s*\*\s*w/);
    expect(src).toMatch(/field\[cellIdx \+ 1u\]\s*=\s*field\[cellIdx \+ 1u\]\s*\+\s*emit\.y\s*\*\s*w/);
    expect(src).toMatch(/field\[cellIdx \+ 2u\]\s*=\s*field\[cellIdx \+ 2u\]\s*\+\s*emit\.z\s*\*\s*w/);
  });

  it('uses cubic Hermite falloff in `falloff(r, cutoff)`', () => {
    const src = readFileSync(SHADER_PATH, 'utf8');
    // The falloff function is the GPU's port of the CPU
    // reference's `f(r) = (1 - r/cutoff)² · (1 + 2r/cutoff)`.
    expect(src).toMatch(/fn\s+falloff\s*\(/);
    expect(src).toMatch(/oneMinus\s*\*\s*oneMinus\s*\*\s*\(1\.0\s*\+\s*2\.0\s*\*\s*t\)/);
  });
});
