// Hailing a cab on foot: stand still on the pavement, press H (or tap the prompt) and a taxi pulls up at the kerb. The
// city map opens: tap where you want to go. The fare is shown (about what a driver earns for the same trip); take the
// ride - the cab drives the real streets and you can watch it all - or skip straight to the destination.
import * as THREE from 'three';
import { buildCarModel } from './carModels.js';

export function createHail({ city, scene, heightAt, world, camera, minimap, toast }) {
  const nodes = city.roadNodes, edges = city.roadEdges;
  // ---- road graph (for the nearest road and the route) ----
  const adj = {}, usable = e => e.structure !== 'tunnel';
  edges.forEach(e => {
    if (!usable(e) || !nodes[e.from] || !nodes[e.to]) return;
    const a = nodes[e.from], b = nodes[e.to], len = Math.hypot(a.x - b.x, a.z - b.z);
    (adj[e.from] ||= []).push({ to: e.to, len, e });
    if (!e.oneWay) (adj[e.to] ||= []).push({ to: e.from, len, e });
  });
  const nearestOnRoad = (x, z, maxD = 1e9) => {
    let best = null;
    for (const e of edges) {
      if (!usable(e) || e.structure === 'bridge' && false) continue;
      const a = nodes[e.from], b = nodes[e.to]; if (!a || !b) continue;
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < maxD && (!best || d < best.d)) { const l = Math.sqrt(l2); best = { d, x: px, z: pz, dx: dx / l, dz: dz / l, e, t, a, b, len: l }; }
    }
    return best;
  };
  const nearestNode = (x, z) => { let b = null, bd = 1e12; for (const id in adj) { const n = nodes[id], d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; b = id; } } return b; };
  function route(fromId, toId) {
    const dist = { [fromId]: 0 }, prev = {}, done = new Set();
    for (;;) {
      let u = null, bd = Infinity; for (const n in dist) if (!done.has(n) && dist[n] < bd) { bd = dist[n]; u = n; }
      if (u === null || u === toId) break; done.add(u);
      (adj[u] || []).forEach(({ to, len }) => { if (dist[u] + len < (dist[to] ?? Infinity)) { dist[to] = dist[u] + len; prev[to] = u; } });
    }
    if (dist[toId] === undefined) return null;
    const ids = [toId]; for (let n = toId; n !== fromId; n = prev[n]) ids.unshift(prev[n]);
    return ids;
  }
  // round the corners a little so the cab doesn't pivot on the spot
  function smooth(pts, it = 2) {
    let p = pts;
    for (let k = 0; k < it; k++) { const q = [p[0]]; for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } q.push(p[p.length - 1]); p = q; }
    return p;
  }

  // ---- UI ----
  const st = document.createElement('style');
  st.textContent = `
    #hailprompt { position: fixed; left: 50%; bottom: 150px; transform: translateX(-50%); z-index: 8; display: none; padding: 10px 18px; border-radius: 22px; background: #ffd21f; color: #111; font: 800 15px system-ui, sans-serif; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
    #hailcard { position: fixed; left: 50%; top: 24%; transform: translateX(-50%); z-index: 30; display: none; width: min(330px, 92vw); padding: 14px 16px; border-radius: 16px; background: rgba(10,14,22,.95); color: #fff; font: 14px system-ui, sans-serif; border-top: 4px solid #ffd21f; }
    #hailcard h3 { margin: 0 0 4px; font-size: 18px; } #hailcard .sub { color: #9fb0c6; font-size: 12px; margin-bottom: 10px; } #hailcard .fare { font-size: 30px; font-weight: 800; color: #7dffa9; margin: 2px 0 10px; }
    #hailcard .btns { display: flex; gap: 8px; } #hailcard button { flex: 1; border: 0; border-radius: 10px; padding: 11px 6px; font: 800 13px system-ui; cursor: pointer; background: rgba(255,255,255,.14); color: #fff; } #hailcard button.go { background: #ffd21f; color: #111; }
    #hailskip { position: fixed; right: 12px; bottom: 30%; z-index: 9; display: none; padding: 10px 14px; border: 0; border-radius: 12px; font: 800 13px system-ui; background: rgba(10,14,22,.85); color: #fff; cursor: pointer; border: 2px solid #ffd21f; }`;
  document.head.appendChild(st);
  const prompt = document.createElement('div'); prompt.id = 'hailprompt'; prompt.textContent = '🚖 Hail a cab (H)'; document.body.appendChild(prompt);
  const card = document.createElement('div'); card.id = 'hailcard'; document.body.appendChild(card);
  const skipBtn = document.createElement('button'); skipBtn.id = 'hailskip'; skipBtn.textContent = '⏭ Skip to destination'; document.body.appendChild(skipBtn);

  // ---- the cab ----
  const cab = buildCarModel('taxi'); cab.visible = false; scene.add(cab);
  const proxy = { x: 0, z: 0, y: 0, heading: 0, speed: 0, vx: 0, vz: 0, isPlayer: true, collisionRadius: 1.2, roll: 0, pitch: 0 };
  let state = 'idle', standT = 0, stop = null, pts = null, cum = null, total = 0, s = 0, v = 0, trip = null, lastY = 0;
  const ptAt = d => {
    let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
    const a = pts[i - 1], b = pts[i], l = (cum[i] - cum[i - 1]) || 1, t = Math.max(0, Math.min(1, (d - cum[i - 1]) / l));
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l };
  };
  const setPath = p => { pts = p; cum = [0]; for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); total = cum[cum.length - 1]; s = 0; };
  const place = (x, z, h) => { lastY = heightAt(x, z, lastY); cab.position.set(x, lastY, z); cab.rotation.y = h; proxy.x = x; proxy.z = z; proxy.y = lastY; proxy.heading = h; };
  const footPose = () => world._dbg.foot;

  function hail() {
    const f = footPose(), r = nearestOnRoad(f.x, f.z, 40); if (!r) { toast('No road close enough to hail a cab here'); return; }
    // the kerb on the walker's side; the cab arrives driving so that side is on its right
    const nx = f.x - r.x, nz = f.z - r.z; let dx = r.dx, dz = r.dz;
    if (dz * nx - dx * nz < 0) { dx = -dx; dz = -dz; }
    const side = Math.sign(dz * nx - dx * nz) || 1, nl = Math.hypot(nx, nz) || 1, off = Math.max(1.8, (r.e.width || 12) / 2 - 2.6);
    const sx = r.x + (nx / nl) * off, sz = r.z + (nz / nl) * off, h = Math.atan2(dx, dz);
    const back = Math.min(70, 25 + (r.e.width || 12) * 2.5), startx = sx - dx * back, startz = sz - dz * back;
    stop = { x: sx, z: sz, h, dx, dz, edge: r };
    setPath([[startx, startz], [sx, sz]]); v = 7; place(startx, startz, h); cab.visible = true;
    state = 'arriving'; world.setFootFrozen(true); prompt.style.display = 'none'; toast('A cab is on its way...');
  }
  function askDestination() {
    state = 'pick'; world.setAvatarVisible(false); cab.visible = true;
    minimap.pick('Where to?', dest => { if (state === 'pick') quote(dest); });
    const t = setInterval(() => { if (state !== 'pick') { clearInterval(t); return; } if (!minimap.isFullOpen()) { clearInterval(t); if (state === 'pick') cancel('Cab cancelled'); } }, 300);
  }
  function quote(dest) {
    const a = nearestNode(stop.x, stop.z), snap = nearestOnRoad(dest.x, dest.z), b = snap ? nearestNode(snap.x, snap.z) : null;
    const ids = a && b ? route(a, b) : null;
    if (!ids || ids.length < 2) { cancel('No route to there'); return; }
    let p = [[stop.x, stop.z]]; ids.forEach(id => p.push([nodes[id].x, nodes[id].z]));
    // drive off in the direction of travel rather than doubling back along the street we are standing on
    p = p.filter((q, i) => i === 0 || Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) > 0.5);
    let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    const fare = Math.max(8, Math.round((12 + L * 0.16) * 0.9));
    trip = { p, L, fare, dest: snap ? { x: snap.x, z: snap.z, nx: dest.x - snap.x, nz: dest.z - snap.z } : dest };
    state = 'confirm';
    card.innerHTML = `<h3>Cab ride</h3><div class="sub">About ${Math.round(L * 1.25)} m by road, ${Math.max(1, Math.round(L / 16 / 60))} min</div><div class="fare">$${fare}</div><div class="btns"><button data-a="cancel">Cancel</button><button data-a="skip">Skip ahead</button><button class="go" data-a="ride">Take the ride</button></div>`;
    card.style.display = 'block'; minimap.setFull(false);
  }
  function cancel(msg) {
    card.style.display = 'none'; skipBtn.style.display = 'none'; cab.visible = false; state = 'idle'; standT = -2;
    world.setFootFrozen(false); world.setAvatarVisible(true); if (msg) toast(msg);
  }
  function begin(skip) {
    if (!world.spend(trip.fare)) { return; }
    card.style.display = 'none';
    setPath(smooth(trip.p, 2)); v = 0; place(trip.p[0][0], trip.p[0][1], stop.h);
    if (skip) { finish(); return; }
    state = 'ride'; skipBtn.style.display = 'block'; camPos = null;
  }
  function finish() {
    const d = trip.dest, n = Math.hypot(d.nx || 0, d.nz || 0) || 1;
    const kx = d.x + (d.nx || 0) / n * 5, kz = d.z + (d.nz || 0) / n * 5;
    skipBtn.style.display = 'none'; cab.visible = false; state = 'idle'; standT = -3;
    world.placeFoot(kx, kz, Math.atan2(d.nx || 0, d.nz || 0));
    world.setFootFrozen(false); world.setAvatarVisible(true);
    toast('You have arrived - fare $' + trip.fare);
  }
  card.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.a === 'cancel') cancel('Cab cancelled'); else begin(b.dataset.a === 'skip'); });
  skipBtn.addEventListener('click', () => { if (state === 'ride') finish(); });
  prompt.addEventListener('click', () => { if (state === 'idle' && prompt.style.display === 'block') hail(); });
  addEventListener('keydown', e => { if (e.code === 'KeyH' && !e.repeat && state === 'idle' && prompt.style.display === 'block') hail(); else if (e.code === 'Escape' && state === 'confirm') cancel('Cab cancelled'); });

  let camPos = null;
  function update(dt, canHail) {
    const f = footPose();
    if (state === 'idle') {
      const pav = (() => { heightAt(f.x, f.z, f.y); return heightAt.kind === 'curb' || heightAt.kind === 'plaza'; })();
      if (canHail && world.onFoot && world.mode === 'city' && !world.modal && Math.abs(f.speed || 0) < 0.05 && pav) standT += dt; else standT = Math.min(0, standT) + (standT < 0 ? dt : 0);
      prompt.style.display = standT > 1.2 ? 'block' : 'none';
      return;
    }
    prompt.style.display = 'none';
    if (state === 'arriving') {
      const rem = total - s, vt = Math.min(13, Math.sqrt(Math.max(0, 2 * 3.2 * rem)) + 0.8);
      v += (vt - v) * Math.min(1, dt * 2.5); s = Math.min(total, s + v * dt);
      const p = ptAt(s); place(p.x, p.z, stop.h);
      if (total - s < 0.15) { s = total; v = 0; askDestination(); }
    } else if (state === 'ride') {
      // slow for corners: look ahead and ease off by how much the road turns
      const a = ptAt(s + 4), b = ptAt(s + 20); let turn = Math.abs(Math.atan2(a.dx * b.dz - a.dz * b.dx, a.dx * b.dx + a.dz * b.dz));
      const vt = Math.max(4.5, 15.5 - turn * 14) * Math.min(1, 0.35 + (total - s) / 25);
      v += (vt - v) * Math.min(1, dt * 1.8); s = Math.min(total, s + v * dt);
      const p = ptAt(s), q = ptAt(Math.min(total, s + 5)); const h = Math.atan2(q.dx, q.dz);
      let dh = h - cab.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      place(p.x, p.z, cab.rotation.y + dh * Math.min(1, dt * 6)); proxy.speed = v; proxy.vx = Math.sin(cab.rotation.y) * v; proxy.vz = Math.cos(cab.rotation.y) * v;
      if (total - s < 0.3) finish();
    }
  }
  // the camera while riding: a chase view behind the cab
  function updateCamera(dt) {
    const h = cab.rotation.y, want = new THREE.Vector3(cab.position.x - Math.sin(h) * 8.5, cab.position.y + 3.6, cab.position.z - Math.cos(h) * 8.5);
    if (!camPos) camPos = want.clone(); camPos.lerp(want, 1 - Math.pow(0.002, dt));
    camera.position.copy(camPos); camera.up.set(0, 1, 0); camera.lookAt(cab.position.x, cab.position.y + 1.3, cab.position.z);
  }
  return { update, updateCamera, proxy, state: () => state, busy: () => state !== 'idle', riding: () => state === 'ride' || state === 'arriving' || state === 'pick' || state === 'confirm', following: () => state === 'ride' || state === 'arriving', cabCam: () => state === 'ride' };
}
