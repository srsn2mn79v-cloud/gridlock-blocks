// Race routing for the Studio and the game (pure maths, no three.js).
// A race is a list of checkpoints placed anywhere. The route between two checkpoints is the SHORTEST way along the roads:
// each checkpoint is joined to the closest point on the road network by a straight connector (which crosses grass if the
// checkpoint is off the road), then the road graph is searched (Dijkstra) for the shortest road path between those two points.
// route(cps, loop) -> { pts, segs, cpDist, length, offRoad }
//   pts     the whole polyline [[x, z], ...] (starts at the first checkpoint; a loop ends back on it)
//   segs    [{ grass: bool, pts }] the same polyline cut into road pieces and grass connectors (the Studio colours them)
//   cpDist  distance along pts at which each checkpoint (1..n-1, then the first one again when it is a loop) is reached
//   offRoad how many checkpoints are further than 6 units from any road
export function makeRouter(nodes, edges) {
  const E = edges.filter(e => nodes[e.from] && nodes[e.to]);
  const adj = {};
  E.forEach(e => {
    const a = nodes[e.from], b = nodes[e.to], len = Math.hypot(a.x - b.x, a.z - b.z);
    e._len = len;
    (adj[e.from] ||= []).push({ to: e.to, len, e });
    (adj[e.to] ||= []).push({ to: e.from, len, e });
  });
  // closest point on any road centre-line: { e, t (0..1 from e.from), x, z, d }
  function nearest(x, z) {
    let best = null;
    E.forEach(e => {
      const a = nodes[e.from], b = nodes[e.to], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)), px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { e, t, x: px, z: pz, d };
    });
    return best;
  }
  // shortest road path from point qa to point qb (both on edges): returns [[x, z], ...]
  function roadPath(qa, qb) {
    const A = nodes[qa.e.from], B = nodes[qa.e.to];
    if (qa.e === qb.e) return [[qa.x, qa.z], [qb.x, qb.z]];
    const dist = {}, prev = {}, done = new Set();
    const open = [];
    const push = (id, d, from) => { if (dist[id] === undefined || d < dist[id]) { dist[id] = d; prev[id] = from; open.push(id); } };
    push(qa.e.from, qa.t * qa.e._len, null); push(qa.e.to, (1 - qa.t) * qa.e._len, null);
    const goal = { [qb.e.from]: qb.t * qb.e._len, [qb.e.to]: (1 - qb.t) * qb.e._len };
    let bestEnd = null, bestD = Infinity;
    while (open.length) {
      let mi = 0; for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[mi]]) mi = i;
      const u = open.splice(mi, 1)[0]; if (done.has(u)) continue; done.add(u);
      if (dist[u] >= bestD) break;
      if (goal[u] !== undefined && dist[u] + goal[u] < bestD) { bestD = dist[u] + goal[u]; bestEnd = u; }
      (adj[u] || []).forEach(({ to, len }) => { if (!done.has(to)) push(to, dist[u] + len, u); });
    }
    if (bestEnd === null) return null;
    const ids = [bestEnd]; while (prev[ids[0]] !== null && prev[ids[0]] !== undefined) ids.unshift(prev[ids[0]]);
    return [[qa.x, qa.z], ...ids.map(id => [nodes[id].x, nodes[id].z]), [qb.x, qb.z]];
  }
  function route(cps, loop) {
    const n = cps.length, segs = [], pts = [], cpDist = [];
    if (n < 2) return { pts: n ? [cps[0].slice()] : [], segs, cpDist, length: 0, offRoad: 0 };
    const q = cps.map(c => nearest(c[0], c[1]));
    let offRoad = 0; q.forEach(p => { if (p.d > 6) offRoad++; });
    let len = 0, last = null;
    const add = (p, grass) => {
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.3) return;
      if (last) {
        len += Math.hypot(p[0] - last[0], p[1] - last[1]);
        const s = segs[segs.length - 1];
        if (s && s.grass === grass) s.pts.push(p); else segs.push({ grass, pts: [last, p] });
      }
      pts.push(p); last = p;
    };
    add(cps[0].slice(), false);
    const legs = loop ? n : n - 1;
    for (let i = 0; i < legs; i++) {
      const a = i, b = (i + 1) % n;
      add([q[a].x, q[a].z], true);                       // checkpoint -> road
      const rp = roadPath(q[a], q[b]);
      if (!rp) return { pts, segs, cpDist, length: len, offRoad, error: 'checkpoint ' + (b + 1) + ' cannot be reached by road from checkpoint ' + (a + 1) };
      rp.forEach(p => add(p, false));
      add(cps[b].slice(), true);                          // road -> checkpoint
      cpDist.push(len);
    }
    return { pts, segs, cpDist, length: len, offRoad };
  }
  return { route, nearest, roadPath };
}

// A saved custom race ({ id, name, kind: 'circuit' | 'sprint', laps, cls, cps: [[x, z], ...] }) -> the race object the game plays
export function raceFromDef(def, router) {
  const cps = (def.cps || []).filter(p => Array.isArray(p) && p.length === 2);
  const loop = def.kind === 'circuit';
  if (cps.length < (loop ? 3 : 2)) return null;
  const r = router.route(cps, loop);
  if (r.error || r.pts.length < 2) return null;
  const checkpoints = cps.slice(1).map(p => p.slice()); if (loop) checkpoints.push(cps[0].slice());
  const race = { kind: def.kind, id: 'custom_' + def.id, name: def.name || 'Custom race', pts: r.pts, length: r.length, width: 16, checkpoints, cpSfix: r.cpDist, custom: true, cls: def.cls === 'E' ? 'E' : 'F' };
  if (loop) { race.lap = true; race.laps = Math.max(1, Math.min(9, def.laps | 0 || 2)); }
  return race;
}
