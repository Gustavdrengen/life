/**
 * Color palette helpers — maps signal-field components and genome position
 * to displayable colors. Colorblind-friendly high-contrast triples are
 * baked in; the HUD exposes a toggle only for the rendering layer.
 *
 * Vision decision (see specs/ROOT.md §11): the default axes map is
 * `#5fb3ff` (signal-A, blue), `#ff7d52` (signal-B, orange),
 * `#b56cff` (signal-C, magenta). The triple is chosen to remain
 * discriminable under the most common deuteranopia + protanopia
 * simulations.
 *
 * Particle color is computed from the genome's trailing emitBase slot
 * so a particle's color is stable across frames and across the field.
 */

import { GENOME, GENOME_LENGTH } from '$engine/core/genome.js';

export const PALETTE = {
  signalA: '#5fb3ff',
  signalB: '#ff7d52',
  signalC: '#b56cff',
  bg: '#0a0c10',
  panel: '#11141a',
  panelEdge: '#1a1f28',
  primaryText: '#e6e8ec',
  secondaryText: '#a4abb9',
  warn: '#ffb454',
  ok: '#5dd39e',
  err: '#ff6b6b',
  organismOutline: '#7a8aa0'
} as const;

/**
 * Hex string to [r, g, b] byte tuple.
 */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`invalid hex color ${hex}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/**
 * Convert a 3-axis signal vector to a CSS color string. The signal
 * components are clamped to ±1 and mapped axis-to-channel. Negative
 * signal floors to 0; positive signal rises linearly.
 */
export function signalToColor(
  signal: readonly [number, number, number]
): string {
  const a = clamp01(signal[0] ?? 0);
  const b = clamp01(signal[1] ?? 0);
  const c = clamp01(signal[2] ?? 0);
  const r = a * 0x5f + b * 0xff + c * 0xb5;
  const g = a * 0xb3 + b * 0x7d + c * 0x6c;
  const bl = a * 0xff + b * 0x52 + c * 0xff;
  return `rgb(${r | 0}, ${g | 0}, ${bl | 0})`;
}

/**
 * Particle coloring — palette picks based on the genome's emitBase and
 * modulators. Two particles with similar genome regions will share hue,
 * so emergent lineages cluster visually by color.
 */
export function particleColor(genomeRow: Float32Array | null): string {
  if (genomeRow === null) return PALETTE.primaryText;
  const ax = genomeRow[GENOME.emitBaseOffset] ?? 0;
  const bx = genomeRow[GENOME.emitBaseOffset + 1] ?? 0;
  const cx = genomeRow[GENOME.emitBaseOffset + 2] ?? 0;
  return signalToColor([
    clampSigned(ax) / 2,
    clampSigned(bx) / 2,
    clampSigned(cx) / 2
  ]);
}

/** Dust coloring — fixed mute gray. */
export const DUST_COLOR = '#3b4252';
/** Organism cluster outline — low-saturation gray from VISION
 * §Constraints colorblind palette. */
export const ORGANISM_OUTLINE = PALETTE.organismOutline;

void GENOME_LENGTH;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampSigned(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}
