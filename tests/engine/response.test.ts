/**
 * Per-property signal response math.
 *
 * For every slot p and signal s:
 *   p' = (p + a·s) · exp(m·s)
 *
 * Cases:
 *   - add zero + mul zero → p' == p
 *   - positive mul → p' > p
 *   - negative mul → p' < p
 *   - exp arg clipped at ±50 (overflow-safe)
 */
import { describe, expect, it } from 'vitest';
import { effectivePersonality, effectiveSlotValue } from '$engine/core/response.js';
import { GENOME_LENGTH, GENOME, PERSONALITY_SLOTS } from '$engine/core/genome.js';

function buildGenome(
  prop: number,
  add: readonly [number, number, number],
  mul: readonly [number, number, number],
  mod = 0
): Float32Array {
  const row = new Float32Array(GENOME_LENGTH);
  row[GENOME.propOffset + 0] = prop;
  row[GENOME.addOffset + 0] = add[0];
  row[GENOME.addOffset + 1] = add[1];
  row[GENOME.addOffset + 2] = add[2];
  row[GENOME.mulOffset + 0] = mul[0];
  row[GENOME.mulOffset + 1] = mul[1];
  row[GENOME.mulOffset + 2] = mul[2];
  row[GENOME.modOffset + 0] = mod;
  return row;
}

describe('effectiveSlotValue', () => {
  it('zero signal returns raw prop', () => {
    const row = buildGenome(2, [0, 0, 0], [0, 0, 0]);
    const slot = {
      prop: row[GENOME.propOffset + 0]!,
      add: [row[GENOME.addOffset + 0]!, row[GENOME.addOffset + 1]!, row[GENOME.addOffset + 2]!] as const,
      mul: [row[GENOME.mulOffset + 0]!, row[GENOME.mulOffset + 1]!, row[GENOME.mulOffset + 2]!] as const,
      mod: 0
    };
    expect(effectiveSlotValue(slot, [0, 0, 0])).toBe(2);
  });

  it('additive offset moves the base', () => {
    const row = buildGenome(2, [0.5, 0, 0], [0, 0, 0]);
    const slot = {
      prop: row[GENOME.propOffset + 0]!,
      add: [row[GENOME.addOffset + 0]!, row[GENOME.addOffset + 1]!, row[GENOME.addOffset + 2]!] as const,
      mul: [row[GENOME.mulOffset + 0]!, row[GENOME.mulOffset + 1]!, row[GENOME.mulOffset + 2]!] as const,
      mod: 0
    };
    // s=(1,0,0), a=(0.5, 0, 0) → (2 + 0.5) · exp(0) = 2.5
    expect(effectiveSlotValue(slot, [1, 0, 0])).toBeCloseTo(2.5, 9);
  });

  it('multiplicative scalar > 0 widens the value', () => {
    const row = buildGenome(2, [0, 0, 0], [1, 0, 0]);
    const slot = {
      prop: row[GENOME.propOffset + 0]!,
      add: [row[GENOME.addOffset + 0]!, row[GENOME.addOffset + 1]!, row[GENOME.addOffset + 2]!] as const,
      mul: [row[GENOME.mulOffset + 0]!, row[GENOME.mulOffset + 1]!, row[GENOME.mulOffset + 2]!] as const,
      mod: 0
    };
    expect(effectiveSlotValue(slot, [1, 0, 0])).toBeCloseTo(2 * Math.exp(1), 6);
  });

  it('becomes strictly positive with positive prop + negative exp arg', () => {
    const row = buildGenome(0.001, [0, 0, 0], [-100, 0, 0]);
    const slot = {
      prop: row[GENOME.propOffset + 0]!,
      add: [row[GENOME.addOffset + 0]!, row[GENOME.addOffset + 1]!, row[GENOME.addOffset + 2]!] as const,
      mul: [row[GENOME.mulOffset + 0]!, row[GENOME.mulOffset + 1]!, row[GENOME.mulOffset + 2]!] as const,
      mod: 0
    };
    expect(effectiveSlotValue(slot, [1, 0, 0])).toBeGreaterThan(0);
  });

  it('multi-axis additive sums contributions', () => {
    const row = buildGenome(2, [0.2, 0.3, 0.4], [0, 0, 0]);
    const slot = {
      prop: row[GENOME.propOffset + 0]!,
      add: [row[GENOME.addOffset + 0]!, row[GENOME.addOffset + 1]!, row[GENOME.addOffset + 2]!] as const,
      mul: [row[GENOME.mulOffset + 0]!, row[GENOME.mulOffset + 1]!, row[GENOME.mulOffset + 2]!] as const,
      mod: 0
    };
    expect(effectiveSlotValue(slot, [1, 1, 1])).toBeCloseTo(2 + 0.9, 6);
  });

  it('overflow-safe: clipped expArg at 50 yields finite result', () => {
    const row = buildGenome(1, [0, 0, 0], [1000, 0, 0]);
    const slot = {
      prop: row[GENOME.propOffset + 0]!,
      add: [row[GENOME.addOffset + 0]!, row[GENOME.addOffset + 1]!, row[GENOME.addOffset + 2]!] as const,
      mul: [row[GENOME.mulOffset + 0]!, row[GENOME.mulOffset + 1]!, row[GENOME.mulOffset + 2]!] as const,
      mod: 0
    };
    expect(Number.isFinite(effectiveSlotValue(slot, [1, 0, 0]))).toBe(true);
  });
});

describe('effectivePersonality', () => {
  it('writes PERSONALITY_SLOTS values', () => {
    const row = new Float32Array(GENOME_LENGTH);
    const out = new Float32Array(PERSONALITY_SLOTS);
    effectivePersonality(row, [0, 0, 0], out);
    expect(out.length).toBe(PERSONALITY_SLOTS);
    for (let i = 0; i < PERSONALITY_SLOTS; i++) expect(out[i]).toBe(0);
  });

  it('throws on wrong-sized out buffer', () => {
    const row = new Float32Array(GENOME_LENGTH);
    const wrong = new Float32Array(PERSONALITY_SLOTS + 1);
    expect(() => effectivePersonality(row, [0, 0, 0], wrong)).toThrow(RangeError);
  });
});
