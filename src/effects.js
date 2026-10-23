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

export function updateEffects(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const e = active[i];
    e.t += dt;
    if (e.type === 'knockdown') {
      const t = Math.min(1, e.t / e.duration);
      e.mesh.rotation.z = (Math.PI / 2) * t * e.sign;
      if (t >= 1) active.splice(i, 1);
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
