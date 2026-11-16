// The airport: a real-looking runway (edge, centre, threshold, touchdown and aiming-point markings, rubber marks, numbers) with edge / threshold /
// centre-line lights, a flashing approach "rabbit", PAPI lights, a blue-lit taxiway, an apron with three stands, jet bridges, a terminal, a control
// tower with a rotating beacon, a hangar, a windsock, floodlight masts, baggage tractors, a fuel truck and a fire engine.
// Planes come and go: one lands (taxis in, parks at a free stand), or one pushes back, taxies out and takes off; airliners also cross the sky
// far above (drawn onto a sky sphere, as the far plane is short) with contrails by day and nav lights by night.
// Park at the Departures gate and hold still for a moment: you board a flight to the other city (the city is a stored choice, see map.js).
// The map says where: map.airport = {at:[X,Y] near the terminal (the gate is the nearest road point), rwy:[[X,Y],[X,Y]], dest:'sf'|'chicago', name}.
import * as THREE from 'three';
import { MAP, T } from './chicago/map.js';
import { planeMesh, Flyer, glowTexture } from './aircraft.js';

const CITY_NAMES = { chicago: 'CHICAGO', sf: 'SAN FRANCISCO' };

export function createAirport({ city, scene, car, toast, collisionWorld }) {
  const A = MAP.airport; if (!A) return { update() {} };
  const g = new THREE.Group(); g.name = 'airport'; scene.add(g);
  const [ax, az] = T(A.rwy[0][0], A.rwy[0][1]), [bx, bz] = T(A.rwy[1][0], A.rwy[1][1]);
  const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2, yaw = Math.atan2(ux, uz);
  const Y = A.y != null ? A.y : 0.17, W = A.width || 26, side = A.apronSide || 1, vx = -uz * side, vz = ux * side;     // v: across the runway towards the apron
  const P = (s, d, y = 0) => new THREE.Vector3(ax + ux * s + vx * d, y, az + uz * s + vz * d);                          // runway frame -> world: s along, d across (apron side positive)
  const thU = Math.atan2(-uz, ux);                                                                                        // rotation.y that lays a box's long side along the runway
  const hdAlong = Math.atan2(-uz, ux), hdAcross = Math.atan2(-vz, vx);                                                    // plane headings: along +u, towards the apron (+d)
  const yB = Y + 3.2;                                                                                                     // a plane's centre height when its wheels are on the ground
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85 }, o));
  const box = (sl, h, dl, s, d, y, m, parent = g) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sl, h, dl), m); b.rotation.y = thU; b.position.copy(P(s, d, y + h / 2)); b.castShadow = true; b.receiveShadow = true; parent.add(b); return b; };
  const quad = (pts, m, y) => { const mm = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.z)))), m); mm.rotation.x = -Math.PI / 2; mm.position.y = y; mm.receiveShadow = true; return mm; };
  const nameTxt = (A.name || 'AIRPORT').toUpperCase();

  // ---- layout, in the runway frame ----
  const DT = W / 2 + 22, TW = 6, R = DT / 2, S0 = -8, LC = L - 10;      // taxiway centre line, its half width, the U-turn radius at both ends, where those U-turns sit
  const DS = DT + 32, CS = L * 0.5, stands = [CS - 85, CS, CS + 85].map((s, i) => ({ s, d: DS, plane: null, reserved: false, i }));
  const TERM_D0 = DS + 18.6 + 22, TERM_D1 = TERM_D0 + 20, TERM_HALF = 150, SVC = DS + 26;
  // ---- apron slab under everything (the strip of land is not always wide enough) ----
  { const m = mat(0x8e9195, { roughness: 0.95 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(L + 150, 0.3, TERM_D1 + 30 + W / 2 + 36), m); slab.rotation.y = thU;
    const c = P(L / 2, (TERM_D1 + 30 - W / 2 - 36) / 2, Y - 0.2); slab.position.copy(c); slab.receiveShadow = true; g.add(slab); }
  // ---- runway: asphalt with real markings (scaled in world units, so a dash is the same length on a short strip as on a long one) ----
  const ppu = Math.min(6, 3900 / L), cw = Math.round(W * ppu), ch = Math.round(L * ppu), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const q = cv.getContext('2d');
  if (q && q.fillRect) {
    const X = d => (d + W / 2) * ppu, Yc = s => s * ppu, R_ = (d0, s0, dw, sl) => q.fillRect(X(d0), Yc(s0), dw * ppu, sl * ppu);
    q.fillStyle = '#2b2e33'; q.fillRect(0, 0, cw, ch);
    q.fillStyle = '#25272b'; R_(-4.5, L * 0.05, 9, L * 0.09); R_(-4.5, L * 0.86, 9, L * 0.07);                                        // rubber from landing and braking
    q.fillStyle = '#e9e9e4';
    R_(-W / 2 + 0.7, 0, 0.45, L); R_(W / 2 - 1.15, 0, 0.45, L);                                                                       // edge lines
    for (let s = 40; s < L - 40; s += 22) R_(-0.35, s, 0.7, 12);                                                                       // centre dashes
    for (let k = 0; k < 8; k++) { const d = -W / 2 + 2.2 + k * ((W - 4.4) / 7) - 0.45; R_(d, 2, 0.9, 11); R_(d, L - 13, 0.9, 11); }  // threshold piano keys
    [0.13, 0.2, 0.27].forEach(f => [-1, 1].forEach(sg => { R_(sg * 4 - 0.5 + (sg > 0 ? 0 : 0), L * f, 1, 5); R_(sg * 6 - 0.5, L * f, 1, 5); R_(sg * 8 - 0.5, L * f + 6, 1, 5); }));   // touchdown zone pairs
    [-1, 1].forEach(sg => R_(sg * 5.5 - 1, L * 0.33, 2, 11));                                                                          // aiming point
    q.font = 'bold ' + Math.round(9 * ppu) + 'px sans-serif'; q.textAlign = 'center';
    q.save(); q.translate(cw / 2, Yc(26)); q.fillText(A.num0 || '18', 0, 0); q.restore(); q.save(); q.translate(cw / 2, Yc(L - 26)); q.rotate(Math.PI); q.fillText(A.num1 || '36', 0, 0); q.restore();
  }
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 8;
  const rw = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  rw.rotation.x = -Math.PI / 2; rw.rotation.z = -yaw; rw.position.set(mx, Y, mz); rw.receiveShadow = true; rw.material.polygonOffset = true; rw.material.polygonOffsetFactor = -2; g.add(rw);
  // ---- taxiway: one ribbon from the runway's start round a U-turn, along the apron, and round the U-turn at the far end ----
  const uStart = [], uEnd = [];
  for (let k = 0; k <= 12; k++) { const a = Math.PI * k / 12; uStart.push([S0 - R * Math.sin(a), R + R * Math.cos(a)]); uEnd.push([LC + R * Math.sin(a), R - R * Math.cos(a)]); }       // uStart: (S0,DT) -> (S0,0); uEnd: (LC,0) -> (LC,DT)
  const taxiLine = [...uStart.slice().reverse(), [S0, DT], [LC, DT], ...uEnd.slice().reverse()];                                // runway start -> start U -> straight -> end U -> runway end
  function ribbon(pts, half, m, y) {
    const pos = [], idx = [];
    pts.forEach((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let ds = b[0] - a[0], dd = b[1] - a[1]; const l = Math.hypot(ds, dd) || 1; ds /= l; dd /= l;
      const n = [-dd, ds]; [-1, 1].forEach(sg => { const w = P(p[0] + n[0] * half * sg, p[1] + n[1] * half * sg, Y); pos.push(w.x, Y, w.z); }); if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); } });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const mm = new THREE.Mesh(geo, m); mm.position.y = y; mm.receiveShadow = true; g.add(mm); return mm;
  }
  const taxiM = mat(0x34373c, { polygonOffset: true, polygonOffsetFactor: -1 }), yellowM = mat(0xe8c21a, { roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3 });
  ribbon(taxiLine, TW, taxiM, 0.03); ribbon(taxiLine, 0.22, yellowM, 0.05);
  // the apron in front of the stands: darker concrete and yellow lead-in lines into each stand, a stop bar at the nose
  stands.forEach(st => {
    ribbon([[st.s + 40, DT], [st.s + 22, DT + 3], [st.s + 8, DT + 14], [st.s + 1, DT + 26], [st.s, DS - 6], [st.s, DS + 16]], 0.2, yellowM, 0.05);
    ribbon([[st.s - 5, DS + 22], [st.s + 5, DS + 22]], 0.35, yellowM, 0.05);
  });
  // ---- lights: everything glows through one Points cloud (runway, approach, taxiway, apron masts); the rabbit and the PAPI animate ----
  const lt = [];                                                                       // { p: Vector3, c: [r,g,b], size, kind, i }
  const add = (s, d, y, c, kind = 'st', i = 0, size = 3) => lt.push({ p: P(s, d, y), c, kind, i, size });
  const WH = [1, 0.96, 0.85], GR = [0.1, 1, 0.3], RD = [1, 0.12, 0.08], BL = [0.2, 0.4, 1], WARM = [1, 0.85, 0.55];
  for (let s = 4; s < L; s += 22) { add(s, -W / 2 - 0.9, Y + 0.3, WH); add(s, W / 2 + 0.9, Y + 0.3, WH); }          // edge lights
  for (let k = 0; k < 9; k++) { const d = -W / 2 + k * W / 8; add(-1, d, Y + 0.3, GR); add(L + 1, d, Y + 0.3, RD); }  // green threshold, red runway end
  for (let s = 14; s < L - 10; s += 14) add(s, 0, Y + 0.08, WH, 'st', 0, 1.8);                                        // centre line
  const RAB = 18; for (let j = 0; j < RAB; j++) add(-20 - (RAB - 1 - j) * 15, 0, Y + 0.4, WH, 'rabbit', j, 3.6);      // approach lights: j = 0 is the farthest
  [-60, -105, -150, -195, -240].forEach(s => { for (let k = 1; k <= 3; k++) { add(s, k * 2.2, Y + 0.4, WH, 'st', 0, 2.4); add(s, -k * 2.2, Y + 0.4, WH, 'st', 0, 2.4); } });
  for (let i = 0; i < 4; i++) add(L * 0.12, -(W / 2 + 9 + i * 3.4), Y + 0.5, WH, 'papi', i, 3.2);                    // PAPI: left of the runway, on the glide path two white and two red
  for (let k = 0; k < taxiLine.length - 1; k++) { const a = taxiLine[k], b = taxiLine[k + 1], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 13)); if (k % 1 === 0) for (let j = 0; j < n; j++) { const f = j / n, ps = a[0] + (b[0] - a[0]) * f, pd = a[1] + (b[1] - a[1]) * f, dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / dl, nd = (b[0] - a[0]) / dl; add(ps + nx * TW, pd + nd * TW, Y + 0.3, BL, 'st', 0, 2.4); add(ps - nx * TW, pd - nd * TW, Y + 0.3, BL, 'st', 0, 2.4); } }
  const masts = [CS - 120, CS - 40, CS + 40, CS + 120].map(s => { const m = P(s, SVC + 6, 0); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 16, 6), mat(0x55595f)); pole.position.set(m.x, Y + 8, m.z); g.add(pole); const head = box(3.4, 0.5, 1.2, s, SVC + 6, Y + 16, mat(0x30343a)); head.userData.mast = true; add(s, SVC + 6, Y + 16.4, WARM, 'mast', 0, 9); return m; });
  const lightPos = new Float32Array(lt.length * 3), lightCol = new Float32Array(lt.length * 3), lightSize = new Float32Array(lt.length);
  lt.forEach((l, i) => { lightPos.set([l.p.x, l.p.y, l.p.z], i * 3); lightSize[i] = l.size; });
  const lgeo = new THREE.BufferGeometry(); lgeo.setAttribute('position', new THREE.BufferAttribute(lightPos, 3)); lgeo.setAttribute('color', new THREE.BufferAttribute(lightCol, 3));
  const lmat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: true, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
  const lights = new THREE.Points(lgeo, lmat); lights.frustumCulled = false; g.add(lights);
  // ---- terminal, tower, hangar, windsock ----
  const wallM = mat(0xc9ced3), glassTex = (() => { const c = document.createElement('canvas'); c.width = 512; c.height = 64; const x = c.getContext('2d'); if (x && x.fillRect) { x.fillStyle = '#16222e'; x.fillRect(0, 0, 512, 64); for (let i = 0; i < 32; i++) for (let j = 0; j < 3; j++) if ((i * 7 + j * 3) % 5) { x.fillStyle = (i + j) % 4 ? '#ffe2a0' : '#bcd8ff'; x.fillRect(i * 16 + 2, 6 + j * 19, 12, 14); } } const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(2, 1); return t; })();
  const glassM = new THREE.MeshStandardMaterial({ color: 0x20384c, roughness: 0.2, metalness: 0.4, emissive: 0xffffff, emissiveMap: glassTex, emissiveIntensity: 0.15, map: glassTex });
  const hall = box(TERM_HALF * 2, 9, TERM_D1 - TERM_D0, CS, (TERM_D0 + TERM_D1) / 2, Y, wallM);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(TERM_HALF * 2 - 6, 5.5), glassM); front.rotation.y = hdAcross + Math.PI / 2 * 0 + Math.atan2(-vx, -vz) * 0; front.position.copy(P(CS, TERM_D0 - 0.05, Y + 4.8)); front.rotation.y = Math.atan2(-vx, -vz); g.add(front);   // glazed face towards the planes
  box(TERM_HALF * 2 + 6, 0.7, TERM_D1 - TERM_D0 + 7, CS, (TERM_D0 + TERM_D1) / 2 - 2, Y + 9, mat(0x6d7178));          // roof with an overhang
  box(TERM_HALF * 1.2, 4, 10, CS, (TERM_D0 + TERM_D1) / 2 + 2, Y + 9.7, wallM);                                          // upper concourse
  { const c = document.createElement('canvas'); c.width = 512; c.height = 64; const x = c.getContext('2d'); if (x && x.fillRect) { x.fillStyle = '#0d2342'; x.fillRect(0, 0, 512, 64); x.fillStyle = '#fff'; x.font = 'bold 40px sans-serif'; x.textAlign = 'center'; x.fillText('✈ ' + nameTxt, 256, 46); }
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(40, 5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) })); sg.position.copy(P(CS, TERM_D0 + 4.8, Y + 11.4)); sg.rotation.y = Math.atan2(-vx, -vz); g.add(sg); }
  stands.forEach(st => { box(3.2, 3.2, TERM_D0 - (DS + 15), st.s - 3, (TERM_D0 + DS + 15) / 2, Y + 3.4, mat(0xb4b9be)); });       // jet bridges, high enough for the baggage tractors to drive underneath
  { const ts = CS + TERM_HALF + 18, td = TERM_D0 + 10;                                                                     // control tower
    const tw = P(ts, td, 0), shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.9, 26, 10), wallM); shaft.position.set(tw.x, Y + 13, tw.z); shaft.castShadow = true; g.add(shaft);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 4, 4.2, 10), new THREE.MeshStandardMaterial({ color: 0x23394d, roughness: 0.2, metalness: 0.4, emissive: 0xffe2a0, emissiveIntensity: 0.1 })); cab.position.set(tw.x, Y + 28.1, tw.z); g.add(cab); stands.cab = cab;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.7, 10), mat(0x55595f)); roof.position.set(tw.x, Y + 30.5, tw.z); g.add(roof);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 5), mat(0x55595f)); mast.position.set(tw.x, Y + 33, tw.z); g.add(mast);
    stands.tower = { x: tw.x, z: tw.z }; }
  { const hs = CS - TERM_HALF - 38, hd = TERM_D0 + 14, hw = P(hs, hd, 0);                                                    // hangar
    const body = box(34, 7, 38, hs, hd, Y, mat(0xaeb4ba)); const dome = new THREE.Mesh(new THREE.CylinderGeometry(17, 17, 38, 20, 1, true, Math.PI / 2, Math.PI), mat(0xaeb4ba, { side: THREE.DoubleSide })); dome.rotation.order = 'YXZ'; dome.rotation.y = thU; dome.rotation.x = Math.PI / 2; dome.rotation.z = 0; dome.position.set(hw.x, Y + 7, hw.z); dome.castShadow = true; g.add(dome);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(26, 9), new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.9 })); door.position.copy(P(hs, hd - 19.1, Y + 4.5)); door.rotation.y = Math.atan2(-vx, -vz); g.add(door); stands.hangar = { s: hs, d: hd }; }
  const sockPivot = new THREE.Group(); { const sp = P(L * 0.3, -(W / 2 + 14), 0), pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), mat(0xdddddd)); pole.position.set(sp.x, Y + 3.5, sp.z); g.add(pole);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.4, 4.2, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.8, side: THREE.DoubleSide })); sock.rotation.z = Math.PI / 2; sock.position.x = 2.1; sockPivot.add(sock);
    [0.8, 1.9, 3.0].forEach(x => { const band = new THREE.Mesh(new THREE.CylinderGeometry(0.8 - x * 0.12, 0.8 - x * 0.12 - 0.02, 0.5, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide })); band.rotation.z = Math.PI / 2; band.position.x = x + 0.3; sockPivot.add(band); });
    sockPivot.position.set(sp.x, Y + 7, sp.z); g.add(sockPivot); }
  const beacon = new THREE.Group(); { const tw = stands.tower; beacon.position.set(tw.x, Y + 34.6, tw.z); g.add(beacon);
    const w1 = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })), g1 = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x44ff77, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    w1.scale.set(7, 7, 1); g1.scale.set(7, 7, 1); w1.position.set(1.6, 0, 0); g1.position.set(-1.6, 0, 0); beacon.add(w1, g1); }
  // ---- parked and moving aircraft ----
  const PALETTE = [[0xf2f3f4, 0x2a6db8], [0xf4efe6, 0xc0392b], [0xe8eef4, 0x1f8f5b], [0xf6f6f2, 0xd8392b], [0xeef0f2, 0x6a3fa0]];
  const flyers = PALETTE.map((c, i) => { const f = new Flyer(planeMesh(c[0], c[1], 1), { name: 'plane' + i }); f.groundY = Y; f.acc = 4.5; scene.add(f.mesh); return f; });
  const standRec = [];
  stands.forEach((st, i) => {
    const f = flyers[i]; st.plane = f; f.stand = st; f.set(P(st.s, st.d, yB), hdAcross); f.hidden = false; f.state = 'parked';
    const c = [P(st.s - 21, st.d - 24), P(st.s + 21, st.d - 24), P(st.s + 21, st.d + 22), P(st.s - 21, st.d + 22)];
    const rec = { kind: 'parcel', footprint: c.map(p => [p.x, p.z]), blocksCar: true, destructible: false, response: 'bounce', destroyed: false }; standRec.push(rec); if (collisionWorld) collisionWorld.push(rec);
  });
  const blocks = [[CS, (TERM_D0 + TERM_D1) / 2, TERM_HALF + 4, 14], [stands.hangar.s, stands.hangar.d, 20, 22]];                  // car colliders for the terminal and the hangar
  blocks.forEach(([s, d, hs, hd]) => { const c = [P(s - hs, d - hd), P(s + hs, d - hd), P(s + hs, d + hd), P(s - hs, d + hd)]; if (collisionWorld) collisionWorld.push({ kind: 'parcel', footprint: c.map(p => [p.x, p.z]), blocksCar: true, destructible: false, response: 'bounce', destroyed: false }); });
  const spare = flyers.slice(3);
  // routes (see Flyer): v is the target speed at that point
  const N = (p, v, extra = {}) => Object.assign({ p, v }, extra);
  const alt = y => yB + y;
  function arrivalRoute(st) {
    const r = [N(P(-3200, 0, alt(168)), 66, { on: 'inbound' }), N(P(-300, 0, alt(16)), 57), N(P(-40, 0, alt(2.1)), 52), N(P(40, 0, yB), 46, { on: 'touch' }), N(P(L * 0.55, 0, yB), 28), N(P(Math.max(L * 0.7, LC - 50), 0, yB), 10)];
    uEnd.forEach((u, k) => r.push(N(P(u[0], u[1], yB), 7, k === 0 ? { on: 'clear' } : {})));
    [[st.s + 40, DT, 9], [st.s + 22, DT + 3, 7], [st.s + 8, DT + 14, 5], [st.s + 1, DT + 26, 4], [st.s, DS - 8, 3]].forEach(([s, d, v]) => r.push(N(P(s, d, yB), v)));
    r.push(N(P(st.s, DS, yB), 0, { on: 'parked' }));
    return r;
  }
  function departureRoute(st) {
    const r = [N(P(st.s, DS, yB), 2, { rev: true, wait: 6, on: 'pushback' }), N(P(st.s, DS - 20, yB), 2, { on: 'pushed' }), N(P(st.s - 14, DS - 28, yB), 6), N(P(st.s - 32, DT, yB), 9)];
    r.push(N(P(S0 + 12, DT, yB), 9));
    uStart.forEach((u, k) => r.push(N(P(u[0], u[1], yB), 7, k === uStart.length - 1 ? { wait: 3, on: 'lineup' } : {})));
    r.push(N(P(4, 0, yB), 6), N(P(L * 0.5, 0, yB), 40), N(P(L - 25, 0, yB), 52), N(P(L + 60, 0, alt(4)), 57, { on: 'airborne' }), N(P(L + 420, 0, alt(32)), 66), N(P(L + 1500, 40, alt(110)), 76), N(P(L + 3400, 320, alt(270)), 88), N(P(L + 7000, 1100, alt(560)), 96, { on: 'gone' }));
    return r;
  }
  let rwyBusy = false, taxiLock = false, opTimer = 14, arrivals = 0, departures = 0;
  const log = { arrivals: 0, departures: 0, overflights: 0 };
  const fire = (ev, f) => {
    if (ev === 'clear') rwyBusy = false;
    else if (ev === 'parked') { f.state = 'parked'; f.stand = f.pendingStand; f.stand.plane = f; f.stand.reserved = false; f.pendingStand = null; taxiLock = false; f.route = null; opTimer = 22 + Math.random() * 30; standRec[f.stand.i].destroyed = false; log.arrivals++; }
    else if (ev === 'pushback') { f.state = 'taxi'; }
    else if (ev === 'lineup') { rwyBusy = true; }
    else if (ev === 'airborne') { taxiLock = false; f.state = 'climb'; }
    else if (ev === 'gone' || ev === 'end') { if (f.sky) { f.hidden = true; f.sky = false; f.contrail = false; log.overflights++; } else if (f.state === 'climb') { f.hidden = true; f.state = 'spare'; rwyBusy = false; spare.push(f); opTimer = 18 + Math.random() * 30; log.departures++; } }
  };
  function startOp() {
    const free = stands.find(s => !s.plane && !s.reserved), occupied = stands.filter(s => s.plane && s.plane.state === 'parked');
    const wantArrival = free && spare.length && (!occupied.length || Math.random() < 0.5);
    if (wantArrival) {
      const f = spare.shift(); free.reserved = true; f.pendingStand = free; f.state = 'inbound'; f.hidden = false; f.contrail = false; f.go(arrivalRoute(free)); rwyBusy = true; taxiLock = true; f.acc = 3.6;
    } else if (occupied.length) {
      const st = occupied[Math.floor(Math.random() * occupied.length)], f = st.plane; st.plane = null; f.stand = null; standRec[st.i].destroyed = true; f.go(departureRoute(st)); f.speed = 0; f.state = 'taxi'; f.acc = 4.2; taxiLock = true;
    } else opTimer = 10;
  }
  // overflights: airliners crossing the sky far above, from any direction, high enough to leave contrails
  const high = [0, 1, 2].map(i => { const f = new Flyer(planeMesh(...PALETTE[i % PALETTE.length], 1), { sky: 2.4, name: 'high' + i }); f.groundY = 0; f.sky = false; scene.add(f.mesh); f.timer = 8 + i * 22 + Math.random() * 20; return f; });
  function startHigh(f) {
    const th = Math.random() * Math.PI * 2, R0 = 7500, a = new THREE.Vector3(Math.cos(th) * R0, 0, Math.sin(th) * R0), tx = (Math.random() - 0.5) * 3000, tz = (Math.random() - 0.5) * 3000, dx = tx - a.x, dz = tz - a.z, dl = Math.hypot(dx, dz);
    const y = 650 + Math.random() * 550; a.y = y; const b = new THREE.Vector3(a.x + dx / dl * 15000, y, a.z + dz / dl * 15000);
    f.go([N(a, 125), N(b, 125, { on: 'gone' })]); f.sky = true; f.hidden = false; f.contrail = true; f.acc = 1; f.state = 'cruise';
  }
  // ---- ground vehicles on the apron: baggage tractors shuttle along the service lane, a fuel truck waits at a stand, a fire engine by the tower ----
  const vm = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.7 }, o));
  function vehicle(kind) {
    const v = new THREE.Group(), bx = (w, h, l, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m); b.position.set(x, y, z); b.castShadow = true; v.add(b); return b; };
    const wheels = (xs, z, r = 0.38) => xs.forEach(x => [-1, 1].forEach(sg => { const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 8), vm(0x18191b)); w.rotation.x = Math.PI / 2; w.position.set(x, r, sg * z); v.add(w); }));
    if (kind === 'tractor') { bx(2.2, 0.9, 1.3, 0, 0.75, 0, vm(0xf2c200)); bx(1.0, 0.9, 1.2, -0.3, 1.5, 0, vm(0xf2c200)); wheels([-0.7, 0.7], 0.7);
      [-3.2, -6.3].forEach(x => { bx(2.7, 0.35, 1.5, x, 0.6, 0, vm(0x2b5aa8)); bx(2.4, 1.0, 1.3, x, 1.2, 0, vm(0x6b6f76)); wheels([x - 0.9, x + 0.9], 0.75, 0.3); }); }
    else if (kind === 'fuel') { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 3.6, 12), vm(0xeeeeee)); t.rotation.z = Math.PI / 2; t.position.set(-0.6, 1.5, 0); v.add(t); bx(1.4, 1.5, 1.7, 1.9, 1.0, 0, vm(0xd8392b)); bx(3.6, 0.2, 0.2, -0.6, 1.5, 1.0, vm(0xd8392b)); wheels([-1.6, 0, 1.8], 0.8); }
    else if (kind === 'fire') { bx(5.2, 1.5, 1.9, 0, 1.2, 0, vm(0xd22020)); bx(1.7, 1.4, 1.9, 2.6, 1.6, 0, vm(0xd22020)); bx(5.2, 0.25, 1.95, 0, 1.4, 0, vm(0xffffff)); const lad = bx(3.6, 0.2, 0.6, -0.6, 2.2, 0, vm(0xbfc4c8)); void lad; wheels([-1.8, 0, 2.0], 0.85, 0.5); }
    v.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return v;
  }
  const veh = [];
  const addVeh = (kind, s, d, o = {}) => { const m = vehicle(kind); g.add(m); const x = Object.assign({ m, s, d, dir: 1, speed: 0, vmax: 6, wait: 0, lo: CS - 130, hi: CS + 130, moving: false }, o); veh.push(x); m.position.copy(P(s, d, Y)); m.rotation.y = thU; return x; };
  addVeh('tractor', CS - 100, SVC - 2.5, { moving: true, vmax: 6.5, dir: 1 }); addVeh('tractor', CS + 60, SVC + 2.5, { moving: true, vmax: 5.5, dir: -1 }); addVeh('tractor', CS, SVC - 2.5, { moving: true, vmax: 7, dir: -1, wait: 6 });
  addVeh('fuel', stands[1].s + 20, DS + 2, {}); addVeh('fire', CS + TERM_HALF + 6, TERM_D0 - 6, {});
  veh[3].m.rotation.y = thU + Math.PI / 2; veh[4].m.rotation.y = thU;

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
  const col = lgeo.getAttribute('color');
  function paintLights(night) {
    const base = 0.22 + 0.78 * night, ph = Math.floor(t * 16) % (RAB + 8);
    lt.forEach((l, i) => {
      let k = base;
      if (l.kind === 'rabbit') k = base * (l.i === ph ? 1.6 : 0.25);
      else if (l.kind === 'papi') k = base * 1.2;
      else if (l.kind === 'mast') k = night > 0.15 ? 1.4 : 0.1;
      const c = l.kind === 'papi' && l.i >= 2 ? RD : l.c;
      col.setXYZ(i, c[0] * k, c[1] * k, c[2] * k);
    });
    col.needsUpdate = true; lmat.size = 2.6 + 1.4 * night;
  }
  let lightTick = 0;
  return {
    gate, runway: { ax, az, ux, uz, L, W, mx, mz, yaw, Y, side }, log, flyers, high, stands, veh,
    update(dt, night = 1, cam = null) {
      t += dt; lightTick -= dt;
      if (lightTick <= 0) { lightTick = 0.05; paintLights(night); }
      sockPivot.rotation.y = Math.sin(t * 0.13) * 0.6 + 1.2; sockPivot.children.forEach(c => { c.rotation.z = Math.PI / 2 + Math.sin(t * 2.1) * 0.06; });
      beacon.rotation.y = t * 3.2; beacon.visible = night > 0.1; stands.cab.material.emissiveIntensity = 0.1 + 0.9 * night;
      glassM.emissiveIntensity = 0.12 + 1.1 * night;
      if (cam) {
        opTimer -= dt;
        if (opTimer <= 0) { if (!rwyBusy && !taxiLock) { startOp(); opTimer = 20 + Math.random() * 30; } else opTimer = 3; }
        flyers.forEach(f => { f.step(dt, fire); f.place(cam, t, night); });
        high.forEach(f => { if (f.sky) { f.step(dt, fire); f.place(cam, t, night); } else { f.mesh.visible = false; f.timer -= dt; if (f.timer <= 0) { startHigh(f); f.timer = 50 + Math.random() * 70; } } });
        veh.forEach(v => { if (!v.moving) return; if (v.wait > 0) { v.wait -= dt; return; } v.speed += (v.vmax - v.speed) * Math.min(1, dt); v.s += v.dir * v.speed * dt;
          if (v.s > v.hi || v.s < v.lo) { v.s = Math.max(v.lo, Math.min(v.hi, v.s)); v.dir *= -1; v.speed = 0; v.wait = 4 + Math.random() * 8; }
          v.m.position.copy(P(v.s, v.d, Y)); v.m.rotation.y = thU + (v.dir < 0 ? Math.PI : 0); });
      } else { flyers.forEach(f => { f.mesh.visible = false; }); high.forEach(f => { f.mesh.visible = false; }); }
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
