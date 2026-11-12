// Gridlock Blocks checks. Run on request:
//   node tools/check.mjs signs      road signs sit beside the road, not on it
//   node tools/check.mjs signfacing gantries, street signs and roadside boards are square to their road; gantries have lamps
//   node tools/check.mjs lamps      lamp posts / props sit beside the road, near it, not in buildings
//   node tools/check.mjs buildings  no building footprint overlaps a road surface
//   node tools/check.mjs traffic [cars=40] [minutes=5]   AI traffic simulation: nothing gets stuck
//   node tools/check.mjs markings   painted lines, crosswalks and stop lines never cross or overlap another road's paint
//   node tools/check.mjs bridges    no bridge pillar stands in a lane; low ramps have walls; freeway lanes are clear
//   node tools/check.mjs solid      every object a car can see is solid (and a rammed collider really stops the car)
//   node tools/check.mjs sidewalks every pavement leads somewhere (no stubs / islands, none beside slip roads)
//   node tools/check.mjs water      no road surface lies under water without a bridge
//   node tools/check.mjs transit    bus loops are legal, metro stations stand on free ground, custom lines build
//   node tools/check.mjs drift      the three drift circuits: corner radius, walls, start
//   node tools/check.mjs rivals     race rivals run their routes without errors
//   node tools/check.mjs pavementgaps  no gaps in the pavement at bends, joins and junction corners
//   node tools/check.mjs riverbanks  banks follow the water: no spikes at river corners, nothing above street level
//   node tools/check.mjs bridgewalls every raised deck has parapets on both sides
//   node tools/check.mjs obstacles   knocked AI cars collide with every wall, building, parapet and prop
//   node tools/check.mjs lotgeo      shop car parks meet a street: lane, stop line and STOP sign on clear ground
//   node tools/check.mjs outroad    the road out of town joins the city, keeps clear of the pocket worlds, tunnel mouths are open
//   node tools/check.mjs stops [cars=90] [minutes=6]   stop signs: stop, take turns, keep the box clear (numbers; set STOPS_BASELINE=1 to only print)
//   node tools/check.mjs quick      every static check (seconds)       placement / roads: sub-groups of quick
//   node tools/check.mjs sim        the simulations (traffic, solid, rivals, races)
//   node tools/check.mjs all        quick + sim
// Exit code 1 if anything fails. Add new checks to CHECKS below.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = p => import(pathToFileURL(path.join(root, p)).href);

// minimal canvas stub so texture-building code runs under node
const ctx2d = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient') ? () => ({ addColorStop() {} }) : (typeof k === 'string' && k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => ctx2d, width: 0, height: 0, style: {} }) };
let T = 0; performance.now = () => T;

if (process.env.RB !== undefined) globalThis.__RB_ONLY = process.env.RB.split(',').filter(Boolean).map(Number);   // experiment: which river bridges to build
const { buildChicago } = await imp('src/chicago/chicago.js');
const city = buildChicago();
const THREE = await imp('node_modules/three/build/three.module.js');
const { createGroundSampler } = await imp('src/terrain.js');
const { makeRoadClearance } = await imp('src/roadClearance.js');
const { pointInPolygon } = await imp('src/collision.js');
const heightAt = createGroundSampler(city);

let roads = null, distToRoad = null;
async function world() {
  if (roads) return;
  const { buildRoads } = await imp('src/generators/roads.js');
  roads = buildRoads(city);
  distToRoad = makeRoadClearance(roads.userData.mapPaths);
}
const buildings = () => (city.parcels || []).filter(p => p.type === 'building' || p.type === 'water');
const inBuilding = (x, z) => buildings().some(p => pointInPolygon(x, z, p.footprint));
const r1 = v => Math.round(v * 10) / 10;

async function checkSigns() {
  await world();
  const { buildSigns } = await imp('src/generators/signs.js');
  const signs = buildSigns(city, heightAt, roads.userData.mapPaths);
  const bad = [];
  signs.instances.forEach(i => {
    const d = distToRoad(i.x, i.z);
    const what = i.type + '@' + r1(i.x) + ',' + r1(i.z);
    if (d < 0.4) bad.push(what + ' is on the road (' + r1(d) + ' from the surface edge)');
    else if (d > 9 && i.type !== 'gantry') bad.push(what + ' is ' + r1(d) + ' away from any road');
    if (inBuilding(i.x, i.z)) bad.push(what + ' is inside a building');
  });
  return { name: 'signs', count: signs.instances.length, bad };
}

// every highway gantry stands square to the road: its board faces straight along the nearest carriageway (within 4 degrees), and its three lamps exist
async function checkSignFacing() {
  await world();
  const { buildSigns } = await imp('src/generators/signs.js');
  const signs = buildSigns(city, heightAt, roads.userData.mapPaths), bad = [], seen = new Set();
  const edges = (city.roadEdges || []).map(e => { const a = city.roadNodes[e.from], b = city.roadNodes[e.to], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return { e, a, dx, dz, l, ux: dx / l, uz: dz / l }; });
  const hw = edges.filter(q => q.e.type === 'highway' && !q.e.ramp);
  const nearest = (list, x, z, within = 1e9) => { let best = null; list.forEach(q => { const t = Math.max(0, Math.min(1, ((x - q.a.x) * q.dx + (z - q.a.z) * q.dz) / (q.l * q.l))), d = Math.hypot(q.a.x + q.dx * t - x, q.a.z + q.dz * t - z); if (d < within && (!best || d < best.d)) best = { d, q }; }); return best; };
  const ang = (fx, fz, ux, uz) => Math.acos(Math.min(1, Math.abs(fx * ux + fz * uz))) * 180 / Math.PI;     // 0 = parallel (either way)
  let nG = 0, nP = 0, nB = 0;
  // 1. overhead highway gantries: the board faces straight along the nearest carriageway, and has lamps over it
  signs.instances.filter(i => i.type === 'gantry').forEach(i => {
    const m = i.mesh; if (seen.has(m)) return; seen.add(m); nG++;
    const fx = Math.sin(m.rotation.y), fz = Math.cos(m.rotation.y), at = 'gantry@' + r1(m.position.x) + ',' + r1(m.position.z), b = nearest(hw, m.position.x, m.position.z);
    if (!b) { bad.push(at + ' has no highway near it'); return; }
    const a = ang(fx, fz, b.q.ux, b.q.uz); if (a > 4) bad.push(at + ' is turned ' + r1(a) + ' degrees off the road direction (edge ' + b.q.e.id + ')');
    if (!m.children.some(c => c.material && c.material.emissive && c.material.emissive.getHex() === 0xffe2a0)) bad.push(at + ' has no lamps over its board');
  });
  // 2. street signs (stop, speed limit): square to the road they speak to - along a nearby street, or along a shop alley (square to the street)
  signs.instances.filter(i => i.type === 'signpost').forEach(i => {
    const m = i.mesh; nP++;
    const fx = Math.sin(m.rotation.y), fz = Math.cos(m.rotation.y), at = 'signpost@' + r1(i.x) + ',' + r1(i.z);
    let best = 1e9; edges.forEach(q => { const t = Math.max(0, Math.min(1, ((i.x - q.a.x) * q.dx + (i.z - q.a.z) * q.dz) / (q.l * q.l))); if (Math.hypot(q.a.x + q.dx * t - i.x, q.a.z + q.dz * t - i.z) > 24) return; best = Math.min(best, ang(fx, fz, q.ux, q.uz), 90 - ang(fx, fz, q.ux, q.uz)); });
    if (best === 1e9) bad.push(at + ' has no road within 24 u');
    else if (best > 4) bad.push(at + ' is ' + r1(best) + ' degrees off every nearby road direction');
  });
  // 3. roadside advertising boards (the lit LED-style panels): turned square to the freeway, so drivers see them head on
  (city.billboards || []).forEach(b => {
    nB++; const fx = Math.sin(b.face), fz = Math.cos(b.face), at = 'billboard@' + r1(b.x) + ',' + r1(b.z), n = nearest(hw, b.x, b.z);
    if (!n) { bad.push(at + ' has no highway near it'); return; }
    const a = ang(fx, fz, n.q.ux, n.q.uz); if (a > 4) bad.push(at + ' is turned ' + r1(a) + ' degrees off the road direction');
  });
  if (!nG && hw.length) bad.push('no gantries found');
  return { name: 'signfacing', count: nG + ' gantries, ' + nP + ' street signs, ' + nB + ' billboards', bad };
}

async function checkLamps() {
  await world();
  const { buildProps } = await imp('src/generators/props.js');
  const { instances } = buildProps(city);
  const ptIn = (await imp('src/collision.js')).pointInPolygon;
  const bad = []; let n = 0;
  instances.forEach(i => {
    const d = distToRoad(i.x, i.z);
    const what = i.type + '@' + r1(i.x) + ',' + r1(i.z);
    const median = (city.props || []).some(p => p.twin && Math.abs(p.x - i.x) < 0.01 && Math.abs(p.z - i.z) < 0.01);
    if (median) return;
    if (['light', 'trafficlight'].includes(i.type)) {
      n++;
      if (d < 0.4) bad.push(what + ' is on the road (' + r1(d) + ')');
      else if (d > 6 && !(city.parcels || []).some(q => (q.type === 'plaza' || q.type === 'park') && q.footprint && ptIn(i.x, i.z, q.footprint))) bad.push(what + ' is ' + r1(d) + ' from the road (should be next to it)');
    } else if (d < 0.2 && i.type !== 'parkedcar') bad.push(what + ' is on the road');   // parked cars sit in the kerb lane on purpose
    if (inBuilding(i.x, i.z)) bad.push(what + ' is inside a building');
  });
  return { name: 'lamps', count: n, bad };
}

