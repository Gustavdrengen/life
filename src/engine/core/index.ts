/**
 * Engine core barrel — single import for the headless CPU reference
 * implementation. The GPU compute pipeline mirrors this surface.
 */
export * from './genome.js';
export * from './rng.js';
export * from './particles.js';
export * from './allocator.js';
export { createSignalField, clearSignalField, deposit, sample } from './field.js';
export type { SignalField, WorldDims } from './field.js';
export * from './response.js';
export * from './emission.js';
export * from './forces.js';
export * from './world.js';
export * from './seeds.js';
export * from './step.js';
export * from './snapshot.js';
export * from './clipboard.js';
export * from './timeline.js';
export * from './clusters.js';
