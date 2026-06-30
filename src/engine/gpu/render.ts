// Render pipeline surface — consumes the GPU's signal field
// and per-particle arrays and renders them to a canvas via
// WebGPU.
//
// Spec: specs/gpu_pipeline.md §6 (render path).
//
// The render pass is the third post-MVP piece the state-of-
// play entry flagged as outstanding. The CPU reference's
// `Renderer.ts` continues to work for the App's primary
// render path; this module is the WebGPU-native replacement
// that becomes active when a real adapter is acquired.

interface RenderOptions {
  width: number;
  height: number;
  backgroundResolution: number;
  showField: boolean;
  showDust: boolean;
  showClusters: boolean;
}

/** Acquire the WebGPU canvas context + configure the swap
 *  chain. Throws if the canvas doesn't expose a `getContext('webgpu')`
 *  surface. */
export function acquireGpuCanvasContext(
  canvas: HTMLCanvasElement,
  device: GPUDevice
): GPUCanvasContext {
  if (typeof canvas.getContext !== 'function') {
    throw new Error('acquireGpuCanvasContext: canvas.getContext is not a function');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (canvas.getContext('webgpu') as any) as GPUCanvasContext | null;
  if (!ctx) {
    throw new Error(
      'acquireGpuCanvasContext: canvas does not expose a WebGPU context'
    );
  }
  ctx.configure({
    device,
    format: 'bgra8unorm',
    alphaMode: 'opaque'
  });
  return ctx;
}

/** Render a frame from the GPU's field + particle buffers to
 *  the canvas. The implementation is post-MVP — the surface
 *  is wired so a real headed browser can call it once a
 *  swap chain + pipeline module are added. */
export function renderGpuFrame(
  _ctx: GPUCanvasContext,
  _options: RenderOptions,
  _uniforms: Float32Array,
  _field: Float32Array
): void {
  // Render pass lands in a follow-up commit. The function
  // exists to give the App shell a typed entry point and
  // match the WGSL render shader's input contract.
}
