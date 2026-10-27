// Fuel: a tank measured in litres that drains with distance, gas stations to fill it at, three fuels.
//
// - Tank: 20 L as standard, +5 L for every tank upgrade stage in the yellow garage (a stage 4 tank holds 40 L).
// - Consumption: regular 20 L/100 km, diesel 15 L/100 km, performance (premium) fuel 25 L/100 km.
// - Vans, buses and pickups run on diesel and can only fill diesel; every other car takes regular or premium.
// - Prices per litre: regular about $5, premium 5x that and adds 5 % top speed and acceleration, diesel 20-40 % over regular
//   (each station has its own). A full 20 L tank of regular is about $100.
// - Switching fuel: the tank has to be emptied, so you pay for a full tank of the new fuel. The pump asks first.
// - Stations: eight forecourts (chicago.js `gasStations`): a canopy over the pump lanes, a big price board facing the street, a shop.
import * as THREE from 'three';
import { createGroundGlow, createHalo, setGlow } from './glow.js';

export const BASE_TANK_L = 20, TANK_STEP_L = 5, PRICE_PER_L = 5, PREMIUM_MUL = 5, PREMIUM_POWER = 0.05, FILL_SECONDS = 10;
export const FUELS = { regular: { name: 'Regular', l100: 20 }, premium: { name: 'Performance', l100: 25 }, diesel: { name: 'Diesel', l100: 15 } };
export const DIESEL_STYLES = ['van', 'bus', 'pickup'];
export const dieselMul = s => 1.2 + ((Math.round((s.priceMul || 1) * 1000) * 7919) % 1000) / 1000 * 0.2;    // 1.20 .. 1.40 of the regular price
export const pricePerL = (s, type) => PRICE_PER_L * s.priceMul * (type === 'premium' ? PREMIUM_MUL : type === 'diesel' ? dieselMul(s) : 1);
const UNIT_M = 1.25;