async function checkTraffic(cars = 40, minutes = 5) {
  if (process.env.NOHW) globalThis.__noHw = true;
  const { createTrafficSystem } = await imp('src/traffic.js');
  const { buildTransit, clearTransitSpots } = await imp('src/transit.js'); const transit = buildTransit(city); clearTransitSpots(city, transit);
  const dt = 1 / 15, tr = createTrafficSystem(city, new THREE.Scene(), heightAt, cars, cars, transit);
  const player = { x: 9999, z: 9999, y: 0, heading: 0, speed: 0 };
  const still = new Map(), seen = new Map(), spin = new Map(); let longest = 0, overlaps = 0, ghosts = 0, stopSec = 0, inBox = 0, whyH = {}, carSec = 0, boxSec = 0, travelled = 0;
  const parkedCars = (city.props || []).filter(p => p.type === 'parkedcar').map(p => { const h = (p.rotation || 0) * Math.PI / 180, fx = Math.sin(h), fz = Math.cos(h); return [-0.9, 0, 0.9].map(o => ({ x: p.x + fx * o, z: p.z + fz * o })); });
  const pgrid = new Map(); parkedCars.forEach((c, i) => { const k = Math.floor(c[1].x / 20) + ',' + Math.floor(c[1].z / 20); (pgrid.get(k) || pgrid.set(k, []).get(k)).push(i); });
  const hitParked = new Set();
  const bad = [], lanes = [0, 0, 0], changes = { n: 0 }, offLine = new Set(), busSeen = new Map(), stopsServed = new Set();
  for (let k = 0; k < 15 * 60 * minutes; k++) {
    T += dt * 1000; tr.update(dt, player);
    if (k % 15 === 0) tr.cars.forEach(c => { if (c.active && c.edge && c.edge.type === 'highway' && c.lanes === 3 && !c.conn) lanes[c.laneIndex]++; });
    if (k % 3 === 0) tr.cars.forEach((c, i) => {      // traffic against the parked cars: their collision circles must not overlap
      if (!c.active || !c.colliders || c.knock) return;
      const cx = Math.floor(c.mesh.position.x / 20), cz = Math.floor(c.mesh.position.z / 20);
      for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++) for (const pi of pgrid.get(a + ',' + b) || []) {
        let deep = 0; for (const q of c.colliders) for (const pc of parkedCars[pi]) deep = Math.max(deep, q.radius + 0.85 - Math.hypot(q.x - pc.x, q.z - pc.z));
        if (deep > 0.4) { const key = c.edge.id + ":" + pi; if (!hitParked.has(key)) { hitParked.add(key); bad.push('traffic car ' + i + ' (' + c.type + ') overlaps a parked car by ' + r1(deep) + ' u on edge ' + c.edge.id + ' @' + r1(c.mesh.position.x) + ',' + r1(c.mesh.position.z)); } }
      }
    });
    tr.cars.forEach((c, i) => {
      if (!c.active) return;
      carSec += dt; travelled += c.speed * dt; if (c.speed < 0.3 && c.conn) inBox += dt; if (c.speed < 0.3) { stopSec += dt; if (c.why === 'box') boxSec += dt; whyH[c.why || (c.blockedBy ? 'car' : '-')] = (whyH[c.why || (c.blockedBy ? 'car' : '-')] || 0) + dt; }
      if (c.speed < 0.05 && c.crashTimer <= 0) {
        const v = (still.get(i) || 0) + dt; still.set(i, v); longest = Math.max(longest, v);
        if (v > 40 && c.why !== 'bridge' && !seen.has(i + ':' + c.to)) { seen.set(i + ':' + c.to, 1); bad.push('car ' + i + ' (' + c.type + ') stuck >40 s on edge ' + c.edge.id + ' toward ' + c.to + ' (' + c.why + ')'); }
      } else still.set(i, 0);
      if (c.ghost > 6.9) ghosts++;
      { // circling: a car whose heading turns through more than 300 deg within 20 s while staying within 12 u of where it started
        const w = (spin.get(i) || spin.set(i, { x: c.mesh.position.x, z: c.mesh.position.z, h: c.hdg, a: 0, t: 0 }).get(i));
        let dh = c.hdg - w.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); w.a += dh; w.h = c.hdg; w.t += dt;
        if (Math.hypot(c.mesh.position.x - w.x, c.mesh.position.z - w.z) > 12) { w.x = c.mesh.position.x; w.z = c.mesh.position.z; w.a = 0; w.t = 0; }
        else if (w.t > 20) { w.a = 0; w.t = 0; w.x = c.mesh.position.x; w.z = c.mesh.position.z; }
        else if (Math.abs(w.a) > 4.4 && !c.crashTimer && !c.knock) { bad.push('car ' + i + ' (' + c.type + ') turned in circles near ' + r1(w.x) + ',' + r1(w.z) + ' on edge ' + (c.edge && c.edge.id)); w.a = 0; w.t = 0; }
      }
      if (c.line && c.edge) { const on = c.line.steps.some(st => st.edge === c.edge); if (!on) offLine.add(i); const v = busSeen.get(i) || new Set(); v.add(c.edge.id); busSeen.set(i, v); if (c.stopDone) stopsServed.add(i + ':' + c.stopDone); }
    });
    if (k % 15 === 0) for (let i = 0; i < tr.cars.length; i++) for (let j = i + 1; j < tr.cars.length; j++) {
      const A = tr.cars[i], B = tr.cars[j];
      if (A.active && B.active && Math.hypot(A.collider.x - B.collider.x, A.collider.z - B.collider.z) < 1.6) overlaps++;
    }
  }
  if (overlaps > cars) bad.push('cars overlapped in ' + overlaps + ' samples');
  const lineBuses = tr.cars.filter(c => c.line).length;
  if (!transit.lines.length) bad.push('no bus lines were built');
  if (!transit.depot) bad.push('no bus depot site found');
  if (transit.stands.length < 8) bad.push('only ' + transit.stands.length + ' cab stands');
  if (offLine.size) bad.push(offLine.size + ' line bus(es) left their route');
  if (minutes >= 3 && stopsServed.size < lineBuses) bad.push('buses served only ' + stopsServed.size + ' stops in ' + minutes + ' min');
  const tot = lanes[0] + lanes[1] + lanes[2];
  if (tot > 40 && Math.min(...lanes) / tot < 0.05) bad.push('highway lanes unevenly used: left/middle/right = ' + lanes.map(v => Math.round(v / tot * 100)).join('/') + ' %');
  return { name: 'traffic', count: cars + ' cars, ' + minutes + ' min (stopped ' + Math.round(stopSec / carSec * 100) + ' % of car-time, ' + Math.round(boxSec / carSec * 1000) / 10 + ' % held by full exits, ' + Math.round(inBox / carSec * 1000) / 10 + ' % stopped inside a junction [' + Object.entries(whyH).map(([k, v]) => k + ':' + Math.round(v / carSec * 1000) / 10).join(' ') + '], avg speed ' + (travelled / carSec).toFixed(1) + ' u/s, longest stop ' + Math.round(longest) + ' s, ghost frames ' + ghosts + ', overlap samples ' + overlaps + ', highway lanes L/M/R ' + lanes.join('/') + '; ' + transit.lines.length + ' bus lines, ' + lineBuses + ' buses, ' + stopsServed.size + ' stops served, ' + transit.stops.length + ' stops, ' + transit.stands.length + ' cab stands)', bad };
}

async function checkBuildings() {
  await world();
  const bad = []; let n = 0;
  const structOf = [];
  (roads.userData.mapPaths || []).forEach(p => { if (p.structure && p.structure !== 'ground') structOf.push(p); });
  for (const p of city.parcels || []) {
    if (p.type !== 'building' || !p.footprint) continue;
    n++;
    const f = p.footprint, pts = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L / 2));
      for (let j = 0; j < k; j++) pts.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
    }
    let cx = 0, cz = 0; f.forEach(q => { cx += q[0]; cz += q[1]; }); pts.push([cx / f.length, cz / f.length]);
    let worst = 0, at = null;
    pts.forEach(q => { const d = -distToRoad(q[0], q[1]); if (d > worst) { worst = d; at = q; } });
    if (worst > 0.3) bad.push((p.landmark?'LANDMARK ':p.shop!==undefined?'SHOP ':p.district?'cell ':'other ') + (p.name||p.district||'') + ' ' + (p.id || '') + '@' + r1(cx / f.length) + ',' + r1(cz / f.length) + ' covers the road by ' + r1(worst) + ' near ' + r1(at[0]) + ',' + r1(at[1]));
  }
  return { name: 'buildings', count: n, bad };
}


// ---- painted markings never conflict ---------------------------------------------------------------------------------------
async function checkMarkings() {
  await world();
  const marks = roads.userData.marks || [];
  const bad = [], CELL = 8, grid = new Map();
  marks.forEach((m, i) => {
    const x0 = Math.floor(Math.min(m.x1, m.x2) / CELL), x1 = Math.floor(Math.max(m.x1, m.x2) / CELL), z0 = Math.floor(Math.min(m.z1, m.z2) / CELL), z1 = Math.floor(Math.max(m.z1, m.z2) / CELL);
    for (let a = x0; a <= x1; a++) for (let b = z0; b <= z1; b++) { const k = a + ',' + b; (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  });
  const nodesOf = id => { if (id.startsWith('corner:')) return [id.slice(7)]; const e = edgeById.get(id); return e ? [e.from, e.to] : []; };
  const edgeById = new Map(city.roadEdges.map(e => [e.id, e]));
  const seen = new Set(), reported = new Set();
  const isLine = k => k === 'dash' || k === 'solid' || k === 'yellow';
  for (const list of grid.values()) for (let ii = 0; ii < list.length; ii++) for (let jj = ii + 1; jj < list.length; jj++) {
    const a = marks[list[ii]], b = marks[list[jj]];
    if (a.e === b.e) continue;
    const key = list[ii] < list[jj] ? list[ii] + '_' + list[jj] : list[jj] + '_' + list[ii];
    if (seen.has(key)) continue; seen.add(key);
    if (Math.abs(a.y - b.y) > 1.2) continue;
    const ax = a.x2 - a.x1, az = a.z2 - a.z1, bx = b.x2 - b.x1, bz = b.z2 - b.z1, la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 0.3 || lb < 0.3) continue;
    const den = ax * bz - az * bx;
    let why = null, wx, wz;
    if (Math.abs(den) > 1e-6 * la * lb) {
      const t = ((b.x1 - a.x1) * bz - (b.z1 - a.z1) * bx) / den, u = ((b.x1 - a.x1) * az - (b.z1 - a.z1) * ax) / den;
      const e = 0.04;
      if (t > e && t < 1 - e && u > e && u < 1 - e) {
        // a crosswalk or stop line of one road over the paint of another, or two roads' lines crossing
        if ((a.k === 'cross' || a.k === 'stop' || b.k === 'cross' || b.k === 'stop') || (isLine(a.k) && isLine(b.k))) { why = a.k + ' of ' + a.e + ' crosses ' + b.k + ' of ' + b.e; wx = a.x1 + ax * t; wz = a.z1 + az * t; }
      }
    } else if (isLine(a.k) && isLine(b.k)) {
      // parallel: overlapping paint
      const d = Math.abs(((b.x1 - a.x1) * az - (b.z1 - a.z1) * ax) / la);
      if (d < 0.35) {
        const ta = ((b.x1 - a.x1) * ax + (b.z1 - a.z1) * az) / la, tb = ((b.x2 - a.x1) * ax + (b.z2 - a.z1) * az) / la;
        const ov = Math.min(la, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb));
        if (ov > 1.0) { why = a.k + ' of ' + a.e + ' overlaps ' + b.k + ' of ' + b.e; wx = a.x1 + ax / 2; wz = a.z1 + az / 2; }
      }
    }
    if (why) {
      // paint of two pieces of the same road meeting at a joint (a bend or a taper) overlaps by a few cm: not a visible conflict
      const na = nodesOf(a.e), nb = nodesOf(b.e), shared = na.filter(n => nb.includes(n));
      if (shared.some(n => Math.hypot(city.roadNodes[n].x - wx, city.roadNodes[n].z - wz) < 14) && isLine(a.k) && isLine(b.k)) continue;
    }
    if (why) { const rk = a.e + '|' + b.e + '|' + a.k + b.k; if (reported.has(rk)) continue; reported.add(rk); bad.push(why + ' near ' + r1(wx) + ',' + r1(wz)); }
  }
  return { name: 'markings', count: marks.length + ' painted segments', bad };
}

