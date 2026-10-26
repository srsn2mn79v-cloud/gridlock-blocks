// A hand-written example in the exact schema the Gridlock City Editor exports. It has
// grown from a straight test strip into a small city with a highway ring around it:
//
//   - The original main street (x=0) runs north from the spawn (n1) through three signalled/
//     unsignalled junctions, past a park and a plaza, then bends away to the north-west.
//   - A one-way couplet (nA-nB, x=45) wraps a block east of the park.
//   - "Grand Avenue" (x=100) is a 4-lane (2 each way) spine from the south ring road to the
//     north ring road, with two signalled cross streets (m2, m3).
//   - West blocks (x -110..0) and east blocks (x 100..190) fill in the grid either side,
//     and everything else is buildings, a plaza, a park and a lake.
//   - The yellow highway is a closed ring road (x -320..320, z -120..400) around the whole
//     city with three kinds of ground: ordinary surface, a bridge (north side, ramps up to
//     12 and back down) and a tunnel (south-west, dips to -8 and back). Four connectors tie
//     it to the street grid: south (spawn road), south (Grand Avenue), west and east, and
//     Grand Avenue's north end meets it too.
//
// The car spawns facing +z at (0,0), which is mid-road on the spawn street, so you can just
// hold forward from the start.
//
// Every road edge carries an `id` (e1, e2, ...) — the same thing the real city editor
// exports — because traffic signals reference their approach by edge id.
//
// A little code builds the signal timing and signal poles from the road geometry (see
// signalsAt / signalPole below) so every pole sits on the far-right corner of its approach,
// faces oncoming traffic and reaches over its lane. The result is plain data in the same
// shape the editor exports; hand-written entries still work the same way.
import { buildEdgesByNode, intersectionClearance } from './roadMath.js';

