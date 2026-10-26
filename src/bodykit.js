// Tuner body kits, styled after the Need for Speed Underground catalogue: splitters and canards, intake chins, ground-effect
// skirts, bolt-on wide-body arches, ducktails and GT wings on swan-neck stands, vented hoods and race diffusers with twin pipes.
// Everything is built from small extruded profiles in the car's own frame (+z nose, +y up, x across; the whole model is later
// squeezed to the real track width), so the same kit fits every body.
import * as THREE from 'three';

// profile in the side view (u = z along the car, v = y up) extruded across the car, centred on x = cx
function side(pts, width, cx = 0) {
  const sh = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: false });
  g.rotateY(-Math.PI / 2); g.translate(cx + width / 2, 0, 0);
  return g;
}
// plan-view plate (x, z) of a given thickness lying at height y
function plate(pts, thick, y) {
  const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  return g;
}
// front view profile (x across, y up) extruded along the car (z)
function front(pts, len, z0 = 0) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false });
  g.translate(0, 0, z0);
  return g;
}

export function buildKit(K, { base, heightAtZ, wheels, wheelR = 0.38, frontZ = 1.8, rearZ = -1.8 }) {
  const grp = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.3, metalness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.45, metalness: 0.35 });
  const weave = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.35, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.9 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd4dc, metalness: 0.95, roughness: 0.2 });
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; grp.add(o); return o; };
  const mirrorX = (fn) => [-1, 1].forEach(s => fn(s));

  // ---------------- front bumper -----------------
  if (K.front >= 1) {   // splitter lip: a thin carbon blade that sticks out past the nose, corners swept back
    add(plate([[-0.97, frontZ - 0.15], [0.97, frontZ - 0.15], [1.02, frontZ + 0.1], [0.62, frontZ + 0.3], [-0.62, frontZ + 0.3], [-1.02, frontZ + 0.1]], 0.035, 0.1), carbon);
  }
  if (K.front >= 2) {   // sport chin: body-coloured lower bumper with a black intake, small canards at the corners
    add(side([[frontZ - 0.35, 0.1], [frontZ + 0.18, 0.12], [frontZ + 0.22, 0.32], [frontZ + 0.05, 0.43], [frontZ - 0.35, 0.43]], 1.72), paint);
    add(front([[-0.62, 0.0], [0.62, 0.0], [0.56, 0.17], [-0.56, 0.17]], 0.03, frontZ + 0.205), dark, 0, 0.2, 0);
    mirrorX(s => add(side([[0, 0], [0.22, 0], [0.05, 0.18]], 0.025, s * 0.88), carbon, 0, 0.35, frontZ + 0.02));
  }
  if (K.front >= 3) {   // aggressive: huge intake, mesh slats, endplates and stacked canards
    add(front([[-0.7, 0.0], [0.7, 0.0], [0.62, 0.14], [-0.62, 0.14]], 0.05, frontZ + 0.2), dark, 0, 0.27, 0);
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(1.22, 0.012, 0.03), chrome, 0, 0.29 + i * 0.045, frontZ + 0.25);
    mirrorX(s => {
      add(new THREE.BoxGeometry(0.03, 0.2, 0.55), carbon, s * 0.98, 0.2, frontZ + 0.05);
      add(side([[0, 0], [0.3, 0], [0.08, 0.16]], 0.025, s * 0.86), carbon, 0, 0.5, frontZ - 0.1);
      add(side([[0, 0], [0.26, 0], [0.06, 0.14]], 0.025, s * 0.86), carbon, 0, 0.62, frontZ - 0.12);
    });
  }

  // ---------------- rear bumper / diffuser -----------------
  if (K.rear >= 1) {
    add(side([[rearZ + 0.4, 0.14], [rearZ - 0.02, 0.1], [rearZ - 0.3, 0.32], [rearZ - 0.3, 0.46], [rearZ + 0.4, 0.46]], 1.55), carbon);
    for (let i = -3; i <= 3; i++) add(new THREE.BoxGeometry(0.025, 0.2, 0.46), carbon, i * 0.22, 0.26, rearZ - 0.05);
  }
  if (K.rear >= 2) {    // race diffuser: taller, with a central exhaust cut-out and twin chrome pipes
    add(side([[rearZ + 0.4, 0.1], [rearZ - 0.12, 0.08], [rearZ - 0.42, 0.34], [rearZ - 0.42, 0.55], [rearZ + 0.4, 0.55]], 1.7), paint, 0, -0.01, 0);
    mirrorX(s => {
      add(new THREE.CylinderGeometry(0.075, 0.075, 0.28, 14), chrome, s * 0.5, 0.3, rearZ - 0.28, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.055, 0.055, 0.29, 14), dark, s * 0.5, 0.3, rearZ - 0.285, Math.PI / 2);
    });
  }

  // ---------------- side skirts -----------------
  if (K.skirts >= 1) {
    const t = K.skirts, drop = 0.05 + 0.04 * t, out = 0.1 + 0.05 * t, L = 1.05;
    mirrorX(s => {
      // a wedge: deepest in the middle, sweeping up at both ends, slightly proud of the body
      add(side([[-L, 0.34], [-L + 0.15, 0.34 - drop], [L - 0.15, 0.34 - drop], [L, 0.34], [L, 0.46], [-L, 0.46]], out, s * (0.92 + out / 2)), paint);
      if (t >= 2) add(new THREE.BoxGeometry(0.02, 0.025, 1.7), chrome, s * (0.92 + out), 0.34 - drop + 0.02, 0);
    });
  }

  // ---------------- wide-body arches -----------------
  if (K.fenders >= 1) (wheels || []).forEach(p => {
    const s = Math.sign(p.x) || 1, R = wheelR + 0.035, Ro = R + 0.05 + 0.02 * K.fenders, T = 0.12 + 0.06 * K.fenders, bolts = K.fenders >= 2;
    const pts = [];
    for (let a = 8; a <= 172; a += 8) pts.push([p.z + Math.cos(a * Math.PI / 180) * Ro, p.y + Math.sin(a * Math.PI / 180) * Ro]);
    for (let a = 172; a >= 8; a -= 8) pts.push([p.z + Math.cos(a * Math.PI / 180) * R, p.y + Math.sin(a * Math.PI / 180) * R]);
    const x = s * (0.93 + T / 2);
    add(side(pts, T, x), paint);
    if (bolts) for (let a = 24; a <= 156; a += 22) { const o = add(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8), chrome, x + s * T / 2, p.y + Math.sin(a * Math.PI / 180) * (R + 0.025), p.z + Math.cos(a * Math.PI / 180) * (R + 0.025)); o.rotation.z = Math.PI / 2; }
  });

  // ---------------- hood -----------------
  if (K.hood >= 1) {
    const hy = (heightAtZ(0, 0.95) ?? 0.85) + 0.012;
    if (K.hood === 1) mirrorX(s => { for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.34, 0.012, 0.035), dark, s * 0.38, hy + 0.004, 0.65 + i * 0.09); });
    if (K.hood === 2) {   // scoop
      add(side([[0.55, 0], [1.0, 0], [1.05, 0.04], [0.8, 0.13], [0.6, 0.13]], 0.56), paint, 0, hy - 0.01, 0);
      add(front([[-0.2, 0], [0.2, 0], [0.2, 0.08], [-0.2, 0.08]], 0.02, 1.045), dark, 0, hy, 0);
    }
    if (K.hood === 3) {   // carbon bonnet with twin vents and pins
      add(plate([[-0.62, 0.45], [0.62, 0.45], [0.58, 1.38], [-0.58, 1.38]], 0.02, hy), weave);
      mirrorX(s => { add(plate([[s * 0.14, 0.7], [s * 0.5, 0.7], [s * 0.5, 1.15], [s * 0.14, 1.15]], 0.025, hy + 0.02), dark); for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.34, 0.012, 0.018), chrome, s * 0.32, hy + 0.05, 0.76 + i * 0.09); });
      [[-0.54, 0.5], [0.54, 0.5], [-0.54, 1.3], [0.54, 1.3]].forEach(([x, z]) => add(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 8), chrome, x, hy + 0.02, z));
    }
  }

  // ---------------- spoiler -----------------
  if (K.spoiler >= 1) {
    const zr = rearZ + 0.3, y0 = heightAtZ(0, zr) ?? 1.0;
    if (K.spoiler === 1) add(side([[0, 0], [-0.3, 0], [-0.32, 0.06], [-0.1, 0.1]], 1.5), paint, 0, y0 - 0.01, zr + 0.1);     // lip
    else if (K.spoiler === 2) add(side([[0.1, 0], [-0.36, 0], [-0.42, 0.14], [-0.34, 0.18], [0.0, 0.07]], 1.62), paint, 0, y0 - 0.02, zr);   // ducktail
    else {
      // GT wing on swan-neck stands (3) / tall twin-stand race wing with a gurney flap (4)
      const tall = K.spoiler >= 4, y = y0 + (tall ? 0.66 : 0.42), chord = tall ? 0.46 : 0.4;
      const foil = [[chord * 0.5, 0], [chord * 0.3, 0.04], [0, 0.055], [-chord * 0.35, 0.03], [-chord * 0.5, -0.005], [-chord * 0.5, -0.03], [-chord * 0.1, -0.025], [chord * 0.35, -0.012]];
      add(side(foil, 1.66), carbon, 0, y, zr - 0.05).rotation.x = tall ? -0.16 : -0.1;
      if (tall) add(new THREE.BoxGeometry(1.66, 0.035, 0.02), carbon, 0, y + 0.07, zr - 0.05 - chord * 0.5);
      mirrorX(s => {
        add(new THREE.BoxGeometry(0.03, 0.26, chord + 0.12), carbon, s * 0.84, y + 0.01, zr - 0.05);       // end plate
        const up = tall ? [0.46] : [0.5];
        up.forEach(x => {
          add(new THREE.BoxGeometry(0.045, y - y0 + 0.02, 0.1), carbon, s * x, y0 + (y - y0) / 2, zr + (tall ? 0 : 0.03)).rotation.x = tall ? 0 : 0.12;
          if (!tall) add(new THREE.BoxGeometry(0.045, 0.1, 0.22), carbon, s * x, y - 0.05, zr - 0.1);        // the swan neck's hook
        });
      });
    }
  }
  return grp;
}
