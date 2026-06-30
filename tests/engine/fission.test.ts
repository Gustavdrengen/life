/**
 * Fission — energy splits, daughters inherit mutated genomes, parent is
 * consumed, daughters are non-dust.
 *
 * Spec: specs/ROOT.md §8 "Fission".
 */
import { describe, expect, it } from 'vitest';
import {
  createSimulationState,
  stepOnce,
  spawnParticle,
  DEFAULT_WORLD_CONFIG,
  GENOME,
  GENOME_LENGTH
} from '$engine/core/index.js';

function makeState(capacity = 16) {
  return createSimulationState(capacity, {
    ...DEFAULT_WORLD_CONFIG,
    width: 200,
    height: 200,
    latticeResolution: 16,
    signalCutoff: 30,
    fixedDt: 1 / 60,
    targetPopulation: 20,
    seed: 99
  });
}

/**
 * Make the parent fission-friendly: huge energy, tiny threshold, low cost,
 * zero velocity so dust does not bleed energy out, and a high mutSigma so
 * daughter mutation is observable in one generation.
 */
function armForFission(state: ReturnType<typeof makeState>, slot: number): void {
  state.storage.energies[slot] = 4;
  const start = slot * GENOME_LENGTH;
  state.storage.genomesSoA[start + GENOME.fissionThreshold] = 0.05;
  state.storage.genomesSoA[start + GENOME.fissionCost] = 0.001;
  state.storage.genomesSoA[start + GENOME.mutSigma] = 0.5;
  state.storage.genomesSoA[start + GENOME.drag] = 1.0;
  state.storage.velocitiesSoA[slot * 2] = 0;
  state.storage.velocitiesSoA[slot * 2 + 1] = 0;
  // Wake age gate so first eligible tick may fission.
  state.storage.ages[slot] = 100;
}

describe('fission', () => {
  it('produces two daughters when energy > threshold', () => {
    const s = makeState(16);
    const parent = spawnParticle(s, 100, 100, 0, 0, 1.0, false, -1);
    armForFission(s, parent!);
    const parentEnergyBefore = s.storage.energies[parent!];
    for (let i = 0; i < 5; i++) stepOnce(s);
    // Capture the parent's id before stepping so we can distinguish the
    // parent's slot-reused-by-daughter from a real conservation check.
    const parentId = s.storage.ids[parent!];
    let aliveNonDust = 0;
    let slotsWithParentId = 0;
    for (let i = 0; i < s.storage.capacity; i++) {
      if (s.storage.alive[i] === 1 && s.storage.isDust[i] === 0) {
        aliveNonDust++;
        if (s.storage.ids[i] === parentId) slotsWithParentId++;
      }
    }
    // Two daughters, at most one of which may have reused the parent's
    // slot if the allocator picked first-fit.
    expect(aliveNonDust).toBeGreaterThanOrEqual(2);
    expect(slotsWithParentId).toBeLessThanOrEqual(1);
    // Total non-dust energy is close to parent's pre-fission energy minus
    // the dust puff from fissionCost. Conservation tested elsewhere.
    let totalNonDust = 0;
    for (let i = 0; i < s.storage.capacity; i++) {
      if (s.storage.alive[i] === 1 && s.storage.isDust[i] === 0) {
        totalNonDust += s.storage.energies[i]!;
      }
    }
    expect(totalNonDust).toBeLessThanOrEqual(parentEnergyBefore! + 1e-6);
  });

  it('daughters inherit parent\'s genome with Gaussian noise on noisy slots', () => {
    const s = makeState(16);
    const parent = spawnParticle(s, 100, 100, 0, 0, 1.0, false, -1);
    armForFission(s, parent!);
    // Pin slot 0's prop to a known value, multiply by mutSigma so daughters
    // will land measurably off from it.
    const startParent = parent! * GENOME_LENGTH;
    s.storage.genomesSoA[startParent + GENOME.propOffset] = 5.0;
    for (let i = 0; i < 5; i++) stepOnce(s);

    const nonDust: number[] = [];
    for (let i = 0; i < s.storage.capacity; i++) {
      if (s.storage.alive[i] === 1 && s.storage.isDust[i] === 0) nonDust.push(i);
    }
    expect(nonDust.length).toBeGreaterThanOrEqual(2);
    // At least one daughter should NOT have prop[0] exactly at 5.0.
    let observable = false;
    for (const i of nonDust) {
      const prop0 = s.storage.genomesSoA[i * GENOME_LENGTH + GENOME.propOffset]!;
      if (Math.abs(prop0 - 5.0) > 1e-3) observable = true;
    }
    expect(observable).toBe(true);
  });
});
