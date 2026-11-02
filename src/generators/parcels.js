import * as THREE from 'three';
import { WATER_Y } from '../rivers.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Moving water: a few crossing wave trains bend the normal (so the sky and sun glint ripple), a slow dark/light mottling and bright crests
// give the surface depth and flow. `waterTime` is advanced by main.js every frame.
export const waterTime = { value: 0 };
function animateWater(mat, river) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = waterTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uTime; varying vec3 vWPos;
      vec3 waveGrad(vec2 p) {                       // xy: slope, z: height
        vec3 r = vec3(0.0);
        for (int i = 0; i < 6; i++) {
          float fi = float(i), a = 0.9 + fi * 1.13, f = 0.55 + fi * 0.47, sp = 0.8 + fi * 0.35;
          vec2 d = vec2(cos(a), sin(a));
          ${river ? 'd = normalize(d + vec2(0.0, 1.6));' : ''}
          float ph = dot(d, p) * f + uTime * sp + fi * 2.1, amp = 1.0 / (1.0 + fi * 0.8);
          r.xy += d * f * cos(ph) * amp; r.z += sin(ph) * amp;
        }
        return r * 0.22;
      }`).replace('#include <color_fragment>', `#include <color_fragment>
      vec3 wv = waveGrad(vWPos.xz);
      float mott = 0.5 + 0.5 * sin(vWPos.x * 0.07 + uTime * 0.2) * sin(vWPos.z * 0.09 - uTime * 0.15);
      diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.55, 0.78, 0.82), diffuseColor.rgb * vec3(1.05, 1.1, 1.08), mott * 0.6 + wv.z * 0.25);
      diffuseColor.rgb += vec3(0.55, 0.62, 0.68) * smoothstep(0.55, 0.95, wv.z * 0.9 + 0.35) * 0.35;`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = normalize(normal + (viewMatrix * vec4(wv.x, 0.0, wv.y, 0.0)).xyz * 0.9);`);
  };
  mat.customProgramCacheKey = () => 'water' + (river ? 'R' : 'L');
}
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
  } else if (p.roof === 'resi' && w > 5 && d > 5) {
    // residential block: brick/pastel walls, a cornice, a floor of balconies per storey on the long sides, a hipped roof with a chimney and a front stoop
    out.push(colored(prism(fp, 0, h), col));
    out.push(colored(prism(scaled(fp, cx, cz, 1.03), h - 0.5, 0.5), col, 0.82));                                                      // cornice
    const alongX = w >= d, L = alongX ? w : d, S = alongX ? d : w, floors = Math.max(2, Math.round(h / 3.2));
    for (let f = 1; f < floors; f++) {
      const y = f * (h / floors);
      [1, -1].forEach(sd => {
        const bw = L * 0.64, bx = alongX ? cx : cx + sd * (S / 2 + 0.45), bz = alongX ? cz + sd * (S / 2 + 0.45) : cz;
        const slab = new THREE.BoxGeometry(alongX ? bw : 0.9, 0.18, alongX ? 0.9 : bw).translate(bx, y, bz);
        out.push(colored(slab, 0xb8b2a6));
        const rail = new THREE.BoxGeometry(alongX ? bw : 0.06, 0.55, alongX ? 0.06 : bw).translate(alongX ? bx : bx + sd * 0.42, y + 0.36, alongX ? bz + sd * 0.42 : bz);
        out.push(colored(rail, 0x2a2d33));
      });
    }
    const hipH = Math.min(w, d) * 0.28, cone = new THREE.ConeGeometry(Math.SQRT1_2, hipH, 4); cone.rotateY(Math.PI / 4); cone.scale(w * 1.04, 1, d * 1.04); cone.translate(cx, h + hipH / 2, cz);      // a four-sided pyramid over the whole footprint
    out.push(colored(cone, 0x6a4a3e));
    out.push(colored(new THREE.BoxGeometry(0.9, 2.2, 0.9).translate(cx + w * 0.22, h + hipH * 0.55, cz - d * 0.12), 0x8a5a48));      // chimney
    out.push(colored(new THREE.BoxGeometry(alongX ? 3 : 1.6, 0.35, alongX ? 1.6 : 3).translate(cx, 0.18, alongX ? cz - S / 2 - 0.6 : cz), 0xa8a39a));  // stoop
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
    if (p.type === 'water' && !p.deck) animateWater(mat, !!p.river);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = p.deck ? 0.12 : p.river ? WATER_Y : p.type === 'water' ? 0.05 : p.type === 'plaza' ? 0.04 : 0.02;
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
