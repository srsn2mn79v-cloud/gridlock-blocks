// Taxi job: a passenger waits at the kerb somewhere in town (yellow beam on the world and map),
// you stop next to them, then drive to the drop-off (green beam). A guide at the top of the screen
// shows an arrow for the way along the road network (it swings toward a turn as the turn
// approaches), the next manoeuvre and the distance left. Faster, smoother trips pay more.
//
// Route finding is plain Dijkstra over the road graph (one-way streets respected); the guide
// re-plans a few times a second so missing a turn just gives you a new route.
import * as THREE from 'three';
import { buildEdgesByNode, intersectionClearance } from './roadMath.js';
import { hasSidewalks } from './sidewalks.js';
import { pointInPolygon } from './collision.js';
import { computeStopApproaches } from './junctionRules.js';
import { phaseAt } from './signals.js';

const M_PER_U = 1.72;                 // the HUD's km/h implies 1 world unit = 1.72 m
const STORE = 'gridlock.cash', PSTORE = 'gridlock.taxiProfile';
const fmtDist = u => {
  const m = u * M_PER_U;
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.max(10, Math.round(m / 10) * 10) + ' m';
};

export function createTaxi({ city, scene, heightAt, snowing = () => false }) {
  const nodes = city.roadNodes, edges = city.roadEdges;
  const byNode = buildEdgesByNode(edges);
  const buildings = (city.parcels || []).filter(p => p.type === 'building' || p.type === 'water');

  // ---- road graph ----------------------------------------------------------------------
  const adj = {};
  edges.forEach(e => {
    const a = nodes[e.from], b = nodes[e.to];
    if (!a || !b) return;
    const len = Math.hypot(a.x - b.x, a.z - b.z);
    (adj[e.from] ||= []).push({ to: e.to, len });
    if (!e.oneWay) (adj[e.to] ||= []).push({ to: e.from, len });
  });

  function dijkstra(startCost, endCost) {
    const dist = {}, prev = {}, done = new Set();
    Object.keys(startCost).forEach(n => { dist[n] = startCost[n]; });
    for (;;) {
      let u = null, best = Infinity;
      for (const n in dist) if (!done.has(n) && dist[n] < best) { best = dist[n]; u = n; }
      if (u === null) break;
      done.add(u);
      (adj[u] || []).forEach(({ to, len }) => {
        if (dist[u] + len < (dist[to] ?? Infinity)) { dist[to] = dist[u] + len; prev[to] = u; }
      });
    }
    let bestEnd = null, bestTotal = Infinity;
    for (const n in endCost) {
      const t = (dist[n] ?? Infinity) + endCost[n];
      if (t < bestTotal) { bestTotal = t; bestEnd = n; }
    }
    if (bestEnd === null) return null;
    const path = [];
    for (let n = bestEnd; n !== undefined; n = prev[n]) { path.unshift(n); if (startCost[n] !== undefined && prev[n] === undefined) break; }
    return { path, total: bestTotal };
  }

  function nearestEdge(x, z) {
    let best = null, bd = Infinity;
    edges.forEach(e => {
      const a = nodes[e.from], b = nodes[e.to];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  }

  // Route from a car position/heading to a kerb spot on `targetEdge`. Returns polyline points.
  function planRoute(px, pz, heading, target) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const behind = n => ((n.x - px) * fx + (n.z - pz) * fz) < 0 ? 80 : 0;
    const startCost = {};
    const own = nearestEdge(px, pz);
    const consider = (id, forced) => {
      const n = nodes[id];
      const d = Math.hypot(n.x - px, n.z - pz);
      if (!forced && d > 70) return;
      const c = d + behind(n);
      if (startCost[id] === undefined || c < startCost[id]) startCost[id] = c;
    };
    Object.keys(nodes).forEach(id => consider(id, false));
    if (own) { if (!(own.oneWay && false)) { consider(own.from, true); consider(own.to, true); } }
    const te = target.edge;
    const endCost = {};
    const tFrom = nodes[te.from], tTo = nodes[te.to];
    endCost[te.from] = Math.hypot(tFrom.x - target.x, tFrom.z - target.z);
    if (!te.oneWay) endCost[te.to] = Math.hypot(tTo.x - target.x, tTo.z - target.z);
    const res = dijkstra(startCost, endCost);
    const pts = [[px, pz]];
    let total = Infinity;
    if (res) { res.path.forEach(id => pts.push([nodes[id].x, nodes[id].z])); total = res.total; }
    // driving straight along the same street to the spot
    if (own === te) {
      const direct = Math.hypot(target.x - px, target.z - pz) + behind(target);
      if (direct <= total + 20) { pts.length = 1; total = direct; }
    }
    pts.push([target.x, target.z]);
    return pts;
  }

  // ---- infraction detection: stop lines of signals and stop signs --------------------------------
  const approaches = [];
  function addApproach(nodeId, e, kind, sig) {
    const n = nodes[nodeId], o = nodes[e.from === nodeId ? e.to : e.from];
    if (!n || !o) return;
    const len = Math.hypot(o.x - n.x, o.z - n.z) || 1;
    approaches.push({ kind, sig, x: n.x, z: n.z, ux: (o.x - n.x) / len, uz: (o.z - n.z) / len, elev: n.elevation || 0,
      clear: intersectionClearance(nodeId, e, byNode) + 1, half: (e.width || 9) / 2 + 1, min: Infinity, prev: null });
  }
  (city.signals || []).forEach(sg => {
    const e = edges.find(x => x.id === sg.edgeId) || edges.find(x => (x.from === sg.approachFrom && x.to === sg.approachTo) || (x.to === sg.approachFrom && x.from === sg.approachTo));
    if (e) addApproach(sg.nodeId, e, 'signal', sg);
  });
  computeStopApproaches(city).stops.forEach(k => {
    const [nid, eid] = k.split('|');
    const e = edges.find(x => x.id === eid);
    if (e) addApproach(nid, e, 'stop');
  });
  function checkInfractions(car) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading), now = performance.now();
    for (const a of approaches) {
      const dx = car.x - a.x, dz = car.z - a.z;
      const s = dx * a.ux + dz * a.uz, lat = Math.abs(dx * a.uz - dz * a.ux);
      if (lat > a.half || s > 60 || s < -8 || Math.abs(a.elev - (car.y || 0)) > 3.5 || fx * a.ux + fz * a.uz > -0.3) { a.min = Infinity; a.prev = null; continue; }
      const sc = s - a.clear;
      if (sc > 0 && sc < 18) a.min = Math.min(a.min, Math.abs(car.speed));
      if (a.prev !== null && a.prev > 0 && sc <= 0) {
        if (a.kind === 'signal') { if (phaseAt(a.sig, now) === 'red') { inf.red++; toast('Ran a red light!', true); } }
        else if (a.min > 1.6) { inf.stop++; toast('Rolled through a stop sign!', true); }
        a.min = Infinity;
      }
      a.prev = sc;
    }
  }

  // ---- fares ------------------------------------------------------------------------------
  const sidewalked = edges.filter(e => e.type !== 'highway' && e.structure === 'surface' && hasSidewalks(e));
  function kerbSpot(minFrom, maxFrom, px, pz, avoid) {
    for (let tries = 0; tries < 200; tries++) {
      const e = sidewalked[Math.floor(Math.random() * sidewalked.length)];
      const a = nodes[e.from], b = nodes[e.to];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const c1 = intersectionClearance(e.from, e, byNode) + 4, c2 = intersectionClearance(e.to, e, byNode) + 4;
      if (len < c1 + c2 + 6) continue;
      const t = (c1 + Math.random() * (len - c1 - c2)) / len;
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      const side = Math.random() < 0.5 ? 1 : -1;
      const off = (e.width || 9) / 2 + 1.1;
      const x = a.x + (b.x - a.x) * t - dz * off * side, z = a.z + (b.z - a.z) * t + dx * off * side;
      const d = Math.hypot(x - px, z - pz);
      if (d < minFrom || d > maxFrom) continue;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < 60) continue;
      if (buildings.some(p => pointInPolygon(x, z, p.footprint))) continue;
      return { x, z, edge: e, dirX: dx, dirZ: dz, side };
    }
    return null;
  }

  // ---- world markers -----------------------------------------------------------------------
  function makeMarker(color) {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 38, 20, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
    );
    beam.position.y = 19;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.4, 4.3, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12;
    g.add(beam, ring);
    g.userData = { beam, ring };
    g.visible = false;
    scene.add(g);
    return g;
  }
  const pickupMarker = makeMarker(0xffd400), dropMarker = makeMarker(0x3ddc84);

  // a waiting passenger standing at the pickup, waving
  const passenger = new THREE.Group();
  {
    const col = new THREE.Color().setHSL(Math.random(), 0.6, 0.5);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 1.0, 10), new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 }));
    body.position.y = 1.0;
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0x2c3140, roughness: 0.9 }));
    legs.position.y = 0.3;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe0ac8a, roughness: 0.7 }));
    head.position.y = 1.72;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.75, 6), new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 }));
    arm.geometry.translate(0, 0.37, 0);
    arm.position.set(0.38, 1.4, 0);
    passenger.add(body, legs, head, arm);
    passenger.userData.arm = arm;
    passenger.visible = false;
    passenger.scale.setScalar(0.74);   // 1.44 u = a 1.8 m person, like the pedestrians
    scene.add(passenger);
  }

  // ---- HUD ----------------------------------------------------------------------------------
  const css = document.createElement('style');
  css.textContent = `
    #taxi { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 6; display: none; align-items: center; gap: 10px;
      background: rgba(14,18,26,.72); color: #fff; padding: 6px 12px 6px 8px; border-radius: 16px; font: 13px system-ui, sans-serif;
      border: 1px solid rgba(255,255,255,.18); backdrop-filter: blur(3px); max-width: min(92vw, 420px); }
    #taxi .arrow { width: 46px; height: 46px; flex: none; }
    #taxi .arrow svg { width: 100%; height: 100%; transition: transform .08s linear; filter: drop-shadow(0 1px 2px #000); }
    #taxi .t1 { font-weight: 700; font-size: 14px; }
    #taxi .t2 { opacity: .85; font-size: 12px; }
    #taxi .t3 { opacity: .7; font-size: 11px; }
    #taxi button { pointer-events: auto; border: 0; border-radius: 8px; background: rgba(255,255,255,.14); color: #fff; font-size: 14px; padding: 4px 8px; }
    html.touch #taxi { top: 40px; }
    #cash { position: fixed; top: 34px; left: 12px; z-index: 6; font: 700 15px system-ui, sans-serif; color: #7dffa9; text-shadow: 0 1px 3px #000; display: none; margin-top: 52px; }
    html.touch #cash { margin-top: 28px; }
    #toast { position: fixed; top: 140px; left: 50%; transform: translateX(-50%); z-index: 7; font: 700 18px system-ui, sans-serif; color: #fff;
      background: rgba(20,120,60,.85); padding: 8px 16px; border-radius: 14px; display: none; text-align: center; white-space: nowrap; }
    #cash { pointer-events: auto; cursor: pointer; }
    #fareCard { position: fixed; top: 150px; left: 50%; transform: translateX(-50%); z-index: 8; display: none; background: rgba(14,18,26,.9); color: #fff;
      font: 14px system-ui, sans-serif; padding: 12px 18px; border-radius: 16px; border: 1px solid rgba(255,255,255,.2); text-align: center; min-width: 210px; }
    #fareCard .stars { font-size: 30px; color: #ffd400; letter-spacing: 3px; }
    #fareCard .big { font-size: 20px; font-weight: 700; color: #7dffa9; }
    #fareCard .row { opacity: .85; font-size: 13px; }
    #fareCard .bad { color: #ff9d8a; }
    #profile { position: fixed; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.55); font: 15px system-ui, sans-serif; color: #fff; }
    #profile .box { background: #151b26; border: 1px solid rgba(255,255,255,.2); border-radius: 18px; padding: 18px 22px; min-width: 260px; max-width: 90vw; }
    #profile h2 { margin: 0 0 6px; font-size: 18px; } #profile .stars { font-size: 28px; color: #ffd400; letter-spacing: 3px; }
    #profile table { width: 100%; margin: 8px 0 12px; border-collapse: collapse; } #profile td { padding: 3px 0; } #profile td+td { text-align: right; font-weight: 700; }
    #profile button { width: 100%; border: 0; border-radius: 10px; padding: 9px; font-size: 15px; background: rgba(255,255,255,.16); color: #fff; }
    #toast.bad { background: rgba(150,60,40,.88); }
  `;
  document.head.appendChild(css);
  const hud = document.createElement('div');
  hud.id = 'taxi';
  hud.innerHTML = `<div class="arrow"><svg viewBox="-50 -50 100 100"><path d="M0 -40 L30 25 L0 12 L-30 25 Z" fill="#ffd400" stroke="#fff" stroke-width="5" stroke-linejoin="round"/></svg></div>
    <div><div class="t1"></div><div class="t2"></div><div class="t3"></div></div><button title="Skip this fare">✕</button>`;
  document.body.appendChild(hud);
  const cashEl = document.createElement('div'); cashEl.id = 'cash'; document.body.appendChild(cashEl);
  const cardEl = document.createElement('div'); cardEl.id = 'fareCard'; document.body.appendChild(cardEl);
  let cardT = 0;
  const profEl = document.createElement('div'); profEl.id = 'profile'; document.body.appendChild(profEl);
  function showProfile() {
    const r = avgRating();
    profEl.innerHTML = `<div class="box"><h2>🚕 Driver profile</h2><div class="stars">${prof.ratings.length ? starStr(r) : '☆☆☆☆☆'}</div>
      <div style="opacity:.7;font-size:12px">${prof.ratings.length ? r.toFixed(2) + ' average (last ' + prof.ratings.length + ' fares)' : 'No rated fares yet'}</div>
      <table><tr><td>Fares completed</td><td>${prof.fares}</td></tr><tr><td>Total earnings</td><td>$${prof.earned}</td></tr>
      <tr><td>Most paid ride</td><td>$${prof.best}</td></tr><tr><td>Red lights ran</td><td>${prof.red}</td></tr>
      <tr><td>Stop signs ran</td><td>${prof.stop}</td></tr><tr><td>Crashes</td><td>${prof.crashes}</td></tr></table>
      <div style="opacity:.65;font-size:12px;margin-bottom:10px">Keep your rating at 3★ or better, or passengers get slower to call.</div>
      <button>Close</button></div>`;
    profEl.style.display = 'flex';
    profEl.querySelector('button').onclick = () => { profEl.style.display = 'none'; };
  }
  profEl.addEventListener('click', ev => { if (ev.target === profEl) profEl.style.display = 'none'; });
  const toastEl = document.createElement('div'); toastEl.id = 'toast'; document.body.appendChild(toastEl);
  const arrowSvg = hud.querySelector('svg'), t1 = hud.querySelector('.t1'), t2 = hud.querySelector('.t2'), t3 = hud.querySelector('.t3');
  hud.querySelector('button').addEventListener('click', () => { if (state !== 'off') { clearFare(); state = 'wait'; wait = 0.5; toast('Fare skipped', true); } });

  // ---- driver profile (kept in localStorage) ------------------------------------------------------
  let prof = { fares: 0, earned: 0, best: 0, ratings: [], red: 0, stop: 0, crashes: 0 };
  try { prof = { ...prof, ...JSON.parse(localStorage.getItem(PSTORE) || '{}') }; } catch (e) { /* ignore */ }
  const saveProf = () => { try { localStorage.setItem(PSTORE, JSON.stringify(prof)); } catch (e) { /* ignore */ } };
  const avgRating = () => prof.ratings.length ? prof.ratings.reduce((a, b) => a + b, 0) / prof.ratings.length : 0;
  const starStr = (r, n = 5) => '★'.repeat(Math.round(r)) + '☆'.repeat(n - Math.round(r));
  let cash = 0;
  try { cash = Number(localStorage.getItem(STORE)) || 0; } catch (e) { /* private mode */ }
  const setCash = v => { cash = v; cashEl.textContent = '$' + cash + (prof.ratings.length ? '  ★' + avgRating().toFixed(1) : ''); try { localStorage.setItem(STORE, String(cash)); } catch (e) { /* ignore */ } };
  cashEl.title = 'Driver profile'; cashEl.addEventListener('click', showProfile);
  setCash(cash); cashEl.style.display = 'block';
  let toastT = 0;
  function toast(msg, bad) { toastEl.textContent = msg; toastEl.classList.toggle('bad', !!bad); toastEl.style.display = 'block'; toastT = 3.2; }

  // ---- state machine --------------------------------------------------------------------------
  let state = 'off';            // off | wait | pickup | ride
  const inf = { red: 0, stop: 0, crash: 0 };
  let crashCool = 0;
  let wait = 0, fare = null, route = [], cum = [], routeT = 0, boardT = 0, rideT = 0, lastSpeed = 0, hits = 0, total = 0;

  function clearFare() {
    fare = null; route = []; cum = [];
    pickupMarker.visible = dropMarker.visible = passenger.visible = false;
  }
  function setRoute(pts) {
    route = pts; cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  function placeMarker(m, spot) {
    m.position.set(spot.x, heightAt ? heightAt(spot.x, spot.z) : 0, spot.z);
    m.visible = true;
  }
  function newFare(car) {
    const pick = kerbSpot(70, 380, car.x, car.z);
    if (!pick) { wait = 2; return; }
    const drop = kerbSpot(150, 520, pick.x, pick.z, pick);
    if (!drop) { wait = 2; return; }
    fare = { pick, drop };
    placeMarker(pickupMarker, pick);
    passenger.position.set(pick.x, heightAt ? heightAt(pick.x, pick.z) : 0, pick.z);
    passenger.rotation.y = Math.atan2(pick.dirZ * pick.side, -pick.dirX * pick.side);   // face the road
    passenger.visible = true;
    dropMarker.visible = false;
    state = 'pickup'; routeT = 0; boardT = 0;
    toast('New passenger waiting!');
  }

  function replan(car, spot) { setRoute(planRoute(car.x, car.z, car.heading, spot)); }

  function guide(car) {
    // project the car onto the route, look a little way ahead, and point at that spot
    let bi = 0, bd = Infinity, bt = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const [ax, az] = route[i], [bx, bz] = route[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((car.x - ax) * dx + (car.z - az) * dz) / l2));
      const d = Math.hypot(car.x - (ax + dx * t), car.z - (az + dz * t));
      if (d < bd) { bd = d; bi = i; bt = t; }
    }
    const segLen = cum[bi + 1] - cum[bi];
    const s = cum[bi] + segLen * bt;
    const totalLen = cum[cum.length - 1];
    const look = Math.min(totalLen, s + Math.max(14, Math.min(40, 14 + Math.abs(car.speed) * 1.3)));
    let k = bi; while (k < route.length - 2 && cum[k + 1] < look) k++;
    const l = (look - cum[k]) / ((cum[k + 1] - cum[k]) || 1);
    const tx = route[k][0] + (route[k + 1][0] - route[k][0]) * l, tz = route[k][1] + (route[k + 1][1] - route[k][1]) * l;
    const dx = tx - car.x, dz = tz - car.z;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const a = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);          // negative = target is to the left
    arrowSvg.style.transform = `rotate(${a}rad)`;
    // next real turn on the route
    let turn = null;
    for (let i = 1; i < route.length - 1; i++) {
      if (cum[i] < s - 4) continue;
      const d1x = route[i][0] - route[i - 1][0], d1z = route[i][1] - route[i - 1][1];
      const d2x = route[i + 1][0] - route[i][0], d2z = route[i + 1][1] - route[i][1];
      const l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
      if (l1 < 1 || l2 < 1) continue;
      const cr = (d1x * d2z - d1z * d2x) / (l1 * l2), dt = (d1x * d2x + d1z * d2z) / (l1 * l2);
      const ang = Math.atan2(cr, dt);
      if (Math.abs(ang) > 0.55) { turn = { dist: cum[i] - s, left: ang < 0, uturn: Math.abs(ang) > 2.5 }; break; }
    }
    return { remaining: totalLen - s, turn, off: bd };
  }

  // Fare maths: finishing early adds a speed bonus, infractions cut the fare, and a random tip
  // only drops for a clean, faster-than-expected ride (and not every time, or every size).
  function settle(base, limit) {
    const r = rideT / limit, left = Math.max(0, 1 - r);
    let amount = base * (0.55 + 0.45 * left);
    const speedBonus = r < 0.6 ? Math.round(base * 0.25 * (1 - r / 0.6)) : 0;
    amount = amount * Math.max(0.3, 1 - 0.15 * inf.red - 0.1 * inf.stop) - inf.crash * 4;
    amount = Math.max(Math.round(base * 0.25), Math.round(amount)) + (inf.red + inf.stop + inf.crash === 0 ? speedBonus : 0);
    const clean = inf.red + inf.stop + inf.crash === 0;
    let tip = 0;
    if (clean && r < 1 && Math.random() < 0.4) tip = Math.max(1, Math.round(base * (0.05 + Math.random() * Math.random() * 0.6) * (0.5 + left)));
    const pen = r > 1 ? Math.min(2.5, (r - 1) * 3) : 0;
    const stars = Math.max(1, Math.min(5, Math.round(5 - inf.crash - 1.5 * inf.red - inf.stop - pen)));
    const snow = snowing(), m = snow ? 2 : 1;      // driving in snow pays double
    return { amount: amount * m, tip: tip * m, stars, speedBonus: clean ? speedBonus * m : 0, snow };
  }
  function showCard(res) {
    const rows = [];
    if (inf.red) rows.push(`<div class="row bad">${inf.red} red light${inf.red > 1 ? 's' : ''} ran</div>`);
    if (inf.stop) rows.push(`<div class="row bad">${inf.stop} stop sign${inf.stop > 1 ? 's' : ''} ran</div>`);
    if (inf.crash) rows.push(`<div class="row bad">${inf.crash} crash${inf.crash > 1 ? 'es' : ''}</div>`);
    if (res.stars >= 4 && !rows.length) rows.push('<div class="row">Clean, quick drive</div>');
    if (rideT > fare.limit) rows.push('<div class="row bad">Late arrival</div>');
    if (res.speedBonus) rows.push(`<div class="row">Speed bonus +$${res.speedBonus}</div>`);
    if (res.snow) rows.push('<div class="row" style="color:#9fd8ff">❄ Snow bonus: fare doubled</div>');
    if (res.tip) rows.push(`<div class="row" style="color:#ffd400">Tip +$${res.tip}!</div>`);
    cardEl.innerHTML = `<div class="stars">${starStr(res.stars)}</div><div class="big">+$${res.amount + res.tip}</div>${rows.join('')}`;
    cardEl.style.display = 'block'; cardT = 5;
  }

  function update(dt, car) {
    if (cardT > 0) { cardT -= dt; if (cardT <= 0) cardEl.style.display = 'none'; }
    if (crashCool > 0) crashCool -= dt;
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.style.display = 'none'; }
    if (state === 'off') return;
    // waving passenger / pulsing rings
    const tm = performance.now() / 1000;
    pickupMarker.userData.ring.scale.setScalar(1 + 0.08 * Math.sin(tm * 4));
    dropMarker.userData.ring.scale.setScalar(1 + 0.08 * Math.sin(tm * 4));
    passenger.userData.arm.rotation.z = -2.4 + 0.5 * Math.sin(tm * 7);

    if (state === 'wait') {
      wait -= dt;
      hud.style.display = 'none';
      if (wait <= 0) newFare(car);
      return;
    }
    hud.style.display = 'flex';
    const spot = state === 'pickup' ? fare.pick : fare.drop;
    routeT -= dt;
    if (routeT <= 0) { replan(car, spot); routeT = 0.35; }
    const g = guide(car);
    const dStraight = Math.hypot(car.x - spot.x, car.z - spot.z);
    t1.textContent = state === 'pickup' ? '🚕 Pick up the passenger' : '📍 Take them to the drop-off';
    let line2;
    if (dStraight < 25 && state === 'pickup') line2 = Math.abs(car.speed) < 3 ? 'Boarding…' : 'Slow down and stop next to them';
    else if (dStraight < 25) line2 = 'Stop at the green marker';
    else if (g.turn && g.turn.dist < 220) line2 = (g.turn.uturn ? 'Make a U-turn' : (g.turn.left ? 'Turn left' : 'Turn right')) + ' in ' + fmtDist(g.turn.dist);
    else line2 = 'Continue straight';
    t2.textContent = line2;
    if (state === 'ride') {
      rideT += dt;
      const left = Math.max(0, fare.limit - rideT);
      t3.textContent = fmtDist(g.remaining) + ' left · ' + (left > 0 ? Math.ceil(left) + ' s for full fare' : 'late – fare dropping');
    } else t3.textContent = fmtDist(g.remaining) + ' to pickup';

    // a hard knock hurts the tip
    if (state === 'ride') {
      const hitV = car.impactSpeed > 2.5; car.impactSpeed = 0;
      if (crashCool <= 0 && (hitV || lastSpeed - car.speed > 6)) { inf.crash++; crashCool = 1.5; toast('Crash! −$4', true); }
      checkInfractions(car);
    }
    lastSpeed = car.speed;

    if (dStraight < 11 && Math.abs(car.speed) < 3) {
      boardT += dt;
      if (boardT > (state === 'pickup' ? 1.0 : 0.8)) {
        boardT = 0;
        if (state === 'pickup') {
          state = 'ride'; rideT = 0; inf.red = inf.stop = inf.crash = 0; car.impactSpeed = 0; crashCool = 0; approaches.forEach(a => { a.min = Infinity; a.prev = null; });
          passenger.visible = false; pickupMarker.visible = false;
          placeMarker(dropMarker, fare.drop);
          replan(car, fare.drop);
          total = cum[cum.length - 1];
          fare.base = Math.round(12 + total * 0.16);
          fare.limit = total / 9 + 25;
          routeT = 0.35;
          toast('Passenger on board – fare $' + fare.base);
        } else {
          const res = settle(fare.base, fare.limit);
          const got = res.amount + res.tip;
          prof.fares++; prof.earned += got; prof.best = Math.max(prof.best, got);
          prof.ratings.push(res.stars); if (prof.ratings.length > 20) prof.ratings.shift();
          prof.red += inf.red; prof.stop += inf.stop; prof.crashes += inf.crash; saveProf();
          showCard(res);
          setCash(cash + got);
          clearFare(); state = 'wait'; wait = 3;
          if (avgRating() < 3) { wait = 15 + Math.random() * 15; setTimeout(() => toast('Low rating – passengers are slow to call', true), 5200); }
        }
      }
    } else boardT = 0;
  }

  return {
    update,
    get active() { return state !== 'off'; },
    get debug() { return { state, fare, route, cash }; },
    getCash: () => cash,
    addCash(v) { setCash(Math.max(0, cash + v)); },
    setEnabled(on, car) {
      if (on && state === 'off') { state = 'wait'; wait = 1.5; setCash(cash); cashEl.style.display = 'block'; }
      if (!on && state !== 'off') { clearFare(); state = 'off'; hud.style.display = 'none'; }
    },
    // for the minimap
    mapExtras() {
      if (state === 'off' || !fare) return null;
      const markers = [];
      if (state === 'pickup') markers.push({ x: fare.pick.x, z: fare.pick.z, color: '#ffd400', label: 'P' });
      else markers.push({ x: fare.drop.x, z: fare.drop.z, color: '#3ddc84', label: 'D' });
      return { markers, route };
    }
  };
}
