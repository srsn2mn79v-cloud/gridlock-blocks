// Procedural vehicle bodies, used for the player's cars (carModels.js) and AI traffic
// (traffic.js). Bodies are extruded side profiles with a small bevel (so edges catch light
// instead of looking like boxes), glass is a separate darker shell, wheels have tyres plus a
// spoked rim that visibly spins, and every vehicle carries a soft contact-shadow blob.
// Geometry is cached per shape; only the paint material is per vehicle.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const geoCache = {};

// pts = side profile as [z, y] pairs (z forward). Extruded across `width` (centred on x=0).
function profileGeo(key, pts, width, bevel = 0.05) {
  if (geoCache[key]) return geoCache[key];
  const shape = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
  shape.closePath();
  const depth = Math.max(0.05, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  return (geoCache[key] = g);
}
function boxGeo(key, w, h, d, r = 0.04) {
  if (geoCache[key]) return geoCache[key];
  // beveled box via the same extrusion path: profile is the side (z,y) rectangle
  return profileGeo(key, [[-d / 2, -h / 2], [d / 2, -h / 2], [d / 2, h / 2], [-d / 2, h / 2]], w, r);
}

export function makeMaterials(color) {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, metalness: 0.55, clearcoat: 0.9, clearcoatRoughness: 0.12 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0c131b, roughness: 0.06, metalness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x101215, roughness: 0.7, metalness: 0.2 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 0.95 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.55, metalness: 0.1 })
  };
}
const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.92, metalness: 0 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xaab0b8, roughness: 0.3, metalness: 0.9 });

function wheelGeos(r, w) {
  const key = 'wheel' + r + '_' + w;
  if (geoCache[key]) return geoCache[key];
  const tyre = new THREE.CylinderGeometry(r, r, w, 18);
  const parts = [new THREE.CylinderGeometry(r * 0.66, r * 0.66, w + 0.02, 14)];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.BoxGeometry(r * 1.25, w + 0.035, r * 0.16);
    b.rotateY((i / 5) * Math.PI);
    parts.push(b);
  }
  return (geoCache[key] = { tyre, rim: mergeGeometries(parts) });
}
// wheel mesh whose own rotation.x spins it about the axle (same convention car.js/traffic.js use)
function makeWheel(r, w) {
  const { tyre, rim } = wheelGeos(r, w);
  const m = new THREE.Mesh(tyre, tyreMat);
  m.rotation.z = Math.PI / 2;
  m.add(new THREE.Mesh(rim, rimMat));
  return m;
}
function addWheels(g, list, r, w) {
  g.userData.wheels = list.map(([x, y, z]) => { const m = makeWheel(r, w); m.position.set(x, y, z); g.add(m); return m; });
  g.userData.wheelR = r;
}

let blobTex = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  return (blobTex = new THREE.CanvasTexture(c));
}
const blobMat = new THREE.MeshBasicMaterial({ map: null, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
function addBlob(g, len, wid) {
  blobMat.map ||= blobTexture();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wid * 1.5, len * 1.3), blobMat);
  m.rotation.x = -Math.PI / 2; m.position.y = 0.035; m.renderOrder = 1;
  g.add(m);
}

const part = (geo, mat, x, y, z, parent, cast = false) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; parent.add(m); return m;
};

// ---- common details --------------------------------------------------------------------
function addPlates(g, m, len, y = 0.5) {
  part(boxGeo('plate', 0.5, 0.12, 0.03, 0.01), m.white, 0, y, len / 2 + 0.01, g);
  part(boxGeo('plate', 0.5, 0.12, 0.03, 0.01), m.white, 0, y + 0.05, -len / 2 - 0.01, g);
}
function addMirrors(g, m, y, z, half) {
  [-1, 1].forEach(s => part(boxGeo('mirror', 0.1, 0.12, 0.18, 0.02), m.paint, s * (half + 0.08), y, z, g));
}

// ---- player-sized cars (3.6 long, 1.9 wide, wheels at the same spots for every style) ----
const CAR_WHEELS = [[-1, 0.42, 1.25], [1, 0.42, 1.25], [-1, 0.42, -1.25], [1, 0.42, -1.25]];

