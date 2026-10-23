// Real lighting for the inside of a flat or shop: warm lamp lights (the first one casts shadows), a cool "sky" fill by the windows,
// and patches of direct sunlight on the floor that follow the sun through each window. The lights are children of the flat's
// group, so they only exist (and only cost anything) while that group is visible.
import * as THREE from 'three';

let mullionTex = null;
function mullion() {
  if (mullionTex) return mullionTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const q = c.getContext('2d');
  const g = q.createRadialGradient(32, 32, 4, 32, 32, 46); g.addColorStop(0, 'rgba(255,238,200,1)'); g.addColorStop(0.7, 'rgba(255,230,180,0.9)'); g.addColorStop(1, 'rgba(255,225,170,0.5)');
  q.fillStyle = g; q.fillRect(0, 0, 64, 64);
  q.fillStyle = 'rgba(0,0,0,0.9)'; q.fillRect(30, 0, 4, 64); q.fillRect(0, 30, 64, 4);       // the window bars cast their shadow
  return (mullionTex = new THREE.CanvasTexture(c));
}

export function createFlatLights(I) {
  const g = new THREE.Group(); g.name = 'flatlights'; I.group.add(g);
  const lamps = [], MAXL = 5;
  (I.lamps || []).slice().sort((a, b) => (b.cast ? 1 : 0) - (a.cast ? 1 : 0) || b.k - a.k).slice(0, MAXL).forEach((l, i) => {
    const pl = new THREE.PointLight(0xffd6a0, 26 * l.k, 12, 2); pl.position.set(l.x, l.y, l.z);
    if (l.cast && i === 0) { pl.castShadow = true; pl.shadow.mapSize.set(512, 512); pl.shadow.bias = -0.004; pl.shadow.normalBias = 0.03; pl.shadow.camera.near = 0.15; pl.shadow.camera.far = 14; pl.shadow.radius = 4; }
    g.add(pl); lamps.push({ pl, base: 26 * l.k });
  });
  const sky = [], wins = I.windows || [];
  for (let i = 0; i < wins.length; i += Math.max(1, Math.ceil(wins.length / 2))) {
    const w = wins[i], pl = new THREE.PointLight(0xcfe3ff, 0, 10, 2); pl.position.set(w.x, (w.y0 + w.y1) / 2, 0.9); g.add(pl); sky.push(pl);
  }
  // sun patches
  const mat = new THREE.MeshBasicMaterial({ map: mullion(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, color: 0xffe2b0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
  const patches = wins.map(w => {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2)); geo.setIndex([0, 1, 2, 1, 3, 2]);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial(Object.assign({}, { map: mullion(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, color: 0xffe2b0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
    m.frustumCulled = false; m.visible = false; g.add(m); return { m, w };
  });
  return {
    // dir = the way sunlight travels, in the flat's local frame (z into the building); day 0..1 (night..noon); lampK 0.5..1
    update(dir, day, lampK) {
      lamps.forEach(l => { l.pl.intensity = l.base * lampK; });
      sky.forEach(pl => { pl.intensity = 22 * day; });
      const ok = dir.y < -0.12 && dir.z > 0.05 && day > 0.05;
      patches.forEach(({ m, w }) => {
        m.visible = ok; if (!ok) return;
        const kz = -1 / dir.y, kx = dir.x * kz * -1 * -1, p = m.geometry.attributes.position, D = I.D - 0.3;
        // a window point at height y lands on the floor at z = y * dir.z / -dir.y, x shifted by y * dir.x / -dir.y
        const zA = Math.min(D, w.y0 * dir.z * kz), zB = Math.min(D, w.y1 * dir.z * kz);
        const xA = w.y0 * dir.x * kz, xB = w.y1 * dir.x * kz;
        const hw = w.w / 2, f = 0.02;
        p.setXYZ(0, w.x - hw + xA, f, zA); p.setXYZ(1, w.x + hw + xA, f, zA); p.setXYZ(2, w.x - hw + xB, f, zB); p.setXYZ(3, w.x + hw + xB, f, zB);
        p.needsUpdate = true; m.material.opacity = Math.min(0.32, 0.32 * day);
      });
    }
  };
}
