// Clothes: the catalogue (shirt, pants, hat, glasses, shoes), dressing the walking character, and the little "studio" far
// outside the map where the character is shown spinning in the wardrobe and in the clothes shops.
import * as THREE from 'three';

export const SLOTS = [['shirt', 'Shirts'], ['pants', 'Pants'], ['hat', 'Hats'], ['glasses', 'Glasses'], ['shoes', 'Shoes']];
// price 0 = you start with it. `none` entries exist for hat / glasses.
export const CLOTHES = {
  shirt: [
    { id: 'tee_blue', name: 'Blue tee', price: 0, color: 0x2f6fe0 }, { id: 'tee_white', name: 'White tee', price: 35, color: 0xf0f0f0 }, { id: 'tee_red', name: 'Red tee', price: 35, color: 0xd23b34 },
    { id: 'tee_black', name: 'Black tee', price: 35, color: 0x1d1f24 }, { id: 'stripe_navy', name: 'Striped shirt', price: 80, color: 0x24324f, pattern: 'stripe', alt: 0xf0f0f0 },
    { id: 'hoodie_grey', name: 'Grey hoodie', price: 120, color: 0x8a909a }, { id: 'hoodie_black', name: 'Black hoodie', price: 130, color: 0x202226 },
    { id: 'hawaii', name: 'Hawaiian shirt', price: 150, color: 0x1fa88a, pattern: 'dots', alt: 0xffd23f }, { id: 'leather', name: 'Leather jacket', price: 420, color: 0x2a1d17 },
    { id: 'suit', name: 'Suit jacket', price: 650, color: 0x2c3138 }
  ],
  pants: [
    { id: 'dark', name: 'Dark trousers', price: 0, color: 0x23262d }, { id: 'jeans', name: 'Blue jeans', price: 90, color: 0x35568a }, { id: 'khaki', name: 'Khakis', price: 80, color: 0xb5a47a },
    { id: 'cargo', name: 'Cargo pants', price: 110, color: 0x56653f }, { id: 'white', name: 'White pants', price: 100, color: 0xe6e3dc }, { id: 'red', name: 'Red pants', price: 130, color: 0xb02f2f },
    { id: 'suitp', name: 'Suit trousers', price: 220, color: 0x32363d }
  ],
  hat: [
    { id: 'none', name: 'No hat', price: 0 }, { id: 'cap_black', name: 'Black cap', price: 0, color: 0x15161a, kind: 'cap' }, { id: 'cap_red', name: 'Red cap', price: 40, color: 0xc92f2f, kind: 'cap' },
    { id: 'beanie', name: 'Beanie', price: 50, color: 0x6a3d8f, kind: 'beanie' }, { id: 'hard', name: 'Hard hat', price: 90, color: 0xf2c500, kind: 'hard' },
    { id: 'cowboy', name: 'Cowboy hat', price: 220, color: 0x8b5e34, kind: 'cowboy' }, { id: 'top', name: 'Top hat', price: 320, color: 0x111114, kind: 'top' }
  ],
  glasses: [
    { id: 'none', name: 'No glasses', price: 0 }, { id: 'round', name: 'Round glasses', price: 60, color: 0x222222, kind: 'round' }, { id: 'shades', name: 'Sunglasses', price: 90, color: 0x0b0b0d, kind: 'shades' },
    { id: 'aviator', name: 'Aviators', price: 150, color: 0xc9a227, kind: 'aviator' }, { id: 'neon', name: 'Neon shades', price: 250, color: 0x39ff9a, kind: 'neon' }
  ],
  shoes: [
    { id: 'sneaker_black', name: 'Black sneakers', price: 0, color: 0x15161a }, { id: 'sneaker_white', name: 'White sneakers', price: 90, color: 0xf2f2f2 }, { id: 'sneaker_red', name: 'Red sneakers', price: 110, color: 0xcc2b2b },
    { id: 'boots', name: 'Boots', price: 160, color: 0x4a3322, tall: true }, { id: 'gold', name: 'Gold sneakers', price: 500, color: 0xd4af37 }
  ]
};
export const DEFAULT_OUTFIT = { shirt: 'tee_blue', pants: 'dark', hat: 'cap_black', glasses: 'none', shoes: 'sneaker_black' };
export const itemOf = (slot, id) => CLOTHES[slot].find(i => i.id === id) || CLOTHES[slot][0];
export const startOwned = () => Object.keys(CLOTHES).flatMap(sl => CLOTHES[sl].filter(i => i.price === 0).map(i => sl + ':' + i.id));

const patTex = (a, b, kind) => {
  const c = document.createElement('canvas'); c.width = c.height = 32; const q = c.getContext('2d');
  q.fillStyle = '#' + a.toString(16).padStart(6, '0'); q.fillRect(0, 0, 32, 32); q.fillStyle = '#' + b.toString(16).padStart(6, '0');
  if (kind === 'stripe') for (let y = 0; y < 32; y += 8) q.fillRect(0, y, 32, 3); else { [[6, 6], [22, 10], [12, 22], [27, 27]].forEach(([x, y]) => { q.beginPath(); q.arc(x, y, 3, 0, 7); q.fill(); }); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const lit = hex => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7 });
const emi = hex => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1.4, roughness: 0.3 });

