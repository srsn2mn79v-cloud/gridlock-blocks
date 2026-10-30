// Pedestrians. Can they be hit? No — by two independent guarantees:
//
//   1. They're never added to the collision world (see collision.js / main.js). There
//      is no function anywhere that tests the car's position against a pedestrian's.
//   2. Their visible position is purely cosmetic steering on top of that: it can wander
//      off their intended path (crossing a road, dodging the car, standing at a bus
//      stop) but none of that visible motion is ever checked against the car. Don't
//      "fix" a weird-looking dodge by adding a car/pedestrian distance check anywhere
//      outside this file — that's the one thing that would undermine guarantee #1.
//
// Behavior: pedestrians walk a graph built from sidewalk segments (sidewalks.js). At
// each intersection corner, a direct "crossing" link lets them step out across that
// specific road, gated by that approach's traffic signal if one exists (signals.js) —
// otherwise they just pause briefly ("look both ways") before crossing. They
// occasionally detour to a nearby bus stop prop and stand there for a while — a
// placeholder for an actual bus/transit system later. When the car actually drives up onto the
// pavement towards them they turn to look, brace, and (only if it keeps coming) jump clear;
// if it never gets close they relax and walk on. A car merely passing on the road never
// triggers anything.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildSidewalkSegments } from './sidewalks.js';
import { findSignalForApproach, isApproachClear, redRemainingMs } from './signals.js';
import { buildEdgesByNode, intersectionClearance } from './roadMath.js';

// Brisk walk/jog while on the road, and the time a crossing needs, so nobody steps out
// with too little red left and gets caught mid-road.
const CROSS_SPEED = 2.4;
const crossMs = link => (link.length || 12) / CROSS_SPEED * 1000 + 600;

// Walk cycle: legs and arms swing in opposite phase, body bobs twice per cycle and sways
// once. `moving` false eases everything to a relaxed idle pose.
function animate(p, dt, moving, speed) {
  const r = p.rig;
  p.amp += ((moving ? 1 : 0) - p.amp) * Math.min(1, dt * 7);
  if (moving) p.phase += dt * speed * 4.6;
  const a = p.amp, run = speed > 1.5 ? 1.35 : 1;
  const sw = Math.sin(p.phase);
  r.legL.rotation.x = sw * 0.55 * a * run;
  r.legR.rotation.x = -sw * 0.55 * a * run;
  r.armL.rotation.x = -sw * 0.5 * a * run;
  r.armR.rotation.x = sw * 0.5 * a * run;
  r.armL.rotation.z = r.armR.rotation.z = 0;
  r.armL.rotation.z = 0.06; r.armR.rotation.z = -0.06;
  r.body.position.y = Math.abs(Math.cos(p.phase)) * 0.035 * a;
  r.body.rotation.z = sw * 0.035 * a;
  r.body.rotation.y = -sw * 0.08 * a;
  // reactions: brace (arms up, weight back, knees bent) and the jump itself
  const b = p.brace || 0;
  if (b > 0.01) {
    r.armL.rotation.x = r.armL.rotation.x * (1 - b) + (-1.35) * b; r.armR.rotation.x = r.armR.rotation.x * (1 - b) + (-1.2) * b;
    r.armL.rotation.z = r.armL.rotation.z * (1 - b) + 0.5 * b; r.armR.rotation.z = r.armR.rotation.z * (1 - b) + (-0.5) * b;
    r.legL.rotation.x = r.legL.rotation.x * (1 - b) + 0.3 * b; r.legR.rotation.x = r.legR.rotation.x * (1 - b) - 0.25 * b;
    r.body.rotation.x = -0.16 * b; r.body.position.y -= 0.04 * b;
  } else r.body.rotation.x = 0;
  const j = p.jumpPose || 0;
  if (j > 0.01) {
    r.armL.rotation.x = -2.3 * j + r.armL.rotation.x * (1 - j); r.armR.rotation.x = -2.0 * j + r.armR.rotation.x * (1 - j);
    r.legL.rotation.x = -0.9 * j + r.legL.rotation.x * (1 - j); r.legR.rotation.x = 0.55 * j + r.legR.rotation.x * (1 - j);
    r.body.rotation.z = (p.jumpDir || 1) * 0.35 * j; r.body.rotation.x = 0.12 * j;
  }
}

function dist(x1, z1, x2, z2) { return Math.hypot(x1 - x2, z1 - z2); }

