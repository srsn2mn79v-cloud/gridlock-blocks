// Street races: drag (straight line), drift (score in a zone), circuit (one lap of the city through checkpoints) and
// sprint (a one-off path from A to B). Start gates stand on the street, every race has a pin on the map, and the top
// three get $5000 / $3000 / $1500. Opponents are real cars in the traffic that follow the route: they bump you and the traffic, and brake and swerve for what is ahead.
// The route generator is plain data + the road graph, so tools/check.mjs can run it in node (see `planRaces`).
import * as THREE from 'three';

import { CLASS_REF_SPEED, CLASS_PRIZE_MUL, CLASS_ORDER, CLASS_COLOR, classIndex } from './classes.js';
const PRIZES = [5000, 3000, 1500];
export const RACE_KINDS = {
  drag:    { name: 'Drag',    color: '#ff4d4d', hex: 0xff4d4d, label: 'DR', desc: 'Straight line, fastest to the line' },
  drift:   { name: 'Drift',   color: '#ff9f1c', hex: 0xff9f1c, label: 'DF', desc: 'Slide for points: long, fast, big angle' },
  circuit: { name: 'Circuit', color: '#3b82f6', hex: 0x3b82f6, label: 'CI', desc: 'A closed loop through checkpoints; the start line is the finish line' },
  sprint:  { name: 'Sprint',  color: '#2ee66b', hex: 0x2ee66b, label: 'SP', desc: 'One path from A to B through checkpoints' }
};

function mulberry(seed) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- planning (no three.js, runs in node) -----------------------------------------------------------------------------------
import { loadCustom } from './customData.js';
import { LAKES, RIVERS } from './chicago/map.js';
import { makeRouter, raceFromDef } from './routeTool.js';
export function planRaces(city, districtName = () => 'City', transit = null) {
  const nodes = city.roadNodes, edges = city.roadEdges, rand = mulberry(7781);
  const usable = e => e.structure !== 'tunnel' && !e.ramp;
  const adj = {};
  edges.forEach(e => {
    if (!usable(e)) return;
    const a = nodes[e.from], b = nodes[e.to], len = Math.hypot(a.x - b.x, a.z - b.z);
    (adj[e.from] ||= []).push({ to: e.to, len, e });
    if (!e.oneWay) (adj[e.to] ||= []).push({ to: e.from, len, e });
  });
  const flat = id => nodes[id].elevation < 0.5;
  function path(from, to) {            // Dijkstra over the drivable graph
    const dist = { [from]: 0 }, prev = {}, done = new Set();
    for (;;) {
      let u = null, best = Infinity;
      for (const n in dist) if (!done.has(n) && dist[n] < best) { best = dist[n]; u = n; }
      if (u === null || u === to) break;
      done.add(u);
      (adj[u] || []).forEach(({ to: v, len }) => { if (dist[u] + len < (dist[v] ?? Infinity)) { dist[v] = dist[u] + len; prev[v] = u; } });
    }
    if (dist[to] === undefined) return null;
    const out = [to]; for (let n = to; n !== from; n = prev[n]) out.unshift(prev[n]);
    return out;
  }
  const polyOf = ids => { const pts = []; ids.forEach(id => { const p = [nodes[id].x, nodes[id].z]; const l = pts[pts.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 0.5) pts.push(p); }); return pts; };
  const lenOf = pts => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
  const ids = Object.keys(nodes);
  const deg = {}; edges.forEach(e => { if (usable(e)) { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; } });
  const hubs = ids.filter(id => flat(id) && (deg[id] || 0) >= 3 && adj[id] && adj[id].some(a => a.e.type !== 'highway'));
  const nearestHub = (x, z, within = 90) => { let b = null, bd = within; hubs.forEach(id => { const d = Math.hypot(nodes[id].x - x, nodes[id].z - z); if (d < bd) { bd = d; b = id; } }); return b; };
  const races = [], starts = [];
  // race gates keep well clear of anything you can walk/drive into (apartment doors + garage gates, shops, agents)
  const keepOut = [];
  (city.apartments || []).forEach(a => { keepOut.push([a.door.x, a.door.z]); if (a.gate) keepOut.push([a.gate.x, a.gate.z]); });
  (city.shops || []).forEach(sh => keepOut.push([sh.door.x, sh.door.z]));
  (city.agents || []).forEach(ag => keepOut.push([ag.door.x, ag.door.z]));
  (city.stores || []).forEach(st => keepOut.push([st.door.x, st.door.z]));
  if (transit) { transit.stands.forEach(q => keepOut.push([q.x, q.z])); if (transit.depot) keepOut.push([transit.depot.x, transit.depot.z]); }
  const clearOfDoors = (x, z) => keepOut.every(k => Math.hypot(k[0] - x, k[1] - z) > 55);
  const farFromOthers = (x, z, d = 260) => clearOfDoors(x, z) && starts.every(s => Math.hypot(s[0] - x, s[1] - z) > d);
  const ptAt = (pts, s) => { let acc = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc + l >= s || i === pts.length - 1) { const t = Math.min(1, (s - acc) / (l || 1)); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; } acc += l; } return pts[pts.length - 1]; };
  const checkpointsFor = (pts, every) => { const L = lenOf(pts), n = Math.max(5, Math.round(L / every)), out = []; for (let k = 1; k <= n; k++) out.push(ptAt(pts, L * k / n)); return out; };
  const label = (x, z) => districtName(x, z);

  // --- drag: the straightest long runs of wide road -------------------------------------------------------------------------
  const cand = [];
  edges.forEach(e => {
    if (!usable(e) || e.width < 15 || e.structure === 'bridge') return;
    [[e.from, e.to], ...(e.oneWay ? [] : [[e.to, e.from]])].forEach(([a, b]) => {
      if (!flat(a) || !flat(b)) return;
      let pts = [[nodes[a].x, nodes[a].z], [nodes[b].x, nodes[b].z]], cur = b, prevN = a, total = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), guard = 0;
      const dir0 = [(pts[1][0] - pts[0][0]) / total, (pts[1][1] - pts[0][1]) / total];
      while (total < 470 && guard++ < 14) {
        let best = null, bd = 0.985;
        (adj[cur] || []).forEach(o => {
          if (o.to === prevN || o.e.width < 15 || o.e.structure === 'bridge' || !flat(o.to)) return;
          const dx = nodes[o.to].x - nodes[cur].x, dz = nodes[o.to].z - nodes[cur].z, l = Math.hypot(dx, dz) || 1;
          const c = (dx / l) * dir0[0] + (dz / l) * dir0[1];
          if (c > bd) { bd = c; best = o; }
        });
        if (!best) break;
        pts.push([nodes[best.to].x, nodes[best.to].z]); total += best.len; prevN = cur; cur = best.to;
      }
      if (total >= 330) cand.push({ pts, total, e });
    });
  });
  cand.sort((a, b) => (b.e.oneWay ? 1 : 0) - (a.e.oneWay ? 1 : 0) || b.total - a.total);
  const dragStarts = [];
  cand.forEach(c => {
    if (dragStarts.length >= 3) return;
    const mx = c.pts[0][0], mz = c.pts[0][1];
    if (dragStarts.some(s => Math.hypot(s[0] - mx, s[1] - mz) < 500) || !clearOfDoors(mx, mz)) return;
    dragStarts.push([mx, mz]);
    const L = Math.min(c.total, 420);
    // start 14 u in so the gate stands on plain road, then run L
    const pts = [ptAt(c.pts, 14), ...c.pts.slice(1)].filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1);
    races.push({ kind: 'drag', id: 'drag' + races.length, name: label(mx, mz) + ' Drag', pts, length: Math.min(lenOf(pts), L), width: c.e.width, checkpoints: [] });
    starts.push([mx, mz]);
  });

  // --- circuits: a loop through three waypoints around a start hub ---------------------------------------------------------------
  const order = hubs.slice().sort(() => rand() - 0.5);
  let nC = 0;
  for (const h of order) {
    if (nC >= 3) break;
    const s = nodes[h]; if (!farFromOthers(s.x, s.z, 250) || !clearOfDoors(s.x, s.z)) continue;
  for (let attempt = 0; attempt < 150; attempt++) {
    const R = 200 + rand() * 160, a0 = rand() * Math.PI * 2, wp = [], nWp = 3 + (rand() < 0.4 ? 1 : 0);
    for (let k = 0; k < nWp; k++) {
      const a = a0 + k * (Math.PI * 2 / nWp) + (rand() - 0.5) * 0.5;
      const n = nearestHub(s.x + Math.cos(a) * R, s.z + Math.sin(a) * R, 130);
      if (n && n !== h && !wp.includes(n)) wp.push(n);
    }
    if (wp.length < nWp) continue;
    const legs = [h, ...wp, h]; let ids2 = [h], ok = true;
    for (let i = 1; i < legs.length && ok; i++) { const p = path(legs[i - 1], legs[i]); if (!p) ok = false; else ids2 = ids2.concat(p.slice(1)); }
    if (!ok) continue;
    // a true loop never uses the same street twice (no turning back on yourself)
    const used = new Set(); let reuse = false;
    for (let i = 1; i < ids2.length; i++) { const k = ids2[i - 1] < ids2[i] ? ids2[i - 1] + '|' + ids2[i] : ids2[i] + '|' + ids2[i - 1]; if (used.has(k)) reuse = true; used.add(k); }
    if (reuse) continue;
    const P = polyOf(ids2), L = lenOf(P);
    if (L < 700 || L > 3300) continue;
    // the start/finish line sits 50 u before the hub on the closing stretch, so the lap simply carries on through it
    const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const cut = L - 50; let k = 0; while (k < P.length - 2 && cum[k + 1] <= cut) k++;
    const S = ptAt(P, cut);
    const pts = [S, ...P.slice(k + 1), ...P.slice(1, k + 1), S].filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1);
    races.push({ kind: 'circuit', id: 'circuit' + nC, name: label(s.x, s.z) + ' Circuit', pts, length: L, width: 16, checkpoints: checkpointsFor(pts, 150), lap: true, laps: 2 });
    starts.push([S[0], S[1]]); nC++; break;
  }
  }

  // --- sprints: far apart ends, one shortest path --------------------------------------------------------------------------------
  let nS = 0;
  for (const h of order.slice().reverse()) {
    if (nS >= 3) break;
    const s = nodes[h]; if (!farFromOthers(s.x, s.z, 300)) continue;
    for (let tries = 0; tries < 24; tries++) {
      const a = rand() * Math.PI * 2, D = 1000 + rand() * 700;
      const e = nearestHub(s.x + Math.cos(a) * D, s.z + Math.sin(a) * D, 90);
      if (!e || e === h) continue;
      const p = path(h, e); if (!p) continue;
      const pts = polyOf(p), L = lenOf(pts);
      if (L < 1000 || L > 2900) continue;
      races.push({ kind: 'sprint', id: 'sprint' + nS, name: label(s.x, s.z) + ' Sprint', pts, length: L, width: 16, checkpoints: checkpointsFor(pts, 140) });
      starts.push([s.x, s.z]); nS++; break;
    }
  }

  // --- drift events: a gate at a junction; the event itself runs on one of the three circuits outside the city (driftTrack.js) ----
  const TRACKS = [['rect', 'Block Loop'], ['esses', 'Serpent'], ['tri', 'Delta']];
  const wide = hubs.filter(id => adj[id].some(a => a.e.width >= 16)).sort(() => rand() - 0.5);
  const rest = hubs.filter(id => !wide.includes(id)).sort(() => rand() - 0.5);
  let nD = 0;
  for (const gap of [260, 160, 90]) {
    for (const h of wide.concat(rest)) {
      if (nD >= TRACKS.length) break;
      const s = nodes[h]; if (!farFromOthers(s.x, s.z, gap) || races.some(r => r.kind === 'drift' && Math.hypot(r.zone.x - s.x, r.zone.z - s.z) < gap)) continue;
      const dir = adj[h][0], o = nodes[dir.to], l = Math.hypot(o.x - s.x, o.z - s.z) || 1;
      races.push({ kind: 'drift', id: 'drift' + nD, track: TRACKS[nD][0], name: TRACKS[nD][1] + ' Drift', pts: [[s.x, s.z], [s.x + (o.x - s.x) / l * 8, s.z + (o.z - s.z) / l * 8]], length: 0, width: 16, checkpoints: [], zone: { x: s.x, z: s.z, r: 20 }, timeLimit: 90 });
      starts.push([s.x, s.z]); nD++;
    }
  }
  // races made in the Studio (checkpoints joined by the shortest road route)
  const customDefs = loadCustom().races;
  if (Array.isArray(customDefs) && customDefs.length) { const router = makeRouter(nodes, edges); customDefs.forEach(def => { try { const cr = raceFromDef(def, router); if (cr) races.push(cr); } catch (e) { console.warn('custom race skipped', e); } }); }
  // difficulty class: F (easier, slower rivals, smaller purse) and E (faster rivals, bigger purse) alternate within each kind
  const seen = {};
  races.forEach(r => { if (r.custom) return; seen[r.kind] = (seen[r.kind] || 0); r.cls = seen[r.kind]++ % 2 === 0 ? 'F' : 'E'; });
  return races;
}