// ---- bridges: pillars out of the lanes, low sides walled ---------------------------------------------------------------------
let structs = null;
async function structures() {
  if (structs) return structs;
  const { buildStructures } = await imp('src/structures.js');
  return (structs = buildStructures(city));
}
async function checkBridges() {
  await world();
  const st = await structures();
  const ground = makeRoadClearance((roads.userData.mapPaths || []).filter(p => p.structure !== 'bridge' && !(p.minY > 1.2)));
  const bad = [];
  st.piers.forEach(p => {
    const c = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    c.forEach(([a, b]) => {
      const x = p.x + p.ux * p.hl * a - p.uz * p.hw * b, z = p.z + p.uz * p.hl * a + p.ux * p.hw * b;
      const d = ground(x, z);
      if (d < 0.3) bad.push(p.kind + ' pillar @' + r1(p.x) + ',' + r1(p.z) + ' stands on a road (' + r1(d) + ' from the surface edge)');
    });
  });
  // every pillar of a street over the freeway sits in the median, between the carriageways
  const median = st.piers.filter(p => p.kind === 'median');
  if (!median.length && (city.hasHW !== false && !process.env.CITY)) bad.push('no median pillar found for the freeway crossings');
  // low-deck sides are walled
  const unwalled = [];
  city.roadEdges.forEach(e => {
    const A = city.roadNodes[e.from], B = city.roadNodes[e.to];
    if (Math.max(A.elevation, B.elevation) < 0.5 || Math.min(A.elevation, B.elevation) >= 3.0 || e.structure === 'tunnel') return;
    const L2 = (B.x - A.x) ** 2 + (B.z - A.z) ** 2 || 1;
    if (!st.walls.some(w => { const t = Math.max(0, Math.min(1, ((w.x - A.x) * (B.x - A.x) + (w.z - A.z) * (B.z - A.z)) / L2)); return Math.hypot(w.x - A.x - (B.x - A.x) * t, w.z - A.z - (B.z - A.z) * t) < e.width / 2 + 1.5; })) unwalled.push(e.id);
  });
  unwalled.slice(0, 20).forEach(id => bad.push('raised edge ' + id + ' has no low side walls'));
  return { name: 'bridges', count: st.piers.length + ' pillars, ' + st.walls.length + ' wall pieces', bad };
}

// ---- water --------------------------------------------------------------------------------------------------------------------
async function checkRules() {
  if (process.env.DUMP) { const ids = process.env.DUMP.split(','); ids.concat(Object.keys(city.roadNodes).filter(k => Math.hypot(city.roadNodes[k].x + 1153, city.roadNodes[k].z - 984.75) < 20 && process.env.DUMP2)).forEach(id => { const n = city.roadNodes[id]; console.log(id, n.x, n.z, n.elevation, city.roadEdges.filter(e => e.from === id || e.to === id).map(e => e.id + ':' + e.type + ':' + e.structure + ':' + (e.from === id ? e.to : e.from)).join(' ')); }); }
  const { CLASSES } = await imp('src/chicago/network.js');
  const bad = [], N = city.roadNodes, E = city.roadEdges;
  const deg = {}; E.forEach(e => { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; });
  // 1. grades
  E.forEach(e => {
    const A = N[e.from], B = N[e.to], L = Math.hypot(B.x - A.x, B.z - A.z) || 1, g = Math.abs(B.elevation - A.elevation) / L, lim = (CLASSES[e.cls] || CLASSES.two).maxGrade;
    if (g > lim + 0.002) bad.push('edge ' + e.id + ' (' + e.cls + ') grade ' + r1(g * 100) + ' % > ' + lim * 100 + ' %');
  });
  // 2. dead ends (highway/ramp ends excluded: they leave the map)
  Object.keys(N).forEach(id => { if ((deg[id] || 0) === 1) { const e = E.find(q => q.from === id || q.to === id); if (e && e.type !== 'highway' && !e.ramp) bad.push('dead end at ' + id + ' ' + r1(N[id].x) + ',' + r1(N[id].z) + ' map ' + r1(494.5 - N[id].x / 2.5) + ',' + r1(701.5 - N[id].z / 2.5) + ' (' + e.type + ' ' + e.id + ')'); } });
  // 3. meeting points (3+ roads) at least 100 m = 80 u apart, on the ground
  const J = Object.keys(N).filter(id => deg[id] >= 3 && N[id].elevation < 0.5 && !E.some(e => (e.from === id || e.to === id) && (e.type === 'highway' || e.ramp)));
  for (let i = 0; i < J.length; i++) for (let j = i + 1; j < J.length; j++) { const d = Math.hypot(N[J[i]].x - N[J[j]].x, N[J[i]].z - N[J[j]].z); if (d < 80) bad.push('meeting points ' + J[i] + ' / ' + J[j] + ' only ' + r1(d * 1.25) + ' m apart at map ' + r1(494.5 - N[J[i]].x / 2.5) + ',' + r1(701.5 - N[J[i]].z / 2.5) + ' elev ' + r1(N[J[i]].elevation)); }
  return { name: 'rules', count: E.length + ' edges, ' + J.length + ' meeting points', bad };
}
async function checkDriveways() {
  const { buildSidewalkSegments } = await imp('src/sidewalks.js');
  const segs = buildSidewalkSegments(city), bad = [];
  (city.driveways || []).forEach((d, i) => {
    segs.forEach(sg => {
      const dx = sg.x2 - sg.x1, dz = sg.z2 - sg.z1, L = Math.hypot(dx, dz) || 1, t = Math.max(0, Math.min(1, ((d.x - sg.x1) * dx + (d.z - sg.z1) * dz) / (L * L)));
      const q = Math.hypot(d.x - (sg.x1 + dx * t), d.z - (sg.z1 + dz * t));
      if (q < 3) bad.push('driveway ' + i + ' (' + d.kind + ') has kerb across it at ' + r1(d.x) + ',' + r1(d.z));
    });
    (city.props || []).forEach(p => { if (Math.hypot(p.x - d.x, p.z - d.z) < d.hw * 0.75 && ['parkedcar', 'light', 'tree', 'sign', 'trafficlight', 'bench', 'hydrant', 'mailbox'].includes(p.type)) bad.push('driveway ' + i + ': ' + p.type + ' blocks the entrance at ' + r1(p.x) + ',' + r1(p.z)); });
  });
  return { name: 'driveways', count: (city.driveways || []).length + ' driveways', bad };
}
// ---- the road surface is smooth: gentle grades, no spikes, no steps ---------------------------------------------------------------------------
async function checkSmooth() {
  const { CLASSES } = await imp('src/chicago/network.js');
  const { buildHorizontalCurve, buildEdgesByNode, buildVerticalCurves, elevationAlongEdge } = await imp('src/roadMath.js');
  const bad = [], STEP = 2, N = city.roadNodes, ebn = buildEdgesByNode(city.roadEdges);
  const clsOf = e => e.cls || (e.ramp ? 'ramp' : e.type === 'highway' ? 'hw' : e.type === 'avenue' ? 'four' : 'two');
  let samples = 0;
  // a run of surface heights sampled every `step` u: grade limit, no spikes (2nd difference), no steps
  const judge = (label, ys, step, lim, at) => {
    samples += ys.length;
    for (let i = 1; i < ys.length - 1; i++) {
      const g = Math.abs(ys[i + 1] - ys[i]) / step, curv = Math.abs(ys[i - 1] - 2 * ys[i] + ys[i + 1]);
      if (g > lim * 1.5 + 0.03) { bad.push(label + ': surface grade ' + r1(g * 100) + ' % (limit ' + r1(lim * 150 + 3) + ' %) near ' + at(i)); return; }
      if (curv > (+process.env.CURV || 0.25)) { bad.push(label + ': bump of ' + r1(curv) + ' u over ' + step + ' u near ' + at(i)); return; }
    }
  };
  const corner = {};
  for (const id in N) { const c = buildHorizontalCurve(id, N, ebn); if (c) corner[id] = c; }
  const vc = buildVerticalCurves(N, ebn);
  let refY; const yAt = (x, z) => heightAt(x, z, refY);      // refY: which of several stacked surfaces (a bridge over a road) to read
  city.roadEdges.forEach(e => {
    const A = N[e.from], B = N[e.to], L = Math.hypot(B.x - A.x, B.z - A.z), t0 = corner[e.from] ? corner[e.from].trim : 0, t1 = corner[e.to] ? corner[e.to].trim : 0;
    const lim = (CLASSES[clsOf(e)] || CLASSES.two).maxGrade, run = L - t0 - t1; if (run < 3 * STEP) return;
    const n = Math.floor(run / STEP), ys = [], P = i => { const s = t0 + run * i / n, t = s / L; return [A.x + (B.x - A.x) * t, A.z + (B.z - A.z) * t]; };
    for (let i = 0; i <= n; i++) { const p = P(i); refY = elevationAlongEdge(e, t0 + run * i / n, N, vc) + 0.45; ys.push(yAt(p[0], p[1])); }
    judge('edge ' + e.id + ' (' + clsOf(e) + ', ' + e.structure + ')', ys, run / n, lim, i => r1(P(i)[0]) + ',' + r1(P(i)[1]));
  });
  for (const id in corner) {
    const c = corner[id], es = ebn[id], lim = Math.min(...es.map(e => (CLASSES[clsOf(e)] || CLASSES.two).maxGrade));
    const ys = [], P = [], step = Math.max(0.6, c.length / 24);
    const endY = oid => { const e = es.find(q => (q.from === id ? q.to : q.from) === oid), Ln = Math.hypot(N[e.to].x - N[e.from].x, N[e.to].z - N[e.from].z); return elevationAlongEdge(e, e.from === id ? c.trim : Ln - c.trim, N, vc); };
    const y0 = endY(c.otherIds[0]), y1 = endY(c.otherIds[1]);
    for (let l = 0; l <= c.length; l += step) { const sm = c.samples.reduce((b, q) => (Math.abs(q.l - l) < Math.abs(b.l - l) ? q : b)); P.push([sm.x, sm.z]); refY = y0 + (y1 - y0) * l / c.length + 0.9; ys.push(yAt(sm.x, sm.z)); }
    judge('corner ' + id + ' (' + clsOf(es[0]) + ')', ys, step, lim, i => r1(P[i][0]) + ',' + r1(P[i][1]));
    // the seams: where the straight edge hands over to the corner there is no step
    c.otherIds.forEach((oid, k) => {
      const e = es.find(q => (q.from === id ? q.to : q.from) === oid), o = N[oid], n0 = N[id], d = Math.hypot(o.x - n0.x, o.z - n0.z) || 1;
      const sx = n0.x + (o.x - n0.x) / d * c.trim, sz = n0.z + (o.z - n0.z) / d * c.trim, cs = k === 0 ? c.samples[0] : c.samples[c.samples.length - 1];
      refY = (k === 0 ? y0 : y1) + 0.9; const jump = Math.abs(yAt(sx, sz) - yAt(cs.x, cs.z));
      if (jump > 0.06) bad.push('corner ' + id + ': step of ' + r1(jump) + ' u where edge ' + e.id + ' meets the corner (' + r1(sx) + ',' + r1(sz) + ')');
    });
  }
  return { name: 'smooth', count: samples + ' samples', bad };
}
// ---- the drawn road surface and the surface cars drive on agree (nothing sticks out, nothing sinks) -----------------------------------------
async function checkMesh() {
  await world();
  const bad = [], seen = new Set(); let n = 0;
  roads.updateMatrixWorld(true);
  roads.traverse(o => {
    if (!o.isMesh || !o.userData.isRoadSurface) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); n++;
      let g = heightAt(x, z, y);                                  // vertices on the very edge of the ribbon can fall just outside the sampler's width, so also try 0.6 u around
      for (const [ox, oz] of [[0.6,0],[-0.6,0],[0,0.6],[0,-0.6]]) { const h = heightAt(x + ox, z + oz, y); if (Math.abs(h - y) < Math.abs(g - y)) g = h; }
      const d = y - g;
      if (Math.abs(d) > 0.2 && !(g === 0 && y < 0.2) && !(d < 0 && d > -0.5)) {       // (a vertex a little below the surface is hidden under a neighbouring road that climbs: the end of a flat street square-on to a bridge approach)         // 0.2 u = 25 cm: the paint / lift offsets are 0.03-0.05
        const k = Math.round(x / 8) + ',' + Math.round(z / 8) + ',' + (d > 0 ? 'up' : 'down'); if (seen.has(k)) continue; seen.add(k);
        bad.push('road mesh ' + (d > 0 ? 'sticks out ' : 'sinks ') + r1(Math.abs(d)) + ' u above/below the driving surface at ' + r1(x) + ',' + r1(z) + ' (mesh y ' + r1(y) + ', surface ' + r1(g) + ')');
      }
    }
  });
  return { name: 'mesh', count: n + ' vertices', bad: bad.slice(0, 40).concat(bad.length > 40 ? ['... and ' + (bad.length - 40) + ' more'] : []) };
}
async function checkWater() {
  const { RIVERS, LAKES, DECKS } = await imp('src/chicago/map.js');
  const { nearestOnPoly, pointInPoly } = await imp('src/chicago/geom.js');
  const onDeck = (x, z) => DECKS.some(d => pointInPoly(x, z, d.pts));      // piers / causeways stand on the water
  const wet = (x, z) => !onDeck(x, z) && LAKES.some(l => pointInPoly(x, z, l)) || RIVERS.some(r => nearestOnPoly(x, z, r.pts).d < r.half - 0.5);
  const bad = [], done = new Set();
  city.roadEdges.forEach(e => {
    const A = city.roadNodes[e.from], B = city.roadNodes[e.to], L = Math.hypot(B.x - A.x, B.z - A.z);
    for (let s = 0; s <= L; s += 2) {
      const t = s / L, x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t, y = A.elevation + (B.elevation - A.elevation) * t;
      if (y < 1.5 && wet(x, z) && !done.has(e.id)) { done.add(e.id); bad.push('edge ' + e.id + ' (' + e.type + ') lies in water at ' + r1(x) + ',' + r1(z) + ' (height ' + r1(y) + ')'); }
    }
  });
  return { name: 'water', count: city.roadEdges.length + ' edges', bad };
}

