/**
 * Seeded RNG — Mulberry32. Single 32-bit state, no allocation per call.
 *
 * Why Mulberry32: small, deterministic across platforms, no Math.random or
 * Date.now reach-ins. Quality is sufficient for visual emergence — we are not
 * running statistical inference; we are evolving populations under noisy
 * inheritance. If higher quality is needed later, swap the body of `next()`
 * for splitmix64; the public surface (`next`, `range`, `normal`, `unit`) does
 * not depend on the bit-mixing core.
 *
 * Determinism note: WEBGPU floating-point ordering is implementation-defined
 * across hardware, so the same snapshot bytes do NOT guarantee bit-identical
 * evolution on different machines. Determinism is required *within a single
 * machine and browser combination* (VISION §9). The CPU reference path uses
 * this RNG with bit-stable float math.
 *
 * @see specs/ROOT.md §9 "Determinism, snapshots, scrubbing"
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new TypeError(`Rng seed must be a finite integer, got ${seed}`);
    }
    this.state = (seed | 0) >>> 0;
    if (this.state === 0) this.state = 0xdeadbeef; // mulberry32 collapses to 0 from 0
  }

  /** Returns the next unsigned 32-bit value. */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  unit(): number {
    return this.next() / 0x1_0000_0000;
  }

  /** Uniform float in [-1, 1). */
  signed(): number {
    return this.unit() * 2 - 1;
  }

  /** Uniform integer in [0, n). */
  rangen(n: number): number {
    if (n <= 0) throw new RangeError(`rangen requires n > 0, got ${n}`);
    return this.next() % n;
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.unit() * (hi - lo);
  }

  /** Standard normal via Box-Muller using two uniform samples. */
  normal(): number {
    const u1 = Math.max(this.unit(), Number.EPSILON);
    const u2 = this.unit();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Gaussian with explicit mean and σ. */
  gaussian(mean: number, sigma: number): number {
    return mean + this.normal() * sigma;
  }

  /** Snapshot the bit-state for save/restore. */
  snapshot(): number {
    return this.state;
  }

  /** Restore the bit-state. Falls back to the canonical zero-guard. */
  restore(state: number): void {
    this.state = (state | 0) >>> 0;
    if (this.state === 0) this.state = 0xdeadbeef;
  }
}
