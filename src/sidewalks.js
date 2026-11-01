// Sidewalks: both the walkable path data pedestrians.js uses and the raised curb mesh
// drawn to match it. Kept in one file so the two never disagree about where a sidewalk
// actually is.
import * as THREE from 'three';
import { buildEdgesByNode, intersectionClearance, buildHorizontalCurve } from './roadMath.js';

// 1 world unit = 1.25 m: a 0.1 u kerb is 12.5 cm, a 2.8 u pavement 3.5 m
export const CURB_HEIGHT = 0.1;
export const SIDEWALK_WIDTH = 2.8;
const TRIM = 3;

function dist(x1, z1, x2, z2) { return Math.hypot(x1 - x2, z1 - z2); }

// Does this road edge get sidewalks (and the crosswalks that go with them)? On by default
// for everything except highways; set `sidewalks: false` on an edge to leave it bare (a
// service road, an alley), or `sidewalks: true` to force one onto a highway edge.
export function hasSidewalks(e) {
  if (e.sidewalks !== undefined) return !!e.sidewalks;
  return e.type !== 'highway';
}

// One sidewalk segment per side of each sidewalked road edge. At a true intersection
// (3+ edges) each end stops at the intersecting street's pavement edge plus a small
// margin (`intersectionClearance`, the same line roads.js paints the crosswalk on), so
// the spot where a pedestrian stands to wait or starts to cross is on the curb, not on the
// cross street. (A fixed 3-unit trim used to put it *inside* a 9-16 unit wide cross
// street.) Other ends — plain bends, dead ends — keep the old small fixed trim.
// Each segment remembers the road nodes at its two ends (fromNode/toNode) so a crossing
// built from it can look up the right traffic signal later (pedestrians.js / signals.js).
export function buildSidewalkSegments(cityData, { cut = true } = {}) {
  const nodes = cityData.roadNodes || {};
  const edgesByNode = buildEdgesByNode(cityData.roadEdges || []);
  const segments = [];
  (cityData.roadEdges || []).forEach(e => {
    if (!hasSidewalks(e)) return;
    const a = nodes[e.from], b = nodes[e.to];
    if (!a || !b) return;
    const len = dist(a.x, a.z, b.x, b.z);

    // Where this end stops: true intersection -> the crossing street's pavement edge; a
    // smoothed bend -> where the straight ribbon hands over to the corner ribbon (the
    // curve's own trim distance — a fixed 3 units stops *inside* the corner pavement on a
    // wide street); anything else -> the old small fixed trim.
    const trimAt = nodeId => {
      if ((edgesByNode[nodeId] || []).length >= 3) return intersectionClearance(nodeId, e, edgesByNode);
      const curve = buildHorizontalCurve(nodeId, nodes, edgesByNode);
      if (curve) return Math.max(TRIM, curve.trim);
      const es = edgesByNode[nodeId] || [];
      return es.length === 2 && es.every(hasSidewalks) && Math.abs((nodes[es[0].from === nodeId ? es[0].to : es[0].from].elevation || 0) - (nodes[nodeId].elevation || 0)) < 0.01 ? 0 : TRIM;   // a straight join of two sidewalked edges: no gap
    };
    const trimA = trimAt(e.from), trimB = trimAt(e.to);
    if (len <= trimA + trimB + 0.05) return;
    const shortRun = len - trimA - trimB < 2.5;     // a short piece between two bends: kept (it is what joins the two bend pavements)
    if (Math.abs((a.elevation || 0) - (b.elevation || 0)) > 0.01) return;   // slopes (ramps) get no pavement

    const heading = Math.atan2(b.z - a.z, b.x - a.x);
    const ux = Math.cos(heading), uz = Math.sin(heading);
    const perpX = Math.sin(heading), perpZ = -Math.cos(heading);
    const offset = e.width / 2 + 1.4;

    const startX = a.x + ux * trimA, startZ = a.z + uz * trimA;
    const endX = b.x - ux * trimB, endZ = b.z - uz * trimB;

    [1, -1].forEach(side => {
      segments.push({
        x1: startX + perpX * offset * side, z1: startZ + perpZ * offset * side,
        x2: endX + perpX * offset * side, z2: endZ + perpZ * offset * side,
        elevation: (a.elevation || 0) + CURB_HEIGHT,
        fromNode: e.from, toNode: e.to, side, edgeId: e.id, ...(shortRun ? { corner: true } : {})
      });
    });
  });
  addBendPavement(segments, cityData, nodes, edgesByNode);
  let cutSegs = cutRoads(segments, cityData);                                       // the road wins over the strips ...
  const corners = addJunctionCorners(cutSegs, cityData, nodes, edgesByNode);        // ... then the corners and joins are drawn between what is left (and cut in turn)
  cutSegs = cutSegs.concat(cutRoads(corners, cityData));
  cutSegs = cutSegs.concat(cutRoads(joinLooseEnds(cutSegs, edgesByNode, nodes, cityData), cityData));
  cutSegs = cutSegs.concat(cutRoads(closeNotches(cutSegs, cityData), cityData));
  const kept = pruneLonelySidewalks(cutSegs);
  return cut ? cutDriveways(kept, cityData.driveways || []) : kept;       // pedestrians and the pavement check use the uncut strips (they walk across a driveway)
}