// ---- everything is solid ------------------------------------------------------------------------------------------------------
async function checkSolid() {
  await world();
  const { buildProps } = await imp('src/generators/props.js');
  const { buildSigns } = await imp('src/generators/signs.js');
  const { propPhysics } = await imp('src/physicsConfig.js');
  const { buildCollisionWorld, resolveCarCollisions } = await imp('src/collision.js');
  const st = await structures();
  const props = buildProps(city).instances, signs = buildSigns(city, heightAt, roads.userData.mapPaths).instances;
  const bad = [], typesNo = {};
  const DECOR = new Set(['shopsign', 'flowers', 'crosswalk']);
  // the part of a model a car can actually hit: meshes reaching down below ~0.8 u (not glow cones, mast arms or canopies)
  const lowBox = obj => {
    const box = new THREE.Box3(); obj.updateWorldMatrix(true, true);
    obj.traverse(o => { if (!o.isMesh || o.material?.transparent || o.material?.blending === THREE.AdditiveBlending) return; const b = new THREE.Box3().setFromObject(o); if (b.min.y < 0.8 && b.max.y > 0.4) box.union(b); });
    return box;
  };
  const tally = (k) => { typesNo[k] = (typesNo[k] || 0) + 1; };
  props.concat(signs).forEach(i => {
    if (!i.mesh) return;
    const bb = lowBox(i.mesh), half = bb.isEmpty() ? 0 : Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
    if (propPhysics[i.type]) {
      if (half > propPhysics[i.type].radius * 1.8 + 0.4 && i.type !== 'gantry') tally(i.type + ': collider radius ' + propPhysics[i.type].radius + ' but the model is ' + r1(half) + ' wide at ground level');
      return;
    }
    if (DECOR.has(i.type)) return;
    if (!bb.isEmpty() && bb.max.y - bb.min.y > 0.3 && half > 0.15) tally(i.type + ' stands on the ground (' + r1(half * 2) + ' wide) but has no collision');
  });
  Object.entries(typesNo).forEach(([k, n]) => bad.push(n + 'x ' + k));
  // ram every collider from 7 units out at 25 u/s and make sure the car never ends up inside
  const parcelsInst = (city.parcels || []).filter(p => p.type === 'building').map(p => ({ type: 'building', footprint: p.footprint }));
  const world3 = buildCollisionWorld(props.concat(signs), parcelsInst).concat(st.colliders);
  let rammed = 0;
  const rng = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
  const pick = world3.filter(c => !c.destructible).sort(() => rng() - 0.5).slice(0, 700).concat(st.colliders.filter(c => c.pier).slice(0, 40));
  pick.forEach(c => {
    let tx, tz, inside;
    if (c.footprint) { const f = c.footprint; tx = f.reduce((s, q) => s + q[0], 0) / f.length; tz = f.reduce((s, q) => s + q[1], 0) / f.length; inside = (x, z) => pointInPolygon(x, z, f); }
    else { tx = c.x; tz = c.z; inside = (x, z) => Math.hypot(x - c.x, z - c.z) < c.radius * 0.6; }
    for (let a = 0; a < 6; a++) {
      const ang = a * Math.PI / 3 + 0.3, car = { x: tx - Math.sin(ang) * 9, z: tz - Math.cos(ang) * 9, y: 0, heading: ang, speed: 25, collisionRadius: 1.1, massFactor: 1 };
      const only = [c];
      for (let k = 0; k < 60; k++) { car.x += Math.sin(car.heading) * car.speed / 30; car.z += Math.cos(car.heading) * car.speed / 30; resolveCarCollisions(car, only, 1 / 30); }
      rammed++;
      if (inside(car.x, car.z) && !(c.kind === 'parcel' && c.footprint.length < 3)) { bad.push((c.pier ? 'pillar' : c.wall ? 'wall' : c.kind) + ' @' + r1(tx) + ',' + r1(tz) + ' can be driven into/through'); break; }
    }
  });
  return { name: 'solid', count: props.length + signs.length + ' objects, ' + st.colliders.length + ' structure colliders, ' + rammed + ' ram tests', bad };
}

// ---- covered: no rain/snow indoors, but it does fall in the open ---------------------------------------------------------
async function checkCovered() {
  const { isCovered } = await imp('src/covered.js');
  const { pocketOrigin } = await imp('src/estate.js');
  const bad = []; let n = 0;
  const expect = (what, got, want) => { n++; if (got !== want) bad.push(what + ': covered=' + got + ', should be ' + want); };
  for (let i = 0; i < 60; i++) { const o = pocketOrigin(i); [[0, 0], [-60, 3], [77, 0], [20, 20]].forEach(([dx, dz]) => expect('pocket ' + i + ' at ' + dx + ',' + dz, isCovered(o.x + dx, 0, 'city'), true)); }
  expect('garage mode', isCovered(0, 0, 'garage'), true); expect('flat mode', isCovered(0, 0, 'flat'), true);
  expect('tunnel floor', isCovered(100, -4, 'city'), true);
  Object.values(city.roadNodes).forEach(nd => { if (nd.elevation >= 0 || nd.elevation === undefined) expect('street node ' + nd.x + ',' + nd.z, isCovered(nd.x, Math.max(0, nd.elevation || 0), 'city'), false); });
  return { name: 'covered', count: n + ' sample points', bad };
}

