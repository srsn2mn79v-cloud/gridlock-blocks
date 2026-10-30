import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  buildHorizontalCurve, buildEdgesByNode, buildVerticalCurves,
  elevationAlongEdge, curveElevationAt, dist, intersectionClearance, buildBanks, edgeBank, cornerBanks
} from '../roadMath.js';
import { hasSidewalks } from '../sidewalks.js';
import { findSignalForApproach } from '../signals.js';
import { createGroundGlow } from '../glow.js';
import { computeStopApproaches, stopKey } from '../junctionRules.js';

const roadColor = { local: 0x3c3f44, avenue: 0x35383e, highway: 0x403e3b };

// Lifts every road surface a hair above its nominal elevation so it never sits exactly
// coplanar with the flat ground plane (which is at y=0) — two coincident flat surfaces
// z-fight, which reads as a flickering moiré pattern wherever a surface-level road
// crosses the ground. A couple of centimeters is invisible but resolves the depth test
// cleanly; terrain.js's height samples don't bother matching it (the gap is smaller
// than the approximation it already documents).
const ROAD_LIFT = 0.03;
const LIFT_BY_TYPE = { local: 0.03, avenue: 0.04, highway: 0.05 }; // stacked so overlapping ribbons at junctions never z-fight
const LANE_LIFT = 0.07; // lane paint sits a hair above the road surface itself

// Builds a ribbon mesh through an arbitrary polyline of centerline points, offsetting
// each sample perpendicular to its direction of travel by half the road width, tilted
// by that sample's bank angle (a genuine banked cross-section, not just a flat strip).
// `widthOrArray` can be a single number (every sample the same width) or an array with
// one width per point — used at smoothed corners, where the two roads meeting at the
// corner can have different widths (e.g. a local road widening into a highway). Using a
// single width for the whole corner used to pick just one of the two edges' widths,
// which left a visible step — a gap or an overlapping sliver — right where the corner
// ribbon met the narrower or wider straight ribbon on either side.
const ribbonMats = new Map();
function convexHull(pts) {            // Andrew's monotone chain, points as [x, z]
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  p.forEach(q => { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
function buildRibbon(points, widthOrArray, colorHex, bankSamples, lift = ROAD_LIFT) {
  const widthAt = Array.isArray(widthOrArray) ? (i => widthOrArray[i]) : (() => widthOrArray);
  const positions = [];
  const indices = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = points[Math.min(i + 1, points.length - 1)];
    const prev = points[Math.max(i - 1, 0)];
    const heading = Math.atan2(next.z - prev.z, next.x - prev.x);
    const perpX = Math.sin(heading), perpZ = -Math.cos(heading);
    const bank = bankSamples ? bankSamples[i] : 0;
    const halfW = widthAt(i) / 2;
    const riseL = halfW * Math.sin(bank), riseR = -halfW * Math.sin(bank);
    const runL = halfW * Math.cos(bank), runR = halfW * Math.cos(bank);
    const y = p.y + lift;
    positions.push(p.x + perpX * runL, y + riseL, p.z + perpZ * runL);
    positions.push(p.x - perpX * runR, y + riseR, p.z - perpZ * runR);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  let mat = ribbonMats.get(colorHex);
  if (!mat) { mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.96, envMapIntensity: 0.12, side: THREE.DoubleSide }); ribbonMats.set(colorHex, mat); }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.isRoadSurface = true;
  return mesh;
}

// Dashed center line + solid edge lines along a polyline, so it's visually clear where
// to drive. Drawn as a pile of thin boxes rather than a textured strip — simplest thing
// that reads correctly from a chase camera, and cheap enough at this city's scale.
const dashMat = new THREE.MeshStandardMaterial({ color: 0xf2ead2, roughness: 0.7 });
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe9e9e9, roughness: 0.8 });
const DASH_LEN = 1.4, DASH_GAP = 1.4;
const yellowLineMat = new THREE.MeshStandardMaterial({ color: 0xe6b422, roughness: 0.7, emissive: 0xffc93f, emissiveIntensity: 0.05 });
// A real double-yellow centre line: two solid yellow lines with a gap between them.
function addDoubleYellow(group, a, b, heading, perpX, perpZ, segLen) {
  addLine(group, a, b, heading, perpX, perpZ, 0.2, segLen, false, yellowLineMat);
  addLine(group, a, b, heading, perpX, perpZ, -0.2, segLen, false, yellowLineMat);
}

// Orients a line/reflector box to actually follow the road's grade, not just its
// heading. Every line segment used to be rotated only around Y (flat, horizontal, no
// matter what) and placed at a lerped height — fine on level ground, but on a slope the
// box's flat underside no longer matches the tilted road surface under it, so it reads
// as floating above the road on one end and sinking into it on the other (worse the
// steeper the grade — most visible on the bridge ramps). This builds a proper 3D basis
// instead: `forward` tilts to follow the actual rise/fall from (ax,ay,az) to (bx,by,bz),
// `right` stays horizontal (a lane line doesn't roll side-to-side on a grade, only
// pitches along it), and `up` is whatever's left to keep the three perpendicular.
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _basis = new THREE.Matrix4();
function orientAlongGrade(mesh, ax, ay, az, bx, by, bz, perpX, perpZ) {
  _fwd.set(bx - ax, by - ay, bz - az);
  if (_fwd.lengthSq() < 1e-8) return;
  _fwd.normalize();
  _right.set(perpX, 0, perpZ).normalize();
  _up.crossVectors(_right, _fwd).normalize();
  _basis.makeBasis(_fwd, _up, _right);
  mesh.quaternion.setFromRotationMatrix(_basis);
}

