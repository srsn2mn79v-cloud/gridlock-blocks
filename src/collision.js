// Static-world collision: builds the set of things a car can physically hit (buildings,
// blocking props, and AI traffic) and resolves the player's car against them each frame.
//
// Pedestrians are never passed into buildCollisionWorld and never appear in its output
// — see pedestrians.js and the comment in main.js where it's wired up. That's what
// makes hitting a pedestrian impossible: there is no code path that tests the car
// against one, not just an AI that happens to avoid them.
import { propPhysics, parcelPhysics, destroySpeedThreshold } from './physicsConfig.js';

const BODY_OFFSETS = [1.3, 0, -1.3], BODY_R = 1.05;
function dist(x1, z1, x2, z2) { return Math.hypot(x1 - x2, z1 - z2); }

export function pointInPolygon(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    const intersect = ((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function closestPointOnPolygon(px, pz, poly) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const lenSq = dx * dx + dz * dz;
    let t = lenSq === 0 ? 0 : ((px - a[0]) * dx + (pz - a[1]) * dz) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a[0] + t * dx, cz = a[1] + t * dz;
    const d = dist(px, pz, cx, cz);
    if (d < bestD) { bestD = d; best = { x: cx, z: cz }; }
  }
  return { point: best, dist: bestD };
}

// propInstances / parcelInstances come from buildProps()/buildParcels()'s returned
// `instances` arrays (each carries the mesh, so destruction can hide/knock it down).
export function buildCollisionWorld(propInstances, parcelInstances) {
  const colliders = [];

  (propInstances || []).forEach(inst => {
    const cfg = propPhysics[inst.type];
    if (!cfg) return; // no entry = purely decorative, no collision at all
    colliders.push({
      kind: 'prop', instance: inst, x: inst.x, z: inst.z, radius: cfg.radius,
      blocksCar: cfg.blocksCar, destructible: cfg.destructible,
      destroy: cfg.destroy, spray: cfg.spray, debrisColor: cfg.debrisColor, speedPenalty: cfg.speedPenalty || 0, mass: cfg.mass, fall: cfg.fall, breakSpeed: cfg.breakSpeed,
      response: cfg.response || 'bounce',
      destroyed: false
    });
  });

  (parcelInstances || []).forEach(inst => {
    const cfg = parcelPhysics[inst.type];
    if (!cfg || !cfg.blocksCar) return;
    // Buildings collide against their actual footprint polygon, not a bounding circle
    // — a circle through a rectangle's corners extends well past its real edges (up to
    // ~41% past the midpoint of each side), which used to create an invisible wall
    // reaching out onto the adjoining road or sidewalk near every building.
    colliders.push({
      kind: 'parcel', instance: inst, footprint: inst.footprint,
      blocksCar: true, destructible: false, response: cfg.response || 'bounce', destroyed: false
    });
  });

  return colliders;
}

// How hard this impact actually was, in the only terms the car's scalar speed+heading
// model can express: `impactFraction` is how head-on it was (1 = drove straight into
// the normal, 0 = grazing along the surface almost parallel to it), and `turnSign` is
// which way to deflect to go "around" whatever was hit. The car always moves exactly
// along its own heading (see car.js), so there's no independent lateral velocity to
// reflect — these two numbers are what every response mode below is built from instead.
function impact(car, nx, nz) {
  // car.js's heading convention: forward = (sin h, cos h) — not the atan2(dz,dx)
  // convention other files use (see traffic.js's header comment for why that
  // distinction matters and bit the AI cars earlier).
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const dot = fx * nx + fz * nz; // + means facing away from the obstacle, - means into it
  const impactFraction = Math.min(1, Math.abs(dot));
  const turnSign = Math.sign(fx * nz - fz * nx) || 1;
  return { impactFraction, turnSign };
}

// Bleeds off speed in proportion to how head-on the hit was (a graze along a wall
// barely costs you anything; driving straight into it costs a lot), rather than a flat
// multiplier regardless of angle — that flat cut was what made "rubbing against
// objects" feel like driving into molasses.
function applyBounce(car, nx, nz, dt) {
  const { impactFraction } = impact(car, nx, nz);
  const lossPerSecond = 6 * (car.massFactor || 1);   // heavier vehicles bleed more speed on objects
  car.wallHit = Math.max(car.wallHit || 0, Math.abs(car.speed) * impactFraction);   // how hard it hit (drift events read and clear this)
  car.speed *= Math.max(0, 1 - impactFraction * lossPerSecond * dt);
}

// Mostly preserves speed but steers the car around the obstacle instead — for things
// you'd realistically deflect off rather than crunch into: lamp posts, sign posts,
// traffic-light poles, a bus-stop bench. Also used as the "it broke, but you clipped
// it on the way through" response when a destructible actually breaks.
function applyRedirect(car, nx, nz, dt) {
  const { impactFraction, turnSign } = impact(car, nx, nz);
  const DEFLECT_RATE = 3.2; // rad/sec at a fully head-on hit
  car.wallHit = Math.max(car.wallHit || 0, Math.abs(car.speed) * impactFraction);
  car.heading += turnSign * impactFraction * DEFLECT_RATE * dt;
  car.speed *= Math.max(0, 1 - impactFraction * 1.5 * (car.massFactor || 1) * dt);
}

// Car-vs-AI-vehicle: a proper momentum exchange. Both bodies are treated as point masses
// along the contact normal (n points from the other vehicle toward the player): the player
// loses or gains speed according to the mass ratio and closing speed, the other vehicle is
// handed a new velocity (it slides, spins, and for hard hits hops and tumbles - see
// traffic.js applyImpact), and the two are pushed apart in proportion to how light each is.
function hitVehicle(car, c, nx, nz, overlap) {
  const o = c.ref;
  const mp = car.mass || 1300, mo = o.mass || 1300;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const pv = { x: car.vx ?? fx * car.speed, z: car.vz ?? fz * car.speed };
  const ov = o.getVelocity();
  const vn = (pv.x - ov.x) * nx + (pv.z - ov.z) * nz;     // < 0: the player is moving into it
  // a car still following its road can't be shoved sideways, so the player takes the whole separation
  const wp = o.knock ? mo / (mp + mo) : 1, wo = o.knock ? mp / (mp + mo) : 0;
  car.x += nx * overlap * wp; car.z += nz * overlap * wp;
  // anything the player runs into stops and flashes its hazards (even a tap that doesn't wreck it)
  if (!o.knock) o.crashTimer = Math.max(o.crashTimer || 0, 5);
  if (!o.knock) {
    // the AI car's own circles move with it: shove its mesh the other way
    o.mesh.position.x -= nx * overlap * wo; o.mesh.position.z -= nz * overlap * wo;
    o.colliders.forEach(k => { k.x -= nx * overlap * wo; k.z -= nz * overlap * wo; });
  } else {
    o.knock.x -= nx * overlap * wo; o.knock.z -= nz * overlap * wo;
    o.colliders.forEach(k => { k.x -= nx * overlap * wo; k.z -= nz * overlap * wo; });
  }
  if (vn >= -0.15) return;
  const e = 0.2;                                           // a little bounce
  const j = -(1 + e) * vn / (1 / mp + 1 / mo);
  const npx = pv.x + (j / mp) * nx, npz = pv.z + (j / mp) * nz;
  const nox = ov.x - (j / mo) * nx, noz = ov.z - (j / mo) * nz;
  // player: keep heading (mostly), take the new forward speed and swing toward the new direction
  const newFwd = npx * fx + npz * fz;
  const newSide = npx * fz - npz * fx;                     // component along (cos h, -sin h)
  car.speed = newFwd;
  car.vx = npx; car.vz = npz;
  car.heading += Math.max(-0.5, Math.min(0.5, Math.atan2(newSide, Math.max(Math.abs(newFwd), 2)) * 0.35));
  car.impactSpeed = Math.abs(vn);
  // other vehicle
  const dv = j / mo;
  if (dv < 1.2 && !o.knock) return;                        // a gentle tap isn't a wreck
  const ofx = Math.sin(o.mesh.rotation.y), ofz = Math.cos(o.mesh.rotation.y);
  const cross = ofx * nz - ofz * nx;                       // side-on hits spin it, head-on ones don't
  o.applyImpact(nox, noz, cross * Math.min(3.5, dv * 0.45), dv, Math.sign(cross) || 1);
}

// Pushes the car out of anything solid it's overlapping and bleeds off its speed on
// impact — the exact feel depends on what was hit (see applyBounce/applyRedirect
// above): buildings/trees/AI traffic bounce you off a bit, lamp posts/signs/traffic
// lights/benches redirect you around them. A destructible prop hit above
// destroySpeedThreshold breaks instead of blocking, and is returned so the caller can
// trigger a knockdown/debris effect and stop treating it as solid.
export function resolveCarCollisions(car, colliders, dt = 1 / 60) {
  const destroyedNow = [];
  const carRadius = car.collisionRadius || 1.1;

  const exempt = colliders.exempt;        // set by the world: underground (a garage) the city's walls and props are not there; at an open garage door the building lets the car in
  for (const c of colliders) {
    if (c.destroyed || !c.blocksCar) continue;
    if (exempt && exempt(car, c)) continue;

    if (c.kind === 'parcel') {
      if (c.ymax !== undefined && (car.y || 0) > c.ymax) continue;     // a deck above you is not a wall
      // cheap reject first: the footprint's bounding box (cached) grown by the car's reach
      let bb = c._bb;
      if (!bb) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of c.footprint) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; } bb = c._bb = [x0, x1, z0, z1]; }
      if (car.x < bb[0] - carRadius - 1 || car.x > bb[1] + carRadius + 1 || car.z < bb[2] - carRadius - 1 || car.z > bb[3] + carRadius + 1) continue;
      const inside = pointInPolygon(car.x, car.z, c.footprint);
      const { point, dist: d } = closestPointOnPolygon(car.x, car.z, c.footprint);
      if (!inside && d >= carRadius) continue;

      let nx, nz;
      if (inside) {
        // Shouldn't normally happen (resolved every frame), but if the car ever ends
        // up embedded, push it out through the nearest edge away from the building's
        // centroid rather than leaving it stuck.
        const cx = c.footprint.reduce((s, p) => s + p[0], 0) / c.footprint.length;
        const cz = c.footprint.reduce((s, p) => s + p[1], 0) / c.footprint.length;
        nx = car.x - cx; nz = car.z - cz;
        const mag = Math.hypot(nx, nz) || 0.001;
        nx /= mag; nz /= mag;
        car.x = point.x + nx * carRadius;
        car.z = point.z + nz * carRadius;
      } else {
        nx = (car.x - point.x) / d; nz = (car.z - point.z) / d;
        const overlap = carRadius - d;
        car.x += nx * overlap;
        car.z += nz * overlap;
      }
      car.absorb && car.absorb(nx, nz);
      applyBounce(car, nx, nz, dt);
      continue;
    }

    // The car's body is three circles along its length (nose, middle, tail), so things hit
    // the actual front of the car instead of a point in its middle (which let you visibly
    // clip into the thing before touching it).
    { const rr = (c.radius || 0) + 9; if (Math.abs(c.x - car.x) > rr || Math.abs(c.z - car.z) > rr) continue; }   // too far to touch
    if (c.kind === 'traffic' && c.y !== undefined && Math.abs(c.y - (car.y || 0)) > 3.5) continue;   // different level
    for (const off of (car.bodyOffsets || BODY_OFFSETS)) {
      const px = car.x + Math.sin(car.heading) * off, pz = car.z + Math.cos(car.heading) * off;
      const dx = px - c.x, dz = pz - c.z;
      const d = Math.hypot(dx, dz);
      const minDist = c.radius + BODY_R;
      if (d >= minDist) continue;

      const safeD = d || 0.001;
      const nx = dx / safeD, nz = dz / safeD;
      if (c.kind === 'traffic') { hitVehicle(car, c, nx, nz, minDist - safeD); continue; }

      if (c.destructible && Math.abs(car.speed) >= (c.breakSpeed ?? destroySpeedThreshold)) {
        c.destroyed = true;
        destroyedNow.push(c);
        // Breaking something that size isn't free — shave a defined chunk off the car's
        // speed on top of whatever the redirect nudge already costs.
        applyRedirect(car, nx, nz, dt);
        if (c.speedPenalty) car.speed *= (1 - Math.min(0.9, c.speedPenalty * (car.massFactor || 1)));
        break;
      }

      const overlap = minDist - safeD;
      car.x += nx * overlap;
      car.z += nz * overlap;
      car.absorb && car.absorb(nx, nz);

      if (c.response === 'redirect') applyRedirect(car, nx, nz, dt);
      else applyBounce(car, nx, nz, dt);
    }
  }
  return destroyedNow;
}
