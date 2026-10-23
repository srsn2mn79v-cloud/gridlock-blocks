// How far a point is from the nearest road surface (negative = on it), measured against the
// real drawn road centrelines (roads.js `mapPaths`, which include the smoothed corners).
// Used by signs.js to keep sign posts off the carriageway, and by tools/check.mjs.
export function makeRoadClearance(mapPaths) {
  const segs = [];
  (mapPaths || []).forEach(p => {
    if (p.structure === 'tunnel') return;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1];
      segs.push({ ax, az, dx: bx - ax, dz: bz - az, l2: (bx - ax) ** 2 + (bz - az) ** 2 || 1, hw: p.width / 2, minx: Math.min(ax, bx) - p.width, maxx: Math.max(ax, bx) + p.width, minz: Math.min(az, bz) - p.width, maxz: Math.max(az, bz) + p.width });
    }
  });
  // distance from (x, z) to the edge of the nearest road surface; `ignore` skips paths by predicate on width (unused)
  return function distToRoad(x, z) {
    let best = Infinity;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (x < s.minx - 20 || x > s.maxx + 20 || z < s.minz - 20 || z > s.maxz + 20) continue;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.l2));
      const d = Math.hypot(x - (s.ax + s.dx * t), z - (s.az + s.dz * t)) - s.hw;
      if (d < best) best = d;
    }
    return best;
  };
}
