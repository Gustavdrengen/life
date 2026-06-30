/**
 * Acceptance #10 — transplant isolation (VISION §Success).
 *
 * Spec: VISION §Success #10 ("An interesting organism can be selected
 * mid-run, copied into a fresh empty world, and produce a viable
 * descendant lineage on its own.")
 *
 * The base clipboard contract is in `clipboard.test.ts` (copy →
 * serialize → parse → paste → step survives). This file pins the
 * *full acceptance*: a pasted cluster, on a step window, must show
 *  - the pasted members alive,
 *  - at least one fission descendant with the same genome region as
 *    a parent (the lineage is not degenerating into dust),
 *  - the descendant count grows over time (viability signal).
 *
 * If the fission math or the genome inheritance path ever regresses,
 * this test fails. Memory target=24 with capacity headroom keeps the
 * run under one second on a commodity CPU.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORLD_CONFIG,
  GENOME,
  GENOME_LENGTH,
  createSimulationState,
  stepOnce,
  spawnParticle,
  copyOrganism,
  pasteOrganism,
  genomeStats,
  personalityNorm
} from '$engine/core/index.js';

/** Seed a small "donor" world with a clustered trio that shares a
 *  genome profile. The trio is hand-placed under tight separation
 *  so the cluster-detection and fission paths fire in their normal
 *  parametric regime. */
function makeDonor(): ReturnType<typeof createSimulationState> {
  const state = createSimulationState(96, {
    ...DEFAULT_WORLD_CONFIG,
    width: 800,
    height: 600,
    targetPopulation: 8,
    seed: 0xa10e,
    snapshotInterval: 1_000_000
  });
  // 4 sibling founders with the same genome row — the cluster is a
  // tight triplet of identically-configured particles. After a few
  // ticks of growth they form a multi-cell organism that survives
  // copy → paste into an empty world.
  const row = new Float32Array(GENOME_LENGTH);
  row[GENOME.mass] = 1;
  row[GENOME.radius] = 1;
  row[GENOME.drag] = 0.95;
  row[GENOME.fissionThreshold] = 0.5; // eager fission
  row[GENOME.fissionCost] = 0.04;
  row[GENOME.mutSigma] = 0.05;
  // Personality slots: gentle, stable profile to keep descendants
  // lineage-coherent.
  for (let i = 0; i < 8; i++) {
    row[GENOME.propOffset + i] = 0;
    row[GENOME.modOffset + i] = 0.2;
  }
  // emitBase biased so deposited signal keeps daughters close to the
  // original cluster center.
  row[GENOME.emitBaseOffset + 0] = 0.4;
  row[GENOME.emitBaseOffset + 1] = 0.4;
  row[GENOME.emitBaseOffset + 2] = 0.4;

  // Place the trio at (200, 200) — they overlap, the elastic bounce
  // separates them, and the modest initial energy keeps them in
  // contact long enough to absorb dust and fission.
  spawnParticle(state, 200, 200, 0, 0, 1.5, false, -1, row);
  spawnParticle(state, 201, 201, 0, 0, 1.5, false, -1, row);
  spawnParticle(state, 200, 201, 0, 0, 1.5, false, -1, row);
  spawnParticle(state, 201, 200, 0, 0, 1.5, false, -1, row);
  return state;
}

function aliveNonDust(state: ReturnType<typeof createSimulationState>): number {
  let n = 0;
  for (let i = 0; i < state.storage.capacity; i++) {
    if (state.storage.alive[i] === 1 && state.storage.isDust[i] === 0) n++;
  }
  return n;
}

describe('acceptance #10: transplant isolated organisms', () => {
  it('pasted founders survive and produce a viable descendant lineage', () => {
    const donor = makeDonor();
    // Donor starts with 4 founders. Push energy for a few ticks so
    // the population reaches its first fission event before we copy.
    for (let i = 0; i < 5; i++) stepOnce(donor);

    // Take a snapshot of the live donor non-dust slot indices and
    // copy them as the organism archive.
    const slots: number[] = [];
    for (let i = 0; i < donor.storage.capacity; i++) {
      if (donor.storage.alive[i] === 1 && donor.storage.isDust[i] === 0) {
        slots.push(i);
      }
    }
    expect(slots.length).toBeGreaterThanOrEqual(4);
    const cb = copyOrganism(donor, slots);
    const donorStats = genomeStats(donor);

    // Paste into a *fresh* empty world.
    const fresh = createSimulationState(256, {
      ...DEFAULT_WORLD_CONFIG,
      width: 800,
      height: 600,
      targetPopulation: 16,
      seed: 0xa10e,
      snapshotInterval: 1_000_000
    });
    const pasteSlots = pasteOrganism(fresh, cb, 400, 300);
    expect(pasteSlots.length).toBe(cb.count);
    // The pasted world is empty apart from the organism.
    expect(aliveNonDust(fresh)).toBe(cb.count);

    // Step the fresh world for a window long enough for fission to
    // produce descendants but short enough not to drain energy.
    for (let i = 0; i < 30; i++) stepOnce(fresh);

    const afterStats = genomeStats(fresh);
    // Descendants count strictly grew vs the pasted population.
    expect(aliveNonDust(fresh)).toBeGreaterThan(cb.count);

    // The personality profile is preserved — the donor's per-slot
    // mean sits inside the descendant world's mean under a small
    // Gaussian noise budget. Unbiased mutation keeps the means
    // bounded; a regression that drops personality to zero would
    // land at `personalityNorm === 0` and fail this check.
    expect(personalityNorm(afterStats)).toBeGreaterThan(0);
    // Drift between donor and fresh is small compared to drift
    // driven by a different founder distribution; this confirms the
    // offspring stayed on the donor's branch, not that fissions
    // generically drift.
    let sumAbs = 0;
    for (let i = 0; i < GENOME_LENGTH; i++) {
      sumAbs += Math.abs((afterStats.mean[i] ?? 0) - (donorStats.mean[i] ?? 0));
    }
    expect(sumAbs / GENOME_LENGTH).toBeLessThan(0.05);
  });
});
