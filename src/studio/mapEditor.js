// Studio: map editor. Every layer of the map data (streets, water, parks, landmarks, highway, districts, shops...) can be
// moved, added to or deleted on top of your reference image. "Rebuild roads" runs the real road builder on the edited map.
import { put, h, View, SC, S, distSeg, field, numInput, textInput, selectInput, colorInput, clone } from './common.js';
import refUrl from './ref-map.png';
import { SHOP_KINDS } from '../chicago/chicago.js';

const DIST = 9;
// ---- layer descriptions: how each part of the map data is turned into editable items -------------------------------------------------
function poly(arr, closed, extra = {}) {
  return { type: 'poly', closed, get n() { return arr.length; }, getPt: j => arr[j], setPt: (j, x, y) => { arr[j] = [x, y]; }, insert: (j, x, y) => arr.splice(j, 0, [x, y]), remove: j => arr.splice(j, 1), min: closed ? 3 : 2, ...extra };
}
const point = (get, set, extra = {}) => ({ type: 'point', n: 1, getPt: () => get(), setPt: (j, x, y) => set([x, y]), ...extra });
const num = (o, k, label, step = 1) => ({ label, kind: 'num', get: () => o[k], set: v => { o[k] = v; }, step });
const txt = (o, k, label) => ({ label, kind: 'text', get: () => o[k], set: v => { o[k] = v; } });
const sel = (o, k, label, opts) => ({ label, kind: 'select', opts, get: () => o[k], set: v => { o[k] = v; } });