// drift circuits: corners wide enough to drift (radius >= 12 u), walls clear of the road, tracks far from each other and from the city
async function checkDrift() {
  const { createDriftTracks } = await imp('src/driftTrack.js');
  const d = createDriftTracks({ scene: new THREE.Scene() }), bad = [];
  d.tracks.forEach(t => {
    if (t.minR < 12) bad.push(t.id + ' tightest corner ' + t.minR + ' u');
    let close = 0; t.wall.forEach(w => { if (t.distFrom(w.x, w.z) < t.width / 2 + 2) close++; }); if (close) bad.push(t.id + ': ' + close + ' wall posts inside the track');
    if (t.length < 250 || t.length > 700) bad.push(t.id + ' lap ' + t.length + ' m');
    if (d.heightAt(t.pts[0][0], t.pts[0][1]) !== 0 || d.heightAt.kind !== 'road') bad.push(t.id + ' start is not road');
  });
  return { name: 'drift', count: d.tracks.length + ' circuits', bad };
}
// races: circuits are real closed loops (start = finish, no street used twice), every kind has a start on the road
async function checkRaces() {
  await world();
  const { planRaces } = await imp('src/races.js');
  const plan = planRaces(city, () => 'City'), bad = [], by = {};
  plan.forEach(r => { by[r.kind] = (by[r.kind] || 0) + 1; });
  const circ = plan.filter(r => r.kind === 'circuit');
  if (circ.length < 1) bad.push('no circuit race was planned');
  circ.forEach(r => {
    const a = r.pts[0], b = r.pts[r.pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1.5) bad.push(r.id + ' does not close: ' + Math.round(Math.hypot(a[0] - b[0], a[1] - b[1])) + ' u apart');
    const last = r.checkpoints[r.checkpoints.length - 1];
    if (Math.hypot(last[0] - a[0], last[1] - a[1]) > 3) bad.push(r.id + ' final checkpoint is not the start line');
  });
  // every start (the player's slot and the three rival slots behind it) is free of obstacles and on the street level, and the player can drive off from it
  {
    const { buildProps } = await imp('src/generators/props.js');
    const { buildSigns } = await imp('src/generators/signs.js');
    const { buildCollisionWorld, resolveCarCollisions } = await imp('src/collision.js');
    const st = await structures();
    const props = buildProps(city).instances, signs = buildSigns(city, heightAt, roads.userData.mapPaths).instances;
    const parcelsInst = (city.parcels || []).filter(p => p.type === 'building').map(p => ({ type: 'building', footprint: p.footprint }));
    const world3 = buildCollisionWorld(props.concat(signs), parcelsInst).concat(st.colliders);
    plan.filter(r => !r.track).forEach(r => {
      const p = r.pts[0], q = r.pts[1], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, dx = (q[0] - p[0]) / l, dz = (q[1] - p[1]) / l;
      const off = Math.min(1.6, r.width / 5), x = p[0] - dz * off, z = p[1] + dx * off, h = Math.atan2(dx, dz);
      const car = { x, z, y: 0, heading: h, speed: 0, collisionRadius: 1.1, massFactor: 1 }, x0 = car.x, z0 = car.z;
      resolveCarCollisions(car, world3, 1 / 60);
      const pushed = Math.hypot(car.x - x0, car.z - z0);
      if (pushed > 0.5) bad.push(r.id + ' (' + r.kind + ') starts inside an obstacle (pushed ' + r1(pushed) + ' u)' + (process.env.DBG ? ' at ' + r1(x) + ',' + r1(z) + ' near ' + world3.filter(o => Math.hypot((o.x ?? 1e9) - x, (o.z ?? 1e9) - z) < 6).map(o => JSON.stringify(o).slice(0, 120)).join(' | ') : ''));
      car.speed = 10;
      for (let k = 0; k < 120; k++) { car.x += Math.sin(h) * car.speed / 60; car.z += Math.cos(h) * car.speed / 60; resolveCarCollisions(car, world3, 1 / 60); car.speed = Math.max(car.speed, 8); }
      const gone = Math.hypot(car.x - x0, car.z - z0);
      if (gone < 10) bad.push(r.id + ' (' + r.kind + ') cannot drive off the start: moved only ' + r1(gone) + ' u in 2 s');
    });
  }
  return { name: 'races', count: Object.entries(by).map(([k, v]) => v + ' ' + k).join(', '), bad };
}
// gas stations: enough of them, every pump lane sits on the paved forecourt, nothing (building/road) overlaps it
async function checkGas() {
  await world();
  const bad = [], g = city.gasStations || [];
  if (g.length < 5) bad.push('only ' + g.length + ' gas stations');
  g.forEach(s => g.forEach(o => { if (o !== s && s.id < o.id && Math.hypot(s.x - o.x, s.z - o.z) < 120) bad.push(s.id + ' and ' + o.id + ' are close together'); }));
  g.forEach(s => s.fill.forEach((f, i) => { heightAt(f.x, f.z, 0); if (heightAt.kind !== 'plaza') bad.push(s.id + ' lane ' + i + ' is on ' + heightAt.kind); }));
  return { name: 'gas', count: g.length + ' gas stations', bad };
}
// ---- sidewalks lead somewhere ----------------------------------------------------------------------------------------------
async function checkSidewalks() {
  const { buildSidewalkSegments, STUB_LEN, ISLAND_LEN } = await imp('src/sidewalks.js');
  const segs = buildSidewalkSegments(city, { cut: false }), bad = [];
  const byEdge = new Map(); segs.forEach(sg => { const e = byEdge.get(sg.edgeId) || { id: sg.edgeId, from: sg.fromNode, to: sg.toNode, len: 0 }; e.len = Math.max(e.len, Math.hypot(sg.x2 - sg.x1, sg.z2 - sg.z1)); byEdge.set(sg.edgeId, e); });
  const at = new Map(); byEdge.forEach(e => { [e.from, e.to].forEach(n => at.set(n, (at.get(n) || 0) + 1)); });
  byEdge.forEach(e => { if ((at.get(e.from) <= 1 || at.get(e.to) <= 1) && e.len < STUB_LEN) { const n = city.roadNodes[at.get(e.from) <= 1 ? e.from : e.to]; bad.push('pavement stub of ' + r1(e.len) + ' u goes nowhere @' + r1(n.x) + ',' + r1(n.z)); } });
  // pavement beside a slip road or the interstate: nobody should be walking there
  const hot = city.roadEdges.filter(e => e.ramp || e.type === 'highway');
  const hotNodes = new Set(hot.flatMap(e => [e.from, e.to]));
  byEdge.forEach(e => { if (hotNodes.has(e.from) && hotNodes.has(e.to) && e.len < 150) bad.push('pavement between two slip-road nodes @' + r1(city.roadNodes[e.from].x) + ',' + r1(city.roadNodes[e.from].z)); });
  return { name: 'sidewalks', count: segs.length + ' pavement segments (stubs < ' + STUB_LEN + ' u and islands < ' + ISLAND_LEN + ' u are dropped)', bad };
}
// ---- pavement never lies on a road (where they overlap, the road wins) ---------------------------------------------------------
async function checkPavement() {
  await world();
  const { buildSidewalkSegments } = await imp('src/sidewalks.js');
  const segs = buildSidewalkSegments(city, { cut: true });
  const ground = makeRoadClearance((roads.userData.mapPaths || []).filter(p => p.structure !== 'bridge' && !(p.minY > 1.2)));
  const bad = [], seen = new Set(); let n = 0;
  segs.forEach(sg => {
    const L = Math.hypot(sg.x2 - sg.x1, sg.z2 - sg.z1), k = Math.max(1, Math.ceil(L / 1.5));
    const ux = (sg.x2 - sg.x1) / (L || 1), uz = (sg.z2 - sg.z1) / (L || 1);
    for (let i = 0; i <= k; i++) {
      const x = sg.x1 + (sg.x2 - sg.x1) * i / k, z = sg.z1 + (sg.z2 - sg.z1) * i / k;
      for (const o of [-1.2, 0, 1.2]) {                              // inner edge, middle, outer edge of the 2.8 u pavement
        const px = x - uz * o, pz = z + ux * o; n++;
        const d = ground(px, pz);
        if (d < -0.35) { const key = sg.edgeId + ':' + Math.round(px / 6) + ',' + Math.round(pz / 6); if (seen.has(key)) continue; seen.add(key); bad.push('pavement of ' + sg.edgeId + ' lies ' + r1(-d) + ' u inside a road @' + r1(px) + ',' + r1(pz)); }
      }
    }
  });
  return { name: 'pavement', count: segs.length + ' segments, ' + n + ' samples', bad };
}

// ---- everything that should be connected is: one drivable network, and the road surfaces meet at the same height at every node ------------------
async function checkConnected() {
  const { buildEdgesByNode, buildVerticalCurves, elevationAlongEdge } = await imp('src/roadMath.js');
  const N = city.roadNodes, ebn = buildEdgesByNode(city.roadEdges), vc = buildVerticalCurves(N, ebn), bad = [];
  // 1. topology: islands of road that nothing can drive to (one-way edges respected: every node must be reachable from, and lead back to, the main network)
  const out = {}, inn = {};
  city.roadEdges.forEach(e => { (out[e.from] ||= []).push(e.to); (inn[e.to] ||= []).push(e.from); if (!e.oneWay) { (out[e.to] ||= []).push(e.from); (inn[e.from] ||= []).push(e.to); } });
  const reach = (start, adj) => { const seen = new Set([start]), st = [start]; while (st.length) { const n = st.pop(); (adj[n] || []).forEach(m => { if (!seen.has(m)) { seen.add(m); st.push(m); } }); } return seen; };
  const ids = Object.keys(N).filter(id => (ebn[id] || []).length);
  let best = null; ids.slice(0, 40).forEach(id => { const r = reach(id, out); if (!best || r.size > best.size) best = r; });
  const root = [...best][0], fwd = reach(root, out), back = reach(root, inn);
  const strong = ids.filter(id => fwd.has(id) && back.has(id)).length;
  ids.forEach(id => { if (!(fwd.has(id) && back.has(id))) { const n = N[id]; bad.push('node ' + id + ' @' + r1(n.x) + ',' + r1(n.z) + ' cannot be reached from / does not lead back to the main road network (' + (ebn[id].map(e => e.id + (e.ramp ? ' ramp' : '')).join(',')) + ')'); } });
  // 2. height: at every node, the driving surface of each road that meets there is at the planned height and the roads agree with each other
  let n3 = 0;
  for (const id of ids) {
    const es = ebn[id]; if (es.length < 2) continue;
    const nd = N[id], ys = [];
    es.forEach(e => {
      const A = N[e.from], B = N[e.to], L = Math.hypot(B.x - A.x, B.z - A.z) || 1, d = Math.min(3, L * 0.3), s = e.from === id ? d : L - d, t = s / L;
      const px = A.x + (B.x - A.x) * t, pz = A.z + (B.z - A.z) * t, plan = elevationAlongEdge(e, s, N, vc);
      const y = heightAt(px, pz, plan + 0.45); n3++;
      ys.push({ e, y, plan });
      if (y - plan > 0.75 || y - plan < -0.3) bad.push('node ' + id + ' @' + r1(nd.x) + ',' + r1(nd.z) + ': driving surface of ' + e.id + (e.ramp ? ' (ramp)' : '') + ' is ' + r1(y) + ' u but the road is planned at ' + r1(plan) + ' u 3 u from the node (' + e.structure + ')');
    });
    for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++) {
      const a = ys[i], b = ys[j];
      if (Math.abs(a.y - b.y) > 0.5) bad.push('node ' + id + ' @' + r1(nd.x) + ',' + r1(nd.z) + ': ' + a.e.id + (a.e.ramp ? ' (ramp)' : '') + ' meets ' + b.e.id + (b.e.ramp ? ' (ramp)' : '') + ' with a height gap of ' + r1(Math.abs(a.y - b.y)) + ' u (' + r1(a.y) + ' vs ' + r1(b.y) + ')');
    }
  }
  return { name: 'connected', count: ids.length + ' nodes (' + strong + ' in the main network), ' + n3 + ' junction samples', bad };
}


