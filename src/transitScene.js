// Meshes for the public transport layout: bus stop poles + shelters, the bus depot yard, painted cab stands.
import * as THREE from 'three';
import { CAR_WIDTH_K } from './carModels.js';
import { buildCarBody } from './vehicleModels.js';

function label(text, w, h, bg, fg, font = 'bold 56px sans-serif') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const q = c.getContext('2d'); q.fillStyle = bg; q.fillRect(0, 0, w, h);
  q.strokeStyle = fg; q.lineWidth = 6; q.strokeRect(5, 5, w - 10, h - 10);
  q.fillStyle = fg; q.font = font; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillText(text, w / 2, h / 2 + 3);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}

export function createTransitScene({ scene, transit, heightAt }) {
  const g = new THREE.Group(); g.name = 'transit'; scene.add(g);
  const grey = new THREE.MeshStandardMaterial({ color: 0x5b6169, roughness: 0.6, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd0e6, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x2c3a4d, roughness: 0.7 });
  const bench = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.8 });
  const signTex = label('BUS', 128, 128, '#1e5fb0', '#ffffff', 'bold 64px sans-serif');
  const signM = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0x4a7fc0, emissiveMap: signTex, emissiveIntensity: 0.35, roughness: 0.5 });
  const poleG = new THREE.CylinderGeometry(0.07, 0.07, 3.1, 8), signG = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 20), boxG = new THREE.BoxGeometry(1, 1, 1);

  // --- bus stops: a pole with a round BUS sign, a little glass shelter with a bench, and a painted kerb box ---
  const stopM = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.0, depthWrite: false });
  transit.stops.forEach(st => {
    const y = heightAt(st.x, st.z);
    const grp = new THREE.Group(); grp.position.set(st.x, y, st.z); grp.rotation.y = -st.h;   // local +x along the road, +z to the right of travel
    const pole = new THREE.Mesh(poleG, grey); pole.position.set(-3.2, 1.55, 0); grp.add(pole);
    const sign = new THREE.Mesh(signG, signM); sign.position.set(-3.2, 3.0, 0); sign.rotation.set(0, 0, Math.PI / 2); grp.add(sign);
    // shelter
    const back = new THREE.Mesh(boxG, glass); back.scale.set(4.2, 2.2, 0.05); back.position.set(0.4, 1.2, 1.1); grp.add(back);
    const side = new THREE.Mesh(boxG, glass); side.scale.set(0.05, 2.2, 1.7); side.position.set(2.5, 1.2, 0.3); grp.add(side);
    const roof = new THREE.Mesh(boxG, roofM); roof.scale.set(4.6, 0.12, 2.1); roof.position.set(0.4, 2.35, 0.2); grp.add(roof);
    [-1.7, 2.5].forEach(x => { const p = new THREE.Mesh(boxG, grey); p.scale.set(0.08, 2.3, 0.08); p.position.set(x, 1.2, -0.7); grp.add(p); });
    const seat = new THREE.Mesh(boxG, bench); seat.scale.set(2.2, 0.1, 0.5); seat.position.set(0.5, 0.55, 0.85); grp.add(seat);
    g.add(grp);
  });

  // --- depot: fenced yard, a garage hall with roller doors, flood lights, and the fleet parked nose-in ---
  let depotMesh = null;
  const d = transit.depot;
  if (d) {
    const grp = new THREE.Group(); grp.position.set(d.x, heightAt(d.x, d.z), d.z); grp.rotation.y = -d.h; depotMesh = grp;
    const sd = d.side > 0 ? 1 : -1;          // +1: the yard lies on local +z, so the road is at -z and the back wall at +z
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
    const add = (mat, w, h, l, x, y, z, cast = false) => { const m = new THREE.Mesh(boxG, mat); m.scale.set(w, h, l); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; grp.add(m); return m; };
    // ground: dark asphalt with a lighter apron and painted bay lines
    add(M(0x34373c, { roughness: 0.95 }), d.hw * 2, 0.14, d.hd * 2, 0, 0.07, 0);
    add(M(0x44474d, { roughness: 0.95 }), d.hw * 2 - 4, 0.02, 12, 0, 0.16, -sd * 1);
    const paint = new THREE.MeshBasicMaterial({ color: 0xf0f0e8 });
    for (let i = 0; i <= 4; i++) add(paint, 0.2, 0.02, 8.4, -9.2 + i * 4.6, 0.17, sd * (d.hd - 5 - 4.6));
    add(new THREE.MeshBasicMaterial({ color: 0xf2c200 }), d.hw * 2 - 2, 0.02, 0.35, 0, 0.17, -sd * (d.hd - 0.8));       // yellow line at the road edge
    // hall along the back wall
    const hallZ = sd * (d.hd - 2.6);
    add(M(0x7d8794), d.hw * 2 - 2, 5.2, 4.6, 0, 2.6, hallZ, true);
    add(M(0x2c333d), d.hw * 2 - 1.2, 0.5, 5.4, 0, 5.4, hallZ, true);                                                    // roof lip
    const door = new THREE.MeshStandardMaterial({ color: 0x1b1d22, emissive: 0xffc980, emissiveIntensity: 0.25, roughness: 0.6 });
    for (let i = 0; i < 4; i++) add(door, 4.0, 3.9, 0.12, -9.2 + 2.3 + i * 4.6 - 2.3 + 2.3, 2.0, hallZ - sd * 2.34);
    const tex = label('BUS DEPOT', 512, 128, '#14315c', '#ffd34d', 'bold 78px sans-serif');
    const board = add(new THREE.MeshStandardMaterial({ map: tex, emissive: 0x7a7448, emissiveMap: tex, emissiveIntensity: 0.55 }), 11, 2.7, 0.3, 0, 7.2, hallZ - sd * 2.2);
    add(grey, 0.3, 2.2, 0.3, -4.4, 6.0, hallZ - sd * 2.2); add(grey, 0.3, 2.2, 0.3, 4.4, 6.0, hallZ - sd * 2.2);
    // fence: posts + two rails on the sides and the road side, with a wide gap for the gate
    const fenceM = M(0x4c525a, { metalness: 0.5, roughness: 0.5 });
    const rail = (x0, z0, x1, z1) => {
      const L = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0);
      [0.6, 1.5].forEach(y => { const m = add(fenceM, L, 0.08, 0.08, (x0 + x1) / 2, y, (z0 + z1) / 2); m.rotation.y = -a; });
      for (let t = 0; t <= L + 0.01; t += 3) add(fenceM, 0.12, 1.7, 0.12, x0 + (x1 - x0) * (t / L), 0.85, z0 + (z1 - z0) * (t / L));
    };
    const fz = -sd * d.hd, bz = sd * d.hd;
    rail(-d.hw, fz, -5, fz); rail(5, fz, d.hw, fz);               // road side, 10 units open in the middle
    rail(-d.hw, fz, -d.hw, bz); rail(d.hw, fz, d.hw, bz);          // sides
    // flood lights
    const lampM = new THREE.MeshStandardMaterial({ color: 0xfff3cf, emissive: 0xffe9a8, emissiveIntensity: 1.6 });
    [[-d.hw + 1.5, fz + sd * 1.5], [d.hw - 1.5, fz + sd * 1.5], [0, bz - sd * 5.2]].forEach(([x, z]) => {
      add(grey, 0.2, 7.5, 0.2, x, 3.75, z, true); add(lampM, 1.6, 0.35, 0.6, x, 7.6, z);
    });
    // gate posts with a blue roundel
    [-5.4, 5.4].forEach(x => add(grey, 0.4, 2.6, 0.4, x, 1.3, fz, true));
    const roundel = new THREE.Mesh(signG, signM); roundel.position.set(-5.4, 3.3, fz); roundel.rotation.set(Math.PI / 2, 0, 0); grp.add(roundel);
    // the fleet, one colour per line, nose-in to the hall
    const colors = transit.lines.map(l => l.color); while (colors.length < 4) colors.push(0xd9a21b);
    for (let i = 0; i < 4; i++) {
      const b = buildCarBody('bus', colors[i]); b.scale.x = CAR_WIDTH_K; b.traverse(m => { if (m.isMesh) { m.castShadow = true; } });
      b.rotation.y = sd > 0 ? 0 : Math.PI;
      b.position.set(-6.9 + i * 4.6, 0.14, sd * (d.hd - 5 - 4.6));
      grp.add(b);
    }
    g.add(grp);
  }

  // --- cab stands: yellow bay painted in the kerb lane + a roadside TAXI sign ---
  const bayTex = label('TAXI', 256, 128, '#f2c200', '#1b1b1b', 'bold 76px sans-serif');
  const bayM = new THREE.MeshBasicMaterial({ map: bayTex, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false });
  const bayG = new THREE.PlaneGeometry(6.4, 3.0); bayG.rotateX(-Math.PI / 2);
  const flagTex = label('TAXI', 128, 128, '#f2c200', '#111', 'bold 40px sans-serif');
  const flagM = new THREE.MeshStandardMaterial({ map: flagTex, emissive: 0x806800, emissiveMap: flagTex, emissiveIntensity: 0.5 });
  transit.stands.forEach(s => {
    const y = heightAt(s.x, s.z) + 0.05;
    const bay = new THREE.Mesh(bayG, bayM); bay.position.set(s.x, y + 0.02, s.z); bay.rotation.y = -s.h; bay.renderOrder = 3; g.add(bay);
    const rx = -Math.sin(s.h), rz = Math.cos(s.h), px = s.x + rx * 3.6 - Math.cos(s.h) * 3.4, pz = s.z + rz * 3.6 - Math.sin(s.h) * 3.4;
    const pole = new THREE.Mesh(poleG, grey); pole.position.set(px, heightAt(px, pz) + 1.55, pz); g.add(pole);
    const sign = new THREE.Mesh(boxG, flagM); sign.scale.set(1.0, 0.9, 0.08); sign.position.set(px, heightAt(px, pz) + 3.0, pz); sign.rotation.y = -s.h + Math.PI / 2; g.add(sign);
  });
  return { group: g, depotMesh };
}
