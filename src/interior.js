// The cockpit: a dashboard with a working instrument cluster (speedo, rev counter, gear, fuel gauge, indicator and
// headlight tell-tales), a steering wheel that turns with the car, light buttons on the dash, seats and pillars.
// It is a child of the car's group (so it moves/rolls with the body) and is only shown from the "inside" camera.
// At night - or with the headlights on - the cluster is backlit and the dash glows softly.
import * as THREE from 'three';

const CW = 512, CH = 224;

export function createInterior({ car, input }) {
  const root = new THREE.Group(); root.visible = false; car.group.add(root);
  const mat = (c, r = 0.85, m = 0.05) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const plastic = mat(0x23262c), plasticL = mat(0x30343b), leather = mat(0x1b1d22, 0.95), headliner = mat(0x4b4f57, 1), trim = mat(0x8d949f, 0.4, 0.6);
  const add = (geo, m, x, y, z, parent = root) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // ---- dash, console, panels ----
  add(box(1.72, 0.16, 0.5), plastic, 0, 0.78, 0.92);                    // dash top
  add(box(1.72, 0.3, 0.12), plastic, 0, 0.62, 0.7);                     // dash face
  const binnacle = add(box(0.66, 0.3, 0.2), plasticL, 0.4, 0.92, 0.72); binnacle.rotation.x = -0.25;
  add(box(0.3, 0.34, 0.8), plasticL, 0, 0.42, 0.25);                    // centre console
  add(box(0.08, 0.5, 2.3), plastic, 0.9, 0.42, -0.2); add(box(0.08, 0.5, 2.3), plastic, -0.9, 0.42, -0.2);   // door cards
  add(box(0.06, 0.1, 2.3), trim, 0.9, 0.7, -0.2); add(box(0.06, 0.1, 2.3), trim, -0.9, 0.7, -0.2);
  // seats
  [0.42, -0.42].forEach(x => { add(box(0.5, 0.14, 0.55), leather, x, 0.42, -0.1); add(box(0.5, 0.62, 0.13), leather, x, 0.76, -0.4); add(box(0.24, 0.16, 0.1), leather, x, 1.16, -0.4); });
  add(box(1.55, 0.16, 0.5), leather, 0, 0.42, -1.1); add(box(1.55, 0.55, 0.13), leather, 0, 0.72, -1.38);
  // roof, pillars, mirror
  add(box(1.84, 0.05, 1.6), headliner, 0, 1.46, -0.5);
  [0.88, -0.88].forEach(x => {
    const a = add(box(0.07, 0.07, 0.85), plastic, x, 1.17, 0.42); a.rotation.x = 0.62;                    // A pillar
    add(box(0.07, 0.62, 0.08), plastic, x, 1.15, -1.3);                                                  // C pillar
    add(box(0.07, 0.07, 0.8), plastic, x, 1.44, -0.35);                                                  // roof rail
  });
  add(box(1.84, 0.06, 0.1), plastic, 0, 1.46, 0.78);                                                      // header rail
  const mirror = add(box(0.26, 0.07, 0.04), plastic, 0.05, 1.3, 0.66); mirror.rotation.x = 0.1;
  [0.99, -0.99].forEach(x => { const m = add(box(0.05, 0.13, 0.2), plastic, x, 0.98, 0.7); m.rotation.y = x > 0 ? -0.2 : 0.2; });   // door mirrors
  const hood = add(box(1.58, 0.1, 1.2), mat(0x888888, 0.35, 0.5), 0, 0.82, 1.55); hood.rotation.x = 0.09;
  root.userData.hood = hood;

  // ---- steering wheel (turns with the car) ----
  const wheel = new THREE.Group(); wheel.position.set(0.4, 0.7, 0.4); wheel.rotation.x = 0.5; root.add(wheel);
  const spin = new THREE.Group(); wheel.add(spin);
  add(new THREE.TorusGeometry(0.19, 0.024, 10, 36), plastic, 0, 0, 0, spin);
  add(box(0.34, 0.035, 0.03), plastic, 0, 0, 0, spin); add(box(0.035, 0.17, 0.03), plastic, 0, -0.09, 0, spin);
  add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16), trim, 0, 0, 0, spin).rotation.x = Math.PI / 2;
  add(box(0.04, 0.04, 0.34), plasticL, 0, 0, 0.2, wheel).position.set(0, 0, 0.16);   // column

  // ---- instrument cluster: a canvas drawn every frame ----
  const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH; const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.262), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.position.set(0.4, 0.92, 0.615); face.rotation.set(-0.25, Math.PI, 0); root.add(face);
  // soft glow behind the cluster / over the dash at night
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = add(new THREE.PlaneGeometry(1.5, 0.36), glowMat, 0, 0.865, 0.665); glow.rotation.set(-1.25, Math.PI, 0);

  // ---- light buttons on the dash: left indicator, headlights, right indicator ----
  const btns = [];
  const BTN = [['blinkerLeft', '◀', 0.04], ['lightsOn', '☀', -0.065], ['blinkerRight', '▶', -0.17]];
  const lab = document.createElement('canvas'); lab.width = 256; lab.height = 64; const lg = lab.getContext('2d');
  BTN.forEach(([key, sym, x]) => {
    const m = new THREE.MeshStandardMaterial({ color: 0x333840, roughness: 0.5, emissive: 0x000000 });
    const b = add(new THREE.CylinderGeometry(0.036, 0.036, 0.03, 18), m, x, 0.66, 0.635); b.rotation.x = Math.PI / 2 - 0.1;
    b.userData = { key }; const hit = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); hit.userData = { key }; hit.position.copy(b.position); root.add(hit);
    btns.push({ key, mesh: b, hit, mat: m, x });
  });
  const labels = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.06), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  labels.position.set(-0.065, 0.605, 0.645); labels.rotation.set(-0.1, Math.PI, 0); root.add(labels);

  const drawDial = (cx, cy, r, v, maxV, step, labelEvery, label, redFrom, A, dim) => {
    g.strokeStyle = `rgba(${A}, ${0.25 * dim})`; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
    const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
    for (let i = 0; i <= maxV / step; i++) {
      const val = i * step, a = a0 + span * val / maxV, big = i % labelEvery === 0, red = redFrom != null && val >= redFrom;
      g.strokeStyle = red ? `rgba(255,70,60,${dim})` : `rgba(${A},${dim})`; g.lineWidth = big ? 4 : 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); g.lineTo(cx + Math.cos(a) * (r - (big ? 17 : 11)), cy + Math.sin(a) * (r - (big ? 17 : 11))); g.stroke();
      if (big) { g.fillStyle = red ? `rgba(255,90,80,${dim})` : `rgba(${A},${dim})`; g.font = 'bold 15px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label(val), cx + Math.cos(a) * (r - 32), cy + Math.sin(a) * (r - 32)); }
    }
    const a = a0 + span * Math.max(0, Math.min(1, v / maxV));
    g.strokeStyle = `rgba(255,90,60,${Math.min(1, dim + 0.2)})`; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12); g.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); g.stroke();
    g.fillStyle = '#10141a'; g.beginPath(); g.arc(cx, cy, 9, 0, 7); g.fill();
  };
  let acc = 0;
  function paint(st) {
    const dim = st.lit ? 1 : 0.62, A = st.lit ? '120,230,255' : '170,200,210';
    g.fillStyle = st.lit ? '#04070b' : '#0c1015'; g.fillRect(0, 0, CW, CH);
    const top = Math.max(120, Math.ceil(st.maxKmh / 20) * 20);
    drawDial(100, 116, 88, st.kmh, top, 10, top > 200 ? 4 : 2, v => String(v), null, A, dim);
    drawDial(412, 116, 88, st.rpm * 8, 8, 0.5, 2, v => String(v), 6.8, A, dim);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = `rgba(${A},${dim})`; g.font = 'bold 40px system-ui'; g.fillText(String(Math.round(st.kmh)), 100, 150); g.font = 'bold 13px system-ui'; g.fillText('km/h', 100, 176);
    g.font = 'bold 12px system-ui'; g.fillText('x1000 rpm', 412, 176);
    // centre: gear, fuel gauge, tell-tales
    g.fillStyle = st.rpm > 0.88 ? '#ff4a3c' : '#ffd21f'; g.font = 'bold 62px system-ui'; g.fillText(String(st.gear), 256, 78);
    g.fillStyle = `rgba(${A},${dim})`; g.font = 'bold 12px system-ui'; g.fillText('GEAR', 256, 118);
    g.strokeStyle = `rgba(${A},${dim})`; g.lineWidth = 2; g.strokeRect(206.5, 148.5, 99, 14);
    g.fillStyle = st.fuel < 0.12 ? '#ff3b30' : '#38e07b'; g.fillRect(208, 150, 96 * Math.max(0, Math.min(1, st.fuel)), 11);
    g.fillStyle = `rgba(${A},${dim})`; g.font = 'bold 12px system-ui'; g.fillText('E', 197, 156); g.fillText('F', 315, 156); g.fillText('⛽ ' + Math.round(st.fuel * 100) + '%', 256, 178);
    g.font = 'bold 34px system-ui';
    g.fillStyle = st.blinkL ? '#3dff5c' : 'rgba(60,110,70,.45)'; g.fillText('◀', 214, 30); g.fillStyle = st.blinkR ? '#3dff5c' : 'rgba(60,110,70,.45)'; g.fillText('▶', 298, 30);
    g.font = 'bold 24px system-ui'; g.fillStyle = st.lights ? '#4aa3ff' : 'rgba(60,80,110,.4)'; g.fillText('☀', 256, 28);
    if (st.fuel < 0.12) { g.fillStyle = '#ff3b30'; g.font = 'bold 14px system-ui'; g.fillText('LOW FUEL', 256, 200); }
    tex.needsUpdate = true;
  }
  const drawLabels = lit => {
    const c = lab; lg.clearRect(0, 0, 256, 64); lg.fillStyle = lit ? 'rgba(255,200,120,.95)' : 'rgba(180,185,195,.6)'; lg.font = 'bold 26px system-ui'; lg.textAlign = 'center'; lg.textBaseline = 'middle';
    lg.fillText('IND', 28, 32); lg.fillText('LIGHTS', 128, 32); lg.fillText('IND', 228, 32);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; labels.material.map = t; labels.material.needsUpdate = true;
  };
  let lastLit = null;

  return {
    root, buttons: btns.map(b => b.hit), wheel: spin,
    setVisible(v) { root.visible = v; },
    // body paint for the hood and a taller/longer layout for big vehicles
    fit() {
      const st = car.model && car.model.userData.style, k = Math.max(0.9, Math.min(1.3, (car.dimLen || 3.6) / 3.6));
      const h = ((car.dimHeight || 1.5) - 1.5) * 0.75;
      root.position.y = h; root.scale.set(1, 1, k > 1.1 ? 1.1 : 1);
      if (st && st.color != null) hood.material.color.set(car.paintColor != null ? car.paintColor : st.color);
    },
    update(dt, st) {
      if (!root.visible) return;
      spin.rotation.z = -(car.steerAngle || 0) * 2.4;       // a left turn rotates the wheel counter-clockwise, as seen by the driver
      if (st.lit !== lastLit) { lastLit = st.lit; drawLabels(st.lit); glowMat.opacity = 0; }
      glowMat.opacity += ((st.lit ? 0.16 : 0) - glowMat.opacity) * Math.min(1, dt * 4);
      btns.forEach(b => { const on = b.key === 'lightsOn' ? st.lights : b.key === 'blinkerLeft' ? st.blinkL : st.blinkR; b.mat.emissive.set(on ? (b.key === 'lightsOn' ? 0x2d7bff : 0x22cc44) : 0x000000); b.mat.emissiveIntensity = on ? 1.4 : 0; b.mesh.position.z = on ? 0.628 : 0.635; });
      acc += dt; if (acc > 1 / 30) { acc = 0; paint(st); }
    }
  };
}
