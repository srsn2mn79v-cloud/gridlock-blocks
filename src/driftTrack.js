// Drift circuits: three closed tracks (a rectangle, an S-bend loop and a triangle) that live far outside the city,
// like the event arenas in NFS Underground. Entering a drift event from its gate in the city teleports you here and
// leaving (or finishing) puts you back. Each track is a wide flat ribbon with red/white kerbs and tyre walls.
// The walls only collide while their track is in use (activate/deactivate), so the city's collision list stays small.
import * as THREE from 'three';
import { createGroundGlow, setGlow } from './glow.js';

export const ARENA_X = -9000, ARENA_STEP = 900;
export const inArena = x => x < -6000;
const WIDTH = 22, WALL_GAP = 2.6, BONUS_FROM_WALL = 3.2, BONUS_MARGIN = 0.5;   // units (1 u = 1.25 m): the bonus band is the 4 m next to either wall

// ---- centrelines ---------------------------------------------------------------------------------
function fillet(poly, R, step = 3) {
  const out = [], n = poly.length;
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i + n - 1) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    const a = [p0[0] - p1[0], p0[1] - p1[1]], b = [p2[0] - p1[0], p2[1] - p1[1]];
    const la = Math.hypot(...a), lb = Math.hypot(...b); a[0] /= la; a[1] /= la; b[0] /= lb; b[1] /= lb;
    const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
    const t = Math.min(R / Math.tan(ang / 2), la * 0.48, lb * 0.48), r = t * Math.tan(ang / 2);
    const s = [p1[0] + a[0] * t, p1[1] + a[1] * t], e = [p1[0] + b[0] * t, p1[1] + b[1] * t];
    const bis = [a[0] + b[0], a[1] + b[1]], lbis = Math.hypot(...bis) || 1, d = r / Math.sin(ang / 2);
    const c = [p1[0] + bis[0] / lbis * d, p1[1] + bis[1] / lbis * d];
    let a0 = Math.atan2(s[1] - c[1], s[0] - c[0]), a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
    let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(Math.abs(da) * r / step));
    for (let k = 0; k <= steps; k++) { const aa = a0 + da * k / steps; out.push([c[0] + Math.cos(aa) * r, c[1] + Math.sin(aa) * r]); }
  }
  return out;
}
function spline(ctrl, step = 3) {   // closed Catmull-Rom
  const out = [], n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i + n - 1) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), steps = Math.max(4, Math.ceil(len / step));
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  return out;
}
function resample(pts, step) {   // evenly spaced points along a closed polyline
  const n = pts.length, cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i % n][0] - pts[i - 1][0], pts[i % n][1] - pts[i - 1][1]));
  const L = cum[n], m = Math.round(L / step), out = []; let j = 0;
  for (let k = 0; k < m; k++) {
    const s = L * k / m; while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1), a = pts[j], b = pts[(j + 1) % n];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return { pts: out, length: L };
}

const DEFS = [
  { id: 'rect', name: 'Block Loop', note: 'Tight L-shaped block: six hairpin-ish corners, short straights', poly: () => resample(fillet([[0, 0], [190, 0], [190, 80], [115, 80], [115, 135], [0, 135]], 30), 4) },
  { id: 'esses', name: 'Serpent', note: 'Compact S-bends: flick the car left and right', poly: () => resample(spline([[0, 0], [75, -14], [150, 8], [172, 70], [128, 108], [70, 78], [22, 110], [-40, 126], [-96, 92], [-92, 34], [-48, 6]].map(p => [p[0] * 1.15, p[1] * 1.15])), 4) },
  { id: 'tri', name: 'Delta', note: 'Triangle with a hairpin at every point', poly: () => resample(fillet([[0, 0], [200, 0], [100, 175]], 36), 4) }
];

