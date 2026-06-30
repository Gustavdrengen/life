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
}

export type ConfigKey =
  | 'signalCutoff'
  | 'latticeResolution'
  | 'predationSpeedThreshold'
  | 'dustAbsorbSpeed'
  | 'contactSeparation'
  | 'dustDecayPerSec';
