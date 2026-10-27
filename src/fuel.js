// Fuel: a tank that drains with distance (a full stock tank is 100 km), petrol stations to fill it at, and premium fuel.
//
// - Tank: level 0..1 of the current car's tank; upgrades in the yellow garage make the tank 25 % bigger per stage
//   (range = 100 km x tankMul), so the same level is more fuel and costs more to refill.
// - Stations: eight forecourts built in the city (chicago.js `gasStations`): a canopy over two pump lanes, a price
//   board, a small shop. Stop on a ring (stand still) and choose regular or premium; a full tank takes 10 s.
// - Premium costs 5x and adds 5 % top speed and acceleration for as long as the tank holds it (it mixes with what's left).
// - Price: a full regular tank is about $100, varying by station (-12 % .. +15 %).
import * as THREE from 'three';
import { createGroundGlow, setGlow } from './glow.js';

export const FULL_TANK_KM = 100, FULL_TANK_PRICE = 100, PREMIUM_MUL = 5, PREMIUM_POWER = 0.05, FILL_SECONDS = 10, LITRES = 50;
const UNIT_M = 1.25;

export function createFuel({ city, scene, heightAt, car, world, active = () => true }) {
  const stations = city.gasStations || [];
  const save = (world.save.fuel ||= {});
  const tankMul = () => 1 + 0.25 * ((world.modsOf(car.styleKey).tank) || 0);
  const tank = () => (save[car.styleKey] ||= { lvl: 1, prem: 0 });
  let lowWarn = false, lastKey = null, towAsk = false;
  const colliders = [];

  // ---------------------------------------------------------------- the forecourts
  const tex = (draw, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const white = new THREE.MeshStandardMaterial({ color: 0xeceff3, roughness: 0.7 }), red = new THREE.MeshStandardMaterial({ color: 0xd8262f, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.7, metalness: 0.3 }), concrete = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.95 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1cf });
  const pumpMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }), screenMat = new THREE.MeshBasicMaterial({ color: 0x61e6a0 });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x38e07b, transparent: true, opacity: 0.95, depthWrite: false });
  const discMat = new THREE.MeshBasicMaterial({ color: 0x38e07b, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const ringGeo = new THREE.TorusGeometry(2.3, 0.14, 8, 40), discGeo = new THREE.CircleGeometry(2.3, 40);
  const price = (s, prem) => (2.0 * s.priceMul * (prem ? PREMIUM_MUL : 1));
  const board = s => tex((g, w, h) => {
    g.fillStyle = '#10141c'; g.fillRect(0, 0, w, h); g.fillStyle = '#d8262f'; g.fillRect(0, 0, w, 56);
    g.fillStyle = '#fff'; g.font = 'bold 40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('GAS STATION', w / 2, 30);
    g.textAlign = 'left'; g.font = 'bold 34px system-ui'; g.fillStyle = '#9fb0c6'; g.fillText('REGULAR', 24, 100); g.fillText('PREMIUM', 24, 152);
    g.textAlign = 'right'; g.fillStyle = '#7dffa9'; g.fillText('$' + price(s, false).toFixed(2) + '/L', w - 24, 100); g.fillStyle = '#ffd21f'; g.fillText('$' + price(s, true).toFixed(2) + '/L', w - 24, 152);
    g.textAlign = 'center'; g.font = '600 20px system-ui'; g.fillStyle = '#8796ab'; g.fillText('full tank about $' + Math.round(FULL_TANK_PRICE * s.priceMul), w / 2, 190);
  }, 512, 208);
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
    // price board on a pole by the street
    box(0.5, 9, 0.5, dark, 10.8, 4.5, 3); solid(0.4, 0.4, 10.8, 3);
    const bm = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.6, 0.3), [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ map: board(s) }), new THREE.MeshBasicMaterial({ map: board(s) })]);
    bm.position.set(10.8, 9.4, 3); g.add(bm);
    // shop at the back
    box(15, 4.6, 7.5, white, 0, 2.3, 31.5); box(15.3, 0.9, 7.8, red, 0, 4.7, 31.5); solid(7.6, 3.8, 0, 31.5);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.3), new THREE.MeshBasicMaterial({ map: tex((c, w, h) => { c.fillStyle = '#d8262f'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 74px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('GAS  24H', w / 2, h / 2 + 3); }, 512, 112) }));
    sign.position.set(0, 3.6, 27.68); sign.rotation.y = Math.PI; g.add(sign);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.6), new THREE.MeshBasicMaterial({ color: 0xffe9b0 })); win.position.set(0, 1.9, 27.7); win.rotation.y = Math.PI; g.add(win);
    const glow = createGroundGlow(0xfff1cf, 18, 12); glow.position.set(0, 0.07, 14); setGlow(glow, 0.5); glow.visible = true; g.add(glow); s._glow = glow;
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
    #gaspanel button.prem { background: #ffd21f; color: #2a2100; } #gaspanel button small { display: block; font-weight: 600; opacity: .8; margin-top: 2px; }
    #gaspanel .bar { height: 12px; border-radius: 7px; background: rgba(255,255,255,.14); overflow: hidden; margin: 8px 0 4px; } #gaspanel .bar i { display: block; height: 100%; width: 0; background: #38e07b; }
    #towbtn { position: fixed; left: 50%; top: 22%; transform: translateX(-50%); z-index: 11; display: none; padding: 10px 18px; border: 0; border-radius: 22px; font: 800 14px system-ui; background: #ff3b30; color: #fff; cursor: pointer; }`;
  document.head.appendChild(style);
  const hud = document.createElement('div'); hud.id = 'fuelhud'; hud.innerHTML = '<span>⛽</span><div class="fb"><i></i></div><b class="pc">100%</b><span class="pm"></span>'; document.body.appendChild(hud);
  const hudBar = hud.querySelector('i'), hudPc = hud.querySelector('.pc'), hudPm = hud.querySelector('.pm');
  const panel = document.createElement('div'); panel.id = 'gaspanel'; document.body.appendChild(panel);
  const towBtn = document.createElement('button'); towBtn.id = 'towbtn'; towBtn.textContent = '⛽ Out of fuel - call a tow ($60, T)'; document.body.appendChild(towBtn);

  // ---------------------------------------------------------------- state
  let at = null, fill = null, panelSig = '', fed = 0;
  const cost = (s, x, prem) => FULL_TANK_PRICE * s.priceMul * tankMul() * x * (prem ? PREMIUM_MUL : 1);
  function startFill(prem) { if (!at || fill) return; const t = tank(); if (t.lvl > 0.995) { world.toast('The tank is already full'); return; } fill = { s: at.s, prem, paid: 0, acc: 0 }; }
  function stopFill(why) { if (!fill) return; if (why) world.toast(why); fill = null; panelSig = ''; }
  panel.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.f) startFill(b.dataset.f === 'p'); });
  addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.code === 'Digit1' && at && !fill) startFill(false); else if (e.code === 'Digit2' && at && !fill) startFill(true);
    else if (e.code === 'KeyT' && car.noFuel && !world.onFoot) tow();
  });
  towBtn.addEventListener('click', () => tow());
  function tow() {
    if (!stations.length) return;
    let b = null, bd = 1e12; stations.forEach(s => { const d = (s.x - car.x) ** 2 + (s.z - car.z) ** 2; if (d < bd) { bd = d; b = s; } });
    const f = b.fill[0]; car.teleport(f.x, f.z, heightAt(f.x, f.z, 0), Math.atan2(b.nx, b.nz));
    const t = tank(); t.lvl = 0.06; t.prem = 0; car.noFuel = false;
    if (world.cash() >= 60) { world.spend(60); world.toast('Towed to the nearest gas station ($60)'); } else world.toast('Towed to the nearest gas station');
  }

  function update(dt) {
    const key = car.styleKey;
    if (key !== lastKey) { lastKey = key; fill = null; lowWarn = false; }
    const t = tank(), M = tankMul(), onCity = world.mode === 'city' && !world.onFoot;
    // drain with distance (a full stock tank = 100 km)
    if (onCity && active() && !fill) {
      const km = Math.hypot(car.vx || 0, car.vz || 0) * dt * UNIT_M / 1000;
      t.lvl = Math.max(0, t.lvl - km / (FULL_TANK_KM * M));
    }
    car.noFuel = t.lvl <= 0.0005;
    car.fuelPower = 1 + PREMIUM_POWER * (t.lvl > 0 ? t.prem : 0);
    // near a pump ring?
    at = null;
    if (onCity && !world.modal) {
      for (const s of stations) {
        if (Math.abs(s.x - car.x) > 30 || Math.abs(s.z - car.z) > 30) continue;
        for (let i = 0; i < s.fill.length; i++) { const f = s.fill[i]; if (Math.hypot(f.x - car.x, f.z - car.z) < 2.6 && Math.abs(car.speed) < 1.2) { at = { s, i }; break; } }
        if (at) break;
      }
    }
    if (fill && (!at || at.s !== fill.s)) stopFill('Fuelling stopped - you moved');
    if (fill) {
      const want = Math.min(1 - t.lvl, dt / FILL_SECONDS), c = cost(fill.s, want, fill.prem);
      if (world.cash() + 0.001 < c) { stopFill('Out of cash - fuelling stopped'); }
      else {
        const before = t.lvl; t.lvl += want; t.prem = (t.prem * before + (fill.prem ? want : 0)) / Math.max(1e-6, t.lvl);
        fill.acc += c; fill.paid += c; if (fill.acc >= 1) { const w = Math.floor(fill.acc); world.spend(w); fill.acc -= w; }
        if (t.lvl >= 0.9999) { t.lvl = 1; if (fill.acc > 0) world.spend(Math.max(0, Math.round(fill.acc))); world.toast('Tank full - paid $' + Math.round(fill.paid)); stopFill(); world.persist && world.persist(); }
      }
    }
    // rings pulse; only the ones nearby are shown
    const pul = 1 + Math.sin(performance.now() / 260) * 0.05;
    rings.forEach(r => { const d = Math.hypot(r.position.x - car.x, r.position.z - car.z); r.visible = d < 200 && !world.onFoot; r.scale.setScalar(pul); });
    stations.forEach(s => { if (s._group) s._group.visible = Math.hypot(s.x - car.x, s.z - car.z) < 500; });
    // panel
    let html = '';
    if (at) {
      const s = at.s, rp = Math.round(cost(s, 1 - t.lvl, false)), pp = Math.round(cost(s, 1 - t.lvl, true));
      if (fill) html = `<h3>Fuelling ${fill.prem ? 'premium' : 'regular'}...</h3><div class="sub">Stay still. $${Math.round(fill.paid)} so far</div><div class="bar"><i style="width:${Math.round(t.lvl * 100)}%"></i></div>`;
      else if (t.lvl > 0.995) html = '<h3>Tank full</h3><div class="sub">Drive on.</div>';
      else html = `<h3>Gas station</h3><div class="sub">Tank ${Math.round(t.lvl * 100)} % - a full fill takes 10 s. Stay still while fuelling.</div><div class="btns"><button data-f="r">Regular [1]<small>$${price(s, false).toFixed(2)}/L - $${rp}</small></button><button class="prem" data-f="p">Premium [2]<small>+5% power - $${price(s, true).toFixed(2)}/L - $${pp}</small></button></div>`;
    }
    const sig = html.replace(/\d+ so far|width:\d+%|\d+ %/g, '');
    if (html !== panelSig) { panelSig = html; panel.innerHTML = html; }
    panel.style.display = html ? 'block' : 'none';
    // gauge
    const pc = Math.round(t.lvl * 100);
    hudBar.style.width = pc + '%'; if (hudPc.textContent !== pc + '%') hudPc.textContent = pc + '%';
    hudPm.textContent = t.prem > 0.5 && t.lvl > 0 ? '+5%' : ''; hud.classList.toggle('low', t.lvl < 0.12);
    hud.style.display = world.onFoot || world.mode !== 'city' ? 'none' : 'flex';
    if (t.lvl < 0.15 && !lowWarn) { lowWarn = true; world.toast('Low fuel - find a gas station (⛽ on the map)'); }
    if (t.lvl > 0.3) lowWarn = false;
    towBtn.style.display = car.noFuel && onCity ? 'block' : 'none';
  }

  return {
    update, colliders, stations, tank, tankMul,
    level: () => tank().lvl, premium: () => tank().prem, range: () => Math.round(tank().lvl * FULL_TANK_KM * tankMul()),
    markers: () => stations.map(s => ({ x: s.x, z: s.z, color: '#38e07b', label: '⛽' }))
  };
}
