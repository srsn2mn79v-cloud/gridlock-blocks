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

// long axis along +x (nose at +x), +y up, +z to the right of the pilot.  userData: gear, lights {nav, strobe, beacon, landing}, trail
export function planeMesh(body = 0xf2f3f4, accent = 0x2a6db8, scale = 1) {
  const g = new THREE.Group(), M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.5, metalness: 0.2 }, o));
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 30, 14), M(body)); fus.rotation.z = Math.PI / 2; g.add(fus);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), M(body)); nose.rotation.z = -Math.PI / 2; nose.position.x = 15; nose.scale.set(1.5, 1, 1); g.add(nose);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 0.7, 9, 12), M(body)); tail.rotation.z = Math.PI / 2; tail.position.x = -19; g.add(tail);
  const cock = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 3.2), M(0x1e2a36)); cock.position.set(16.2, 0.9, 0); g.add(cock);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(2.43, 2.43, 22, 14, 1, true), M(accent)); stripe.rotation.z = Math.PI / 2; stripe.position.x = -1; g.add(stripe);
  const wingGeo = new THREE.BoxGeometry(6, 0.5, 17);
  [1, -1].forEach(s => {
    const w = new THREE.Mesh(wingGeo, M(0xd9dde0)); w.position.set(-1, -1, s * 10); w.rotation.y = -s * 0.5; g.add(w);
    const en = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4, 10), M(0x9aa3ab)); en.rotation.z = Math.PI / 2; en.position.set(1.8, -2.2, s * 8.6); g.add(en);
    const st = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.4, 8), M(0xd9dde0)); st.position.set(-20.5, 0.8, s * 4.5); st.rotation.y = -s * 0.4; g.add(st);
  });
  const fin = new THREE.Mesh(new THREE.BoxGeometry(5, 8, 0.5), M(accent)); fin.position.set(-20, 5, 0); fin.rotation.z = -0.35; g.add(fin);
  const gear = new THREE.Group(); g.add(gear);
  [[11, 0], [-3, 3.2], [-3, -3.2]].forEach(([x, z]) => {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.7, 10), M(0x1b1d20)); wh.rotation.x = Math.PI / 2; wh.position.set(x, -3.1, z); gear.add(wh);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.6, 0.25), M(0x6b7075)); strut.position.set(x, -2.3, z); gear.add(strut);
  });
  // lights: green right wing tip, red left, white strobes on the tips and tail, a red beacon on top, a landing light in the nose
  const nav = new THREE.Group(), strobe = new THREE.Group(), beacon = new THREE.Group(), landing = new THREE.Group();
  nav.add(sprite(0x22ff66, 3.2, -5.1, -0.8, 17.6), sprite(0xff2a2a, 3.2, -5.1, -0.8, -17.6));
  strobe.add(sprite(0xffffff, 4.5, -5.2, -0.8, 17.7), sprite(0xffffff, 4.5, -5.2, -0.8, -17.7), sprite(0xffffff, 4, -23.5, 8.6, 0));
  beacon.add(sprite(0xff3322, 3.4, 1, 2.8, 0), sprite(0xff3322, 3.4, 1, -2.8, 0));
  landing.add(sprite(0xfff4d8, 7, 19, -1.2, 0));
  [nav, strobe, beacon, landing].forEach(x => { x.visible = false; g.add(x); });
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
