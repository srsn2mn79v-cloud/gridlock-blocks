// What happens to things the car breaks: poles and signs topple the way they were hit, traffic
// lights shatter into pieces, and whatever ends up on the road stays there as debris you have
// to deal with — thin things (poles, signs, mast arms) are driven over at a small cost in
// speed, compact heavy things (signal heads, benches) are shoved along ahead of the car.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const MAX_LYING = 90;
const CAR_R = 1.1;

export function createDestruction(scene) {
  const moving = [];   // toppling props and flying pieces
  const lying = [];    // settled debris that still interacts with the car

  const unitDir = (dx, dz) => { const l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; };

  function addLying(d) {
    lying.push(d);
    while (lying.length > MAX_LYING) { const old = lying.shift(); scene.remove(old.obj); }
  }

  // A whole prop (lamp, sign, bench) tips over about its base, away from where it was hit.
  // hit = { speed, carMass, mass }: a fast hit on a light thing throws it along the way the car was heading (lighter = further and more tumbling);
  // slow hits, or no hit data, just tip it over.
  function topple(mesh, dx, dz, fall = {}, hit = null) {
    const d = unitDir(dx, dz);
    if (hit && hit.speed > 4) {
      const m = hit.mass || 50, cm = hit.carMass || 1300, ratio = cm / (cm + 3 * m);
      const vh = Math.min(30, hit.speed * 0.8 * ratio);                    // sideways launch speed (u/s)
      const vy = Math.max(1.5, Math.min(9, vh * 0.45));
      const T = 2 * vy / 22;
      mesh.updateMatrixWorld(true);
      moving.push({
        type: 'launch', obj: mesh, fall, d, baseQ: mesh.quaternion.clone(), axis: new THREE.Vector3(d.z, 0, -d.x),
        y0: mesh.position.y, t: 0, T, vx: d.x * vh, vz: d.z * vh, vy, landed: false, slide: 0,
        spins: m < 40 ? Math.round(vh / 7) : m < 120 ? Math.round(vh / 14) : 0       // whole tumbles in the air before it ends up lying
      });
      return;
    }
    mesh.updateMatrixWorld(true);
    const wp = new THREE.Vector3(); mesh.getWorldPosition(wp);
    moving.push({
      type: 'topple', obj: mesh, fall, d,
      baseQ: mesh.quaternion.clone(),
      axis: new THREE.Vector3(d.z, 0, -d.x),
      y0: mesh.position.y, t: 0, dur: 0.55 + (fall.len || 2) * 0.08
    });
  }

  // Traffic light: it snaps off at the base and the pieces fly (only a base plate stays).
  function breakTrafficLight(mesh, dx, dz, speed = 10) {
    const d = unitDir(dx, dz);
    const parts = mesh.userData.parts;
    if (!parts) return topple(mesh, dx, dz, { len: 5.8, kind: 'drive', penalty: 0.1, lift: 0.15 });
    mesh.updateMatrixWorld(true);
    const v = Math.min(14, Math.abs(speed));
    const specs = {
      lower: { rest: 0.15, push: 0.2, up: 1.6, kind: 'drive', len: 2.8, axis: 'y', penalty: 0.08 },
      upper: { rest: 0.14, push: 0.25, up: 2.5, kind: 'drive', len: 2.9, axis: 'y', penalty: 0.08 },
      arm:   { rest: 0.1,  push: 0.55, up: 3.5, kind: 'drive', len: 3.0, axis: 'x', penalty: 0.05 },
      head:  { rest: 0.3,  push: 0.7,  up: 4.0, kind: 'push', radius: 0.85, mass: 0.35, axis: 'y' },
      ped:   { rest: 0.15, push: 0.8,  up: 3.0, kind: 'push', radius: 0.4, mass: 0.1, axis: 'x' }
    };
    Object.entries(parts).forEach(([name, obj]) => {
      const sp = specs[name.replace(/\d+$/, '')]; if (!sp) return;
      scene.attach(obj);
      const spread = (Math.random() - 0.5) * 0.9;
      const dirx = d.x * Math.cos(spread) - d.z * Math.sin(spread), dirz = d.x * Math.sin(spread) + d.z * Math.cos(spread);
      const sp0 = (1 + v * sp.push * 0.5) * (0.7 + Math.random() * 0.6);
      const qStart = obj.quaternion.clone();
      let qEnd;
      const hAng = Math.atan2(dirz, dirx) + (Math.random() - 0.5) * 0.8;
      const h = new THREE.Vector3(Math.cos(hAng), 0, Math.sin(hAng));
      if (sp.axis === 'y') {
        qEnd = new THREE.Quaternion().setFromUnitVectors(UP, h)
          .multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * 6.28));
      } else {
        const yaw = new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * 6.28);
        qEnd = yaw.multiply(qStart.clone());
        if (sp.kind === 'push') qEnd.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      }
      moving.push({
        type: 'piece', obj, sp, qStart, qEnd, t: 0, rotT: 0.6 + Math.random() * 0.3,
        vx: dirx * sp0, vz: dirz * sp0, vy: sp.up * (0.6 + Math.random() * 0.6) + v * 0.1
      });
    });
    mesh.userData.parts = null;
  }

  function settle(m) {
    const o = m.obj;
    if (m.type === 'topple') {
      const f = m.fall;
      if (f.kind === 'push') addLying({ obj: o, kind: 'push', mass: f.mass || 0.6, circles: [{ x: o.position.x + m.d.x * (f.len || 1) * 0.4, z: o.position.z + m.d.z * (f.len || 1) * 0.4, r: f.radius || 0.8 }], vx: 0, vz: 0, cooldown: 0 });
      else {
        const circles = [];
        for (let t = 0.3; t <= (f.len || 2); t += 0.55) circles.push({ x: o.position.x + m.d.x * t, z: o.position.z + m.d.z * t, r: 0.3 });
        addLying({ obj: o, kind: 'drive', penalty: f.penalty || 0.06, circles, cooldown: 0 });
      }
    } else {
      const sp = m.sp;
      if (sp.kind === 'push') addLying({ obj: o, kind: 'push', mass: sp.mass, circles: [{ x: o.position.x, z: o.position.z, r: sp.radius }], vx: 0, vz: 0, cooldown: 0 });
      else {
        const ax = sp.axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        ax.applyQuaternion(o.quaternion); ax.y = 0; ax.normalize();
        const circles = [];
        for (let t = -sp.len / 2 + 0.3; t <= sp.len / 2 - 0.2; t += 0.6) circles.push({ x: o.position.x + ax.x * t, z: o.position.z + ax.z * t, r: 0.3 });
        addLying({ obj: o, kind: 'drive', penalty: sp.penalty, circles, cooldown: 0 });
      }
    }
  }

  const _q = new THREE.Quaternion();
  // car footprint as an oriented box (half-length 1.9, half-width 1.05, 1.5 tall)
  function carFrame(car) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    return { x: car.x, z: car.z, fx, fz, rx: fz, rz: -fx, vx: fx * car.speed, vz: fz * car.speed };
  }
  function update(dt, car) {
    const cf = car ? carFrame(car) : null;
    for (let i = moving.length - 1; i >= 0; i--) {
      const m = moving[i];
      // a pole still tipping over through the car's body: let it drop fast instead of passing through
      if (cf && m.type === 'topple') {
        const L = m.fall.len || 2, ang = (Math.PI / 2 - 0.05) * Math.min(1, m.t / m.dur) ** 2;
        for (let f = 0.15; f <= 1; f += 0.17) {
          const dx = m.obj.position.x + m.d.x * L * f * Math.sin(ang) - cf.x, dz = m.obj.position.z + m.d.z * L * f * Math.sin(ang) - cf.z;
          if (Math.abs(dx * cf.fx + dz * cf.fz) < 2.0 && Math.abs(dx * cf.rx + dz * cf.rz) < 1.15 && L * f * Math.cos(ang) < 1.6 && L * f * Math.cos(ang) > 0.3) { m.t += dt * 3; break; }
        }
      }
      m.t += dt;
      const o = m.obj;
      if (m.type === 'launch') {
        if (!m.landed) {
          m.vy -= 22 * dt; o.position.x += m.vx * dt; o.position.z += m.vz * dt; o.position.y += m.vy * dt;
          const p = Math.min(1, m.t / m.T);
          _q.setFromAxisAngle(m.axis, (Math.PI / 2 - 0.05 + m.spins * Math.PI * 2) * p);
          o.quaternion.copy(_q).multiply(m.baseQ);
          if (m.t >= m.T) { m.landed = true; o.position.y = m.y0 + (m.fall.lift ?? 0.1); m.vx *= 0.6; m.vz *= 0.6; }
        } else {                                                           // slides to a stop where it lands
          const f = Math.exp(-2.8 * dt); m.vx *= f; m.vz *= f; o.position.x += m.vx * dt; o.position.z += m.vz * dt; m.slide += dt;
          if (Math.hypot(m.vx, m.vz) < 0.3 || m.slide > 2) { moving.splice(i, 1); settle({ ...m, type: 'topple' }); }
        }
      } else if (m.type === 'topple') {
        const p = Math.min(1, m.t / m.dur);
        const e = p * p;
        const ang = (Math.PI / 2 - 0.05) * e;
        _q.setFromAxisAngle(m.axis, ang);
        o.quaternion.copy(_q).multiply(m.baseQ);
        o.position.y = m.y0 + (m.fall.lift ?? 0.1) * e;
        if (p >= 1) { moving.splice(i, 1); settle(m); }
      } else {
        m.vy -= 16 * dt;
        o.position.x += m.vx * dt; o.position.z += m.vz * dt; o.position.y += m.vy * dt;
        let grounded = false;
        if (o.position.y <= m.sp.rest) {
          o.position.y = m.sp.rest; grounded = true;
          if (m.vy < -1.5) m.vy = -m.vy * 0.3; else m.vy = 0;
          const f = Math.exp(-3.5 * dt); m.vx *= f; m.vz *= f;
        }
        if (cf && o.position.y < 1.6) {
          // flying pieces bounce off the car body instead of passing through it
          const R = m.sp.push > 0.5 ? 0.45 : 0.3;
          const dx = o.position.x - cf.x, dz = o.position.z - cf.z;
          const lf = dx * cf.fx + dz * cf.fz, lr = dx * cf.rx + dz * cf.rz;
          const pf = 1.9 + R - Math.abs(lf), pr = 1.05 + R - Math.abs(lr);
          if (pf > 0 && pr > 0) {
            if (pf < pr) { const s = Math.sign(lf) || 1; o.position.x += cf.fx * s * pf; o.position.z += cf.fz * s * pf; m.vx = cf.vx + cf.fx * s * 2.5 + (Math.random() - 0.5); m.vz = cf.vz + cf.fz * s * 2.5 + (Math.random() - 0.5); }
            else { const s = Math.sign(lr) || 1; o.position.x += cf.rx * s * pr; o.position.z += cf.rz * s * pr; m.vx = cf.vx * 0.6 + cf.rx * s * 3; m.vz = cf.vz * 0.6 + cf.rz * s * 3; }
            m.vy = Math.max(m.vy, 2.2);
          }
        }
        const p = Math.min(1, m.t / m.rotT);
        o.quaternion.slerpQuaternions(m.qStart, m.qEnd, p * p * (3 - 2 * p));
        if (grounded && p >= 1 && Math.hypot(m.vx, m.vz) < 0.25) { moving.splice(i, 1); settle(m); }
      }
    }

    if (!car) return;
    const sgn = Math.sign(car.speed) || 1;
    for (const d of lying) {
      d.cooldown = Math.max(0, d.cooldown - dt);
      if (d.kind === 'push') {
        d.vx *= Math.exp(-3 * dt); d.vz *= Math.exp(-3 * dt);
        const c = d.circles[0];
        let dx = c.x - car.x, dz = c.z - car.z, dist = Math.hypot(dx, dz);
        if (dist < c.r + CAR_R && Math.abs(car.speed) > 0.3) {
          if (dist < 0.01) { dx = Math.sin(car.heading) * sgn; dz = Math.cos(car.heading) * sgn; dist = 1; }
          const nx = dx / dist, nz = dz / dist;
          c.x = car.x + nx * (c.r + CAR_R); c.z = car.z + nz * (c.r + CAR_R);
          const push = Math.abs(car.speed) * 0.9;
          d.vx = nx * push; d.vz = nz * push;
          car.speed *= Math.max(0, 1 - 0.8 * d.mass * dt * 6 * (car.massFactor || 1));
          d.obj.rotation.y += (Math.random() - 0.5) * 0.05;
        }
        c.x += d.vx * dt; c.z += d.vz * dt;
        d.obj.position.x = c.x; d.obj.position.z = c.z;
      } else {
        let touching = false;
        for (const c of d.circles) {
          if (Math.hypot(c.x - car.x, c.z - car.z) < c.r + CAR_R * 0.8) { touching = true; break; }
        }
        if (touching && d.cooldown <= 0 && Math.abs(car.speed) > 1) {
          car.speed *= 1 - Math.min(0.9, d.penalty * (car.massFactor || 1));
          d.cooldown = 1.0;
        } else if (touching) d.cooldown = Math.max(d.cooldown, 0.2);
      }
    }
  }

  return { topple, breakTrafficLight, update, get lying() { return lying; } };
}