export const PLAYER_BUS_DIMS = { len: 7.2, wid: 2.0 };   // the drivable bus is a short city shuttle (the traffic bus is 10.4 long)
// ---- player car shapes as data, so the Studio can edit them ----
// body / glass = side profiles as [z, y] pairs (z forward, y up); parts = extra boxes (w, h, d = width, height, length; x, y, z = centre;
// r = edge bevel; mat = paint | glass | dark | chrome | white | stripe | sign; mirror = also add the copy at -x; cast = casts a shadow).
export const CAR_SPECS = {
  sport: { body: [[-1.8, 0.27], [1.8, 0.27], [1.8, 0.5], [1.25, 0.63], [0.5, 0.7], [-1.2, 0.74], [-1.8, 0.7], [-1.8, 0.45]],
    glass: { pts: [[0.6, 0.7], [0.05, 1.06], [-0.75, 1.08], [-1.35, 0.74]], w: 1.55, r: 0.03 },
    parts: [{ n: 'roof', w: 1.2, h: 0.05, d: 0.8, x: 0, y: 1.095, z: -0.35, r: 0.02, mat: 'paint' },
      { n: 'wing', w: 1.7, h: 0.05, d: 0.36, x: 0, y: 1.02, z: -1.68, r: 0.02, mat: 'paint', cast: 1 },
      { n: 'strut', w: 0.07, h: 0.3, d: 0.1, x: 0.6, y: 0.86, z: -1.66, r: 0.01, mat: 'dark', mirror: 1 },
      { n: 'splitter', w: 1.9, h: 0.05, d: 0.3, x: 0, y: 0.3, z: 1.72, r: 0.01, mat: 'dark' }] },
  muscle: { body: [[-1.8, 0.28], [1.8, 0.28], [1.8, 0.62], [1.5, 0.86], [0.4, 0.92], [-1.5, 0.92], [-1.8, 0.84], [-1.8, 0.5]],
    glass: { pts: [[0.3, 0.92], [-0.15, 1.3], [-0.95, 1.3], [-1.4, 0.92]], w: 1.58, r: 0.03 },
    parts: [{ n: 'roof', w: 1.25, h: 0.05, d: 0.8, x: 0, y: 1.325, z: -0.55, r: 0.02, mat: 'paint' },
      { n: 'stripe', w: 0.34, h: 0.02, d: 3.5, x: 0, y: 0.935, z: 0, r: 0.005, mat: 'stripe' },
      { n: 'scoop', w: 0.7, h: 0.12, d: 0.6, x: 0, y: 0.98, z: 1.05, r: 0.03, mat: 'dark' },
      { n: 'grille', w: 1.3, h: 0.2, d: 0.05, x: 0, y: 0.5, z: 1.82, r: 0.01, mat: 'dark' }] },
  pickup: { body: [[-0.6, 0.3], [1.8, 0.3], [1.8, 0.62], [1.4, 0.9], [0.5, 0.95], [-0.6, 0.95]],
    glass: { pts: [[0.5, 0.95], [0.15, 1.42], [-0.55, 1.42], [-0.6, 0.95]], w: 1.6, r: 0.04 },
    parts: [{ n: 'roof', w: 1.5, h: 0.05, d: 0.75, x: 0, y: 1.44, z: -0.2, r: 0.02, mat: 'paint' },
      { n: 'bed floor', w: 1.9, h: 0.12, d: 1.25, x: 0, y: 0.5, z: -1.18, r: 0.03, mat: 'dark' },
      { n: 'bed side', w: 0.1, h: 0.5, d: 1.25, x: 0.9, y: 0.82, z: -1.18, r: 0.03, mat: 'paint', mirror: 1, cast: 1 },
      { n: 'tailgate', w: 1.9, h: 0.5, d: 0.1, x: 0, y: 0.82, z: -1.75, r: 0.03, mat: 'paint', cast: 1 },
      { n: 'bed front', w: 1.9, h: 0.5, d: 0.1, x: 0, y: 0.82, z: -0.58, r: 0.03, mat: 'paint' },
      { n: 'grille', w: 1.3, h: 0.22, d: 0.05, x: 0, y: 0.52, z: 1.82, r: 0.01, mat: 'chrome' }] },
  van: { body: [[-1.8, 0.3], [1.8, 0.3], [1.8, 0.78], [1.5, 0.98], [0.95, 1.55], [-1.8, 1.72], [-1.8, 0.5]],
    glass: { pts: [[1.42, 1.0], [0.97, 1.48], [0.78, 1.48], [0.78, 1.0]], w: 1.6, r: 0.02 }, mirrorY: 1.2,
    parts: [{ n: 'side window', w: 0.03, h: 0.34, d: 1.3, x: 0.955, y: 1.3, z: 0.1, r: 0.005, mat: 'glass', mirror: 1 },
      { n: 'rear window', w: 0.03, h: 0.34, d: 0.9, x: 0.955, y: 1.3, z: -1.2, r: 0.005, mat: 'glass', mirror: 1 },
      { n: 'grille', w: 1.3, h: 0.2, d: 0.05, x: 0, y: 0.55, z: 1.82, r: 0.01, mat: 'dark' }] },
  taxi: { body: [[-1.8, 0.28], [1.8, 0.28], [1.8, 0.6], [1.55, 0.78], [0.7, 0.84], [-1.1, 0.84], [-1.7, 0.8], [-1.8, 0.62]],
    glass: { pts: [[0.75, 0.84], [0.25, 1.28], [-0.75, 1.3], [-1.25, 0.86]], w: 1.58, r: 0.03 },
    parts: [{ n: 'roof', w: 1.25, h: 0.05, d: 1.0, x: 0, y: 1.305, z: -0.25, r: 0.02, mat: 'paint' },
      { n: 'roof sign', w: 0.62, h: 0.2, d: 0.3, x: 0, y: 1.43, z: -0.25, r: 0.03, mat: 'sign' },
      { n: 'stripe', w: 1.93, h: 0.05, d: 3.4, x: 0, y: 0.62, z: 0, r: 0.005, mat: 'dark' }] },
  hatch: { body: [[-1.8, 0.28], [1.8, 0.28], [1.8, 0.6], [1.55, 0.78], [0.7, 0.84], [-1.5, 0.86], [-1.8, 0.74], [-1.8, 0.5]],
    glass: { pts: [[0.72, 0.84], [0.2, 1.3], [-1.0, 1.33], [-1.6, 0.86]], w: 1.58, r: 0.03 },
    parts: [{ n: 'roof', w: 1.25, h: 0.05, d: 1.1, x: 0, y: 1.32, z: -0.4, r: 0.02, mat: 'paint' }] }
};
// custom shapes made in the Studio (localStorage 'gridlock-custom-v1' -> cars[key].model) replace the built-in ones
export function carSpecFor(key) {
  let c = null;
  try { c = JSON.parse(localStorage.getItem('gridlock-custom-v1') || 'null'); } catch (e) { /* none */ }
  const m = c && c.cars && c.cars[key] && c.cars[key].model;
  return (m && Array.isArray(m.body) && m.body.length >= 3 ? m : null) || CAR_SPECS[key] || CAR_SPECS.hatch;
}
const specKey = (tag, o) => tag + JSON.stringify(o);
export function buildCarFromSpec(spec, color, styleKey = 'hatch') {
  const g = new THREE.Group();
  const m = makeMaterials(color);
  m.stripe = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, metalness: 0.1 });
  m.sign = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0b0, emissiveIntensity: 0.9 });
  const W = 1.9;
  part(profileGeo(specKey('body', spec.body), spec.body, W), m.paint, 0, 0, 0, g, true);
  if (spec.glass) part(profileGeo(specKey('glass', spec.glass), spec.glass.pts, spec.glass.w, spec.glass.r ?? 0.03), m.glass, 0, 0, 0, g);
  (spec.parts || []).forEach(q => {
    const geo = boxGeo(specKey('box', [q.w, q.h, q.d, q.r ?? 0.02]), q.w, q.h, q.d, q.r ?? 0.02), mat = m[q.mat] || m.paint;
    part(geo, mat, q.x, q.y, q.z, g, !!q.cast);
    if (q.mirror) part(geo, mat, -q.x, q.y, q.z, g, !!q.cast);
  });
  addMirrors(g, m, spec.mirrorY || 0.95, 0.55, W / 2);
  part(boxGeo('bumper_f', 1.85, 0.16, 0.12, 0.03), m.dark, 0, 0.36, 1.78, g);
  part(boxGeo('bumper_r', 1.85, 0.16, 0.12, 0.03), m.dark, 0, 0.36, -1.78, g);
  addPlates(g, m, 3.7, 0.4);
  addWheels(g, CAR_WHEELS, 0.42, 0.35);
  addBlob(g, 3.6, 1.9);
  return g;
}
export function buildCarBody(style, color, opts = {}) {
  if (style === 'bus') return buildTrafficBody('bus', color, PLAYER_BUS_DIMS);
  return buildCarFromSpec(carSpecFor(style), color, style);
}

