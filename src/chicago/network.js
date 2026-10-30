// Turns a set of centre-lines (streets, arterials, the interstate, ramps) into the road graph the
// game uses: nodes at every junction, edges between them, bridges where a street has to cross a
// river or the interstate, and a tidy-up pass (tiny edges merged, dead ends removed).
import { dist, distToSeg, segInter, nearestOnPoly } from './geom.js';

export const CLASSES = {
  // widths in world units (1 u = 1.25 m). Interstate: 3.6 m lanes + 3 m shoulders. City roads: 3.5 m lanes (a 3 m lane is legal but too tight for the game's
  // car collision size and steering), residential 2 x 3.6 m. Express road adds a 1.6 u central divider.
  // lane 3 m (hw 3.6 m + 3 m shoulders), 1 u = 1.25 m; speedLimit in km/h
  hw:   { type: 'highway', width: 13.4, lanes: 3, sidewalks: false, oneWay: true, speedLimit: 120, maxGrade: 0.06 },
  hwEnd: { type: 'avenue', width: 8.4, lanes: 3, sidewalks: false, oneWay: true, speedLimit: 70, maxGrade: 0.06 },   // where the interstate ends: one half of the arterial it flows into
  six:  { type: 'avenue',  width: 18.4,   lanes: 3, speedLimit: 120, maxGrade: 0.06 },   // express road (orange)
  four: { type: 'avenue',  width: 16.8, lanes: 3, speedLimit: 70,  maxGrade: 0.06 },   // main arterial (yellow)
  two:  { type: 'local',   width: 8.4,    lanes: 1, speedLimit: 50,  maxGrade: 0.15 },   // residential (black)
  ramp: { type: 'avenue',  width: 7.7,  lanes: 1, sidewalks: false, ramp: true, oneWay: true, speedLimit: 60, maxGrade: 0.06 }
};

// How a line crosses a barrier: deck vertices at +-d1 (raised to `h`), approach vertices at +-d2 (ground).
function bridgeProfile(lineCls, barrier) {
  // approach length comes from the class's grade limit: d2 = d1 + h / (0.95 * maxGrade)
  const g = 0.95 * (CLASSES[lineCls] ? CLASSES[lineCls].maxGrade : 0.06);
  let d1, h;
  if (barrier.kind === 'river') { d1 = barrier.half + (lineCls === 'hw' ? 10 : 5); h = lineCls === 'hw' ? 3.2 : 2.4; }
  else { d1 = barrier.half + 6; h = 4.6; }                       // over the interstate: ~5.7 m clearance
  return { d1, d2: d1 + h / g, h };
}

