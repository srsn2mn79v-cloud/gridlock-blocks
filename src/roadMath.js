// Shared road-curve math used by both the 3D mesh builder (roads.js) and the ground
// sampler (terrain.js), so the two can never drift apart — the car always rolls to
// match the surface it's actually standing on because both read from this one place.
//
// Horizontal curves are built as real spiral-arc-spiral (clothoid) alignments, the
// same three-piece structure actual highway design uses:
//   1. Entrance spiral — curvature ramps linearly from 0 up to 1/R, while bank angle
//      ramps from flat up to the full superelevation over the same distance.
//   2. Circular arc — constant radius R, full bank held.
//   3. Exit spiral — the mirror image of the entrance spiral, unwinding back to 0.
// A clothoid's defining property is that curvature is linear in arc length, which means
// heading (its integral) is an exact closed-form piecewise quadratic/linear function of
// arc length — no approximation needed there. Position (the integral of cos/sin of that
// heading) has no elementary closed form (this is the Fresnel-integral situation), so
// it's integrated numerically (trapezoidal rule over many samples) instead of using the
// textbook's truncated power-series approximation.
//
// Vertical curves use the standard civil-engineering parabola: at any node where two
// edges meet at different grades, elevation is blended through a parabolic curve
// centered on that node rather than snapping straight from one slope to the other.
//
// Same simplified, game-appropriate numbers as the city editor (not an exact
// civil-engineering spec) — see the editor's comments for the reasoning.
export const designSpeedKmh = { local: 40, avenue: 70, highway: 120 };
export const frictionAssumed = { local: 0.17, avenue: 0.14, highway: 0.09 };
// Highway corners are sized for a real sweeping bend (a 90-degree turn at the 60-unit trim
// below comes out at roughly a 60-unit radius), not the tight joint a street corner is.
export const cornerTrim = { local: 4, avenue: 7, highway: 60 };
// How long (in world units) the entrance/exit spirals are allowed to run, capped per
// road type — a faster road gets a longer, gentler transition, same idea as a real
// design-speed-based spiral length table.
const spiralCap = { local: 6, avenue: 10, highway: 24 };
// Vertical-curve "K value" stand-in: bigger means a longer, gentler grade transition
// for a given change in slope, scaled up for faster roads same as the horizontal side.
const vcK = { local: 3, avenue: 6, highway: 14 };

export function angleBetween(ax, az, bx, bz) { return Math.atan2(bz - az, bx - ax); }
export function dist(x1, z1, x2, z2) { return Math.hypot(x1 - x2, z1 - z2); }

export function easeInOut(t) { return t * t * (3 - 2 * t); }

export function buildEdgesByNode(edges) {
  const byNode = {};
  edges.forEach(e => {
    (byNode[e.from] ||= []).push(e);
    (byNode[e.to] ||= []).push(e);
  });
  return byNode;
}

// How far back from `nodeId`, measured along `edge`, the *crossing street's* pavement
// ends — i.e. where a crosswalk (and the sidewalk that leads to it) can sit without being
// on top of the intersecting road. Based on the widest *other* road meeting at that node
// (not this edge's own width): a narrow street meeting a wide avenue has to clear the
// avenue's full half-width, which a clearance computed from its own width never did.
// Shared by roads.js (markings + crosswalks) and sidewalks.js (where pedestrians wait and
// cross) so the painted crossing and the walkable one are always the same place.
export function intersectionClearance(nodeId, edge, edgesByNode) {
  let maxHalf = 0;
  (edgesByNode[nodeId] || []).forEach(o => {
    if (o !== edge) maxHalf = Math.max(maxHalf, (o.width || 9) / 2);
  });
  return maxHalf + 1.5;
}

export function pointAt(nodes, nodeId, towardId, distance) {
  const n = nodes[nodeId], o = nodes[towardId];
  const ang = angleBetween(n.x, n.z, o.x, o.z);
  return { x: n.x + Math.cos(ang) * distance, y: n.elevation || 0, z: n.z + Math.sin(ang) * distance };
}

