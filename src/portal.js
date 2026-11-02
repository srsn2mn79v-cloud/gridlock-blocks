// The Marin gate (San Francisco only): a signed arch over the road at the far end of the Golden Gate loop. Drive through it and the
// game reloads in Chicago (the city is a stored choice, see menu.js / map.js: `gridlock-city`).
import * as THREE from 'three';
import { MAP, T } from './chicago/map.js';

export function createPortal({ city, scene, car, toast }) {
  if (MAP.city !== 'sf') return { update() {} };
  const [gx, gz] = T(329.8, 30);                        // the top of the Marin loop (map px)
  let best = null;
  (city.roadEdges || []).forEach(e => {
    if (e.structure !== 'surface') return;
    const a = city.roadNodes[e.from], b = city.roadNodes[e.to], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0.1, Math.min(0.9, ((gx - a.x) * dx + (gz - a.z) * dz) / L2)), px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(px - gx, pz - gz);
    if (!best || d < best.d) best = { d, px, pz, ux: dx / Math.sqrt(L2), uz: dz / Math.sqrt(L2), w: e.width };
  });
  if (!best) return { update() {} };
  const g = new THREE.Group(); g.position.set(best.px, 0, best.pz); g.rotation.y = Math.atan2(best.ux, best.uz); scene.add(g);
  const steel = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.55, metalness: 0.2 });
  const half = best.w / 2 + 2.6, H = 9;
  [-1, 1].forEach(s => { const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, H, 1.4), steel); p.position.set(s * half, H / 2, 0); g.add(p); });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 1.4, 3.6, 1.2), steel); beam.position.set(0, H + 0.4, 0); g.add(beam);
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
  const c = cv.getContext('2d');
  if (c && c.fillRect) { c.fillStyle = '#10141c'; c.fillRect(0, 0, 512, 96); c.fillStyle = '#ffd24a'; c.font = 'bold 54px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('→ CHICAGO', 256, 50); }
  const tex = new THREE.CanvasTexture(cv);
  const face = new THREE.MeshBasicMaterial({ map: tex });
  [1, -1].forEach(s => { const sg = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - 0.6, 3.0), face); sg.position.set(0, H + 0.4, s * 0.62); if (s < 0) sg.rotation.y = Math.PI; g.add(sg); });
  let armed = false;
  return {
    pos: { x: best.px, z: best.pz },
    update() {
      if (armed || (car.y || 0) > 3) return;
      if (Math.hypot(car.x - best.px, car.z - best.pz) < 5) {
        armed = true; toast('Leaving San Francisco - next stop: Chicago');
        setTimeout(() => { try { localStorage.setItem('gridlock-city', 'chicago'); } catch (e) { /* ignore */ } location.reload(); }, 1600);
      }
    }
  };
}
