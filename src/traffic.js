// AI traffic: a handful of cars that drive the same road graph the player does,
// stopping for red signals and slowing for whatever's physically ahead of them. No real
// vehicle physics — each car advances a distance `s` along a precomputed centerline path
// for its current edge. That path follows the same spiral-arc-spiral corner curves
// roads.js draws (via roadMath.js's buildHorizontalCurve) rather than cutting straight
// from node to node, which matters now that highway bends are wide, sweeping ones — a
// straight lerp would drive 25 units off the road at each corner.
//
// Coordinate convention note: `heading` in this file is `Math.atan2(dz, dx)` — the
// ordinary math-angle convention, where the forward direction is `(cos h, sin h)` and
// "right of travel" (US-style right-hand traffic) is `(sin h, -cos h)`. That's the
// same convention roads.js/sidewalks.js use for their perpX/perpZ. It is *not* the
// same convention car.js uses for the player's own heading, where forward is
// `(sin h, cos h)` instead — the two files just happen to both use a variable named
// `heading` for different angle origins. Mixing the two up here (treating this file's
// heading as if it were car.js's) is what previously put AI traffic in the middle of
// the road instead of its lane, and made the "something's ahead of me" check look at
// the wrong cone entirely.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildEdgesByNode, intersectionClearance, buildHorizontalCurve } from './roadMath.js';
import { findSignalForApproach, phaseAt } from './signals.js';
import { computeStopApproaches, stopKey, roadRank } from './junctionRules.js';
import { createGroundGlow, createHalo, setGlow } from './glow.js';

function dist(x1, z1, x2, z2) { return Math.hypot(x1 - x2, z1 - z2); }

// Wraps an angle into (-PI, PI] — needed wherever a heading difference is computed,
// since a raw subtraction can come back as e.g. -359° instead of +1° right at the wrap.
function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Cruising speeds in world units/s; the HUD shows units*6.2 as km/h, so these sit just under
// the posted limits of 40 / 60 / 100 (see junctionRules.js).
const typeSpeed = { local: 6.3, avenue: 9.5, highway: 15.8 };
const bodyColors = [0x3a6ea5, 0x8a8a8a, 0x5a9e5a, 0xb5543a, 0xcac35a, 0x6a4a8a];

import { bodyLift } from './bodyLift.js';
import { addServiceGear, SERVICE_BASE, SERVICE_COLOR, isService } from './serviceVehicles.js';
import { buildTrafficBody, TRAFFIC_DIMS } from './vehicleModels.js';

// Vehicle classes: size, weight, how fast they cruise relative to the road's pace, how hard
// they accelerate / brake (units/s^2), and the circles that make up their collision shape
// (offsets along the vehicle, so buses and trucks are not one big round blob).
const VEH = {
  sedan: { mass: 1300, speedMul: 1.0,  accel: 3.4, brake: 13,  circles: [-0.75, 0.75], r: 1.0 },
  taxi:  { mass: 1500, speedMul: 1.1,  accel: 3.8, brake: 13,  circles: [-0.75, 0.75], r: 1.02 },
  van:   { mass: 2400, speedMul: 0.92, accel: 2.6, brake: 11,  circles: [-1.3, 1.3], r: 1.1 },
  truck: { mass: 7500, speedMul: 0.8,  accel: 1.5, brake: 8.5, circles: [-2.6, 0, 2.6], r: 1.3 },
  bus:   { mass: 11000, speedMul: 0.74, accel: 1.7, brake: 9,  circles: [-3.8, -1.3, 1.3, 3.8], r: 1.4 },
  police:    { mass: 1700, speedMul: 1.2,  accel: 4.6, brake: 14, circles: [-0.75, 0.75], r: 1.0 },
  ambulance: { mass: 2900, speedMul: 1.12, accel: 3.4, brake: 12, circles: [-1.3, 1.3], r: 1.1 },
  fire:      { mass: 9000, speedMul: 1.0,  accel: 2.2, brake: 9,  circles: [-2.6, 0, 2.6], r: 1.3 },
  plow:      { mass: 8500, speedMul: 0.5,  accel: 1.6, brake: 9,  circles: [-2.6, 0, 2.6], r: 1.3 }
};
// mix that repeats down the pool so any density slider position gets a believable blend
const TYPE_CYCLE = ['sedan', 'sedan', 'taxi', 'sedan', 'van', 'sedan', 'bus', 'sedan', 'truck', 'sedan', 'taxi', 'van', 'sedan', 'sedan', 'truck', 'bus'];

function trafficCarMesh(svcType, color) {
  const g = new THREE.Group();
  const type = SERVICE_BASE[svcType] || svcType;      // a police car is built on the sedan body, a plough on the truck...
  const body = buildTrafficBody(type, isService(svcType) ? SERVICE_COLOR[svcType] : color);
  g.add(body);
  const d = body.userData.dims || TRAFFIC_DIMS[type];
  const hl = d.len / 2;
  const hw = d.wid / 2 - 0.3;
  const lampY = type === 'bus' ? 0.9 : type === 'truck' ? 0.85 : 0.52;
  const headMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0xfff2c8, emissiveIntensity: 1.1 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0xff2a2a, emissiveIntensity: 1.0 });
  const hGeo = new THREE.BoxGeometry(0.22, 0.14, 0.05), tGeo = new THREE.BoxGeometry(0.2, 0.14, 0.05);
  [-1, 1].forEach(sx => {
    const h = new THREE.Mesh(hGeo, headMat); h.position.set(sx * hw, lampY, hl + 0.02); g.add(h);
    const t = new THREE.Mesh(tGeo, tailMat); t.position.set(sx * hw, lampY + 0.05, -hl - 0.02); g.add(t);
  });
  // Light spilling onto the road: a pool ahead of the headlights, a red one behind the
  // taillights that brightens when braking (driven per frame; real THREE.Lights per car
  // would cost far too much).
  const headPool = createGroundGlow(0xfff0c8, 5.2, 10);
  headPool.position.set(0, 0.07, hl + 5.4);
  const tailPool = createGroundGlow(0xff2a1a, 3.4, 2.6);
  tailPool.position.set(0, 0.07, -hl - 1.3);
  const tailHalos = [-hw, hw].map(x => { const h = createHalo(0xff2a1a, 1.3); h.position.set(x, lampY + 0.05, -hl - 0.1); g.add(h); return h; });
  // Hazard lights: an amber lamp + bloom at each corner, flashed together after a crash.
  const hazardMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0xffa726, emissiveIntensity: 0 });
  const hazardHalos = [];
  [[-hw - 0.1, hl], [hw + 0.1, hl], [-hw - 0.1, -hl], [hw + 0.1, -hl]].forEach(([x, z]) => {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.06), hazardMat);
    lamp.position.set(x, lampY - 0.02, z); g.add(lamp);
    const h = createHalo(0xffa726, 1.3); h.position.set(x, lampY - 0.02, z + Math.sign(z) * 0.1); g.add(h);
    hazardHalos.push(h);
  });
  g.add(headPool, tailPool);
  g.userData.hazardMat = hazardMat;
  g.userData.hazardHalos = hazardHalos;
  g.userData.wheels = body.userData.wheels;
  g.userData.wheelR = body.userData.wheelR || 0.4;
  g.userData.headPool = headPool;
  g.userData.tailPool = tailPool;
  g.userData.tailHalos = tailHalos;
  g.userData.tailMat = tailMat;
  g.userData.dims = d;
  if (isService(svcType)) { g.userData.svc = addServiceGear(g, svcType, d); }
  // LOD: everything above moves into `full`; a single-draw-call box model (`lite`) stands in for the car when it is far from the player
  const full = new THREE.Group(); while (g.children.length) full.add(g.children[0]); g.add(full);
  const lite = new THREE.Mesh(liteGeo(type, d), new THREE.MeshStandardMaterial({ color: isService(svcType) ? SERVICE_COLOR[svcType] : color, roughness: 0.6, metalness: 0.3 }));
  lite.visible = false; g.add(lite);
  g.userData.full = full; g.userData.lite = lite;
  return g;
}
const _liteCache = {};
function liteGeo(type, d) {
  if (_liteCache[type]) return _liteCache[type];
  const box = (w, h, l, y, z) => { const b = new THREE.BoxGeometry(w, h, l); b.translate(0, y, z); return b.toNonIndexed(); };
  let parts;
  if (type === 'bus') parts = [box(d.wid, 2.5, d.len, 1.65, 0)];
  else if (type === 'truck') parts = [box(d.wid * 0.9, 0.7, d.len, 0.8, 0), box(d.wid, 2.3, d.len * 0.65, 1.9, -d.len * 0.15), box(d.wid, 1.5, d.len * 0.25, 1.4, d.len * 0.36)];
  else if (type === 'van') parts = [box(d.wid, 1.5, d.len, 1.1, 0), box(d.wid * 0.95, 0.5, d.len * 0.5, 1.9, -d.len * 0.12)];
  else parts = [box(d.wid, 0.75, d.len, 0.65, 0), box(d.wid * 0.9, 0.5, d.len * 0.5, 1.2, -d.len * 0.08)];
  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return (_liteCache[type] = merged);
}