// Integrates the unsigned (turnSign = +1) spiral-arc-spiral shape: curvature ramps
// 0 -> 1/R over [0, Ls], holds at 1/R over [Ls, Ls+Lc], then ramps back to 0 over the
// final Ls. Heading is exact (closed-form integral of a piecewise-linear curvature);
// position (u = forward progress, v = lateral progress) is accumulated with the
// trapezoidal rule since cos/sin of a quadratic heading has no elementary antiderivative.
function integrateProfile(Ls, Lc, R, steps) {
  const Ltotal = 2 * Ls + Lc;
  const thetaS = Ls > 0 ? Ls / (2 * R) : 0;
  function headingAt(l) {
    if (Ls <= 1e-6) return Lc > 0 ? l / R : 0;
    if (l <= Ls) return (l * l) / (2 * R * Ls);
    if (l <= Ls + Lc) return thetaS + (l - Ls) / R;
    const l2 = l - (Ls + Lc);
    return thetaS + Lc / R + (1 / R) * (l2 - (l2 * l2) / (2 * Ls));
  }
  const n = Math.max(8, Math.round(steps));
  const dl = Ltotal / n;
  const points = [{ l: 0, u: 0, v: 0, theta: 0 }];
  let u = 0, v = 0, thPrev = 0;
  for (let i = 1; i <= n; i++) {
    const l1 = i * dl;
    const th1 = headingAt(l1);
    u += dl * 0.5 * (Math.cos(thPrev) + Math.cos(th1));
    v += dl * 0.5 * (Math.sin(thPrev) + Math.sin(th1));
    points.push({ l: l1, u, v, theta: th1 });
    thPrev = th1;
  }
  return { points, Ltotal, thetaS };
}

// Integrates a single one-way spiral on its own: curvature ramps linearly from 0 to
// 1/R over its whole length Ls and *keeps going* at that curvature — it does not
// unwind back down. This is distinct from calling integrateProfile(Ls, 0, R, ...): that
// builds entry-spiral-then-exit-spiral (curvature ramps up then straight back down
// again, an S-shaped double spiral of total length 2*Ls), which is the wrong shape for
// deriving a single spiral's own endpoint/shift parameters below.
function integrateSpiralOnly(Ls, R, steps) {
  function headingAt(l) { return (l * l) / (2 * R * Ls); }
  const n = Math.max(8, Math.round(steps));
  const dl = Ls / n;
  let u = 0, v = 0, thPrev = 0;
  for (let i = 1; i <= n; i++) {
    const l1 = i * dl;
    const th1 = headingAt(l1);
    u += dl * 0.5 * (Math.cos(thPrev) + Math.cos(th1));
    v += dl * 0.5 * (Math.sin(thPrev) + Math.sin(th1));
    thPrev = th1;
  }
  return { u, v };
}

