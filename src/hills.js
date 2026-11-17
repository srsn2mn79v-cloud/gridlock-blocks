// Hills (San Francisco). The game world stays flat inside - roads, traffic, collisions and walking all work on the level - and the hills
// are a height function added to everything that is drawn: every built-in material's vertex shader lifts its world position by
// hill(x, z) (a sum of Gaussian bumps, written into the shader as constants, so no uniforms are needed and shadows, fog and
// instancing follow along). The camera and the lights are lifted the same way just before each frame is drawn, the car gets a pull
// along the slope, and flat geometry is cut into small triangles where there are hills so that it bends with them.
import * as THREE from 'three';

const LOW = 1.5;                       // geometry below this (flat-world height) is ground-level and has to bend with the hills
const BASE = 0.6;                      // subtracted from the sum, so the height is exactly 0 away from the hills (the shore, the bridges)
let H = [];                            // { x, z, k (1 / r^2), h }
export const hills = { on: false };

function raw(x, z) { let s = 0; for (let i = 0; i < H.length; i++) { const h = H[i], dx = x - h.x, dz = z - h.z, q = (dx * dx + dz * dz) * h.k; if (q < 12) s += h.h * Math.exp(-q); } return s; }
export function hillAt(x, z) { if (!hills.on) return 0; const s = raw(x, z) - BASE; return s > 0 ? s : 0; }
// slope along a heading (forward = (sin h, cos h)): rise per unit of run
export function hillSlope(x, z, heading) { if (!hills.on) return 0; const sx = Math.sin(heading), sz = Math.cos(heading); return (hillAt(x + sx * 1.5, z + sz * 1.5) - hillAt(x - sx * 1.5, z - sz * 1.5)) / 3; }
const nearHills = (x0, z0, x1, z1) => H.some(h => { const r = 2.4 / Math.sqrt(h.k), cx = Math.max(x0, Math.min(x1, h.x)), cz = Math.max(z0, Math.min(z1, h.z)); return (cx - h.x) ** 2 + (cz - h.z) ** 2 < r * r; });

// list: [{ x, z, r, h }] in world units. Call before any material is compiled.
export function installHills(list) {
  H = (list || []).map(h => ({ x: h.x, z: h.z, k: 1 / (h.r * h.r), h: h.h }));
  if (!H.length) return;
  hills.on = true;
  const f = v => (Math.round(v * 1000) / 1000).toFixed(3), fk = v => v.toExponential(6);
  const glsl = '\nfloat gbHill( vec2 p ) {\n\tfloat s = 0.0; vec2 d;\n' + H.map(h => `\td = p - vec2( ${f(h.x)}, ${f(h.z)} ); s += ${f(h.h)} * exp( - min( dot( d, d ) * ${fk(h.k)}, 30.0 ) );`).join('\n') + `\n\treturn max( 0.0, s - ${f(BASE)} );\n}\n`;
  const C = THREE.ShaderChunk;
  C.common = C.common + glsl;
  C.project_vertex = C.project_vertex.replace('mvPosition = modelViewMatrix * mvPosition;', 'mvPosition = modelMatrix * mvPosition; mvPosition.y += gbHill( mvPosition.xz ); mvPosition = viewMatrix * mvPosition;');
  C.worldpos_vertex = C.worldpos_vertex.replace('worldPosition = modelMatrix * worldPosition;', 'worldPosition = modelMatrix * worldPosition; worldPosition.y += gbHill( worldPosition.xz );');
  const SL = THREE.ShaderLib;
  SL.sprite.vertexShader = SL.sprite.vertexShader.replace('vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );', 'vec4 gbW = modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ); gbW.y += gbHill( gbW.xz ); vec4 mvPosition = viewMatrix * gbW;');
  hills.glsl = glsl;                   // for hand-written shaders (puffs.js)
}

