// Easter egg: a little four-seater parked on a private tie-down beside the runway, away from the terminal. Drive up to it, stop, press F (or tap the
// ✈ button) and you are in it. Arcade flight: W/S throttle, ↑/↓ pitch (↓ pulls the nose up), A/D (or ←/→) bank and turn, Space brakes on the ground,
// F parks it and gets you back into your car once it is down and slow. While you fly, the car object itself is carried along with the plane (hidden),
// so the streaming, traffic, map and sound all follow without knowing about it; main.js only skips the car physics, collisions and the water check.
import * as THREE from 'three';

export function lightPlane(body = 0xf4f1e8, accent = 0xc0392b) {
  const g = new THREE.Group(), M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.55, metalness: 0.15 }, o));
  const add = (geo, m, x, y, z, rot) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); if (rot) o.rotation.set(rot[0], rot[1], rot[2]); o.castShadow = true; g.add(o); return o; };
  add(new THREE.CylinderGeometry(0.62, 0.5, 5.4, 12), M(body), 0, 0, 0, [0, 0, Math.PI / 2]);                  // fuselage
  add(new THREE.CylinderGeometry(0.5, 0.2, 2.6, 10), M(body), -3.8, 0.12, 0, [0, 0, Math.PI / 2]);              // tail cone
  add(new THREE.CylinderGeometry(0.64, 0.62, 1.2, 12), M(0x2a2e33), 3.2, -0.02, 0, [0, 0, Math.PI / 2]);        // engine cowl
  add(new THREE.BoxGeometry(1.7, 0.55, 1.12), M(0x1e2a36, { roughness: 0.2, metalness: 0.4 }), 0.55, 0.55, 0);   // canopy
  add(new THREE.BoxGeometry(5.3, 0.16, 0.5), M(accent), 0, 0.02, 0.0).scale.set(1, 1, 2.45);                     // belt stripe (wide, flat)
  add(new THREE.BoxGeometry(1.5, 0.14, 9.6), M(body), 0.5, 0.95, 0);                                              // high wing
  add(new THREE.BoxGeometry(0.2, 1.1, 0.12), M(0xb9bec3), 0.5, 0.45, 2.1, [0.5, 0, 0]); add(new THREE.BoxGeometry(0.2, 1.1, 0.12), M(0xb9bec3), 0.5, 0.45, -2.1, [-0.5, 0, 0]);   // wing struts
  add(new THREE.BoxGeometry(0.9, 0.1, 3.4), M(body), -4.6, 0.28, 0);                                              // tail plane
  add(new THREE.BoxGeometry(1.0, 1.5, 0.1), M(accent), -4.5, 0.95, 0, [0, 0, -0.25]);                             // fin
  [[1.9, 0], [-0.4, 0.95], [-0.4, -0.95]].forEach(([x, z]) => { add(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 10), M(0x18191b), x, -1.0, z, [Math.PI / 2, 0, 0]); add(new THREE.BoxGeometry(0.1, 0.7, 0.1), M(0x6b7075), x, -0.65, z * 0.9); });
  const prop = new THREE.Group(); prop.position.set(3.85, 0, 0); g.add(prop);
  [0, Math.PI / 2].forEach(r => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.5, 0.22), M(0x1b1d20)); b.rotation.x = r; prop.add(b); });
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), M(accent)); prop.add(hub);
  g.userData.prop = prop; g.userData.groundOff = 1.3; g.rotation.order = 'YZX';
  return g;
}