// ---------------------------------------------------------------------------------
// Pedestrian look. A small pool of shared "variants" (body + arm + leg geometries with
// baked vertex colours, one shared material) is built once; each pedestrian is a root
// Group -> body Mesh -> four limb Meshes parented at the shoulder/hip pivots (5 meshes,
// ~330 tris). Per-ped height/width comes from the root's scale, so nothing is allocated
// per pedestrian beyond the Group/Mesh objects themselves.
// ---------------------------------------------------------------------------------
const SKIN = [0xf1c9a5, 0xe0ac82, 0xc68863, 0x9a6648, 0x6e4430, 0x4a2e22];
const HAIR = [0x1c1410, 0x3b2616, 0x6a4424, 0xa87b3c, 0xd4b46a, 0x8a3a22, 0x6c6c70];
const SHIRT = [0xc94a3a, 0x3a6fb0, 0x3f9a62, 0xe0b73a, 0xf0f0ea, 0x7a4aa8, 0xd9772f, 0x2e2e36, 0x4aa8b0, 0xd46a8e, 0x8a8f96];
const PANTS = [0x2a3550, 0x3a3a3f, 0x5a4632, 0x7a6a50, 0x1f2a44, 0x4a5a3a, 0x6a6e78];
const SHOES = [0x1a1a1a, 0xf0f0f0, 0x5a3a24, 0x2a3a6a, 0xb03a2a];
const pick = a => a[Math.floor(Math.random() * a.length)];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitSphere = new THREE.SphereGeometry(1, 8, 6);

function colored(geo, hex, x, y, z, sx, sy, sz, rx = 0) {
  const g = geo.clone();
  _e.set(rx, 0, 0);
  _q.setFromEuler(_e);
  g.applyMatrix4(_m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)));
  _c.setHex(hex);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const box = (c, x, y, z, w, h, d) => colored(unitBox, c, x, y, z, w, h, d);
const ball = (c, x, y, z, rx, ry, rz) => colored(unitSphere, c, x, y, z, rx, ry, rz);
// Tapered cylinder (rTop -> rBot over len), centred at (x,y,z), tilted by rx about X.
function cyl(c, rTop, rBot, len, x, y, z, rx = 0, seg = 7) {
  return colored(new THREE.CylinderGeometry(rTop, rBot, len, seg, 1), c, x, y, z, 1, 1, 1, rx);
}
function merge(list) {
  const g = mergeGeometries(list);
  list.forEach(l => l.dispose());
  return g;
}