// ---- drawing a frame: lift the camera and the lights, draw, put the camera back -------------------------------------------------
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _d = new THREE.Vector3(), _f = new THREE.Vector3();
let lights = [], lightScan = 0;
export function renderLifted(scene, camera, draw) {
  if (!hills.on) { draw(); return; }
  scene.matrixWorldAutoUpdate = false; scene.updateMatrixWorld();
  if (--lightScan <= 0) { lightScan = 90; lights = []; scene.traverse(o => { if (o.isSpotLight || o.isPointLight || (o.isDirectionalLight && o.castShadow)) lights.push(o); }); }
  for (const l of lights) {
    if (!l.visible || l.intensity <= 0) continue;
    if (l.isDirectionalLight) {      // the sun: its shadow box follows the ground it is aimed at
      if (!l.target) continue; if (!l.target.parent) l.target.updateMatrixWorld(); const t = l.target.matrixWorld.elements, up = hillAt(t[12], t[14]); t[13] += up; l.matrixWorld.elements[13] += up; continue;
    }
    const e = l.matrixWorld.elements; e[13] += hillAt(e[12], e[14]);
    if (l.isSpotLight && l.target) { const t = l.target.matrixWorld.elements; if (!l.target.parent) l.target.updateMatrixWorld(); t[13] += hillAt(t[12], t[14]); }
  }
  _p.copy(camera.position); _q.copy(camera.quaternion);
  camera.getWorldDirection(_d); _f.copy(_p).addScaledVector(_d, 14);
  camera.position.y += hillAt(_p.x, _p.z); _f.y += hillAt(_f.x, _f.z);
  camera.lookAt(_f); camera.updateMatrixWorld();
  draw();
  camera.position.copy(_p); camera.quaternion.copy(_q); camera.updateMatrixWorld();
}