// Draws one line (dashed or solid) at a fixed lateral offset from the centerline along
// one a->b segment. Shared by every road type so "dashed center line", "solid edge
// line" and "solid median" are all just this with different offsets/lengths — that's
// also why every road type ends up with *some* markings, where before only
// local/avenue did.
let markEdge = null;      // the road whose paint is being queued (see the paint queue further down)
function addLine(group, a, b, heading, perpX, perpZ, offset, segLen, dashed, mat, ph) {
  const ay = a.y + (a.bank ? offset * Math.sin(a.bank) : 0), by = b.y + (b.bank ? offset * Math.sin(b.bank) : 0);   // banked corners: paint follows the tilted surface
  const ax = a.x + perpX * offset, az = a.z + perpZ * offset;
  const bx = b.x + perpX * offset, bz = b.z + perpZ * offset;
  if (!dashed) {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = (ay + by) / 2;
    const line = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.015, 0.14), mat || edgeMat);
    line.position.set(mx, my + LANE_LIFT, mz);
    orientAlongGrade(line, ax, ay, az, bx, by, bz, perpX, perpZ);
    group.add(line);
    return;
  }
  // Dash pattern continues across segments (ph.d = distance already travelled along this
  // line): corners are sampled as many short segments, and restarting the pattern on every
  // one of them used to turn dashes into a continuous line there.
  const cycle = DASH_LEN + DASH_GAP;
  let d = 0;
  const start = ph && ph.d !== undefined ? ph.d : 0;
  while (d < segLen) {
    const c = (start + d) % cycle;
    if (c >= DASH_LEN - 1e-6) { d = Math.min(segLen, d + Math.max(1e-6, cycle - c)); continue; }
    const dashEnd = Math.min(segLen, d + (DASH_LEN - c));
    const t0 = d / segLen, t1 = dashEnd / segLen, tMid = (t0 + t1) / 2;
    const mx = ax + (bx - ax) * tMid, mz = az + (bz - az) * tMid, my = ay + (by - ay) * tMid;
    const dash = new THREE.Mesh(new THREE.BoxGeometry(dashEnd - d, 0.015, 0.16), mat || dashMat);
    dash.position.set(mx, my + LANE_LIFT, mz);
    orientAlongGrade(
      dash,
      ax + (bx - ax) * t0, ay + (by - ay) * t0, az + (bz - az) * t0,
      ax + (bx - ax) * t1, ay + (by - ay) * t1, az + (bz - az) * t1,
      perpX, perpZ
    );
    group.add(dash);
    d = dashEnd;
  }
  if (ph) ph.d = (start + segLen) % cycle;
}

// Small reflective pavement markers (like US/AU raised reflectors/"Botts' dots") along
// a line, spaced periodically rather than continuous — color follows the same
// convention real roads use: white marks a boundary between lanes going the same
// direction, yellow marks the boundary between opposing directions of travel.
//
// A plain non-emissive specular material alone turned out to barely read as "lit" at
// all from a moving chase camera — a flat microfacet highlight only lines up for an
// instant as the car passes, nothing like how a real retroreflector actually works (it
// bounces light straight back toward *where the light came from*, which is right next
// to the driver's eyes, so it reads as lit from almost any angle the headlight hits it
// at, not just one). Rather than fight that with material tricks, each stud gets its
// own small emissive boost that main.js drives directly: a fixed, precomputed glow for
// studs sitting near a streetlamp (computed once — lamps don't move), plus a brighter,
// dynamic one for whichever studs are actually inside the player's headlight cone right
// now (see main.js's updateReflectors). Each stud needs its own material instance (not
// the shared base) so that per-stud brightness can actually differ.
const reflectorBaseMats = {
  white: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.55, metalness: 0.1, envMapIntensity: 0.1, emissive: 0xffffff, emissiveIntensity: 0.04 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xcfa012, roughness: 0.55, metalness: 0.1, envMapIntensity: 0.1, emissive: 0xffc93f, emissiveIntensity: 0.04 })
};
function addReflectors(group, a, b, heading, perpX, perpZ, offset, segLen, colorKey, spacing = 4, ph) {
  const ay = a.y + (a.bank ? offset * Math.sin(a.bank) : 0), by = b.y + (b.bank ? offset * Math.sin(b.bank) : 0);   // banked corners: paint follows the tilted surface
  const ax = a.x + perpX * offset, az = a.z + perpZ * offset;
  const bx = b.x + perpX * offset, bz = b.z + perpZ * offset;
  group.userData.reflectors ||= [];
  // ph.next = where the next stud falls relative to this segment's start (carried across
  // segments, so short corner segments don't each drop or double studs)
  let d = ph && ph.next !== undefined ? ph.next : spacing / 2;
  while (d < segLen) {
    const t = d / segLen;
    const mx = ax + (bx - ax) * t, mz = az + (bz - az) * t, my = ay + (by - ay) * t;
    const stud = new THREE.Object3D();
    stud.position.set(mx, my + LANE_LIFT + 0.015, mz);
    orientAlongGrade(stud, ax, ay, az, bx, by, bz, perpX, perpZ);
    stud.updateMatrix();
    group.userData.reflectors.push({ matrix: stud.matrix.clone(), colorKey, x: mx, y: my, z: mz });
    d += spacing;
  }
  if (ph) ph.next = d - segLen;
}

