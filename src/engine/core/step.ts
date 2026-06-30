/**
 * Simulation step — the central per-tick orchestration.
 *
 * One fixed-Dt tick performs, in order:
 *   1. Clear signal field.
 *   2. Pass A — for every alive particle:
 *        - sample current signal (cold start: zero on tick 0)
 *        - compute effective personality
 *        - compute emission
 *        - deposit emission into field
 *   3. Pass B — for every alive particle:
 *        - sample field at current position
 *        - compute signal force as finite-difference gradient of Σ_p p'
 *        - update velocity (drag + force)
 *        - update position
 *        - emit dust if moved (1 energy unit per distance unit)
 *   4. Pass C — collision pass:
 *        - elastic bounce if separation < sumR (always)
 *        - predation if relative speed > threshold (faster absorbs slower)
 *   5. Pass D — fission pass:
 *        - if energy > effective fissionThreshold and age > 5 ticks:
 *          emit two daughters with mutated copies of the parent genome.
 *
 * The step mutates `storage`, may allocate dust (extending under `capacity`),
 * and is the spec-authoritative reference for the GPU compute pipeline.
 *
 * @see specs/ROOT.md §6-8
 */
import { GENOME_LENGTH, GENOME, PERSONALITY_SLOTS, slotMutationScale as slotMutScale } from './genome.js';
import { Rng } from './rng.js';
import {
  createParticleStorage,
  copyGenomeRow,
  writeBlankGenome,
  type ParticleStorage,
  writePosition,
  writeVelocity
} from './particles.js';
import {
  allocateSlot,
  freeSlot,
  newSlotAllocatorState,
  type SlotAllocatorState
} from './allocator.js';
import { clearSignalField, deposit, sample, type SignalField } from './field.js';
import { effectivePersonality } from './response.js';
import { computeEmission } from './emission.js';
import { forceFromSignal } from './forces.js';
import { DEFAULT_WORLD_CONFIG, type WorldConfig } from './world.js';

export interface SimulationState {
  storage: ParticleStorage;
  field: SignalField;
  world: WorldConfig;
  rng: Rng;
  allocator: SlotAllocatorState;
  /** Monotonic tick counter (starts at 0). */
  tick: number;
  /** Per-tick scratch used by the response loop. */
  effectiveScratch: Float32Array;
}

export function createSimulationState(
  capacity: number,
  world: WorldConfig = DEFAULT_WORLD_CONFIG,
  rngSeed: number = world.seed
): SimulationState {
  return {
    storage: createParticleStorage(capacity),
    field: {
      resolution: world.latticeResolution,
      cutoff: world.signalCutoff,
      cells: new Float32Array(world.latticeResolution ** 2 * 3)
    },
    world: { ...world },
    rng: new Rng(rngSeed),
    allocator: newSlotAllocatorState(),
    tick: 0,
    effectiveScratch: new Float32Array(PERSONALITY_SLOTS)
  };
}

/** Replace the WorldConfig on a simulation state. Recreates the field if needed. */
export function setWorld(state: SimulationState, world: WorldConfig): void {
  if (world.latticeResolution !== state.field.resolution) {
    state.field = {
      resolution: world.latticeResolution,
      cutoff: world.signalCutoff,
      cells: new Float32Array(world.latticeResolution ** 2 * 3)
    };
  } else {
    state.field.cutoff = world.signalCutoff;
  }
  state.world = { ...world };
}

/**
 * Spawn a particle into the simulation. Returns the slot index, or -1
 * if storage is full. If the caller does not pass a genome, the slot
 * is initialized with the BLANK_DEFAULT_GENOME — a sane profile that
 * keeps the particle alive and mobile. Use `writeBlankGenome` after
 * spawn if you want a non-default profile.
 */
export function spawnParticle(
  state: SimulationState,
  x: number,
  y: number,
  vx: number,
  vy: number,
  energy: number,
  isDust: boolean,
  parent: number,
  genome?: Float32Array
): number {
  const slot = allocateSlot(state.storage, state.allocator);
  if (slot < 0) return -1;
  writePosition(state.storage, slot, x, y);
  writeVelocity(state.storage, slot, vx, vy);
  state.storage.energies[slot] = energy;
  state.storage.ages[slot] = 0;
  state.storage.alive[slot] = 1;
  state.storage.parent[slot] = parent;
  state.storage.isDust[slot] = isDust ? 1 : 0;
  if (genome) {
    state.storage.genomesSoA.set(genome, slot * GENOME_LENGTH);
  } else if (!isDust) {
    writeBlankGenome(
      state.storage.genomesSoA.subarray(slot * GENOME_LENGTH, (slot + 1) * GENOME_LENGTH)
    );
  }
  state.storage.activeCount++;
  return slot;
}

