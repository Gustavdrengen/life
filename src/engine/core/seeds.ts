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

/**
 * Cluster-based founder seeding. Particles are grouped into `clusterCount`
 * clusters, each cluster centered on a single point inside the world
 * with `~clusterSize` siblings. All siblings in a cluster share a
 * genealogically close genome — a single "archetype" is drawn, and each
 * sibling receives it with mild per-slot Gaussian noise.
 *
 * This produces visible motion and clustering within the first ~60 ticks
 * instead of waiting for accumulated drift, and gives the user an
 * immediate sense of how lineages diverge under selection pressure.
 * Effective T0/T1 fix for the "quiet first 30 seconds" symptom.
 */
export function scatterClusteredFounders(
  totalCount: number,
  rng: Rng,
  world: WorldDims,
  clusterCount: number,
  dist: Distribution = DEFAULT_DISTRIBUTION
): Founder[] {
  if (clusterCount <= 0) throw new RangeError('clusterCount must be > 0');
  const out: Founder[] = [];
  const perCluster = Math.max(1, Math.floor(totalCount / clusterCount));
  for (let c = 0; c < clusterCount; c++) {
    // Pick a cluster center inside the world with a comfortable margin.
    const margin = Math.min(world.width, world.height) * 0.08;
    const cx = rng.range(margin, world.width - margin);
    const cy = rng.range(margin, world.height - margin);
    const archetype = makeFounderGenome(rng, dist);
    // Bump archetype's mutateSigma modestly down — we want clusters
    // to stay coherent for a few generations, not dissolve instantly.
    archetype[GENOME.mutSigma] = (archetype[GENOME.mutSigma] ?? 0.05) * 0.8;
    const jx = rng.signed();
    const jy = rng.signed();
    for (let k = 0; k < perCluster && out.length < totalCount; k++) {
      const radius = Math.min(world.width, world.height) * rng.range(0.01, 0.05);
      const ang = rng.range(0, Math.PI * 2);
      out.push({
        x: cx + Math.cos(ang) * radius,
        y: cy + Math.sin(ang) * radius,
        vx: jx * 2,
        vy: jy * 2,
        energy: 1.0,
        genomeRow: noiseGenomeRow(archetype, rng, ARCHETYPE_NOISE)
      });
    }
  }
  return out;
}

/** Per-slot Gaussian noise scale applied when copying an archetype to a sibling. */
const ARCHETYPE_NOISE = 0.05;

function noiseGenomeRow(
  archetype: Float32Array,
  rng: Rng,
  scale: number
): Float32Array {
  const row = new Float32Array(archetype.length);
  for (let i = 0; i < archetype.length; i++) {
    const a = archetype[i] ?? 0;
    if (i === GENOME.velAxisBias) {
      row[i] = a; // categorical
      continue;
    }
    row[i] = a + rng.gaussian(0, scale);
  }
  return row;
}
