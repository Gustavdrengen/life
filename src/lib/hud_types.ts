/**
 * Shared UI types. Imported by Svelte components to keep component
 * script-blocks parser-clean for ESLint flat config.
 */
export type Reset = () => void;
export type SaveSnapshot = () => void;
export type LoadSnapshot = () => void;
export type CopyOrganism = () => void;
export type PasteOrganism = () => void;
export type ScrubTo = (tick: number) => void;

export interface InspectorView {
  /** Slot index in the engine's ParticleStorage. */
  slot: number;
  tick: number;
  energy: number;
  age: number;
  velocity: readonly [number, number];
  /** 3-axis signal at the particle's position. */
  localSignal: readonly [number, number, number];
  /** Genome row — index aligned to GENOME constants in the engine. */
  genome: readonly number[];
}

export interface HudProps {
  fps: number;
  population: number;
  dustCount: number;
  tick: number;
  config: {
    signalCutoff: number;
    latticeResolution: number;
    predationSpeedThreshold: number;
    dustAbsorbSpeed: number;
    contactSeparation: number;
    dustDecayPerSec: number;
  };
  inspector: InspectorView | null;
  onClearInspector: () => void;
  onReset: Reset;
  onStep: () => void;
  onTogglePause: () => void;
  onChangeConfig: (key: ConfigKey, value: number) => void;
  onSaveSnapshot: SaveSnapshot;
  onLoadSnapshot: LoadSnapshot;
  onCopyOrganism: CopyOrganism;
  onPasteOrganism: PasteOrganism;
  onScrubTo: ScrubTo;
  /** Bounds the slider can scrub through. <tick, maxTick>. */
  scrubRange: readonly [number, number];
  clipboardStatus: string;
  paused: boolean;
  initialPopulation: number;
  /** Number of detected multi-cell clusters at the current tick. */
  clusterCount: number;
  /** WebGPU adapter status surfaced for transparency: "gpu: ready"
   *  if a real device was acquired, "gpu: stub (cpu)" if the
   *  surface is the CPU-backed stub, "gpu: cpu (no WebGPU)" /
   *  "gpu: cpu (no adapter)" if the browser lacks WebGPU, or
   *  "gpu: error (...)" if adapter request failed. */
  gpuStatus: string;
}

export type ConfigKey =
  | 'signalCutoff'
  | 'latticeResolution'
  | 'predationSpeedThreshold'
  | 'dustAbsorbSpeed'
  | 'contactSeparation'
  | 'dustDecayPerSec';
