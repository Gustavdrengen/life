/**
 * Genome layout — fixed-length, slot indices resolve, readPersonality
 * returns the right triple, dust genome is all-zero, mutation scale
 * array covers every slot.
 */
import { describe, expect, it } from 'vitest';
import {
  GENOME,
  GENOME_LENGTH,
  PERSONALITY_SLOTS,
  SIGNAL_AXES,
  SLOT_MUTATION_SCALE,
  slotMutationScale,
  readPersonality,
  writeDustGenome
} from '$engine/core/genome.js';

describe('genome layout', () => {
  it('GENOME_LENGTH == 77 as advertised', () => {
    expect(GENOME_LENGTH).toBe(77);
  });

  it('personality slots map 1:1 onto add/mul/mod regions', () => {
    // sanity: each region is exactly PERSONALITY_SLOTS * chunk wide
    expect(GENOME.addOffset - GENOME.propOffset).toBe(PERSONALITY_SLOTS);
    expect(GENOME.mulOffset - GENOME.addOffset).toBe(
      PERSONALITY_SLOTS * SIGNAL_AXES
    );
    expect(GENOME.modOffset - GENOME.mulOffset).toBe(
      PERSONALITY_SLOTS * SIGNAL_AXES
    );
  });

  it('readPersonality returns prop/add/mul/mod triple for valid slot', () => {
    const row = new Float32Array(GENOME_LENGTH);
    row[GENOME.propOffset + 0] = 7;
    row[GENOME.addOffset + 0 * 3] = 1;
    row[GENOME.addOffset + 0 * 3 + 1] = 2;
    row[GENOME.addOffset + 0 * 3 + 2] = 3;
    row[GENOME.mulOffset + 0 * 3] = 4;
    row[GENOME.mulOffset + 0 * 3 + 1] = 5;
    row[GENOME.mulOffset + 0 * 3 + 2] = 6;
    row[GENOME.modOffset + 0] = 8;
    const pt = readPersonality(row, 0);
    expect(pt.prop).toBe(7);
    expect([...pt.add]).toEqual([1, 2, 3]);
    expect([...pt.mul]).toEqual([4, 5, 6]);
    expect(pt.mod).toBe(8);
  });

  it('readPersonality throws on out-of-range slot', () => {
    const row = new Float32Array(GENOME_LENGTH);
    expect(() => readPersonality(row, -1)).toThrow(RangeError);
    expect(() => readPersonality(row, PERSONALITY_SLOTS)).toThrow(RangeError);
  });

  it('dust genome is all-zero', () => {
    const row = new Float32Array(GENOME_LENGTH);
    writeDustGenome(row);
    for (let i = 0; i < GENOME_LENGTH; i++) {
      expect(row[i]).toBe(0);
    }
  });

  it('SLOT_MUTATION_SCALE covers every slot', () => {
    expect(SLOT_MUTATION_SCALE.length).toBe(GENOME_LENGTH);
    for (let i = 0; i < GENOME_LENGTH; i++) {
      expect(typeof slotMutationScale(i)).toBe('number');
    }
  });

  it('velAxisBias slot has zero mutation scale (categorical)', () => {
    expect(slotMutationScale(GENOME.velAxisBias)).toBe(0);
  });
});