function makeVariant() {
  const child = Math.random() < 0.14;
  const female = Math.random() < 0.5;
  const skin = pick(SKIN);
  const shirt = pick(SHIRT);
  const pants = pick(PANTS);
  const shoe = pick(SHOES);
  const build = (female ? 0.9 : 1.0) * (0.92 + Math.random() * 0.25);   // width factor
  const hs = child ? 1.3 : 1.12;                                            // bigger head on kids
  const hairCol = pick(HAIR);
  const outfit = child ? (Math.random() < 0.5 ? 'shorts' : 'long') : (female && Math.random() < 0.35 ? 'dress' : (Math.random() < 0.25 ? 'shorts' : 'long'));
  const jacket = !child && Math.random() < 0.3;
  const topCol = jacket ? pick(PANTS.concat(SHIRT.slice(0, 4))) : shirt;
  const shortSleeve = !jacket && Math.random() < 0.5;
  const legCol = outfit === 'dress' ? (Math.random() < 0.5 ? skin : pants) : pants;

  const tw = 0.2 * build;                      // torso half-width
  const parts = [];
  // pelvis + torso + shoulders + neck
  parts.push(cyl(legCol === skin ? shirt : pants, tw * 0.9, tw * 0.95, 0.16, 0, 0.9, 0, 0, 8));
  parts.push(colored(new THREE.CylinderGeometry(tw * 1.05, tw * 0.85, jacket ? 0.56 : 0.5, 8), topCol, 0, jacket ? 1.12 : 1.14, 0, 1, 1, 0.62));
  for (const sx of [-1, 1]) parts.push(ball(topCol, sx * (tw * 1.05 + 0.02), 1.36, 0, 0.065, 0.065, 0.07));
  parts.push(cyl(skin, 0.045, 0.05, 0.1, 0, 1.43, 0, 0, 6));
  if (outfit === 'dress') parts.push(cyl(shirt === 0xf0f0ea ? 0xd46a8e : shirt, tw * 0.9, tw * 1.55, 0.4, 0, 0.7, 0, 0, 8));
  // head, face, hair, hats
  const hy = 1.43 + 0.05 + 0.115 * hs;
  parts.push(ball(skin, 0, hy, 0, 0.1 * hs, 0.118 * hs, 0.105 * hs));
  for (const sx of [-1, 1]) parts.push(box(0x1a1410, sx * 0.04 * hs, hy + 0.012 * hs, 0.098 * hs, 0.018, 0.022, 0.012));
  parts.push(box(skin, 0, hy - 0.015 * hs, 0.108 * hs, 0.02, 0.03, 0.02));
  const hat = Math.random() < 0.25 ? pick(['cap', 'beanie', 'wide']) : null;
  const hair = child ? pick(['short', 'pony', 'short']) : pick(['bald', 'short', 'short', 'long', 'pony', 'afro']);
  if (hat !== 'beanie' && hat !== 'cap' && hat !== 'wide') {
    if (hair === 'short' || hair === 'long' || hair === 'pony') parts.push(ball(hairCol, 0, hy + 0.025 * hs, -0.012 * hs, 0.108 * hs, 0.108 * hs, 0.112 * hs));
    if (hair === 'long') parts.push(box(hairCol, 0, hy - 0.1 * hs, -0.075 * hs, 0.19 * hs, 0.25 * hs, 0.05));
    if (hair === 'pony') parts.push(ball(hairCol, 0, hy - 0.03 * hs, -0.13 * hs, 0.04, 0.07, 0.04));
    if (hair === 'afro') parts.push(ball(hairCol, 0, hy + 0.035 * hs, -0.01, 0.14 * hs, 0.14 * hs, 0.14 * hs));
  } else {
    // hat sits over a bit of hair at the back
    parts.push(ball(hairCol, 0, hy + 0.0, -0.025 * hs, 0.104 * hs, 0.1 * hs, 0.108 * hs));
    const hc = pick(SHIRT);
    if (hat === 'cap') {
      parts.push(ball(hc, 0, hy + 0.045 * hs, 0, 0.112 * hs, 0.1 * hs, 0.118 * hs));
      parts.push(box(hc, 0, hy + 0.05 * hs, 0.12 * hs, 0.17 * hs, 0.012, 0.09));
    } else if (hat === 'beanie') {
      parts.push(ball(hc, 0, hy + 0.05 * hs, 0, 0.113 * hs, 0.105 * hs, 0.115 * hs));
    } else {
      parts.push(ball(hc, 0, hy + 0.06 * hs, 0, 0.1 * hs, 0.07 * hs, 0.105 * hs));
      parts.push(cyl(hc, 0.2 * hs, 0.2 * hs, 0.012, 0, hy + 0.055 * hs, 0, 0, 10));
    }
  }
  // bags
  const bag = !child ? Math.random() : Math.random() * 0.5;
  const bagCol = pick([0x2a2a30, 0xb03a2a, 0x2a3a6a, 0x5a3a24, 0x3a6a4a]);
  if (bag < 0.28) parts.push(box(bagCol, 0, 1.15, -0.16, 0.26 * build, 0.34, 0.12));
  else if (bag < 0.42) {
    parts.push(box(bagCol, 0.3 * build, 0.82, 0.02, 0.07, 0.2, 0.22));
  }
  // extra variety: sunglasses, scarf, hood, shoulder strap, tall/short builds
  if (Math.random() < 0.18) parts.push(box(0x0c0c10, 0, hy + 0.012 * hs, 0.108 * hs, 0.17 * hs, 0.03, 0.02));
  if (!child && Math.random() < 0.14) parts.push(cyl(pick([0xc94a3a, 0x2e2e36, 0xe0b73a, 0x3a6fb0]), tw * 0.75, tw * 0.8, 0.09, 0, 1.4, 0, 0, 8));
  if (!child && jacket && Math.random() < 0.4) parts.push(ball(topCol, 0, 1.42, -0.07, 0.11, 0.07, 0.08));
  if (!child && Math.random() < 0.12) parts.push(box(pick([0x2a2a30, 0xb03a2a, 0x5a3a24]), 0.04, 1.2, 0, 0.03, 0.55, 0.3 * build));
  const body = merge(parts);

  // Limbs: origin at the pivot (shoulder / hip), hanging down -Y.
  const armParts = [];
  const sleeveLen = shortSleeve ? 0.15 : 0.28;
  armParts.push(cyl(topCol, 0.052, 0.045, sleeveLen, 0, -sleeveLen / 2 + 0.02, 0));
  if (shortSleeve) armParts.push(cyl(skin, 0.045, 0.04, 0.14, 0, -sleeveLen - 0.05 + 0.02, 0));
  const bend = -0.3, fl = 0.26;
  armParts.push(cyl(jacket || !shortSleeve ? topCol : skin, 0.045, 0.036, fl, 0, -0.28 - (fl / 2) * Math.cos(bend), -(fl / 2) * Math.sin(bend), bend));
  armParts.push(ball(skin, 0, -0.28 - fl * Math.cos(bend) - 0.02, -fl * Math.sin(bend), 0.04, 0.05, 0.035));
  const arm = merge(armParts);

  const legParts = [];
  const shorts = outfit === 'shorts';
  const thighCol = outfit === 'dress' ? legCol : pants;
  legParts.push(cyl(thighCol, 0.082, 0.062, 0.44, 0, -0.22, 0));
  legParts.push(cyl(shorts || outfit === 'dress' && legCol === skin ? skin : pants, 0.062, 0.05, 0.4, 0, -0.64, 0));
  if (shorts) legParts[0] = cyl(skin, 0.082, 0.062, 0.44, 0, -0.22, 0), legParts.push(cyl(pants, 0.092, 0.088, 0.22, 0, -0.11, 0));
  legParts.push(box(shoe, 0, -0.84, 0.05, 0.1, 0.075, 0.26));
  const leg = merge(legParts);
  const shoulderX = tw * 1.05 + 0.02;
  // standing pose merged into one mesh: what a pedestrian is drawn as when it is further than ~60 u away (1 draw call instead of 5)
  const lp = [];
  const put = (g, x, y) => { const c = g.clone(); c.translate(x, y, 0); lp.push(c.index ? c.toNonIndexed() : c); };
  put(body, 0, 0); put(leg, -0.1, HIP_Y); put(leg, 0.1, HIP_Y); put(arm, -shoulderX - 0.03, SHOULDER_Y); put(arm, shoulderX + 0.03, SHOULDER_Y);
  const lite = mergeGeometries(lp); lp.forEach(g => g.dispose());
  return { body, arm, leg, lite, child, female, tw, shoulderX };
}

