/**
 * Signal field — 3-component continuous lattice, emitter deposit + spatial
 * sample. The lattice is grid-aligned to the simulation volume and holds
 * three independent components per cell.
 *
 * Emitter deposit (per particle per tick):
 *   For each particle, lobe the lattice cells within world.signalCutoff
 *   along the (x,y) dimensions. The signal grid is constructed with
 *   `latticeResolution^2` cells (per VISION §3 — 2D rendering with 3-axis
 *   signal math).
 *
 * Spatial sample:
 *   Bilinear interpolation across the four nearest lattice cell corners.
 *
 * Visualization (UI only):
 *   See `src/ui/palette.ts` for the visual mapping. The lattice is rendered
 *   as a colored background overlay.
 *
 * @see specs/ROOT.md §3 "Signal field"
 */
export interface SignalField {
  resolution: number;
  cutoff: number;
  /** [resolution × resolution × 3] — signal value per cell per axis. */
  cells: Float32Array;
}

export interface WorldDims {
  width: number;
  height: number;
}

export function createSignalField(
  resolution: number,
  cutoff: number
): SignalField {
  if (resolution <= 0) throw new RangeError('resolution must be positive');
  if (cutoff <= 0) throw new RangeError('cutoff must be positive');
  return {
    resolution,
    cutoff,
    cells: new Float32Array(resolution * resolution * 3)
  };
}

export function clearSignalField(field: SignalField): void {
  field.cells.fill(0);
}

/**
 * Returns the index into `field.cells` for cell (cx, cy, axis).
 * Bounds: cx, cy in [0, resolution).
 */
function cellIndex(field: SignalField, cx: number, cy: number, axis: number): number {
  return (cy * field.resolution + cx) * 3 + axis;
}

/**
 * Deposit a signal value at world coordinate (x,y) using cubic Hermite
 * falloff over `cutoff`. The deposit visits the cells overlapped by the
 * smoothed emitter lobe.
 *
 * The falloff function is the standard Particle Life / Lenia lobe:
 *   f(r) = (1 - r/c)² · (1 + 2r/c)   for 0 ≤ r ≤ c
 *   f(r) = 0                         for r > c
 *
 * This smooth lobe is positive, strictly decreasing, with f'(0) = 0 and
 * f(c) = 0, so deposits glue smoothly across neighboring cells.
 */
export function deposit(
  field: SignalField,
  world: WorldDims,
  x: number,
  y: number,
  emit: readonly [number, number, number]
): void {
  const cellSize = world.width / field.resolution;
  const cutoff = field.cutoff;
  // Bounding box in cell space.
  const x0 = Math.floor((x - cutoff) / cellSize);
  const y0 = Math.floor((y - cutoff) / cellSize);
  const x1 = Math.ceil((x + cutoff) / cellSize);
  const y1 = Math.ceil((y + cutoff) / cellSize);
  const cMin = 0;
  const cMax = field.resolution - 1;
  for (let cy = y0; cy <= y1; cy++) {
    if (cy < cMin || cy > cMax) continue;
    const wy = cy * cellSize + cellSize * 0.5;
    for (let cx = x0; cx <= x1; cx++) {
      if (cx < cMin || cx > cMax) continue;
      const wx = cx * cellSize + cellSize * 0.5;
      const dx = wx - x;
      const dy = wy - y;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r >= cutoff) continue;
      const t = r / cutoff;
      const fall = (1 - t) * (1 - t) * (1 + 2 * t);
      for (let axis = 0; axis < 3; axis++) {
        field.cells[cellIndex(field, cx, cy, axis)]! += emit[axis]! * fall;
      }
    }
  }
}

/**
 * Sample the field at world coordinate (x, y) using bilinear interpolation.
 * Out-of-bounds clamps to the nearest in-bounds cell.
 *
 * Returns a 3-vector `[s0, s1, s2]` of signal values at that point.
 */
export function sample(
  field: SignalField,
  world: WorldDims,
  x: number,
  y: number
): [number, number, number] {
  const cellSize = world.width / field.resolution;
  let fx = x / cellSize - 0.5;
  let fy = y / cellSize - 0.5;
  const x0 = Math.max(0, Math.min(field.resolution - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(field.resolution - 1, Math.floor(fy)));
  const x1 = Math.min(field.resolution - 1, x0 + 1);
  const y1 = Math.min(field.resolution - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  // Bilinear weights.
  const w00x = 1 - tx;
  const w10x = tx;
  const w00y = 1 - ty;
  const w01y = ty;
  const result: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const v00 = field.cells[cellIndex(field, x0, y0, axis)]!;
    const v10 = field.cells[cellIndex(field, x1, y0, axis)]!;
    const v01 = field.cells[cellIndex(field, x0, y1, axis)]!;
    const v11 = field.cells[cellIndex(field, x1, y1, axis)]!;
    result[axis] =
      (v00 * w00x * w00y + v10 * w10x * w00y + v01 * w00x * w01y + v11 * w10x * w01y);
  }
  return result;
}
