// Solid concrete for every raised road: deck slabs, bridge piers (a single pillar in the freeway median where a
// street crosses it), and walls along the sides of a ramp while it is still low enough to drive under. All of it
// is also returned as collision polygons (with a `ymax`, so a car riding the deck itself is never blocked).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildEdgesByNode, buildVerticalCurves, elevationAlongEdge } from './roadMath.js';

export const WALL_MIN_Y = 0.25, WALL_MAX_Y = 3.0;     // walls stand where the deck is between these heights
const concrete = new THREE.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.92, metalness: 0.02 });
const concreteDark = new THREE.MeshStandardMaterial({ color: 0x7d7b76, roughness: 0.95 });

// a prism along a segment: lateral interval [l0, l1] (perp to the segment), bottoms yb0/yb1 and tops yt0/yt1 at its two ends
function prism(a, b, l0, l1, yb0, yb1, yt0, yt1) {
  const h = Math.atan2(b.z - a.z, b.x - a.x), px = Math.sin(h), pz = -Math.cos(h);
  const P = (p, l, y) => [p.x + px * l, y, p.z + pz * l];
  const v = [P(a, l0, yb0), P(a, l1, yb0), P(b, l1, yb1), P(b, l0, yb1), P(a, l0, yt0), P(a, l1, yt0), P(b, l1, yt1), P(b, l0, yt1)];
  const f = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]];
  const pos = [];
  f.forEach(([i, j, k, m]) => { [i, j, k, i, k, m].forEach(q => pos.push(...v[q])); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function segInter(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

export function buildStructures(city) {
  const group = new THREE.Group(), colliders = [], piers = [], walls = [];
  const nodes = city.roadNodes, edges = city.roadEdges;
  const vc = buildVerticalCurves(nodes, buildEdgesByNode(edges));
  const light = [], dark = [], rail = [], post = [], railCol = [];
  const byNode = buildEdgesByNode(edges);
  const quad = (cx, cz, ux, uz, hl, hw) => [[cx + ux * hl - uz * hw, cz + uz * hl + ux * hw], [cx + ux * hl + uz * hw, cz + uz * hl - ux * hw],
    [cx - ux * hl + uz * hw, cz - uz * hl - ux * hw], [cx - ux * hl - uz * hw, cz - uz * hl + ux * hw]];
  const hwLine = city.hwLine || [];

  edges.forEach(e => {
    if (e.structure === 'tunnel') return;
    const A = nodes[e.from], B = nodes[e.to];
    const len = Math.hypot(B.x - A.x, B.z - A.z); if (len < 2) return;
    const ux = (B.x - A.x) / len, uz = (B.z - A.z) / len, hw = e.width / 2;
    const at = s => ({ x: A.x + ux * s, z: A.z + uz * s, y: elevationAlongEdge(e, s, nodes, vc) });
    const raised = Math.max(A.elevation, B.elevation) > WALL_MIN_Y;
    // guard rails along both sides of a freeway on the ground (not where a slip road joins at either end)
    if (!raised && e.type === 'highway' && !e.structure) {
      const joinA = (byNode[e.from] || []).length > 2, joinB = (byNode[e.to] || []).length > 2;
      const s0 = joinA ? 45 : 4, s1 = len - (joinB ? 45 : 4), L = hw + 0.9;
      if (s1 - s0 > 10) {
        const nn = Math.max(1, Math.round((s1 - s0) / 4));
        for (let i = 0; i < nn; i++) {
          const pa = at(s0 + (s1 - s0) * i / nn), pb = at(s0 + (s1 - s0) * (i + 1) / nn);
          [1, -1].forEach(side => {
            const l0 = side > 0 ? L : -L - 0.12, l1 = side > 0 ? L + 0.12 : -L;
            rail.push(prism(pa, pb, l0, l1, pa.y + 0.5, pb.y + 0.5, pa.y + 0.82, pb.y + 0.82));                       // the W-beam
            const lp = side > 0 ? L + 0.14 : -L - 0.26;
            post.push(prism(pa, { x: pa.x + ux * 0.14, z: pa.z + uz * 0.14 }, lp, lp + 0.12, pa.y, pa.y, pa.y + 0.9, pa.y + 0.9));   // post
            if (i % 2 === 0) {
              const cx = (pa.x + pb.x) / 2, cz = (pa.z + pb.z) / 2, lc = side > 0 ? L + 0.06 : -L - 0.06;
              railCol.push({ kind: 'parcel', footprint: quad(cx - uz * lc, cz + ux * lc, ux, uz, Math.hypot(pb.x - pa.x, pb.z - pa.z) + 0.2, 0.25), blocksCar: true, destructible: false, response: 'bounce', destroyed: false });
            }
          });
        }
      }
    }
    if (!raised) return;
    const step = 2, n = Math.max(1, Math.round(len / step));
    const bridge = e.structure === 'bridge';
    let prev = at(0);
    for (let i = 1; i <= n; i++) {
      const cur = at(len * i / n), my = (prev.y + cur.y) / 2;
      if (bridge) {
        if (my > 0.6) light.push(prism(prev, cur, -hw - 0.35, hw + 0.35, prev.y - 0.95, cur.y - 0.95, prev.y - 0.04, cur.y - 0.04));   // deck slab
        // crash barrier along both sides
        if (my > 0.6) { dark.push(prism(prev, cur, hw - 0.1, hw + 0.35, prev.y, cur.y, prev.y + 0.75, cur.y + 0.75)); dark.push(prism(prev, cur, -hw - 0.35, -hw + 0.1, prev.y, cur.y, prev.y + 0.75, cur.y + 0.75)); }
      }
      // solid sides while the deck is low
      if (my > WALL_MIN_Y && my < WALL_MAX_Y && !(bridge && my > 2.2 && false)) {
        [1, -1].forEach(side => {
          const l0 = side > 0 ? hw - 0.15 : -hw - 0.55, l1 = side > 0 ? hw + 0.55 : -hw + 0.15;
          light.push(prism(prev, cur, l0, l1, 0, 0, Math.max(prev.y - 0.04, 0.05), Math.max(cur.y - 0.04, 0.05)));
          const cx = (prev.x + cur.x) / 2, cz = (prev.z + cur.z) / 2, sl = Math.hypot(cur.x - prev.x, cur.z - prev.z) / 2 + 0.2;
          const lc = (l0 + l1) / 2, ex = Math.sin(Math.atan2(cur.z - prev.z, cur.x - prev.x)), ez = -Math.cos(Math.atan2(cur.z - prev.z, cur.x - prev.x));
          const dx = (cur.x - prev.x), dz = (cur.z - prev.z), dl = Math.hypot(dx, dz) || 1;
          colliders.push({ kind: 'parcel', footprint: quad(cx + ex * lc, cz + ez * lc, dx / dl, dz / dl, sl, (l1 - l0) / 2 + 0.3), blocksCar: true, destructible: false, response: 'bounce', destroyed: false, ymax: my - 0.12, wall: true });
          walls.push({ x: cx + ex * lc, z: cz + ez * lc, y0: prev.y, y1: cur.y });
        });
      }
      prev = cur;
    }
    if (!bridge) return;

    // ---- piers ---------------------------------------------------------------------------------------------------
    const pillar = (x, z, ux2, uz2, hl, hwid, deckY, kind) => {
      const top = deckY - 0.95;
      if (top < 0.8) return;
      const g = new THREE.BoxGeometry(hl * 2, top, hwid * 2);
      g.rotateY(-Math.atan2(uz2, ux2)); g.translate(x, top / 2, z);
      light.push(g);
      // hammerhead beam under the slab, across the full deck width
      const beam = new THREE.BoxGeometry(2.6, 1.2, e.width + 0.2);
      beam.rotateY(-Math.atan2(uz, ux)); beam.translate(x, top - 0.1, z);
      dark.push(beam);
      colliders.push({ kind: 'parcel', footprint: quad(x, z, ux2, uz2, hl + 0.15, hwid + 0.15), blocksCar: true, destructible: false, response: 'bounce', destroyed: false, ymax: deckY - 0.3, pier: true });
      piers.push({ x, z, hl, hw: hwid, ux: ux2, uz: uz2, deckY, kind });
    };
    // where it crosses the freeway: one pillar in the median, on the freeway's centre line
    let crossed = false;
    for (let j = 1; j < hwLine.length && !crossed; j++) {
      const r = segInter([A.x, A.z], [B.x, B.z], hwLine[j - 1], hwLine[j]);
      if (!r) continue;
      crossed = true;
      const x = A.x + (B.x - A.x) * r.t, z = A.z + (B.z - A.z) * r.t, hl = Math.hypot(hwLine[j][0] - hwLine[j - 1][0], hwLine[j][1] - hwLine[j - 1][1]) || 1;
      const tx = (hwLine[j][0] - hwLine[j - 1][0]) / hl, tz = (hwLine[j][1] - hwLine[j - 1][1]) / hl;
      pillar(x, z, tx, tz, 1.7, 1.2, elevationAlongEdge(e, len * r.t, nodes, vc), 'median');
    }
    if (crossed) return;
    // elsewhere (over the river): a wall pier about every 26 units
    const count = Math.floor(len / 26);
    for (let k = 1; k <= count; k++) {
      const s = len * k / (count + 1), p = at(s);
      pillar(p.x, p.z, ux, uz, 1.1, Math.max(1.5, e.width * 0.3), p.y, 'river');
    }
  });

  const addMerged = (list, mat) => {
    if (!list.length) return;
    const parts = list.map(g => { const q = g.index ? g.toNonIndexed() : g; q.deleteAttribute('uv'); return q; });
    const m = new THREE.Mesh(mergeGeometries(parts, false), mat);
    m.castShadow = true; m.receiveShadow = true; group.add(m);
  };
  addMerged(light, concrete); addMerged(dark, concreteDark);
  addMerged(rail, new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.45, metalness: 0.7 })); addMerged(post, concreteDark);
  colliders.push(...railCol);
  return { group, colliders, piers, walls };
}