const HIP_Y = 0.9, SHOULDER_Y = 1.36;
const pedMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
let variants = null;

function personMesh() {
  if (!variants) { variants = []; for (let i = 0; i < 72; i++) variants.push(makeVariant()); }
  const v = pick(variants);
  const root = new THREE.Group();
  const body = new THREE.Mesh(v.body, pedMaterial);
  body.castShadow = true;
  const mk = (geo, x, y) => { const m = new THREE.Mesh(geo, pedMaterial); m.position.set(x, y, 0); body.add(m); return m; };
  const legL = mk(v.leg, -0.1, HIP_Y), legR = mk(v.leg, 0.1, HIP_Y);
  const armL = mk(v.arm, -v.shoulderX - 0.03, SHOULDER_Y), armR = mk(v.arm, v.shoulderX + 0.03, SHOULDER_Y);
  root.add(body);
  const lite = new THREE.Mesh(v.lite, pedMaterial); lite.visible = false; root.add(lite);
  // modelled ~1.75 u tall; 1 u = 1.25 m, so a man is ~1.8 m (scale .82), a woman ~1.65 m (.75), a child ~1.2-1.4 m
  const h = v.child ? 0.5 + Math.random() * 0.14 : (v.female ? 0.74 : 0.81) * (0.93 + Math.random() * 0.15);
  root.scale.setScalar(h);
  root.userData.rig = { body, legL, legR, armL, armR, lite };
  return root;
}

