/**
 * Emission — dust short-circuits to silence, energy attenuation reduces
 * output, velocity bias scales with current speed, modulator sum enters
 * as an exp(arg).
 */
import { describe, expect, it } from 'vitest';
import { computeEmission } from '$engine/core/emission.js';
import {
  createParticleStorage,
  writePosition,
  writeVelocity
} from '$engine/core/particles.js';
import { GENOME_LENGTH, GENOME, PERSONALITY_SLOTS } from '$engine/core/genome.js';

function makeParticle(effective: Float32Array) {
  const storage = createParticleStorage(2);
  writePosition(storage, 0, 0, 0);
  writeVelocity(storage, 0, 0, 0);
  storage.alive[0] = 1;
  storage.energies[0] = 1.0;
  storage.genomesSoA.set(effective, 0);
  return storage;
}

describe('computeEmission', () => {
  it('dust emits (0, 0, 0) regardless of genome state', () => {
    const row = new Float32Array(GENOME_LENGTH);
    // Set non-zero emitBase to prove dust ignores it.
    row[GENOME.emitBaseOffset + 0] = 1.0;
    row[GENOME.emitBaseOffset + 1] = 2.0;
    row[GENOME.emitBaseOffset + 2] = 3.0;
    const storage = createParticleStorage(1);
    storage.alive[0] = 1;
    storage.isDust[0] = 1;
    storage.genomesSoA.set(row, 0);
    const out = computeEmission(storage, 0, [0, 0, 0], new Float32Array(PERSONALITY_SLOTS), [5, 5]);
    expect(out.emit).toEqual([0, 0, 0]);
  });

  it('zero effective personality yields emitBase * exp(0) * energyAtten', () => {
    const row = new Float32Array(GENOME_LENGTH);
    row[GENOME.emitBaseOffset + 0] = 0.5;
    row[GENOME.emitBaseOffset + 1] = 0.5;
    row[GENOME.emitBaseOffset + 2] = 0.5;
    row[GENOME.energyBiasStrength] = 0.0;
    row[GENOME.velBiasStrength] = 0.0;
    const storage = makeParticle(row);
    const effective = new Float32Array(PERSONALITY_SLOTS); // all zero
    const out = computeEmission(storage, 0, [0, 0, 0], effective, [0, 0]);
    // exp(0) = 1, energyAtten = exp(0) = 1, no wake
    expect(out.emit).toEqual([0.5, 0.5, 0.5]);
  });

  it('energy bias attenuates output at low energy', () => {
    const row = new Float32Array(GENOME_LENGTH);
    row[GENOME.emitBaseOffset + 0] = 1.0;
    row[GENOME.energyBiasStrength] = 5; // strong attenuation when E < 1
    row[GENOME.velBiasStrength] = 0;
    const storage = makeParticle(row);
    storage.energies[0] = 0.2;
    const out = computeEmission(storage, 0, [0, 0, 0], new Float32Array(PERSONALITY_SLOTS), [0, 0]);
    expect(out.emit[0]).toBeLessThan(1);
    expect(out.emit[0]).toBeGreaterThan(0);
  });

  it('velocity bias contributes to x/y wake', () => {
    const row = new Float32Array(GENOME_LENGTH);
    row[GENOME.emitBaseOffset + 0] = 0;
    row[GENOME.emitBaseOffset + 1] = 0;
    row[GENOME.emitBaseOffset + 2] = 0;
    row[GENOME.velAxisBias] = 1.0; // bias fully on x
    row[GENOME.velBiasStrength] = 1.0;
    row[GENOME.energyBiasStrength] = 0;
    const storage = makeParticle(row);
    const out = computeEmission(storage, 0, [0, 0, 0], new Float32Array(PERSONALITY_SLOTS), [10, 0]);
    // wake should be the speed (10) * 1 = 10 on x.
    expect(out.emit[0]).toBeCloseTo(10, 6);
    // and (1 - |1|) * 10 * 1 = 0 on y.
    expect(out.emit[1]).toBeCloseTo(0, 6);
  });
});