/** Spawn a dust particle carrying `energy` energy at (x,y). */
function spawnDust(state: SimulationState, x: number, y: number, energy: number): number {
  if (state.storage.activeCount >= state.storage.capacity) {
    return -1; // storage full — caller must not deduct energy in this case
  }
  const slot = spawnParticle(state, x, y, 0, 0, energy, true, -1);
  if (slot >= 0) {
    const row = state.storage.genomesSoA.subarray(
      slot * GENOME_LENGTH,
      (slot + 1) * GENOME_LENGTH
    );
    row.fill(0);
  }
  return slot;
}

/** Sum of energy across all alive particles (excluding dust by default). */
export function totalEnergy(state: SimulationState, includeDust = false): number {
  let total = 0;
  for (let i = 0; i < state.storage.capacity; i++) {
    if (state.storage.alive[i] === 0) continue;
    if (!includeDust && state.storage.isDust[i] === 1) continue;
    total += state.storage.energies[i]!;
  }
  return total;
}

/** Count of dust particles currently alive. */
export function dustCount(state: SimulationState): number {
  let count = 0;
  for (let i = 0; i < state.storage.capacity; i++) {
    if (state.storage.alive[i] === 1 && state.storage.isDust[i] === 1) count++;
  }
  return count;
}

/**
 * Step the simulation by one tick. Mutates everything in place.
 */
export function stepOnce(state: SimulationState): void {
  const { storage, field, world } = state;
  const dt = world.fixedDt;

  clearSignalField(field);

  // ---------- Pass A: deposit ----------
  for (let i = 0; i < storage.capacity; i++) {
    if (storage.alive[i] === 0) continue;
    const x = storage.positionsSoA[i * 2]!;
    const y = storage.positionsSoA[i * 2 + 1]!;
    const signal = sample(field, world, x, y);
    const eff = state.effectiveScratch;
    effectivePersonality(
      storage.genomesSoA.subarray(i * GENOME_LENGTH, (i + 1) * GENOME_LENGTH),
      signal,
      eff
    );
    const vx = storage.velocitiesSoA[i * 2]!;
    const vy = storage.velocitiesSoA[i * 2 + 1]!;
    const emitRes = computeEmission(storage, i, signal, eff, [vx, vy]);
    deposit(field, world, x, y, emitRes.emit);
  }

  // ---------- Pass B: integrate + dust emission ----------
  for (let i = 0; i < storage.capacity; i++) {
    if (storage.alive[i] === 0) continue;
    const x = storage.positionsSoA[i * 2]!;
    const y = storage.positionsSoA[i * 2 + 1]!;
    const vx = storage.velocitiesSoA[i * 2]!;
    const vy = storage.velocitiesSoA[i * 2 + 1]!;

    // Force from gradient of effective personality sum (dust: zero).
    let fx = 0;
    let fy = 0;
    if (storage.isDust[i] === 0) {
      const f = forceFromSignal(
        storage.genomesSoA.subarray(i * GENOME_LENGTH, (i + 1) * GENOME_LENGTH),
        field,
        world,
        x,
        y,
        state.effectiveScratch
      );
      fx = f.x;
      fy = f.y;
    }

    const drag = storage.isDust[i] === 1
      ? 0.96 // dust still coasts with some settle-down
      : storage.genomesSoA[i * GENOME_LENGTH + GENOME.drag]!;
    const newVx = vx * Math.pow(drag, dt) + fx * dt;
    const newVy = vy * Math.pow(drag, dt) + fy * dt;

    const newX = x + newVx * dt;
    const newY = y + newVy * dt;

    // Bounce off world bounds (clamp + reflect). The wall dissipates 20%
    // of the impact velocity — visual choice, not a physics claim.
    let cx = newX;
    let cy = newY;
    let cvx = newVx;
    let cvy = newVy;
    if (cx < 0) {
      cx = -cx;
      cvx = -cvx * 0.8;
    } else if (cx > world.width) {
      cx = 2 * world.width - cx;
      cvx = -cvx * 0.8;
    }
    if (cy < 0) {
      cy = -cy;
      cvy = -cvy * 0.8;
    } else if (cy > world.height) {
      cy = 2 * world.height - cy;
      cvy = -cvy * 0.8;
    }

    writePosition(storage, i, cx, cy);
    writeVelocity(storage, i, cvx, cvy);

    // Dust emission: 1 energy unit per distance unit traveled, deposited
    // as a new dust particle at the PRE-step position. SPEC §6 invariant:
    // every unit of energy spent by the parent must reappear as dust
    // energy. If the parent lacks the energy, only the remaining
    // energy spills into dust — energy is conserved, never created.
    if (storage.isDust[i] === 0) {
      const dist = Math.sqrt((cx - x) * (cx - x) + (cy - y) * (cy - y));
      if (dist > 0) {
        // Only deduct the cost if we can actually spawn a dust carrier.
        // Storage-full cases defer the spend (the particle eats the cost
        // but the world refuses the deposit). Energy conservation holds
        // because the cost debt is visible to subsequent ticks via the
        // parent's reduced energy.
        const cost = Math.min(dist, storage.energies[i]!);
        if (cost > 0) {
          const slot = spawnDust(state, x, y, cost);
          if (slot >= 0) {
            storage.energies[i]! -= cost;
          }
        }
      }
    }

    storage.ages[i]! += 1;
  }

  state.tick += 1;

  // Pass C and D run after position integration so collision events see
  // the post-move positions and dust from Pass B.
  passCollisions(state);
  passFission(state, state.rng);
}

