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
  onReset: Reset;
  onStep: () => void;
  onTogglePause: () => void;
  paused: boolean;
  initialPopulation: number;
}
