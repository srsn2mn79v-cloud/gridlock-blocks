// Studio: transit editor. Bus lines are loops: click the map to drop stops, the bus follows the shortest roads between them and
// comes back another way. Metro lines are a row of stations (an entrance building beside the nearest avenue); you ride between the
// stations of a line. "Check" runs the game's own line builder so you see problems here, not in the game.
import { put, h, View, SC, S, field, textInput, selectInput, colorInput, distSeg } from './common.js';
import { makeRouter } from '../routeTool.js';
import { buildTransit } from '../transit.js';
import refUrl from './ref-map.png';

const hexStr = n => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);

export function createTransitEditor(ctx) {
  const root = h('div', { class: 'tab races' });
  const canvas = h('canvas'), wrap = h('div', { class: 'cv' }, canvas), side = h('div', { class: 'side' });
  root.append(wrap, side);
  const img = new Image(); img.src = refUrl; img.onload = () => view.redraw();
  let kind = 'bus', sel = 0, addMode = true, drag = null, router = null, routeCache = null, cityRef = null, note = '';
  const T = () => { const t = (ctx.custom().transit ||= {}); t.bus ||= []; t.metro ||= []; return t; };
  const lines = () => T()[kind];
  const cur = () => lines()[sel];
  const pts = l => (kind === 'bus' ? l.stops : l.stations.map(s => s.at));
  const X0 = () => ctx.map().origin[0], Y0 = () => ctx.map().origin[1];
  const toPx = p => [X0() - p[0] / S, Y0() - p[1] / S], toWorld = (X, Y) => [-(X - X0()) * S, (Y0() - Y) * S];
  const view = new View(canvas, draw);
  const sc = p => view.toScreen(...toPx(p));
  const rd = v => Math.round(v * 10) / 10;

  function getRoute() {
    const l = cur(); if (!l || kind !== 'bus') return null;
    const city = ctx.cityIfBuilt(); if (!city) return null;
    if (city !== cityRef) { cityRef = city; router = makeRouter(city.roadNodes, city.roadEdges); routeCache = null; }
    if (!routeCache) routeCache = l.stops.length >= 2 ? router.route(l.stops, true) : null;
    return routeCache;
  }
  const changed = () => { routeCache = null; note = ''; ctx.dirty('transit'); renderSide(); view.redraw(); };

  function draw(c) {
    c.fillStyle = '#12161c'; c.fillRect(0, 0, view.w, view.h);
    if (img.complete && img.naturalWidth) { const [x0, y0] = view.toScreen(0, 0); c.globalAlpha = 0.4; c.drawImage(img, x0, y0, img.naturalWidth * SC * view.k, img.naturalHeight * SC * view.k); c.globalAlpha = 1; }
    const city = ctx.cityIfBuilt();
    if (!city) { c.fillStyle = '#fff'; c.font = '16px system-ui'; c.fillText('Building the road network from your map...', 30, 40); return; }
    const N = city.roadNodes;
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1.2; c.beginPath();
    city.roadEdges.forEach(e => { if (!N[e.from] || !N[e.to]) return; const a = sc([N[e.from].x, N[e.from].z]), b = sc([N[e.to].x, N[e.to].z]); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }); c.stroke();
    // the other lines of this kind, faint, so you can see what already runs where
    lines().forEach((l, i) => { if (i === sel) return; c.strokeStyle = hexStr(l.color ?? 0x888888) + '88'; c.lineWidth = 3; c.beginPath(); pts(l).forEach((p, k) => { const q = sc(p); k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.stroke(); });
    const l = cur(); if (!l) return;
    const col = hexStr(l.color ?? 0xffd21f);
    if (kind === 'bus') {
      const route = getRoute();
      if (route) {
        c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = col; c.lineWidth = 4;
        route.segs.forEach(s => { c.beginPath(); s.pts.forEach((p, i) => { const q = sc(p); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.stroke(); });
      }
    } else if (l.stations.length >= 2) {
      c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = col; c.lineWidth = 5; c.setLineDash([10, 6]); c.beginPath();
      l.stations.forEach((s, i) => { const q = sc(s.at); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.stroke(); c.setLineDash([]);
    }
    pts(l).forEach((p, i) => {
      const [x, y] = sc(p);
      c.fillStyle = col; c.strokeStyle = '#000'; c.lineWidth = 1.5;
      if (kind === 'metro') { c.fillRect(x - 10, y - 10, 20, 20); c.strokeRect(x - 10, y - 10, 20, 20); } else { c.beginPath(); c.arc(x, y, 10, 0, 7); c.fill(); c.stroke(); }
      c.fillStyle = '#fff'; c.font = 'bold 11px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), x, y + 0.5);
      if (kind === 'metro' && l.stations[i].name) { c.textAlign = 'left'; c.fillText(l.stations[i].name, x + 14, y - 10); }
    });
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }

  function hit(mx, my) { const l = cur(); if (!l) return -1; let b = -1, bd = 14; pts(l).forEach((p, i) => { const q = sc(p), d = Math.hypot(q[0] - mx, q[1] - my); if (d < bd) { bd = d; b = i; } }); return b; }
  const setPt = (l, i, w) => { if (kind === 'bus') l.stops[i] = w; else l.stations[i].at = w; };
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    const [mx, my] = view.mouse(e), l = cur(), [wx, wy] = view.toWorld(mx, my), w = toWorld(wx, wy).map(rd);
    const i = hit(mx, my);
    if (e.button === 2) { if (l && i >= 0) { (kind === 'bus' ? l.stops : l.stations).splice(i, 1); changed(); } return; }
    if (i >= 0) { drag = i; return; }
    if (l && addMode && e.button === 0) { if (kind === 'bus') l.stops.push(w); else l.stations.push({ at: w, name: '' }); changed(); return; }
    view.panStart(e);
  });
  addEventListener('mousemove', e => {
    if (drag != null) { const l = cur(), [mx, my] = view.mouse(e), [wx, wy] = view.toWorld(mx, my); if (l) { setPt(l, drag, toWorld(wx, wy).map(rd)); routeCache = null; ctx.dirty('transit'); view.redraw(); } return; }
    view.panMove(e);
  });
  addEventListener('mouseup', () => { if (drag != null) { drag = null; renderSide(); } view.panEnd(); });

  function check() {
    const city = ctx.cityIfBuilt(); const l = cur(); if (!city || !l) return;
    note = 'Checking...'; renderSide();
    setTimeout(() => {
      try {
        const t = buildTransit(city, kind === 'bus' ? { bus: [JSON.parse(JSON.stringify(l))], metro: [] } : { bus: [], metro: [JSON.parse(JSON.stringify(l))] });
        if (kind === 'bus') {
          const ln = t.lines.find(q => q.custom);
          note = ln ? `Works: the bus loop is ${(ln.length * 1.25 / 1000).toFixed(1)} km with ${(ln.stops || []).length} stops.` : (t.problems[0] || 'This line cannot be built.');
        } else {
          const m = t.metro.lines[0];
          note = m && m.stations.length >= 2 ? `Works: ${m.stations.length} of ${l.stations.length} stations found free ground.` + (t.problems.length ? ' Problems: ' + t.problems.join('; ') : '') : (t.problems.join('; ') || 'Needs at least two stations with free ground beside an avenue.');
        }
      } catch (e) { note = 'Check failed: ' + e.message; }
      renderSide();
    }, 30);
  }
  function importGame() {
    const city = ctx.cityIfBuilt(); if (!city) return;
    const t = buildTransit(city), TT = T();
    if (kind === 'bus') t.lines.forEach(l => TT.bus.push({ name: l.name, color: l.color, stops: (l.stops || []).map(s => [rd(s.x), rd(s.z)]) }));
    else t.metro.lines.forEach(l => TT.metro.push({ name: l.name, color: l.color, stations: l.stations.map(s => ({ name: s.name, at: [rd(s.x), rd(s.z)] })) }));
    sel = 0; changed();
  }

  function renderSide() {
    const l = cur();
    put(side,
      h('h3', {}, 'Transit'),
      h('div', { class: 'row' }, ['bus', 'metro'].map(k => h('button', { class: 'btn' + (kind === k ? ' pri' : ''), onclick: () => { kind = k; sel = 0; routeCache = null; note = ''; renderSide(); view.redraw(); } }, k === 'bus' ? 'Bus lines' : 'Metro lines'))),
      h('div', { class: 'list' }, lines().map((x, i) => h('div', { class: 'li' + (i === sel ? ' on' : ''), onclick: () => { sel = i; routeCache = null; note = ''; renderSide(); view.redraw(); } }, h('b', { style: 'color:' + hexStr(x.color ?? 0xffd21f) }, '● '), x.name || 'Line ' + (i + 1), ' (' + pts(x).length + ')'))),
      h('div', { class: 'row' },
        h('button', { class: 'btn pri', onclick: () => { lines().push(kind === 'bus' ? { name: 'My bus line ' + (lines().length + 1), color: 0xff7a1a, stops: [] } : { name: 'My metro line ' + (lines().length + 1), color: 0x8e44ad, stations: [] }); sel = lines().length - 1; addMode = true; changed(); } }, 'New line'),
        l ? h('button', { class: 'btn danger', onclick: () => { lines().splice(sel, 1); sel = Math.max(0, sel - 1); changed(); } }, 'Delete') : null,
        !lines().length ? h('button', { class: 'btn', onclick: importGame }, "Start from the game's lines") : null),
      l ? h('div', { class: 'props' },
        field('Name', textInput(l.name, v => { l.name = v; ctx.dirty('transit'); }, '150px')),
        field('Colour', colorInput(l.color ?? 0xff7a1a, v => { l.color = v; ctx.dirty('transit'); view.redraw(); })),
        kind === 'metro' ? l.stations.map((s, i) => field('Station ' + (i + 1), textInput(s.name || '', v => { s.name = v; ctx.dirty('transit'); view.redraw(); }, '150px'), '')) : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn' + (addMode ? ' pri' : ''), onclick: () => { addMode = !addMode; renderSide(); } }, addMode ? 'Placing (click the map)' : 'Click to place'),
          h('button', { class: 'btn', onclick: () => { (kind === 'bus' ? l.stops : l.stations).reverse(); changed(); } }, 'Reverse'),
          h('button', { class: 'btn', onclick: check }, 'Check')),
        note ? h('p', { class: 'hint' + (note.startsWith('Works') ? '' : ' warn') }, note) : null) : h('p', { class: 'hint' }, 'Make a new line, then click on the map.'),
      h('p', { class: 'hint' }, kind === 'bus'
        ? 'Click the map to add stops in order. The bus drives the shortest avenues between them and returns another way (a loop). It cannot cross its own route or turn back on itself - "Check" tells you. Your lines replace the four built-in ones.'
        : 'Click the map to add stations in order; each gets an entrance building beside the nearest avenue. In the game walk up to an entrance and press E to ride to any other station on the line ($3).'),
      h('p', { class: 'hint' }, 'Drag a point to move it, right-click to delete. Press "Save" (top right), then play.')
    );
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