// ---- shop car parks: visitors arrive, park, walk in and out of the shop, and leave (and nothing goes wrong on the way) ----------------------
async function checkLots() {
  const { createShopLots } = await imp('src/lots.js');
  const bad = [], scene = new THREE.Scene(), world = [];
  const actors = [];
  const pedestrians = { createActor: () => { const a = { visible: false, set(x, y, z) { if (![x, y, z].every(Number.isFinite)) bad.push('person at a bad position'); a.visible = true; }, hide() { a.visible = false; }, dispose() {} }; actors.push(a); return a; } };
  let seed = 7; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const { createTrafficSystem } = await imp('src/traffic.js'); const { buildTransit } = await imp('src/transit.js');
  const tr = createTrafficSystem(city, new THREE.Scene(), heightAt, 6, 6, buildTransit(city));
  const lots = createShopLots({ scene, cityData: city, collisionWorld: world, heightAt, pedestrians, adopt: tr.adopt, reserve: tr.reserveLane, release: tr.release, busy: () => false, rng });
  const sh = (city.shops || []).find(s => s.bays && s.mouth);
  const player = { x: sh ? sh.mouth.x + 90 : 0, z: sh ? sh.mouth.z : 0 };
  let nanFrames = 0, maxActive = 0;
  const last = new Map(); let jumps = 0, turns = 0;
  for (let i = 0; i < 15 * 60 * 8; i++) {       // 8 minutes at 15 fps
    lots.update(1 / 15, player, 12); maxActive = Math.max(maxActive, lots.active);
    for (const l of lots.lots) for (const v of l.vs) {
      const c = v.car; if (!(Number.isFinite(c.x) && Number.isFinite(c.z))) nanFrames++;
      const p = last.get(v); if (p) { if (Math.hypot(c.x - p.x, c.z - p.z) > 1.0) { jumps++; if (jumps < 4) bad.push('a car jumped ' + r1(Math.hypot(c.x - p.x, c.z - p.z)) + ' u in one frame (' + v.phase + ') @' + r1(c.x) + ',' + r1(c.z)); } const dy = Math.atan2(Math.sin(c.yaw - p.yaw), Math.cos(c.yaw - p.yaw)); if (Math.abs(dy) > 1.3) { turns++; if (turns < 4) bad.push('a car swung ' + r1(dy) + ' rad in one frame (' + v.phase + ') @' + r1(c.x) + ',' + r1(c.z)); } }
      last.set(v, { x: c.x, z: c.z, yaw: c.yaw });
    }
  }
  if (!(lots.stats.stopped > 0)) bad.push('no leaving car ever stopped at the STOP line');
  if (nanFrames) bad.push(nanFrames + ' frames with a car at a bad position');
  const st = lots.stats;
  if (!(st.arrived > 0)) bad.push('no visitor ever arrived');
  if (!(st.entered > 0)) bad.push('no visitor ever walked into a shop');
  if (!(st.left > 0)) bad.push('no visitor ever left again');
  if (!(st.joined > 0)) bad.push('no leaving visitor ever joined the street traffic');
  // overlapping bays: two visiting cars must never share a bay
  const used = new Set(); for (const l of lots.lots) for (const v of l.vs) { const k = v.b.x + ',' + v.b.z; if (used.has(k)) bad.push('two cars in one bay'); used.add(k); }
  return { name: 'lots', count: lots.lots.length + ' car parks, ' + st.arrived + ' arrivals, ' + st.entered + ' went in, ' + st.left + ' left, ' + (st.joined || 0) + ' joined the traffic (up to ' + maxActive + ' at once)', bad };
}


// ---- pavement is continuous: no gaps at bends, on straights or round junction corners (new maps: run this after changing roads) --------------------------
async function checkPavementGaps() {
  await world();
  const { buildSidewalkSegments, hasSidewalks } = await imp('src/sidewalks.js');
  const { buildEdgesByNode, buildHorizontalCurve } = await imp('src/roadMath.js');
  const segs = buildSidewalkSegments(city, { cut: false }), N = city.roadNodes, by = buildEdgesByNode(city.roadEdges), bad = [];
  const ground = makeRoadClearance((roads.userData.mapPaths || []).filter(p => p.structure !== 'bridge' && !(p.minY > 1.2)));
  const ends = []; segs.forEach((s, i) => { ends.push({ x: s.x1, z: s.z1, i, s }); ends.push({ x: s.x2, z: s.z2, i, s }); });
  const joined = a => ends.some(b => b.i !== a.i && Math.hypot(a.x - b.x, a.z - b.z) < 3.2);
  const nearestOther = a => { let d = 1e9, o = null; for (const b of ends) { if (b.i === a.i) continue; const q = Math.hypot(a.x - b.x, a.z - b.z); if (q < d) { d = q; o = b; } } return { d, o }; };
  // 1. a bend or straight join of two level, pavemented streets: every strip end near the node must meet another strip
  const seen = new Set();
  for (const id in N) {
    const es = by[id] || []; if (es.length !== 2 || !es.every(hasSidewalks)) continue;
    const o = e => N[e.from === id ? e.to : e.from];
    if (es.some(e => Math.abs((o(e).elevation || 0) - (N[id].elevation || 0)) > 0.01)) continue;     // ramps carry no pavement
    const near = ends.filter(a => Math.hypot(a.x - N[id].x, a.z - N[id].z) < 16 && (a.s.fromNode === id || a.s.toNode === id || a.s.edgeId === es[0].id || a.s.edgeId === es[1].id));
    near.forEach(a => { if (!joined(a)) { const k = id + ':' + Math.round(a.x / 4) + ',' + Math.round(a.z / 4); if (seen.has(k)) return; seen.add(k); bad.push('pavement of ' + a.s.edgeId + ' stops short at the bend/join of node ' + id + ' @' + r1(a.x) + ',' + r1(a.z)); } });
  }
  // 2. a junction corner: two strip ends a few units apart with no road between them must be joined (no notch of bare ground)
  ends.forEach(a => {
    if (ends.some(b => b.i !== a.i && Math.hypot(a.x - b.x, a.z - b.z) < 0.35)) return;            // this end already meets another strip: it is not loose
    const { d, o } = nearestOther(a); if (!o || d < 3.2 || d > 6) return;
    const far = a.x === a.s.x1 && a.z === a.s.z1 ? [a.s.x2, a.s.z2] : [a.s.x1, a.s.z1];
    if (Math.hypot(far[0] - o.x, far[1] - o.z) < 0.35) return;           // the strip itself runs on to that end: a long corner piece, not a notch
    const mid = [(a.x + o.x) / 2, (a.z + o.z) / 2];
    if (ground(mid[0], mid[1]) < -0.1) return;                            // a road lies between: that is a crossing, not a gap
    const k = 'c' + Math.round(mid[0] / 4) + ',' + Math.round(mid[1] / 4); if (seen.has(k)) return; seen.add(k);
    bad.push('a ' + r1(d) + ' u notch in the pavement round a corner @' + r1(mid[0]) + ',' + r1(mid[1]));
  });
  return { name: 'pavementgaps', count: segs.length + ' strips', bad };
}

// ---- river banks: they follow the water and never stick out at a corner of the river; the water is below street level -----------------------------------------
async function checkRiverBanks() {
  const { buildRiverBanks } = await imp('src/riverbanks.js');
  const { createRiverField, BANK_W, WATER_Y } = await imp('src/rivers.js');
  const field = createRiverField(city.rivers || []), { holes, group } = buildRiverBanks(city), bad = [];
  holes.forEach((ring, hi) => ring.forEach(([x, z]) => {
    const d = field.edgeDist(x, z);                                          // distance from the water's edge (negative = in the water)
    if (d > BANK_W + 1.2) bad.push('river hole ' + hi + ' has a corner ' + r1(d - BANK_W) + ' u past the bank (a spike) @' + r1(x) + ',' + r1(z));
  }));
  // the bank mesh: nothing above street level (no wall or spike standing up out of the ground), nothing wildly outside the banks
  group.traverse(o => { if (!o.isMesh || !o.geometry.attributes.position) return; const P = o.geometry.attributes.position; let up = 0, far = 0;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i); if (y > 0.12) up++; if (y > 0.02 && field.edgeDist(x, z) > BANK_W + 3) far++; }
    if (up) bad.push(up + ' bank vertices stand above street level'); if (far) bad.push(far + ' bank vertices stand up well away from any river (spikes)'); });
  const water = (city.parcels || []).filter(p => p.type === 'water' && p.river);
  if (!water.length && !process.env.CITY) bad.push('no river water parcels'); 
  return { name: 'riverbanks', count: holes.length + ' channel(s), ' + water.length + ' river water parcels (surface y=' + WATER_Y + ')', bad };
}

// ---- bridges and ramps have parapets a car cannot drive through or over -------------------------------------------------------------------------------------
async function checkBridgeWalls() {
  await world();
  const st = await structures(), { resolveCarCollisions } = await imp('src/collision.js'), { buildEdgesByNode, buildVerticalCurves, elevationAlongEdge } = await imp('src/roadMath.js');
  const N = city.roadNodes, by = buildEdgesByNode(city.roadEdges), vc = buildVerticalCurves(N, by), bad = [];
  const par = st.colliders.filter(c => c.parapet);
  let tested = 0, open = 0;
  city.roadEdges.forEach(e => {
    if (e.structure === 'tunnel' || e.drawbridge) return;
    const A = N[e.from], B = N[e.to], L = Math.hypot(B.x - A.x, B.z - A.z); if (L < 6 || Math.max(A.elevation, B.elevation) < 0.8) return;
    const ux = (B.x - A.x) / L, uz = (B.z - A.z) / L, hw = (e.width || 9) / 2;
    for (let s = 5; s < L - 5; s += 7) {
      const y = elevationAlongEdge(e, s, N, vc); if (y < 0.9) continue;
      if (((by[e.from] || []).length >= 3 && s < 18) || ((by[e.to] || []).length >= 3 && s > L - 18)) continue;     // a street joins: the barrier gives way
      for (const side of [1, -1]) {
        const x = A.x + ux * s - uz * (hw + 0.12) * side, z = A.z + uz * s + ux * (hw + 0.12) * side;
        // a car on the deck, pressed against the parapet from the road side, must be stopped: try to drive it outward through the wall line
        const car = { x: A.x + ux * s - uz * (hw - 0.6) * side, z: A.z + uz * s + ux * (hw - 0.6) * side, y, speed: 14, heading: Math.atan2(-uz * -side, ux * -side) };
        const wall = par.filter(c => c.edgeId === e.id && Math.hypot(c.ex - x, c.ez - z) < 4);
        tested++;
        if (!wall.length) { open++; if (bad.length < 40) bad.push('deck of edge ' + e.id + ' has no parapet on one side @' + r1(x) + ',' + r1(z) + ' (height ' + r1(y) + ')'); }
      }
    }
  });
  return { name: 'bridgewalls', count: par.length + ' parapet pieces, ' + tested + ' deck points tested', bad };
}

