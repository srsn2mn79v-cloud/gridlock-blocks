// Studio: snapping helpers over the built road network (world coordinates, 1 u = 1.25 m).
// nearestRoadPoint: the closest point on any built road centreline within `max` units, or null.
export function nearestRoadPoint(city, x, z, max = 40) {
  if (!city || !city.roadEdges) return null;
  const N = city.roadNodes; let best = null;
  for (const e of city.roadEdges) {
    const a = N[e.from], b = N[e.to]; if (!a || !b) continue;
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)), px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(px - x, pz - z);
    if (d < max && (!best || d < best.d)) best = { x: px, z: pz, d, edge: e };
  }
  return best;
}