// `lanes` is the per-edge lane count in the direction of travel (see cityData.js's
// convention note): for a two-way edge that's lanes-per-direction, for a `oneWay` edge
// it's the total lane count. Undefined/1 reproduces the old single-lane-each-way look
// exactly, so every edge that never set `lanes` is unaffected by this.
function addLaneMarkings(group, points, widthOrArray, type, lanes, oneWay) {
  const widthAt = Array.isArray(widthOrArray) ? (i => widthOrArray[i]) : (() => widthOrArray);
  const n = Math.max(1, lanes || 1);
  // Dash/stud phase per line, matched by call order: every segment makes the same sequence
  // of addLine/addReflectors calls, so the k-th call is always the same physical line.
  const phases = [];
  let ci = 0;
  const S = () => (phases[ci++] ||= {});

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const segLen = dist(a.x, a.z, b.x, b.z);
    if (segLen < 0.01) continue;
    const heading = Math.atan2(b.z - a.z, b.x - a.x);
    const perpX = Math.sin(heading), perpZ = -Math.cos(heading);
    const w = ((widthAt(i) + widthAt(i + 1)) / 2);
    ci = 0;

    // each painted line (with its reflector studs) is queued; paint of different roads that would collide is
    // resolved in resolvePaint() before anything is drawn
    const P = (off, dashed, refl, spacing) => paintOp(group, a, b, heading, perpX, perpZ, off, segLen, dashed, refl, spacing, S(), refl ? S() : null);
    const Y = () => yellowOp(group, a, b, heading, perpX, perpZ, segLen, S());

    if (type === 'highway' && !oneWay) {
      // A real divided-highway treatment: a solid double median down the centerline
      // (opposing high-speed traffic gets a hard line, not a dashed one), then a
      // dashed lane divider a quarter of the way out on each side (splitting each
      // direction's half into two lanes), then solid edge lines at the shoulders.
      Y();
      [1, -1].forEach(side => P(side * (w / 4), true, 'white', 3));
      [1, -1].forEach(side => { const edge = w / 2 - 0.4; if (edge > 0) P(side * edge, false, 'white', 4); });
    } else if (oneWay) {
      // All lanes carry the same direction — no yellow opposing-direction divider at
      // all, just evenly-spaced dashed white dividers between every lane (n=1 draws
      // none, same as a plain single-lane one-way street) plus solid shoulder lines.
      const laneW = w / n;
      for (let li = 1; li < n; li++) P(-w / 2 + li * laneW, true, 'white', 4);
      [1, -1].forEach(side => { const edge = w / 2 - 0.35; if (edge > 0) P(side * edge, false, 'white', 4); });
    } else {
      // Two-way: a dashed yellow centerline splits the opposing directions, then
      // (n-1) dashed white dividers per side split that direction's own lanes (n=1
      // draws none — the original single-lane-each-way look), then solid edge lines.
      Y();
      [1, -1].forEach(side => {
        for (let li = 1; li < n; li++) P(side * li * ((w / 2) / n), true, 'white', 4);
        const edge = w / 2 - 0.35;
        if (edge > 0) P(side * edge, false, 'white', 4);
      });
    }
  }
}

