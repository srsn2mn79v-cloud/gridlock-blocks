// Clothes: the catalogue (shirt, pants, hat, glasses, shoes), dressing the walking character, and the little "studio" far
// outside the map where the character is shown spinning in the wardrobe and in the clothes shops.
import * as THREE from 'three';

export const SLOTS = [['shirt', 'Shirts'], ['pants', 'Pants'], ['hat', 'Hats'], ['glasses', 'Glasses'], ['shoes', 'Shoes']];
// price 0 = you start with it. `none` entries exist for hat / glasses. `kind` picks the garment model in dressAvatar.
export const CLOTHES = {
  shirt: [
    { id: 'tee_blue', name: 'Blue tee', price: 0, color: 0x2f6fe0, kind: 'tee' }, { id: 'tee_white', name: 'White tee', price: 35, color: 0xf0f0f0, kind: 'tee' },
    { id: 'tee_red', name: 'Red tee', price: 35, color: 0xd23b34, kind: 'tee' }, { id: 'tee_black', name: 'Black tee', price: 35, color: 0x1d1f24, kind: 'tee' },
    { id: 'tank', name: 'Grey tank top', price: 30, color: 0x9aa0a8, kind: 'tank' },
    { id: 'polo_green', name: 'Green polo', price: 70, color: 0x2f8a4c, kind: 'polo' }, { id: 'polo_white', name: 'White polo', price: 75, color: 0xf2f0ea, kind: 'polo' },
    { id: 'stripe_navy', name: 'Striped shirt', price: 80, color: 0x24324f, pattern: 'stripe', alt: 0xf0f0f0, kind: 'stripe' },
    { id: 'stripe_red', name: 'Red striped shirt', price: 85, color: 0xb8322d, pattern: 'stripe', alt: 0xf4efe6, kind: 'stripe' },
    { id: 'hoodie_grey', name: 'Grey hoodie', price: 120, color: 0x8a909a, kind: 'hoodie' }, { id: 'hoodie_black', name: 'Black hoodie', price: 130, color: 0x202226, kind: 'hoodie' },
    { id: 'hoodie_red', name: 'Red hoodie', price: 130, color: 0xb62b2b, kind: 'hoodie' },
    { id: 'hawaii', name: 'Hawaiian shirt', price: 150, color: 0x1fa88a, pattern: 'dots', alt: 0xffd23f, kind: 'hawaii' },
    { id: 'turtle', name: 'Cream turtleneck', price: 140, color: 0xe8dcc2, kind: 'turtle' },
    { id: 'denim', name: 'Denim jacket', price: 260, color: 0x3d5f94, kind: 'denim' },
    { id: 'bomber', name: 'Bomber jacket', price: 300, color: 0x3f5a3a, kind: 'bomber' },
    { id: 'puffer', name: 'Puffer jacket', price: 340, color: 0xe2702a, kind: 'puffer' },
    { id: 'leather', name: 'Leather jacket', price: 420, color: 0x2a1d17, kind: 'leather' },
    { id: 'suit', name: 'Suit jacket', price: 650, color: 0x2c3138, kind: 'suit' }, { id: 'suit_cream', name: 'Cream suit', price: 720, color: 0xd9ccb0, kind: 'suit' }
  ],
  pants: [
    { id: 'dark', name: 'Dark trousers', price: 0, color: 0x23262d, kind: 'plain' }, { id: 'jeans', name: 'Blue jeans', price: 90, color: 0x35568a, kind: 'jeans' },
    { id: 'jeans_black', name: 'Black jeans', price: 95, color: 0x1c1d21, kind: 'jeans' }, { id: 'khaki', name: 'Khakis', price: 80, color: 0xb5a47a, kind: 'plain' },
    { id: 'cargo', name: 'Cargo pants', price: 110, color: 0x56653f, kind: 'cargo' }, { id: 'white', name: 'White pants', price: 100, color: 0xe6e3dc, kind: 'plain' },
    { id: 'red', name: 'Red pants', price: 130, color: 0xb02f2f, kind: 'plain' }, { id: 'shorts', name: 'Denim shorts', price: 70, color: 0x4a6ea3, kind: 'shorts' },
    { id: 'jog_grey', name: 'Grey joggers', price: 95, color: 0x7d838c, kind: 'jogger' }, { id: 'jog_black', name: 'Black joggers', price: 95, color: 0x1e2024, kind: 'jogger' },
    { id: 'suitp', name: 'Suit trousers', price: 220, color: 0x32363d, kind: 'suit' }, { id: 'suitp_cream', name: 'Cream trousers', price: 240, color: 0xd9ccb0, kind: 'suit' }
  ],
  hat: [
    { id: 'none', name: 'No hat', price: 0 }, { id: 'cap_black', name: 'Black cap', price: 0, color: 0x15161a, kind: 'cap' }, { id: 'cap_red', name: 'Red cap', price: 40, color: 0xc92f2f, kind: 'cap' },
    { id: 'beanie', name: 'Beanie', price: 50, color: 0x6a3d8f, kind: 'beanie' }, { id: 'bucket', name: 'Bucket hat', price: 65, color: 0xb9b08a, kind: 'bucket' },
    { id: 'phones', name: 'Headphones', price: 80, color: 0x202226, kind: 'phones' }, { id: 'hard', name: 'Hard hat', price: 90, color: 0xf2c500, kind: 'hard' },
    { id: 'fedora', name: 'Fedora', price: 180, color: 0x4b4034, kind: 'fedora' }, { id: 'cowboy', name: 'Cowboy hat', price: 220, color: 0x8b5e34, kind: 'cowboy' },
    { id: 'top', name: 'Top hat', price: 320, color: 0x111114, kind: 'top' }, { id: 'crown', name: 'Gold crown', price: 1000, color: 0xe0b630, kind: 'crown' }
  ],
  glasses: [
    { id: 'none', name: 'No glasses', price: 0 }, { id: 'round', name: 'Round glasses', price: 60, color: 0x222222, kind: 'round' }, { id: 'shades', name: 'Sunglasses', price: 90, color: 0x0b0b0d, kind: 'shades' },
    { id: 'wayfarer', name: 'Wayfarers', price: 110, color: 0x15151a, kind: 'wayfarer' }, { id: 'aviator', name: 'Aviators', price: 150, color: 0xc9a227, kind: 'aviator' },
    { id: 'monocle', name: 'Monocle', price: 200, color: 0xd4af37, kind: 'monocle' }, { id: 'neon', name: 'Neon shades', price: 250, color: 0x39ff9a, kind: 'neon' },
    { id: 'vr', name: 'VR headset', price: 400, color: 0x1b1d24, kind: 'vr' }
  ],
  shoes: [
    { id: 'sneaker_black', name: 'Black sneakers', price: 0, color: 0x15161a, kind: 'sneaker' }, { id: 'sneaker_white', name: 'White sneakers', price: 90, color: 0xf2f2f2, kind: 'sneaker' },
    { id: 'sneaker_red', name: 'Red sneakers', price: 110, color: 0xcc2b2b, kind: 'sneaker' }, { id: 'hitop', name: 'Blue hi-tops', price: 130, color: 0x2b55b8, kind: 'sneaker', tall: 1.9 },
    { id: 'boots', name: 'Boots', price: 160, color: 0x4a3322, kind: 'boot', tall: 2.3 }, { id: 'dress', name: 'Dress shoes', price: 200, color: 0x1a1210, kind: 'dress' },
    { id: 'neonshoe', name: 'Neon runners', price: 260, color: 0x1a1c24, kind: 'sneaker', glow: 0x39ff9a }, { id: 'gold', name: 'Gold sneakers', price: 500, color: 0xd4af37, kind: 'sneaker' }
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
const lit = (hex, r = 0.7, m = 0) => new THREE.MeshStandardMaterial({ color: hex, roughness: r, metalness: m });
const emi = hex => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1.4, roughness: 0.3 });
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
const SLEEVE = { tee: 'short', tank: 'none', polo: 'short', stripe: 'long', hoodie: 'long', hawaii: 'short', turtle: 'long', denim: 'long', bomber: 'long', puffer: 'long', leather: 'long', suit: 'long' };
const BULK = { hoodie: 1, denim: 1, bomber: 1, puffer: 1.25, leather: 1, suit: 1 };