export function createFuel({ city, scene, heightAt, car, world, active = () => true }) {
  const stations = city.gasStations || [];
  const save = (world.save.fuel ||= {});
  const tankL = () => BASE_TANK_L + TANK_STEP_L * ((world.modsOf(car.styleKey).tank) || 0);
  const isDiesel = () => DIESEL_STYLES.includes(car.styleKey);
  const tank = () => {
    const t = (save[car.styleKey] ||= { lvl: 1, type: isDiesel() ? 'diesel' : 'regular' });
    if (!t.type) t.type = t.prem > 0.5 ? 'premium' : 'regular';       // older saves
    if (isDiesel() && t.type !== 'diesel') t.type = 'diesel'; else if (!isDiesel() && t.type === 'diesel') t.type = 'regular';
    return t;
  };
  let lowWarn = false, lastKey = null, towAsk = false, ask = null;
  const colliders = [];

  // ---------------------------------------------------------------- the forecourts
  const tex = (draw, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const white = new THREE.MeshStandardMaterial({ color: 0xeceff3, roughness: 0.7 }), red = new THREE.MeshStandardMaterial({ color: 0xd8262f, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.7, metalness: 0.3 }), concrete = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.95 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfffbf0 }), ledRed = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const pumpMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }), screenMat = new THREE.MeshBasicMaterial({ color: 0x61e6a0 });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x38e07b, transparent: true, opacity: 0.95, depthWrite: false });
  const discMat = new THREE.MeshBasicMaterial({ color: 0x38e07b, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const ringGeo = new THREE.TorusGeometry(2.3, 0.14, 8, 40), discGeo = new THREE.CircleGeometry(2.3, 40);
  // LED price tower like a real one: black slab, coloured fuel bars over big seven-segment style prices, a red 24 h line
  const board = s => tex((g, w, h) => {
    g.fillStyle = '#05070b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2f4f8'; g.font = 'italic 900 44px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('GAS STATION', w / 2, 46);
    const row = (y, name, bar, col, v) => {
      g.fillStyle = bar; g.fillRect(14, y, w - 28, 52); g.fillStyle = '#fff'; g.font = 'bold 40px system-ui'; g.textAlign = 'center'; g.fillText(name, w / 2, y + 28);
      g.shadowColor = col; g.shadowBlur = 18; g.fillStyle = col; g.font = '600 150px "Courier New", monospace'; g.fillText(v.toFixed(2), w / 2 - 10, y + 150);
      g.shadowBlur = 0; g.font = 'bold 34px system-ui'; g.textAlign = 'right'; g.fillText('/L', w - 18, y + 100);
    };
    row(96, 'REGULAR', '#c4202a', '#ff6a63', pricePerL(s, 'regular'));
    row(300, 'DIESEL', '#2f9e3c', '#6dff7a', pricePerL(s, 'diesel'));
    row(504, 'PREMIUM', '#2a57d0', '#7fa6ff', pricePerL(s, 'premium'));
    g.fillStyle = '#f2f4f8'; g.font = 'bold 38px system-ui'; g.textAlign = 'center'; g.fillText('OPEN', w / 2, 724);
    g.shadowColor = '#ff3b30'; g.shadowBlur = 16; g.fillStyle = '#ff5a50'; g.font = '600 96px "Courier New", monospace'; g.fillText('24:00', w / 2, 800);
  }, 512, 880);
  const rings = [];
  stations.forEach(s => {
    const g = new THREE.Group(), y0 = heightAt(s.mx, s.mz, 0);
    g.position.set(s.mx, y0, s.mz); g.rotation.y = Math.atan2(s.nx, s.nz);
    const L = (x, z) => { const c = Math.cos(g.rotation.y), sn = Math.sin(g.rotation.y); return [s.mx + x * c + z * sn, s.mz - x * sn + z * c]; };   // local (x across, z in) -> world
    const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; g.add(b); return b; };
    const solid = (hx, hz, x, z) => colliders.push({ kind: 'parcel', footprint: [[x - hx, z - hz], [x - hx, z + hz], [x + hx, z + hz], [x + hx, z - hz]].map(p => L(p[0], p[1])), blocksCar: true, destructible: false, response: 'bounce', destroyed: false });
    // canopy
    box(17, 0.5, 11.5, white, 0, 5.6, 14); box(17.2, 0.7, 0.3, red, 0, 5.6, 8.1); box(17.2, 0.7, 0.3, red, 0, 5.6, 19.9);
    box(15.6, 0.06, 9.6, lampMat, 0, 5.33, 14);
    [[-7.8, 9.6], [7.8, 9.6], [-7.8, 18.4], [7.8, 18.4]].forEach(([x, z]) => { box(0.7, 5.4, 0.7, white, x, 2.7, z); solid(0.45, 0.45, x, z); });
    // islands + pumps: lanes at x = +-3.4 (between the central island and the outer ones)
    [-6.7, 0, 6.7].forEach(x => {
      box(1.3, 0.22, 8.4, concrete, x, 0.11, 14);
      [-2.1, 2.1].forEach(dz => {
        box(0.75, 1.7, 0.6, pumpMat, x, 1.05, 14 + dz); box(0.5, 0.35, 0.05, screenMat, x, 1.55, 14 + dz + (dz < 0 ? -0.31 : 0.31)); box(0.78, 0.18, 0.62, red, x, 1.95, 14 + dz);
        solid(0.5, 0.42, x, 14 + dz);
      });
    });
    // price towers standing on the ground at the street corners of the forecourt (about 4 m tall), faces square to the street
    // (normal along the street, so a driver coming along the road sees the board head-on from either direction)
    const bmat = new THREE.MeshBasicMaterial({ map: board(s) });
    const TH = 3.2, TW = TH * 512 / 880;
    [-11.6, 11.6].forEach(px => {
      box(0.9, 0.25, TW + 0.5, concrete, px, 0.125, 5.6);
      const bm = new THREE.Mesh(new THREE.BoxGeometry(0.4, TH, TW), [bmat, bmat, dark, dark, dark, dark]);
      bm.position.set(px, 0.25 + TH / 2, 5.6); g.add(bm); solid(0.5, TW / 2 + 0.2, px, 5.6);
      s._boardX = (s._boardX || []).concat(px);
    });
    // a drive-in ramp over the kerb and pavement at the mouth of the forecourt
    { const ramp = new THREE.Mesh(new THREE.BoxGeometry(15, 0.12, 4.4), concrete); ramp.position.set(0, 0.07, -0.4); ramp.rotation.x = -0.05; ramp.receiveShadow = true; g.add(ramp); }
    // shop at the back
    box(15, 4.6, 7.5, white, 0, 2.3, 31.5); box(15.3, 0.9, 7.8, red, 0, 4.7, 31.5); solid(7.6, 3.8, 0, 31.5);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.3), new THREE.MeshBasicMaterial({ map: tex((c, w, h) => { c.fillStyle = '#d8262f'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 74px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('GAS  24H', w / 2, h / 2 + 3); }, 512, 112) }));
    sign.position.set(0, 3.6, 27.68); sign.rotation.y = Math.PI; g.add(sign);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.6), new THREE.MeshBasicMaterial({ color: 0xffe9b0 })); win.position.set(0, 1.9, 27.7); win.rotation.y = Math.PI; g.add(win);
    // night lighting like a real forecourt: a blazing white canopy underside, red LED trim, lit shop window, light pools and halos
    box(17.4, 0.12, 0.12, ledRed, 0, 5.2, 8.0); box(17.4, 0.12, 0.12, ledRed, 0, 5.2, 20.0);
    s._glows = [];
    const addGlow = (color, w, d, x, z, k) => { const gl = createGroundGlow(color, w, d); gl.position.set(x, 0.07, z); g.add(gl); s._glows.push([gl, k]); };
    addGlow(0xfff1cf, 30, 22, 0, 14, 1); addGlow(0xfff1cf, 18, 12, 0, 14, 1); addGlow(0xffe9b0, 16, 10, 0, 24, 0.9); addGlow(0xff4b3a, 14, 6, 0, 3, 0.5);
    s._halos = [];
    [[0, 5.3, 14, 22], [-7.8, 5.3, 14, 10], [7.8, 5.3, 14, 10], [-11.6, 2.2, 5.6, 9], [11.6, 2.2, 5.6, 9], [0, 4.0, 27.2, 10]].forEach(([x, y, z, sz]) => { const hl = createHalo(0xfff1cf, sz); hl.position.set(x, y, z); g.add(hl); s._halos.push(hl); });
    const glow = s._glows[0][0]; s._glow = glow;
    // the fill rings
    s._rings = s.fill.map(f => {
      const r = new THREE.Group(), t = new THREE.Mesh(ringGeo, ringMat), d = new THREE.Mesh(discGeo, discMat);
      t.rotation.x = Math.PI / 2; d.rotation.x = -Math.PI / 2; r.add(t, d);
      r.position.set(f.x, heightAt(f.x, f.z, 0) + 0.12, f.z); r.userData.base = r.position.y; scene.add(r); rings.push(r); return r;
    });
    scene.add(g); s._group = g;
  });

  // ---------------------------------------------------------------- the HUD gauge and the pump panel
  const style = document.createElement('style');
  style.textContent = `
    #fuelhud { position: fixed; right: 16px; bottom: 112px; z-index: 6; display: flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 12px; background: rgba(10,14,22,.72); color: #fff; font: 700 12px system-ui, sans-serif; pointer-events: none; }
    #fuelhud .fb { width: 74px; height: 8px; border-radius: 5px; background: rgba(255,255,255,.14); overflow: hidden; } #fuelhud .fb i { display: block; height: 100%; width: 100%; background: #38e07b; }
    #fuelhud.low { color: #ff6a5c; animation: fl .8s steps(2) infinite; } #fuelhud.low .fb i { background: #ff3b30; } @keyframes fl { 50% { opacity: .35; } }
    #fuelhud .pm { color: #ffd21f; }
    html.touch #fuelhud { bottom: 232px; right: 10px; }
    .cam-inside #dash, .cam-inside #fuelhud { display: none !important; }
    #gaspanel { position: fixed; left: 50%; top: 22%; transform: translateX(-50%); z-index: 11; display: none; width: min(340px, 92vw); padding: 12px 14px; border-radius: 16px; background: rgba(10,14,22,.93); color: #fff; font: 14px system-ui, sans-serif; border-top: 4px solid #38e07b; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
    #gaspanel h3 { margin: 0 0 2px; font-size: 17px; } #gaspanel .sub { color: #9fb0c6; font-size: 12px; margin-bottom: 8px; }
    #gaspanel .btns { display: flex; gap: 8px; } #gaspanel button { flex: 1; border: 0; border-radius: 10px; padding: 10px 6px; font: 800 13px system-ui; cursor: pointer; background: #38e07b; color: #07210f; }
    #gaspanel button.prem { background: #ffd21f; color: #2a2100; } #gaspanel button.dsl { background: #7fd0ff; color: #06202e; } #gaspanel button.keep { background: #3a4660; color: #fff; } #gaspanel button small { display: block; font-weight: 600; opacity: .8; margin-top: 2px; }
    #gaspanel .bar { height: 12px; border-radius: 7px; background: rgba(255,255,255,.14); overflow: hidden; margin: 8px 0 4px; } #gaspanel .bar i { display: block; height: 100%; width: 0; background: #38e07b; }
    #towbtn { position: fixed; left: 50%; top: 22%; transform: translateX(-50%); z-index: 11; display: none; padding: 10px 18px; border: 0; border-radius: 22px; font: 800 14px system-ui; background: #ff3b30; color: #fff; cursor: pointer; }`;
  document.head.appendChild(style);
  const hud = document.createElement('div'); hud.id = 'fuelhud'; hud.innerHTML = '<span>⛽</span><div class="fb"><i></i></div><b class="pc">100%</b><span class="pm"></span>'; document.body.appendChild(hud);
  const hudBar = hud.querySelector('i'), hudPc = hud.querySelector('.pc'), hudPm = hud.querySelector('.pm');
  const panel = document.createElement('div'); panel.id = 'gaspanel'; document.body.appendChild(panel);
  const towBtn = document.createElement('button'); towBtn.id = 'towbtn'; towBtn.textContent = '⛽ Out of fuel - call a tow ($60, T)'; document.body.appendChild(towBtn);

  // ---------------------------------------------------------------- state
  // the tank holds litres (t.l) of one fuel (t.type); t.lvl is the same as a 0..1 fraction of the tank for the gauge
  let at = null, fill = null, panelSig = '', fed = 0, switchAsk = null;
  const cap = () => tankL();
  const litres = () => { const t = tank(); if (t.l === undefined) t.l = Math.min(1, t.lvl === undefined ? 1 : t.lvl) * cap(); t.l = Math.min(t.l, cap()); return t.l; };
  const options = () => (isDiesel() ? ['diesel'] : ['regular', 'premium']);
  const fullPrice = (s, type) => cap() * pricePerL(s, type);
  function startFill(type, paySwitch) {
    if (!at || fill) return;
    const t = tank(), L = litres();
    if (!paySwitch && L > 0.05 && t.type !== type) { switchAsk = { s: at.s, type }; panelSig = ''; return; }     // different fuel than what is in the tank: ask
    if (!paySwitch && L > cap() - 0.05) { world.toast('The tank is already full'); return; }
    if (paySwitch) {
      const c = fullPrice(at.s, type);
      if (world.cash() < c) { world.toast('Switching fuel costs a full tank ($' + Math.round(c) + ') - not enough cash'); switchAsk = null; return; }
      world.spend(Math.round(c)); t.type = type; t.l = 0; world.toast('Tank drained - paid $' + Math.round(c) + ' for a full tank of ' + FUELS[type].name);
      fill = { s: at.s, type, paid: c, acc: 0, free: true };
    } else { t.type = L > 0.05 ? t.type : type; fill = { s: at.s, type: t.type, paid: 0, acc: 0 }; }
    switchAsk = null; panelSig = '';
  }
  function stopFill(why) { if (!fill) return; if (why) world.toast(why); fill = null; panelSig = ''; }
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.f) startFill(b.dataset.f);
    else if (b.dataset.sw) startFill(b.dataset.sw, true);
    else if (b.dataset.keep) { const k = tank().type; switchAsk = null; startFill(k); }
    else if (b.dataset.cancel) { switchAsk = null; panelSig = ''; }
  });
  addEventListener('keydown', e => {
    if (e.repeat) return;
    if (at && !fill && (e.code === 'Digit1' || e.code === 'Digit2')) {
      const i = e.code === 'Digit1' ? 0 : 1;
      if (switchAsk) { if (i === 0) startFill(switchAsk.type, true); else { const k = tank().type; switchAsk = null; startFill(k); } }
      else { const o = options()[i]; if (o) startFill(o); }
    } else if (e.code === 'Escape' && switchAsk) { switchAsk = null; panelSig = ''; }
    else if (e.code === 'KeyT' && car.noFuel && !world.onFoot) tow();
  });
  towBtn.addEventListener('click', () => tow());
  function tow() {
    if (!stations.length) return;
    let b = null, bd = 1e12; stations.forEach(s => { const d = (s.x - car.x) ** 2 + (s.z - car.z) ** 2; if (d < bd) { bd = d; b = s; } });
    const f = b.fill[0]; car.teleport(f.x, f.z, heightAt(f.x, f.z, 0), Math.atan2(b.nx, b.nz));
    const t = tank(); t.l = 0.06 * cap(); car.noFuel = false;
    if (world.cash() >= 60) { world.spend(60); world.toast('Towed to the nearest gas station ($60)'); } else world.toast('Towed to the nearest gas station');
  }

  function update(dt) {
    const key = car.styleKey;
    if (key !== lastKey) { lastKey = key; fill = null; switchAsk = null; lowWarn = false; }
    const t = tank(), C = cap(), onCity = world.mode === 'city' && !world.onFoot;
    let L = litres();
    // drain with distance: litres per 100 km of the fuel in the tank
    if (onCity && active() && !fill) {
      const km = Math.hypot(car.vx || 0, car.vz || 0) * dt * UNIT_M / 1000;
      t.l = L = Math.max(0, L - km * (FUELS[t.type] || FUELS.regular).l100 / 100);
    }
    t.lvl = L / C;
    car.noFuel = L <= 0.01;
    car.fuelPower = 1 + PREMIUM_POWER * (t.type === 'premium' && L > 0.01 ? 1 : 0);
    // near a pump ring?
    at = null;
    if (onCity && !world.modal) {
      for (const s of stations) {
        if (Math.abs(s.x - car.x) > 30 || Math.abs(s.z - car.z) > 30) continue;
        for (let i = 0; i < s.fill.length; i++) { const f = s.fill[i]; if (Math.hypot(f.x - car.x, f.z - car.z) < 2.6 && Math.abs(car.speed) < 1.2) { at = { s, i }; break; } }
        if (at) break;
      }
    }
    if (!at) switchAsk = null;
    if (fill && (!at || at.s !== fill.s)) stopFill('Fuelling stopped - you moved');
    if (fill) {
      const want = Math.min(C - L, dt / FILL_SECONDS * C), c = fill.free ? 0 : want * pricePerL(fill.s, fill.type);
      if (world.cash() + 0.001 < c) { stopFill('Out of cash - fuelling stopped'); }
      else {
        t.l = L += want; t.type = fill.type;
        fill.acc += c; fill.paid += c; if (fill.acc >= 1) { const w = Math.floor(fill.acc); world.spend(w); fill.acc -= w; }
        if (L >= C - 0.001) { t.l = L = C; if (fill.acc > 0) world.spend(Math.max(0, Math.round(fill.acc))); world.toast('Tank full - paid $' + Math.round(fill.paid)); stopFill(); world.persist && world.persist(); }
        t.lvl = L / C;
      }
    }
    // rings pulse; only the ones nearby are shown
    const pul = 1 + Math.sin(performance.now() / 260) * 0.05;
    rings.forEach(r => { const d = Math.hypot(r.position.x - car.x, r.position.z - car.z); r.visible = d < 200 && !world.onFoot; r.scale.setScalar(pul); });
    stations.forEach(s => { if (s._group) s._group.visible = Math.hypot(s.x - car.x, s.z - car.z) < 500; });
    // panel
    let html = '';
    if (at) {
      const s = at.s, lit = n => n.toFixed(1) + ' L';
      if (fill) html = `<h3>Fuelling ${FUELS[fill.type].name}...</h3><div class="sub">Stay still. ${lit(L)} of ${C} L, $${Math.round(fill.paid)} paid</div><div class="bar"><i style="width:${Math.round(L / C * 100)}%"></i></div>`;
      else if (switchAsk) {
        const n = switchAsk.type, o = t.type, price = Math.round(fullPrice(s, n));
        html = `<h3>Switch to ${FUELS[n].name}?</h3><div class="sub">Your tank has ${FUELS[o].name}. To switch it has to be drained and you pay a <b>full tank</b> (${C} L x $${pricePerL(s, n).toFixed(2)} = $${price}).</div><div class="btns"><button class="${n === 'premium' ? 'prem' : ''}" data-sw="${n}">Switch [1]<small>$${price}</small></button><button class="keep" data-keep="1">Keep ${FUELS[o].name} [2]<small>$${pricePerL(s, o).toFixed(2)}/L</small></button></div>`;
      }
      else if (L > C - 0.05) html = '<h3>Tank full</h3><div class="sub">Drive on.</div>';
      else {
        const btn = (o, i) => `<button class="${o === 'premium' ? 'prem' : o === 'diesel' ? 'dsl' : ''}" data-f="${o}">${FUELS[o].name} [${i + 1}]<small>${o === 'premium' ? '+5% power - ' : ''}$${pricePerL(s, o).toFixed(2)}/L - ${(FUELS[o].l100)} L/100km</small></button>`;
        html = `<h3>Gas station</h3><div class="sub">Tank ${lit(L)} of ${C} L (${FUELS[t.type].name}) - a full fill takes 10 s. Stay still while fuelling.${isDiesel() ? ' Diesel engine.' : ''}</div><div class="btns">${options().map(btn).join('')}</div>`;
      }
    }
    if (html !== panelSig) { panelSig = html; panel.innerHTML = html; }
    panel.style.display = html ? 'block' : 'none';
    // gauge: litres left and what is in the tank
    const pc = Math.round(L / C * 100);
    hudBar.style.width = pc + '%';
    const lt = L.toFixed(L < 10 ? 1 : 0) + ' L'; if (hudPc.textContent !== lt) hudPc.textContent = lt;
    hudPm.textContent = !(L > 0) ? '' : t.type === 'premium' ? 'PERF +5%' : t.type === 'diesel' ? 'DIESEL' : ''; hud.classList.toggle('low', t.lvl < 0.12);
    hud.style.display = world.onFoot || world.mode !== 'city' ? 'none' : 'flex';
    if (t.lvl < 0.15 && !lowWarn) { lowWarn = true; world.toast('Low fuel - find a gas station (⛽ on the map)'); }
    if (t.lvl > 0.3) lowWarn = false;
    towBtn.style.display = car.noFuel && onCity ? 'block' : 'none';
  }

  const rangeKm = () => { const t = tank(); return Math.round(litres() / (FUELS[t.type] || FUELS.regular).l100 * 100); };
  return {
    update, colliders, stations, tank, tankL,
    level: () => litres() / cap(), litres, premium: () => (tank().type === 'premium' ? 1 : 0), range: rangeKm,
    markers: () => stations.map(s => ({ x: s.x, z: s.z, color: '#38e07b', label: '⛽' }))
  };
}