export function createFlight({ scene, camera, car, world, input, toast, airport, heightAt }) {
  const none = { active: false, update() {}, updateCamera() {} };
  if (!airport || !airport.runway) return none;
  const R = airport.runway, W = R.W, side = R.side, vx = -R.uz * side, vz = R.ux * side;
  const hRun = Math.atan2(R.ux, R.uz);                                  // car-style heading (forward = sin h, cos h) along the runway
  const s0 = R.L * 0.2, d0 = -(W / 2 + 17), px = R.ax + R.ux * s0 + vx * d0, pz = R.az + R.uz * s0 + vz * d0;
  const mesh = lightPlane(); scene.add(mesh);
  const OFF = mesh.userData.groundOff;
  const parked = { x: px, z: pz, h: hRun, y: R.Y };
  // the tie-down: a patch of concrete, wheel chocks and a small sign, so it reads as somebody's plane and not as a prop
  { const pad = new THREE.Mesh(new THREE.BoxGeometry(16, 0.12, 14), new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.95 })); pad.position.set(px, R.Y + 0.02, pz); pad.rotation.y = hRun; pad.receiveShadow = true; scene.add(pad);
    const c = document.createElement('canvas'); c.width = 256; c.height = 96; const x = c.getContext('2d');
    if (x && x.fillRect) { x.fillStyle = '#1b2a3a'; x.fillRect(0, 0, 256, 96); x.fillStyle = '#ffd24a'; x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.fillText('PRIVATE · N1250', 128, 42); x.fillStyle = '#fff'; x.font = '20px sans-serif'; x.fillText('F to board', 128, 74); }
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }));
    const sx = px + vx * -1 * 0 + Math.cos(hRun) * 7.5, sz = pz - Math.sin(hRun) * 7.5; sg.position.set(sx, R.Y + 1.7, sz); sg.rotation.y = hRun; scene.add(sg);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.7, 0.15), new THREE.MeshStandardMaterial({ color: 0x30353b })); post.position.set(sx, R.Y + 0.85, sz); scene.add(post); }
  // ---- HUD and the board / exit button ----
  const hud = document.createElement('div'); hud.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:30;display:none;padding:8px 14px;border-radius:12px;background:rgba(10,16,24,.78);color:#fff;font:600 14px system-ui;text-align:center;pointer-events:none;white-space:nowrap';
  const btn = document.createElement('button'); btn.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:31;display:none;padding:12px 22px;border:0;border-radius:24px;background:#ffd21f;color:#111;font:700 17px system-ui';
  document.body.append(hud, btn);
  const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  const keys = new Set();
  const F = { active: false, x: px, y: R.Y + OFF, z: pz, h: hRun, p: 0, bank: 0, speed: 0, vy: 0, thr: 0, onGround: true, gy: R.Y, crashT: 0 };
  const groundAt = (x, z) => { let g = 0; try { g = heightAt(x, z, 0); } catch (e) { g = 0; } return Math.max(0, Number.isFinite(g) ? g : 0); };
  window.addEventListener('keydown', e => {
    if (e.target && e.target.closest && e.target.closest('input,textarea')) return;
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'KeyF') toggle();
    if (F.active && (e.code === 'KeyE' || e.code === 'Tab')) { e.stopImmediatePropagation(); e.preventDefault(); }
    if (F.active && e.code.startsWith('Arrow')) e.preventDefault();
  }, true);
  window.addEventListener('keyup', e => keys.delete(e.code), true);
  window.addEventListener('blur', () => keys.clear());
  btn.addEventListener('click', toggle);
  const near = () => world.mode === 'city' && !world.onFoot && Math.hypot(car.x - parked.x, car.z - parked.z) < 10 && Math.abs(car.speed || 0) < 4 && Math.abs(car.y - parked.y) < 3;
  function toggle() {
    if (F.active) {
      if (!F.onGround || F.speed > 4) { toast('Land and slow down first'); return; }
      const rx = -Math.cos(F.h), rz = Math.sin(F.h);          // the pilot's right-hand side
      parked.x = F.x; parked.z = F.z; parked.h = F.h; parked.y = F.gy;
      car.teleport(F.x + rx * 6.5, F.z + rz * 6.5, F.gy, F.h); car.group.visible = true; F.active = false; keys.clear(); toast('Parked. F near the plane to fly again');
    } else if (near()) {
      F.active = true; F.x = parked.x; F.z = parked.z; F.h = parked.h; F.gy = parked.y; F.y = F.gy + OFF; F.p = 0; F.bank = 0; F.speed = 0; F.vy = 0; F.thr = 0; F.onGround = true; car.group.visible = false;
      toast(isTouch ? 'Take off: hold ▲ to pull up once you are fast' : 'W/S throttle · ↓ pull up · ↑ nose down · A/D bank · F to park');
    }
  }
  function crash() {
    toast('💥 Crashed - the plane is back on its tie-down'); F.crashT = 0;
    car.teleport(parked.x + 9, parked.z, parked.y, parked.h); car.group.visible = true; F.active = false; keys.clear(); parked.h = hRun; F.x = parked.x; F.z = parked.z;
  }
  const down = c => keys.has(c);
  function step(dt) {
    const up = isTouch ? (input.back ? 1 : 0) - (input.forward ? 1 : 0) : (down('ArrowDown') ? 1 : 0) - (down('ArrowUp') ? 1 : 0);
    const turn = (down('KeyA') || down('ArrowLeft') || (isTouch && input.left) ? 1 : 0) - (down('KeyD') || down('ArrowRight') || (isTouch && input.right) ? 1 : 0);
    if (isTouch) F.thr = 0.85; else F.thr = Math.max(0, Math.min(1, F.thr + ((down('KeyW') ? 1 : 0) - (down('KeyS') ? 1 : 0)) * 0.55 * dt));
    const VMAX = 62, STALL = 18, ROT = 21;
    const target = VMAX * F.thr, brake = down('Space') && F.onGround ? 30 : 0;
    F.speed += (target - F.speed) * Math.min(1, dt * (F.onGround ? 0.3 : 0.22)) - (F.onGround ? 1.4 * dt : 0) - brake * dt; F.speed = Math.max(0, F.speed);
    // turning: steer on the ground, bank in the air
    if (F.onGround) { F.bank += (0 - F.bank) * Math.min(1, dt * 6); F.h += turn * 0.5 * Math.min(1, F.speed / 9) * dt; }
    else { F.bank += (turn * 0.75 - F.bank) * Math.min(1, dt * 2.2); F.h += F.bank * 0.9 * Math.min(1, F.speed / 35) * dt; }
    // pitch: limited by speed; below the stall speed the nose drops and the plane sinks
    const lift = Math.max(0, Math.min(1, (F.speed - 10) / (STALL - 10)));
    if (F.onGround) { if (up > 0 && F.speed >= ROT) F.p = Math.min(0.4, F.p + 0.55 * dt); else F.p += (0 - F.p) * Math.min(1, dt * 4); }
    else { F.p += up * 0.6 * dt; F.p -= (1 - lift) * 0.5 * dt; F.p = Math.max(-0.7, Math.min(0.45, F.p)); }
    const fwd = F.speed * Math.cos(F.p);
    F.x += Math.sin(F.h) * fwd * dt; F.z += Math.cos(F.h) * fwd * dt;
    const gy = groundAt(F.x, F.z); F.gy = gy;
    if (F.onGround) {
      F.y = gy + OFF; F.vy = 0;
      if (F.p > 0.05 && F.speed >= ROT) { F.onGround = false; F.vy = F.speed * Math.sin(F.p); }
    } else {
      F.vy += (F.speed * Math.sin(F.p) - F.vy) * Math.min(1, dt * 2.5) - (1 - lift) * 14 * dt;
      F.y += F.vy * dt;
      if (F.y > 1400) { F.y = 1400; F.vy = Math.min(F.vy, 0); }
      if (F.y <= gy + OFF) {
        if (F.vy < -11 || Math.abs(F.bank) > 0.5 || F.p < -0.3) { crash(); return; }
        F.y = gy + OFF; F.vy = 0; F.onGround = true; F.p = Math.max(0, F.p * 0.3); F.bank = 0;
      }
    }
    // the car object rides along
    car.x = F.x; car.z = F.z; car.y = F.y - OFF; car.heading = F.h; car.speed = 0; car.vx = 0; car.vz = 0; car.vy = 0;
    mesh.userData.prop.rotation.x += dt * (12 + 70 * F.thr);
  }
  let hintT = 0;
  return {
    get active() { return F.active; }, F,
    update(dt) {
      if (F.active) {
        step(Math.min(dt, 0.05));
        if (!F.active) { hud.style.display = 'none'; btn.style.display = 'none'; }
      }
      if (F.active) {
        mesh.position.set(F.x, F.y, F.z); mesh.rotation.set(-F.bank * 0.9, F.h - Math.PI / 2, F.p);
        hud.style.display = 'block'; hud.textContent = '✈ ' + Math.round(F.speed * 4.5) + ' km/h · ALT ' + Math.round((F.y - OFF - F.gy) * 1.25) + ' m · THR ' + Math.round(F.thr * 100) + '%' + (F.onGround ? ' · F: park' : '');
        btn.textContent = 'Park'; btn.style.display = F.onGround && F.speed < 4 && isTouch ? 'block' : 'none';
      } else {
        mesh.position.set(parked.x, parked.y + OFF, parked.z); mesh.rotation.set(0, parked.h - Math.PI / 2, 0); mesh.userData.prop.rotation.x += dt * 0.2;
        hud.style.display = 'none';
        const n = near(); btn.style.display = n && isTouch ? 'block' : 'none'; btn.textContent = '✈ Board plane';
        if (n && (hintT -= dt) <= 0) { toast('Press F to board the plane'); hintT = 6; } else if (!n) hintT = 0;
      }
      mesh.visible = world.mode === 'city';
    },
    updateCamera(dt) {
      const cp = Math.cos(F.p), fx = Math.sin(F.h) * cp, fy = Math.sin(F.p), fz = Math.cos(F.h) * cp;
      const ex = F.x - fx * 26, ey = F.y - fy * 26 + 7.5, ez = F.z - fz * 26;
      const k = 1 - Math.pow(0.0008, dt); camera.position.x += (ex - camera.position.x) * k; camera.position.y += (ey - camera.position.y) * k; camera.position.z += (ez - camera.position.z) * k;
      camera.up.set(0, 1, 0); camera.lookAt(F.x + fx * 16, F.y + fy * 16 + 1.5, F.z + fz * 16);
    }
  };
}
