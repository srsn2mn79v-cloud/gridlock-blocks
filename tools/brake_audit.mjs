//   node tools/check.mjs all
// Exit code 1 if anything fails. Add new checks to CHECKS below.
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = p => import(pathToFileURL(path.join(root, p)).href);

// minimal canvas stub so texture-building code runs under node
const ctx2d = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient') ? () => ({ addColorStop() {} }) : (typeof k === 'string' && k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => ctx2d, width: 0, height: 0, style: {} }) };
let T = 0; performance.now = () => T;

const { buildChicago } = await imp('src/chicago/chicago.js');
const city = buildChicago();
const THREE = await imp('node_modules/three/build/three.module.js');
const { createGroundSampler } = await imp('src/terrain.js');

const heightAt = createGroundSampler(city);
const { createTrafficSystem } = await imp('src/traffic.js');
const { buildTransit } = await imp('src/transit.js'); const transit = buildTransit(city);
const cars = +process.argv[2] || 40, minutes = +process.argv[3] || 4, dt = 1 / 15;
const tr = createTrafficSystem(city, new THREE.Scene(), heightAt, cars, cars, transit);
const player = { x: 9999, z: 9999, y: 0, heading: 0, speed: 0 };
const byNode = {}; city.roadEdges.forEach(e => { (byNode[e.from] ||= []).push(e); (byNode[e.to] ||= []).push(e); });
const prev = new Map(), stat = {};
const tag = (c) => { const e = c.edge; const kind = e.ramp ? 'ramp' : e.type; const deg = (byNode[c.to] || []).length; const near = c.path ? (c.path.length - c.s) : 0;
  const nodeKinds = (byNode[c.to] || []).map(q => q.ramp ? 'R' : q.type[0].toUpperCase()).sort().join(''); return kind + ' -> node deg' + deg + ' [' + nodeKinds + '] ' + (c.conn ? 'inbox' : near < 30 ? 'near' : 'far'); };
const slow = {};
for (let k = 0; k < 15 * 60 * minutes; k++) {
  T += dt * 1000; tr.update(dt, player);
  tr.cars.forEach((c, i) => { if (!c.active || !c.edge) return;
    const p = prev.get(i); prev.set(i, c.speed);
    if ((c.edge.type === 'highway' || c.edge.ramp) && !c.conn && c.speed < 0.6 * c.targetSpeed && c.cause !== 'car') { const kk = (c.edge.ramp ? 'ramp' : 'highway') + ' slow<60% cause=' + (c.cause || '-') + ' ' + (byNode[c.to] || []).length + ' arms'; slow[kk] = (slow[kk] || 0) + 1; }
    if (p != null && p - c.speed > 0.35 && p > 6 && c.cause !== 'curve' || (p != null && p - c.speed > 0.35 && p > 6 && process.env.CURVES)) { // lost > ~5 u/s per second
      const key = tag(c) + ' cause=' + (c.cause || '?');
      stat[key] = (stat[key] || 0) + 1; } });
}
Object.entries(stat).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(String(v).padStart(5), k));

console.log('--- below 60 % of target speed (not behind another car)'); Object.entries(slow).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(String(v).padStart(6), k));
