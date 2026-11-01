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

  // ---- the cabin shell: dash, doors, seats, roof, pillars and mirrors. It is rebuilt per car (see PROFILES) in fit() ----
  const shell = new THREE.Group(); root.add(shell);
  const glassM = new THREE.MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.16, depthWrite: false });
  const mirrorM = new THREE.MeshStandardMaterial({ color: 0xcfd8e0, roughness: 0.05, metalness: 0.9 });
  const cyl = (rt, rb, h, n = 16) => new THREE.CylinderGeometry(rt, rb, h, n);
  const PROFILES = {
    _:       { leather: 0x1b1d22, plastic: 0x23262c, trim: 0x8d949f, roof: 1.46, dash: 0.78, wedge: 0.0, thick: 0.07, vents: 'bar', shift: 'stick', seat: 'bench' },
    hatch:   { leather: 0x2b2f38, plastic: 0x2a2d33, trim: 0xd9593a, roof: 1.46, dash: 0.78, wedge: 0.0, thick: 0.07, vents: 'round', shift: 'stick', seat: 'bucket' },
    taxi:    { leather: 0x3a352a, plastic: 0x2d2b26, trim: 0xf4c400, roof: 1.46, dash: 0.78, wedge: 0.0, thick: 0.07, vents: 'bar', shift: 'column', seat: 'bench', meter: true },
    van:     { leather: 0x3b3f46, plastic: 0x363a40, trim: 0xb7bcc4, roof: 1.62, dash: 0.84, wedge: 0.0, thick: 0.08, vents: 'bar', shift: 'column', seat: 'bench', tall: 0.16 },
    bus:     { leather: 0x2c4a7a, plastic: 0x2c3036, trim: 0xd9a21b, roof: 1.62, dash: 0.84, wedge: 0.0, thick: 0.09, vents: 'bar', shift: 'column', seat: 'bench', tall: 0.2 },
    pickup:  { leather: 0x5a4632, plastic: 0x34302a, trim: 0xb08d57, roof: 1.55, dash: 0.82, wedge: 0.0, thick: 0.08, vents: 'round', shift: 'stick', seat: 'bench', tall: 0.08 },
    muscle:  { leather: 0x6b1d1d, plastic: 0x16171a, trim: 0xd0d3d8, roof: 1.36, dash: 0.74, wedge: 0.08, thick: 0.09, vents: 'round', shift: 'stick', seat: 'bucket', stripe: 0xd0d3d8, low: 0.08 },
    wagon:   { leather: 0x3c4a58, plastic: 0x2c3138, trim: 0xa9b4bf, roof: 1.5, dash: 0.78, wedge: 0.0, thick: 0.07, vents: 'bar', shift: 'stick', seat: 'bench' },
    suv:     { leather: 0x3b3626, plastic: 0x2a2c26, trim: 0x9aa17f, roof: 1.56, dash: 0.84, wedge: 0.0, thick: 0.08, vents: 'round', shift: 'stick', seat: 'bucket', tall: 0.08 },
    rally:   { leather: 0x15171c, plastic: 0x1c1e23, trim: 0xe03a2e, roof: 1.4, dash: 0.76, wedge: 0.04, thick: 0.08, vents: 'round', shift: 'stick', seat: 'bucket', cage: true, low: 0.04 },
    roadster:{ leather: 0x5b2a22, plastic: 0x1a1a1d, trim: 0xe0b45a, roof: 1.32, dash: 0.72, wedge: 0.1, thick: 0.06, vents: 'round', shift: 'stick', seat: 'bucket', low: 0.1 },
    supercar:{ leather: 0x16171a, plastic: 0x111215, trim: 0xffd400, roof: 1.3, dash: 0.7, wedge: 0.14, thick: 0.1, vents: 'hex', shift: 'paddle', seat: 'bucket', low: 0.14 },
    hyper:   { leather: 0xd9d9dd, plastic: 0x1a1b1f, trim: 0x2f3a46, roof: 1.3, dash: 0.7, wedge: 0.14, thick: 0.1, vents: 'hex', shift: 'paddle', seat: 'bucket', low: 0.14 },
    sport:   { leather: 0x1d2330, plastic: 0x181a1f, trim: 0x4a86e8, roof: 1.36, dash: 0.74, wedge: 0.08, thick: 0.08, vents: 'round', shift: 'stick', seat: 'bucket', low: 0.08 }
  };
  let shellKey = null;
  function buildShell(key) {
    shell.children.slice().forEach(c => { shell.remove(c); c.traverse(o => { if (o.geometry) o.geometry.dispose(); }); });
    const P = PROFILES[key] || PROFILES._, add = (geo, m, x, y, z, par = shell) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); par.add(o); return o; };
    const plastic = mat(P.plastic), plasticL = mat(new THREE.Color(P.plastic).offsetHSL(0, 0, 0.05).getHex()), leather = mat(P.leather, 0.95), trim = mat(P.trim, 0.4, 0.6), headliner = mat(0x4b4f57, 1), carpet = mat(0x121316, 1);
    const R = P.roof, W = 0.9;   // half cabin width
    // floor, firewall, transmission tunnel
    add(box(1.8, 0.04, 2.9), carpet, 0, 0.2, -0.1); add(box(1.76, 0.5, 0.06), plastic, 0, 0.5, 0.76);
    add(box(0.36, 0.14, 1.9), plastic, 0, 0.3, -0.05);
    // ---- dash: a deep top, a face, a visor over the binnacle, vents, glovebox, a centre stack ----
    const top = add(box(1.78, 0.14, 0.5), plastic, 0, P.dash, 0.94); top.rotation.x = -P.wedge * 0.4;
    add(box(1.78, 0.3, 0.14), plastic, 0, P.dash - 0.14, 0.72); add(box(1.78, 0.2, 0.3), plastic, 0, P.dash - 0.33, 0.8);
    const vis = add(box(0.74, 0.05, 0.22), plasticL, 0.4, P.dash + 0.17, 0.74); vis.rotation.x = -0.25 - P.wedge * 0.3;
    add(box(0.74, 0.3, 0.05), plasticL, 0.4, P.dash + 0.03, 0.8).rotation.x = -0.25;                   // binnacle housing
    add(box(0.6, 0.025, 0.02), trim, -0.45, P.dash - 0.02, 0.69);                                      // dash trim line
    add(box(0.5, 0.2, 0.03), plasticL, -0.45, P.dash - 0.2, 0.69);                                     // glovebox lid
    add(box(0.26, 0.4, 0.1), plasticL, 0, P.dash - 0.2, 0.68);                                         // centre stack
    add(box(0.2, 0.1, 0.02), mat(0x0a1016, 0.3, 0.2), 0, P.dash - 0.08, 0.625);                        // infotainment screen
    add(box(0.2, 0.05, 0.02), trim, 0, P.dash - 0.2, 0.625);
    const vent = (x, y) => {
      if (P.vents === 'round') { const v = add(cyl(0.05, 0.05, 0.03, 20), trim, x, y, 0.64, shell); v.rotation.x = Math.PI / 2; add(cyl(0.035, 0.035, 0.035, 20), plastic, x, y, 0.64).rotation.x = Math.PI / 2; }
      else if (P.vents === 'hex') { const v = add(cyl(0.05, 0.05, 0.03, 6), trim, x, y, 0.64); v.rotation.x = Math.PI / 2; add(cyl(0.032, 0.032, 0.035, 6), plastic, x, y, 0.64).rotation.x = Math.PI / 2; }
      else { add(box(0.18, 0.045, 0.03), trim, x, y, 0.645); add(box(0.15, 0.02, 0.035), plastic, x, y, 0.645); }
    };
    vent(-0.28, P.dash - 0.1); vent(0.28, P.dash - 0.1); vent(-0.75, P.dash - 0.05); vent(0.82, P.dash - 0.05);
    if (P.stripe) add(box(0.26, 0.02, 0.5), mat(P.stripe, 0.4, 0.3), 0, P.dash + 0.075, 0.94);          // racing stripe up the dash
    if (P.meter) { add(box(0.22, 0.1, 0.1), mat(0x15181d), -0.04, P.dash + 0.12, 0.9); add(box(0.18, 0.05, 0.02), mat(0xffb020, 0.3, 0, ), -0.04, P.dash + 0.12, 0.845); }   // taxi meter
    // ---- centre console, shifter, handbrake, cupholders ----
    add(box(0.32, 0.22, 1.1), plasticL, 0, 0.42, 0.15); add(box(0.3, 0.03, 0.55), trim, 0, 0.545, 0.35);
    if (P.shift === 'stick') { add(cyl(0.012, 0.012, 0.22, 8), plastic, 0, 0.66, 0.38).rotation.x = 0.2; add(new THREE.SphereGeometry(0.035, 12, 10), leather, 0, 0.78, 0.4); }
    else if (P.shift === 'column') add(box(0.035, 0.035, 0.28), plastic, 0.25, 0.64, 0.5);
    else { add(box(0.1, 0.06, 0.12), trim, 0, 0.56, 0.42); add(box(0.2, 0.012, 0.02), trim, 0.4, 0.82, 0.58); }
    add(box(0.06, 0.05, 0.3), plastic, 0, 0.58, 0.0).rotation.x = -0.2;                                  // handbrake
    // ---- doors: panel, upholstered insert, armrest, window sill, handle, speaker, mirror stalk, glass ----
    [1, -1].forEach(s => {
      const x = s * 0.93;
      add(box(0.07, 0.55, 2.4), plastic, x, 0.5, -0.1);                                                 // lower card
      add(box(0.075, 0.2, 1.7), leather, x - s * 0.005, 0.62, -0.35);                                    // insert
      add(box(0.12, 0.07, 0.8), leather, x - s * 0.04, 0.78, -0.2);                                     // armrest
      add(box(0.075, 0.07, 2.4), trim, x, 0.8, -0.1);                                                    // belt line
      add(box(0.08, 0.05, 0.22), trim, x - s * 0.02, 0.72, -0.62);                                       // handle
      add(cyl(0.07, 0.07, 0.03, 16), plasticL, x - s * 0.02, 0.5, 0.2).rotation.z = Math.PI / 2;        // speaker
      add(box(0.04, 0.5, 0.2), plastic, x, 0.64, 0.84);                                                  // dash end / kick panel
      const g = add(box(0.02, 0.62 + (R - 1.46) * 0.8, 2.0), glassM, x + s * 0.01, 1.12, -0.2);          // side glass
      // wing mirror: arm, housing and reflecting face
      const arm = add(box(0.2, 0.025, 0.05), plastic, x + s * 0.1, 0.92, 0.58); arm.rotation.y = s * 0.2;
      const hs = add(box(0.07, 0.13, 0.2), plastic, x + s * 0.2, 0.96, 0.58); hs.rotation.y = -s * 0.1;
      const face = add(box(0.005, 0.1, 0.16), mirrorM, x + s * 0.2 - s * 0.037, 0.96, 0.57); face.rotation.y = -s * 0.1;
    });
    // ---- seats: driver's (left) and passenger's with headrests and belts; rear bench ----
    const bucket = P.seat === 'bucket';
    [0.42, -0.42].forEach(x => {
      add(box(0.5, 0.13, 0.55), leather, x, 0.4, -0.1);
      const back = add(box(0.5, 0.64, 0.13), leather, x, 0.74, -0.4); back.rotation.x = bucket ? -0.12 : -0.05;
      if (bucket) { add(box(0.07, 0.4, 0.3), leather, x + 0.27, 0.62, -0.28); add(box(0.07, 0.4, 0.3), leather, x - 0.27, 0.62, -0.28); }
      add(box(0.24, 0.17, 0.1), leather, x, 1.16, -0.4); add(box(0.015, 0.15, 0.04), trim, x - 0.05, 1.0, -0.41); add(box(0.015, 0.15, 0.04), trim, x + 0.05, 1.0, -0.41);
    });
    add(box(0.04, 0.9, 0.025), mat(0x1a1a1a, 1), 0.61, 0.95, -0.34).rotation.z = 0.5;                       // seat belt
    add(box(1.55, 0.14, 0.5), leather, 0, 0.4, -1.1); add(box(1.55, 0.55, 0.13), leather, 0, 0.7, -1.38);
    // rear parcel shelf, rear window glass and pillars
    add(box(1.7, 0.04, 0.35), plastic, 0, 0.95, -1.5);
    // ---- roof, headliner, pillars (A, B, C), rails, grab handles, dome light, sun visors ----
    add(box(1.86, 0.05, 2.2), headliner, 0, R, -0.45);
    add(box(1.86, 0.05, 0.12), plastic, 0, R - 0.005, 0.74);
    add(box(0.28, 0.02, 0.22), mat(0xe9e3c8, 0.6), 0, R - 0.035, -0.4);                                   // dome light
    [0.88, -0.88].forEach(x => {
      const by = 0.85, bz = 1.05, ty = R, tz = 0.62, dy = ty - by, dz = tz - bz, len = Math.hypot(dy, dz);
      const a = add(box(P.thick, P.thick * 1.4, len), plastic, x, (by + ty) / 2, (bz + tz) / 2); a.rotation.x = Math.atan2(-dy, dz);   // windscreen A pillar
      add(box(P.thick * 1.2, R - 0.8, 0.12), plastic, x, 0.8 + (R - 0.8) / 2, -0.55);                      // B pillar
      add(box(P.thick * 1.3, R - 0.86, 0.2), plastic, x, 0.86 + (R - 0.86) / 2, -1.34);                    // C pillar
      add(box(P.thick, 0.06, 2.2), plastic, x, R - 0.04, -0.45);                                           // roof rail
      add(box(0.05, 0.04, 0.2), trim, x - Math.sign(x) * 0.04, R - 0.1, -0.2);                             // grab handle
    });
    add(box(1.86, 0.06, 0.1), plastic, 0, R - 0.02, 0.76);                                                  // header rail
    [0.4, -0.4].forEach(x => { const v = add(box(0.38, 0.015, 0.2), mat(0x6a6f78, 1), x, R - 0.06, 0.58); v.rotation.x = x > 0 ? 0 : 0.0; });   // sun visors
    // ---- rear-view mirror: stalk from the headliner, housing, reflecting face ----
    const stalk = add(box(0.03, 0.14, 0.03), plastic, 0.02, R - 0.1, 0.7); stalk.rotation.x = -0.4;
    const mh = add(box(0.3, 0.085, 0.045), plastic, 0.02, R - 0.2, 0.64); mh.rotation.set(0.12, 0.05, 0);
    const mf = add(box(0.27, 0.06, 0.005), mirrorM, 0.02, R - 0.2, 0.615); mf.rotation.set(0.12, 0.05, 0);
    if (P.cage) [0.88, -0.88].forEach(x => { add(cyl(0.025, 0.025, R - 0.4, 8), mat(0xc0c4c8, 0.4, 0.8), x * 0.9, 0.2 + (R - 0.4) / 2, -0.3); });   // roll cage uprights
    if (P.cage) add(cyl(0.025, 0.025, 1.7, 8), mat(0xc0c4c8, 0.4, 0.8), 0, R - 0.08, -0.35).rotation.z = Math.PI / 2;
    // ---- visible bonnet through the windscreen ----
    const hood = add(box(1.58, 0.1, 1.2), mat(0x888888, 0.35, 0.5), 0, P.dash + 0.04 - (P.low || 0) * 0.2, 1.62); hood.rotation.x = 0.09 + P.wedge * 0.2;
    root.userData.hood = hood; shellHood = hood;
    shellKey = key; root.userData.profile = P;
  }
  let shellHood = null;
  buildShell('_');
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
      const key = (st && st.key) || '_'; if (key !== shellKey) buildShell(key);
      const P = root.userData.profile || {}, h = ((car.dimHeight || 1.5) - 1.5) * 0.75 - (P.low || 0) + (P.tall || 0) * 0.5;
      root.position.y = h; root.scale.set(1, 1, k > 1.1 ? 1.1 : 1);
      if (st && st.color != null && shellHood) shellHood.material.color.set(car.paintColor != null ? car.paintColor : st.color);
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
