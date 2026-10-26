// Gridlock Blocks checks. Run on request:
//   node tools/check.mjs signs      road signs sit beside the road, not on it
//   node tools/check.mjs lamps      lamp posts / props sit beside the road, near it, not in buildings
//   node tools/check.mjs buildings  no building footprint overlaps a road surface
//   node tools/check.mjs traffic [cars=40] [minutes=5]   AI traffic simulation: nothing gets stuck
//   node tools/check.mjs markings   painted lines, crosswalks and stop lines never cross or overlap another road's paint
//   node tools/check.mjs bridges    no bridge pillar stands in a lane; low ramps have walls; freeway lanes are clear
//   node tools/check.mjs solid      every object a car can see is solid (and a rammed collider really stops the car)
//   node tools/check.mjs water      no road surface lies under water without a bridge
//   node tools/check.mjs drift      the three drift circuits: corner radius, walls, start
//   node tools/check.mjs all
// Exit code 1 if anything fails. Add new checks to CHECKS below.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = p => import(pathToFileURL(path.join(root, p)).href);

// minimal canvas stub so texture-building code runs under node
const ctx2d = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient') ? () => ({ addColorStop() {} }) : (typeof k === 'string' && k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => ctx2d, width: 0, height: 0, style: {} }) };
let T = 0; performance.now = () => T;

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
    else if (d > 8 && i.type !== 'gantry') bad.push(what + ' is ' + r1(d) + ' away from any road');
    if (inBuilding(i.x, i.z)) bad.push(what + ' is inside a building');
  });
  return { name: 'signs', count: signs.instances.length, bad };
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
  const { buildTransit } = await imp('src/transit.js'); const transit = buildTransit(city);
  const dt = 1 / 15, tr = createTrafficSystem(city, new THREE.Scene(), heightAt, cars, cars, transit);
  const player = { x: 9999, z: 9999, y: 0, heading: 0, speed: 0 };
  const still = new Map(), seen = new Map(); let longest = 0, overlaps = 0, ghosts = 0;
  const bad = [], lanes = [0, 0, 0], changes = { n: 0 }, offLine = new Set(), busSeen = new Map(), stopsServed = new Set();
  for (let k = 0; k < 15 * 60 * minutes; k++) {
    T += dt * 1000; tr.update(dt, player);
    if (k % 15 === 0) tr.cars.forEach(c => { if (c.active && c.edge && c.edge.type === 'highway' && c.lanes === 3 && !c.conn) lanes[c.laneIndex]++; });
    tr.cars.forEach((c, i) => {
      if (!c.active) return;
      if (c.speed < 0.05 && c.crashTimer <= 0) {
        const v = (still.get(i) || 0) + dt; still.set(i, v); longest = Math.max(longest, v);
        if (v > 25 && !seen.has(i + ':' + c.to)) { seen.set(i + ':' + c.to, 1); bad.push('car ' + i + ' (' + c.type + ') stuck >25 s on edge ' + c.edge.id + ' toward ' + c.to + ' (' + c.why + ')'); }
      } else still.set(i, 0);
      if (c.ghost > 6.9) ghosts++;
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
  if (tot > 40 && lanes[2] / tot < 0.55) bad.push('highway traffic should keep right: lane shares left/middle/right = ' + lanes.map(v => Math.round(v / tot * 100)).join('/') + ' %');
  return { name: 'traffic', count: cars + ' cars, ' + minutes + ' min (longest stop ' + Math.round(longest) + ' s, ghost frames ' + ghosts + ', overlap samples ' + overlaps + ', highway lanes L/M/R ' + lanes.join('/') + '; ' + transit.lines.length + ' bus lines, ' + lineBuses + ' buses, ' + stopsServed.size + ' stops served, ' + transit.stops.length + ' stops, ' + transit.stands.length + ' cab stands)', bad };
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
  if (!median.length) bad.push('no median pillar found for the freeway crossings');
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
async function checkWater() {
  const { RIVERS, LAKE_N, LAKE_S } = await imp('src/chicago/map.js');
  const { nearestOnPoly, pointInPoly } = await imp('src/chicago/geom.js');
  const wet = (x, z) => pointInPoly(x, z, LAKE_N) || pointInPoly(x, z, LAKE_S) || RIVERS.some(r => nearestOnPoly(x, z, r.pts).d < r.half - 0.5);
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

// drift circuits: corners wide enough to drift (radius >= 35 u), walls clear of the road, tracks far from each other and from the city
async function checkDrift() {
  const { createDriftTracks } = await imp('src/driftTrack.js');
  const d = createDriftTracks({ scene: new THREE.Scene() }), bad = [];
  d.tracks.forEach(t => {
    if (t.minR < 35) bad.push(t.id + ' tightest corner ' + t.minR + ' u');
    let close = 0; t.wall.forEach(w => { if (t.distFrom(w.x, w.z) < t.width / 2 + 3) close++; }); if (close) bad.push(t.id + ': ' + close + ' wall posts inside the track');
    if (t.length < 700 || t.length > 2200) bad.push(t.id + ' lap ' + t.length + ' m');
    if (d.heightAt(t.pts[0][0], t.pts[0][1]) !== 0 || d.heightAt.kind !== 'road') bad.push(t.id + ' start is not road');
  });
  return { name: 'drift', count: d.tracks.length + ' circuits', bad };
}
const CHECKS = { drift: checkDrift, covered: checkCovered,  signs: checkSigns, lamps: checkLamps, buildings: checkBuildings, traffic: () => checkTraffic(+process.argv[3] || 40, +process.argv[4] || 5), markings: checkMarkings, bridges: checkBridges, solid: checkSolid, water: checkWater };
const which = process.argv[2] || 'all';
const list = which === 'all' ? Object.keys(CHECKS) : [which];
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
