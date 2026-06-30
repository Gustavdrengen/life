/**
 * RNG determinism — same seed → same bit sequence; different seeds
 * diverge; rng.snapshot/restore round-trips.
 *
 * Spec: specs/ROOT.md §9 "Determinism".
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '$engine/core/rng.js';

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(0xcafe_babe);
    const b = new Rng(0xcafe_babe);
    for (let i = 0; i < 1000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const aSeq = Array.from({ length: 100 }, () => a.next());
    const bSeq = Array.from({ length: 100 }, () => b.next());
    expect(aSeq).not.toEqual(bSeq);
  });

  it('unit() stays in [0, 1)', () => {
    const r = new Rng(42);
    for (let i = 0; i < 10_000; i++) {
      const u = r.unit();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('normal() distribution is roughly centered on 0', () => {
    const r = new Rng(42);
    let sum = 0;
    const N = 5_000;
    for (let i = 0; i < N; i++) sum += r.normal();
    const mean = sum / N;
    expect(Math.abs(mean)).toBeLessThan(0.1); // loose, statistical
  });

  it('snapshot → restore yields the same sequence', () => {
    const a = new Rng(7);
    for (let i = 0; i < 50; i++) a.next();
    const state = a.snapshot();
    const aSeq = Array.from({ length: 100 }, () => a.next());
    const b = new Rng(0);
    b.restore(state);
    const bSeq = Array.from({ length: 100 }, () => b.next());
    expect(aSeq).toEqual(bSeq);
  });

  it('seed=0 still works (does not collapse to all zeros)', () => {
    const r = new Rng(0);
    const seq = Array.from({ length: 10 }, () => r.next());
    expect(new Set(seq).size).toBeGreaterThan(1);
  });
});
