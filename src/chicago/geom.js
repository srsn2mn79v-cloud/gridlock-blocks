// Small 2D geometry helpers for the city generator (all in world units, [x, z] pairs).
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

// Distance from a point to a segment, plus the parameter of the closest point.
export function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return { d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t };
}

// Proper segment/segment intersection: returns { t, u } (positions along ab and cd, 0..1) or null.
export function segInter(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const qp = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den, u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { t, u };
}

// Centripetal-ish Catmull-Rom through the points, sampled about every `step` units.
export function spline(pts, step) {
  if (pts.length < 3) return pts.slice();
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [pts[0]];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const n = Math.max(1, Math.round(dist(p1, p2) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  return out;
}

export function polyLen(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]); return l; }

// Point + unit direction at arclength s along a polyline.
export function atLen(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (s <= acc + l || i === pts.length - 1) {
      const t = l ? Math.min(1, Math.max(0, (s - acc) / l)) : 0;
      return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, z: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
        dx: (pts[i][0] - pts[i - 1][0]) / (l || 1), dz: (pts[i][1] - pts[i - 1][1]) / (l || 1), i };
    }
    acc += l;
  }
  return null;
}

// Distance from a point to a polyline, with the segment's unit direction and side (+ = left of travel).
export function nearestOnPoly(px, pz, pts) {
  let best = { d: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const r = distToSeg(px, pz, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (r.d < best.d) {
      const l = dist(pts[i - 1], pts[i]) || 1;
      const dx = (pts[i][0] - pts[i - 1][0]) / l, dz = (pts[i][1] - pts[i - 1][1]) / l;
      const cross = dx * (pz - pts[i - 1][1]) - dz * (px - pts[i - 1][0]);
      best = { d: r.d, i, t: r.t, dx, dz, side: Math.sign(cross) || 1 };
    }
  }
  return best;
}

// Offset curve of a polyline (positive = left of travel), simple miter-free version.
export function offsetPoly(pts, off) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const l = dist(a, b) || 1, dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l;
    return [p[0] - dz * off, p[1] + dx * off];
  });
}

// Polygon (outline) around a polyline of half-width w.
export function ribbonPoly(pts, w) {
  return offsetPoly(pts, w).concat(offsetPoly(pts, -w).reverse());
}

// Mulberry32 so every run of the generator gives the same city.
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
