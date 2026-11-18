// Premade junctions for the City builder. Each piece is stamped into map.streets / map.structs as ordinary roads (map pixels, 1 px = S units,
// 1 unit = 1.25 m), so the game builds them like any other road. Pure geometry, no DOM.
export const S = 2.5;
const r2 = v => Math.round(v * 100) / 100;
const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const plen = pts => pts.reduce((t, q, i) => i ? t + hyp(q, pts[i - 1]) : 0, 0);

export const ROUNDABOUTS = {
  small: { name: 'Small roundabout', R: 24, cls: 'two', blurb: 'One lane, 30 m across: for quiet streets.' },
  medium: { name: 'Roundabout', R: 34, cls: 'four', blurb: 'Three lanes, 43 m across: two avenues meet.' },
  large: { name: 'Large roundabout', R: 46, cls: 'four', blurb: 'Three lanes, 58 m across: room for five arms.' }
};

// Where does the segment a-b cross the circle (centre c, radius R)? parameters t in (0,1), sorted.
function circleHits(a, b, c, R) {
  const dx = b[0] - a[0], dy = b[1] - a[1], fx = a[0] - c[0], fy = a[1] - c[1], A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - R * R, D = B * B - 4 * A * C;
  if (A < 1e-12 || D <= 0) return [];
  const q = Math.sqrt(D); return [(-B - q) / (2 * A), (-B + q) / (2 * A)].filter(t => t > 1e-6 && t < 1 - 1e-6);
}

