// Shop car parks come alive: now and then a car turns in from the street, drives down the alley, noses into a free bay, its driver gets
// out and walks to the shop door and goes in; a while later they come back out, get in, and the car reverses out and drives off.
// Visitors only start while the player is within ~240 u (and not right at the mouth of the alley, where they would pop into view).
// The cars are solid like any AI car (traffic-kind colliders, see collision.js hitVehicle); a car that gets hit stops for a few seconds.
import * as THREE from 'three';
import { buildCarBody, parkedCarStyle } from './vehicleModels.js';
import { lotGeometry, bezier } from './lotGeo.js';

const COLORS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0xecf0f1, 0x2c3e50, 0x7f8c8d, 0xd35400, 0x8e44ad, 0x1abc9c, 0xbdc3c7, 0x34495e];
const MAX_ACTIVE = 22, DRIVE = 4.2, STREET = 7.5, TURN = 3.4, REVERSE = 2.2, WALK = 1.1;
// is a shop open at this hour? `hours` is '24/7' (the default for anything that does not say) or [open, close]
export function isOpen(sh, hour) { const h = sh.info && sh.info.hours || sh.hours; if (!h || h === '24/7') return true; return hour >= h[0] && hour < h[1]; }

export function createShopLots({ scene, cityData, collisionWorld, heightAt, pedestrians, adopt = null, reserve = null, release = null, busy = null, rng = Math.random }) {
  const lots = [...(cityData.shops || []), ...(cityData.stations || []).filter(q => q.market)].filter(sh => sh.bays && sh.mouth && sh.door).map(sh => ({
    sh, free: sh.bays.filter(b => !b.taken).map(b => ({ b, busy: false })), timer: 2 + rng() * 10, vs: [], geo: lotGeometry(cityData, sh), cap: sh.market ? 3 : 1
  })).filter(l => l.free.length);
  const stats = { arrived: 0, entered: 0, left: 0 };
  let active = 0;

  const yawOf = (dx, dz) => Math.atan2(dx, dz);
  const turnTo = (cur, want, k) => { let d = want - cur; d = Math.atan2(Math.sin(d), Math.cos(d)); return cur + d * Math.min(1, k); };

  function makeCar(color) {
    const style = parkedCarStyle(Math.floor(rng() * 40));
    const mesh = buildCarBody(style, color); mesh.rotation.order = 'YXZ'; scene.add(mesh);
    const d = mesh.userData.dims || { len: 3.6, wid: 1.8 };
    const off = Math.max(0.6, d.len / 2 - 1.0);
    const colliders = [off, 0, -off].map(o => ({ kind: 'traffic', x: 0, z: 0, radius: 0.85, off: o, blocksCar: true, destructible: false, destroyed: false, ref: null }));
    const o = { mesh, colliders, color, len: d.len, wid: d.wid, height: d.height || 1.5, mass: 1300, crashTimer: 0,
      getVelocity: () => ({ x: 0, z: 0 }), applyImpact: () => { o.crashTimer = Math.max(o.crashTimer, 6); } };
    colliders.forEach(c => { c.ref = o; });
    collisionWorld.push(...colliders);
    return o;
  }
  function place(o, x, z, yaw) {
    o.x = x; o.z = z; o.yaw = yaw;
    const y = heightAt ? heightAt(x, z, 0) : 0;
    o.mesh.position.set(x, y + 0.02, z); o.mesh.rotation.y = yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    o.colliders.forEach(c => { c.x = x + fx * c.off; c.z = z + fz * c.off; c.y = y; });
  }
  function removeCar(o) { scene.remove(o.mesh); o.colliders.forEach(c => { c.destroyed = true; c.blocksCar = false; }); }

  function begin(lot, slot, player) {
    const sh = lot.sh, b = slot.b, M = sh.mouth, g = lot.geo;
    const along = (b.x - M.x) * sh.nx + (b.z - M.z) * sh.nz;
    const Pa = { x: M.x + sh.nx * along, z: M.z + sh.nz * along };
    // the way in: a car comes along the street in the kerb lane, slows, and turns in at the mouth. With no street found it appears at the mouth.
    let route = [], start = { x: M.x, z: M.z }, yaw0 = yawOf(sh.nx, sh.nz);
    if (g) {
      const S0 = g.lanePt(-38), L1 = g.lanePt(-10);
      if (player && Math.hypot(S0.x - player.x, S0.z - player.z) < 60) return false;       // it would be seen appearing
      start = S0; yaw0 = yawOf(g.D.x, g.D.z);
      route.push({ x: L1.x, z: L1.z, sp: STREET });
      bezier(L1, g.D, M, g.n, 8, 10).forEach(p => route.push({ x: p.x, z: p.z, sp: TURN }));
    } else if (player && Math.hypot(M.x - player.x, M.z - player.z) < 28) return false;
    route.push({ x: Pa.x, z: Pa.z, sp: DRIVE }, { x: b.x, z: b.z, sp: DRIVE * 0.5, last: true });
    const car = makeCar(COLORS[Math.floor(rng() * COLORS.length)]);
    place(car, start.x, start.z, yaw0);
    const n = rng() < 0.3 ? 2 : 1;
    const people = []; for (let i = 0; i < n; i++) people.push({ a: pedestrians.createActor(), x: 0, z: 0, state: 'car', path: null, k: 0, wait: 0, off: (i - (n - 1) / 2) * 0.9 });
    slot.busy = true; active++; stats.arrived++;
    lot.vs.push({ lot, slot, b, M, Pa, car, people, phase: 'arrive', route, k: 0, t: 0, door: { x: sh.door.x, z: sh.door.z } });
    return true;
  }

  // move the car toward a target at a speed (negative speed = reverse, heading kept); returns true on arrival
  function driveTo(v, tx, tz, speed, dt, steer = true) {
    const c = v.car, dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    if (steer && d > 0.05) c.yaw = turnTo(c.yaw, yawOf(dx, dz), dt * 6);
    const step = Math.abs(speed) * dt;
    if (d <= step) { place(c, tx, tz, c.yaw); return true; }
    const dir = Math.sign(speed);
    const hx = steer ? dx / d : Math.sin(c.yaw) * dir, hz = steer ? dz / d : Math.cos(c.yaw) * dir;
    place(c, c.x + hx * step, c.z + hz * step, c.yaw);
    return false;
  }
  const walkTo = (p, tx, tz, dt, h) => {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), step = WALK * dt;
    if (d <= step) { p.x = tx; p.z = tz; return true; }
    p.x += dx / d * step; p.z += dz / d * step;
    p.yaw = turnTo(p.yaw ?? yawOf(dx, dz), yawOf(dx, dz), dt * 8);
    return false;
  };
  const show = (p, dt, moving) => p.a.set(p.x, heightAt ? heightAt(p.x, p.z, 0) : 0, p.z, p.yaw || 0, moving, dt);

  // is another car of this lot just ahead of `v` (so it waits its turn at the mouth / in the alley)?
  function blockedAhead(v) {
    const c = v.car, fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    for (const o of v.lot.vs) { if (o === v) continue; const dx = o.car.x - c.x, dz = o.car.z - c.z, d = Math.hypot(dx, dz); if (d < 6 && (dx * fx + dz * fz) / (d || 1) > 0.35) return true; }
    return false;
  }
  function follow(v, dt) {       // along v.route; returns true when the last point is reached
    const r = v.route[v.k];
    if (blockedAhead(v)) return false;
    if (driveTo(v, r.x, r.z, r.sp, dt)) { v.k++; return v.k >= v.route.length; }
    return false;
  }
  function step(lot, v, dt) {
    const c = v.car, sh = lot.sh, g = lot.geo;
    if (c.crashTimer > 0) { c.crashTimer -= dt; return; }      // got bumped: stands there for a moment
    const bay = v.b;
    if (v.phase === 'arrive') {
      if (follow(v, dt)) { place(c, bay.x, bay.z, yawOf(bay.fx, bay.fz)); v.phase = 'park'; v.t = 1.1; }
    } else if (v.phase === 'park') {
      v.t -= dt;
      if (v.t <= 0) {
        v.phase = 'shopping';
        v.people.forEach(p => { p.x = bay.x + bay.nx * 1.5 + bay.ux * bay.side * 0.0 + p.off * bay.ux; p.z = bay.z + bay.nz * 1.5 + p.off * bay.uz; p.yaw = yawOf(bay.nx, bay.nz); p.state = 'toDoor'; p.k = 0; p.path = [[v.Pa.x + p.off * bay.ux, v.Pa.z + p.off * bay.uz], [v.door.x, v.door.z]]; });
      }
    } else if (v.phase === 'shopping') {
      let all = true;
      v.people.forEach(p => {
        if (p.state === 'toDoor') {
          all = false;
          const t = p.path[p.k];
          if (walkTo(p, t[0], t[1], dt)) { if (++p.k >= p.path.length) { p.state = 'inside'; p.wait = 10 + rng() * 40; p.a.hide(); stats.entered++; } }
          else show(p, dt, true);
        } else if (p.state === 'inside') {
          all = false; p.wait -= dt;
          if (p.wait <= 0) { p.state = 'toCar'; p.x = v.door.x; p.z = v.door.z; p.k = 0; p.path = [[v.Pa.x + p.off * bay.ux, v.Pa.z + p.off * bay.uz], [bay.x + bay.nx * 1.5 + p.off * bay.ux, bay.z + bay.nz * 1.5 + p.off * bay.uz]]; }
        } else if (p.state === 'toCar') {
          all = false;
          const t = p.path[p.k];
          if (walkTo(p, t[0], t[1], dt)) { if (++p.k >= p.path.length) { p.state = 'incar'; p.a.hide(); } } else show(p, dt, true);
        }
      });
      if (all) { v.phase = 'reverse'; }
    } else if (v.phase === 'reverse') {
      if (driveTo(v, v.Pa.x, v.Pa.z, -REVERSE, dt, false)) {
        // the way out: down the alley to the STOP line, wait for a gap, then a right turn onto the kerb lane and away
        v.phase = 'toStop'; v.route = [];
        if (g) {
          const Tc = { x: g.T.x + g.n.x * 2.2, z: g.T.z + g.n.z * 2.2 };
          v.route.push({ x: Tc.x, z: Tc.z, sp: DRIVE }); v.stopAt = Tc;
        } else v.route.push({ x: v.M.x, z: v.M.z, sp: DRIVE });
        v.k = 0;
      }
    } else if (v.phase === 'toStop') {
      if (follow(v, dt)) { if (g) { v.phase = 'stop'; v.t = 1.6 + rng() * 1.4; stats.stopped = (stats.stopped || 0) + 1; } else v.phase = 'gone'; }
    } else if (v.phase === 'stop') {
      v.t -= dt;
      if (v.t > 0) return;
      if (busy && busy(g.M.x, g.M.z, 20, g)) { v.t = 0.3; return; }      // not while a car is coming along the street
      const ahead = g.lanePt(12), res = reserve ? reserve(g.edge, g.D, ahead.x, ahead.z, c.color) : null;
      v.res = res; v.route = [];
      const tgt = res || { x: g.lanePt(30).x, z: g.lanePt(30).z, hx: g.D.x, hz: g.D.z };
      const from = v.stopAt;
      v.route.push({ x: g.M.x, z: g.M.z, sp: TURN });
      bezier(g.M, { x: -g.n.x, z: -g.n.z }, tgt, { x: tgt.hx, z: tgt.hz }, 8, 10).forEach((p, i, arr) => v.route.push({ x: p.x, z: p.z, sp: TURN + i * 0.4 }));
      v.k = 0; v.phase = 'pullout';
    } else if (v.phase === 'pullout') {
      if (follow(v, dt)) {
        if (v.res && release) { release(v.res.car, 4.5); stats.joined = (stats.joined || 0) + 1; }
        else if (!v.res && adopt && adopt(c.x, c.z, g.D.x, g.D.z, c.color)) stats.joined = (stats.joined || 0) + 1;
        v.phase = 'gone';
      }
    }
    if (v.phase === 'gone') {
      removeCar(c); v.people.forEach(p => p.a.dispose()); v.slot.busy = false; lot.vs.splice(lot.vs.indexOf(v), 1); active--; stats.left++;
      lot.timer = (sh.market ? 6 : 14) + rng() * (sh.market ? 18 : 40);
    }
  }
  function update(dt, player, hour = 12) {
    for (const lot of lots) {
      for (const v of lot.vs.slice()) step(lot, v, dt);
      const M = lot.sh.mouth, d = player ? Math.hypot(M.x - player.x, M.z - player.z) : 0;
      if (d > 240) continue;
      lot.timer -= dt;
      if (lot.timer > 0 || active >= MAX_ACTIVE || lot.vs.length >= lot.cap || !isOpen(lot.sh, hour)) continue;
      const slot = lot.free.find(s => !s.busy);
      if (!slot) { lot.timer = 8; continue; }
      if (!begin(lot, slot, player)) lot.timer = 3;
      else lot.timer = (lot.sh.market ? 5 : 12) + rng() * (lot.sh.market ? 14 : 30);
    }
  }
  return { update, stats, lots, get active() { return active; } };
}