// A waypoint per distinct sidewalk endpoint, linked by the sidewalk segments
// themselves plus a direct "cross" link between the two sides of each road edge at
// each end — i.e. a jaywalk-this-specific-street-here connection, tagged with the two
// road nodes so it can be checked against that approach's signal.
function buildGraph(cityData) {
  const segments = buildSidewalkSegments(cityData, { cut: false });
  const waypoints = [];
  const byKey = new Map();
  function waypointAt(x, z, elevation) {
    const k = Math.round(x * 4) + ',' + Math.round(z * 4);
    if (byKey.has(k)) return byKey.get(k);
    const idx = waypoints.length;
    waypoints.push({ x, z, elevation, links: [] });
    byKey.set(k, idx);
    return idx;
  }
  function link(a, b, extra) {
    if (a === b) return;
    const length = Math.hypot(waypoints[a].x - waypoints[b].x, waypoints[a].z - waypoints[b].z);
    waypoints[a].links.push({ to: b, length, ...extra });
    waypoints[b].links.push({ to: a, length, ...extra });
  }

  segments.forEach(seg => {
    const a = waypointAt(seg.x1, seg.z1, seg.elevation);
    const b = waypointAt(seg.x2, seg.z2, seg.elevation);
    link(a, b, { kind: 'sidewalk' });
  });

  const byEdgeEnd = new Map();
  segments.forEach(seg => {
    const startIdx = waypointAt(seg.x1, seg.z1, seg.elevation);
    const endIdx = waypointAt(seg.x2, seg.z2, seg.elevation);
    const startKey = seg.fromNode + '@' + seg.toNode;
    const endKey = seg.toNode + '@' + seg.fromNode;
    (byEdgeEnd.get(startKey) || byEdgeEnd.set(startKey, []).get(startKey))
      .push({ idx: startIdx, nodeId: seg.fromNode, otherNodeId: seg.toNode, edgeId: seg.edgeId });
    (byEdgeEnd.get(endKey) || byEdgeEnd.set(endKey, []).get(endKey))
      .push({ idx: endIdx, nodeId: seg.toNode, otherNodeId: seg.fromNode, edgeId: seg.edgeId });
  });
  // Only cross where roads.js paints a crosswalk (true intersection end, same test as the paint)
  const nodesById = cityData.roadNodes, ebn = buildEdgesByNode(cityData.roadEdges), eById = new Map(cityData.roadEdges.map(e => [e.id, e]));
  const painted = (edgeId, nodeId) => {
    const e = eById.get(edgeId); if (!e) return false;
    const na = nodesById[e.from], nb = nodesById[e.to]; if (!na || !nb) return false;
    const thru = id => e.type === 'highway' && (ebn[id] || []).every(o => o === e || o.ramp || o.type === 'highway' && (ebn[id] || []).length === 3);
    const ramp = id => e.ramp && (ebn[id] || []).some(o => o.type === 'highway');
    const isX = id => (ebn[id] || []).length >= 3 && !thru(id);
    const cl = id => isX(id) ? (ramp(id) ? 18 : intersectionClearance(id, e, ebn)) : 0;
    return isX(nodeId) && cl(e.from) + cl(e.to) < dist(na.x, na.z, nb.x, nb.z) - 2;
  };
  byEdgeEnd.forEach((list, key) => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!list[i].edgeId || !painted(list[i].edgeId, list[i].nodeId)) continue;
        link(list[i].idx, list[j].idx, {
          kind: 'cross', nodeId: list[i].nodeId, otherNodeId: list[i].otherNodeId
        });
      }
    }
  });

  // Walk-around-the-corner links: at an intersection each street's sidewalk ends right
  // beside the next street's sidewalk end (both stop at the crossing street's pavement
  // edge, see sidewalks.js), so join any two ends from *different* edges at the same node
  // that sit within a couple of units — that's the curb corner. Without these a pedestrian
  // could only ever shuttle up and down one street, crossing it at each end.
  const cornerEnds = new Map();
  segments.forEach(seg => {
    [[seg.x1, seg.z1, seg.fromNode], [seg.x2, seg.z2, seg.toNode]].forEach(([x, z, nodeId]) => {
      const idx = waypointAt(x, z, seg.elevation);
      (cornerEnds.get(nodeId) || cornerEnds.set(nodeId, []).get(nodeId))
        .push({ idx, x, z, edgeId: seg.edgeId });
    });
  });
  cornerEnds.forEach(list => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i], B = list[j];
        if (A.edgeId === B.edgeId || A.idx === B.idx) continue;
        if (dist(A.x, A.z, B.x, B.z) < 2.2) link(A.idx, B.idx, { kind: 'sidewalk' });
      }
    }
  });

  return waypoints;
}