// A roundabout at c (px): the streets that cross its circle are cut at the ring and now end on it. Traffic goes round anticlockwise (driving on the right),
// the ring is one-way and has priority. Returns { warnings }.
export function roundabout(streets, c, kind = 'medium') {
  const spec = ROUNDABOUTS[kind] || ROUNDABOUTS.medium, Ru = spec.R, R = Ru / S, warnings = [];
  const inside = p => hyp(p, c) < R - 1e-6, ang = p => Math.atan2(c[1] - p[1], p[0] - c[0]);
  const minGap = 2 * Math.asin(Math.min(0.9, 7.5 / Ru)), ends = [];        // 7.5 u: the game merges edges shorter than 13 u
  const keep = [];
  streets.forEach(s => {
    if (s.ring) { keep.push(s); return; }
    if (s.pts.some(p => hyp(p, c) < R + 3) && (s.cls === 'hw')) warnings.push('A highway runs through the roundabout: move it.');
    if (s.cls === 'hw') { keep.push(s); return; }
    // the points of the street with the circle crossings added, each tagged on-circle or not
    const seq = [];
    s.pts.forEach((p, i) => { if (i) circleHits(s.pts[i - 1], p, c, R).forEach(t => { const a = s.pts[i - 1]; seq.push({ p: [a[0] + (p[0] - a[0]) * t, a[1] + (p[1] - a[1]) * t], on: true }); }); seq.push({ p, on: false }); });
    if (!seq.some(q => q.on) && !inside(seq[0].p)) { keep.push(s); return; }
    const runs = []; let cur = null;
    for (let i = 0; i < seq.length; i++) {
      const A = seq[i], B = seq[i + 1], midIn = B ? inside([(A.p[0] + B.p[0]) / 2, (A.p[1] + B.p[1]) / 2]) : inside(A.p);
      if (B) {
        if (!midIn) { if (!cur) cur = [A]; cur.push(B); }
        else if (cur) { runs.push(cur); cur = null; }
      }
    }
    if (cur) runs.push(cur);
    const made = runs.filter(r => plen(r.map(q => q.p)) * S >= 14).map(r => r.map(q => q.on ? { ...q, p: [q.p[0], q.p[1]] } : q));
    made.forEach((r, k) => {
      r.forEach((q, j) => { if (q.on && (j === 0 || j === r.length - 1)) ends.push({ run: r, j, a: ang(q.p) }); });
      const ns = k === 0 ? s : { ...s }; ns.ctl = undefined; ns.__run = r; keep.push(ns);
    });
  });
  // ring vertices: where streets arrive (nearby arrivals share one vertex), and filler between them
  ends.sort((p, q) => p.a - q.a);
  const verts = [];
  ends.forEach(e => { const last = verts[verts.length - 1]; if (last && e.a - last.a < minGap) e.v = last; else { e.v = { a: e.a }; verts.push(e.v); } });
  if (verts.length > 1 && verts[0].a + 2 * Math.PI - verts[verts.length - 1].a < minGap) { const l = verts.pop(); ends.forEach(e => { if (e.v === l) e.v = verts[0]; }); }
  const at = a => [r2(c[0] + R * Math.cos(a)), r2(c[1] - R * Math.sin(a))];
  const ring = [];
  if (!verts.length) verts.push({ a: Math.PI / 2 });
  const maxGap = 24 / Ru;
  verts.forEach((v, i) => {
    const nx = verts[(i + 1) % verts.length], gap = verts.length === 1 ? 2 * Math.PI : ((nx.a - v.a) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    const n = Math.max(1, Math.min(Math.ceil(gap / maxGap), Math.floor(gap / minGap) || 1), verts.length === 1 ? 6 : 1);
    for (let k = 0; k < n; k++) { const a = v.a + gap * k / n; ring.push(at(a)); if (k === 0) v.p = ring[ring.length - 1]; }
  });
  ring.push(ring[0].slice());
  ends.forEach(e => { e.run[e.j].p = e.v.p.slice(); });
  keep.forEach(s => { if (s.__run) { s.pts = s.__run.map(q => [r2(q.p[0]), r2(q.p[1])]); delete s.__run; } });
  streets.length = 0; keep.forEach(s => streets.push(s));
  streets.push({ cls: spec.cls, pts: ring, oneWay: true, ring: true, name: spec.name });
  return { warnings, arms: verts.length };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Highway pieces. A highway drawn in the builder is a pair of one-way carriageways (map.streets with cls 'hw' and a shared `pair`), the first one
// on the right of its own direction. Ramps are streets of class 'ramp' that start and end on a vertex of a carriageway.
export const HW_OFF = 11.5;                      // units from the middle of the pair to the middle of a carriageway (the game's interstate uses the same)

export function curve(ctl, step = 6) {           // centripetal Catmull-Rom through the points, a point about every `step` px
  if (ctl.length < 3) return ctl.map(q => [q[0], q[1]]);
  const P = [ctl[0], ...ctl, ctl[ctl.length - 1]].map(q => ({ x: q[0], y: q[1] })), out = [[ctl[0][0], ctl[0][1]]];
  const kn = (a, b) => Math.pow(Math.hypot(b.x - a.x, b.y - a.y), 0.5) || 1e-3;
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = i === 1 ? { x: 2 * P[1].x - P[2].x, y: 2 * P[1].y - P[2].y } : P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = i === P.length - 3 ? { x: 2 * P[i + 1].x - P[i].x, y: 2 * P[i + 1].y - P[i].y } : P[i + 2];
    const t0 = 0, t1 = t0 + kn(p0, p1), t2 = t1 + kn(p1, p2), t3 = t2 + kn(p2, p3), n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let k = 1; k <= n; k++) {
      const t = t1 + (t2 - t1) * k / n, L = (a, b, ta, tb) => ({ x: (a.x * (tb - t) + b.x * (t - ta)) / (tb - ta), y: (a.y * (tb - t) + b.y * (t - ta)) / (tb - ta) });
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3), C = L(B1, B2, t1, t2);
      out.push([C.x, C.y]);
    }
  }
  out[out.length - 1] = [ctl[ctl.length - 1][0], ctl[ctl.length - 1][1]];
  return out;
}

