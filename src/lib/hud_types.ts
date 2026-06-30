/**
 * Shared UI types. Imported by Svelte components to keep component
 * script-blocks parser-clean for ESLint flat config.
 */
export type Reset = () => void;

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
