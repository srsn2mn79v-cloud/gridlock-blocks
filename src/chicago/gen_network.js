// Lays out every road of the Chicago map (arterials, grids, the interstate and its interchanges)
// and returns the road graph. See map.js for the coordinates this is transcribed from.
// Lays out every road of the map (the traced streets, the interstate and its interchanges) and returns the road graph.
// The streets come from the map data (mapdata.json / the studio); see map.js.
import { buildNetwork, CLASSES } from './network.js';
import { T, TP, RIVERS, HIGHWAY_PX, STREETS, IXS, X0, Y0, fromWorld } from './map.js';
import { spline, nearestOnPoly, pointInPoly, distToSeg, dist, polyLen, atLen, segInter } from './geom.js';

export function generateRoads() {
  const warnings = [];
  // ---- the interstate --------------------------------------------------------------------------------------------
  let H = spline(TP(HIGHWAY_PX), 75);
  const cityPt = T(X0, Y0);
  const citySide = nearestOnPoly(cityPt[0], cityPt[1], H).side;
  const CAR_OFF = 11.5;      // each carriageway (3 lanes) is centred this far from the median line
  const hwBarrier = { kind: 'highway', half: 19, pts: H };

  // ---- the streets: every traced line of the map ------------------------------------------------------------------------------
  const lines = [];
  STREETS.forEach((s, i) => {
    if (!s.pts || s.pts.length < 2) return;
    const pts = TP(s.pts);
    lines.push({ id: 'L' + i, cls: CLASSES[s.cls] ? s.cls : 'two', pts: pts.map(p => [p[0], p[1]]), bridge: true, noBridge: 'highway', name: s.name });
  });
  // a point on the nearest street (used to hook the interstate and the interchange streets into the network)
  const hook = (p, maxD) => {
    let best = null;
    lines.forEach(L => { for (let j = 1; j < L.pts.length; j++) {
      const r = distToSeg(p[0], p[1], L.pts[j - 1][0], L.pts[j - 1][1], L.pts[j][0], L.pts[j][1]);
      if (r.d < maxD && (!best || r.d < best.d)) best = { d: r.d, L, j, q: [L.pts[j - 1][0] + (L.pts[j][0] - L.pts[j - 1][0]) * r.t, L.pts[j - 1][1] + (L.pts[j][1] - L.pts[j - 1][1]) * r.t] };
    } });
    if (!best) return null;
    const a = best.L.pts[best.j - 1], b = best.L.pts[best.j];
    if (dist(best.q, a) > 4 && dist(best.q, b) > 4) best.L.pts.splice(best.j, 0, best.q);
    return best.q;
  };
  { // the interstate runs from one end of the lake-shore drive to the other
    const s0 = hook(H[0], 45), s1 = hook(H[H.length - 1], 45);
    if (s0) H[0] = s0.slice(); else warnings.push('the interstate does not reach the street map at its first end');
    if (s1) H[H.length - 1] = s1.slice(); else warnings.push('the interstate does not reach the street map at its last end');
  }

  // ---- interchanges: a street goes over the interstate; slip roads (with a deceleration lane on the way off and a
  // merge lane on the way on) leave from the right-hand side of each direction and meet that street 66 units away.
  // The side away from the city has no street of its own, so the street carries on over the interstate on a bridge
  // to meet the outside ramps - that is how the "outside lane" gets its exits.
  const IX = IXS.map((ix, k) => {
    const sw = TP(ix.pts); const q = hook(sw[1], 60); if (q) sw[1] = q;
    return { sw0: sw, street: ix.pts, cls: ix.cls || 'six', no: k + 1, label: ix.label || ('Interchange ' + (k + 1)) };
  });
  const ramps = [];
  const QD = 84, A = 165, ENTRY_END = 185;
  const needS = [];
  IX.forEach(ix => {
    const sw = ix.sw0;
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
  const net = buildNetwork(lines, barriers, { warn: m => warnings.push(m), minEdge: 13, stubLen: 60 });
  return { net, lines, H, warnings, IX, ramps, CAR_OFF, ENTRY_END };
}