// avatar.userData: mats { shirt, pants, shoe }, shoes [meshes], cap (the built-in cap mesh to hide), hatSlot / glassSlot groups
export function dressAvatar(avatar, outfit) {
  const U = avatar.userData, o = { ...DEFAULT_OUTFIT, ...outfit };
  const sh = itemOf('shirt', o.shirt), pa = itemOf('pants', o.pants), ho = itemOf('hat', o.hat), gl = itemOf('glasses', o.glasses), so = itemOf('shoes', o.shoes);
  U.mats.shirt.color.setHex(sh.pattern ? 0xffffff : sh.color);
  if (U.mats.shirt.map && U.mats.shirt.map.dispose) U.mats.shirt.map.dispose();
  U.mats.shirt.map = sh.pattern ? patTex(sh.color, sh.alt, sh.pattern) : null; U.mats.shirt.needsUpdate = true;
  U.mats.pants.color.setHex(pa.color); U.mats.shoe.color.setHex(so.color);
  U.shoes.forEach(m => { m.scale.y = so.tall ? 2.3 : 1; m.position.y = so.tall ? 0.115 : 0.05; });
  if (U.cap) U.cap.visible = false;
  [U.hatSlot, U.glassSlot].forEach(g => { while (g.children.length) { const c = g.children.pop(); c.geometry.dispose(); c.material.dispose(); } });
  const add = (g, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const H = U.hatSlot, hm = lit(ho.color || 0);
  if (ho.kind === 'cap') { add(H, new THREE.SphereGeometry(0.19, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hm, 0, 0.04, 0); add(H, new THREE.BoxGeometry(0.28, 0.02, 0.2), hm, 0, 0.045, 0.2); }
  else if (ho.kind === 'beanie') { add(H, new THREE.SphereGeometry(0.19, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hm, 0, 0.03, 0); add(H, new THREE.SphereGeometry(0.05, 8, 8), lit(0xf0f0f0), 0, 0.23, 0); }
  else if (ho.kind === 'hard') { add(H, new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hm, 0, 0.04, 0); add(H, new THREE.CylinderGeometry(0.24, 0.24, 0.02, 16), hm, 0, 0.045, 0); }
  else if (ho.kind === 'cowboy') { add(H, new THREE.CylinderGeometry(0.32, 0.32, 0.02, 20), hm, 0, 0.06, 0); add(H, new THREE.CylinderGeometry(0.12, 0.15, 0.17, 14), hm, 0, 0.15, 0); }
  else if (ho.kind === 'top') { add(H, new THREE.CylinderGeometry(0.25, 0.25, 0.02, 20), hm, 0, 0.06, 0); add(H, new THREE.CylinderGeometry(0.14, 0.14, 0.28, 16), hm, 0, 0.2, 0); add(H, new THREE.CylinderGeometry(0.145, 0.145, 0.04, 16), lit(0xb02f2f), 0, 0.1, 0); }
  const G = U.glassSlot;
  if (gl.kind) {
    const m = gl.kind === 'neon' ? emi(gl.color) : lit(gl.color), lens = gl.kind === 'round' ? new THREE.MeshStandardMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.35, roughness: 0.1 }) : m;
    [-1, 1].forEach(s => {
      if (gl.kind === 'round') add(G, new THREE.TorusGeometry(0.05, 0.008, 6, 14), m, s * 0.075, 0, 0).rotation.y = 0;
      else add(G, new THREE.BoxGeometry(0.11, gl.kind === 'aviator' ? 0.085 : 0.06, 0.012), lens, s * 0.075, 0, 0);
    });
    add(G, new THREE.BoxGeometry(0.05, 0.012, 0.012), m, 0, 0.012, 0); add(G, new THREE.BoxGeometry(0.3, 0.01, 0.01), m, 0, 0.012, -0.015);
  }
}

// ---- the studio -----------------------------------------------------------------------------------------------------------------------
export const STAGE = { x: 6000, y: 0, z: 0 };
export function createStage(scene, makeAvatar) {
  const g = new THREE.Group(); g.position.set(STAGE.x, STAGE.y, STAGE.z); g.visible = false; scene.add(g);
  const c = document.createElement('canvas'); c.width = 8; c.height = 256; const q = c.getContext('2d'); const gr = q.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#1b2433'); gr.addColorStop(0.55, '#3a4a66'); gr.addColorStop(1, '#222a38'); q.fillStyle = gr; q.fillRect(0, 0, 8, 256);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 16), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.BackSide, fog: false })); g.add(dome);
  const fc = document.createElement('canvas'); fc.width = fc.height = 128; const f = fc.getContext('2d'); const fg = f.createRadialGradient(64, 64, 6, 64, 64, 64);
  fg.addColorStop(0, '#9fb4d6'); fg.addColorStop(0.55, '#4e5f7e'); fg.addColorStop(1, 'rgba(34,42,56,0)'); f.fillStyle = fg; f.fillRect(0, 0, 128, 128);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 40), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fc), transparent: true, fog: false })); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; g.add(floor);
  const avatar = makeAvatar(); avatar.visible = true; avatar.scale.multiplyScalar(1.0); g.add(avatar);
  // no real lights out here: the character's materials glow a little so it reads against the backdrop
  const glow = v => avatar.traverse(o => { if (o.isMesh && o.material) { o.material.emissive = o.material.emissive || new THREE.Color(); o.material.emissive.copy(o.material.color).multiplyScalar(v); } });
  return {
    group: g, avatar,
    show(on) { g.visible = on; },
    dress(outfit) { dressAvatar(avatar, outfit); glow(0.55); },
    rotate(y) { avatar.rotation.y = y; },
    position: new THREE.Vector3(STAGE.x, 0, STAGE.z)
  };
}
