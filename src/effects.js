// Lightweight stand-ins for "destruction" — no physics engine, just enough motion to
// sell a hit. knockdown() tips a prop's existing mesh over in place; spawnDebris()
// hides the original and pops a few simple chunks outward with gravity. Call
// updateEffects(dt) once per frame from the render loop to advance both.
import * as THREE from 'three';

const active = [];

export function knockdown(mesh, awayX, awayZ) {
  const sign = Math.atan2(awayZ, awayX) >= 0 ? 1 : -1;
  active.push({ type: 'knockdown', mesh, t: 0, duration: 0.35, sign });
}

export function spawnDebris(scene, x, y, z, color, count = 5) {
  for (let i = 0; i < count; i++) {
    const chunk = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 0.22),
      new THREE.MeshStandardMaterial({ color: color || 0x8893a1 })
    );
    chunk.position.set(x, y, z);
    chunk.castShadow = true;
    scene.add(chunk);
    const angle = Math.random() * Math.PI * 2;
    active.push({
      type: 'debris', mesh: chunk, scene, t: 0, duration: 1.4,
      vx: Math.cos(angle) * (2 + Math.random() * 2),
      vz: Math.sin(angle) * (2 + Math.random() * 2),
      vy: 4 + Math.random() * 2
    });
  }
}

// A bush bursting: green leaves flutter down while brown twigs fly out and drop.
const LEAF_GEO = new THREE.PlaneGeometry(0.28, 0.2), TWIG_GEO = new THREE.BoxGeometry(0.05, 0.05, 0.55);
const LEAF_MATS = [0x2f7a3c, 0x3f9a4c, 0x5bb15a, 0x24602f].map(c => new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, flatShading: true }));
const TWIG_MAT = new THREE.MeshStandardMaterial({ color: 0x6b4a2b });
export function spawnLeaves(scene, x, y, z, dirx = 0, dirz = 0, speed = 6) {
  const push = Math.min(1, speed / 14);
  for (let i = 0; i < 34; i++) {
    const twig = i < 8, m = new THREE.Mesh(twig ? TWIG_GEO : LEAF_GEO, twig ? TWIG_MAT : LEAF_MATS[i % LEAF_MATS.length]);
    m.position.set(x + (Math.random() - 0.5) * 0.8, y + 0.2 + Math.random() * 0.7, z + (Math.random() - 0.5) * 0.8);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    scene.add(m);
    const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3;
    active.push({
      type: 'leaf', mesh: m, scene, twig, t: 0, duration: twig ? 1.6 : 2.6 + Math.random() * 1.2,
      vx: Math.cos(a) * s + dirx * push * 5, vz: Math.sin(a) * s + dirz * push * 5, vy: (twig ? 3 : 2) + Math.random() * 3,
      spin: [(Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8], phase: Math.random() * 6
    });
  }
}

export function updateEffects(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const e = active[i];
    e.t += dt;
    if (e.type === 'knockdown') {
      const t = Math.min(1, e.t / e.duration);
      e.mesh.rotation.z = (Math.PI / 2) * t * e.sign;
      if (t >= 1) active.splice(i, 1);
    } else if (e.type === 'leaf') {
      // leaves drift (low gravity, drag, sway); twigs drop like sticks
      const g = e.twig ? 9.8 : 3.2, drag = e.twig ? 0.4 : 2.2;
      e.vy -= g * dt; if (!e.twig && e.vy < -1.4) e.vy = -1.4;
      e.vx *= Math.exp(-drag * dt); e.vz *= Math.exp(-drag * dt);
      e.mesh.position.x += (e.vx + (e.twig ? 0 : Math.sin(e.t * 5 + e.phase) * 0.6)) * dt;
      e.mesh.position.y += e.vy * dt;
      e.mesh.position.z += e.vz * dt;
      e.mesh.rotation.x += e.spin[0] * dt; e.mesh.rotation.y += e.spin[1] * dt; e.mesh.rotation.z += e.spin[2] * dt;
      if (e.mesh.position.y <= 0.05 || e.t >= e.duration) { e.mesh.position.y = Math.max(0.05, e.mesh.position.y); if (e.t >= e.duration + (e.twig ? 0 : 3) || e.mesh.position.y <= 0.05) { e.scene.remove(e.mesh); active.splice(i, 1); } }
    } else {
      e.vy -= 9.8 * dt;
      e.mesh.position.x += e.vx * dt;
      e.mesh.position.y += e.vy * dt;
      e.mesh.position.z += e.vz * dt;
      e.mesh.rotation.x += dt * 4;
      if (e.mesh.position.y <= 0.1 || e.t >= e.duration) {
        e.scene.remove(e.mesh);
        active.splice(i, 1);
      }
    }
  }
}