// ---- knocked-about AI cars collide with every obstacle (walls, buildings, parapets, props...) ------------------------------------------------------------------
async function checkObstacles() {
  await world();
  const { buildProps } = await imp('src/generators/props.js'), { buildSigns } = await imp('src/generators/signs.js');
  const { buildCollisionWorld } = await imp('src/collision.js'), { resolveKnockAgainstWorld } = await imp('src/aiCollide.js');
  const { buildParcels } = await imp('src/generators/parcels.js');
  const st = await structures();
  const props = buildProps(city).instances, signs = buildSigns(city, heightAt, roads.userData.mapPaths).instances, parcels = buildParcels(city).instances;
  const world2 = buildCollisionWorld(props.concat(signs), parcels).concat(st.colliders).filter(c => c.blocksCar && !c.destroyed);
  const bad = [], R = 1.0; let tested = 0, leaked = 0;
  // fire a free car at every sampled collider from outside, 14 u/s, and see that it never ends up inside
  const sample = world2.filter((c, i) => i % 7 === 0).slice(0, 900);
  for (const c of sample) {
    let cx, cz, hx, hz;
    if (c.kind === 'parcel') { if (!c.footprint) continue; cx = c.footprint.reduce((a, p) => a + p[0], 0) / c.footprint.length; cz = c.footprint.reduce((a, p) => a + p[1], 0) / c.footprint.length; hx = c.footprint[0][0]; hz = c.footprint[0][1]; }
    else { cx = c.x; cz = c.z; }
    const ang = (tested * 2.399) % (Math.PI * 2), y = c.ymin !== undefined ? c.ymin + 0.2 : (c.ymax !== undefined ? Math.max(0, c.ymax - 1) : 0.0);
    const k = { x: cx + Math.cos(ang) * 14, z: cz + Math.sin(ang) * 14, y, vx: -Math.cos(ang) * 14, vz: -Math.sin(ang) * 14, wy: 0 };
    const only = [c]; tested++;
    let inside = false;
    for (let f = 0; f < 60 && !inside; f++) {
      k.x += k.vx / 60; k.z += k.vz / 60; resolveKnockAgainstWorld(k, R, only);
      if (c.kind === 'parcel' ? pointInPolygon(k.x, k.z, c.footprint) : Math.hypot(k.x - c.x, k.z - c.z) < (c.radius || 0) * 0.6) inside = true;
    }
    if (inside) { leaked++; if (bad.length < 30) bad.push('a knocked car passed into a ' + (c.parapet ? 'parapet' : c.kind) + ' collider @' + r1(cx) + ',' + r1(cz)); }
  }
  if (!tested) bad.push('no colliders tested');
  return { name: 'obstacles', count: tested + ' colliders hit by a knocked car, ' + leaked + ' got through', bad };
}

// ---- every shop car park meets a street: lane, stop line and STOP sign are on clear ground ----------------------------------------------------------------------
async function checkLotGeo() {
  await world();
  const { lotGeometry } = await imp('src/lotGeo.js');
  const ground = makeRoadClearance((roads.userData.mapPaths || []).filter(p => p.structure !== 'bridge' && !(p.minY > 1.2)));
  const bad = [], all = (city.shops || []).concat((city.stations || []).filter(q => q.market)).filter(sh => sh.mouth && sh.door && sh.bays);
  all.forEach(sh => {
    const g = lotGeometry(city, sh), at = ' @' + r1(sh.mouth.x) + ',' + r1(sh.mouth.z);
    if (!g) { bad.push('car park ' + (sh.id || sh.kind) + ' has no street to join' + at); return; }
    const sg = g.stopSign;
    if (ground(sg.x, sg.z) < 0.5) bad.push('the STOP sign of car park ' + (sh.id || sh.kind) + ' stands on the road' + at);
    if (ground(g.T.x, g.T.z) < -0.2) bad.push('the stop line of car park ' + (sh.id || sh.kind) + ' lies on the road' + at);
    if (ground(g.lanePt(0).x, g.lanePt(0).z) > 0.3) bad.push('the kerb lane of car park ' + (sh.id || sh.kind) + ' is not on the road' + at);
    if (Math.hypot(g.T.x - sh.mouth.x, g.T.z - sh.mouth.z) > 12) bad.push('the stop line of car park ' + (sh.id || sh.kind) + ' is far from the mouth' + at);
  });
  // the shops' opening hours are well formed
  (city.stations || []).filter(q => q.market).forEach(q => { const h = q.info.hours; if (h !== '24/7' && !(Array.isArray(h) && h[0] >= 0 && h[1] <= 24 && h[0] < h[1])) bad.push('market ' + q.info.name + ' has bad opening hours'); });
  return { name: 'lotgeo', count: all.length + ' car parks', bad };
}

// ---- people walk into shop doors and storefronts and come out again ------------------------------------------------------------------------
async function checkDoors() {
  const { createPedestrianSystem } = await imp('src/pedestrians.js');
  const bad = [], ps = createPedestrianSystem(city, new THREE.Scene(), 150, 150);
  const sp = (city.gameplay || []).find(g => g.type === 'spawn') || { x: 0, z: 0 };
  const car = { x: sp.x, z: sp.z, y: 0, vx: 0, vz: 0, speed: 0 };
  for (let i = 0; i < 15 * 60 * 6; i++) { T += 66; ps.update(1 / 15, car); }
  let stuck = 0; ps.peds.forEach(p => { if (p.state === 'enter' && p.enter && p.enter.phase !== 1 && !Number.isFinite(p.renderX)) stuck++; if (!Number.isFinite(p.mesh.position.x)) { stuck++; if (process.env.DBGP) console.log('BADPED', p.state, JSON.stringify({ seg: p.seg && (p.seg.edgeId || p.seg.id), x: p.x, z: p.z, t: p.t, dir: p.dir })); } });
  if (stuck) bad.push(stuck + ' people at a bad position');
  if (!(ps.stats.entered > 0)) bad.push('nobody ever walked into a door');
  if (!(ps.stats.exited > 0)) bad.push('nobody ever came out of a door');
  return { name: 'doors', count: ps.entrances.length + ' doors, ' + ps.stats.entered + ' went in, ' + ps.stats.exited + ' came out', bad };
}

// race rivals: the cars that run a race route next to the traffic (this once threw every frame and froze the game at the start of a sprint)
async function checkRivals() {
  const { createTrafficSystem } = await imp('src/traffic.js'); const { buildTransit } = await imp('src/transit.js'); const { planRaces } = await imp('src/races.js');
  const bad = [], plan = planRaces(city, () => 'City').filter(r => r.kind !== 'drift');
  const tr = createTrafficSystem(city, new THREE.Scene(), heightAt, 25, 25, buildTransit(city));
  plan.forEach(r => {
    const pts = r.pts, cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const at = s => { s = Math.max(0, Math.min(cum[cum.length - 1], s)); let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const l = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / l, dx = (pts[i][0] - pts[i - 1][0]) / l, dz = (pts[i][1] - pts[i - 1][1]) / l; return { x: pts[i - 1][0] + dx * l * t, z: pts[i - 1][1] + dz * l * t, dx, dz }; };
    try {
      tr.clearRivals(); [0, 1, 2].forEach(i => tr.addRival({ sample: at, project: (x, z, h) => h, loop: false, total: r.length, vmax: 25, tau: 3, lat: i - 1, maxLat: 5, s0: -5 - i * 4 }));
      const player = { x: pts[0][0], z: pts[0][1], y: 0, heading: 0, speed: 0 };
      for (let k = 0; k < 15 * 40; k++) { T += 66; tr.update(1 / 15, player); }
    } catch (e) { bad.push(r.id + ' (' + r.kind + '): ' + e.message); }
  });
  tr.clearRivals();
  return { name: 'rivals', count: plan.length + ' routes', bad };
}
// ---- public transport: bus loops are legal, stops/stations stand on free ground, a custom line builds -------------------------------------
async function checkTransit() {
  const { buildTransit } = await imp('src/transit.js');
  const bad = [], t = buildTransit(city);
  if (t.lines.length < 3) bad.push('only ' + t.lines.length + ' bus lines');
  if (!t.metro.lines.length) bad.push('no metro line');
  t.metro.lines.forEach(l => {
    if (l.stations.length < 3) bad.push(l.name + ' has only ' + l.stations.length + ' stations');
    l.stations.forEach(st => {
      const fx = Math.cos(st.h), fz = Math.sin(st.h), rx = -fz, rz = fx;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
        const x = st.x + rx * 3.1 * a + fx * 2.6 * b, z = st.z + rz * 3.1 * a + fz * 2.6 * b;
        if (city.parcels.some(p => (p.type === 'building') && p.footprint && pointInPolygon(x, z, p.footprint))) { bad.push(st.name + ' station overlaps a building'); break; }
        const near = city.roadEdges.some(e => { const A = city.roadNodes[e.from], B = city.roadNodes[e.to]; if (!A || !B) return false; const dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / l2)); return Math.hypot(x - A.x - dx * u, z - A.z - dz * u) < (e.width || 10) / 2 + 1; });
        if (near) { bad.push(st.name + ' station stands on a road'); break; }
      }
    });
  });
  // a custom bus line + metro line (built from the first generated line's stops) must build
  const L = t.lines[0].stops, pick = [0, 1, 2].map(i => L[i % L.length]);
  const t2 = buildTransit(city, { bus: [{ name: 'T', stops: pick.map(s => [s.x, s.z]) }], metro: [{ name: 'M', stations: [0, 3].map(i => ({ at: [L[i % L.length].x, L[i % L.length].z] })) }] });
  if (!t2.lines.length || !t2.lines[0].custom) bad.push('a custom bus line did not build');
  if (!t2.metro.lines.length) bad.push('a custom metro line did not build');
  return { name: 'transit', count: t.lines.length + ' bus lines, ' + t.stops.length + ' stops, ' + t.metro.lines.map(l => l.stations.length).join('+') + ' metro stations', bad };
}
// ---- the road out of town (outroads.js): it exists, joins the city, stays clear of the pocket worlds, and both tunnel mouths are open ---------
async function checkOutroad() {
  const io = city.interstate, bad = [];
  if (!io) return { name: 'outroad', count: 'no road out of town in this city', bad };
  (city.warnings || []).filter(w => /road out of town/.test(w)).forEach(w => bad.push(w));
  const xs = io.pts.map(p => p[0]);
  if (Math.max(...xs) > 3700 || Math.min(...xs) < -5500) bad.push('runs into the pocket worlds: keep world x between -5500 and 3700 (now ' + r1(Math.min(...xs)) + ' .. ' + r1(Math.max(...xs)) + ')');
  if (io.total - io.start < 1500) bad.push('only ' + r1(io.total - io.start) + ' u of open road');
  const N = city.roadNodes, M = io.mouth, rx = -M.dz, rz = M.dx;
  // a carriageway vertex right at each mouth, and the hidden loop behind them joins the two (the `connected` check covers the rest)
  [1, -1].forEach(f => { const x = M.x + rx * io.off * f, z = M.z + rz * io.off * f; if (!Object.values(N).some(n => Math.hypot(n.x - x, n.z - z) < 4)) bad.push('no road at the ' + (f > 0 ? 'outbound' : 'inbound') + ' tunnel mouth'); });
  const lamps = (city.props || []).filter(p => p.type === 'light' && p.twin).length;
  return { name: 'outroad', count: r1(io.total * 1.25 / 1000) + ' km to ' + io.to + ', ' + lamps + ' median lamps', bad };
}