// ---- AI traffic vehicles (own dimensions; forward = +z; wheels spin via userData.wheels) ----
export const TRAFFIC_DIMS = {
  // 1 u = 1.25 m: a sedan 4.5 x 1.9 m, a van 6.1 x 2.1 m, a rigid truck 9.8 x 2.6 m, a city bus 13 x 2.6 m
  sedan: { len: 3.6, wid: 1.5 },
  taxi: { len: 3.6, wid: 1.5 },
  van: { len: 4.9, wid: 1.7 },
  truck: { len: 7.8, wid: 2.1 },
  bus: { len: 10.4, wid: 2.1 }
};

export function buildTrafficBody(type, color, dimsOverride) {
  const g = new THREE.Group();
  const m = makeMaterials(color);
  const d = dimsOverride || TRAFFIC_DIMS[type];
  const L = d.len / 2;
  switch (type) {
    case 'taxi': {
      const t = buildCarBody('taxi', 0xf4c400);
      t.scale.set(d.wid / 1.9, 1, 1);
      t.userData.dims = d; t.userData.wheelR = 0.42;
      return t;
    }
    case 'van': {
      part(profileGeo('tvan_body', [[-L, 0.32], [L, 0.32], [L, 0.8], [L - 0.35, 1.0], [L - 1.0, 1.7], [-L, 1.95], [-L, 0.5]], d.wid), m.paint, 0, 0, 0, g, true);
      part(profileGeo('tvan_ws', [[L - 0.4, 1.02], [L - 1.0, 1.62], [L - 1.2, 1.62], [L - 1.2, 1.02]], d.wid - 0.3, 0.02), m.glass, 0, 0, 0, g);
      [-1, 1].forEach(s => part(boxGeo('tvan_win', 0.03, 0.4, 1.5, 0.005), m.glass, s * (d.wid / 2 + 0.005), 1.45, L - 1.6, g));
      part(boxGeo('tvan_grille', 1.4, 0.22, 0.05, 0.01), m.dark, 0, 0.58, L + 0.02, g);
      addMirrors(g, m, 1.3, L - 1.1, d.wid / 2);
      addWheels(g, [[-0.9, 0.38, L - 1.1], [0.9, 0.38, L - 1.1], [-0.9, 0.38, -L + 1.0], [0.9, 0.38, -L + 1.0]], 0.38, 0.28);
      break;
    }
    case 'truck': {
      // cab + chassis + a tall box body
      part(profileGeo('truck_cab', [[L - 2.2, 0.6], [L, 0.6], [L, 1.5], [L - 0.5, 2.6], [L - 2.2, 2.6]], d.wid), m.paint, 0, 0, 0, g, true);
      part(boxGeo('truck_ws', d.wid - 0.3, 0.9, 0.05, 0.01), m.glass, 0, 2.0, L - 0.24, g).rotation.x = -0.28;
      part(boxGeo('truck_chassis', 1.5, 0.3, d.len - 0.4, 0.04), m.dark, 0, 0.55, 0, g);
      part(boxGeo('truck_box', d.wid, 2.5, d.len - 2.7, 0.05), m.white, 0, 1.95, -L + (d.len - 2.7) / 2 + 0.05, g, true);
      part(boxGeo('truck_stripe', d.wid + 0.02, 0.35, d.len - 2.7, 0.01), m.paint, 0, 1.2, -L + (d.len - 2.7) / 2 + 0.05, g);
      part(boxGeo('truck_grille', 1.5, 0.5, 0.06, 0.02), m.chrome, 0, 1.0, L + 0.02, g);
      part(boxGeo('truck_bumper', d.wid, 0.28, 0.2, 0.03), m.dark, 0, 0.55, L + 0.05, g);
      const wz = [L - 1.3, -L + 2.1, -L + 0.9];
      addWheels(g, wz.flatMap(z => [[-1.0, 0.5, z], [1.0, 0.5, z]]), 0.5, 0.4);
      break;
    }
    case 'bus': {
      // sloped windscreen up front, glazed sides, wheels poking out of the body, dark underframe
      const H = 3.15;
      part(profileGeo('bus_body2', [[-L, 0.62], [L, 0.62], [L, 1.5], [L - 0.28, H - 0.18], [L - 0.4, H], [-L, H], [-L, 0.9]], d.wid), m.paint, 0, 0, 0, g, true);
      part(boxGeo('bus_under', d.wid - 0.5, 0.55, d.len - 0.4, 0.05), m.dark, 0, 0.42, 0, g);
      const ws = part(boxGeo('bus_ws2', d.wid - 0.34, 1.35, 0.06, 0.012), m.glass, 0, 2.3, L - 0.17, g);
      ws.rotation.x = -0.2;
      [-1, 1].forEach(s => {
        part(boxGeo('bus_win2', 0.04, 0.9, d.len - 3.4, 0.005), m.glass, s * (d.wid / 2 + 0.012), 2.35, -0.9, g);
        part(boxGeo('bus_door2', 0.05, 1.9, 1.15, 0.005), m.glass, s * (d.wid / 2 + 0.014), 1.78, L - 1.5, g);
        part(boxGeo('bus_trim', 0.03, 0.12, d.len - 0.4, 0.005), m.white, s * (d.wid / 2 + 0.01), 1.3, 0, g);
        part(boxGeo('bus_light', 0.06, 0.18, 0.34, 0.01), new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xfff0b0, emissiveIntensity: 0.8 }), s * 0.85, 0.85, L + 0.02, g);
      });
      part(boxGeo('bus_rear2', d.wid - 0.5, 0.85, 0.06, 0.01), m.glass, 0, 2.35, -L - 0.02, g);
      part(boxGeo('bus_bumper', d.wid, 0.22, 0.2, 0.03), m.dark, 0, 0.7, L + 0.04, g);
      part(boxGeo('bus_bumper_r', d.wid, 0.22, 0.2, 0.03), m.dark, 0, 0.7, -L - 0.04, g);
      const dest = new THREE.Mesh(boxGeo('bus_dest', 1.3, 0.25, 0.04, 0.01), new THREE.MeshStandardMaterial({ color: 0x201000, emissive: 0xff9a1a, emissiveIntensity: 1.2 }));
      dest.position.set(0, H - 0.24, L - 0.4); dest.rotation.x = -0.2; g.add(dest);
      part(boxGeo('bus_roofac', 1.4, 0.3, 2.2, 0.05), m.white, 0, H + 0.12, -1.0, g);
      addWheels(g, [[-1.12, 0.5, L - 2.2], [1.12, 0.5, L - 2.2], [-1.12, 0.5, -L + 2.4], [1.12, 0.5, -L + 2.4]], 0.5, 0.42);
      break;
    }
    default: { // sedan
      const c = buildCarBody('hatch', color);
      c.scale.set(0.97, 0.97, 1);
      c.userData.dims = d;
      return c;
    }
  }
  addBlob(g, d.len, d.wid);
  g.userData.dims = d;
  return g;
}

