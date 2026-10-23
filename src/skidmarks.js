// Tyre marks: dark streaks while the wheels slide on tarmac and two soft tracks when driving through
// settled snow. One shared ring buffer of quads (oldest overwritten); every mark fades over ~25 s.
import * as THREE from 'three';

const MAX = 1400, LIFE = 26;
export function createSkidMarks({ scene, heightAt }) {
  const pos = new Float32Array(MAX * 4 * 3), col = new Float32Array(MAX * 4 * 4), idx = new Uint32Array(MAX * 6);
  for (let i = 0; i < MAX; i++) { const v = i * 4; idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6); }
  const age = new Float32Array(MAX).fill(1e9), base = new Float32Array(MAX), tint = new Float32Array(MAX * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 2; scene.add(mesh);
  let head = 0, dirty = false, tick = 0, isSliding = false;
  const last = [null, null, null, null];     // previous edge points per wheel (null = the streak is broken)
  const HW = 0.17;                           // half width of a mark

  function put(i, ax, az, ay, bx, bz, by, dx, dz, a, kind) {
    const p = i * 12;
    pos.set([ax + dx, ay, az + dz, ax - dx, ay, az - dz, bx + dx, by, bz + dz, bx - dx, by, bz - dz], p);
    age[i] = 0; base[i] = a; tint[i * 3] = kind.r; tint[i * 3 + 1] = kind.g; tint[i * 3 + 2] = kind.b;
    dirty = true;
  }
  const DARK = { r: 0.03, g: 0.03, b: 0.035 }, SNOW = { r: 0.55, g: 0.6, b: 0.66 };

  function update(dt, car, { snow = 0, onFoot = false, allow = true } = {}) {
    // age + fade (colour alpha only touched a few times per second)
    tick += dt;
    if (tick > 0.25) {
      for (let i = 0; i < MAX; i++) {
        if (age[i] > LIFE) { if (age[i] < 1e8) { age[i] = 1e9; for (let k = 0; k < 4; k++) col[(i * 4 + k) * 4 + 3] = 0; dirty = true; } continue; }
        age[i] += tick;
        const f = Math.max(0, 1 - age[i] / LIFE), a = base[i] * f * Math.min(1, age[i] * 6 + 0.3);
        for (let k = 0; k < 4; k++) { const c = (i * 4 + k) * 4; col[c] = tint[i * 3]; col[c + 1] = tint[i * 3 + 1]; col[c + 2] = tint[i * 3 + 2]; col[c + 3] = a; }
      }
      tick = 0; dirty = true;
    }
    if (dirty) { geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; dirty = false; }

    const speed = Math.hypot(car.vx || 0, car.vz || 0);
    const h = car.heading, sh = Math.sin(h), ch = Math.cos(h);
    const side = Math.abs((car.vx || 0) * ch - (car.vz || 0) * sh);
    const onRoad = car.surface !== 'ground';
    const sliding = onRoad && !car.airborne && !onFoot && car.y > -1.5 && speed > 4 && (side > 2.6 || car.drifting && speed > 6);
    const braking = false;
    isSliding = !!(sliding && allow);
    const snowy = snow > 0.25 && onRoad && !car.airborne && !onFoot && speed > 1.5 && car.y > -1.5;
    if (!allow || (!sliding && !snowy && !braking)) { last.fill(null); return; }
    const strength = sliding ? Math.min(1, 0.45 + (side - 2.6) / 7) : Math.min(0.55, snow * 0.6);
    const kind = sliding ? DARK : SNOW;
    const wheels = sliding ? [[0.85, -1.25], [-0.85, -1.25], [0.85, 1.25], [-0.85, 1.25]] : [[0.85, -1.25], [-0.85, -1.25], [0.85, 1.25], [-0.85, 1.25]];
    for (let w = 0; w < 4; w++) {
      const [lx, lz] = wheels[w];
      const x = car.x + sh * lz + ch * lx, z = car.z + ch * lz - sh * lx;
      const y = heightAt(x, z, car.y) + 0.06;
      const pr = last[w];
      if (pr) {
        const dx = x - pr.x, dz = z - pr.z, l = Math.hypot(dx, dz);
        if (l > 0.35) {
          if (l < 3) {
            const nx = -dz / l * HW, nz = dx / l * HW;
            put(head, pr.x, pr.z, pr.y, x, z, y, nx, nz, strength, kind);
            head = (head + 1) % MAX;
          }
          last[w] = { x, z, y };
        }
      } else last[w] = { x, z, y };
    }
  }
  return { update, get sliding() { return isSliding; }, clear() { age.fill(1e9); col.fill(0); geo.attributes.color.needsUpdate = true; last.fill(null); } };
}
