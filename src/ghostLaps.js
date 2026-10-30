// Ghost laps and local leaderboards. During a race the player's path is sampled (8 Hz); when the run beats the
// stored best, it replaces the saved ghost, and the next attempt can race it as a see-through copy of the car that set it.
// Everything lives in localStorage ('gridlock-ghosts-v1': { [raceId]: { best, ghost: {car, t, d:[x*10,z*10,heading*100,...]}, board:[{v,car,when}] } }).
import * as THREE from 'three';
import { buildCarModel } from './carModels.js';

const KEY = 'gridlock-ghosts-v1', HZ = 8, BOARD = 10;
let store = {};
try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { store = {}; }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* storage full or blocked */ } };

export function fmtTime(t) { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); }

export function createGhostLaps({ scene, heightAt, styleName = k => k }) {
  let rec = null, play = null, mesh = null, meshKey = null;

  function ghostMesh(styleKey) {
    if (mesh && meshKey === styleKey) return mesh;
    if (mesh) { scene.remove(mesh); }
    mesh = buildCarModel(styleKey); meshKey = styleKey;
    mesh.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false;
      const mk = m => { const c = m.clone(); c.transparent = true; c.opacity = 0.36; c.depthWrite = false; if (c.emissive) { c.emissive.setHex(0x2f9bff); c.emissiveIntensity = 0.5; } return c; };
      o.material = Array.isArray(o.material) ? o.material.map(mk) : mk(o.material);
    });
    mesh.visible = false; scene.add(mesh); return mesh;
  }

  return {
    // a run starts: begin recording, load the stored ghost for this race (if any)
    start(raceId, styleKey) {
      rec = { id: raceId, car: styleKey, d: [], next: 0 };
      const g = store[raceId] && store[raceId].ghost;
      play = g && g.d && g.d.length >= 9 ? g : null;
      if (play) ghostMesh(play.car);
    },
    // every frame with the race clock t (negative during the countdown)
    tick(t, car) {
      if (!rec) return;
      if (t >= rec.next) { rec.d.push(Math.round(car.x * 10), Math.round(car.z * 10), Math.round(car.heading * 100)); rec.next += 1 / HZ; }
      if (!play || !mesh) return;
      const n = play.d.length / 3, f = Math.max(0, t) * HZ, i = Math.min(n - 1, Math.floor(f)), j = Math.min(n - 1, i + 1), k = f - i;
      if (f > n + HZ) { mesh.visible = false; return; }          // the ghost has finished and left
      const L = (a, b) => a + (b - a) * k;
      const x = L(play.d[i * 3], play.d[j * 3]) / 10, z = L(play.d[i * 3 + 1], play.d[j * 3 + 1]) / 10;
      let h0 = play.d[i * 3 + 2] / 100, h1 = play.d[j * 3 + 2] / 100; while (h1 - h0 > Math.PI) h1 -= 2 * Math.PI; while (h1 - h0 < -Math.PI) h1 += 2 * Math.PI;
      mesh.visible = true; mesh.position.set(x, heightAt(x, z), z); mesh.rotation.y = L(h0, h1);
    },
    // the run ended without finishing
    stop() { rec = null; play = null; if (mesh) mesh.visible = false; },
    // the run finished with `value` (seconds, lower is better - or points when `higher`). Returns what to tell the player.
    finish(raceId, value, { higher = false, styleKey } = {}) {
      const e = store[raceId] ||= { board: [] };
      const better = (a, b) => higher ? a > b : a < b;
      const prev = e.best, isBest = prev == null || better(value, prev);
      e.board.push({ v: Math.round(value * 100) / 100, car: styleName(styleKey || (rec && rec.car)), when: new Date().toISOString().slice(0, 10) });
      e.board.sort((a, b) => higher ? b.v - a.v : a.v - b.v); e.board.length = Math.min(e.board.length, BOARD);
      const rank = e.board.findIndex(x => x.v === Math.round(value * 100) / 100 && x.when === new Date().toISOString().slice(0, 10)) + 1;
      if (isBest && rec && rec.d.length >= 9) { e.best = value; e.ghost = { car: rec.car, t: value, d: rec.d }; }
      else if (isBest) e.best = value;
      persist();
      if (mesh) mesh.visible = false;
      const delta = prev == null ? null : value - prev;
      rec = null; play = null;
      return { rank, isBest, delta, prev };
    },
    hasGhost: id => !!(store[id] && store[id].ghost),
    // HTML for the pre-race menu / results
    boardHtml(raceId, higher = false) {
      const e = store[raceId]; if (!e || !e.board.length) return '<div class="board"><b>Leaderboard</b><div class="brow"><span>No runs yet - set the first time!</span></div></div>';
      const f = v => higher ? Math.round(v).toLocaleString('en-US') + ' pts' : fmtTime(v);
      return '<div class="board"><b>Leaderboard</b>' + e.board.map((x, i) => `<div class="brow"><span>${i + 1}. ${f(x.v)}</span><span>${x.car || ''} &middot; ${x.when}</span></div>`).join('') + (e.ghost ? '<div class="brow"><span>Ghost</span><span>your best run races you</span></div>' : '') + '</div>';
    }
  };
}
