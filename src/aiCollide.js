// Knocked-about AI cars (hit by the player, a rival, or each other) slide and spin as free bodies: this keeps them from sliding through
// walls, buildings, bridge parapets, lamp posts and every other solid thing the player's car bumps into. The same code is run by the
// `obstacles` check (tools/check.mjs) against every collider in the world.
import { pointInPolygon, closestPointOnPolygon } from './collision.js';

// k: the free body { x, z, y, vx, vz, wy }, r: its radius, colliders: the collision world. Returns the number of contacts resolved.
export function resolveKnockAgainstWorld(k, r, colliders) {
  let hits = 0;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.destroyed || !c.blocksCar || c.kind === 'traffic') continue;
    if (c.ymax !== undefined && k.y > c.ymax) continue;
    if (c.ymin !== undefined && k.y < c.ymin) continue;
    let nx, nz, pen;
    if (c.kind === 'parcel') {
      if (!c.footprint) continue;
      let bb = c._bb;
      if (!bb) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of c.footprint) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; } bb = c._bb = [x0, x1, z0, z1]; }
      if (k.x < bb[0] - r - 1 || k.x > bb[1] + r + 1 || k.z < bb[2] - r - 1 || k.z > bb[3] + r + 1) continue;
      const inside = pointInPolygon(k.x, k.z, c.footprint), { point, dist: d } = closestPointOnPolygon(k.x, k.z, c.footprint);
      if (!inside && d >= r) continue;
      if (inside) { const cx = c.footprint.reduce((s, p) => s + p[0], 0) / c.footprint.length, cz = c.footprint.reduce((s, p) => s + p[1], 0) / c.footprint.length; nx = k.x - cx; nz = k.z - cz; const m = Math.hypot(nx, nz) || 1; nx /= m; nz /= m; k.x = point.x + nx * r; k.z = point.z + nz * r; }
      else { nx = (k.x - point.x) / d; nz = (k.z - point.z) / d; pen = r - d; k.x += nx * pen; k.z += nz * pen; }
    } else {
      if (!c.radius) continue;
      const dx = k.x - c.x, dz = k.z - c.z, d = Math.hypot(dx, dz), rr = r + c.radius;
      if (d >= rr || d < 1e-6) continue;
      nx = dx / d; nz = dz / d; pen = rr - d; k.x += nx * pen; k.z += nz * pen;
    }
    const vn = k.vx * nx + k.vz * nz;
    if (vn < 0) { k.vx -= 1.3 * vn * nx; k.vz -= 1.3 * vn * nz; k.wy += (Math.random() - 0.5) * Math.min(3, -vn * 0.3); }
    hits++;
  }
  return hits;
}