export const LAYERS = {
  streets: { name: 'Streets', color: '#d9a35b', items: m => m.streets.map((s, i) => poly(s.pts, false, { label: '#' + i + ' ' + s.cls, props: [sel(s, 'cls', 'Class', ['six', 'four', 'two'])] })), add: m => ({ type: 'poly', closed: false, min: 2, make: pts => m.streets.push({ cls: 'four', pts }) }), del: (m, i) => m.streets.splice(i, 1) },
  highway: { name: 'Highway', color: '#2e7d4f', items: m => [poly(m.highway, false, { label: 'Highway ring (' + m.highway.length + ' points)', props: [] })] },
  lake: { name: 'Lake', color: '#4aa3df', items: m => [poly(m.lake, true, { label: 'Lake shore (' + m.lake.length + ' points)', props: [] })] },
  rivers: { name: 'Rivers', color: '#4aa3df', items: m => m.rivers.map(r => poly(r.pts, false, { label: r.id, props: [txt(r, 'id', 'Name'), num(r, 'half', 'Half width (px)', 0.5)] })), add: m => ({ type: 'poly', closed: false, min: 2, make: pts => m.rivers.push({ id: 'river' + (m.rivers.length + 1), half: 16, pts }) }), del: (m, i) => m.rivers.splice(i, 1) },
  parks: { name: 'Parks', color: '#6aa56b', items: m => m.parks.map(p => poly(p.pts, true, { label: p.name, props: [txt(p, 'name', 'Name')] })), add: m => ({ type: 'poly', closed: true, min: 3, make: pts => m.parks.push({ name: 'New park', pts }) }), del: (m, i) => m.parks.splice(i, 1) },
  decks: { name: 'Piers & decks', color: '#b9a98f', items: m => m.decks.map(p => poly(p.pts, true, { label: p.name, props: [txt(p, 'name', 'Name')] })), add: m => ({ type: 'poly', closed: true, min: 3, make: pts => m.decks.push({ name: 'New deck', color: 13222576, pts }) }), del: (m, i) => m.decks.splice(i, 1) },
  landmarks: { name: 'Landmarks', color: '#e56bb0', items: m => m.landmarks.map(a => ({ type: 'rect', n: 2, getPt: j => j ? [a[3], a[4]] : [a[1], a[2]], setPt: (j, x, y) => { if (j) { a[3] = x; a[4] = y; } else { a[1] = x; a[2] = y; } }, label: a[0],
    props: [{ label: 'Name', kind: 'text', get: () => a[0], set: v => { a[0] = v; } }, { label: 'Height', kind: 'num', step: 5, get: () => a[5], set: v => { a[5] = v; } }, { label: 'Pier / deck (stands on water)', kind: 'check', get: () => !!a[6], set: v => { a[6] = v ? 1 : 0; } }] })),
    add: m => ({ type: 'rect', make: pts => m.landmarks.push(['New landmark', pts[0][0], pts[0][1], pts[1][0], pts[1][1], 40])}), del: (m, i) => m.landmarks.splice(i, 1) },
  stadium: { name: 'Stadium', color: '#e56bb0', items: m => [{ type: 'ellipse', n: 2, label: 'Stadium', getPt: j => j ? [m.stadium.cx + m.stadium.rx, m.stadium.cy + m.stadium.ry] : [m.stadium.cx, m.stadium.cy], setPt: (j, x, y) => { if (j) { m.stadium.rx = Math.abs(x - m.stadium.cx); m.stadium.ry = Math.abs(y - m.stadium.cy); } else { m.stadium.cx = x; m.stadium.cy = y; } }, props: [] }] },
  districts: { name: 'Districts', color: '#7a8cff', items: m => m.districts.map(d => poly(d.poly, true, { label: d.name, props: [txt(d, 'name', 'Name'), txt(d, 'style', 'Building style'), { label: 'Colour', kind: 'color', get: () => parseInt((d.color || '#9aa7b8').slice(1), 16), set: v => { d.color = '#' + v.toString(16).padStart(6, '0'); } }, txt(d, 'blurb', 'Description'),
    { label: 'Building height min', kind: 'num', step: 5, get: () => (d.h || [10, 30])[0], set: v => { d.h = [v, (d.h || [10, 30])[1]]; } }, { label: 'Building height max', kind: 'num', step: 5, get: () => (d.h || [10, 30])[1], set: v => { d.h = [(d.h || [10, 30])[0], v]; } }] })),
    add: m => ({ type: 'poly', closed: true, min: 3, make: pts => m.districts.push({ name: 'New district', poly: pts, h: [10, 40], style: 'mixed', blurb: '', color: '#9aa7b8' }) }), del: (m, i) => m.districts.splice(i, 1) },
  interchanges: { name: 'Highway exits', color: '#2e7d4f', items: m => m.interchanges.map(x => poly(x.pts, false, { label: x.label, props: [txt(x, 'label', 'Label'), sel(x, 'cls', 'Road class', ['six', 'four', 'two'])] })), add: m => ({ type: 'poly', closed: false, min: 2, make: pts => m.interchanges.push({ cls: 'four', label: 'New exit', pts }) }), del: (m, i) => m.interchanges.splice(i, 1) },
  shops: { name: 'Shops', color: '#ffb02e', items: m => m.shops.map(s => point(() => s.at, p => { s.at = p; }, { label: s.kind, props: [sel(s, 'kind', 'Kind', Object.keys(SHOP_KINDS)), num(s, 'r', 'Reach (px)', 1)] })), add: m => ({ type: 'point', make: p => m.shops.push({ kind: 'dealer', at: p, r: 92 }) }), del: (m, i) => m.shops.splice(i, 1) },
  stations: { name: 'Hospital / police / fire', color: '#ff5555', items: m => m.stations.map(s => point(() => s.at, p => { s.at = p; }, { label: s.kind, props: [sel(s, 'kind', 'Kind', ['hospital', 'police', 'fire']), num(s, 'r', 'Reach (px)', 1)] })), add: m => ({ type: 'point', make: p => m.stations.push({ kind: 'police', at: p, r: 101 }) }), del: (m, i) => m.stations.splice(i, 1) },
  gas: { name: 'Gas stations', color: '#ff7f2e', items: m => m.gas.map((g, i) => point(() => g, p => { m.gas[i] = p; }, { label: 'Gas ' + (i + 1), props: [] })), add: m => ({ type: 'point', make: p => m.gas.push(p) }), del: (m, i) => m.gas.splice(i, 1) },
  slips: { name: 'Harbour slips', color: '#27c4c4', items: m => m.harbour.slips.map((g, i) => point(() => g, p => { m.harbour.slips[i] = p; }, { label: 'Slip ' + (i + 1), props: [] })), add: m => ({ type: 'point', make: p => m.harbour.slips.push(p) }), del: (m, i) => m.harbour.slips.splice(i, 1) }
};
const STREET_COL = { six: '#e0a23a', four: '#c9a063', two: '#9a3f45', ramp: '#888' };

