// The airport: a runway with painted markings, parked airliners, a plane that lands and takes off now and then, and a Departures gate.
// Park at the gate and hold still for a moment: you board a flight to the other city (the city is a stored choice, see map.js).
// The map says where: map.airport = {at:[X,Y] near the terminal (the gate is the nearest road point), rwy:[[X,Y],[X,Y]], dest:'sf'|'chicago', name}.
import * as THREE from 'three';
import { MAP, T } from './chicago/map.js';

const CITY_NAMES = { chicago: 'CHICAGO', sf: 'SAN FRANCISCO' };

function planeMesh(body = 0xf2f3f4, accent = 0x2a6db8, scale = 1) {
  const g = new THREE.Group(), M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.5, metalness: 0.2 }, o));
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 30, 14), M(body)); fus.rotation.z = Math.PI / 2; g.add(fus);          // long axis along +x (nose at +x)
  const nose = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(body)); nose.rotation.z = -Math.PI / 2; nose.position.x = 15; nose.scale.set(1.5, 1, 1); g.add(nose);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 0.7, 9, 12), M(body)); tail.rotation.z = Math.PI / 2; tail.position.x = -19; g.add(tail);
  const cock = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 3.2), M(0x1e2a36)); cock.position.set(16.2, 0.9, 0); g.add(cock);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(2.43, 2.43, 22, 14, 1, true), M(accent)); stripe.rotation.z = Math.PI / 2; stripe.position.x = -1; stripe.scale.set(1, 1, 1); g.add(stripe);
  const wingGeo = new THREE.BoxGeometry(6, 0.5, 17); [1, -1].forEach(s => { const w = new THREE.Mesh(wingGeo, M(0xd9dde0)); w.position.set(-1, -1, s * 10); w.rotation.y = -s * 0.5; g.add(w);
    const en = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4, 10), M(0x9aa3ab)); en.rotation.z = Math.PI / 2; en.position.set(1.8, -2.2, s * 8.6); g.add(en); });
  const fin = new THREE.Mesh(new THREE.BoxGeometry(5, 8, 0.5), M(accent)); fin.position.set(-20, 5, 0); fin.rotation.z = -0.35; g.add(fin);
  [1, -1].forEach(s => { const st = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.4, 8), M(0xd9dde0)); st.position.set(-20.5, 0.8, s * 4.5); st.rotation.y = -s * 0.4; g.add(st); });
  [[11, 0], [-3, 3.2], [-3, -3.2]].forEach(([x, z]) => { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.7, 10), M(0x1b1d20)); wh.rotation.x = Math.PI / 2; wh.position.set(x, -3.1, z); g.add(wh); });
  g.scale.setScalar(scale); g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function createAirport({ city, scene, car, toast, collisionWorld }) {
  const A = MAP.airport; if (!A) return { update() {} };
  const g = new THREE.Group(); g.name = 'airport'; scene.add(g);
  const [ax, az] = T(A.rwy[0][0], A.rwy[0][1]), [bx, bz] = T(A.rwy[1][0], A.rwy[1][1]);
  const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2, yaw = Math.atan2(ux, uz);
  const Y = A.y != null ? A.y : 0.17, W = A.width || 26;
  // ---- runway ----
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 1024; const q = cv.getContext('2d');
  if (q && q.fillRect) {
    q.fillStyle = '#2b2e33'; q.fillRect(0, 0, 128, 1024);
    q.fillStyle = '#e9e9e4'; for (let y = 120; y < 900; y += 64) q.fillRect(61, y, 6, 36);                                        // centre dashes
    q.fillRect(6, 0, 4, 1024); q.fillRect(118, 0, 4, 1024);                                                                      // edge lines
    for (let k = 0; k < 6; k++) { q.fillRect(18 + k * 16, 18, 8, 70); q.fillRect(18 + k * 16, 936, 8, 70); }                      // threshold bars
    q.fillStyle = '#e9e9e4'; q.font = 'bold 40px sans-serif'; q.textAlign = 'center'; q.save(); q.translate(64, 150); q.fillText(A.num0 || '18', 0, 0); q.restore(); q.save(); q.translate(64, 910); q.rotate(Math.PI); q.fillText(A.num1 || '36', 0, 0); q.restore();
  }
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const rw = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  rw.rotation.x = -Math.PI / 2; rw.rotation.z = -yaw; rw.position.set(mx, Y, mz); rw.receiveShadow = true; rw.material.polygonOffset = true; rw.material.polygonOffsetFactor = -2; g.add(rw);
  // runway edge lights (blue) and end lights (green)
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0x66aaff, emissiveIntensity: 0.1 }), endMat = new THREE.MeshStandardMaterial({ color: 0xccffcc, emissive: 0x22ff66, emissiveIntensity: 0.1 });
  { const pts = []; for (let s = 6; s < L; s += 20) { pts.push([-1, s], [1, s]); }
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 5), lampMat, pts.length), m4 = new THREE.Matrix4();
    pts.forEach(([side, s], i) => { m4.makeTranslation(ax + ux * s - uz * side * (W / 2 + 0.8), Y + 0.25, az + uz * s + ux * side * (W / 2 + 0.8)); im.setMatrixAt(i, m4); }); g.add(im);
    const em = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 6, 5), endMat, 12); for (let i = 0; i < 6; i++) { [0, L].forEach((s, k) => { m4.makeTranslation(ax + ux * s - uz * (-W / 2 + (i + 0.5) * W / 6), Y + 0.25, az + uz * s + ux * (-W / 2 + (i + 0.5) * W / 6)); em.setMatrixAt(i + k * 6, m4); }); } g.add(em); }
  // ---- parked airliners on the apron side of the runway ----
  const side = A.apronSide || 1, parked = [];
  [0.22, 0.5, 0.78].forEach((k, i) => {
    const pl = planeMesh([0xf2f3f4, 0xf4efe6, 0xe8eef4][i], [0x2a6db8, 0xc0392b, 0x1f8f5b][i]);
    const ox = mx - uz * 0 + (-uz) * side * (W / 2 + 22) + ux * (k - 0.5) * L * 0.8, oz = mz + ux * side * (W / 2 + 22) + uz * (k - 0.5) * L * 0.8;
    pl.position.set(ox, Y + 3.6, oz); pl.rotation.y = yaw - Math.PI / 2 + (i % 2 ? Math.PI : 0) * 0 + Math.PI * 0; g.add(pl); parked.push(pl);
    if (collisionWorld) collisionWorld.push({ kind: 'parcel', footprint: [[ox - 9, oz - 9], [ox + 9, oz - 9], [ox + 9, oz + 9], [ox - 9, oz + 9]], blocksCar: true, destructible: false, response: 'bounce', destroyed: false });
  });
  // ---- a plane that lands and takes off, one after the other ----
  const fly = planeMesh(0xf6f6f2, 0xd8392b, 1.15); g.add(fly);
  const CYCLE = 150;
  const placeFlyer = t => {
    const ph = (t + 20) % CYCLE;               // 0..75: landing (from the +u end towards -u... see below), 75..150: take-off the other way
    let s, alt, dirv = 1, vis = true;
    if (ph < 70) { const k = ph / 70; dirv = 1; s = -700 + k * (700 + L * 0.8); alt = k < 0.55 ? 90 * (1 - k / 0.55) ** 1.2 + 0 : 0; if (k > 0.55) s = Math.min(s, L * 0.8); }          // landing run along +u
    else if (ph < 100) { vis = false; s = 0; alt = 0; }
    else { const k = (ph - 100) / 50; dirv = -1; const a = 0.02 + k * k * 1.7; s = L * 0.9 - k * k * (L * 0.9 + 900) * 1.0; alt = Math.max(0, (k - 0.35) * 120) ; }
    fly.visible = vis; if (!vis) return;
    const sx = ax + ux * s, sz = az + uz * s;
    fly.position.set(sx, Y + 3.8 + alt, sz); fly.rotation.y = yaw - Math.PI / 2 + (dirv < 0 ? Math.PI : 0); fly.rotation.z = (dirv > 0 ? 1 : -1) * (alt > 2 ? 0.0 : 0) ;
  };
  // ---- the Departures gate: the nearest road point to A.at ----
  const [gx0, gz0] = T(A.at[0], A.at[1]); let gate = null;
  (city.roadEdges || []).forEach(e => {
    if (e.structure && e.structure !== 'surface') return;
    const a = city.roadNodes[e.from], b = city.roadNodes[e.to], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0.15, Math.min(0.85, ((gx0 - a.x) * dx + (gz0 - a.z) * dz) / l2)), px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(px - gx0, pz - gz0);
    if (Math.abs(a.elevation || 0) > 0.3 || Math.abs(b.elevation || 0) > 0.3) return;
    if (!gate || d < gate.d) gate = { d, px, pz, w: e.width, ux: dx / Math.sqrt(l2), uz: dz / Math.sqrt(l2) };
  });
  let hold = 0, boarding = false, glow = null, board = null;
  const destName = CITY_NAMES[A.dest] || String(A.dest).toUpperCase();
  if (gate) {
    const gg = new THREE.Group(); gg.position.set(gate.px, 0, gate.pz); g.add(gg);
    glow = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.6, 40), new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.3; gg.add(glow);
    const c2 = document.createElement('canvas'); c2.width = 512; c2.height = 160; const k2 = c2.getContext('2d');
    if (k2 && k2.fillRect) { k2.fillStyle = '#0d2342'; k2.fillRect(0, 0, 512, 160); k2.fillStyle = '#ffffff'; k2.font = 'bold 34px sans-serif'; k2.textAlign = 'center'; k2.fillText('✈ DEPARTURES', 256, 52); k2.fillStyle = '#ffd24a'; k2.font = 'bold 40px sans-serif'; k2.fillText(destName, 256, 112); }
    const stex = new THREE.CanvasTexture(c2), sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.5), new THREE.MeshBasicMaterial({ map: stex })); sign.position.set(-gate.uz * (gate.w / 2 + 3.5), 5.6, gate.ux * (gate.w / 2 + 3.5)); sign.rotation.y = Math.atan2(gate.ux, gate.uz); gg.add(sign);
    const sign2 = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.5), new THREE.MeshBasicMaterial({ map: stex })); sign2.position.copy(sign.position); sign2.rotation.y = sign.rotation.y + Math.PI; gg.add(sign2);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.6, 0.3), new THREE.MeshStandardMaterial({ color: 0x30353b })); post.position.set(sign.position.x, 2.8, sign.position.z); gg.add(post);
    board = gg;
  }
  const veil = document.createElement('div'); veil.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity 1.2s;z-index:9999;display:flex;align-items:center;justify-content:center;color:#fff;font:600 22px system-ui';
  document.body.appendChild(veil);
  let t = 0;
  return {
    gate, update(dt, night = 1) {
      t += dt; placeFlyer(t); lampMat.emissiveIntensity = 0.1 + 2 * night; endMat.emissiveIntensity = 0.1 + 2 * night;
      if (!gate || boarding) return;
      const d = Math.hypot(car.x - gate.px, car.z - gate.pz);
      if (glow) glow.material.opacity = 0.55 + 0.3 * Math.sin(t * 3);
      if (d < 7 && Math.abs(car.speed || 0) < 2 && (car.y || 0) < 2) {
        hold += dt; if (hold < dt * 1.5) toast('Hold still to board the flight to ' + destName);
        if (hold > 1.8) {
          boarding = true; veil.textContent = '✈  Flying to ' + destName + '…'; veil.style.opacity = '1';
          setTimeout(() => { try { localStorage.setItem('gridlock-city', A.dest); } catch (e) { /* ignore */ } location.reload(); }, 1800);
        }
      } else hold = 0;
    }
  };
}
