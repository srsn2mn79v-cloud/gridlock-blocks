// Aeroplanes: the model, its lights, and a Flyer that follows a route (taxi, take-off, climb, cruise, approach, landing) in world space.
//
// Camera far plane is only a few hundred units, so a plane 5 km away cannot simply be drawn where it is. Flyer.place() draws it for real while it is
// within SKY_R of the camera and, beyond that, projects it onto a sphere of that radius around the camera, scaled down by the same factor. The
// angle on screen is exactly right, nothing pops at the boundary, and an airliner crossing the sky 1 km up looks like one. Only airborne planes
// are projected (a taxiing plane far away would float in front of buildings), and none at all when the camera is not in the city.
import * as THREE from 'three';

let glow = null;
export function glowTexture() {
  if (glow) return glow;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  if (x && x.createRadialGradient) { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.22, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }
  glow = new THREE.CanvasTexture(c); return glow;
}
const sprite = (color, size, x, y, z) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  s.scale.set(size, size, 1); s.position.set(x, y, z); return s;
};

// Modelled on a Boeing 737-800 (dimensions from the type's published data): 39.5 m long, 34.3 m span, 12.5 m tall, fuselage 3.8 m across, wings swept ~25 deg with
// blended winglets, two underslung CFM56 engines, a swept T-less tail, tricycle gear with twin wheels. Built in metres inside a group scaled 1.19 (1 u = 1.25 m, and the old
// model was a little longer than the real thing; the wheels sit 3.2 u below the centre as the airport expects).
// long axis along +x (nose at +x), +y up, +z to the right of the pilot.  userData: gear, lights {nav, strobe, beacon, landing}, trail
const planform = (pts, thick, dih = 0, mirror = false) => {         // a flat swept surface from (x, z) outline points (z >= 0), extruded `thick` up, with dihedral
  const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
  const pa = geo.attributes.position; for (let i = 0; i < pa.count; i++) pa.setY(pa.getY(i), pa.getY(i) + Math.abs(pa.getZ(i)) * dih);
  geo.computeVertexNormals(); void mirror; return geo;
};
export function planeMesh(body = 0xf2f3f4, accent = 0x2a6db8, scale = 1) {
  const g = new THREE.Group(), A = new THREE.Group(); A.scale.setScalar(1.19); g.add(A);
  const M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.45, metalness: 0.15 }, o));
  const white = M(body), grey = M(0xc6ccd2), dark = M(0x1b2530, { roughness: 0.3 }), accentM = M(accent), tyre = M(0x16181a, { roughness: 0.9, metalness: 0 }), metal = M(0x7b838b, { metalness: 0.5 });
  // fuselage: a lathe profile (radius, position along the axis), tail swept up
  const prof = [[0.1, -19.7], [0.45, -18.5], [0.95, -16.6], [1.45, -14.2], [1.8, -11.4], [1.88, -8.5], [1.88, 11], [1.84, 13.2], [1.68, 15.4], [1.4, 17.2], [1.0, 18.5], [0.55, 19.4], [0.05, 19.85]];
  const fg = new THREE.LatheGeometry(prof.map(([r, x]) => new THREE.Vector2(r, x)), 28); fg.rotateZ(-Math.PI / 2);
  { const pa = fg.attributes.position, col = []; const cb = new THREE.Color(body), ca = new THREE.Color(accent), cg = new THREE.Color(0xb9c0c7);
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i); if (x < -9) pa.setY(i, y + (-9 - x) * 0.085);
      const c = y < -1.05 ? cg : (x < -12.5 && y > -0.3 ? ca : cb); col.push(c.r, c.g, c.b); }
    fg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); fg.computeVertexNormals(); }
  A.add(new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.15 })));
  // cheat line and cabin windows (a painted strip each side), cockpit glass
  const wc = document.createElement('canvas'); wc.width = 512; wc.height = 32; const wx = wc.getContext('2d');
  if (wx && wx.fillRect) { wx.clearRect(0, 0, 512, 32); wx.fillStyle = '#' + new THREE.Color(accent).getHexString(); wx.fillRect(0, 21, 512, 5); wx.fillStyle = '#1b2a3a'; for (let i = 0; i < 38; i++) { wx.beginPath(); wx.roundRect ? wx.roundRect(8 + i * 13, 5, 7, 10, 2) : wx.rect(8 + i * 13, 5, 7, 10); wx.fill(); } }
  const wtex = new THREE.CanvasTexture(wc); wtex.colorSpace = THREE.SRGBColorSpace;
  [1, -1].forEach(sd => { const w = new THREE.Mesh(new THREE.PlaneGeometry(26, 1.65), new THREE.MeshBasicMaterial({ map: wtex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); w.position.set(-0.7, 0.55, sd * 1.82); w.lookAt(w.position.x, w.position.y + 0.24, w.position.z + sd); A.add(w); });
  [1, -1].forEach(sd => { const c = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 0.9), dark); c.position.set(17.15, 0.62, sd * 0.78); c.rotation.set(0, sd * -0.55, 0); c.scale.set(1, 1, 0.9); A.add(c); });
  { const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 1.5), dark); c.position.set(17.6, 0.68, 0); A.add(c); }
  // wings (right side, mirrored): root chord 6.9 m, tip 1.6 m, ~25 deg sweep, a kink in the trailing edge; winglets
  const wingPts = [[2.0, 0], [-6.4, 17.1], [-8.0, 17.1], [-5.2, 6.2], [-8.6, 0]];
  const wingGeo = planform(wingPts, 0.34, 0.055), wingletShape = new THREE.Shape([new THREE.Vector2(-6.4, 0), new THREE.Vector2(-8.0, 0), new THREE.Vector2(-8.9, 2.5), new THREE.Vector2(-8.3, 2.5)]);
  const wingletGeo = new THREE.ExtrudeGeometry(wingletShape, { depth: 0.1, bevelEnabled: false });
  [1, -1].forEach(sd => {
    const w = new THREE.Mesh(wingGeo, white); w.position.set(0, -1.35, 0); w.scale.z = sd; A.add(w);
    const tipY = -1.35 + 17.1 * 0.055; const wl = new THREE.Mesh(wingletGeo, white); wl.position.set(0, tipY + 0.2, sd * 17.1 - 0.05); wl.rotation.x = sd * 0.14; A.add(wl);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 6.5), grey); flap.position.set(-6.5, -1.12 + 6 * 0.055, sd * 6.3); flap.rotation.y = sd * 0.16; A.add(flap);
    // engine: nacelle (lathe, open intake with a dark fan face), pylon, exhaust cone
    const np = [[0.8, 2.3], [0.98, 2.2], [1.02, 1.1], [0.96, -0.9], [0.8, -1.9], [0.5, -2.5]], ng = new THREE.LatheGeometry(np.map(([r, x]) => new THREE.Vector2(r, x)), 18); ng.rotateZ(-Math.PI / 2);
    const nac = new THREE.Mesh(ng, grey); nac.position.set(3.2, -2.05, sd * 5.2); A.add(nac);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.09, 6, 18), accentM); lip.rotation.y = Math.PI / 2; lip.position.set(5.5, -2.05, sd * 5.2); A.add(lip);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.78, 16), dark); fan.rotation.y = Math.PI / 2; fan.position.set(5.35, -2.05, sd * 5.2); A.add(fan);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 8), metal); cone.rotation.z = Math.PI / 2; cone.position.set(5.05, -2.05, sd * 5.2); A.add(cone);
    const pyl = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.9, 0.2), white); pyl.position.set(2.6, -1.55, sd * 5.2); A.add(pyl);
    // tailplane
    const st = new THREE.Mesh(planform([[-14.6, 0], [-18.6, 7.2], [-19.9, 7.2], [-17.9, 0]], 0.2, 0.07), white); st.position.set(0, 0.85, 0); st.scale.z = sd; A.add(st);
  });
  // fin
  { const fs = new THREE.Shape([new THREE.Vector2(-12.0, 0.9), new THREE.Vector2(-17.2, 8.0), new THREE.Vector2(-19.8, 8.0), new THREE.Vector2(-19.8, 0.9)]);
    const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(fs, { depth: 0.3, bevelEnabled: false }), accentM); fin.position.set(0, 0.9, -0.15); A.add(fin);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 0.34), white); cap.position.set(-18.5, 8.05, 0); A.add(cap); }
  // gear: nose (twin wheels) and two main bogies (twin wheels each); wheel bottoms 2.69 m below the centre
  const gear = new THREE.Group(); A.add(gear);
  [[14.4, 0, 0.95], [-1.2, 2.9, 1.5], [-1.2, -2.9, 1.5]].forEach(([x, z, top]) => {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.69 - 0.55 - top + 0.2, 0.22), metal); strut.position.set(x, -((2.69 - 0.55) + top) / 2 - 0.05, z); gear.add(strut);
    [-1, 1].forEach(k => { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.38, 12), tyre); wh.rotation.x = Math.PI / 2; wh.position.set(x, -2.14, z + k * 0.3); gear.add(wh); });
  });
  // lights: green right wing tip, red left, white strobes on the tips and tail, red beacons top and bottom, a landing light in the nose
  const nav = new THREE.Group(), strobe = new THREE.Group(), beacon = new THREE.Group(), landing = new THREE.Group();
  const tipY = -1.35 + 17.1 * 0.055 + 0.2;
  nav.add(sprite(0x22ff66, 2.6, -7.2, tipY, 17.2), sprite(0xff2a2a, 2.6, -7.2, tipY, -17.2));
  strobe.add(sprite(0xffffff, 3.6, -7.9, tipY, 17.3), sprite(0xffffff, 3.6, -7.9, tipY, -17.3), sprite(0xffffff, 3.2, -20.2, 0.9, 0));
  beacon.add(sprite(0xff3322, 2.8, 1, 1.95, 0), sprite(0xff3322, 2.8, 1, -1.95, 0));
  landing.add(sprite(0xfff4d8, 6, 15.0, -1.5, 0));
  [nav, strobe, beacon, landing].forEach(x => { x.visible = false; A.add(x); });
  // a contrail for cruising flights: a long ribbon behind the plane, faded to nothing at the far end
  const c = document.createElement('canvas'); c.width = 128; c.height = 8; const q = c.getContext('2d');
  if (q && q.createLinearGradient) { const gr = q.createLinearGradient(0, 0, 128, 0); gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); q.fillStyle = gr; q.fillRect(0, 0, 128, 8); }
  const trail = new THREE.Mesh(new THREE.PlaneGeometry(1800, 6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  trail.rotation.x = -Math.PI / 2; trail.position.set(-900 - 24, 0, 0); trail.visible = false; g.add(trail);
  g.userData = { gear, trail, lights: { nav, strobe, beacon, landing } };
  g.scale.setScalar(scale); g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  g.userData.baseScale = scale; g.rotation.order = 'YZX';
  return g;
}

const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const _v = new THREE.Vector3();

// route: array of { p: Vector3 (world, y = height of the plane's centre), v: target speed there (u/s), wait?: seconds to stand still on arrival,
//                   rev?: this leg is driven backwards (pushback), the heading is kept, on?: callback name fired on arrival }
export class Flyer {
  constructor(mesh, { sky = 0, name = '' } = {}) { this.mesh = mesh; this.name = name; this.route = null; this.i = 0; this.d = 0; this.speed = 0; this.wait = 0; this.hd = 0; this.pitch = 0; this.pos = new THREE.Vector3(); this.state = 'idle'; this.hidden = true; this.skyScale = sky || mesh.userData.baseScale; this.done = false; mesh.visible = false; }
  set(pos, hd) { this.pos.copy(pos); this.hd = hd; this.route = null; this.speed = 0; this.done = false; }
  go(route, speed0 = 0) {
    this.route = route; this.i = 0; this.d = 0; this.speed = speed0; this.done = false; this.lens = [];
    for (let k = 0; k + 1 < route.length; k++) this.lens.push(Math.max(0.01, Math.hypot(route[k + 1].p.x - route[k].p.x, route[k + 1].p.z - route[k].p.z)));
    this.pos.copy(route[0].p);
    const t = this.tangent(0); this.hd = Math.atan2(-t.z, t.x);
    if (route[0].v != null && speed0 === 0) this.speed = route[0].v;
  }
  tangent(i) { const a = this.route[i].p, b = this.route[Math.min(this.route.length - 1, i + 1)].p; return { x: b.x - a.x, z: b.z - a.z }; }
  step(dt, fire) {
    const R = this.route; if (!R || this.done) return;
    if (this.wait > 0) { this.wait -= dt; this.speed = 0; return; }
    const i = this.i, a = R[i], b = R[i + 1], len = this.lens[i], frac = Math.min(1, this.d / len);
    // brake early enough for the next stop: the target speed is the straight blend a.v -> b.v along the leg
    const vT = a.v + (b.v - a.v) * frac, acc = this.acc || 4.5;
    this.speed += Math.max(-acc * 2 * dt, Math.min(acc * dt, vT - this.speed));
    const sp = Math.max(this.speed, b.v === 0 && len - this.d < 2 ? 0.4 : 1.2);
    this.d += sp * dt;
    while (this.d >= this.lens[this.i]) {
      this.d -= this.lens[this.i]; this.i++;
      const n = R[this.i];
      if (n.on && fire) fire(n.on, this);
      if (this.i >= R.length - 1) { this.d = 0; this.done = true; this.pos.copy(n.p); fire && fire('end', this); return; }
      if (n.wait) { this.wait = n.wait; this.speed = 0; this.d = 0; this.pos.copy(n.p); return; }
    }
    const A = R[this.i], B = R[this.i + 1], f = this.d / this.lens[this.i];
    this.pos.set(A.p.x + (B.p.x - A.p.x) * f, A.p.y + (B.p.y - A.p.y) * f, A.p.z + (B.p.z - A.p.z) * f);
    if (!A.rev) { const t = this.tangent(this.i), want = Math.atan2(-t.z, t.x), turn = (this.speed < 15 ? 1.4 : 0.6) * dt; this.hd += Math.max(-turn, Math.min(turn, wrap(want - this.hd))); }
    const slope = Math.atan2(B.p.y - A.p.y, this.lens[this.i]); this.pitch += (slope - this.pitch) * Math.min(1, dt * 2.5);
  }
  get airborne() { return this.pos.y > (this.groundY || 0) + 6; }
  // draw it: for real up to SKY_R from the camera, projected onto the sky sphere beyond that; cam null = hide (interiors, other worlds)
  place(cam, t, night, SKY_R = 440) {
    const m = this.mesh; if (!cam || this.hidden || !this.route && this.state === 'gone') { m.visible = false; return; }
    const dx = this.pos.x - cam.x, dy = this.pos.y - cam.y, dz = this.pos.z - cam.z, D = Math.hypot(dx, dy, dz) || 1;
    let k = 1;
    if (D > SKY_R) {
      if (this.pos.y < (this.groundY || 0) + 25 || D > 14000) { m.visible = false; return; }
      k = SKY_R / D; m.position.set(cam.x + dx * k, cam.y + dy * k, cam.z + dz * k);
      if (m.position.y < 4) { m.visible = false; return; }
    } else m.position.copy(this.pos);
    m.visible = true; m.scale.setScalar((D > SKY_R ? this.skyScale : m.userData.baseScale) * k);
    m.rotation.set(0, this.hd, this.pitch);
    const u = m.userData, L = u.lights, air = this.airborne;
    u.gear.visible = !air || this.pos.y < (this.groundY || 0) + 9 + (this.route ? 0 : 0);
    const on = night > 0.12 || D > SKY_R * 1.5 && night > 0.05;
    L.nav.visible = on; L.beacon.visible = on && ((t * 1.1) % 1 < 0.5); L.strobe.visible = on && ((t % 1.3) < 0.1 || ((t % 1.3) > 0.25 && (t % 1.3) < 0.35));
    L.landing.visible = on && this.pos.y < (this.groundY || 0) + 120 && this.speed > 5 && (this.route && this.route.length > 2);
    u.trail.visible = this.contrail && air && this.pos.y > 400;
    void _v;
  }
}
