// The interstate's interchange lanes. A slip road is the fourth lane of its carriageway: the lane starts `exitFar` units before an exit and runs on for `entryHold` units
// after an entry, so there are three lanes between an exit and the next entry. Through traffic never uses it (traffic.js), a car leaving enters it between `exitFar`
// and `exitNear` before the exit, and a car that has just joined stays in it until `mergeRun` units before it ends. 1 unit = 1.25 m, 644 units = half a mile.
// Chicago's interstate carriageways are widened to 4 lanes (17.9 u) on the edges that carry the lane, so the road, its markings, barriers and the traffic all agree.
export const HW_DEFAULT = { lanes4: true, exitFar: 966, exitNear: 322, entryHold: 644, mergeRun: 200, rampBoost: 1 };
export const AUX_WIDTH = 17.9;

// ids of the highway edges that carry the extra lane, and of the slip roads that join the highway (entries); whole edges (they are short)
export function auxLayout(nodes, edges, R = HW_DEFAULT) {
  const len = e => Math.hypot(nodes[e.to].x - nodes[e.from].x, nodes[e.to].z - nodes[e.from].z);
  const hw = edges.filter(e => e.type === 'highway' && !e.ramp);
  const into = {}, outof = {}; hw.forEach(e => { (into[e.to] ||= []).push(e); (outof[e.from] ||= []).push(e); });
  const aux = new Set(), entryRamps = new Set();
  edges.filter(e => e.ramp).forEach(r => {
    if (into[r.from]) { let node = r.from, left = R.exitFar; for (let g = 0; g < 80 && left > 0; g++) { const up = (into[node] || [])[0]; if (!up) break; aux.add(up.id); left -= len(up); node = up.from; } }
    if (outof[r.to]) { entryRamps.add(r.id); let node = r.to, left = R.entryHold; for (let g = 0; g < 80 && left > 0; g++) { const dn = (outof[node] || [])[0]; if (!dn) break; aux.add(dn.id); left -= len(dn); node = dn.to; } }
  });
  return { aux, entryRamps };
}
export function widenInterchanges(nodes, edges, R = HW_DEFAULT, ends = []) {
  if (!R || !R.lanes4) return 0;
  const { aux } = auxLayout(nodes, edges, R); let n = 0;
  const raised = Object.values(nodes).filter(q => (q.elevation || 0) >= 0.25), nearRaised = id => raised.some(q => Math.hypot(q.x - nodes[id].x, q.z - nodes[id].z) < 70);       // not where a ramp climbs onto a bridge
  const nearEnd = id => ends.some(q => Math.hypot(q[0] - nodes[id].x, q[1] - nodes[id].z) < 780);       // the carriageways are still coming together near the ends of the interstate
  edges.forEach(e => { if (aux.has(e.id) && e.lanes === 3 && (e.structure || 'surface') === 'surface' && !nearRaised(e.from) && !nearRaised(e.to) && !nearEnd(e.from) && !nearEnd(e.to) && Math.max(nodes[e.from].elevation || 0, nodes[e.to].elevation || 0) < 0.25) { e.lanes = 4; e.width = AUX_WIDTH; n++; } });
  return n;
}

// The extra lane widens / narrows over TAPER_MAX units (MUTCD-style long taper): e.flare = { n0, n1, T } holds the widths of the narrower highway edges it meets at its two ends.
export const TAPER_MAX = 170, BASE_WIDTH = 13.4, LANE_W = BASE_WIDTH / 3;
export function edgeWidthAt(e, s, len) {
  const f = e.flare; if (!f) return e.width;
  let w = e.width;
  const fl = (d, o) => { if (d < f.T) { const k = Math.max(0, d) / f.T; w = Math.min(w, o + (e.width - o) * k * k * (3 - 2 * k)); } };
  if (f.n0) fl((f.d0 || 0) + s, f.n0); if (f.n1) fl((f.d1 || 0) + len - s, f.n1);       // d0 / d1: how far the run of same-width edges extends before / after this one
  return w;
}
