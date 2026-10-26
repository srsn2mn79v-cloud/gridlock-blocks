// Gridlock Blocks' Chicago: roads from gen_network.js, plus everything built on them - signals,
// street furniture, parked cars, buildings (by district), parks and water, the five coloured
// shops hidden in alleys, and apartments to buy. Deterministic (seeded) so every load is the same city.
import { generateRoads } from './gen_network.js';
import { buildEdgesByNode, intersectionClearance } from '../roadMath.js';
import { S, T, TP, fromWorld, LAKE_N, LAKE_S, PIER, RIVERS, PARKS, LANDMARKS, STADIUM, districtAt } from './map.js';
import { rng, dist, distToSeg, pointInPoly, ribbonPoly, nearestOnPoly, atLen, polyLen } from './geom.js';

const r2 = v => Math.round(v * 100) / 100;
// 4 s of all-red between one direction turning red and the other turning green, so busy junctions clear
const GREEN = 7000, YELLOW = 2000, CLEAR = 4000, HALF = GREEN + YELLOW + CLEAR, RED = 2 * HALF - GREEN - YELLOW;

export const SHOP_KINDS = {
  dealer:  { name: 'Car Dealership',   color: '#17d6c8', hex: 0x17d6c8, desc: 'Buy new cars' },
  perf:    { name: 'Performance Shop', color: '#2f7bff', hex: 0x2f7bff, desc: 'Engine, tyres, brakes' },
  paint:   { name: 'Paint & Decals',   color: '#ff3b3b', hex: 0xff3b3b, desc: 'Paint jobs, stripes, decals' },
  tuning:  { name: 'Tuning Shop',      color: '#ffd21f', hex: 0xffd21f, desc: 'Neon, tint, trunk and HUD extras' },
  body:    { name: 'Body Kit Shop',    color: '#33d65a', hex: 0x33d65a, desc: 'Bumpers, skirts, spoilers, fenders' }
};
// Apartments by price. W x D is the floor plan in world units (1 u = 1.25 m, so 1 u^2 = 1.56 m^2), `floor` how high up the
// building it sits, `garage` the parking spaces in its underground garage, and the rooms it has besides the open living area.
export const APARTMENT_TIERS = [
  { key: 'micro',     label: 'Micro Studio',  price: 9000,   W: 6.4,  D: 7.4,  floor: 2,  garage: 1, beds: 0, baths: 1 },
  { key: 'studio',    label: 'Studio',        price: 19000,  W: 7.6,  D: 8.6,  floor: 3,  garage: 1, beds: 0, baths: 1 },
  { key: 'onebed',    label: 'One-Bedroom',   price: 42000,  W: 9.6,  D: 10.6, floor: 5,  garage: 2, beds: 1, baths: 1 },
  { key: 'twobed',    label: 'Two-Bedroom',   price: 86000,  W: 11.6, D: 12.0, floor: 8,  garage: 2, beds: 2, baths: 2 },
  { key: 'loft',      label: 'Loft',          price: 165000, W: 14.0, D: 13.4, floor: 12, garage: 4, beds: 3, baths: 2 },
  { key: 'penthouse', label: 'Penthouse',     price: 390000, W: 17.0, D: 15.0, floor: 18, garage: 6, beds: 4, baths: 3 }
];
export const FLOOR_H = 3.4;
export const AGENT_MARKUP = 1.10;
export const regionOf = (x, z) => (z > Math.abs(x) ? 'north' : z < -Math.abs(x) ? 'south' : x < 0 ? 'east' : 'west');   // east is -x on this map

