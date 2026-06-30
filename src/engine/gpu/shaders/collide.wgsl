// WebGPU compute shader — collision pass (spatial-hash + bounce + predation).
//
// Spec: specs/gpu_pipeline.md §4.4 (compute pass: collision).
//
// The CPU reference's collision pass is O(N²) over all particle
// pairs. The GPU pass uses a 2D spatial hash with cell size
// `2 × contactSeparation` so each particle only compares against
// particles in its own bucket + the 8-neighborhood. Average cost
// drops to O(N) for uniformly distributed populations.
//
// Each thread handles one particle. The thread:
//   1. Computes its bucket cell.
//   2. Scans its own bucket + 8 neighbors (the 3×3 cell window).
//   3. For each pair within `contactSeparation`:
//      a. Always: elastic bounce (positions projected to
//         contact, velocities reflected along the normal).
//      b. If relative speed > `predationSpeedThreshold`: the
//         faster particle absorbs the slower.
//
// The pass also marks absorbed slots in a `victim` array. The
// fission pass later turns those slots into daughters of the
// predator.
//
// Bindings:
//   @binding(0) — positions_rw
//   @binding(1) — velocities_rw
//   @binding(2) — energies_rw
//   @binding(3) — alive_rw
//   @binding(4) — isDust
//   @binding(5) — bucketHead: array<u32> (size = bucketCount)
//   @binding(6) — bucketNext: array<u32> (size = capacity)
//   @binding(7) — victim: array<u32> (size = capacity, 0/1)
//   @binding(8) — CollideParams

@group(0) @binding(0) var<storage, read_write> positions: array<f32>;
@group(0) @binding(1) var<storage, read_write> velocities: array<f32>;
@group(0) @binding(2) var<storage, read_write> energies: array<f32>;
@group(0) @binding(3) var<storage, read_write> alive: array<u32>;
@group(0) @binding(4) var<storage, read> isDust: array<u32>;
@group(0) @binding(5) var<storage, read> bucketHead: array<u32>;
@group(0) @binding(6) var<storage, read> bucketNext: array<u32>;
@group(0) @binding(7) var<storage, read_write> victim: array<u32>;

struct CollideParams {
  bucketCount: u32,
  capacity: u32,
  contactSeparation: f32,
  predationSpeedThreshold: f32,
  worldWidth: f32,
  worldHeight: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(8) var<uniform> params: CollideParams;

/// Genome layout constants.
const GENOME_LENGTH: u32 = 77u;
const GENOME_RADIUS_OFFSET: u32 = 1u;

@compute @workgroup_size(64)
fn collide_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.capacity) { return; }
  if (alive[i] == 0u) { return; }

  let posBase = i * 2u;
  let x = positions[posBase + 0u];
  let y = positions[posBase + 1u];
  let vx = velocities[posBase + 0u];
  let vy = velocities[posBase + 1u];
  let ri = 1.0; // radius — full genome read is post-MVP

  // Compute this particle's bucket cell.
  let bucketSize = params.contactSeparation * 2.0;
  let cellsX = u32(ceil(params.worldWidth / bucketSize));
  let cellsY = u32(ceil(params.worldHeight / bucketSize));
  let cx = u32(clamp(x / bucketSize, 0.0, f32(cellsX) - 1.0));
  let cy = u32(clamp(y / bucketSize, 0.0, f32(cellsY) - 1.0));

  // Walk the 3×3 neighborhood of buckets. For each bucket,
  // follow the linked list of particles via `bucketNext`.
  for (var dy: i32 = -1; dy <= 1; dy = dy + 1) {
    for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
      let nx = i32(cx) + dx;
      let ny = i32(cy) + dy;
      if (nx < 0 || ny < 0 || nx >= i32(cellsX) || ny >= i32(cellsY)) {
        continue;
      }
      let bucketIdx = u32(ny) * cellsX + u32(nx);
      if (bucketIdx >= params.bucketCount) { continue; }
      var j = bucketHead[bucketIdx];
      var guard: u32 = 0u;
      // Traverse the linked list. The `guard` is a hard cap
      // against a corrupted bucket (e.g. after a write race);
      // 1024 is well above the expected bucket occupancy.
      while (j != 0xFFFFFFFFu && guard < 1024u) {
        guard = guard + 1u;
        // Skip self, dead, and dust-on-dust contacts.
        if (j != i && alive[j] == 1u) {
          let jx = positions[j * 2u + 0u];
          let jy = positions[j * 2u + 1u];
          let rj = 1.0; // radius — full genome read is post-MVP
          let minSep = (ri + rj) * params.contactSeparation;
          let ddx = jx - x;
          let ddy = jy - y;
          let distSq = ddx * ddx + ddy * ddy;
          if (distSq < minSep * minSep && distSq > 1e-12) {
            let dist = sqrt(distSq);
            let nxN = ddx / dist;
            let nyN = ddy / dist;
            let overlap = minSep - dist;
            // Project both particles back to the contact
            // boundary. The CPU reference uses equal mass; so
            // do we.
            let proj = overlap * 0.5;
            positions[posBase + 0u] = x - nxN * proj;
            positions[posBase + 1u] = y - nyN * proj;
            positions[j * 2u + 0u] = jx + nxN * proj;
            positions[j * 2u + 1u] = jy + nyN * proj;
            // Elastic reflection along the contact normal.
            let viDotN = vx * nxN + vy * nyN;
            let vjDotN = velocities[j * 2u + 0u] * nxN +
                         velocities[j * 2u + 1u] * nyN;
            velocities[posBase + 0u] = vx - 2.0 * viDotN * nxN;
            velocities[posBase + 1u] = vy - 2.0 * viDotN * nyN;
            velocities[j * 2u + 0u] = velocities[j * 2u + 0u] -
                                      2.0 * vjDotN * nxN;
            velocities[j * 2u + 1u] = velocities[j * 2u + 1u] -
                                      2.0 * vjDotN * nyN;
            // Predation: the faster of the two wins if its
            // speed exceeds the threshold.
            let mySpeed = length(vec2<f32>(
              velocities[posBase + 0u],
              velocities[posBase + 1u]
            ));
            let jSpeed = length(vec2<f32>(
              velocities[j * 2u + 0u],
              velocities[j * 2u + 1u]
            ));
            if (mySpeed > params.predationSpeedThreshold &&
                jSpeed <= params.predationSpeedThreshold) {
              energies[i] = energies[i] + energies[j];
              victim[j] = 1u;
            } else if (jSpeed > params.predationSpeedThreshold &&
                       mySpeed <= params.predationSpeedThreshold) {
              energies[j] = energies[j] + energies[i];
              victim[i] = 1u;
            } else if (mySpeed > params.predationSpeedThreshold &&
                       jSpeed > params.predationSpeedThreshold &&
                       jSpeed > mySpeed) {
              energies[j] = energies[j] + energies[i];
              victim[i] = 1u;
            } else if (mySpeed > params.predationSpeedThreshold &&
                       jSpeed > params.predationSpeedThreshold) {
              energies[i] = energies[i] + energies[j];
              victim[j] = 1u;
            }
          }
        }
        j = bucketNext[j];
      }
    }
  }
}
