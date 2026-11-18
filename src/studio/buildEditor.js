// Studio: city builder. A toolbar like a city-building game: pick a thing (building, shop, hospital, bus stop, metro station, bus depot ...),
// click the map to place it, right-click to remove, drag to move. Everything is written into the same data the other tabs and the game use.
import { put, h, View, SC, S, distSeg } from './common.js';
import refUrl from './ref-map.png';
import { SHOP_KINDS } from '../chicago/chicago.js';

const CATS = [
  { id: 'build', name: 'Buildings', color: '#e56bb0', tools: [
    { id: 'house', name: 'House', size: [3.2, 3.2], hgt: 9, note: 'a small house' }, { id: 'flats', name: 'Apartment block', size: [7, 5], hgt: 40 },
    { id: 'office', name: 'Office', size: [8, 7], hgt: 70 }, { id: 'tower', name: 'Tower', size: [7, 7], hgt: 140 }, { id: 'hall', name: 'Hall / warehouse', size: [12, 8], hgt: 14 } ] },
  { id: 'shop', name: 'Shops', color: '#ffb02e', tools: Object.keys(SHOP_KINDS).map(k => ({ id: 'shop:' + k, name: k.charAt(0).toUpperCase() + k.slice(1), kind: k })) },
  { id: 'svc', name: 'Services', color: '#ff5555', tools: [
    { id: 'svc:hospital', name: 'Hospital', kind: 'hospital' }, { id: 'svc:police', name: 'Police station', kind: 'police' }, { id: 'svc:fire', name: 'Fire station', kind: 'fire' }, { id: 'gas', name: 'Gas station' } ] },
  { id: 'transit', name: 'Transit', color: '#3aa0ff', tools: [
    { id: 'busstop', name: 'Bus stop', note: 'added to the selected bus line' }, { id: 'metro', name: 'Metro station', note: 'added to the selected metro line' }, { id: 'depot', name: 'Bus depot', note: 'the garage where bus shifts start' } ] }
];
const toolById = {}; CATS.forEach(c => c.tools.forEach(t => { toolById[t.id] = { ...t, cat: c }; }));

