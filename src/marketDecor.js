// Supermarkets (chicago.js `stations` with market: true) are real shops: a glass storefront with sliding doors under an entrance canopy, a
// big logo sign, a brand-coloured cornice, roof units, a loading dock at the back, a trolley bay, a pylon sign at the mouth of the car park
// and, for some brands, small shops attached at the side (bakery, florist, pharmacy...), each with a door, a window, an awning and a sign.
// The box of the building itself (walls, windows, roof) is the ordinary parcel from chicago.js; everything here is drawn on top of it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const css = n => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);

// the little pictures used in the logos
function glyph(g, kind, cx, cy, r, col) {
  g.save(); g.translate(cx, cy); g.fillStyle = col; g.strokeStyle = col; g.lineWidth = r * 0.14; g.lineCap = 'round';
  const poly = (n, ro, ri, rot = -Math.PI / 2) => { g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, rr = i % 2 ? ri : ro; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill(); };
  if (kind === 'leaf') { g.rotate(-0.6); g.beginPath(); g.ellipse(0, 0, r * 0.55, r, 0, 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.moveTo(0, r * 0.9); g.lineTo(0, -r * 0.8); g.stroke(); }
  else if (kind === 'burst') poly(12, r, r * 0.68);
  else if (kind === 'star') poly(5, r, r * 0.45);
  else if (kind === 'sun') { g.beginPath(); g.arc(0, 0, r * 0.5, 0, 7); g.fill(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.68, Math.sin(a) * r * 0.68); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke(); } }
  else if (kind === 'basket') { g.beginPath(); g.moveTo(-r, -r * 0.1); g.lineTo(r, -r * 0.1); g.lineTo(r * 0.7, r * 0.8); g.lineTo(-r * 0.7, r * 0.8); g.closePath(); g.fill(); g.beginPath(); g.arc(0, -r * 0.1, r * 0.62, Math.PI, 0); g.stroke(); }
  else if (kind === 'wheat') { g.beginPath(); g.moveTo(0, r); g.lineTo(0, -r * 0.8); g.stroke(); for (let i = 0; i < 4; i++) { const y = -r * 0.7 + i * r * 0.4; [-1, 1].forEach(s => { g.beginPath(); g.ellipse(s * r * 0.3, y, r * 0.16, r * 0.3, s * 0.7, 0, 7); g.fill(); }); } }
  else if (kind === 'drop') { g.beginPath(); g.moveTo(0, -r); g.bezierCurveTo(r * 0.9, r * 0.1, r * 0.7, r, 0, r); g.bezierCurveTo(-r * 0.7, r, -r * 0.9, r * 0.1, 0, -r); g.fill(); }
  else if (kind === 'flower') { for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; g.beginPath(); g.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.4, 0, 7); g.fill(); } g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.arc(0, 0, r * 0.25, 0, 7); g.fill(); }
  else if (kind === 'cross') { g.fillRect(-r * 0.25, -r, r * 0.5, r * 2); g.fillRect(-r, -r * 0.25, r * 2, r * 0.5); }
  g.restore();
}

