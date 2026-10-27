// Studio: car editor. Shape (side profile of the body and glass, plus extra boxes such as roof, spoiler, bed), colour, class,
// speed, acceleration, mass, brakes, handling and price of every car. A live 3-D preview shows the result.
import * as THREE from 'three';
import { put, h, hex, unhex, clone, field, numInput, textInput, selectInput, colorInput, distSeg } from './common.js';
import { CAR_STYLES, BASE_STYLES, CAR_WIDTH_K } from '../carModels.js';
import { CAR_SPECS, buildCarFromSpec } from '../vehicleModels.js';
import { UPGRADE_DEFAULTS } from '../customData.js';
import { zeroTo100, CLASS_ORDER } from '../classes.js';

const MATS = ['paint', 'glass', 'dark', 'chrome', 'white', 'stripe', 'sign'];
const PX = 150, GX = 330, GY = 250;      // profile canvas: pixels per unit, screen x of z=0, screen y of the ground

export function createCarEditor(ctx) {
  const root = h('div', { class: 'tab cars' });
  const left = h('div', { class: 'carleft' }), side = h('div', { class: 'side' });
  const prev = h('div', { class: 'prev' }), prof = h('canvas', { width: 660, height: 300, class: 'prof' });
  left.append(prev, prof, h('p', { class: 'hint' }, 'Drag the white dots to reshape. Double-click a line to add a point, right-click a dot to remove it. Drag a part (orange box) to move it. Drag in the 3-D view to turn the car.'));
  root.append(left, side);
  let key = 'hatch', target = 'body', dragV = null, dragPart = null;

  const entry = () => ((ctx.custom().cars ||= {})[key] ||= {});
  const spec = () => { const e = entry(); return e.model || (e.model = clone(CAR_SPECS[key] || CAR_SPECS.hatch)); };
  const style = () => CAR_STYLES.find(s => s.key === key);
  const base = () => BASE_STYLES.find(s => s.key === key);
  const touch = () => { ctx.dirty('cars'); rebuild(); drawProfile(); };

  // ---- 3-D preview ----
  const R = new THREE.WebGLRenderer({ antialias: true }); R.setPixelRatio(Math.min(2, devicePixelRatio || 1)); R.setSize(660, 300); R.shadowMap.enabled = true;
  prev.append(R.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x1a2029);
  const cam = new THREE.PerspectiveCamera(36, 660 / 300, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x303846, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(4, 8, 5); sun.castShadow = true; scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: 0x2a313c, roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  let model = null, yaw = 0.7, pitch = 0.22, dist = 7.2, spin = true;
  function rebuild() {
    if (model) { scene.remove(model); model.traverse(o => { if (o.isMesh && o.material && !o.userData.shared) { /* materials are cheap */ } }); }
    const st = style();
    if (key === 'bus') { model = null; return; }
    model = buildCarFromSpec(spec(), st.color, key); model.scale.x = CAR_WIDTH_K; model.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(model);
  }
  let down = null;
  R.domElement.addEventListener('mousedown', e => { down = [e.clientX, e.clientY, yaw, pitch]; spin = false; });
  addEventListener('mousemove', e => { if (down) { yaw = down[2] - (e.clientX - down[0]) * 0.01; pitch = Math.max(0.02, Math.min(1.3, down[3] + (e.clientY - down[1]) * 0.01)); } });
  addEventListener('mouseup', () => { down = null; });
  R.domElement.addEventListener('wheel', e => { e.preventDefault(); dist = Math.max(4, Math.min(14, dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });
  R.domElement.addEventListener('dblclick', () => { spin = !spin; });
  let alive = false;
  function loop() {
    if (!alive) return;
    if (spin) yaw += 0.006;
    cam.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + 0.6, Math.cos(yaw) * Math.cos(pitch) * dist); cam.lookAt(0, 0.7, 0);
    R.render(scene, cam); requestAnimationFrame(loop);
  }

  // ---- side profile editor ----
  const pc = prof.getContext('2d');
  const sx = z => GX + z * PX, sy = y => GY - y * PX, fz = x => (x - GX) / PX, fy = y => (GY - y) / PX;
  const items = () => {      // editable handles of the selected thing
    const sp = spec();
    if (target === 'body') return sp.body;
    if (target === 'glass' && sp.glass) return sp.glass.pts;
    return null;
  };
  function drawProfile() {
    const sp = spec(), st = style();
    pc.clearRect(0, 0, 660, 300); pc.fillStyle = '#10151b'; pc.fillRect(0, 0, 660, 300);
    pc.strokeStyle = '#2b3440'; pc.lineWidth = 1; for (let z = -2; z <= 2; z += 0.5) { pc.beginPath(); pc.moveTo(sx(z), 0); pc.lineTo(sx(z), 300); pc.stroke(); } for (let y = 0; y <= 2; y += 0.5) { pc.beginPath(); pc.moveTo(0, sy(y)); pc.lineTo(660, sy(y)); pc.stroke(); }
    pc.strokeStyle = '#5b6878'; pc.beginPath(); pc.moveTo(0, sy(0)); pc.lineTo(660, sy(0)); pc.stroke();
    pc.fillStyle = '#8a97a8'; pc.font = '11px system-ui'; pc.fillText('rear', 8, 16); pc.fillText('front  →', 596, 16);
    // wheels for reference
    [[-1.25], [1.25]].forEach(([z]) => { pc.fillStyle = '#0b0c0e'; pc.beginPath(); pc.arc(sx(z), sy(0.42), 0.42 * PX, 0, 7); pc.fill(); pc.strokeStyle = '#8a97a8'; pc.beginPath(); pc.arc(sx(z), sy(0.42), 0.28 * PX, 0, 7); pc.stroke(); });
    const poly = (pts, fill, stroke, w) => { pc.beginPath(); pts.forEach(([z, y], i) => i ? pc.lineTo(sx(z), sy(y)) : pc.moveTo(sx(z), sy(y))); pc.closePath(); if (fill) { pc.fillStyle = fill; pc.fill(); } pc.strokeStyle = stroke; pc.lineWidth = w; pc.stroke(); };
    poly(sp.body, hex(st.color) + 'aa', target === 'body' ? '#fff' : '#9fb0c4', target === 'body' ? 2.5 : 1.5);
    if (sp.glass) poly(sp.glass.pts, 'rgba(30,60,90,.7)', target === 'glass' ? '#fff' : '#6fa0d0', target === 'glass' ? 2.5 : 1.5);
    (sp.parts || []).forEach((q, i) => { const on = target === i; pc.fillStyle = on ? 'rgba(255,159,67,.55)' : 'rgba(255,159,67,.25)'; pc.strokeStyle = on ? '#fff' : '#ff9f43'; pc.lineWidth = on ? 2.5 : 1.2; pc.fillRect(sx(q.z - q.d / 2), sy(q.y + q.h / 2), q.d * PX, Math.max(1, q.h * PX)); pc.strokeRect(sx(q.z - q.d / 2), sy(q.y + q.h / 2), q.d * PX, Math.max(1, q.h * PX)); });
    const pts = items(); if (pts) pts.forEach(([z, y], i) => { pc.fillStyle = dragV === i ? '#ff3b3b' : '#fff'; pc.strokeStyle = '#000'; pc.beginPath(); pc.arc(sx(z), sy(y), 5, 0, 7); pc.fill(); pc.stroke(); });
  }
  const pm = e => { const r = prof.getBoundingClientRect(); return [(e.clientX - r.left) * 660 / r.width, (e.clientY - r.top) * 300 / r.height]; };
  const rnd = v => Math.round(v * 100) / 100;
  prof.addEventListener('contextmenu', e => e.preventDefault());
  prof.addEventListener('mousedown', e => {
    const [mx, my] = pm(e), pts = items(), sp = spec();
    let vi = -1; if (pts) pts.forEach(([z, y], i) => { if (Math.hypot(sx(z) - mx, sy(y) - my) < 10) vi = i; });
    if (e.button === 2) { if (vi >= 0 && pts.length > 3) { pts.splice(vi, 1); touch(); } return; }
    if (vi >= 0) { dragV = vi; return; }
    if (e.detail === 2 && pts) { for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], r = distSeg(mx, my, sx(a[0]), sy(a[1]), sx(b[0]), sy(b[1])); if (r.d < 8) { pts.splice(i + 1, 0, [rnd(fz(mx)), rnd(fy(my))]); touch(); return; } } }
    // pick a part
    for (let i = (sp.parts || []).length - 1; i >= 0; i--) { const q = sp.parts[i]; if (mx >= sx(q.z - q.d / 2) - 3 && mx <= sx(q.z + q.d / 2) + 3 && my >= sy(q.y + q.h / 2) - 3 && my <= sy(q.y - q.h / 2) + 3) { target = i; dragPart = { i, dz: q.z - fz(mx), dy: q.y - fy(my) }; renderSide(); drawProfile(); return; } }
  });
  addEventListener('mousemove', e => {
    if (dragV != null) { const [mx, my] = pm(e), pts = items(); if (pts) { pts[dragV] = [rnd(fz(mx)), Math.max(0, rnd(fy(my)))]; touch(); } }
    else if (dragPart) { const [mx, my] = pm(e), q = spec().parts[dragPart.i]; if (q) { q.z = rnd(fz(mx) + dragPart.dz); q.y = rnd(fy(my) + dragPart.dy); touch(); } }
  });
  addEventListener('mouseup', () => { if (dragV != null || dragPart) { dragV = null; dragPart = null; renderSide(); } });

  // ---- side panel ----
  function stat(label, k, step, hint) { const st = style(); return field(label, numInput(st[k], v => { st[k] = v; entry().stats = { ...(entry().stats || {}), [k]: v }; ctx.dirty('cars'); updDerived(); }, step), hint); }
  let derived;
  function updDerived() { const st = style(); if (derived) derived.textContent = `${Math.round(st.maxSpeed * 6.2)} km/h top speed · 0-100 km/h in ${zeroTo100(st.accel, st.maxSpeed, st.mass).toFixed(1)} s`; }
  function renderSide() {
    const st = style(), sp = key === 'bus' ? null : spec(), e = entry();
    derived = h('p', { class: 'hint' });
    put(side, 
      h('h3', {}, 'Cars'),
      h('div', { class: 'list row' }, CAR_STYLES.map(c => h('div', { class: 'li' + (c.key === key ? ' on' : ''), onclick: () => { key = c.key; target = 'body'; rebuild(); renderSide(); drawProfile(); } }, c.name))),
      h('div', { class: 'props' },
        field('Name', textInput(st.name, v => { st.name = v; entry().stats = { ...(entry().stats || {}), name: v }; ctx.dirty('cars'); })),
        field('Colour', colorInput(st.color, v => { st.color = v; entry().stats = { ...(entry().stats || {}), color: v }; ctx.dirty('cars'); rebuild(); drawProfile(); })),
        field('Class', selectInput(st.cls, [...CLASS_ORDER, 'G'], v => { st.cls = v; entry().stats = { ...(entry().stats || {}), cls: v }; ctx.dirty('cars'); })),
        stat('Top speed (units/s)', 'maxSpeed', 0.1, '1 u/s = 6.2 km/h'), stat('Acceleration', 'accel', 0.05), stat('Mass (kg)', 'mass', 50), stat('Braking', 'brake', 0.05, '1 = good'), stat('Handling', 'handling', 0.05, '1 = good'),
        field('Price ($)', numInput(e.price ?? UPGRADE_DEFAULTS.carPrice[key] ?? 0, v => { e.price = v; ctx.dirty('cars'); }, 100), key === 'hatch' || key === 'taxi' ? 'not for sale (starter / job)' : ''),
        derived,
        h('button', { class: 'btn danger', onclick: () => { Object.assign(st, base()); delete ctx.custom().cars[key]; ctx.dirty('cars'); rebuild(); renderSide(); drawProfile(); } }, 'Reset this car to the original')),
      sp ? h('div', { class: 'props' }, h('h4', {}, 'Shape'),
        h('div', { class: 'list' },
          h('div', { class: 'li' + (target === 'body' ? ' on' : ''), onclick: () => { target = 'body'; renderSide(); drawProfile(); } }, 'Body outline'),
          sp.glass ? h('div', { class: 'li' + (target === 'glass' ? ' on' : ''), onclick: () => { target = 'glass'; renderSide(); drawProfile(); } }, 'Windows / glass') : null,
          (sp.parts || []).map((q, i) => h('div', { class: 'li' + (target === i ? ' on' : ''), onclick: () => { target = i; renderSide(); drawProfile(); } }, (q.n || 'part') + ' · ' + q.mat))),
        partForm(sp),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { (sp.parts ||= []).push({ n: 'new part', w: 0.6, h: 0.1, d: 0.6, x: 0, y: 1.0, z: 0, r: 0.02, mat: 'dark' }); target = sp.parts.length - 1; touch(); renderSide(); } }, '+ Add part'),
          field('Start from', selectInput('', [['', '(copy shape of…)'], ...Object.keys(CAR_SPECS).map(k => [k, k])], v => { if (!v) return; entry().model = clone(CAR_SPECS[v]); target = 'body'; touch(); renderSide(); })),
          h('button', { class: 'btn', onclick: () => { entry().model = clone(CAR_SPECS[key] || CAR_SPECS.hatch); target = 'body'; touch(); renderSide(); } }, 'Reset shape'))) :
        h('p', { class: 'hint' }, 'The city bus is a traffic-bus model; its stats and price can be changed here but not its shape.'),
      h('p', { class: 'hint' }, 'All cars share the same wheel positions and length so lights and collisions keep working. Press "Save" (top right) to keep your changes.'));
    updDerived();
  }
  function partForm(sp) {
    const upd = (q, k) => v => { q[k] = v; touch(); };
    if (target === 'glass' && sp.glass) { const g = sp.glass; return h('div', { class: 'props' }, field('Glass width', numInput(g.w, v => { g.w = v; touch(); }, 0.05)), field('Edge bevel', numInput(g.r ?? 0.03, v => { g.r = v; touch(); }, 0.005))); }
    if (typeof target === 'number' && sp.parts[target]) {
      const q = sp.parts[target];
      return h('div', { class: 'props grid' }, field('Name', textInput(q.n || '', v => { q.n = v; ctx.dirty('cars'); }, '90px')), field('Material', selectInput(q.mat, MATS, v => { q.mat = v; touch(); })),
        ...[['w', 'Width'], ['h', 'Height'], ['d', 'Length'], ['x', 'x'], ['y', 'Height up'], ['z', 'Forward'], ['r', 'Bevel']].map(([k, l]) => field(l, numInput(q[k], upd(q, k), 0.02, '60px'))),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!q.mirror, onchange: e => { q.mirror = e.target.checked ? 1 : 0; touch(); } }), 'Mirror to other side'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!q.cast, onchange: e => { q.cast = e.target.checked ? 1 : 0; touch(); } }), 'Casts shadow'),
        h('button', { class: 'btn danger', onclick: () => { sp.parts.splice(target, 1); target = 'body'; touch(); renderSide(); } }, 'Delete part'));
    }
    return h('p', { class: 'hint' }, target === 'body' ? 'Body outline: the side silhouette, extruded across the car.' : '');
  }
  rebuild(); renderSide(); drawProfile();
  return {
    el: root,
    show() { root.style.display = ''; alive = true; loop(); rebuild(); renderSide(); drawProfile(); },
    hide() { root.style.display = 'none'; alive = false; },
    refresh() { rebuild(); renderSide(); drawProfile(); }
  };
}