// Builds the full spiral-arc-spiral curve at a 2-edge node, returning everything
// roads.js / terrain.js need to draw and sample it. Returns null where no real curve is
// needed (a near-straight pass-through, or a node that isn't a simple 2-way joint).
export function buildHorizontalCurve(nodeId, nodes, edgesByNode) {
  const connected = edgesByNode[nodeId] || [];
  if (connected.length !== 2) return null;
  const n = nodes[nodeId];
  const otherIds = connected.map(e => (e.from === nodeId ? e.to : e.from));
  const o1 = nodes[otherIds[0]], o2 = nodes[otherIds[1]];
  if (!o1 || !o2) return null;

  const h1 = angleBetween(n.x, n.z, o1.x, o1.z);
  const h2 = angleBetween(n.x, n.z, o2.x, o2.z);
  const deflect = Math.atan2(Math.sin(h2 - h1 - Math.PI), Math.cos(h2 - h1 - Math.PI));
  const deflectAbs = Math.abs(deflect);
  if (deflectAbs * 180 / Math.PI < 3) return null;
  const turnSign = deflect >= 0 ? 1 : -1;

  const type = connected[0].type;
  const d1 = dist(o1.x, o1.z, n.x, n.z), d2 = dist(o2.x, o2.z, n.x, n.z);

  // Base radius, same spirit as the old circular-corner model: enough to keep tight
  // intersections from demanding absurdly long transitions. Scaled by the road's own
  // width, not just its type — a corner on a wide multi-lane street needs a visibly
  // bigger turning radius than a narrow one-lane-each-way street, the same way a real
  // road does; using only the fixed per-type constant made every "local" corner the
  // same tight radius regardless of how wide the road actually was, which read as an
  // abrupt, too-sharp turn on anything wider than the original single-lane streets.
  const cornerWidth = Math.max(connected[0].width || 9, connected[1].width || 9);
  const trimBase = Math.min(Math.max(cornerTrim[type] || 6, cornerWidth * 0.8), Math.min(d1, d2) * 0.4);
  const halfTurn = deflectAbs / 2;
  let R = halfTurn > 0.01 ? trimBase / Math.tan(halfTurn) : 999;
  R = Math.max(R, 4);

  let Ls = Math.max(1.5, Math.min(R * 0.5, spiralCap[type] || 8));
  let thetaS = Ls / (2 * R);
  let Lc;
  if (2 * thetaS >= deflectAbs) {
    // The two spirals alone already cover the whole deflection — shrink them to match
    // exactly instead of overshooting (a "spiral-only"/S-S curve: common for a tight
    // angle on a slower road, no constant-radius middle section at all).
    Ls = deflectAbs * R;
    thetaS = Ls / (2 * R);
    Lc = 0;
  } else {
    Lc = (deflectAbs - 2 * thetaS) * R;
  }

  // Integrate just the entry spiral on its own (length Ls, no arc) to get its endpoint
  // offset from the circle it's tangent to — the standard shift parameters k, p — from
  // which the usual tangent-length formula T = (R+p)*tan(deflect/2) + k follows. Using
  // our own numeric integration here (rather than the textbook's truncated series for
  // k/p) keeps this exactly consistent with the samples actually drawn below. This must
  // be the spiral *alone* (l in [0, Ls]), not the full spiral-arc-spiral curve — k and p
  // describe where the spiral itself ends up relative to the circle it hands off to.
  let end = integrateSpiralOnly(Ls, R, 20);
  let k = end.u - R * Math.sin(thetaS);
  let p = end.v - R * (1 - Math.cos(thetaS));
  let T = (R + p) * Math.tan(deflectAbs / 2) + k;

  // If the curve doesn't fit in the straight run available on either side, scale the
  // whole thing down uniformly. Curvature is defined as a fraction of (R, Ls) throughout
  // (theta(l) only depends on l/Ls and R together, not their absolute sizes), so scaling
  // R, Ls and Lc by the same factor scales every length that falls out of the
  // integration (T, k, p, the drawn samples) by that same factor, without re-integrating.
  const maxReach = Math.min(d1, d2) * 0.85;
  if (T > maxReach && T > 0.0001) {
    const scale = maxReach / T;
    R *= scale; Ls *= scale; Lc *= scale; T *= scale; k *= scale; p *= scale;
  }

  // Superelevation from the *final* radius — a sharper corner banks harder, same
  // side-friction formula as before.
  const v = designSpeedKmh[type] || 50;
  const f = frictionAssumed[type] || 0.14;
  const ef = (v * v) / (127 * Math.max(R, 5));
  const eVal = Math.max(0, ef - f);
  // Superelevation (road banking) is a highway thing only: on ordinary city streets a
  // tilted corner just reads as a road that's broken, so local/avenue corners stay flat
  // (and the car stays level through them — terrain.js reads the same bank value).
  // Highways bank by tan(theta) = v^2 / (r g) (v design speed, r radius in metres, g = 9.81), capped at 10 degrees; the
  // ribbon is lifted by half its width x sin(bank) (roads.js / terrain.js) so the low edge never dips under the ground.
  const bankMax = type === 'highway' ? Math.min(0.175, Math.atan((((designSpeedKmh.highway) / 3.6) ** 2) / (Math.max(R, 5) * 1.25 * 9.81))) : 0;

  // Re-integrate at the final (possibly scaled) R/Ls/Lc for the actual drawable samples.
  const Ltotal0 = 2 * Ls + Lc;
  const steps = Math.max(16, Math.round(Ltotal0 * 1.5));
  const finalProfile = integrateProfile(Ls, Lc, R, steps);
  const Ltotal = finalProfile.Ltotal;

  const phi = h1 + Math.PI; // world heading of the incoming tangent at TS
  const TS = pointAt(nodes, nodeId, otherIds[0], T);
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);

  const samples = finalProfile.points.map(pt => {
    const vv = pt.v * turnSign;
    const theta = pt.theta * turnSign;
    const worldX = TS.x + pt.u * cosPhi - vv * sinPhi;
    const worldZ = TS.z + pt.u * sinPhi + vv * cosPhi;
    const heading = phi + theta;
    const frac = Ls > 0
      ? (pt.l < Ls ? pt.l / Ls : (pt.l < Ls + Lc ? 1 : (Ltotal - pt.l) / Ls))
      : 1;
    return { x: worldX, z: worldZ, heading, bankRad: bankMax * frac * turnSign, l: pt.l };
  });

  return { trim: T, radius: R, bankMax, turnSign, otherIds, type, samples, length: Ltotal };
}

// --- Vertical curves (parabolic grade blending) ---------------------------------

