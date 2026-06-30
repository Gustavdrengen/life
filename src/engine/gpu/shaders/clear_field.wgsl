// WebGPU compute shader — clear the signal field lattice.
//
// Spec: specs/gpu_pipeline.md §4.1 (compute pass order: clear field).
//
// One thread per cell. The lattice holds 3 components per cell
// (axes sx, sy, sz); we clear all three to 0. The total number of
// cells is `latticeResolution²`, and the field buffer is sized
// `latticeResolution² × 3` floats.
//
// Bindings:
//   @binding(0) — field: storage<read_write> array<f32, lattice^2 * 3>;
//
// Workgroup size: 64 (a typical single-axis chunk of a 32-cell
// lattice uses 32 cells, so 64 covers two columns at once).

@group(0) @binding(0) var<storage, read_write> field: array<f32>;

struct ClearParams {
  /// Total number of cells in the lattice (latticeResolution * latticeResolution).
  cellCount: u32,
  /// Stride: 3 floats per cell.
  components: u32,
  /// Padding/reserved for 16-byte alignment.
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(1) var<uniform> params: ClearParams;

@compute @workgroup_size(64)
fn clear_field_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let cellCount = params.cellCount;
  let components = params.components;
  if (i >= cellCount) {
    return;
  }
  let base = i * components;
  // Unrolled clear — 3 components per cell. A loop would also
  // work; the unroll lets the optimizer emit a flat store per
  // axis. The exact storage layout matters because the CPU
  // reference deposits into the same offsets.
  field[base + 0u] = 0.0;
  field[base + 1u] = 0.0;
  field[base + 2u] = 0.0;
}