// ---- paint queue ------------------------------------------------------------------------------------------------------------
// Everything painted on a road is queued with its footprint; resolvePaint() drops what would collide with the paint of a
// more important road (lane lines of a slip road inside the freeway, a crosswalk across another road's lanes...).
let paintQueue = null, markRank = 0;
function paintOp(group, a, b, heading, perpX, perpZ, off, segLen, dashed, refl, spacing, ph, phR) {
  const x1 = a.x + perpX * off, z1 = a.z + perpZ * off, x2 = b.x + perpX * off, z2 = b.z + perpZ * off;
  paintQueue.push({ k: dashed ? 'dash' : 'solid', e: markEdge, rank: markRank, x1, z1, x2, z2, y: (a.y + b.y) / 2, run: () => {
    addLine(group, a, b, heading, perpX, perpZ, off, segLen, dashed, undefined, ph);
    if (refl) addReflectors(group, a, b, heading, perpX, perpZ, off, segLen, refl, spacing, phR);
  } });
}
function yellowOp(group, a, b, heading, perpX, perpZ, segLen, phR) {
  paintQueue.push({ k: 'yellow', e: markEdge, rank: markRank, x1: a.x, z1: a.z, x2: b.x, z2: b.z, y: (a.y + b.y) / 2, run: () => {
    addDoubleYellow(group, a, b, heading, perpX, perpZ, segLen);
    addReflectors(group, a, b, heading, perpX, perpZ, 0, segLen, 'yellow', 3, phR);
  } });
}
function resolvePaint(group, nodesById, edgesById) {
  const ops = paintQueue; paintQueue = null;
  const nodesOf = id => (id.startsWith('corner:') ? [id.slice(7)] : (edgesById[id] ? [edgesById[id].from, edgesById[id].to] : []));
  const isLine = k => k === 'dash' || k === 'solid' || k === 'yellow';
  const CELL = 8, grid = new Map(), keep = new Set();
  const cellsOf = m => { const r = []; for (let i = Math.floor(Math.min(m.x1, m.x2) / CELL); i <= Math.floor(Math.max(m.x1, m.x2) / CELL); i++) for (let j = Math.floor(Math.min(m.z1, m.z2) / CELL); j <= Math.floor(Math.max(m.z1, m.z2) / CELL); j++) r.push(i + ',' + j); return r; };
  const clash = (a, b) => {
    if (a.e === b.e || Math.abs(a.y - b.y) > 1.2) return false;
    const ax = a.x2 - a.x1, az = a.z2 - a.z1, bx = b.x2 - b.x1, bz = b.z2 - b.z1, la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 0.3 || lb < 0.3) return false;
    const den = ax * bz - az * bx;
    let x, z;
    if (Math.abs(den) > 1e-6 * la * lb) {
      const t = ((b.x1 - a.x1) * bz - (b.z1 - a.z1) * bx) / den, u = ((b.x1 - a.x1) * az - (b.z1 - a.z1) * ax) / den, e = 0.04;
      if (!(t > e && t < 1 - e && u > e && u < 1 - e)) return false;
      if (!((!isLine(a.k) || !isLine(b.k)) || true)) return false;
      x = a.x1 + ax * t; z = a.z1 + az * t;
    } else if (isLine(a.k) && isLine(b.k)) {
      const d = Math.abs(((b.x1 - a.x1) * az - (b.z1 - a.z1) * ax) / la);
      if (d >= 0.35) return false;
      const ta = ((b.x1 - a.x1) * ax + (b.z1 - a.z1) * az) / la, tb = ((b.x2 - a.x1) * ax + (b.z2 - a.z1) * az) / la;
      if (Math.min(la, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb)) <= 1.0) return false;
      x = a.x1 + ax / 2; z = a.z1 + az / 2;
    } else return false;
    if (isLine(a.k) && isLine(b.k)) {
      // two pieces of one road meeting at a joint overlap by a few cm: not a conflict
      const na = nodesOf(a.e), nb = nodesOf(b.e);
      if (na.some(n => nb.includes(n) && nodesById[n] && Math.hypot(nodesById[n].x - x, nodesById[n].z - z) < 14)) return false;
    }
    return true;
  };
  const order = ops.map((o, i) => i).sort((p, q) => {
    const A = ops[p], B = ops[q], ca = isLine(A.k) ? 0 : A.k === 'cross' ? 1 : 2, cb = isLine(B.k) ? 0 : B.k === 'cross' ? 1 : 2;
    return ca - cb || B.rank - A.rank || p - q;
  });
  order.forEach(i => {
    const o = ops[i], cells = cellsOf(o); let ok = true;
    for (const c of cells) { for (const j of (grid.get(c) || [])) if (clash(o, ops[j])) { ok = false; break; } if (!ok) break; }
    if (!ok) return;
    keep.add(i); cells.forEach(c => (grid.get(c) || grid.set(c, []).get(c)).push(i));
  });
  const marks = group.userData.marks = [];
  ops.forEach((o, i) => { if (!keep.has(i)) return; marks.push({ k: o.k, e: o.e, x1: o.x1, z1: o.z1, x2: o.x2, z2: o.z2, y: o.y }); o.run(); });
  group.userData.paintDropped = {}; ops.forEach((o, i) => { const k = keep.has(i) ? 'kept ' + o.k : 'dropped ' + o.k; group.userData.paintDropped[k] = (group.userData.paintDropped[k] || 0) + 1; });
}