const nodes = {
  // --- main street (x=0) ---
  n1:  { x: 0,    z: 0,   elevation: 0 },   // spawn, mid-road
  n2:  { x: 0,    z: 80,  elevation: 0 },
  n3:  { x: 0,    z: 160, elevation: 0 },   // signalled 4-way
  n4:  { x: 0,    z: 240, elevation: 0 },
  n5:  { x: -50,  z: 300, elevation: 0 },   // gentle bend apex
  n6:  { x: -130, z: 300, elevation: 0 },   // sharper bend apex
  n7:  { x: -170, z: 220, elevation: 0 },   // turn onto the west connector

  // --- one-way couplet ---
  nA:  { x: 45,   z: 80,  elevation: 0 },
  nB:  { x: 45,   z: 160, elevation: 0 },

  // --- Grand Avenue (x=100) and its cross streets ---
  m1:  { x: 100,  z: 0,   elevation: 0 },
  m2:  { x: 100,  z: 80,  elevation: 0 },   // signalled 4-way
  m3:  { x: 100,  z: 160, elevation: 0 },   // signalled 4-way
  m4:  { x: 100,  z: 240, elevation: 0 },
  c1a: { x: 70,   z: 80,  elevation: 0 },
  c1b: { x: 130,  z: 80,  elevation: 0 },
  c2a: { x: 70,   z: 160, elevation: 0 },
  c2b: { x: 130,  z: 160, elevation: 0 },

  // --- west blocks ---
  wS1: { x: -110, z: 80,  elevation: 0 },
  w1:  { x: -110, z: 160, elevation: 0 },
  wS2: { x: -110, z: 240, elevation: 0 },

  // --- east blocks ---
  eS1: { x: 190,  z: 80,  elevation: 0 },
  eS2: { x: 190,  z: 160, elevation: 0 },
  eS3: { x: 190,  z: 240, elevation: 0 },

  // --- highway ring (clockwise from the south-west corner) ---
  SW:  { x: -320, z: -120, elevation: 0 },
  tA:  { x: -210, z: -120, elevation: 0 },   // top of the tunnel approach ramp
  tB:  { x: -170, z: -120, elevation: -8 },  // tunnel starts
  tC:  { x: -90,  z: -120, elevation: -8 },  // tunnel ends
  tD:  { x: -50,  z: -120, elevation: 0 },   // back at the surface
  rS0: { x: 0,    z: -120, elevation: 0 },   // junction: spawn-street connector
  rS1: { x: 100,  z: -120, elevation: 0 },   // junction: Grand Avenue south end
  SE:  { x: 320,  z: -120, elevation: 0 },
  rE:  { x: 320,  z: 160,  elevation: 0 },   // junction: east connector
  NE:  { x: 320,  z: 400,  elevation: 0 },
  rN:  { x: 100,  z: 400,  elevation: 0 },   // junction: Grand Avenue north end
  b0:  { x: 30,   z: 400,  elevation: 0 },   // foot of the bridge ramp
  b1:  { x: -30,  z: 400,  elevation: 12 },  // bridge deck starts
  b2:  { x: -170, z: 400,  elevation: 12 },  // bridge deck ends
  b3:  { x: -230, z: 400,  elevation: 0 },   // foot of the far ramp
  NW:  { x: -320, z: 400,  elevation: 0 },
  rW:  { x: -320, z: 220,  elevation: 0 },   // (the west connector now ends on a slip road, see below)

  // --- interchanges: slip roads (off/on ramps) instead of a flat T onto the ring ---
  hE1: { x: 320,  z: 60,   elevation: 0 },   // east: northbound exit leaves the ring here
  hE2: { x: 320,  z: 290,  elevation: 0 },   //       and the entry ramp rejoins it here (after its merge lane)
  mA:  { x: 306,  z: 205,  elevation: 0 },   //       merge (acceleration) lane runs alongside the ring from mA to mB
  mB:  { x: 306,  z: 262,  elevation: 0 },
  rX1: { x: 255,  z: 160,  elevation: 0 },   //       ramps meet the east connector (k3)
  hW1: { x: -320, z: 300,  elevation: 0 },   // west: southbound exit leaves the ring here
  hW2: { x: -320, z: 60,   elevation: 0 },   //       and the entry ramp rejoins it here (after its merge lane)
  mC:  { x: -306, z: 175,  elevation: 0 },   //       merge lane from mC to mD
  mD:  { x: -306, z: 118,  elevation: 0 },
  rX2: { x: -255, z: 220,  elevation: 0 },   //       ramps meet the west connector (k2)

  // --- a street that passes UNDER the bridge deck (z=400) ---
  ub1: { x: -120, z: 350,  elevation: 0 },
  ub2: { x: -120, z: 470,  elevation: 0 },

  // --- a street that passes OVER the tunnel (z=-120, x -170..-90) ---
  os1: { x: 0,    z: -30,  elevation: 0 },
  os2: { x: -130, z: -30,  elevation: 0 },
  os3: { x: -130, z: -200, elevation: 0 },

  // --- a boulevard east of Grand Avenue: one-way pair with a tree-lined planted median ---
  gA:  { x: 100,  z: 312,  elevation: 0 },
  gB:  { x: 100,  z: 328,  elevation: 0 },
  bF1: { x: 215,  z: 328,  elevation: 0 },
  bH:  { x: 228,  z: 320,  elevation: 0 },
  bF2: { x: 215,  z: 312,  elevation: 0 }
};