// avatar.userData: mats { shirt, pants, shoe, skin }, shoes / shins [meshes], hat / glass / torso / pants slot groups, armSlots / legSlots / footSlots [groups]
export function dressAvatar(avatar, outfit) {
  const U = avatar.userData, o = { ...DEFAULT_OUTFIT, ...outfit }, M = U.mats;
  const sh = itemOf('shirt', o.shirt), pa = itemOf('pants', o.pants), ho = itemOf('hat', o.hat), gl = itemOf('glasses', o.glasses), so = itemOf('shoes', o.shoes);
  const shared = new Set(Object.values(M));
  const clear = g => { while (g.children.length) { const c = g.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material && !shared.has(c.material)) c.material.dispose(); } };
  [U.hatSlot, U.glassSlot, U.torsoSlot, U.pantsSlot, ...U.armSlots, ...U.legSlots, ...U.footSlots].forEach(clear);
  const add = (g, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), C = (a, b, h, n = 14) => new THREE.CylinderGeometry(a, b, h, n), S = (r, n = 10) => new THREE.SphereGeometry(r, n, n);

  // ---- shirt ----
  const k = sh.kind || 'tee', sleeve = SLEEVE[k] || 'short', bulk = BULK[k] || 0, T = U.torsoSlot, SM = M.shirt;
  SM.color.setHex(sh.pattern ? 0xffffff : sh.color);
  if (SM.map && SM.map.dispose) SM.map.dispose();
  SM.map = sh.pattern ? patTex(sh.color, sh.alt, sh.pattern) : null;
  SM.roughness = k === 'leather' ? 0.35 : k === 'suit' ? 0.6 : 0.85; SM.metalness = k === 'leather' ? 0.12 : 0; SM.needsUpdate = true;
  const trim = lit(shade(sh.color, 0.62), 0.9), light = lit(shade(sh.color, 1.35), 0.8), metal = lit(0xb9bcc2, 0.3, 0.8), white = lit(0xf4f4f2, 0.6);
  if (bulk) { add(T, B(0.5 + 0.05 * bulk, 0.38, 0.28 + 0.035 * bulk), SM, 0, 1.33, 0); add(T, B(0.44 + 0.04 * bulk, 0.285, 0.25 + 0.03 * bulk), SM, 0, 1.02, 0); }
  U.armSlots.forEach(A => {
    if (sleeve === 'none') return;
    const w = 0.14 + 0.035 * bulk, d = 0.16 + 0.035 * bulk;
    if (sleeve === 'short') add(A, B(w + 0.02, 0.17, d + 0.02), SM, 0, -0.095, 0);
    else {
      add(A, B(w + 0.012, 0.325, d + 0.012), SM, 0, -0.165, 0); add(A, B(w - 0.005 + 0.02 * bulk, 0.35, d - 0.015 + 0.02 * bulk), SM, 0, -0.5, 0);
      if (k === 'puffer') [-0.1, -0.22, -0.34, -0.46, -0.58].forEach(y => add(A, B(w + 0.05, 0.012, d + 0.05), trim, 0, y, 0));
      if (k === 'hoodie' || k === 'bomber' || k === 'puffer' || k === 'stripe' || k === 'leather') add(A, B(w + 0.012 + 0.02 * bulk, 0.06, d + 0.03 + 0.02 * bulk), k === 'stripe' ? SM : trim, 0, -0.665, 0);
      if (k === 'suit') add(A, B(w + 0.012, 0.035, d + 0.02), white, 0, -0.675, 0);
      if (k === 'leather') add(A, B(0.02, 0.02, 0.06), metal, 0, -0.66, d / 2 + 0.03);
      if (k === 'denim') add(A, B(w + 0.03, 0.03, d + 0.03), trim, 0, -0.64, 0);
    }
    if (sleeve === 'short' && k === 'polo') add(A, B(w + 0.03, 0.025, d + 0.03), trim, 0, -0.17, 0);
    if (k === 'tee') add(A, B(w + 0.025, 0.015, d + 0.025), trim, 0, -0.18, 0);
  });
  const collarY = 1.555, front = bulk ? 0.16 + 0.017 * bulk : 0.14;
  const flap = (s, w, h, rz, y, z, m = SM) => add(T, B(w, h, 0.02), m, s * 0.085, y, z, -0.3, 0, rz * s);
  if (k === 'tee' || k === 'stripe' || k === 'tank') add(T, new THREE.TorusGeometry(0.075, 0.013, 6, 14), trim, 0, collarY - 0.02, 0.02, Math.PI / 2.3);
  if (k === 'tank') { [-1, 1].forEach(s => add(T, B(0.1, 0.16, 0.285), SM, s * 0.17, 1.46, 0)); }
  if (k === 'polo') {
    [-1, 1].forEach(s => flap(s, 0.1, 0.045, 0.5, 1.545, 0.135, light)); add(T, B(0.03, 0.2, 0.01), trim, 0, 1.43, 0.143);
    [0, 1, 2].forEach(i => add(T, S(0.009, 6), white, 0, 1.51 - i * 0.06, 0.15));
  }
  if (k === 'hawaii') {
    [-1, 1].forEach(s => flap(s, 0.1, 0.1, 0.9, 1.5, 0.135)); add(T, B(0.012, 0.38, 0.01), trim, 0, 1.33, 0.142);
    [0, 1, 2, 3].forEach(i => add(T, S(0.009, 6), white, 0.02, 1.4 - i * 0.1, 0.148)); add(T, B(0.09, 0.07, 0.01), SM, -0.12, 1.28, 0.143);
  }
  if (k === 'turtle') { add(T, C(0.085, 0.092, 0.12), SM, 0, 1.585, 0); add(T, new THREE.TorusGeometry(0.088, 0.018, 6, 14), trim, 0, 1.645, 0, Math.PI / 2); add(T, B(0.45, 0.025, 0.26), trim, 0, 0.885, 0); }
  if (k === 'hoodie') {
    add(T, new THREE.TorusGeometry(0.11, 0.04, 8, 16), SM, 0, 1.56, 0.0, Math.PI / 2.1); add(T, S(0.19, 12), SM, 0, 1.58, -0.14).scale.set(1, 0.9, 0.55);
    add(T, B(0.3, 0.12, 0.03), trim, 0, 1.02, front - 0.012); add(T, B(0.03, 0.12, 0.12), SM, -0.145, 1.02, front - 0.05); add(T, B(0.03, 0.12, 0.12), SM, 0.145, 1.02, front - 0.05);
    [-1, 1].forEach(s => { add(T, C(0.006, 0.006, 0.2, 5), white, s * 0.05, 1.45, front + 0.003); add(T, S(0.012, 6), white, s * 0.05, 1.34, front + 0.003); });
    add(T, B(0.52, 0.04, 0.3), trim, 0, 0.885, 0);
  }
  if (k === 'denim') {
    [-1, 1].forEach(s => { flap(s, 0.11, 0.05, 0.4, 1.55, 0.15, trim); add(T, B(0.1, 0.075, 0.012), SM, s * 0.13, 1.33, front - 0.002); add(T, B(0.1, 0.02, 0.014), trim, s * 0.13, 1.37, front); });
    add(T, B(0.012, 0.6, 0.014), trim, 0, 1.2, front + 0.002); [0, 1, 2, 3].forEach(i => add(T, S(0.012, 6), metal, 0.018, 1.45 - i * 0.12, front + 0.01)); add(T, B(0.5, 0.03, 0.29), trim, 0, 0.9, 0);
  }
  if (k === 'bomber') {
    add(T, C(0.095, 0.1, 0.06, 14), trim, 0, 1.585, 0); add(T, B(0.52, 0.06, 0.3), trim, 0, 0.9, 0); add(T, B(0.014, 0.55, 0.012), metal, 0, 1.17, front + 0.003);
    add(T, B(0.1, 0.06, 0.012), lit(0xe2702a, 0.7), 0.13, 1.4, front + 0.002);
  }
  if (k === 'puffer') {
    [1.12, 1.24, 1.36, 1.48, 0.97, 0.9].forEach(y => add(T, B(0.58, 0.012, 0.36), trim, 0, y, 0)); add(T, C(0.11, 0.12, 0.09, 14), SM, 0, 1.6, 0); add(T, B(0.015, 0.6, 0.012), metal, 0, 1.17, 0.19);
  }
  if (k === 'leather') {
    [-1, 1].forEach(s => { flap(s, 0.13, 0.09, 0.55, 1.52, 0.155, trim); add(T, B(0.07, 0.025, 0.012), metal, s * 0.15, 1.2, front + 0.002); add(T, B(0.13, 0.04, 0.05), trim, s * 0.2, 1.55, 0); });
    add(T, B(0.016, 0.62, 0.012), metal, 0.0, 1.17, front + 0.004); add(T, B(0.54, 0.04, 0.3), trim, 0, 0.9, 0); add(T, B(0.5, 0.02, 0.012), metal, 0, 0.93, front - 0.02);
  }
  if (k === 'suit') {
    add(T, B(0.14, 0.24, 0.012), white, 0, 1.43, front - 0.004); add(T, B(0.052, 0.3, 0.014), lit(sh.color > 0x888888 ? 0x7d1f2c : 0x7d1f2c), 0, 1.36, front + 0.004);
    add(T, B(0.065, 0.05, 0.02), lit(0x7d1f2c), 0, 1.52, front + 0.006); [-1, 1].forEach(s => { add(T, B(0.085, 0.3, 0.022), SM, s * 0.115, 1.4, front, 0, 0, -s * 0.28); add(T, B(0.04, 0.035, 0.02), white, s * 0.15, 1.28, front); });
    add(T, B(0.07, 0.035, 0.014), white, 0.15, 1.34, front + 0.004); [0, 1].forEach(i => add(T, S(0.014, 6), lit(shade(sh.color, 0.4), 0.4), 0.0, 1.2 - i * 0.11, front + 0.004));
    add(T, B(0.5, 0.045, 0.3), SM, 0, 0.885, 0);
  }

  // ---- pants ----
  const pk = pa.kind || 'plain', PM = M.pants; PM.color.setHex(pa.color); PM.roughness = pk === 'suit' ? 0.55 : 0.85; PM.needsUpdate = true;
  const skinned = pk === 'shorts'; U.shins.forEach(m => { m.material = skinned ? M.skin : PM; });
  const P = U.pantsSlot, ptrim = lit(shade(pa.color, 0.6), 0.9), stitch = lit(pk === 'jeans' ? 0xd9a441 : shade(pa.color, 1.3), 0.9);
  if (pk !== 'jogger') { add(P, B(0.455, 0.045, 0.27), lit(pk === 'suit' ? 0x15100c : 0x3a2a1c, 0.5), 0, 0.915, 0); add(P, B(0.06, 0.04, 0.012), metal, 0, 0.915, 0.138); }
  else add(P, B(0.455, 0.05, 0.27), ptrim, 0, 0.915, 0);
  U.legSlots.forEach(L => {
    const s = L.userData.side;
    if (pk === 'jeans') { add(L, B(0.012, 0.86, 0.012), stitch, s * 0.1, -0.44, 0); add(L, B(0.1, 0.012, 0.012), stitch, -s * 0.01, -0.08, 0.112); add(L, B(0.012, 0.1, 0.012), stitch, s * 0.04, -0.13, 0.112); add(L, B(0.2, 0.04, 0.23), ptrim, 0, -0.86, 0); }
    if (pk === 'cargo') { add(L, B(0.045, 0.17, 0.15), PM, s * 0.115, -0.38, 0.0); add(L, B(0.05, 0.05, 0.155), ptrim, s * 0.115, -0.31, 0); add(L, S(0.012, 6), metal, s * 0.14, -0.31, 0); add(L, B(0.2, 0.05, 0.23), ptrim, 0, -0.86, 0); }
    if (pk === 'plain' || pk === 'suit') { add(L, B(0.2, 0.03, 0.23), ptrim, 0, -0.865, 0); if (pk === 'suit') add(L, B(0.012, 0.8, 0.012), ptrim, 0, -0.46, 0.113); }
    if (pk === 'shorts') { add(L, B(0.215, 0.05, 0.235), ptrim, 0, -0.43, 0); add(L, B(0.012, 0.3, 0.012), stitch, s * 0.1, -0.24, 0); add(L, B(0.2, 0.06, 0.22), white, 0, -0.8, 0); }
    if (pk === 'jogger') { add(L, B(0.012, 0.78, 0.045), white, s * 0.102, -0.42, 0); add(L, B(0.215, 0.08, 0.24), ptrim, 0, -0.84, 0); }
  });

  // ---- shoes ----
  const sk = so.kind || 'sneaker', tall = so.tall || 1;
  M.shoe.color.setHex(so.color); M.shoe.roughness = sk === 'dress' ? 0.25 : 0.7;
  U.shoes.forEach(m => { m.scale.y = sk === 'dress' ? 0.8 : tall; m.position.y = sk === 'dress' ? 0.04 : 0.05 * tall; });
  const sole = lit(sk === 'boot' ? 0x1b1410 : sk === 'dress' ? 0x120c09 : so.glow ? so.glow : 0xf4f4f2, 0.8), laceM = lit(sk === 'boot' ? 0xcbb68d : 0xf4f4f2, 0.9);
  if (so.glow) { sole.emissive = new THREE.Color(so.glow); sole.emissiveIntensity = 1.2; }
  U.footSlots.forEach(F => {
    add(F, B(0.215, 0.028, 0.32), sole, 0, 0.014, 0);
    if (sk === 'sneaker') {
      add(F, S(0.1, 8), M.shoe, 0, 0.065 * tall, 0.1).scale.set(1, 0.55, 0.9); add(F, B(0.19, 0.02, 0.1), white, 0, 0.1 * tall + 0.005, 0.04); add(F, B(0.205, 0.015, 0.05), white, 0, 0.032, 0.17);
      [0, 1, 2].forEach(i => add(F, B(0.12, 0.008, 0.012), laceM, 0, 0.1 * tall + 0.012, 0.0 + i * 0.03));
      if (tall > 1) { add(F, C(0.075, 0.08, 0.14 * tall), M.shoe, 0, 0.12 * tall, -0.06, 0.0); add(F, S(0.05, 6), white, 0.0, 0.1 * tall, -0.06).scale.set(2, 0.2, 1.3); }
    } else if (sk === 'boot') {
      add(F, C(0.095, 0.105, 0.24), M.shoe, 0, 0.2, -0.045); add(F, B(0.215, 0.05, 0.1), sole, 0, 0.04, -0.08); add(F, B(0.12, 0.02, 0.05), laceM, 0, 0.15, 0.065);
      [0, 1, 2, 3].forEach(i => add(F, B(0.1, 0.008, 0.01), laceM, 0, 0.16 + i * 0.035, 0.045 - i * 0.003));
      add(F, C(0.105, 0.105, 0.03), lit(shade(so.color, 0.6), 0.9), 0, 0.32, -0.045);
    } else if (sk === 'dress') { add(F, S(0.1, 8), M.shoe, 0, 0.055, 0.1).scale.set(1, 0.5, 1); add(F, B(0.16, 0.02, 0.04), lit(0x2a1d16, 0.2), 0, 0.085, 0.02); add(F, B(0.215, 0.04, 0.07), sole, 0, 0.02, -0.12); }
  });

  // ---- hats ----
  const H = U.hatSlot, hm = lit(ho.color || 0);
  const hk = ho.kind;
  if (hk === 'cap') { add(H, new THREE.SphereGeometry(0.19, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hm, 0, 0.04, 0); add(H, B(0.27, 0.018, 0.2), hm, 0, 0.045, 0.2, 0.08); add(H, S(0.018, 6), hm, 0, 0.23, 0); add(H, B(0.21, 0.04, 0.012), lit(shade(ho.color, 1.6)), 0, 0.09, 0.185, 0.35); add(H, B(0.02, 0.2, 0.02), lit(shade(ho.color, 0.7)), 0, 0.13, 0.0, 0, 0, 0).scale.set(0.3, 1, 8); }
  else if (hk === 'beanie') { add(H, new THREE.SphereGeometry(0.19, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hm, 0, 0.03, 0); add(H, C(0.196, 0.196, 0.07, 14), lit(shade(ho.color, 0.7), 0.95), 0, 0.01, 0); add(H, S(0.05, 8), lit(0xf0f0f0, 0.95), 0, 0.23, 0); }
  else if (hk === 'hard') { add(H, new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hm, 0, 0.04, 0); add(H, C(0.24, 0.24, 0.02, 16), hm, 0, 0.045, 0); add(H, B(0.05, 0.03, 0.4), hm, 0, 0.235, 0); add(H, B(0.07, 0.05, 0.03), emi(0xfff3b0), 0, 0.12, 0.2); }
  else if (hk === 'cowboy') { add(H, C(0.32, 0.32, 0.02, 20), hm, 0, 0.06, 0); add(H, C(0.12, 0.15, 0.17, 14), hm, 0, 0.15, 0); add(H, C(0.152, 0.152, 0.035, 14), lit(shade(ho.color, 0.5)), 0, 0.1, 0); [-1, 1].forEach(s => add(H, B(0.12, 0.02, 0.3), hm, s * 0.3, 0.09, 0, 0, 0, s * -0.35)); add(H, B(0.035, 0.02, 0.1), lit(shade(ho.color, 0.7)), 0, 0.245, 0); }
  else if (hk === 'top') { add(H, C(0.25, 0.25, 0.02, 20), hm, 0, 0.06, 0); add(H, C(0.14, 0.14, 0.28, 16), hm, 0, 0.2, 0); add(H, C(0.145, 0.145, 0.04, 16), lit(0xb02f2f), 0, 0.1, 0); add(H, C(0.14, 0.14, 0.01, 16), lit(0x1e1e24), 0, 0.345, 0); }
  else if (hk === 'fedora') { add(H, C(0.27, 0.27, 0.015, 22), hm, 0, 0.055, 0); add(H, C(0.115, 0.15, 0.17, 16), hm, 0, 0.15, 0); add(H, C(0.152, 0.158, 0.04, 16), lit(0x15110d), 0, 0.1, 0); add(H, B(0.08, 0.012, 0.3), hm, 0, 0.235, 0); add(H, B(0.3, 0.02, 0.08), hm, 0, 0.065, 0.25, -0.1); }
  else if (hk === 'bucket') { add(H, C(0.2, 0.21, 0.13, 16), hm, 0, 0.1, 0); add(H, C(0.27, 0.2, 0.035, 20), hm, 0, 0.04, 0); add(H, S(0.06, 8), hm, 0, 0.165, 0).scale.set(1.6, 0.25, 1.6); add(H, C(0.21, 0.21, 0.02, 16), lit(shade(ho.color, 0.6)), 0, 0.075, 0); }
  else if (hk === 'phones') {
    add(H, new THREE.TorusGeometry(0.2, 0.018, 8, 20, Math.PI), hm, 0, -0.04, 0); [-1, 1].forEach(s => { add(H, C(0.065, 0.065, 0.045, 14), hm, s * 0.2, -0.04, 0, 0, 0, Math.PI / 2); add(H, C(0.055, 0.055, 0.02, 14), lit(0xc9372f, 0.9), s * 0.178, -0.04, 0, 0, 0, Math.PI / 2); });
  }
  else if (hk === 'crown') {
    const gm = lit(ho.color, 0.25, 0.9); add(H, C(0.17, 0.17, 0.11, 16, 1), gm, 0, 0.1, 0); add(H, C(0.172, 0.172, 0.02, 16), gm, 0, 0.045, 0);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(H, new THREE.ConeGeometry(0.03, 0.1, 6), gm, Math.sin(a) * 0.15, 0.21, Math.cos(a) * 0.15); add(H, S(0.014, 6), lit([0xd02a2a, 0x2a6fd0, 0x20b060][i % 3], 0.2), Math.sin(a) * 0.15, 0.265, Math.cos(a) * 0.15); }
  }

  // ---- glasses ----
  const G = U.glassSlot;
  if (gl.kind) {
    const gk = gl.kind, m = gk === 'neon' ? emi(gl.color) : lit(gl.color, 0.35, gk === 'aviator' || gk === 'monocle' ? 0.8 : 0.1);
    const lens = gk === 'round' || gk === 'monocle' ? new THREE.MeshStandardMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.35, roughness: 0.1 }) : gk === 'aviator' ? lit(0x6a5a2a, 0.15, 0.4) : m;
    if (gk === 'vr') {
      add(G, B(0.34, 0.11, 0.09), m, 0, 0.0, 0.03); add(G, B(0.3, 0.025, 0.01), emi(0x4fd1ff), 0, 0.0, 0.078); add(G, B(0.35, 0.03, 0.04), lit(0x2a2d36), 0, 0.0, -0.14); [-1, 1].forEach(s => add(G, B(0.02, 0.03, 0.3), lit(0x2a2d36), s * 0.175, 0, -0.1));
    } else if (gk === 'monocle') {
      add(G, new THREE.TorusGeometry(0.05, 0.007, 6, 16), m, 0.075, 0, 0.005); add(G, new THREE.CircleGeometry(0.05, 14), lens, 0.075, 0, 0.004); add(G, B(0.004, 0.14, 0.004), m, 0.12, -0.08, 0.005, 0, 0, 0.15);
    } else {
      [-1, 1].forEach(s => {
        if (gk === 'round') { add(G, new THREE.TorusGeometry(0.05, 0.008, 6, 16), m, s * 0.075, 0, 0.004); add(G, new THREE.CircleGeometry(0.048, 14), lens, s * 0.075, 0, 0.004); }
        else if (gk === 'wayfarer') { add(G, B(0.125, 0.07, 0.014), m, s * 0.075, 0, 0.003); add(G, B(0.1, 0.05, 0.016), lit(0x101418, 0.1), s * 0.075, -0.004, 0.006); }
        else if (gk === 'aviator') { add(G, S(0.055, 10), lens, s * 0.075, -0.008, 0.004).scale.set(1.0, 0.9, 0.15); add(G, new THREE.TorusGeometry(0.056, 0.006, 6, 16), m, s * 0.075, -0.008, 0.004); }
        else add(G, B(0.11, 0.06, 0.012), lens, s * 0.075, 0, 0.004);
        add(G, B(0.01, 0.012, 0.17), m, s * 0.148, 0.01, -0.075);
      });
      add(G, B(0.05, 0.012, 0.012), m, 0, 0.012, 0.004);
      if (gk === 'wayfarer') add(G, B(0.26, 0.012, 0.014), m, 0, 0.032, 0.004);
    }
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