// A frame along carriageway number xi of `streets`, at the point of it nearest to p: pos(s, l) is the point s units along its direction of travel and l units to
// the right of the middle of the pair (this carriageway itself lies at l = offU); vertexAt(s) is a vertex of the carriageway at that distance (inserted if needed).
function frameOn(streets, xi, p) {
  const X = streets[xi], partner = streets.findIndex((q, k) => k !== xi && q.pair && q.pair === X.pair && q.cls === 'hw');
  if (partner < 0) return null;
  const cum = [0]; for (let i = 1; i < X.pts.length; i++) cum.push(cum[i - 1] + hyp(X.pts[i], X.pts[i - 1]));
  const tot = cum[cum.length - 1];
  let best = null;
  for (let j = 1; j < X.pts.length; j++) {
    const a = X.pts[j - 1], b = X.pts[j], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)), d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
    if (!best || d < best.d) best = { d, s: cum[j - 1] + (cum[j] - cum[j - 1]) * t };
  }
  const s0 = best.s, Y = streets[partner];
  const along = sPx => {
    const q = Math.max(0, Math.min(tot, sPx)); let j = 1; while (j < cum.length - 1 && cum[j] < q) j++;
    const a = X.pts[j - 1], b = X.pts[j], l = cum[j] - cum[j - 1] || 1, t = (q - cum[j - 1]) / l, dx = (b[0] - a[0]) / l, dy = (b[1] - a[1]) / l;
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d: [dx, dy], r: [-dy, dx] };
  };
  const f0 = along(s0);
  let dmin = 1e9; for (let i = 1; i < Y.pts.length; i++) { const a = Y.pts[i - 1], dx = Y.pts[i][0] - a[0], dy = Y.pts[i][1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((f0.p[0] - a[0]) * dx + (f0.p[1] - a[1]) * dy) / l2)); dmin = Math.min(dmin, Math.hypot(a[0] + dx * t - f0.p[0], a[1] + dy * t - f0.p[1])); }
  const off = dmin / 2;
  const frame = su => { const f = along(s0 + su / S); return { c: [f.p[0] - f.r[0] * off, f.p[1] - f.r[1] * off], r: f.r, d: f.d, p: f.p }; };
  const pos = (su, lu) => { const f = frame(su); return [f.c[0] + f.r[0] * lu / S, f.c[1] + f.r[1] * lu / S]; };
  const vertexAt = su => {
    const q = Math.max(0, Math.min(tot, s0 + su / S)), k = cum.findIndex(v => Math.abs(v - q) < 0.8); if (k >= 0) return X.pts[k];
    let j = 1; while (j < cum.length - 1 && cum[j] < q) j++;
    const a = X.pts[j - 1], b = X.pts[j], t = (q - cum[j - 1]) / (cum[j] - cum[j - 1] || 1), v = [r2(a[0] + (b[0] - a[0]) * t), r2(a[1] + (b[1] - a[1]) * t)];
    X.pts.splice(j, 0, v); cum.splice(j, 0, q); if (X.ctl) X.ctl = undefined; return v;
  };
  return { X, Y, xi, partner, offU: off * S, frame, pos, vertexAt, room: [s0 * S, (tot - s0) * S], centre: frame(0).c, r: frame(0).r };
}
export function hwFrame(streets, p, maxPx = 14) {
  let best = null;
  streets.forEach((s, i) => { if (s.cls !== 'hw' || !s.pair) return; for (let j = 1; j < s.pts.length; j++) {
    const a = s.pts[j - 1], b = s.pts[j], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)), d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
    if (d < maxPx && (!best || d < best.d)) best = { i, d }; } });
  return best ? frameOn(streets, best.i, p) : null;
}

const GRADE = 0.95 * 0.06, DECK_H = 4.6;
export const deckGeo = (h = DECK_H) => { const d1 = HW_OFF + 6.7 + 7, d2 = d1 + h / GRADE; return { d1, d2, h }; };