function pickNextLink(waypoints, currentIdx, cameFromIdx) {
  const all = waypoints[currentIdx].links;
  if (all.length === 0) return null;
  const notBack = all.filter(l => l.to !== cameFromIdx);
  const pool = notBack.length ? notBack : all;
  return pool[Math.floor(Math.random() * pool.length)];
}

function posOnLink(waypoints, fromIdx, toIdx, t) {
  const a = waypoints[fromIdx], b = waypoints[toIdx];
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    elevation: a.elevation + (b.elevation - a.elevation) * t
  };
}

function nearestBusStopWithin(point, busStops, maxDist) {
  let best = null, bestD = maxDist;
  busStops.forEach(b => {
    const d = dist(point.x, point.z, b.x, b.z);
    if (d < bestD) { bestD = d; best = b; }
  });
  return best;
}

export function createPedestrianSystem(cityData, scene, count = 14, maxCount = count) {
  const waypoints = buildGraph(cityData);
  const busStops = (cityData.props || []).filter(p => p.type === 'busstop');
  const peds = [];

  // pedestrians are created on demand (the pool grows when the density slider goes up), up to maxCount
  function spawnOne(active) {
    if (!waypoints.length) return null;
    const start = Math.floor(Math.random() * waypoints.length);
    const link0 = waypoints[start].links[Math.floor(Math.random() * waypoints[start].links.length)];
    if (!link0) return null;
    const mesh = personMesh();
    scene.add(mesh);
    const p = {
      mesh, active, from: start, to: link0.to, link: link0, t: Math.random(),
      speed: 0.42 + Math.random() * 0.62 + (Math.random() < 0.08 ? 0.5 : 0),   // dawdlers to hurried joggers
      lat: (Math.random() - 0.5) * 1.0 + 0.12, wobble: Math.random() * 6.28, wobAmp: 0.04 + Math.random() * 0.1, pace: 0.9 + Math.random() * 0.2, pause: 0,
      react: 'none', reactT: 0, ox: 0, oz: 0, vox: 0, voz: 0, jy: 0, brace: 0, jumpPose: 0, jumpDir: 1, yaw: 0,
      state: 'walk',   // 'walk' | 'waitSignal' | 'waitLook' | 'waitStop'
      busStopTimer: 0, lookTimer: 0, renderX: undefined, renderZ: undefined, lod: 0,
      rig: mesh.userData.rig, phase: Math.random() * 6.28, amp: 0, gait: 0
    };
    mesh.visible = active; peds.push(p); return p;
  }
  for (let i = 0; i < count; i++) spawnOne(true);
  const CAP = Math.max(count, maxCount);

  // keep the crowd around the player: walkers left far behind are moved to a pavement near (not on top of) them
  let pedRR = 0;
  function recyclePeds(car) {
    for (let n = 0; n < 6; n++) {
      const p = peds[pedRR++ % peds.length];
      if (!p || !p.active) continue;
      const m = p.mesh.position;
      if (Math.hypot(m.x - car.x, m.z - car.z) < 330) continue;
      for (let tries = 0; tries < 30; tries++) {
        const i = Math.floor(Math.random() * waypoints.length), w = waypoints[i];
        const d = Math.hypot(w.x - car.x, w.z - car.z);
        if (d < 35 || d > 260 || !w.links.length) continue;
        const l = w.links[Math.floor(Math.random() * w.links.length)];
        p.from = i; p.to = l.to; p.link = l; p.t = Math.random(); p.state = 'walk'; p.renderX = undefined; p.renderZ = undefined; p.react = 'none'; p.ox = p.oz = p.jy = 0;
        break;
      }
    }
  }

  // 0 = full rig, 1 = single merged mesh (no limb animation), 2 = hidden
  function setLod(p, d) {
    const l = d < 70 ? 0 : d < 230 ? 1 : 2;
    if (l === p.lod) return; p.lod = l;
    const r = p.rig;
    p.mesh.visible = l < 2 && p.active;
    r.body.visible = l === 0; r.lite.visible = l === 1;
  }

  function update(dt, car) {
    const now = performance.now(), tNow = now / 1000;
    if (car && car.x < 4000 && car.y > -1.2) recyclePeds(car);

    peds.forEach(p => {
      if (!p.active) return;
      if (p.state === 'waitStop') {
        p.busStopTimer -= dt;
        if (p.busStopTimer <= 0) p.state = 'walk';
        if (p.lod < 2) animate(p, dt, false, 0);
        return;
      }

      // Waiting (red light / looking both ways) only stops the pedestrian *advancing* along
      // their path — they still go through the position update below. Skipping it entirely,
      // as this used to, froze anyone who'd just been shoved off the curb by a passing car
      // wherever they landed, so they'd stand waiting in the middle of the street.
      let waiting = false;
      const onCross = p.link && p.link.kind === 'cross';
      const spd = onCross ? Math.max(p.speed, CROSS_SPEED) : p.speed * p.pace;
      if (p.pause > 0) { p.pause -= dt; waiting = true; }
      if (p.react === 'look' || p.react === 'brace') waiting = true;
      if (p.state === 'waitSignal') {
        const sig = findSignalForApproach(cityData, p.link.nodeId, p.link.otherNodeId);
        if (!sig || (isApproachClear(sig, now) && redRemainingMs(sig, now) >= crossMs(p.link))) p.state = 'walk';
        else waiting = true;
      }
      if (p.state === 'waitLook') {
        p.lookTimer -= dt;
        if (p.lookTimer <= 0) p.state = 'walk';
        else waiting = true;
      }

      if (!waiting) {
        const len = Math.max(0.5, dist(
          waypoints[p.from].x, waypoints[p.from].z, waypoints[p.to].x, waypoints[p.to].z
        ));
        p.t += (spd * (p.link && p.link.kind === 'cross' ? 1 : 0.9 + 0.1 * Math.sin(p.wobble * 3 + tNow * 0.35)) * dt) / len;

        if (p.t >= 1) {
          const arrivedAt = p.to;

          if (Math.random() < 0.08) {
            const stop = nearestBusStopWithin(waypoints[arrivedAt], busStops, 12);
            if (stop) {
              p.state = 'waitStop';
              p.busStopTimer = 5 + Math.random() * 10;
              p.renderX = stop.x; p.renderZ = stop.z;
              p.mesh.position.set(stop.x, waypoints[arrivedAt].elevation, stop.z);
              return;
            }
          }

          if (Math.random() < 0.07) p.pause = 1 + Math.random() * 3.5;   // window-shopping / checking a phone
          const next = pickNextLink(waypoints, arrivedAt, p.from);
          if (!next) { p.t = 1; } else {
            p.from = arrivedAt; p.to = next.to; p.link = next; p.t = 0;
            if (next.kind === 'cross') {
              const sig = findSignalForApproach(cityData, next.nodeId, next.otherNodeId);
              if (sig && !(isApproachClear(sig, now) && redRemainingMs(sig, now) >= crossMs(next))) {
                p.state = 'waitSignal';
              } else if (!sig) {
                // No signal data for this crossing — pause briefly ("look both ways")
                // before stepping out, rather than crossing instantly.
                p.state = 'waitLook';
                p.lookTimer = 0.4 + Math.random() * 0.5;
              }
            }
          }
        }
      }

      const base = posOnLink(waypoints, p.from, p.to, Math.min(1, p.t));
      const ldx = waypoints[p.to].x - waypoints[p.from].x, ldz = waypoints[p.to].z - waypoints[p.from].z, llen = Math.hypot(ldx, ldz) || 1;
      const fx = ldx / llen, fz = ldz / llen;                       // walking direction; right-hand side is (fz, -fx)

      // ---- reaction to a car that has come up onto the pavement ------------------------------
      // The car only counts as "on the pavement" when its centre is within ~1.9 u of this
      // walker's sidewalk centre line (a car driving along the kerb on the road is >= 2.3 u away).
      // Purely cosmetic: nothing here is ever fed back to the car (see header).
      let threat = 0, tx = 0, tz = 0, ttc = 9;
      if (car && !onCross && car.x < 4000 && car.y > -1.2 && p.state !== 'waitStop') {
        const rx = base.x - car.x, rz = base.z - car.z, d = Math.hypot(rx, rz);
        if (d < 17) {
          const sp = Math.hypot(car.vx || 0, car.vz || 0);
          // car distance from the sidewalk line of this link (perpendicular), clamped to the segment
          const cx = car.x - waypoints[p.from].x, cz = car.z - waypoints[p.from].z, al = cx * fx + cz * fz;
          const lat = Math.abs(cx * fz - cz * fx);
          const onWalk = al > -2 && al < llen + 2 && lat < 1.9;
          if (onWalk && sp > 1.2) {
            const vx = (car.vx || 0) / sp, vz = (car.vz || 0) / sp;
            const toward = (rx * vx + rz * vz) / Math.max(d, 0.01);   // >0 when the car heads at the walker
            if (toward > 0.35) { threat = 1; tx = vx; tz = vz; ttc = d / Math.max(sp, 0.1); }
          }
        }
      }
      if (threat) {
        if (p.react === 'none' || p.react === 'recover') { p.react = 'look'; p.reactT = 0; }
        p.reactT += dt;
        if (p.react === 'look' && p.reactT > 0.3) { p.react = 'brace'; p.reactT = 0; }
        if (p.react === 'brace' && ttc < 0.85 && Math.hypot(base.x + p.ox - car.x, base.z + p.oz - car.z) < 6.5) {
          // jump sideways, away from the car's line of travel (to whichever side of it the walker is already on)
          const side = Math.sign((base.x - car.x) * -tz + (base.z - car.z) * tx) || 1;
          const jx = -tz * side, jz = tx * side;
          p.vox = jx * 11; p.voz = jz * 11; p.jumpDir = side; p.react = 'jump'; p.reactT = 0; p.jy = 0;
        }
      } else if (p.react === 'look' || p.react === 'brace') { p.react = 'recover'; p.reactT = 0; }   // false alarm: relax, walk on
      if (p.react === 'jump') {
        p.reactT += dt;
        p.ox += p.vox * dt; p.oz += p.voz * dt; p.vox *= Math.pow(0.02, dt); p.voz *= Math.pow(0.02, dt);
        p.jy = Math.max(0, Math.sin(Math.min(1, p.reactT / 0.5) * Math.PI)) * 0.55;
        if (p.reactT > 0.5) { p.jy = 0; p.react = 'down'; p.reactT = 0; }
      } else if (p.react === 'down') {
        p.reactT += dt; if (p.reactT > 1.1) { p.react = 'recover'; p.reactT = 0; }
      } else if (p.react === 'recover') {
        p.reactT += dt; if (p.reactT > 0.4) p.react = 'none';
      }
      // after a jump the walker eases back to the path; after a false alarm nothing was displaced
      if (p.react !== 'jump') { const k = Math.pow(0.35, dt); p.ox *= k; p.oz *= k; }
      if (p.react === 'down') waiting = true;
      p.brace += ((p.react === 'brace' ? 1 : 0) - p.brace) * Math.min(1, dt * 9);
      p.jumpPose += ((p.react === 'jump' ? 1 : 0) - p.jumpPose) * Math.min(1, dt * 14);

      // ---- own line on the pavement + a little weave, so a crowd never walks in single file --------
      const w = onCross ? 0.25 : p.lat + Math.sin(tNow * 0.6 + p.wobble) * p.wobAmp;
      const targetX = base.x + fz * w + p.ox, targetZ = base.z - fx * w + p.oz;
      const ease = 1 - Math.pow(0.0008, dt);
      p.renderX = p.renderX === undefined ? targetX : p.renderX + (targetX - p.renderX) * ease;
      p.renderZ = p.renderZ === undefined ? targetZ : p.renderZ + (targetZ - p.renderZ) * ease;

      if (p.lod < 2) animate(p, dt, !waiting, spd);
      p.mesh.position.set(p.renderX, base.elevation + p.jy, p.renderZ);
      if (car) setLod(p, Math.hypot(p.renderX - car.x, p.renderZ - car.z));
      // heading: along the path, or turned to face the oncoming car while looking / bracing
      let want = Math.atan2(fx, fz);
      if (car && (p.react === 'look' || p.react === 'brace')) want = Math.atan2(car.x - p.renderX, car.z - p.renderZ);
      else if (p.react === 'jump') want = p.yaw;
      let dyaw = want - p.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      p.yaw += dyaw * Math.min(1, dt * (p.react === 'look' ? 12 : 7));
      p.mesh.rotation.y = p.yaw;
    });
  }

  function setCount(n) {
    n = Math.max(0, Math.min(CAP, Math.round(n)));
    while (peds.length < n) if (!spawnOne(false)) break;
    n = Math.min(n, peds.length);
    peds.forEach((p, i) => { p.active = i < n; p.mesh.visible = p.active && p.lod < 2; });
  }
  return { update, peds, setCount, maxCount: waypoints.length ? CAP : 0 };
}
