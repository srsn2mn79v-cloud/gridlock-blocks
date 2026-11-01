// The river channels: the ground plane gets a hole where the rivers run (the union of their banks), and these meshes fill it: a bank that
// slopes from street level down to the water's edge, the bed, and a dark floor so no gap ever shows the sky. The water itself is the
// water parcel, lowered to WATER_Y (generators/parcels.js). Heights come from rivers.js, the same numbers the car rides on.
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { ribbonPoly } from './chicago/geom.js';
import { createRiverField, BANK_W, BED_Y } from './rivers.js';

const inPoly = (x, z, f) => { let c = false; for (let i = 0, j = f.length - 1; i < f.length; j = i++) { if ((f[i][1] > z) !== (f[j][1] > z) && x < (f[j][0] - f[i][0]) * (z - f[i][1]) / (f[j][1] - f[i][1]) + f[i][0]) c = !c; } return c; };

export function buildRiverBanks(city) {
  const rivers = city.rivers || [], group = new THREE.Group(), field = createRiverField(rivers);
  if (!rivers.length) return { group, holes: [] };
  const lakes = (city.parcels || []).filter(p => p.type === 'water' && !p.river).map(p => p.footprint);
  // the ground hole: every river's banks, merged (overlapping holes would break the triangulation)
  const polys = rivers.map(r => [ribbonPoly(r.pts, r.half + BANK_W).map(p => [p[0], p[1]])]);
  const merged = polygonClipping.union(...polys);
  const holes = merged.map(poly => poly[0].slice(0, -1));
  // the banks: a strip along each river, cross-section sampled at fixed offsets from the water's edge
  const prof = [BANK_W + 1.2, BANK_W, 5.6, 4.2, 2.8, 1.4, 0, -4, -9];
  const pos = [], col = [], idx = [];
  const grass = new THREE.Color(0x5d7a45), mud = new THREE.Color(0x6a5a44), wet = new THREE.Color(0x3f3629), c = new THREE.Color();
  rivers.forEach((r, ri) => {
    const P = r.pts, n = P.length, first = pos.length / 3;
    const frame = i => { const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return { nx: -dz / l, nz: dx / l }; };
    const yOf = e => { if (e >= BANK_W + 1) return -0.06; if (e >= BANK_W) return 0; if (e <= 0) return -2.2 + (BED_Y + 2.2) * Math.min(1, -e / 6); const t = e / BANK_W; return -2.2 * (1 - t * t * (3 - 2 * t)); };
    for (let i = 0; i < n; i++) {
      const f = frame(i);
      for (const side of [-1, 1]) {
        const list = side < 0 ? prof : prof.slice().reverse();
        for (const e of list) {
          const uu = (r.half + e) * side;
          pos.push(P[i][0] + f.nx * uu, yOf(e), P[i][1] + f.nz * uu);
          const y = yOf(e); c.copy(y > -0.35 ? grass : y > -1.7 ? mud : wet); col.push(c.r, c.g, c.b);
        }
      }
    }
    const W = prof.length * 2;           // vertices per cross-section
    for (let i = 0; i + 1 < n; i++) for (let k = 0; k + 1 < W; k++) {
      const a = first + i * W + k, b = a + 1, d = first + (i + 1) * W + k, e2 = d + 1;
      const cx = (pos[a * 3] + pos[e2 * 3]) / 2, cz = (pos[a * 3 + 2] + pos[e2 * 3 + 2]) / 2;
      if (field.edgeDist(cx, cz, ri) < -0.5 || lakes.some(l => inPoly(cx, cz, l))) continue;       // inside another river or a lake: leave it out
      idx.push(a, b, d, b, e2, d);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const banks = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  banks.receiveShadow = true; group.add(banks);
  // a dark floor under the whole channel, so a skipped quad never shows the sky
  holes.forEach(ring => {
    const shape = new THREE.Shape(); ring.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)); shape.closePath();
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2f2920, roughness: 1 })); m.position.y = BED_Y - 0.15; group.add(m);
  });
  return { group, holes };
}
