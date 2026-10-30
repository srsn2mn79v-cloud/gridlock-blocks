// Shop car parks come alive: now and then a car turns in from the street, drives down the alley, noses into a free bay, its driver gets
// out and walks to the shop door and goes in; a while later they come back out, get in, and the car reverses out and drives off.
// Visitors only start while the player is within ~240 u (and not right at the mouth of the alley, where they would pop into view).
// The cars are solid like any AI car (traffic-kind colliders, see collision.js hitVehicle); a car that gets hit stops for a few seconds.
import * as THREE from 'three';
import { buildCarBody, parkedCarStyle } from './vehicleModels.js';

const COLORS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0xecf0f1, 0x2c3e50, 0x7f8c8d, 0xd35400, 0x8e44ad, 0x1abc9c, 0xbdc3c7, 0x34495e];
const MAX_ACTIVE = 12, DRIVE = 4.2, REVERSE = 2.2, WALK = 1.1;

export function createShopLots({ scene, cityData, collisionWorld, heightAt, pedestrians, adopt = null, rng = Math.random }) {
  const lots = [...(cityData.shops || []), ...(cityData.stations || []).filter(q => q.market)].filter(sh => sh.bays && sh.mouth && sh.door).map(sh => ({
    sh, free: sh.bays.filter(b => !b.taken).map(b => ({ b, busy: false })), timer: 3 + rng() * 25, v: null
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
    const sh = lot.sh, b = slot.b, M = sh.mouth;
    const along = (b.x - M.x) * sh.nx + (b.z - M.z) * sh.nz;
    const Pa = { x: M.x + sh.nx * along, z: M.z + sh.nz * along };
    const car = makeCar(COLORS[Math.floor(rng() * COLORS.length)]);
    place(car, M.x, M.z, yawOf(sh.nx, sh.nz));
    const n = rng() < 0.3 ? 2 : 1;
    const people = []; for (let i = 0; i < n; i++) people.push({ a: pedestrians.createActor(), x: 0, z: 0, state: 'car', path: null, k: 0, wait: 0, off: (i - (n - 1) / 2) * 0.9 });
    slot.busy = true; active++; stats.arrived++;
    lot.v = { slot, b, M, Pa, car, people, phase: 'arrive', seg: 0, t: 0, door: { x: sh.door.x, z: sh.door.z } };
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

  function step(lot, dt) {
    const v = lot.v, c = v.car;
    if (c.crashTimer > 0) { c.crashTimer -= dt; return; }      // got bumped: stands there for a moment
    const bay = v.b;
    if (v.phase === 'arrive') {
      const slowNear = Math.hypot(c.x - v.Pa.x, c.z - v.Pa.z) < 3 ? 0.45 : 1;
      if (v.seg === 0) { if (driveTo(v, v.Pa.x, v.Pa.z, DRIVE * slowNear, dt)) v.seg = 1; }
      else if (driveTo(v, bay.x, bay.z, DRIVE * 0.5, dt)) { place(c, bay.x, bay.z, yawOf(bay.fx, bay.fz)); v.phase = 'park'; v.t = 1.1; }
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
      if (driveTo(v, v.Pa.x, v.Pa.z, -REVERSE, dt, false)) v.phase = 'leave';
    } else if (v.phase === 'leave') {
      if (driveTo(v, v.M.x, v.M.z, DRIVE, dt)) { if (adopt && adopt(v.M.x, v.M.z, -lot.sh.nx, -lot.sh.nz, c.color)) stats.joined = (stats.joined || 0) + 1; removeCar(c); v.people.forEach(p => p.a.dispose()); v.slot.busy = false; lot.v = null; active--; stats.left++; lot.timer = 20 + rng() * 50; }
    }
  }
  function update(dt, player) {
    for (const lot of lots) {
      if (lot.v) { step(lot, dt); continue; }
      const M = lot.sh.mouth, d = player ? Math.hypot(M.x - player.x, M.z - player.z) : 0;
      if (d > 240) continue;
      lot.timer -= dt;
      if (lot.timer > 0 || d < 28 || active >= MAX_ACTIVE) continue;
      const slot = lot.free.find(s => !s.busy);
      if (!slot) { lot.timer = 15; continue; }
      begin(lot, slot, player);
    }
  }
  return { update, stats, lots, get active() { return active; } };
}
