// Doors for the buildings you can enter (apartments and the five kinds of shop), drawn on the facade at
// real-world size (1 world unit = 1.25 m): an apartment has a 0.9 m single door in a frame with a step, a
// canopy and a lamp; a shop has a 1.9 m glass double door under a coloured awning. Everything is merged
// into one vertex-coloured mesh (plus a tiny emissive one for the lamps), ~20 boxes per door.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SHOP_KINDS } from '../chicago/chicago.js';

export const DOOR = { aptW: 0.78, aptH: 1.66, shopLeafW: 0.8, shopH: 1.72, frame: 0.1 };

const _c = new THREE.Color();
function box(list, hex, w, h, d, x, y, z, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  _c.set(hex);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  list.push(g);
}
const APT_DOOR_COLORS = [0x6b3f2a, 0x2f4a6b, 0x3c5a3c, 0x7a2f2f, 0x2e2e36];

// local frame: +x across the facade, +y up, +z away from the wall (the wall is at z = 0)
function aptDoor(list, lamps, i) {
  const f = DOOR.frame, w = DOOR.aptW, h = DOOR.aptH, col = APT_DOOR_COLORS[i % APT_DOOR_COLORS.length];
  box(list, 0x3b3834, w + 2 * f, h + f, 0.14, 0, (h + f) / 2, 0.07);                     // frame / reveal
  box(list, col, w, h, 0.06, 0, h / 2, 0.14);                                            // door leaf
  box(list, 0x202428, w * 0.7, h * 0.28, 0.02, 0, h * 0.72, 0.175);                       // glazed panel
  box(list, 0x202428, w * 0.7, h * 0.28, 0.02, 0, h * 0.72, 0.175);
  box(list, 0xd9b44a, 0.05, 0.05, 0.07, w * 0.36, h * 0.48, 0.2);                         // handle
  box(list, 0xb9b5ab, 1.5, 0.1, 0.6, 0, 0.05, 0.3);                                     // step
  box(list, 0x55524d, w + 0.9, 0.07, 0.62, 0, h + f + 0.22, 0.31);                        // canopy slab
  [-1, 1].forEach(s => box(list, 0x55524d, 0.04, 0.22, 0.04, s * (w / 2 + 0.38), h + f + 0.12, 0.58));
  lamps.push([0, h + f + 0.14, 0.24]);
}
function shopDoor(list, lamps, hex) {
  const f = DOOR.frame, lw = DOOR.shopLeafW, h = DOOR.shopH;
  box(list, 0x2a2d33, 2 * lw + 2 * f + 0.04, h + f, 0.16, 0, (h + f) / 2, 0.08);       // frame
  [-1, 1].forEach(s => {
    box(list, 0x17202c, lw - 0.1, h - 0.1, 0.05, s * (lw / 2 + 0.02), h / 2, 0.15);       // glass leaf
    box(list, 0x9aa3ad, 0.04, 0.5, 0.05, s * 0.07, h * 0.5, 0.2);                         // pull bar
  });
  box(list, 0xb9b5ab, 2.2, 0.1, 0.7, 0, 0.05, 0.35);                                    // step
  // sloped awning in the shop's colour, with a darker valance
  box(list, hex, 3.4, 0.07, 1.1, 0, h + 0.55, 0.55, 0.28);
  box(list, new THREE.Color(hex).multiplyScalar(0.6).getHex(), 3.4, 0.2, 0.05, 0, h + 0.28, 1.03);
  lamps.push([0, h + 0.15, 0.3]);
}

export function buildDoors(city) {
  const group = new THREE.Group();
  const list = [], lampGeos = [];
  const place = (build, f, ...args) => {
    const sub = [], lamps = [];
    build(sub, lamps, ...args);
    const m = new THREE.Matrix4().makeRotationY(Math.atan2(f.nx, f.nz)).setPosition(f.x, 0.02, f.z);
    sub.forEach(g => { g.applyMatrix4(m); list.push(g); });
    lamps.forEach(([x, y, z]) => {
      const g = new THREE.SphereGeometry(0.08, 8, 6); g.translate(x, y, z); g.applyMatrix4(m); lampGeos.push(g);
    });
  };
  (city.apartments || []).forEach((a, i) => { if (a.facade) place(aptDoor, a.facade, i); });
  (city.shops || []).forEach(s => { if (s.facade) place(shopDoor, s.facade, SHOP_KINDS[s.kind].hex); });
  (city.agents || []).forEach(g => { if (g.facade) place(shopDoor, g.facade, 0x19c6b7); });
  if (list.length) {
    const mesh = new THREE.Mesh(mergeGeometries(list, false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (lampGeos.length) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xffd98a, emissiveIntensity: 1.8 });
    mat.userData.snow = { skip: true };
    group.add(new THREE.Mesh(mergeGeometries(lampGeos, false), mat));
  }
  return group;
}