const edges = [
  // main street
  { id: 'e1',  from: 'n1', to: 'n2',  width: 9,  type: 'local',   structure: 'surface' },
  { id: 'e2',  from: 'n2', to: 'n3',  width: 9,  type: 'local',   structure: 'surface' },
  { id: 'e3',  from: 'n3', to: 'n4',  width: 9,  type: 'local',   structure: 'surface' },
  { id: 'e4',  from: 'n4', to: 'n5',  width: 9,  type: 'local',   structure: 'surface' },
  { id: 'e5',  from: 'n5', to: 'n6',  width: 9,  type: 'local',   structure: 'surface' },
  { id: 'e6',  from: 'n6', to: 'n7',  width: 9,  type: 'local',   structure: 'surface' },
  // connectors from the street grid to the ring (no sidewalks: keep pedestrians in town)
  { id: 'k1',  from: 'rS0', to: 'os1', width: 9,  type: 'local',   structure: 'surface', sidewalks: false },
  { id: 'k1b', from: 'os1', to: 'n1',  width: 9,  type: 'local',   structure: 'surface', sidewalks: false },
  { id: 'k2',  from: 'n7',  to: 'rX2', width: 12, type: 'avenue',  structure: 'surface', sidewalks: false },
  { id: 'k3',  from: 'eS2', to: 'rX1', width: 12, type: 'avenue',  structure: 'surface', sidewalks: false },

  // one-way couplet: two ordinary connectors with a one-way street (nA->nB, northbound)
  // between. `lanes` = lanes in the direction of travel (the total on a one-way edge).
  { id: 'e20', from: 'n2', to: 'nA',  width: 7,  type: 'local',   structure: 'surface' },
  { id: 'e21', from: 'nB', to: 'n3',  width: 7,  type: 'local',   structure: 'surface' },
  { id: 'e22', from: 'nA', to: 'nB',  width: 9,  type: 'local',   structure: 'surface', oneWay: true, lanes: 2 },
  { id: 'e23', from: 'nA', to: 'c1a', width: 9,  type: 'local',   structure: 'surface' },
  { id: 'e24', from: 'nB', to: 'c2a', width: 9,  type: 'local',   structure: 'surface' },

  // Grand Avenue, ring to ring
  { id: 'g0',  from: 'rS1', to: 'm1', width: 16, type: 'avenue',  structure: 'surface', lanes: 2 },
  { id: 'e30', from: 'm1', to: 'm2',  width: 16, type: 'avenue',  structure: 'surface', lanes: 2 },
  { id: 'e31', from: 'm2', to: 'm3',  width: 16, type: 'avenue',  structure: 'surface', lanes: 2 },
  { id: 'e32', from: 'm3', to: 'm4',  width: 16, type: 'avenue',  structure: 'surface', lanes: 2 },
  { id: 'g5',  from: 'm4', to: 'rN',  width: 16, type: 'avenue',  structure: 'surface', lanes: 2 },
  { id: 'e33', from: 'c1a', to: 'm2', width: 9,  type: 'local',   structure: 'surface' },
  { id: 'e34', from: 'm2', to: 'c1b', width: 9,  type: 'local',   structure: 'surface' },
  { id: 'e35', from: 'c2a', to: 'm3', width: 9,  type: 'local',   structure: 'surface' },
  { id: 'e36', from: 'm3', to: 'c2b', width: 9,  type: 'local',   structure: 'surface' },

  // west blocks
  { id: 'w1',  from: 'n2',  to: 'wS1', width: 9, type: 'local',   structure: 'surface' },
  { id: 'w2',  from: 'wS1', to: 'w1',  width: 9, type: 'local',   structure: 'surface' },
  { id: 'w3',  from: 'w1',  to: 'wS2', width: 9, type: 'local',   structure: 'surface' },
  { id: 'e15', from: 'n3',  to: 'w1',  width: 9, type: 'local',   structure: 'surface' },
  { id: 'w4',  from: 'n4',  to: 'wS2', width: 9, type: 'local',   structure: 'surface' },

  // east blocks
  { id: 'x1',  from: 'c1b', to: 'eS1', width: 9, type: 'local',   structure: 'surface' },
  { id: 'x2',  from: 'c2b', to: 'eS2', width: 9, type: 'local',   structure: 'surface' },
  { id: 'x3',  from: 'm4',  to: 'eS3', width: 9, type: 'local',   structure: 'surface' },
  { id: 'x4',  from: 'eS1', to: 'eS2', width: 9, type: 'local',   structure: 'surface' },
  { id: 'x5',  from: 'eS2', to: 'eS3', width: 9, type: 'local',   structure: 'surface' },
  { id: 'x6',  from: 'n4',  to: 'm4',  width: 9, type: 'local',   structure: 'surface' },

  // highway ring: 2 lanes each way (matches the painted lane dividers)
  { id: 'h1',  from: 'SW',  to: 'tA',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h2',  from: 'tA',  to: 'tB',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h3',  from: 'tB',  to: 'tC',  width: 20, type: 'highway', structure: 'tunnel',  lanes: 2 },
  { id: 'h4',  from: 'tC',  to: 'tD',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h5',  from: 'tD',  to: 'rS0', width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h6',  from: 'rS0', to: 'rS1', width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h7',  from: 'rS1', to: 'SE',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h8',  from: 'SE',  to: 'hE1', width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h8b', from: 'hE1', to: 'rE',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h9',  from: 'rE',  to: 'hE2', width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h9b', from: 'hE2', to: 'NE',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h10', from: 'NE',  to: 'rN',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h11', from: 'rN',  to: 'b0',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h12', from: 'b0',  to: 'b1',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h13', from: 'b1',  to: 'b2',  width: 20, type: 'highway', structure: 'bridge',  lanes: 2 },
  { id: 'h14', from: 'b2',  to: 'b3',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h15', from: 'b3',  to: 'NW',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h16', from: 'NW',  to: 'hW1', width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h16b', from: 'hW1', to: 'rW',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h17', from: 'rW',  to: 'hW2', width: 20, type: 'highway', structure: 'surface', lanes: 2 },
  { id: 'h17b', from: 'hW2', to: 'SW',  width: 20, type: 'highway', structure: 'surface', lanes: 2 },

  // slip roads: one-way, no sidewalks. The exit peels off the lanes nearest the connector; the
  // entry ramp merges back into the same side. `exit` feeds the overhead signs (signs.js).
  { id: 'r1',  from: 'hE1', to: 'rX1', width: 8, type: 'avenue', structure: 'surface', oneWay: true, lanes: 1, sidewalks: false, ramp: true, exit: { no: 4, label: 'Eastside', next: [{ no: 3, label: 'Midtown N', dist: '2 MILES' }, { no: 2, label: 'Old Town', dist: '4 MILES' }] } },
  { id: 'r2',  from: 'rX1', to: 'mA',  width: 8, type: 'avenue', structure: 'surface', oneWay: true, lanes: 1, sidewalks: false, ramp: true },
  { id: 'r2m', from: 'mA',  to: 'mB',  width: 8, type: 'avenue', structure: 'surface', oneWay: true, lanes: 1, sidewalks: false, ramp: true },   // merge lane
  { id: 'r2t', from: 'mB',  to: 'hE2', width: 8, type: 'avenue', structure: 'surface', oneWay: true, lanes: 1, sidewalks: false, ramp: true },   // taper into the ring
  { id: 'r3',  from: 'hW1', to: 'rX2', width: 8, type: 'avenue', structure: 'surface', oneWay: true, lanes: 1, sidewalks: false, ramp: true, exit: { no: 2, label: 'Old Town', next: [{ no: 1, label: 'Harbor Rd', dist: '2 MILES' }, { no: 4, label: 'Eastside', dist: '5 MILES' }] } },
  { id: 'r4',  from: 'rX2', to: 'mC',  width: 8, type: 'avenue', structure: 'surface', oneWay: true, lanes: 1, sidewalks: false, ramp: true },
  { id: 'r4m', from: 'mC',  to: 'mD',  width: 8, type: 'avenue', structure: 'surface', oneWay: true, lanes: 1, sidewalks: false, ramp: true },
  { id: 'r4t', from: 'mD',  to: 'hW2', width: 8, type: 'avenue', structure: 'surface', oneWay: true, lanes: 1, sidewalks: false, ramp: true }
];

const byNode = buildEdgesByNode(edges);
const otherEnd = (e, id) => (e.from === id ? e.to : e.from);

// --- signals --------------------------------------------------------------------------
// One signal per approach edge, matched back by edge id (the same shape the city editor's
// Signal tool exports). Cycle is 18s: the two directions of one street share a phase, the
// crossing street runs half a cycle later, and the 1.5s of red either side of each yellow
// is an all-red clearance so cars finish clearing the box before the cross traffic starts.
// 4 s of all-red between one direction turning red and the other turning green, so busy junctions clear
const GREEN = 7000, YELLOW = 2000, CLEAR = 4000, HALF = GREEN + YELLOW + CLEAR, RED = 2 * HALF - GREEN - YELLOW;
function signalsAt(nodeId, groupA, groupB) {
  const mk = (edgeId, offsetMs, n) => ({
    id: 'sig_' + nodeId + '_' + n, nodeId, edgeId,
    greenMs: GREEN, yellowMs: YELLOW, redMs: RED, offsetMs
  });
  return [
    ...groupA.map((id, i) => mk(id, 0, 'a' + i)),
    ...groupB.map((id, i) => mk(id, HALF, 'b' + i))
  ];
}

// A signal pole for traffic arriving at `nodeId` from `approachId`: far side of the
// intersection, on the right-hand corner (right of travel, in the same convention
// traffic.js drives on), beyond the far crosswalk, with its arm reaching back over the
// lane. `rotation` turns the prop so its lenses face oncoming traffic. The positions use
// the same intersectionClearance the crosswalks, stop lines and sidewalks are placed with.
function signalPole(nodeId, approachId) {
  const N = nodes[nodeId], A = nodes[approachId];
  const dx = N.x - A.x, dz = N.z - A.z, len = Math.hypot(dx, dz);
  const d = { x: dx / len, z: dz / len };
  const right = { x: -d.z, z: d.x };
  const approachEdge = byNode[nodeId].find(e => otherEnd(e, nodeId) === approachId);
  let far = null, best = -2;
  byNode[nodeId].forEach(e => {
    if (e === approachEdge) return;
    const o = nodes[otherEnd(e, nodeId)];
    const ex = o.x - N.x, ez = o.z - N.z, l = Math.hypot(ex, ez);
    const dot = (ex * d.x + ez * d.z) / l;
    if (dot > best) { best = dot; far = e; }
  });
  const farEdge = far && best > 0.7 ? far : approachEdge;
  const along = intersectionClearance(nodeId, farEdge, byNode) + 1.9;
  const lateral = (farEdge.width || 9) / 2 + 1.4;
  const arm = Math.max(1.5, lateral - (approachEdge.width || 9) / 4);
  const r2 = v => Math.round(v * 100) / 100;
  return {
    type: 'trafficlight',
    x: r2(N.x + d.x * along + right.x * lateral),
    z: r2(N.z + d.z * along + right.z * lateral),
    rotation: Math.round(Math.atan2(-d.x, -d.z) * 180 / Math.PI),
    arm: r2(arm), signalNode: nodeId, signalApproach: approachId
  };
}

// A streetlamp at (x, z) whose arm reaches toward (tx, tz).
function lamp(x, z, tx, tz, extra) {
  return { type: 'light', x, z, rotation: Math.round(Math.atan2(tx - x, tz - z) * 180 / Math.PI), ...extra };
}

const bld = (x1, x2, z1, z2, height) => ({
  type: 'building', height, footprint: [[x1, z1], [x1, z2], [x2, z2], [x2, z1]]
});
const rect = (type, x1, x2, z1, z2) => ({ type, footprint: [[x1, z1], [x1, z2], [x2, z2], [x2, z1]] });


// ---- scenery helpers: deterministic scatter / layout of park trees, plazas and the boulevard ----
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const r1 = v => Math.round(v * 10) / 10;
const faceTo = (x, z, tx, tz) => Math.round(Math.atan2(tx - x, tz - z) * 180 / Math.PI);
function scatterTrees(x1, x2, z1, z2, gap, seed, avoid = []) {
  const rnd = mulberry(seed), out = [];
  for (let x = x1 + gap / 2; x < x2; x += gap) for (let z = z1 + gap / 2; z < z2; z += gap) {
    const px = x + (rnd() - 0.5) * gap * 0.6, pz = z + (rnd() - 0.5) * gap * 0.6;
    if (avoid.some(([ax, az, ar]) => Math.hypot(px - ax, pz - az) < ar)) continue;
    out.push({ type: rnd() < 0.6 ? 'oak' : 'tree', x: r1(px), z: r1(pz), rotation: Math.round(rnd() * 360) });
  }
  return out;
}
const bushLine = (x1, z1, x2, z2, step) => {
  const n = Math.max(1, Math.round(Math.hypot(x2 - x1, z2 - z1) / step)), out = [];
  for (let i = 0; i <= n; i++) out.push({ type: 'bush', x: r1(x1 + (x2 - x1) * i / n), z: r1(z1 + (z2 - z1) * i / n), rotation: (i * 67) % 360 });
  return out;
};
const benchRing = (cx, cz, r, n, phase = 0) => Array.from({ length: n }, (_, i) => {
  const a = phase + i * Math.PI * 2 / n, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
  return { type: 'bench', x: r1(x), z: r1(z), rotation: faceTo(x, z, cx, cz) };
});

const parkTrees = [
  ...scatterTrees(10, 30, 90, 150, 6, 11, [[14, 85, 2]]),
  ...scatterTrees(135, 180, 90, 150, 6.5, 23, [[150, 125, 3], [165, 100, 3]])
];

// town square (x 114..182, z 252..304): fountain, gazebo, food stands, benches, bushes, lamps
const squareProps = [
  { type: 'fountain', x: 148, z: 278, rotation: 0 },
  { type: 'gazebo', x: 170, z: 292, rotation: 0 },
  { type: 'foodstand', x: 124, z: 262, rotation: faceTo(124, 262, 148, 278), variant: 0 },
  { type: 'foodstand', x: 124, z: 294, rotation: faceTo(124, 294, 148, 278), variant: 1 },
  { type: 'foodstand', x: 170, z: 260, rotation: faceTo(170, 260, 148, 278), variant: 2 },
  ...benchRing(148, 278, 8.5, 8, 0.3),
  ...bushLine(116.5, 254, 116.5, 302, 5), ...bushLine(120, 302, 180, 302, 5), ...bushLine(120, 254, 180, 254, 5), ...bushLine(180.5, 258, 180.5, 296, 5),
  { type: 'oak', x: 132, z: 282, rotation: 10 }, { type: 'oak', x: 135, z: 270, rotation: 50 }, { type: 'oak', x: 162, z: 270, rotation: 90 },
  { type: 'oak', x: 160, z: 296, rotation: 140 }, { type: 'oak', x: 128, z: 274, rotation: 200 }, { type: 'tree', x: 176, z: 276, rotation: 30 },
  lamp(118, 258, 130, 266), lamp(118, 298, 130, 290), lamp(178, 258, 166, 266), lamp(176, 300, 164, 292)
];
const smallPlazas = [
  // main-street plaza (x 10..30, z 170..230)
  { type: 'fountain', x: 20, z: 200, rotation: 0, small: true },
  ...benchRing(20, 200, 6.5, 4, 0.8), ...bushLine(11.5, 172, 28.5, 172, 4), ...bushLine(11.5, 228, 28.5, 228, 4),
  // east plaza (x 200..245, z 170..230)
  { type: 'fountain', x: 222, z: 200, rotation: 0 },
  ...benchRing(222, 200, 8, 6, 0.2), ...bushLine(202, 172, 243, 172, 5), ...bushLine(202, 228, 243, 228, 5),
  { type: 'oak', x: 205, z: 190, rotation: 20 }, { type: 'oak', x: 240, z: 210, rotation: 80 }
];
// the boulevard's planted median: a tree every 11 units, a two-headed lamp between them
const boulevard = [];
for (let x = 120; x <= 206; x += 11) boulevard.push({ type: 'oak', x, z: 320, rotation: (x * 13) % 360 });
for (let x = 125.5; x <= 200; x += 22) boulevard.push({ type: 'light', x: r1(x), z: 320, rotation: 0, twin: true });

export const sampleCity = {
  meta: { version: 1 },
  roadNodes: nodes,
  roadEdges: edges,

  signals: [
    // n3: main street (n2/n4 approaches) vs the west/east street (w1/nB approaches)
    ...signalsAt('n3', ['e2', 'e3'], ['e15', 'e21']),
    // Grand Avenue's two signalled crossings
    ...signalsAt('m2', ['e30', 'e31'], ['e33', 'e34']),
    ...signalsAt('m3', ['e31', 'e32'], ['e35', 'e36'])
  ],

  parcels: [
    // --- main street, as before ---
    bld(-30, -10, 10, 70, 18),
    bld(10, 30, 10, 70, 14),
    bld(-30, -10, 90, 150, 20),
    rect('park', 10, 30, 90, 150),
    bld(-30, -10, 170, 230, 16),
    rect('plaza', 10, 30, 170, 230),
    rect('water', -95, -60, 310, 345),

    // the block inside the one-way couplet, and the strip between it and Grand Avenue
    bld(30, 39, 88, 155, 13),
    bld(54, 70, 90, 150, 14),
    bld(40, 68, 172, 232, 17),

    // --- Grand Avenue frontage (road half-width 8, so clear of x=92 / x=108) ---
    bld(75, 86, 4, 70, 22), bld(75, 86, 90, 150, 17), bld(75, 86, 170, 236, 25),
    bld(114, 125, 4, 70, 19), bld(114, 125, 90, 150, 15), bld(114, 125, 170, 236, 21),

    // --- west blocks (x -110..0, streets at z=80/160/240) ---
    bld(-100, -36, 90, 150, 15), bld(-100, -36, 170, 230, 19),
    bld(-160, -120, 90, 150, 12), bld(-160, -120, 170, 208, 23),

    // --- east blocks (x 100..190 and beyond) ---
    rect('park', 135, 180, 90, 150), bld(135, 180, 170, 232, 18),
    bld(200, 245, 90, 150, 16), rect('plaza', 200, 245, 170, 230),
    

    // --- south of the spawn, between the ring and the first junction ---
    bld(-45, -12, -105, -40, 14), bld(12, 45, -105, -15, 17),
    bld(60, 90, -105, -15, 20), bld(110, 150, -105, -15, 13),
    bld(160, 245, -88, -10, 12),

    // --- north of the bend / Grand Avenue ---
    bld(20, 90, 252, 382, 24), bld(114, 200, 340, 382, 18),
    // town square south of the boulevard, and blocks round it
    rect('plaza', 114, 182, 252, 304), bld(190, 248, 252, 300, 20), bld(232, 262, 342, 380, 16),
    // (removed: footprint crossed the n6-n7 bend)
  ],

  props: [
    ...parkTrees, ...squareProps, ...smallPlazas, ...boulevard,
    // main street furniture, as before
    { type: 'tree', x: -7, z: 100, rotation: 90 },
    lamp(7, 60, 0, 60), lamp(-7, 90, 0, 90), lamp(7, 120, 0, 120),
    { type: 'bench', x: -7, z: 140, rotation: 180 },
    lamp(7, 140, 0, 140),
    { type: 'sign', x: 7, z: 180, rotation: 90 },
    lamp(-7, 190, 0, 190),
    { type: 'tree', x: -7, z: 200, rotation: 105 },
    lamp(7, 220, 0, 220),
    lamp(-70, 293, -70, 300), lamp(-110, 307, -110, 300),
    // A median-style fixture on the road's centreline: the two-headed `twin` variant.
    { type: 'light', x: 0, z: 258, rotation: 0, twin: true },

    // signal poles — generated from the geometry, see signalPole()
    signalPole('n3', 'n2'), signalPole('n3', 'n4'), signalPole('n3', 'w1'), signalPole('n3', 'nB'),
    signalPole('m2', 'm1'), signalPole('m2', 'm3'), signalPole('m2', 'c1a'), signalPole('m2', 'c1b'),
    signalPole('m3', 'm2'), signalPole('m3', 'm4'), signalPole('m3', 'c2a'), signalPole('m3', 'c2b'),

    // one-way signage for the bypass street (nA->nB): one facing traffic arriving from
    // n2's side at the legal entrance, one at the far end facing anyone entering wrongly.
    { type: 'oneway', x: 51, z: 85,  rotation: 180 },
    { type: 'oneway', x: 51, z: 155, rotation: 0 },

    // Grand Avenue
    lamp(91, 30, 100, 30), lamp(109, 50, 100, 50), lamp(91, 110, 100, 110),
    lamp(109, 190, 100, 190), lamp(91, 210, 100, 210),
    lamp(109, 280, 100, 280), lamp(91, 320, 100, 320), lamp(109, 360, 100, 360),
    lamp(91, -30, 100, -30), lamp(109, -70, 100, -70),

    // west blocks
    lamp(-55, 167, -55, 160), lamp(-90, 153, -90, 160),
    lamp(-55, 87, -55, 80),   lamp(-90, 73, -90, 80),
    lamp(-55, 247, -55, 240), lamp(-90, 233, -90, 240),
    lamp(-117, 120, -110, 120), lamp(-103, 200, -110, 200),

    // east blocks
    lamp(160, 167, 160, 160), lamp(230, 153, 230, 160), lamp(210, 167, 210, 160),
    lamp(160, 87, 160, 80),   lamp(183, 120, 190, 120), lamp(197, 200, 190, 200),

    // spawn road, south of the first junction
    lamp(7, -40, 0, -40), lamp(-7, -80, 0, -80),

    { type: 'tree', x: -7, z: -20, rotation: 90 }, { type: 'tree', x: 7, z: -60, rotation: 90 },
    { type: 'bench', x: 14, z: 85, rotation: 90 }, { type: 'tree', x: 150, z: 125, rotation: 0 },
    { type: 'tree', x: 165, z: 100, rotation: 0 }, { type: 'tree', x: 250, z: 200, rotation: 0 }
  ],

  gameplay: [
    { type: 'spawn', x: 0, z: 0 },
    { type: 'checkpoint', x: 0, z: 240 },
    { type: 'checkpoint', x: -130, z: 300 },
    { type: 'checkpoint', x: -100, z: 400, elevation: 12 },   // on the bridge deck
    { type: 'checkpoint', x: -130, z: -120, elevation: -8 },  // inside the tunnel
    { type: 'checkpoint', x: 320, z: 280 }                    // east side of the ring
  ]
};