export function createTrafficSystem(cityData, scene, heightAt, count = 6, maxCount = count, transit = null) {
  const events = [];   // sound cues for main.js to drain each frame ({t:'honk', x, z, type, seed, angry})
  const nodes = cityData.roadNodes || {};
  const edgesByNode = buildEdgesByNode(cityData.roadEdges || []);
  const drivable = cityData.roadEdges || [];
  // Buses and trucks are too long to take a 9 m side street's corners, so they stay on avenues
  // and highways (spawn there, and prefer those roads at every junction).
  const isWide = e => e.type !== 'local';
  const wideEdges = drivable.filter(isWide);
  const edgeFor = type => {
    const heavy = type === 'bus' || type === 'truck' || type === 'fire' || type === 'plow';
    const list = heavy && wideEdges.length ? wideEdges : drivable;
    return list[Math.floor(Math.random() * list.length)];
  };

  const cars = [];

  function otherEnd(edge, nodeId) { return edge.from === nodeId ? edge.to : edge.from; }

  // --- Road centerline paths ---------------------------------------------------------
  // A car traveling an edge from F to T follows: the half of F's corner curve that lies
  // on this edge's side, the straight run, then the half of T's corner curve on this
  // edge's side. Consecutive edges meet at the same curve sample (both use the same
  // midpoint index), so the hand-over between edges is seamless.
  const curveInfo = {};
  for (const id in nodes) {
    const c = buildHorizontalCurve(id, nodes, edgesByNode);
    if (c) curveInfo[id] = c;
  }
  const pathCache = new Map();
  function curveHalf(nodeId, otherId, arriving) {
    const c = curveInfo[nodeId];
    if (!c) return [];
    const m = Math.round((c.samples.length - 1) / 2);
    const towardFirst = otherId === c.otherIds[0];
    // samples run TS (otherIds[0] side) -> ST (otherIds[1] side)
    let half = towardFirst ? c.samples.slice(0, m + 1) : c.samples.slice(m);
    // leaving the node: apex -> far end of the half; arriving: far end -> apex
    const apexFirst = towardFirst ? false : true; // slice(0,m+1) ends at the apex; slice(m) starts at it
    const leaving = !arriving;
    if (leaving !== apexFirst) half = half.slice().reverse();
    return half.map(p => ({ x: p.x, z: p.z }));
  }
  function pathFor(edge, from, to) {
    const key = edge.id + ':' + from;
    if (pathCache.has(key)) return pathCache.get(key);
    const A = nodes[from], B = nodes[to];
    const full = Math.max(0.01, dist(A.x, A.z, B.x, B.z));
    const dx = (B.x - A.x) / full, dz = (B.z - A.z) / full;
    const trimF = curveInfo[from] ? curveInfo[from].trim : 0;
    const trimT = curveInfo[to] ? curveInfo[to].trim : 0;
    const raw = [];
    curveHalf(from, to, false).forEach(p => raw.push(p));
    if (trimF + trimT < full - 0.5) {
      raw.push({ x: A.x + dx * trimF, z: A.z + dz * trimF });
      raw.push({ x: B.x - dx * trimT, z: B.z - dz * trimT });
    }
    curveHalf(to, from, true).forEach(p => raw.push(p));
    if (raw.length === 0) { raw.push({ x: A.x, z: A.z }, { x: B.x, z: B.z }); }
    // drop near-duplicate points so every segment has a usable direction
    const pts = [];
    raw.forEach(p => {
      const last = pts[pts.length - 1];
      if (!last || dist(last.x, last.z, p.x, p.z) > 0.05) pts.push({ x: p.x, z: p.z });
    });
    if (pts.length === 1) pts.push({ x: pts[0].x + dx * 0.1, z: pts[0].z + dz * 0.1 });
    let acc = 0;
    pts[0].cum = 0;
    for (let i = 1; i < pts.length; i++) { acc += dist(pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z); pts[i].cum = acc; }
    // Smoothed vertex headings + curvature, so heading and lane offset vary continuously
    // along the polyline instead of jumping at every vertex (that jump was the visible
    // "not quite smooth" turning).
    const n = pts.length, seg = [], segLen = [];
    for (let i = 1; i < n; i++) {
      seg[i] = Math.atan2(pts[i].z - pts[i - 1].z, pts[i].x - pts[i - 1].x);
      segLen[i] = Math.max(1e-6, pts[i].cum - pts[i - 1].cum);
    }
    const curv = new Array(n).fill(0);
    pts.forEach((p, i) => {
      if (i === 0) p.hdg = seg[1];
      else if (i === n - 1) p.hdg = seg[n - 1];
      else {
        p.hdg = seg[i] + normalizeAngle(seg[i + 1] - seg[i]) / 2;
        curv[i] = Math.abs(normalizeAngle(seg[i + 1] - seg[i])) / ((segLen[i] + segLen[i + 1]) / 2);
      }
    });
    const path = { pts, length: acc, curv };
    pathCache.set(key, path);
    return path;
  }
  // Centerline position + travel heading (atan2(dz,dx) convention) at distance s. The heading
  // is the segment's own direction, blended toward the smoothed vertex heading near each end
  // of the segment, so it is continuous across vertices.
  function sampleAt(path, s) {
    const pts = path.pts;
    s = Math.max(0, Math.min(path.length, s));
    let i = 1;
    while (i < pts.length - 1 && pts[i].cum < s) i++;
    const p0 = pts[i - 1], p1 = pts[i];
    const L = Math.max(1e-6, p1.cum - p0.cum);
    const u = Math.max(0, Math.min(1, (s - p0.cum) / L));
    const segH = Math.atan2(p1.z - p0.z, p1.x - p0.x);
    const r = Math.min(3, L / 2), d0 = u * L, d1 = L - d0;
    let h = segH;
    if (d0 < r) h += normalizeAngle(p0.hdg - segH) * (1 - d0 / r);
    if (d1 < r) h += normalizeAngle(p1.hdg - segH) * (1 - d1 / r);
    return { x: p0.x + (p1.x - p0.x) * u, z: p0.z + (p1.z - p0.z) * u, heading: h, idx: i };
  }
  // Fastest sensible speed for the bends just ahead (lateral acceleration limit).
  const LAT_ACC = 6.5;
  function curveCap(path, idx, s, speed) {
    const look = 5 + speed * 0.7;
    let k = Math.max(path.curv[idx - 1] || 0, path.curv[idx] || 0);
    for (let j = idx + 1; j < path.pts.length && path.pts[j].cum <= s + look; j++) k = Math.max(k, path.curv[j]);
    return k > 1e-3 ? Math.max(3.5, Math.sqrt(LAT_ACC / k)) : Infinity;
  }

  // Signed lateral distance from the centerline for lane index `i` of `n` lanes, positive
  // toward this file's "right of travel" (see the file header).
  // One-way: lanes fill the *whole* width (no opposing traffic, so no reason to leave
  // the other half empty) — i=0 is the leftmost lane, i=n-1 the rightmost. Two-way:
  // this direction of travel only owns its own half (right-hand traffic) — i=0 sits
  // nearest the centerline (the passing/left-turn lane), i=n-1 nearest the curb (the
  // right-turn lane). Checked empirically, not just on paper: same-direction traffic
  // must render on screen-right of the chase camera, oncoming on the left.
  function laneLateral(width, lanes, laneIndex, oneWay) {
    const n = Math.max(1, lanes || 1);
    const i = Math.min(Math.max(0, laneIndex || 0), n - 1);
    return oneWay ? -width / 2 + (i + 0.5) * (width / n) : (i + 0.5) * ((width / 2) / n);
  }
  function offsetVec(heading, lateral) {
    return { x: -Math.sin(heading) * lateral, z: Math.cos(heading) * lateral };
  }

  // Which lane should this car use on the edge it's about to drive (car.from -> car.to),
  // given the turn it's already committed to making at the far end (car.nextEdge, picked
  // one edge ahead so the choice can anticipate the turn rather than react to it)? Left
  // turn -> leftmost lane, right turn -> rightmost lane, straight -> a middle lane
  // (picked randomly between the two most-central lanes when there's no single exact
  // middle, so straight-through traffic doesn't all pile into one lane).
  // Highways / freeways: everybody keeps to the right-hand lane, moves over for the exit they will take (200 m before it),
  // and faster cars use the left lanes to pass, stay there a while, then merge back right.
  const EXIT_LOOK = 160;      // 200 m
  const hash01 = (seed, str) => { let h = Math.floor(seed * 1e9) >>> 0; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0; return h / 4294967296; };
  const wantsExit = (car, nodeId) => { if (car.seed === undefined) car.seed = Math.random(); return hash01(car.seed, nodeId) < 0.4; };
  const edgeLen = e => { const a = nodes[e.from], b = nodes[e.to]; return Math.hypot(b.x - a.x, b.z - a.z); };
  const hwOptions = (nodeId, fromId) => (edgesByNode[nodeId] || []).filter(e => allowedFrom(e, nodeId) && otherEnd(e, nodeId) !== fromId);
  const turnSign = (fromId, nodeId, e) => {
    const a = nodes[fromId], b = nodes[nodeId], c = nodes[otherEnd(e, nodeId)];
    return normalizeAngle(Math.atan2(c.z - b.z, c.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x));
  };
  // the next exit this car is going to take, if it is within 420 u: { dist, right }
  function hwExit(car, now) {
    if (car._exT !== undefined && now - car._exT < 500) return car._ex;
    car._exT = now; car._ex = null;
    let d = Math.max(0, (car.path ? car.path.length : 0) - car.s), node = car.to, from = car.from;
    let next = car.nextEdge;
    for (let k = 0; k < 8 && d < 420 && node; k++) {
      let ramps, rest;
      if (k === 0 && next) { ramps = next.ramp ? [next] : []; rest = next.ramp ? [] : [next]; }
      else { const o = hwOptions(node, from); ramps = o.filter(e => e.ramp); rest = o.filter(e => !e.ramp); if (ramps.length && rest.length && !wantsExit(car, node)) ramps = []; else if (ramps.length && !rest.length) ramps = ramps.slice(0, 1); }
      if (ramps.length) { car._ex = { dist: d, right: turnSign(from, node, ramps[0]) >= 0 }; break; }
      next = rest.find(e => e.type === 'highway'); if (!next) break;
      d += edgeLen(next); from = node; node = otherEnd(next, node);
      if (k === 0) next = null;
    }
    return car._ex;
  }
  function chooseLaneIndex(car) {
    const n = Math.max(1, car.lanes || 1);
    if (n <= 1) return 0;
    if (car.line) return n - 1;                       // bus lines hug the kerb so they can serve the stops
    if (car.edge && car.edge.type === 'highway') {
      if (car.prevType === 'highway' && car.laneIndex != null) return Math.min(n - 1, car.laneIndex);
      return n - 1;
    }
    const a = nodes[car.from], b = nodes[car.to];
    const mid = (n - 1) / 2;
    const loIdx = Math.floor(mid), hiIdx = Math.ceil(mid);
    const middleChoice = loIdx === hiIdx ? loIdx : (Math.random() < 0.5 ? loIdx : hiIdx);
    if (!a || !b || !car.nextEdge) return middleChoice;
    const far = nodes[otherEnd(car.nextEdge, car.to)];
    if (!far) return middleChoice;
    const currentHeading = Math.atan2(b.z - a.z, b.x - a.x);
    const nextHeading = Math.atan2(far.z - b.z, far.x - b.x);
    const turn = normalizeAngle(nextHeading - currentHeading);
    // Right-hand-traffic convention: increasing heading is a right turn, decreasing a left.
    if (turn > 0.3) return n - 1;
    if (turn < -0.3) return 0;
    return middleChoice;
  }

  // Put `car` at a random spot on `edge`, facing along it (used to spawn and to respawn).
  function place(car, edge, reversed) {
    car.edge = edge;
    car.from = reversed ? edge.to : edge.from;
    car.to = reversed ? edge.from : edge.to;
    car.speed = 0;
    car.targetSpeed = (typeSpeed[edge.type] || 8) * car.veh.speedMul;
    car.width = edge.width || 9;
    car.lanes = Math.max(1, edge.lanes || 1);
    car.oneWay = !!edge.oneWay;
    car.stopCleared = false; car.dwell = 0; car.dwellNeeded = 1.0 + Math.random() * 1.2;
    car.crashTimer = 0;
    car.path = pathFor(edge, car.from, car.to);
    car.s = Math.random() * 0.7 * car.path.length;
    car.pace = 0.93 + Math.random() * 0.17; car.prevType = undefined; car.laneIndex = undefined; car.passOff = 0; car._exT = undefined; car.seed = undefined;
    car.targetSpeed *= edge.type === 'highway' ? car.pace : 1;
    car.nextEdge = pickNextEdge(car.to, car.from, car);
    car.laneIndex = chooseLaneIndex(car);
    if (edge.type === 'highway' && car.lanes > 1 && Math.random() < 0.22) { car.passOff = 1 + (car.lanes > 2 && Math.random() < 0.3 ? 1 : 0); car.laneIndex = Math.max(0, car.lanes - 1 - car.passOff); car.passUntil = performance.now() + 3000 + Math.random() * 9000; }
    car.lat = laneLateral(car.width, car.lanes, car.laneIndex, car.oneWay);
    car.visualHeading = undefined;
    car.avoidOff = 0; car.avoidObs = null; car.conn = null; car.ghost = 0; car.blockedT = 0; car.waitT = 0;
    car.why = ''; car.blockedBy = null; car.hdg = undefined; car.knock = null; car.wreck = false;
    car.mesh.rotation.x = 0; car.mesh.rotation.z = 0;
  }

  function spawnOn(edge, reversed, opts = {}) {
    const type = opts.type || TYPE_CYCLE[cars.length % TYPE_CYCLE.length];
    const veh = VEH[type];
    const colors = type === 'bus' ? [0xd9a21b, 0x2f6fb5, 0xc8362f] : type === 'truck' ? [0xd7d9dc, 0x3a6ea5, 0xb5543a] : bodyColors;
    const mesh = trafficCarMesh(type, opts.color != null ? opts.color : colors[Math.floor(Math.random() * colors.length)]);
    scene.add(mesh);
    const dims = mesh.userData.dims;
    // One circular collider per circle of the vehicle's shape, kept in sync with the mesh every
    // frame; merged into collision.js's world so the player bumps AI vehicles like any other
    // solid thing. `ref` lets collision.js exchange momentum with the car (see applyImpact).
    const colliders = veh.circles.map(off => ({ kind: 'traffic', x: 0, z: 0, radius: veh.r, off, blocksCar: true, destructible: false, destroyed: false, ref: null }));
    mesh.rotation.order = 'YXZ';
    const car = { mesh, type, veh, len: dims.len, wid: dims.wid, mass: veh.mass, collider: colliders[0], colliders, wheels: mesh.userData.wheels, braking: false, active: true, crashTimer: 0, line: opts.line || null, svc: isService(type) ? type : null };
    colliders.forEach(c => { c.ref = car; });
    car.getVelocity = () => {
      if (car.knock) return { x: car.knock.vx, z: car.knock.vz };
      const h = car.hdg ?? 0;
      return { x: Math.cos(h) * car.speed, z: Math.sin(h) * car.speed };
    };
    // A hit from the player (or anything): swap to free physics. `v` is the new world
    // velocity, `spin` a yaw kick, `dv` how big the velocity change was (drives the hop/tumble).
    car.applyImpact = (vx, vz, spin, dv, sideSign) => {
      if (dv > 1.5 && (car.honkCool || 0) <= 0) { events.push({ t: 'honk', x: mesh.position.x, z: mesh.position.z, type: car.type, seed: car.seed, angry: true }); car.honkCool = 3 + Math.random() * 4; }
      if (!car.knock) {
        car.knock = { x: mesh.position.x, z: mesh.position.z, y: mesh.position.y, yaw: mesh.rotation.y, vx: 0, vz: 0, vy: 0, wy: 0, wr: 0, wp: 0, roll: mesh.rotation.z, pitch: mesh.rotation.x, air: false, restRoll: 0, age: 0 };
      }
      const k = car.knock;
      k.vx = vx; k.vz = vz; k.wy += spin;
      if (dv > 4.5) {
        const e = dv - 4.5;
        k.vy = Math.min(5.5, e * 0.4); k.air = true;
        k.wr += sideSign * Math.min(4, e * 0.22);
        k.wp += (Math.random() - 0.5) * Math.min(2.5, e * 0.12);
      }
      car.wreck = true; car.crashTimer = 1e9; car.speed = 0; car.avoidObs = null; car.conn = null;
    };
    place(car, edge, reversed);
    cars.push(car);
    return car;
  }

  if (drivable.length) {
    for (let i = 0; i < count; i++) {
      const edge = edgeFor(TYPE_CYCLE[cars.length % TYPE_CYCLE.length]);
      // A one-way edge only ever runs from->to — never spawn a car facing the wrong
      // way down it (reversed would put it going to->from).
      spawnOn(edge, edge.oneWay ? false : Math.random() < 0.5);
    }
  }

  // Public transport: a few buses per line, spread round the loop, always on their route (see transit.js).
  const lineBuses = [];
  if (transit) for (const line of transit.lines) {
    const per = Math.max(3, Math.round(line.length / 520));
    for (let b = 0; b < per; b++) {
      const st = line.steps[Math.floor((b / per) * line.steps.length)];
      lineBuses.push(spawnOn(st.edge, st.edge.from !== st.from, { type: 'bus', color: line.color, line }));
    }
  }

  // Emergency services and winter service: always-present vehicles outside the density slider. Police cars, ambulances and fire engines patrol like
  // everyone else and now and then run "code 3" (lights + siren, faster). Snowploughs only come out while it snows (setPlows).
  const svcCars = [];
  [['police', 3], ['ambulance', 2], ['fire', 1], ['plow', 6]].forEach(([t, n]) => {
    for (let i = 0; i < n && drivable.length; i++) {
      const edge = edgeFor(t), c = spawnOn(edge, edge.oneWay ? false : Math.random() < 0.5, { type: t });
      c.sirenT = 10 + Math.random() * 60;
      svcCars.push(c);
      if (t === 'plow') { c.active = false; c.mesh.visible = false; c.colliders.forEach(k => { k.blocksCar = false; k.x = 1e6; k.z = 1e6; }); }
    }
  });
  // vehicles parked on the aprons of the hospital / police / fire stations (solid, not part of the traffic simulation)
  const stationColliders = [];
  (cityData.stations || []).forEach(st => (st.bays || []).forEach(b => {
    const mesh = trafficCarMesh(b.type, 0xffffff), u = mesh.userData, d = u.dims, h = (b.rotation || 0) * Math.PI / 180;
    const y = heightAt ? heightAt(b.x, b.z, 0) : 0;
    mesh.position.set(b.x, y, b.z); mesh.rotation.y = h; scene.add(mesh);
    setGlow(u.headPool, 0); setGlow(u.tailPool, 0); u.tailHalos.forEach(k => { k.visible = false; }); u.tailMat.emissiveIntensity = 0.6;
    const n = Math.max(2, Math.round(d.len / 2.2));
    for (let i = 0; i < n; i++) { const o = (i / (n - 1) - 0.5) * (d.len - 2.2); stationColliders.push({ kind: 'prop', instance: { type: 'stationvehicle', x: b.x, z: b.z, mesh }, x: b.x + Math.sin(h) * o, z: b.z + Math.cos(h) * o, radius: 1.15, blocksCar: true, destructible: false, response: 'bounce', destroyed: false }); }
  }));
  function setPlows(on) {
    svcCars.forEach(c => {
      if (c.type !== 'plow') return;
      if (on && !c.active) {
        c.active = true; c.mesh.visible = true; c.colliders.forEach(k => { k.blocksCar = true; });
        for (let tries = 0; tries < 30; tries++) {
          const edge = edgeFor('plow'); place(c, edge, edge.oneWay ? false : Math.random() < 0.5);
          const pos = sampleAt(c.path, c.s), px = lastPlayer ? lastPlayer.x : 1e6, pz = lastPlayer ? lastPlayer.z : 1e6;
          if (Math.hypot(pos.x - px, pos.z - pz) > 60) break;
        }
      } else if (!on && c.active) { c.active = false; c.mesh.visible = false; c.colliders.forEach(k => { k.blocksCar = false; k.x = 1e6; k.z = 1e6; }); }
      c.plowing = on;
    });
  }

  // Can this car legally continue onto `edge` starting from `nodeId`? Only false for a
  // one-way edge entered from its `to` end — every other edge is fair game either way.
  function allowedFrom(edge, nodeId) {
    return !edge.oneWay || edge.from === nodeId;
  }

  function pickNextEdge(nodeId, fromNodeId, car) {
    if (car && car.line) { const e = car.line.next.get(fromNodeId + '>' + nodeId); if (e) return e; }
    const connected = (edgesByNode[nodeId] || []).filter(e => allowedFrom(e, nodeId));
    let options = connected.filter(e => otherEnd(e, nodeId) !== fromNodeId);
    if (car && (car.type === 'bus' || car.type === 'truck' || car.type === 'fire' || car.type === 'plow')) {
      const wide = options.filter(isWide);
      if (wide.length) options = wide;
    }
    // never choose a near-U-turn (e.g. onto a slip road pointing the other way) when there is anything else
    if (options.length > 1 && nodes[fromNodeId] && nodes[nodeId]) {
      const a = nodes[fromNodeId], b = nodes[nodeId];
      const ix = b.x - a.x, iz = b.z - a.z, il = Math.hypot(ix, iz) || 1;
      const sane = options.filter(e => {
        const o = nodes[otherEnd(e, nodeId)];
        const ox = o.x - b.x, oz = o.z - b.z, ol = Math.hypot(ox, oz) || 1;
        return (ix * ox + iz * oz) / (il * ol) > -0.5;
      });
      if (sane.length) options = sane;
    }
    let pool = options.length ? options : connected;
    if (car && car.edge && car.edge.type === 'highway' && pool.some(e => e.ramp) && pool.some(e => !e.ramp)) {
      const ex = wantsExit(car, nodeId); pool = pool.filter(e => ex ? e.ramp : !e.ramp);
    }
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  const stopSet = computeStopApproaches(cityData).stops;

  // Is it safe to leave the stop line? Nobody in the junction box, and (for a minor road
  // meeting a bigger one) no car on the bigger road about to reach the junction.
  function stopJunctionClear(car, clr) {
    const node = nodes[car.to];
    const myRank = roadRank(car.edge);
    for (const o of cars) {
      if (o === car || !o.active) continue;
      const d = Math.hypot(o.mesh.position.x - node.x, o.mesh.position.z - node.z);
      if (d < clr + 1.5 && (o.speed > 0.3 || d < clr)) return false;
      if (o.to === car.to && roadRank(o.edge) > myRank && d < 24 && o.speed > 0.5) return false;
    }
    return true;
  }


  // --- Junction turns -----------------------------------------------------------------
  // Paths only have corner curves at 2-edge bends. At a real junction the old code just
  // swapped to the next edge's straight path at the node centre, so a turning car cut a sharp
  // corner and relied on the body-yaw smoothing to hide it. Now the car follows a cubic arc from
  // its lane on the old road (at the edge of the junction box) to its lane on the new road.
  function turnAngleOf(car) {
    if (car._turnFor !== car.nextEdge || car._turnFrom !== car.from) {
      car._turnFor = car.nextEdge; car._turnFrom = car.from;
      const A = nodes[car.from], B = nodes[car.to], C = car.nextEdge && nodes[otherEnd(car.nextEdge, car.to)];
      car._turnAng = (A && B && C)
        ? Math.abs(normalizeAngle(Math.atan2(C.z - B.z, C.x - B.x) - Math.atan2(B.z - A.z, B.x - A.x))) : 0;
    }
    return car._turnAng;
  }
  function connSample(c) {
    const pts = c.pts;
    const s = Math.max(0, Math.min(c.length, c.cs));
    let i = 1;
    while (i < pts.length - 1 && pts[i].cum < s) i++;
    const p0 = pts[i - 1], p1 = pts[i];
    const u = Math.max(0, Math.min(1, (s - p0.cum) / Math.max(1e-6, p1.cum - p0.cum)));
    return { x: p0.x + (p1.x - p0.x) * u, z: p0.z + (p1.z - p0.z) * u, heading: p0.h + normalizeAngle(p1.h - p0.h) * u };
  }
  function tryStartConn(car, clrA) {
    const next = car.nextEdge;
    if (!next || turnAngleOf(car) < 0.12) return;
    const toNode = car.to, far = otherEnd(next, toNode);
    const pathB = pathFor(next, toNode, far);
    const clrB = intersectionClearance(toNode, next, edgesByNode);
    if (pathB.length < clrB + 4) return;
    const nn = pickNextEdge(far, toNode, car);
    const lanesB = Math.max(1, next.lanes || 1);
    const laneB = chooseLaneIndex({ from: toNode, to: far, lanes: lanesB, nextEdge: nn, edge: next, prevType: car.edge && car.edge.type, laneIndex: car.laneIndex, line: car.line });
    const latB = laneLateral(next.width || 9, lanesB, laneB, !!next.oneWay);
    const sA = Math.min(car.path.length, Math.max(0, car.s));
    const a = sampleAt(car.path, sA), oA = offsetVec(a.heading, car.lat);
    // sharp (acute-junction) turns exit further down the new road so the arc isn't a hairpin
    const endS = Math.min(pathB.length - 1, clrB + Math.max(0, turnAngleOf(car) - 1.0) * 6);
    const b = sampleAt(pathB, endS), oB = offsetVec(b.heading, latB);
    const P0 = { x: a.x + oA.x, z: a.z + oA.z }, P3 = { x: b.x + oB.x, z: b.z + oB.z };
    const k = Math.hypot(P3.x - P0.x, P3.z - P0.z) * 0.42;
    const P1 = { x: P0.x + Math.cos(a.heading) * k, z: P0.z + Math.sin(a.heading) * k };
    const P2 = { x: P3.x - Math.cos(b.heading) * k, z: P3.z - Math.sin(b.heading) * k };
    const N = 18, pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      const x = u * u * u * P0.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * P3.x;
      const z = u * u * u * P0.z + 3 * u * u * t * P1.z + 3 * u * t * t * P2.z + t * t * t * P3.z;
      const dx = 3 * u * u * (P1.x - P0.x) + 6 * u * t * (P2.x - P1.x) + 3 * t * t * (P3.x - P2.x);
      const dz = 3 * u * u * (P1.z - P0.z) + 6 * u * t * (P2.z - P1.z) + 3 * t * t * (P3.z - P2.z);
      pts.push({ x, z, h: Math.atan2(dz, dx), cum: 0 });
    }
    let acc = 0, maxCurv = 0;
    for (let i = 1; i <= N; i++) {
      const d = Math.max(1e-6, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      acc += d; pts[i].cum = acc;
      maxCurv = Math.max(maxCurv, Math.abs(normalizeAngle(pts[i].h - pts[i - 1].h)) / d);
    }
    car.conn = {
      pts, length: acc, cs: 0, endS, latB, laneB, nn, next,
      cap: maxCurv > 1e-3 ? Math.max(3.5, Math.sqrt(LAT_ACC / maxCurv)) : Infinity
    };
  }

  let lastPlayer = null;
  const playerObs = { isPlayer: true, x: 0, z: 0, speed: 0, hdg: 0 };
  const clrOf = car => {
    const key = car.edge.id + '|' + car.to;
    if (car._clrKey !== key) { car._clrKey = key; car._clr = intersectionClearance(car.to, car.edge, edgesByNode); }
    return car._clr;
  };

  // Is this car legitimately waiting (red light / stop sign somewhere up its queue)?
  // Follows the chain of "blocked by" links; a chain that ends in a signal or stop is fine,
  // one that loops or ends in nothing is a deadlock.
  function waitingLegit(car) {
    let c = car;
    for (let hops = 0; hops < 8 && c; hops++) {
      if (c.crashTimer > 0 || c.why === 'sig' || c.why === 'stop') return true;
      if (c.why !== 'ahead' || !c.blockedBy) return false;
      if (c.blockedBy.isPlayer) return true;
      c = c.blockedBy;
    }
    return false;
  }


  // Free physics for a car that has been hit: slides with friction, may hop and tumble, spins
  // about its yaw, and ends up a wreck (hazards on) until the player is well away, when it is
  // quietly swapped for a fresh car elsewhere.
  function syncColliders(car, x, z, yaw) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    car.colliders.forEach(c => { c.x = x + fx * c.off; c.z = z + fz * c.off; c.y = car.mesh.position.y; });
  }
  function updateKnocked(car, dt, now, playerCar) {
    const k = car.knock;
    k.age += dt;
    const sp = Math.hypot(k.vx, k.vz);
    if (sp > 0.01) {
      const dec = Math.min(sp, (k.air ? 0.5 : 17) * dt);          // sliding friction: tyres + crumpled bodywork grip, a hit car doesn't skate
      k.vx -= (k.vx / sp) * dec; k.vz -= (k.vz / sp) * dec;
      if (!k.air) { const e = Math.exp(-1.5 * dt); k.vx *= e; k.vz *= e; }
    }
    k.x += k.vx * dt; k.z += k.vz * dt;
    k.yaw += k.wy * dt;
    k.wy *= Math.exp(-5.5 * dt);
    const ground = heightAt ? heightAt(k.x, k.z, k.y) : 0;
    k.vy -= 22 * dt;
    k.y += k.vy * dt;
    if (k.y <= ground) {
      k.y = ground;
      if (k.air) {
        k.air = false;
        // landed: if it has rolled far enough it stays on its side, otherwise it settles upright
        k.restRoll = Math.abs(k.roll) > 1.0 ? Math.sign(k.roll) * 1.5 : 0;
      }
      if (k.vy < -3) { k.vy = -k.vy * 0.25; k.air = true; } else k.vy = 0;
    } else k.air = true;
    if (k.air) { k.roll += k.wr * dt; k.pitch += k.wp * dt; }
    else {
      const e = Math.min(1, dt * 7);
      k.roll += (k.restRoll - k.roll) * e; k.pitch += (0 - k.pitch) * e;
      k.wr *= Math.exp(-6 * dt); k.wp *= Math.exp(-6 * dt);
    }
    const m = car.mesh;
    m.position.set(k.x, k.y + bodyLift(k.pitch, k.roll, (car.wid || 1.8) / 2, car.height || 1.5, (car.len || 3.6) / 2), k.z);
    m.rotation.set(k.pitch, k.yaw, k.roll);
    syncColliders(car, k.x, k.z, k.yaw);
    car.speed = 0; car.braking = true; car.hdg = Math.atan2(Math.cos(k.yaw), Math.sin(k.yaw));
    const u = m.userData;
    u.tailMat.emissiveIntensity = 2.6;
    setGlow(u.tailPool, 0.3);
    const hazardOn = Math.floor(now / 330) % 2 === 0;
    u.hazardMat.emissiveIntensity = hazardOn ? 3 : 0;
    u.hazardHalos.forEach(h => { h.material.opacity = hazardOn ? 0.9 : 0; h.visible = hazardOn; });
    // wrecks clear away once the player has left them well behind
    if (playerCar && k.age > 20 && Math.hypot(k.x - playerCar.x, k.z - playerCar.z) > 90) respawnAway(car, playerCar);
  }
  function respawnAway(car, playerCar) {
    if (car.line) {
      for (let tries = 0; tries < 40; tries++) {
        const st = car.line.steps[Math.floor(Math.random() * car.line.steps.length)];
        place(car, st.edge, st.edge.from !== st.from);
        const pos = sampleAt(car.path, car.s);
        if (Math.hypot(pos.x - playerCar.x, pos.z - playerCar.z) > 80) break;
      }
      car.mesh.position.set(1e5, 0, 1e5); return;
    }
    for (let tries = 0; tries < 40; tries++) {
      const edge = edgeFor(car.type);
      place(car, edge, edge.oneWay ? false : Math.random() < 0.5);
      const pos = sampleAt(car.path, car.s);
      if (Math.hypot(pos.x - playerCar.x, pos.z - playerCar.z) > 80) break;
    }
    car.mesh.position.set(1e5, 0, 1e5);  // snapped to its path on the next update
  }

  // Keep the traffic where the player is: a few cars per frame, any that have been left far behind are moved to a
  // road near (but not on top of) the player, so a bigger pool means a busier street rather than emptier suburbs.
  const edgeMid = drivable.map(e => { const a = nodes[e.from], b = nodes[e.to]; return a && b ? { e, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 } : null; }).filter(Boolean);
  let rrIdx = 0;
  function recycleFar(playerCar) {
    for (let n = 0; n < 4; n++) {
      const car = cars[rrIdx++ % cars.length];
      if (!car || !car.active || car.knock || car.wreck || car.line) continue;
      const pos = car.mesh.position;
      if (Math.hypot(pos.x - playerCar.x, pos.z - playerCar.z) < 520) continue;
      const near = edgeMid.filter(m => { const d = Math.hypot(m.x - playerCar.x, m.z - playerCar.z); return d > 60 && d < 420 && (car.type === 'bus' || car.type === 'truck' || car.type === 'fire' || car.type === 'plow' ? m.e.type !== 'local' : true); });
      if (!near.length) continue;
      for (let tries = 0; tries < 12; tries++) {
        const m = near[Math.floor(Math.random() * near.length)];
        place(car, m.e, m.e.oneWay ? false : Math.random() < 0.5);
        const q = sampleAt(car.path, car.s);
        const d = Math.hypot(q.x - playerCar.x, q.z - playerCar.z);
        if (d > 110 && d < 440) break;
      }
      car.mesh.position.set(1e5, 0, 1e5);
    }
  }

  function update(dt, playerCar) {
    const now = performance.now();
    lastPlayer = playerCar || lastPlayer;
    const under = !!playerCar && (playerCar.y < -1.2 || playerCar.x > 4000);
    if (playerCar && !under) recycleFar(playerCar);
    const act = cars.filter(c => c.active);
    if (playerCar) {
      playerObs.x = under ? 1e6 : playerCar.x; playerObs.z = under ? 1e6 : playerCar.z; playerObs.speed = Math.abs(playerCar.speed || 0);
      playerObs.hdg = Math.atan2(Math.cos(playerCar.heading), Math.sin(playerCar.heading));
    }
    // spatial grid (48-unit cells): every neighbour query below only looks at the 3x3 cells around the car, so the cost grows
    // with how crowded a street is, not with the number of cars in the city
    const grid = new Map();
    for (let i = 0; i < act.length; i++) { const c = act[i]; c._ai = i; const k = (Math.floor(c.mesh.position.x / 48) + 4000) * 10007 + Math.floor(c.mesh.position.z / 48) + 4000; const l = grid.get(k); if (l) l.push(c); else grid.set(k, [c]); }
    const nearOf = c => {
      const out = [], cx = Math.floor(c.mesh.position.x / 48) + 4000, cz = Math.floor(c.mesh.position.z / 48) + 4000;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = grid.get((cx + a) * 10007 + cz + b); if (l) for (let i = 0; i < l.length; i++) out.push(l[i]); }
      return out;
    };
    const px = o => (o.isPlayer ? o.x : o.mesh.position.x), pz = o => (o.isPlayer ? o.z : o.mesh.position.z);

    act.forEach(car => {
      if (car.svc && car.svc !== 'plow') {
        car.sirenT = (car.sirenT ?? 30) - dt;
        if (car.sirenT <= 0) { car.siren = !car.siren; car.sirenT = car.siren ? 20 + Math.random() * 25 : 35 + Math.random() * 90; car.targetSpeed *= car.siren ? 1.3 : 1 / 1.3; }
      }
      const nb = car._nb = nearOf(car);
      const nbC = (playerCar && Math.abs(playerObs.x - car.mesh.position.x) < 70 && Math.abs(playerObs.z - car.mesh.position.z) < 70) ? nb.concat([playerObs]) : nb;
      const a = nodes[car.from], b = nodes[car.to];
      if (!a || !b) return;
      if (car.knock) { updateKnocked(car, dt, now, playerCar); return; }
      const len = car.path.length;
      const conn = car.conn;
      const here = conn ? connSample(conn) : sampleAt(car.path, car.s);
      const heading = here.heading;
      const ch = Math.cos(heading), sh = Math.sin(heading);
      const off0 = offsetVec(heading, conn ? 0 : car.lat);
      const curX = here.x + off0.x, curZ = here.z + off0.z;

      let desiredSpeed = car.targetSpeed;
      car.why = '';
      const distToNode = conn ? 0 : len - car.s;
      const isJunction = (edgesByNode[car.to] || []).length >= 3;
      const clr = clrOf(car);
      const lineDist = clr + 3.7;
      const hold = (toStop, why) => {
        const v = toStop < 1.0 ? 0 : Math.max(0, (toStop - 0.8) * 1.5);
        if (v < desiredSpeed) { desiredSpeed = v; if (v < 1) car.why = why; }
      };

      // bus stops: pull up at the kerb in the middle of a stop edge, wait a few seconds, move on
      if (car.line && !conn && car.edge) {
        const key = car.edge.id + '>' + car.from, st = transit.stopAt.get(key);
        if (st && car.stopDone !== key) {
          const toStop = len * 0.5 - car.s;
          if (toStop > -1.5) {
            hold(toStop, 'stop');
            if (toStop < 1.3 && car.speed < 0.6) {
              if (!car.dwellStop) events.push({ t: 'hiss', x: car.mesh.position.x, z: car.mesh.position.z });
              car.dwellStop = (car.dwellStop || 0) + dt;
              if (car.dwellStop > 5 + (car.seed || 0.5) * 3) { car.stopDone = key; car.dwellStop = 0; }
            }
          } else car.stopDone = key;
        }
      }

      // curvature: slow for bends
      desiredSpeed = Math.min(desiredSpeed, conn ? conn.cap : curveCap(car.path, here.idx, car.s, car.speed));
      if (!conn && car.nextEdge && (edgesByNode[car.to] || []).length >= 3 && turnAngleOf(car) > 0.12) {
        const cap = Math.max(3.5, Math.sqrt(LAT_ACC * (3 + clrOf(car) * 0.8)));
        desiredSpeed = Math.min(desiredSpeed, cap + Math.max(0, distToNode - clrOf(car)) * 1.5);
      }

      // Traffic signal / stop sign at the node this car is heading into.
      const sig = findSignalForApproach(cityData, car.to, car.from);
      if (!sig && car.edge && !car.stopCleared && stopSet.has(stopKey(car.to, car.edge.id))) {
        const toStop = distToNode - lineDist;
        if (toStop > -0.8) {
          hold(toStop, 'stop');
          if (car.speed < 0.2 && toStop < 2.5) {
            car.dwell = (car.dwell || 0) + dt;
            if (car.dwell > car.dwellNeeded && (stopJunctionClear(car, clr) || car.dwell > car.dwellNeeded + 14)) car.stopCleared = true;
          }
        } else car.stopCleared = true;
      }
      if (sig && car.edge && isJunction) {
        const phase = phaseAt(sig, now);
        if (phase !== 'green') {
          const toStop = distToNode - lineDist;
          const cyc = sig.greenMs + sig.yellowMs + sig.redMs;
          const tIn = (((now + (sig.offsetMs || 0)) % cyc) + cyc) % cyc;
          const yellowLeft = Math.max(0, (sig.greenMs + sig.yellowMs - tIn) / 1000);
          const comfortable = !(toStop / Math.max(car.speed, 1) < yellowLeft - 0.15);
          if (toStop > -0.8 && (phase === 'red' || comfortable)) hold(toStop, 'sig');
        }
      }

      // Don't enter a junction whose exit is clogged (keeps the box clear -> no gridlock).
      if (isJunction && car.nextEdge && car.ghost <= 0) {
        const toStop = distToNode - lineDist;
        if (toStop > -0.8 && toStop < 18) {
          for (const o of nb) {
            if (o !== car && o.from === car.to && o.edge === car.nextEdge && o.s < car.len + 6 + clr * 0.5 && o.speed < 2.2) { hold(toStop, 'box'); break; }
          }
        }
      }

      // Keep the middle of the junction free of conflicts (without touching the signal timing):
      //  1. don't drive into a box where another car (from a different approach) is sitting slow or stopped inside it;
      //  2. a left-turner gives way to oncoming straight-through traffic that is about to arrive (but never for more than ~6 s).
      if (isJunction && car.edge && car.ghost <= 0 && !car.conn) {
        const toStop = distToNode - lineDist;
        if (toStop > -0.8 && toStop < 16) {
          let blockedBox = false, yieldTo = false;
          const B = nodes[car.to], A = nodes[car.from], C = car.nextEdge && nodes[otherEnd(car.nextEdge, car.to)];
          const sa = Math.sin(heading), ca = Math.cos(heading);
          for (const o of nb) {
            if (o === car || o.isPlayer || o.ghost > 0 || o.to !== car.to || o.from === car.from || !o.edge) continue;
            if (o.conn && o.speed < 2.5 && o.mesh.position.y - car.mesh.position.y < 3.5) { blockedBox = true; break; }
          }
          if (blockedBox) hold(toStop, 'box');
          else if (B && A && C && turnAngleOf(car) > 0.5 && (car.yieldT || 0) < 6) {
            const latC = -(C.x - B.x) * sa + (C.z - B.z) * ca;
            for (const o of nb) {
              if (o === car || o.ghost > 0 || o.to !== car.to || o.from === car.from || o.conn || !o.edge) continue;
              if (Math.cos((o.hdg ?? heading) - heading) > -0.6 || turnAngleOf(o) > 0.4) continue;
              const ox = o.mesh.position.x - B.x, oz = o.mesh.position.z - B.z, dN = Math.hypot(ox, oz), latO = -(o.mesh.position.x - car.mesh.position.x) * sa + (o.mesh.position.z - car.mesh.position.z) * ca;
              if (Math.sign(latO) !== Math.sign(latC) || dN > 26 || (o.speed < 0.8 && dN > 10)) continue;
              yieldTo = true; break;
            }
            if (yieldTo) { hold(toStop, 'yield'); car.yieldT = (car.yieldT || 0) + dt; }
          }
        }
      } else if (car.yieldT && !car.conn) car.yieldT = 0;
      if (car.conn) car.yieldT = 0;

      // What's physically ahead? (player or other cars; heading-aware so oncoming and crossing
      // traffic don't count as "in my lane"). Look-ahead grows with speed.
      let nearest = Infinity, obs = null, obsLat = 0;
      const range = 9 + car.len * 0.5 + car.speed * 1.0;
      for (const o of nbC) {
        if (o === car) continue;
        if (!o.isPlayer && car.ghost > 0) continue;
        if (o === car.avoidObs) continue;
        const dx = px(o) - curX, dz = pz(o) - curZ;
        const ahead = dx * ch + dz * sh;
        if (ahead < 0.5 || ahead > range) continue;
        if (Math.abs((o.isPlayer ? (o.y || 0) : o.mesh.position.y) - car.mesh.position.y) > 3.5) continue;   // a different level (bridge / tunnel)
        const lat = -dx * sh + dz * ch, al = Math.abs(lat);
        const rel = o.hdg === undefined ? 1 : Math.cos(o.hdg - heading);
        let hit;
        const oLen = o.isPlayer ? 3.6 : o.len, oWid = o.isPlayer ? 1.9 : o.wid;
        const latThr = (car.wid + oWid) / 2 + 0.15;
        if (o.isPlayer && o.speed < 1.2) hit = al < latThr + 0.1;
        else if (rel > 0.5) hit = al < latThr;
        else if (rel < -0.3) hit = al < 1.4;
        else hit = ahead < 5.5 + (car.len - 3.4) * 0.4 && al < 1.7;
        if (!hit) continue;
        const d = Math.hypot(dx, dz) - (car.len + oLen) / 2 + 3.5;   // bumper-to-bumper distance, expressed like the old centre-to-centre one
        if (d < nearest) { nearest = d; obs = o; obsLat = lat; }
      }
      car.blockedBy = obs && !obs.isPlayer ? obs : (obs ? playerObs : null);
      if (!globalThis.__noHw && !car.conn && car.edge.type === 'highway' && car.lanes > 1 && !car.avoidObs) {
        const n = car.lanes, right = n - 1, ex = hwExit(car, now), exitNear = ex && ex.dist < EXIT_LOOK;
        if (car.passOff === undefined) car.passOff = 0;
        let want;
        if (exitNear) { want = ex.right ? right : 0; car.passOff = right - want; }
        else {
          if (obs && !obs.isPlayer && car.passOff < right && nearest < 26 && obs.speed < car.targetSpeed * 0.88 && car.speed > 2 && now > (car.laneT || 0)) {
            car.passOff++; car.passUntil = now + 6000 + Math.random() * 9000;
          } else if (car.passOff > 0 && now > (car.passUntil || 0) && now > (car.laneT || 0)) { car.passOff--; car.passUntil = now + 2500; }
          want = right - car.passOff;
        }
        if (want !== car.laneIndex && now > (car.laneT || 0)) {
          const step = want > car.laneIndex ? 1 : -1, tl = car.laneIndex + step;
          const side = laneLateral(car.width, n, tl, true) - car.lat;
          let clear = true;
          for (const o of nb) {
            if (o === car) continue;
            const dx = px(o) - curX, dz = pz(o) - curZ, ahead = dx * ch + dz * sh, lat = -dx * sh + dz * ch;
            if (ahead > -9 - (o.speed > car.speed ? (o.speed - car.speed) * 1.2 : 0) && ahead < 11 + Math.max(0, car.speed - o.speed) * 1.5 && Math.abs(lat - side) < 2.5) { clear = false; break; }
          }
          if (clear) { car.laneIndex = tl; car.laneT = now + 1800; }
          else if (!exitNear && step > 0) car.passUntil = Math.max(car.passUntil || 0, now + 1500);
          else if (!exitNear && step < 0) { car.passOff = Math.max(0, car.passOff - 1); }
        }
      }
      if (obs) {
        const cap = Math.sqrt(car.veh.brake * 1.1 * Math.max(0, nearest - 5.0));
        if (cap < desiredSpeed) { desiredSpeed = cap; if (cap < 0.6 && !car.why) car.why = 'ahead'; }
      }

      // Going round something that is parked in the way (the player, or a crashed car).
      if (car.avoidObs) {
        const o = car.avoidObs;
        const dx = px(o) - curX, dz = pz(o) - curZ;
        const ahead = dx * ch + dz * sh;
        if ((!o.isPlayer && !o.active) || ahead < -4 || o.speed > 2.0) { car.avoidObs = null; car.avoidOff = 0; }
        else desiredSpeed = Math.min(desiredSpeed, 3.0);
      } else if (obs && nearest < 12 && car.speed < 1.5 && car.waitT > 1.5 && distToNode > 18 &&
                 (obs.isPlayer ? obs.speed < 0.6 : (obs.crashTimer > 0 && obs.speed < 0.6)) && !car.why.match(/sig|stop|box/)) {
        const laneLat = laneLateral(car.width, car.lanes, car.laneIndex, car.oneWay);
        const halfW = car.width / 2 - 0.9;
        const need = Math.max(0.8, 2.4 - Math.abs(obsLat));
        const dirs = obsLat >= 0 ? [-1, 1] : [1, -1];
        for (const dir of dirs) {
          const off = dir * need, tLat = laneLat + off;
          if (tLat > halfW || tLat < -halfW) continue;
          if (!car.oneWay && tLat < 0.2) {
            // the oncoming side must be empty
            let bad = false;
            for (const o of nb) {
              if (o === car) continue;
              const dx = px(o) - curX, dz = pz(o) - curZ, ahead = dx * ch + dz * sh, lat = -dx * sh + dz * ch;
              if (ahead > -6 && ahead < 40 && Math.abs(lat - off) < 2.6 && Math.cos((o.hdg ?? heading) - heading) < 0) { bad = true; break; }
            }
            if (bad) continue;
          }
          let side = false;
          for (const o of nbC) {
            if (o === car || o === obs) continue;
            const dx = px(o) - curX, dz = pz(o) - curZ, ahead = dx * ch + dz * sh, lat = -dx * sh + dz * ch;
            if (ahead > -5 && ahead < 10 && Math.abs(lat - off) < 2.3) { side = true; break; }
          }
          if (side) continue;
          car.avoidObs = obs; car.avoidOff = off;
          break;
        }
      }

      // Stuck-breaker: a queue that is not waiting on a signal and isn't moving is a deadlock;
      // after a while the cars involved briefly slip through each other.
      car.waitT = car.speed < 0.3 ? car.waitT + dt : 0;
      if (car.honkCool > 0) car.honkCool -= dt;
      if (car.blockedBy === playerObs && car.waitT > 2 && !(car.honkCool > 0) && !car.knock) { events.push({ t: 'honk', x: car.mesh.position.x, z: car.mesh.position.z, type: car.type, seed: car.seed }); car.honkCool = 4.5 + Math.random() * 5; }
      if (car.ghost > 0) car.ghost -= dt;
      if (car.speed < 0.3 && (car.why === 'ahead' || car.why === 'box') && !waitingLegit(car)) {
        car.blockedT += dt;
        if (car.blockedT > 9) { car.ghost = 7; car.blockedT = 0; car.blockedBy = null; }
      } else car.blockedT = 0;

      // Rammed by the player, or touching it: stop where it is, hazards flashing.
      const emergency = obs && car.speed > desiredSpeed + 0.5;
      if (car.crashTimer > 0) {
        car.crashTimer -= dt;
        desiredSpeed = 0; car.why = 'crash';
        car.speed = Math.max(0, car.speed - 20 * dt);
      } else if (emergency) {
        car.speed = Math.max(desiredSpeed, car.speed - car.veh.brake * dt);
      } else {
        // ease toward the wanted speed, but never faster than this vehicle can accelerate or brake
        const dv = (desiredSpeed - car.speed) * Math.min(1, dt * 2.2);
        car.speed += Math.max(-car.veh.brake * dt, Math.min(car.veh.accel * dt, dv));
      }
      if (car.speed < 0.05) car.speed = 0;
      car.braking = car.crashTimer > 0 || car.speed - desiredSpeed > 0.4 || car.speed < 0.2;

      let carry = null;
      if (car.conn) {
        car.conn.cs += car.speed * dt;
        if (car.conn.cs >= car.conn.length) carry = car.conn.cs - car.conn.length;
      } else {
        car.s += car.speed * dt;
        if (isJunction && car.nextEdge && car.s >= len - clr && car.s < len + 5) tryStartConn(car, clr);
        if (!car.conn && car.s >= len) carry = car.s - len;
      }
      if (carry !== null) {
        const c = car.conn;
        const next = c ? c.next : (car.nextEdge || pickNextEdge(car.to, car.from, car));
        if (!next) {
          const justDriven = (edgesByNode[car.to] || []).find(e => otherEnd(e, car.to) === car.from);
          if (!justDriven || !justDriven.oneWay) {
            const tmp = car.from; car.from = car.to; car.to = tmp;
          }
        } else {
          car.from = car.to;
          car.to = otherEnd(next, car.from);
          car.prevType = car.edge && car.edge.type; car.edge = next;
          car.stopCleared = false; car.dwell = 0; car.dwellNeeded = 1.0 + Math.random() * 1.2;
          car.targetSpeed = (typeSpeed[next.type] || 8) * car.veh.speedMul * (next.type === 'highway' ? (car.pace || 1) : 1) * (car.siren ? 1.3 : 1);
          car.width = next.width || 9;
          car.lanes = Math.max(1, next.lanes || 1);
          car.oneWay = !!next.oneWay;
          car.avoidObs = null; car.avoidOff = 0;
        }
        car.path = pathFor(car.edge, car.from, car.to);
        if (c) {
          car.s = c.endS + carry; car.nextEdge = c.nn; car.laneIndex = c.laneB; car.lat = c.latB; car.conn = null;
        } else {
          car.s = Math.min(carry, car.path.length * 0.5);
          car.nextEdge = pickNextEdge(car.to, car.from, car);
          car.laneIndex = chooseLaneIndex(car);
        }
      }

      // Slide toward the wanted lane (plus any detour round an obstacle).
      const wantLat = laneLateral(car.width, car.lanes, car.laneIndex, car.oneWay) + car.avoidOff;
      const maxLat = (car.avoidObs ? 3.0 : 2.5) * dt;
      const prevLat = car.lat;
      let pos, x, z;
      if (car.conn) {
        pos = connSample(car.conn); x = pos.x; z = pos.z; car.latVel = 0;
      } else {
        // eased lateral motion: velocity chases the wanted lane and is itself low-pass filtered,
        // so lane changes start and finish gently (no instantaneous sideways kick)
        const maxV = car.avoidObs ? 3.0 : 2.2;
        const vWant = Math.max(-maxV, Math.min(maxV, (wantLat - car.lat) * 1.8));
        car.latVel = (car.latVel || 0) + (vWant - (car.latVel || 0)) * (1 - Math.exp(-dt * 3));
        car.lat += car.latVel * dt;
        pos = sampleAt(car.path, car.s);
        const off = offsetVec(pos.heading, car.lat);
        x = pos.x + off.x; z = pos.z + off.z;
      }
      car.hdg = pos.heading;
      const y = heightAt ? heightAt(x, z, car.mesh.position.y) : 0;
      car.mesh.position.set(x, y, z);
      // level of detail by distance to the player: full model close up, one box beyond ~130 u, nothing past ~430 u
      if (lastPlayer) {
        const ddx = x - lastPlayer.x, ddz = z - lastPlayer.z, d2 = ddx * ddx + ddz * ddz;
        const far = d2 > (car.far ? 115 * 115 : 135 * 135);
        const uu = car.mesh.userData;
        if (far !== car.far || car._lodInit !== true) { car.far = far; car._lodInit = true; uu.full.visible = !far; uu.lite.visible = far; }
        if (far) { const vis = d2 < 430 * 430; if (uu.lite.visible !== vis) uu.lite.visible = vis; }
      }

      // Body yaw follows the path heading, plus the yaw of a lane change, smoothed.
      const ds = car.speed * dt;
      let target = pos.heading;
      if (!car.conn) target += Math.max(-0.5, Math.min(0.5, Math.atan2(car.latVel || 0, Math.max(car.speed, 0.8))));
      if (car.visualHeading === undefined) car.visualHeading = target;
      car.visualHeading += normalizeAngle(target - car.visualHeading) * (1 - Math.exp(-dt * 10));
      const mh = Math.atan2(Math.cos(car.visualHeading), Math.sin(car.visualHeading));
      car.mesh.rotation.y = mh;

      if (heightAt && !car.far) {
        const fx = Math.sin(mh), fz = Math.cos(mh);
        const frontY = heightAt(x + fx * 1.7, z + fz * 1.7, y), rearY = heightAt(x - fx * 1.7, z - fz * 1.7, y);
        car.mesh.rotation.x = Math.atan2(rearY - frontY, 3.4);
      }

      if (car.wheels && !car.far) {
        const wheelSpin = (car.speed * dt) / (car.mesh.userData.wheelR || 0.4);
        car.wheels.forEach(w => { w.rotation.x += wheelSpin; });
      }

      const u = car.mesh.userData;
      u.tailMat.emissiveIntensity = car.braking ? 2.6 : 1.0;
      setGlow(u.tailPool, car.braking ? 0.3 : 0.08);
      u.tailHalos.forEach(h => { h.material.opacity = car.braking ? 0.75 : 0.22; h.visible = true; });
      setGlow(u.headPool, 0.4);
      const hazardOn = car.crashTimer > 0 && Math.floor(now / 330) % 2 === 0;
      u.hazardMat.emissiveIntensity = hazardOn ? 3 : 0;
      u.hazardHalos.forEach(h => { h.material.opacity = hazardOn ? 0.9 : 0; h.visible = hazardOn; });
      if (u.svc && !car.far) u.svc.flash(!!car.siren || (car.svc === 'plow' && car.plowing), now / 1000);

      syncColliders(car, x, z, mh);
    });

    // Hard backstop against overlapping AI vehicles (skipped for cars in deadlock-breaker mode
    // and for knocked ones, which the physics above already handles).
    for (let i = 0; i < act.length; i++) {
      const nbA = act[i]._nb || [];
      for (let jj = 0; jj < nbA.length; jj++) {
        const A = act[i], B = nbA[jj];
        if (B._ai <= i) continue;
        if (A.ghost > 0 || B.ghost > 0) continue;
        const reach = (A.len + B.len) / 2 + 1;
        if (Math.abs(A.mesh.position.y - B.mesh.position.y) > 3.5) continue;
        if (Math.abs(A.mesh.position.x - B.mesh.position.x) > reach || Math.abs(A.mesh.position.z - B.mesh.position.z) > reach) continue;
        let done = false;
        for (const ca of A.colliders) {
          for (const cb of B.colliders) {
            const dx = cb.x - ca.x, dz = cb.z - ca.z, d = Math.hypot(dx, dz), minD = ca.radius + cb.radius;
            if (d > 0.0001 && d < minD) {
              const nx = dx / d, nz = dz / d, ov = (minD - d) / 2;
              const wa = A.knock ? 0 : B.mass / (A.mass + B.mass), wb = B.knock ? 0 : A.mass / (A.mass + B.mass);
              const tot = (wa + wb) || 1;
              const mvA = ov * 2 * wa / tot, mvB = ov * 2 * wb / tot;
              A.mesh.position.x -= nx * mvA; A.mesh.position.z -= nz * mvA;
              B.mesh.position.x += nx * mvB; B.mesh.position.z += nz * mvB;
              if (A.knock) { A.knock.x = A.mesh.position.x; A.knock.z = A.mesh.position.z; }
              if (B.knock) { B.knock.x = B.mesh.position.x; B.knock.z = B.mesh.position.z; }
              A.speed *= 0.5; B.speed *= 0.5;
              syncColliders(A, A.mesh.position.x, A.mesh.position.z, A.mesh.rotation.y);
              syncColliders(B, B.mesh.position.x, B.mesh.position.z, B.mesh.rotation.y);
              done = true; break;
            }
          }
          if (done) break;
        }
      }
    }
  }

  // Density control: the pool is built once; this shows the first `n` cars and hides the
  // rest (hidden cars don't move, collide or light the road). Newly shown cars appear at
  // a random spot well away from the player.
  function setCount(n) {
    n = Math.max(0, Math.min(maxCount, Math.round(n)));
    const pool = cars.filter(c => !c.line && !c.svc);
    // the pool is built on demand (a phone that never raises the slider never pays for the cars)
    while (pool.length < n && drivable.length) {
      const edge = edgeFor(TYPE_CYCLE[cars.length % TYPE_CYCLE.length]);
      const car = spawnOn(edge, edge.oneWay ? false : Math.random() < 0.5);
      car.active = false; car.mesh.visible = false; car.colliders.forEach(c => { c.blocksCar = false; c.x = 1e6; c.z = 1e6; });
      car.colliders.forEach(c => { colliderList.push(c); if (sink) sink.push(c); });
      pool.push(car);
    }
    pool.forEach((car, i) => {
      const want = i < n;
      if (want === car.active) return;
      car.active = want;
      car.mesh.visible = want;
      car.colliders.forEach(c => { c.blocksCar = want; });
      if (!want) { car.colliders.forEach(c => { c.x = 1e6; c.z = 1e6; }); return; }
      for (let tries = 0; tries < 30; tries++) {
        const edge = edgeFor(car.type);
        place(car, edge, edge.oneWay ? false : Math.random() < 0.5);
        const pos = sampleAt(car.path, car.s);
        const px = lastPlayer ? lastPlayer.x : 1e6, pz = lastPlayer ? lastPlayer.z : 1e6;
        if (Math.hypot(pos.x - px, pos.z - pz) > 70) break;
      }
    });
  }
  const colliderList = cars.flatMap(c => c.colliders).concat(stationColliders); let sink = null;
  const activeCount = () => cars.filter(c => c.active && !c.line && !c.svc).length;
  cars.forEach((c, i) => { if (i >= count && !c.line && !c.svc) { c.active = false; c.mesh.visible = false; c.colliders.forEach(k => { k.blocksCar = false; k.x = 1e6; k.z = 1e6; }); } });

  return { update, events, colliders: colliderList, cars, svcCars, setPlows, setCount, activeCount, maxCount, setSink(arr) { sink = arr; } };
}
