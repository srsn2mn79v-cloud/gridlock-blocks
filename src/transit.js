// Public transport layout: bus lines (closed loops over the avenues), their stops, a bus depot and taxi cab stands.
// Pure data, no THREE - so the node checks can run it. transitScene.js builds the meshes.
import { pointInPolygon } from './collision.js';

const LINE_COLORS = [0xd9a21b, 0x2f6fb5, 0xc8362f, 0x2f9a5a];
const LINE_NAMES = ['Lakeshore Line', 'Loop Line', 'Crosstown Line', 'Riverside Line'];

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// `custom` (from the Studio's Transit tab): { bus: [{ name, color, stops: [[x, z], ...] }], metro: [{ name, color, stations: [{ name, at: [x, z] }] }] }.
// With custom bus lines the game uses them instead of the four generated loops; metro lines default to two built from the bus routes.
export function buildTransit(city, custom) {
  const N = city.roadNodes || {}, E = city.roadEdges || [];
  const ave = E.filter(e => e.type !== 'highway' && !e.ramp && (!e.structure || e.structure === 'surface') && N[e.from] && N[e.to]);
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
      for (const { e, to } of adj[u] || []) { if (banE && banE.has(e.id)) continue; if (banN && banN.has(to) && to !== b) continue; const d = dist[u] + len(e) * (e.type === 'avenue' ? 1 : 5); if (dist[to] == null || d < dist[to]) { dist[to] = d; prev[to] = u; open.push(to); } }
    }
    if (dist[b] == null) return null;
    const out = [b]; while (out[0] !== a) out.unshift(prev[out[0]]);
    return out;
  }
  const nearest = (x, z) => { let bi = null, bd = 1e18; for (const i of best) { if ((adj[i] || []).length < 3) continue; const d = (N[i].x - x) ** 2 + (N[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  const edgeBetween = (a, b) => (adj[a] || []).find(o => o.to === b);

  const R = rng(1234), lines = [];
  // closes a node list into a loop, checking every directed transition has exactly one successor and nothing reverses; returns the line or null
  function closeLoop(nodesSeq, meta, strict) {
    const m = nodesSeq.length, next = new Map(); let bad = false, total = 0;
    for (let i = 0; i < m && !bad; i++) {
      const p = nodesSeq[(i + m - 1) % m], c = nodesSeq[i], q = nodesSeq[(i + 1) % m];
      const A = N[p], B = N[c], C = N[q];
      const ix = B.x - A.x, iz = B.z - A.z, ox = C.x - B.x, oz = C.z - B.z, dot = (ix * ox + iz * oz) / ((Math.hypot(ix, iz) * Math.hypot(ox, oz)) || 1);
      if (p === q || dot < (strict ? -0.55 : -0.93)) { bad = true; break; }
      const key = p + '>' + c, rec = edgeBetween(c, q);
      if (!rec || (next.has(key) && next.get(key) !== rec.e)) { bad = true; break; }
      next.set(key, rec.e);
      total += len(rec.e);
    }
    if (bad) return null;
    let loc = 0; for (let i = 0; i < m; i++) { const rec = edgeBetween(nodesSeq[i], nodesSeq[(i + 1) % m]); if (rec && rec.e.type !== 'avenue') loc += len(rec.e); }
    if (strict && (total < 1200 || total > 9000 || loc > total * 0.55)) return null;
    const steps = nodesSeq.map((c, i) => { const q = nodesSeq[(i + 1) % m]; return { from: c, to: q, edge: edgeBetween(c, q).e }; });
    return { id: lines.length, name: meta.name, color: meta.color, nodes: nodesSeq, steps, next, length: total, custom: !!meta.custom };
  }
  // out-and-back through a list of nodes: the way back avoids the way out where it can
  function loopThrough(ids, meta) {
    let out = [ids[0]];
    for (let i = 1; i < ids.length; i++) { const seg = dijkstra(ids[i - 1], ids[i]); if (!seg) return null; out = out.concat(seg.slice(1)); }
    const banE = new Set(), banN = new Set(out.slice(1, -1));
    for (let i = 0; i + 1 < out.length; i++) { const rec = edgeBetween(out[i], out[i + 1]); if (rec) banE.add(rec.e.id); const rb = edgeBetween(out[i + 1], out[i]); if (rb) banE.add(rb.e.id); }
    const a = ids[ids.length - 1], b = ids[0];
    // the way back: avoiding the way out entirely, then only its roads, then anything; the first that makes a legal loop wins
    for (const back of [dijkstra(a, b, banE, banN), dijkstra(a, b, banE), dijkstra(a, b)]) {
      if (!back) continue;
      const seq = out.concat(back.slice(1)); seq.pop();
      const line = closeLoop(seq, meta, false);
      if (line) return line;
    }
    return null;
  }
  const customBus = custom && Array.isArray(custom.bus) ? custom.bus.filter(l => l && Array.isArray(l.stops) && l.stops.length >= 2) : [];
  const problems = [];
  if (customBus.length && best.length > 20) {
    customBus.forEach((cl, k) => {
      const ids = cl.stops.map(q => nearest(q[0], q[1])).filter((n, i, arr) => n && n !== arr[i - 1]); if (ids.length > 2 && ids[ids.length - 1] === ids[0]) ids.pop();
      const line = ids.length >= 2 ? loopThrough(ids, { name: cl.name || 'Line ' + (k + 1), color: cl.color != null ? cl.color : LINE_COLORS[k % 4], custom: true }) : null;
      if (line) { line.userStops = cl.stops; lines.push(line); } else problems.push('bus line "' + (cl.name || k + 1) + '" has no legal loop (a bus loop cannot cross its own route or turn back on itself - move a stop)');
    });
  } else
  for (let k = 0; k < 4 && best.length > 20; k++) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const r = maxR * (0.35 + 0.3 * R()), a0 = (k / 4) * Math.PI + R() * 0.6;
      const A = nearest(cx + Math.cos(a0) * r, cz + Math.sin(a0) * r), B = nearest(cx - Math.cos(a0) * r * (0.7 + 0.5 * R()), cz - Math.sin(a0) * r * (0.7 + 0.5 * R()));
      if (!A || !B || A === B) continue;
      const out = dijkstra(A, B); if (!out) continue;
      const banE = new Set(), banN = new Set(out.slice(1, -1));
      for (let i = 0; i + 1 < out.length; i++) { const rec = edgeBetween(out[i], out[i + 1]); if (rec) banE.add(rec.e.id); const rb = edgeBetween(out[i + 1], out[i]); if (rb) banE.add(rb.e.id); }
      const back = dijkstra(B, A, banE, banN); if (!back) continue;
      let nodesSeq = out.concat(back.slice(1));
      nodesSeq.pop();                                        // closed loop: last == first
      const line = closeLoop(nodesSeq, { name: LINE_NAMES[k], color: LINE_COLORS[k] }, true);
      if (!line) continue;
      line.id = k; lines.push(line);
      break;
    }
  }

  // stops: roughly every 380 units along each loop, on the middle of a long enough edge; shared where lines cross
  const stops = [], byKey = new Map();
  function addStop(line, st) {
    const key = st.edge.id + '>' + st.from;
    let s = byKey.get(key);
    if (!s) {
      const a = N[st.from], b = N[st.to], h = Math.atan2(b.z - a.z, b.x - a.x), w = st.edge.width || 20;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, rx = -Math.sin(h), rz = Math.cos(h), off = w / 2 + 2.6;
      s = { id: stops.length, key, edge: st.edge, from: st.from, to: st.to, x: mx + rx * off, z: mz + rz * off, h, lines: [], name: '' };
      stops.push(s); byKey.set(key, s);
    }
    if (!s.lines.includes(line.id)) { s.lines.push(line.id); line.stops = (line.stops || []).concat(s); }
  }
  for (const line of lines) {
    if (line.custom) {       // the stops you placed: each goes on the nearest long-enough piece of the line
      line.userStops.forEach(q => {
        let bestSt = null, bd = 1e18;
        line.steps.forEach(st => { if (len(st.edge) < 40) return; const d = (((N[st.from].x + N[st.to].x) / 2) - q[0]) ** 2 + (((N[st.from].z + N[st.to].z) / 2) - q[1]) ** 2; if (d < bd) { bd = d; bestSt = st; } });
        if (bestSt) addStop(line, bestSt);
      });
      continue;
    }
    let since = 260 + line.id * 70;
    for (const st of line.steps) {
      const L = len(st.edge); since += L;
      if (since >= 380 && L >= 85) { since = 0; addStop(line, st); }
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

  // ---- metro: stations (an entrance building beside an avenue) joined into lines; you ride between the stations of a line from the entrance
  const METRO_COLORS = [0xe0392b, 0x2f6fe0, 0x1fa88a, 0xf0a020];
  const STATION_NAMES = ['Lakeshore', 'Union', 'Central', 'Harbour', 'Old Town', 'Riverside', 'Market Square', 'Gold Coast', 'The Loop', 'Northgate', 'Westend', 'Southport', 'Stadium', 'Airfield', 'Chinatown', 'Neon Strip'];
  let nameK = 0;
  const metroSpots = [];
  function stationSpot(x, z) {            // free ground beside the nearest avenue, set back from the kerb; null if none
    let be = null, bd = 1e18;
    for (const e of ave) {
      const a = N[e.from], b = N[e.to], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0.1, Math.min(0.9, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z); if (d < bd && len(e) > 60) { bd = d; be = { e, t, a, b }; }
    }
    if (!be) return null;
    const { e, a, b } = be, h = Math.atan2(b.z - a.z, b.x - a.x), w = e.width || 20;
    for (const dt of [0, 0.12, -0.12, 0.24, -0.24]) for (const off of [w / 2 + 11, w / 2 + 16, w / 2 + 22]) for (const side of [1, -1]) {
      const t = Math.max(0.12, Math.min(0.88, be.t + dt)), px = a.x + (b.x - a.x) * t - Math.sin(h) * off * side, pz = a.z + (b.z - a.z) * t + Math.cos(h) * off * side;
      if (metroSpots.some(q => Math.hypot(q.x - px, q.z - pz) < 40)) continue;
      if (free(px, pz, h, 5, 4) && roadClear(px, pz, 7)) { const sp = { x: px, z: pz, h: h - (side > 0 ? Math.PI / 2 : -Math.PI / 2), edge: e }; metroSpots.push(sp); return sp; }
    }
    return null;
  }
  let metroDefs = custom && Array.isArray(custom.metro) ? custom.metro.filter(l => l && Array.isArray(l.stations) && l.stations.length >= 2) : [];
  if (!metroDefs.length) {       // default: two lines along the generated bus routes (every other stop)
    metroDefs = [0, 2].filter(k => lines[k] && (lines[k].stops || []).length >= 4).map((k, i) => {
      const st = lines[k].stops, pick = [0, 1, 2, 3, 4, 5, 6, 7].map(j => st[Math.floor(j * st.length / 8)]).filter((q, j, arr) => q && arr.indexOf(q) === j).slice(0, 6);
      return { name: i ? 'Blue Line' : 'Red Line', color: METRO_COLORS[i], stations: pick.map(q => ({ at: [q.x, q.z] })) };
    });
  }
  const metroLines = [];
  metroDefs.forEach((d, k) => {
    const line = { id: k, name: d.name || 'Metro ' + (k + 1), color: d.color != null ? d.color : METRO_COLORS[k % 4], stations: [] };
    d.stations.forEach(q => {
      const sp = stationSpot(q.at[0], q.at[1]); if (!sp) { problems.push('a metro station near ' + Math.round(q.at[0]) + ',' + Math.round(q.at[1]) + ' has no free ground'); return; }
      line.stations.push({ id: 'metro' + k + '_' + line.stations.length, name: q.name || STATION_NAMES[nameK++ % STATION_NAMES.length], line: k, x: sp.x, z: sp.z, h: sp.h });
    });
    if (line.stations.length >= 2) metroLines.push(line);
  });
  return { lines, stops, stopAt, depot, stands, metro: { lines: metroLines }, problems };
}

// bus stops and cab stands are where vehicles pull in to the kerb: no parked car may stand there
export function clearTransitSpots(city, transit) {
  const spots = transit.stops.concat(transit.stands);
  city.props = (city.props || []).filter(p => p.type !== 'parkedcar' || !spots.some(s => Math.hypot(s.x - p.x, s.z - p.z) < 16));
  return city;
}
