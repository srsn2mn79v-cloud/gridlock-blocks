// Ground-height lookup for the car to ride on, including the actual banked height at a
// given lateral offset across a corner — not just the centerline elevation.
//
// The city is grey-box (no heightmap terrain mesh), so "following the terrain" means
// following the road graph itself: every node carries the elevation that draws bridges
// and tunnels correctly in roads.js, and every corner has a computed bank angle. This
// reads that same data (via roadMath.js, shared with roads.js so the two can't drift
// apart). Car.js samples this at each of the car's four wheel positions and derives
// pitch/roll from the differences — that's what makes the tilt track the real surface
// instead of a single formula guessing at it.
import {
  buildHorizontalCurve, buildEdgesByNode, buildVerticalCurves,
  elevationAlongEdge, curveElevationAt, dist
} from './roadMath.js';
import { buildSidewalkSegments, SIDEWALK_WIDTH } from './sidewalks.js';

export function createGroundSampler(cityData) {
  const nodes = cityData.roadNodes || {};
  const edgesByNode = buildEdgesByNode(cityData.roadEdges || []);

  const curveInfo = {};
  for (const id in nodes) {
    const c = buildHorizontalCurve(id, nodes, edgesByNode);
    if (c) curveInfo[id] = c;
  }
  const vcByNode = buildVerticalCurves(nodes, edgesByNode);

  // Straight runs: height now follows the same vertical-curve-aware elevation lookup
  // roads.js draws its ribbon with, instead of a plain linear blend — otherwise the car
  // would ride a flat slope through what the mesh actually draws as a smooth crest/sag.
  const segments = (cityData.roadEdges || []).map(e => {
    const a = nodes[e.from], b = nodes[e.to];
    if (!a || !b) return null;
    const len = dist(a.x, a.z, b.x, b.z);
    // where the straight ribbon starts/ends: a smoothed bend hands over to the corner ribbon at its trim
    const t0 = curveInfo[e.from] ? curveInfo[e.from].trim : 0, t1 = curveInfo[e.to] ? curveInfo[e.to].trim : 0;
    const deg = id => (edgesByNode[id] || []).length;
    const mg = e.width / 2 + 2;
    return { edge: e, a, b, len, halfWidth: e.width / 2, t0, t1, minx: Math.min(a.x, b.x) - mg, maxx: Math.max(a.x, b.x) + mg, minz: Math.min(a.z, b.z) - mg, maxz: Math.max(a.z, b.z) + mg, junctA: deg(e.from) >= 3, junctB: deg(e.to) >= 3 };
  }).filter(Boolean);

  // Corners: sampled points along the same spiral-arc-spiral curve roads.js draws, each
  // with the bank angle and local tangent heading at that point, so a query off-center
  // can be projected onto the tangent's perpendicular to find its lateral offset —
  // needed to compute the actual banked height there, matching buildRibbon's
  // cross-section.
  const edgeBetween = (a, b) => (cityData.roadEdges || []).find(e =>
    (e.from === a && e.to === b) || (e.from === b && e.to === a)
  );

  const corners = [];
  for (const nodeId in curveInfo) {
    const c = curveInfo[nodeId];
    // Use whichever of the two joining edges is wider, not just "the first edge found
    // at this node" — at a corner where a local road widens into an avenue or highway,
    // picking the narrower edge's width shrank the search radius on the wide side,
    // which could miss it entirely and fall back to height 0 right at the seam.
    const w1 = (edgeBetween(nodeId, c.otherIds[0]) || {}).width || 9;
    const w2 = (edgeBetween(nodeId, c.otherIds[1]) || {}).width || 9;
    const width = Math.max(w1, w2);
    const pts = c.samples.map(s => ({
      x: s.x, z: s.z,
      y: curveElevationAt(nodeId, s.l, c.trim, nodes, vcByNode),
      bank: s.bankRad
    }));
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      pts[i].heading = Math.atan2(next.z - prev.z, next.x - prev.x);
    }
    const xs = pts.map(q => q.x), zs = pts.map(q => q.z), m = width / 2 + 4;
    corners.push({ pts, halfWidth: width / 2, nodeId, minx: Math.min(...xs) - m, maxx: Math.max(...xs) + m, minz: Math.min(...zs) - m, maxz: Math.max(...zs) + m });
  }

  // Flat sidewalks (see sidewalks.js): the car rides up over the kerb.
  const walks = buildSidewalkSegments(cityData).map(w => {
    const dx = w.x2 - w.x1, dz = w.z2 - w.z1;
    return { ...w, dx, dz, l2: dx * dx + dz * dz || 1, minx: Math.min(w.x1, w.x2) - 3, maxx: Math.max(w.x1, w.x2) + 3, minz: Math.min(w.z1, w.z2) - 3, maxz: Math.max(w.z1, w.z2) + 3 };
  });
  const paved = (cityData.parcels || []).filter(p => p.type === 'plaza' && p.footprint).map(p => {
    const xs = p.footprint.map(q => q[0]), zs = p.footprint.map(q => q[1]);
    return { f: p.footprint, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  });
  const inPoly = (x, z, f) => { let c = false; for (let i = 0, j = f.length - 1; i < f.length; j = i++) { if ((f[i][1] > z) !== (f[j][1] > z) && x < (f[j][0] - f[i][0]) * (z - f[i][1]) / (f[j][1] - f[i][1]) + f[i][0]) c = !c; } return c; };

  // Height at a single (x, z): the road ribbon exactly as roads.js draws it (straight runs, then the
  // corner curve with its bank), or a kerb-height sidewalk, or the ground (0).
  // `refY` is the caller's current height: where roads cross at different levels the surface closest to
  // refY wins, so a car under a deck isn't snapped up onto it. Afterwards `heightAt.kind` says what the
  // chosen surface was: 'road' | 'curb' | 'plaza' | 'ground' (grass / dirt / nothing under you).
  // spatial index: every road segment / corner / sidewalk / plaza is filed under the 80-unit cells its bounding box covers,
  // so a height query only looks at the handful of things near the point instead of the whole city
  const CELL = 80, EMPTY = [];
  const keyOf = (cx, cz) => (cx + 2000) * 5003 + cz + 2000;
  function buildIdx(list, b) {
    const m = new Map();
    for (const it of list) {
      const x0 = Math.floor(it[b[0]] / CELL), x1 = Math.floor(it[b[1]] / CELL), z0 = Math.floor(it[b[2]] / CELL), z1 = Math.floor(it[b[3]] / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) { const k = keyOf(cx, cz), l = m.get(k); if (l) l.push(it); else m.set(k, [it]); }
    }
    return (x, z) => m.get(keyOf(Math.floor(x / CELL), Math.floor(z / CELL))) || EMPTY;
  }
  const BB = ['minx', 'maxx', 'minz', 'maxz'];
  const segAt = buildIdx(segments, BB), cornerAt = buildIdx(corners, BB), walkAt = buildIdx(walks, BB), pavedAt = buildIdx(paved, ['x0', 'x1', 'z0', 'z1']);
  const cy = new Float64Array(64), cd = new Float64Array(64), ck = new Array(64);
  function heightAt(x, z, refY) {
    let n = 0, kind = 'ground';
    const consider = (d, y, k) => { cy[n] = y; cd[n] = d; ck[n] = k; n++; };

    for (const s of segAt(x, z)) {
      if (x < s.minx || x > s.maxx || z < s.minz || z > s.maxz) continue;
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
      const rawT = ((x - s.a.x) * dx + (z - s.a.z) * dz) / (s.len * s.len || 1);
      const along = rawT * s.len;
      // only the part of the edge the straight ribbon covers; ends at junctions (flat) keep a little reach
      const lo = s.junctA ? -s.halfWidth : s.t0, hi = s.len - (s.junctB ? -s.halfWidth : s.t1);
      if (along < lo - 0.01 || along > hi + 0.01) continue;
      const tt = Math.max(0, Math.min(1, rawT));
      const cx = s.a.x + tt * dx, cz = s.a.z + tt * dz;
      const d = dist(x, z, cx, cz);
      if (d <= s.halfWidth + 0.15) consider(d, elevationAlongEdge(s.edge, tt * s.len, nodes, vcByNode), 'road');
    }

    for (const corner of cornerAt(x, z)) {
      if (x < corner.minx || x > corner.maxx || z < corner.minz || z > corner.maxz) continue;
      const pts = corner.pts;
      // nearest sample, then project onto its two neighbours' segments and interpolate (a stair-step
      // of sample heights is what made bridges and ramps feel bumpy)
      let bi = -1, bd = Infinity;
      for (let i = 0; i < pts.length; i++) { const d2 = (x - pts[i].x) ** 2 + (z - pts[i].z) ** 2; if (d2 < bd) { bd = d2; bi = i; } }
      if (bd > (corner.halfWidth + 3) ** 2) continue;
      let best = null;
      for (const [i0, i1] of [[bi - 1, bi], [bi, bi + 1]]) {
        if (i0 < 0 || i1 >= pts.length) continue;
        const p0 = pts[i0], p1 = pts[i1], ex = p1.x - p0.x, ez = p1.z - p0.z, l2 = ex * ex + ez * ez || 1;
        const t = ((x - p0.x) * ex + (z - p0.z) * ez) / l2;
        if (t < -0.001 || t > 1.001) continue;
        const tc = Math.max(0, Math.min(1, t));
        const px = p0.x + ex * tc, pz = p0.z + ez * tc, d = dist(x, z, px, pz);
        if (!best || d < best.d) best = { d, p0, p1, tc, px, pz };
      }
      if (!best || best.d > corner.halfWidth + 0.15) continue;
      const { p0, p1, tc } = best;
      const yc = p0.y + (p1.y - p0.y) * tc, bank = p0.bank + (p1.bank - p0.bank) * tc;
      let y = yc;
      if (Math.abs(bank) > 0.0005) {
        const hd = Math.atan2(p1.z - p0.z, p1.x - p0.x);
        const lateral = (x - best.px) * Math.sin(hd) + (z - best.pz) * -Math.cos(hd);
        y = yc + lateral * Math.sin(bank) + corner.halfWidth * Math.abs(Math.sin(bank));
      }
      consider(best.d, y, 'road');
    }

    for (const w of walkAt(x, z)) {
      if (x < w.minx || x > w.maxx || z < w.minz || z > w.maxz) continue;
      const t = Math.max(0, Math.min(1, ((x - w.x1) * w.dx + (z - w.z1) * w.dz) / w.l2));
      const d = dist(x, z, w.x1 + w.dx * t, w.z1 + w.dz * t);
      if (d <= SIDEWALK_WIDTH / 2) consider(d, w.elevation, 'curb');
    }

    let bestY = 0;
    if (n) {
      let pick = 0;
      if (refY === undefined) {
        let bs = Infinity; for (let i = 0; i < n; i++) { const sc = cd[i] + (ck[i] === 'curb' ? 0.2 : 0); if (sc < bs) { bs = sc; pick = i; } }
      } else {
        // the surface at (or nearest to) the caller's height; where several lie within ~a metre of it
        // (a ramp rising out of a street, a kerb beside the road) the top one is the one you're driving on
        // a deck well above you is a roof, never a floor: it is skipped (walls keep you from driving onto it)
        let m = Infinity; for (let i = 0; i < n; i++) if (cy[i] <= refY + 0.6) m = Math.min(m, Math.abs(cy[i] - refY));
        let by = -Infinity, bd2 = Infinity;
        pick = -1;
        for (let i = 0; i < n; i++) {
          if (cy[i] > refY + 0.6 || Math.abs(cy[i] - refY) > m + 1.0) continue;
          if (ck[i] === 'curb' && cd[i] > SIDEWALK_WIDTH / 2) continue;
          if (cy[i] > by + 0.02 || (Math.abs(cy[i] - by) <= 0.02 && cd[i] < bd2)) { by = cy[i]; bd2 = cd[i]; pick = i; }
        }
      }
      if (pick >= 0) { bestY = cy[pick]; kind = ck[pick]; }
    }
    if (kind === 'ground') {
      for (const p of pavedAt(x, z)) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && inPoly(x, z, p.f)) { kind = 'plaza'; break; }
    }
    heightAt.kind = kind;
    return bestY;
  }
  heightAt.kind = 'ground';
  return heightAt;
}
