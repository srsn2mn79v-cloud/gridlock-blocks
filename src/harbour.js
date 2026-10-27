// The harbour's boats: one moored in most slips, bobbing gently on the water. (The decks themselves are plaza parcels,
// see chicago.js `harbour`.)
import * as THREE from 'three';

export function createHarbour({ city, scene }) {
  const H = city.harbour; if (!H) return { update() {} };
  const colors = [0xf2f2f2, 0xe8e0d0, 0x2f5d9b, 0xb3262e, 0xf2f2f2, 0x1d6b57, 0xf2f2f2, 0xd8a31f];
  const hullM = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }), cabM = new THREE.MeshStandardMaterial({ color: 0xf8f8f8, roughness: 0.4 }), mastM = new THREE.MeshStandardMaterial({ color: 0xb5bcc6, metalness: 0.6, roughness: 0.4 });
  const boats = [];
  H.slips.forEach((s, i) => {
    if (i % 5 === 4) return;                                   // an empty slip now and then
    const g = new THREE.Group(), L = 12 + (i * 7) % 5, W = 3.6 + (i % 3) * 0.4, sail = i % 3 === 0;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(L, 1.3, W), hullM(colors[i % colors.length])); hull.position.y = 0.3; hull.castShadow = true;
    const bow = new THREE.Mesh(new THREE.CylinderGeometry(0.01, W / 2, 2.6, 4, 1), hullM(colors[i % colors.length])); bow.rotation.z = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.set(L / 2 + 1.2, 0.3, 0); bow.scale.set(1, 1, 1);
    g.add(hull, bow);
    if (sail) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 13, 6), mastM); m.position.set(L * 0.1, 7, 0); g.add(m); const sl = new THREE.Mesh(new THREE.PlaneGeometry(8, 10), new THREE.MeshStandardMaterial({ color: 0xfafafa, side: THREE.DoubleSide, roughness: 0.9 })); sl.rotation.y = Math.PI / 2; sl.position.set(L * 0.1 - 0.2, 6.6, 0); g.add(sl); }
    else { const cab = new THREE.Mesh(new THREE.BoxGeometry(L * 0.4, 1.5, W * 0.7), cabM); cab.position.set(-L * 0.1, 1.7, 0); cab.castShadow = true; g.add(cab); }
    g.position.set(s.x, 0.05, s.z); g.rotation.y = Math.PI / 2 + (i % 2 ? 0 : Math.PI) * 0;   // long axis along world x (the slips run east-west on the map)
    g.rotation.set(0, 0, 0); g.userData = { y0: 0.05, ph: i * 1.7 };
    scene.add(g); boats.push(g);
  });
  let t = 0;
  return {
    boats,
    update(dt) { t += dt; boats.forEach(b => { b.position.y = b.userData.y0 + Math.sin(t * 1.3 + b.userData.ph) * 0.07; b.rotation.z = Math.sin(t * 0.9 + b.userData.ph) * 0.02; b.rotation.x = Math.sin(t * 1.1 + b.userData.ph * 2) * 0.015; }); }
  };
}
