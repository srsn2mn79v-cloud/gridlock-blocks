// Water jets from broken hydrants: a fountain of droplets that arcs up, falls back and lasts ~12 s.
import * as THREE from 'three';

export function createSprays(scene) {
  const jets = [];
  const N = 70;
  const mat = new THREE.PointsMaterial({ color: 0xcfe9ff, size: 0.35, transparent: true, opacity: 0.85, depthWrite: false });
  mat.userData = { snow: { skip: true } };
  function add(x, y, z) {
    const pos = new Float32Array(N * 3), vel = [], age = [];
    for (let i = 0; i < N; i++) {
      const a = Math.random() * 6.283, s = Math.random() * 1.6;
      vel.push([Math.cos(a) * s, 9 + Math.random() * 5, Math.sin(a) * s]); age.push(Math.random() * 1.4);
      pos.set([x, y, z], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
    jets.push({ pts, pos, vel, age, x, y, z, t: 0 });
    while (jets.length > 6) { const o = jets.shift(); scene.remove(o.pts); o.pts.geometry.dispose(); }
  }
  function update(dt) {
    for (let k = jets.length - 1; k >= 0; k--) {
      const j = jets[k]; j.t += dt;
      if (j.t > 12) { scene.remove(j.pts); j.pts.geometry.dispose(); jets.splice(k, 1); continue; }
      const fade = j.t > 9 ? Math.max(0, 1 - (j.t - 9) / 3) : 1;
      for (let i = 0; i < N; i++) {
        const v = j.vel[i]; j.age[i] += dt;
        v[1] -= 22 * dt;
        let px = j.pos[i * 3] + v[0] * dt, py = j.pos[i * 3 + 1] + v[1] * dt, pz = j.pos[i * 3 + 2] + v[2] * dt;
        if (py < j.y || j.age[i] > 2.2) { const a = Math.random() * 6.283, s = Math.random() * 1.6 * fade; px = j.x; py = j.y; pz = j.z; v[0] = Math.cos(a) * s; v[1] = (9 + Math.random() * 5) * (0.3 + 0.7 * fade); v[2] = Math.sin(a) * s; j.age[i] = 0; }
        j.pos[i * 3] = px; j.pos[i * 3 + 1] = py; j.pos[i * 3 + 2] = pz;
      }
      j.pts.geometry.attributes.position.needsUpdate = true;
    }
  }
  return { add, update };
}
