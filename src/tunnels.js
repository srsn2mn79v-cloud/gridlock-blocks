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

  // ---- the line tunnels: each line is a smooth curve (centripetal Catmull-Rom through the stations, with a straight lead-in either side of every station) ----
  const segs = [];                                        // short body segments (floor at FLOOR), grouped in chains
  const stationsAt = [];                                  // { x, z, name, color }
  let chainId = 0; const chains = [];
  const addChain = (pts, extra = {}) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
    const n = Math.max(2, Math.ceil(curve.getLength() / 6)), sp = curve.getSpacedPoints(n), id = chainId++;
    for (let i = 0; i < n; i++) segs.push(seg(sp[i].x, sp[i].z, sp[i + 1].x, sp[i + 1].z, { chain: id, idx: i, last: i === n - 1, ...extra }));
    chains.push({ id, pts: sp.map(v => ({ x: v.x, z: v.z })), ...extra });
  };
  lines.forEach(l => {
    const st = l.stations, pts = [];
    st.forEach((s, i) => {
      stationsAt.push({ x: s.x, z: s.z, name: s.name, color: l.color });
      const p = st[i - 1] || s, n = st[i + 1] || s, tx = n.x - p.x, tz = n.z - p.z, tl = Math.hypot(tx, tz) || 1;
      const lp = i ? Math.hypot(s.x - p.x, s.z - p.z) : 1e9, ln = i + 1 < st.length ? Math.hypot(n.x - s.x, n.z - s.z) : 1e9, a = Math.min(30, 0.3 * Math.min(lp, ln));
      if (i) pts.push({ x: s.x - tx / tl * a, z: s.z - tz / tl * a });
      pts.push({ x: s.x, z: s.z });
      if (i + 1 < st.length) pts.push({ x: s.x + tx / tl * a, z: s.z + tz / tl * a });
    });
    addChain(pts, { line: l });
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
    addChain([{ x: p.bx, z: p.bz }, { x: mx, z: mz }, { x: p.S.x, z: p.S.z }], { feeder: p });
    p.rampSeg = seg(p.x, p.z, p.bx, p.bz, { ramp: true });
  });

  // ---- height, hole polygons, walls (collision) ----
  const rampH = u => FLOOR * sm(Math.max(0, Math.min(1, u / L)));
  const segGrid = new Map();
  segs.forEach(s => put(segGrid, Math.min(s.ax, s.bx) - 8, Math.min(s.az, s.bz) - 8, Math.max(s.ax, s.bx) + 8, Math.max(s.az, s.bz) + 8, s));
  const nearSegs = (x, z) => segGrid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)) || [];
  const inUnion = (x, z, rad) => nearSegs(x, z).some(s => distSeg(s, x, z) < rad) || ramps.some(p => distSeg(p.rampSeg, x, z) < rad);
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
      const lim = W / 2 - 1.65; let best = null;
      const all = nearSegs(car.x, car.z).concat(ramps.map(p => p.rampSeg));
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
  // everything repeated (floor, rails, sleepers, walls ...) is instanced: one draw call per material
  const inst = new Map(); const bxi = (m, len, h, wd, x, y, z, ry) => { let a = inst.get(m); if (!a) inst.set(m, a = []); a.push([len, h, wd, x, y, z, ry]); };
  const ballastM = B(0x4a463f), sleeperM = B(0x6b6258), railM = B(0xc4c7cc), walkM = B(0x75787c), cableM = B(0x1f2124), stripM = B(0xd9b21c);
  const lamps = [];
  const joinedOther = (x, z, s) => nearSegs(x, z).some(o => o.chain !== s.chain && distSeg(o, x, z) < 1) || ramps.some(p => distSeg(p.rampSeg, x, z) < 1);
  const hiddenAt = (x, z, s) => nearSegs(x, z).some(o => o !== s && (o.chain !== s.chain || Math.abs(o.idx - s.idx) > 2) && distSeg(o, x, z) < W / 2 - 0.5) || ramps.some(p => distSeg(p.rampSeg, x, z) < W / 2 - 0.5 && p.feeder !== s.feeder);
  const TR = 1.9;                                          // two tracks, this far either side of the centre line
  segs.forEach((s, i) => {
    const free0 = s.idx === 0 && !s.noExtStart && !joinedOther(s.ax, s.az, s), free1 = s.last && !joinedOther(s.bx, s.bz, s);
    const ry = Math.atan2(-s.dz, s.dx), e0 = free0 ? 0 : 0.7, e1 = free1 ? 0 : 0.7, len = s.len + e0 + e1, m0 = (s.len + e1 - e0) / 2, cx = s.ax + s.dx * m0, cz = s.az + s.dz * m0, j = (i % 7) * 0.003;
    const at = (t, lat) => [s.ax + s.dx * t - s.dz * lat, s.az + s.dz * t + s.dx * lat];
    { const q = at(m0, 0); bxi(ballastM, len, 0.4, W + 0.6, q[0], FLOOR - 0.2 - j, q[1], ry); bxi(ceilM, len, 0.5, W + 1.2, q[0], TOP + 0.25 + j, q[1], ry); }
    [-1, 1].forEach(sd => {
      [-0.72, 0.72].forEach(o => { const q = at(m0, sd * TR + o); bxi(railM, len, 0.16, 0.13, q[0], FLOOR + 0.2 + j, q[1], ry); });                 // the two rails of each track
      for (let t = 0.3; t < s.len; t += 1.2) { const q = at(t, sd * TR); bxi(sleeperM, 0.4, 0.13, 3.1, q[0], FLOOR + 0.065, q[1], ry); }              // sleepers
    });
    for (let t = 6; t < s.len - 3; t += 16) { if (i % 3 === 0) lamps.push([s.ax + s.dx * t, s.az + s.dz * t, ry]); }
    if (free0) bxi(wallM, 0.5, CEIL, W + 0.8, s.ax - s.dx * 0.25, FLOOR + CEIL / 2, s.az - s.dz * 0.25, ry);      // the dead end of a line: a wall across it
    if (free1) bxi(wallM, 0.5, CEIL, W + 0.8, s.bx + s.dx * 0.25, FLOOR + CEIL / 2, s.bz + s.dz * 0.25, ry);
    // walls, walkway ledge and cable tray along both sides, in 3 u pieces, left out where another tunnel opens into this one
    [-1, 1].forEach(sd => {
      for (let t = 0; t < s.len; t += 3) {
        const pl = Math.min(3, s.len - t), mid = t + pl / 2, w = at(mid, sd * (W / 2)); if (hiddenAt(w[0], w[1], s)) continue;
        const q = at(mid, sd * (W / 2 + 0.2)); bxi(wallM, pl + 0.5, CEIL, 0.4, q[0], FLOOR + CEIL / 2, q[1], ry); bxi(baseM, pl + 0.5, 1.0, 0.46, q[0], FLOOR + 0.5, q[1], ry);
        const wk = at(mid, sd * (W / 2 - 0.65)); bxi(walkM, pl + 0.5, 0.34, 1.3, wk[0], FLOOR + 0.17, wk[1], ry);
        const st = at(mid, sd * (W / 2 - 1.3)); bxi(stripM, pl + 0.5, 0.02, 0.12, st[0], FLOOR + 0.35, st[1], ry);
        const cb = at(mid, sd * (W / 2 - 0.12)); bxi(cableM, pl + 0.5, 0.14, 0.14, cb[0], FLOOR + 2.1, cb[1], ry); bxi(cableM, pl + 0.5, 0.14, 0.14, cb[0], FLOOR + 2.45, cb[1], ry);
      }
    });
  });
  { const mat = new THREE.Matrix4(), qt = new THREE.Quaternion(), eu = new THREE.Euler(), p3 = new THREE.Vector3(), s3 = new THREE.Vector3();
    inst.forEach((arr, m) => { const im = new THREE.InstancedMesh(boxGeo, m, arr.length); arr.forEach((a, k) => { mat.compose(p3.set(a[3], a[4], a[5]), qt.setFromEuler(eu.set(0, a[6], 0)), s3.set(a[0], a[1], a[2])); im.setMatrixAt(k, mat); }); im.frustumCulled = false; g.add(im); });
    const lg = new THREE.InstancedMesh(boxGeo, lampM, Math.max(1, lamps.length)); lamps.forEach((q, k) => { mat.compose(p3.set(q[0], TOP - 0.1, q[1]), qt.setFromEuler(eu.set(0, q[2], 0)), s3.set(2.4, 0.12, W * 0.55)); lg.setMatrixAt(k, mat); }); lg.count = lamps.length; lg.frustumCulled = false; g.add(lg); }
  // station signs: a coloured light bar and a hanging name board over the lane at each station
  stationsAt.forEach(s => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
    if (x && x.fillRect) { x.fillStyle = '#' + s.color.toString(16).padStart(6, '0'); x.fillRect(0, 0, 512, 128); x.fillStyle = '#fff'; x.fillRect(0, 0, 512, 10); x.fillRect(0, 118, 512, 10); x.font = 'bold 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Ⓜ ' + String(s.name).toUpperCase(), 256, 66, 490); }
    const tex = new THREE.CanvasTexture(c), sg = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.75), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); sg.position.set(s.x, TOP - 1.3, s.z);
    const near = segs.find(q => !q.feeder && distSeg(q, s.x, s.z) < 2); sg.rotation.y = near ? Math.atan2(near.dx, near.dz) : 0; g.add(sg);
    if (near) [-1, 1].forEach(sd => bx(B(s.color), 26, 0.5, 0.08, s.x - near.dz * sd * (W / 2 - 0.02), FLOOR + 2.8, s.z + near.dx * sd * (W / 2 - 0.02), Math.atan2(-near.dz, near.dx)));      // a coloured band along both walls
  });
  const gates = [];
  // ramps: floor, retaining walls, rim, the trench's end wall over the mouth, and a gantry sign at the top
  ramps.forEach(p => {
    const N = 29, flo = [], wl = [[], []], idx = [], P = (u, l, y) => [p.x + p.dx * u - p.dz * l, y, p.z + p.dz * u + p.dx * l];
    const fpos = [], wpos = [[], []];
    for (let i = 0; i <= N; i++) { const u = L * i / N, y = rampH(u); [-1, 1].forEach(s => fpos.push(...P(u, s * (W / 2 + 0.4), y - 0.02))); [-1, 1].forEach((s, k) => { wpos[k].push(...P(u, s * (W / 2 + 0.4), 0), ...P(u, s * (W / 2 + 0.4), y - 0.4)); }); if (i) { const a = i * 2; idx.push(a - 2, a - 1, a, a - 1, a + 1, a); } }
    void flo; void wl;
    const mk = (pos, m) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals(); const o = new THREE.Mesh(geo, m); g.add(o); };
    mk(fpos, new THREE.MeshBasicMaterial({ color: 0x5a5d60, side: THREE.DoubleSide }));       // bare concrete: a service ramp, not a street
    mk(wpos[0], new THREE.MeshBasicMaterial({ color: 0x474c52, side: THREE.DoubleSide })); mk(wpos[1], new THREE.MeshBasicMaterial({ color: 0x474c52, side: THREE.DoubleSide }));
    const ry = Math.atan2(-p.dz, p.dx);
    [-1, 1].forEach(sd => { for (let u = 2; u < L - 2; u += 2.5) { const q = P(u, sd * 1.5, rampH(u) + 0.03); const o = bx(B(0x44474a), 2.6, 0.02, 0.9, q[0], q[1], q[2], ry); o.rotation.z = -Math.atan2(rampH(u + 1) - rampH(u - 1), 2); } });   // two worn wheel tracks
    [-1, 1].forEach(s => { for (let u = 8; u < L; u += 2) { const q = P(u + 1, s * (W / 2 + 0.95), 0.45); bx(B(0xb9bdc2), 2.05, 0.9, 0.9, q[0], q[1], q[2], ry); } });   // rim blocks
    { const q = P(L + 0.4, 0, (TOP + 0) / 2 - 0.0); bx(wallM, 0.8, -TOP, W + 1.8, q[0], TOP / 2, q[2], ry); }       // the end wall above the mouth (ground to the roof)
    { const q = P(L + 0.1, 0, FLOOR / 2 + TOP / 2); void q; }
    // gantry over the mouth at the street: two posts, a lintel and the sign
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
    if (x && x.fillRect) { x.fillStyle = '#f2f2ee'; x.fillRect(0, 0, 512, 128); x.fillStyle = '#c21f1f'; x.fillRect(0, 0, 512, 10); x.fillRect(0, 118, 512, 10); x.font = 'bold 44px sans-serif'; x.textAlign = 'center'; x.fillText('Ⓜ METRO MAINTENANCE', 256, 58, 490); x.fillStyle = '#111'; x.font = 'bold 30px sans-serif'; x.fillText('AUTHORISED VEHICLES ONLY', 256, 100, 480); }
    const post = (s) => { const q = P(1.5, s * (W / 2 + 1.8), 3.2); bx(B(0x3a3f45), 0.5, 6.4, 0.5, q[0], q[1], q[2], ry); };
    post(-1); post(1); { const q = P(1.5, 0, 6.2); bx(B(0x3a3f45), 0.5, 0.7, W + 4.2, q[0], q[1], q[2], ry); const sg = new THREE.Mesh(new THREE.PlaneGeometry(W + 1, 2.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide })); const q2 = P(1.5, 0, 4.6); sg.position.set(q2[0], q2[1], q2[2]); sg.rotation.y = Math.atan2(p.dx, p.dz); g.add(sg); }
    // a boom gate across the top of the ramp: post, counterweight, a red-and-white arm that lifts when a car comes up to it, amber beacons
    { const q = P(4, -(W / 2 + 1.1), 0), piv = new THREE.Group(), arm = new THREE.Group(); piv.position.set(q[0], 1.15, q[2]); piv.rotation.y = Math.atan2(-p.dx, -p.dz); piv.add(arm); g.add(piv);
      bx(B(0x2c2f33), 0.6, 1.3, 0.6, q[0], 0.65, q[2], ry);
      for (let k = 0; k < 9; k++) { const m = new THREE.Mesh(boxGeo, B(k % 2 ? 0xf4f4f0 : 0xd0221f)); m.scale.set((W + 1.4) / 9, 0.22, 0.14); m.position.set((k + 0.5) * (W + 1.4) / 9, 0, 0); arm.add(m); }
      { const m = new THREE.Mesh(boxGeo, B(0x2c2f33)); m.scale.set(1.2, 0.5, 0.4); m.position.set(-0.7, 0, 0); arm.add(m); }
      const lampA = B(0xffb020), mkL = sd => { const q2 = P(4, sd * (W / 2 + 1.1), 0); const m = bx(lampA, 0.3, 0.3, 0.3, q2[0], sd < 0 ? 1.6 : 1.3, q2[2], ry); if (sd > 0) bx(B(0x2c2f33), 0.3, 1.15, 0.3, q2[0], 0.58, q2[2], ry); return m; };
      mkL(-1); mkL(1); gates.push({ arm, lamp: lampA, x: p.x + p.dx * 4, z: p.z + p.dz * 4, open: 0 }); }
    for (let k = -3; k <= 3; k++) { const q = P(-1.5, k * 1.5, 0.03); bx(k % 2 ? B(0x111111) : yellowM, 0.8, 0.03, 1.4, q[0], q[1], q[2], ry); }       // hazard stripes across the mouth
  });
  // ---- trains: one per line, four carriages, shuttling end to end on the right-hand track and waiting at every station ----
  const trains = [];
  chains.filter(c => c.line).forEach(c => {
    const pts = c.pts, cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const total = cum[cum.length - 1]; if (total < 160) return;
    const at = sv => { sv = Math.max(0, Math.min(total, sv)); let i = 1; while (i < pts.length - 1 && cum[i] < sv) i++; const t = (sv - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / L, dz: (b.z - a.z) / L }; };
    const stops = c.line.stations.map(st => { let bi = 0, bd = 1e9; pts.forEach((q, i) => { const d = Math.hypot(q.x - st.x, q.z - st.z); if (d < bd) { bd = d; bi = i; } }); return cum[bi]; }).sort((a, b) => a - b);
    const body = B(0xc9ced4), stripe = B(c.line.color || 0x3388ff), win = B(0xfff3c4), dark = B(0x23262a), cars = [];
    for (let k = 0; k < 4; k++) {
      const grp = new THREE.Group(), add = (m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(boxGeo, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); grp.add(o); };
      add(body, 13.4, 2.9, 2.9, 0, 2.0, 0); add(dark, 12.6, 0.5, 2.5, 0, 0.45, 0); add(stripe, 13.44, 0.35, 2.94, 0, 1.25, 0); add(win, 11.6, 0.95, 2.96, 0, 2.55, 0); add(dark, 13.2, 0.25, 2.2, 0, 3.55, 0);
      [-4.6, -1.55, 1.55, 4.6].forEach(x => add(dark, 0.25, 1.0, 2.98, x, 2.55, 0));                                        // window pillars
      if (k === 0 || k === 3) { const e = k === 0 ? 1 : -1; add(win, 0.1, 0.9, 2.2, e * 6.72, 2.55, 0); add(B(0xffffff), 0.12, 0.25, 0.4, e * 6.74, 1.0, 0.9); add(B(0xffffff), 0.12, 0.25, 0.4, e * 6.74, 1.0, -0.9); }
      g.add(grp); cars.push(grp);
    }
    trains.push({ at, total, stops, cars, s: Math.max(30, Math.min(total - 30, stops[0] || 40)), dir: 1, v: 0, wait: 4 });
  });
  const TRAIN_V = 19, CAR_GAP = 14.2; let warnT = 0;
  function stepTrains(dt, car) {
    trains.forEach(tr => {
      // where it has to stop next: the next station in its direction, or the end of the line
      const lim0 = 30, lim1 = tr.total - 30, ahead = tr.dir > 0 ? tr.stops.find(q => q > tr.s + 0.5) : [...tr.stops].reverse().find(q => q < tr.s - 0.5);
      const goal = ahead !== undefined ? Math.max(lim0, Math.min(lim1, ahead)) : (tr.dir > 0 ? lim1 : lim0), left = Math.abs(goal - tr.s);
      // a car on its track ahead: it brakes for it
      const head = tr.at(tr.s + tr.dir * 21), hx = head.dx * tr.dir, hz = head.dz * tr.dir; let block = false;
      if (car.y < -3) { const rx = car.x - head.x, rz = car.z - head.z, fwd = rx * hx + rz * hz, lat = -rx * hz + rz * hx; if (fwd > -4 && fwd < 46 && Math.abs(lat - TR * 1) < 2.6) block = true; }
      if (tr.wait > 0) { tr.wait -= dt; tr.v = 0; }
      else {
        const want = block ? 0 : Math.min(TRAIN_V, Math.sqrt(2 * 5 * Math.max(0, left - 0.3)) + 0.6);
        tr.v += Math.max(-9 * dt, Math.min(4 * dt, want - tr.v)); tr.s += tr.dir * tr.v * dt;
        if (!block && left < 0.6) { tr.s = goal; tr.v = 0; tr.wait = 7; if (ahead === undefined) tr.dir = -tr.dir; }
      }
      tr.cars.forEach((grp, k) => {
        const off = (k - 1.5) * CAR_GAP, q = tr.at(tr.s - tr.dir * off), dx = q.dx * tr.dir, dz = q.dz * tr.dir;
        grp.position.set(q.x - dz * TR, FLOOR + 0.28, q.z + dx * TR); grp.rotation.y = Math.atan2(-dz, dx);
        // a car that is in the way all the same gets shoved to the side walkway
        if (car.y < -3) { const rx = car.x - grp.position.x, rz = car.z - grp.position.z, fwd = rx * dx + rz * dz, lat = -rx * dz + rz * dx; if (Math.abs(fwd) < 8.2 && Math.abs(lat) < 2.5) { const sd = lat >= 0 ? 1 : -1; car.x += -dz * sd * (2.5 - Math.abs(lat)); car.z += dx * sd * (2.5 - Math.abs(lat)); car.speed *= 0.9; if (warnT <= 0) { warnT = 4; toast('Mind the train!'); } } }
      });
    });
    warnT -= dt;
  }
  let was = false, nameShown = null;
  api.update = (dt, car) => {
    const under = car.y < -3;
    if (under && !was) toast('Metro service tunnel - watch out for trains');
    was = under; api.active = under;
    stepTrains(dt, car);
    const blink = (performance.now() % 900) < 450; gates.forEach(gt => { const near = Math.hypot(car.x - gt.x, car.z - gt.z) < 20 && car.y > -6; gt.open += ((near ? 1 : 0) - gt.open) * Math.min(1, dt * 3.5); gt.arm.rotation.z = gt.open * 1.38; gt.lamp.color.setHex(blink && near ? 0xffd060 : 0x8a5a10); });
    if (under) { const s = stationsAt.find(q => Math.hypot(q.x - car.x, q.z - car.z) < 6); if (s && nameShown !== s.name) { nameShown = s.name; toast(s.name + ' station'); } else if (!s) nameShown = null; }
  };
  api.trains = trains; api.gates = gates;
  return api;
}
