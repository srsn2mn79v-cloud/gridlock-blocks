// Lays out every road of the Chicago map (arterials, grids, the interstate and its interchanges)
// and returns the road graph. See map.js for the coordinates this is transcribed from.
import { buildNetwork, CLASSES } from './network.js';
import { T, TP, RIVERS, LAKE_N, LAKE_S, PARKS, HIGHWAY_PX, STADIUM, fromWorld } from './map.js';
import { spline, nearestOnPoly, pointInPoly, distToSeg, dist, polyLen, atLen, segInter } from './geom.js';

const KM = { corridor: 46 };

export function generateRoads() {
  const warnings = [];
  // ---- the interstate --------------------------------------------------------------------------------------------
  let H = spline(TP(HIGHWAY_PX), 75);
  const cityPt = T(450, 900);
  const citySide = nearestOnPoly(cityPt[0], cityPt[1], H).side;
  const CAR_OFF = 11.5;      // each carriageway (3 lanes) is centred this far from the median line
const hwBarrier = { kind: 'highway', half: 19, pts: H };

  const inLake = (x, z) => pointInPoly(x, z, LAKE_N) || pointInPoly(x, z, LAKE_S);
  const parksW = PARKS.map(p => p.pts);
  const stadiumW = (() => { const c = T(STADIUM.cx, STADIUM.cy); return { x: c[0], z: c[1], r: (STADIUM.ry + 14) * 0.8 }; })();
  function riverDist(x, z) { let best = 1e9, bhalf = 0; RIVERS.forEach(r => { const o = nearestOnPoly(x, z, r.pts); if (o.d - r.half < best) { best = o.d - r.half; bhalf = r.half; } }); return best; }
  function allowed(x, z, f) {
    if (inLake(x, z)) return false;
    if (parksW.some(p => pointInPoly(x, z, p))) return false;
    if (!f.bridge && riverDist(x, z) < 8) return false;
    if (f.bridge && riverDist(x, z) < -0.5 && false) return false;
    if (!f.crossHW) {
      const h = nearestOnPoly(x, z, H);
      if (h.d < KM.corridor || h.side !== citySide) return false;
    }
    return true;
  }
  const lines = [];
  // simpler explicit implementation (the loop above only tracks first/last of straight pieces)
  function addLine(cls, ptsPx, f = {}) {
    const w = ptsPx.map(p => T(p[0], p[1]));
    const total = polyLen(w);
    const step = 5, n = Math.max(2, Math.ceil(total / step));
    let run = null; const runs = [];
    for (let k = 0; k <= n; k++) {
      const p = atLen(w, total * k / n);
      if (allowed(p.x, p.z, f)) { if (!run) { run = { from: k, to: k }; runs.push(run); } else run.to = k; } else run = null;
    }
    runs.forEach(r => {
      if ((r.to - r.from) * total / n < 28) return;
      // keep the original vertices that fall inside the run (curves), plus clipped ends
      const s0 = total * r.from / n, s1 = total * r.to / n;
      const pts = [];
      const a = atLen(w, s0); pts.push([a.x, a.z]);
      let acc = 0;
      for (let i = 1; i < w.length - 1; i++) { acc += dist(w[i - 1], w[i]); if (acc > s0 + 3 && acc < s1 - 3) pts.push(w[i]); }
      const b = atLen(w, s1); pts.push([b.x, b.z]);
      lines.push({ id: 'L' + lines.length, cls, pts, ...f });
    });
  }
  const hl = (Y, x0, x1, cls, f) => addLine(cls, [[x0, Y], [x1, Y]], f);
  const vl = (X, y0, y1, cls, f) => addLine(cls, [[X, y0], [X, y1]], f);
  const B = { bridge: true };

  // ---- arterials -------------------------------------------------------------------------------------------------------------
  // Lake Shore Drive: the six-lane ring along the lake, around Grant Park and back to the interstate's southern end
  const LSD = spline(TP([[272, 262], [292, 228], [330, 205], [375, 222], [430, 258], [495, 292], [560, 305], [620, 310], [668, 325], [712, 365], [738, 425],
    [743, 500], [745, 600], [738, 690], [722, 760], [718, 860], [738, 930], [780, 1000], [795, 1080], [788, 1180], [758, 1255], [690, 1305], [620, 1345], [580, 1425]]), 45);
  lines.push({ id: 'LSD', cls: 'six', pts: LSD, keepEnds: true, bridge: true, noBridge: 'highway', name: 'Lake Shore Dr' });
  // Columbus / Michigan: the avenue along the west edge of Grant Park
  vl(650, 330, 700, 'four', B); vl(650, 700, 1262, 'six', B);

  // River North and the Loop: the beige rings
  hl(545, 250, 745, 'four', B); hl(385, 430, 745, 'four', B);
  vl(372, 497, 1060, 'six', B); vl(505, 497, 1010, 'six', B);
  // north grid (Gold Coast / Old Town / River North)
  [270, 305, 345, 415, 450, 520].forEach((Y, i) => hl(Y, 252, 745, 'two'));
  [[300, 'two'], [360, 'two'], [420, 'two'], [475, 'four'], [530, 'two'], [585, 'four'], [640, 'two'], [695, 'two']].forEach(([X, c]) => vl(X, 220, 545, c, c === 'four' ? B : {}));
  // Old Town diagonals
  // (one clean 45-degree diagonal, Clark-Street style, so the triangles it cuts are proper blocks, not slivers)
  addLine('four', [[345, 535], [410, 470], [480, 400], [540, 340]]);
  addLine('two', [[300, 480], [345, 435], [400, 380]]);
  // Downtown grid
  [[625, 'two'], [680, 'two'], [736, 'four'], [896, 'four'], [941, 'two']].forEach(([Y, c]) => hl(Y, 252, c === 'four' ? 718 : 650, c, c === 'four' ? B : {}));
  hl(806, 60, 718, 'six', B);  hl(1046, 85, 575, 'four', B);
  vl(252, 606, 1060, 'four', B); vl(315, 606, 1050, 'four', B); vl(440, 606, 1050, 'four', B); vl(575, 606, 1050, 'four', B);
  // Industrial (west of the river) - reached over the bridges at 806 / 981 / 1046
  [[85], [115], [145]].forEach(([X]) => vl(X, 700, 1060, 'two'));
  [760, 870, 925, 1010].forEach(Y => hl(Y, 45, 190, 'two'));
  // Chinatown and the south loop
  [1090, 1135, 1180, 1230, 1270].forEach(Y => hl(Y, 260, 640, 'two'));
  vl(372, 1060, 1260, 'six'); vl(430, 1050, 1300, 'two'); vl(505, 1010, 1340, 'six'); vl(560, 1050, 1340, 'two');
  addLine('four', [[560, 1060], [515, 1200], [450, 1330]]);

  // ---- interchanges: a street goes over the interstate; slip roads (with a deceleration lane on the way off and a
  // merge lane on the way on) leave from the right-hand side of each direction and meet that street 66 units away.
  // The side away from the city has no street of its own, so the street carries on over the interstate on a bridge
  // to meet the outside ramps - that is how the "outside lane" gets its exits.
  const IX = [
    { street: [[-60, 415], [745, 415]], cls: 'six', no: 1, label: 'Old Town' },
    { street: [[-60, 981], [650, 981]], cls: 'six', no: 2, label: 'Downtown' }
  ];
  H[0] = LSD[0].slice(); H[H.length - 1] = LSD[LSD.length - 1].slice();   // fixed before any distances along H are measured
  const ramps = [];
  const QD = 84, A = 165, ENTRY_END = 185;
  const needS = [];
  IX.forEach(ix => {
    const sw = ix.street.map(p => T(p[0], p[1]));
    let P = null, hs = 0;
    for (let i = 1; i < H.length && !P; i++) {
      const r = segInter(sw[0], sw[1], H[i - 1], H[i]);
      if (r) { P = [sw[0][0] + (sw[1][0] - sw[0][0]) * r.t, sw[0][1] + (sw[1][1] - sw[0][1]) * r.t]; hs = 0; for (let k = 1; k < i; k++) hs += dist(H[k - 1], H[k]); hs += dist(H[i - 1], P); }
    }
    if (!P) { warnings.push('interchange street misses the highway: ' + ix.label); return; }
    const len = dist(sw[0], sw[1]), u = [(sw[1][0] - sw[0][0]) / len, (sw[1][1] - sw[0][1]) / len];
    Object.assign(ix, { P, hs, uIn: u, sw, Qin: [P[0] + u[0] * QD, P[1] + u[1] * QD], Qout: [P[0] - u[0] * QD, P[1] - u[1] * QD] });
    needS.push(hs - A, hs + ENTRY_END, hs + A, hs - ENTRY_END);
  });
  // put vertices into the interstate where the slip roads leave and rejoin it
  needS.sort((a, b) => a - b).forEach(s => {
    let acc = 0;
    for (let i = 1; i < H.length; i++) {
      const l = dist(H[i - 1], H[i]);
      if (s <= acc + l) { if (s - acc > 2.5 && acc + l - s > 2.5) { const t = (s - acc) / l; H.splice(i, 0, [H[i - 1][0] + (H[i][0] - H[i - 1][0]) * t, H[i - 1][1] + (H[i][1] - H[i - 1][1]) * t]); } return; }
      acc += l;
    }
  });
  hwBarrier.pts = H;
  // the freeway: two one-way carriageways either side of a median (a pillar-wide gap), joined into one point at each end
  const hwPoint = s => { const p = atLen(H, Math.max(0, Math.min(polyLen(H), s))); return { x: p.x, z: p.z, rx: -p.dz, rz: p.dx }; };   // (rx, rz) = right of the path direction
  {
    const total = polyLen(H), sv = new Set([0, total]);
    let acc = 0; for (let i = 1; i < H.length; i++) { acc += dist(H[i - 1], H[i]); sv.add(acc); }
    [30, 60, 90, 120].forEach(d => { sv.add(d); sv.add(total - d); });
    const sl = [...sv].filter(v => v >= 0 && v <= total).sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > 1.5);
    const taper = s => { const e = Math.min(s, total - s) / 120; return e >= 1 ? 1 : e * e * (3 - 2 * e); };
    const make = f => sl.map(s => { const h = hwPoint(s), l = CAR_OFF * taper(s) * f; return [h.x + h.rx * l, h.z + h.rz * l]; });
    const fw = make(1), bw = make(-1).reverse();
    lines.push({ id: 'HWF', cls: 'hw', pts: fw, keepEnds: true, oneWay: true, name: 'Interstate' });
    lines.push({ id: 'HWB', cls: 'hw', pts: bw, keepEnds: true, oneWay: true, name: 'Interstate' });
  }
  IX.forEach(ix => {
    if (!ix.P) return;
    const { hs, P } = ix;
    const rp = hwPoint(hs), inDot = rp.rx * ix.uIn[0] + rp.rz * ix.uIn[1];
    [1, -1].forEach(f => {                          // f=+1 travels along the path, f=-1 against it
      const inside = (inDot * f) > 0;               // the right-hand side of this direction is the city side
      const Q = inside ? ix.Qin : ix.Qout;
      const sAt = a => hs + f * (a - A);
      const lat = (a, l) => { const h = hwPoint(sAt(a)); const L = l < 10 ? CAR_OFF + l * 0.75 : l + 9; return [h.x + h.rx * f * L, h.z + h.rz * f * L]; };
      // Q in the ramp's own frame: aq along the interstate (A = level with the street), lq out from the carriageway. Both ramps
      // swing out with eased lateral growth and arrive at the street running parallel to the interstate, i.e. square on.
      const tg = hwPoint(hs + 1), tgx = tg.x - rp.x, tgz = tg.z - rp.z, tl = Math.hypot(tgx, tgz) || 1;
      const qx = Q[0] - rp.x, qz = Q[1] - rp.z;
      const aq = A + ((qx * tgx + qz * tgz) / tl) * f, lq = (qx * rp.rx + qz * rp.rz) * f - 9;
      const sm = k => k * k * (3 - 2 * k);
      const swingOut = [0.18, 0.36, 0.54, 0.72, 0.88].map(k => lat(70 + (aq - 28 - 70) * k, 14.5 + (lq - 14.5) * sm(k)));
      const exitPts = [lat(0, 0), lat(30, 14.5), lat(70, 14.5), ...swingOut, lat(aq - 12, lq), Q];
      const swingIn = [0.2, 0.4, 0.6, 0.8, 1].map(k => lat(aq + 14 + 82 * k, lq + (14.5 - lq) * sm(k)));
      const entryPts = [Q, lat(aq + 12, lq), ...swingIn, lat(A + 135, 14.5), lat(A + 170, 5), lat(A + ENTRY_END, 0)];
      ramps.push({ pts: exitPts, kind: 'exit', f, ix, inside });
      ramps.push({ pts: entryPts, kind: 'entry', f, ix, inside });
    });
    // the street: outside meeting point -> over the interstate -> inside meeting point -> into the city
    lines.push({ id: 'IXS' + ix.no, cls: ix.cls, pts: [ix.Qout, ix.Qin, ix.sw[1]], bridge: true, crossHW: true, ixStreet: true });
  });
  ramps.forEach((r, i) => lines.push({ id: 'RP' + i, cls: 'ramp', pts: r.pts, noJoin: true, ramp: r }));

  // ---- barriers for the bridge builder -----------------------------------------------------------------------------------------------------
  const barriers = RIVERS.map(r => ({ kind: 'river', half: r.half, pts: r.pts })).concat([hwBarrier]);
  const net = buildNetwork(lines, barriers, { warn: m => warnings.push(m), minEdge: 13 });
  return { net, lines, H, warnings, IX, ramps, CAR_OFF, ENTRY_END };
}
