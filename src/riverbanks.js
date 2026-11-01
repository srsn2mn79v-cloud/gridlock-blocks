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
  // the banks: a height-field grid over each (merged) hole, heights from the river's own distance field (rivers.js), so a sharp bend
  // never makes the spikes and folds a strip-per-river mesh would; the shape of the bank is the same on both sides of every corner
  const STEP = 2.5, pos = [], col = [], idx = [];
  const grass = new THREE.Color(0x5d7a45), mud = new THREE.Color(0x6a5a44), wet = new THREE.Color(0x3f3629), c = new THREE.Color();
  holes.forEach(ring => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; ring.forEach(([x, z]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
    const nx = Math.ceil((x1 - x0) / STEP) + 2, nz = Math.ceil((z1 - z0) / STEP) + 2, first = pos.length / 3, inside = new Uint8Array(nx * nz);
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const x = x0 - STEP + a * STEP, z = z0 - STEP + b * STEP, ins = inPoly(x, z, ring); inside[a * nz + b] = ins ? 1 : 0;
      const y = field.groundY(x, z) - (ins ? 0 : 0.04);          // outside the hole it lies just under the ground plane
      pos.push(x, y, z); c.copy(y > -0.35 ? grass : y > -1.7 ? mud : wet); col.push(c.r, c.g, c.b);
    }
    for (let a = 0; a + 1 < nx; a++) for (let b = 0; b + 1 < nz; b++) {
      if (!(inside[a * nz + b] || inside[(a + 1) * nz + b] || inside[a * nz + b + 1] || inside[(a + 1) * nz + b + 1])) continue;
      const cx = x0 - STEP + (a + 0.5) * STEP, cz = z0 - STEP + (b + 0.5) * STEP;
      if (lakes.some(l => inPoly(cx, cz, l))) continue;
      const v00 = first + a * nz + b, v01 = v00 + 1, v10 = v00 + nz, v11 = v10 + 1;
      idx.push(v00, v01, v10, v01, v11, v10);
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
