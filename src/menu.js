// The settings menu: sliders for traffic / pedestrian density, time of day, fog; rain and snow
// switches; and a car picker with a 3D model turning slowly in the middle. The game pauses
// while it's open, but the world keeps rendering behind the (translucent) panel, so time of
// day, fog, rain and snow can be judged live as you drag.
import * as THREE from 'three';
import { CAR_STYLES, buildCarModel } from './carModels.js';
import { zeroTo100, CLASS_COLOR } from './classes.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const STORE = 'gridlock-settings-v1';

const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
// Graphics defaults are gentler on touch devices (no ambient occlusion, medium textures).
export const DEFAULT_SETTINGS = {
  traffic: 40, peds: 100, hour: 22, day: 0, dynWeather: true, clockRun: true, fog: 0, rain: false, snow: false, car: 'hatch', camMode: 'chase', camDist: 9.5, camHeight: 5.2, camInBack: 0.5, camInUp: 0.08,
  ao: coarse ? 'off' : 'low', bloom: true, tone: true, tex: coarse ? 1 : 2, fx: true, shadow: coarse ? 1024 : 2048, quality: coarse ? 'medium' : 'high',
  taxi: true, sound: true, volume: 0.7, swapSticks: false, res: coarse ? 0.75 : 1, view: coarse ? 0.7 : 1, fps: true
};

const PRESETS = {
  low:    { ao: 'off', bloom: false, fx: false, tex: 0, res: 0.75, shadow: 1024 },
  medium: { ao: 'off', bloom: true, fx: true, tex: 1, res: 1, shadow: 2048 },
  high:   { ao: 'low', bloom: true, fx: true, tex: 2, res: 1, shadow: 2048 },
  ultra:  { ao: 'high', bloom: true, fx: true, tex: 2, res: 1, shadow: 4096 }
};
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; }
  catch (e) { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* private mode */ } }

const fmtHour = h => {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
};