// distance from (x,z) to the closed polyline, plus the nearest point's index
function nearest(pts, x, z) {
  let bd = 1e18, bi = 0;
  for (let i = 0; i < pts.length; i++) { const dx = pts[i][0] - x, dz = pts[i][1] - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
  return { d: Math.sqrt(bd), i: bi };
}

function stripGeo(pts, off0, off1, y, colorFn, skip) {
  const n = pts.length, pos = [], col = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n], p = pts[i % n];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz, nz = tx, c = colorFn(i);
    pos.push(p[0] + nx * off0, y, p[1] + nz * off0, p[0] + nx * off1, y, p[1] + nz * off1);
    col.push(...c, ...c);
  }
  for (let i = 0; i < n; i++) { if (skip && skip(i)) continue; const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // normals must point up whichever way the ribbon is wound
  const nr = g.attributes.normal; for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
  return g;
}

export function createDriftTracks({ scene }) {
  const group = new THREE.Group(); group.name = 'driftArena'; scene.add(group);
  const tracks = [];
  const asphalt = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x2d3b2c, roughness: 1 });
  const tyreA = new THREE.MeshStandardMaterial({ color: 0xd9352b, roughness: 0.8 }), tyreB = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.8 });
  const tyreGeo = new THREE.CylinderGeometry(1.15, 1.15, 1.0, 12); tyreGeo.translate(0, 0.5, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.4 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffd9a0, emissiveIntensity: 1.2 });
  const pools = [];

  DEFS.forEach((def, ti) => {
    const { pts: raw, length } = def.poly();
    let cx = 0, cz = 0; raw.forEach(p => { cx += p[0]; cz += p[1]; }); cx /= raw.length; cz /= raw.length;
    const ox = ARENA_X, oz = ti * ARENA_STEP;
    const pts = raw.map(p => [p[0] - cx + ox, p[1] - cz + oz]);
    const half = WIDTH / 2, wallR = half + WALL_GAP;
    // minimum corner radius, for the record (and the check)
    let minR = 1e9;
    for (let i = 0; i < pts.length; i += 2) {
      const a = pts[i], b = pts[(i + 3) % pts.length], c = pts[(i + 6) % pts.length];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
      const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if (cross > 1e-3) minR = Math.min(minR, ab * bc * ca / (2 * cross));
    }
    const g = new THREE.Group(); g.position.set(0, 0, 0);
    // ground: a big dark meadow under the circuit
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(900, 700), grassMat); gm.rotation.x = -Math.PI / 2; gm.position.set(ox, -0.02, oz); gm.receiveShadow = true; g.add(gm);
    const road = new THREE.Mesh(stripGeo(pts, -half, half, 0.02, i => { const v = 0.19 + ((i * 7) % 5) * 0.004; return [v, v, v + 0.01]; }), asphalt); road.receiveShadow = true; g.add(road);
    // kerbs: red/white blocks every 4 units
    [[-half - 1.8, -half], [half, half + 1.8]].forEach(([a, b]) => g.add(new THREE.Mesh(stripGeo(pts, a, b, 0.05, i => (Math.floor(i / 2) % 2 ? [0.92, 0.92, 0.92] : [0.82, 0.12, 0.1])), paint)));
    // dashed centre line + edge lines
    g.add(new THREE.Mesh(stripGeo(pts, -0.25, 0.25, 0.04, () => [0.95, 0.95, 0.9], i => Math.floor(i / 3) % 2 === 0), paint));
    // the bonus lines: painted 4 m in from the inside and outside walls - drift between a line and its wall for extra points
    { const o = wallR - BONUS_FROM_WALL; [[-o - 0.2, -o + 0.2], [o - 0.2, o + 0.2]].forEach(([a, b]) => g.add(new THREE.Mesh(stripGeo(pts, a, b, 0.045, () => [1.0, 0.55, 0.05]), paint))); }
    // start / finish line: a chequered strip across the track at point 0
    {
      const p = pts[0], q = pts[1]; let tx = q[0] - p[0], tz = q[1] - p[1]; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
      const c = document.createElement('canvas'); c.width = 128; c.height = 16; const k = c.getContext('2d');
      for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { k.fillStyle = (i + j) % 2 ? '#111' : '#fff'; k.fillRect(i * 8, j * 8, 8, 8); }
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const line = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, 2.4), new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      line.geometry.rotateX(-Math.PI / 2); line.rotation.y = Math.atan2(-tx, -tz); line.position.set(p[0], 0.06, p[1]);
      g.add(line);
    }
    // tyre walls both sides, and the collider list for them
    const wall = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length], p = pts[i];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      [-1, 1].forEach(s => wall.push([p[0] - tz * wallR * s, p[1] + tx * wallR * s, i]));
    }
    const tyreN = wall.length, tA = new THREE.InstancedMesh(tyreGeo, tyreA, tyreN * 2), tB = new THREE.InstancedMesh(tyreGeo, tyreB, tyreN * 2);
    const m4 = new THREE.Matrix4(); let na = 0, nb = 0;
    wall.forEach(([x, z, i], k) => {
      for (let h = 0; h < 2; h++) {
        m4.makeTranslation(x, h * 1.0, z);
        if ((Math.floor(i / 2) + h) % 2) tA.setMatrixAt(na++, m4); else tB.setMatrixAt(nb++, m4);
      }
    });
    tA.count = na; tB.count = nb; tA.frustumCulled = tB.frustumCulled = false; g.add(tA, tB);
    // floodlights
    for (let i = 0; i < pts.length; i += 22) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length], p = pts[i];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const s = (i / 22) % 2 ? 1 : -1, px = p[0] - tz * (wallR + 5) * s, pz = p[1] + tx * (wallR + 5) * s;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 16, 8), poleMat); pole.position.set(px, 8, pz); g.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 1.2), headMat); head.position.set(px + tz * s * 1.2, 16.2, pz - tx * s * 1.2); head.rotation.y = Math.atan2(tx, tz); g.add(head);
      const pool = createGroundGlow(0xffd9a0, 60, 60); pool.position.set(px + tz * s * 8, 0.08, pz - tx * s * 8); setGlow(pool, 0.34); g.add(pool); pools.push(pool);
    }
    // painted direction arrows every ~60 units
    group.add(g);

    const start = { x: pts[0][0], z: pts[0][1] };
    const a = pts[0], b = pts[2]; const hd = Math.atan2(b[0] - a[0], b[1] - a[1]);
    // the grid: a few car lengths behind the line so there is room to build speed
    const back = pts[pts.length - 12];
    tracks.push({
      id: def.id, name: def.name, note: def.note, pts, width: WIDTH, length: Math.round(length * 1.25), minR: Math.round(minR), cx: ox, cz: oz,
      start: { x: back[0], z: back[1], heading: Math.atan2(a[0] - back[0], a[1] - back[1]), lineX: start.x, lineZ: start.z },
      wall: wall.map(w => ({ x: w[0], z: w[1] })),
      inTrack: (x, z, margin = 4) => nearest(pts, x, z).d < half + margin,
      distFrom: (x, z) => nearest(pts, x, z).d,
      inBonus: (x, z) => nearest(pts, x, z).d > wallR - BONUS_FROM_WALL - BONUS_MARGIN,
      area: 0
    });
  });

  // height + surface under any point in the arena: flat ground, 'road' on the circuit, 'ground' (slow) off it
  function heightAt(x, z) {
    const ti = Math.max(0, Math.min(tracks.length - 1, Math.round(z / ARENA_STEP)));
    const t = tracks[ti];
    heightAt.kind = t && t.inTrack(x, z, 1.8) ? 'road' : 'ground';
    return 0;
  }
  heightAt.kind = 'ground';

  const live = [];
  return {
    group, tracks, heightAt, pools,
    byId: id => tracks.find(t => t.id === id),
    // add / remove the tyre-wall colliders of one track in the shared collision list
    activate(track, collisionWorld) {
      this.deactivate(collisionWorld);
      track.wall.forEach(w => { const c = { kind: 'prop', x: w.x, z: w.z, radius: 1.3, blocksCar: true, destructible: false, response: 'bounce', destroyed: false, arena: true }; live.push(c); collisionWorld.push(c); });
    },
    deactivate(collisionWorld) {
      if (!live.length) return;
      for (let i = collisionWorld.length - 1; i >= 0; i--) if (collisionWorld[i].arena) collisionWorld.splice(i, 1);
      live.length = 0;
    }
  };
}