// ---- the game side ---------------------------------------------------------------------------------------------------------------------
export function createRaces({ city, scene, heightAt, car, world, districtName, transit = null, arena = null, collisionWorld = null, tune = null, gearbox = null }) {
  const plan = planRaces(city, districtName, transit);
  const save = (world.save.races ||= {});
  const persist = () => world.persist && world.persist();
  const ptAt = (pts, s) => {
    if (s <= 0) { const dx = pts[1][0] - pts[0][0], dz = pts[1][1] - pts[0][1], l = Math.hypot(dx, dz) || 1; return { x: pts[0][0] + dx / l * s, z: pts[0][1] + dz / l * s, dx: dx / l, dz: dz / l }; }
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1], l = Math.hypot(dx, dz) || 1;
      if (acc + l >= s || i === pts.length - 1) { const t = (s - acc) / l; return { x: pts[i - 1][0] + dx * t, z: pts[i - 1][1] + dz * t, dx: dx / l, dz: dz / l }; }
      acc += l;
    }
  };
  plan.forEach(r => {
    r.cum = [0]; for (let i = 1; i < r.pts.length; i++) r.cum.push(r.cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    if (r.kind === 'drag') r.length = Math.min(r.length, r.cum[r.cum.length - 1]);
    const s0 = ptAt(r.pts, 0); r.start = { x: s0.x, z: s0.z, dx: s0.dx, dz: s0.dz, heading: Math.atan2(s0.dx, s0.dz) };
    if (r.kind === 'drift') r.start = { x: r.zone.x, z: r.zone.z, dx: s0.dx, dz: s0.dz, heading: Math.atan2(s0.dx, s0.dz) };
    r.cpS = r.cpSfix ? r.cpSfix.slice() : r.checkpoints.map(p => { let bs = 0, bd = 1e9; for (let i = 1; i < r.pts.length; i++) { const ax = r.pts[i - 1][0], az = r.pts[i - 1][1], bx = r.pts[i][0], bz = r.pts[i][1], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1; const t = Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - az) * (bz - az)) / l2)); const d = Math.hypot(p[0] - ax - (bx - ax) * t, p[1] - az - (bz - az) * t); if (d < bd) { bd = d; bs = r.cum[i - 1] + (r.cum[i] - r.cum[i - 1]) * t; } } return bs; });
  });

  // ---- gates in the street ----------------------------------------------------------------------------------------------------
  const labelTex = (text, color) => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 512, 128);
    g.fillStyle = 'rgba(255,255,255,.18)'; for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) g.fillRect(i * 32, j * 8, 32, 8);
    g.fillStyle = '#fff'; g.font = 'bold 74px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.4 });
  plan.forEach(r => {
    const K = RACE_KINDS[r.kind], gate = new THREE.Group(), hw = Math.min(r.width / 2 + 1.1, 13);
    const px = -r.start.dz, pz = r.start.dx;      // across the track
    // local z runs down the track, local x across it
    // no poles: the banner floats high above the road, so nothing is in the way when you drive past
    const face = new THREE.MeshBasicMaterial({ map: labelTex(K.name.toUpperCase() + (r.kind === 'drift' ? ' CIRCUIT' : ' RACE'), K.color) });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 1.7, 0.18), [postMat, postMat, postMat, postMat, face, face]);
    banner.position.set(0, 8.2, 0); gate.add(banner);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.22, 10, 28), new THREE.MeshBasicMaterial({ color: K.hex }));
    ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.25, 0); gate.add(ring);
    gate.rotation.y = Math.atan2(r.start.dx, r.start.dz);
    gate.position.set(r.start.x, heightAt(r.start.x, r.start.z), r.start.z);
    scene.add(gate); r.gate = gate;
    r.solids = [];
  });

  // ---- checkpoint rings / ghost cars ---------------------------------------------------------------------------------------------
  const cpMat = (hex, op) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: op, depthWrite: false });
  const rings = [0, 1].map(i => { const m = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.38, 10, 32), cpMat(i ? 0xffffff : 0xffd21f, i ? 0.35 : 0.9)); m.visible = false; scene.add(m); return m; });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 160, 10, 1, true), cpMat(0xffd21f, 0.4)); beacon.visible = false; scene.add(beacon);
  // a glowing guide strip laid on the road from you to the next checkpoint
  const GN = 72, guide = (() => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GN * 2 * 3), 3));
    const idx = []; for (let i = 0; i < GN - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    m.frustumCulled = false; m.visible = false; scene.add(m); return m;
  })();
  function updateGuide(r, prog, endS) {
    const a = guide.geometry.attributes.position, span = Math.max(8, Math.min(endS - prog, 240));
    for (let i = 0; i < GN; i++) {
      const p = ptAt(r.pts, prog + 3 + span * i / (GN - 1)), y = heightAt(p.x, p.z, car.y) + 0.35, nx = p.dz * 0.9, nz = -p.dx * 0.9;
      a.setXYZ(i * 2, p.x - nx, y, p.z - nz); a.setXYZ(i * 2 + 1, p.x + nx, y, p.z + nz);
    }
    a.needsUpdate = true; guide.visible = true;
  }
  // what the road does next: the first sharp change of direction within ~250 m
  function nextTurn(r, prog) {
    const c0 = ptAt(r.pts, prog + 6), h0 = Math.atan2(c0.dx, c0.dz);
    for (let L = 14; L <= 200; L += 6) {
      const p = ptAt(r.pts, prog + L); let d = Math.atan2(p.dx, p.dz) - h0; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > 0.5) return { dir: Math.abs(d) > 2.4 ? 'uturn' : d > 0 ? 'right' : 'left', m: Math.max(10, Math.round((L - 6) * 1.25 / 5) * 5) };
    }
    return null;
  }
  const zoneRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.012, 96), new THREE.MeshBasicMaterial({ color: 0xff9f1c, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false }));
  zoneRing.rotation.x = -Math.PI / 2; zoneRing.visible = false; scene.add(zoneRing);
  const ghostColors = [0xe53935, 0x43a047, 0xfdd835, 0x8e24aa];
  const ghostMeshes = [0, 1, 2].map(i => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.6, 3.9), new THREE.MeshStandardMaterial({ color: ghostColors[i], roughness: 0.4, metalness: 0.3, transparent: true, opacity: 0.88 })); body.position.y = 0.55;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.9), new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 0.2 })); cab.position.set(0, 1.05, -0.2);
    g.add(body, cab); g.visible = false; scene.add(g); return g;
  });

  // ---- UI -------------------------------------------------------------------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    #racehud { position: fixed; top: 46px; left: 50%; transform: translateX(-50%); z-index: 9; display: none; min-width: 260px; text-align: center; padding: 8px 18px; border-radius: 12px;
      background: rgba(10,14,22,.78); color: #fff; font: 700 15px system-ui, sans-serif; border-bottom: 4px solid var(--race, #ffd21f); pointer-events: none; }
    #racehud .big { font-size: 28px; letter-spacing: 1px; } #racehud .turn { font-size: 22px; color: #ffd21f; margin: 2px 0; } #racehud small { display: block; font-weight: 600; color: #b7c4d6; margin-top: 2px; }
    #racecount { position: fixed; inset: 0; z-index: 12; display: none; align-items: center; justify-content: center; font: 900 140px system-ui, sans-serif; color: #fff; text-shadow: 0 6px 30px rgba(0,0,0,.7); pointer-events: none; }
    #raceres { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 13; display: none; width: min(380px, 92vw); padding: 18px 20px; border-radius: 16px; background: rgba(10,14,22,.94); color: #fff; font: 15px system-ui, sans-serif; border-top: 6px solid var(--race, #ffd21f); }
    #raceres h2 { margin: 0 0 6px; font-size: 26px; } #raceres .row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,.1); }
    #raceres .row.me { color: #ffd21f; font-weight: 800; } #raceres button { margin-top: 12px; width: 100%; border: 0; border-radius: 10px; padding: 10px; font: 800 15px system-ui; background: var(--race, #ffd21f); color: #111; cursor: pointer; }
    #racequit { position: fixed; top: 8px; right: 8px; z-index: 14; display: none; border: 0; border-radius: 8px; padding: 6px 10px; font: 700 12px system-ui; background: rgba(160,30,30,.85); color: #fff; cursor: pointer; }
    #raceprompt { pointer-events: auto !important; cursor: pointer; position: fixed; left: 50%; bottom: 175px; transform: translateX(-50%); z-index: 8; display: none; padding: 8px 16px; border-radius: 20px; font: 800 14px system-ui, sans-serif; color: #111; background: var(--race, #ffd21f); pointer-events: none; }`;
  style.textContent += `
    #racemenu { position: fixed; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center; background: rgba(4,8,14,.62); font-family: system-ui, sans-serif; }
    #racemenu .box { width: min(440px, 94vw); max-height: 94vh; overflow: auto; padding: 14px 16px; border-radius: 16px; background: rgba(12,16,26,.97); color: #fff; border-top: 5px solid var(--race, #ffd21f); box-shadow: 0 10px 40px rgba(0,0,0,.6); }
    #racemenu h2 { margin: 0; font-size: 21px; } #racemenu .sub { color: #aab7c8; font-size: 12px; margin: 2px 0 8px; }
    #racemenu canvas { width: 100%; height: min(78vw, 46vh); max-height: 380px; object-fit: contain; border-radius: 10px; background: #0b1119; display: block; }
    #racemenu .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 10px 0; }
    #racemenu .stat { background: rgba(255,255,255,.07); border-radius: 8px; padding: 6px 9px; font-size: 12px; color: #aab7c8; } #racemenu .stat b { display: block; font-size: 17px; color: #fff; }
    #racemenu .btns { display: flex; gap: 8px; margin-top: 8px; } #racemenu button { flex: 1; border: 0; border-radius: 10px; padding: 11px 6px; font: 800 14px system-ui; cursor: pointer; background: rgba(255,255,255,.12); color: #fff; }
    #racemenu button.go { flex: 1.6; background: var(--race, #ffd21f); color: #111; }
    #racemenu .row { display: flex; align-items: center; gap: 8px; margin: 7px 0; font-size: 13px; } #racemenu .row label { width: 96px; color: #cfd8e6; } #racemenu .row input[type=range] { flex: 1; } #racemenu .row output { width: 46px; text-align: right; font-weight: 700; }
    #racemenu .seg { display: flex; gap: 5px; flex: 1; } #racemenu .seg button { padding: 7px 2px; font-size: 12px; } #racemenu .seg button.on { background: var(--race, #ffd21f); color: #111; }
    #raceload { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 14px; background: #060a10; color: #fff; font: 800 22px system-ui, sans-serif; }
    #raceload i { width: 220px; height: 6px; border-radius: 3px; background: rgba(255,255,255,.15); overflow: hidden; } #raceload i::after { content: ''; display: block; height: 100%; width: 40%; background: var(--race, #ffd21f); animation: rl 0.9s linear infinite; } @keyframes rl { from { margin-left: -40%; } to { margin-left: 100%; } }`;
  style.textContent += `
    #racedial { position: fixed; left: 10px; top: 96px; z-index: 9; display: none; width: min(26vw, 200px); pointer-events: none; }
    #racedial canvas { width: 100%; display: block; filter: drop-shadow(0 4px 12px rgba(0,0,0,.6)); }
    #raceshift { position: fixed; left: 10px; top: calc(96px + min(26vw, 200px) + 6px); z-index: 10; display: none; gap: 10px; } html.touch #raceshift { top: auto; bottom: 168px; }
    #raceshift button { width: 74px; height: 56px; border: 2px solid rgba(255,255,255,.55); border-radius: 14px; background: rgba(10,14,22,.78); color: #fff; font: 800 15px system-ui; touch-action: none; cursor: pointer; }
    #raceshift button.up { border-color: #2ee66b; } #raceshift button:active { background: rgba(80,150,230,.8); }`;
  document.head.appendChild(style);
  const mk = (id) => { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); return d; };
  const menuEl = mk('racemenu'), loadEl = mk('raceload'), dialEl = mk('racedial'), shiftEl = mk('raceshift'), hud = mk('racehud'), countEl = mk('racecount'), resEl = mk('raceres'), promptEl = mk('raceprompt');
  const dcv = document.createElement('canvas'); dcv.width = dcv.height = 360; dialEl.appendChild(dcv);
  shiftEl.innerHTML = '<button class="dn" aria-label="Shift down">▼ DOWN<br><small>Z</small></button><button class="up" aria-label="Shift up">▲ UP<br><small>X</small></button>';
  shiftEl.querySelector('.up').addEventListener('pointerdown', e => { e.preventDefault(); gearbox && gearbox.shiftUp(); });
  shiftEl.querySelector('.dn').addEventListener('pointerdown', e => { e.preventDefault(); gearbox && gearbox.shiftDown(); });
  addEventListener('keydown', e => { if (!run || run.r.kind !== 'drag' || !gearbox || e.repeat) return; if (e.code === 'KeyX') gearbox.shiftUp(); else if (e.code === 'KeyZ') gearbox.shiftDown(); });
  // the big tachometer for manual shifting: red zone, a green shift window, a needle and the gear in the middle
  function drawDial(v) {
    const g = dcv.getContext('2d'), W = 360, cx = 180, cy = 190, R = 150, a0 = Math.PI * 0.78, a1 = Math.PI * 2.22, A = x => a0 + (a1 - a0) * x;
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(8,12,20,.82)'; g.beginPath(); g.arc(cx, cy, R + 18, 0, 7); g.fill();
    const arc = (x0, x1, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(cx, cy, R - w / 2, A(x0), A(x1)); g.stroke(); };
    arc(0, 0.74, '#3a4658', 16); arc(0.74, 0.84, '#ffd21f', 16); arc(0.84, 0.95, '#2ee66b', 16); arc(0.95, 1, '#ff3b30', 16);
    g.strokeStyle = '#cfd8e6'; g.lineWidth = 3; g.fillStyle = '#cfd8e6'; g.font = 'bold 20px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i <= 8; i++) { const x = i / 8, a = A(x); g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22)); g.lineTo(cx + Math.cos(a) * (R - 36), cy + Math.sin(a) * (R - 36)); g.stroke(); g.fillText(String(i), cx + Math.cos(a) * (R - 56), cy + Math.sin(a) * (R - 56)); }
    const a = A(Math.min(1, v.r));
    g.strokeStyle = v.r >= 0.84 && v.r <= 0.95 ? '#2ee66b' : v.r > 0.95 ? '#ff3b30' : '#ffffff'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 18), cy + Math.sin(a) * (R - 18)); g.stroke();
    g.fillStyle = '#10151f'; g.beginPath(); g.arc(cx, cy, 36, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 44px system-ui'; g.fillText(String(v.gear), cx, cy + 2);
    g.font = 'bold 15px system-ui'; g.fillStyle = '#9fb0c6'; g.fillText('x1000 rpm', cx, cy + 74);
    if (v.shiftLabel) { g.font = 'bold 22px system-ui'; g.fillStyle = v.shiftLabel === 'PERFECT SHIFT' ? '#2ee66b' : v.shiftLabel === 'good shift' ? '#ffd21f' : '#ff7a5c'; g.fillText(v.shiftLabel.toUpperCase(), cx, cy + 108); }
    else if (v.r > 0.95) { g.font = 'bold 22px system-ui'; g.fillStyle = '#ff3b30'; g.fillText('SHIFT!', cx, cy + 108); }
  }
  const quitBtn = document.createElement('button'); quitBtn.id = 'racequit'; quitBtn.textContent = 'Quit race (Backspace)'; document.body.appendChild(quitBtn);

  // ---- state ----------------------------------------------------------------------------------------------------------------------
  let run = null, cooldown = null, shownNear = null, offer = null;
  const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  const speedOf = r => CLASS_REF_SPEED[r.cls || 'F'];     // rivals run at their class's pace, not yours
  const ghostSetup = (r) => {
    const base = speedOf(r);
    const lvl = r.kind === 'drag' ? 0.86 : 0.56;
    return [1.04, 0.97, 0.9].map((m, i) => ({ v: base * lvl * m * (0.97 + (((r.id.length + i) * 37) % 7) / 100), tau: r.kind === 'drag' ? 1.5 + i * 0.25 : 2.6 + i * 0.4, lat: [-3.2, 3.2, -6.4][i], back: [5, 9, 13][i] }));
  };
  const gs = (g, t) => g.v * (t - g.tau * (1 - Math.exp(-t / g.tau)));
  const gTime = (g, L) => { let lo = 0, hi = 600; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (gs(g, mid) < L) lo = mid; else hi = mid; } return hi; };
  // the rivals are real cars in the traffic (see traffic.js addRival): they follow the route, but bump and get bumped like anyone else
  function spawnRivals(r, run) {
    tune.rivals.clear();
    const L = r.length, loop = r.kind === 'circuit', total = L * run.laps, p0 = ptAt(r.pts, 0), pE = ptAt(r.pts, L);
    const sample = s => {
      if (s < 0) return { x: p0.x + p0.dx * s, z: p0.z + p0.dz * s, dx: p0.dx, dz: p0.dz };
      if (loop) return ptAt(r.pts, s % L);
      if (s > L) return { x: pE.x + pE.dx * (s - L), z: pE.z + pE.dz * (s - L), dx: pE.dx, dz: pE.dz };
      return ptAt(r.pts, s);
    };
    const project = (x, z, hint) => {
      let best = hint, bd = 1e12;
      for (let s = hint - 40; s <= hint + 160; s += 3) { const q = sample(s), d = (q.x - x) ** 2 + (q.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
      return best;
    };
    run.rivals = run.ghosts.map(gh => {
      const lat = (r.kind === 'drag' ? gh.lat : gh.lat * 0.25) * Math.min(1, Math.max(0.5, (r.width - 6) / 12)) + 1.4;
      const car = tune.rivals.add({ sample, project, loop, total, vmax: gh.v, tau: gh.tau, lat, maxLat: Math.max(2, r.width / 2 - 2.4), s0: -gh.back });
      car.rival.t = -3.2;
      return car;
    });
  }
  const rivalS = (run, i) => (run.rivals && run.rivals[i] && run.rivals[i].rival ? run.rivals[i].rival.s : 0);
  const driftTargets = [16000, 10500, 6200];


  // ---- pre-race menu: route on a map, length, records, opponents, laps, and a tune panel -----------------------------------------
  const rt = (save.raceTune ||= { traffic: 6, peds: 35 });
  const SNAP_KEYS = ['traffic', 'peds', 'hour', 'fog', 'rain', 'snow', 'dynWeather', 'clockRun'];
  let menuR = null, snap = null, tuning = false, restore = null;
  function drawRoute(cv, r) {
    const W = cv.width = 640, H = cv.height = r.track ? 400 : 560, g = cv.getContext('2d');      // street races show the whole city (taller than wide)
    let pts = r.pts, closed = false;
    if (r.track && arena) { const T = arena.byId(r.track); if (T) { pts = T.pts; closed = true; } }
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; pts.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); });
    if (!r.track) { x0 = 1e9; x1 = -1e9; z0 = 1e9; z1 = -1e9; Object.values(city.roadNodes).forEach(n => { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z); }); }      // the whole city, not just the route
    const pad = r.track ? 20 : 60; x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
    const sc = Math.min(W / (x1 - x0), H / (z1 - z0)), ox = (W - (x1 - x0) * sc) / 2 - x0 * sc, oz = (H - (z1 - z0) * sc) / 2 - z0 * sc;
    // the whole-city view is drawn like the map: north up, the lake on the right (the world's x axis points west)
    const flip = !r.track, X = flip ? (x => (x1 - x) * sc + (W - (x1 - x0) * sc) / 2) : (x => x * sc + ox), Z = flip ? (z => (z1 - z) * sc + (H - (z1 - z0) * sc) / 2) : (z => z * sc + oz);
    g.fillStyle = '#0b1119'; g.fillRect(0, 0, W, H);
    if (flip) {          // water for orientation: the lake and the rivers
      g.fillStyle = 'rgba(52,104,160,.38)'; LAKES.forEach(l => { g.beginPath(); l.forEach((p, i) => i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))); g.closePath(); g.fill(); });
      g.strokeStyle = 'rgba(52,104,160,.38)'; g.lineCap = 'round'; g.lineJoin = 'round'; RIVERS.forEach(rv => { g.lineWidth = rv.half * 2 * sc; g.beginPath(); rv.pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))); g.stroke(); });
    }
    if (!r.track) {      // the surrounding streets, faint
      g.strokeStyle = 'rgba(160,180,210,.28)'; g.lineWidth = 2;
      const nodes = city.roadNodes; g.beginPath();
      city.roadEdges.forEach(e => { const a = nodes[e.from], b = nodes[e.to]; if (!a || !b) return; if ((a.x < x0 && b.x < x0) || (a.x > x1 && b.x > x1) || (a.z < z0 && b.z < z0) || (a.z > z1 && b.z > z1)) return; g.moveTo(X(a.x), Z(a.z)); g.lineTo(X(b.x), Z(b.z)); });
      g.stroke();
    }
    const K = RACE_KINDS[r.kind];
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 11; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))); if (closed) g.closePath(); g.stroke();
    g.strokeStyle = K.color; g.lineWidth = 6; g.stroke();
    // direction chevrons
    g.fillStyle = '#fff'; const n = pts.length; const step = Math.max(6, Math.floor(n / 9));
    for (let i = step; i < n - 1; i += step) { const a = pts[i], b = pts[(i + 1) % n], ang = Math.atan2(Z(b[1]) - Z(a[1]), X(b[0]) - X(a[0])); g.save(); g.translate(X(a[0]), Z(a[1])); g.rotate(ang); g.beginPath(); g.moveTo(5, 0); g.lineTo(-4, -4); g.lineTo(-4, 4); g.closePath(); g.fill(); g.restore(); }
    // start / finish
    const s = pts[0]; g.fillStyle = '#fff'; g.beginPath(); g.arc(X(s[0]), Z(s[1]), 9, 0, 7); g.fill(); g.fillStyle = '#111'; g.font = 'bold 12px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(r.kind === 'sprint' || r.kind === 'drag' ? 'S' : 'S/F', X(s[0]), Z(s[1]) + 0.5);
    if (r.kind === 'sprint' || r.kind === 'drag') { const e = pts[pts.length - 1]; g.fillStyle = K.color; g.beginPath(); g.arc(X(e[0]), Z(e[1]), 9, 0, 7); g.fill(); g.fillStyle = '#111'; g.fillText('F', X(e[0]), Z(e[1]) + 0.5); }
  }
  function menuStats(r) {
    const b = save[r.id] || {}, laps = r.kind === 'circuit' ? (r.laps || 1) : 1;
    let lenM = Math.round(r.length * 1.25 * laps);
    if (r.track && arena) { const T = arena.byId(r.track); lenM = T ? T.length : 0; }
    const fmtLen = m => m >= 1000 ? (m / 1000).toFixed(2) + ' km' : m + ' m';
    const rows = [['Length', r.kind === 'drift' ? fmtLen(lenM) + ' / lap' : fmtLen(lenM) + (laps > 1 ? ` (${laps} laps)` : '')], ['Opponents', '3 rivals'], ['Class', r.cls || 'F']];
    if (r.kind === 'circuit') rows.push(['Lap record', b.bestLap ? fmt(b.bestLap) : '-'], ['Best race', b.best ? fmt(b.best) : '-']);
    else if (r.kind === 'drift') rows.push(['Best score', b.best ? Math.round(b.best).toLocaleString('en-US') + ' pts' : '-'], ['Time limit', Math.round(r.timeLimit) + ' s']);
    else rows.push(['Record', b.best ? fmt(b.best) : '-'], ['Won', (b.wins || 0) + ' / ' + (b.plays || 0)]);
    return rows.map(x => `<div class="stat">${x[0]}<b>${x[1]}</b></div>`).join('');
  }
  const wxNow = () => { const st = tune.settings; return st.dynWeather ? 'dyn' : st.rain ? 'rain' : st.snow ? 'snow' : st.fog > 0.3 ? 'fog' : 'clear'; };
  function renderMenu() {
    const r = menuR, K = RACE_KINDS[r.kind], st = tune ? tune.settings : {};
    menuEl.style.setProperty('--race', K.color);
    if (!tuning) {
      menuEl.innerHTML = `<div class="box"><h2>${K.name} - ${r.name}</h2><div class="sub">${K.desc}</div><canvas></canvas><div class="stats">${menuStats(r)}</div>
        ${r.kind === 'circuit' ? `<div class="row"><label>Laps</label><div class="seg">${[1, 2, 3, 4, 5].map(n => `<button data-laps="${n}" class="${(r.laps || 1) === n ? 'on' : ''}">${n}</button>`).join('')}</div></div>` : ''}
        <div class="btns">${tune ? '<button data-a="tune">Tune conditions</button>' : ''}<button data-a="cancel">Cancel</button><button class="go" data-a="go">Enter race</button></div></div>`;
      drawRoute(menuEl.querySelector('canvas'), r);
    } else {
      const lim = tune.limits || { traffic: 60, peds: 200 }, wx = wxNow();
      menuEl.innerHTML = `<div class="box"><h2>Race conditions</h2><div class="sub">Traffic and pedestrians apply during the race only; weather and time of day stay as you set them.</div>
        <div class="row"><label>Traffic</label><input type="range" data-k="traffic" min="0" max="${lim.traffic}" step="1" value="${rt.traffic}"><output>${rt.traffic}</output></div>
        <div class="row"><label>Pedestrians</label><input type="range" data-k="peds" min="0" max="${lim.peds}" step="1" value="${rt.peds}"><output>${rt.peds}</output></div>
        <div class="row"><label>Time of day</label><input type="range" data-k="hour" min="0" max="23.5" step="0.5" value="${st.hour}"><output>${Math.floor(st.hour)}:${st.hour % 1 ? '30' : '00'}</output></div>
        <div class="row"><label>Weather</label><div class="seg">${[['dyn', 'Auto'], ['clear', 'Clear'], ['rain', 'Rain'], ['snow', 'Snow'], ['fog', 'Fog']].map(([v, l]) => `<button data-wx="${v}" class="${wx === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="btns"><button data-a="back" class="go">Done</button></div></div>`;
    }
  }
  menuEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !menuR) return;
    if (b.dataset.laps) { menuR.laps = +b.dataset.laps; renderMenu(); return; }
    if (b.dataset.wx && tune) {
      const v = b.dataset.wx;
      tune.set('dynWeather', v === 'dyn'); if (v !== 'dyn') { tune.set('rain', v === 'rain'); tune.set('snow', v === 'snow'); tune.set('fog', v === 'fog' ? 0.6 : 0); }
      renderMenu(); return;
    }
    const a = b.dataset.a;
    if (a === 'tune') { tuning = true; renderMenu(); } else if (a === 'back') { tuning = false; renderMenu(); }
    else if (a === 'cancel') closeMenu(true);
    else if (a === 'go') { const r = menuR; closeMenu(false); launch(r); }
  });
  menuEl.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.k; if (!k || !tune) return;
    const v = Number(e.target.value); e.target.nextElementSibling.textContent = k === 'hour' ? Math.floor(v) + ':' + (v % 1 ? '30' : '00') : v;
    if (k === 'hour') tune.set('hour', v); else { rt[k] = v; persist(); }
  });
  function openMenu(r) {
    if (run || menuR) return;
    menuR = r; tuning = false; offer = null; promptEl.style.display = 'none';
    snap = {}; if (tune) SNAP_KEYS.forEach(k => { snap[k] = tune.settings[k]; });
    if (tune) { const lim = tune.limits || {}; rt.traffic = Math.min(rt.traffic, lim.traffic ?? 999); rt.peds = Math.min(rt.peds, lim.peds ?? 999); }
    renderMenu(); menuEl.style.display = 'flex'; world.modalOpen && world.modalOpen(true);
  }
  function closeMenu(cancel) {
    menuEl.style.display = 'none'; menuR = null; tuning = false; world.modalOpen && world.modalOpen(false);
    if (cancel && tune && snap) { SNAP_KEYS.forEach(k => { if (tune.settings[k] !== snap[k]) tune.set(k, snap[k]); }); }
  }
  // a short loading screen, then the grid: traffic is emptied around the line and kept low for the race
  function launch(r) {
    const K = RACE_KINDS[r.kind];
    loadEl.style.setProperty('--race', K.color); loadEl.innerHTML = `<div>${K.name} - ${r.name}</div><i></i><small style="font:600 13px system-ui;color:#9fb0c6">Clearing the streets...</small>`; loadEl.style.display = 'flex';
    setTimeout(() => {
      if (tune) {
        restore = { traffic: tune.settings.traffic, peds: tune.settings.peds };
        tune.set('traffic', rt.traffic); tune.set('peds', rt.peds);
        if (!r.track && tune.clearZone) tune.clearZone({ x: r.start.x, z: r.start.z, r: r.kind === 'drag' ? Math.max(250, r.length + 40) : 250 });   // 250 u = 312 m
      }
      try { begin(r); } catch (err) { console.error(err); end('The race could not start'); }      // never leave the loading screen up (it freezes the car)
      setTimeout(() => { loadEl.style.display = 'none'; }, 450);
    }, 700);
  }

  function begin(r) {
    const K = RACE_KINDS[r.kind];
    run = { r, K, laps: r.kind === 'circuit' ? (r.laps || 1) : 1, lapIdx: 0, lapT0: 0, bestLap: 0, t: -3.2, phase: 'count', cp: 0, ghosts: r.kind === 'drift' ? [] : ghostSetup(r), progress: 0, score: 0, chain: 0, chainT: 0, mult: 1, bank: 0, calm: 0, lost: '', best: 0 };
    document.documentElement.style.setProperty('--race', K.color);
    if (r.kind !== 'drift' && tune && tune.rivals) spawnRivals(r, run);
    let x = r.start.x, z = r.start.z, h = r.start.heading;
    if (r.kind === 'drag' || r.kind === 'circuit' || r.kind === 'sprint') { const p = ptAt(r.pts, 0), px = -p.dz; x += px * Math.min(1.6, r.width / 5); z += p.dx * Math.min(1.6, r.width / 5); }
    if (r.track && arena) {
      const T = arena.byId(r.track); run.T = T; arena.activate(T, collisionWorld);
      car.driftAssist = true;
      x = T.start.x; z = T.start.z; h = T.start.heading;
      car.teleport(x, z, 0, h);
    } else car.teleport(x, z, heightAt(x, z), h);
    car.speed = 0; car.vx = 0; car.vz = 0;
    quitBtn.style.display = 'block'; hud.style.display = 'block'; promptEl.style.display = 'none';
    if (r.kind === 'drag' && gearbox) { gearbox.setManual(true); dialEl.style.display = 'block'; shiftEl.style.display = 'flex'; }
    world.toast(K.name + ' - ' + r.name);
  }
  function end(reason) {
    if (!run) return;
    if (run.r.track && arena) {      // back to the gate in the city
      arena.deactivate(collisionWorld); car.driftAssist = false;
      const g = run.r.start; car.teleport(g.x + g.dx * 12, g.z + g.dz * 12, heightAt(g.x, g.z), g.heading); car.speed = 0; car.vx = 0; car.vz = 0;
    }
    if (gearbox) { gearbox.setManual(false); } dialEl.style.display = 'none'; shiftEl.style.display = 'none';
    if (tune && tune.rivals) tune.rivals.clear();
    if (tune) { if (tune.clearZone) tune.clearZone(null); if (restore) { tune.set('traffic', restore.traffic); tune.set('peds', restore.peds); restore = null; } }
    run = null; hud.style.display = 'none'; countEl.style.display = 'none'; quitBtn.style.display = 'none';
    rings.forEach(m => { m.visible = false; }); beacon.visible = false; guide.visible = false; zoneRing.visible = false; ghostMeshes.forEach(m => { m.visible = false; });
    if (reason) world.toast(reason);
  }
  function results(rows, mine, title, time, prize, r) {
    resEl.innerHTML = `<h2>${title}</h2>` + rows.map((x, i) => `<div class="row${x.me ? ' me' : ''}"><span>${i + 1}. ${x.name}</span><span>${x.val}</span></div>`).join('') +
      `<div class="row"><span>Prize</span><b>${prize ? '$' + prize.toLocaleString('en-US') : '-'}</b></div><button>Continue</button>`;
    resEl.style.display = 'block';
    resEl.querySelector('button').onclick = () => { resEl.style.display = 'none'; };
  }
  function finish(timeOrScore) {
    const { r } = run, K = run.K;
    let rows, place;
    if (r.kind === 'drift') {
      const mineScore = Math.round(run.bank);
      const opp = driftTargets.map((s, i) => ({ name: ['Rival A', 'Rival B', 'Rival C'][i], val: Math.round(s * (r.cls === 'E' ? 1 : 0.65) * (0.9 + ((r.id.length * 13 + i * 7) % 20) / 100)) }));
      rows = opp.concat([{ name: 'You', val: mineScore, me: true }]).sort((a, b) => b.val - a.val);
      place = rows.findIndex(x => x.me); rows.forEach(x => { x.val = x.val.toLocaleString('en-US') + ' pts'; });
      const prev = save[r.id] || {}; if (!prev.best || mineScore > prev.best) save[r.id] = { ...prev, best: mineScore };
    } else {
      const t = timeOrScore, g = run.ghosts.map((gh, i) => { const R = run.rivals && run.rivals[i] && run.rivals[i].rival; return R ? (R.finished != null ? R.finished : t + Math.max(0, r.length * run.laps - R.s) / Math.max(8, R.vmax * 0.8)) : gTime(gh, r.length * run.laps); });
      const names = ['Rival A', 'Rival B', 'Rival C'];
      rows = g.map((tt, i) => ({ name: names[i], tt })).concat([{ name: 'You', tt: t, me: true }]).sort((a, b) => a.tt - b.tt);
      place = rows.findIndex(x => x.me); rows.forEach(x => { x.val = fmt(x.tt); });
      const prev = save[r.id] || {}; if (!prev.best || t < prev.best) save[r.id] = { ...prev, best: t };
      if (run.bestLap && (!(save[r.id].bestLap) || run.bestLap < save[r.id].bestLap)) save[r.id].bestLap = run.bestLap;
    }
    const prize = place < 3 ? Math.round(PRIZES[place] * CLASS_PRIZE_MUL[r.cls || 'F']) : 0;
    if (prize) world.reward(prize);
    save[r.id] = { ...(save[r.id] || {}), plays: ((save[r.id] || {}).plays || 0) + 1, wins: ((save[r.id] || {}).wins || 0) + (place === 0 ? 1 : 0) };
    persist();
    results(rows, place, ['WIN!', '2nd place', '3rd place', 'Finished ' + (place + 1) + 'th'][Math.min(place, 3)], 0, prize, r);
    cooldown = r;
    end();
  }
  addEventListener('keydown', e => {
    if (e.code === 'KeyE' && !e.repeat && !run && offer && !world.modal && !world.onFoot && !e.target.closest?.('input,textarea')) { const r = offer; offer = null; openMenu(r); return; }
    if (e.code === 'Escape' && menuR) { e.preventDefault(); closeMenu(true); return; }
    if (e.code === 'Backspace' && run) { e.preventDefault(); end('Race abandoned'); }
    if ((e.code === 'Enter' || e.code === 'Space') && resEl.style.display === 'block') resEl.style.display = 'none';
  });
  promptEl.addEventListener('click', () => { if (offer && !run) { const r = offer; offer = null; openMenu(r); } });
  quitBtn.addEventListener('click', () => end('Race abandoned'));

  // player progress along the route (projected, monotone within a window)
  function progressOf(r, hint) {
    let bs = hint, bd = 1e9;
    for (let i = 1; i < r.pts.length; i++) {
      if (r.cum[i] < hint - 60 || r.cum[i - 1] > hint + 260) continue;
      const ax = r.pts[i - 1][0], az = r.pts[i - 1][1], bx = r.pts[i][0], bz = r.pts[i][1], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((car.x - ax) * (bx - ax) + (car.z - az) * (bz - az)) / l2)), d = Math.hypot(car.x - ax - (bx - ax) * t, car.z - az - (bz - az) * t);
      if (d < bd) { bd = d; bs = r.cum[i - 1] + (r.cum[i] - r.cum[i - 1]) * t; }
    }
    return bs;
  }

  function update(dt) {
    // ---- idle: gates, prompt, trigger ----
    if (!run) {
      let near = null, nd = 1e9;
      plan.forEach(r => { const d = Math.hypot(r.start.x - car.x, r.start.z - car.z); r.gate.visible = d < 260; if (d < nd) { nd = d; near = r; } });
      if (cooldown && Math.hypot(cooldown.start.x - car.x, cooldown.start.z - car.z) > 45) cooldown = null;
      const canStart = !world.onFoot && !world.modal && !menuR && loadEl.style.display !== 'flex' && !(window.__noRace);
      offer = null;
      if (near && nd < 60 && canStart && resEl.style.display !== 'block') {
        const K = RACE_KINDS[near.kind], b = save[near.id] || {};
        promptEl.style.setProperty('--race', K.color);
        const mine = world.carClassInfo ? world.carClassInfo().cls : 'F', tooGood = classIndex(mine) > classIndex(near.cls);
        if (nd < 8 && !tooGood) offer = near;
        promptEl.textContent = `[Class ${near.cls}] ${near.name} - ${tooGood ? 'your class ' + mine + ' car is too fast for this race (needs class ' + near.cls + ' or slower)' : nd < 8 ? 'press E to start' : 'drive to the ring'}${b.best ? ' (best ' + (near.kind === 'drift' ? b.best.toLocaleString('en-US') + ' pts' : fmt(b.best)) + ')' : ''}`;
        promptEl.style.display = 'block';
      } else promptEl.style.display = 'none';
      return;
    }
    // ---- running ----
    const { r, K } = run;
    if (r.kind === 'drag' && gearbox) { const v = gearbox.state(); if (v) drawDial(v); }
    run.t += dt;
    const t = run.t;
    plan.forEach(p => { if (p !== r) p.gate.visible = false; });
    if (run.phase === 'count') {
      car.speed = 0;
      const n = Math.ceil(-t);
      countEl.style.display = 'flex'; countEl.textContent = n > 0 ? String(n) : 'GO!'; countEl.style.color = n > 0 ? '#fff' : K.color;
      hud.innerHTML = `<div class="big">${K.name.toUpperCase()}</div><small>${r.name}</small>`;
      if (t >= 0) { run.phase = 'go'; setTimeout(() => { if (!run || run.phase !== 'go') countEl.style.display = 'none'; else if (run.t > 0.8) countEl.style.display = 'none'; }, 900); }
      if (t < 0) { if (!run.rivals) placeGhosts(r, 0, true); return; }
    }
    if (t > 0.9) countEl.style.display = 'none';
    if (r.kind === 'drift') return driftStep(dt);
    // ghosts
    if (!run.rivals) placeGhosts(r, t, false);
    // progress / checkpoints
    run.progress = progressOf(r, run.progress);
    let posN = 1; run.ghosts.forEach((gh, i) => { if ((run.rivals ? rivalS(run, i) : gs(gh, t)) > run.lapIdx * r.length + run.progress) posN++; });
    if (r.kind === 'drag') {
      hud.innerHTML = `<div class="big">${fmt(t)}</div><small>POS ${posN}/4 &middot; ${Math.max(0, Math.round((r.length - run.progress) * 1.25))} m to go</small>`;
      if (run.progress >= r.length - 0.5 && t > 1) finish(t);
      else if (t > 120) end('Too slow - race over');
      const fin = ptAt(r.pts, r.length); rings[0].visible = true; rings[0].position.set(fin.x, heightAt(fin.x, fin.z) + 3.2, fin.z); rings[0].rotation.set(0, Math.atan2(fin.dx, fin.dz), 0); rings[0].scale.setScalar(Math.min(1.9, r.width / 8)); rings[1].visible = false;
      beacon.visible = true; beacon.position.set(fin.x, heightAt(fin.x, fin.z) + 20, fin.z);
      return;
    }
    const cps = r.checkpoints, nCp = cps.length, totalCp = nCp * run.laps, c = cps[run.cp % nCp];
    if (c) {
      const d = Math.hypot(car.x - c[0], car.z - c[1]);
      if (d < 11) {
        run.cp++;
        if (run.cp % nCp === 0) {      // crossed the start/finish line
          const lt = t - run.lapT0; run.lapT0 = t; if (!run.bestLap || lt < run.bestLap) run.bestLap = lt;
          if (run.cp < totalCp) { run.lapIdx++; run.progress = 0; world.toast('Lap ' + (run.lapIdx + 1) + '/' + run.laps + ' - last ' + fmt(lt)); }
        }
        if (run.cp >= totalCp) { finish(t); return; }
      }
    }
    const n0 = run.cp < totalCp ? cps[run.cp % nCp] : null, n1 = run.cp + 1 < totalCp ? cps[(run.cp + 1) % nCp] : null;
    const setRing = (m, p, vis) => { m.visible = vis && !!p; if (!p) return; const y = heightAt(p[0], p[1]); m.position.set(p[0], y + 3, p[1]); m.rotation.set(0, Math.atan2(p[0] - car.x, p[1] - car.z) + Math.PI / 2, 0); };
    setRing(rings[0], n0, true); setRing(rings[1], n1, true);
    if (n0) { beacon.visible = true; beacon.position.set(n0[0], heightAt(n0[0], n0[1]) + 80, n0[1]); }
    const tgt = r.cpS && r.cpS[run.cp % nCp] != null ? r.cpS[run.cp % nCp] : run.progress + 120;
    updateGuide(r, run.progress, tgt);
    const turn = nextTurn(r, run.progress), G = { left: '⬅', right: '➡', uturn: '⮌' };
    const cue = turn ? `<div class="turn">${G[turn.dir]} ${turn.dir === 'uturn' ? 'U-turn' : 'Turn ' + turn.dir} in ${turn.m} m</div>` : '<div class="turn">⬆ Straight on</div>';
    const lapTxt = run.laps > 1 ? `lap ${run.lapIdx + 1}/${run.laps} &middot; ` : '';
    hud.innerHTML = `<div class="big">${fmt(t)}</div>${cue}<small>POS ${posN}/4 &middot; ${lapTxt}checkpoint ${(run.cp % nCp) + 1}/${nCp}${n0 ? ' &middot; ' + Math.round(Math.hypot(car.x - n0[0], car.z - n0[1]) * 1.25) + ' m away' : ''}${run.bestLap ? ' &middot; best lap ' + fmt(run.bestLap) : ''}</small>`;
    if (t > 900) end('Race timed out');
  }

  function placeGhosts(r, t, grid) {
    run.ghosts.forEach((gh, i) => {
      const m = ghostMeshes[i];
      const s = grid ? -gh.back : gs(gh, t) - gh.back * Math.max(0, 1 - t / 6);
      if (s >= r.length * run.laps + 80) { m.visible = false; return; }
      const p = ptAt(r.pts, s < 0 ? Math.max(-30, s) : (r.kind === 'circuit' ? s % r.length : s));
      const rx = -p.dz, rz = p.dx, lat = (r.kind === 'drag' ? gh.lat : gh.lat * 0.25) * Math.min(1, Math.max(0.5, (r.width - 6) / 12));
      const x = p.x + rx * (lat + 1.4), z = p.z + rz * (lat + 1.4);
      m.visible = true; m.position.set(x, heightAt(x, z), z); m.rotation.y = Math.atan2(p.dx, p.dz);
    });
  }

  function driftStep(dt) {
    const { r } = run, t = run.t, left = r.timeLimit - t;
    const T = run.T;
    if (T) zoneRing.visible = false; else { zoneRing.visible = true; zoneRing.position.set(r.zone.x, heightAt(r.zone.x, r.zone.z) + 0.2, r.zone.z); zoneRing.scale.setScalar(r.zone.r); }
    const sp = Math.hypot(car.vx, car.vz), inZone = T ? T.inTrack(car.x, car.z, 3) : Math.hypot(car.x - r.zone.x, car.z - r.zone.z) < r.zone.r;
    let slip = 0;
    if (sp > 6) { const fx = Math.sin(car.heading), fz = Math.cos(car.heading), vx = car.vx / sp, vz = car.vz / sp; slip = Math.abs(Math.atan2(fx * vz - fz * vx, fx * vx + fz * vz)); if (car.speed < -1) slip = 0; }
    const sliding = sp > 8 && slip > 0.2 && inZone && !car.airborne;
    const wallHit = car.wallHit || 0; car.wallHit = 0;                 // a tyre wall (or anything else fixed) hit hard enough also ends the chain
    if ((car.impactSpeed || 0) > 2.5 || wallHit > 2.2) { car.impactSpeed = 0; if (run.chain > 0) run.lost = 'Crash! chain lost'; run.chain = 0; run.chainT = 0; run.mult = 1; }
    if (sliding) {
      run.calm = 0; run.chainT += dt;
      const bonus = !!(T && T.inBonus && T.inBonus(car.x, car.z));
      run.mult = 1 + Math.min(3, run.chainT * 0.3);
      // points shrink the longer one slide goes on, and every slide scrubs speed off: you have to straighten up and
      // build speed again between drifts, so the circuit can't be chained by just holding gas and steering
      run.chain += dt * 55 * Math.min(2.0, slip / 0.6) * Math.min(2, sp / 16) * Math.max(0.4, 1 - run.chainT * 0.1) * (bonus ? 2.5 : 1);
      const bleed = Math.exp(-dt * (0.2 + 0.3 * Math.min(1, slip / 0.7)));
      car.vx *= bleed; car.vz *= bleed; car.speed *= bleed;
      run.bonusNow = bonus;
      run.lost = '';
    } else {
      run.calm += dt; run.bonusNow = false;
      if (run.chain > 0 && (run.calm > 0.7 || !inZone)) {
        if (inZone) { run.bank += run.chain * run.mult; run.lost = '+' + Math.round(run.chain * run.mult); } else run.lost = 'Left the zone - chain lost';
        run.chain = 0; run.chainT = 0; run.mult = 1;
      }
    }
    hud.innerHTML = `<div class="big">${Math.round(run.bank + (run.chain * run.mult)).toLocaleString('en-US')} pts</div><small>${run.chain > 0 ? 'chain ' + Math.round(run.chain) + ' &times; ' + run.mult.toFixed(1) + (run.bonusNow ? ' &middot; <b style="color:#ff9f1c">WALL BONUS x2.5</b>' : '') : (run.lost || (T ? 'drift: turn hard on the gas, tap handbrake' : 'drift: handbrake + steer'))} &middot; ${Math.max(0, Math.ceil(left))} s${inZone ? '' : (T ? ' &middot; BACK ON THE TRACK' : ' &middot; GET BACK IN THE RING')}</small>`;
    if (left <= 0) { if (run.chain > 0) run.bank += run.chain * run.mult; finish(run.bank); }
  }

  return {
    update,
    frozen: () => (!!run && run.phase === 'count') || !!menuR || loadEl.style.display === 'flex',
    active: () => !!run,
    menuOpen: () => !!menuR,
    offering: () => (!!offer || !!menuR) && !run,
    abort: reason => end(reason),
    markers: () => {
      const out = plan.map(r => ({ x: r.start.x, z: r.start.z, color: RACE_KINDS[r.kind].color, label: RACE_KINDS[r.kind].label }));
      if (run && run.r.checkpoints.length) { const c = run.r.checkpoints[run.cp], c2 = run.r.checkpoints[run.cp + 1]; if (c2) out.push({ x: c2[0], z: c2[1], color: '#ffffff', label: '2' }); if (c) out.push({ x: c[0], z: c[1], color: '#ffd21f', label: '▶' }); }
      return out;
    },
    route: () => (run && run.r.kind !== 'drift' ? run.r.pts.concat() : null),
    solids: plan.flatMap(r => r.solids),
    plan
  };
}
