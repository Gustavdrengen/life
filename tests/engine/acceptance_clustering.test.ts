/**
 * Acceptance #3 — signal-driven clustering (VISION §Success).
 *
 * Spec: specs/signal_clustering.md.
 *
 * Two populations seeded identically except for `mul[*][axis]`
 * coefficients: one at default seeded values, the other pinned to
 * 0 (no signal response). After a 30-tick window the cluster
 * signatures should differ — the responsive population bends under
 * the local signal field while the unresponsive population drifts
 * only via the wall bounce.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORLD_CONFIG,
  GENOME,
  GENOME_LENGTH,
  Rng,
  createSimulationState,
  spawnParticle,
  scatterClusteredFounders,
  stepOnce,
  clusterSignature
} from '$engine/core/index.js';

function buildState(seed: number, responseMode: 'baseline' | 'unresponsive' | 'amplified') {
  const state = createSimulationState(256, {
    ...DEFAULT_WORLD_CONFIG,
    width: 800,
    height: 600,
    targetPopulation: 24,
    seed,
    snapshotInterval: 1_000_000
  });
  const clusters = Math.max(6, Math.min(20, Math.floor(24 * 0.03)));
  const rng = new Rng(state.rng.snapshot());
  scatterClusteredFounders(24, rng, state.world, clusters).forEach((f) => {
    const row = f.genomeRow;
    // Per VISION §4, per-property response has both an additive
    // (`add`) and a multiplicative (`mul`) component. To truly
    // *disable* signal response both must be zeroed; the additive
    // path is still active when `mul=0` alone.
    if (responseMode === 'unresponsive') {
      for (let axis = 0; axis < 3; axis++) {
        for (let personality = 0; personality < 8; personality++) {
          row[GENOME.addOffset + personality * 3 + axis] = 0;
          row[GENOME.mulOffset + personality * 3 + axis] = 0;
        }
      }
    } else if (responseMode === 'amplified') {
      // Both additive and multiplicative coefficients scaled 4× —
      // the gradient bends more strongly under the same emitted
      // field, producing measurable shape divergence. Read-then-write
      // to satisfy noUncheckedIndexedAccess — the assignment form
      // `row[i] *= 4` would treat the LHS as `number | undefined`.
      for (let axis = 0; axis < 3; axis++) {
        for (let personality = 0; personality < 8; personality++) {
          const addIdx = GENOME.addOffset + personality * 3 + axis;
          const mulIdx = GENOME.mulOffset + personality * 3 + axis;
          row[addIdx] = (row[addIdx] ?? 0) * 4;
          row[mulIdx] = (row[mulIdx] ?? 0) * 4;
        }
      }
    }
    spawnParticle(state, f.x, f.y, f.vx, f.vy, f.energy, false, -1, row);
  });
  return state;
}

describe('acceptance #3: signal-driven clustering', () => {
  it('clusterSignature.memberCount equals alive non-dust count', () => {
    const state = buildState(0x3333_3333, 'baseline');
    const sig = clusterSignature(state);
    expect(sig).not.toBeNull();
    let aliveNonDust = 0;
    for (let i = 0; i < state.storage.capacity; i++) {
      if (state.storage.alive[i] === 1 && state.storage.isDust[i] === 0) {
        aliveNonDust++;
      }
    }
    expect(sig!.memberCount).toBe(aliveNonDust);
  });

  it('seed-identical populations produce byte-identical signatures (determinism)', () => {
    const a = buildState(0x4444_4444, 'baseline');
    const b = buildState(0x4444_4444, 'baseline');
    for (let i = 0; i < 30; i++) stepOnce(a);
    for (let i = 0; i < 30; i++) stepOnce(b);
    const sa = clusterSignature(a);
    const sb = clusterSignature(b);
    expect(sa).not.toBeNull();
    expect(sb).not.toBeNull();
    expect(sa!.memberCount).toBe(sb!.memberCount);
    expect(sa!.interiorMass).toBe(sb!.interiorMass);
    for (let i = 0; i < sa!.pairwiseDistanceSq.length; i++) {
      expect(sa!.pairwiseDistanceSq[i]).toBe(sb!.pairwiseDistanceSq[i]);
    }
  });

  it('unresponsive population (add=0, mul=0) signature differs from baseline', () => {
    // Comparison: the unresponsive population emits signal but cannot
    // respond to it (no `add`/`mul` coefficients), while the
    // baseline population runs with default seeded coefficients.
    // After stepping both populations, their pairwise-distance
    // fingerprints must diverge — the response math on the
    // gradient is the spec-level acceptance for VISION §Success #3.
    //
    // The step window is generous (120 ticks) because derivative
    // forces take a few dozen ticks to integrate into measurable
    // shape change. We don't specify an absolute distance delta
    // because the geometric response at default signalCutoff=60 is
    // small — VISION §3's lattice resolution at 32 cells per axis
    // limits the gradient resolution. The acceptance is relative:
    // at least 5% of the fingerprint must diverge by > 0.5% of the
    // smaller fingerprint's median. That captures "shape has moved
    // under the response curve" without depending on a specific
    // world-unit threshold.
    const baseline = buildState(0x5555_5555, 'baseline');
    const unresponsive = buildState(0x5555_5555, 'unresponsive');
    for (let i = 0; i < 120; i++) stepOnce(baseline);
    for (let i = 0; i < 120; i++) stepOnce(unresponsive);
    const sB = clusterSignature(baseline);
    const sU = clusterSignature(unresponsive);
    expect(sB).not.toBeNull();
    expect(sU).not.toBeNull();
    // Shared member count is a precondition for a percentile-band
    // comparison — if fission has grown one population unbalanced,
    // the fingerprints simply aren't comparable.
    expect(sB!.memberCount).toBe(sU!.memberCount);
    const len = Math.min(
      sB!.pairwiseDistanceSq.length,
      sU!.pairwiseDistanceSq.length
    );
    const medB = sB!.pairwiseDistanceSq[Math.floor(len / 2)] ?? 1;
    const medU = sU!.pairwiseDistanceSq[Math.floor(len / 2)] ?? 1;
    // Both medians must be finite; if either is 0 (e.g. all
    // particles at the same coordinate) the relative-epsilon gate
    // collapses to zero and the test can't measure a shape change.
    expect(Number.isFinite(medB)).toBe(true);
    expect(Number.isFinite(medU)).toBe(true);
    const medianBaseline = Math.min(medB, medU);
    // Relative threshold anchored to the smaller median so the test
    // survives geometric scale changes.
    const relEps = medianBaseline * 0.005;
    let differBands = 0;
    for (let i = 0; i < len; i++) {
      const delta = Math.abs(
        (sB!.pairwiseDistanceSq[i] ?? 0) - (sU!.pairwiseDistanceSq[i] ?? 0)
      );
      if (delta > relEps) differBands++;
    }
    expect(differBands).toBeGreaterThan(len * 0.05);
  });

  it('clusterSignature returns null for an empty state', () => {
    const state = createSimulationState(16, { ...DEFAULT_WORLD_CONFIG, seed: 1 });
    expect(clusterSignature(state)).toBeNull();
  });

  it('signatures are sorted ascending and have the right cardinality', () => {
    const state = buildState(0x6666_6666, 'baseline');
    for (let i = 0; i < 30; i++) stepOnce(state);
    const sig = clusterSignature(state);
    expect(sig).not.toBeNull();
    // Distance vector is monotonically non-decreasing.
    for (let i = 1; i < sig!.pairwiseDistanceSq.length; i++) {
      expect(sig!.pairwiseDistanceSq[i]!).toBeGreaterThanOrEqual(
        sig!.pairwiseDistanceSq[i - 1]!
      );
    }
    // Length matches combinatorial formula.
    const expected = (sig!.memberCount * (sig!.memberCount - 1)) / 2;
    expect(sig!.pairwiseDistanceSq.length).toBe(expected);
    void GENOME_LENGTH;
  });
});
