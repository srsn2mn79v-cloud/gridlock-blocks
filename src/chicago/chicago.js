// Gridlock Blocks' Chicago: roads from gen_network.js, plus everything built on them - signals,
// street furniture, parked cars, buildings (by district), parks and water, the five coloured
// shops hidden in alleys, and apartments to buy. Deterministic (seeded) so every load is the same city.
import { generateRoads } from './gen_network.js';
import { CLASSES } from './network.js';
import { buildEdgesByNode, intersectionClearance } from '../roadMath.js';
import { S, T, TP, fromWorld, LAKES, DECKS, SPOTS, MAP, X0, Y0, RIVERS, PARKS, LANDMARKS, STADIUM, districtAt, DISTRICTS } from './map.js';
import { rng, dist, distToSeg, pointInPoly, ribbonPoly, nearestOnPoly, atLen, polyLen } from './geom.js';

const r2 = v => Math.round(v * 100) / 100;
// 4 s of all-red between one direction turning red and the other turning green, so busy junctions clear
const GREEN = 8500, YELLOW = 2500, CLEAR = 2000, HALF = GREEN + YELLOW + CLEAR, RED = 2 * HALF - GREEN - YELLOW;

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
  const CL = CLASSES;
  const edges = R.net.edges.map((e, i) => {
    const c = CL[e.line.cls];
    const o = { id: 'e' + i, from: idOf[e.from], to: idOf[e.to], width: c.width, type: c.type, structure: e.deckEdge ? 'bridge' : 'surface' };
    if (e.deckEdge && e.line.drawbridge) { o.drawbridge = true; o.sidewalks = false; }
    if (c.lanes) o.lanes = c.lanes;
    o.speedLimit = c.speedLimit;
    if (e.line.cls === 'hw' || e.line.cls === 'ramp') o.sidewalks = false;
    if (e.line.cls === 'ramp') { o.oneWay = true; o.ramp = true; o.lanes = 1; }
    if (e.line.cls === 'hw' || e.line.cls === 'hwEnd') o.oneWay = true;
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
    if (LAKES.some(l => pointInPoly(x, z, l))) return true;
    for (const r of RIVERS) if (nearestOnPoly(x, z, r.pts).d < r.half + m) return true;
    return false;
  };
  const parkAt = (x, z) => PARKS.find(p => pointInPoly(x, z, p.pts));
  const hwSide = (() => { const c = T(X0, Y0); return nearestOnPoly(c[0], c[1], R.H).side; })();
  const outsideHW = (x, z, m = 0) => { const h = nearestOnPoly(x, z, R.H); return h.side !== hwSide || h.d < 24 + m; };

  // ---------------------------------------------------------------- signals
  const signals = [], props = [];
  const arterial = e => e.cls === 'six' || e.cls === 'four';
  const signalNodes = [];
  Object.keys(byNode).forEach(id => {
    const es = byNode[id];
    if (es.length < 3 || nodes[id].elevation > 0.5) return;
    const art = es.filter(arterial);
    if (art.length >= 2 && es.length <= 5 && !es.some(e => e.ramp || e.cls === 'hw') && es.every(e => e.structure !== 'bridge')) signalNodes.push(id);
  });
  const spawnC = T(X0, Y0);
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
    const half = (approachEdge.width || 9) / 2;
    const lanesN = Math.max(1, Math.round(half / 3.7));
    const heads = [];
    for (let i = lanesN - 1; i >= 0; i--) heads.push(r2(Math.max(1.2, lateral - (i + 0.5) * half / lanesN)));   // one head over each approach lane
    const arm = heads[0];
    const sp = spawnC && Math.hypot(N.x - spawnC[0], N.z - spawnC[1]) < 300;      // inner city: suspended cable style
    const p0 = { type: 'trafficlight', x: r2(N.x + d.x * along + right.x * lateral), z: r2(N.z + d.z * along + right.z * lateral),
      rotation: Math.round(Math.atan2(-d.x, -d.z) * 180 / Math.PI), arm: r2(arm), signalNode: nodeId, signalApproach: approachId };
    if (heads.length > 1 || sp) {
      p0.heads = heads;
      if (sp) {   // the cable runs to a bare pole on the far kerb
        const span = r2(2 * lateral);
        p0.span = span; p0.spanPole = false;
        p0.pair = { x: r2(p0.x - right.x * span), z: r2(p0.z - right.z * span), rotation: p0.rotation };
      }
    }
    return p0;
  }
  signalNodes.forEach(id => {
    const es = byNode[id].filter(e => !(e.oneWay && e.from === id));
    const ref = byNode[id].find(arterial);
    const ro = nodes[other(ref, id)], ra = Math.atan2(ro.z - nodes[id].z, ro.x - nodes[id].x);
    es.forEach((e, k) => {
      const o = nodes[other(e, id)], a = Math.atan2(o.z - nodes[id].z, o.x - nodes[id].x);
      const grpA = Math.abs(Math.cos(a - ra)) > 0.7071;
      signals.push({ id: 'sig_' + id + '_' + k, nodeId: id, edgeId: e.id, greenMs: GREEN, yellowMs: YELLOW, redMs: RED, offsetMs: grpA ? 0 : HALF });
      const sp0 = signalPole(id, other(e, id));
      props.push(sp0);
      if (sp0.pair) props.push({ type: 'trafficlight', spanPole: true, x: sp0.pair.x, z: sp0.pair.z, rotation: sp0.pair.rotation, owner: sp0 });
    });
  });

  // ---------------------------------------------------------------- shop sites (reserved before buildings fill in)
  const blockedRects = [];        // [x0,z0,x1,z1] kept free of buildings (alleys)
  const driveways = [];           // {x,z,hw}: where a forecourt / car park meets the street - no kerb, no parked cars, no props across it
  const shops = [];
  const SHOP_SPECS = SPOTS.shops;
  // emergency services: a hospital, police stations and fire stations, each at the end of its own short side street like the shops
  const stations = [], gasStations = [];
  const STATION_SPECS = SPOTS.stations;
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
        else if (shops.some(s => dist([s.x, s.z], [x, z]) < 26) || stations.some(s => dist([s.x, s.z], [x, z]) < 30) || gasStations.some(s => dist([s.x, s.z], [x, z]) < 30)) ok = false;
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

  const STATION_INFO = {
    hospital: { name: 'City Hospital', color: 0xeaf0f4, h: 26, w: 22, d: 15, neon: 'HOSPITAL', neonCol: 0xff3b3b },
    police:   { name: 'Police Station', color: 0x2c4a86, h: 11, w: 18, d: 12, neon: 'POLICE', neonCol: 0x3b7bff },
    fire:     { name: 'Fire Station', color: 0xb2301f, h: 9, w: 19, d: 12, neon: 'FIRE', neonCol: 0xff7a1a }
  };
  STATION_SPECS.forEach((spec, i) => {
    const k = findAlley(spec);
    if (!k) { warnings.push('no alley found for ' + spec.kind + ' station'); return; }
    const info = STATION_INFO[spec.kind];
    const sx = k.mx + k.nx * 27, sz = k.mz + k.nz * 27;
    const rot = Math.round(Math.atan2(-k.nx, -k.nz) * 180 / Math.PI);
    // parked emergency vehicles on the apron between the street and the building: two rows, nose out
    const bays = [];
    const nb = spec.kind === 'hospital' ? 3 : 2;
    for (let b = 0; b < nb; b++) {
      const lat = (b - (nb - 1) / 2) * 6.2, dep = 12 + (spec.kind === 'fire' ? 0 : 0);
      bays.push({ x: r2(k.mx + k.nx * dep + k.ux * lat), z: r2(k.mz + k.nz * dep + k.uz * lat), rotation: rot, type: spec.kind === 'hospital' ? 'ambulance' : spec.kind === 'police' ? 'police' : 'fire' });
    }
    stations.push({ id: 'svc' + i, kind: spec.kind, name: info.name, x: r2(sx), z: r2(sz), door: { x: r2(sx - k.nx * (info.d / 2 + 1.5)), z: r2(sz - k.nz * (info.d / 2 + 1.5)), rotation: rot },
      mouth: { x: r2(k.mx + k.nx * 3), z: r2(k.mz + k.nz * 3) }, nx: k.nx, nz: k.nz, ux: k.ux, uz: k.uz, bays });
    blockedRects.push(Math.abs(k.nx) > Math.abs(k.nz)
      ? [Math.min(k.mx, k.mx + k.nx * 36), k.mz - 12, Math.max(k.mx, k.mx + k.nx * 36), k.mz + 12]
      : [k.mx - 12, Math.min(k.mz, k.mz + k.nz * 36), k.mx + 12, Math.max(k.mz, k.mz + k.nz * 36)]);
  });

  // ---------------------------------------------------------------- buildings
  const parcels = [];
  // petrol stations: a forecourt at the end of a short side street, canopy over two pump lanes, a small shop at the back
  const GAS_SPECS = SPOTS.gas;
  GAS_SPECS.forEach((at, i) => {
    const k = findAlley({ at, r: 100 });
    if (!k) { warnings.push('no alley found for gas station ' + i); return; }
    const P = (d, a) => [r2(k.mx + k.nx * d + k.ux * a), r2(k.mz + k.nz * d + k.uz * a)];
    gasStations.push({ id: 'gas' + i, name: 'Gas Station', x: P(14, 0)[0], z: P(14, 0)[1], nx: k.nx, nz: k.nz, ux: k.ux, uz: k.uz, mx: r2(k.mx), mz: r2(k.mz),
      fill: [P(14, -3.4), P(14, 3.4)].map(q => ({ x: q[0], z: q[1] })), priceMul: r2(0.88 + rand() * 0.27), rot: Math.atan2(k.nx, k.nz) });
    driveways.push({ x: r2(k.mx), z: r2(k.mz), hw: 14, kind: 'gas' });
    parcels.push({ type: 'plaza', color: 0x30333a, footprint: [P(-1, -12.5), P(-1, 12.5), P(36, 12.5), P(36, -12.5)] });
    blockedRects.push(Math.abs(k.nx) > Math.abs(k.nz)
      ? [Math.min(k.mx, k.mx + k.nx * 38), k.mz - 14, Math.max(k.mx, k.mx + k.nx * 38), k.mz + 14]
      : [k.mx - 14, Math.min(k.mz, k.mz + k.nz * 38), k.mx + 14, Math.max(k.mz, k.mz + k.nz * 38)]);
  });

  const rectFp = (x0, z0, x1, z1) => [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
  // water
  LAKES.forEach(l => parcels.push({ type: 'water', footprint: l.map(p => [r2(p[0]), r2(p[1])]) }));
  riverPolys.forEach(p => parcels.push({ type: 'water', footprint: p.map(q => [r2(q[0]), r2(q[1])]) }));
  // piers, causeways and the island platforms: plazas laid over the water, so cars and people can use them
  const harbour = { slips: [], decks: [] };
  DECKS.forEach(d => { const f = d.pts.map(p => [r2(p[0]), r2(p[1])]); parcels.push({ type: 'plaza', deck: true, color: d.color, footprint: f }); harbour.decks.push(f); });
  ((MAP.harbour && MAP.harbour.slips) || []).forEach((p, n) => { const q = T(p[0], p[1]); harbour.slips.push({ x: r2(q[0]), z: r2(q[1]), n }); });
  PARKS.forEach(p => parcels.push({ type: 'park', name: p.name, footprint: p.pts.map(q => [r2(q[0]), r2(q[1])]) }));
  // stadium
  const sc = T(STADIUM.cx, STADIUM.cy), sx = STADIUM.rx * S * 0.75, sz = STADIUM.ry * S * 0.75;
  parcels.push({ type: 'park', name: 'Pitch', footprint: rectFp(sc[0] - sx + 7, sc[1] - sz + 7, sc[0] + sx - 7, sc[1] + sz - 7) });
  [[-sx, -sz, sx, -sz + 7], [-sx, sz - 7, sx, sz], [-sx, -sz, -sx + 7, sz], [sx - 7, -sz, sx, sz]].forEach(([a, b, c, d]) =>
    parcels.push({ type: 'building', height: 17, color: 0xd8d2c4, roof: 'flat', footprint: rectFp(sc[0] + a, sc[1] + b, sc[0] + c, sc[1] + d) }));
  // landmarks
  const lmRects = [];
  LANDMARKS.forEach(([name, X0_, Y0_, X1_, Y1_, h, onDeck]) => {
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
    if (x1 - x0 < 16 || z1 - z0 < 16 || (!onDeck && inWater((x0 + x1) / 2, (z0 + z1) / 2, 0))) return;
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
    if (ok) { const [X, Y] = fromWorld(cx, cz); if (Y > MAP.image.h * MAP.scale + 20 || Y < 0) ok = false; }
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

  stations.forEach(st => {
    const info = STATION_INFO[st.kind], along = Math.abs(st.nx) > Math.abs(st.nz) ? 'x' : 'z';
    const hw = info.w / 2, hd = info.d / 2;
    const x0 = along === 'x' ? st.x - hd : st.x - hw, x1 = along === 'x' ? st.x + hd : st.x + hw, z0 = along === 'x' ? st.z - hw : st.z - hd, z1 = along === 'x' ? st.z + hw : st.z + hd;
    parcels.push({ type: 'building', station: st.id, height: info.h, color: info.color, roof: 'flat', footprint: rectFp(r2(x0), r2(z0), r2(x1), r2(z1)) });
    // a big lit sign over the entrance, facing the street (projecting neon, same instanced sign pool)
    const px = st.door.x, pz = st.door.z;
    props.push({ type: 'neonsign', x: r2(px - st.nx * 1.0), z: r2(pz - st.nz * 1.0), y: 4.2, rotation: Math.round(Math.atan2(st.nz, -st.nx) * 180 / Math.PI), w: 3.6, h: 1.6, blade: false, word: info.neon, color: info.neonCol });
    // (no coloured beacon lamp here: only shops get one)
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
        if (W < t.W * 0.72 || D < t.D * 0.72 || along < Math.max(26, t.W * 0.8 + 3) || depth < 24) continue;     // the ramp (10 u wide, 20 u long) runs under the building, so it needs room
        const maxFloor = Math.floor((c.p.height - 3.2) / FLOOR_H);
        if (maxFloor < Math.max(1, t.floor - 4)) continue;
        if (!farFromDoors(sx, sz, 80)) continue;
        chosen = { c, s: f.s, W, D, depth, floor: Math.min(t.floor, maxFloor) }; break;
      }
      if (!chosen) continue;
      const { c, s, W, D, depth, floor } = chosen; c.used = true; pool = pool.filter(x => x !== c);
      const [sx, sz, nx, nz, along] = s;
      const ux = -nz, uz = nx;                                  // along the wall
      const g = Math.max(6.5, along / 2 - 7.2) * (rand() < 0.5 ? 1 : -1);    // the garage door sits toward one end of the front, with the whole ramp inside the building's width
      const F = { x: sx - nx * 3.5, z: sz - nz * 3.5 };
      doorsTaken.push([sx, sz]);
      apartments.push({ id: 'apt' + apartments.length, type: t.key, tier: tierIdx, label: t.label, name: (aptNames[district] || 'Central') + ' ' + t.label, price: t.price, garage: t.garage, district,
        floor, rooms: 1 + t.beds, beds: t.beds, baths: t.baths, w: r2(W), d: r2(D), surface: Math.round(W * D * 1.5625), region: regionOf(sx, sz), height: c.p.height,
        door: { x: r2(sx), z: r2(sz), rotation: Math.round(Math.atan2(-nx, -nz) * 180 / Math.PI) },
        facade: { x: r2(F.x), z: r2(F.z), nx, nz },
        depth: r2(depth), gate: { x: r2(F.x + ux * g), z: r2(F.z + uz * g), nx, nz, ux, uz } });
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
  const inDrive = (x, z, pad = 0) => driveways.some(d => Math.hypot(d.x - x, d.z - z) < d.hw + pad);
  const propOK = (x, z, minGap, list) => !list.some(p => Math.abs(p.x - x) < minGap && Math.abs(p.z - z) < minGap && dist([p.x, p.z], [x, z]) < minGap);
  const lampList = [];
  edges.forEach(e => {
    if (e.cls === 'hw' || e.cls === 'hwEnd' || e.cls === 'ramp' || e.structure === 'bridge') return;
    const spacing = e.cls === 'six' ? 26 : e.cls === 'four' ? 28 : e.cls === 'two' ? 30 : 0;   // a regular pattern: a lamp every ~32-38 m, alternating sides, so the whole street is lit
    if (!spacing) return;
    const a = nodes[e.from], b = nodes[e.to], len = Math.hypot(b.x - a.x, b.z - a.z);
    const endC = id => (byNode[id] || []).length === 2 ? 44 : 24;       // a bend gets rounded off into the road, so keep clear of it
    const c1 = Math.max(endC(e.from), intersectionClearance(e.from, e, byNode) + 7), c2 = Math.max(endC(e.to), intersectionClearance(e.to, e, byNode) + 7);
    const n = Math.max(1, Math.round((len - c1 - c2) / spacing)), step = (len - c1 - c2) / n;       // spread evenly from end to end
    let side = rand() < 0.5 ? 1 : -1;
    if (nodes[e.from].elevation > 0.5 || nodes[e.to].elevation > 0.5) return;
    for (let k = 0; k <= n; k++) {
      const t = c1 + k * step; let placed = false;
      for (const sd of [side, -side]) { for (const off of [2.2, 2.9, 3.6]) {
        const p = sidePoint(e, t, sd, e.width / 2 + off);
        if (roadClear(p.x, p.z) < 3.0 || inWater(p.x, p.z, 1) || parcelsHit(p.x, p.z, 1.0) || outsideHW(p.x, p.z, 0) || inDrive(p.x, p.z, 1)) continue;
        if (!propOK(p.x, p.z, 9, lampList)) continue;
        if (Object.keys(nodes).some(ni => { const nd = nodes[ni]; return (byNode[ni] || []).length >= 3 && Math.abs(nd.x - p.x) < 17 && Math.abs(nd.z - p.z) < 17 && Math.hypot(nd.x - p.x, nd.z - p.z) < 17; })) continue;      // the corner fillets of a junction reach further than its edges
        lampList.push({ type: 'light', x: r2(p.x), z: r2(p.z), rotation: Math.round(Math.atan2((a.x + (b.x - a.x) * (t / len)) - p.x, (a.z + (b.z - a.z) * (t / len)) - p.z) * 180 / Math.PI) });
        placed = true; break;
      } if (placed) break; }
      side = -side;
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
    if (q.spanPole) { delete q.owner.span; delete q.owner.pair; props.splice(i, 1); continue; }   // no room on the far kerb: back to a plain mast arm
    if (q.span) { const k = props.findIndex(o => o.owner === q); if (k >= 0) { props.splice(k, 1); if (k < i) i--; } delete q.span; delete q.pair; }   // cable style needs both poles exactly: fall back to a mast arm
    let found = null;
    for (let r = 1; r <= 12 && !found; r += 1) for (let k = 0; k < 16 && !found; k++) {
      const ang = k * Math.PI / 8, x = q.x + Math.cos(ang) * r, z = q.z + Math.sin(ang) * r;
      if (poleOK(x, z)) found = [x, z];
    }
    if (found) { q.x = r2(found[0]); q.z = r2(found[1]); } else props.splice(i, 1);
  }
  props.forEach(q => { delete q.owner; if (q.spanPole === false) delete q.spanPole; });

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
      if (roadClear(p.x, p.z) < 1.2 || inWater(p.x, p.z, 2) || parcelsHit(p.x, p.z, 1) || outsideHW(p.x, p.z, 0) || inDrive(p.x, p.z, 1)) continue;
      if (!propOK(p.x, p.z, 6, treeList) || !propOK(p.x, p.z, 4, lampList)) continue;
      treeList.push({ type: 'tree', x: r2(p.x), z: r2(p.z), rotation: 0 });
    }
  });
  // freeway verges: a scatter of trees beyond the rails
  edges.forEach(e => {
    if (e.type !== 'highway' || e.structure || Math.max(nodes[e.from].elevation, nodes[e.to].elevation) > 0.25) return;
    const a = nodes[e.from], b = nodes[e.to], len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let t = 30; t < len - 30; t += 22) for (const side of [1, -1]) {
      if (rand() < 0.35) continue;
      const p = sidePoint(e, t + (rand() - 0.5) * 12, side, e.width / 2 + 5 + rand() * 9);
      if (roadClear(p.x, p.z) < 3.5 || inWater(p.x, p.z, 2) || parcelsHit(p.x, p.z, 1.5)) continue;
      if (!propOK(p.x, p.z, 7, treeList)) continue;
      treeList.push({ type: rand() < 0.3 ? 'bush' : (rand() < 0.5 ? 'oak' : 'tree'), x: r2(p.x), z: r2(p.z), rotation: Math.floor(rand() * 360) });
    }
  });
  // street furniture: fire hydrants and mailboxes along the kerb of the streets, café sets (a table and chairs) outside the busy districts' buildings
  const CAFE_DISTRICTS = ['Gold Coast', 'Old Town', 'Chinatown', 'Loop Edge', 'Downtown', 'River North'];
  edges.forEach(e => {
    if ((e.cls !== 'two' && e.cls !== 'four') || e.structure === 'bridge' || nodes[e.from].elevation > 0.5 || nodes[e.to].elevation > 0.5) return;
    const a = nodes[e.from], b = nodes[e.to], len = Math.hypot(b.x - a.x, b.z - a.z);
    const mid = fromWorld((a.x + b.x) / 2, (a.z + b.z) / 2), dis = districtAt(mid[0], mid[1]);
    const c1 = intersectionClearance(e.from, e, byNode) + 7, c2 = intersectionClearance(e.to, e, byNode) + 7;
    const okAt = (p, r, near) => roadClear(p.x, p.z) >= near && roadClear(p.x, p.z, false, true) <= 6 && !inWater(p.x, p.z, 2) && !parcelsHit(p.x, p.z, r) && !outsideHW(p.x, p.z, 0) && !inDrive(p.x, p.z, 2.5)
      && propOK(p.x, p.z, 5, treeList) && propOK(p.x, p.z, 3.5, lampList) && !driveways.some(d => Math.hypot(d.x - p.x, d.z - p.z) < d.hw + 4);
    for (let t = c1 + rand() * 20; t < len - c2; t += 48 + rand() * 30) {
      const side = rand() < 0.5 ? 1 : -1, p = sidePoint(e, t, side, e.width / 2 + 2.1);
      if (!okAt(p, 0.5, 0.8)) continue;
      treeList.push({ type: rand() < 0.6 ? 'hydrant' : 'mailbox', x: r2(p.x), z: r2(p.z), rotation: Math.round(Math.atan2(p.ux, p.uz) * 180 / Math.PI) });
    }
    if (dis && CAFE_DISTRICTS.includes(dis.name)) for (let t = c1 + 6 + rand() * 25; t < len - c2; t += 60 + rand() * 40) {
      if (rand() < 0.45) continue;
      const side = rand() < 0.5 ? 1 : -1, p = sidePoint(e, t, side, e.width / 2 + 4.3);
      if (!okAt(p, 1.5, 2.6)) continue;
      treeList.push({ type: 'cafeset', x: r2(p.x), z: r2(p.z), rotation: Math.floor(rand() * 360) });
    }
    if (dis && CAFE_DISTRICTS.includes(dis.name)) for (let t = c1 + 20 + rand() * 40; t < len - c2; t += 150 + rand() * 90) {
      if (rand() < 0.5) continue;
      const side = rand() < 0.5 ? 1 : -1, p = sidePoint(e, t, side, e.width / 2 + 5.4);
      if (!okAt(p, 2.2, 3.4)) continue;
      treeList.push({ type: 'foodstand', variant: Math.floor(rand() * 4), x: r2(p.x), z: r2(p.z), rotation: Math.round(Math.atan2(-p.ux, -p.uz) * 180 / Math.PI) + (side > 0 ? 90 : -90) });
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

  // park seating: benches facing the paths, picnic tables, and a food stand in the bigger parks
  PARKS.forEach(pk => {
    const xs = pk.pts.map(p => p[0]), zs = pk.pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), step = 26;
    const ok = (px, pz, rad) => pointInPoly(px, pz, pk.pts) && roadClear(px, pz) >= 5 && !inWater(px, pz, 2) && !parcelsHit(px, pz, rad) && propOK(px, pz, 4.2, treeList) && propOK(px, pz, 3.2, props.filter(q => q.type === 'pathlight' || q.type === 'bench' || q.type === 'picnic' || q.type === 'foodstand'));
    for (let x = x0 + 8; x < x1; x += step) for (let z = z0 + 8; z < z1; z += step) {
      const px = x + 3 + (rand() - 0.5) * 3, pz = z + 3 + (rand() - 0.5) * 3, r = rand();
      if (r < 0.5 && ok(px, pz, 1.2)) props.push({ type: 'bench', x: r2(px), z: r2(pz), rotation: Math.floor(rand() * 4) * 90 });
      else if (r < 0.7 && ok(px, pz, 2)) props.push({ type: 'picnic', x: r2(px), z: r2(pz), rotation: Math.floor(rand() * 4) * 90 });
    }
    if (x1 - x0 > 70 && z1 - z0 > 70) for (let tries = 0; tries < 40; tries++) {
      const px = x0 + rand() * (x1 - x0), pz = z0 + rand() * (z1 - z0);
      if (!ok(px, pz, 2.2) || roadClear(px, pz) > 18) continue;
      props.push({ type: 'foodstand', variant: Math.floor(rand() * 4), x: r2(px), z: r2(pz), rotation: Math.floor(rand() * 4) * 90 }); break;
    }
  });

  // parked cars: along the kerb of the smaller streets (and some avenues), leaving the junctions clear
  const parked = [];
  const PARK_COLORS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0xecf0f1, 0x2c3e50, 0x7f8c8d, 0xd35400, 0x8e44ad, 0x1abc9c, 0xbdc3c7, 0x34495e];
  edges.forEach(e => {
    if (e.cls !== 'two' && e.cls !== 'four') return;
    if (e.structure === 'bridge' || nodes[e.from].elevation > 0.5 || nodes[e.to].elevation > 0.5) return;
    const a = nodes[e.from], b = nodes[e.to], len = Math.hypot(b.x - a.x, b.z - a.z);
    const c1 = intersectionClearance(e.from, e, byNode) + ((byNode[e.from] || []).length >= 3 ? 30 : 16), c2 = intersectionClearance(e.to, e, byNode) + ((byNode[e.to] || []).length >= 3 ? 30 : 16);   // corners swing wide: no parked car within 16 u of a junction or a bend
    const dens = e.cls === 'two' ? 0.5 : 0.28;
    [1, -1].forEach(side => {
      for (let t = c1; t < len - c2; t += 7.4) {
        if (rand() > dens) continue;
        const off = e.width / 2 + (e.cls === 'two' ? 0.35 : 0.7);      // parked cars stand half on the road, half on the kerb (a local street's lanes leave room for it; on an avenue the cars sit a little further out)
        const p = sidePoint(e, t, side, off);
        if (driveways.some(d => Math.hypot(d.x - p.x, d.z - p.z) < d.hw + 6)) continue;
        if (roadClear(p.x, p.z) < -0.7 || inWater(p.x, p.z, 2) || parcelsHit(p.x, p.z, 0.3) || outsideHW(p.x, p.z, 0)) continue;
        if (!propOK(p.x, p.z, 3.6, parked) || !propOK(p.x, p.z, 2.6, lampList) || !propOK(p.x, p.z, 2.4, treeList) || !propOK(p.x, p.z, 3, props.filter(q => q.type === 'trafficlight'))) continue;
        const h = Math.atan2(p.ux, p.uz) + (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.06;
        parked.push({ type: 'parkedcar', x: r2(p.x), z: r2(p.z), rotation: Math.round(h * 180 / Math.PI), color: pick(PARK_COLORS) });
      }
    });
  });
  // shop car parks: perpendicular bays down both sides of each shop's alley, a cow-path's worth of room in front of the door; a bay is only
  // kept where nothing stands in it, and about half of them hold a parked car. The painted lines are drawn by shopBays.js from shop.bays.
  shops.forEach(sh => {
    sh.bays = [];
    [1, -1].forEach(side => [6, 9.2, 12.4, 15.6].forEach(d => {
      const cx = sh.mouth.x - sh.nx * 3 + sh.nx * d + sh.ux * side * 7.9, cz = sh.mouth.z - sh.nz * 3 + sh.nz * d + sh.uz * side * 7.9;
      const fx = sh.ux * side, fz = sh.uz * side;                      // the car noses in: pointing away from the aisle
      const pts = [[0, 0], [fx * 1.7, fz * 1.7], [-fx * 1.7, -fz * 1.7], [sh.nx * 1.1, sh.nz * 1.1], [-sh.nx * 1.1, -sh.nz * 1.1]].map(([ox, oz]) => [cx + ox, cz + oz]);
      if (pts.some(([x, z]) => inWater(x, z, 1) || parcelsHit(x, z, 0.4) || outsideHW(x, z, 0) || roadClear(x, z) < 1.5)) return;
      if (!propOK(cx, cz, 3.4, lampList) || !propOK(cx, cz, 3.0, treeList) || !propOK(cx, cz, 3.2, props.filter(q => q.type === 'shopsign' || q.type === 'trafficlight'))) return;
      const bay = { x: r2(cx), z: r2(cz), fx, fz, nx: sh.nx, nz: sh.nz, ux: sh.ux, uz: sh.uz, side };
      sh.bays.push(bay);
      if (rand() < 0.55 && propOK(cx, cz, 3.6, parked)) parked.push({ type: 'parkedcar', x: bay.x, z: bay.z, rotation: Math.round(Math.atan2(fx, fz) * 180 / Math.PI), color: pick(PARK_COLORS) });
    }));
  });
  props.push(...parked);

  // neon signs: glowing words and blade signs on the street-facing walls of the taller buildings (drawn as a few instanced quads, props.js)
  const NEON_WORDS = ['BAR', 'CLUB', 'OPEN', 'RAMEN', 'PIZZA', 'ARCADE', 'HOTEL', 'TUNE', 'LIVE', '24H', 'DINER', 'SUSHI', 'GYM', 'FIT'];   // (stations add HOSPITAL / POLICE / FIRE)
  const NEON_COLS = [0xff2fa8, 0x20e8ff, 0xff7a1a, 0x38ff6a, 0xa14bff, 0xff3b3b, 0xffe14a];
  let nNeon = 0;
  parcels.forEach(q => {
    const NEON_P = { 'Neon Strip': 0.95, Chinatown: 0.6, 'River North': 0.4, Downtown: 0.3, 'Loop Edge': 0.3, 'Gold Coast': 0.25, 'Old Town': 0.3, Industrial: 0.05 };
    if (q.type !== 'building' || q.height < (q.district === 'Neon Strip' ? 8 : 12) || q.landmark || rand() > (NEON_P[q.district] ?? 0.2) || nNeon > 1700) return;
    const f = q.footprint, x0 = Math.min(f[0][0], f[2][0]), x1 = Math.max(f[0][0], f[2][0]), z0 = Math.min(f[0][1], f[2][1]), z1 = Math.max(f[0][1], f[2][1]);
    const sides = [[0, -1, z0, x0, x1, true], [0, 1, z1, x0, x1, true], [-1, 0, x0, z0, z1, false], [1, 0, x1, z0, z1, false]];
    let best = null, bd = 1e9;
    sides.forEach(sd => { const [nx, nz, c, a0, a1, alongX] = sd, m = (a0 + a1) / 2, px = alongX ? m : c, pz = alongX ? c : m; const d = roadClear(px + nx * 5, pz + nz * 5); if (d < bd) { bd = d; best = sd; } });
    if (!best || bd > 9) return;
    const [nx, nz, c, a0, a1, alongX] = best, span = a1 - a0; if (span < 9) return;
    const count = q.district === 'Neon Strip' ? 2 + (span > 22 ? 1 : 0) : 1 + (span > 26 && rand() < 0.6 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      // projecting signs: the board sticks out from the wall (perpendicular to it) with its bottom edge 3-5 m above the street
      const blade = rand() < 0.4, w = blade ? 1.5 : 2.6 + rand() * 1.6, h = blade ? 3.6 : 1.4 + rand() * 0.8;
      const t = a0 + 3 + (span - 6) * (count === 1 ? rand() : (k + 0.5) / count), y = 3 + rand() * 2;
      if (y + h > q.height - 0.5) continue;
      const px = alongX ? t : c + nx * (0.25 + w / 2), pz = alongX ? c + nz * (0.25 + w / 2) : t;
      if (roadClear(px + nx * (w / 2 + 1.2), pz + nz * (w / 2 + 1.2)) < 0.5) continue;
      props.push({ type: 'neonsign', x: r2(px), z: r2(pz), y: r2(y), rotation: Math.round(Math.atan2(-nz, nx) * 180 / Math.PI), w: r2(w), h: r2(h), blade, word: pick(NEON_WORDS), color: pick(NEON_COLS), bracket: 1 }); nNeon++;
    }
  });
  // storefront awnings: a striped canopy over the pavement on the street side of the lower buildings (decoration high above the traffic, drawn merged in props.js)
  { let nAw = 0; const AW_COLS = [0xc0392b, 0x2e6fa6, 0x2f8f5b, 0xd98b1e, 0x7a3b86, 0x222a35];
    parcels.forEach(q => {
      if (q.type !== 'building' || q.landmark || q.district === 'Industrial' || q.height < 6 || rand() > 0.4 || nAw > 1500) return;
      const f = q.footprint, x0 = Math.min(f[0][0], f[2][0]), x1 = Math.max(f[0][0], f[2][0]), z0 = Math.min(f[0][1], f[2][1]), z1 = Math.max(f[0][1], f[2][1]);
      const sides = [[0, -1, z0, x0, x1, true], [0, 1, z1, x0, x1, true], [-1, 0, x0, z0, z1, false], [1, 0, x1, z0, z1, false]];
      let best = null, bd = 1e9;
      sides.forEach(sd => { const [nx, nz, c, a0, a1, alongX] = sd, m = (a0 + a1) / 2, px = alongX ? m : c, pz = alongX ? c : m; const d = roadClear(px + nx * 5, pz + nz * 5); if (d < bd) { bd = d; best = sd; } });
      if (!best || bd > 9) return;
      const [nx, nz, c, a0, a1, alongX] = best, span = a1 - a0; if (span < 9) return;
      const w = Math.min(span - 3, 3.5 + rand() * 4.5), t = a0 + 1.5 + w / 2 + (span - 3 - w) * rand();
      const px = alongX ? t : c + nx * 0.9, pz = alongX ? c + nz * 0.9 : t;
      if (roadClear(px + nx * 1.2, pz + nz * 1.2) < 0.6 || driveways.some(d => Math.hypot(d.x - px, d.z - pz) < d.hw + 3)) return;
      props.push({ type: 'awning', x: r2(px), z: r2(pz), y: 3, rotation: Math.round(Math.atan2(nx, nz) * 180 / Math.PI), w: r2(w), color: pick(AW_COLS) }); nAw++;
    }); }
  // keep every garage entrance clear: nothing stands on the driveway
  apartments.forEach(a => { const g = a.gate; for (let i = props.length - 1; i >= 0; i--) { const q = props[i]; if (q.type === 'trafficlight') continue; const dx = q.x - g.x, dz = q.z - g.z, along = dx * g.nx + dz * g.nz, lat = dx * g.ux + dz * g.uz; if (along > -1.5 && along < 12 && Math.abs(lat) < 3.8) props.splice(i, 1); } });

  // plaza furniture on the pier and a fountain in each of the bigger parks
  [['Wrigley Green', 'fountain'], ['Hancock Green', 'fountain'], ['Riverwalk Park', 'fountain'], ['Grant Park Strip', 'fountain']].forEach(([name, type]) => {
    const pk = PARKS.find(p => p.name === name); if (!pk) return;
    const xs = pk.pts.map(p => p[0]), zs = pk.pts.map(p => p[1]);
    // the spot in the park that is furthest from every road (the park's centre can be crossed by a street)
    let best = null;
    for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) {
      const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * i / 16, z = Math.min(...zs) + (Math.max(...zs) - Math.min(...zs)) * j / 16;
      if (!pointInPoly(x, z, pk.pts)) continue;
      const c = roadClear(x, z); if (!best || c > best.c) best = { x, z, c };
    }
    if (best && best.c > 5) props.push({ type, x: r2(best.x), z: r2(best.z), rotation: 0 });
  });

  // ---------------------------------------------------------------- gameplay: spawn on Michigan-ish street downtown + checkpoints
  const spawnPt = T(X0, Y0);
  let spawnNode = null, sd = 1e9;
  // start at a junction with several apartment garages close by (so the first thing you can do is visit one), still downtown
  const gateXZ = apartments.map(a => [a.gate.x, a.gate.z]);
  Object.keys(nodes).forEach(id => {
    const n = nodes[id]; if (!byNode[id] || byNode[id].length < 3 || n.elevation > 0.5) return;
    const dd = gateXZ.map(g => dist([n.x, n.z], g)).sort((x, y) => x - y).slice(0, 3);
    if (dd.length < 3) return;
    const score = dd.reduce((x, y) => x + y, 0) + dist([n.x, n.z], spawnPt) * 0.05;
    if (score < sd) { sd = score; spawnNode = id; }
  });
  if (!spawnNode) Object.keys(nodes).forEach(id => { const d = dist([nodes[id].x, nodes[id].z], spawnPt); if (d < sd && byNode[id] && byNode[id].length >= 3) { sd = d; spawnNode = id; } });
  const sp = nodes[spawnNode];
  const sedge = byNode[spawnNode][0], so = nodes[other(sedge, spawnNode)];
  const gameplay = [{ type: 'spawn', x: sp.x, z: sp.z, heading: Math.atan2(so.x - sp.x, so.z - sp.z) }];

  edges.forEach(e => { delete e.cls; });
  // final clean-up after the retrace: drop lamps that ended up far from any road and greenery/signs stuck in buildings
  for (let i = props.length - 1; i >= 0; i--) {
    const q = props[i];
    if (q.type === 'light' && !q.twin && roadClear(q.x, q.z, true, true) > 4.2 && !parkAt(q.x, q.z)) props.splice(i, 1);
    else if (['oak', 'bush', 'birch', 'pine', 'tree', 'shopsign'].includes(q.type) && (parcelsHit(q.x, q.z, 0.3) || inWater(q.x, q.z, 0.5))) props.splice(i, 1);
  }
  const districts = DISTRICTS.map(d => { const poly = d.poly.map(([X, Y]) => T(X, Y).map(r2)); return { name: d.name, color: d.color || '#9aa7b8', blurb: d.blurb || '', poly, cx: r2(poly.reduce((a, p) => a + p[0], 0) / poly.length), cz: r2(poly.reduce((a, p) => a + p[1], 0) / poly.length) }; }).filter(d => d.color !== '#9aa7b8' || true);
  const city = { districts, roadNodes: nodes, roadEdges: edges, parcels, props, signals, gameplay, shops, stations, gasStations, driveways, harbour, apartments, agents, stores, warnings, hwSigns, hwLine: R.H.map(p => [r2(p[0]), r2(p[1])]),
    bounds: (() => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; Object.values(nodes).forEach(n => { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }); return [x0 - 90, z0 - 90, x1 + 90, z1 + 90]; })() };
  return city;
}
