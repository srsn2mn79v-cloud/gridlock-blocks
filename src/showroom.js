// The inside of a shop: a lit garage bay far off the map. While you browse, the car is moved in here (valet), so it sits on a
// polished floor with the shop's neon on the walls instead of standing in an alley. Nothing is simulated in it.
import * as THREE from 'three';

export const SHOWROOM = { x: 6600, y: 0, z: 0 };

function label(text, color, w = 512, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const q = c.getContext('2d');
  q.clearRect(0, 0, w, h); q.font = '700 78px Impact, "Arial Black", sans-serif'; q.textAlign = 'center'; q.textBaseline = 'middle';
  q.shadowColor = color; q.shadowBlur = 26; q.fillStyle = '#fff'; q.fillText(text.toUpperCase(), w / 2, h / 2 + 4);
  q.shadowBlur = 8; q.strokeStyle = color; q.lineWidth = 3; q.strokeText(text.toUpperCase(), w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function floorTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const q = c.getContext('2d');
  q.fillStyle = '#15181f'; q.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { q.fillStyle = (i + j) % 2 ? '#1c212b' : '#12151b'; q.fillRect(i * 128, j * 128, 128, 128); }
  q.strokeStyle = 'rgba(255,255,255,.07)'; q.lineWidth = 2; q.strokeRect(1, 1, 254, 254);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 6); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createShowroom(scene) {
  const g = new THREE.Group(); g.position.set(SHOWROOM.x, SHOWROOM.y, SHOWROOM.z); g.visible = false; scene.add(g);
  const W = 18, D = 16, H = 5.2;
  const mat = (col, o = {}) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, metalness: 0.05, ...o });
  const box = (w, h, d, m, x, y, z, parent = g) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); parent.add(o); return o; };
  const glow = col => new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTex(), roughness: 0.28, metalness: 0.55 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.0, 0); g.add(floor);
  const wallM = mat(0x232833), ceilM = mat(0x0f1218);
  box(W, H, 0.3, wallM, 0, H / 2, -D / 2); box(W, H, 0.3, wallM, 0, H / 2, D / 2);
  box(0.3, H, D, wallM, -W / 2, H / 2, 0); box(0.3, H, D, wallM, W / 2, H / 2, 0);
  box(W, 0.3, D, ceilM, 0, H, 0);
  // concrete skirting + hazard stripe along the wall bases
  const stripe = mat(0xd9b500, { emissive: 0x302600 });
  [[0, -D / 2 + 0.2, W, 0.25], [0, D / 2 - 0.2, W, 0.25]].forEach(([x, z, w, d]) => box(w, 0.18, d, stripe, x, 0.09, z));
  [[-W / 2 + 0.2, 0], [W / 2 - 0.2, 0]].forEach(([x, z]) => box(0.25, 0.18, D, stripe, x, 0.09, z));
  const lights = [], lightPool = new THREE.PointLight(0xffffff, 0, 30, 1.6); lightPool.position.set(0, H - 0.8, 0); g.add(lightPool);
  const fill = new THREE.PointLight(0xffffff, 0, 22, 1.8); fill.position.set(3, 2.4, 4); g.add(fill);
  // ceiling tubes
  const tubeM = new THREE.MeshBasicMaterial({ color: 0xf2f6ff, toneMapped: false });
  for (let i = -2; i <= 2; i++) for (let s of [-4.2, 4.2]) box(0.16, 0.08, 6.5, tubeM, i * 3.6, H - 0.22, s * 0.0 + (s > 0 ? 3.5 : -3.5));
  const accentM = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const strips = [];
  [[0, 3.55, -D / 2 + 0.2, W - 1, 0.12, 0.08], [0, 0.55, -D / 2 + 0.2, W - 1, 0.1, 0.08]].forEach(([x, y, z, w, h, d]) => { const m = accentM.clone(); const o = box(w, h, d, m, x, y, z); strips.push(m); });
  [-1, 1].forEach(s => { const m = accentM.clone(); box(0.08, 0.12, D - 2, m, s * (W / 2 - 0.2), 3.0, 0); strips.push(m); });
  // the name board on the back wall (behind the car, as you look at it)
  const signM = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), signM); sign.position.set(0, 3.9, -D / 2 + 0.2); g.add(sign);
  const rig = new THREE.Group(); g.add(rig);
  // turntable under the car
  const tt = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.3, 0.14, 40), mat(0x0c0e12, { roughness: 0.3, metalness: 0.8 })); tt.position.y = 0.07; g.add(tt);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.05, 6, 48), accentM.clone()); ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; g.add(ring); strips.push(ring.material);
  function dress(kind) {
    while (rig.children.length) { const o = rig.children.pop(); o.traverse(m => { if (m.geometry) m.geometry.dispose(); }); }
    const L = (o) => { rig.add(o); return o; };
    const col = new THREE.Color(kind.hex);
    if (kind.key === 'perf' || kind.key === 'dealer') {            // tyre stacks and tool chests
      for (let k = 0; k < 4; k++) for (let n = 0; n < 4; n++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.18, 8, 18), mat(0x0b0b0c, { roughness: 0.95 })); t.rotation.x = Math.PI / 2; t.position.set(-W / 2 + 1.4 + (k > 1 ? 1 : 0) * 0.9, 0.2 + n * 0.36, -D / 2 + 1.4 + (k % 2) * 0.95); L(t); }
      box(2.2, 1.0, 0.8, mat(0xb0211c), W / 2 - 1.6, 0.5, -D / 2 + 1.0, rig); box(2.2, 0.08, 0.84, mat(0x2a2d33, { metalness: 0.6 }), W / 2 - 1.6, 1.04, -D / 2 + 1.0, rig);
    }
    if (kind.key === 'paint') {                                   // swatch wall
      const cols = [0xe63946, 0xf4a261, 0xffd21f, 0x2ec27e, 0x1ec8e0, 0x3a6df0, 0x8a4fff, 0xff5fa8, 0xf5f5f5, 0x15171c];
      cols.forEach((c, i) => box(1.1, 1.5, 0.08, mat(c, { roughness: 0.2, metalness: 0.4 }), -W / 2 + 1.5 + i * 1.5 + (i > 5 ? 0 : 0), 1.7, D / 2 - 0.3, rig).rotation.y = Math.PI);
    }
    if (kind.key === 'body') {                                    // bumpers and wings on the wall
      for (let i = 0; i < 5; i++) { box(2.0, 0.28, 0.5, mat(0x2b2f38, { metalness: 0.5, roughness: 0.4 }), -W / 2 + 0.5, 1.0 + i * 0.5, -3 + i * 1.5, rig).rotation.y = Math.PI / 2; }
      box(2.4, 0.08, 0.7, mat(col), W / 2 - 1.2, 2.2, -2, rig); box(0.1, 0.5, 0.1, mat(0x111111), W / 2 - 0.6, 1.9, -2, rig); box(0.1, 0.5, 0.1, mat(0x111111), W / 2 - 1.8, 1.9, -2, rig);
    }
    if (kind.key === 'tuning') {                                  // neon tubes + a speaker stack
      for (let i = 0; i < 4; i++) box(0.08, 2.6, 0.08, glow([0xff2bd6, 0x2bf0ff, 0xffd21f, 0x7a5cff][i]), -W / 2 + 0.8, 2.2, -5 + i * 3, rig);
      for (let i = 0; i < 3; i++) box(1.0, 0.8, 0.8, mat(0x101114), W / 2 - 1.0, 0.4 + i * 0.8, -D / 2 + 1.0, rig);
    }
    // wall shelving, common to all
    [1.2, 2.1].forEach(y => box(0.5, 0.08, 7, mat(0x3a404c), W / 2 - 0.4, y, 3, rig));
  }
  return {
    group: g, position: new THREE.Vector3(SHOWROOM.x, SHOWROOM.y, SHOWROOM.z),
    show(on, kind) {
      g.visible = on;
      if (on && kind) {
        const col = new THREE.Color(kind.hex);
        strips.forEach(m => m.color.copy(col)); lightPool.color.set(0xfff4e6); lightPool.intensity = 70; fill.color.copy(col).lerp(new THREE.Color(0xffffff), 0.5); fill.intensity = 26;
        signM.map = label(kind.name, kind.color); signM.needsUpdate = true; dress(kind);
      } else { lightPool.intensity = 0; fill.intensity = 0; }
    }
  };
}