// move a point away from the road surface (down the road-clearance gradient) until a pavement centred on it (1.4 u half width + margin) is clear
function pushClear(clear, x, z, want = 1.55) {
  for (let it = 0; it < 14 && clear(x, z) < want; it++) {
    const e = 0.6, gx = clear(x + e, z) - clear(x - e, z), gz = clear(x, z + e) - clear(x, z - e), gl = Math.hypot(gx, gz);
    if (gl < 1e-6) break;
    const st = Math.min(0.7, want - clear(x, z) + 0.1); x += gx / gl * st; z += gz / gl * st;
  }
  return [x, z];
}

// the road node a strip end belongs to: the nearer of the strip's two nodes, if within `r` u
function nearestNode(sg, x, z, nodes, r) {
  let best = null, bd = r;
  for (const id of [sg.fromNode, sg.toNode]) { const n = nodes[id]; if (!n) continue; const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = id; } }
  return best;
}

// Pavement round a bend: the straight strips of the two edges stop where the corner curve starts, so a strip of short pieces follows the curve
// (both sides) to join them. The pieces carry `corner: true`, which lets them stay shorter than the usual 2.5 u minimum.
function addBendPavement(segments, cityData, nodes, by) {
  for (const id in nodes) {
    const es = by[id] || [];
    if (es.length !== 2 || !es.every(hasSidewalks) || Math.abs((nodes[id].elevation || 0) - (nodes[es[0].from === id ? es[0].to : es[0].from].elevation || 0)) > 0.01) continue;
    const c = buildHorizontalCurve(id, nodes, by); if (!c) continue;
    const n = c.samples.length, w0 = es[0].width / 2 + 1.4, w1 = es[1].width / 2 + 1.4;
    [1, -1].forEach(side => {
      const pts = c.samples.map((q, i) => { const off = w0 + (w1 - w0) * i / (n - 1); return [q.x + Math.sin(q.heading) * off * side, q.z - Math.cos(q.heading) * off * side]; });
      let prev = pts[0];
      for (let i = 1; i < n; i++) {
        const q = pts[i], last = i === n - 1;
        if (Math.hypot(q[0] - prev[0], q[1] - prev[1]) < 1.6 && !last) continue;
        segments.push({ x1: prev[0], z1: prev[1], x2: q[0], z2: q[1], elevation: (nodes[id].elevation || 0) + CURB_HEIGHT, fromNode: id, toNode: id, side, edgeId: 'bend:' + id + ':' + side, corner: true });
        prev = q;
      }
    });
  }
}

