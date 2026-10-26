// Emergency and winter-service vehicles: police car, ambulance, fire engine and snowplough. Each is the plain traffic body of a
// similar size (sedan / van / truck) plus the gear that makes it what it is: light bars that flash in turn, stripes, a blade...
// `addServiceGear(group, type, dims)` returns { flash(on, phase) } and the bay-door sized dims of the base body.
import * as THREE from 'three';

export const SERVICE_BASE = { police: 'sedan', ambulance: 'van', fire: 'truck', plow: 'truck' };
export const SERVICE_COLOR = { police: 0xf1f3f6, ambulance: 0xf4f6f8, fire: 0xc4281a, plow: 0xff8a00 };
export const isService = t => !!SERVICE_BASE[t];

const lamp = (hex) => new THREE.MeshStandardMaterial({ color: 0x151515, emissive: hex, emissiveIntensity: 0.15, roughness: 0.3 });
const solid = (hex, rough = 0.5, metal = 0.2) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = false; parent.add(m); return m; };

export function addServiceGear(g, type, d) {
  const L = d.len / 2, W = d.wid;
  const lamps = [];   // { mat, group: 'a' | 'b' }
  const bar = (y, z, w, ca, cb) => {
    const a = lamp(ca), b = lamp(cb);
    box(w, 0.1, 0.34, solid(0x15181c), 0, y, z, g);
    box(w / 2 - 0.03, 0.12, 0.3, a, -w / 4, y + 0.07, z, g); box(w / 2 - 0.03, 0.12, 0.3, b, w / 4, y + 0.07, z, g);
    lamps.push({ mat: a, group: 'a' }, { mat: b, group: 'b' });
  };
  if (type === 'police') {
    // white car with black doors, bonnet and boot, a roof bar (red / blue) and a grille push-bar
    const dk = solid(0x14171c, 0.45, 0.4);
    box(W * 1.02, 0.34, 1.35, dk, 0, 0.62, -0.1, g).scale.set(1, 1, 1);
    box(W * 0.9, 0.04, 0.9, dk, 0, 0.9, L - 0.9, g);
    bar(1.5, -0.05, W * 0.62, 0xff2020, 0x2a5cff);
    box(W * 0.7, 0.2, 0.08, dk, 0, 0.45, L + 0.1, g);
  } else if (type === 'ambulance') {
    const red = solid(0xd8201a, 0.5);
    [-1, 1].forEach(s => {
      box(0.04, 0.2, d.len * 0.92, red, s * (W / 2 + 0.03), 1.0, 0, g);
      // a white cross on a red square on each side and on the back
      const sq = box(0.05, 0.8, 0.8, red, s * (W / 2 + 0.04), 1.5, -0.4, g);
      box(0.06, 0.6, 0.16, solid(0xffffff), s * (W / 2 + 0.05), 1.5, -0.4, g); box(0.06, 0.16, 0.6, solid(0xffffff), s * (W / 2 + 0.05), 1.5, -0.4, g);
      sq.name = 'cross';
    });
    box(W * 0.8, 0.04, 0.4, red, 0, 2.03, 0.1, g);
    bar(2.06, 0.9, W * 0.8, 0xff2020, 0xffffff);
    bar(2.06, -1.6, W * 0.5, 0xff2020, 0xffffff);
  } else if (type === 'fire') {
    const red = solid(0xc4281a, 0.45, 0.35), steel = solid(0xb8bdc4, 0.35, 0.8);
    box(d.wid + 0.04, 2.5, d.len - 2.7, red, 0, 1.95, -L + (d.len - 2.7) / 2 + 0.05, g);                 // red body over the white box
    box(d.wid + 0.07, 0.12, d.len - 2.7, solid(0xf2d21b), 0, 1.35, -L + (d.len - 2.7) / 2 + 0.05, g);     // yellow band
    box(0.3, 0.14, d.len * 0.62, steel, -0.35, 3.3, -0.9, g); box(0.3, 0.14, d.len * 0.62, steel, 0.35, 3.3, -0.9, g);   // ladder rails
    for (let i = 0; i < 11; i++) box(0.9, 0.05, 0.05, steel, 0, 3.3, -3.9 + i * 0.55, g);
    bar(2.75, L - 1.2, W * 0.7, 0xff2020, 0xff2020);
    bar(3.2, -L + 0.7, W * 0.7, 0xff2020, 0xffffff);
  } else if (type === 'plow') {
    const org = solid(0xff8a00, 0.5, 0.25), dk = solid(0x23272d, 0.7, 0.4), steel = solid(0xaab0b8, 0.35, 0.8);
    box(d.wid + 0.04, 2.5, d.len - 2.7, org, 0, 1.95, -L + (d.len - 2.7) / 2 + 0.05, g);
    box(d.wid + 0.06, 0.55, 0.08, dk, 0, 1.2, -L - 0.03, g); box(d.wid + 0.07, 0.14, 0.09, solid(0xf2c300), 0, 1.2, -L - 0.035, g);   // tail board with a hazard stripe
    // the blade: a wide plate on a frame, angled so the left end leads and the snow is thrown to the right-hand kerb
    const yel = solid(0xf2c300, 0.5, 0.2);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(d.wid + 1.8, 1.15, 0.14), yel);
    blade.position.set(0.15, 0.7, L + 1.0); blade.rotation.y = 0.4; blade.rotation.x = 0.12; g.add(blade);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(d.wid + 1.85, 0.1, 0.2), dk); edge.position.set(0.15, 0.14, L + 1.02); edge.rotation.y = 0.4; g.add(edge);
    box(0.14, 0.14, 1.2, dk, -0.55, 0.5, L + 0.5, g); box(0.14, 0.14, 1.2, dk, 0.55, 0.5, L + 0.5, g);
    // salt spreader hopper on the back: a dark box with a spinner disc under it
    box(d.wid * 0.85, 0.5, 1.5, dk, 0, 3.4, -L + 1.6, g);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 16), steel); disc.position.set(0, 0.5, -L - 0.3); g.add(disc);
    const am = lamp(0xffa000); const am2 = lamp(0xffa000);
    box(0.5, 0.22, 0.5, am, 0, 3.0, L - 1.0, g); box(0.5, 0.22, 0.5, am2, 0, 3.75, -L + 1.6, g);
    lamps.push({ mat: am, group: 'a' }, { mat: am2, group: 'b' });
  }
  return {
    // on: lights running; t: seconds (drives the alternation)
    flash(on, t) {
      const ph = Math.floor(t * 8) % 4;           // two quick bursts per side, like a real bar
      lamps.forEach(l => { l.mat.emissiveIntensity = on ? ((l.group === 'a' ? (ph < 2 && ph % 2 === 0) : (ph >= 2 && ph % 2 === 0)) ? 3.2 : 0.2) : 0.12; });
    }
  };
}
