// Life outside the driver's seat: stepping out of the car and walking, the yellow "enter" arrows at
// apartment and shop doors, apartments + garages, the dealership and the four tuning shops, and the
// car modifications themselves (paint, decals, neon, body kits, performance parts, nitro, HUD).
// Everything is saved to localStorage ('gridlock.world'); money is the taxi wallet (taxi.getCash()).
import * as THREE from 'three';
import { CAR_STYLES, buildCarModel } from './carModels.js';
import { createShowroom } from './showroom.js';
import { dressAvatar, createStage, SLOTS, CLOTHES, DEFAULT_OUTFIT, itemOf, startOwned } from './wardrobe.js';
import { carClass, zeroTo100, classIndex, CLASS_ORDER } from './classes.js';
import { SHOP_KINDS, APARTMENT_TIERS, AGENT_MARKUP, regionOf } from './chicago/chicago.js';
import { createFlatLights } from './flatlight.js';
import { buildInterior, buildStoreInterior, buildGarage, buildGateMesh, garageLayout, garageHeight, RAMP, bayAt, FINE_SECS } from './estate.js';
import { createGroundGlow } from './glow.js';
import { buildKit } from './bodykit.js';
import { getUpgrades } from './customData.js';
const UPG = getUpgrades();      // prices + effects of every upgrade (editable in the Studio)

const SAVE_KEY = 'gridlock.world';
const STARTERS = ['hatch'];   // taxi and bus are jobs now (cab stands, bus depot), not cars you can buy
const CAR_PRICE = UPG.carPrice;
const PAINTS = [['Racing red', 0xd62a2a], ['Sunset orange', 0xff5e3a], ['Gold', 0xf1b800], ['Lime', 0x7ed321], ['Forest', 0x1f7a44], ['Teal', 0x14b3a6],
  ['Sky blue', 0x3aa0ff], ['Cobalt', 0x2f4fd8], ['Violet', 0x7a3fd1], ['Hot pink', 0xff4fa3], ['Pearl white', 0xf2f2f2], ['Graphite', 0x30343b], ['Jet black', 0x0e0f12]];
const DECAL_COLORS = [['White', 0xffffff], ['Black', 0x111111], ['Yellow', 0xffd21f], ['Red', 0xe53030], ['Blue', 0x2f7bff], ['Cyan', 0x17d6c8]];
const NEONS = [['Pink', 0xff2fa8], ['Cyan', 0x20e8ff], ['Green', 0x38ff6a], ['Violet', 0xa14bff], ['White', 0xffffff], ['Red', 0xff2a2a]];
const NITRO_SECS = [0, ...UPG.nitro.secs];

const defaultMods = () => ({ paint: null, decal: { type: 'none', color: 0xffffff }, neon: null, xenon: false, nitro: 0, hud: 0, tank: 0,
  perf: { engine: 0, turbo: 0, gearbox: 0, tires: 0, suspension: 0, brakes: 0, weight: 0, seats: 0, limiter: 0 }, kit: { front: 0, rear: 0, skirts: 0, spoiler: 0, fenders: 0, hood: 0 }, own: {} });

function loadSave() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { /* private mode */ }
  if (!s) s = { apts: {}, bought: [], mods: {}, welcomed: false };
  s.apts ||= {}; s.bought ||= []; s.mods ||= {}; s.fleet ||= {};
  return s;
}

// ---------- tiny 2-D geometry helpers for walking -----------------------------------------------------
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function closestOnPoly(px, pz, poly) {
  let best = null, bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2)) : 0;
    const cx = a[0] + t * dx, cz = a[1] + t * dz, d = Math.hypot(px - cx, pz - cz);
    if (d < bd) { bd = d; best = [cx, cz]; }
  }
  return { x: best[0], z: best[1], d: bd };
}

// 1 world unit = 1.25 m. The modelled body is 1.89 u tall; scaled to a 1.8 m (1.44 u) man.
const AVATAR_SCALE = 1.44 / 1.89;
export function makeAvatar() {
  const g = new THREE.Group();
  const M = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const jacket = M(0x2f6fe0), pants = M(0x23262d), skin = M(0xe0b090, 0.7), shoe = M(0x15161a), hairM = M(0x3a2a1d, 0.9), dark = M(0x1a1410), lip = M(0xa8625a);
  const box = (w, h, d, m, x, y, z, parent = g) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const mesh = (geo, m, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  // torso: chest + waist (both take the shirt material); neck
  box(0.5, 0.38, 0.28, jacket, 0, 1.33, 0); box(0.44, 0.285, 0.25, jacket, 0, 1.02, 0);
  mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10), skin, 0, 1.56, 0);
  // head: skull, ears, brows, eyes, nose, mouth, hair
  mesh(new THREE.SphereGeometry(0.17, 16, 12), skin, 0, 1.7, 0);
  [-1, 1].forEach(s => {
    box(0.03, 0.07, 0.045, skin, s * 0.17, 1.7, 0); box(0.07, 0.014, 0.012, hairM, s * 0.065, 1.755, 0.158);
    box(0.034, 0.024, 0.012, dark, s * 0.065, 1.72, 0.162); box(0.03, 0.12, 0.1, hairM, s * 0.158, 1.73, -0.02);
  });
  box(0.03, 0.045, 0.045, skin, 0, 1.69, 0.17); box(0.07, 0.012, 0.01, lip, 0, 1.64, 0.162);
  mesh(new THREE.SphereGeometry(0.18, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), hairM, 0, 1.715, -0.012);
  box(0.28, 0.12, 0.05, hairM, 0, 1.69, -0.15);
  const hatSlot = new THREE.Group(); hatSlot.position.set(0, 1.74, 0); g.add(hatSlot);
  const glassSlot = new THREE.Group(); glassSlot.position.set(0, 1.72, 0.16); g.add(glassSlot);
  const torsoSlot = new THREE.Group(), pantsSlot = new THREE.Group(); g.add(torsoSlot, pantsSlot);
  // limbs: arms and legs are pivots at shoulder / hip so the walk cycle can swing them
  const pivot = (x, y, ph) => { const p = new THREE.Group(); p.position.set(x, y, 0); p.userData.ph = ph; g.add(p); return p; };
  const shins = [], armSlots = [], legSlots = [];
  const legs = [-0.13, 0.13].map((x, i) => {
    const p = pivot(x, 0.88, i ? Math.PI : 0);
    box(0.2, 0.44, 0.22, pants, 0, -0.22, 0, p); shins.push(box(0.19, 0.44, 0.21, pants, 0, -0.66, 0, p));
    const sl = new THREE.Group(); sl.userData.side = x < 0 ? -1 : 1; p.add(sl); legSlots.push(sl); return p;
  });
  const arms = [-0.34, 0.34].map((x, i) => {
    const p = pivot(x, 1.5, i ? 0 : Math.PI);
    box(0.14, 0.32, 0.16, skin, 0, -0.16, 0, p); box(0.125, 0.34, 0.14, skin, 0, -0.49, 0, p);
    box(0.1, 0.12, 0.13, skin, 0, -0.72, 0.005, p); box(0.025, 0.07, 0.05, skin, x < 0 ? 0.06 : -0.06, -0.72, 0.05, p);
    const sl = new THREE.Group(); sl.userData.side = x < 0 ? -1 : 1; p.add(sl); armSlots.push(sl); return p;
  });
  const shoeMeshes = [], footSlots = [];
  [-0.13, 0.13].forEach(x => {
    shoeMeshes.push(box(0.2, 0.1, 0.3, shoe, x, 0.05, 0.04));
    const f = new THREE.Group(); f.position.set(x, 0, 0.04); g.add(f); footSlots.push(f);
  });
  // each shoe + its foot decoration rides in a group that swings about the hip with its leg (see stepFoot), so the feet move with the legs
  legs.forEach((l, i) => { const fw = new THREE.Group(); fw.add(shoeMeshes[i], footSlots[i]); g.add(fw); l.userData.fw = fw; });
  g.userData.limbs = legs.concat(arms);
  g.userData.mats = { shirt: jacket, pants, shoe, skin }; g.userData.shoes = shoeMeshes; g.userData.shins = shins;
  g.userData.hatSlot = hatSlot; g.userData.glassSlot = glassSlot; g.userData.torsoSlot = torsoSlot; g.userData.pantsSlot = pantsSlot;
  g.userData.armSlots = armSlots; g.userData.legSlots = legSlots; g.userData.footSlots = footSlots;
  g.scale.setScalar(AVATAR_SCALE);
  return g;
}

function arrowMarker(hex) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1.6, roughness: 0.4 });
  mat.userData.snow = { skip: true };
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.3, 4), mat); cone.rotation.x = Math.PI; cone.position.y = 0.65;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 0.4), mat); shaft.position.y = 1.75;
  const arrow = new THREE.Group(); arrow.add(cone, shaft); g.add(arrow);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.35, 28), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; g.add(ring);
  g.userData.arrow = arrow;
  return g;
}