// Any two loose strip ends that belong to the same two-street node (a bend whose curve is too slight to draw, a join of streets of different
// width, a short street between two bends) are joined by a short connector: no gap is left at a node of two streets.
function joinLooseEnds(segments, by, nodes, cityData) {
  const clear = groundRoadClearance(cityData), ends = [];
  segments.forEach((sg, i) => [[sg.x1, sg.z1], [sg.x2, sg.z2]].forEach(([x, z]) => { const node = nearestNode(sg, x, z, nodes, 16); if (node !== null && (by[node] || []).length === 2) ends.push({ x, z, node, i, sg }); }));
  const done = new Set(), add = [];
  ends.forEach(a => {
    if (ends.some(b => b.i !== a.i && b.node === a.node && Math.hypot(a.x - b.x, a.z - b.z) < 0.35)) return;          // already meets another strip
    let best = null, bd = 1e9;
    ends.forEach(b => { if (b.i === a.i || b.node !== a.node || b.sg.edgeId === a.sg.edgeId) return; const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < bd) { bd = d; best = b; } });
    if (!best || bd > 12) return;
    const k = [a.i, best.i].sort().join('-') + ':' + Math.round(a.x) + ',' + Math.round(a.z); if (done.has(k)) return; done.add(k);
    const M = pushClear(clear, (a.x + best.x) / 2, (a.z + best.z) / 2);
    add.push({ x1: a.x, z1: a.z, x2: M[0], z2: M[1], elevation: a.sg.elevation, fromNode: a.node, toNode: a.node, side: 0, edgeId: 'join:' + a.node + ':' + done.size + 'a', corner: true },
             { x1: M[0], z1: M[1], x2: best.x, z2: best.z, elevation: a.sg.elevation, fromNode: a.node, toNode: a.node, side: 0, edgeId: 'join:' + a.node + ':' + done.size + 'b', corner: true });
  });
  return add;
}

// Last pass: two strip ends 3-6 u apart with open ground (no road) between them are a notch in the pavement: bridge them.
function closeNotches(segments, cityData) {
  const clear = groundRoadClearance(cityData), ends = [], out = [], done = new Set();
  segments.forEach((sg, i) => { ends.push({ x: sg.x1, z: sg.z1, i, sg }); ends.push({ x: sg.x2, z: sg.z2, i, sg }); });
  ends.forEach(a => {
    let d = 1e9, o = null; for (const b of ends) { if (b.i === a.i) continue; const q = Math.hypot(a.x - b.x, a.z - b.z); if (q < d) { d = q; o = b; } }
    if (!o || d < 3.2 || d > 6) return;
    const mx = (a.x + o.x) / 2, mz = (a.z + o.z) / 2; if (clear(mx, mz) < -0.1) return;
    const k = Math.round(mx / 2) + ',' + Math.round(mz / 2); if (done.has(k)) return; done.add(k);
    const M = pushClear(clear, mx, mz), el = Math.max(a.sg.elevation || 0, o.sg.elevation || 0);
    out.push({ x1: a.x, z1: a.z, x2: M[0], z2: M[1], elevation: el, fromNode: a.sg.fromNode, toNode: a.sg.toNode, side: 0, edgeId: 'notch:' + k + 'a', corner: true },
             { x1: M[0], z1: M[1], x2: o.x, z2: o.z, elevation: el, fromNode: o.sg.fromNode, toNode: o.sg.toNode, side: 0, edgeId: 'notch:' + k + 'b', corner: true });
  });
  return out;
}

