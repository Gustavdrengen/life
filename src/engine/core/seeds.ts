/**
 * Initial-condition seeding — presets that the HUD uses to populate a
 * fresh simulation with founder genomes. Each preset returns an array
 * of `{ x, y, vx, vy, energy, genomeRow }` suggestions that the caller
 * funnels into `spawnParticle`.
 *
 * Founders are picked with random genome vectors drawn from bounded
 * distributions typical of "Particle Life" style stables: small additive
 * and multiplicative response, modest emission, modest mutation rate.
 * These biases are deliberate — they produce clumpy motion on first
 * tick rather than scattered Brownian noise. The HUD slider exposes
 * each coefficient's distribution width so the user can dial up
 * chaos on demand.
 */

import { GENOME_LENGTH, GENOME, PERSONALITY_SLOTS } from './genome.js';
import type { Rng } from './rng.js';

export interface Founder {
  x: number;
  y: number;
  vx: number;
  vy: number;
  energy: number;
  genomeRow: Float32Array;
}

export interface WorldDims {
  width: number;
  height: number;
}

export interface Distribution {
  /** Per-property bounds for the personality slots. */
  propMin: number;
  propMax: number;
  /** Additive response per slot per axis. */
  addMin: number;
  addMax: number;
  /** Multiplicative response per slot per axis — kept gentle. */
  mulMin: number;
  mulMax: number;
  /** Modulator coefficient per slot. */
  modMin: number;
  modMax: number;
  /** Emit base per signal axis. */
  emitBaseMin: number;
  emitBaseMax: number;
}

export const DEFAULT_DISTRIBUTION: Distribution = Object.freeze({
  propMin: -1,
  propMax: 1,
  addMin: -0.5,
  addMax: 0.5,
  mulMin: -0.2,
  mulMax: 0.2,
  modMin: -0.5,
  modMax: 0.5,
  emitBaseMin: -0.5,
  emitBaseMax: 0.5
});

/**
 * Generate one founder genome row consistent with the genome layout.
 * The row is fully initialized — caller passes it into `spawnParticle`.
 */
export function makeFounderGenome(
  rng: Rng,
  dist: Distribution = DEFAULT_DISTRIBUTION
): Float32Array {
  const row = new Float32Array(GENOME_LENGTH);
  row[GENOME.mass] = 1;
  row[GENOME.radius] = 1;
  row[GENOME.drag] = 0.95;
  row[GENOME.fissionThreshold] = 1.4;
  row[GENOME.fissionCost] = 0.04;
  row[GENOME.dustAbsorbRate] = 0.0;
  row[GENOME.mutSigma] = 0.05;

  for (let i = 0; i < PERSONALITY_SLOTS; i++) {
    row[GENOME.propOffset + i] = rng.range(dist.propMin, dist.propMax);
  }
  for (let i = 0; i < PERSONALITY_SLOTS; i++) {
    for (let axis = 0; axis < 3; axis++) {
      row[GENOME.addOffset + i * 3 + axis] = rng.range(dist.addMin, dist.addMax);
      row[GENOME.mulOffset + i * 3 + axis] = rng.range(dist.mulMin, dist.mulMax);
    }
  }
  for (let i = 0; i < PERSONALITY_SLOTS; i++) {
    row[GENOME.modOffset + i] = rng.range(dist.modMin, dist.modMax);
  }
  for (let axis = 0; axis < 3; axis++) {
    row[GENOME.emitBaseOffset + axis] = rng.range(dist.emitBaseMin, dist.emitBaseMax);
  }
  row[GENOME.velAxisBias] = rng.range(-1, 1);
  row[GENOME.velBiasStrength] = rng.range(0, 0.4);
  row[GENOME.energyBiasStrength] = rng.range(0, 2);
  return row;
}

/** Preset: scatter `n` founders uniformly across the world. */
export function scatterFounders(
  n: number,
  rng: Rng,
  world: WorldDims,
  dist: Distribution = DEFAULT_DISTRIBUTION
): Founder[] {
  const out: Founder[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: rng.range(0, world.width),
      y: rng.range(0, world.height),
      vx: rng.signed() * 5,
      vy: rng.signed() * 5,
      energy: 1.0,
      genomeRow: makeFounderGenome(rng, dist)
    });
  }
  return out;
}