// ---- parked cars: hundreds of them, so they are drawn as InstancedMeshes (one per style and
// material) instead of a Group of meshes each. `cars` = [{x, y, z, heading, style, color}].
const PARK_STYLES = ['hatch', 'hatch', 'sport', 'muscle', 'pickup', 'van'];
export function parkedCarStyle(i) { return PARK_STYLES[i % PARK_STYLES.length]; }
export function buildParkedCars(cars) {
  const out = new THREE.Group();
  const handles = out.userData.handles = new Map();   // car record -> [[instancedMesh, index], ...] so a car can be lifted out when it's woken
  const byStyle = {};
  cars.forEach(c => (byStyle[c.style + '|' + Math.floor(c.x / 140) + ',' + Math.floor(c.z / 140)] ||= []).push(c));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
  const protoCache = new Map();
  Object.entries(byStyle).forEach(([key, list]) => {
    const style = key.split('|')[0];
    const proto = protoCache.get(style) || protoCache.set(style, buildCarBody(style, 0xffffff)).get(style);
    proto.updateMatrixWorld(true);
    let groups = proto.userData._pg;
    if (!groups) { groups = proto.userData._pg = new Map();
    proto.traverse(o => {
      if (!o.isMesh || o.geometry.type === 'PlaneGeometry') return;      // contact-shadow blob is skipped
      let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      geo.applyMatrix4(o.matrixWorld);
      (groups.get(o.material) || groups.set(o.material, []).get(o.material)).push(geo);
      // spinning rims are children of the tyre mesh; traverse reaches them with their own material
    }); }
    groups.forEach((geos, mat) => {
      const geo = proto.userData._mg?.get(mat) || (proto.userData._mg ||= new Map()).set(mat, mergeGeometries(geos)).get(mat);
      const paint = mat.isMeshPhysicalMaterial && mat.clearcoat > 0.5;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.castShadow = false; im.receiveShadow = false;
      list.forEach((c, i) => {
        q.setFromAxisAngle(up, c.heading);
        m4.compose(new THREE.Vector3(c.x, c.y || 0.02, c.z), q, sc);
        im.setMatrixAt(i, m4);
        (handles.get(c) || handles.set(c, []).get(c)).push([im, i]);
        if (paint) im.setColorAt(i, new THREE.Color(c.color));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      out.add(im);
    });
  });
  return out;
}