// Junction corners: where two neighbouring streets meet, their pavement strips stop at the cross street's kerb a couple of units apart
// (a notch of bare ground at the block corner). Join the two ends round the corner: along the strips' own lines to where they meet, or
// straight across when they do not meet nearby. The road still wins: anything over a road surface is cut away afterwards.
function addJunctionCorners(segments, cityData, nodes, by) {
  const clear = groundRoadClearance(cityData), ends = new Map(), out = [];
  segments.forEach(sg => {
    if (sg.corner) return;
    [[sg.x1, sg.z1, sg.x2, sg.z2], [sg.x2, sg.z2, sg.x1, sg.z1]].forEach(([x, z, ox, oz]) => {
      const node = nearestNode(sg, x, z, nodes, 16); if (node === null) return;
      if ((by[node] || []).length < 3) return;
      const L = Math.hypot(ox - x, oz - z) || 1;
      (ends.get(node) || ends.set(node, []).get(node)).push({ x, z, dx: (ox - x) / L, dz: (oz - z) / L, edgeId: sg.edgeId, el: sg.elevation });
    });
  });
  ends.forEach((list, node) => {
    const used = new Set();
    const pairs = [];
    list.forEach((A, i) => list.forEach((B, k) => { if (k <= i || A.edgeId === B.edgeId) return; const gap = Math.hypot(A.x - B.x, A.z - B.z); if (gap >= 0.8 && gap <= 7) pairs.push([gap, i, k]); }));
    pairs.sort((p, q) => p[0] - q[0]);
    pairs.forEach(([gap, i, k]) => {
      if (used.has(i) || used.has(k)) return; used.add(i); used.add(k);
      const A = list[i], B = list[k];
      // meeting point of the two strip lines (A + s*dA = B + t*dB), taken only if it lies just beyond both ends
      const den = A.dx * B.dz - A.dz * B.dx; let Q = null;
      if (Math.abs(den) > 0.2) {
        const s2 = ((B.x - A.x) * B.dz - (B.z - A.z) * B.dx) / den, t2 = ((B.x - A.x) * A.dz - (B.z - A.z) * A.dx) / den;
        if (s2 > -9 && s2 < 0.1 && t2 > -9 && t2 < 0.1) Q = [A.x + A.dx * s2, A.z + A.dz * s2];
      }
      const mk = (x1, z1, x2, z2, kk) => out.push({ x1, z1, x2, z2, elevation: A.el, fromNode: node, toNode: node, side: 0, edgeId: 'junction:' + node + ':' + i + ':' + k + kk, corner: true });
      const M = pushClear(clear, ...(Q || [(A.x + B.x) / 2, (A.z + B.z) / 2]));                 // the corner point, kept off the road
      mk(A.x, A.z, M[0], M[1], 'a'); mk(M[0], M[1], B.x, B.z, 'b');
    });
  });
  return out;
}