export function createMenu({ settings, limits, onChange, onOpenChange , ownedCars, canOpen }) {
  const css = document.createElement('style');
  css.textContent = `
    #menuBtn { position: fixed; top: 12px; right: 64px; z-index: 5; width: 44px; height: 44px; border-radius: 10px;
      border: 0; font-size: 22px; background: rgba(14,18,24,0.72); color: #fff; cursor: pointer; touch-action: manipulation; }
    #menu { position: fixed; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center;
      background: rgba(5,8,12,0.45); font-family: ui-monospace, monospace; color: #e8ecf1; }
    #menu.open { display: flex; }
    #menu .panel { width: min(440px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow-y: auto;
      background: rgba(16,21,28,0.93); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 14px 16px 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
    #menu h2 { margin: 0 0 6px; font-size: 15px; letter-spacing: 2px; text-transform: uppercase; color: #9fb4cc; }
    #menu .carbox { position: relative; display: flex; align-items: center; justify-content: center; }
    #menu canvas.preview { width: 100%; max-width: 340px; height: 170px; border-radius: 10px;
      background: radial-gradient(ellipse at 50% 40%, #2a3644, #12171e); }
    #menu .carname { text-align: center; font-size: 14px; margin: 4px 0 10px; }
    #menu .arrow { position: absolute; top: 50%; transform: translateY(-50%); width: 38px; height: 54px; border: 0;
      border-radius: 8px; background: rgba(255,255,255,0.08); color: #fff; font-size: 20px; cursor: pointer; }
    #menu .arrow.l { left: 0; } #menu .arrow.r { right: 0; }
    #menu .row { display: grid; grid-template-columns: 110px 1fr 56px; align-items: center; gap: 8px; margin: 9px 0; font-size: 13px; }
    #menu .row output { text-align: right; color: #9fb4cc; }
    #menu input[type=range] { width: 100%; accent-color: #4da3ff; }
    #menu .presets { display: flex; gap: 6px; margin: 2px 0 6px 118px; flex-wrap: wrap; }
    #menu .presets button, #menu .toggle, #menu .close { border: 0; border-radius: 8px; padding: 7px 10px; font: inherit; font-size: 12px;
      background: rgba(255,255,255,0.09); color: #e8ecf1; cursor: pointer; }
    #menu .toggles { display: flex; gap: 8px; margin: 10px 0; }
    #menu .toggle { flex: 1; padding: 10px; font-size: 13px; }
    #menu .toggle.on { background: #2f7cf6; }
    #menu .close { width: 100%; padding: 12px; font-size: 14px; background: #2f7cf6; margin-top: 4px; }
    #menu .tabs { display: flex; gap: 6px; margin: 4px 0 8px; }
    #menu .tabs button { flex: 1; border: 0; border-radius: 8px; padding: 8px; font: inherit; font-size: 13px; background: rgba(255,255,255,0.07); color: #cfd8e3; cursor: pointer; }
    #menu .tabs button.on { background: #2f7cf6; color: #fff; }
    #menu .tab[hidden] { display: none; }
    #menu .seg { display: flex; gap: 6px; }
    #menu .seg button { flex: 1; border: 0; border-radius: 8px; padding: 8px 4px; font: inherit; font-size: 12px; background: rgba(255,255,255,0.09); color: #e8ecf1; cursor: pointer; }
    #menu .seg button.on { background: #2f7cf6; }
    #menu .stats { text-align: center; font-size: 11px; color: #8fa2b8; margin: -6px 0 10px; }
    #menu .note { font-size: 11px; color: #7d8ea3; margin: 4px 0 10px; line-height: 1.4; }
    #menu small { display: block; text-align: center; color: #7d8ea3; margin-top: 8px; }
  `;
  document.head.appendChild(css);

  const btn = document.createElement('button');
  btn.id = 'menuBtn'; btn.textContent = '⚙️'; btn.tabIndex = -1; btn.setAttribute('aria-label', 'Settings');
  document.body.appendChild(btn);

  const root = document.createElement('div');
  root.id = 'menu';
  root.innerHTML = `
    <div class="panel">
      <h2>Settings</h2>
      <div class="tabs"><button data-tab="game" class="on">Game</button><button data-tab="gfx">Graphics</button><button data-tab="save">Save</button></div>
      <div class="tab" data-tab="game">
      <div class="carbox">
        <button class="arrow l" data-d="-1">◀</button>
        <canvas class="preview" width="680" height="340"></canvas>
        <button class="arrow r" data-d="1">▶</button>
      </div>
      <div class="carname"></div>
      <div class="stats"></div>
      <div class="row"><label>Traffic</label><input type="range" data-k="traffic" min="0" max="${limits.traffic}" step="1"><output></output></div>
      <div class="row"><label>Pedestrians</label><input type="range" data-k="peds" min="0" max="${limits.peds}" step="1"><output></output></div>
      <div class="row"><label>Time of day</label><input type="range" data-k="hour" min="0" max="24" step="0.1"><output></output></div>
      <div class="presets">
        <button data-h="7.6">Morning</button><button data-h="12">Day</button><button data-h="18.4">Evening</button><button data-h="22">Night</button>
      </div>
      <div class="row"><label>Fog</label><input type="range" data-k="fog" min="0" max="1" step="0.01"><output></output></div>
      <div class="toggles">
        <button class="toggle" data-t="dynWeather">🌦 Dynamic weather</button>
        <button class="toggle" data-t="clockRun">⏱ Clock running</button>
        <button class="toggle" data-t="rain">🌧 Rain</button>
        <button class="toggle" data-t="snow">❄️ Snow</button>
        <button class="toggle" data-t="sound">🔊 Sound</button>
      </div>
      <div class="toggles"><button class="toggle" data-t="swapSticks">🎮 Swap thumbsticks (on foot: camera left, move right)</button></div>
      <div class="row"><label>Volume</label><input type="range" data-k="volume" min="0" max="1" step="0.01"><output></output></div>
      </div>
      <div class="tab" data-tab="gfx" hidden>
        <div class="row" style="grid-template-columns:110px 1fr"><label>Quality preset</label>
          <div class="seg" data-seg="quality"><button data-v="low">Low</button><button data-v="medium">Medium</button><button data-v="high">High</button><button data-v="ultra">Ultra</button></div></div>
        <div class="row" style="grid-template-columns:110px 1fr"><label>Shadow detail</label>
          <div class="seg" data-seg="shadow"><button data-v="1024">Low</button><button data-v="2048">Medium</button><button data-v="4096">High</button></div></div>
        <div class="row" style="grid-template-columns:110px 1fr"><label>Ambient occlusion</label>
          <div class="seg" data-seg="ao"><button data-v="off">Off</button><button data-v="low">Low</button><button data-v="high">High</button></div></div>
        <div class="row" style="grid-template-columns:110px 1fr"><label>Texture quality</label>
          <div class="seg" data-seg="tex"><button data-v="0">Low</button><button data-v="1">Medium</button><button data-v="2">High</button></div></div>
        <div class="row" style="grid-template-columns:110px 1fr"><label>Resolution</label>
          <div class="seg" data-seg="res"><button data-v="0.5">50%</button><button data-v="0.75">75%</button><button data-v="1">100%</button></div></div>
        <div class="row" style="grid-template-columns:110px 1fr"><label>View distance</label>
          <div class="seg" data-seg="view"><button data-v="0.4">Short</button><button data-v="0.7">Medium</button><button data-v="1">Long</button></div></div>
        <div class="toggles">
          <button class="toggle" data-t="fps">📊 FPS</button>
          <button class="toggle" data-t="bloom">✨ Bloom</button>
          <button class="toggle" data-t="tone">🎞 Tone mapping</button>
          <button class="toggle" data-t="fx">🎬 Cinematic FX (sun shafts, speed blur, grade)</button>
        </div>
        <div class="note">Ambient occlusion is the heaviest option - leave it Off or Low on a phone. Texture quality changes the asphalt, ground and building-window detail. Bloom adds the glow around lights.</div>
      </div>
      <div class="tab" data-tab="save" hidden>
        <div class="note" id="saveInfo"></div>
        <div class="toggles"><button class="toggle" id="saveExport">⬇️ Download backup</button><button class="toggle" id="saveImport">⬆️ Load backup</button></div>
        <input type="file" id="saveFile" accept="application/json,.json" hidden>
        <div class="toggles"><button class="toggle" id="saveReset">🗑 Start over (erase progress)</button></div>
        <div class="note" id="saveMsg"></div>
        <div class="note">The game saves by itself every time you buy something, finish a race or earn money. The save lives in this browser on this device: the Safari tab and the home-screen app each keep their own, and clearing website data deletes it. Download a backup to move your progress to another device or keep it safe.</div>
      </div>
      <div class="toggles"><button class="toggle" id="openStudio">🛠 Studio: edit the map, races, cars and upgrades</button></div>
      <button class="close">Resume</button>
      <small>M or Esc toggles this menu</small>
    </div>`;
  document.body.appendChild(root);

  const $ = s => root.querySelector(s);
  const outFmt = {
    traffic: v => v, peds: v => v, hour: fmtHour, fog: v => Math.round(v * 100) + '%', volume: v => Math.round(v * 100) + '%'
  };
  function refresh() {
    root.querySelectorAll('input[type=range]').forEach(inp => {
      const k = inp.dataset.k;
      inp.value = settings[k];
      inp.nextElementSibling.textContent = outFmt[k](Number(settings[k]));
    });
    root.querySelectorAll('.toggle').forEach(b => b.classList.toggle('on', !!settings[b.dataset.t]));
    const cs = CAR_STYLES.find(c => c.key === settings.car) || CAR_STYLES[0];
    $('.carname').textContent = cs.name;
    $('.stats').innerHTML = `<b style="color:${CLASS_COLOR[cs.cls]}">Class ${cs.cls}</b> · Top ${Math.round(cs.maxSpeed * 6.2)} km/h · 0-100 ≈ ${zeroTo100(cs.accel, cs.maxSpeed, cs.mass).toFixed(1)} s · ${cs.mass} kg`;
    root.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(settings[seg.dataset.seg]) === b.dataset.v)));
  }
  function set(k, v) {
    settings[k] = v;
    // choosing rain / snow / fog by hand takes the weather off the forecast; turning "Dynamic weather" on hands it back
    if ((k === 'rain' || k === 'snow') && settings.dynWeather) { settings.dynWeather = false; onChange('dynWeather', false); }
    if (k === 'fog' && settings.dynWeather) { settings.dynWeather = false; onChange('dynWeather', false); }
    // rain and snow are mutually exclusive
    const other = k === 'rain' ? 'snow' : k === 'snow' ? 'rain' : null;
    if (v && other && settings[other]) { settings[other] = false; onChange(other, false); }
    saveSettings(settings);
    refresh();
    onChange(k, v);
  }

  root.querySelectorAll('input[type=range]').forEach(inp => {
    inp.addEventListener('input', () => set(inp.dataset.k, Number(inp.value)));
  });
  root.querySelectorAll('.presets button').forEach(b => b.addEventListener('click', () => set('hour', Number(b.dataset.h))));
  root.querySelectorAll('.toggle').forEach(b => b.addEventListener('click', () => set(b.dataset.t, !settings[b.dataset.t])));
  root.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const k = seg.dataset.seg;
    if (k === 'quality') { const P = PRESETS[b.dataset.v]; Object.keys(P).forEach(pk => set(pk, P[pk])); set('quality', b.dataset.v); return; }
    set(k, (k === 'tex' || k === 'res' || k === 'view' || k === 'shadow') ? Number(b.dataset.v) : b.dataset.v);
    if (k !== 'quality' && ['ao', 'tex', 'res', 'shadow'].includes(k)) set('quality', 'custom');
  })));
  root.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    root.querySelectorAll('.tab').forEach(t => { t.hidden = t.dataset.tab !== b.dataset.tab; });
  }));
  // ---- save / backup -------------------------------------------------------------------------------
  const saveKeys = () => { const k = []; try { for (let i = 0; i < localStorage.length; i++) { const n = localStorage.key(i); if (n && (n.startsWith('gridlock'))) k.push(n); } } catch (e) { /* private mode */ } return k; };
  function saveInfo() {
    let w = {}; try { w = JSON.parse(localStorage.getItem('gridlock.world') || '{}'); } catch (e) { /* ignore */ }
    const cash = Number(localStorage.getItem('gridlock.cash') || 0), races = Object.keys(w.races || {}).filter(k => (w.races[k] || {}).plays).length;
    $('#saveInfo').textContent = `Saved: $${cash.toLocaleString('en-US')} · ${(w.bought || []).length + 1} car(s) · ${Object.keys(w.apts || {}).length} apartment(s) · ${races} race(s) played`;
  }
  const $s = id => root.querySelector(id);
  $s('#saveExport').addEventListener('click', () => {
    const data = { game: 'gridlock-blocks', version: 1, saved: new Date().toISOString(), keys: {} };
    saveKeys().forEach(k => { data.keys[k] = localStorage.getItem(k); });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = 'gridlock-save-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove();
    $s('#saveMsg').textContent = 'Backup downloaded.';
  });
  $s('#saveImport').addEventListener('click', () => $s('#saveFile').click());
  $s('#saveFile').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => {
      const d = JSON.parse(t); if (d.game !== 'gridlock-blocks' || !d.keys) throw new Error('not a Gridlock save');
      Object.keys(d.keys).forEach(k => { if (k.startsWith('gridlock') && typeof d.keys[k] === 'string') localStorage.setItem(k, d.keys[k]); });
      $s('#saveMsg').textContent = 'Backup loaded - restarting...'; setTimeout(() => location.reload(), 600);
    }).catch(err => { $s('#saveMsg').textContent = 'Could not load that file: ' + err.message; });
    e.target.value = '';
  });
  let resetArmed = 0;
  $s('#saveReset').addEventListener('click', () => {
    if (!resetArmed || Date.now() - resetArmed > 5000) { resetArmed = Date.now(); $s('#saveMsg').textContent = 'Tap "Start over" again within 5 seconds to erase your money, cars and race progress.'; return; }
    saveKeys().filter(k => k !== STORE).forEach(k => localStorage.removeItem(k)); location.reload();
  });
  root.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'save') saveInfo(); }));
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* ignore */ }

  root.querySelectorAll('.arrow').forEach(b => b.addEventListener('click', () => {
    const list = ownedCars ? ownedCars() : CAR_STYLES.map(c => c.key);
    const i = Math.max(0, list.indexOf(settings.car));
    const key = list[(i + Number(b.dataset.d) + list.length) % list.length];
    showCar(key);
    set('car', key);
  }));
  $('.close').addEventListener('click', () => close());
  $('#openStudio').addEventListener('click', () => { location.href = './studio.html'; });
  root.addEventListener('pointerdown', e => { if (e.target === root) close(); });

  // ---- 3D preview: its own tiny renderer + scene, only drawn while the menu is open ----
  const canvas = $('canvas.preview');
  let renderer = null, pScene = null, pCam = null, pivot = null, raf = 0, last = 0;
  function initPreview() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(680, 340, false);
    pScene = new THREE.Scene();
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    pScene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    pScene.environmentIntensity = 0.6;
    pCam = new THREE.PerspectiveCamera(34, 2, 0.1, 50);
    pCam.position.set(0, 2.6, 7.2); pCam.lookAt(0, 0.8, 0);
    pScene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a2622, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 7, 5); pScene.add(key);
    const rim = new THREE.DirectionalLight(0x7aa8ff, 0.8); rim.position.set(-5, 3, -4); pScene.add(rim);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.06, 40), new THREE.MeshStandardMaterial({ color: 0x2b3442, roughness: 0.8 }));
    disc.position.y = -0.03; pScene.add(disc);
    pivot = new THREE.Group(); pScene.add(pivot);
  }
  function showCar(key) {
    initPreview();
    while (pivot.children.length) pivot.remove(pivot.children[0]);
    pivot.add(buildCarModel(key));
  }
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    pivot.rotation.y += dt * 0.9;
    renderer.render(pScene, pCam);
  }

  let isOpen = false;
  function open() {
    if (isOpen) return;
    isOpen = true;
    root.classList.add('open');
    showCar(settings.car);
    refresh();
    last = performance.now(); raf = requestAnimationFrame(loop);
    onOpenChange(true);
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('open');
    cancelAnimationFrame(raf);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    onOpenChange(false);
  }
  const toggle = () => (isOpen ? close() : open());
  btn.addEventListener('click', () => { toggle(); btn.blur(); });
  addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.code === 'Escape') { if (isOpen) close(); else if (!(canOpen && !canOpen())) toggle(); }
  });

  refresh();
  return { open, close, toggle, isOpen: () => isOpen, refresh, set };
}
