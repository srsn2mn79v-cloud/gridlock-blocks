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
    const sw = TP(ix.pts); const q = hook(sw[sw.length - 1], 60); if (q) sw[sw.length - 1] = q;
    return { sw, ramps: (ix.ramps || []).map(r => TP(r)), cls: ix.cls || 'six', no: k + 1, label: ix.label || ('Interchange ' + (k + 1)) };
  });
  const ramps = [];
  const LEAD = 45, ENTRY_END = LEAD;
  const needS = [];
  // arclength of the interstate at the point nearest to p, and which side of it p is on (+1 = right of the path)
  const along = p => {
    let best = null, acc = 0;
    for (let i = 1; i < H.length; i++) {
      const l = dist(H[i - 1], H[i]), r = distToSeg(p[0], p[1], H[i - 1][0], H[i - 1][1], H[i][0], H[i][1]);
      if (!best || r.d < best.d) { const dx = (H[i][0] - H[i - 1][0]) / l, dz = (H[i][1] - H[i - 1][1]) / l; best = { d: r.d, s: acc + r.t * l, side: ((p[0] - H[i - 1][0]) * -dz + (p[1] - H[i - 1][1]) * dx) > 0 ? 1 : -1 }; }
      acc += l;
    }
    return best;
  };
  IX.forEach(ix => {
    const sw = ix.sw;
    let P = null, hs = 0;
    for (let j = 1; j < sw.length && !P; j++) for (let i = 1; i < H.length && !P; i++) {
      const r = segInter(sw[j - 1], sw[j], H[i - 1], H[i]);
      if (r) { P = [sw[j - 1][0] + (sw[j][0] - sw[j - 1][0]) * r.t, sw[j - 1][1] + (sw[j][1] - sw[j - 1][1]) * r.t]; hs = 0; for (let k = 1; k < i; k++) hs += dist(H[k - 1], H[k]); hs += dist(H[i - 1], P); }
    }
    if (!P) { warnings.push('interchange street misses the highway: ' + ix.label); return; }
    Object.assign(ix, { P, hs });
    ix.ramps.forEach(r => {
      const e = along(r[0]); r.info = e; r.junction = dist(r[r.length - 1], sw[0]) < dist(r[r.length - 1], sw[1]) ? sw[0] : sw[1];
      const f = e.side, exitKind = (f > 0 ? e.s < hs : e.s > hs);   // the right-hand carriageway of the side the arc is on; upstream of the street = exit
      r.f = f; r.kind = exitKind ? 'exit' : 'entry';
      needS.push(e.s - f * (exitKind ? LEAD : -LEAD), e.s);
    });
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
    ix.ramps.forEach(r => {
      const { f, kind } = r, e = r.info, ex = kind === 'exit';
      const carr = s => { const h = hwPoint(s); return [h.x + h.rx * f * CAR_OFF, h.z + h.rz * f * CAR_OFF]; };
      const arc = r.slice(0, -1).concat([r.junction]);
      const sm = k => k * k * (3 - 2 * k), blend = [];
      for (let k = 0; k <= 4; k++) {
        const w = sm(k / 4), s0 = e.s + f * (ex ? -1 : 1) * LEAD * (1 - k / 4), c = carr(s0);
        blend.push([c[0] + (arc[0][0] - c[0]) * w, c[1] + (arc[0][1] - c[1]) * w]);
      }
      if (ex) ramps.push({ pts: blend.concat(arc.slice(1)), kind, f, ix, inside: true });
      else { const q = arc.slice().reverse().concat(blend.slice().reverse().slice(1)); ramps.push({ pts: q, kind, f, ix, inside: true }); }
    });
    // the street: outer junction -> over the interstate -> inner junction -> into the city
    const d0 = [ix.sw[0][0] - ix.sw[1][0], ix.sw[0][1] - ix.sw[1][1]], l0 = Math.hypot(d0[0], d0[1]) || 1;   // a short tail beyond the outer junction gives the bridge room (the tail itself is pruned as a stub)
    lines.push({ id: 'IXS' + ix.no, cls: ix.cls, pts: [[ix.sw[0][0] + d0[0] / l0 * 70, ix.sw[0][1] + d0[1] / l0 * 70], ...ix.sw], bridge: true, crossHW: true, ixStreet: true });
  });
  ramps.forEach((r, i) => lines.push({ id: 'RP' + i, cls: 'ramp', pts: r.pts, noJoin: true, ramp: r }));

  // ---- barriers for the bridge builder -----------------------------------------------------------------------------------------------------
  const barriers = RIVERS.map(r => ({ kind: 'river', half: r.half, pts: r.pts })).concat([hwBarrier]);
  const net = buildNetwork(lines, barriers, { warn: m => warnings.push(m), minEdge: 13, stubLen: 90 });
  return { net, lines, H, warnings, IX, ramps, CAR_OFF, ENTRY_END };
}