// Where a pavement strip would lie on a road (a corner of its own road, a crossing street), the road wins: the strip is cut there.
// The road surface is rebuilt here from the same centrelines roads.js draws (straight runs between the corner trims, plus the corner curves);
// only roads at ground level count, so a bridge or ramp overhead does not remove the pavement under it.
const _clr = new WeakMap();
function groundRoadClearance(cityData) {
  if (_clr.has(cityData)) return _clr.get(cityData);
  const nodes = cityData.roadNodes || {}, by = buildEdgesByNode(cityData.roadEdges || []), segs = [];
  const add = (ax, az, bx, bz, hw) => segs.push({ ax, az, dx: bx - ax, dz: bz - az, l2: (bx - ax) ** 2 + (bz - az) ** 2 || 1, hw, minx: Math.min(ax, bx) - hw, maxx: Math.max(ax, bx) + hw, minz: Math.min(az, bz) - hw, maxz: Math.max(az, bz) + hw });
  const low = n => n && (n.elevation || 0) < 1.2;
  const curves = {};
  for (const id in nodes) { const c = buildHorizontalCurve(id, nodes, by); if (c) curves[id] = c; }
  (cityData.roadEdges || []).forEach(e => {
    let a = nodes[e.from], b = nodes[e.to]; if (!a || !b || e.structure === 'tunnel') return;
    if (low(a) !== low(b)) {   // a ramp up to a bridge: its low part (under 1.2 u) still lies on the ground
      const lo = low(a) ? a : b, hi = low(a) ? b : a, t = (1.2 - (lo.elevation || 0)) / ((hi.elevation || 0) - (lo.elevation || 0) || 1);
      const cut = { x: lo.x + (hi.x - lo.x) * t, z: lo.z + (hi.z - lo.z) * t, elevation: 1.2 };
      if (low(a)) b = { ...cut, elevation: 0 }; else a = { ...cut, elevation: 0 };
    }
    if (!low(a) || !low(b)) return;
    const L = dist(a.x, a.z, b.x, b.z) || 1, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    const ta = curves[e.from] ? curves[e.from].trim : 0, tb = curves[e.to] ? curves[e.to].trim : 0;
    if (ta + tb < L) add(a.x + ux * ta, a.z + uz * ta, b.x - ux * tb, b.z - uz * tb, e.width / 2);
  });
  for (const id in curves) {
    const c = curves[id], n = nodes[id]; if (!low(n)) continue;
    const w = Math.max(...(by[id] || []).map(e => e.width || 0)) / 2;
    for (let i = 0; i < c.samples.length - 1; i++) add(c.samples[i].x, c.samples[i].z, c.samples[i + 1].x, c.samples[i + 1].z, w);
  }
  const fn = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < segs.length; i++) {
      const q = segs[i];
      if (x < q.minx - 1 || x > q.maxx + 1 || z < q.minz - 1 || z > q.maxz + 1) continue;
      const t = Math.max(0, Math.min(1, ((x - q.ax) * q.dx + (z - q.az) * q.dz) / q.l2));
      const d = Math.hypot(x - (q.ax + q.dx * t), z - (q.az + q.dz * t)) - q.hw;
      if (d < best) best = d;
    }
    return best;
  };
  _clr.set(cityData, fn);
  return fn;
}
export function cutRoads(segments, cityData) {
  const clear = groundRoadClearance(cityData), out = [], half = SIDEWALK_WIDTH / 2;
  segments.forEach(sg => {
    const dx = sg.x2 - sg.x1, dz = sg.z2 - sg.z1, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, k = Math.max(1, Math.ceil(L / 0.75));
    const blocked = [];
    for (let i = 0; i <= k; i++) {
      const x = sg.x1 + dx * i / k, z = sg.z1 + dz * i / k;
      blocked.push(sg.corner ? clear(x, z) < 0.9 : [-half, 0, half].some(o => clear(x - uz * o, z + ux * o) < -0.15));      // a corner piece (pushed clear of the road when drawn) is cut only if its middle comes within 0.9 u of the road
    }
    let start = -1;
    for (let i = 0; i <= k + 1; i++) {
      const free = i <= k && !blocked[i];
      if (free && start < 0) start = i;
      if (!free && start >= 0) {
        const a = Math.min(k, start + (start > 0 ? 1 : 0)), b = Math.max(0, i - 1 - (i - 1 < k ? 1 : 0));   // keep a 0.75 u margin from the road
        if ((b - a) * L / k >= (sg.corner ? 0.25 : 2.5) || (sg.corner && a === 0 && b === k)) out.push(a === 0 && b === k ? sg : { ...sg, x1: sg.x1 + dx * a / k, z1: sg.z1 + dz * a / k, x2: sg.x1 + dx * b / k, z2: sg.z1 + dz * b / k, cut: true });
        start = -1;
      }
    }
  });
  return out;
}

// A driveway (gas station forecourt, car park, shop entrance) interrupts the pavement: the kerb dips away so a car drives straight
// from the road onto the forecourt. Each pavement strip passing a driveway is cut to leave a gap of the driveway's width.
export function cutDriveways(segments, driveways) {
  if (!driveways.length) return segments;
  const out = [];
  segments.forEach(sg => {
    let pieces = [[0, 1]];
    const dx = sg.x2 - sg.x1, dz = sg.z2 - sg.z1, L = Math.hypot(dx, dz) || 1;
    driveways.forEach(d => {
      const t = ((d.x - sg.x1) * dx + (d.z - sg.z1) * dz) / (L * L), cx = sg.x1 + dx * t, cz = sg.z1 + dz * t;
      if (Math.hypot(d.x - cx, d.z - cz) > 6 || t < -d.hw / L || t > 1 + d.hw / L) return;      // this strip does not run past the driveway
      const lo = t - d.hw / L, hi = t + d.hw / L, next = [];
      pieces.forEach(([a, b]) => { if (hi <= a || lo >= b) { next.push([a, b]); return; } if (lo > a) next.push([a, lo]); if (hi < b) next.push([hi, b]); });
      pieces = next;
    });
    pieces.forEach(([a, b]) => { if ((b - a) * L < 2.5 && !sg.corner) return; out.push({ ...sg, x1: sg.x1 + dx * a, z1: sg.z1 + dz * a, x2: sg.x1 + dx * b, z2: sg.z1 + dz * b, cut: pieces.length > 1 || a > 0 || b < 1 }); });
  });
  return out;
}

