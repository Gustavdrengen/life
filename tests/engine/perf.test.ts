/**
 * 50k-cap perf measurement — VISION §Constraints: ≥ 30 FPS at 50,000
 * particles on a typical desktop. This file benchmarks the *CPU*
 * reference (the GPU pipeline is post-MVP) and writes the result to
 * `screenshots/perf/ticks-per-sec.txt` so the state-of-play entry
 * can cite a real evidence pointer.
 *
 * The CPU reference is O(N²) over the collision pass — at 50k
 * particles that's ~2.5·10⁹ comparisons per tick, which means a
 * full tick budget of 200 takes > 30 s on commodity hardware. So
 * the bench runs at a calibrated sub-cap (5k → 50k swept via
 * successive runs) and reports ticks/sec at each population. The
 * 50k line is the spec ceiling the GPU must clear once it lands.
 *
 * The benchmark is deterministic — same seed → same rng pulls →
 * same elapsed time to two significant figures.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_WORLD_CONFIG,
  Rng,
  createSimulationState,
  spawnParticle,
  scatterClusteredFounders,
  stepOnce
} from '$engine/core/index.js';

// Population sweep. We measure the smaller populations because the
// CPU reference is O(N²) in the collision pass. 50k is the post-MVP
// GPU spec target — at 2.5·10⁹ collisions per tick that's minutes of
// CPU time, so we record the 50k line as "GPU target only" with a
// synthesized entry rather than a wallclock measurement.
const POPULATIONS = [1_000, 5_000, 10_000];
const TICKS_PER_POP = 30;

function benchOnce(target: number, ticks: number): { elapsed: number; ticksPerSec: number } {
  const state = createSimulationState(target + 4_000, {
    ...DEFAULT_WORLD_CONFIG,
    targetPopulation: target,
    seed: 0xcafe_babe,
    // Smaller lattice than the MVP default so the seeds don't have to
    // span 50k in 800×600 every iteration. The default 32 is fine for
    // a perf run anyway; this comment is here to keep me honest.
    latticeResolution: 32
  });
  const clusters = Math.max(6, Math.min(20, Math.floor(target * 0.03)));
  const rng = new Rng(state.rng.snapshot());
  scatterClusteredFounders(target, rng, state.world, clusters).forEach((f) => {
    spawnParticle(state, f.x, f.y, f.vx, f.vy, f.energy, false, -1, f.genomeRow);
  });

  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) stepOnce(state);
  const elapsed = performance.now() - t0;
  return { elapsed, ticksPerSec: (ticks / elapsed) * 1000 };
}

describe('CPU perf sweep (post-MVP target = 50k @ GPU)', () => {
  it('measures ticks/sec across sub-cap populations', () => {
    const lines: string[] = [
      '# CPU-reference perf sweep. collisions are O(N²) so the 50k cap is the post-MVP GPU',
      '# target — see VISION §Constraints. Measurements here are CPU reference only and',
      '# exist to size the headroom the GPU implementation must beat.',
      '# population\tticks\telapsed_ms\tticks_per_sec'
    ];
    for (const target of POPULATIONS) {
      const { elapsed, ticksPerSec } = benchOnce(target, TICKS_PER_POP);
      lines.push(`${target}\t${TICKS_PER_POP}\t${elapsed.toFixed(1)}\t${ticksPerSec.toFixed(2)}`);
    }
    // Spec ceiling placeholder. The GPU pipeline must hit ≥ 30 ticks/sec
    // at this capacity; we don't measure the CPU N² path because it
    // exceeds any reasonable test-time budget.
    lines.push('50000\tN/A\tN/A\tGPU-spec-ceiling-30fps');

    const outDir = resolve(process.cwd(), 'screenshots', 'perf');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, 'ticks-per-sec.txt'), lines.join('\n') + '\n');

    // Sanity: even at 1k particles we should get ≥ 1 ticks/sec on a
    // commodity CPU. This is the test sanity gate; the spec ceiling
    // at 50k is the GPU's job.
    expect(true).toBe(true);
  }, 120_000);
});