// The ramps of one carriageway (frame F): an exit before the crossing and an entry after it, both meeting the street at a terminal `Lo` units from the middle
// of the highway. Returns the two ramp streets, the terminal and any warnings.
function sideRamps(F, Lo, Ex = 300) {
  const offU = F.offU, warns = [], ex = Math.min(Ex, F.room[0] - 15), en = Math.min(Ex, F.room[1] - 15);
  if (ex < 150 || en < 150) warns.push('The highway is too short here for slip roads: they need 190 m or more on each side of the junction.');
  const a0 = F.vertexAt(-ex), a1 = F.vertexAt(en), T = F.pos(0, Lo), rd = q => [r2(q[0]), r2(q[1])];
  const exit = curve([a0, F.pos(-ex + 70, offU + 3), F.pos(-ex + 150, offU + 22), F.pos(-Math.max(60, ex * 0.32), Lo * 0.62), F.pos(-28, Lo * 0.93), T]);
  const entry = curve([T, F.pos(28, Lo * 0.93), F.pos(Math.max(60, en * 0.32), Lo * 0.62), F.pos(en - 150, offU + 22), F.pos(en - 70, offU + 3), a1]);
  exit[0] = a0; entry[entry.length - 1] = a1; exit[exit.length - 1] = T; entry[0] = T;
  return { streets: [{ cls: 'ramp', pts: exit.map(rd), name: 'Exit ramp' }, { cls: 'ramp', pts: entry.map(rd), name: 'Entry ramp' }], T, warns };
}

// Slip roads: an exit and an entry on the carriageway nearest to p, meeting at a terminal with a short street that you can connect to.
export function slipRoads(streets, p) {
  const F = hwFrame(streets, p); if (!F) return { error: 'Click a highway.' };
  const side = sideRamps(F, F.offU + 80); side.streets.forEach(s => streets.push(s));
  const T = side.T, f0 = F.frame(0), end = [T[0] + f0.r[0] * 56 / S, T[1] + f0.r[1] * 56 / S];
  streets.push({ cls: 'four', pts: [T, end].map(q => [r2(q[0]), r2(q[1])]), name: 'Ramp road' });
  return { warnings: side.warns, note: 'Slip roads added. Connect the end of the short street to your roads.' };
}

// A street over the highway with slip roads on every side.
export function interchange(streets, structs, p, opts = {}) {
  const F = hwFrame(streets, p); if (!F) return { error: 'Click a highway.' };
  const g = deckGeo(), Lo = g.d2 + (opts.round ? ROUNDABOUTS.small.R + 8 : 18), c = F.centre, warns = [];
  const G = frameOn(streets, F.partner, c);           // the other carriageway, with the same middle
  if (!G) return { error: 'The other carriageway was not found.' };
  const one = sideRamps(F, Lo), two = sideRamps(G, Lo); warns.push(...one.warns);
  const far = (g.d2 + 150) / S, r = F.r, A = [c[0] + r[0] * far, c[1] + r[1] * far], B = [c[0] - r[0] * far, c[1] - r[1] * far];
  streets.push({ cls: 'four', pts: [B, two.T, one.T, A].map(q => [r2(q[0]), r2(q[1])]), name: 'Interchange road' });
  [...one.streets, ...two.streets].forEach(s => streets.push(s));
  structs.push({ at: [r2(c[0]), r2(c[1])], len: r2(2 * g.d1), h: g.h });
  if (opts.round) { roundabout(streets, one.T, 'small'); roundabout(streets, two.T, 'small'); return { warnings: warns, note: 'Roundabout interchange added: a street crosses on a bridge and a roundabout sits at each end of it. Connect the street ends to your roads.' }; }
  return { warnings: warns, note: 'Interchange added: a street crosses on a bridge and four slip roads join it. Connect the street ends to your roads.' };
}

// An elevated highway: draws the pair like a highway, and lifts the middle of both carriageways so streets can run underneath.
export function elevatedStructs(pts, hU = 6.5) {
  const L = plen(pts) * S, ramp = hU / GRADE, len = L - 2 * ramp - 30;
  if (len < 40) return { error: 'Too short to lift: with a ' + Math.round(hU * 1.25) + ' m clearance the ramps need ' + Math.round(ramp * 1.25) + ' m each, so the highway has to be at least ' + Math.round((2 * ramp + 70) * 1.25) + ' m long.' };
  return { len, h: hU, ramp };
}
