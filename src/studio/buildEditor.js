// Studio: city builder. A toolbar in the spirit of a city-building game: pick a road type, a building, a service or a transit piece from a menu of
// cards (picture, name, what it does), then click the map to put it down. Roads are drawn point by point (pins mark each point, coloured by type),
// bridges and tunnels are dropped onto a road, and the map can show the roads the game really builds: every lane, the traffic lights, the stop signs
// and where the road changes width (the lanes merge there).
import { put, h, View, SC, S } from './common.js';
import refUrl from './ref-map.png';
import { SHOP_KINDS } from '../chicago/chicago.js';
import { CLASSES } from '../chicago/network.js';

const M_PER_U = 1.25;
const ROAD_TYPES = [
  { id: 'six', name: 'Express avenue', color: '#e8a21a', pin: 'E', blurb: 'The widest street: fast traffic, long junction spacing.' },
  { id: 'four', name: 'Main avenue', color: '#f0d23c', pin: 'M', blurb: 'A main arterial: shops and bus routes line it.' },
  { id: 'two', name: 'Local street', color: '#e8605f', pin: 'L', blurb: 'A quiet residential street, slow and narrow.' }
];
const roadType = id => ROAD_TYPES.find(r => r.id === id) || ROAD_TYPES[2];
const CATS = [
  { id: 'road', name: 'Roads', color: '#f0d23c', tools: [
    ...ROAD_TYPES.map(r => ({ id: 'road:' + r.id, name: r.name, road: r.id, blurb: r.blurb })),
    { id: 'bridge', name: 'Bridge', blurb: 'Click a road: that stretch is lifted over what it crosses, with ramps up and down.', struct: 1 },
    { id: 'tunnel', name: 'Tunnel', blurb: 'Click a road: that stretch goes underground, with ramps down and up.', struct: -1 } ] },
  { id: 'build', name: 'Buildings', color: '#e56bb0', tools: [
    { id: 'house', name: 'House', size: [3.2, 3.2], hgt: 9, blurb: 'A small family house.' }, { id: 'flats', name: 'Apartment block', size: [7, 5], hgt: 40, blurb: 'Mid-rise flats.' },
    { id: 'office', name: 'Office', size: [8, 7], hgt: 70, blurb: 'A glass office block.' }, { id: 'tower', name: 'Tower', size: [7, 7], hgt: 140, blurb: 'A skyscraper.' }, { id: 'hall', name: 'Hall / warehouse', size: [12, 8], hgt: 14, blurb: 'Wide and low.' } ] },
  { id: 'shop', name: 'Shops', color: '#ffb02e', tools: Object.keys(SHOP_KINDS).map(k => ({ id: 'shop:' + k, name: SHOP_KINDS[k].name || k, kind: k, color: SHOP_KINDS[k].color, blurb: SHOP_KINDS[k].desc || '' })) },
  { id: 'svc', name: 'Services', color: '#ff5555', tools: [
    { id: 'svc:hospital', name: 'Hospital', kind: 'hospital', blurb: 'Ambulances start here.' }, { id: 'svc:police', name: 'Police station', kind: 'police', blurb: 'Police cars start here.' },
    { id: 'svc:fire', name: 'Fire station', kind: 'fire', blurb: 'Fire engines start here.' }, { id: 'gas', name: 'Gas station', blurb: 'Fill up the tank.' } ] },
  { id: 'transit', name: 'Transit', color: '#3aa0ff', tools: [
    { id: 'busstop', name: 'Bus stop', blurb: 'Added to the selected bus line.' }, { id: 'metro', name: 'Metro station', blurb: 'Added to the selected metro line; a walk-down shaft appears beside it.' }, { id: 'depot', name: 'Bus depot', blurb: 'The garage where bus shifts start.' } ] }
];
const toolById = {}; CATS.forEach(c => c.tools.forEach(t => { toolById[t.id] = { ...t, cat: c }; }));

