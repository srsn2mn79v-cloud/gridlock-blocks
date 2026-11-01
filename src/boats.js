// Boats on the rivers: motor boats, sailing boats and tugs follow a river's centre line, up and down stream. Low boats slip under the
// closed low bridges; the tall ones (sails, the tug's funnel) wait in front of a movable bridge until its leaves are up (drawbridge.js).
import * as THREE from 'three';
import { WATER_Y } from './rivers.js';
import { LEAF_MAX } from './drawbridge.js';

const TYPES = {
  motor: { len: 6, wid: 2.1, speed: 11, tall: false },
  sail:  { len: 8, wid: 2.6, speed: 6.5, tall: true },
  tug:   { len: 11, wid: 3.6, speed: 5, tall: true }
};
const COLORS = [0xf2f2ee, 0xd23b34, 0x2f6fe0, 0xf0c542, 0x1fa88a, 0x24324f];

function hullGeo(len, wid, h) {            // top-view outline with a pointed bow, extruded up
  const s = new THREE.Shape(), hl = len / 2, hw = wid / 2;
  s.moveTo(-hl, -hw * 0.85); s.lineTo(hl * 0.35, -hw); s.quadraticCurveTo(hl, -hw * 0.5, hl, 0); s.quadraticCurveTo(hl, hw * 0.5, hl * 0.35, hw); s.lineTo(-hl, hw * 0.85); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, -h * 0.4, 0);        // shape x -> boat forward (+x), shape y -> -z after the turn
  return g;
}

function buildBoat(kind, color) {
  const T = TYPES[kind], g = new THREE.Group();
  const hullM = new THREE.MeshStandardMaterial({ color, roughness: 0.55 }), white = new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x232830, roughness: 0.7 }), glassM = new THREE.MeshStandardMaterial({ color: 0x7fb6d6, roughness: 0.15, metalness: 0.2 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const hull = new THREE.Mesh(hullGeo(T.len, T.wid, 1.1), hullM); hull.castShadow = true; g.add(hull);
  add(new THREE.BoxGeometry(T.len * 0.9, 0.12, T.wid * 0.8), white, -T.len * 0.04, 0.68, 0);              // deck
  if (kind === 'motor') {
    add(new THREE.BoxGeometry(2.2, 0.9, 1.5), white, -0.4, 1.2, 0); add(new THREE.BoxGeometry(1.0, 0.45, 1.4), glassM, 0.35, 1.3, 0);
    add(new THREE.BoxGeometry(0.5, 0.55, 0.5), dark, -T.len / 2 + 0.2, 0.9, 0);                            // outboard
  } else if (kind === 'sail') {
    add(new THREE.BoxGeometry(2.4, 0.6, 1.4), white, -0.8, 1.0, 0);
    add(new THREE.CylinderGeometry(0.08, 0.1, 9.5, 6), dark, 0.6, 5.2, 0);
    const sail = new THREE.BufferGeometry(), v = [0.55, 9.2, 0, 0.55, 1.4, 0, -3.1, 1.4, 0];
    sail.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); sail.computeVertexNormals();
    const sm = add(sail, new THREE.MeshStandardMaterial({ color: 0xf8f6ee, roughness: 0.9, side: THREE.DoubleSide }), 0, 0, 0); sm.castShadow = false;
    const jib = new THREE.BufferGeometry(); jib.setAttribute('position', new THREE.Float32BufferAttribute([0.7, 8.6, 0, 3.4, 1.3, 0, 0.7, 1.3, 0], 3)); jib.computeVertexNormals();
    add(jib, new THREE.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.9, side: THREE.DoubleSide }), 0, 0, 0);
  } else {
    add(new THREE.BoxGeometry(4.6, 2.0, 2.8), white, -1.2, 1.7, 0); add(new THREE.BoxGeometry(2.4, 1.0, 3.0), dark, -1.2, 2.8, 0);
    add(new THREE.BoxGeometry(3.0, 0.9, 2.6), glassM, 0.3, 2.0, 0);
    add(new THREE.CylinderGeometry(0.55, 0.7, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0xc8362f, roughness: 0.6 }), -2.6, 3.6, 0);
    add(new THREE.BoxGeometry(0.4, 1.6, 0.4), dark, T.len / 2 - 0.8, 1.2, 0);                              // bow fender post
  }
  // navigation lights: red / green at the bow, white on top
  const lamp = (c, x, y, z) => add(new THREE.SphereGeometry(0.14, 6, 5), new THREE.MeshBasicMaterial({ color: c }), x, y, z);
  lamp(0xff3030, T.len * 0.25, 0.95, -T.wid * 0.38); lamp(0x30ff60, T.len * 0.25, 0.95, T.wid * 0.38);
  lamp(0xffffff, kind === 'sail' ? 0.6 : -1.2, kind === 'sail' ? 10.0 : kind === 'tug' ? 4.9 : 1.9, 0);
  // wake: a faint V of foam trailing behind
  const w = new THREE.BufferGeometry();
  w.setAttribute('position', new THREE.Float32BufferAttribute([-T.len * 0.4, 0, 0, -T.len * 2.4, 0, -T.wid * 1.9, -T.len * 2.4, 0, T.wid * 1.9], 3));
  const wake = new THREE.Mesh(w, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  wake.position.y = 0.12; wake.renderOrder = 2; g.add(wake);
  return g;
}