// a sign texture: `wide` = a fascia board (picture left, name right); otherwise a pylon board (picture over name)
function signTexture(b, wide, sub) {
  const W = wide ? 512 : 256, H = wide ? 128 : 300, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), bg = css(b.trim), light = '#ffffff';
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 6; g.strokeRect(6, 6, W - 12, H - 12);
  g.fillStyle = 'rgba(255,255,255,.95)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (wide) {
    glyph(g, b.glyph, 70, H / 2, 40, light);
    let size = 64; g.font = '900 ' + size + 'px "Arial Black", system-ui, sans-serif';
    const mw = g.measureText(b.name.toUpperCase()).width; if (mw > W - 190) { size = Math.floor(size * (W - 190) / mw); g.font = '900 ' + size + 'px "Arial Black", system-ui, sans-serif'; }
    g.fillText(b.name.toUpperCase(), 130 + (W - 150) / 2, H / 2 - (sub ? 8 : 0));
    if (sub) { g.font = '700 22px system-ui, sans-serif'; g.fillText(sub, 130 + (W - 150) / 2, H / 2 + 34); }
  } else {
    glyph(g, b.glyph, W / 2, 92, 58, light);
    let size = 44; g.font = '900 ' + size + 'px "Arial Black", system-ui, sans-serif';
    const mw = g.measureText(b.name.toUpperCase()).width; if (mw > W - 30) { size = Math.floor(size * (W - 30) / mw); g.font = '900 ' + size + 'px "Arial Black", system-ui, sans-serif'; }
    g.fillText(b.name.toUpperCase(), W / 2, 188);
    g.font = '700 22px system-ui, sans-serif'; g.fillText(sub || 'SUPERMARKET', W / 2, 232);
    g.font = '800 20px system-ui, sans-serif'; g.fillText('ENTRANCE  →', W / 2, 272);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function buildMarketDecor(city, heightAt) {
  const root = new THREE.Group(), signMats = [];
  const markets = [];
  const solidM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, vertexColors: true });
  (city.stations || []).filter(st => st.market).forEach(st => {
    const info = st.info, hw = info.w / 2, hd = info.d / 2, h = info.h, theta = Math.atan2(-st.nx, -st.nz), ct = Math.cos(theta), sn = Math.sin(theta);
    const brand = { name: info.name, trim: info.trim, glyph: info.glyph };
    const grp = new THREE.Group(); grp.position.set(st.x, heightAt(st.x, st.z, 0), st.z); grp.rotation.y = theta; root.add(grp);
    const solid = [], glass = [], lights = [], mySigns = [];
    const glassM = new THREE.MeshStandardMaterial({ color: 0xa8d4ea, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide, emissive: 0xffe2a0, emissiveIntensity: 0 });
    const lightM = new THREE.MeshBasicMaterial({ color: 0xfff1cc });
    const col = new THREE.Color();
    const box = (list, w, hh, d, x, y, z, color) => {
      const g = new THREE.BoxGeometry(w, hh, d); g.translate(x, y + hh / 2, z);
      if (list === solid) { col.setHex(color); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
      list.push(g);
    };
    const cyl = (r, hh, x, y, z, color) => { const g = new THREE.CylinderGeometry(r, r, hh, 10); g.translate(x, y + hh / 2, z); col.setHex(color); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); solid.push(g); };
    const plane = (w, hh, x, y, z, tex, ry = 0) => {          // a sign board that reads from the street (and from behind when ry = PI)
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }); signMats.push(mat); mySigns.push(mat);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat); m.position.set(x, y, z); m.rotation.y = ry; grp.add(m); return m;
    };
    const TRIM = info.trim, DARK = 0x262b33, WHITE = 0xf2f2ee, STEEL = 0x9aa3ad;
    const fz = hd + 0.1;                                                              // the front wall plane (+z is toward the street)
    // ---- storefront: glass wall with mullions, a plinth, sliding doors in the middle ----
    const gw = Math.min(hw * 1.7, info.w - 3);
    box(solid, gw + 0.6, 0.5, 0.3, 0, 0, fz + 0.05, DARK);                            // plinth
    box(glass, gw, 3.3, 0.06, 0, 0.5, fz + 0.1);                                      // glass
    box(solid, gw + 0.6, 0.45, 0.36, 0, 3.8, fz + 0.08, DARK);                        // header over the glass
    for (let x = -gw / 2; x <= gw / 2 + 0.01; x += 2.4) box(solid, 0.12, 3.3, 0.14, x, 0.5, fz + 0.1, DARK);   // mullions
    if (info.glass) { box(glass, info.w - 1.4, h - 5.2, 0.08, 0, 4.4, fz + 0.12); for (let x = -hw + 0.7; x <= hw - 0.6; x += 3.2) box(solid, 0.1, h - 5.2, 0.12, x, 4.4, fz + 0.12, DARK); }   // a curtain wall above (Urban Pantry)
    // doors: two sliding leaves in a white frame, a mat, handles, lit sensor box
    box(solid, 4.2, 0.18, 0.5, 0, 0.5, fz + 0.14, WHITE); box(solid, 0.18, 3.0, 0.5, -2.1, 0.5, fz + 0.14, WHITE); box(solid, 0.18, 3.0, 0.5, 2.1, 0.5, fz + 0.14, WHITE);
    box(glass, 1.9, 2.8, 0.06, -1.0, 0.55, fz + 0.2); box(glass, 1.9, 2.8, 0.06, 1.0, 0.55, fz + 0.2); box(solid, 0.1, 1.2, 0.1, -0.12, 1.0, fz + 0.26, STEEL); box(solid, 0.1, 1.2, 0.1, 0.12, 1.0, fz + 0.26, STEEL);
    box(solid, 4.2, 0.12, 0.2, 0, 3.4, fz + 0.2, WHITE); box(lights, 0.5, 0.12, 0.1, 0, 3.3, fz + 0.32);
    box(solid, 3.6, 0.04, 1.6, 0, 0, fz + 1.0, 0x30363d);                              // door mat
    // ---- entrance canopy on two columns, with a strip light underneath ----
    box(solid, 7.6, 0.3, 3.4, 0, 4.15, fz + 1.7, TRIM); box(lights, 6.6, 0.06, 0.2, 0, 4.1, fz + 3.0);
    [-3.4, 3.4].forEach(x => cyl(0.2, 4.15, x, 0, fz + 3.1, WHITE));
    // ---- cornice in the brand colour round the top of the building, and the big logo above the canopy ----
    box(solid, info.w + 0.5, 0.55, info.d + 0.5, 0, h - 0.55, 0, TRIM);
    const fasciaW = Math.min(info.w * 0.66, 15), fasciaH = fasciaW / 4;
    const signY = Math.min(h - 1.0 - fasciaH / 2, 5.05 + fasciaH / 2);
    box(solid, fasciaW + 0.3, fasciaH + 0.3, 0.2, 0, signY - fasciaH / 2 - 0.15, fz + 0.1, DARK);
    plane(fasciaW, fasciaH, 0, signY, fz + 0.26, signTexture(brand, true, 'SUPERMARKET'));
    // ---- roof: air-conditioning units and vents (not on the pitched roofs) ----
    if (!info.roof || info.roof === 'flat') {
      const nU = info.roofUnits || 3;
      for (let i = 0; i < nU; i++) { const x = (i - (nU - 1) / 2) * (info.w / (nU + 0.5)), z = -hd * 0.3 + (i % 2) * hd * 0.5; box(solid, 2.6, 1.2, 1.7, x, h, z, 0xb4b9bf); cyl(0.5, 0.25, x - 0.5, h + 1.2, z, 0x4a5058); }
      cyl(0.35, 1.6, hw * 0.7, h, hd * 0.2, 0x8b9096);
    }
    // ---- sides and back: a staff door each side, the loading dock behind with roller doors and a bumper ramp ----
    [-1, 1].forEach(s => box(solid, 0.12, 2.3, 1.3, s * (hw + 0.07), 0, hd * 0.2, 0x4a4f57));
    box(solid, info.w * 0.5, 1.2, 2.4, 0, 0, -hd - 1.3, 0x7f858c);
    [-1, 1].forEach(s => box(solid, 3.4, 3.1, 0.12, s * info.w * 0.17, 1.2, -hd - 0.08, 0x6d7279));
    // ---- trolley bay beside the entrance: a little roofed shelter and a row of trolleys ----
    {
      const bx = hw * 0.62, bz = fz + 3.4;
      box(solid, 5.2, 0.12, 2.2, bx, 2.2, bz, STEEL); [-2.4, 2.4].forEach(dx => [-0.9, 0.9].forEach(dz => box(solid, 0.08, 2.2, 0.08, bx + dx, 0, bz + dz, STEEL)));
      for (let i = 0; i < 9; i++) { const x = bx - 2.2 + i * 0.52; box(solid, 0.42, 0.5, 0.7, x, 0.55, bz, 0x9fa6ad); box(solid, 0.42, 0.06, 0.8, x, 0.35, bz, 0x4a4f57); box(solid, 0.42, 0.45, 0.06, x, 1.0, bz - 0.4, 0x6f757c); }
    }
    // ---- the pylon sign at the mouth of the car park (both faces), so the way in is obvious from the street ----
    {
      const mx = st.mouth.x - st.x, mz = st.mouth.z - st.z, lx = mx * ct - mz * sn, lz = mx * sn + mz * ct;     // the mouth in the building's frame
      const px = lx + 11.2, pz = lz + 4.5, tex = signTexture(brand, false, 'SUPERMARKET');
      cyl(0.22, 6.2, px, 0, pz, DARK); box(solid, 0.3, 4.0, 3.5, px, 5.2, pz, DARK);
      plane(3.3, 3.8, px + 0.18, 7.2, pz, tex, Math.PI / 2); plane(3.3, 3.8, px - 0.18, 7.2, pz, tex, -Math.PI / 2);      // perpendicular to the street: the faces look along it, so drivers see the sign head-on
      const ty = 6.2; box(solid, 0.5, 0.2, 3.6, px, ty - 0.1, pz, TRIM);
      // painted arrows into the lot, in both lanes of the driveway
      for (const dx of [-3.2, 3.2]) { const ax = lx + dx; box(solid, 0.3, 0.02, 3.0, ax, 0.06, lz - 5.5, WHITE); box(solid, 1.6, 0.02, 0.3, ax - (dx < 0 ? -0.0 : 0), 0.06, lz - 4.2, WHITE); }
      box(solid, 7.0, 0.02, 0.3, lx, 0.06, lz - 1.0, WHITE);                           // a white line across the driveway
    }
    // ---- side shops: each a storefront with a door, a big window, a striped awning and its own sign ----
    (st.units || []).forEach(u => {
      const side = u.lat > 0 ? 1 : -1, ux = u.lat, uf = hd + 0.1, uw = u.w, ub = { name: u.name, trim: u.color, glyph: u.glyph };
      box(solid, uw + 0.4, 0.5, info.d > 0 ? 0.3 : 0.3, ux, 0, uf + 0.05, DARK);
      box(glass, uw - 3.2, 2.4, 0.06, ux - side * 0.9, 0.7, uf + 0.1);                  // shop window
      box(solid, 0.1, 2.4, 0.12, ux - side * 0.9, 0.7, uf + 0.12, DARK);
      box(solid, 1.4, 2.5, 0.16, ux + side * (uw / 2 - 1.5), 0, uf + 0.12, DARK);        // the door
      box(glass, 1.0, 2.0, 0.06, ux + side * (uw / 2 - 1.5), 0.3, uf + 0.22);
      for (let i = 0; i < 8; i++) box(solid, uw / 8, 0.12, 1.5, ux - uw / 2 + uw / 16 + i * uw / 8, 3.3 - i % 2 * 0.0, uf + 0.8, i % 2 ? 0xf4f1e8 : u.color);   // awning stripes
      box(solid, uw + 0.5, 0.45, 0.5, 0, 0, 0, 0);                                      // (placeholder, removed below)
      solid.pop();
      box(solid, uw + 0.4, 0.5, u.d + 0.4, ux, 4.6 - 0.5, (u.d - info.d) / 2, u.color);  // cornice in the shop's colour
      plane(uw * 0.8, uw * 0.8 / 4, ux, 4.0, uf + 0.2, signTexture(ub, true, null));
    });
    const sm = new THREE.Mesh(mergeGeometries(solid, false), solidM); sm.castShadow = true; sm.receiveShadow = true; grp.add(sm);
    grp.add(new THREE.Mesh(mergeGeometries(glass, false), glassM));
    grp.add(new THREE.Mesh(mergeGeometries(lights, false), lightM));
    markets.push({ st, glassM, lightM, signs: mySigns, hours: info.hours || '24/7' });
  });
  // each frame (cheap): the storefront glows when the shop is open after dark; a shop that is shut goes dark, its sign dim
  root.userData.update = (hour, nightK) => {
    for (const m of markets) {
      const open = m.hours === '24/7' || (hour >= m.hours[0] && hour < m.hours[1]);
      m.glassM.emissiveIntensity = open ? 0.15 + 1.1 * nightK : 0;
      m.lightM.color.setScalar(open ? 1 : 0.18);
      m.signs.forEach(mat => mat.color.setScalar(open ? 1 : 0.25 + 0.75 * (1 - nightK)));
    }
  };
  root.userData.signMats = signMats;
  return root;
}
