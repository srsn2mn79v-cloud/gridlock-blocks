// Parked cars start as cheap instanced meshes with a static collider. When the player comes close one
// is "woken": lifted out of the instanced mesh, given a real car body, circle colliders and free
// physics (slides, spins, hops, tumbles), so it can be shoved and crashed like an AI car.
import * as THREE from 'three';
import { buildCarBody } from './vehicleModels.js';
import { bodyLift } from './bodyLift.js';

const MASS = { wagon: 1400, suv: 2000, rally: 1200, roadster: 1150, supercar: 1350, hyper: 1450, hatch: 1050, sport: 1250, muscle: 1700, pickup: 2100, van: 2300, taxi: 1400 };
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function createParkedCars({ scene, propInstances, handles, collisionWorld, heightAt, events }) {
  const items = propInstances.filter(p => p.type === 'parkedcar' && p.rec);
  const cell = 24, grid = new Map();
  items.forEach(it => { const k = Math.floor(it.x / cell) + ',' + Math.floor(it.z / cell); (grid.get(k) || grid.set(k, []).get(k)).push(it); });
  const colliderOf = new Map(); collisionWorld.forEach(c => { if (c.kind === 'prop' && c.instance && c.instance.type === 'parkedcar') colliderOf.set(c.instance, c); });
  const awake = [];

  function wake(it) {
    if (it.awake) return; it.awake = true;
    const rec = it.rec;
    const st = colliderOf.get(it); if (st) { st.destroyed = true; st.blocksCar = false; }
    (handles && handles.get(rec) || []).forEach(([im, i]) => { im.setMatrixAt(i, ZERO); im.instanceMatrix.needsUpdate = true; });
    const mesh = buildCarBody(rec.style, rec.color); mesh.rotation.order = 'YXZ';
    const d = mesh.userData.dims || { len: 3.6, wid: 1.8 };
    mesh.position.set(rec.x, rec.y || 0.02, rec.z); mesh.rotation.y = rec.heading;
    scene.add(mesh);
    const off = Math.max(0.6, d.len / 2 - 1.0);
    const colliders = [off, 0, -off].map(o => ({ kind: 'traffic', x: rec.x, z: rec.z, radius: 0.95, off: o, blocksCar: true, destructible: false, destroyed: false, ref: null }));
    const o = { mesh, colliders, len: d.len, wid: d.wid, height: d.height || 1.5, mass: MASS[rec.style] || 1300, crashTimer: 0, hdg: 0,
      knock: { x: rec.x, z: rec.z, y: rec.y || 0.02, yaw: rec.heading, vx: 0, vz: 0, vy: 0, wy: 0, wr: 0, wp: 0, roll: 0, pitch: 0, air: false, restRoll: 0, age: 0 } };
    o.getVelocity = () => ({ x: o.knock.vx, z: o.knock.vz });
    o.applyImpact = (vx, vz, spin, dv, sideSign) => {
      const k = o.knock; k.vx = vx; k.vz = vz; k.wy += spin;
      if (dv > 4.5) { const e = dv - 4.5; k.vy = Math.min(5.5, e * 0.4); k.air = true; k.wr += sideSign * Math.min(4, e * 0.22); k.wp += (Math.random() - 0.5) * Math.min(2.5, e * 0.12); }
      if (events && dv > 1.2) events.push({ t: 'crash', x: k.x, z: k.z, power: Math.min(1, dv / 8) });
    };
    colliders.forEach(c => { c.ref = o; });
    collisionWorld.push(...colliders);
    sync(o); awake.push(o);
  }
  function sync(o) {
    const k = o.knock, fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    o.colliders.forEach(c => { c.x = k.x + fx * c.off; c.z = k.z + fz * c.off; c.y = o.mesh.position.y; });
  }
  function step(o, dt) {
    const k = o.knock; k.age += dt;
    const sp = Math.hypot(k.vx, k.vz);
    if (sp > 0.01) { const dec = Math.min(sp, 6 * dt); k.vx -= k.vx / sp * dec; k.vz -= k.vz / sp * dec; } else { k.vx = k.vz = 0; }
    if (sp < 0.01 && !k.air && Math.abs(k.wy) < 0.01 && Math.abs(k.vy) < 0.01 && Math.abs(k.roll - k.restRoll) < 0.005) return;   // asleep
    k.x += k.vx * dt; k.z += k.vz * dt; k.yaw += k.wy * dt; k.wy *= Math.exp(-1.8 * dt);
    const ground = heightAt ? heightAt(k.x, k.z, k.y) : 0;
    k.vy -= 22 * dt; k.y += k.vy * dt;
    if (k.y <= ground) {
      k.y = ground;
      if (k.air) { k.air = false; k.restRoll = Math.abs(k.roll) > 1.0 ? Math.sign(k.roll) * 1.5 : 0; }
      if (k.vy < -3) { k.vy = -k.vy * 0.25; k.air = true; } else k.vy = 0;
    } else k.air = true;
    if (k.air) { k.roll += k.wr * dt; k.pitch += k.wp * dt; }
    else { const e = Math.min(1, dt * 7); k.roll += (k.restRoll - k.roll) * e; k.pitch += (0 - k.pitch) * e; k.wr *= Math.exp(-6 * dt); k.wp *= Math.exp(-6 * dt); }
    o.mesh.position.set(k.x, k.y + bodyLift(k.pitch, k.roll, o.wid / 2, o.height, o.len / 2), k.z);
    o.mesh.rotation.set(k.pitch, k.yaw, k.roll);
    sync(o);
  }
  function update(dt, px, pz) {
    const cx = Math.floor(px / cell), cz = Math.floor(pz / cell);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      const list = grid.get(i + ',' + j); if (!list) continue;
      for (const it of list) if (!it.awake && Math.abs(it.x - px) < 9 && Math.abs(it.z - pz) < 9) wake(it);
    }
    awake.forEach(o => step(o, dt));
  }
  return { update, awake, wake };
}
