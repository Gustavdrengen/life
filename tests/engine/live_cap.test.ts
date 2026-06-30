/**
 * Live-app CPU population floor — `src/lib/live_cap.ts`.
 *
 * Regression for the boot-hang symptom: opening `npm run dev`/preview
 * used to spawn 50,000 founders, locking the tab while the O(N²) CPU
 * collision pass chewed through the first tick. The vision cap stays
 * at 50k on `DEFAULT_WORLD_CONFIG.targetPopulation` (the GPU pipeline
 * will re-enable it), but the live app uses a CPU-friendly floor so
 * the first frame paints within one rAF budget.
 */
import { describe, expect, it } from 'vitest';
import {
  CPU_LIVE_FLOOR,
  liveInitialPopulation
} from '$lib/live_cap.js';
import { DEFAULT_WORLD_CONFIG } from '$engine/core/world.js';

describe('live-app CPU population floor (boot-hang regression)', () => {
  it('keeps the vision cap at 50,000', () => {
    // VISION §Constraints — population is the cap, not a slider.
    expect(DEFAULT_WORLD_CONFIG.targetPopulation).toBe(50_000);
  });

  it('floors the live-app initial population at the CPU ceiling', () => {
    expect(CPU_LIVE_FLOOR).toBeLessThan(DEFAULT_WORLD_CONFIG.targetPopulation);
  });

  it('liveInitialPopulation honors the vision cap when the floor is higher', () => {
    expect(liveInitialPopulation(CPU_LIVE_FLOOR + 100)).toBe(CPU_LIVE_FLOOR);
    expect(liveInitialPopulation(50_000)).toBe(CPU_LIVE_FLOOR);
  });

  it('passes the vision cap through when the floor is lower', () => {
    // If the GPU pipeline lands (post-MVP), the live app should
    // adopt the vision cap verbatim — the floor is the safeguard,
    // not the policy.
    expect(liveInitialPopulation(50)).toBe(50);
    expect(liveInitialPopulation(100)).toBe(100);
  });
});