export function createBuildEditor(ctx) {
  const root = h('div', { class: 'tab races' });
  const canvas = h('canvas'), wrap = h('div', { class: 'cv' }, canvas), side = h('div', { class: 'side' });
  root.append(wrap, side);
  const img = new Image(); img.src = refUrl; img.onload = () => view.redraw();
  let tool = 'house', mouse = null, drag = null, busSel = 0, metroSel = 0, note = '';
  const M = () => ctx.map();
  const T = () => { const t = (ctx.custom().transit ||= {}); t.bus ||= []; t.metro ||= []; return t; };
  const toWorld = p => [-(p[0] - M().origin[0]) * S, (M().origin[1] - p[1]) * S], toPx = w => [M().origin[0] - w[0] / S, M().origin[1] - w[1] / S];
  const rd = v => Math.round(v * 10) / 10;
  const view = new View(canvas, draw), sc = p => view.toScreen(p[0], p[1]);

  // every placed thing as { kind, px:[x,y], label, color, remove(), move(p) }, so drawing, picking, moving and removing are one code path
  function things() {
    const m = M(), out = [], md = m;
    (md.landmarks || []).forEach((a, i) => out.push({ k: 'build', px: [(a[1] + a[3]) / 2, (a[2] + a[4]) / 2], rect: [a[1], a[2], a[3], a[4]], label: a[0], color: '#e56bb0', remove: () => md.landmarks.splice(i, 1), move: p => { const w = a[3] - a[1], hh = a[4] - a[2]; a[1] = p[0] - w / 2; a[3] = p[0] + w / 2; a[2] = p[1] - hh / 2; a[4] = p[1] + hh / 2; } }));
    (md.shops || []).forEach((s, i) => out.push({ k: 'shop', px: s.at, label: s.kind, color: '#ffb02e', remove: () => md.shops.splice(i, 1), move: p => { s.at = p; } }));
    (md.stations || []).forEach((s, i) => out.push({ k: 'svc', px: s.at, label: s.kind, color: '#ff5555', remove: () => md.stations.splice(i, 1), move: p => { s.at = p; } }));
    (md.gas || []).forEach((g, i) => out.push({ k: 'gas', px: g, label: 'gas', color: '#ff7f2e', remove: () => md.gas.splice(i, 1), move: p => { md.gas[i] = p; } }));
    T().bus.forEach((l, li) => l.stops.forEach((s, i) => out.push({ k: 'busstop', px: toPx(s), label: l.name, color: '#ffd21f', remove: () => l.stops.splice(i, 1), move: p => { l.stops[i] = toWorld(p).map(rd); } })));
    T().metro.forEach((l, li) => l.stations.forEach((s, i) => out.push({ k: 'metro', px: toPx(s.at), label: s.name || l.name, color: '#' + (l.color >>> 0).toString(16).padStart(6, '0').slice(-6), remove: () => l.stations.splice(i, 1), move: p => { s.at = toWorld(p).map(rd); } })));
    const d = T().depot; if (d && d.at) out.push({ k: 'depot', px: toPx(d.at), label: 'bus depot', color: '#9aa7b8', remove: () => { delete T().depot; }, move: p => { d.at = toWorld(p).map(rd); } });
    return out;
  }
  const hitThing = (mx, my) => { let b = null, bd = 14; things().forEach(t => { const q = sc(t.px), d = Math.hypot(q[0] - mx, q[1] - my); if (d < bd) { bd = d; b = t; } }); return b; };

  function draw(c) {
    c.fillStyle = '#12161c'; c.fillRect(0, 0, view.w, view.h);
    if (img.complete && img.naturalWidth) { const [x0, y0] = view.toScreen(0, 0); c.globalAlpha = 0.5; c.drawImage(img, x0, y0, img.naturalWidth * SC * view.k, img.naturalHeight * SC * view.k); c.globalAlpha = 1; }
    const city = ctx.cityIfBuilt();
    if (city) {
      const N = city.roadNodes; c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1; c.beginPath();
      city.roadEdges.forEach(e => { if (!N[e.from] || !N[e.to]) return; const a = sc(toPx([N[e.from].x, N[e.from].z])), b = sc(toPx([N[e.to].x, N[e.to].z])); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }); c.stroke();
    }
    things().forEach(t => {
      const [x, y] = sc(t.px);
      if (t.rect) { const a = sc([t.rect[0], t.rect[1]]), b = sc([t.rect[2], t.rect[3]]); c.fillStyle = t.color + '88'; c.strokeStyle = t.color; c.lineWidth = 1.5; c.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); return; }
      c.fillStyle = t.color; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath();
      if (t.k === 'metro') c.rect(x - 8, y - 8, 16, 16); else if (t.k === 'depot') c.rect(x - 12, y - 8, 24, 16); else c.arc(x, y, t.k === 'busstop' ? 6 : 8, 0, 7);
      c.fill(); c.stroke(); c.fillStyle = '#fff'; c.font = 'bold 10px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText({ metro: 'M', busstop: 'B', depot: 'D', gas: 'G', svc: '+', shop: '$' }[t.k] || '', x, y + 0.5);
    });
    // metro tunnels, so you see what the stations belong to
    T().metro.forEach(l => { if (l.stations.length < 2) return; c.strokeStyle = '#' + (l.color >>> 0).toString(16).padStart(6, '0').slice(-6) + '99'; c.lineWidth = 3; c.setLineDash([8, 6]); c.beginPath(); l.stations.forEach((s, i) => { const q = sc(toPx(s.at)); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.stroke(); c.setLineDash([]); });
    // the ghost under the pointer
    const t = toolById[tool];
    if (mouse && t) {
      c.globalAlpha = 0.6; c.fillStyle = t.cat.color; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
      if (t.size) { const w = t.size[0] * view.k, hh = t.size[1] * view.k; c.fillRect(mouse[0] - w / 2, mouse[1] - hh / 2, w, hh); c.strokeRect(mouse[0] - w / 2, mouse[1] - hh / 2, w, hh); }
      else { c.beginPath(); c.arc(mouse[0], mouse[1], 9, 0, 7); c.fill(); c.stroke(); }
      c.globalAlpha = 1; c.fillStyle = '#fff'; c.font = '11px system-ui'; c.textAlign = 'left'; c.fillText(t.name, mouse[0] + 14, mouse[1] - 8);
    }
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }

  function place(p) {
    const t = toolById[tool]; if (!t) return; const m = M(), w = toWorld(p).map(rd);
    if (t.cat.id === 'build') { m.landmarks.push([t.name, rd(p[0] - t.size[0] / 2), rd(p[1] - t.size[1] / 2), rd(p[0] + t.size[0] / 2), rd(p[1] + t.size[1] / 2), t.hgt]); ctx.dirty('map'); }
    else if (t.cat.id === 'shop') { (m.shops ||= []).push({ kind: t.kind, at: [rd(p[0]), rd(p[1])], r: 60 }); ctx.dirty('map'); }
    else if (t.cat.id === 'svc' && t.kind) { (m.stations ||= []).push({ kind: t.kind, at: [rd(p[0]), rd(p[1])], r: 101 }); ctx.dirty('map'); }
    else if (t.id === 'gas') { (m.gas ||= []).push([rd(p[0]), rd(p[1])]); ctx.dirty('map'); }
    else if (t.id === 'busstop') { const L = T().bus; if (!L.length) L.push({ name: 'My bus line 1', color: 0xff7a1a, stops: [] }); L[Math.min(busSel, L.length - 1)].stops.push(w); ctx.dirty('transit'); }
    else if (t.id === 'metro') { const L = T().metro; if (!L.length) L.push({ name: 'My metro line 1', color: 0x8e44ad, stations: [] }); const l = L[Math.min(metroSel, L.length - 1)]; l.stations.push({ at: w, name: 'Station ' + (l.stations.length + 1) }); ctx.dirty('transit'); }
    else if (t.id === 'depot') { T().depot = { at: w }; ctx.dirty('transit'); }
    note = ''; renderSide(); view.redraw();
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    const [mx, my] = view.mouse(e), hit = hitThing(mx, my);
    if (e.button === 2) { if (hit) { hit.remove(); ctx.dirty(['busstop', 'metro', 'depot'].includes(hit.k) ? 'transit' : 'map'); renderSide(); view.redraw(); } return; }
    if (e.button === 1 || e.shiftKey) { view.panStart(e); return; }
    if (hit && e.altKey === false && !e.ctrlKey && hit.k === toolById[tool]?.cat.id) { drag = hit; return; }
    if (hit && (e.ctrlKey)) { drag = hit; return; }
    const w = view.toWorld(mx, my); place([w[0], w[1]]);
  });
  addEventListener('mousemove', e => {
    const [mx, my] = view.mouse(e); mouse = (mx >= 0 && my >= 0 && mx <= view.w && my <= view.h) ? [mx, my] : null;
    if (drag) { const w = view.toWorld(mx, my); drag.move([rd(w[0]), rd(w[1])]); ctx.dirty('map'); view.redraw(); return; }
    if (view.panMove(e)) return; view.redraw();
  });
  addEventListener('mouseup', () => { if (drag) { drag = null; if (ctx.dirty) { ctx.dirty('transit'); } renderSide(); } view.panEnd(); });

  function renderSide() {
    const counts = {}; things().forEach(t => { counts[t.k] = (counts[t.k] || 0) + 1; });
    const cur = toolById[tool];
    put(side, h('h3', {}, 'City builder'),
      h('p', { class: 'hint' }, 'Pick a piece, click the map to place it. Right-click a piece to remove it, drag a piece (of the kind you are placing) to move it. Hold Shift or use the middle button to pan, wheel to zoom.'),
      CATS.map(cat => h('div', { class: 'grp' },
        h('div', { class: 'row' }, h('b', { style: 'color:' + cat.color }, cat.name)),
        h('div', { class: 'row', style: 'flex-wrap:wrap;gap:4px' }, cat.tools.map(t => h('button', { class: 'btn' + (tool === t.id ? ' pri' : ''), onclick: () => { tool = t.id; renderSide(); view.redraw(); } }, t.name))))),
      cur && cur.note ? h('p', { class: 'hint' }, cur.note + '.') : null,
      cur && cur.id === 'busstop' ? h('div', { class: 'row' }, 'Line ', h('select', { onchange: e => { busSel = +e.target.value; } }, (T().bus.length ? T().bus : [{ name: 'a new line' }]).map((l, i) => h('option', { value: i, selected: i === busSel }, l.name)))) : null,
      cur && cur.id === 'metro' ? h('div', { class: 'row' }, 'Line ', h('select', { onchange: e => { metroSel = +e.target.value; } }, (T().metro.length ? T().metro : [{ name: 'a new line' }]).map((l, i) => h('option', { value: i, selected: i === metroSel }, l.name)))) : null,
      h('p', { class: 'hint' }, `Placed: ${counts.build || 0} buildings, ${counts.shop || 0} shops, ${counts.svc || 0} services, ${counts.gas || 0} gas, ${counts.busstop || 0} bus stops, ${counts.metro || 0} metro stations${counts.depot ? ', a bus depot' : ''}.`),
      h('p', { class: 'hint' }, 'Metro stations are joined in the order you place them (draw whole lines in the Transit tab). Press "Save" at the top, then play; "Rebuild" happens when you open the game.'));
  }
  view.initial = [0, 0, 1180, 1240];
  renderSide();
  return {
    el: root,
    show() { root.style.display = ''; view.fit(); renderSide(); view.redraw(); },
    hide() { root.style.display = 'none'; },
    refresh() { renderSide(); view.redraw(); }
  };
}
