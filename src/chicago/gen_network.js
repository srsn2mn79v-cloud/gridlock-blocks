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
  // ---- river bridges: arterials that stop on one bank and line up with another arterial on the far bank get joined ---------------------------
  {
    // 1. arterials that already span the river but are too short for approach ramps: borrow road from the streets at both ends
    // each bridge line borrows the last PAD units of both streets so the approach ramps have room on the bank
    const PAD = 70, pathLen = pts => pts.reduce((t, q, i) => i ? t + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0, 0);
    const take = (L, front) => {   // cut PAD off one end of L; returns the cut-off path ordered from the cut point to the old end
      const pts = front ? L.pts : L.pts.slice().reverse();
      // cut at the first junction at least 50 u along (so the bridge starts at a real junction), else PAD from the end
      let pad = PAD;
      { let best = Infinity, run = 0;
        for (let i = 1; i < pts.length; i++) {
          const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          lines.forEach(M => { if (M === L || M.cls === 'ramp') return; for (let j = 1; j < M.pts.length; j++) { const r = segInter(pts[i - 1], pts[i], M.pts[j - 1], M.pts[j]); if (r) { const d = run + r.t * seg; if (d >= 50 && d < best) best = d; } } });
          run += seg;
        }
        if (best <= 150) pad = best; }
      let acc = 0, k = 1;
      while (k < pts.length && acc + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) < pad) { acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); k++; }
      if (k >= pts.length) return null;
      const a = pts[k - 1], b = pts[k], t = (pad - acc) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
      const cut = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const removed = [...pts.slice(0, k).map(q => [q[0], q[1]]), cut];                       // river end ... cut point
      const rest = [cut, ...pts.slice(k).map(q => [q[0], q[1]])];                              // what stays of the street
      L.pts = front ? rest : rest.slice().reverse();
      return removed;   // from the old (river-side) end back to the cut point
    };
    // streets that used to end at the river bank now end where the bridge ramp starts (on the ground), so they can still join it
    const rehome = (from, to, except) => lines.forEach(M => {
      if (except.includes(M) || M.lowBridge) return;
      [0, M.pts.length - 1].forEach(i => { if (M.pts.length > 1 && Math.hypot(M.pts[i][0] - from[0], M.pts[i][1] - from[1]) < 2.5) M.pts[i] = [to[0], to[1]]; });
    });
    const sideAt = (x, z) => { for (const r of RIVERS) { const nn = nearestOnPoly(x, z, r.pts); if (nn.d < r.half + 170) return { id: r.id, side: nn.side, half: r.half }; } return null; };
    let spans = 0, cIdx = 0;
    const RB_ALLOW = [0, 2, 5];   // the crossings that came out clean in tools/check.mjs (the others leave a dead-end side street: see README)
    const allowed = idx => (globalThis.__RB_ONLY || RB_ALLOW).includes(idx);
    lines.slice().forEach(L => {
      if ((L.cls !== 'six' && L.cls !== 'four') || L.pts.length < 2) return;
      const p0 = L.pts[0], p1 = L.pts[L.pts.length - 1], s0 = sideAt(p0[0], p0[1]), s1 = sideAt(p1[0], p1[1]);
      if (!s0 || !s1 || s0.id !== s1.id || s0.side === s1.side) return;
      const nb = pt => lines.filter(o => o !== L && (o.cls === 'six' || o.cls === 'four') && !o.lowBridge && [o.pts[0], o.pts[o.pts.length - 1]].some(q => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < 1.5))
        .sort((x, y) => pathLen(y.pts) - pathLen(x.pts))[0];
      const na = nb(p0), nbb = nb(p1);
      if (!na || !nbb || pathLen(na.pts) < PAD + 30 || pathLen(nbb.pts) < PAD + 30) return;
      if (!allowed(cIdx++)) return;
      const ea = Math.hypot(na.pts[0][0] - p0[0], na.pts[0][1] - p0[1]) < 1.5, eb = Math.hypot(nbb.pts[0][0] - p1[0], nbb.pts[0][1] - p1[1]) < 1.5;
      const ta = take(na, ea), tb = take(nbb, eb);
      if (!ta || !tb) return;
      rehome(ta[0], ta[ta.length - 1], [L, na, nbb]); rehome(tb[0], tb[tb.length - 1], [L, na, nbb]);
      L.pts = [...ta.slice().reverse().slice(0, -1), ...L.pts, ...tb.slice(1)];
      L.lowBridge = true; L.anchors = [pathLen(ta), pathLen(L.pts) - pathLen(tb)]; spans++;
    });
    warnings.push('arterial river crossings lengthened: ' + spans);
    const eps = [];
    lines.forEach(L => {
      if ((L.cls !== 'six' && L.cls !== 'four') || L.lowBridge) return;
      [[0, 1], [L.pts.length - 1, L.pts.length - 2]].forEach(([a, b]) => {
        const dx = L.pts[a][0] - L.pts[b][0], dz = L.pts[a][1] - L.pts[b][1], l = Math.hypot(dx, dz) || 1;
        RIVERS.forEach(r => { const n = nearestOnPoly(L.pts[a][0], L.pts[a][1], r.pts); if (n.d < r.half + 170) eps.push({ L, a, x: L.pts[a][0], z: L.pts[a][1], dx: dx / l, dz: dz / l, river: r.id, side: n.side, half: r.half, d: n.d }); });
      });
    });
    const cand = [];
    for (let i = 0; i < eps.length; i++) for (let j = i + 1; j < eps.length; j++) {
      const A = eps[i], B = eps[j];
      if (A.river !== B.river || A.side === B.side || A.L === B.L) continue;
      const vx = B.x - A.x, vz = B.z - A.z, len = Math.hypot(vx, vz);
      if (len > 300 || len < A.half * 2 + 8) continue;
      const ux = vx / len, uz = vz / len;
      if (A.dx * ux + A.dz * uz < 0.93 || -(B.dx * ux + B.dz * uz) < 0.93) continue;
      cand.push({ A, B, len });
    }
    cand.sort((p, q) => p.len - q.len);
    const used = new Set(); let n = 0;
    cand.forEach(({ A, B }) => {
      if (used.has(A) || used.has(B)) return;
      if (pathLen(A.L.pts) < PAD + 30 || pathLen(B.L.pts) < PAD + 30) return;
      if (!allowed(cIdx++)) return;
      eps.forEach(e => { if (e.L === A.L && e.a === A.a || e.L === B.L && e.a === B.a) used.add(e); });
      const ta = take(A.L, A.a === 0), tb = take(B.L, B.a === 0);
      if (!ta || !tb) return;
      rehome(ta[0], ta[ta.length - 1], [A.L, B.L]); rehome(tb[0], tb[tb.length - 1], [A.L, B.L]);
      // ta runs from the river end of A back to its cut point; the bridge goes cutA -> A -> B -> cutB
      lines.push({ id: 'RB' + (n++), cls: A.L.cls === 'six' || B.L.cls === 'six' ? 'six' : 'four', pts: [...ta.slice().reverse(), ...tb], anchors: [pathLen(ta), pathLen(ta) + Math.hypot(A.x - B.x, A.z - B.z)], bridge: true, lowBridge: true, noBridge: 'highway', name: A.L.name || B.L.name });
    });
    warnings.push('river bridges added: ' + n);
  }
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
  { // the drawbridge: the street that crosses the north river between (651, 558) and (566, 642) becomes a low movable bridge (see drawbridge.js)
    const L = lines.find(l => l.pts.length === 2 && Math.hypot(l.pts[0][0] - 651, l.pts[0][1] - 557.75) < 3 && Math.hypot(l.pts[1][0] - 565.75, l.pts[1][1] - 642.25) < 3);
    if (L) { L.drawbridge = true; L.name = 'Drawbridge'; } else warnings.push('drawbridge street not found');
  }
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
  const XH = 210, ENTRY_END = 45;       // a slip road touches its carriageway XH units from where its curve takes over; ENTRY_END only places the 'next exits' signs
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
      const sg = exitKind ? f : -f;                                  // direction of travel along the interstate as seen from the ramp's outward end
      let ia = 0; while (ia < r.length - 3 && along(r[ia]).d < 50) ia++;
      const sa = along(r[ia]).s, total = polyLen(H);
      const room = sg > 0 ? sa - 135 : total - 135 - sa; let xh = Math.max(100, Math.min(XH, room));       // near the interstate's ends the slip road gets less room
      const laneWet = x0 => { for (let x = 0; x <= xh; x += 10) { const s = Math.max(0, Math.min(total, x0 + sg * x)), p = atLen(H, s), l = 23 * f;
        if (RIVERS.some(rv => nearestOnPoly(p.x - p.dz * l, p.z + p.dx * l, rv.pts).d < rv.half + 64)) return true; } return false; };   // 64 = the bridge approach ramp of the interstate (about 53 u) + margin: a slip road must join the carriageway at ground level
      while (xh > 100 && laneWet(sa - sg * xh)) xh -= 10;                                               // the extra lane must not run over a river
      r.plan = { ia, sg, xh, s0: Math.max(0, Math.min(total, sa - sg * xh)) };
      needS.push(r.plan.s0);
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
    [12, 36, 60, 90, 120].forEach(d => { sv.add(d); sv.add(total - d); });
    const sl = [...sv].filter(v => v >= 0 && v <= total).sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > 1.5);
    // The two carriageways never overlap: they come together as the two halves of the arterial they end in (3 lanes each, 8.4 u wide,
    // centred 4.2 u from the middle) and only widen to full interstate width (centred CAR_OFF) once they are clear of each other.
    // offset from the median line: 0 -> 4.2 over the last 12 u, 4.2 -> 8.4 up to 60 u (the narrow 'hwEnd' road, half an arterial), 8.4 -> CAR_OFF by 120 u.
    const sm = k => k * k * (3 - 2 * k);
    const offAt = s => { const e = Math.min(s, total - s); return e <= 12 ? 4.2 * sm(e / 12) : e <= 60 ? 4.2 + 4.2 * sm((e - 12) / 48) : e < 120 ? 8.4 + (CAR_OFF - 8.4) * sm((e - 60) / 60) : CAR_OFF; };
    const make = f => sl.map(s => { const h = hwPoint(s), l = offAt(s) * f; return [h.x + h.rx * l, h.z + h.rz * l]; });
    const fw = make(1), bw = make(-1).reverse();
    // cut each carriageway into end pieces (narrow arterial class) and the interstate proper
    const cutLine = (id, pts, flip) => {
      const n = pts.length, idx = i => flip ? n - 1 - i : i;        // vertex i of the list in path order
      const sAt = i => sl[idx(i)];
      const first = pts.findIndex((p, i) => (flip ? total - sAt(i) : sAt(i)) >= 60), lastIdx = (() => { let k = n - 1; while (k > 0 && (flip ? total - sAt(k) : sAt(k)) > total - 60) k--; return k; })();
      lines.push({ id: id + 'a', cls: 'hwEnd', pts: pts.slice(0, first + 1), keepEnds: true, oneWay: true, name: 'Interstate' });
      lines.push({ id, cls: 'hw', pts: pts.slice(first, lastIdx + 1), keepEnds: true, oneWay: true, name: 'Interstate' });
      lines.push({ id: id + 'b', cls: 'hwEnd', pts: pts.slice(lastIdx), keepEnds: true, oneWay: true, name: 'Interstate' });
    };
    cutLine('HWF', fw, false); cutLine('HWB', bw, true);
  }
  IX.forEach(ix => {
    if (!ix.P) return;
    ix.ramps.forEach(r => {
      const { f, kind } = r, ex = kind === 'exit', { ia, sg, s0, xh } = r.plan, LL = 23, HM = xh >= 210 ? 90 : 60, PAR = Math.max(0, xh - 40 - HM);
      const at = (x, l) => { const h = hwPoint(s0 + sg * x); return [h.x + h.rx * f * l, h.z + h.rz * f * l]; };
      const sm = k => k * k * (3 - 2 * k), out = [];
      for (let x = 0; x <= 40; x += 10) out.push(at(x, CAR_OFF + (LL - CAR_OFF) * sm(x / 40)));     // leaves the carriageway as a 4th lane ...
      if (PAR > 0) out.push(at(40 + PAR / 2, LL), at(40 + PAR, LL));                                  // ... runs alongside (up to 80 u) ...
      const P0 = out[out.length - 1], P1 = r[ia], tg = hwPoint(s0 + sg * (40 + PAR));
      const T0 = [(tg.rz) * f * sg, -(tg.rx) * f * sg], ta = [r[Math.min(r.length - 1, ia + 5)][0] - P1[0], r[Math.min(r.length - 1, ia + 5)][1] - P1[1]], tl = Math.hypot(ta[0], ta[1]) || 1, ch = dist(P0, P1) * 0.7;
      for (let k = 1; k <= 8; k++) {                                                                  // ... then a smooth curve (Hermite) onto the traced arc
        const t = k / 8, h00 = 2 * t ** 3 - 3 * t * t + 1, h10 = t ** 3 - 2 * t * t + t, h01 = -2 * t ** 3 + 3 * t * t, h11 = t ** 3 - t * t;
        out.push([h00 * P0[0] + h10 * ch * T0[0] + h01 * P1[0] + h11 * ch * ta[0] / tl, h00 * P0[1] + h10 * ch * T0[1] + h01 * P1[1] + h11 * ch * ta[1] / tl]);
      }
      const arc = r.slice(ia + 1, -1).concat([r.junction]);
      const pts = out.concat(arc);
      // the Hermite join can overshoot and double back by a couple of units, leaving a spike (a dead stub) in the slip road: drop such vertices
      for (let again = true, guard = 0; again && guard++ < 20;) {
        again = false;
        for (let i = 1; i < pts.length - 1; i++) {
          const ax = pts[i][0] - pts[i - 1][0], az = pts[i][1] - pts[i - 1][1], bx = pts[i + 1][0] - pts[i][0], bz = pts[i + 1][1] - pts[i][1];
          if (ax * bx + az * bz < -0.2 * Math.hypot(ax, az) * Math.hypot(bx, bz)) { pts.splice(i, 1); again = true; break; }
        }
      }
      ramps.push({ pts: ex ? pts : pts.slice().reverse(), kind, f, ix, inside: true });
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
