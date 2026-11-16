// Underground (metro-style) tunnels you can drive. Every metro line gets a tunnel under the street through its stations (floor 9 u down, so it runs under
// buildings, roads and the river), and a few drive-in ramps ("portals") cut into free ground near a station lead down to it. Nothing here is a road in the graph
// (no AI traffic, no signals): the tunnel is a set of straight segments with its own floor height, walls and lights, and the world's height function, the
// collision resolver and the water check are told about it (world.js hAt, main.js).
//   height(x, z, refY)  -> floor height of a ramp / tunnel under (x, z), or null (refY: only an underground car sees the tunnel floor)
//   constrain(car)      -> keeps an underground car inside the tunnel walls (a union of capsules around the segments)
//   holes               -> ground-plane holes over the ramps; portals -> [{ x, z, h }] for the minimap
import * as THREE from 'three';

export const TUN = { W: 10.5, DROP: 9, CEIL: 5.4, RAMP_L: 58, MAX_PORTALS: 6 };
const sm = k => k * k * (3 - 2 * k);

export function createTunnels({ city, scene, transit, collisionWorld, parcels = [], props = [], cityHeight, toast = () => {} }) {
  const lines = (transit && transit.metro && transit.metro.lines) || [];
  const none = { active: false, height: () => null, constrain() {}, update() {}, holes: [], portals: [], segs: [] };
  if (!lines.length) return none;
  const { W, DROP, CEIL, RAMP_L: L } = TUN, FLOOR = -DROP, TOP = FLOOR + CEIL;
  const seg = (ax, az, bx, bz, extra = {}) => { const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1; return { ax, az, bx, bz, dx: dx / len, dz: dz / len, len, ...extra }; };
  const distSeg = (s, x, z) => { const t = Math.max(0, Math.min(s.len, (x - s.ax) * s.dx + (z - s.az) * s.dz)); return Math.hypot(x - (s.ax + s.dx * t), z - (s.az + s.dz * t)); };

  // ---- the line tunnels ----
  const segs = [];                                        // body segments (floor at FLOOR)
  const stationsAt = [];                                  // { x, z, name, color }
  lines.forEach(l => {
    const st = l.stations;
    st.forEach(s => stationsAt.push({ x: s.x, z: s.z, name: s.name, color: l.color }));
    for (let i = 0; i + 1 < st.length; i++) segs.push(seg(st[i].x, st[i].z, st[i + 1].x, st[i + 1].z, { line: l }));
  });

  // ---- where a ramp can go: free ground beside a road, near a station ----
  const CELL = 40, cellKey = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
  const parcelGrid = new Map(), propGrid = new Map(), roadGrid = new Map();
  const put = (grid, x0, z0, x1, z1, v) => { for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) { const k = cx + ',' + cz; (grid.get(k) || grid.set(k, []).get(k)).push(v); } };
  const inPoly = (x, z, poly) => { let o = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) o = !o; } return o; };
  parcels.forEach(c => { if (c.footprint && !c.deck) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; c.footprint.forEach(q => { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }); put(parcelGrid, x0, z0, x1, z1, c); } });      // every lot: buildings, parks and plazas (their floors would cover the trench)
  collisionWorld.forEach(c => {
    if (c.destroyed || c.garage) return;
    if (c.kind === 'parcel' && c.footprint && !c.instance) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; c.footprint.forEach(q => { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }); put(parcelGrid, x0, z0, x1, z1, c); }
    else if (c.x !== undefined && c.blocksCar !== false) put(propGrid, c.x - 3, c.z - 3, c.x + 3, c.z + 3, c);
  });
  (city.roadEdges || []).forEach(e => { const a = city.roadNodes[e.from], b = city.roadNodes[e.to]; if (!a || !b) return; put(roadGrid, Math.min(a.x, b.x) - 12, Math.min(a.z, b.z) - 12, Math.max(a.x, b.x) + 12, Math.max(a.z, b.z) + 12, { a, b, hw: (e.width || 8) / 2 }); });
  const roadNear = (x, z) => { let best = null; (roadGrid.get(cellKey(x, z)) || []).forEach(r => { const dx = r.b.x - r.a.x, dz = r.b.z - r.a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - r.a.x) * dx + (z - r.a.z) * dz) / l2)), px = r.a.x + dx * t, pz = r.a.z + dz * t, d = Math.hypot(x - px, z - pz) - r.hw; if (!best || d < best.d) best = { d, px, pz }; }); return best; };
  props.forEach(c => { if (c.x !== undefined && c.type !== 'tree_') put(propGrid, c.x - 4, c.z - 4, c.x + 4, c.z + 4, { x: c.x, z: c.z, radius: 1.2 }); });
  // what is on the ground at a point: null = bare ground, 'x' = a building or anything that cannot be cut, or a park / plaza instance (its floor gets a hole)
  const lotAt = (x, z) => { for (const c of parcelGrid.get(cellKey(x, z)) || []) if (inPoly(x, z, c.footprint)) return (c.type === 'park' || c.type === 'plaza') && c.mesh ? c : 'x'; return null; };
  const propHit = (x, z, r) => (propGrid.get(cellKey(x, z)) || []).some(c => Math.hypot(c.x - x, c.z - z) < (c.radius || 1) + r);
  const keepOut = []; if (transit.depot) keepOut.push({ x: transit.depot.x, z: transit.depot.z, r: 60 });
  (transit.stands || []).concat(transit.stops || [], stationsAt).forEach(q => keepOut.push({ x: q.x, z: q.z, r: 9 }));
  const nearKeep = (x, z) => keepOut.some(q => Math.hypot(q.x - x, q.z - z) < q.r);
  const ramps = [];
  function tryPortal(sIdx) {
    const S = stationsAt[sIdx]; let best = null;
    for (let r = 10; r <= 110; r += 8) for (let a = 0; a < 12; a++) {
      const px = S.x + Math.cos(a * Math.PI / 6) * r, pz = S.z + Math.sin(a * Math.PI / 6) * r;
      const rd = roadNear(px, pz); if (!rd || rd.d < 1.5 || rd.d > 45) continue;
      if (ramps.some(q => Math.hypot(q.x - px, q.z - pz) < 90)) continue;
      for (let k = 0; k < 24; k++) {
        const th = k * Math.PI / 12, dx = Math.cos(th), dz = Math.sin(th);
        const vx = px - rd.px, vz = pz - rd.pz, vl = Math.hypot(vx, vz) || 1; if ((vx * dx + vz * dz) / vl < 0.55) continue;      // faces away from the road it leaves
        const bx = px + dx * L, bz = pz + dz * L, dS = Math.hypot(bx - S.x, bz - S.z); if (best && dS >= best.dS) continue; if (dS > 260) continue;
        let ok = true, lot = undefined;
        for (let u = 0; u <= L + 8 && ok; u += 4) for (const lat of [-W / 2 - 1.3, 0, W / 2 + 1.3]) {
          const x = px + dx * u - dz * lat, z = pz + dz * u + dx * lat;
          const lt = lotAt(x, z); if (lt === 'x' || (lot !== undefined && lt !== lot)) { ok = false; break; } lot = lt;      // all bare ground, or all inside one park / plaza
          if (propHit(x, z, 0.6) || nearKeep(x, z)) { ok = false; break; }
          if (u >= 6) { const q = roadNear(x, z); if (q && q.d < 2.2) { ok = false; break; } }
          if (Math.abs(cityHeight(x, z, 0) - cityHeight(px, pz, 0)) > 0.35) { ok = false; break; }
        }
        if (ok && segs.some(s => { for (let u = 0; u <= L - 4; u += 6) if (distSeg(s, px + dx * u, pz + dz * u) < W / 2 + 2.5) return true; return false; })) ok = false;      // never over the line tunnel itself
        if (ok) best = { x: px, z: pz, dx, dz, bx, bz, dS, S, sIdx, lot: lot || null };
      }
    }
    return best;
  }
  // priority: the ends of each line, then the rest, until MAX_PORTALS ramps exist
  const order = []; { let k = 0; lines.forEach(l => { order.push(k, k + l.stations.length - 1); k += l.stations.length; }); stationsAt.forEach((s, i) => { if (!order.includes(i)) order.push(i); }); }
  for (const i of order) { if (ramps.length >= TUN.MAX_PORTALS) break; const p = tryPortal(i); if (p) ramps.push(p); }
  // a ramp in a park or plaza cuts a hole in its floor
  { const cuts = new Map(); ramps.forEach((p, i) => { if (p.lot) (cuts.get(p.lot) || cuts.set(p.lot, []).get(p.lot)).push(i); });
    cuts.forEach((ids, lot) => { const shape = new THREE.Shape(lot.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
      ids.forEach(i => { const p = ramps[i]; shape.holes.push(new THREE.Path([[-0.5, -1], [L + 0.3, -1], [L + 0.3, 1], [-0.5, 1]].map(([u, sd]) => { const lat = sd * (W / 2 + 0.6); return new THREE.Vector2(p.x + p.dx * u - p.dz * lat, -(p.z + p.dz * u + p.dx * lat)); }))); });
      const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2); lot.mesh.geometry.dispose(); lot.mesh.geometry = geo; }); }
  // feeder: the foot of each ramp, straight on for 8 u, then to the station
  ramps.forEach(p => {
    const mx = p.bx + p.dx * 16, mz = p.bz + p.dz * 16;
    segs.push(seg(p.bx, p.bz, mx, mz, { feeder: p, noExtStart: true }), seg(mx, mz, p.S.x, p.S.z, { feeder: p }));
    p.rampSeg = seg(p.x, p.z, p.bx, p.bz, { ramp: true });
  });

  // ---- height, hole polygons, walls (collision) ----
  const rampH = u => FLOOR * sm(Math.max(0, Math.min(1, u / L)));
  const inUnion = (x, z, rad) => segs.some(s => distSeg(s, x, z) < rad) || ramps.some(p => distSeg(p.rampSeg, x, z) < rad);
  const holes = ramps.map(p => [[0.15, -1], [L, -1], [L, 1], [0.15, 1]].map(([u, s]) => { const lat = s * (W / 2 + 0.55); return [p.x + p.dx * u - p.dz * lat, p.z + p.dz * u + p.dx * lat]; }));
  ramps.forEach(p => {       // low walls along the trench: a car on the street cannot drive into its side, and they are the rim you see
    [-1, 1].forEach(s => {
      const lat = s * (W / 2 + 0.95), u0 = 8, u1 = L, o = (u, l) => [p.x + p.dx * u - p.dz * l, p.z + p.dz * u + p.dx * l];
      collisionWorld.push({ kind: 'parcel', instance: null, tunnelRim: true, footprint: [o(u0, lat - 0.45), o(u1, lat - 0.45), o(u1, lat + 0.45), o(u0, lat + 0.45)], blocksCar: true, destructible: false, response: 'bounce', destroyed: false });
    });
  });
  const api = {
    segs, ramps, holes, portals: ramps.map(p => ({ x: p.x + p.dx * 3, z: p.z + p.dz * 3, h: Math.atan2(p.dx, p.dz) })), stations: stationsAt, active: false,
    height(x, z, refY) {
      for (const p of ramps) { const rx = x - p.x, rz = z - p.z, u = rx * p.dx + rz * p.dz, lat = -rx * p.dz + rz * p.dx; if (u >= 0 && u <= L && Math.abs(lat) < W / 2 + 0.55) return rampH(u); }
      if (refY != null && refY < FLOOR + 5.8 && refY < -3.2 && inUnion(x, z, W / 2 + 0.3)) return FLOOR;
      return null;
    },
    constrain(car) {
      if (car.y > -0.6) return;
      const lim = W / 2 - 1.25; let best = null;
      const all = segs.concat(ramps.map(p => p.rampSeg));
      for (const s of all) { const t = Math.max(0, Math.min(s.len, (car.x - s.ax) * s.dx + (car.z - s.az) * s.dz)), px = s.ax + s.dx * t, pz = s.az + s.dz * t, d = Math.hypot(car.x - px, car.z - pz); if (!best || d < best.d) best = { d, px, pz }; }
      if (!best || best.d <= lim) return;
      const nx = (car.x - best.px) / best.d, nz = (car.z - best.pz) / best.d;
      car.x = best.px + nx * lim; car.z = best.pz + nz * lim;
      const vn = (car.vx || 0) * nx + (car.vz || 0) * nz; if (vn > 0) { car.vx -= nx * vn * 1.3; car.vz -= nz * vn * 1.3; car.speed *= 0.82; }
    }
  };

  // ---- meshes ----
  const g = new THREE.Group(); g.name = 'tunnels'; scene.add(g);
  const B = (c, o = {}) => new THREE.MeshBasicMaterial({ color: c, ...o });
  const wallM = B(0x474c52), baseM = B(0x2e3135), floorM = B(0x1b1d20), ceilM = B(0x2a2d31), lineM = B(0xe9e9e4), yellowM = B(0xf0c020), lampM = B(0xfff2c8);
  const add = (geo, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; g.add(o); return o; };
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const bx = (m, len, h, wd, x, y, z, ry) => { const o = add(boxGeo, m, x, y, z, ry); o.scale.set(len, h, wd); return o; };
  const lamps = [], dashes = [];
  const joined = (x, z, self) => segs.some(o => o !== self && distSeg(o, x, z) < 1) || ramps.some(p => distSeg(p.rampSeg, x, z) < 1);
  segs.forEach((s, i) => {
    const free0 = !s.noExtStart && !joined(s.ax, s.az, s), free1 = !joined(s.bx, s.bz, s);
    const ry = Math.atan2(-s.dz, s.dx), e0 = s.noExtStart || free0 ? 0 : W / 2, e1 = free1 ? 0 : W / 2, len = s.len + e0 + e1, cx = s.ax + s.dx * ((s.len + e1 - e0) / 2), cz = s.az + s.dz * ((s.len + e1 - e0) / 2), j = (i % 7) * 0.003;
    bx(floorM, len, 0.4, W + 0.6, cx, FLOOR - 0.2 - j, cz, ry);                                                   // floor
    bx(ceilM, len, 0.5, W + 1.2, cx, TOP + 0.25 + j, cz, ry);                                                     // roof
    [-1, 1].forEach(sd => bx(lineM, len - 2, 0.02, 0.22, cx, FLOOR + 0.01 + j, cz, ry).position.add(new THREE.Vector3(-s.dz * sd * (W / 2 - 0.9), 0, s.dx * sd * (W / 2 - 0.9))));   // edge lines
    for (let t = 4; t < s.len - 2; t += 8) dashes.push([s.ax + s.dx * t, s.az + s.dz * t, ry]);
    for (let t = 6; t < s.len - 3; t += 16) lamps.push([s.ax + s.dx * t, s.az + s.dz * t, ry]);
    if (free0) bx(wallM, 0.5, CEIL, W + 0.8, s.ax - s.dx * 0.25, FLOOR + CEIL / 2, s.az - s.dz * 0.25, ry);        // the dead end of a line: a wall across it
    if (free1) bx(wallM, 0.5, CEIL, W + 0.8, s.bx + s.dx * 0.25, FLOOR + CEIL / 2, s.bz + s.dz * 0.25, ry);
    // walls: runs along both sides that are not inside another tunnel (junction mouths and the inside of bends stay open)
    [-1, 1].forEach(sd => {
      let run = null; const runs = [];
      for (let t = -e0; t <= s.len + e1 + 0.001; t += 1) {
        const x = s.ax + s.dx * t - s.dz * sd * (W / 2), z = s.az + s.dz * t + s.dx * sd * (W / 2);
        const hidden = segs.some((o, k) => k !== i && distSeg(o, x, z) < W / 2 - 0.5) || ramps.some(p => distSeg(p.rampSeg, x, z) < W / 2 - 0.5 && p.feeder !== s.feeder);
        if (!hidden) { if (!run) runs.push(run = [t, t]); else run[1] = t; } else run = null;
      }
      runs.forEach(([t0, t1]) => { if (t1 - t0 < 0.5) return; const m = (t0 + t1) / 2, x = s.ax + s.dx * m - s.dz * sd * (W / 2 + 0.2), z = s.az + s.dz * m + s.dx * sd * (W / 2 + 0.2);
        bx(wallM, t1 - t0 + 1, CEIL, 0.4, x, FLOOR + CEIL / 2, z, ry); bx(baseM, t1 - t0 + 1, 1.1, 0.46, x, FLOOR + 0.55, z, ry); });
    });
  });
  { const lg = new THREE.InstancedMesh(boxGeo, lampM, Math.max(1, lamps.length)); lamps.forEach((q, k) => { const m = new THREE.Matrix4().compose(new THREE.Vector3(q[0], TOP - 0.1, q[1]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, q[2], 0)), new THREE.Vector3(2.4, 0.12, W * 0.55)); lg.setMatrixAt(k, m); }); lg.count = lamps.length; g.add(lg);
    const dg = new THREE.InstancedMesh(boxGeo, yellowM, Math.max(1, dashes.length)); dashes.forEach((q, k) => { const m = new THREE.Matrix4().compose(new THREE.Vector3(q[0], FLOOR + 0.012, q[1]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, q[2], 0)), new THREE.Vector3(3, 0.02, 0.2)); dg.setMatrixAt(k, m); }); dg.count = dashes.length; g.add(dg); }
  // station signs: a coloured light bar and a hanging name board over the lane at each station
  stationsAt.forEach(s => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
    if (x && x.fillRect) { x.fillStyle = '#' + s.color.toString(16).padStart(6, '0'); x.fillRect(0, 0, 512, 128); x.fillStyle = '#fff'; x.fillRect(0, 0, 512, 10); x.fillRect(0, 118, 512, 10); x.font = 'bold 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Ⓜ ' + String(s.name).toUpperCase(), 256, 66, 490); }
    const tex = new THREE.CanvasTexture(c), sg = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.75), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); sg.position.set(s.x, TOP - 1.3, s.z);
    const near = segs.find(q => !q.feeder && distSeg(q, s.x, s.z) < 1); sg.rotation.y = near ? Math.atan2(near.dx, near.dz) : 0; g.add(sg);
    bx(B(s.color), 9, 0.04, W - 1.5, s.x, FLOOR + 0.02, s.z, near ? Math.atan2(-near.dz, near.dx) : 0);
  });
  // ramps: floor, retaining walls, rim, the trench's end wall over the mouth, and a gantry sign at the top
  ramps.forEach(p => {
    const N = 29, flo = [], wl = [[], []], idx = [], P = (u, l, y) => [p.x + p.dx * u - p.dz * l, y, p.z + p.dz * u + p.dx * l];
    const fpos = [], wpos = [[], []];
    for (let i = 0; i <= N; i++) { const u = L * i / N, y = rampH(u); [-1, 1].forEach(s => fpos.push(...P(u, s * (W / 2 + 0.4), y - 0.02))); [-1, 1].forEach((s, k) => { wpos[k].push(...P(u, s * (W / 2 + 0.4), 0), ...P(u, s * (W / 2 + 0.4), y - 0.4)); }); if (i) { const a = i * 2; idx.push(a - 2, a - 1, a, a - 1, a + 1, a); } }
    void flo; void wl;
    const mk = (pos, m) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals(); const o = new THREE.Mesh(geo, m); g.add(o); };
    mk(fpos, new THREE.MeshBasicMaterial({ color: 0x1b1d20, side: THREE.DoubleSide }));
    mk(wpos[0], new THREE.MeshBasicMaterial({ color: 0x474c52, side: THREE.DoubleSide })); mk(wpos[1], new THREE.MeshBasicMaterial({ color: 0x474c52, side: THREE.DoubleSide }));
    const ry = Math.atan2(-p.dz, p.dx);
    for (let u = 3; u < L - 2; u += 7) { const q = P(u, 0, rampH(u) + 0.03); const o = bx(yellowM, 3, 0.02, 0.2, q[0], q[1], q[2], ry); o.rotation.z = -Math.atan2(rampH(u + 1) - rampH(u - 1), 2); }   // centre dashes follow the slope
    [-1, 1].forEach(s => { for (let u = 8; u < L; u += 2) { const q = P(u + 1, s * (W / 2 + 0.95), 0.45); bx(B(0xb9bdc2), 2.05, 0.9, 0.9, q[0], q[1], q[2], ry); } });   // rim blocks
    { const q = P(L + 0.4, 0, (TOP + 0) / 2 - 0.0); bx(wallM, 0.8, -TOP, W + 1.8, q[0], TOP / 2, q[2], ry); }       // the end wall above the mouth (ground to the roof)
    { const q = P(L + 0.1, 0, FLOOR / 2 + TOP / 2); void q; }
    // gantry over the mouth at the street: two posts, a lintel and the sign
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
    if (x && x.fillRect) { x.fillStyle = '#0d2342'; x.fillRect(0, 0, 512, 128); x.fillStyle = '#ffd24a'; x.font = 'bold 52px sans-serif'; x.textAlign = 'center'; x.fillText('Ⓜ METRO TUNNEL', 256, 62); x.fillStyle = '#fff'; x.font = '32px sans-serif'; x.fillText('▼ stations: ' + String(p.S.name || '').slice(0, 24), 256, 104, 480); }
    const post = (s) => { const q = P(1.5, s * (W / 2 + 1.8), 3.2); bx(B(0x3a3f45), 0.5, 6.4, 0.5, q[0], q[1], q[2], ry); };
    post(-1); post(1); { const q = P(1.5, 0, 6.2); bx(B(0x3a3f45), 0.5, 0.7, W + 4.2, q[0], q[1], q[2], ry); const sg = new THREE.Mesh(new THREE.PlaneGeometry(W + 1, 2.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide })); const q2 = P(1.5, 0, 4.6); sg.position.set(q2[0], q2[1], q2[2]); sg.rotation.y = Math.atan2(p.dx, p.dz); g.add(sg); }
    for (let k = -3; k <= 3; k++) { const q = P(-1.5, k * 1.5, 0.03); bx(k % 2 ? B(0x111111) : yellowM, 0.8, 0.03, 1.4, q[0], q[1], q[2], ry); }       // hazard stripes across the mouth
  });
  let was = false, nameShown = null;
  api.update = (dt, car) => {
    const under = car.y < -3;
    if (under && !was) toast('Metro tunnel - follow it to the stations');
    was = under; api.active = under;
    if (under) { const s = stationsAt.find(q => Math.hypot(q.x - car.x, q.z - car.z) < 6); if (s && nameShown !== s.name) { nameShown = s.name; toast(s.name + ' station'); } else if (!s) nameShown = null; }
  };
  return api;
}
