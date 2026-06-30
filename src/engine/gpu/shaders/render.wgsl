// WebGPU render shader — draw the signal field as a
// fullscreen quad and the alive particles as a per-instance
// color point.
//
// Spec: specs/gpu_pipeline.md §6 (render path).
//
// Two passes per render frame:
//  1. Fullscreen field — sample the lattice at each pixel
//     (bilinear), write the colorblind-safe axis triple
//     (signal-A #5fb3ff / signal-B #ff7d52 / signal-C
//     #b56cff). The output is a non-indexed triangle strip
//     covering the entire framebuffer.
//  2. Per-particle instanced — one quad per alive particle.
//     The vertex shader fetches the genome row and emits
//     the genome-derived color; the fragment shader writes
//     a saturated particle square.

struct FieldUniforms {
  width: u32,
  height: u32,
  latticeResolution: u32,
  worldWidth: f32,
  worldHeight: f32,
  /// Visibility flags — non-zero enables the field layer.
  showField: u32,
  showDust: u32,
  showClusters: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<uniform> fieldUniforms: FieldUniforms;
@group(0) @binding(1) var<storage, read> field: array<f32>;

// ---------- Field pass ----------

struct VsFieldOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) cellCoord: vec2<f32>,
};

@vertex
fn vs_field_main(@builtin(vertex_index) vi: u32) -> VsFieldOut {
  // A 3-vertex triangle that covers the entire screen.
  // We use the standard fullscreen-triangle trick — generate
  // a single oversized triangle whose corners are clipped to
  // the viewport.
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  let p = positions[vi];
  var out: VsFieldOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  // Map the screen-space coordinate to a cell coordinate in
  // the lattice. The screen covers (0, 0) to (width, height)
  // in pixels; we map to (0, 0) to (latticeResolution,
  // latticeResolution) in cell units.
  out.cellCoord = vec2<f32>(
    (p.x * 0.5 + 0.5) * f32(fieldUniforms.latticeResolution),
    (1.0 - (p.y * 0.5 + 0.5)) * f32(fieldUniforms.latticeResolution)
  );
  return out;
}

@fragment
fn fs_field_main(in: VsFieldOut) -> @location(0) vec4<f32> {
  // Bilinear sample of the field at the screen coordinate.
  let lat = f32(fieldUniforms.latticeResolution);
  let cx = clamp(in.cellCoord.x, 0.0, lat - 1.0);
  let cy = clamp(in.cellCoord.y, 0.0, lat - 1.0);
  let ix = u32(floor(cx));
  let iy = u32(floor(cy));
  let fx = cx - f32(ix);
  let fy = cy - f32(iy);
  let i00 = (iy * fieldUniforms.latticeResolution + ix) * 3u;
  let i10 = i00 + 3u;
  let i01 = i00 + fieldUniforms.latticeResolution * 3u;
  let i11 = i01 + 3u;
  let s00 = vec3<f32>(field[i00 + 0u], field[i00 + 1u], field[i00 + 2u]);
  let s10 = vec3<f32>(field[i10 + 0u], field[i10 + 1u], field[i10 + 2u]);
  let s01 = vec3<f32>(field[i01 + 0u], field[i01 + 1u], field[i01 + 2u]);
  let s11 = vec3<f32>(field[i11 + 0u], field[i11 + 1u], field[i11 + 2u]);
  let v0 = mix(s00, s10, vec3<f32>(fx, fx, fx));
  let v1 = mix(s01, s11, vec3<f32>(fx, fx, fx));
  let s = mix(v0, v1, vec3<f32>(fy, fy, fy));
  // Colorblind palette: signal-A #5fb3ff / signal-B #ff7d52 /
  // signal-C #b56cff (per VISION §Constraints). The constants
  // are pre-multiplied by 1/255 so the shader does one mul
  // per axis.
  let r = s.x * 0.3725 + s.y * 1.0 + s.z * 0.7098;
  let g = s.x * 0.7019 + s.y * 0.4901 + s.z * 0.4235;
  let b = s.x * 1.0 + s.y * 0.3215 + s.z * 1.0;
  // 0.18 mixes with the dark background to match the existing
  // Canvas2D renderer's field opacity.
  let k = 0.18;
  return vec4<f32>(r * k + 0.0392, g * k + 0.0470, b * k + 0.0627, 1.0);
}

// ---------- Particle pass ----------

@group(0) @binding(0) var<uniform> particleUniforms: FieldUniforms;
@group(0) @binding(1) var<storage, read> genomes: array<f32>;
@group(0) @binding(2) var<storage, read> positions: array<f32>;
@group(0) @binding(3) var<storage, read> alive: array<u32>;
@group(0) @binding(4) var<storage, read> isDust: array<u32>;

struct VsParticleOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) isDust: f32,
};

const GENOME_LENGTH: u32 = 77u;
const EMIT_BASE_OFFSET: u32 = 71u;

@vertex
fn vs_particle_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsParticleOut {
  // Per-particle instanced draw — one quad per alive
  // particle. The vertex index maps to a corner of a 2x2
  // quad centered on the particle's position.
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );
  let corner = corners[vi];
  let posBase = ii * 2u;
  let x = positions[posBase + 0u];
  let y = positions[posBase + 1u];
  // Map world units to NDC. The framebuffer is
  // (width × height) pixels; we want 1 world unit = a fixed
  // pixel size, so divide by worldWidth / width to get NDC.
  let ndcX = (x / particleUniforms.worldWidth) * 2.0 - 1.0;
  let ndcY = 1.0 - (y / particleUniforms.worldHeight) * 2.0;
  // Particle pixel size — 2 world units of half-size.
  let halfSizeX = 2.0 / particleUniforms.worldWidth;
  let halfSizeY = 2.0 / particleUniforms.worldHeight;
  var out: VsParticleOut;
  out.pos = vec4<f32>(
    ndcX + corner.x * halfSizeX,
    ndcY + corner.y * halfSizeY,
    0.0,
    1.0
  );
  // Genome-derived particle color: emitBase[0..2] map to
  // signal axes the same way the field pass does.
  let genBase = ii * GENOME_LENGTH;
  let baseX = clamp(genomes[genBase + EMIT_BASE_OFFSET + 0u], 0.0, 1.0);
  let baseY = clamp(genomes[genBase + EMIT_BASE_OFFSET + 1u], 0.0, 1.0);
  let baseZ = clamp(genomes[genBase + EMIT_BASE_OFFSET + 2u], 0.0, 1.0);
  out.color = vec3<f32>(
    baseX * 0.3725 + baseY * 1.0 + baseZ * 0.7098,
    baseX * 0.7019 + baseY * 0.4901 + baseZ * 0.4235,
    baseX * 1.0 + baseY * 0.3215 + baseZ * 1.0
  );
  out.isDust = isDust[ii];
  return out;
}

@fragment
fn fs_particle_main(in: VsParticleOut) -> @location(0) vec4<f32> {
  // Dust renders as a mute gray. Aligned with
  // src/lib/palette.ts DUST_COLOR = #3b4252 = (0.2314,
  // 0.2588, 0.3216).
  if (in.isDust > 0.5) {
    return vec4<f32>(0.2314, 0.2588, 0.3216, 1.0);
  }
  return vec4<f32>(in.color, 1.0);
}
