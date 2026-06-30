/**
 * Live-app CPU population floor.
 *
 * The vision cap on target population is 50,000
 * (`VISION.md §Constraints`, `DEFAULT_WORLD_CONFIG.targetPopulation`).
 * The browser-tab MVP runs on the CPU reference, whose collision pass
 * is O(N²) — at 50k founders the first tick takes multiple seconds,
 * which makes the page appear to lock up before any frame paints.
 *
 * `src/engine/gpu/` (the GPU compute path that hits 30 FPS at the
 * vision cap) is post-MVP. Until it lands, the live app uses a
 * CPU-friendly floor that the browser can step inside a single
 * requestAnimationFrame budget so opening the page paints
 * immediately.
 *
 * The floor is exported as a single helper so App, tests, and any
 * future HUD surface agree on the same number. Tests pin
 * `CPU_LIVE_FLOOR` so the live-app ceiling can't regress silently.
 */
export const CPU_LIVE_FLOOR = 500;

/**
 * Effective initial population for the live browser app:
 * `min(visionCap, CPU_LIVE_FLOOR)`. Pass any `WorldConfig`; the
 * function only reads `targetPopulation`.
 */
export function liveInitialPopulation(targetPopulation: number): number {
  return Math.min(targetPopulation, CPU_LIVE_FLOOR);
}
