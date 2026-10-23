// Public transport layout: bus lines (closed loops over the avenues), their stops, a bus depot and taxi cab stands.
// Pure data, no THREE - so the node checks can run it. transitScene.js builds the meshes.
import { pointInPolygon } from './collision.js';

const LINE_COLORS = [0xd9a21b, 0x2f6fb5, 0xc8362f, 0x2f9a5a];
const LINE_NAMES = ['Lakeshore Line', 'Loop Line', 'Crosstown Line', 'Riverside Line'];

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export function buildTransit(city) {
  const N = city.roadNodes || {}, E = city.roadEdges || [];
  const ave = E.filter(e => e.type === 'avenue' && (!e.structure || e.structure === 'surface') && N[e.from] && N[e.to]);
  const adj = {};
  const len = e => Math.hypot(N[e.from].x - N[e.to].x, N[e.from].z - N[e.to].z);
  ave.forEach(e => { (adj[e.from] ||= []).push({ e, to: e.to }); if (!e.oneWay) (adj[e.to] ||= []).push({ e, to: e.from }); });
  // biggest connected piece of the avenue network
  const comp = {}; let best = [], cid = 0;
  for (const id in adj) {
    if (comp[id] != null) continue;
    const q = [id], members = []; comp[id] = cid;
    while (q.length) { const a = q.pop(); members.push(a); for (const { e } of adj[a]) { for (const b of [e.from, e.to]) if (comp[b] == null && adj[b]) { comp[b] = cid; q.push(b); } } }
    if (members.length > best.length) best = members; cid++;
  }
  const inComp = new Set(best);
  const cx = best.reduce((s, i) => s + N[i].x, 0) / (best.length || 1), cz = best.reduce((s, i) => s + N[i].z, 0) / (best.length || 1);
  const maxR = Math.max(1, ...best.map(i => Math.hypot(N[i].x - cx, N[i].z - cz)));

  function dijkstra(a, b, banE, banN) {                      // shortest legal path as a node list (optionally avoiding edges / nodes)
    const dist = { [a]: 0 }, prev = {}, done = new Set(), open = [a];
    while (open.length) {
      open.sort((p, q) => dist[q] - dist[p]); const u = open.pop();
      if (done.has(u)) continue; done.add(u);
      if (u === b) break;
      for (const { e, to } of adj[u] || []) { if (banE && banE.has(e.id)) continue; if (banN && banN.has(to) && to !== b) continue; const d = dist[u] + len(e); if (dist[to] == null || d < dist[to]) { dist[to] = d; prev[to] = u; open.push(to); } }
    }
    if (dist[b] == null) return null;
    const out = [b]; while (out[0] !== a) out.unshift(prev[out[0]]);
    return out;
  }
  const nearest = (x, z) => { let bi = null, bd = 1e18; for (const i of best) { if ((adj[i] || []).length < 3) continue; const d = (N[i].x - x) ** 2 + (N[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  const edgeBetween = (a, b) => (adj[a] || []).find(o => o.to === b);

  const R = rng(1234), lines = [];
  for (let k = 0; k < 4 && best.length > 20; k++) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const r = maxR * (0.35 + 0.3 * R()), a0 = (k / 4) * Math.PI + R() * 0.6;
      const A = nearest(cx + Math.cos(a0) * r, cz + Math.sin(a0) * r), B = nearest(cx - Math.cos(a0) * r * (0.7 + 0.5 * R()), cz - Math.sin(a0) * r * (0.7 + 0.5 * R()));
      if (!A || !B || A === B) continue;
      const out = dijkstra(A, B); if (!out) continue;
      const banE = new Set(), banN = new Set(out.slice(1, -1));
      for (let i = 0; i + 1 < out.length; i++) { const rec = edgeBetween(out[i], out[i + 1]); if (rec) banE.add(rec.e.id); const rb = edgeBetween(out[i + 1], out[i]); if (rb) banE.add(rb.e.id); }
      const back = dijkstra(B, A, banE, banN); if (!back) continue;
      let nodesSeq = out.concat(back.slice(1));
      nodesSeq.pop();                                        // closed loop: last == first
      // no reversing, no hairpins, every directed transition has exactly one successor
      const m = nodesSeq.length, next = new Map(); let bad = false, total = 0;
      for (let i = 0; i < m && !bad; i++) {
        const p = nodesSeq[(i + m - 1) % m], c = nodesSeq[i], q = nodesSeq[(i + 1) % m];
        const A = N[p], B = N[c], C = N[q];
        const ix = B.x - A.x, iz = B.z - A.z, ox = C.x - B.x, oz = C.z - B.z, dot = (ix * ox + iz * oz) / ((Math.hypot(ix, iz) * Math.hypot(ox, oz)) || 1);
        if (p === q || dot < -0.15) { bad = true; break; }
        const key = p + '>' + c, rec = edgeBetween(c, q);
        if (!rec || (next.has(key) && next.get(key) !== rec.e)) { bad = true; break; }
        next.set(key, rec.e);
        total += len(rec.e);
      }
      if (bad || total < 1700 || total > 9000) continue;
      const steps = nodesSeq.map((c, i) => { const q = nodesSeq[(i + 1) % m]; return { from: c, to: q, edge: edgeBetween(c, q).e }; });
      lines.push({ id: k, name: LINE_NAMES[k], color: LINE_COLORS[k], nodes: nodesSeq, steps, next, length: total });
      break;
    }
  }

  // stops: roughly every 380 units along each loop, on the middle of a long enough edge; shared where lines cross
  const stops = [], byKey = new Map();
  for (const line of lines) {
    let since = 260 + line.id * 70;
    for (const st of line.steps) {
      const L = len(st.edge); since += L;
      if (since >= 380 && L >= 85) {
        since = 0;
        const key = st.edge.id + '>' + st.from;
        let s = byKey.get(key);
        if (!s) {
          const a = N[st.from], b = N[st.to], h = Math.atan2(b.z - a.z, b.x - a.x), w = st.edge.width || 20;
          const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, rx = -Math.sin(h), rz = Math.cos(h), off = w / 2 + 2.6;
          s = { id: stops.length, key, edge: st.edge, from: st.from, to: st.to, x: mx + rx * off, z: mz + rz * off, h, lines: [], name: '' };
          stops.push(s); byKey.set(key, s);
        }
        s.lines.push(line.id); line.stops = (line.stops || []).concat(s);
      }
    }
  }
  const stopAt = new Map(); stops.forEach(s => stopAt.set(s.key, s));

  // free ground for the depot / stands: nothing from city.parcels inside the rectangle
  const parcels = (city.parcels || []).filter(p => p.type === 'building' || p.type === 'water');
  const free = (x, z, h, hw, hd) => {
    const c = Math.cos(h), s = Math.sin(h);
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const px = x + c * u * hw - s * v * hd, pz = z + s * u * hw + c * v * hd;
      for (const p of parcels) if (pointInPolygon(px, pz, p.footprint)) return false;
    }
    return true;
  };
  // does this rectangle clash with a road (any edge segment closer than the half width + margin)?
  const roadClear = (x, z, r) => {
    for (const e of E) {
      const a = N[e.from], b = N[e.to]; if (!a || !b) continue;
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) < (e.width || 10) / 2 + r) return false;
    }
    return true;
  };

  // depot: beside the first line's first long avenue, on free ground
  let depot = null;
  const onLine = new Set(); lines.forEach(l => l.steps.forEach(st => onLine.add(st.edge.id)));
  const dc = e => Math.hypot((N[e.from].x + N[e.to].x) / 2 - cx, (N[e.from].z + N[e.to].z) / 2 - cz);
  const cand = ave.filter(e => len(e) > 110).sort((p, q) => (onLine.has(q.id) ? 1 : 0) - (onLine.has(p.id) ? 1 : 0) || dc(p) - dc(q));
  outer: for (const e of cand) {
    const a = N[e.from], b = N[e.to], h = Math.atan2(b.z - a.z, b.x - a.x), w = e.width || 20;
    for (const side of [1, -1]) for (const f of [0.5, 0.35, 0.65]) {
      const rx = -Math.sin(h) * side, rz = Math.cos(h) * side, off = w / 2 + 6 + 15;
      const x = a.x + (b.x - a.x) * f + rx * off, z = a.z + (b.z - a.z) * f + rz * off;
      if (free(x, z, h, 20, 14) && roadClear(x, z, 21)) { depot = { x, z, h, hw: 18, hd: 12, gateX: a.x + (b.x - a.x) * f, gateZ: a.z + (b.z - a.z) * f, side, edge: e }; break outer; }
    }
  }

  // cab stands: painted boxes in the kerb lane, spread out (>= 330 apart), on long avenues, not at the bus stops
  const stands = [], sr = rng(99);
  const pool = ave.filter(e => len(e) > 90 && !(e.lanes < 1)).map(e => ({ e, k: sr() })).sort((p, q) => p.k - q.k);
  for (const { e } of pool) {
    if (stands.length >= 14) break;
    const a = N[e.from], b = N[e.to], h = Math.atan2(b.z - a.z, b.x - a.x), w = e.width || 20, f = 0.28 + sr() * 0.12;
    const rx = -Math.sin(h), rz = Math.cos(h), off = w / 2 - 2.2;
    const x = a.x + (b.x - a.x) * f + rx * off, z = a.z + (b.z - a.z) * f + rz * off;
    if (stands.some(s => Math.hypot(s.x - x, s.z - z) < 330)) continue;
    if (stops.some(s => Math.hypot(s.x - x, s.z - z) < 40)) continue;
    stands.push({ id: stands.length, x, z, h, edge: e });
  }
  return { lines, stops, stopAt, depot, stands };
}
