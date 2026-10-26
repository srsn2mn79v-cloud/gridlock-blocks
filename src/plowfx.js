// Snowplough effects: a spray of snow thrown off the blade to the plough's right, and salt grains spun out behind it.
// Two small point pools (one draw call each); only ploughs near the camera emit.
import * as THREE from 'three';

function dot() {
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c);
}
function pool(n, color, size, scene) {
  const pos = new Float32Array(n * 3), geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size, map: dot(), transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  for (let i = 0; i < n; i++) pos[i * 3 + 1] = -999;
  return { n, pos, geo, vel: new Float32Array(n * 3), life: new Float32Array(n), next: 0 };
}
export function createPlowFx(scene) {
  const snow = pool(360, 0xf4f8ff, 0.5, scene), salt = pool(260, 0xe6e2d8, 0.16, scene);
  const emit = (P, x, y, z, vx, vy, vz, life) => {
    const i = P.next; P.next = (P.next + 1) % P.n;
    P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z; P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz; P.life[i] = life;
  };
  const step = (P, dt, grav, drag) => {
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) continue;
      P.life[i] -= dt;
      if (P.life[i] <= 0) { P.pos[i * 3 + 1] = -999; continue; }
      P.vel[i * 3 + 1] -= grav * dt; const k = Math.max(0, 1 - drag * dt); P.vel[i * 3] *= k; P.vel[i * 3 + 2] *= k;
      P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      if (P.pos[i * 3 + 1] < 0.04) { P.pos[i * 3 + 1] = 0.04; P.vel[i * 3 + 1] = 0; P.vel[i * 3] *= 0.2; P.vel[i * 3 + 2] *= 0.2; }
    }
    P.geo.attributes.position.needsUpdate = true;
  };
  let acc = 0;
  return {
    // plows: [{ mesh, speed, len, wid }] that are out and working; cam: camera position (only nearby ones emit)
    update(dt, plows, cam, snowing) {
      acc += dt;
      const rate = 1 / 60;
      while (acc > rate) {
        acc -= rate;
        plows.forEach(c => {
          const m = c.mesh.position; if (Math.hypot(m.x - cam.x, m.z - cam.z) > 110 || c.speed < 0.8) return;
          const h = c.mesh.rotation.y, fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h), L = c.len / 2;
          const sp = Math.min(1, c.speed / 5);
          // blade spray: leaves the right-hand end of the blade, thrown out to the right and forward a little
          if (snowing) for (let k = 0; k < 2; k++) {
            const bx = m.x + fx * (L + 0.5) + rx * (0.8 + Math.random() * 0.6), bz = m.z + fz * (L + 0.5) + rz * (0.8 + Math.random() * 0.6);
            const out = (3.5 + Math.random() * 3.5) * sp;
            emit(snow, bx, m.y + 0.3 + Math.random() * 0.4, bz, rx * out + fx * c.speed * 0.5 * 1.0, 1.2 + Math.random() * 2.2, rz * out + fz * c.speed * 0.5, 0.7 + Math.random() * 0.6);
          }
          // salt: tossed backwards and sideways off the spinner at the tail
          for (let k = 0; k < 3; k++) {
            const sx = m.x - fx * (L + 0.5), sz = m.z - fz * (L + 0.5), a = (Math.random() - 0.5) * 2.4, sd = 2 + Math.random() * 3;
            emit(salt, sx, m.y + 0.55, sz, (-fx * 2.5 + rx * a * sd) , 1.2 + Math.random() * 1.5, (-fz * 2.5 + rz * a * sd), 0.5 + Math.random() * 0.5);
          }
        });
      }
      step(snow, dt, 11, 1.2); step(salt, dt, 14, 0.8);
    }
  };
}
