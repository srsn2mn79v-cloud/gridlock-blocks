// Gridlock Blocks Studio: edit the map, races, cars and upgrades. Everything is saved to this browser (localStorage
// 'gridlock-custom-v1'), which the game reads when it starts. Export / import lets you move it between devices.
import { h, clone } from './common.js';
import { loadCustom, saveCustom, CUSTOM_KEY } from '../customData.js';
import DEFAULT_MAP from '../chicago/mapdata.js';
import { setMapData } from '../chicago/map.js';
import { buildChicago } from '../chicago/chicago.js';
import { createMapEditor } from './mapEditor.js';
import { createRaceEditor } from './raceEditor.js';
import { createCarEditor } from './carEditor.js';
import { createUpgradeEditor } from './upgradeEditor.js';

let S = loadCustom(), city = null, cityStale = true, building = false, flags = new Set(), cur = 'map';
const statusEl = h('span', { class: 'status' }), saveBtn = h('button', { class: 'btn pri', onclick: () => save() }, 'Save');
const status = m => { statusEl.textContent = m || ''; };
const ctx = {
  custom: () => S,
  map: () => (S.map ||= clone(DEFAULT_MAP)),
  setMap: m => { S.map = m; cityStale = true; },
  dirty: k => { flags.add(k); if (k === 'map') cityStale = true; saveBtn.textContent = 'Save •'; },
  cityIfBuilt: () => city,
  rebuild: () => rebuild()
};
function rebuild(after) {
  if (building) return; building = true; status('Building the road network from the map...');
  setTimeout(() => {
    try { setMapData(ctx.map()); city = buildChicago(); cityStale = false; status('Road network built: ' + city.roadEdges.length + ' road pieces' + (city.warnings.length ? ', ' + city.warnings.length + ' warning(s)' : '')); }
    catch (e) { console.error(e); status('The map could not be built: ' + e.message); }
    building = false; maps.refresh(); races.refresh(); after && after();
  }, 40);
}
function save() {
  if (S.map && JSON.stringify(S.map) === JSON.stringify(DEFAULT_MAP)) delete S.map;     // unchanged: keep following the game's own map
  try { saveCustom(S); flags.clear(); saveBtn.textContent = 'Save'; status('Saved. Start the game to play with it.'); }
  catch (e) { status('Could not save: ' + e.message); }
}
function exportJson() {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' })), download: 'gridlock-studio.json' }); a.click();
}
function importJson(file) {
  const r = new FileReader();
  r.onload = () => { try { S = JSON.parse(r.result) || {}; cityStale = true; flags.clear(); Object.values(tabs).forEach(t => t.reset ? t.reset() : t.refresh()); status('Imported. Press Save to keep it.'); saveBtn.textContent = 'Save •'; if (cur === 'races') rebuild(); } catch (e) { status('That file is not a Studio export.'); } };
  r.readAsText(file);
}
function resetAll() {
  if (!confirm('Throw away every change (map, races, cars, upgrades) and go back to the original game?')) return;
  try { localStorage.removeItem(CUSTOM_KEY); } catch (e) { /* ignore */ }
  location.reload();
}

const maps = createMapEditor(ctx), races = createRaceEditor(ctx), cars = createCarEditor(ctx), upg = createUpgradeEditor(ctx);
const tabs = { map: maps, races, cars, upgrades: upg };
const NAMES = { map: 'Map', races: 'Races', cars: 'Cars', upgrades: 'Upgrades' };
const nav = h('div', { class: 'tabs' });
function go(k) {
  cur = k; Object.entries(tabs).forEach(([n, t]) => (n === k ? t.show() : t.hide()));
  [...nav.children].forEach(b => b.classList.toggle('on', b.dataset.k === k));
  if (k === 'races' && (cityStale || !city)) rebuild();
}
Object.keys(NAMES).forEach(k => nav.append(h('button', { 'data-k': k, class: 'tab-btn', onclick: () => go(k) }, NAMES[k])));
const fileIn = h('input', { type: 'file', accept: 'application/json', style: 'display:none', onchange: e => e.target.files[0] && importJson(e.target.files[0]) });
const bar = h('header', {}, h('b', { class: 'logo' }, 'Gridlock Studio'), nav, statusEl, h('span', { class: 'sp' }),
  h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Import'), h('button', { class: 'btn', onclick: exportJson }, 'Export'), h('button', { class: 'btn danger', onclick: resetAll }, 'Reset all'), saveBtn,
  h('button', { class: 'btn go', onclick: () => { save(); location.href = './index.html'; } }, 'Save & play ▶'));
document.body.append(bar, h('main', {}, maps.el, races.el, cars.el, upg.el), fileIn);
go('map');
addEventListener('beforeunload', e => { if (flags.size) { e.preventDefault(); e.returnValue = ''; } });
setTimeout(() => rebuild(), 300);       // so the road network is ready for the road overlay and the race editor
window.__studio = { ctx, rebuild, go, S: () => S };
