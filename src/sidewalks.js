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
export function buildSidewalkSegments(cityData) {
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
      return curve ? Math.max(TRIM, curve.trim + 0.5) : TRIM;
    };
    const trimA = trimAt(e.from), trimB = trimAt(e.to);
    if (len <= trimA + trimB + 1) return;
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
        fromNode: e.from, toNode: e.to, side, edgeId: e.id
      });
    });
  });
  return pruneLonelySidewalks(segments);
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
    const P = [[seg.x1 + px, y, seg.z1 + pz], [seg.x1 - px, y, seg.z1 - pz], [seg.x2 + px, y, seg.z2 + pz], [seg.x2 - px, y, seg.z2 - pz]];
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