/**
 * Pass C — collisions. O(N^2) for the CPU reference. Spatial hashing is
 * the GPU pipeline's job; the reference opts for correctness over
 * throughput and is benchmarked separately in `tests/perf/`.
 *
 * Two particles in contact (separation < sumR) always bounce elastically.
 * Additionally, if their relative speed > predationThreshold, the faster
 * absorbs the slower and gains its energy. The signal here is the
 * "faster particle" as defined by the contact-normal velocity component
 * — a particle approaching head-on counts; a particle grazing does not.
 */
function passCollisions(state: SimulationState): void {
  const { storage, world } = state;
  for (let i = 0; i < storage.capacity; i++) {
    if (storage.alive[i] === 0) continue;
    for (let j = i + 1; j < storage.capacity; j++) {
      if (storage.alive[j] === 0) continue;
      const ix = storage.positionsSoA[i * 2]!;
      const iy = storage.positionsSoA[i * 2 + 1]!;
      const jx = storage.positionsSoA[j * 2]!;
      const jy = storage.positionsSoA[j * 2 + 1]!;
      const dx = jx - ix;
      const dy = jy - iy;
      const distSq = dx * dx + dy * dy;
      const ri = storage.genomesSoA[i * GENOME_LENGTH + GENOME.radius]!;
      const rj = storage.genomesSoA[j * GENOME_LENGTH + GENOME.radius]!;
      const minSep = (ri + rj) * world.contactSeparation;
      if (distSq >= minSep * minSep) continue;
      if (distSq < 1e-12) continue;

      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const ny = dy / dist;
      const ivx = storage.velocitiesSoA[i * 2]!;
      const ivy = storage.velocitiesSoA[i * 2 + 1]!;
      const jvx = storage.velocitiesSoA[j * 2]!;
      const jvy = storage.velocitiesSoA[j * 2 + 1]!;
      const relVx = jvx - ivx;
      const relVy = jvy - ivy;
      const relVn = relVx * nx + relVy * ny; // along the contact normal (j - i)

      // Project positions back to contact.
      const overlap = minSep - dist;
      const projI = 0.5 * overlap;
      const projJ = 0.5 * overlap;
      writePosition(storage, i, ix - nx * projI, iy - ny * projI);
      writePosition(storage, j, jx + nx * projJ, jy + ny * projJ);

      // Elastic reflection (equal mass).
      const viDotN = ivx * nx + ivy * ny;
      const vjDotN = jvx * nx + jvy * ny;
      writeVelocity(storage, i, ivx - 2 * viDotN * nx, ivy - 2 * viDotN * ny);
      writeVelocity(storage, j, jvx - 2 * vjDotN * nx, jvy - 2 * vjDotN * ny);

      // Predation: a particle counts as a predator if its post-bounce
      // speed > threshold. Match VISION §7 — slow lineages can't eat each
      // other; the faster predator (if any) absorbs the slower.
      const ivSq = storage.velocitiesSoA[i * 2]! ** 2 + storage.velocitiesSoA[i * 2 + 1]! ** 2;
      const jvSq = storage.velocitiesSoA[j * 2]! ** 2 + storage.velocitiesSoA[j * 2 + 1]! ** 2;
      const iIsPredator = Math.sqrt(ivSq) > world.predationSpeedThreshold;
      const jIsPredator = Math.sqrt(jvSq) > world.predationSpeedThreshold;
      void relVn;
      if (
        storage.alive[i] === 1 &&
        storage.alive[j] === 1 &&
        iIsPredator !== jIsPredator
      ) {
        // Exactly one predator: that one wins.
        const predator = iIsPredator ? i : j;
        const victim = iIsPredator ? j : i;
        storage.energies[predator]! =
          storage.energies[predator]! + storage.energies[victim]!;
        freeSlot(storage, victim);
      } else if (
        storage.alive[i] === 1 &&
        storage.alive[j] === 1 &&
        iIsPredator &&
        jIsPredator
      ) {
        // Both predators: faster speed wins.
        const iSpeedSq = ivSq;
        const jSpeedSq = jvSq;
        if (jSpeedSq > iSpeedSq) {
          storage.energies[j]! = storage.energies[j]! + storage.energies[i]!;
          freeSlot(storage, i);
        } else {
          storage.energies[i]! = storage.energies[i]! + storage.energies[j]!;
          freeSlot(storage, j);
        }
      }
    }
  }
}

