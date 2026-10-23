import * as THREE from 'three';

export function buildCheckpoints(cityData) {
  const list = (cityData.gameplay || []).filter(g => g.type === 'checkpoint');
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffaa00, emissiveIntensity: 0.6 });
  return list.map((cp, i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.35, 10, 24), mat.clone());
    ring.position.set(cp.x, (cp.elevation || 0) + 2.2, cp.z);
    ring.rotation.y = Math.PI / 2;
    return { mesh: ring, x: cp.x, z: cp.z, hit: false, index: i };
  });
}

export function getSpawn(cityData) {
  const spawn = (cityData.gameplay || []).find(g => g.type === 'spawn');
  return spawn ? { x: spawn.x, z: spawn.z, heading: spawn.heading || 0 } : { x: 0, z: 0, heading: 0 };
}