// Sidewalks that go nowhere (a short pavement stub ending in nothing, or a little island of pavement joined to no other
// pavement - typically beside slip roads) are dropped: pedestrians would walk to the end and stand there.
export const STUB_LEN = 60, ISLAND_LEN = 150;
export function pruneLonelySidewalks(segments) {
  const byEdge = new Map();
  segments.forEach(sg => { const e = byEdge.get(sg.edgeId) || { id: sg.edgeId, from: sg.fromNode, to: sg.toNode, len: 0, segs: [] }; e.len = Math.max(e.len, Math.hypot(sg.x2 - sg.x1, sg.z2 - sg.z1)); e.segs.push(sg); byEdge.set(sg.edgeId, e); });
  const at = new Map(); const add = (n, e) => { if (!at.has(n)) at.set(n, new Set()); at.get(n).add(e); };
  byEdge.forEach(e => { add(e.from, e); add(e.to, e); });
  const drop = e => { byEdge.delete(e.id); at.get(e.from).delete(e); at.get(e.to).delete(e); };
  for (let again = true; again;) {                                           // stubs: one end touches no other pavement
    again = false;
    for (const e of [...byEdge.values()]) {
      const lone = n => at.get(n).size <= 1;
      if ((lone(e.from) || lone(e.to)) && e.len < STUB_LEN) { drop(e); again = true; }
    }
  }
  const seen = new Set();                                                    // islands: connected pavement shorter than ISLAND_LEN
  for (const e0 of [...byEdge.values()]) {
    if (seen.has(e0.id)) continue;
    const comp = [], stack = [e0]; seen.add(e0.id);
    while (stack.length) { const e = stack.pop(); comp.push(e); for (const n of [e.from, e.to]) at.get(n).forEach(o => { if (!seen.has(o.id)) { seen.add(o.id); stack.push(o); } }); }
    if (comp.reduce((a, e) => a + e.len, 0) < ISLAND_LEN) comp.forEach(drop);
  }
  const keep = new Set(); byEdge.forEach(e => e.segs.forEach(sg => keep.add(sg)));
  return segments.filter(sg => keep.has(sg));
}

// One merged mesh for every pavement strip: a flat top CURB_HEIGHT above the road plus the two vertical
// kerb faces (so it reads as a raised kerb from the side, not a floating ribbon).
export function buildSidewalks(cityData) {
  const pos = [], idx = [];
  buildSidewalkSegments(cityData).forEach(seg => {
    const heading = Math.atan2(seg.z2 - seg.z1, seg.x2 - seg.x1);
    const px = Math.sin(heading) * SIDEWALK_WIDTH / 2, pz = -Math.cos(heading) * SIDEWALK_WIDTH / 2;
    const y = seg.elevation, y0 = y - CURB_HEIGHT - 0.02;
    const b = pos.length / 3;
    // 0..3 top (L1, R1, L2, R2), 4..7 bottom of the same
    const ex = seg.corner ? Math.cos(heading) * 0.7 : 0, ez = seg.corner ? Math.sin(heading) * 0.7 : 0;     // bend pieces overlap a little so the joints leave no wedge
    const P = [[seg.x1 - ex + px, y, seg.z1 - ez + pz], [seg.x1 - ex - px, y, seg.z1 - ez - pz], [seg.x2 + ex + px, y, seg.z2 + ez + pz], [seg.x2 + ex - px, y, seg.z2 + ez - pz]];
    P.forEach(q => pos.push(q[0], q[1], q[2]));
    P.forEach(q => pos.push(q[0], y0, q[2]));
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);                         // top
    idx.push(b, b + 4, b + 2, b + 2, b + 4, b + 6, b + 1, b + 3, b + 5, b + 3, b + 7, b + 5); // sides (both windings drawn via DoubleSide)
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc2bfb6, roughness: 1, envMapIntensity: 0.5, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}
