// Bus job: stop in the depot yard to start a shift. You get a city bus and one of the bus lines; drive the loop and stop at each
// bus stop (blue beam on the world and map) for a moment: passengers get on and pay. A full loop pays a bonus.
// Stopping in the depot yard again ends the shift and gives you your own car back.
import * as THREE from 'three';

const PER_PAX = 9, LOOP_BONUS = 450;

export function createBusJob({ transit, nodes = {}, scene, taxi, setBody, restoreBody, toast = () => {} }) {
  const depot = transit && transit.depot, lines = ((transit && transit.lines) || []).filter(l => !l.tram);
  const none = { active: false, update() {}, mapExtras: () => null, end() {}, nearDepot: () => false };
  if (!depot || !lines.length) return none;

  // ---- HUD ----
  const css = document.createElement('style');
  css.textContent = `#busjob { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 6; display: none; align-items: center; gap: 10px;
      background: rgba(14,18,26,.72); color: #fff; padding: 6px 12px 6px 8px; border-radius: 16px; font: 13px system-ui, sans-serif; border: 1px solid rgba(255,255,255,.18); max-width: min(92vw, 420px); }
    #busjob .arrow { width: 46px; height: 46px; flex: none; } #busjob .arrow svg { width: 100%; height: 100%; filter: drop-shadow(0 1px 2px #000); }
    #busjob .t1 { font-weight: 700; font-size: 14px; } #busjob .t2 { opacity: .85; font-size: 12px; } #busjob .t3 { opacity: .7; font-size: 11px; }
    #busjob button { pointer-events: auto; border: 0; border-radius: 8px; background: rgba(255,255,255,.14); color: #fff; font-size: 14px; padding: 4px 8px; }
    html.touch #busjob { top: 40px; }`;
  document.head.appendChild(css);
  const hud = document.createElement('div'); hud.id = 'busjob';
  hud.innerHTML = `<div class="arrow"><svg viewBox="-50 -50 100 100"><path d="M0 -40 L30 25 L0 12 L-30 25 Z" fill="#4aa3ff" stroke="#fff" stroke-width="5" stroke-linejoin="round"/></svg></div>
    <div><div class="t1"></div><div class="t2"></div><div class="t3"></div></div><button class="skip" title="Skip this stop">Skip</button><button class="off" title="End the shift (or stop in the depot)">End</button>`;
  document.body.appendChild(hud);
  const svg = hud.querySelector('svg'), t1 = hud.querySelector('.t1'), t2 = hud.querySelector('.t2'), t3 = hud.querySelector('.t3');

  // ---- beam on the next stop ----
  const beam = new THREE.Group();
  beam.add(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 34, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.24, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })));
  beam.children[0].position.y = 17;
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.1, 40), new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; beam.add(ring); beam.visible = false; scene.add(beam);

  // ---- depot yard test ----
  const cs = Math.cos(depot.h), sn = Math.sin(depot.h);
  const inYard = (x, z) => { const dx = x - depot.x, dz = z - depot.z, u = dx * cs + dz * sn, v = -dx * sn + dz * cs; return Math.abs(u) < depot.hw - 1.5 && Math.abs(v) < depot.hd - 1; };

  let state = 'off', line = null, seq = [], k = 0, dwell = 0, pax = 0, earned = 0, stops = 0, loops = 0, depotT = 0, depotLock = true, route = [], hint = 0;
  const orderStops = l => {
    const byKey = new Map(); (l.stops || []).forEach(s => byKey.set(s.key, s));
    return l.steps.map(st => byKey.get(st.edge.id + '>' + st.from)).filter((s, i, a) => s && a.indexOf(s) === i);
  };
  let lineNo = -1;
  function start(car) {
    if (taxi.active) taxi.setEnabled(false, car);
    for (let tries = 0; tries < lines.length; tries++) { lineNo = (lineNo + 1) % lines.length; seq = orderStops(lines[lineNo]); if (seq.length >= 2) break; }
    line = lines[lineNo];
    if (!line || seq.length < 2) { toast('No bus line has stops to serve'); return; }
    // begin with the stop closest to the depot gate
    let bi = 0, bd = 1e18; seq.forEach((s, i) => { const d = Math.hypot(s.x - depot.x, s.z - depot.z); if (d < bd) { bd = d; bi = i; } });
    k = bi; dwell = 0; pax = 0; earned = 0; stops = 0; loops = 0; state = 'run';
    route = (line.nodes || []).map(id => { const n = nodes[id]; return n ? [n.x, n.z] : null; }).filter(Boolean);
    setBody('bus');
    toast('Bus shift started - ' + line.name + ' line. Drive to the blue stop');
  }
  function end(car, msg) {
    if (state === 'off') return;
    state = 'off'; beam.visible = false; hud.style.display = 'none'; restoreBody();
    if (msg !== ' ') toast(msg || ('Shift over - earned $' + earned + ' (' + stops + ' stops)'));
  }
  hud.querySelector('.off').addEventListener('click', () => end());
  hud.querySelector('.skip').addEventListener('click', () => { if (state === 'run') { k = (k + 1) % seq.length; dwell = 0; } });

  function update(dt, car, onFoot) {
    if (onFoot) { depotT = 0; return; }
    const inside = inYard(car.x, car.z);
    if (!inside) { depotLock = false; depotT = 0; if (state === 'off' && Math.hypot(car.x - depot.x, car.z - depot.z) < 60 && hint <= 0) { hint = 40; toast('Bus depot: stop in the yard to start a bus shift'); } hint -= dt; }
    else if (Math.abs(car.speed) < 1.0 && !depotLock) {
      depotT += dt;
      if (depotT > 1.2) { depotLock = true; depotT = 0; if (state === 'off') start(car); else end(car); }
    } else if (inside && Math.abs(car.speed) >= 1.0) depotT = 0;
    if (state !== 'run') return;
    const s = seq[k], d = Math.hypot(s.x - car.x, s.z - car.z);
    beam.visible = true; beam.position.set(s.x, (car.y || 0) - 0.1 < 0 ? 0 : car.y, s.z);
    const a = Math.atan2(s.x - car.x, s.z - car.z) - car.heading;      // forward = (sin h, cos h); left turn = +h
    svg.style.transform = `rotate(${-a}rad)`;
    t1.textContent = '🚌 ' + line.name + ': next stop ' + (s.name || ('#' + (k + 1)));
    t2.textContent = d < 9 ? (Math.abs(car.speed) < 1.2 ? 'Boarding…' : 'Stop the bus at the shelter') : Math.round(d * 1.72) + ' m';
    t3.textContent = 'Earned $' + earned + ' · ' + stops + ' stops · ' + loops + ' loops';
    hud.style.display = 'flex';
    if (d < 9 && Math.abs(car.speed) < 1.2) {
      dwell += dt;
      if (dwell > 1.4) {
        dwell = 0; const n = 2 + Math.floor(Math.random() * 11), pay = n * PER_PAX; pax = n; earned += pay; stops++; taxi.addCash(pay);
        toast('+' + n + ' passengers  +$' + pay);
        k = (k + 1) % seq.length;
        if (k === 0 || (stops > 0 && stops % seq.length === 0)) { loops++; earned += LOOP_BONUS; taxi.addCash(LOOP_BONUS); toast('Loop complete! Bonus +$' + LOOP_BONUS); }
      }
    } else dwell = Math.max(0, dwell - dt);
  }
  return {
    get active() { return state === 'run'; },
    update, end,
    nearDepot: (x, z) => inYard(x, z),
    mapExtras() { if (state !== 'run') return null; const s = seq[k]; return { markers: [{ x: s.x, z: s.z, color: '#4aa3ff', label: 'B' }], route }; }
  };
}
