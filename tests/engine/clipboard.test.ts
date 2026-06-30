/**
 * Organism clipboard — VISION §10 "Transplant isolated organisms".
 * Copy cluster → serialize → parse → paste into a fresh state and
 * verify member placement, energies, and genomes survive.
 */
import { describe, expect, it } from 'vitest';
import {
  Rng,
  DEFAULT_WORLD_CONFIG,
  createSimulationState,
  stepOnce,
  spawnParticle,
  copyOrganism,
  pasteOrganism,
  clipboardToString,
  clipboardFromString,
  type OrganismClipboard
} from '$engine/core/index.js';
import { GENOME_LENGTH } from '$engine/core/genome.js';

function makeState() {
  return createSimulationState(20, {
    ...DEFAULT_WORLD_CONFIG,
    width: 400,
    height: 300,
    latticeResolution: 16,
    signalCutoff: 40,
    fixedDt: 1 / 60,
    targetPopulation: 20,
    seed: 4321
  });
}

function seed(state: ReturnType<typeof makeState>): void {
  state.rng = new Rng(4321);
  spawnParticle(state, 100, 80, 1, 0, 0.9, false, -1);
  spawnParticle(state, 110, 82, -1, 0, 0.9, false, -1);
  spawnParticle(state, 105, 95, 0, 1, 0.9, false, -1);
}

describe('copyOrganism + pasteOrganism', () => {
  it('captures all requested slots into a clipboard envelope', () => {
    const s = makeState();
    seed(s);
    const slots = [0, 1, 2];
    const cb = copyOrganism(s, slots);
    expect(cb.count).toBe(3);
    expect(cb.members.length).toBe(3);
    for (const m of cb.members) {
      expect(m.genome.length).toBe(GENOME_LENGTH);
    }
  });

  it('center of mass matches mean of member positions', () => {
    const s = makeState();
    seed(s);
    const cb = copyOrganism(s, [0, 1, 2]);
    expect(cb.centerX).toBeCloseTo((100 + 110 + 105) / 3);
    expect(cb.centerY).toBeCloseTo((80 + 82 + 95) / 3);
  });

  it('refuses to copy dead slots', () => {
    const s = makeState();
    seed(s);
    expect(() => copyOrganism(s, [0, 1, 999])).toThrow(/range/);
  });

  it('serializes and deserializes symmetrically', () => {
    const s = makeState();
    seed(s);
    const cb = copyOrganism(s, [0, 1, 2]);
    const json = clipboardToString(cb);
    const parsed: OrganismClipboard = clipboardFromString(json);
    expect(parsed.count).toBe(cb.count);
    expect(parsed.members[0]!.energy).toBe(cb.members[0]!.energy);
  });

  it('pastes into a fresh state at the drop point', () => {
    const src = makeState();
    seed(src);
    const cb = copyOrganism(src, [0, 1, 2]);

    const dst = makeState();
    const dropX = 250;
    const dropY = 200;
    const newSlots = pasteOrganism(dst, cb, dropX, dropY);
    expect(newSlots.length).toBe(3);
    expect(dst.storage.activeCount).toBe(3);
    // Center of mass of pasted cluster should be near (250, 200).
    let sx = 0;
    let sy = 0;
    for (const slot of newSlots) {
      sx += dst.storage.positionsSoA[slot * 2] ?? 0;
      sy += dst.storage.positionsSoA[slot * 2 + 1] ?? 0;
    }
    expect(sx / newSlots.length).toBeCloseTo(dropX, 0);
    expect(sy / newSlots.length).toBeCloseTo(dropY, 0);
  });

  it('pasted particles carry original genomes', () => {
    const src = makeState();
    seed(src);
    const cb = copyOrganism(src, [0, 1, 2]);
    const dst = makeState();
    const newSlots = pasteOrganism(dst, cb, 250, 200);
    for (let i = 0; i < newSlots.length; i++) {
      const srcGenome = cb.members[i]!.genome;
      const dstGenome = Array.from(
        dst.storage.genomesSoA.subarray(
          newSlots[i]! * GENOME_LENGTH,
          (newSlots[i]! + 1) * GENOME_LENGTH
        )
      );
      expect(dstGenome).toEqual(srcGenome);
    }
  });

  it('rejects a member whose genome shape does not match the layout', () => {
    const src = makeState();
    seed(src);
    const cb = copyOrganism(src, [0, 1, 2]);
    const bad = { ...cb, members: cb.members.map((m) => ({ ...m, genome: [1, 2, 3] })) };
    const dst = makeState();
    expect(() => pasteOrganism(dst, bad, 250, 200)).toThrow(/length/);
  });

  it('paste survives several post-paste steps without crashing', () => {
    const src = makeState();
    seed(src);
    const cb = copyOrganism(src, [0, 1, 2]);
    const dst = makeState();
    pasteOrganism(dst, cb, 250, 200);
    expect(() => {
      for (let i = 0; i < 30; i++) stepOnce(dst);
    }).not.toThrow();
  });
});