// Zebra-stripe crosswalk: a row of stripes elongated ALONG the direction of travel
// (matching a real crossing, where the painted bars run parallel to car travel and
// perpendicular to the pedestrian's crossing direction), spread across the road's
// width. Placed at the same "paint clearance" line where lane markings stop short of
// an intersection (see buildRoads), right where a car would actually stop and where
// pedestrians.js's own waypoint graph already routes a crossing.
const crosswalkMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.75 });
function addCrosswalk(group, nodes, edge, nodeId, otherId, distFromNode) {
  const n = nodes[nodeId], o = nodes[otherId];
  if (!n || !o) return;
  const heading = Math.atan2(o.z - n.z, o.x - n.x); // pointing from the node into the edge
  const dirX = Math.cos(heading), dirZ = Math.sin(heading);
  const perpX = Math.sin(heading), perpZ = -Math.cos(heading);
  const cx = n.x + dirX * distFromNode, cz = n.z + dirZ * distFromNode;
  const edgeLen = Math.max(0.01, dist(n.x, n.z, o.x, o.z));
  const grade = ((o.elevation || 0) - (n.elevation || 0)) / edgeLen;
  const cy = (n.elevation || 0) + grade * distFromNode;

  const halfW = (edge.width || 9) / 2 - 0.3;
  if (halfW < 0.3) return;
  paintQueue.push({ k: 'cross', e: markEdge, rank: markRank, x1: cx - perpX * halfW, z1: cz - perpZ * halfW, x2: cx + perpX * halfW, z2: cz + perpZ * halfW, y: cy, run: () => drawCrosswalk(group, heading, perpX, perpZ, cx, cz, cy, halfW) });
}
function drawCrosswalk(group, heading, perpX, perpZ, cx, cz, cy, halfW) {
  const stripeLen = 2.4, stripeThickness = 0.55, stripeGap = 0.5;
  let d = -halfW;
  while (d < halfW - 0.05) {
    const sw = Math.min(stripeThickness, halfW - d);
    const mid = d + sw / 2;
    const sx = cx + perpX * mid, sz = cz + perpZ * mid;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(stripeLen, 0.02, sw), crosswalkMat);
    stripe.position.set(sx, cy + LANE_LIFT + 0.01, sz);
    stripe.rotation.y = -heading;
    stripe.receiveShadow = true;
    group.add(stripe);
    d += sw + stripeGap;
  }
}

// A solid white stop line across the incoming lanes of a signalled approach, just before
// the crosswalk. Approaching traffic is on the +perp side of the edge (right-hand
// traffic; perp matches the one used everywhere else in this file), so the bar only spans
// that half. AI traffic halts its nose at this line (traffic.js: intersectionClearance
// + 3.7 for the car's centre).
function addStopLine(group, nodes, edge, nodeId, otherId, distFromNode) {
  const n = nodes[nodeId], o = nodes[otherId];
  if (!n || !o) return;
  const heading = Math.atan2(o.z - n.z, o.x - n.x);
  const dirX = Math.cos(heading), dirZ = Math.sin(heading);
  const perpX = Math.sin(heading), perpZ = -Math.cos(heading);
  const halfW = (edge.width || 9) / 2;
  const span = halfW - 0.6;
  if (span < 0.5) return;
  const edgeLen = Math.max(0.01, dist(n.x, n.z, o.x, o.z));
  const grade = ((o.elevation || 0) - (n.elevation || 0)) / edgeLen;
  const cx = n.x + dirX * distFromNode + perpX * (0.3 + span / 2);
  const cz = n.z + dirZ * distFromNode + perpZ * (0.3 + span / 2);
  const cy = (n.elevation || 0) + grade * distFromNode;
  paintQueue.push({ k: 'stop', e: markEdge, rank: markRank, x1: cx - perpX * span / 2, z1: cz - perpZ * span / 2, x2: cx + perpX * span / 2, z2: cz + perpZ * span / 2, y: cy, run: () => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, span), crosswalkMat);
    bar.position.set(cx, cy + LANE_LIFT + 0.01, cz);
    bar.rotation.y = -heading;
    bar.receiveShadow = true;
    group.add(bar);
  } });
}