export function createMapEditor(ctx) {
  const root = h('div', { class: 'tab map' });
  const canvas = h('canvas'), wrap = h('div', { class: 'cv' }, canvas), side = h('div', { class: 'side' });
  root.append(wrap, side);
  const img = new Image(); img.src = refUrl; img.onload = () => view.redraw();
  let layer = 'streets', selIdx = 0, selV = -1, drawing = null, dragging = null, alpha = 0.55, showImg = true, showBuilt = true, hist = [], builtEdges = null, showAll = true;
  const m = () => ctx.map();

  const view = new View(canvas, draw);
  const sc = (x, y) => view.toScreen(x, y);
  const items = () => LAYERS[layer].items(m());

  function snap() { hist.push(JSON.stringify(m())); if (hist.length > 60) hist.shift(); }
  function undo() { if (!hist.length) return; ctx.setMap(JSON.parse(hist.pop())); selV = -1; changed(false); renderSide(); }
  function changed(dirty = true) { if (dirty) ctx.dirty('map'); view.redraw(); }

  function draw(c) {
    const md = m(), W = view.w, H = view.h;
    c.fillStyle = '#12161c'; c.fillRect(0, 0, W, H);
    if (showImg && img.complete && img.naturalWidth) { const [x0, y0] = sc(0, 0); c.globalAlpha = alpha; c.drawImage(img, x0, y0, img.naturalWidth * SC * view.k, img.naturalHeight * SC * view.k); c.globalAlpha = 1; }
    const path = (pts, closed) => { c.beginPath(); pts.forEach((p, i) => { const [x, y] = sc(p[0], p[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); }); if (closed) c.closePath(); };
    // water
    c.fillStyle = 'rgba(74,163,223,.35)'; path(md.lake, true); c.fill();
    c.strokeStyle = 'rgba(74,163,223,.9)'; c.lineWidth = 1.5; c.stroke();
    md.rivers.forEach(r => { c.strokeStyle = 'rgba(74,163,223,.45)'; c.lineWidth = Math.max(2, r.half * 2 * view.k); c.lineCap = 'round'; path(r.pts, false); c.stroke(); });
    md.parks.forEach(p => { c.fillStyle = 'rgba(80,170,90,.35)'; path(p.pts, true); c.fill(); });
    md.decks.forEach(p => { c.fillStyle = 'rgba(190,170,140,.55)'; path(p.pts, true); c.fill(); });
    md.landmarks.forEach(a => { const [x0, y0] = sc(a[1], a[2]), [x1, y1] = sc(a[3], a[4]); c.fillStyle = 'rgba(229,107,176,.35)'; c.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); });
    { const s = md.stadium, [x, y] = sc(s.cx, s.cy); c.fillStyle = 'rgba(229,107,176,.3)'; c.beginPath(); c.ellipse(x, y, s.rx * view.k, s.ry * view.k, 0, 0, 7); c.fill(); }
    md.districts.forEach(d => { c.setLineDash([6, 5]); c.strokeStyle = 'rgba(150,160,255,.7)'; c.lineWidth = 1; path(d.poly, true); c.stroke(); c.setLineDash([]); const [x, y] = sc(d.poly[0][0], d.poly[0][1]); c.fillStyle = 'rgba(190,200,255,.9)'; c.font = '11px system-ui'; c.fillText(d.name, x + 4, y + 12); });
    // roads as data
    c.lineCap = 'round'; c.lineJoin = 'round';
    md.streets.forEach(s => { c.strokeStyle = STREET_COL[s.cls] || '#aaa'; c.lineWidth = Math.max(1.2, (s.cls === 'six' ? 5 : s.cls === 'four' ? 3.4 : 2.2) * view.k * 1.4); path(s.pts, false); c.stroke(); });
    c.strokeStyle = '#2e7d4f'; c.lineWidth = Math.max(2, 6 * view.k); path(md.highway, false); c.stroke();
    md.interchanges.forEach(x => { c.strokeStyle = '#38b36d'; c.lineWidth = Math.max(1.5, 3 * view.k); path(x.pts, false); c.stroke(); });
    // the network the game really builds from it
    if (showBuilt && builtEdges) { c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 1; c.beginPath(); builtEdges.forEach(([a, b]) => { const [x0, y0] = sc(a[0], a[1]), [x1, y1] = sc(b[0], b[1]); c.moveTo(x0, y0); c.lineTo(x1, y1); }); c.stroke(); }
    // point layers
    const dot = (p, col, lab) => { const [x, y] = sc(p[0], p[1]); c.fillStyle = col; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill(); c.stroke(); if (lab) { c.fillStyle = '#fff'; c.font = '10px system-ui'; c.fillText(lab, x + 7, y + 3); } };
    if (showAll) ['shops', 'stations', 'gas', 'slips'].forEach(k => LAYERS[k].items(md).forEach(it => dot(it.getPt(0), LAYERS[k].color, it.label)));
    // active layer: handles
    const its = items();
    its.forEach((it, i) => {
      const act = i === selIdx, col = LAYERS[layer].color;
      if (it.type === 'poly') { c.strokeStyle = act ? '#fff' : col; c.lineWidth = act ? 2.5 : 1.5; path(Array.from({ length: it.n }, (_, j) => it.getPt(j)), it.closed); c.stroke(); }
      if (it.type === 'rect') { const [x0, y0] = sc(...it.getPt(0)), [x1, y1] = sc(...it.getPt(1)); c.strokeStyle = act ? '#fff' : col; c.lineWidth = act ? 2.5 : 1.5; c.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); }
      if (it.type === 'ellipse') { const [x, y] = sc(...it.getPt(0)), [x1, y1] = sc(...it.getPt(1)); c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.ellipse(x, y, Math.abs(x1 - x), Math.abs(y1 - y), 0, 0, 7); c.stroke(); }
      for (let j = 0; j < it.n; j++) {
        if (it.type === 'poly' && !act && view.k < 0.8) continue;
        const [x, y] = sc(...it.getPt(j)); c.fillStyle = act && j === selV ? '#ff3b3b' : act ? '#fff' : col; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, act ? 4.5 : 3.2, 0, 7); c.fill(); c.stroke();
        if (it.type === 'point') { c.fillStyle = '#fff'; c.font = '10px system-ui'; c.fillText(it.label || '', x + 7, y + 3); if (act) { c.strokeStyle = '#fff'; c.beginPath(); c.arc(x, y, 9, 0, 7); c.stroke(); } }
      }
    });
    if (drawing) {
      c.strokeStyle = '#ffeb3b'; c.lineWidth = 2; c.setLineDash([5, 4]); if (drawing.pts.length) { path(drawing.pts, false); c.stroke(); } c.setLineDash([]);
      drawing.pts.forEach(p => { const [x, y] = sc(p[0], p[1]); c.fillStyle = '#ffeb3b'; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill(); });
    }
    // origin marker
    { const [x, y] = sc(md.origin[0], md.origin[1]); c.strokeStyle = '#ffeb3b'; c.beginPath(); c.moveTo(x - 7, y); c.lineTo(x + 7, y); c.moveTo(x, y - 7); c.lineTo(x, y + 7); c.stroke(); c.fillStyle = '#ffeb3b'; c.font = '10px system-ui'; c.fillText('origin', x + 8, y - 6); }
  }

  // ---- mouse ---------------------------------------------------------------------------------------------------------------------
  function hit(mx, my) {
    let best = null;
    items().forEach((it, i) => { for (let j = 0; j < it.n; j++) { const [x, y] = sc(...it.getPt(j)), d = Math.hypot(x - mx, y - my); if (d < DIST && (!best || d < best.d)) best = { i, j, d }; } });
    return best;
  }
  function edgeHit(mx, my) {
    let best = null;
    items().forEach((it, i) => { if (it.type !== 'poly') return; const n = it.n, cnt = it.closed ? n : n - 1; for (let j = 0; j < cnt; j++) { const a = sc(...it.getPt(j)), b = sc(...it.getPt((j + 1) % n)), r = distSeg(mx, my, a[0], a[1], b[0], b[1]); if (r.d < 7 && (!best || r.d < best.d)) best = { i, j: j + 1, d: r.d }; } });
    return best;
  }
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    const [mx, my] = view.mouse(e), [wx, wy] = view.toWorld(mx, my);
    const rnd = v => Math.round(v * 10) / 10;
    if (e.button === 2) {    // right click: delete a vertex / point
      const hh = hit(mx, my); if (!hh) return; const it = items()[hh.i];
      snap();
      if (it.type === 'point') LAYERS[layer].del(m(), hh.i);
      else if (it.type === 'poly' && it.n > it.min) it.remove(hh.j);
      selV = -1; changed(); renderSide(); return;
    }
    if (drawing) {
      const D = drawing; D.pts.push([rnd(wx), rnd(wy)]);
      const need = D.spec.type === 'rect' ? 2 : D.spec.type === 'point' ? 1 : Infinity;
      if (D.pts.length >= need) finishDrawing(); else view.redraw(); return;
    }
    const hh = hit(mx, my);
    if (hh) { selIdx = hh.i; selV = hh.j; snap(); dragging = { i: hh.i, j: hh.j }; renderSide(); view.redraw(); return; }
    if (e.detail === 2) { const eh = edgeHit(mx, my); if (eh) { snap(); const it = items()[eh.i]; it.insert(eh.j, rnd(wx), rnd(wy)); selIdx = eh.i; selV = eh.j; changed(); return; } }
    const eh = edgeHit(mx, my); if (eh) { selIdx = eh.i; selV = -1; renderSide(); view.redraw(); }
    view.panStart(e);
  });
  addEventListener('mousemove', e => {
    if (dragging) { const [mx, my] = view.mouse(e), [wx, wy] = view.toWorld(mx, my), it = items()[dragging.i]; if (it) { it.setPt(dragging.j, Math.round(wx * 10) / 10, Math.round(wy * 10) / 10); changed(); } return; }
    view.panMove(e);
  });
  addEventListener('mouseup', () => { dragging = null; view.panEnd(); });
  addEventListener('keydown', e => {
    if (root.style.display === 'none' || /input|select|textarea/i.test(document.activeElement.tagName)) return;
    if (e.key === 'Escape') { drawing = null; renderSide(); view.redraw(); }
    if (e.key === 'Enter' && drawing) finishDrawing();
    if ((e.key === 'Delete' || e.key === 'Backspace') && selV >= 0) { const it = items()[selIdx]; if (it && it.type === 'poly' && it.n > it.min) { snap(); it.remove(selV); selV = -1; changed(); } else if (it && it.type === 'point') { snap(); LAYERS[layer].del(m(), selIdx); selIdx = 0; selV = -1; changed(); renderSide(); } }
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); }
  });
  function finishDrawing() {
    const D = drawing; drawing = null;
    if (D.spec.type === 'poly' && D.pts.length < D.spec.min) { renderSide(); view.redraw(); return; }
    snap();
    if (D.spec.type === 'point') D.spec.make(D.pts[0]); else D.spec.make(D.pts);
    selIdx = items().length - 1; selV = -1; changed(); renderSide();
  }

  // ---- side panel ----------------------------------------------------------------------------------------------------------------------
  function renderSide() {
    const L = LAYERS[layer], its = items(); if (selIdx >= its.length) selIdx = Math.max(0, its.length - 1);
    put(side, 
      h('h3', {}, 'Map'),
      field('Layer', selectInput(layer, Object.entries(LAYERS).map(([k, v]) => [k, v.name]), v => { layer = v; selIdx = 0; selV = -1; drawing = null; renderSide(); view.redraw(); })),
      h('div', { class: 'row' },
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: showImg, onchange: e => { showImg = e.target.checked; view.redraw(); } }), 'Your map image'),
        h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: alpha, oninput: e => { alpha = +e.target.value; view.redraw(); } })),
      h('div', { class: 'row' },
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: showBuilt, onchange: e => { showBuilt = e.target.checked; view.redraw(); } }), 'Built road network'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: showAll, onchange: e => { showAll = e.target.checked; view.redraw(); } }), 'Shops & stations')),
      h('div', { class: 'row' },
        L.add ? h('button', { class: 'btn', onclick: () => { drawing = { spec: L.add(m()), pts: [] }; renderSide(); } }, '+ New') : null,
        h('button', { class: 'btn', onclick: undo }, 'Undo'),
        h('button', { class: 'btn pri', onclick: () => ctx.rebuild() }, 'Rebuild roads')),
      drawing ? h('p', { class: 'hint warn' }, drawing.spec.type === 'poly' ? 'Click to add points. Enter (or the Finish button) ends the line. Esc cancels.' : drawing.spec.type === 'rect' ? 'Click two opposite corners.' : 'Click where it goes.') : null,
      drawing && drawing.spec.type === 'poly' ? h('button', { class: 'btn', onclick: finishDrawing }, 'Finish') : null,
      h('div', { class: 'list' }, its.map((it, i) => h('div', { class: 'li' + (i === selIdx ? ' on' : ''), onclick: () => { selIdx = i; selV = -1; renderSide(); view.redraw(); if (it.n) { const p = it.getPt(0), [sx, sy] = sc(p[0], p[1]); if (sx < 0 || sy < 0 || sx > view.w || sy > view.h) { view.ox += view.w / 2 - sx; view.oy += view.h / 2 - sy; view.redraw(); } } } }, it.label || ('#' + i)))),
      its[selIdx] && its[selIdx].props && its[selIdx].props.length ? h('div', { class: 'props' }, its[selIdx].props.map(p => propRow(p))) : null,
      its[selIdx] && L.del ? h('button', { class: 'btn danger', onclick: () => { snap(); L.del(m(), selIdx); selIdx = 0; selV = -1; changed(); renderSide(); } }, 'Delete this one') : null,
      h('p', { class: 'hint' }, 'Drag a dot to move it. Double-click a line to add a point. Right-click a dot to remove it. Drag empty space to pan, wheel to zoom. Ctrl+Z undoes.'),
      builtInfo()
    );
  }
  function propRow(p) {
    let inp;
    const upd = fn => v => { fn(v); ctx.dirty('map'); view.redraw(); };
    if (p.kind === 'num') inp = numInput(p.get(), upd(p.set), p.step || 1);
    else if (p.kind === 'text') inp = textInput(p.get(), upd(p.set), '150px');
    else if (p.kind === 'select') inp = selectInput(p.get(), p.opts, upd(p.set));
    else if (p.kind === 'color') inp = colorInput(p.get(), upd(p.set));
    else inp = h('input', { type: 'checkbox', checked: p.get(), onchange: e => upd(p.set)(e.target.checked) });
    inp.addEventListener('focus', () => snap(), { once: true });
    return field(p.label, inp);
  }
  function builtInfo() {
    const city = ctx.cityIfBuilt();
    if (!city) return h('p', { class: 'hint' }, 'Press "Rebuild roads" to see the road network the game makes from this map (white lines).');
    return h('div', { class: 'hint' }, `Built: ${city.roadEdges.length} road pieces, ${Object.keys(city.roadNodes).length} junctions` + (city.warnings && city.warnings.length ? `, ${city.warnings.length} warning(s):` : '.'),
      city.warnings && city.warnings.length ? h('ul', {}, city.warnings.slice(0, 8).map(w => h('li', {}, String(w)))) : null);
  }
  function setBuilt() {
    const city = ctx.cityIfBuilt(); if (!city) { builtEdges = null; return; }
    const X0 = m().origin[0], Y0 = m().origin[1], N = city.roadNodes, px = n => [X0 - n.x / S, Y0 - n.z / S];
    builtEdges = city.roadEdges.filter(e => N[e.from] && N[e.to]).map(e => [px(N[e.from]), px(N[e.to])]);
  }
  view.initial = [0, 0, 1180, 1240];
  renderSide();
  return {
    el: root,
    show() { root.style.display = ''; view.fit(); renderSide(); },
    hide() { root.style.display = 'none'; },
    refresh() { setBuilt(); renderSide(); view.redraw(); },
    reset() { hist = []; selIdx = 0; selV = -1; setBuilt(); renderSide(); view.redraw(); }
  };
}