export function createWorld({ setGarageHoles, city, scene, camera, car, input, heightAt: cityHeight, collisionWorld, parcelInstances, taxi, env, chooseCar, setModalPause }) {
  const save = loadSave();
  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } };
  if (!save.welcomed) { save.welcomed = true; if (taxi.getCash() < 300) taxi.addCash(300 - taxi.getCash()); persist(); }
  if (!save.gift100k) { save.gift100k = true; taxi.addCash(100000); persist(); }   // starting purse, so the shops can be browsed
  if (!save.gift1m) { save.gift1m = true; if (taxi.getCash() < 1000000) taxi.addCash(1000000 - taxi.getCash()); persist(); }   // a million to play with
  if (!save.outfit) save.outfit = { ...DEFAULT_OUTFIT };
  if (!save.clothes) save.clothes = startOwned();
  const ownsCloth = (slot, id) => save.clothes.includes(slot + ':' + id);
  const modsOf = key => {
    const m = (save.mods[key] ||= defaultMods());
    m.perf = Object.assign({ engine: 0, turbo: 0, gearbox: 0, tires: 0, suspension: 0, brakes: 0, weight: 0, seats: 0, limiter: 0 }, m.perf);   // older saves lack the newer parts
    m.kit = Object.assign({ front: 0, rear: 0, skirts: 0, spoiler: 0, fenders: 0, hood: 0 }, m.kit);
    return m;
  };
  const garageSlots = () => (city.apartments || []).reduce((n, a) => n + (save.apts[a.id] ? a.garage : 0), 0);
  const fleet = save.fleet;
  // where the player is: the open city, an apartment's underground garage, or inside a flat
  let mode = 'city', cur = null, trans = false;   // cur = { a, o, g?, statics?, polys?, F? } for the apartment being visited
  const garages = {}, flats = {};
  const aptIdx = a => city.apartments.indexOf(a);
  // ground height for everything that drives or walks: the city sampler, or the garage floor / ramp in the pocket world
  let arenaH = null;
  function hAt(x, z, refY) {
    if (x < -6000 && arenaH) { const y = arenaH(x, z); hAt.kind = arenaH.kind; return y; }
    // inside the garage the floor and ramp are the garage's own (the garage is built in the real city, under the building)
    if (mode === 'garage' && cur && cur.g) {
      const p = cur.toL(x, z), h = garageHeight(cur.g.lay, p.x, p.z);
      if (h != null) { hAt.kind = 'road'; return h; }
    }
    const r = cityHeight(x, z, refY); hAt.kind = cityHeight.kind; return r;
  }
  hAt.kind = 'road';
  const heightAt = hAt;
  const ownedCars = () => STARTERS.concat(save.bought);
  const cash = () => taxi.getCash();

  // ---------- UI shell ------------------------------------------------------------------------------
  const css = document.createElement('style');
  css.textContent = `
    #wprompt { position: fixed; left: 50%; bottom: 120px; transform: translateX(-50%); z-index: 8; padding: 9px 18px; border-radius: 22px; display: none; cursor: pointer;
      font: 700 15px system-ui, sans-serif; color: #111; background: #ffd21f; box-shadow: 0 2px 12px rgba(0,0,0,.5); }
    #wprompt kbd { background: #111; color: #ffd21f; border-radius: 5px; padding: 1px 7px; margin-right: 6px; }
    #wpanel { position: fixed; top: 0; right: 0; bottom: 0; width: min(430px, 100vw); z-index: 15; display: none; flex-direction: column; background: rgba(12,16,22,.93);
      color: #eaf0f7; font: 14px system-ui, sans-serif; border-left: 4px solid var(--accent, #ffd21f); }
    @media (max-width: 720px) { #wpanel { top: auto; left: 0; right: 0; bottom: 0; width: 100vw; height: 52vh; border-left: 0; border-top: 4px solid var(--accent, #ffd21f); } }
    #wpanel header { padding: 14px 16px 8px; } #wpanel h2 { margin: 0; font-size: 20px; } #wpanel .sub { color: #9db0c6; font-size: 12px; margin-top: 3px; }
    #wpanel .cashline { display: flex; justify-content: space-between; padding: 6px 16px; background: rgba(255,255,255,.06); font-weight: 700; }
    #wpanel .cashline span:first-child { color: #7dffa9; }
    #wpanel .tabs { display: flex; gap: 6px; padding: 10px 12px 0; flex-wrap: wrap; }
    #wpanel .tabs button { border: 0; border-radius: 8px; padding: 6px 10px; font: inherit; font-size: 12px; background: rgba(255,255,255,.09); color: #dbe5f0; cursor: pointer; }
    #wpanel .tabs button.on { background: var(--accent, #ffd21f); color: #111; font-weight: 700; }
    #wpanel .list { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
    #wpanel .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.07); }
    #wpanel .row.sel { outline: 2px solid var(--accent, #ffd21f); }
    #wpanel .row .t { flex: 1; } #wpanel .row .t b { display: block; } #wpanel .row .t small { color: #9db0c6; }
    #wpanel .row button { border: 0; border-radius: 8px; padding: 7px 12px; font: inherit; font-weight: 700; min-width: 74px; cursor: pointer; background: var(--accent, #ffd21f); color: #111; }
    #wpanel .row button[disabled] { background: rgba(255,255,255,.14); color: #8fa0b4; cursor: default; }
    #wpanel .chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 6px 4px; }
    #wpanel .chip { width: 34px; height: 34px; border-radius: 50%; border: 3px solid rgba(255,255,255,.25); cursor: pointer; }
    #wpanel .chip.on { border-color: #fff; box-shadow: 0 0 0 2px var(--accent, #ffd21f); }
    #wpanel .pbars { padding: 8px 16px 10px; background: rgba(255,255,255,.04); }
    #wpanel .pbar { display: grid; grid-template-columns: 96px 1fr 30px; align-items: center; gap: 8px; margin: 3px 0; font-size: 12px; }
    #wpanel .pbar .trk { position: relative; height: 9px; border-radius: 5px; background: rgba(255,255,255,.13); overflow: hidden; }
    #wpanel .pbar .cur { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent, #ffd21f); }
    #wpanel .pbar .up { position: absolute; top: 0; bottom: 0; background: #5cff8a; } #wpanel .pbar .dn { position: absolute; top: 0; bottom: 0; background: #ff5c5c; }
    #wpanel .pbar b { text-align: right; } #wpanel .pwt { font-size: 12px; color: #9db0c6; margin-top: 4px; }
    #wpanel .hint { font-size: 12px; color: #9db0c6; padding: 2px 4px; }
    #wpanel .cartline { display: flex; justify-content: space-between; padding: 6px 16px; background: rgba(255,210,31,.12); font-weight: 700; } #wpanel .cartline b { color: var(--accent, #ffd21f); }
    #wpanel footer button.buy { margin-bottom: 8px; background: var(--accent, #ffd21f); color: #111; } #wpanel footer button.buy[disabled] { background: rgba(255,255,255,.14); color: #ff9a9a; cursor: default; }
    #wpanel footer { padding: 10px 12px; } #wpanel footer button { width: 100%; border: 0; border-radius: 10px; padding: 10px; font: inherit; font-weight: 700; background: rgba(255,255,255,.16); color: #fff; cursor: pointer; }
    #wtoast { position: fixed; left: 50%; top: 70px; transform: translateX(-50%); z-index: 30; padding: 8px 16px; border-radius: 10px; background: rgba(0,0,0,.8); color: #fff; font: 14px system-ui; display: none; }
    #wcluster { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 6; display: none; text-align: center; font-family: ui-monospace, monospace; color: #7df; text-shadow: 0 0 8px #0af; pointer-events: none; }
    #wcluster .big { font-size: 44px; font-weight: 800; line-height: 1; } #wcluster .big small { font-size: 14px; }
    #wcluster .bar { width: 190px; height: 8px; margin: 5px auto 0; border-radius: 4px; background: rgba(255,255,255,.15); overflow: hidden; } #wcluster .bar i { display: block; height: 100%; background: linear-gradient(90deg,#ff8a00,#ffe14d); }
    #wcluster .meta { font-size: 13px; opacity: .85; margin-top: 3px; }
    #wact { display: none; }
    html.touch #wact { position: fixed; z-index: 7; right: 16px; top: 72px; width: 60px; height: 60px; border-radius: 50%; border: 0; font-size: 26px; background: #ffd21f; color: #111; }
    html.touch #wprompt { bottom: 170px; }
    #wfade { position: fixed; inset: 0; background: #000; opacity: 0; transition: opacity .26s; z-index: 40; pointer-events: none; }
  `;
  document.head.appendChild(css);
  const promptEl = document.createElement('div'); promptEl.id = 'wprompt'; document.body.appendChild(promptEl);
  const panel = document.createElement('div'); panel.id = 'wpanel'; document.body.appendChild(panel);
  const toastEl = document.createElement('div'); toastEl.id = 'wtoast'; document.body.appendChild(toastEl);
  const cluster = document.createElement('div'); cluster.id = 'wcluster'; document.body.appendChild(cluster);
  const actBtn = document.createElement('button'); actBtn.id = 'wact'; actBtn.textContent = '🚪'; document.body.appendChild(actBtn);
  const fadeEl = document.createElement('div'); fadeEl.id = 'wfade'; document.body.appendChild(fadeEl);
  let toastT = 0;
  function toast(msg) { toastEl.textContent = msg; toastEl.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.style.display = 'none'; }, 2600); }

  // ---------- applying a car's modifications --------------------------------------------------------
  const neonMesh = createGroundGlow(0xffffff, 3.0, 5.4); neonMesh.position.y = 0.07; car.group.add(neonMesh);
  const flames = [-0.5, 0.5].map(x => { const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.1, 8), new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0.9 })); f.rotation.x = -Math.PI / 2; f.position.set(x, 0.42, -2.35); f.visible = false; car.group.add(f); return f; });
  const _ray = new THREE.Raycaster(), _v = new THREE.Vector3(), _d = new THREE.Vector3();

  function surfaceHit(model, meshes, origin, dir) {
    _v.copy(origin).applyMatrix4(model.matrixWorld);
    _d.copy(dir).transformDirection(model.matrixWorld);
    _ray.set(_v, _d); _ray.far = 8;
    const hits = _ray.intersectObjects(meshes, false);
    return hits.length ? model.worldToLocal(hits[0].point.clone()) : null;
  }
  function ribbon(points, up, color) {
    // points: [[x,y,z, ox,oy,oz]] — centre plus the half-width offset vector at that sample
    const pos = [], idx = [];
    points.forEach(p => { pos.push(p[0] - p[3] + up[0], p[1] - p[4] + up[1], p[2] - p[5] + up[2], p[0] + p[3] + up[0], p[1] + p[4] + up[1], p[2] + p[5] + up[2]); });
    for (let i = 0; i < points.length - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.45, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  }

  // ---------- performance model: what each part does, and the five ratings the Performance shop shows -------------
  function perfStats(styleKey, P) {
    const st = CAR_STYLES.find(c => c.key === styleKey) || CAR_STYLES[0];
    const fx = k => Object.keys(UPG.stages).reduce((a, n) => a + ((UPG.stages[n].fx || {})[k] || 0) * (P[n] || 0), 0);
    const mass = Math.round(st.mass * (1 - fx('weight')) - (P.seats ? UPG.seats.kg : 0));
    const maxSpeed = st.maxSpeed * (1 + fx('speed')) * (P.limiter ? 1 + UPG.limiter.speed : 1);
    const accel = st.accel * (1 + fx('accel'));
    const gripBonus = fx('grip');
    const brakeMul = (st.brake || 1) * (1 + fx('brake'));
    const handlingMul = (st.handling || 1) * (1 + fx('handling'));
    // ratings 0-100 (what you actually feel: lighter = quicker off the line, better braking and turn-in)
    const effAccel = accel * Math.pow(st.mass / mass, 0.8), hm = handlingMul * Math.pow(1100 / mass, 0.25), brk = brakeMul * Math.pow(1100 / mass, 0.3);
    const r = (v, lo, hi) => Math.max(0, Math.min(100, Math.round((v - lo) / (hi - lo) * 100)));
    return { mass, maxSpeed, accel, gripBonus, brakeMul, handlingMul,
      bars: [['Speed', r(maxSpeed, 14, 38)], ['Acceleration', r(effAccel, 1.4, 5)], ['Handling', r(hm, 0.6, 1.6)], ['Braking', r(brk, 0.6, 1.9)], ['Grip', Math.max(0, Math.min(100, Math.round(40 + gripBonus * 200)))]] };
  }

  function applyMods(override) {
    if (!override) reconcileFleet();
    const key = car.styleKey, m = override || modsOf(key), model = car.model, st = model.userData.style;
    model.updateMatrixWorld(true);
    // --- stats
    const P = m.perf;
    const ps = perfStats(key, P);
    car.maxSpeed = ps.maxSpeed; car.accel = ps.accel; car.gripBonus = ps.gripBonus; car.brakeMul = ps.brakeMul; car.handlingMul = ps.handlingMul;
    car.mass = ps.mass; car.baseMass = st.mass; car.massFactor = Math.max(0.6, Math.min(1.6, Math.pow(ps.mass / 1300, 0.6)));
        car._baseMax = car.maxSpeed; car._baseAccel = car.accel;
    // --- paint
    const base = m.paint != null ? m.paint : st.color;
    model.traverse(o => { if (o.isMesh && o.material.isMeshPhysicalMaterial && o.material.clearcoat > 0.5) o.material.color.setHex(base); });
    // --- add-ons live in one group, rebuilt every time
    if (model.userData.mods) { model.remove(model.userData.mods); model.userData.mods.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
    const grp = new THREE.Group(); model.userData.mods = grp; model.add(grp);
    const wheelSet = new Set(model.userData.wheels || []);
    const meshes = []; model.traverse(o => { if (o.isMesh && !wheelSet.has(o) && !(o.parent && wheelSet.has(o.parent)) && o.geometry.type !== 'PlaneGeometry') meshes.push(o); });
    const down = new THREE.Vector3(0, -1, 0);
    const heightAtZ = (x, z) => { const h = surfaceHit(model, meshes, new THREE.Vector3(x, 4, z), down); return h ? h.y : null; };
    const wz0 = () => (model.userData.wheels || []).map(w => w.position);
    const carbon = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.5, metalness: 0.3 });
    const add = (geo, mat, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; grp.add(o); return o; };
    // decals: vinyl hugging the real surface (heights sampled with rays)
    const D = m.decal;
    if (D && D.type !== 'none') {
      const stripe = (x0, hw) => {
        let run = [];
        const flush = () => { if (run.length > 2) grp.add(ribbon(run, [0, 0.012, 0], D.color)); run = []; };
        for (let z = 1.75; z >= -1.75; z -= 0.07) { const y = heightAtZ(x0, z); if (y == null) { flush(); continue; } run.push([x0, y, z, hw, 0, 0]); }
        flush();
      };
      if (D.type === 'stripe') stripe(0, 0.2);
      else if (D.type === 'twin') { stripe(-0.2, 0.08); stripe(0.2, 0.08); }
      else if (D.type === 'side') {
        [-1, 1].forEach(s => {
          const run = [];
          for (let z = 1.7; z >= -1.7; z -= 0.1) {
            const h = surfaceHit(model, meshes, new THREE.Vector3(s * 3, 0.62, z), new THREE.Vector3(-s, 0, 0));
            if (h) run.push([h.x, h.y, z, 0, 0.07, 0]);
          }
          if (run.length > 2) grp.add(ribbon(run, [s * 0.012, 0, 0], D.color));
        });
      }
    }
    // body kit (bodykit.js)
    grp.add(buildKit(m.kit, { base, heightAtZ, wheels: wz0(), wheelR: model.userData.wheelR || 0.38 }));
    // neon underglow, xenon headlights
    if (m.neon != null) { neonMesh.material.color.setHex(m.neon); neonMesh.material.opacity = 0.9; neonMesh.visible = true; } else neonMesh.visible = false;
    const xen = m.xenon;
    (car.headSpots || []).forEach(sp => sp.color.setHex(xen ? 0xcfe2ff : 0xfff2d0));
    (car.headlightMeshes || []).forEach(l => l.material.emissive.setHex(xen ? 0xbcd8ff : 0xfff6d0));
    // nitro tank: twin pipes at the back
    if (m.nitro) { [-0.5, 0.5].forEach(x => add(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.9, roughness: 0.25 }), x, 0.42, -1.82, Math.PI / 2)); }
    updateCluster(true);
  }

  // ---------- nitro + HUD cluster ---------------------------------------------------------------------
  let nitro = 1, boosting = false;
  function beforeCar(dt) {
    const m = modsOf(car.styleKey), lvl = m.nitro;
    if (!onFoot && lvl > 0 && input.boost && nitro > 0.02 && car.speed > 1) { boosting = true; nitro = Math.max(0, nitro - dt / NITRO_SECS[lvl]); }
    else { boosting = false; nitro = Math.min(1, nitro + dt * 0.1); }
    car.maxSpeed = (car._baseMax || car.maxSpeed) * (boosting ? 1.3 : 1);
    car.accel = (car._baseAccel || car.accel) * (boosting ? 2.4 : 1);
    flames.forEach(f => { f.visible = boosting; if (boosting) f.scale.set(1, 0.7 + Math.random() * 0.8, 1); });
  }
  let clusterT = 0;
  function updateCluster(force) {
    const m = modsOf(car.styleKey);
    if (!m.hud && !m.nitro) { cluster.style.display = 'none'; return; }
    const now = performance.now();
    if (!force && now - clusterT < 90) return; clusterT = now;
    cluster.style.display = onFoot ? 'none' : 'block';
    const kmh = Math.round(Math.hypot(car.vx || 0, car.vz || 0) * 6.2);
    let html = '';
    if (m.hud) {
      html += `<div class="big">${kmh}<small> km/h</small></div>`;
      if (m.hud >= 2) {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const hdg = (Math.atan2(-Math.sin(car.heading), Math.cos(car.heading)) * 180 / Math.PI + 360) % 360;   // game +z = north
        const hr = env && env.state ? env.state.hour : 12, hh = Math.floor(hr) % 24, mm = Math.floor((hr % 1) * 60);
        html += `<div class="meta">${dirs[Math.round(hdg / 45) % 8]} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}</div>`;
      }
    }
    if (m.nitro) html += `<div class="bar"><i style="width:${Math.round(nitro * 100)}%"></i></div><div class="meta">NITRO${input.boost ? ' 🔥' : ' (Shift)'}</div>`;
    cluster.innerHTML = html;
  }

  // ---------- walking ----------------------------------------------------------------------------------
  let onFoot = false;
  const foot = { x: 0, y: 0, z: 0, heading: 0, speed: 0, turn: 0, camH: 0, vx: 0, vz: 0, roll: 0, phase: 0 };
  const avatar = makeAvatar(); avatar.visible = false; scene.add(avatar); dressAvatar(avatar, save.outfit);
  const stage = createStage(scene, makeAvatar);
  const showroom = createShowroom(scene);
  const BUCKET = 48, grid = new Map();
  const gkey = (i, j) => i + ',' + j;
  const addGrid = (x0, z0, x1, z1, item) => { for (let i = Math.floor(x0 / BUCKET); i <= Math.floor(x1 / BUCKET); i++) for (let j = Math.floor(z0 / BUCKET); j <= Math.floor(z1 / BUCKET); j++) { const k = gkey(i, j); (grid.get(k) || grid.set(k, []).get(k)).push(item); } };
  parcelInstances.forEach(p => {
    if (p.type !== 'building') return;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; p.footprint.forEach(([x, z]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
    addGrid(x0 - 1, z0 - 1, x1 + 1, z1 + 1, { poly: p.footprint });
  });
  collisionWorld.forEach(c => { if (c.kind === 'prop' && c.blocksCar && c.radius > 0.25) addGrid(c.x - c.radius, c.z - c.radius, c.x + c.radius, c.z + c.radius, { c }); });
  const waterPolys = parcelInstances.filter(p => p.type === 'water').map(p => p.footprint);
  const R = 0.32;
  const rectHit = (rs, x, z, r) => rs.some(q => x > q.x0 - r && x < q.x1 + r && z > q.z0 - r && z < q.z1 + r);
  const circleHit = (cs, x, z) => cs.some(c => Math.hypot(x - c.x, z - c.z) < c.radius + R * 0.6);
  function pocketBlocked(x, z) {
    const p = cur.toL(x, z);
    if (p.x < 0) return !(p.x > -14 && Math.abs(p.z) < RAMP.W / 2 + 4);          // out in front of the door is the street: open
    if (garageHeight(cur.g.lay, p.x, p.z) == null) return true;
    if (rectHit(cur.g.solids, p.x, p.z, R)) return true;
    if (circleHit(cur.colliders, x, z)) return true;
    return onFoot && Math.abs(car.y - foot.y) < 3 && [-1.15, 1.15].some(o => Math.hypot(x - (car.x + Math.sin(car.heading) * o), z - (car.z + Math.cos(car.heading) * o)) < 1.0 + R * 0.6);
  }
  function flatToWorld(lx, lz) { const F = cur.F; return { x: F.x + lx * F.ux + lz * F.dx, z: F.z + lx * F.uz + lz * F.dz }; }
  function flatBlocked(x, z) {
    const F = cur.F, dx = x - F.x, dz = z - F.z, lx = dx * F.ux + dz * F.uz, lz = dx * F.dx + dz * F.dz, I = cur.flat;
    if (Math.abs(lx) > I.W / 2 - R - 0.05 || lz > I.D - R - 0.1) return true;
    if (lz < 0.4 + R) { const T = I.terrace; if (!T || lx < T.x0 + R || lx > T.x1 - R || lz < -T.depth + R) return true; }          // the street wall - except through the glass door onto the terrace
    return rectHit(I.solids, lx, lz, R);
  }
  function blockedAt(x, z) {
    if (mode === 'garage') return pocketBlocked(x, z);
    if (mode === 'flat') return flatBlocked(x, z);
    if (waterPolys.some(w => pointInPoly(x, z, w)) && heightAt(x, z, foot.y) < 0.6) return true;
    const cell = grid.get(gkey(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
    if (!cell) return false;
    for (const it of cell) {
      if (it.poly) { if (inGateway(x, z)) continue; if (pointInPoly(x, z, it.poly) || closestOnPoly(x, z, it.poly).d < R) return true; }
      else if (!it.c.destroyed && Math.hypot(x - it.c.x, z - it.c.z) < it.c.radius + R * 0.6) return true;
    }
    return false;
  }
  const B = city.bounds || [-1e4, -1e4, 1e4, 1e4];
  let lookDX = 0, lookDY = 0;
  addEventListener('pointermove', e => { if (onFoot && !modal && e.buttons & 1 && e.target && e.target.tagName === 'CANVAS') { lookDX += e.movementX * 0.006; lookDY -= e.movementY * 0.004; } });
  function stepFoot(dt) {
    // camera: the look vector (right stick / arrow keys / mouse drag) swings it freely round the walker
    foot.camH -= (input.lookX || 0) * 1.96 * dt + lookDX; lookDX = 0;
    foot.pitch = Math.max(-0.5, Math.min(0.7, (foot.pitch || 0) + (input.lookY || 0) * 1.12 * dt + lookDY)); lookDY = 0;
    // movement is relative to the camera: stick forward walks away from the camera, sideways strafes round, and the walker turns to face where they go
    const mxs = input.moveX || 0, mys = input.moveY || 0, mag = Math.min(1, Math.hypot(mxs, mys));
    const fx = Math.sin(foot.camH), fz = Math.cos(foot.camH), rx = -Math.cos(foot.camH), rz = Math.sin(foot.camH);
    const wx = fx * mys + rx * mxs, wz = fz * mys + rz * mxs;
    const run = input.run ? 5.2 : 2.4;
    const want = mag > 0.05 ? (input.run ? run : Math.min(run, mag / 0.9 * run)) : 0;
    if (mag > 0.05) {
      const th = Math.atan2(wx, wz), dh = Math.atan2(Math.sin(th - foot.heading), Math.cos(th - foot.heading));
      foot.heading += dh * Math.min(1, dt * (mode === 'flat' ? 14 : 9));
      foot.dirX = wx / Math.hypot(wx, wz); foot.dirZ = wz / Math.hypot(wx, wz);
    }
    foot.speed += (want - foot.speed) * Math.min(1, dt * 7);
    // a shove (a car that hit you): carries you along its direction, fading fast
    foot.pushX = foot.pushX || 0; foot.pushZ = foot.pushZ || 0; const fade = Math.exp(-4.5 * dt); foot.pushX *= fade; foot.pushZ *= fade; if (Math.hypot(foot.pushX, foot.pushZ) < 0.05) foot.pushX = foot.pushZ = 0;
    const dx = (foot.dirX || 0) * foot.speed * dt + foot.pushX * dt, dz = (foot.dirZ || 0) * foot.speed * dt + foot.pushZ * dt;
    let nx = foot.x + dx, nz = foot.z + dz;
    if (blockedAt(nx, nz)) { if (!blockedAt(foot.x + dx, foot.z)) nz = foot.z; else if (!blockedAt(foot.x, foot.z + dz)) nx = foot.x; else { nx = foot.x; nz = foot.z; foot.speed *= 0.3; } }
    if (mode === 'city') { foot.x = Math.max(B[0], Math.min(B[2], nx)); foot.z = Math.max(B[1], Math.min(B[3], nz)); } else { foot.x = nx; foot.z = nz; }
    const gy = mode === 'flat' ? cur.flat.floorY : heightAt(foot.x, foot.z, foot.y);
    foot.y += (gy - foot.y) * Math.min(1, dt * 14);
    foot.phase += Math.abs(foot.speed) * dt * 4.2;
    avatar.position.set(foot.x, foot.y, foot.z); avatar.rotation.y = foot.heading;
    if (mode === 'garage') garageEdge();
    const sw = Math.min(1, Math.abs(foot.speed) / 3);
    avatar.userData.limbs.forEach(l => {
      const ang = Math.sin(foot.phase + l.userData.ph) * 0.7 * sw; l.rotation.x = ang;
      const fw = l.userData.fw; if (fw) { fw.position.set(0, 0.88 * (1 - Math.cos(ang)), -0.88 * Math.sin(ang)); fw.rotation.x = ang * 0.45; }   // the foot follows the swinging leg, kept flatter than the shin
    });
  }
  function exitCar() {
    const h = car.heading, lx = Math.cos(h), lz = -Math.sin(h);
    for (const s of [1, -1]) {
      const x = car.x + lx * 2.4 * s, z = car.z + lz * 2.4 * s;
      if (!blockedAt(x, z)) {
        foot.x = x; foot.z = z; foot.heading = h; foot.camH = h; foot.turn = 0; foot.y = car.y; foot.speed = 0; onFoot = true; avatar.visible = true; stepFoot(0);
        if (mode === 'garage') { parkRecord(); toast('Parked. E next to a car to hop in, or take the elevator'); } else toast('E near your car to get back in');
        return;
      }
    }
    toast('No room to get out here');
  }
  function enterCar() {
    onFoot = false; avatar.visible = false; boosting = false;
    const e = fleet[car.styleKey]; if (e && e.live) { delete fleet[car.styleKey]; persist(); }
  }
  const footCam = new THREE.Vector3();
  let footFrozen = false;
  let camSnap = false;
  function updateCamera(dt) {
    if (mode === 'flat') {
      // first person, eyes at 1.6 m
      const ex = foot.x, ey = foot.y + 1.5, ez = foot.z, pt = foot.pitch || 0;
      camera.position.set(ex, ey, ez); camera.up.set(0, 1, 0);
      camera.lookAt(ex + Math.sin(foot.camH) * 5, ey - 0.12 + Math.tan(pt) * 5, ez + Math.cos(foot.camH) * 5);
      avatar.visible = false;
      return;
    }
    // the camera swings round behind the walker gently instead of snapping with every turn
    let dist = 4.4;
    if (mode === 'garage') {       // keep the camera inside the garage walls
      for (; dist > 0.9; dist -= 0.5) {
        const cx = foot.x - Math.sin(foot.camH) * dist, cz = foot.z - Math.cos(foot.camH) * dist;
        if (!pocketBlocked(cx, cz) && !pocketBlocked(cx + 0.6, cz) && !pocketBlocked(cx - 0.6, cz) && !pocketBlocked(cx, cz + 0.6) && !pocketBlocked(cx, cz - 0.6)) break;
      }
    }
    const pt = foot.pitch || 0, cp = Math.cos(pt * 0.8);
    footCam.set(foot.x - Math.sin(foot.camH) * dist * cp, foot.y + (mode === 'garage' ? 1.9 : 2.1) + Math.sin(pt) * 3.2, foot.z - Math.cos(foot.camH) * dist * cp);
    if (camSnap) { camera.position.copy(footCam); camSnap = false; } else camera.position.lerp(footCam, 1 - Math.pow(0.0005, dt));
    camera.up.set(0, 1, 0);
    camera.lookAt(foot.x, foot.y + 1.15, foot.z);
  }

  // ---------- garages, flats and the fade between them -------------------------------------------------------------
  function snapCamera() {
    if (onFoot) { camSnap = true; updateCamera(0.016); return; }
    camera.position.set(car.x - Math.sin(car.heading) * 9, car.y + 3.4, car.z - Math.cos(car.heading) * 9);
    camera.up.set(0, 1, 0); camera.lookAt(car.x, car.y + 1.2, car.z);
  }
  function transition(fn) {
    if (trans || modal) return;
    trans = true; fadeEl.style.opacity = '1'; setModalPause(true); promptEl.style.display = 'none';
    setTimeout(() => {
      try { fn(); snapCamera(); } catch (e) { console.error(e); }
      fadeEl.style.opacity = '0';
      setTimeout(() => { if (!modal) setModalPause(false); trans = false; }, 280);
    }, 300);
  }
  function ensureGarage(a) {
    if (!garages[a.id]) {
      // the garage is built in the real city, under the building: its frame starts at the gate (local +x runs into the building)
      const g = buildGarage(a.garage), gt = a.gate, th = Math.atan2(gt.nz, -gt.nx), c = Math.cos(th), sn = Math.sin(th);
      const toW = (lx, lz) => ({ x: gt.x + lx * c + lz * sn, z: gt.z - lx * sn + lz * c });
      const toL = (x, z) => { const dx = x - gt.x, dz = z - gt.z; return { x: c * dx - sn * dz, z: sn * dx + c * dz }; };
      g.group.position.set(gt.x, 0, gt.z); g.group.rotation.y = th; g.group.visible = false; scene.add(g.group);
      const polys = g.solids.map(r => ({ kind: 'parcel', instance: null, garage: true, footprint: [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]].map(([lx, lz]) => { const w = toW(lx, lz); return [w.x, w.z]; }), blocksCar: true, destructible: false, response: 'bounce', destroyed: false }));
      garages[a.id] = { a, th, toW, toL, g, polys, colliders: [], statics: [] };
    }
    return garages[a.id];
  }
  const rmColliders = list => { const set = new Set(list); for (let i = collisionWorld.length - 1; i >= 0; i--) if (set.has(collisionWorld[i])) collisionWorld.splice(i, 1); };
  function paintStatic(model, key) {
    const st = model.userData.style, m = save.mods[key], base = m && m.paint != null ? m.paint : st.color;
    model.traverse(o => { if (o.isMesh && o.material.isMeshPhysicalMaterial && o.material.clearcoat > 0.5) { o.material = o.material.clone(); o.material.color.setHex(base); } });
  }
  function populateGarage() {
    const G = cur; if (!G || !G.g) return;
    rmColliders(G.colliders); G.colliders = [];
    G.statics.forEach(s => G.g.group.remove(s.model)); G.statics = [];
    Object.keys(fleet).forEach(k => {
      const e = fleet[k]; if (e.apt !== G.a.id || e.live) return;
      const model = buildCarModel(k); paintStatic(model, k);
      model.position.set(e.x, G.g.lay.floorY, e.z); model.rotation.y = e.h; G.g.group.add(model);
      G.statics.push({ key: k, model, e });
      [-1.15, 1.15].forEach(o => { const w = G.toW(e.x + Math.sin(e.h) * o, e.z + Math.cos(e.h) * o); G.colliders.push({ kind: 'prop', instance: null, garage: true, x: w.x, z: w.z, radius: 1.0, blocksCar: true, destructible: false, destroyed: false }); });
    });
    // the other residents' cars
    (G.npc || []).forEach(m => G.g.group.remove(m)); G.npc = [];
    const NPC_STYLES = ['hatch', 'hatch', 'sport', 'muscle', 'pickup', 'van', 'taxi'], NPC_COLORS = [0xc0392b, 0x2c3e50, 0xbdc3c7, 0x27ae60, 0xf1c40f, 0x7f8c8d, 0x8e44ad, 0xecf0f1, 0x34495e, 0xd35400];
    G.g.lay.others.filter(o => o.kind === 'taken').forEach(o => {
      const key = NPC_STYLES[o.variant % NPC_STYLES.length], col = NPC_COLORS[(o.variant >> 3) % NPC_COLORS.length], model = buildCarModel(key);
      model.traverse(q => { if (q.isMesh && q.material.isMeshPhysicalMaterial && q.material.clearcoat > 0.5) { q.material = q.material.clone(); q.material.color.setHex(col); } });
      const h = o.heading + ((o.variant % 7) - 3) * 0.012;
      model.position.set(o.x, G.g.lay.floorY, o.z + ((o.variant % 5) - 2) * 0.12); model.rotation.y = h; G.g.group.add(model); G.npc.push(model);
      [-1.15, 1.15].forEach(d => { const w = G.toW(o.x + Math.sin(h) * d, o.z + Math.cos(h) * d); G.colliders.push({ kind: 'prop', instance: null, garage: true, x: w.x, z: w.z, radius: 1.0, blocksCar: true, destructible: false, destroyed: false }); });
    });
    collisionWorld.push(...G.colliders);
  }
  const spotPose = (a, i) => { const sp = garageLayout(a.garage).spots[i]; return { x: sp.x, z: sp.z, h: sp.heading }; };
  const freeSpot = a => { const used = Object.values(fleet).filter(e => e.apt === a.id).map(e => e.spot); for (let i = 0; i < a.garage; i++) if (!used.includes(i)) return i; return -1; };
  // every owned car that is not the one you are driving has a bay in one of your garages
  function reconcileFleet() {
    Object.keys(fleet).forEach(k => {
      const e = fleet[k];
      if (!ownedCars().includes(k)) { delete fleet[k]; return; }
      if (k === car.styleKey) { if (!e.live) delete fleet[k]; } else if (e.live) e.live = false;
    });
    ownedCars().forEach(k => {
      if (k === car.styleKey || fleet[k]) return;
      for (const a of city.apartments) {
        if (!save.apts[a.id]) continue;
        const sp = freeSpot(a); if (sp < 0) continue;
        fleet[k] = { apt: a.id, spot: sp, ...spotPose(a, sp) }; break;
      }
    });
    persist();
  }
  function parkRecord() {
    const G = cur, lay = G.g.lay; let best = 0, bd = 1e9;
    const pl = G.toL(car.x, car.z);
    lay.spots.forEach((sp, i) => { const d = Math.hypot(sp.x - pl.x, sp.z - pl.z); if (d < bd) { bd = d; best = i; } });
    const bay = bayAt(lay, pl.x, pl.z), banned = !!bay && bay.kind === 'banned';
    const prev = fleet[car.styleKey];
    fleet[car.styleKey] = { apt: G.a.id, spot: banned || bd > 3.6 ? -1 : best, x: pl.x, z: pl.z, h: car.heading - G.th, live: true, ...(banned ? { since: prev && prev.since ? prev.since : Date.now(), fined: !!(prev && prev.fined && prev.since) } : {}) };
    persist();
  }
  // a car left in somebody else's bay for FINE_SECS earns a fine (once); it stays where it is
  let fineT = 1;
  function checkFines() {
    const now = Date.now();
    Object.keys(fleet).forEach(k => {
      const e = fleet[k]; if (!e.since || e.fined) return;
      if (now - e.since >= FINE_SECS * 1000) { e.fined = true; taxi.addCash(-5000); persist(); toast('Parking fine: -$5,000 - your ' + ((CAR_STYLES.find(c => c.key === k) || {}).name || 'car') + ' was left in a bay that is not yours'); }
    });
  }
  function leaveMode() {
    if (mode === 'garage' && cur) { rmColliders(cur.colliders); rmColliders(cur.polys); cur.colliders = []; cur.statics.forEach(s => cur.g.group.remove(s.model)); cur.statics = []; (cur.npc || []).forEach(m => cur.g.group.remove(m)); cur.npc = []; }
    if (mode === 'flat' && cur && cur.flat) cur.flat.group.visible = false;
    clearLocal();
  }
  // how: 'car' / 'foot' = walked or driven in through the door (nothing moves: the garage is simply where you already are),
  //      'footAt' = the E shortcut at the door, 'lift' = from the flat upstairs
  function toGarage(a, how) {
    leaveMode();
    const G = ensureGarage(a); cur = G; mode = 'garage';
    G.g.group.visible = true; collisionWorld.push(...G.polys);
    populateGarage();
    const lay = G.g.lay;
    if (how === 'car') { onFoot = false; avatar.visible = false; }
    else if (how === 'foot') { onFoot = true; avatar.visible = true; }
    else {
      const e = how === 'lift' ? { x: lay.lift.x - 2.8, z: 0, h: -Math.PI / 2 } : { x: 3.2, z: 0, h: Math.PI / 2 }, w = G.toW(e.x, e.z);
      foot.x = w.x; foot.z = w.z; foot.y = hAt(foot.x, foot.z); foot.heading = foot.camH = e.h + G.th; foot.speed = 0; foot.turn = 0;
      onFoot = true; avatar.visible = true; stepFoot(0);
    }
    const lw = G.toW(lay.lift.x, lay.lift.z);
    setLocal([{ kind: 'lift', name: 'the elevator', x: lw.x, z: lw.z, y: lay.floorY, hex: 0xffd21f, onFootOnly: true }]);
  }
  // back out through the door: the street is simply there again, nothing is moved
  function garageEdge() {
    const G = cur; if (mode !== 'garage' || !G || !G.g) return;
    const p = G.toL(onFoot ? foot.x : car.x, onFoot ? foot.z : car.z);
    if (p.x > 0.25 || Math.abs(p.z) > 6) return;
    leaveMode(); mode = 'city'; cur = null; camHold = 1.6;
    if (!onFoot) { const e = fleet[car.styleKey]; if (e && e.live) delete fleet[car.styleKey]; persist(); }
  }
  let camHold = 0, shoveT = 0;
  // the owned garage door a point is in the doorway of (so the building's own wall does not stop you there)
  function inGateway(x, z) {
    if (mode !== 'city') return false;
    for (const id in gates) {
      const G = gates[id]; if (G.open < 0.6) continue;
      const g = G.t.data.gate, rx = x - g.x, rz = z - g.z, along = rx * g.nx + rz * g.nz, lat = rx * g.ux + rz * g.uz;
      if (along > -3 && along < 6 && Math.abs(lat) < 2.3) return true;
    }
    return false;
  }
  collisionWorld.exempt = null;
  function updateExempt() {
    if (mode === 'garage') { collisionWorld.exempt = EX_GARAGE; return; }
    if (mode === 'city' && !onFoot) {
      for (const id in gates) {
        const G = gates[id]; if (G.open < 0.6) continue;
        const g = G.t.data.gate, rx = car.x - g.x, rz = car.z - g.z, along = rx * g.nx + rz * g.nz;
        if (along > -6 && along < 8 && Math.abs(rx * g.ux + rz * g.uz) < 4) { collisionWorld.exempt = EX_GATE; return; }
      }
    }
    collisionWorld.exempt = null;
  }
  const EX_GARAGE = (c, k) => !k.garage;                  // underground, the city above does not exist for the car
  const EX_GATE = (c, k) => k.kind === 'parcel' && !k.garage && inGateway(c.x, c.z);        // at the door the building's wall lets the car in
  function ensureFlat(a) {
    if (!flats[a.id]) {
      const f = a.facade, I = a.store ? buildStoreInterior(a) : buildInterior(a), th = Math.atan2(-f.nx, -f.nz);
      I.group.position.set(f.x, I.floorY, f.z); I.group.rotation.y = th; I.group.visible = false; scene.add(I.group);
      flats[a.id] = { I, F: { x: f.x, z: f.z, ux: -f.nz, uz: f.nx, dx: -f.nx, dz: -f.nz }, th, L: createFlatLights(I) };
    }
    cur.flat = flats[a.id].I; cur.F = flats[a.id].F; cur.flat.group.visible = true;
    return cur;
  }
  function toFlat(a, how) {   // how: 'street' | 'lift'
    leaveMode(); mode = 'city';
    cur = garages[a.id] || { a, colliders: [], polys: [], statics: [] };
    ensureFlat(a); mode = 'flat';
    const I = cur.flat, F = cur.F, p = flatToWorld(I.spawn.x, I.spawn.z);
    foot.x = p.x; foot.z = p.z; foot.y = I.floorY; foot.heading = foot.camH = Math.atan2(F.dx, F.dz); foot.speed = 0; foot.turn = 0;
    onFoot = true; avatar.visible = false;
    const mkT = (kind, name, lp, hex) => { const w = flatToWorld(lp.x, lp.z); return { kind, name, x: w.x, z: w.z, y: I.floorY, hex, onFootOnly: true, small: true }; };
    const list = [mkT('door', 'street', I.exitAt, 0x5cff8a)];
    if (I.liftAt) list.push(mkT('lift', 'the elevator', I.liftAt, 0xffd21f));
    if (I.bedAt) list.push(mkT('bed', 'bed', I.bedAt, 0x7aa0ff));
    if (I.wardrobeAt) list.push(mkT('wardrobe', 'wardrobe', I.wardrobeAt, 0xff9f43));
    if (I.deskAt && !a.store) list.push(mkT('desk', 'desk', I.deskAt, 0x4aa3ff));
    if (I.fitAt) list.push(mkT('fitting', a.name, I.fitAt, 0xff5fa8));
    if (!a.store) list.push(mkT('travel', 'the city map', { x: I.W / 2 - 0.9, z: 1.2 }, 0x4aa3ff));
    setLocal(list);
  }
  function leaveFlat() {
    const a = cur.a, f = a.facade;
    transition(() => {
      leaveMode(); mode = 'city'; cur = null;
      foot.x = a.door.x; foot.z = a.door.z; foot.y = hAt(foot.x, foot.z); foot.heading = foot.camH = Math.atan2(f.nx, f.nz); foot.speed = 0;
      onFoot = true; avatar.visible = true; stepFoot(0);
    });
  }
  function flatToGarage() { const a = cur.a; transition(() => toGarage(a, 'lift')); }
  function garageToFlat() { const a = cur.a; transition(() => toFlat(a, 'lift')); }
  // near a parked car: hop in. The car you were in is left where it stands, and the one you hop into drives off from its bay.
  function nearStatic() {
    if (mode !== 'garage' || !cur) return null;
    let best = null;
    cur.statics.forEach(s => { const w = cur.toW(s.e.x, s.e.z), d = Math.hypot(w.x - foot.x, w.z - foot.z); if (d < 4.2 && (!best || d < best.d)) best = { s, d }; });
    return best;
  }
  function swapTo(s) {
    const e = s.e, K = s.key, old = car.styleKey, oe = fleet[old];
    if (oe && oe.live) oe.live = false;
    delete fleet[K];
    chooseCar(K);
    reconcileFleet();
    const wp = cur.toW(e.x, e.z); car.teleport(wp.x, wp.z, cur.g.lay.floorY, e.h + cur.th);
    populateGarage();
    onFoot = false; avatar.visible = false; boosting = false;
    toast('Driving the ' + (CAR_STYLES.find(c => c.key === K) || {}).name);
  }
  // roller door animation + the drive-in trigger on the street
  let gateCool = null;
  const gates = {};
  function ensureGate(a) {
    if (gates[a.id]) return;
    const mesh = buildGateMesh(a); scene.add(mesh);
    const g = a.gate, mk = arrowMarker(0x4aa3ff); mk.position.set(g.x + g.nx * 4.2, 0.02, g.z + g.nz * 4.2); scene.add(mk);
    const t = { kind: 'gate', id: a.id, name: 'garage', x: g.x + g.nx * 3.4, z: g.z + g.nz * 3.4, data: a, mk, onFootOnly: true };
    gates[a.id] = { mesh, t, open: 0 }; targets.push(t);
  }
  function gatesUpdate(dt) {
    if (mode !== 'city') return;
    for (const a of city.apartments) {
      if (!save.apts[a.id]) continue;
      ensureGate(a);
      const G = gates[a.id], g = a.gate, px = onFoot ? foot.x : car.x, pz = onFoot ? foot.z : car.z;
      const rx = px - g.x, rz = pz - g.z, along = rx * g.nx + rz * g.nz, lat = rx * g.ux + rz * g.uz;
      const want = (along > -2 && along < 14 && Math.abs(lat) < 6.5) ? 1 : 0;
      G.open += Math.sign(want - G.open) * Math.min(Math.abs(want - G.open), dt * 1.4);
      G.mesh.userData.door.position.y = G.open * 3.1;
      // through the open door and in: the garage takes over where you stand (no fade, no jump)
      if (!modal && !trans && G.open > 0.6 && -along > 0.8 && -along < 5 && Math.abs(lat) < 2.5 && !(blockedFn && blockedFn())) { toGarage(a, onFoot ? 'foot' : 'car'); return; }
    }
  }

  // ---------- enter-markers ---------------------------------------------------------------------------------
  const targets = [];            // the city's: apartment doors, shops, estate agents, garage gates
  let local = [];                // markers that exist only inside a garage or a flat
  (city.apartments || []).forEach(a => {
    const mk = arrowMarker(0xffd21f); mk.position.set(a.door.x, 0.02, a.door.z); scene.add(mk);
    targets.push({ kind: 'apt', id: a.id, name: a.name, x: a.door.x, z: a.door.z, data: a, mk });
  });
  (city.shops || []).forEach(s => {
    const k = SHOP_KINDS[s.kind];
    const mk = arrowMarker(k.hex); mk.position.set(s.door.x, 0.02, s.door.z); scene.add(mk);
    targets.push({ kind: 'shop', id: s.id, name: k.name, x: s.door.x, z: s.door.z, data: s, mk });
  });
  (city.stores || []).forEach(st => {
    const mk = arrowMarker(0xff5fa8); mk.position.set(st.door.x, 0.02, st.door.z); scene.add(mk);
    targets.push({ kind: 'store', id: st.id, name: st.name, x: st.door.x, z: st.door.z, data: st, mk });
  });
  (city.agents || []).forEach(ag => {
    const mk = arrowMarker(0x19c6b7); mk.position.set(ag.door.x, 0.02, ag.door.z); scene.add(mk);
    targets.push({ kind: 'agent', id: ag.id, name: ag.name, x: ag.door.x, z: ag.door.z, data: ag, mk });
  });
  function setLocal(list) {
    clearLocal();
    list.forEach(t => {
      const mk = arrowMarker(t.hex); mk.position.set(t.x, (t.y || 0) + 0.02, t.z); if (t.small) mk.scale.setScalar(0.55); scene.add(mk); t.mk = mk; local.push(t);
    });
  }
  function clearLocal() { local.forEach(t => scene.remove(t.mk)); local = []; }
  const activeTargets = () => (mode === 'city' ? targets : local);
  function refreshMarkers() {
    targets.forEach(t => { if (t.kind === 'apt') t.mk.userData.arrow.children.forEach(c => c.material.color.setHex(save.apts[t.id] ? 0x5cff8a : 0xffd21f)); });
  }
  refreshMarkers();
  (city.apartments || []).forEach(a => { if (save.apts[a.id]) ensureGate(a); });
  // an owned garage's ramp is cut into the street (a hole in the ground plane) and drawn at all times, so the car never sinks into the ground on the way down
  function showGarageRamps() {
    const polys = [];
    (city.apartments || []).forEach(a => {
      if (!save.apts[a.id] || !a.garage) return;
      const G = ensureGarage(a); G.g.group.visible = true;
      const hw = RAMP.W / 2 + 0.55;
      polys.push([[0.15, -hw], [RAMP.L, -hw], [RAMP.L, hw], [0.15, hw]].map(([lx, lz]) => { const p = G.toW(lx, lz); return [p.x, p.z]; }));
    });
    if (setGarageHoles) setGarageHoles(polys);
  }
  showGarageRamps();
  reconcileFleet();
  if (save.garageV !== 3) {      // the garage layout changed (v3: built in the real city, shorter ramp): put every parked car on its bay in the new one
    Object.keys(fleet).forEach(k => { const e = fleet[k], a = city.apartments.find(q => q.id === e.apt); if (!a || e.live) { if (e.live) delete fleet[k]; return; } if (e.spot >= 0 && e.spot < a.garage) Object.assign(e, spotPose(a, e.spot)); });
    save.garageV = 3; reconcileFleet();
  }
  let target = null, tAnim = 0;
  function nearestTarget() {
    const px = onFoot ? foot.x : car.x, pz = onFoot ? foot.z : car.z;
    const reach = onFoot ? 3.4 : (Math.abs(car.speed) < 6 && mode === 'city' ? 6.5 : 0);
    let best = null, bd = reach;
    activeTargets().forEach(t => {
      if (!onFoot && (t.kind === 'shop' || t.onFootOnly)) return;
      const d = Math.hypot(t.x - px, t.z - pz); if (d < bd) { bd = d; best = t; }
    });
    return best;
  }
  // shops open by driving into their garage; after Leave they stay quiet until the car has gone away again
  let shopCool = null;
  let blockedFn = null;
  function driveInShops() {
    if (modal || onFoot || trans || mode !== 'city' || (blockedFn && blockedFn())) return;
    for (const t of targets) {
      if (t.kind !== 'shop') continue;
      const d = Math.hypot(t.x - car.x, t.z - car.z);
      if (shopCool === t) { if (d > 16) shopCool = null; continue; }
      if (d < 4.8) { openModal(t); return; }
    }
  }
  function markerAnim(dt) {
    tAnim += dt;
    const px = onFoot ? foot.x : car.x, pz = onFoot ? foot.z : car.z;
    activeTargets().forEach(t => {
      const d = Math.hypot(t.x - px, t.z - pz);
      t.mk.visible = d < 150;
      if (!t.mk.visible) return;
      t.mk.userData.arrow.position.y = (t.small ? 1.9 : 2.6) + Math.sin(tAnim * 3 + t.x) * 0.25;
      t.mk.userData.arrow.rotation.y = tAnim * 1.8;
    });
  }
  function buyApt(a, price) {
    if (!spend(price)) return;
    save.apts[a.id] = true; ensureGate(a); showGarageRamps(); reconcileFleet(); persist(); refreshMarkers(); refreshPanel();
    toast('Welcome home! Your garage gate is marked on the map.');
  }
  function activate(t) {
    if (t.kind === 'apt') { if (save.apts[t.id]) { transition(() => toFlat(t.data, 'street')); return; } openModal(t); return; }
    if (t.kind === 'shop' || t.kind === 'agent') { openModal(t); return; }
    if (t.kind === 'store') { transition(() => toFlat(t.data, 'street')); return; }
    if (t.kind === 'wardrobe' || t.kind === 'fitting' || t.kind === 'bed' || t.kind === 'desk') { openModal(t); return; }
    if (t.kind === 'gate') { transition(() => toGarage(t.data, 'footAt')); return; }
    if (t.kind === 'lift') { if (mode === 'garage') garageToFlat(); else flatToGarage(); return; }
    if (t.kind === 'door') { leaveFlat(); return; }
    if (t.kind === 'travel') { openModal(t); return; }
  }

  // ---------- modal panels ------------------------------------------------------------------------------------
  let modal = null;   // { kind, shop?, tab, preview?, ... }
  let previewCar = null, bay = null, orbitT = 0, hadCarVisible = true, cameFootAt = null;
  const money = v => '$' + Math.round(v).toLocaleString('en-US');
  const rowHtml = (r, i) => `<div class="row${r.sel ? ' sel' : ''}" data-i="${i}"><div class="t"><b>${r.name}</b><small>${r.sub || ''}</small></div>${r.btn ? `<button ${r.disabled ? 'disabled' : ''}>${r.btn}</button>` : ''}</div>`;
  function render(spec) {
    const accent = spec.accent || '#ffd21f';
    panel.style.setProperty('--accent', accent);
    const items = [];
    let html = `<header><h2>${spec.title}</h2><div class="sub">${spec.sub || ''}</div></header><div class="cashline"><span>${money(cash())}</span><span>${spec.right || ''}</span></div>${spec.buy ? `<div class="cartline"><span>Cart (${spec.buy.count} item${spec.buy.count === 1 ? '' : 's'})</span><b>${money(spec.buy.total)}</b></div>` : ''}`;
    if (spec.perfBars) html += '<div class="pbars"></div>';
    if (spec.tabs) html += `<div class="tabs">${spec.tabs.map((t, i) => `<button data-tab="${i}" class="${i === modal.tab ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    html += '<div class="list">';
    spec.rows.forEach(r => {
      if (r.chips) {
        html += `<div class="hint">${r.name}</div><div class="chips">${r.chips.map((c, ci) => { items.push(c); return `<div class="chip${c.on ? ' on' : ''}" data-i="${items.length - 1}" title="${c.label}" style="background:#${c.color.toString(16).padStart(6, '0')}"></div>`; }).join('')}</div>`;
      } else if (r.hint) html += `<div class="hint">${r.hint}</div>`;
      else { items.push(r); html += rowHtml(r, items.length - 1); }
    });
    const poor = spec.buy && spec.buy.total > cash();
    html += `</div><footer>${spec.buy ? `<button class="buy" ${!spec.buy.count || poor ? 'disabled' : ''}>${poor ? 'Insufficient funds' : !spec.buy.count ? 'Purchase' : spec.buy.total > 0 ? 'Purchase · ' + money(spec.buy.total) : 'Apply (free)'}</button>` : ''}<button class="x">${spec.exit || 'Leave'}</button></footer>`;
    const oldList = panel.querySelector('.list'), keepScroll = oldList && modal._lastTab === modal.tab && modal._lastKind === modal.kind ? oldList.scrollTop : 0;   // picking an item must not throw you back to the top
    modal._lastTab = modal.tab; modal._lastKind = modal.kind;
    panel.innerHTML = html;
    const newList = panel.querySelector('.list'); if (newList && keepScroll) newList.scrollTop = keepScroll;
    panel.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { modal.tab = Number(b.dataset.tab); refreshPanel(); }));
    panel.querySelectorAll('[data-i]').forEach(el => el.addEventListener('click', e => {
      const it = items[Number(el.dataset.i)]; if (!it) return;
      if (it.focus) it.focus();
      if (e.target.tagName === 'BUTTON' || el.classList.contains('chip')) { if (!it.disabled && it.act) it.act(); }
    }));
    panel.querySelector('.x').addEventListener('click', closeModal);
    const bb = panel.querySelector('.buy'); if (bb) bb.addEventListener('click', () => { if (!bb.disabled) confirmPurchase(); });
    if (spec.perfBars) {
      drawBars(null);
      panel.querySelectorAll('.row[data-i]').forEach(el => {
        const it = items[Number(el.dataset.i)];
        if (!it || !it.hover) return;
        el.addEventListener('pointerenter', () => drawBars(it.hover));
        el.addEventListener('pointerleave', () => drawBars(null));
        el.addEventListener('click', () => drawBars(it.hover));
      });
    }
  }
  // the five rating bars; with `hover` (a part you are looking at) the change is drawn in green / red
  function drawBars(hover) {
    const box = panel.querySelector('.pbars'); if (!box) return;
    const P = (modal && modal.cart ? draft() : modsOf(car.styleKey)).perf, cur = perfStats(car.styleKey, P), cand = hover ? perfStats(car.styleKey, { ...P, ...hover }) : null;
    let html = cur.bars.map(([n, v], i) => {
      const nv = cand ? cand.bars[i][1] : v;
      const seg = nv > v ? `<i class="up" style="left:${v}%;width:${nv - v}%"></i>` : nv < v ? `<i class="dn" style="left:${nv}%;width:${v - nv}%"></i>` : '';
      return `<div class="pbar"><span>${n}</span><div class="trk"><i class="cur" style="width:${Math.min(v, nv)}%"></i>${seg}</div><b>${nv}</b></div>`;
    }).join('');
    html += `<div class="pwt">Weight ${cur.mass.toLocaleString('en-US')} kg${cand && cand.mass !== cur.mass ? ' -> ' + cand.mass.toLocaleString('en-US') + ' kg' : ''}</div>`;
    box.innerHTML = html;
  }
  function refreshPanel() { if (!modal) return; if (modal.kind === 'bed') renderSleep(); else render(buildSpec()); }
  // the shopping cart: what you have picked but not paid for yet. The car shows the draft; Leave drops it.
  function draft() { const m = JSON.parse(JSON.stringify(modsOf(car.styleKey))); modal.cart.forEach(it => it.apply(m)); return m; }
  const cartTotal = () => { let t = 0; modal.cart.forEach(it => { t += it.price; }); return t; };
  function pick(it) { const c = modal.cart, cur = c.get(it.group); if (cur && cur.key === it.key) c.delete(it.group); else c.set(it.group, it); applyMods(draft()); refreshPanel(); }
  function confirmPurchase() {
    if (!modal || !modal.cart || !modal.cart.size) return;
    const total = cartTotal(); if (total > cash()) { toast('Insufficient funds'); return; }
    if (total > 0) taxi.addCash(-total);
    const m = modsOf(car.styleKey);
    const newCars = [...modal.cart.values()].filter(it => it.group.startsWith('car.')).map(it => it.key);
    modal.cart.forEach(it => { it.apply(m); if (it.commit) it.commit(); });
    modal.cart.clear();
    if (newCars.length) {
      // the car you came in is parked in a free bay of one of your garages and you drive away in the new one
      const old = car.styleKey, nk = newCars[newCars.length - 1];
      if (old !== nk) {
        chooseCar(nk); reconcileFleet();
        const e = fleet[old], ap = e && city.apartments.find(q => q.id === e.apt);
        toast('Your new ' + (CAR_STYLES.find(c => c.key === nk) || {}).name + ' is ready' + (ap ? ' - the ' + (CAR_STYLES.find(c => c.key === old) || {}).name + ' is parked at ' + ap.name : ''));
      }
      if (modal.preview) { modal.preview = nk; }
    } else reconcileFleet();
    persist(); applyMods(); refreshPanel();
    if (!newCars.length) toast(total > 0 ? 'Purchased for ' + money(total) : 'Done');
  }
  function spend(v) { if (cash() < v) { toast('Not enough money'); return false; } taxi.addCash(-v); return true; }
  function buyOwn(id, price, then) { const m = modsOf(car.styleKey); if (m.own[id]) { then(m); persist(); applyMods(); refreshPanel(); return; } if (!spend(price)) return; m.own[id] = true; then(m); persist(); applyMods(); refreshPanel(); toast('Installed!'); }

  function levelRows(group, defs) {
    const m = modsOf(car.styleKey), rows = [];
    defs.forEach(([key, label, prices, desc]) => {
      rows.push({ hint: label + ' — ' + desc });
      prices.forEach((p, i) => {
        const lvl = i + 1, have = m.perf[key] >= lvl, next = m.perf[key] === i;
        rows.push({ name: `${label} stage ${lvl}`, sub: have ? 'Installed' : money(p), btn: have ? '✓' : next ? 'Buy' : '🔒', disabled: have || !next, act: () => buyOwn(`perf.${key}.${lvl}`, p, mm => { mm.perf[key] = lvl; }) });
      });
    });
    return rows;
  }
  function buildSpec() {
    const m = car.model ? modsOf(car.styleKey) : null;
    if (modal.kind === 'apt') return aptSpec(modal.target.data);
    if (modal.kind === 'agent') return agentSpec(modal.target.data);
    if (modal.kind === 'travel') return travelSpec();
    if (modal.kind === 'desk') return deskSpec();
    if (modal.kind === 'wardrobe' || modal.kind === 'fitting') return clothesSpec();
    const shop = modal.target.data, kind = SHOP_KINDS[shop.kind], style = CAR_STYLES.find(s => s.key === car.styleKey);
    const base = { title: kind.name, accent: kind.color, sub: kind.desc, right: style ? style.name : '' };
    // ---- shopping cart: pick what you want, watch the total, then press Purchase ----
    const real = m, d = draft(), cartMap = modal.cart;
    const buyBar = () => ({ total: cartTotal(), count: cartMap.size });
    const pickRow = ({ group, key, name, price, fitted, apply, commit, hover, sub, noun }) => {
      const inCart = cartMap.get(group), chosen = inCart && inCart.key === key;
      const state = chosen ? 'Selected' : fitted && !inCart ? '✓' : fitted ? 'Keep' : price > 0 ? 'Select' : 'Fit';
      return { name, sub: sub || (chosen ? (price > 0 ? money(price) + ' · in your cart' : 'In your cart') : fitted ? 'Fitted' : price > 0 ? money(price) : 'Owned'), sel: chosen, btn: state, disabled: fitted && !inCart, hover,
        act: () => { if (fitted) cartMap.delete(group); else pick({ group, key, name, price, apply, commit }); if (fitted) { applyMods(draft()); refreshPanel(); } } };
    };
    const stageRows = (rows, group, label, prices, desc, getLvl, setLvl) => {
      rows.push({ hint: label + ' - ' + desc });
      const cur = getLvl(real), inCart = cartMap.get(group), pend = inCart ? inCart.level : null;
      prices.forEach((p, i) => {
        const lvl = i + 1, have = cur >= lvl, sel = pend != null && pend >= lvl;
        const cum = prices.slice(cur, lvl).reduce((a, b) => a + b, 0);
        rows.push({ name: `${label} stage ${lvl}`, sub: have ? 'Installed' : pend === lvl ? `${money(cum)} · in your cart` : sel ? 'Included' : money(p) + (lvl > cur + 1 ? ' (+ earlier stages)' : ''),
          sel: pend === lvl, btn: have ? '✓' : pend === lvl ? 'Selected' : sel ? 'Included' : 'Select', disabled: have, hover: group.startsWith('perf.') ? { [group.slice(5)]: lvl } : undefined,
          act: () => { if (pend === lvl) { cartMap.delete(group); applyMods(draft()); refreshPanel(); } else pick({ group, key: 'L' + lvl, level: lvl, name: `${label} stage ${lvl}`, price: cum, apply: mm => setLvl(mm, lvl) }); } });
      });
    };
    const chipRow = (name, list) => ({ name, chips: list });
    if (shop.kind === 'dealer') {
      const slots = garageSlots(), picked = [...cartMap.keys()].filter(g => g.startsWith('car.')).length;
      const need = save.bought.length + picked >= slots;
      return { ...base, buy: buyBar(), right: `Garage ${save.bought.length + picked}/${slots}`, rows: [{ hint: need ? (slots ? 'Your garage bays are full - a new car needs a free bay for the car you drive now. Buy or rent a flat with a bigger garage first.' : 'You need a garage first: a new car goes home with you and your current car is parked in your garage. Buy a flat with a garage from an estate agent.') : 'The car you drive now is parked in a free garage bay and you drive away in the new one.' }].concat(CAR_STYLES.filter(cs => !cs.job).map(cs => {
        const owned = ownedCars().includes(cs.key), price = CAR_PRICE[cs.key] || 0, g = 'car.' + cs.key, chosen = cartMap.has(g), full = save.bought.length + picked >= slots && !chosen;
        return { name: cs.name, sub: `Class ${cs.cls} · ${Math.round(cs.maxSpeed * 6.2)} km/h · 0-100 ${zeroTo100(cs.accel, cs.maxSpeed, cs.mass).toFixed(1)} s · ${cs.mass} kg · ${owned ? 'Owned' : money(price)}`, sel: modal.preview === cs.key || chosen,
          btn: owned ? 'Owned' : chosen ? 'Selected' : full ? 'No garage' : 'Select', disabled: owned || full,
          focus: () => { modal.preview = cs.key; showPreview(cs.key); refreshPanel(); },
          act: () => { if (owned) return; if (chosen) cartMap.delete(g); else cartMap.set(g, { group: g, key: cs.key, name: cs.name, price, apply: () => {}, commit: () => { save.bought.push(cs.key); } }); refreshPanel(); } };
      })) };
    }
    if (shop.kind === 'perf') {
      const rows = [];
      { const cc = carClass(style.cls, d), nxt = CLASS_ORDER[Math.min(5, classIndex(style.cls) + 1)];
        rows.push({ hint: `Class ${cc.cls}${cc.maxed ? ' (maxed out: moved up from ' + cc.base + ')' : ''} - build ${Math.round(cc.progress * 100)}%. Fit every upgrade to lift this car to class ${nxt}.` }); }
      Object.keys(UPG.stages).forEach(k => {
        const st2 = UPG.stages[k], fxt = Object.entries(st2.fx || {}).filter(([, v]) => v).map(([n, v]) => (n === 'weight' ? '-' : '+') + Math.round(v * 100) + '% ' + n).join(', ');
        stageRows(rows, 'perf.' + k, st2.name, st2.prices, st2.desc + (fxt ? ' (' + fxt + ' per stage)' : ''), x => x.perf[k], (mm, l) => { mm.perf[k] = l; });
      });
      rows.push({ hint: 'Stripping & limiter' });
      [['seats', 'Remove seats', UPG.seats.price, '-' + UPG.seats.kg + ' kg: ' + UPG.seats.desc], ['limiter', 'Remove speed limiter', UPG.limiter.price, '+' + Math.round(UPG.limiter.speed * 100) + '% ' + UPG.limiter.desc]].forEach(([k, n, p, ds]) => {
        rows.push({ ...pickRow({ group: 'perf.' + k, key: k, name: n, price: p, fitted: !!real.perf[k], sub: real.perf[k] ? 'Installed' : `${money(p)} - ${ds}`, hover: { [k]: 1 }, apply: mm => { mm.perf[k] = 1; } }), hover: { [k]: 1 } });
      });
      return { ...base, perfBars: true, buy: buyBar(), rows };
    }
    if (shop.kind === 'paint') {
      const curPaint = d.paint != null ? d.paint : style.color, rp = real.paint != null ? real.paint : style.color;
      const rows = [{ chips: PAINTS.map(([n, c]) => ({ label: n + (c === rp ? '' : ' · $' + UPG.paint), color: c, on: curPaint === c,
        act: () => { if (c === rp) cartMap.delete('paint'); else if (cartMap.get('paint') && cartMap.get('paint').key === c) cartMap.delete('paint'); else cartMap.set('paint', { group: 'paint', key: c, name: n, price: UPG.paint, apply: mm => { mm.paint = c; } }); applyMods(draft()); refreshPanel(); } })), name: 'Paint job - $' + UPG.paint }];
      [['none', 'No decal', 0], ['stripe', 'Racing stripe', UPG.decal], ['twin', 'Twin stripes', UPG.decal], ['side', 'Side stripes', UPG.decal]].forEach(([t, n, p]) => {
        const owned = t === 'none' || real.own['decal.' + t];
        rows.push(pickRow({ group: 'decal', key: t, name: n, price: owned ? 0 : p, fitted: real.decal.type === t, apply: mm => { mm.decal.type = t; if (t !== 'none') mm.own['decal.' + t] = true; } }));
      });
      rows.push({ name: 'Decal colour (free)', chips: DECAL_COLORS.map(([n, c]) => ({ label: n, color: c, on: d.decal.color === c, act: () => { if (real.decal.color === c) cartMap.delete('decalcolor'); else cartMap.set('decalcolor', { group: 'decalcolor', key: c, name: n, price: 0, apply: mm => { mm.decal.color = c; } }); applyMods(draft()); refreshPanel(); } })) });
      return { ...base, buy: buyBar(), rows };
    }
    if (shop.kind === 'tuning') {
      const rows = [{ name: real.own.neon ? 'Underglow neon (owned - recolour free)' : 'Underglow neon - $' + UPG.neon + ' (then free to recolour)', chips: NEONS.map(([n, c]) => ({ label: n, color: c, on: d.neon === c,
        act: () => { const cc = cartMap.get('neon'); if (cc && cc.key === c) cartMap.delete('neon'); else cartMap.set('neon', { group: 'neon', key: c, name: 'Neon ' + n, price: real.own.neon ? 0 : UPG.neon, apply: mm => { mm.neon = c; mm.own.neon = true; } }); applyMods(draft()); refreshPanel(); } })) }];
      if (real.neon != null || d.neon != null) rows.push(pickRow({ group: 'neon', key: 'off', name: 'Remove neon', price: 0, fitted: d.neon == null && real.neon == null, sub: 'Switch the underglow off', apply: mm => { mm.neon = null; } }));
      rows.push(pickRow({ group: 'xenon', key: 'x', name: 'Xenon headlights', price: UPG.xenon, fitted: !!real.xenon, sub: real.xenon ? 'Fitted' : '$' + UPG.xenon + ' · cold blue-white beams', apply: mm => { mm.xenon = true; } }));
      rows.push({ hint: 'Trunk: nitro tank - hold Shift to boost (+30% top speed, 2.4x acceleration), refills over time' });
      const nr = []; stageRows(nr, 'nitro', 'Nitro tank', UPG.nitro.prices, 'boost time ' + UPG.nitro.secs.join(' / ') + ' s', x => x.nitro, (mm, l) => { mm.nitro = l; }); rows.push(...nr.slice(1));
      rows.push({ hint: 'Fuel' });
      const tr = []; stageRows(tr, 'tank', 'Fuel tank', UPG.tank.prices, '+5 L per stage (tank 25 / 30 / 35 / 40 L)', x => x.tank || 0, (mm, l) => { mm.tank = l; }); rows.push(...tr.slice(1));
      rows.push({ hint: 'HUD' });
      const hr = []; stageRows(hr, 'hud', 'HUD', UPG.hud.prices, 'stage 1 digital speedo, stage 2 adds compass + clock', x => x.hud, (mm, l) => { mm.hud = l; }); rows.push(...hr.slice(1));
      return { ...base, buy: buyBar(), rows };
    }
    // body kit shop
    const slots = [['front', 'Front bumper'], ['rear', 'Rear bumper'], ['skirts', 'Side skirts'], ['spoiler', 'Spoiler'], ['fenders', 'Fender flares'], ['hood', 'Hood']].map(([k, l]) => [k, l, UPG.kit[k].names, UPG.kit[k].prices]);
    const rows = [];
    slots.forEach(([slot, label, names, prices]) => {
      rows.push({ hint: label });
      names.forEach((n, v) => { const owned = v === 0 || real.own[`kit.${slot}.${v}`]; rows.push(pickRow({ group: 'kit.' + slot, key: v, name: n, price: owned ? 0 : prices[v], fitted: real.kit[slot] === v, apply: mm => { mm.kit[slot] = v; if (v) mm.own[`kit.${slot}.${v}`] = true; } })); });
    });
    return { ...base, buy: buyBar(), rows };
  }

  // ---- wardrobe + clothes shops: the character spins in a little studio; shops use the cart, the wardrobe wears straight away ----
  function previewOutfit() { return { ...save.outfit, ...(modal.tryOn || {}) }; }
  function clothesSpec() {
    const shop = modal.kind === 'fitting', slot = SLOTS[modal.tab][0], cart = modal.cart, rows = [];
    const buyBar = () => { let t = 0; cart.forEach(it => { t += it.price; }); return { total: t, count: cart.size }; };
    CLOTHES[slot].forEach(it => {
      const own = ownsCloth(slot, it.id), worn = save.outfit[slot] === it.id, gk = 'cl.' + slot + ':' + it.id, inCart = cart.has(gk);
      const tryOn = () => { modal.tryOn[slot] = it.id; stage.dress(previewOutfit()); };
      if (shop) {
        if (it.price === 0 && it.id === 'none') return;
        rows.push({ name: it.name, sub: own ? 'In your wardrobe' : inCart ? money(it.price) + ' · in your cart' : money(it.price), sel: inCart || (modal.tryOn[slot] === it.id), btn: own ? 'Owned' : inCart ? 'Selected' : 'Select', disabled: own,
          focus: tryOn, act: () => { if (inCart) cart.delete(gk); else { cart.set(gk, { group: gk, key: it.id, name: it.name, price: it.price, apply: () => {}, commit: () => { save.clothes.push(slot + ':' + it.id); } }); tryOn(); } refreshPanel(); } });
      } else if (own) {
        rows.push({ name: it.name, sub: worn ? 'Wearing' : '', sel: worn, btn: worn ? '✓' : 'Wear', disabled: worn, focus: () => {}, act: () => { save.outfit[slot] = it.id; modal.tryOn = {}; dressAvatar(avatar, save.outfit); stage.dress(save.outfit); persist(); refreshPanel(); } });
      }
    });
    const hint = shop ? 'Tap an item to try it on, then Select the ones you want. Purchases go to your wardrobe - you keep wearing what you came in with.' : 'Wear anything you own. Drag the picture to spin your character. New clothes are sold in the clothes shops (pink C on the map).';
    const spec = { title: shop ? modal.target.name : 'Wardrobe', accent: shop ? '#ff5fa8' : '#ff9f43', sub: shop ? 'Clothes' : 'Your clothes', right: '', tabs: SLOTS.map(x => x[1]), rows: [{ hint }].concat(rows), exit: shop ? 'Leave' : 'Close' };
    if (shop) spec.buy = buyBar();
    return spec;
  }

  // ---- sleep: drag the hands of the clock to the time you want to wake up ----
  function renderSleep() {
    const h = env && env.state ? env.state.hour : 22, wake = modal.wake, pm = wake >= 12;
    const fmt = v => { const hh = Math.floor(v) % 24, mm = Math.round((v % 1) * 60) % 60; return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };
    let hours = wake - h; if (hours <= 0) hours += 24;
    panel.style.setProperty('--accent', '#7aa0ff');
    panel.innerHTML = `<header><h2>Go to sleep</h2><div class="sub">Drag the hands to set your alarm</div></header><div class="cashline"><span>Now ${fmt(h)}</span><span>Sleep ${hours.toFixed(1)} h</span></div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:8px 0"><canvas id="sleepclock" width="240" height="240" style="touch-action:none;cursor:grab"></canvas>
      <div style="font:800 32px ui-monospace,monospace">${fmt(wake)}</div>
      <div class="seg" style="display:flex;gap:6px"><button class="am" ${!pm ? 'style="background:#2f7cf6"' : ''}>AM</button><button class="pm" ${pm ? 'style="background:#2f7cf6"' : ''}>PM</button></div></div>
      <footer><button class="buy go">Sleep until ${fmt(wake)}</button><button class="x">Cancel</button></footer>`;
    const cv = panel.querySelector('#sleepclock'), q = cv.getContext('2d'), cx = 120, cy = 120, R = 108;
    const hourAng = ((wake % 12) + (wake % 1 ? 0 : 0)) / 12 * Math.PI * 2, minAng = (wake % 1) * Math.PI * 2;
    q.fillStyle = '#10151c'; q.beginPath(); q.arc(cx, cy, R + 8, 0, 7); q.fill(); q.strokeStyle = '#7aa0ff'; q.lineWidth = 4; q.stroke();
    q.fillStyle = '#e8ecf1'; q.font = 'bold 15px system-ui'; q.textAlign = 'center'; q.textBaseline = 'middle';
    for (let i = 1; i <= 12; i++) { const a = i / 12 * Math.PI * 2; q.fillText(String(i), cx + Math.sin(a) * (R - 16), cy - Math.cos(a) * (R - 16)); }
    for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2, l = i % 5 ? 4 : 8; q.strokeStyle = '#6b7788'; q.lineWidth = 1; q.beginPath(); q.moveTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R); q.lineTo(cx + Math.sin(a) * (R - l), cy - Math.cos(a) * (R - l)); q.stroke(); }
    const hand = (ang, len, w, col) => { q.strokeStyle = col; q.lineWidth = w; q.lineCap = 'round'; q.beginPath(); q.moveTo(cx, cy); q.lineTo(cx + Math.sin(ang) * len, cy - Math.cos(ang) * len); q.stroke(); q.fillStyle = col; q.beginPath(); q.arc(cx + Math.sin(ang) * len, cy - Math.cos(ang) * len, w + 3, 0, 7); q.fill(); };
    hand(hourAng + (wake % 1) / 12 * Math.PI * 2, R * 0.5, 7, '#ffd21f'); hand(minAng, R * 0.78, 4, '#7aa0ff');
    q.fillStyle = '#fff'; q.beginPath(); q.arc(cx, cy, 6, 0, 7); q.fill();
    let which = null;
    const setFrom = e => {
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 240 - cx, y = (e.clientY - r.top) / r.height * 240 - cy;
      let ang = Math.atan2(x, -y); if (ang < 0) ang += Math.PI * 2;
      const hh = Math.floor(wake) % 12, mm = Math.round((wake % 1) * 60);
      if (which === 'min') { let nm = Math.round(ang / (Math.PI * 2) * 60 / 5) * 5 % 60; let nh = Math.floor(wake) % 12; if (mm > 40 && nm < 20) nh = (nh + 1) % 12; if (mm < 20 && nm > 40) nh = (nh + 11) % 12; modal.wake = (pm ? 12 : 0) + nh + nm / 60; }
      else { const nh = Math.round(ang / (Math.PI * 2) * 12) % 12; modal.wake = (pm ? 12 : 0) + nh + (mm / 60); }
      refreshPanel();
    };
    cv.addEventListener('pointerdown', e => {
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 240 - cx, y = (e.clientY - r.top) / r.height * 240 - cy;
      which = Math.hypot(x, y) < R * 0.55 ? 'hour' : 'min'; try { cv.setPointerCapture(e.pointerId); } catch (er) { /* */ }
      cv.dataset.drag = '1'; setFrom(e);
    });
    cv.addEventListener('pointermove', e => { if (cv.dataset.drag === '1' && which) setFrom(e); });
    const stop = () => { cv.dataset.drag = ''; };
    cv.addEventListener('pointerup', stop); cv.addEventListener('pointercancel', stop);
    panel.querySelector('.am').addEventListener('click', () => { if (modal.wake >= 12) modal.wake -= 12; refreshPanel(); });
    panel.querySelector('.pm').addEventListener('click', () => { if (modal.wake < 12) modal.wake += 12; refreshPanel(); });
    panel.querySelector('.x').addEventListener('click', closeModal);
    panel.querySelector('.go').addEventListener('click', () => {
      const target = modal.wake, from = env && env.state ? env.state.hour : 22; let slept = target - from; if (slept <= 0) slept += 24;
      closeModal();
      transition(() => { if (sleepHook) sleepHook(slept); else if (env) env.setHour(target, true); toast('You slept ' + slept.toFixed(1) + ' hours. Good morning!'); });
    });
  }

  // ---- travel: from the flat, pick where to go next; the car is waiting there ----------------------------------------
  let extraDest = () => [];
  function destinations() {
    const out = [], reg = (x, z) => regionOf(x, z)[0].toUpperCase() + regionOf(x, z).slice(1);
    const at = (name, group, x, z, nx, nz, dist = 7) => out.push({ name, group, sub: reg(x, z), x: x + nx * dist, z: z + nz * dist, h: Math.atan2(nx, nz) });
    (city.shops || []).forEach(s => at(SHOP_KINDS[s.kind].name, 'Shops', s.door.x, s.door.z, -s.nx, -s.nz, 15));
    (city.stores || []).forEach(g => at(g.name, 'Clothes shops', g.door.x, g.door.z, g.facade.nx, g.facade.nz));
    (city.agents || []).forEach(g => at(g.name, 'Real estate', g.door.x, g.door.z, g.facade.nx, g.facade.nz));
    (city.apartments || []).forEach(a => { if (save.apts[a.id]) at(a.name + ' (street)', 'Your apartments', a.door.x, a.door.z, a.facade.nx, a.facade.nz); });
    extraDest().forEach(d => out.push(d));
    return out;
  }
  function travelTo(d) {
    closeModal();
    transition(() => {
      leaveMode(); mode = 'city'; cur = null;
      const e = fleet[car.styleKey]; if (e && e.live) { delete fleet[car.styleKey]; persist(); }
      car.teleport(d.x, d.z, hAt(d.x, d.z), d.h); onFoot = false; avatar.visible = false; boosting = false;
    });
  }
  // ---- the desk: your stats, your cars and your races at a glance ----
  let raceInfo = () => [], sleepHook = null, statsT = 30;
  const stats = (save.stats ||= { secs: 0, units: 0 });
  function deskSpec() {
    const owned = ownedCars(), races = raceInfo(), rs = save.races || {};
    const plays = Object.values(rs).reduce((n, r) => n + (r.plays || 0), 0), wins = Object.values(rs).reduce((n, r) => n + (r.wins || 0), 0);
    const aptN = city.apartments.filter(a => save.apts[a.id]).length, clothesN = save.clothes.length;
    const done = races.filter(r => rs[r.id] && rs[r.id].wins).length;
    const parts = [owned.length / CAR_STYLES.length, races.length ? done / races.length : 0, aptN / Math.max(1, city.apartments.length), clothesN / Math.max(1, Object.values(CLOTHES).reduce((n, l) => n + l.length, 0))];
    const pct = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length * 100);
    const km = stats.units * 1.25 / 1000, hrs = stats.secs / 3600;
    const rows = [];
    if (modal.tab === 0) {
      rows.push({ hint: 'Progress' });
      rows.push({ name: pct + '% complete', sub: `${owned.length}/${CAR_STYLES.length} cars · ${done}/${races.length} races won · ${aptN}/${city.apartments.length} flats · ${clothesN} clothes` });
      rows.push({ hint: 'Career' });
      rows.push({ name: 'Money', sub: money(cash()) });
      rows.push({ name: 'Distance driven', sub: km.toFixed(1) + ' km' });
      rows.push({ name: 'Time played', sub: hrs >= 1 ? hrs.toFixed(1) + ' h' : Math.round(stats.secs / 60) + ' min' });
      rows.push({ name: 'Races', sub: `${plays} run · ${wins} won` });
    } else if (modal.tab === 1) {
      // your cars grouped by the house they live at (each flat has its own garage)
      const nameOf = k => (CAR_STYLES.find(c => c.key === k) || {}).name || k, info = k => { const cs = CAR_STYLES.find(c => c.key === k); return cs ? `Class ${cs.cls} · ${Math.round(cs.maxSpeed * 6.2)} km/h` : ''; };
      const drivingNow = owned.includes(car.styleKey) ? car.styleKey : null;
      if (drivingNow) { rows.push({ hint: 'Driving now' }); rows.push({ name: nameOf(drivingNow), sub: info(drivingNow) }); }
      const homes = city.apartments.filter(a => save.apts[a.id]);
      if (!homes.length) rows.push({ hint: 'You do not own a house yet - buy a flat with a garage from an estate agent to keep more cars.' });
      homes.forEach(a => {
        const here = owned.filter(k => k !== drivingNow && fleet[k] && fleet[k].apt === a.id);
        rows.push({ hint: `${a.name} - ${a.label} · ${a.district} (garage ${here.length}/${a.garage})` });
        if (!here.length) rows.push({ name: 'Empty garage', sub: `${a.garage} bay${a.garage === 1 ? '' : 's'} free` });
        here.forEach(k => rows.push({ name: nameOf(k), sub: info(k) + (fleet[k].spot >= 0 ? ` · bay ${fleet[k].spot + 1}` : ' · parked on the garage floor') }));
      });
      const lost = owned.filter(k => k !== drivingNow && !(fleet[k] && homes.some(a => a.id === fleet[k].apt)));
      if (lost.length) { rows.push({ hint: 'No garage space' }); lost.forEach(k => rows.push({ name: nameOf(k), sub: info(k) + ' · no free bay - get a bigger garage' })); }
    } else {
      if (!races.length) rows.push({ hint: 'No races listed.' });
      races.forEach(r => { const st = rs[r.id] || {}; rows.push({ name: r.name, sub: `${r.kind} · class ${r.cls || '-'} · ${st.plays || 0} run · ${st.wins || 0} won` + (st.best ? ' · best ' + (r.kind === 'drift' ? Math.round(st.best).toLocaleString('en-US') + ' pts' : st.best.toFixed(1) + ' s') : '') }); });
    }
    return { title: 'Desk', sub: 'Your records', accent: '#4aa3ff', right: pct + '% complete', tabs: ['Stats', 'Cars', 'Races'], rows, exit: 'Close' };
  }
  function travelSpec() {
    const rows = [{ hint: 'Pick a destination - your car is waiting there.' }];
    let g = '';
    destinations().forEach(d => { if (d.group !== g) { g = d.group; rows.push({ hint: g.toUpperCase() }); } rows.push({ name: d.name, sub: d.sub, btn: 'Go', act: () => travelTo(d) }); });
    return { title: 'City map', sub: 'Travel from home', accent: '#4aa3ff', right: '', rows, exit: 'Stay home' };
  }
  const aptInfo = a => `${a.rooms} room${a.rooms > 1 ? 's' : ''} (${a.beds ? a.beds + ' bed · ' : 'studio · '}${a.baths} bath) · ${a.surface} m² · floor ${a.floor} · ${a.garage} parking space${a.garage > 1 ? 's' : ''}`;
  function aptSpec(a) {
    const owned = !!save.apts[a.id];
    const rows = [{ name: a.name, sub: `${a.label} · ${a.district}`, btn: owned ? 'Owned' : money(a.price), disabled: owned || cash() < a.price, act: () => buyApt(a, a.price) }];
    rows.push({ hint: aptInfo(a) });
    rows.push({ hint: `Buying adds ${a.garage} underground parking space${a.garage > 1 ? 's' : ''} for your cars. Real estate agents sell the same flats at ${Math.round((AGENT_MARKUP - 1) * 100)}% more.` });
    return { title: a.name, sub: a.label + ' · ' + a.district, accent: '#ffd21f', right: `Garage ${save.bought.length}/${garageSlots()}`, rows, exit: 'Leave' };
  }
  function agentSpec(ag) {
    const rows = [{ hint: `Listings in the ${ag.region} of the city. Agent prices are ${Math.round((AGENT_MARKUP - 1) * 100)}% above the price at the flat's own door. Villas with private garages: coming soon.` }];
    APARTMENT_TIERS.forEach(t => {
      const list = city.apartments.filter(a => a.region === ag.region && a.type === t.key).sort((p, q) => p.floor - q.floor);
      if (!list.length) return;
      rows.push({ hint: `${t.label.toUpperCase()}` });
      list.forEach(a => {
        const price = Math.round(a.price * AGENT_MARKUP), owned = !!save.apts[a.id];
        rows.push({ name: `${a.name} · ${a.district}`, sub: aptInfo(a), btn: owned ? 'Owned' : money(price), disabled: owned || cash() < price, act: () => buyApt(a, price) });
      });
    });
    if (rows.length === 1) rows.push({ hint: 'Nothing is listed in this region right now.' });
    return { title: ag.name, sub: 'Real estate · ' + ag.region[0].toUpperCase() + ag.region.slice(1), accent: '#19c6b7', right: `Garage ${save.bought.length}/${garageSlots()}`, rows, exit: 'Leave' };
  }

  function showPreview(key) {
    if (previewCar) { scene.remove(previewCar); previewCar = null; }
    if (!key) { car.group.visible = true; return; }
    car.group.visible = false;
    previewCar = buildCarModel(key);
    previewCar.position.set(bay.x, bay.y, bay.z); previewCar.rotation.y = bay.heading + spin;
    scene.add(previewCar);
  }
  // spin: how far the shop's turntable has been dragged round (yaw only -- the car can't be tipped over)
  let spin = 0, spinV = 0, dragging = false, dragX = 0;
  const canvasEl = () => document.querySelector('canvas');
  addEventListener('pointerdown', e => {
    if (!modal || !(modal.kind === 'shop' || modal.kind === 'wardrobe' || modal.kind === 'fitting') || panel.contains(e.target) || (e.target.closest && e.target.closest('button,#wprompt'))) return;
    dragging = true; dragX = e.clientX; spinV = 0;
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  addEventListener('pointermove', e => {
    if (!dragging) return;
    const d = (e.clientX - dragX) * 0.011; dragX = e.clientX;
    spin += d; spinV = d / Math.max(1 / 120, 0.016);
  });
  const endDrag = () => { dragging = false; };
  addEventListener('pointerup', endDrag); addEventListener('pointercancel', endDrag);
  function openModal(t) {
    modal = { kind: t.kind, target: t, tab: 0, preview: null, cart: new Map() };
    if (t.kind === 'shop') {
      const s = t.data, dx = -s.nx, dz = -s.nz;       // door -> alley mouth
      // the car is valeted into the shop's showroom (a lit bay far off the map), nose to the camera; closing puts it back in the alley
      bay = { x: showroom.position.x, z: showroom.position.z, y: showroom.position.y, heading: 0, dx, dz, exitHeading: Math.atan2(dx, dz) };
      cameFootAt = onFoot ? { x: s.door.x + dx * 2.6, z: s.door.z + dz * 2.6 } : null;
      showroom.show(true, { key: s.kind, ...SHOP_KINDS[s.kind] });
      // the player's car is brought into the bay (valet service, like driving into the shop in NFSU)
      car.teleport(bay.x, bay.z, bay.y, bay.heading);
      if (onFoot) { foot.x = cameFootAt.x; foot.z = cameFootAt.z; avatar.position.set(foot.x, foot.y, foot.z); }
      avatar.visible = false;
      spin = 0; spinV = 0; modal.snap = true;
      if (innerWidth > 720) camera.setViewOffset(innerWidth, innerHeight, Math.min(430, innerWidth * 0.6) / 2, 0, innerWidth, innerHeight);
      else camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.26, innerWidth, innerHeight);
      const tc = document.getElementById('touch'); if (tc) tc.style.display = 'none';
      document.documentElement.style.touchAction = 'none'; document.body.style.touchAction = 'none';
    }
    if (t.kind === 'wardrobe' || t.kind === 'fitting') {
      modal.tryOn = {}; modal.tab = 0; spin = 0; spinV = 0; modal.snap = true;
      stage.show(true); stage.dress(save.outfit); stage.rotate(0);
      avatar.visible = false;
      if (innerWidth > 720) camera.setViewOffset(innerWidth, innerHeight, Math.min(430, innerWidth * 0.6) / 2, 0, innerWidth, innerHeight);
      else camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.26, innerWidth, innerHeight);
      const tc = document.getElementById('touch'); if (tc) tc.style.display = 'none';
      document.documentElement.style.touchAction = 'none'; document.body.style.touchAction = 'none';
    }
    if (t.kind === 'bed') { const h = env && env.state ? env.state.hour : 22; modal.wake = ((Math.round((h + 8) * 4) / 4) % 24 + 24) % 24; if (modal.wake < 5 || modal.wake > 11) modal.wake = 7; modal.wake = Math.round(modal.wake * 4) / 4; }
    setModalPause(true);
    promptEl.style.display = 'none';
    panel.style.display = 'flex';
    refreshPanel();
  }
  function closeModal() {
    if (!modal) return;
    if (modal.kind === 'shop') {
      if (modal.cart && modal.cart.size) { modal.cart.clear(); applyMods(); }
      // the car is put well outside the shop, in the alley, nose toward the street
      const ox = modal.target.data.door.x + bay.dx * 15, oz = modal.target.data.door.z + bay.dz * 15;
      car.heading = bay.exitHeading; car.speed = 0;
      car.teleport(ox, oz, heightAt(ox, oz), bay.exitHeading);
      showroom.show(false);
      shopCool = modal.target;
    }
    const wasStage = modal.kind === 'wardrobe' || modal.kind === 'fitting';
    if (wasStage) { stage.show(false); dressAvatar(avatar, save.outfit); }
    showPreview(null);
    camera.clearViewOffset();
    const tc = document.getElementById('touch'); if (tc) tc.style.display = '';
    document.documentElement.style.touchAction = ''; document.body.style.touchAction = '';
    dragging = false;
    modal = null;
    panel.style.display = 'none';
    setModalPause(false);
    if (onFoot) avatar.visible = mode !== 'flat';
    if (wasStage && onFoot) snapCamera();
  }
  const _cc = new THREE.Vector3();
  const stageCam = new THREE.Vector3();
  function updateModal(dt) {
    if (modal && (modal.kind === 'wardrobe' || modal.kind === 'fitting')) {
      if (!dragging) { spin += spinV * dt; spinV *= Math.pow(0.04, dt); if (Math.abs(spinV) < 0.02) spinV = 0; }
      else spin += 0;
      stage.rotate(spin);
      stageCam.set(stage.position.x + 0.6, 1.3, stage.position.z + 4.3);
      if (modal.snap) { camera.position.copy(stageCam); modal.snap = false; } else camera.position.lerp(stageCam, 1 - Math.pow(0.002, dt));
      camera.up.set(0, 1, 0); camera.lookAt(stage.position.x + 0.2, 0.95, stage.position.z);
      return;
    }
    if (!modal || modal.kind !== 'shop') return;
    if (!dragging) { spin += spinV * dt; spinV *= Math.pow(0.04, dt); if (Math.abs(spinV) < 0.02) spinV = 0; }
    // fixed camera: ahead of the car and to its right-hand side (about 40 deg off the nose), a little above
    const fx = Math.sin(bay.heading), fz = Math.cos(bay.heading), rx = -Math.cos(bay.heading), rz = Math.sin(bay.heading);
    const AZ = 0.7, D = 6.6;
    _cc.set(bay.x + (fx * Math.cos(AZ) + rx * Math.sin(AZ)) * D, bay.y + 1.75, bay.z + (fz * Math.cos(AZ) + rz * Math.sin(AZ)) * D);
    if (modal.snap) { camera.position.copy(_cc); modal.snap = false; } else camera.position.lerp(_cc, 1 - Math.pow(0.002, dt));
    camera.up.set(0, 1, 0);
    camera.lookAt(bay.x, bay.y + 0.65, bay.z);
    if (previewCar) previewCar.rotation.y = bay.heading + spin;
    else { car.heading = bay.heading + spin; car.group.rotation.set(0, car.heading, 0); }
    updateCluster();
  }

  // ---------- the E key / prompt ---------------------------------------------------------------------------------
  function act() {
    if (modal || (blockedFn && blockedFn())) return;
    const t = nearestTarget();
    if (trans) return;
    if (t) { activate(t); return; }
    if (onFoot) {
      const dCar = Math.hypot(foot.x - car.x, foot.z - car.z), st = nearStatic();
      if (st && (dCar > 4.5 || st.d < dCar)) { swapTo(st.s); return; }
      if (dCar < 4.5 && mode !== 'flat' && Math.abs(car.y - foot.y) < 2.5) enterCar(); else toast(mode === 'flat' ? 'Your car is in the garage downstairs' : 'Your car is further away — walk back to it');
      return;
    }
    if (Math.abs(car.speed) < 3) exitCar(); else toast('Slow down to step out');
  }
  let escAt = -1e9;
  addEventListener('keydown', e => {
    if (e.code === 'KeyE' && !e.repeat && !e.target.closest?.('input,textarea')) { if (modal) closeModal(); else act(); }
    if (e.code === 'Escape' && modal) { closeModal(); escAt = performance.now(); }
  });
  promptEl.addEventListener('click', act); actBtn.addEventListener('click', act);

  function updatePrompt() {
    if (modal) return;
    if (blockedFn && blockedFn()) { promptEl.style.display = 'none'; return; }
    target = nearestTarget();
    let msg = '';
    if (target) msg = `<kbd>E</kbd>${({ apt: save.apts[target.id] ? 'Enter your flat' : 'View ' + target.name, agent: 'Visit ' + target.name, gate: 'Enter the garage', lift: 'Take ' + target.name, door: 'Go out to the ' + target.name, bed: 'Go to sleep', wardrobe: 'Open the wardrobe', fitting: 'Try on clothes', store: 'Enter ' + target.name })[target.kind] || 'Enter ' + target.name}`;
    else if (onFoot) {
      const dCar = Math.hypot(foot.x - car.x, foot.z - car.z), st = nearStatic();
      if (st && (dCar > 4.5 || st.d < dCar)) msg = `<kbd>E</kbd>Get in the ${(CAR_STYLES.find(c => c.key === st.s.key) || {}).name}`;
      else msg = dCar < 4.5 && mode !== 'flat' ? '<kbd>E</kbd>Get in car' : '';
    }
    else if (Math.abs(car.speed) < 1) msg = '<kbd>E</kbd>Get out';
    promptEl.innerHTML = msg; promptEl.style.display = msg ? 'block' : 'none';
    actBtn.textContent = target ? '🏢' : onFoot ? '🚗' : '🚪';
  }

  // minimap pins for what is near
  function mapMarkers(all = false) {
    if (mode !== 'city') return [];
    const px = onFoot ? foot.x : car.x, pz = onFoot ? foot.z : car.z, out = [];
    targets.forEach(t => {
      if (!all && t.kind !== 'shop' && Math.hypot(t.x - px, t.z - pz) > 170) return;   // shops are always pinned
      if (t.kind === 'gate') { out.push({ x: t.x, z: t.z, color: '#4aa3ff', label: 'P' }); return; }
      if (t.kind === 'agent') { out.push({ x: t.x, z: t.z, color: '#19c6b7', label: 'RE' }); return; }
      if (t.kind === 'store') { out.push({ x: t.x, z: t.z, color: '#ff5fa8', label: 'C' }); return; }
      out.push({ x: t.x, z: t.z, color: t.kind === 'apt' ? (save.apts[t.id] ? '#5cff8a' : '#ffd21f') : SHOP_KINDS[t.data.kind].color, label: t.kind === 'apt' ? '⌂' : ({ dealer: 'D', perf: 'P', paint: 'R', tuning: 'T', body: 'B' })[t.data.kind] });
    });
    if (onFoot) {
      let cx = car.x, cz = car.z;
      if (cx != null && (all || Math.hypot(cx - px, cz - pz) < 170)) out.push({ x: cx, z: cz, color: '#ff8a3d', label: '🚗' });
    }
    return out;
  }

  // restore the saved paint/parts for whichever car is current
  applyMods();

  return {
    get onFoot() { return onFoot; },
    get modal() { return !!modal; },
    focus() { return onFoot ? foot : car; },
    setDestinations: fn => { extraDest = fn; }, setRaceInfo: fn => { raceInfo = fn; }, setSleepHook: fn => { sleepHook = fn; }, heightAt: hAt, setArena: fn => { arenaH = fn; }, get mode() { return mode; }, get inShop() { return !!modal && modal.kind === 'shop'; }, pocketWall: (x, z) => {
      if (mode !== 'garage' || !cur || !cur.g) return false;
      const p = cur.toL(x, z);
      if (p.x < 0) return !(p.x > -14 && Math.abs(p.z) < RAMP.W / 2 + 4);
      return garageHeight(cur.g.lay, p.x, p.z) == null || rectHit(cur.g.solids, p.x, p.z, 0);
    }, get _dbg() { return { mode, cur, fleet, foot, targets: local.slice() }; },
    carClassInfo: () => { const st = CAR_STYLES.find(c => c.key === car.styleKey) || CAR_STYLES[0]; return carClass(st.cls, modsOf(car.styleKey)); }, persist, spend, cash: () => cash(), modsOf, setFootFrozen: v => { footFrozen = !!v; }, setAvatarVisible: v => { avatar.visible = !!v; },
    shoveFoot: (vx, vz) => { if (!onFoot || mode !== 'city') return; if (Math.hypot(foot.pushX || 0, foot.pushZ || 0) < 3) { foot.pushX = vx; foot.pushZ = vz; if (!shoveT || performance.now() - shoveT > 1500) { shoveT = performance.now(); toast('Watch out!'); } } },
    placeFoot: (x, z, h) => { foot.x = x; foot.z = z; foot.y = hAt(x, z, 0); foot.heading = foot.camH = h; foot.speed = 0; foot.turn = 0; foot.vx = foot.vz = 0; onFoot = true; avatar.visible = true; stepFoot(0); camSnap = true; }, setBlocked: fn => { blockedFn = fn; }, escAt: () => escAt, ownedCars, applyMods, openModal, closeModal, act, updateModal, updateCamera, mapMarkers, beforeCar, save,
    update(dt) {
      stats.secs += dt; if (!onFoot && mode !== 'flat') stats.units += Math.abs(car.speed || 0) * dt; statsT -= dt; if (statsT <= 0) { statsT = 30; persist(); }
      markerAnim(dt);
      driveInShops();
      gatesUpdate(dt);
      updateExempt();
      camHold = Math.max(0, camHold - dt); car.inGarage = mode === 'garage' || camHold > 0;
      if (!onFoot) { const fe = fleet[car.styleKey]; if (fe && fe.since) { delete fe.since; delete fe.fined; } }
      fineT -= dt; if (fineT <= 0) { fineT = 1; checkFines(); }
      if (mode === 'garage' && !onFoot) garageEdge();
      if (mode === 'flat' && cur && flats[cur.a.id]) {
        const F = flats[cur.a.id], hr = env && env.state ? env.state.hour : 12, u = Math.max(0, Math.min(1, (hr - 6) / 12)), ang = Math.PI * u;
        const wx = -60 * Math.cos(ang), wy = -62 * Math.sin(ang), wz = -30, ln = Math.hypot(wx, wy, wz), c = Math.cos(F.th), sn = Math.sin(F.th);
        const dirL = new THREE.Vector3((wx * c - wz * sn) / ln, wy / ln, (wx * sn + wz * c) / ln);
        const wet = env && env.state && (env.state.rain || env.state.snow) ? 0.45 : 1;
        const day = hr > 6 && hr < 18 ? Math.sin(ang) * wet : 0;
        F.L.update(dirL, day, 1 - 0.45 * Math.min(1, day * 1.5));
      }
      if (onFoot && !footFrozen) stepFoot(dt);
      updatePrompt();
      updateCluster();
    },
    // an idle control state for the parked car while its owner walks around
    parkedInput(src) { return { parked: true, forward: false, back: false, left: false, right: false, brake: true, boost: false, steerAxis: 0, throttle: 1, lightsOn: src.lightsOn, blinkerLeft: src.blinkerLeft, blinkerRight: src.blinkerRight }; },
    _dbg: { foot, toFlat, toGarage, activate, get local() { return local; }, openModal, flats, get cur() { return cur; }, get targets() { return targets; }, get stage() { return typeof stage !== "undefined" ? stage : null; } },
    reward(v) { taxi.addCash(v); },
    toast
  };
}