export function buildChicago() {
  const rand = rng(20261008);
  const R = generateRoads();
  const warnings = R.warnings.slice();

  // ---------------------------------------------------------------- roads -> city schema
  const used = new Set(); R.net.edges.forEach(e => { used.add(e.from); used.add(e.to); });
  const idOf = {}; let ni = 0;
  const nodes = {};
  R.net.nodes.forEach((n, i) => { if (!used.has(i)) return; const id = 'n' + ni++; idOf[i] = id; nodes[id] = { x: r2(n.x), z: r2(n.z), elevation: r2(n.elev) }; });
  const CL = { hw: { type: 'highway', width: 15, lanes: 3 }, six: { type: 'avenue', width: 24, lanes: 3 }, four: { type: 'avenue', width: 16, lanes: 2 },
    two: { type: 'local', width: 9 }, ramp: { type: 'avenue', width: 8, lanes: 1 } };
  const edges = R.net.edges.map((e, i) => {
    const c = CL[e.line.cls];
    const o = { id: 'e' + i, from: idOf[e.from], to: idOf[e.to], width: c.width, type: c.type, structure: e.deckEdge ? 'bridge' : 'surface' };
    if (c.lanes) o.lanes = c.lanes;
    if (e.line.cls === 'hw' || e.line.cls === 'ramp') o.sidewalks = false;
    if (e.line.cls === 'ramp') { o.oneWay = true; o.ramp = true; o.lanes = 1; }
    if (e.line.cls === 'hw') o.oneWay = true;
    o.cls = e.line.cls;
    return o;
  });
  const byNode = buildEdgesByNode(edges);
  const other = (e, id) => (e.from === id ? e.to : e.from);

  // exits: tag the first edge of every exit slip road, with the next exits on that carriageway
  const ixs = R.IX.filter(x => x.P);
  const EXTRA_S = [{ no: 53, label: 'Chinatown' }, { no: 54, label: 'McCormick Pl' }];
  const EXTRA_N = [{ no: 50, label: 'Gold Coast' }, { no: 49, label: 'Lincoln Park' }];
  R.ramps.filter(r => r.kind === 'exit').forEach(r => {
    const ix = r.ix, sorted = ixs.slice().sort((a, b) => (r.f > 0 ? a.hs - b.hs : b.hs - a.hs));
    const idx = sorted.indexOf(ix);
    const list = sorted.slice(idx + 1).map(x => ({ no: 50 + x.no, label: x.label })).concat(r.f > 0 ? EXTRA_S : EXTRA_N);
    const miles = ['2 MILES', '4 MILES'];
    const a = nodes[Object.keys(nodes).find(id => dist([nodes[id].x, nodes[id].z], r.pts[0]) < 3.5)];
    const firstId = Object.keys(nodes).find(id => dist([nodes[id].x, nodes[id].z], r.pts[0]) < 3.5);
    const e = edges.find(x => x.ramp && x.from === firstId && dist([nodes[x.to].x, nodes[x.to].z], r.pts[1]) < 140);
    if (e) e.exit = { no: 50 + ix.no, label: ix.label, next: list.slice(0, 2).map((x, i) => ({ ...x, dist: miles[i] })) };
    else warnings.push('exit edge not found for ' + ix.label);
  });

  // "next exits" boards for each carriageway: after every interchange and near each end
  const hwSigns = [];
  {
    const total = polyLen(R.H), miles = ['2 MILES', '4 MILES'];
    [1, -1].forEach(f => {
      const ahead = sPos => ixs.filter(x => (f > 0 ? x.hs > sPos + 40 : x.hs < sPos - 40)).sort((a, b) => f > 0 ? a.hs - b.hs : b.hs - a.hs)
        .map(x => ({ no: 50 + x.no, label: x.label })).concat(f > 0 ? EXTRA_S : EXTRA_N).slice(0, 2).map((x, i) => ({ ...x, dist: miles[i] }));
      const stations = [f > 0 ? 130 : total - 130].concat(ixs.map(x => x.hs + f * (R.ENTRY_END + 90))).filter(s => s > 100 && s < total - 100);
      stations.forEach(s => {
        const h = atLen(R.H, s), d = { x: f * h.dx, z: f * h.dz };
        hwSigns.push({ x: r2(h.x + (-h.dz) * f * R.CAR_OFF), z: r2(h.z + h.dx * f * R.CAR_OFF), d: { x: r2(d.x * 1000) / 1000, z: r2(d.z * 1000) / 1000 }, next: ahead(s) });
      });
    });
  }

  // ---------------------------------------------------------------- spatial lookups
  const BUCKET = 64;
  const segIndex = new Map();
  const segs = edges.map(e => ({ e, a: nodes[e.from], b: nodes[e.to] }));
  segs.forEach((s, i) => {
    const x0 = Math.min(s.a.x, s.b.x) - 40, x1 = Math.max(s.a.x, s.b.x) + 40, z0 = Math.min(s.a.z, s.b.z) - 40, z1 = Math.max(s.a.z, s.b.z) + 40;
    for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++) for (let bz = Math.floor(z0 / BUCKET); bz <= Math.floor(z1 / BUCKET); bz++) {
      const k = bx + ',' + bz; (segIndex.get(k) || segIndex.set(k, []).get(k)).push(i);
    }
  });
  // distance from a point to the nearest road surface (negative on the road); crossing levels are ignored
  // corners between roads of different widths are drawn as one tapering curve as wide as the wider road
  const degree = {}; edges.forEach(e => { (degree[e.from] ||= []).push(e); (degree[e.to] ||= []).push(e); });
  const taper = Object.keys(degree).filter(id => degree[id].length === 2 && !degree[id].some(e => e.type === 'highway'))
    .map(id => ({ x: nodes[id].x, z: nodes[id].z, r: Math.max(degree[id][0].width, degree[id][1].width) / 2 + (degree[id][0].width !== degree[id][1].width ? 9 : 5) }));
  function roadClear(x, z, skipRamps = false, noTaper = false) {
    const list = segIndex.get(Math.floor(x / BUCKET) + ',' + Math.floor(z / BUCKET));
    let best = 1e9;
    if (list) for (const i of list) {
      const s = segs[i]; if (skipRamps && s.e.ramp) continue;
      const d = distToSeg(x, z, s.a.x, s.a.z, s.b.x, s.b.z).d - s.e.width / 2;
      if (d < best) best = d;
    }
    if (!noTaper) for (const t of taper) { const dx = x - t.x; if (dx > 30 || dx < -30) continue; const d = Math.hypot(dx, z - t.z) - t.r; if (d < best) best = d; }
    return best;
  }
  const riverPolys = RIVERS.map(r => ribbonPoly(r.pts, r.half));
  const inWater = (x, z, m = 0) => {
    if (pointInPoly(x, z, LAKE_N) || pointInPoly(x, z, LAKE_S)) return true;
    for (const r of RIVERS) if (nearestOnPoly(x, z, r.pts).d < r.half + m) return true;
    return false;
  };
  const parkAt = (x, z) => PARKS.find(p => pointInPoly(x, z, p.pts));
  const hwSide = (() => { const c = T(450, 900); return nearestOnPoly(c[0], c[1], R.H).side; })();
  const outsideHW = (x, z, m = 0) => { const h = nearestOnPoly(x, z, R.H); return h.side !== hwSide || h.d < 24 + m; };

  // ---------------------------------------------------------------- signals
  const signals = [], props = [];
  const arterial = e => e.cls === 'six' || e.cls === 'four';
  const signalNodes = [];
  Object.keys(byNode).forEach(id => {
    const es = byNode[id];
    if (es.length < 3 || nodes[id].elevation > 0.5) return;
    const art = es.filter(arterial);
    if (art.length >= 3 && es.some(e => e.cls === 'six') && es.length <= 5 && !es.some(e => e.ramp || e.cls === 'hw') && es.every(e => e.structure !== 'bridge')) signalNodes.push(id);
  });
  function signalPole(nodeId, approachId) {
    const N = nodes[nodeId], A = nodes[approachId];
    const dx = N.x - A.x, dz = N.z - A.z, len = Math.hypot(dx, dz) || 1;
    const d = { x: dx / len, z: dz / len }, right = { x: -d.z, z: d.x };
    const approachEdge = byNode[nodeId].find(e => other(e, nodeId) === approachId);
    let far = null, best = -2;
    byNode[nodeId].forEach(e => {
      if (e === approachEdge) return;
      const o = nodes[other(e, nodeId)], ex = o.x - N.x, ez = o.z - N.z, l = Math.hypot(ex, ez) || 1, dot = (ex * d.x + ez * d.z) / l;
      if (dot > best) { best = dot; far = e; }
    });
    const farEdge = far && best > 0.7 ? far : approachEdge;
    const along = intersectionClearance(nodeId, farEdge, byNode) + 1.9;
    const lateral = (farEdge.width || 9) / 2 + 1.4;
    const arm = Math.max(1.5, lateral - (approachEdge.width || 9) / 4);
    return { type: 'trafficlight', x: r2(N.x + d.x * along + right.x * lateral), z: r2(N.z + d.z * along + right.z * lateral),
      rotation: Math.round(Math.atan2(-d.x, -d.z) * 180 / Math.PI), arm: r2(arm), signalNode: nodeId, signalApproach: approachId };
  }
  signalNodes.forEach(id => {
    const es = byNode[id].filter(e => !(e.oneWay && e.from === id));
    const ref = byNode[id].find(arterial);
    const ro = nodes[other(ref, id)], ra = Math.atan2(ro.z - nodes[id].z, ro.x - nodes[id].x);
    es.forEach((e, k) => {
      const o = nodes[other(e, id)], a = Math.atan2(o.z - nodes[id].z, o.x - nodes[id].x);
      const grpA = Math.abs(Math.cos(a - ra)) > 0.7071;
      signals.push({ id: 'sig_' + id + '_' + k, nodeId: id, edgeId: e.id, greenMs: GREEN, yellowMs: YELLOW, redMs: RED, offsetMs: grpA ? 0 : HALF });
      props.push(signalPole(id, other(e, id)));
    });
  });

  // ---------------------------------------------------------------- shop sites (reserved before buildings fill in)
  const blockedRects = [];        // [x0,z0,x1,z1] kept free of buildings (alleys)
  const shops = [];
  const SHOP_SPECS = [
    { kind: 'dealer', at: [470, 470], r: 90 },      // River North
    { kind: 'dealer', at: [380, 900], r: 90 },      // the Loop
    { kind: 'perf',   at: [120, 940], r: 70 },      // Industrial, by the interstate
    { kind: 'paint',  at: [330, 420], r: 90 },      // Old Town
    { kind: 'tuning', at: [440, 1180], r: 90 },     // Chinatown
    { kind: 'body',   at: [130, 780], r: 70 }       // Industrial north
  ];
  function findAlley(spec) {
    const c = T(spec.at[0], spec.at[1]), cands = [];
    edges.forEach(e => {
      if (e.cls !== 'two' && e.cls !== 'four') return;
      const a = nodes[e.from], b = nodes[e.to], len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 70) return;
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      for (let t = 32; t < len - 32; t += 14) for (const side of [1, -1]) {
        const px = a.x + ux * t, pz = a.z + uz * t, nx = -uz * side, nz = ux * side;
        const mx = px + nx * (e.width / 2 + 5), mz = pz + nz * (e.width / 2 + 5);
        if (dist([mx, mz], c) > spec.r * 2.6 * (S / 1.25)) continue;
        cands.push({ e, px, pz, nx, nz, ux, uz, mx, mz, score: dist([mx, mz], c) + rand() * 25 });
      }
    });
    cands.sort((p, q) => p.score - q.score);
    for (const k of cands) {
      // the alley runs 52 units straight back from the kerb, 20 wide: shop block at the end
      let ok = true;
      for (let d = 0; d <= 36 && ok; d += 4) for (let w = -10; w <= 10 && ok; w += 5) {
        const x = k.mx + k.nx * d + k.ux * w, z = k.mz + k.nz * d + k.uz * w;
        if (inWater(x, z, 6) || parkAt(x, z) || outsideHW(x, z, 12)) ok = false;
        else if (d > 3 && roadClear(x, z) < 4.5) ok = false;
        else if (shops.some(s => dist([s.x, s.z], [x, z]) < 26)) ok = false;
      }
      if (!ok) continue;
      return k;
    }
    return null;
  }
  SHOP_SPECS.forEach((spec, i) => {
    const k = findAlley(spec);
    if (!k) { warnings.push('no alley found for shop ' + spec.kind); return; }
    const kind = SHOP_KINDS[spec.kind];
    const sx = k.mx + k.nx * 27, sz = k.mz + k.nz * 27;
    const rot = Math.round(Math.atan2(-k.nx, -k.nz) * 180 / Math.PI);       // door faces back out of the alley
    const shop = { id: 'shop' + i, kind: spec.kind, name: kind.name, x: r2(sx), z: r2(sz), door: { x: r2(sx - k.nx * 7.5), z: r2(sz - k.nz * 7.5), rotation: rot },
      facade: { x: r2(sx - k.nx * 6), z: r2(sz - k.nz * 6), nx: -k.nx, nz: -k.nz },
      mouth: { x: r2(k.mx + k.nx * 3), z: r2(k.mz + k.nz * 3) }, nx: k.nx, nz: k.nz, ux: k.ux, uz: k.uz };
    shops.push(shop);
    blockedRects.push(Math.abs(k.nx) > Math.abs(k.nz)
      ? [Math.min(k.mx, k.mx + k.nx * 36), k.mz - 11, Math.max(k.mx, k.mx + k.nx * 36), k.mz + 11]
      : [k.mx - 11, Math.min(k.mz, k.mz + k.nz * 36), k.mx + 11, Math.max(k.mz, k.mz + k.nz * 36)]);
  });

  // ---------------------------------------------------------------- buildings
  const parcels = [];
  const rectFp = (x0, z0, x1, z1) => [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
  // water
  parcels.push({ type: 'water', footprint: LAKE_N.map(p => [r2(p[0]), r2(p[1])]) }, { type: 'water', footprint: LAKE_S.map(p => [r2(p[0]), r2(p[1])]) });
  riverPolys.forEach(p => parcels.push({ type: 'water', footprint: p.map(q => [r2(q[0]), r2(q[1])]) }));
  parcels.push({ type: 'plaza', footprint: PIER.map(p => [r2(p[0]), r2(p[1])]) });
  PARKS.forEach(p => parcels.push({ type: 'park', name: p.name, footprint: p.pts.map(q => [r2(q[0]), r2(q[1])]) }));
  // stadium
  const sc = T(STADIUM.cx, STADIUM.cy), sx = STADIUM.rx * 0.8, sz = STADIUM.ry * 0.8;
  parcels.push({ type: 'park', name: 'Pitch', footprint: rectFp(sc[0] - sx + 7, sc[1] - sz + 7, sc[0] + sx - 7, sc[1] + sz - 7) });
  [[-sx, -sz, sx, -sz + 7], [-sx, sz - 7, sx, sz], [-sx, -sz, -sx + 7, sz], [sx - 7, -sz, sx, sz]].forEach(([a, b, c, d]) =>
    parcels.push({ type: 'building', height: 17, color: 0xd8d2c4, roof: 'flat', footprint: rectFp(sc[0] + a, sc[1] + b, sc[0] + c, sc[1] + d) }));
  // landmarks
  const lmRects = [];
  LANDMARKS.forEach(([name, X0_, Y0_, X1_, Y1_, h]) => {
    const a = T(X0_, Y0_), b = T(X1_, Y1_);
    let x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
    if (nearestOnPoly((x0 + x1) / 2, (z0 + z1) / 2, R.H).side !== hwSide) return;
    // trim the footprint back from any road it would cover (the landmark rectangles are
    // drawn on the map, the road net is generated separately)
    for (let guard = 0; guard < 60; guard++) {
      let worst = null;
      for (let x = x0; x <= x1 + 0.01; x += 4) for (let z = z0; z <= z1 + 0.01; z += 4) {
        const d = roadClear(x, z); if (d < 5 && (!worst || d < worst.d)) worst = { x, z, d };
      }
      if (!worst) break;
      const dl = worst.x - x0, dr = x1 - worst.x, dt = worst.z - z0, db = z1 - worst.z, m = Math.min(dl, dr, dt, db);
      if (m === dl) x0 = worst.x + 6; else if (m === dr) x1 = worst.x - 6; else if (m === dt) z0 = worst.z + 6; else z1 = worst.z - 6;
      if (x1 - x0 < 16 || z1 - z0 < 16) { x1 = x0; break; }
    }
    if (x1 - x0 < 16 || z1 - z0 < 16 || inWater((x0 + x1) / 2, (z0 + z1) / 2, 0)) return;
    lmRects.push([x0 - 6, z0 - 6, x1 + 6, z1 + 6]);
    const tall = h > 100;
    parcels.push({ type: 'building', name, landmark: true, height: h, color: tall ? 0x20242b : 0xd9c9c4, roof: tall ? 'tiers' : 'flat', footprint: rectFp(x0, z0, x1, z1) });
  });
  // cells
  const C = 8, gx0 = -1500, gz0 = -1400, NX = Math.ceil((1250 - gx0) / C), NZ = Math.ceil((2350 - gz0) / C);
  const free = new Uint8Array(NX * NZ);
  const inRect = (x, z, r) => x > r[0] && x < r[2] && z > r[1] && z < r[3];
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
    const cx = gx0 + (i + 0.5) * C, cz = gz0 + (j + 0.5) * C;
    let ok = true;
    for (const [ox, oz] of [[0, 0], [-3.4, -3.4], [3.4, -3.4], [-3.4, 3.4], [3.4, 3.4]]) {
      const x = cx + ox, z = cz + oz;
      if (roadClear(x, z) < 5.2 || inWater(x, z, 3) || parkAt(x, z) || outsideHW(x, z, 14)) { ok = false; break; }
    }
    if (ok && roadClear(cx, cz) > 75) ok = false;
    if (ok && (blockedRects.some(r => inRect(cx, cz, r)) || lmRects.some(r => inRect(cx, cz, r)))) ok = false;
    if (ok) { const [X, Y] = fromWorld(cx, cz); if (Y > 1420 || Y < 205) ok = false; }
    free[i * NZ + j] = ok ? 1 : 0;
  }
  const PAL = {
    tower: [0x6b7a8f, 0x8793a5, 0x4f5d73, 0x9aa7b8, 0x5f7a8c, 0x6e6a78, 0x7f8a96],
    mid: [0xb9a58a, 0xa8b0a8, 0x8f8a80, 0xc2b59b, 0x9aa2b0, 0xaf9a86],
    low: [0x9b5a45, 0xa8654b, 0x8c4f3d, 0xb07a5a, 0x7e5a4a, 0xa3694e],
    warehouse: [0x7d7468, 0x8a8f8c, 0x6c7279, 0x93826e, 0x777f7b],
    china: [0xb23b34, 0xc9a24b, 0x8a3f3a, 0xd0b27a, 0x9c4a3e]
  };
  const pick = a => a[Math.floor(rand() * a.length)];
  const lots = [];
  const taken = new Uint8Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    if (!free[i * NZ + j] || taken[i * NZ + j]) continue;
    const cx = gx0 + (i + 0.5) * C, cz = gz0 + (j + 0.5) * C, [X, Y] = fromWorld(cx, cz), dis = districtAt(X, Y);
    const maxW = dis && (dis.style === 'tower') ? 6 : dis && dis.style === 'warehouse' ? 9 : dis && dis.style === 'low' ? 4 : 5, maxH = Math.max(3, maxW - Math.floor(rand() * 2));
    let w = 1; while (w < maxW && i + w < NX && free[(i + w) * NZ + j] && !taken[(i + w) * NZ + j] && rand() < 0.86) w++;
    let h = 1; const okRow = jj => { for (let k = 0; k < w; k++) if (!free[(i + k) * NZ + jj] || taken[(i + k) * NZ + jj]) return false; return true; };
    while (h < maxH && j + h < NZ && okRow(j + h) && rand() < 0.86) h++;
    for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) taken[(i + a) * NZ + j + b] = 1;
    lots.push({ x0: gx0 + i * C, x1: gx0 + (i + w) * C, z0: gz0 + j * C, z1: gz0 + (j + h) * C, dis });
  }
  lots.forEach(l => {
    const gap = 1.3;
    const x0 = l.x0 + gap, x1 = l.x1 - gap, z0 = l.z0 + gap, z1 = l.z1 - gap;
    if (x1 - x0 < 6 || z1 - z0 < 6) return;
    const dis = l.dis || { style: 'mid', h: [14, 34], name: 'Edge' };
    const k = Math.pow(rand(), dis.style === 'tower' ? 0.8 : 1.6);
    let hgt = Math.round(dis.h[0] + (dis.h[1] - dis.h[0]) * k);
    const roof = dis.style === 'low' ? (rand() < 0.55 ? 'gable' : 'flat') : dis.style === 'china' ? 'pagoda' : dis.style === 'warehouse' ? (rand() < 0.5 ? 'tank' : 'flat') : hgt > 55 ? 'tiers' : 'flat';
    parcels.push({ type: 'building', district: dis.name, height: hgt, color: pick(PAL[dis.style] || PAL.mid), roof, footprint: rectFp(r2(x0), r2(z0), r2(x1), r2(z1)) });
  });

  // ---- shop buildings (small, colour-coded) at the end of each alley
  shops.forEach(s => {
    const kind = SHOP_KINDS[s.kind];
    const hw = 8, hd = 6;
    const along = Math.abs(s.nx) > Math.abs(s.nz) ? 'x' : 'z';
    const x0 = along === 'x' ? s.x - hd : s.x - hw, x1 = along === 'x' ? s.x + hd : s.x + hw, z0 = along === 'x' ? s.z - hw : s.z - hd, z1 = along === 'x' ? s.z + hw : s.z + hd;
    parcels.push({ type: 'building', shop: s.id, height: 7, color: kind.hex, roof: 'flat', footprint: rectFp(r2(x0), r2(z0), r2(x1), r2(z1)) });
    props.push({ type: 'shoplamp', shop: s.kind, x: s.mouth.x, z: s.mouth.z, rotation: Math.round(Math.atan2(-s.nx, -s.nz) * 180 / Math.PI) });   // faces the street
    props.push({ type: 'shopsign', shop: s.kind, x: s.door.x, z: s.door.z, rotation: s.door.rotation });
  });

  // ---- apartments: the nicer the district the bigger the flat
  const apartments = [], agents = [], stores = [];
  const aptCandidates = parcels.filter(p => p.type === 'building' && !p.shop && !p.landmark && p.height >= 10 && p.district)
    .map(p => { const xs = p.footprint.map(q => q[0]), zs = p.footprint.map(q => q[1]); return { p, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...zs) + Math.max(...zs)) / 2, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }; });
  const APT_PLAN = [
    ['micro', 'Industrial', 2], ['micro', 'Chinatown', 1], ['studio', 'Chinatown', 2], ['studio', 'Industrial', 1], ['onebed', 'Old Town', 2], ['onebed', 'River North', 1],
    ['twobed', 'River North', 1], ['twobed', 'Loop Edge', 2], ['loft', 'Downtown', 2], ['loft', 'Gold Coast', 1], ['penthouse', 'Gold Coast', 1], ['penthouse', 'Downtown', 1]
  ];
  const aptNames = { Industrial: 'Foundry', Chinatown: 'Lantern', 'Old Town': 'Maple', 'River North': 'Riverside', Downtown: 'Skyline', 'Loop Edge': 'Union', 'Gold Coast': 'Lakeview' };
  // the building side facing the nearest street: [door x, door z, outward nx, nz, along-the-wall length, depth into the building]
  const frontOf = c => {
    const sides = [[c.x0 - 3.5, c.cz, -1, 0, c.z1 - c.z0, c.x1 - c.x0], [c.x1 + 3.5, c.cz, 1, 0, c.z1 - c.z0, c.x1 - c.x0], [c.cx, c.z0 - 3.5, 0, -1, c.x1 - c.x0, c.z1 - c.z0], [c.cx, c.z1 + 3.5, 0, 1, c.x1 - c.x0, c.z1 - c.z0]];
    let best = null;
    sides.forEach(s => { const d = roadClear(s[0], s[1]); if (!best || d < best.d) best = { d, s }; });
    return best;
  };
  const doorsTaken = [];
  const farFromDoors = (x, z, r) => !doorsTaken.some(q => dist(q, [x, z]) < r);
  APT_PLAN.forEach(([typeKey, district, count]) => {
    const t = APARTMENT_TIERS.find(a => a.key === typeKey), tierIdx = APARTMENT_TIERS.indexOf(t);
    let pool = aptCandidates.filter(c => c.p.district === district && !c.used);
    pool.sort(() => rand() - 0.5);
    if (tierIdx >= 4) pool.sort((p, q) => q.p.height - p.p.height);      // the dear ones go in the tall buildings
    for (let n = 0; n < count && pool.length; n++) {
      let chosen = null;
      for (const c of pool.slice(0, 60)) {
        const f = frontOf(c); if (f.d >= 14) continue;
        const [sx, sz, nx, nz, along, depth] = f.s;
        const W = Math.min(t.W, along - 3), D = Math.min(t.D, depth - 1.8);
        if (W < t.W * 0.72 || D < t.D * 0.72 || along < Math.max(15, t.W * 0.8 + 3)) continue;
        const maxFloor = Math.floor((c.p.height - 3.2) / FLOOR_H);
        if (maxFloor < Math.max(1, t.floor - 4)) continue;
        if (!farFromDoors(sx, sz, 80)) continue;
        chosen = { c, s: f.s, W, D, floor: Math.min(t.floor, maxFloor) }; break;
      }
      if (!chosen) continue;
      const { c, s, W, D, floor } = chosen; c.used = true; pool = pool.filter(x => x !== c);
      const [sx, sz, nx, nz, along] = s;
      const ux = -nz, uz = nx;                                  // along the wall
      const g = (along / 2 - 3.0) * (rand() < 0.5 ? 1 : -1);    // the garage door sits near the far end of the front
      const F = { x: sx - nx * 3.5, z: sz - nz * 3.5 };
      doorsTaken.push([sx, sz]);
      apartments.push({ id: 'apt' + apartments.length, type: t.key, tier: tierIdx, label: t.label, name: (aptNames[district] || 'Central') + ' ' + t.label, price: t.price, garage: t.garage, district,
        floor, rooms: 1 + t.beds, beds: t.beds, baths: t.baths, w: r2(W), d: r2(D), surface: Math.round(W * D * 1.5625), region: regionOf(sx, sz), height: c.p.height,
        door: { x: r2(sx), z: r2(sz), rotation: Math.round(Math.atan2(-nx, -nz) * 180 / Math.PI) },
        facade: { x: r2(F.x), z: r2(F.z), nx, nz },
        gate: { x: r2(F.x + ux * g), z: r2(F.z + uz * g), nx, nz, ux, uz } });
    }
  });
  // real estate agents: one office per region of the city, on a building front near the middle of that region
  [['north', 'Lakeshore Realty', -120, 900], ['south', 'Southgate Estates', 140, -1000], ['east', 'Harbour Homes', -520, 60], ['west', 'Prairie Properties', 560, 120]].forEach(([region, name, ax, az]) => {
    const pool = aptCandidates.filter(c => !c.used && c.p.height <= 60).sort((p, q) => dist([p.cx, p.cz], [ax, az]) - dist([q.cx, q.cz], [ax, az]));
    for (const c of pool.slice(0, 80)) {
      const f = frontOf(c); if (f.d >= 14 || f.s[4] < 9) continue;
      const [sx, sz, nx, nz] = f.s;
      if (!farFromDoors(sx, sz, 60)) continue;
      c.used = true; doorsTaken.push([sx, sz]);
      agents.push({ id: 'agent_' + region, region, name: name + ' (' + region[0].toUpperCase() + region.slice(1) + ')', door: { x: r2(sx), z: r2(sz), rotation: Math.round(Math.atan2(-nx, -nz) * 180 / Math.PI) }, facade: { x: r2(sx - nx * 3.5), z: r2(sz - nz * 3.5), nx, nz } });
      break;
    }
  });

  // clothes shops: a walk-in boutique on a ground-floor front in five parts of town (same door mechanic as a flat)
  [['Threadbare', -300, 420], ['Loop Looks', 40, -60], ['Gold Coast Garments', -200, 1000], ['Lantern Outfitters', 330, -520], ['Prairie Wear', 640, 150]].forEach(([name, ax, az], si) => {
    const pool = aptCandidates.filter(c => !c.used).sort((p, q) => dist([p.cx, p.cz], [ax, az]) - dist([q.cx, q.cz], [ax, az]));
    for (const c of pool.slice(0, 120)) {
      const f = frontOf(c); if (f.d >= 14 || f.s[4] < 14 || f.s[5] < 12) continue;
      const [sx, sz, nx, nz, along, depth] = f.s;
      if (!farFromDoors(sx, sz, 70)) continue;
      c.used = true; doorsTaken.push([sx, sz]);
      stores.push({ id: 'store' + si, store: true, name, tier: 3, floor: 0, w: r2(Math.min(11, along - 3)), d: r2(Math.min(9, depth - 2)), beds: 0, baths: 0, garage: 0, region: regionOf(sx, sz),
        door: { x: r2(sx), z: r2(sz), rotation: Math.round(Math.atan2(-nx, -nz) * 180 / Math.PI) }, facade: { x: r2(sx - nx * 3.5), z: r2(sz - nz * 3.5), nx, nz } });
      break;
    }
  });

  // ---------------------------------------------------------------- street furniture
  // lamps: along the big roads (both sides, alternating) and at every signalled corner
  const lampSpots = [];
  function sidePoint(e, t, side, off) {
    const a = nodes[e.from], b = nodes[e.to], len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    return { x: a.x + ux * t - uz * off * side, z: a.z + uz * t + ux * off * side, ux, uz, len, y: nodes[e.from].elevation };
  }
  const propOK = (x, z, minGap, list) => !list.some(p => Math.abs(p.x - x) < minGap && Math.abs(p.z - z) < minGap && dist([p.x, p.z], [x, z]) < minGap);
  const lampList = [];
  edges.forEach(e => {
    if (e.cls === 'hw' || e.cls === 'ramp' || e.structure === 'bridge') return;
    const spacing = e.cls === 'six' ? 34 : e.cls === 'four' ? 38 : e.cls === 'two' ? 56 : 0;   // alternating sides: a lamp every ~35-70 m per side
    if (!spacing) return;
    const a = nodes[e.from], b = nodes[e.to], len = Math.hypot(b.x - a.x, b.z - a.z);
    const c1 = Math.max(34, intersectionClearance(e.from, e, byNode) + 7), c2 = Math.max(34, intersectionClearance(e.to, e, byNode) + 7);   // bends (smoothed corners) eat ~20 u at each end
    let side = rand() < 0.5 ? 1 : -1;
    for (let t = c1; t < len - c2; t += spacing) {
      const p = sidePoint(e, t, side, e.width / 2 + 2.1); side = -side;
      if (nodes[e.from].elevation > 0.5 || nodes[e.to].elevation > 0.5) continue;
      if (roadClear(p.x, p.z) < 1.6 || inWater(p.x, p.z, 1) || parcelsHit(p.x, p.z, 1.2) || outsideHW(p.x, p.z, 0)) continue;
      if (!propOK(p.x, p.z, 10, lampList)) continue;
      // the arm reaches over the road: face the road centre
      lampList.push({ type: 'light', x: r2(p.x), z: r2(p.z), rotation: Math.round(Math.atan2((a.x + (b.x - a.x) * (t / len)) - p.x, (a.z + (b.z - a.z) * (t / len)) - p.z) * 180 / Math.PI) });
    }
  });
  // parcel hit test (buildings only), used to keep props out of buildings
  function parcelsHit(x, z, m) {
    for (const q of parcels) {
      if (q.type !== 'building') continue;
      const f = q.footprint, x0 = f[0][0], x1 = f[2][0], z0 = f[0][1], z1 = f[2][1];
      if (x > Math.min(x0, x1) - m && x < Math.max(x0, x1) + m && z > Math.min(z0, z1) - m && z < Math.max(z0, z1) + m) return true;
    }
    return false;
  }
  props.push(...lampList);

  // signal poles were placed before the buildings existed: nudge any that ended up in the road or a
  // building to the nearest clear spot, or drop them (the signal still runs, it just has one pole fewer)
  const poleOK = (x, z) => roadClear(x, z) >= 0.8 && roadClear(x, z, false, true) <= 4.8 && !parcelsHit(x, z, 0.4) && !inWater(x, z, 1) && !outsideHW(x, z, 0);
  for (let i = props.length - 1; i >= 0; i--) {
    const q = props[i];
    if (q.type !== 'trafficlight' || poleOK(q.x, q.z)) continue;
    let found = null;
    for (let r = 1; r <= 12 && !found; r += 1) for (let k = 0; k < 16 && !found; k++) {
      const ang = k * Math.PI / 8, x = q.x + Math.cos(ang) * r, z = q.z + Math.sin(ang) * r;
      if (poleOK(x, z)) found = [x, z];
    }
    if (found) { q.x = r2(found[0]); q.z = r2(found[1]); } else props.splice(i, 1);
  }

  // trees: in the parks, and along the quieter streets of the nicer districts
  const treeList = [];
  PARKS.forEach(pk => {
    const xs = pk.pts.map(p => p[0]), zs = pk.pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const step = pk.name === 'Grant Park' ? 17 : 13;
    for (let x = x0; x < x1; x += step) for (let z = z0; z < z1; z += step) {
      const px = x + (rand() - 0.5) * step * 0.8, pz = z + (rand() - 0.5) * step * 0.8;
      if (!pointInPoly(px, pz, pk.pts) || roadClear(px, pz) < 5 || parcelsHit(px, pz, 2)) continue;
      if (pk.name === 'Grant Park' && rand() < 0.35) continue;
      treeList.push({ type: rand() < 0.28 ? 'bush' : 'oak', x: r2(px), z: r2(pz), rotation: Math.floor(rand() * 360) });
    }
  });
  edges.forEach(e => {
    if (e.cls !== 'two' || e.structure === 'bridge') return;
    const a = nodes[e.from], b = nodes[e.to], len = Math.hypot(b.x - a.x, b.z - a.z);
    const mid = fromWorld((a.x + b.x) / 2, (a.z + b.z) / 2), dis = districtAt(mid[0], mid[1]);
    if (!dis || !['Gold Coast', 'Old Town', 'Chinatown', 'Loop Edge'].includes(dis.name)) return;
    const c1 = intersectionClearance(e.from, e, byNode) + 6, c2 = intersectionClearance(e.to, e, byNode) + 6;
    for (let t = c1; t < len - c2; t += 20) {
      const side = rand() < 0.5 ? 1 : -1, p = sidePoint(e, t, side, e.width / 2 + 3.6);
      if (roadClear(p.x, p.z) < 1.2 || inWater(p.x, p.z, 2) || parcelsHit(p.x, p.z, 1) || outsideHW(p.x, p.z, 0)) continue;
      if (!propOK(p.x, p.z, 6, treeList) || !propOK(p.x, p.z, 4, lampList)) continue;
      treeList.push({ type: 'tree', x: r2(p.x), z: r2(p.z), rotation: 0 });
    }
  });
  props.push(...treeList);
  // pedestrian path lights: low posts on a loose grid through the parks (they glow at night, see props.js / main.js)
  PARKS.forEach(pk => {
    const xs = pk.pts.map(p => p[0]), zs = pk.pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), step = 26;
    for (let x = x0 + 8; x < x1; x += step) for (let z = z0 + 8; z < z1; z += step) {
      const px = x + (rand() - 0.5) * 3, pz = z + (rand() - 0.5) * 3;
      if (!pointInPoly(px, pz, pk.pts) || roadClear(px, pz) < 5 || inWater(px, pz, 2) || parcelsHit(px, pz, 2) || !propOK(px, pz, 4, treeList)) continue;
      props.push({ type: 'pathlight', x: r2(px), z: r2(pz), rotation: 0 });
    }
  });

  // parked cars: along the kerb of the smaller streets (and some avenues), leaving the junctions clear
  const parked = [];
  const PARK_COLORS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0xecf0f1, 0x2c3e50, 0x7f8c8d, 0xd35400, 0x8e44ad, 0x1abc9c, 0xbdc3c7, 0x34495e];
  edges.forEach(e => {
    if (e.cls !== 'two' && e.cls !== 'four') return;
    if (e.structure === 'bridge' || nodes[e.from].elevation > 0.5 || nodes[e.to].elevation > 0.5) return;
    const a = nodes[e.from], b = nodes[e.to], len = Math.hypot(b.x - a.x, b.z - a.z);
    const c1 = intersectionClearance(e.from, e, byNode) + 8, c2 = intersectionClearance(e.to, e, byNode) + 8;
    const dens = e.cls === 'two' ? 0.5 : 0.28;
    [1, -1].forEach(side => {
      for (let t = c1; t < len - c2; t += 7.4) {
        if (rand() > dens) continue;
        const off = e.width / 2 - (e.cls === 'two' ? 0.15 : 0.6);
        const p = sidePoint(e, t, side, off);
        if (roadClear(p.x, p.z) < -2.5 || inWater(p.x, p.z, 2) || parcelsHit(p.x, p.z, 0.3) || outsideHW(p.x, p.z, 0)) continue;
        if (!propOK(p.x, p.z, 3.6, parked) || !propOK(p.x, p.z, 2.6, lampList) || !propOK(p.x, p.z, 2.4, treeList) || !propOK(p.x, p.z, 3, props.filter(q => q.type === 'trafficlight'))) continue;
        const h = Math.atan2(p.ux, p.uz) + (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.06;
        parked.push({ type: 'parkedcar', x: r2(p.x), z: r2(p.z), rotation: Math.round(h * 180 / Math.PI), color: pick(PARK_COLORS) });
      }
    });
  });
  props.push(...parked);
  // keep every garage entrance clear: nothing stands on the driveway
  apartments.forEach(a => { const g = a.gate; for (let i = props.length - 1; i >= 0; i--) { const q = props[i]; if (q.type === 'trafficlight') continue; const dx = q.x - g.x, dz = q.z - g.z, along = dx * g.nx + dz * g.nz, lat = dx * g.ux + dz * g.uz; if (along > -1.5 && along < 12 && Math.abs(lat) < 3.8) props.splice(i, 1); } });

  // plaza furniture on the pier and a fountain in each of the bigger parks
  [['Lincoln Green', 'fountain'], ['Hancock Plaza', 'fountain'], ['Riverwalk Park', 'fountain']].forEach(([name, type]) => {
    const pk = PARKS.find(p => p.name === name); if (!pk) return;
    const xs = pk.pts.map(p => p[0]), zs = pk.pts.map(p => p[1]);
    props.push({ type, x: r2((Math.min(...xs) + Math.max(...xs)) / 2), z: r2((Math.min(...zs) + Math.max(...zs)) / 2), rotation: 0 });
  });

  // ---------------------------------------------------------------- gameplay: spawn on Michigan-ish street downtown + checkpoints
  const spawnPt = T(440, 896);
  let spawnNode = null, sd = 1e9;
  Object.keys(nodes).forEach(id => { const d = dist([nodes[id].x, nodes[id].z], spawnPt); if (d < sd && byNode[id] && byNode[id].length >= 3) { sd = d; spawnNode = id; } });
  const sp = nodes[spawnNode];
  const sedge = byNode[spawnNode][0], so = nodes[other(sedge, spawnNode)];
  const gameplay = [{ type: 'spawn', x: sp.x, z: sp.z, heading: Math.atan2(so.x - sp.x, so.z - sp.z) }];

  edges.forEach(e => { delete e.cls; });
  const city = { roadNodes: nodes, roadEdges: edges, parcels, props, signals, gameplay, shops, apartments, agents, stores, warnings, hwSigns, hwLine: R.H.map(p => [r2(p[0]), r2(p[1])]),
    bounds: (() => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; Object.values(nodes).forEach(n => { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }); return [x0 - 90, z0 - 90, x1 + 90, z1 + 90]; })() };
  return city;
}