// The standard symmetric parabolic vertical curve: at distance d from the node (the
// PVI), positive toward the "o2" neighbor, elevation follows
//   elev(d) = nodeElevation + A*Lvc/8 + d*(g1+g2)/2 + (A/(2*Lvc))*d^2      (|d| <= Lvc/2)
// where A = g2-g1 is the grade change and Lvc is the curve length. The A*Lvc/8 term is
// the usual "middle ordinate" offset — the curve passes below (sag) or above (crest)
// the point where the two straight grade lines would otherwise have met. Outside the
// curve it's just the plain tangent grade, continued linearly from the curve's edge.
function vcElevationAt(vc, nodeElevation, d) {
  const half = vc.Lvc / 2;
  const mid = nodeElevation + (vc.Adiff * vc.Lvc) / 8;
  if (Math.abs(d) <= half) {
    return mid + d * (vc.g1 + vc.g2) / 2 + (vc.Adiff / (2 * vc.Lvc)) * d * d;
  }
  const sign = d >= 0 ? 1 : -1;
  const edgeD = sign * half;
  const edgeElev = mid + edgeD * (vc.g1 + vc.g2) / 2 + (vc.Adiff / (2 * vc.Lvc)) * edgeD * edgeD;
  const g = sign >= 0 ? vc.g2 : vc.g1;
  return edgeElev + g * (d - edgeD);
}

// Detects a grade change at a 2-edge node and sizes its vertical curve. Independent of
// whether the node also has a horizontal curve — a straight road can still have a
// crest/sag, and a horizontal bend can sit on constant grade.
export function computeVerticalCurve(nodeId, nodes, edgesByNode) {
  const connected = edgesByNode[nodeId] || [];
  if (connected.length !== 2) return null;
  const n = nodes[nodeId];
  const otherIds = connected.map(e => (e.from === nodeId ? e.to : e.from));
  const o1 = nodes[otherIds[0]], o2 = nodes[otherIds[1]];
  if (!o1 || !o2) return null;
  const d1 = dist(o1.x, o1.z, n.x, n.z), d2 = dist(o2.x, o2.z, n.x, n.z);
  if (d1 < 0.01 || d2 < 0.01) return null;

  const g1 = ((n.elevation || 0) - (o1.elevation || 0)) / d1; // grade arriving at n from o1
  const g2 = ((o2.elevation || 0) - (n.elevation || 0)) / d2; // grade leaving n toward o2
  const Adiff = g2 - g1;
  if (Math.abs(Adiff) < 0.001) return null; // no meaningful grade break

  const type = connected[0].type;
  const Lvc = Math.max(4, Math.min((vcK[type] || 5) * Math.abs(Adiff) * 100, 0.9 * Math.min(d1, d2)));
  return { o1Id: otherIds[0], o2Id: otherIds[1], g1, g2, Adiff, Lvc };
}

export function buildVerticalCurves(nodes, edgesByNode) {
  const map = {};
  for (const id in nodes) {
    const vc = computeVerticalCurve(id, nodes, edgesByNode);
    if (vc) map[id] = vc;
  }
  return map;
}

// Elevation at distance `s` from edge.from along a straight edge, blending in either
// endpoint's vertical curve near that endpoint (each one's influence tapers to exactly
// zero at its own curve boundary, so it never affects the far end of a long edge).
export function elevationAlongEdge(edge, s, nodes, vcByNode) {
  const A = nodes[edge.from], B = nodes[edge.to];
  const Len = Math.max(0.0001, dist(A.x, A.z, B.x, B.z));
  const gradeAB = ((B.elevation || 0) - (A.elevation || 0)) / Len;
  let elev = (A.elevation || 0) + gradeAB * s;

  const vcA = vcByNode[edge.from];
  if (vcA && (vcA.o2Id === edge.to || vcA.o1Id === edge.to)) {
    const sign = vcA.o2Id === edge.to ? 1 : -1;
    const half = Math.min(vcA.Lvc / 2, 0.45 * Len);
    const d = sign * s;
    if (Math.abs(d) <= half) {
      elev = vcElevationAt({ ...vcA, Lvc: half * 2 }, A.elevation || 0, d);
    }
  }
  const vcB = vcByNode[edge.to];
  if (vcB && (vcB.o2Id === edge.from || vcB.o1Id === edge.from)) {
    const sign = vcB.o2Id === edge.from ? 1 : -1;
    const half = Math.min(vcB.Lvc / 2, 0.45 * Len);
    const d = sign * (Len - s);
    if (Math.abs(d) <= half) {
      elev = vcElevationAt({ ...vcB, Lvc: half * 2 }, B.elevation || 0, d);
    }
  }
  return elev;
}

// Elevation at arc-length `l` along a horizontal curve built by buildHorizontalCurve
// (l=0 at TS, l=trim at the node itself, l=length at ST) — station-based, same as real
// alignments keep horizontal and vertical geometry independently parameterized.
export function curveElevationAt(nodeId, l, trim, nodes, vcByNode) {
  const n = nodes[nodeId];
  const vc = vcByNode[nodeId];
  if (!vc) return n.elevation || 0;
  return vcElevationAt(vc, n.elevation || 0, l - trim);
}
