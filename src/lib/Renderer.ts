/**
 * Canvas2D renderer — draws the background gradient (a smoothed sense of
 * the signal field) and active particles as small saturated circles.
 *
 * This is the MVP reference path. The GPU compute + render pipeline is
 * `src/engine/gpu/` (post-MVP); the headless CPU engine produces the
 * state this renderer reads.
 *
 * Perf notes:
 *  - We draw field-derived background once per frame as a single
 *    `createImageData` + put + ImageData buffer fill. That's faster
 *    than thousands of `fillRect` per frame.
 *  - Particles are drawn with `fillRect` of size 2 (faster than
 *    `arc`). For particle sizes > 4 we still use `fillRect` — the
 *    MVP feels fine without anti-aliased circles.
 *  - No `shadowBlur` or blur effects — those are FPS poison.
 *
 * Type quirk: ImageData.data is treated as a readonly property in the
 * WebImageData TS type. We work around this by creating a fresh
 * ImageData each frame — the underlying buffer is cheap and the GC
 * pressure is acceptable at 60 Hz.
 */
import { PALETTE, particleColor, DUST_COLOR, ORGANISM_OUTLINE } from './palette.js';
import type { SimulationState } from '$engine/core/step.js';
import { detectClusters } from '$engine/core/index.js';

export interface RenderOptions {
  /** Filed drawing resolution — sub-samples the lattice to this many
   *  pixels per axis in the image. Lower is faster. Default 192. */
  backgroundResolution: number;
  /** Particle pixel radius. Default 2.0. */
  particleRadius: number;
  /** Show dust (default true). */
  showDust: boolean;
  /** Show signal field background (default true). */
  showField: boolean;
  /** Show cluster-detection outlines highlighting emergent multi-cell
   * organisms. Default true — free when clusters are absent. */
  showClusters: boolean;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  backgroundResolution: 192,
  particleRadius: 2.0,
  showDust: true,
  showField: true,
  showClusters: true
};

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private pixelBuf: Uint8ClampedArray = new Uint8ClampedArray(0);
  private cachedOptions: RenderOptions = DEFAULT_RENDER_OPTIONS;
  private lastFieldHash = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.syncPixelBuffer();
  }

  private syncPixelBuffer(): void {
    const len = this.canvas.width * this.canvas.height * 4;
    if (this.pixelBuf.length !== len) {
      this.pixelBuf = new Uint8ClampedArray(len);
    }
  }

  /** Resize the underlying image buffer in place when the canvas size changes. */
  resize(w: number, h: number): void {
    // Match the canvas internal pixel buffer size.
    this.canvas.width = w;
    this.canvas.height = h;
    this.syncPixelBuffer();
    this.lastFieldHash = -1; // force redraw
  }

  render(state: SimulationState, options: RenderOptions): void {
    this.cachedOptions = options;

    // Background: solid color first.
    const { ctx, canvas } = this;
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (options.showField) this.drawFieldBackground(state);

    this.drawParticles(state);

    if (options.showClusters) this.drawClusterOutlines(state);
  }

  private drawFieldBackground(state: SimulationState): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const bg = this.cachedOptions.backgroundResolution;
    const cellW = w / bg;
    const cellH = h / bg;
    const fieldRes = state.field.resolution;
    const fieldCells = state.field.cells;

    // Cheap hash to skip redraws when nothing visibly changed.
    let hash = 0;
    for (
      let i = 0;
      i < fieldCells.length;
      i += Math.max(1, Math.floor(fieldCells.length / 64))
    ) {
      hash = (hash * 31 + Math.floor(fieldCells[i]! * 1000)) | 0;
    }
    void this.lastFieldHash; // hash-cache optimization is post-MVP
    this.lastFieldHash = hash;

    const buf = this.pixelBuf;
    for (let py = 0; py < h; py++) {
      const fy = py / cellH;
      for (let px = 0; px < w; px++) {
        const fx = px / cellW;
        const cx = clampInt(Math.floor(fx), 0, fieldRes - 1);
        const cy = clampInt(Math.floor(fy), 0, fieldRes - 1);
        const idx = (cy * fieldRes + cx) * 3;
        const s0 = clamp01(fieldCells[idx]!);
        const s1 = clamp01(fieldCells[idx + 1]!);
        const s2 = clamp01(fieldCells[idx + 2]!);
        const r = Math.floor(s0 * 0x5f + s1 * 0xff + s2 * 0xb5);
        const g = Math.floor(s0 * 0xb3 + s1 * 0x7d + s2 * 0x6c);
        const b = Math.floor(s0 * 0xff + s1 * 0x52 + s2 * 0xff);
        const k = 0.18;
        const off = (py * w + px) * 4;
        buf[off] = Math.floor(r * k + 0x0a * (1 - k));
        buf[off + 1] = Math.floor(g * k + 0x0c * (1 - k));
        buf[off + 2] = Math.floor(b * k + 0x10 * (1 - k));
        buf[off + 3] = 255;
      }
    }
    // Construct a fresh ImageData each frame: ImageData.data is typed
    // readonly in modern DOM types, but at runtime is a plain Uint8ClampedArray.
    const img = new ImageData(new Uint8ClampedArray(buf), w, h);
    ctx.putImageData(img, 0, 0);
  }

  private drawParticles(state: SimulationState): void {
    const { ctx, canvas } = this;
    const r = this.cachedOptions.particleRadius;
    const w = canvas.width;
    const h = canvas.height;
    const sx = w / state.world.width;
    const sy = h / state.world.height;
    const storage = state.storage;
    for (let i = 0; i < storage.capacity; i++) {
      if (storage.alive[i] === 0) continue;
      const isDust = storage.isDust[i]!;
      if (isDust === 1 && !this.cachedOptions.showDust) continue;
      const px = Math.floor(storage.positionsSoA[i * 2]! * sx);
      const py = Math.floor(storage.positionsSoA[i * 2 + 1]! * sy);
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const genomeRow = storage.genomesSoA.subarray(i * 77, (i + 1) * 77);
      ctx.fillStyle = isDust === 1 ? DUST_COLOR : particleColor(genomeRow);
      ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
    }
  }

  /** Draw a low-saturation outline around each detected multi-cell
   * cluster's bounding box. The outline color is intentionally
   * contrast-shifted from the signal field so emergent organisms read
   * at a glance — see PALETTE.organismOutline (VISION §Constraints
   * colorblind palette). */
  private drawClusterOutlines(state: SimulationState): void {
    const { ctx, canvas } = this;
    // Skip clusters analysis entirely if the population is tiny — the
    // outline is meaningless on a near-empty world and adds N^2 work.
    if (state.storage.activeCount < 4) return;
    const clusters = detectClusters(state, { neighborRadius: 8, minClusterSize: 2 });
    if (clusters.length === 0) return;
    const sx = canvas.width / state.world.width;
    const sy = canvas.height / state.world.height;
    ctx.strokeStyle = ORGANISM_OUTLINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    for (const c of clusters) {
      const x0 = Math.max(0, Math.floor(c.bbox.minX * sx));
      const y0 = Math.max(0, Math.floor(c.bbox.minY * sy));
      const x1 = Math.min(canvas.width - 1, Math.ceil(c.bbox.maxX * sx));
      const y1 = Math.min(canvas.height - 1, Math.ceil(c.bbox.maxY * sy));
      ctx.strokeRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    }
    ctx.setLineDash([]);
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v | 0;
}