export function createBoats({ city, scene, drawbridge, count = 4 }) {
  const rivers = (city.rivers || []).map(r => {
    const cum = [0]; for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    return { ...r, cum, total: cum[cum.length - 1], bridges: [] };
  });
  const posAt = (r, s, lat) => {
    let i = 1; while (i < r.cum.length - 1 && r.cum[i] < s) i++;
    const a = r.pts[i - 1], b = r.pts[i], t = (s - r.cum[i - 1]) / ((r.cum[i] - r.cum[i - 1]) || 1), dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return { x: a[0] + dx * t - dz / l * lat, z: a[1] + dz * t + dx / l * lat, h: Math.atan2(dx, dz) };
  };
  // where each movable bridge crosses which river (distance along that river)
  (drawbridge && drawbridge.bridges ? drawbridge.bridges : []).forEach(br => {
    const N = city.roadNodes, A = N[br.edge.from], B = N[br.edge.to], mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    let best = null;
    rivers.forEach(r => { for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((mx - a[0]) * dx + (mz - a[1]) * dz) / l2));
      const d = Math.hypot(mx - a[0] - dx * t, mz - a[1] - dz * t);
      if (d < r.half + 12 && (!best || d < best.d)) best = { r, d, s: r.cum[i - 1] + Math.sqrt(l2) * t };
    } });
    if (best) best.r.bridges.push({ s: best.s, edge: br.edge });
  });
  const boats = [], kinds = ['motor', 'sail', 'tug', 'motor'];
  rivers.forEach((r, ri) => {
    if (r.total < 150) return;
    for (let k = 0; k < count; k++) {
      const kind = kinds[(ri + k) % kinds.length], dir = k % 2 ? -1 : 1, color = COLORS[(ri * 3 + k * 5) % COLORS.length];
      const mesh = buildBoat(kind, color); scene.add(mesh);
      boats.push({ r, kind, T: TYPES[kind], dir, mesh, s: r.total * ((k + 0.5) / count) * (0.9 + 0.05 * ri) % r.total, lat: dir * r.half * 0.28, v: TYPES[kind].speed, t: Math.random() * 10 });
    }
  });
  let clock = 0;
  function update(dt, focus) {
    clock += dt;
    for (const b of boats) {
      b.t += dt;
      // is a bridge ahead that this boat cannot pass?
      let hold = false;
      if (b.T.tall) for (const br of b.r.bridges) {
        const ahead = (br.s - b.s) * b.dir;                                       // distance to the bridge along my way (negative: behind me)
        if (ahead > 14 && ahead < 40 && br.edge.bridgeAngle < LEAF_MAX * 0.92) hold = true;   // wait 14 u short of the span until it is fully open
      }
      for (const o of boats) if (o !== b && o.r === b.r && o.dir === b.dir) { const gap = (o.s - b.s) * b.dir; if (gap > 0 && gap < 16 + b.T.len) hold = true; }
      const want = hold ? 0 : b.T.speed;
      b.v += (want - b.v) * Math.min(1, dt * 0.8);
      b.s += b.dir * b.v * dt;
      if (b.s < 0 || b.s > b.r.total) { b.dir = -b.dir; b.lat = -b.lat; b.s = b.dir > 0 ? 0.5 : b.r.total - 0.5; }   // at the end of the river: turn round
      const p = posAt(b.r, b.s, b.lat);
      const near = !focus || (Math.abs(p.x - focus.x) < 900 && Math.abs(p.z - focus.z) < 900);
      b.mesh.visible = near;
      if (!near) continue;
      b.mesh.position.set(p.x, WATER_Y + 0.12 + Math.sin(b.t * 1.7 + b.s) * 0.05, p.z);
      // the mesh's forward is +x; heading h is atan2(dx, dz) for travel along +z
      b.mesh.rotation.set(Math.sin(b.t * 1.3) * 0.015, p.h - Math.PI / 2 + (b.dir < 0 ? Math.PI : 0), Math.sin(b.t * 1.1 + 1) * 0.02 + 0, 'YXZ');
      b.mesh.userData.wakeK = Math.min(1, b.v / b.T.speed);
      b.mesh.children[b.mesh.children.length - 1].material.opacity = 0.05 + 0.2 * b.mesh.userData.wakeK;
    }
  }
  return { update, boats };
}