export function buildRoads(cityData) {
  const group = new THREE.Group();
  paintQueue = [];
  const nodes = cityData.roadNodes;
  const edgesByNode = buildEdgesByNode(cityData.roadEdges);
  const stopSet = computeStopApproaches(cityData).stops;

  const edgeBetween = (a, b) => cityData.roadEdges.find(e =>
    (e.from === a && e.to === b) || (e.from === b && e.to === a)
  );

  const curveInfo = {};
  for (const id in nodes) {
    const c = buildHorizontalCurve(id, nodes, edgesByNode);
    if (c) curveInfo[id] = c;
  }
  const vcByNode = buildVerticalCurves(nodes, edgesByNode);
  const bankFor = buildBanks(nodes, edgesByNode);

  // Straight edges, trimmed back from any smoothed corner at either end. Sampled as a
  // short polyline (not just the two trimmed endpoints) so a vertical curve — a crest or
  // sag at either node — actually shows up as a smooth parabola in the mesh instead of
  // a single straight segment that only hits the right height at its very ends.
  cityData.roadEdges.forEach(e => {
    const a = nodes[e.from], b = nodes[e.to];
    if (!a || !b) return;
    markEdge = e.id; markRank = e.width + (e.type === 'highway' ? 4 : 0);
    const color = roadColor[e.type] || 0x3c3f44;

    const fullLen = dist(a.x, a.z, b.x, b.z);
    const startCurve = curveInfo[e.from];
    const endCurve = curveInfo[e.to];
    const sStart = startCurve ? startCurve.trim : 0;
    const sEnd = fullLen - (endCurve ? endCurve.trim : 0);
    const runLen = Math.max(0.01, sEnd - sStart);
    const sampleCount = Math.max(1, Math.round(runLen / 4));

    const pts = [];
    for (let i = 0; i <= sampleCount; i++) {
      const s = sStart + (runLen * i) / sampleCount;
      const t = s / fullLen;
      const bk = edgeBank(e, s, fullLen, bankFor);
      pts.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        y: elevationAlongEdge(e, s, nodes, vcByNode) + (e.width / 2) * Math.abs(Math.sin(bk)),    // banked: lift the centre so the low edge stays on the ground
        bank: bk
      });
    }
    const startPt = pts[0], endPt = pts[pts.length - 1];

    if (!e.drawbridge) group.add(buildRibbon(pts, e.width, color, pts.map(p => p.bank), LIFT_BY_TYPE[e.type] ?? ROAD_LIFT));      // the drawbridge's two leaves (drawbridge.js) are its road surface
    (group.userData.mapPaths ||= []).push({ type: e.type, width: e.width, structure: e.structure, minY: Math.min(...pts.map(p => p.y)), pts: pts.map(p => [p.x, p.z]) });
    if (e.drawbridge) return;

    // Lane markings get extra clearance at a true intersection (3+ edges meeting at a
    // node) so the paint stops short of the intersection box instead of running straight
    // through it and crossing the other street's own markings. A simple 2-edge bend
    // (handled by curveInfo below, with its own corner ribbon) isn't an intersection in
    // this sense, so it isn't clamped here. The pavement ribbon above still runs the
    // full, untrimmed distance — real intersections have continuous pavement, just no
    // lane paint inside the box — only the markings range is narrowed.
    // A slip road peeling off / merging into the highway doesn't interrupt the highway's paint,
    // and the slip road's own paint starts beyond the highway pavement.
    const throughHighway = id => e.type === 'highway' && (edgesByNode[id] || []).every(o => o === e || o.ramp || o.type === 'highway' && (edgesByNode[id] || []).length === 3);
    const rampOnHighway = id => e.ramp && (edgesByNode[id] || []).some(o => o.type === 'highway');
    const fromIsIntersection = (edgesByNode[e.from] || []).length >= 3 && !throughHighway(e.from);
    const toIsIntersection = (edgesByNode[e.to] || []).length >= 3 && !throughHighway(e.to);
    // `clear*` is where the crossing street's pavement ends (the crosswalk goes there, and
    // the sidewalks stop there — see sidewalks.js); paint resumes a stop-line gap beyond it.
    const clearFrom = fromIsIntersection ? (rampOnHighway(e.from) ? 18 : intersectionClearance(e.from, e, edgesByNode)) : 0;
    const clearTo = toIsIntersection ? (rampOnHighway(e.to) ? 18 : intersectionClearance(e.to, e, edgesByNode)) : 0;
    const PAINT_GAP = 1.8;
    const clearStart = fromIsIntersection ? Math.max(sStart, clearFrom + PAINT_GAP) : sStart;
    const clearEnd = toIsIntersection ? Math.min(sEnd, fullLen - (clearTo + PAINT_GAP)) : sEnd;
    const markRunLen = clearEnd - clearStart;
    if (markRunLen > 0.5) {
      const markSampleCount = Math.max(1, Math.round(markRunLen / 4));
      const markPts = [];
      for (let i = 0; i <= markSampleCount; i++) {
        const s = clearStart + (markRunLen * i) / markSampleCount;
        const t = s / fullLen;
        const bk = edgeBank(e, s, fullLen, bankFor);
        markPts.push({
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t,
          y: elevationAlongEdge(e, s, nodes, vcByNode) + (e.width / 2) * Math.abs(Math.sin(bk)),
          bank: bk
        });
      }
      addLaneMarkings(group, markPts, e.width, e.type, e.lanes, e.oneWay);
    }

    // Crosswalks at the clearance line on each approach that meets a true intersection —
    // only on edges that have sidewalks (so no crossing painted on highways or bare roads).
    if (hasSidewalks(e) && clearFrom + clearTo < fullLen - 2) {
      if (fromIsIntersection) {
        addCrosswalk(group, nodes, e, e.from, e.to, clearFrom);
        if (findSignalForApproach(cityData, e.from, e.to) || stopSet.has(stopKey(e.from, e.id))) addStopLine(group, nodes, e, e.from, e.to, clearFrom + PAINT_GAP - 0.3);
      }
      if (toIsIntersection) {
        addCrosswalk(group, nodes, e, e.to, e.from, clearTo);
        if (findSignalForApproach(cityData, e.to, e.from) || stopSet.has(stopKey(e.to, e.id))) addStopLine(group, nodes, e, e.to, e.from, clearTo + PAINT_GAP - 0.3);
      }
    }

    // Bridge and tunnel structures are built segment-by-segment along the same sampled
    // centerline (`pts`) the road ribbon uses, so they follow its vertical curve — the old
    // version stretched one straight box from the first point to the last, which cut
    // straight through the sag/crest the deck itself curves along.
    const segDir = (p, q) => {
      const h = Math.atan2(q.z - p.z, q.x - p.x);
      return { h, perpX: Math.sin(h), perpZ: -Math.cos(h) };
    };

    if (e.structure === 'bridge') {
      const pierMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36 });
      const railMat = new THREE.MeshStandardMaterial({ color: 0xb8c0ca, metalness: 0.4, roughness: 0.5 });
      const hw = e.width / 2;

      // (the piers, deck slab and low side walls are built by structures.js)

      // Railings: one box per sample interval, tilted along the deck's grade, on both
      // sides; and a post at every sample so it reads at a glance.
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const { perpX, perpZ } = segDir(p, q);
        const segLen = dist(p.x, p.z, q.x, q.z);
        if (segLen < 0.01) continue;
        [1, -1].forEach(side => {
          const ax = p.x + perpX * hw * side, az = p.z + perpZ * hw * side;
          const bx = q.x + perpX * hw * side, bz = q.z + perpZ * hw * side;
          const rail = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.7, 0.12), railMat);
          rail.position.set((ax + bx) / 2, (p.y + q.y) / 2 + ROAD_LIFT + 0.45, (az + bz) / 2);
          orientAlongGrade(rail, ax, p.y, az, bx, q.y, bz, perpX, perpZ);
          rail.castShadow = true;
          group.add(rail);
        });
      }
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], { perpX, perpZ } = segDir(pts[Math.max(0, i - 1)], pts[Math.min(pts.length - 1, i + 1)]);
        [1, -1].forEach(side => {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), railMat);
          post.position.set(p.x + perpX * hw * side, p.y + ROAD_LIFT + 0.45, p.z + perpZ * hw * side);
          post.castShadow = true;
          group.add(post);
        });
      }
    }

    if (e.structure === 'tunnel') {
      // Headroom is generous (the camera follows well above the car — see camera.js, which
      // also drops it lower underground), and every piece follows the road's own grade.
      const TUNNEL_H = 7.2;
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x15191e, roughness: 1 });
      const stripMat = new THREE.MeshStandardMaterial({ color: 0x222, emissive: 0xfff1d0, emissiveIntensity: 2.4 });
      const hw = e.width / 2;
      let sinceStrip = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const { perpX, perpZ } = segDir(p, q);
        const segLen = dist(p.x, p.z, q.x, q.z);
        if (segLen < 0.01) continue;
        const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, my = (p.y + q.y) / 2;

        const ceiling = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.4, e.width + 0.8), wallMat);
        ceiling.position.set(mx, my + TUNNEL_H, mz);
        orientAlongGrade(ceiling, p.x, p.y, p.z, q.x, q.y, q.z, perpX, perpZ);
        group.add(ceiling);

        [1, -1].forEach(side => {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(segLen, TUNNEL_H, 0.4), wallMat);
          wall.position.set(mx + perpX * (hw + 0.2) * side, my + TUNNEL_H / 2, mz + perpZ * (hw + 0.2) * side);
          orientAlongGrade(wall, p.x, p.y, p.z, q.x, q.y, q.z, perpX, perpZ);
          group.add(wall);
        });

        // Ceiling light fixtures: one row over each driving direction (the centre of each
        // half of the road), every ~10 units. Each is a bright emissive bar, a soft pool of
        // light on the road under it (always on, even by day) and a registered anchor so
        // main.js can park a real spotlight on the nearest ones, which actually lights the
        // walls, ceiling and cars (see lampDefs there).
        sinceStrip += segLen;
        if (sinceStrip >= 10) {
          sinceStrip = 0;
          [1, -1].forEach(side => {
            const lat = side * (e.width / 4);
            const fx = mx + perpX * lat, fz = mz + perpZ * lat;
            const bar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 0.55), stripMat);
            bar.position.set(fx, my + TUNNEL_H - 0.28, fz);
            orientAlongGrade(bar, p.x, p.y, p.z, q.x, q.y, q.z, perpX, perpZ);
            group.add(bar);
            const pool = createGroundGlow(0xfff1d0, 7, 9);
            pool.position.set(fx, my + 0.09, fz);
            pool.material.opacity = 0.42; pool.visible = true;
            group.add(pool);
            group.userData.tunnelLights ||= [];
            group.userData.tunnelLights.push({ x: fx, y: my + TUNNEL_H - 0.3, z: fz, ground: my });
          });
        }
      }
    }
  });

  // Junction fill: every street ends square at its node, so where 3+ streets meet at an angle there are wedge-shaped holes between the arms.
  // One flat polygon per junction (the convex hull of every arm's pavement corners where its crossing street ends, plus the centre) closes them.
  for (const id in nodes) {
    const arms = (edgesByNode[id] || []);
    if (arms.length < 3 || arms.some(e => e.type === 'highway' || e.ramp)) continue;
    if (arms.some(e => Math.abs((nodes[e.from === id ? e.to : e.from].elevation || 0) - (nodes[id].elevation || 0)) > 0.05)) continue;    // an arm that climbs away (a bridge approach): a flat fill would sink under it
    const n = nodes[id], P = [[n.x, n.z]];
    arms.forEach(e => {
      const o = nodes[e.from === id ? e.to : e.from], d = dist(n.x, n.z, o.x, o.z) || 1, ux = (o.x - n.x) / d, uz = (o.z - n.z) / d;
      const clr = Math.min(intersectionClearance(id, e, edgesByNode), d * 0.45), hw = e.width / 2;
      P.push([n.x + ux * clr - uz * hw, n.z + uz * clr + ux * hw], [n.x + ux * clr + uz * hw, n.z + uz * clr - ux * hw]);
    });
    const hull = convexHull(P); if (hull.length < 3) continue;
    const top = arms.reduce((a, e) => (a.width >= e.width ? a : e)), y = (n.elevation || 0) + (LIFT_BY_TYPE[top.type] ?? ROAD_LIFT) + 0.004;
    const pos = [], idx = [];
    hull.forEach(p => pos.push(p[0], y, p[1])); for (let i = 1; i + 1 < hull.length; i++) idx.push(0, i + 1, i);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const mat = ribbonMats.get(roadColor[top.type] || 0x3c3f44) || new THREE.MeshStandardMaterial({ color: roadColor[top.type] || 0x3c3f44, roughness: 0.96, envMapIntensity: 0.12, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.userData.isRoadSurface = true; group.add(mesh);
  }

  // Spiral-arc-spiral corners: a real highway-style transition replacing the sharp
  // joint — entrance spiral, constant-radius arc, exit spiral, with superelevation
  // ramping in and out alongside the curvature instead of a generic symmetric hump.
  // Width still tapers from whichever edge it's leaving to whichever edge it's
  // entering, needed wherever two differently-sized roads meet at a bend.
  for (const nodeId in curveInfo) {
    const c = curveInfo[nodeId];
    const edge1 = edgeBetween(nodeId, c.otherIds[0]) || {};
    const edge2 = edgeBetween(nodeId, c.otherIds[1]) || {};
    const w1 = edge1.width || 9, w2 = edge2.width || 9;
    const pts = [], banks = [], widths = [];
    const cbank = cornerBanks(nodeId, c, edgesByNode, nodes, bankFor);
    c.samples.forEach((s, si) => {
      const t = c.length > 0 ? s.l / c.length : 0;
      const wAt = w1 + (w2 - w1) * t;
      // a banked ribbon tilts about its centre line: lift the centre so the low edge stays on the ground
      pts.push({ x: s.x, z: s.z, y: curveElevationAt(nodeId, s.l, c.trim, nodes, vcByNode) + (wAt / 2) * Math.abs(Math.sin(cbank[si])), bank: cbank[si] });
      banks.push(cbank[si]);
      widths.push(wAt);
    });
    group.add(buildRibbon(pts, widths, roadColor[c.type] || 0x3c3f44, banks, LIFT_BY_TYPE[c.type] ?? ROAD_LIFT));
    (group.userData.mapPaths ||= []).push({ type: c.type, width: Math.max(w1, w2), minY: Math.min(...pts.map(p => p.y)), pts: pts.map(p => [p.x, p.z]) });
    // A 2-edge bend is a curve, not an intersection, so its own lane/one-way-ness
    // carries straight through the corner unchanged (both edges here are the same
    // physical street continuing around a bend, so they agree on lane count/one-way-ness
    // in practice — falling back to either side's value if one is missing).
    markEdge = 'corner:' + nodeId; markRank = Math.max(w1, w2) + (c.type === 'highway' ? 4 : 0);
    addLaneMarkings(group, pts, widths, c.type, edge1.lanes || edge2.lanes, edge1.oneWay || edge2.oneWay);
  }

  const nodesById = nodes, edgesById = {}; cityData.roadEdges.forEach(e => { edgesById[e.id] = e; });
  resolvePaint(group, nodesById, edgesById);
  finishRoads(group);
  return group;
}

// Collapses the thousands of little road meshes (dashes, edge lines, crosswalk bars, rails, piers,
// ribbons) into a handful of merged chunk meshes per material, and turns the reflector studs into
// two instanced meshes whose per-stud brightness main.js drives through the instance colour.
function finishRoads(group) {
  const CH = 260, buckets = new Map(), kill = [];
  group.updateMatrixWorld(true);
  group.children.forEach(o => {
    if (!o.isMesh || o.userData.keep) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrix);
    Object.keys(g.attributes).forEach(k => { if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k); });
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const ng = g.index ? g.toNonIndexed() : g;
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    const key = o.material.uuid + '|' + Math.floor(c.x / CH) + ',' + Math.floor(c.z / CH);
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [], road: !!o.userData.isRoadSurface, shadow: o.receiveShadow, cast: o.castShadow });
    buckets.get(key).geos.push(ng);
    kill.push(o);
  });
  kill.forEach(o => { group.remove(o); o.geometry.dispose(); });
  buckets.forEach(b => {
    const m = new THREE.Mesh(mergeGeometries(b.geos, false), b.mat);
    m.receiveShadow = b.shadow; m.castShadow = b.cast;
    if (b.road) m.userData.isRoadSurface = true;
    group.add(m);
  });
  // reflector studs -> one InstancedMesh per colour; r.set(color) updates a single stud
  const refl = group.userData.reflectors || [];
  const base = { white: new THREE.Color(0xe8e8e8), yellow: new THREE.Color(0xe0b020) };
  ['white', 'yellow'].forEach(key => {
    const list = refl.filter(r => r.colorKey === key);
    if (!list.length) return;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.045, 0.12), new THREE.MeshBasicMaterial({ color: 0xffffff }), list.length);
    im.frustumCulled = false;
    list.forEach((r, i) => { im.setMatrixAt(i, r.matrix); im.setColorAt(i, base[key]); r.im = im; r.idx = i; r.base = base[key]; r.last = -1; });
    im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    group.add(im);
  });
}
