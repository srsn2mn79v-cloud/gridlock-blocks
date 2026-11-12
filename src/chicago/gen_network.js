// Lays out every road of the Chicago map (arterials, grids, the interstate and its interchanges)
// and returns the road graph. See map.js for the coordinates this is transcribed from.
// Lays out every road of the map (the traced streets, the interstate and its interchanges) and returns the road graph.
// The streets come from the map data (mapdata.json / the studio); see map.js.
import { buildNetwork, CLASSES } from './network.js';
import { MAP, T, TP, RIVERS, HIGHWAY_PX, STREETS, IXS, X0, Y0, fromWorld, OUTROAD } from './map.js';
import { spline, nearestOnPoly, pointInPoly, distToSeg, dist, polyLen, atLen, segInter } from './geom.js';

export function generateRoads() {
  const warnings = [];
  // ---- the interstate --------------------------------------------------------------------------------------------
  const hasHW = HIGHWAY_PX.length >= 2;
  let H = hasHW ? spline(TP(HIGHWAY_PX), 75) : [];
  const cityPt = T(X0, Y0);
  const citySide = hasHW ? nearestOnPoly(cityPt[0], cityPt[1], H).side : 1;
  const CAR_OFF = 11.5;      // each carriageway (3 lanes) is centred this far from the median line
  const hwBarrier = { kind: 'highway', half: 19, pts: H };

  // ---- the streets: every traced line of the map ------------------------------------------------------------------------------
  const lines = [];
  STREETS.forEach((s, i) => {
    if (!s.pts || s.pts.length < 2) return;
    const pts = TP(s.pts);
    lines.push({ id: 'L' + i, cls: CLASSES[s.cls] ? s.cls : 'two', pts: pts.map(p => [p[0], p[1]]), bridge: true, noBridge: 'highway', name: s.name });
  });
  // ---- bridges and tunnels marked on the map: map.structs = [{at:[X,Y], len, h}] (h > 0 a bridge that high, h < 0 a tunnel that deep, in units)
  //      or {line:'name', from, to, h} to span part of a named road (to < 0 counts back from its end) ----
  {
    const plen = pts => pts.reduce((t, q, i) => i ? t + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0, 0);
    (MAP.structs || []).forEach(st => {
      if (st.line) { const L = lines.find(l => l.name === st.line); if (!L) { warnings.push('structure road not found: ' + st.line); return; } const tot = plen(L.pts); (L.structs ||= []).push({ s0: st.from, s1: st.to < 0 ? tot + st.to : st.to, h: st.h }); return; }
      const [x, z] = T(st.at[0], st.at[1]); let best = null;
      lines.forEach(L => { let acc = 0; for (let i = 1; i < L.pts.length; i++) { const l = Math.hypot(L.pts[i][0] - L.pts[i - 1][0], L.pts[i][1] - L.pts[i - 1][1]), r = distToSeg(x, z, L.pts[i - 1][0], L.pts[i - 1][1], L.pts[i][0], L.pts[i][1]); if (!best || r.d < best.d) best = { d: r.d, L, s: acc + r.t * l, tot: 0 }; acc += l; } });
      if (!best || best.d > 40) { warnings.push('no road at the structure at ' + st.at); return; }
      const tot = plen(best.L.pts), s0 = Math.max(0, best.s - st.len / 2), s1 = Math.min(tot, best.s + st.len / 2);
      (best.L.structs ||= []).push({ s0, s1, h: st.h });
    });
  }
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
    const allowed = idx => (globalThis.__RB_ONLY || (process.env.RB_ONLY ? JSON.parse(process.env.RB_ONLY) : RB_ALLOW)).includes(idx);
    lines.slice().forEach(L => {
      if ((L.cls !== 'six' && L.cls !== 'four') || L.pts.length < 2) return;
      const p0 = L.pts[0], p1 = L.pts[L.pts.length - 1], s0 = sideAt(p0[0], p0[1]), s1 = sideAt(p1[0], p1[1]);
      if (!s0 || !s1 || s0.id !== s1.id || s0.side === s1.side) return;
      const nb = pt => lines.filter(o => o !== L && (o.cls === 'six' || o.cls === 'four') && !o.lowBridge && [o.pts[0], o.pts[o.pts.length - 1]].some(q => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < 1.5))
        .sort((x, y) => pathLen(y.pts) - pathLen(x.pts))[0];
      const na = nb(p0), nbb = nb(p1);
      if (!na || !nbb || pathLen(na.pts) < PAD + 30 || pathLen(nbb.pts) < PAD + 30) return;
      if (process.env.DBGRB) console.error('ARTERIAL', cIdx, L.cls, Math.round(p0[0]), Math.round(p0[1]), '->', Math.round(p1[0]), Math.round(p1[1]));
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
      if (process.env.DBGRB) console.error('CAND', cIdx, A.L.cls, Math.round(A.x), Math.round(A.z), '->', Math.round(B.x), Math.round(B.z));
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
  if (hasHW) { // the interstate runs from one end of the lake-shore drive to the other
    const s0 = hook(H[0], 45), s1 = hook(H[H.length - 1], 45);
    if (s0) H[0] = s0.slice(); else warnings.push('the interstate does not reach the street map at its first end');
    if (s1) H[H.length - 1] = s1.slice(); else warnings.push('the interstate does not reach the street map at its last end');
  }

  // ---- interchanges: a street goes over the interstate; slip roads (with a deceleration lane on the way off and a
  // merge lane on the way on) leave from the right-hand side of each direction and meet that street 66 units away.
  // The side away from the city has no street of its own, so the street carries on over the interstate on a bridge
  // to meet the outside ramps - that is how the "outside lane" gets its exits.
  // the road out of town (outroads.js). With `clover: '<interchange label>'` it takes that interchange over: instead of a street on a bridge
  // with slip roads, the road out of town itself crosses the interstate there and the two are joined by a full cloverleaf (see below).
  const OR = (OUTROAD && OUTROAD.pts && OUTROAD.pts.length >= 2 && !(typeof process !== 'undefined' && process.env && process.env.NO_OUTROAD)) ? OUTROAD : null;
  const IX = IXS.map((ix, k) => {
    const sw = TP(ix.pts); const q = hook(sw[sw.length - 1], 60); if (q) sw[sw.length - 1] = q;
    const clover = !!(OR && OR.clover && hasHW && ix.label === OR.clover);
    return { sw, loops: /cloverleaf/i.test(ix.template || ''), ramps: clover ? [] : (ix.ramps || []).map(r => TP(r)), cls: ix.cls || 'six', no: k + 1, clover,
      label: clover ? (OR.exit || OR.name) : (ix.label || ('Interchange ' + (k + 1))) };
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
      const f = e.side, up = (f > 0 ? e.s < hs : e.s > hs);   // the right-hand carriageway of the side the arc is on; upstream of the street = diagonal exit
      const turning = (() => { let t = 0, ph = null; for (let i = 1; i < r.length; i++) { const h = Math.atan2(r[i][1] - r[i - 1][1], r[i][0] - r[i - 1][0]); if (ph !== null) t += Math.abs(Math.atan2(Math.sin(h - ph), Math.cos(h - ph))); ph = h; } return t; })();
      const isLoop = turning > 3.4, exitKind = isLoop ? !up : up;                      // a cloverleaf's loops are the other way round: traffic leaves AFTER the crossing and loops round 270 degrees back to the street, and joins BEFORE it
      r.f = f; r.isLoop = isLoop; r.kind = exitKind ? 'exit' : 'entry';
      const sg = exitKind ? f : -f;                                  // direction of travel along the interstate as seen from the ramp's outward end
      let ia = 0; while (ia < r.length - 3 && along(r[ia]).d < 50) ia++;
      const sa = along(r[ia]).s, total = polyLen(H);
      const room = sg > 0 ? sa - 135 : total - 135 - sa; let xh = Math.max(100, Math.min(r.isLoop ? 100 : XH, room));      // loops: a short lane (the loop ramps of one carriageway would otherwise overlap each other)
            // near the interstate's ends the slip road gets less room
      const laneWet = x0 => { for (let x = 0; x <= xh; x += 10) { const s = Math.max(0, Math.min(total, x0 + sg * x)), p = atLen(H, s), l = 23 * f;
        if (RIVERS.some(rv => nearestOnPoly(p.x - p.dz * l, p.z + p.dx * l, rv.pts).d < rv.half + 64)) return true; } return false; };   // 64 = the bridge approach ramp of the interstate (about 53 u) + margin: a slip road must join the carriageway at ground level
      while (xh > 100 && laneWet(sa - sg * xh)) xh -= 10;                                               // the extra lane must not run over a river
      r.plan = { ia, sg, xh, s0: Math.max(0, Math.min(total, sa - sg * xh)) };
      needS.push(r.plan.s0);
    });
  });
  // ---- the road out of town, part 1: its path, and where its cloverleaf's slip roads touch the interstate ---------------------------------
  const CL = { E0: 30, FL: 60, R: 67, V: 330, RHO: 60, CS: 290, ARC: 14 };     // cloverleaf: loops leave E0 past the crossing on a FL-long lane and turn on radius R (= E0 + FL - 23) in ARC pieces; the outer ramps start V out; the city side's meet the interstate CS out.
  // Keep the pieces long (15 u or more): every bend in a road is rounded and levelled, so short pieces on a slope turn into steps (tools/check.mjs smooth).
  let OP = null;
  if (OR) {
    const px = TP(OR.pts), cl = IX.find(x => x.clover && x.P);
    if (cl) {                                                  // the cloverleaf's road starts 30 u on the city side of the old interchange's inner junction (room for the bridge to come down)
      const a = cl.sw[1], b = cl.sw[2] || cl.sw[1], l = dist(a, b) || 1, k = Math.min(30, l - 20) / l;
      cl.start = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; px[0] = cl.start.slice();
    }
    const P = spline(px, 75);
    if (!cl) { const q0 = hook(P[0], 60); if (q0) P[0] = q0.slice(); else warnings.push('the road out of town does not reach the street map'); }
    OP = { P, cl, ps: 0, hs: 0 };
    if (cl) {
      let hit = null, pa = 0;
      for (let j = 1; j < P.length && !hit; j++) { let ha = 0; for (let i = 1; i < H.length && !hit; i++) {
        const r = segInter(P[j - 1], P[j], H[i - 1], H[i]);
        if (r) hit = { ps: pa + r.t * dist(P[j - 1], P[j]), hs: ha + r.u * dist(H[i - 1], H[i]) };
        ha += dist(H[i - 1], H[i]); } pa += dist(P[j - 1], P[j]); }
      if (!hit) { warnings.push('the road out of town misses the interstate: no cloverleaf'); OP.cl = null; }
      else { Object.assign(OP, hit); [-1, 1].forEach(sg => needS.push(hit.hs + sg * CL.E0, hit.hs + sg * (CL.V + CL.FL), hit.hs + sg * CL.CS)); }
    }
  }
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
  if (hasHW) {
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
    if (ix.clover && OP && OP.cl) { lines.push({ id: 'IXS' + ix.no, cls: ix.cls, pts: [ix.start, ix.sw[ix.sw.length - 1]], bridge: true, noBridge: 'highway' }); return; }   // only the stub from the junction into the city is left
    lines.push({ id: 'IXS' + ix.no, cls: ix.cls, pts: [[ix.sw[0][0] + d0[0] / l0 * 70, ix.sw[0][1] + d0[1] / l0 * 70], ...ix.sw], bridge: true, crossHW: true, ixStreet: true });
  });
  // ---- the road out of town, part 2 (OUTROADS in outroads.js: { to, name, pts, clover? }) -------------------------------------------------
  // A long interstate from the edge of the city (pts[0]) out to a tunnel mouth (the last point), where interstate.js sends the player on
  // to the city named in `to`. It is built like the city's own interstate: two one-way carriageways either side of a median that come
  // together into the street they start from. At the far end they do not stop: hidden inside the tunnel's hill the outbound carriageway
  // swings round in a wide loop and comes back as the inbound one, so AI traffic drives into the tunnel and a steady stream comes back
  // out of it, with no dead end.
  let OUT = null;
  if (OP) {
    const io = OR, P = OP.P, cl = OP.cl;
    const total = polyLen(P), LOOP_R = 48, LOOP_L = 110, sm = k => k * k * (3 - 2 * k), END = 60, DECK = 25, PLAT = 66, APP = 124;
    const at = s => { const p = atLen(P, Math.max(0, Math.min(total, s))); return { x: p.x, z: p.z, rx: -p.dz, rz: p.dx, dx: p.dx, dz: p.dz }; };
    const sv = new Set([0, total]); { let acc = 0; for (let i = 1; i < P.length; i++) { acc += dist(P[i - 1], P[i]); sv.add(acc); } }
    [12, 36, END, 90, 120].forEach(d => sv.add(d));
    if (cl) [OP.ps - CL.E0, OP.ps + CL.E0, OP.ps + CL.V + CL.FL].forEach(d => sv.add(d));        // where the cloverleaf's slip roads touch it
    const sl = [...sv].filter(v => v >= 0 && v <= total).sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > 1.5 || (cl && [CL.E0, -CL.E0, CL.V + CL.FL].some(d => Math.abs(v - OP.ps - d) < 1e-6)));
    const offAt = s => s <= 12 ? 4.2 * sm(s / 12) : s <= 60 ? 4.2 + 4.2 * sm((s - 12) / 48) : s < 120 ? 8.4 + (CAR_OFF - 8.4) * sm((s - 60) / 60) : CAR_OFF;   // same taper as the city interstate's ends
    const side = f => sl.map(s => { const h = at(s), l = offAt(s) * f; return [h.x + h.rx * l, h.z + h.rz * l]; });
    const out = side(1), back = side(-1).reverse();
    const M = at(total), lp = (s, lat) => [M.x + M.dx * s + M.rx * lat, M.z + M.dz * s + M.rz * lat], loop = [];
    const TUBE = 72;                                             // straight on for the length of the tunnel tubes, so nothing is seen to turn inside them
    loop.push(lp(TUBE, CAR_OFF));
    for (let k = 1; k <= 6; k++) loop.push(lp(TUBE + LOOP_L * k / 6, CAR_OFF + (LOOP_R - CAR_OFF) * sm(k / 6)));
    for (let k = 1; k <= 12; k++) { const a = Math.PI * k / 12; loop.push(lp(TUBE + LOOP_L + LOOP_R * Math.sin(a), LOOP_R * Math.cos(a))); }
    for (let k = 5; k >= 1; k--) loop.push(lp(TUBE + LOOP_L * k / 6, -(CAR_OFF + (LOOP_R - CAR_OFF) * sm(k / 6))));
    loop.push(lp(TUBE, -CAR_OFF));
    const iE = sl.findIndex(s => s >= END), n = sl.length, name = io.name || 'Interstate';

    // ---- the cloverleaf: the road out of town bridges the interstate; in each of the four quarters a loop (the left turn, 270 degrees
    // to the right) and an outer ramp (the right turn) join the two. On the city side there is no room for a long outer ramp, so those
    // two start and end at the junction where the road out of town begins, as the old interchange's slip roads did.
    const keepXZ = [], cramps = [];
    if (cl) {
      // the bridge: level at 4.6 over the interstate and on to PLAT (the loops join it there: a junction needs level road), then down to the ground at APP
      const elP = d => d <= PLAT ? 4.6 : d >= APP ? 0 : 4.6 * (1 - (d - PLAT) / (APP - PLAT));
      const elR = d => d <= PLAT ? 4.6 : Math.max(elP(d), 4.6 - 0.05 * (d - PLAT));        // a slip road beside the slope comes down a little more gently than the bridge does
      const RH = { sc: OP.hs, at: s => { const p = atLen(H, Math.max(0, Math.min(polyLen(H), s))); return p; }, off: () => CAR_OFF, el: () => 0, isH: true };
      const RP = { sc: OP.ps, at: s => atLen(P, Math.max(0, Math.min(total, s))), off: offAt, el: elR, isH: false };
      const LL = 2 * CAR_OFF, ARC_N = CL.ARC, TOP = 4.6;
      const quarter = (A, sa, B) => {
        const ta = A.at(A.sc), tb = B.at(B.sc), da = [sa * ta.dx, sa * ta.dz], sb = (da[1] * tb.dx - da[0] * tb.dz) > 0 ? 1 : -1;    // b = left of a
        const onA = (u, lat) => { const p = A.at(A.sc + sa * u); return [p.x - sa * p.dz * lat, p.z + sa * p.dx * lat]; };
        const onB = (v, lat) => { const p = B.at(B.sc - sb * v); return [p.x - sb * p.dz * lat, p.z + sb * p.dx * lat]; };
        const map = (u, v) => { const pa = onA(u, v), pb = onB(v, u), w = u * u / ((u * u + v * v) || 1); return [pa[0] * w + pb[0] * (1 - w), pa[1] * w + pb[1] * (1 - w)]; };
        const offA = u => A.off(A.sc + sa * u), offB = v => B.off(B.sc - sb * v);
        return { A, B, sa, sb, onA, onB, map, offA, offB };
      };
      const push = (pts, elevs, rec) => { cramps.push({ pts, elevs, ...rec }); };
      // the loop: leaves A just past the crossing, runs beside it for FL, turns three quarters of a circle and joins B before the crossing
      const loopRamp = Q => {
        // Beside the interstate (on the ground) the slip road's own lane is FL long. Beside the bridge it is short (FLB) and level with the
        // bridge, so that where the two still overlap they are at one height; from there it runs on beside the bridge to where the circle
        // starts and comes down steadily all the way round the loop.
        const { E0, FL, R } = CL, FLB = 36, cu = E0 + FL, cv = LL + R, pts = [], el = [], fa = Q.A.isH ? FL : FLB, fb = Q.B.isH ? FL : FLB;
        const head = [], mid = [], tail = [];
        for (let k = 0; k <= 4; k++) { const u = E0 + fa * k / 4; head.push(k === 0 ? Q.onA(u, Q.offA(u)) : Q.map(u, Q.offA(E0) + (LL - Q.offA(E0)) * sm(k / 4))); }
        if (fa < FL) mid.push(Q.map(cu, LL));
        for (let k = 1; k < ARC_N; k++) { const th = 1.5 * Math.PI * k / ARC_N; mid.push(Q.map(cu + R * Math.sin(th), cv - R * Math.cos(th))); }
        if (fb < FL) mid.push(Q.map(LL, cv));
        for (let k = 0; k <= 4; k++) { const v = E0 + fb - fb * k / 4; tail.push(k === 4 ? Q.onB(v, Q.offB(v)) : Q.map(LL - (LL - Q.offB(E0)) * sm(k / 4), v)); }
        const eA = Q.A.isH ? 0 : TOP, eB = Q.B.isH ? 0 : TOP;
        // heights: level along both lanes, a steady slope (by distance) between the end of one and the start of the other
        const run = [head[head.length - 1], ...mid, tail[0]], acc = [0]; for (let i = 1; i < run.length; i++) acc.push(acc[i - 1] + dist(run[i - 1], run[i]));
        head.forEach(p => { pts.push(p); el.push(eA); });
        mid.forEach((p, i) => { pts.push(p); el.push(eA + (eB - eA) * acc[i + 1] / acc[acc.length - 1]); });
        tail.forEach(p => { pts.push(p); el.push(eB); });
        return { pts, el };
      };
      // the outer ramp: leaves B a long way before the crossing, cuts the corner outside the loop and joins A well past the crossing
      const outerRamp = Q => {
        const { V, FL, RHO } = CL, pts = [];
        for (let k = 0; k <= 4; k++) { const v = V + FL - FL * k / 4; pts.push(k === 0 ? Q.onB(v, Q.offB(v)) : Q.map(Q.offB(V + FL) + (LL - Q.offB(V + FL)) * sm(k / 4), v)); }
        for (let k = 1; k <= 3; k++) { const f = Math.PI / 4 * k / 3; pts.push(Q.map(LL + RHO - RHO * Math.cos(f), V - RHO * Math.sin(f))); }
        for (let k = 3; k >= 0; k--) { const f = Math.PI / 4 * k / 3; pts.push(Q.map(V - RHO * Math.sin(f), LL + RHO - RHO * Math.cos(f))); }
        for (let k = 1; k <= 4; k++) { const u = V + FL * k / 4; pts.push(k === 4 ? Q.onA(u, Q.offA(u)) : Q.map(u, LL - (LL - Q.offA(V + FL)) * sm(k / 4))); }
        return { pts, el: pts.map(() => 0) };
      };
      // the city side's outer ramp: between the interstate (p along it) and the junction at the start of the road out of town (q = OP.ps along that)
      const cityRamp = (Q, hIsA) => {
        const J = OP.ps, C0 = CL.CS - 46, way = [[0, J], [50, J - 6], [105, J - 17], [148, 152], [172, 112], [188, 70], [206, 40], [C0 - 16, LL + 0.8], [C0, LL]];
        const sp = spline(way, 18), pq = sp.concat([1, 2, 3, 4].map(k => [C0 + 46 * k / 4, LL - (LL - CAR_OFF) * sm(k / 4)]));
        const pts = pq.map(([p, q], i) => i === 0 ? (hIsA ? Q.onB(J, 0) : Q.onA(J, 0)) : i === pq.length - 1 ? (hIsA ? Q.onA(p, CAR_OFF) : Q.onB(p, CAR_OFF)) : (hIsA ? Q.map(p, q) : Q.map(q, p)));
        return { pts: hIsA ? pts : pts.reverse(), el: pts.map(() => 0) };
      };
      [[RH, 1, RP], [RH, -1, RP], [RP, 1, RH], [RP, -1, RH]].forEach(([A, sa, B]) => {
        const Q = quarter(A, sa, B);
        // which side of the interstate this quarter is on: the city (where the road out of town starts, OP.ps before the crossing) or the open country
        const city = A.isH ? Q.sb > 0 : sa < 0;
        const lr = loopRamp(Q);
        push(lr.pts, lr.el, { kind: A.isH ? 'exit' : 'link', f: A.isH ? sa : Q.sb, ix: cl, inside: true });
        const orr = city ? cityRamp(Q, A.isH) : outerRamp(Q);
        push(orr.pts, orr.el, { kind: A.isH ? 'link' : 'exit', f: A.isH ? sa : Q.sb, ix: cl, inside: true });    // the outer ramp runs B -> A: it leaves the interstate when B is the interstate
        [lr, orr].forEach(r => [r.pts[0], r.pts[r.pts.length - 1]].forEach(e => keepXZ.push(e)));
      });
    }
    lines.push({ id: 'OUTa', cls: 'hwEnd', pts: out.slice(0, iE + 1), keepEnds: true, oneWay: true, name });
    lines.push({ id: 'OUT', cls: 'hw', pts: [...out.slice(iE), ...loop, ...back.slice(0, n - iE)], keepEnds: true, oneWay: true, name, outroad: true, crossHW: !!cl, crossProf: { d1: DECK, plat: PLAT, d2: APP, h: 4.6 }, keepXZ });
    lines.push({ id: 'OUTb', cls: 'hwEnd', pts: back.slice(n - iE - 1), keepEnds: true, oneWay: true, name });
    cramps.forEach((r, i) => { ramps.push(r); r.custom = true; });
    OUT = { to: io.to, name, sign: io.sign || String(io.to).toUpperCase(), pts: P, total, mouth: { x: M.x, z: M.z, dx: M.dx, dz: M.dz }, loopR: LOOP_R, loopL: LOOP_L, tube: TUBE, off: CAR_OFF,
      start: cl ? OP.ps + CL.V + CL.FL + 30 : 150 };       // where the open road begins (beyond the cloverleaf, if there is one)
  }
  ramps.forEach((r, i) => lines.push({ id: 'RP' + i, cls: 'ramp', pts: r.pts, noJoin: true, ramp: r, ...(r.custom ? { fixedEnds: true, elevs: r.elevs } : {}) }));

  // ---- barriers for the bridge builder -----------------------------------------------------------------------------------------------------
  const barriers = RIVERS.map(r => ({ kind: 'river', half: r.half, pts: r.pts })).concat(hasHW ? [hwBarrier] : []);
  const net = buildNetwork(lines, barriers, { warn: m => warnings.push(m), minEdge: 13, stubLen: hasHW ? 90 : (+process.env.STUB || 320) });
  return { net, lines, H, warnings, IX, ramps, CAR_OFF, ENTRY_END, OUT };
}
