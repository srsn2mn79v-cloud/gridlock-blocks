import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const parcelColor = { building: 0x566072, park: 0x2f5a3a, plaza: 0xd9c79a, water: 0x3fa7ff };

// Three's ExtrudeGeometry/ShapeGeometry build in the shape's local XY plane and extrude
// along Z. To land footprint (x, worldZ) points correctly in world space (X stays X,
// worldZ stays worldZ, extrusion becomes +Y height) the shape's Y is negated going in
// and the geometry is rotated -90deg about X — otherwise buildings come out mirrored.
function footprintToShape(footprint) {
  return new THREE.Shape(footprint.map(pt => new THREE.Vector2(pt[0], -pt[1])));
}

const _tmpC = new THREE.Color();
function colored(geo, hex, shade = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  _tmpC.set(hex).multiplyScalar(shade);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = _tmpC.r; c[i * 3 + 1] = _tmpC.g; c[i * 3 + 2] = _tmpC.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  ['uv1', 'uv2'].forEach(k => g.deleteAttribute(k));
  return g;
}
function prism(fp, y0, h) {
  const g = new THREE.ExtrudeGeometry(footprintToShape(fp), { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return g;
}
function scaled(fp, cx, cz, k) { return fp.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]); }

// Builds the geometry pieces for one building: walls plus its roof style.
function buildingGeos(p) {
  const fp = p.footprint, h = p.height || 12, col = p.color == null ? parcelColor.building : p.color;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  fp.forEach(([x, z]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  const out = [];
  const roofCol = new THREE.Color(col).multiplyScalar(0.55).getHex();
  if (p.roof === 'tiers') {
    // wedding-cake skyscraper: three setbacks and a spire
    const a = h * 0.6, b = h * 0.25;
    out.push(colored(prism(fp, 0, a), col));
    out.push(colored(prism(scaled(fp, cx, cz, 0.78), a, b), col, 0.95));
    out.push(colored(prism(scaled(fp, cx, cz, 0.55), a + b, h - a - b), col, 0.9));
    out.push(colored(new THREE.CylinderGeometry(0.25, 0.5, Math.max(4, h * 0.12), 6).translate(cx, h + Math.max(4, h * 0.12) / 2, cz), 0x9aa0a8));
  } else if (p.roof === 'gable' && w > 4 && d > 4) {
    out.push(colored(prism(fp, 0, h), col));
    const rh = Math.min(w, d) * 0.35, alongX = w >= d;
    const s = alongX ? d : w, L = alongX ? w : d;
    const sh = new THREE.Shape([new THREE.Vector2(-s / 2 - 0.3, 0), new THREE.Vector2(s / 2 + 0.3, 0), new THREE.Vector2(0, rh)]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: L + 0.6, bevelEnabled: false });
    g.translate(0, 0, -(L + 0.6) / 2);
    if (alongX) g.rotateY(Math.PI / 2);
    g.translate(cx, h, cz);
    out.push(colored(g, 0x7a4a3a));
  } else if (p.roof === 'pagoda' && w > 5 && d > 5) {
    const bodyH = h * 0.55;
    out.push(colored(prism(fp, 0, bodyH), col));
    for (let t = 0; t < 3; t++) {
      const k = 1.12 - t * 0.28, y = bodyH + t * ((h - bodyH) / 3);
      const rf = scaled(fp, cx, cz, k);
      out.push(colored(prism(rf, y, 0.5), roofCol));
      if (t < 2) out.push(colored(prism(scaled(fp, cx, cz, k - 0.22), y + 0.5, (h - bodyH) / 3 - 0.5), col, 0.96));
    }
    const cone = new THREE.ConeGeometry(Math.min(w, d) * 0.28, 3.5, 4); cone.rotateY(Math.PI / 4);
    cone.translate(cx, h + 1.9, cz);
    out.push(colored(cone, roofCol));
  } else {
    out.push(colored(prism(fp, 0, h), col));
    if (p.roof === 'tank' && w > 5 && d > 5) {
      const tx = cx + w * 0.2, tz = cz - d * 0.15;
      out.push(colored(new THREE.CylinderGeometry(1.4, 1.4, 2.6, 10).translate(tx, h + 1.3, tz), 0x8a6a4a));
      out.push(colored(new THREE.ConeGeometry(1.6, 1, 10).translate(tx, h + 3.1, tz), 0x5c4630));
    } else if (h > 8 && w > 6 && d > 6) {
      out.push(colored(prism(scaled(fp, cx, cz, 0.35), h, 1.4), col, 0.8));   // rooftop plant room
    }
  }
  return out;
}

// Returns both the Group to add to the scene and a flat `instances` list (each with its
// original footprint and mesh) so collision.js can build a collider for buildings. Buildings are
// merged into per-area chunk meshes (vertex coloured, one shared material) to keep draw calls low.
export function buildParcels(cityData) {
  const group = new THREE.Group();
  const instances = [];
  const bMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, vertexColors: true });
  const chunks = new Map();
  const CH = 220;
  (cityData.parcels || []).forEach((p, i) => {
    if (p.type === 'building') {
      let sx = 0, sz = 0; p.footprint.forEach(q => { sx += q[0]; sz += q[1]; });
      sx /= p.footprint.length; sz /= p.footprint.length;
      const key = Math.floor(sx / CH) + ',' + Math.floor(sz / CH);
      if (!chunks.has(key)) chunks.set(key, { geos: [], list: [] });
      const c = chunks.get(key);
      c.geos.push(...buildingGeos(p));
      c.list.push({ id: 'parcel' + i, type: p.type, footprint: p.footprint, p });
      return;
    }
    const geo = new THREE.ShapeGeometry(footprintToShape(p.footprint));
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: (p.type === 'plaza' && p.color != null) ? p.color : (parcelColor[p.type] || 0x888888), roughness: p.type === 'water' ? 0.2 : 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = p.deck ? 0.12 : p.type === 'water' ? 0.05 : p.type === 'plaza' ? 0.04 : 0.02;
    mesh.receiveShadow = true;
    group.add(mesh);
    instances.push({ id: 'parcel' + i, type: p.type, footprint: p.footprint, mesh, deck: !!p.deck });
  });
  chunks.forEach(c => {
    const mesh = new THREE.Mesh(mergeGeometries(c.geos, false), bMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    c.list.forEach(r => { r.mesh = mesh; instances.push(r); });
  });
  return { group, instances };
}
