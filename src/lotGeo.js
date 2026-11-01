// How a shop car park meets the street: which street it opens onto, the lane a car drives in (arriving) and out (leaving) in, the stop line
// and STOP sign on the way out, and the curves between the lane and the mouth of the alley. Used by lots.js (the cars), signs.js (the STOP sign)
// and the `lots` check. Right-hand traffic: cars come from `D`, turn right into the alley, and turn right out of it to carry on along `D`.
// Heading convention here: forward (fx, fz); the right-hand side of a car heading (fx, fz) is (-fz, fx) (traffic.js: positive lateral = right).
const lerp = (a, b, t) => a + (b - a) * t;

// the cached geometry of one lot, or null if no suitable street is near
const _cache = new WeakMap();
export function lotGeometry(city, sh) {
  if (_cache.has(sh)) return _cache.get(sh);
  const nodes = city.roadNodes, M = sh.mouth, n = { x: sh.nx, z: sh.nz };
  let best = null, bd = 1e9;
  for (const e of city.roadEdges) {
    if (e.type === 'highway' || e.ramp || e.structure === 'bridge' || e.structure === 'tunnel') continue;
    const a = nodes[e.from], b = nodes[e.to]; if (!a || !b) continue;
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((M.x - a.x) * dx + (M.z - a.z) * dz) / l2)), d = Math.hypot(a.x + dx * t - M.x, a.z + dz * t - M.z);
    if (d < bd) { bd = d; best = { e, a, b, t, l: Math.sqrt(l2), ux: dx / Math.sqrt(l2), uz: dz / Math.sqrt(l2), d }; }
  }
  if (!best || bd > 30) { _cache.set(sh, null); return null; }
  const { e, a } = best, w = e.width || 9, lanes = Math.max(1, e.lanes || 1);
  // D: the direction of travel that has the alley on its right (right of D = (-Dz, Dx) = n)
  const want = { x: n.z, z: -n.x };
  let D = { x: best.ux, z: best.uz }; if (D.x * want.x + D.z * want.z < 0) D = { x: -D.x, z: -D.z };
  const right = { x: -D.z, z: D.x };
  const lat = e.oneWay ? -w / 2 + (lanes - 0.5) * (w / lanes) : (lanes - 0.5) * ((w / 2) / lanes);      // the right-hand (kerb) lane, as traffic.js laneLateral
  const lanePt = s => ({ x: M.x + D.x * s + right.x * (lat - signedOffset(best, M, right)), z: M.z + D.z * s + right.z * (lat - signedOffset(best, M, right)) });
  // signed distance of the mouth from the street centre line, measured along `right` (positive = the mouth is on the right of the centre line)
  function signedOffset(bst, m, r) { return (m.x - (bst.a.x + bst.ux * bst.t * bst.l)) * r.x + (m.z - (bst.a.z + bst.uz * bst.t * bst.l)) * r.z; }
  const mouthOff = signedOffset(best, M, right);
  // the stop line: beyond the pavement (centre line + half the road + 2.8 u of kerb and walk), measured from the street centre
  const stopOff = w / 2 + 4.4, T = { x: M.x + n.x * Math.max(0, stopOff - Math.abs(mouthOff)), z: M.z + n.z * Math.max(0, stopOff - Math.abs(mouthOff)) };
  const g = { edge: e, D, right, lat, mouthOff, M, n, lanePt, T, laneIndex: lanes - 1, stopSign: { x: T.x + right.x * 0 - D.x * 0 + (-n.z) * -3.4 * -1, z: T.z + n.x * -3.4 * -1, dir: { x: -n.x, z: -n.z } } };
  // the sign stands on the right-hand side of the exit lane: right of heading (-n) is (n.z, -n.x)
  g.stopSign = { x: T.x + n.z * 3.2 + n.x * 0.5, z: T.z - n.x * 3.2 + n.z * 0.5, dir: { x: -n.x, z: -n.z } };
  _cache.set(sh, g);
  return g;
}

// a cubic Bezier as points: p0 heading h0 -> p3 heading h3, with handles of the given length
export function bezier(p0, h0, p3, h3, handle = 7, steps = 10) {
  const c1 = { x: p0.x + h0.x * handle, z: p0.z + h0.z * handle }, c2 = { x: p3.x - h3.x * handle, z: p3.z - h3.z * handle }, out = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    out.push({ x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x, z: u * u * u * p0.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * p3.z });
  }
  return out;
}
export { lerp };