export function buildNetwork(lines, barriers, opts = {}) {
  const warn = opts.warn || (() => {});
  // ---- 1. bridges: insert deck/approach vertices where a street crosses a barrier ----------------
  lines.forEach(L => {
    L.v = L.pts.map(p => ({ x: p[0], z: p[1], elev: 0 }));
    if (L.cls === 'ramp') return;
    // arclength of each vertex
    const s = [0]; for (let i = 1; i < L.v.length; i++) s.push(s[i - 1] + dist([L.v[i - 1].x, L.v[i - 1].z], [L.v[i].x, L.v[i].z]));
    const total = s[s.length - 1];
    const events = [];
    if (L.drawbridge) {
      // a low movable bridge: the deck covers the water (plus 3 u of bank each side) at a height the approaches can reach within the line's length
      const at0 = sv => { for (let i = 1; i < L.v.length; i++) if (sv <= s[i] || i === L.v.length - 1) { const t = (sv - s[i - 1]) / ((s[i] - s[i - 1]) || 1); return { x: L.v[i - 1].x + (L.v[i].x - L.v[i - 1].x) * t, z: L.v[i - 1].z + (L.v[i].z - L.v[i - 1].z) * t }; } };
      let w0 = null, w1 = null;
      for (let sv = 0; sv <= total; sv += 1) { const p = at0(sv); if (barriers.some(B => B.kind === 'river' && nearestOnPoly(p.x, p.z, B.pts).d < B.half)) { if (w0 === null) w0 = sv; w1 = sv; } }
      if (w0 !== null) {
        const sc = (w0 + w1) / 2, d1 = (w1 - w0) / 2 + 3, g = 0.95 * CLASSES[L.cls].maxGrade, room = Math.min(sc, total - sc) - 4 - d1;
        if (room > 6) { const h = Math.min(1.6, room * g); events.push({ sc, B: { kind: 'river' }, prof: { d1, d2: d1 + h / g, h } }); }
        else warn('drawbridge has no room for its approaches: ' + L.id);
      }
    } else
    barriers.forEach(B => {
      if (B.kind === 'highway' && (L.cls === 'hw' || L.cls === 'hwEnd')) return;
      if (B.line === L) return;
      if (L.noBridge === B.kind) return;
      for (let i = 1; i < L.v.length; i++) {
        const A = [L.v[i - 1].x, L.v[i - 1].z], C = [L.v[i].x, L.v[i].z];
        for (let j = 1; j < B.pts.length; j++) {
          const r = segInter(A, C, B.pts[j - 1], B.pts[j]);
          if (!r) continue;
          const sc = s[i - 1] + (s[i] - s[i - 1]) * r.t;
          if (events.some(e => e.B === B && Math.abs(e.sc - sc) < 30)) continue;
          events.push({ sc, B, prof: bridgeProfile(L.cls, B) });
        }
      }
    });
    if (!events.length) return;
    events.sort((a, b) => a.sc - b.sc);
    const at = sv => {            // point at arclength sv
      for (let i = 1; i < L.v.length; i++) if (sv <= s[i] || i === L.v.length - 1) {
        const t = (sv - s[i - 1]) / ((s[i] - s[i - 1]) || 1);
        return { x: L.v[i - 1].x + (L.v[i].x - L.v[i - 1].x) * t, z: L.v[i - 1].z + (L.v[i].z - L.v[i - 1].z) * t };
      }
    };
    const extra = [], cut = [];
    events.forEach(ev => {
      const { d1, d2, h } = ev.prof;
      if (ev.sc - d2 < 4 || ev.sc + d2 > total - 4) { warn('bridge zone leaves the line: ' + L.id + ' (' + ev.B.kind + ')'); L.pendingTrim = L.pendingTrim || []; L.pendingTrim.push(ev); return; }
      cut.push([ev.sc - d2 - 1, ev.sc + d2 + 1]);
      [[-d2, 0, false], [-d1, h, true], [d1, h, true], [d2, 0, false]].forEach(([o, el, deck]) => {
        const p = at(ev.sc + o); extra.push({ s: ev.sc + o, x: p.x, z: p.z, elev: el, deck, bridgeId: ev.sc });
      });
    });
    const keep = L.v.map((v, i) => ({ s: s[i], x: v.x, z: v.z, elev: 0, deck: false })).filter((v, i, arr) =>
      i === 0 || i === arr.length - 1 || !cut.some(([a, b]) => v.s > a && v.s < b));
    L.v = keep.concat(extra).sort((a, b) => a.s - b.s);
  });

  // trim lines that ended inside a bridge zone (cannot bridge): cut them back to the barrier edge
  lines.forEach(L => {
    if (!L.pendingTrim) return;
    L.pendingTrim.forEach(ev => {
      // drop the vertices beyond the crossing on the shorter side
      const s0 = []; let acc = 0; s0.push(0);
      for (let i = 1; i < L.v.length; i++) { acc += dist([L.v[i - 1].x, L.v[i - 1].z], [L.v[i].x, L.v[i].z]); s0.push(acc); }
      const total = acc;
      if (ev.sc < total / 2) L.v = L.v.filter((v, i) => s0[i] > ev.sc + ev.B.half + 8 || i === L.v.length - 1);
      else L.v = L.v.filter((v, i) => s0[i] < ev.sc - ev.B.half - 8 || i === 0);
    });
  });

  // ---- 2. snap line ends that nearly touch another line (T junctions) ------------------------------
  const segsOf = L => { const r = []; for (let i = 1; i < L.v.length; i++) r.push([i - 1, i]); return r; };
  lines.forEach(L => {
    const isRamp = L.cls === 'ramp';
    if (L.v.length < 2 || (L.noJoin && !isRamp)) return;
    [0, L.v.length - 1].forEach(ei => {
      const E = L.v[ei];
      // a slip road must end ON the carriageway it serves (when the highway vertex it was drawn to was swallowed by a bridge, it would dangle):
      // it looks further for it, at the ground-level part of a highway only; a street looks 7 u
      if (isRamp && lines.some(M => M !== L && (M.cls === 'hw' || M.cls === 'hwEnd') && M.v.some(q => Math.hypot(q.x - E.x, q.z - E.z) < 2.5 && q.elev < 0.6 && !q.deck))) return;   // already meets a highway vertex
      let best = null;
      const reach = isRamp ? 45 : 7;
      lines.forEach(M => {
        if (M === L || M.noJoin || M.v.length < 2) return;
        if (isRamp && M.cls !== 'hw' && M.cls !== 'hwEnd') return;
        for (let j = 1; j < M.v.length; j++) {
          if (M.v[j - 1].deck && M.v[j].deck) continue;                 // never onto the level part of a bridge deck
          const r = distToSeg(E.x, E.z, M.v[j - 1].x, M.v[j - 1].z, M.v[j].x, M.v[j].z);
          if (isRamp && M.v[j - 1].elev + (M.v[j].elev - M.v[j - 1].elev) * r.t > 0.6) continue;     // and only where the highway is still at ground level
          if (r.d < reach && (!best || r.d < best.d)) best = { d: r.d, M, j, t: r.t };
        }
      });
      if (best) {
        const a = best.M.v[best.j - 1], b = best.M.v[best.j];
        if (best.d > 0.05) { E.x = a.x + (b.x - a.x) * best.t; E.z = a.z + (b.z - a.z) * best.t; }
        if (isRamp) { E.elev = a.elev + (b.elev - a.elev) * best.t; }
      } else if (isRamp) L.noJoin = L.noJoin;                           // nothing to join (reported by the connected check)
    });
  });

  // ---- 3. nodes (snapped) and junctions -------------------------------------------------------------------
  const nodes = [];     // {x,z,elev,deck,keep}
  const grid = new Map(); const CELL = 8, SNAP = 3.2;
  const key = (i, j) => i + ',' + j;
  function getNode(x, z, elev = 0, deck = false) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const l = grid.get(key(i, j)); if (!l) continue;
      for (const id of l) {
        const n = nodes[id];
        if (Math.hypot(n.x - x, n.z - z) < SNAP && !(n.deck !== deck && (n.deck || deck))) { n.elev = Math.max(n.elev, elev); n.deck = n.deck || deck; return id; }
      }
    }
    const id = nodes.length; nodes.push({ x, z, elev, deck, keep: false });
    const k = key(ci, cj); (grid.get(k) || grid.set(k, []).get(k)).push(id);
    return id;
  }
  const elevAt = (L, i, t) => L.v[i].elev + (L.v[i + 1].elev - L.v[i].elev) * t;
  // collect, per line segment, the junction points along it
  lines.forEach(L => { L.cuts = L.v.map(() => []); });
  const bb = L => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; L.v.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }); return [x0 - 1, x1 + 1, z0 - 1, z1 + 1]; };
  lines.forEach(L => { L.bb = bb(L); });
  // a slip road's end that was snapped onto a carriageway becomes a real junction on it
  for (let a = 0; a < lines.length; a++) {
    const A = lines[a]; if (A.noJoin || A.v.length < 2) continue;
    for (let b = a + 1; b < lines.length; b++) {
      const B = lines[b]; if (B.noJoin || B.v.length < 2) continue;
      if (A.bb[1] < B.bb[0] || B.bb[1] < A.bb[0] || A.bb[3] < B.bb[2] || B.bb[3] < A.bb[2]) continue;
      for (let i = 0; i < A.v.length - 1; i++) {
        for (let j = 0; j < B.v.length - 1; j++) {
          const r = segInter([A.v[i].x, A.v[i].z], [A.v[i + 1].x, A.v[i + 1].z], [B.v[j].x, B.v[j].z], [B.v[j + 1].x, B.v[j + 1].z]);
          if (!r) continue;
          const eA = elevAt(A, i, r.t), eB = elevAt(B, j, r.u);
          if (Math.abs(eA - eB) > 1.2) continue;
          if ((A.v[i].deck && A.v[i + 1].deck) || (B.v[j].deck && B.v[j + 1].deck)) continue;     // never join on a deck
          const x = A.v[i].x + (A.v[i + 1].x - A.v[i].x) * r.t, z = A.v[i].z + (A.v[i + 1].z - A.v[i].z) * r.t;
          const e = Math.max(eA, eB);
          A.cuts[i].push({ t: r.t, x, z, elev: e }); B.cuts[j].push({ t: r.u, x, z, elev: e });
        }
      }
    }
  }

  // ---- 4. edges --------------------------------------------------------------------------------------------------
  const edges = []; const seen = new Set();
  lines.forEach(L => {
    if (L.v.length < 2) return;
    const seq = [];
    for (let i = 0; i < L.v.length; i++) {
      seq.push({ x: L.v[i].x, z: L.v[i].z, elev: L.v[i].elev, deck: L.v[i].deck });
      if (i < L.v.length - 1) L.cuts[i].sort((p, q) => p.t - q.t).forEach(c => seq.push({ x: c.x, z: c.z, elev: c.elev, deck: false, junction: true }));
    }
    let prev = null;
    seq.forEach((p, k) => {
      const id = getNode(p.x, p.z, p.elev, p.deck);
      if (L.keepEnds && (k === 0 || k === seq.length - 1)) nodes[id].keep = true;
      if (prev !== null && prev !== id) {
        const dd = dist([nodes[prev].x, nodes[prev].z], [nodes[id].x, nodes[id].z]);
        const k2 = prev < id ? prev + '_' + id : id + '_' + prev;
        if (!seen.has(k2 + (L.oneWay ? 'o' : '')) && dd > 0.5) {
          seen.add(k2 + (L.oneWay ? 'o' : ''));
          edges.push({ from: prev, to: id, line: L, deckEdge: nodes[prev].deck && nodes[id].deck && p.deck });
        }
      }
      prev = id;
    });
  });

  // ---- 5. merge tiny edges, drop dead ends ----------------------------------------------------------------------
  const alive = new Set(nodes.map((_, i) => i));
  const nodeEdges = id => edges.filter(e => !e.dead && (e.from === id || e.to === id));
  let changed = true, guard = 0;
  while (changed && guard++ < 20) {
    changed = false;
    for (const e of edges) {
      if (e.dead) continue;
      const a = nodes[e.from], b = nodes[e.to];
      const l = dist([a.x, a.z], [b.x, b.z]);
      const minLen = opts.minEdge || 13;
      if (l >= minLen || a.deck || b.deck || a.keep || b.keep) continue;
      if (e.line.cls === 'hw' || e.line.cls === 'hwEnd' || e.line.cls === 'ramp') continue;
      // contract b into a (keep the node with more connections)
      const da = nodeEdges(e.from).length, db = nodeEdges(e.to).length;
      const [kp, rm] = da >= db ? [e.from, e.to] : [e.to, e.from];
      edges.forEach(o => { if (o.from === rm) o.from = kp; if (o.to === rm) o.to = kp; });
      nodes[kp].elev = Math.max(nodes[kp].elev, nodes[rm].elev);
      e.dead = true; alive.delete(rm); changed = true;
    }
    // collapse degenerate / duplicate edges
    const dup = new Set();
    for (const e of edges) {
      if (e.dead) continue;
      if (e.from === e.to) { e.dead = true; continue; }
      const k = (e.from < e.to ? e.from + '_' + e.to : e.to + '_' + e.from) + (e.line.oneWay ? 'o' + e.from : '');
      if (dup.has(k)) { e.dead = true; continue; }
      dup.add(k);
    }
  }
  // remove sliver junctions: of two streets leaving a junction within ~30 degrees of each other, drop the lesser one
  const RANK = { hw: 9, hwEnd: 9, six: 5, four: 4, two: 2, ramp: 8 };
  for (let pass = 0; pass < 6; pass++) {
    let removed = false;
    const by = {};
    edges.forEach(e => { if (e.dead) return; (by[e.from] ||= []).push(e); (by[e.to] ||= []).push(e); });
    Object.keys(by).forEach(id => {
      const es = by[id].filter(e => !e.dead);
      if (es.length < 3) return;
      const ang = e => { const o = nodes[e.from == id ? e.to : e.from]; return Math.atan2(o.z - nodes[id].z, o.x - nodes[id].x); };
      for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
        const A = es[i], B = es[j]; if (A.dead || B.dead) continue;
        if (A.line.cls === 'ramp' || B.line.cls === 'ramp' || A.line.cls === 'hw' || B.line.cls === 'hw' || A.line.cls === 'hwEnd' || B.line.cls === 'hwEnd') continue;
        let d = Math.abs(ang(A) - ang(B)); d = Math.min(d, 2 * Math.PI - d);
        if (d < 0.52) {
          const lenOf = e => dist([nodes[e.from].x, nodes[e.from].z], [nodes[e.to].x, nodes[e.to].z]);
          const [lo] = [A, B].sort((p, q) => (RANK[p.line.cls] - RANK[q.line.cls]) || (lenOf(p) - lenOf(q)));
          lo.dead = true; removed = true;
        }
      }
    });
    if (!removed) break;
  }
  // prune dead ends (never the interstate's ends)
  changed = true;
  while (changed) {
    changed = false;
    const deg = {};
    edges.forEach(e => { if (e.dead) return; deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; });
    edges.forEach(e => {
      if (e.dead) return;
      const leaf = id => deg[id] === 1 && !nodes[id].keep;
      if ((leaf(e.from) || leaf(e.to)) && e.line.cls !== 'ramp') {
        // (a traced map has real dead-end streets: with opts.stubLen only short stubs are dropped)
        if (opts.stubLen && dist([nodes[e.from].x, nodes[e.from].z], [nodes[e.to].x, nodes[e.to].z]) >= opts.stubLen) return;
        e.dead = true; changed = true;
      }
    });
  }
  return { nodes, edges: edges.filter(e => !e.dead) };
}