// ---- bending flat geometry: split near-level triangles in hill country until no edge is longer than maxEdge ----------------------
export function tessellateScene(root, maxEdge = 12) {
  if (!hills.on) return 0;
  let added = 0; root.updateMatrixWorld(true);
  root.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !o.isBatchedMesh && !o.isSkinnedMesh && o.geometry && o.geometry.attributes.position && !o.userData.noHillSplit) added += tessellate(o, maxEdge); });
  return added;
}
function tessellate(mesh, L) {
  if (mesh.geometry.userData.hillSplit) return 0; mesh.geometry.userData.hillSplit = true;       // shared geometries are split once
  const g = mesh.geometry, pos = g.attributes.position, m = mesh.matrixWorld.elements;
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
  if (!nearHills(bb.min.x, bb.min.z, bb.max.x, bb.max.z)) return 0;
  if (Object.values(g.attributes).some(a => a.isInterleavedBufferAttribute) || g.morphAttributes && Object.keys(g.morphAttributes).length) return 0;
  // a first look without copying anything: is there a low, level triangle with a long edge at all? (most meshes: no)
  { const A = pos.array, I = g.index && g.index.array, n = I ? I.length : pos.count, L2q = L * L; let need = false;
    const px = i => m[0] * A[i * 3] + m[4] * A[i * 3 + 1] + m[8] * A[i * 3 + 2] + m[12], py = i => m[1] * A[i * 3] + m[5] * A[i * 3 + 1] + m[9] * A[i * 3 + 2] + m[13], pz = i => m[2] * A[i * 3] + m[6] * A[i * 3 + 1] + m[10] * A[i * 3 + 2] + m[14];
    for (let t = 0; t + 2 < n && !need; t += 3) { const a = I ? I[t] : t, b = I ? I[t + 1] : t + 1, c = I ? I[t + 2] : t + 2; if (py(a) > LOW || py(b) > LOW || py(c) > LOW) continue;
      const ax = px(a), az = pz(a), bx = px(b), bz = pz(b), cx = px(c), cz = pz(c); if ((ax - bx) ** 2 + (az - bz) ** 2 > L2q || (bx - cx) ** 2 + (bz - cz) ** 2 > L2q || (cx - ax) ** 2 + (cz - az) ** 2 > L2q) need = true; }
    if (!need) return 0; }
  const names = Object.keys(g.attributes), sizes = names.map(n => g.attributes[n].itemSize), data = names.map(n => Array.from(g.attributes[n].array)), norm = names.map(n => g.attributes[n].normalized);
  const pi = names.indexOf('position'), P = data[pi];
  let idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i);
  const wx = i => m[0] * P[i * 3] + m[4] * P[i * 3 + 1] + m[8] * P[i * 3 + 2] + m[12], wy = i => m[1] * P[i * 3] + m[5] * P[i * 3 + 1] + m[9] * P[i * 3 + 2] + m[13], wz = i => m[2] * P[i * 3] + m[6] * P[i * 3 + 1] + m[10] * P[i * 3 + 2] + m[14];
  const X = [], Y = [], Z = []; for (let i = 0; i < pos.count; i++) { X.push(wx(i)); Y.push(wy(i)); Z.push(wz(i)); }
  const mids = new Map(), L2 = L * L;
  const mid = (a, b) => {
    const key = a < b ? a * 4194304 + b : b * 4194304 + a; let v = mids.get(key); if (v !== undefined) return v;
    v = X.length; for (let k = 0; k < data.length; k++) { const s = sizes[k], d = data[k]; for (let c = 0; c < s; c++) d.push((d[a * s + c] + d[b * s + c]) / 2); }
    X.push((X[a] + X[b]) / 2); Y.push((Y[a] + Y[b]) / 2); Z.push((Z[a] + Z[b]) / 2); mids.set(key, v); return v;
  };
  const e2 = (a, b) => (X[a] - X[b]) ** 2 + (Z[a] - Z[b]) ** 2;
  const splitRange = (start, count) => {
    const out = [], stack = [];
    for (let t = start; t < start + count; t += 3) stack.push(idx[t], idx[t + 1], idx[t + 2]);
    while (stack.length) {
      const c = stack.pop(), b = stack.pop(), a = stack.pop();
      const ab = e2(a, b), bc = e2(b, c), ca = e2(c, a), mx = Math.max(ab, bc, ca);
      let split = mx > L2 && Y[a] <= LOW && Y[b] <= LOW && Y[c] <= LOW;      // only what lies on the ground: roofs and decks shear fine as they are
      if (split) {
        // only near-level faces (walls stay as they are), and only where there is a hill
        const ux = X[b] - X[a], uy = Y[b] - Y[a], uz = Z[b] - Z[a], vx = X[c] - X[a], vy = Y[c] - Y[a], vz = Z[c] - Z[a];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1;
        if (Math.abs(ny) / nl < 0.7) split = false;
        else if (!nearHills(Math.min(X[a], X[b], X[c]), Math.min(Z[a], Z[b], Z[c]), Math.max(X[a], X[b], X[c]), Math.max(Z[a], Z[b], Z[c]))) split = false;
      }
      if (!split) { out.push(a, b, c); continue; }
      if (mx === ab) { const q = mid(a, b); stack.push(a, q, c, q, b, c); }
      else if (mx === bc) { const q = mid(b, c); stack.push(a, b, q, a, q, c); }
      else { const q = mid(c, a); stack.push(a, b, q, q, b, c); }
    }
    return out;
  };
  const before = idx.length; let nidx;
  if (g.groups && g.groups.length) {
    nidx = []; const groups = g.groups.map(gr => { const part = splitRange(gr.start, Math.min(gr.count, idx.length - gr.start)), st = nidx.length; for (let i = 0; i < part.length; i++) nidx.push(part[i]); return { start: st, count: part.length, materialIndex: gr.materialIndex }; });
    if (nidx.length === before) return 0;
    g.clearGroups(); groups.forEach(gr => g.addGroup(gr.start, gr.count, gr.materialIndex));
  } else { nidx = splitRange(0, idx.length - idx.length % 3); if (nidx.length === before) return 0; }
  names.forEach((n, k) => { const old = g.attributes[n], A = new old.array.constructor(data[k]); g.setAttribute(n, new THREE.BufferAttribute(A, sizes[k], norm[k])); });
  g.setIndex(X.length > 65535 ? new THREE.BufferAttribute(new Uint32Array(nidx), 1) : new THREE.BufferAttribute(new Uint16Array(nidx), 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  // lifted geometry reaches higher than its flat bounds say: keep it from being culled when only its hilltop is in view
  g.boundingSphere.radius += 70;
  return (nidx.length - before) / 3;
}