// ---- stop signs behave like real life: stop, take turns, don't block the junction -------------------------------------------------------
// Runs the AI on its own and watches every junction that has stop signs. Per car it notes when it came to rest at the line (arrival) and when it
// drove into the box. Counted: rolled stops (entered without ever stopping), out-of-turn entries at all-way stops (someone who stopped earlier
// on another approach was still waiting), box conflicts (two cars from different approaches within 2.2 u inside one junction), waits.
async function checkStops(cars = +process.argv[3] || 90, minutes = +process.argv[4] || 6) {
  { let a = (+process.env.SEED || 1) >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }   // seeded, so before/after runs see the same city and the same cars
  const { createTrafficSystem } = await imp('src/traffic.js');
  const { computeStopApproaches, stopKey } = await imp('src/junctionRules.js');
  const { stops, allWay } = computeStopApproaches(city);
  const dt = 1 / 15, tr = createTrafficSystem(city, new THREE.Scene(), heightAt, cars, cars, null);
  const player = { x: 9999, z: 9999, y: 0, heading: 0, speed: 0 };
  const st = new Map(), waits = [], bad = [];
  let entries = 0, rolled = 0, outOfTurn = 0, conflicts = 0, carSec = 0, stuckAtStop = 0, travelled = 0, passedAll = 0;
  const waiting = new Map();                 // nodeId -> Map(car -> arrival time)
  const seenConf = new Set();
  for (let k = 0; k < 15 * 60 * minutes; k++) {
    T += dt * 1000; tr.update(dt, player); const t = T / 1000;
    const inBox = new Map();
    tr.cars.forEach((c, i) => {
      if (!c.active || !c.edge || c.ghost > 0 || c.crashTimer > 0 || c.knock || c.siren) return;
      carSec += dt; travelled += c.speed * dt;
      const S = st.get(i) || st.set(i, { edge: null, arr: null, stopped: false, inConn: false, lastWait: 0 }).get(i);
      if (S.edge !== c.edge) { S.edge = c.edge; S.arr = null; S.stopped = false; S.inConn = false; }
      const key = stopKey(c.to, c.edge.id), isStop = stops.has(key);
      if (process.env.DBG) { (S.h || (S.h = [])).push([c.edge.id, +(c.path ? c.path.length - c.s : 0).toFixed(1), +c.speed.toFixed(2), c.stopCleared ? 1 : 0, c.why, c.conn ? 'C' : '']); if (S.h.length > 40) S.h.shift(); }
      if (!c.conn && c.path && c.path.length - c.s < 26) S.minSp = Math.min(S.minSp ?? 99, c.speed); if (S.edge !== c.edge) S.minSp = undefined;
      if (!c.conn && isStop) {
        const d = c.len_ !== undefined ? 0 : 0;
        const toNode = c.path ? c.path.length - c.s : 99; // the line is clearance+3.7 before the node (up to ~20 u on avenues)
        if (toNode < 26 && c.speed < 0.45 && S.arr == null) { S.arr = t; S.stopped = true; (waiting.get(c.to) || waiting.set(c.to, new Map()).get(c.to)).set(i, t); }
        if (toNode < 26 && S.arr != null && c.speed < 0.45) { S.lastWait = t - S.arr; if (S.lastWait > 45) { stuckAtStop++; S.arr = t - 1; } }
      }
      if (c.conn) {
        const node = c.to;
        (inBox.get(node) || inBox.set(node, []).get(node)).push({ c, i });
        if (!S.inConn) {
          S.inConn = true;
          if (isStop) {
            entries++;
            if (!S.stopped && !c.siren) { rolled++; if (process.env.DBG && rolled < 3) console.log(JSON.stringify(S.h.filter((_, q) => q % 3 === 0)), 'rolled', i, c.edge.id, 'speed', c.speed.toFixed(2), 'why', c.why, 'cleared', c.stopCleared, 'toNode', (c.path.length - c.s).toFixed(1), 'minSp', (S.minSp ?? -1).toFixed(2), 'type', c.type); }
            else { waits.push(t - S.arr); if (process.env.DBG && t - S.arr > 25) console.log('LONG wait', (t - S.arr).toFixed(0), 'car', i, 'node', c.to, 'edge', c.edge.id, 'at t', t.toFixed(0), 'type', c.type, 'dwell', (c.dwell||0).toFixed(1)); }
            if (allWay.has(node)) {
              passedAll++;
              const w = waiting.get(node);
              if (w) for (const [j, ta] of w) if (j !== i && ta < S.arr - 0.6 && !tr.cars[j].conn && tr.cars[j].active && tr.cars[j].to === node && tr.cars[j].from !== c.from && tr.pathsConflict(c, tr.cars[j])) { outOfTurn++; break; }
            }
            const w2 = waiting.get(node); if (w2) w2.delete(i);
          }
        }
      } else S.inConn = false;
    });
    for (const [node, list] of inBox) if (list.length > 1) {
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        const A = list[a], B = list[b];
        if (A.c.from === B.c.from) continue;
        if (Math.hypot(A.c.collider.x - B.c.collider.x, A.c.collider.z - B.c.collider.z) < 2.2) { const key = node + ':' + Math.min(A.i, B.i) + ':' + Math.max(A.i, B.i) + ':' + Math.floor(t / 4); if (!seenConf.has(key)) { seenConf.add(key); conflicts++; } }
      }
    }
  }
  waits.sort((a, b) => a - b);
  const avg = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0, p95 = waits.length ? waits[Math.floor(waits.length * 0.95)] : 0, mx = waits.length ? waits[waits.length - 1] : 0;
  const per = n => entries ? Math.round(n / entries * 1000) / 10 : 0;
  const summary = cars + ' cars, ' + minutes + ' min: ' + entries + ' stop-sign entries (' + (entries / minutes).toFixed(1) + '/min), rolled stops ' + rolled + ' (' + per(rolled) + ' %), out of turn at all-way stops ' + outOfTurn + ' of ' + passedAll + ', box conflicts ' + conflicts + ', wait avg ' + avg.toFixed(1) + ' s / p95 ' + p95.toFixed(1) + ' s / max ' + mx.toFixed(1) + ' s, waits >45 s ' + stuckAtStop + ', avg speed ' + (travelled / carSec).toFixed(2) + ' u/s';
  if (process.env.STOPS_BASELINE) return { name: 'stops', count: summary, bad };
  if (entries < 20) bad.push('too few stop-sign entries (' + entries + ') to judge');
  if (rolled > entries * 0.03) bad.push('cars rolled through ' + rolled + ' stop signs without stopping');
  if (passedAll && outOfTurn > passedAll * 0.05) bad.push(outOfTurn + ' of ' + passedAll + ' all-way entries were out of turn');
  if (conflicts > entries * 0.02) bad.push(conflicts + ' box conflicts');
  if (stuckAtStop) bad.push(stuckAtStop + ' cars waited >45 s at a stop sign');
  return { name: 'stops', count: summary, bad };
}
// ---- the radio songs (songs.js): every song builds, runs 2.5-5 minutes, keeps its melody in range and mostly by step, has a bass register --------
async function checkSongs() {
  const { SONGS, buildPlan, noteName } = await imp('src/songs.js'), bad = [], names = new Set();
  for (const P of SONGS) {
    const pl = buildPlan(P), dur = pl.bars.length * pl.barSec; let prev = null, leaps = 0, n = 0, lens = new Set();
    if (names.has(P.name)) bad.push('two songs called ' + P.name); names.add(P.name);
    if (/runescape|varrock|falador|wilderness/i.test(P.name)) bad.push(P.name + ': a game reference in the title');
    if (dur < 150 || dur > 330) bad.push(P.name + ' runs ' + Math.round(dur) + ' s');
    pl.bars.forEach(b => b.mel.forEach((m, i) => {
      n++; lens.add(m.len); if (!(m.midi >= 60 && m.midi <= 90)) bad.push(P.name + ': melody note out of range ' + m.midi);
      if (prev != null && i > 0 && b.sec !== 'bridge' && b.sec !== 'outro' && Math.abs(m.midi - prev) > 9) leaps++; prev = m.midi;
    }));
    if (P.melody && n < 60) bad.push(P.name + ' has only ' + n + ' melody notes');
    if (P.melody && lens.size < 4) bad.push(P.name + ' uses only ' + lens.size + ' note lengths');
    if (leaps > 3) bad.push(P.name + ' has ' + leaps + ' big leaps');
    if (!pl.bars.some(b => b.kick) && P.style !== 'lowkey') bad.push(P.name + ' never plays the kick');
  }
  const styles = ['neon', 'lowkey', 'cruise'].map(k => SONGS.filter(s => s.style === k).length);
  if (Math.min(...styles) < 6) bad.push('a station has fewer than 6 songs: ' + styles.join('/'));
  return { name: 'songs', count: SONGS.length + ' songs (' + styles.join('/') + ' per station), ' + SONGS.filter(s => !s.melody).length + ' instrumental grooves', bad };
}

const CHECKS = { songs: checkSongs,  stops: checkStops,  outroad: checkOutroad, transit: checkTransit, rivals: checkRivals, sidewalks: checkSidewalks, gas: checkGas, races: checkRaces, drift: checkDrift, covered: checkCovered,  signs: checkSigns, signfacing: checkSignFacing, lamps: checkLamps, buildings: checkBuildings, traffic: () => checkTraffic(+process.argv[3] || 40, +process.argv[4] || 5), markings: checkMarkings, bridges: checkBridges, solid: checkSolid, water: checkWater, rules: checkRules, driveways: checkDriveways, smooth: checkSmooth, mesh: checkMesh, pavement: checkPavement, connected: checkConnected, lots: checkLots, doors: checkDoors, pavementgaps: checkPavementGaps, riverbanks: checkRiverBanks, bridgewalls: checkBridgeWalls, obstacles: checkObstacles, lotgeo: checkLotGeo };
// groups: run several related checks at once
const GROUPS = {
  placement: ['signs', 'signfacing', 'lamps', 'driveways', 'buildings', 'pavement', 'sidewalks', 'pavementgaps', 'lotgeo'],   // nothing stands where it shouldn't
  roads: ['markings', 'bridges', 'bridgewalls', 'riverbanks', 'water', 'smooth', 'mesh', 'connected', 'rules'],    // road geometry and connections
  quick: ['placement', 'roads', 'gas', 'transit', 'drift', 'covered', 'outroad', 'songs'],                           // all static checks, seconds
  sim: ['traffic', 'stops', 'solid', 'obstacles', 'rivals', 'races', 'lots', 'doors'],                                       // simulations, minutes
  all: ['quick', 'sim']
};
const expand = n => GROUPS[n] ? GROUPS[n].flatMap(expand) : [n];
const which = process.argv[2] || 'all';
const list = [...new Set(which.split(',').flatMap(expand))];
let failed = 0;
for (const k of list) {
  if (!CHECKS[k]) { console.log('unknown check', k, '- try', Object.keys(CHECKS).join(', ')); process.exit(2); }
  const r = await CHECKS[k]();
  console.log((r.bad.length ? 'FAIL ' : 'PASS ') + r.name + ' - ' + r.count + (r.bad.length ? ' (' + r.bad.length + ' problems)' : ''));
  if (r.bad.length > 40) {
    const tally = {}; r.bad.forEach(b => { const k = b.replace(/@[-\d.,]+/, '').replace(/[-\d.]+/g, '#'); tally[k] = (tally[k] || 0) + 1; });
    Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, n]) => console.log('   ~ ' + n + 'x ' + k));
  }
  r.bad.slice(0, process.env.ALL ? 9999 : 40).forEach(b => console.log('   - ' + b));
  if (r.bad.length) failed++;
}
process.exit(failed ? 1 : 0);