// ---- little pictures for the menu cards -------------------------------------------------------------------------------------------------
function iconFor(t, cv) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height; c.clearRect(0, 0, W, H);
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a3340'); g.addColorStop(1, '#1b2129'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = '#2f3a2a'; c.fillRect(0, H - 10, W, 10);
  const box = (x, y, w, hh, col, win) => { c.fillStyle = col; c.fillRect(x, y, w, hh); c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(x + w, y + 4, 8, hh - 4); c.fillStyle = 'rgba(255,255,255,.2)'; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 8, y - 4); c.lineTo(x + w + 8, y - 4); c.lineTo(x + w, y); c.fill();
    if (win) { c.fillStyle = 'rgba(255,240,170,.8)'; for (let yy = y + 5; yy < y + hh - 6; yy += 8) for (let xx = x + 4; xx < x + w - 4; xx += 8) c.fillRect(xx, yy, 4, 4); } };
  const lab = (s, col = '#fff') => { c.fillStyle = col; c.font = 'bold 15px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s, W / 2, H / 2 + 2); };
  const id = t.id;
  if (t.road) { // top-down cross-section of the road
    const k = CLASSES[t.road], lanes = k.lanes, wpx = Math.min(W - 10, 30 + k.width * 4.2), x0 = (W - wpx) / 2, sw = 5;
    c.fillStyle = '#9aa0a6'; c.fillRect(x0 - sw, 4, wpx + 2 * sw, H - 8); c.fillStyle = '#3b4048'; c.fillRect(x0, 4, wpx, H - 8);
    const n = lanes * 2, lw = wpx / n; c.strokeStyle = '#e9e9e4'; c.lineWidth = 1.2; c.setLineDash([5, 5]);
    for (let i = 1; i < n; i++) { if (i === lanes) continue; c.beginPath(); c.moveTo(x0 + lw * i, 4); c.lineTo(x0 + lw * i, H - 4); c.stroke(); } c.setLineDash([]);
    c.strokeStyle = '#f0c020'; c.lineWidth = 1.6; [-1.5, 1.5].forEach(o => { c.beginPath(); c.moveTo(x0 + wpx / 2 + o, 4); c.lineTo(x0 + wpx / 2 + o, H - 4); c.stroke(); });
    c.fillStyle = t.color || roadType(t.road).color; c.beginPath(); c.arc(14, 14, 7, 0, 7); c.fill(); c.fillStyle = '#000'; c.font = 'bold 9px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(roadType(t.road).pin, 14, 14.5); return;
  }
  if (id === 'bridge' || id === 'tunnel') {
    if (id === 'bridge') { c.fillStyle = '#3a78a8'; c.fillRect(0, H - 14, W, 14); c.fillStyle = '#555c66'; c.fillRect(8, H - 34, W - 16, 7); c.fillStyle = '#6b727c'; [24, W - 30].forEach(x => c.fillRect(x, H - 28, 6, 16)); c.strokeStyle = '#d7dbe0'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(8, H - 34); c.quadraticCurveTo(W / 2, H - 70, W - 8, H - 34); c.stroke(); }
    else { c.fillStyle = '#5a4a3c'; c.fillRect(0, 12, W, H - 12); c.fillStyle = '#16181c'; c.beginPath(); c.moveTo(W / 2 - 34, H - 10); c.lineTo(W / 2 - 34, H - 32); c.quadraticCurveTo(W / 2, 4, W / 2 + 34, H - 32); c.lineTo(W / 2 + 34, H - 10); c.fill(); c.fillStyle = '#3b4048'; c.fillRect(W / 2 - 34, H - 12, 68, 3); }
    return;
  }
  if (id === 'house') { box(W / 2 - 20, H - 36, 40, 26, '#d8b98c', 1); c.fillStyle = '#b0503c'; c.beginPath(); c.moveTo(W / 2 - 24, H - 36); c.lineTo(W / 2, H - 54); c.lineTo(W / 2 + 28, H - 40); c.lineTo(W / 2 + 24, H - 36); c.fill(); }
  else if (id === 'flats') box(W / 2 - 24, H - 48, 48, 38, '#b6805f', 1);
  else if (id === 'office') box(W / 2 - 22, H - 58, 44, 48, '#5f8fb0', 1);
  else if (id === 'tower') { box(W / 2 - 14, H - 66, 28, 56, '#7aa4c4', 1); c.fillStyle = '#c9d4de'; c.fillRect(W / 2 - 1, H - 76, 2, 10); }
  else if (id === 'hall') { box(W / 2 - 36, H - 30, 72, 20, '#8a8f95', 0); c.fillStyle = '#444'; [-22, 0, 22].forEach(x => c.fillRect(W / 2 + x - 8, H - 24, 14, 14)); }
  else if (id.startsWith('shop:')) { box(W / 2 - 26, H - 40, 52, 30, '#cfd4da', 0); for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? '#fff' : (t.color || '#ffb02e'); c.fillRect(W / 2 - 28 + i * 9.5, H - 40, 9.5, 9); } lab('$', '#222'); }
  else if (id.startsWith('svc:')) { const col = { hospital: '#e8eef4', police: '#2b4a8c', fire: '#c93232' }[t.kind]; box(W / 2 - 26, H - 40, 52, 30, col, 0); c.fillStyle = t.kind === 'hospital' ? '#d02828' : '#fff'; if (t.kind === 'hospital') { c.fillRect(W / 2 - 3, H - 34, 6, 18); c.fillRect(W / 2 - 9, H - 28, 18, 6); } else lab(t.kind === 'police' ? '★' : '▲'); }
  else if (id === 'gas') { c.fillStyle = '#d4442b'; c.fillRect(W / 2 - 30, H - 46, 60, 7); c.fillStyle = '#ddd'; [-20, 20].forEach(x => c.fillRect(W / 2 + x - 2, H - 40, 4, 30)); c.fillStyle = '#e8e8e8'; [-8, 8].forEach(x => c.fillRect(W / 2 + x - 4, H - 26, 8, 16)); }
  else if (id === 'busstop') { c.fillStyle = '#9aa0a6'; c.fillRect(W / 2 - 2, H - 50, 4, 40); c.fillStyle = '#ffd21f'; c.beginPath(); c.arc(W / 2, H - 52, 11, 0, 7); c.fill(); c.fillStyle = '#000'; c.font = 'bold 12px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('B', W / 2, H - 51); c.fillStyle = '#4a7aa8'; c.fillRect(W / 2 + 8, H - 34, 26, 22); }
  else if (id === 'metro') { c.fillStyle = '#2a2f35'; c.fillRect(W / 2 - 30, H - 22, 60, 12); c.fillStyle = '#9aa0a6'; [-3, 3].forEach(x => c.fillRect(W / 2 + x * 8 - 2, H - 54, 4, 34)); c.fillStyle = '#8e44ad'; c.fillRect(W / 2 - 26, H - 60, 52, 14); c.fillStyle = '#fff'; c.font = 'bold 12px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('METRO', W / 2, H - 52); }
  else if (id === 'depot') { box(W / 2 - 38, H - 34, 76, 24, '#6f7a88', 0); c.fillStyle = '#2b3138'; [-24, -4, 16].forEach(x => c.fillRect(W / 2 + x, H - 28, 16, 18)); c.fillStyle = '#ffb02e'; c.fillRect(W / 2 - 38, H - 38, 76, 4); }
}
const card = (t, on, selected) => { const cv = h('canvas', { width: 130, height: 76 }); iconFor(t, cv); const specs = t.road ? roadSpec(t.road) : '';
  return h('button', { class: 'card2' + (selected ? ' sel' : ''), onclick: on, title: t.blurb || t.name }, cv, h('b', {}, t.name), specs ? h('em', {}, specs) : (t.blurb ? h('em', {}, t.blurb) : null)); };
const roadSpec = id => { const k = CLASSES[id]; return `${k.lanes}+${k.lanes} lanes · ${Math.round(k.width * M_PER_U)} m · ${k.speedLimit} km/h`; };

export function createBuildEditor(ctx) {
  const root = h('div', { class: 'tab races' });
  const canvas = h('canvas'), wrap = h('div', { class: 'cv' }, canvas), side = h('div', { class: 'side', style: 'width:380px' });
  root.append(wrap, side);
  const img = new Image(); img.src = refUrl; img.onload = () => view.redraw();
  let tool = 'road:four', cat = 'road', mouse = null, drag = null, busSel = 0, metroSel = 0, roadPts = null, roadName = '', selStreet = -1, showLanes = true, showSigns = true, showImg = true, sLen = 70, sH = 6, hist = [];
  const M = () => ctx.map();
  const T = () => { const t = (ctx.custom().transit ||= {}); t.bus ||= []; t.metro ||= []; return t; };
  const toWorld = p => [-(p[0] - M().origin[0]) * S, (M().origin[1] - p[1]) * S], toPx = w => [M().origin[0] - w[0] / S, M().origin[1] - w[1] / S];
  const rd = v => Math.round(v * 10) / 10;
  const view = new View(canvas, draw), sc = p => view.toScreen(p[0], p[1]);
  const snap = () => { hist.push(JSON.stringify(M())); if (hist.length > 60) hist.shift(); };
  const dirtyMap = () => { ctx.dirty('map'); };
  let abT = 0; const autoBuild = () => { clearTimeout(abT); abT = setTimeout(() => { ctx.rebuild(); [1200, 3500].forEach(d => setTimeout(() => { renderSide(); view.redraw(); }, d)); }, 400); };      // the road network is rebuilt after an edit so the lanes, lights and signs you see are the real ones

  // every placed thing as { k, px, label, color, remove(), move(p) }
  function things() {
    const md = M(), out = [];
    (md.landmarks || []).forEach((a, i) => out.push({ k: 'build', px: [(a[1] + a[3]) / 2, (a[2] + a[4]) / 2], rect: [a[1], a[2], a[3], a[4]], label: a[0], color: '#e56bb0', remove: () => md.landmarks.splice(i, 1), move: p => { const w = a[3] - a[1], hh = a[4] - a[2]; a[1] = p[0] - w / 2; a[3] = p[0] + w / 2; a[2] = p[1] - hh / 2; a[4] = p[1] + hh / 2; } }));
    (md.shops || []).forEach((s, i) => out.push({ k: 'shop', px: s.at, label: s.kind, color: '#ffb02e', remove: () => md.shops.splice(i, 1), move: p => { s.at = p; } }));
    (md.stations || []).forEach((s, i) => out.push({ k: 'svc', px: s.at, label: s.kind, color: '#ff5555', remove: () => md.stations.splice(i, 1), move: p => { s.at = p; } }));
    (md.gas || []).forEach((g, i) => out.push({ k: 'gas', px: g, label: 'gas', color: '#ff7f2e', remove: () => md.gas.splice(i, 1), move: p => { md.gas[i] = p; } }));
    (md.structs || []).forEach((s, i) => { if (s.at) out.push({ k: s.h < 0 ? 'tunnel' : 'bridge', px: s.at, label: (s.h < 0 ? 'Tunnel ' : 'Bridge ') + Math.round(s.len * M_PER_U) + ' m', color: s.h < 0 ? '#b08a5a' : '#6fb8ff', remove: () => md.structs.splice(i, 1), move: p => { s.at = p; } }); });
    T().bus.forEach(l => l.stops.forEach((s, i) => out.push({ k: 'busstop', px: toPx(s), label: l.name, color: '#ffd21f', remove: () => l.stops.splice(i, 1), move: p => { l.stops[i] = toWorld(p).map(rd); } })));
    T().metro.forEach(l => l.stations.forEach((s, i) => out.push({ k: 'metro', px: toPx(s.at), label: s.name || l.name, color: '#' + (l.color >>> 0).toString(16).padStart(6, '0').slice(-6), remove: () => l.stations.splice(i, 1), move: p => { s.at = toWorld(p).map(rd); } })));
    const d = T().depot; if (d && d.at) out.push({ k: 'depot', px: toPx(d.at), label: 'bus depot', color: '#9aa7b8', remove: () => { delete T().depot; }, move: p => { d.at = toWorld(p).map(rd); } });
    return out;
  }
  const isTransit = k => ['busstop', 'metro', 'depot'].includes(k);
  const hitThing = (mx, my) => { let b = null, bd = 14; things().forEach(t => { const q = sc(t.px), d = Math.hypot(q[0] - mx, q[1] - my); if (d < bd) { bd = d; b = t; } }); return b; };
  // streets: the pins sit on their points
  const streets = () => M().streets || [];
  function hitStreetPin(mx, my) { let b = null, bd = 12; streets().forEach((s, i) => s.pts.forEach((p, j) => { const q = sc(p), d = Math.hypot(q[0] - mx, q[1] - my); if (d < bd) { bd = d; b = { i, j }; } })); return b; }
  function nearRoad(p, maxPx) {         // the nearest point on any street or built road (to snap to, and to drop bridges and tunnels onto)
    let best = null;
    const test = (a, b, ref) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)), x = a[0] + dx * t, y = a[1] + dy * t, d = Math.hypot(x - p[0], y - p[1]) * view.k; if (d < maxPx && (!best || d < best.d)) best = { d, x, y, ref, ang: Math.atan2(dy, dx) }; };
    streets().forEach((s, i) => { for (let j = 1; j < s.pts.length; j++) test(s.pts[j - 1], s.pts[j], i); });
    return best;
  }
  const snapPoint = p => {
    let best = null, bd = 12; streets().forEach(s => s.pts.forEach(q => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]) * view.k; if (d < bd) { bd = d; best = q; } }));
    if (best) return [best[0], best[1]];
    const r = nearRoad(p, 9); return r ? [r.x, r.y] : p;
  };

  // ---- drawing ----
  const pin = (c, x, y, col, ch, r = 9) => { c.fillStyle = col; c.strokeStyle = '#000'; c.lineWidth = 1.3; c.beginPath(); c.arc(x, y - r - 3, r, Math.PI * 0.82, Math.PI * 0.18 + Math.PI * 2); c.lineTo(x, y); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#000'; c.font = 'bold ' + (r + 1) + 'px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, x, y - r - 2.5); };
  function drawBuilt(c, city) {
    const N = city.roadNodes, E = city.roadEdges, p = n => sc(toPx([n.x, n.z])), kx = view.k / S;      // 1 world unit on screen
    const deg = {}; E.forEach(e => { (deg[e.from] ||= []).push(e); (deg[e.to] ||= []).push(e); });
    c.lineCap = 'butt';
    // taper between two roads of different width (the lanes merge here)
    const tapers = [];
    Object.keys(deg).forEach(id => { const es = deg[id]; if (es.length !== 2) return; const [a, b] = es; if (a.lanes === b.lanes && Math.abs(a.width - b.width) < 0.5) return; const wide = a.width >= b.width ? a : b, nar = wide === a ? b : a, nid = id, o = N[wide.from === nid ? wide.to : wide.from], n0 = N[nid], d = Math.hypot(o.x - n0.x, o.z - n0.z) || 1, L = Math.min(34, d * 0.5), ux = (o.x - n0.x) / d, uz = (o.z - n0.z) / d, px2 = -uz, pz = ux;
      tapers.push({ n0, ux, uz, px2, pz, L, wn: nar.width, ww: wide.width, from: nar.lanes, to: wide.lanes, id }); });
    E.forEach(e => { const a = N[e.from], b = N[e.to]; if (!a || !b) return; const A = p(a), B = p(b), w = Math.max(2, e.width * kx);
      c.lineWidth = w + (e.structure && e.structure !== 'surface' ? 3 : 0); c.strokeStyle = e.structure === 'tunnel' ? '#7a5a3a' : e.structure && e.structure !== 'surface' ? '#6fb8ff' : '#262b32'; c.setLineDash(e.structure === 'tunnel' ? [6, 4] : []); c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.stroke(); c.setLineDash([]);
      c.lineWidth = w; c.strokeStyle = '#3b4048'; c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.stroke(); });
    tapers.forEach(t => { const q = (u, s) => sc(toPx([t.n0.x + t.ux * u + t.px2 * s, t.n0.z + t.uz * u + t.pz * s])); c.fillStyle = '#3b4048'; c.beginPath(); [[0, t.wn / 2], [t.L, t.ww / 2], [t.L, -t.ww / 2], [0, -t.wn / 2]].forEach(([u, s], i) => { const o = q(u, s); i ? c.lineTo(o[0], o[1]) : c.moveTo(o[0], o[1]); }); c.fill(); });
    if (showLanes) E.forEach(e => { const a = N[e.from], b = N[e.to]; if (!a || !b) return; const A = p(a), B = p(b), w = e.width * kx; if (w < 9) return; const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, nx = -(B[1] - A[1]) / len, ny = (B[0] - A[0]) / len, n = (e.oneWay ? 1 : 2) * e.lanes, lw = w / n;
      for (let i = 1; i < n; i++) { const o = -w / 2 + lw * i, mid = !e.oneWay && i === e.lanes; c.strokeStyle = mid ? '#f0c020' : '#e9e9e4'; c.lineWidth = mid ? 1.6 : 1; c.setLineDash(mid ? [] : [6, 6]); c.beginPath(); c.moveTo(A[0] + nx * o, A[1] + ny * o); c.lineTo(B[0] + nx * o, B[1] + ny * o); c.stroke(); } c.setLineDash([]); });
    // lane merges: a marker where the road changes lane count or width
    tapers.forEach(t => { const o = sc(toPx([t.n0.x + t.ux * t.L * 0.5, t.n0.z + t.uz * t.L * 0.5])); c.fillStyle = '#ff9f1a'; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.moveTo(o[0], o[1] - 6); c.lineTo(o[0] + 6, o[1] + 5); c.lineTo(o[0] - 6, o[1] + 5); c.closePath(); c.fill(); c.stroke(); if (view.k > 1.3) { c.fillStyle = '#ffd08a'; c.font = '10px system-ui'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(Math.max(t.from, t.to) + '→' + Math.min(t.from, t.to) + ' lanes', o[0] + 9, o[1]); } });
    if (showSigns) {
      const sig = new Set((city.signals || []).map(s => s.nodeId));
      Object.keys(deg).forEach(id => { const n = N[id], q = p(n), k = deg[id].length; if (k < 3) return; const r = view.k > 1.6 ? 6 : 3.5;
        if (sig.has(id)) { c.fillStyle = '#111'; c.strokeStyle = '#ddd'; c.lineWidth = 1; c.fillRect(q[0] - r * 0.6, q[1] - r * 1.5, r * 1.2, r * 3); c.strokeRect(q[0] - r * 0.6, q[1] - r * 1.5, r * 1.2, r * 3); ['#e53935', '#fbc02d', '#43a047'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(q[0], q[1] + (i - 1) * r, r * 0.38, 0, 7); c.fill(); }); }
        else { c.fillStyle = '#d32f2f'; c.strokeStyle = '#fff'; c.lineWidth = 1; c.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; c.lineTo(q[0] + Math.cos(a) * r, q[1] + Math.sin(a) * r); } c.closePath(); c.fill(); c.stroke(); } });
    }
  }
  function draw(c) {
    c.fillStyle = '#12161c'; c.fillRect(0, 0, view.w, view.h);
    if (showImg && img.complete && img.naturalWidth) { const [x0, y0] = view.toScreen(0, 0); c.globalAlpha = 0.45; c.drawImage(img, x0, y0, img.naturalWidth * SC * view.k, img.naturalHeight * SC * view.k); c.globalAlpha = 1; }
    const city = ctx.cityIfBuilt();
    if (city && city.roadNodes) drawBuilt(c, city);
    else { streets().forEach(s => { c.strokeStyle = roadType(s.cls).color; c.lineWidth = 3; c.beginPath(); s.pts.forEach((q, i) => { const o = sc(q); i ? c.lineTo(o[0], o[1]) : c.moveTo(o[0], o[1]); }); c.stroke(); }); }
    streets().forEach(s => { c.strokeStyle = roadType(s.cls).color + 'aa'; c.lineWidth = 1.5; c.setLineDash([5, 4]); c.beginPath(); s.pts.forEach((q, i) => { const o = sc(q); i ? c.lineTo(o[0], o[1]) : c.moveTo(o[0], o[1]); }); c.stroke(); c.setLineDash([]); });
    // pins: one at each end of every street (coloured by type, with its letter), small dots on the points between
    streets().forEach((s, i) => { const rt = roadType(s.cls); s.pts.forEach((q, j) => { const o = sc(q), end = j === 0 || j === s.pts.length - 1; if (end) pin(c, o[0], o[1], i === selStreet ? '#fff' : rt.color, rt.pin, view.k > 0.8 ? 8 : 5.5); else if (view.k > 1.2) { c.fillStyle = rt.color; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(o[0], o[1], 3, 0, 7); c.fill(); c.stroke(); } }); });
    things().forEach(t => {
      const [x, y] = sc(t.px);
      if (t.rect) { const a = sc([t.rect[0], t.rect[1]]), b = sc([t.rect[2], t.rect[3]]); c.fillStyle = t.color + '88'; c.strokeStyle = t.color; c.lineWidth = 1.5; c.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); return; }
      if (t.k === 'bridge' || t.k === 'tunnel') { pin(c, x, y, t.color, t.k === 'bridge' ? '≍' : '∩', 10); return; }
      c.fillStyle = t.color; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath();
      if (t.k === 'metro') c.rect(x - 8, y - 8, 16, 16); else if (t.k === 'depot') c.rect(x - 12, y - 8, 24, 16); else c.arc(x, y, t.k === 'busstop' ? 6 : 8, 0, 7);
      c.fill(); c.stroke(); c.fillStyle = '#fff'; c.font = 'bold 10px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText({ metro: 'M', busstop: 'B', depot: 'D', gas: 'G', svc: '+', shop: '$' }[t.k] || '', x, y + 0.5);
    });
    T().metro.forEach(l => { if (l.stations.length < 2) return; c.strokeStyle = '#' + (l.color >>> 0).toString(16).padStart(6, '0').slice(-6) + '99'; c.lineWidth = 3; c.setLineDash([8, 6]); c.beginPath(); l.stations.forEach((s, i) => { const q = sc(toPx(s.at)); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.stroke(); c.setLineDash([]); });
    // the road being drawn: pins, a smooth rubber band at the road's real width
    const t = toolById[tool];
    if (roadPts && roadPts.length) {
      const k = CLASSES[t.road || 'four'], rt = roadType(t.road || 'four'), pts = mouse ? [...roadPts, snapPoint(view.toWorld(mouse[0], mouse[1]))] : roadPts;
      c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = rt.color + '55'; c.lineWidth = Math.max(4, k.width / S * view.k); c.beginPath(); pts.forEach((q, i) => { const o = sc(q); i ? c.lineTo(o[0], o[1]) : c.moveTo(o[0], o[1]); }); c.stroke();
      c.strokeStyle = rt.color; c.lineWidth = 2; c.setLineDash([8, 5]); c.beginPath(); pts.forEach((q, i) => { const o = sc(q); i ? c.lineTo(o[0], o[1]) : c.moveTo(o[0], o[1]); }); c.stroke(); c.setLineDash([]);
      roadPts.forEach((q, j) => { const o = sc(q); pin(c, o[0], o[1], rt.color, j === 0 ? rt.pin : '•', 8); });
    }
    if (mouse && t) {
      c.globalAlpha = 0.65; c.fillStyle = t.cat.color; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
      if (t.size) { const w = t.size[0] * view.k, hh = t.size[1] * view.k; c.fillRect(mouse[0] - w / 2, mouse[1] - hh / 2, w, hh); c.strokeRect(mouse[0] - w / 2, mouse[1] - hh / 2, w, hh); }
      else if (t.struct) { const r = nearRoad(view.toWorld(mouse[0], mouse[1]), 30); if (r) { const o = sc([r.x, r.y]), hl = sLen / M_PER_U / S * view.k / 2, ca = Math.cos(r.ang), sa = Math.sin(r.ang); c.lineWidth = 9; c.strokeStyle = t.struct > 0 ? '#6fb8ff' : '#b08a5a'; c.lineCap = 'butt'; c.beginPath(); c.moveTo(o[0] - ca * hl, o[1] - sa * hl); c.lineTo(o[0] + ca * hl, o[1] + sa * hl); c.stroke(); } }
      else if (!t.road) { c.beginPath(); c.arc(mouse[0], mouse[1], 9, 0, 7); c.fill(); c.stroke(); }
      c.globalAlpha = 1; c.fillStyle = '#fff'; c.font = '11px system-ui'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(t.name, mouse[0] + 14, mouse[1] - 8);
    }
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }

  // ---- actions ----
  function finishRoad() {
    const t = toolById[tool];
    if (roadPts && roadPts.length >= 2 && t && t.road) { snap(); (M().streets ||= []).push({ cls: t.road, pts: roadPts.map(q => [rd(q[0]), rd(q[1])]), name: roadName || undefined }); selStreet = M().streets.length - 1; dirtyMap(); autoBuild(); }
    roadPts = null; roadName = ''; renderSide(); view.redraw();
  }
  function place(p) {
    const t = toolById[tool]; if (!t) return; const m = M(), w = toWorld(p).map(rd);
    if (t.road) { (roadPts ||= []).push(snapPoint(p)); renderSide(); view.redraw(); return; }
    snap();
    if (t.struct) { const r = nearRoad(p, 30); if (!r) { hist.pop(); return; } (m.structs ||= []).push({ at: [rd(r.x), rd(r.y)], len: Math.round(sLen / M_PER_U), h: t.struct * Math.round(sH / M_PER_U * 10) / 10 }); dirtyMap(); autoBuild(); }
    else if (t.cat.id === 'build') { m.landmarks.push([t.name, rd(p[0] - t.size[0] / 2), rd(p[1] - t.size[1] / 2), rd(p[0] + t.size[0] / 2), rd(p[1] + t.size[1] / 2), t.hgt]); dirtyMap(); }
    else if (t.cat.id === 'shop') { (m.shops ||= []).push({ kind: t.kind, at: [rd(p[0]), rd(p[1])], r: 60 }); dirtyMap(); }
    else if (t.cat.id === 'svc' && t.kind) { (m.stations ||= []).push({ kind: t.kind, at: [rd(p[0]), rd(p[1])], r: 101 }); dirtyMap(); }
    else if (t.id === 'gas') { (m.gas ||= []).push([rd(p[0]), rd(p[1])]); dirtyMap(); }
    else if (t.id === 'busstop') { const L = T().bus; if (!L.length) L.push({ name: 'My bus line 1', color: 0xff7a1a, stops: [] }); L[Math.min(busSel, L.length - 1)].stops.push(w); ctx.dirty('transit'); }
    else if (t.id === 'metro') { const L = T().metro; if (!L.length) L.push({ name: 'My metro line 1', color: 0x8e44ad, stations: [] }); const l = L[Math.min(metroSel, L.length - 1)]; l.stations.push({ at: w, name: 'Station ' + (l.stations.length + 1) }); ctx.dirty('transit'); }
    else if (t.id === 'depot') { T().depot = { at: w }; ctx.dirty('transit'); }
    renderSide(); view.redraw();
  }
  function undo() { if (roadPts && roadPts.length) { roadPts.pop(); if (!roadPts.length) roadPts = null; renderSide(); view.redraw(); return; } if (!hist.length) return; ctx.setMap(JSON.parse(hist.pop())); dirtyMap(); renderSide(); view.redraw(); }

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('dblclick', e => { if (roadPts) { roadPts.pop(); finishRoad(); } });
  canvas.addEventListener('mousedown', e => {
    const [mx, my] = view.mouse(e), hit = hitThing(mx, my);
    if (e.button === 2) {
      if (roadPts) { finishRoad(); return; }
      if (hit) { snap(); hit.remove(); ctx.dirty(isTransit(hit.k) ? 'transit' : 'map'); renderSide(); view.redraw(); return; }
      const sp = hitStreetPin(mx, my); if (sp) { snap(); M().streets.splice(sp.i, 1); selStreet = -1; dirtyMap(); renderSide(); view.redraw(); } return;
    }
    if (e.button === 1 || e.shiftKey) { view.panStart(e); return; }
    if (!roadPts && hit && e.ctrlKey) { snap(); drag = hit; return; }
    if (!roadPts && e.altKey) { const sp = hitStreetPin(mx, my); if (sp) { selStreet = sp.i; renderSide(); view.redraw(); return; } }
    const w = view.toWorld(mx, my); place([w[0], w[1]]);
  });
  addEventListener('mousemove', e => {
    const [mx, my] = view.mouse(e); mouse = (mx >= 0 && my >= 0 && mx <= view.w && my <= view.h) ? [mx, my] : null;
    if (drag) { const w = view.toWorld(mx, my); drag.move([rd(w[0]), rd(w[1])]); ctx.dirty('map'); view.redraw(); return; }
    if (view.panMove(e)) return; view.redraw();
  });
  addEventListener('mouseup', () => { if (drag) { drag = null; renderSide(); } view.panEnd(); });
  addEventListener('keydown', e => { if (root.style.display === 'none') return; if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'Enter') finishRoad(); else if (e.key === 'Backspace' && roadPts) { e.preventDefault(); undo(); } else if (e.key === 'Escape') { roadPts = null; renderSide(); view.redraw(); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); } });

  function renderSide() {
    const counts = {}; things().forEach(t => { counts[t.k] = (counts[t.k] || 0) + 1; });
    const cur = toolById[tool], c0 = CATS.find(c => c.id === cat), st = streets()[selStreet];
    put(side, h('h3', {}, 'City builder'),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:4px;margin-bottom:8px' }, CATS.map(c => h('button', { class: 'btn' + (cat === c.id ? ' pri' : ''), onclick: () => { cat = c.id; if (!c.tools.some(t => t.id === tool)) tool = c.tools[0].id; roadPts = null; renderSide(); view.redraw(); } }, c.name))),
      h('div', { class: 'cards' }, c0.tools.map(t => card({ ...t, color: t.color }, () => { tool = t.id; roadPts = null; renderSide(); view.redraw(); }, tool === t.id))),
      cur && cur.road ? h('div', {}, h('p', { class: 'hint' }, roadPts ? `Drawing: ${roadPts.length} point${roadPts.length > 1 ? 's' : ''}. Click to add a point (it snaps to existing roads), double-click or Enter to finish, Esc to cancel, Backspace/Ctrl+Z removes a point.` : 'Click the map to start a road. Each click drops a pin; the road is drawn at its real width. Click near an existing road to join it. Alt + click a pin to select that road.'),
        h('div', { class: 'row' }, 'Name ', h('input', { type: 'text', value: roadName, placeholder: '(optional)', style: 'width:150px', oninput: e => { roadName = e.target.value; } })),
        roadPts && roadPts.length >= 2 ? h('div', { class: 'row' }, h('button', { class: 'btn pri', onclick: finishRoad }, 'Finish road')) : null) : null,
      cur && cur.struct ? h('div', {}, h('p', { class: 'hint' }, cur.blurb),
        h('div', { class: 'row' }, 'Length ', h('input', { type: 'number', value: sLen, step: 10, min: 20, style: 'width:70px', oninput: e => { sLen = +e.target.value || 70; view.redraw(); } }), ' m   ', cur.struct > 0 ? 'Height ' : 'Depth ', h('input', { type: 'number', value: sH, step: 1, min: 2, style: 'width:60px', oninput: e => { sH = +e.target.value || 6; } }), ' m')) : null,
      cur && !cur.road && !cur.struct && cur.blurb ? h('p', { class: 'hint' }, cur.blurb) : null,
      cur && cur.id === 'busstop' ? h('div', { class: 'row' }, 'Line ', h('select', { onchange: e => { busSel = +e.target.value; } }, (T().bus.length ? T().bus : [{ name: 'a new line' }]).map((l, i) => h('option', { value: i, selected: i === busSel }, l.name)))) : null,
      cur && cur.id === 'metro' ? h('div', { class: 'row' }, 'Line ', h('select', { onchange: e => { metroSel = +e.target.value; } }, (T().metro.length ? T().metro : [{ name: 'a new line' }]).map((l, i) => h('option', { value: i, selected: i === metroSel }, l.name)))) : null,
      st ? h('div', { class: 'grp' }, h('h4', {}, 'Selected road'), h('div', { class: 'row' }, 'Type ', h('select', { onchange: e => { snap(); st.cls = e.target.value; dirtyMap(); renderSide(); view.redraw(); } }, ROAD_TYPES.map(r => h('option', { value: r.id, selected: r.id === st.cls }, r.name)))),
        h('div', { class: 'row' }, 'Name ', h('input', { type: 'text', value: st.name || '', style: 'width:150px', oninput: e => { st.name = e.target.value || undefined; dirtyMap(); } })),
        h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: () => { snap(); M().streets.splice(selStreet, 1); selStreet = -1; dirtyMap(); renderSide(); view.redraw(); } }, 'Delete road'))) : null,
      h('h4', {}, 'Map'),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:10px' },
        h('label', {}, h('input', { type: 'checkbox', checked: showLanes, onchange: e => { showLanes = e.target.checked; view.redraw(); } }), ' lanes'),
        h('label', {}, h('input', { type: 'checkbox', checked: showSigns, onchange: e => { showSigns = e.target.checked; view.redraw(); } }), ' lights & stop signs'),
        h('label', {}, h('input', { type: 'checkbox', checked: showImg, onchange: e => { showImg = e.target.checked; view.redraw(); } }), ' reference image')),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { ctx.rebuild(); setTimeout(() => { renderSide(); view.redraw(); }, 1500); } }, 'Rebuild roads'), h('button', { class: 'btn', onclick: undo }, 'Undo')),
      h('p', { class: 'hint' }, 'Pins: ', ROAD_TYPES.map(r => h('span', { style: 'margin-right:8px' }, h('b', { style: 'color:' + r.color }, r.pin), ' ' + r.name)), '. The map shows the roads as the game builds them: lanes, traffic lights (3 dots), stop signs (red), and an orange ▲ where the road changes width and its lanes merge. "Rebuild roads" refreshes this after an edit; the game adds the lights and signs itself.'),
      h('p', { class: 'hint' }, `Placed: ${streets().length} roads, ${counts.bridge || 0} bridges, ${counts.tunnel || 0} tunnels, ${counts.build || 0} buildings, ${counts.shop || 0} shops, ${counts.svc || 0} services, ${counts.gas || 0} gas, ${counts.busstop || 0} bus stops, ${counts.metro || 0} metro stations${counts.depot ? ', a bus depot' : ''}. Right-click a pin or piece to remove it; Ctrl + drag moves a piece; Shift or the middle button pans.`));
  }
  view.initial = [0, 0, 1180, 1240];
  const st = document.createElement('style'); st.textContent = '.cards{display:grid;grid-template-columns:1fr 1fr;gap:8px}.card2{background:#1c232d;border:1px solid #2c3746;border-radius:9px;color:inherit;padding:5px;text-align:left;cursor:pointer;font:inherit;display:flex;flex-direction:column;gap:3px}.card2:hover{background:#243040}.card2.sel{border-color:#3d8bff;box-shadow:0 0 0 2px #3d8bff55}.card2 canvas{width:100%;border-radius:6px}.card2 b{font-size:12px}.card2 em{font-size:11px;color:#8d9bb0;font-style:normal;line-height:1.25}'; document.head.append(st);
  renderSide();
  return {
    el: root,
    show() { root.style.display = ''; view.fit(); renderSide(); view.redraw(); },
    hide() { root.style.display = 'none'; },
    refresh() { renderSide(); view.redraw(); }
  };
}
