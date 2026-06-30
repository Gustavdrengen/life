/**
 * Simulation snapshot — pure serialization of `SimulationState` to/from
 * a single JSON document. The shape is independent of WebGPU buffer
 * representation: when the GPU pipeline lands it can adopt the same
 * layout for parity with the CPU reference.
 *
 * The format is a forward-compatible, version-stamped JSON envelope:
 *   {
 *     format: 'particle-ecosystem-simulator/snapshot',
 *     version: 1,
 *     capacity: number,
 *     activeCount: number,
 *     tick: number,
 *     rngSeed: number,
 *     world: WorldConfig,
 *     storage: {
 *       positionsSoA: number[],
 *       velocitiesSoA: number[],
 *       genomesSoA: number[],
 *       energies: number[],
 *       ages: number[],
 *       alive: number[],
 *       parent: number[],
 *       ids: number[],
 *       isDust: number[]
 *     }
 *   }
 *
 * Empty slots are emitted in the arrays but reconstructed back into the
 * SoA buffers verbatim — bit-identical save/restore is required by
 * VISION §10 success criterion #6.
 *
 * @see specs/ROOT.md §9 "Determinism, snapshots, scrubbing"
 */

import type { WorldConfig } from './world.js';
import type { SimulationState } from './step.js';
import type { ParticleStorage } from './particles.js';
import { Rng } from './rng.js';

export const SNAPSHOT_FORMAT = 'particle-ecosystem-simulator/snapshot';
export const SNAPSHOT_VERSION = 1;

export interface SnapshotEnvelope {
  format: typeof SNAPSHOT_FORMAT;
  version: typeof SNAPSHOT_VERSION;
  capacity: number;
  activeCount: number;
  tick: number;
  rngSeed: number;
  world: WorldConfig;
  storage: SerializedStorage;
}

export interface SerializedStorage {
  positionsSoA: number[];
  velocitiesSoA: number[];
  genomesSoA: number[];
  energies: number[];
  ages: number[];
  alive: number[];
  parent: number[];
  ids: number[];
  isDust: number[];
}

/** Capture the live `SimulationState` into a round-trippable envelope. */
export function captureSnapshot(state: SimulationState): SnapshotEnvelope {
  const s = state.storage;
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    capacity: s.capacity,
    activeCount: s.activeCount,
    tick: state.tick,
    rngSeed: state.rng.snapshot(),
    world: { ...state.world },
    storage: serializeStorage(s)
  };
}

/** Serialize a `ParticleStorage` to plain arrays. */
export function serializeStorage(s: ParticleStorage): SerializedStorage {
  return {
    positionsSoA: Array.from(s.positionsSoA),
    velocitiesSoA: Array.from(s.velocitiesSoA),
    genomesSoA: Array.from(s.genomesSoA),
    energies: Array.from(s.energies),
    ages: Array.from(s.ages),
    alive: Array.from(s.alive),
    parent: Array.from(s.parent),
    ids: Array.from(s.ids),
    isDust: Array.from(s.isDust)
  };
}

/** Send a snapshot envelope to JSON. Single-shot — large payloads. */
export function snapshotToString(env: SnapshotEnvelope): string {
  return JSON.stringify(env);
}

/** Parse a snapshot envelope. Throws on version/format mismatch. */
export function snapshotFromString(json: string): SnapshotEnvelope {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('snapshotFromString: top-level is not an object');
  }
  const env = parsed as Partial<SnapshotEnvelope>;
  if (env.format !== SNAPSHOT_FORMAT) {
    throw new Error(`snapshotFromString: expected format ${SNAPSHOT_FORMAT}, got ${env.format}`);
  }
  if (env.version !== SNAPSHOT_VERSION) {
    throw new Error(`snapshotFromString: version ${env.version} not supported`);
  }
  if (
    typeof env.capacity !== 'number' ||
    typeof env.activeCount !== 'number' ||
    typeof env.tick !== 'number' ||
    typeof env.rngSeed !== 'number' ||
    typeof env.world !== 'object' ||
    env.world === null ||
    typeof env.storage !== 'object' ||
    env.storage === null
  ) {
    throw new Error('snapshotFromString: missing required fields');
  }
  return env as SnapshotEnvelope;
}

/** Restore an envelope into a live `SimulationState` by mutating the
 * supplied state in place. Capacity must match. */
export function restoreSnapshot(state: SimulationState, env: SnapshotEnvelope): void {
  if (env.capacity !== state.storage.capacity) {
    throw new Error(
      `restoreSnapshot: capacity ${env.capacity} does not match current ${state.storage.capacity}`
    );
  }
  state.tick = env.tick;
  // Rng stores its state as `(seed | 0) >>> 0` with the same zero-guard
  // a fresh `new Rng(seed)` would perform, so reseeding here produces
  // an RNG bit-identical to the saved snapshot.
  state.rng = new Rng(env.rngSeed);
  state.world = { ...env.world };
  state.storage.activeCount = env.activeCount;
  applySerializedStorage(state.storage, env.storage);
}

function applySerializedStorage(target: ParticleStorage, payload: SerializedStorage): void {
  if (target.positionsSoA.length !== payload.positionsSoA.length) {
    throw new RangeError('applySerializedStorage: positions array length mismatch');
  }
  // TypedArrays don't accept `Array.from` because of lengths > 2**27.
  // We split the copy per array to keep each call trivially sized.
  copyIn(target.positionsSoA, payload.positionsSoA);
  copyIn(target.velocitiesSoA, payload.velocitiesSoA);
  copyIn(target.genomesSoA, payload.genomesSoA);
  copyIn(target.energies, payload.energies);
  copyInU(target.ages, payload.ages);
  copyInU(target.alive, payload.alive);
  copyInI(target.parent, payload.parent);
  copyInU(target.ids, payload.ids);
  copyInU(target.isDust, payload.isDust);
}

function copyIn(target: Float32Array, src: number[]): void {
  for (let i = 0; i < src.length; i++) target[i] = src[i] ?? 0;
}
function copyInU(target: Uint8Array | Uint32Array, src: number[]): void {
  for (let i = 0; i < src.length; i++) target[i] = src[i] ?? 0;
}
function copyInI(target: Int32Array, src: number[]): void {
  for (let i = 0; i < src.length; i++) target[i] = src[i] ?? 0;
}
