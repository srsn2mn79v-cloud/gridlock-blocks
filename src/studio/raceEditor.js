// Studio: race editor. Place checkpoints anywhere on the map; the route follows the SHORTEST ROAD PATH between consecutive
// checkpoints. A checkpoint off the road is joined to the nearest road by a straight line, so a badly placed checkpoint makes
// the race cut across grass (drawn dashed). Circuit = closed loop back to checkpoint 1; Sprint = from checkpoint 1 to the last one.
import { put, h, View, SC, S, field, numInput, textInput, selectInput, distSeg } from './common.js';
import { makeRouter } from '../routeTool.js';
import refUrl from './ref-map.png';

export function createRaceEditor(ctx) {
  const root = h('div', { class: 'tab races' });
  const canvas = h('canvas'), wrap = h('div', { class: 'cv' }, canvas), side = h('div', { class: 'side' });
  root.append(wrap, side);
  const img = new Image(); img.src = refUrl; img.onload = () => view.redraw();
  let sel = 0, addMode = true, drag = null, router = null, routeCache = null, cityRef = null;
  const races = () => (ctx.custom().races ||= []);
  const cur = () => races()[sel];
  const X0 = () => ctx.map().origin[0], Y0 = () => ctx.map().origin[1];
  const toPx = p => [X0() - p[0] / S, Y0() - p[1] / S], toWorld = (X, Y) => [-(X - X0()) * S, (Y0() - Y) * S];
  const view = new View(canvas, draw);
  const sc = p => view.toScreen(...toPx(p));

  function getRoute() {
    const r = cur(); if (!r) return null;
    const city = ctx.cityIfBuilt(); if (!city) return null;
    if (city !== cityRef) { cityRef = city; router = makeRouter(city.roadNodes, city.roadEdges); routeCache = null; }
    if (!routeCache) routeCache = r.cps.length >= 2 ? router.route(r.cps, r.kind === 'circuit') : null;
    return routeCache;
  }
  const changed = () => { routeCache = null; ctx.dirty('races'); renderSide(); view.redraw(); };

  function draw(c) {
    c.fillStyle = '#12161c'; c.fillRect(0, 0, view.w, view.h);
    if (img.complete && img.naturalWidth) { const [x0, y0] = view.toScreen(0, 0); c.globalAlpha = 0.4; c.drawImage(img, x0, y0, img.naturalWidth * SC * view.k, img.naturalHeight * SC * view.k); c.globalAlpha = 1; }
    const city = ctx.cityIfBuilt();
    if (!city) { c.fillStyle = '#fff'; c.font = '16px system-ui'; c.fillText('Building the road network from your map...', 30, 40); return; }
    const N = city.roadNodes;
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.2; c.beginPath();
    city.roadEdges.forEach(e => { if (!N[e.from] || !N[e.to]) return; const a = sc([N[e.from].x, N[e.from].z]), b = sc([N[e.to].x, N[e.to].z]); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }); c.stroke();
    const r = cur(); if (!r) return;
    const col = r.kind === 'circuit' ? '#3b82f6' : '#2ee66b', route = getRoute();
    if (route) {
      c.lineCap = 'round'; c.lineJoin = 'round';
      route.segs.forEach(s => {
        c.beginPath(); s.pts.forEach((p, i) => { const q = sc(p); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); });
        if (s.grass) { c.setLineDash([6, 5]); c.strokeStyle = '#ff9f43'; c.lineWidth = 3; } else { c.setLineDash([]); c.strokeStyle = col; c.lineWidth = 4; }
        c.stroke();
      }); c.setLineDash([]);
      // direction chevrons
      let acc = 0; const pts = route.pts.map(sc);
      for (let i = 1; i < pts.length; i++) { const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], l = Math.hypot(dx, dy); acc += l; if (acc > 90 && l > 8) { acc = 0; const mx = (pts[i][0] + pts[i - 1][0]) / 2, my = (pts[i][1] + pts[i - 1][1]) / 2, a = Math.atan2(dy, dx); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(mx + Math.cos(a) * 6, my + Math.sin(a) * 6); c.lineTo(mx + Math.cos(a + 2.5) * 5, my + Math.sin(a + 2.5) * 5); c.lineTo(mx + Math.cos(a - 2.5) * 5, my + Math.sin(a - 2.5) * 5); c.fill(); } }
    } else if (r.cps.length >= 2) { c.beginPath(); r.cps.forEach((p, i) => { const q = sc(p); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.strokeStyle = '#ff9f43'; c.setLineDash([5, 5]); c.stroke(); c.setLineDash([]); }
    r.cps.forEach((p, i) => {
      const [x, y] = sc(p), last = i === r.cps.length - 1 && r.kind === 'sprint' && i > 0;
      const near = router ? router.nearest(p[0], p[1]) : null, grass = near && near.d > 6;
      c.fillStyle = i === 0 ? '#ffd21f' : last ? '#ff4d4d' : col; c.strokeStyle = grass ? '#ff9f43' : '#000'; c.lineWidth = grass ? 3 : 1.5;
      c.beginPath(); c.arc(x, y, 11, 0, 7); c.fill(); c.stroke();
      c.fillStyle = i === 0 ? '#000' : '#fff'; c.font = 'bold 11px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), x, y + 0.5);
      if (i === 0 || last) { c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(i === 0 ? (r.kind === 'circuit' ? 'START / FINISH' : 'START') : 'FINISH', x + 14, y - 10); }
    });
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }

  function hitCp(mx, my) { const r = cur(); if (!r) return -1; let b = -1, bd = 14; r.cps.forEach((p, i) => { const q = sc(p), d = Math.hypot(q[0] - mx, q[1] - my); if (d < bd) { bd = d; b = i; } }); return b; }
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    const [mx, my] = view.mouse(e), r = cur(), [wx, wy] = view.toWorld(mx, my), w = toWorld(wx, wy).map(v => Math.round(v * 10) / 10);
    const i = hitCp(mx, my);
    if (e.button === 2) { if (r && i >= 0) { r.cps.splice(i, 1); changed(); } return; }
    if (i >= 0) { drag = i; return; }
    if (r && e.shiftKey && r.cps.length >= 2) {      // insert into the nearest leg of the route
      const route = getRoute();
      if (route) {
        let best = { d: 1e9, s: 0 }, acc = 0;
        for (let k = 1; k < route.pts.length; k++) { const a = sc(route.pts[k - 1]), b = sc(route.pts[k]), q = distSeg(mx, my, a[0], a[1], b[0], b[1]), pl = Math.hypot(route.pts[k][0] - route.pts[k - 1][0], route.pts[k][1] - route.pts[k - 1][1]); if (q.d < best.d) best = { d: q.d, s: acc + pl * q.t }; acc += pl; }
        let leg = route.cpDist.findIndex(d => d >= best.s); if (leg < 0) leg = route.cpDist.length - 1;
        r.cps.splice(leg + 1, 0, w); changed(); return;
      }
    }
    if (r && addMode && e.button === 0) { r.cps.push(w); changed(); return; }
    view.panStart(e);
  });
  addEventListener('mousemove', e => {
    if (drag != null) { const r = cur(), [mx, my] = view.mouse(e), [wx, wy] = view.toWorld(mx, my); if (r) { r.cps[drag] = toWorld(wx, wy).map(v => Math.round(v * 10) / 10); routeCache = null; ctx.dirty('races'); view.redraw(); } return; }
    view.panMove(e);
  });
  addEventListener('mouseup', () => { if (drag != null) { drag = null; renderSide(); } view.panEnd(); });

  function renderSide() {
    const r = cur(), route = r && getRoute();
    put(side, 
      h('h3', {}, 'Races'),
      h('div', { class: 'list' }, races().map((x, i) => h('div', { class: 'li' + (i === sel ? ' on' : ''), onclick: () => { sel = i; routeCache = null; renderSide(); view.redraw(); } }, (x.kind === 'circuit' ? '◯ ' : '→ ') + (x.name || 'Race') + ' (' + x.cps.length + ')'))),
      h('div', { class: 'row' },
        h('button', { class: 'btn pri', onclick: () => { races().push({ id: Date.now().toString(36), name: 'My race ' + (races().length + 1), kind: 'circuit', laps: 2, cls: 'F', cps: [] }); sel = races().length - 1; addMode = true; changed(); } }, '+ New race'),
        r ? h('button', { class: 'btn', onclick: () => { const c = JSON.parse(JSON.stringify(r)); c.id = Date.now().toString(36); c.name += ' copy'; races().push(c); sel = races().length - 1; changed(); } }, 'Duplicate') : null,
        r ? h('button', { class: 'btn danger', onclick: () => { races().splice(sel, 1); sel = Math.max(0, sel - 1); changed(); } }, 'Delete') : null),
      r ? h('div', { class: 'props' },
        field('Name', textInput(r.name, v => { r.name = v; ctx.dirty('races'); }, '150px')),
        field('Type', selectInput(r.kind, [['circuit', 'Circuit (loop, laps)'], ['sprint', 'Sprint (A to B)']], v => { r.kind = v; changed(); })),
        r.kind === 'circuit' ? field('Laps', numInput(r.laps || 2, v => { r.laps = Math.max(1, Math.min(9, Math.round(v))); ctx.dirty('races'); }, 1, '50px')) : null,
        field('Rivals / purse', selectInput(r.cls || 'F', [['F', 'Class F (easier)'], ['E', 'Class E (faster rivals)']], v => { r.cls = v; ctx.dirty('races'); })),
        h('div', { class: 'row' },
          h('button', { class: 'btn' + (addMode ? ' pri' : ''), onclick: () => { addMode = !addMode; renderSide(); } }, addMode ? 'Placing checkpoints (click map)' : 'Click to place checkpoints'),
          h('button', { class: 'btn', onclick: () => { r.cps.reverse(); changed(); } }, 'Reverse'),
          h('button', { class: 'btn', onclick: () => { r.cps = []; changed(); } }, 'Clear')),
        raceInfo(r, route)) : h('p', { class: 'hint' }, 'Make a new race, then click on the map to drop checkpoints.'),
      h('p', { class: 'hint' }, 'Click the map to add a checkpoint (1 is the start line). Drag a checkpoint to move it, right-click to delete, Shift+click on the route to insert one in between. The route always takes the shortest road path between checkpoints. An orange dashed line is grass: a checkpoint that is off the road makes the route leave it and come back.'),
      h('p', { class: 'hint' }, 'Press "Save" (top right) then play: your races appear in the race menu with the others.')
    );
  }
  function raceInfo(r, route) {
    const need = r.kind === 'circuit' ? 3 : 2;
    if (!ctx.cityIfBuilt()) return h('p', { class: 'hint' }, 'Building the road network...');
    if (r.cps.length < need) return h('p', { class: 'hint warn' }, `Needs at least ${need} checkpoints (${r.cps.length} placed).`);
    if (!route) return null;
    if (route.error) return h('p', { class: 'hint warn' }, route.error);
    return h('p', { class: 'hint' }, `Length ${(route.length * 1.25 / 1000).toFixed(2)} km` + (r.kind === 'circuit' ? ` per lap (${r.laps || 2} laps)` : '') + (route.offRoad ? ` · ${route.offRoad} checkpoint${route.offRoad > 1 ? 's' : ''} off the road: that part of the route crosses grass` : ' · all checkpoints are on roads'));
  }
  view.initial = [0, 0, 1180, 1240];
  renderSide();
  return {
    el: root,
    show() { root.style.display = ''; view.fit(); routeCache = null; renderSide(); view.redraw(); },
    hide() { root.style.display = 'none'; },
    refresh() { routeCache = null; renderSide(); view.redraw(); }
  };
}