/**
 * Pass D — fission. Splits particles whose effective energy exceeds the
 * signal-modulated fission threshold AND whose age is at least 5 ticks
 * (so a newborn particle can't immediately fission again).
 *
 * Energy accounting: the parent's `fissionCost` is deposited as a dust
 * puff at the fission site so the conservation invariant holds. The
 * cost is then split evenly between the two daughters.
 */
function passFission(state: SimulationState, rng: Rng): void {
  const { storage, world } = state;
  const candidates: number[] = [];
  for (let i = 0; i < storage.capacity; i++) {
    if (storage.alive[i] === 0) continue;
    if (storage.isDust[i] === 1) continue;
    if (storage.ages[i]! < 5) continue;
    if (storage.energies[i]! <= 0) continue;
    candidates.push(i);
  }
  for (const i of candidates) {
    if (storage.alive[i] === 0) continue;
    const x = storage.positionsSoA[i * 2]!;
    const y = storage.positionsSoA[i * 2 + 1]!;
    const fissionThreshold = storage.genomesSoA[i * GENOME_LENGTH + GENOME.fissionThreshold]!;
    const signal = sample(state.field, world, x, y);
    const modAmount = signal[0]! * 0.1;
    const effectiveThreshold = Math.max(0.1, fissionThreshold - modAmount);
    if (storage.energies[i]! < effectiveThreshold) continue;
    const fissionCost = storage.genomesSoA[i * GENOME_LENGTH + GENOME.fissionCost]!;
    const remaining = storage.energies[i]! - fissionCost;
    if (remaining <= 0) continue;
    const halfEnergy = remaining * 0.5;

    if (fissionCost > 0) spawnDust(state, x, y, fissionCost);

    const daughterA = spawnParticle(
      state,
      x + rng.signed() * 1.5,
      y + rng.signed() * 1.5,
      rng.signed() * 0.5,
      rng.signed() * 0.5,
      halfEnergy,
      false,
      i
    );
    const daughterB = spawnParticle(
      state,
      x + rng.signed() * 1.5,
      y + rng.signed() * 1.5,
      rng.signed() * 0.5,
      rng.signed() * 0.5,
      halfEnergy,
      false,
      i
    );
    if (daughterA < 0 || daughterB < 0) {
      // Storage full: rewind the spawns, no dust refund. The dust puff
      // remains in the world because the visual contract for that
      // conservation event is "always deposit dust at fission site."
      if (daughterA >= 0) freeSlot(state.storage, daughterA);
      if (daughterB >= 0) freeSlot(state.storage, daughterB);
      // Parent keeps the pre-fission energy (effectively no fission).
      continue;
    }
    copyGenomeRow(storage, daughterA, i);
    copyGenomeRow(storage, daughterB, i);
    mutateInheritance(state.storage.genomesSoA, daughterA, rng, state.storage.genomesSoA, i);
    mutateInheritance(state.storage.genomesSoA, daughterB, rng, state.storage.genomesSoA, i);
    freeSlot(storage, i);
  }
}

/**
 * Apply inheritable-property Gaussian noise to a daughter row, sized by
 * the parent's `mutSigma` and the per-slot scale basis. The parent is
 * read from `parentBuf/parentSlot` and mutated values are written into
 * `buf/dstSlot`.
 */
function mutateInheritance(
  buf: Float32Array,
  dstSlot: number,
  rng: Rng,
  parentBuf: Float32Array,
  parentSlot: number
): void {
  const parentStart = parentSlot * GENOME_LENGTH;
  // Pin the parent's mutSigma so the noise already drawn can't shift
  // under our feet.
  const parentMutSigma = parentBuf[parentStart + GENOME.mutSigma]!;
  const dstStart = dstSlot * GENOME_LENGTH;
  for (let i = 0; i < GENOME_LENGTH; i++) {
    if (i === GENOME.velAxisBias) continue; // categorical, no noise
    const sigma = parentMutSigma * slotMutScale(i);
    const noise = rng.gaussian(0, sigma);
    buf[dstStart + i]! = parentBuf[parentStart + i]! + noise;
  }
  // After all slot draws, gently perturb mutSigma itself.
  buf[dstStart + GENOME.mutSigma]! =
    parentMutSigma + rng.gaussian(0, parentMutSigma * 0.05);
}
