// Small helpers shared by the Studio tabs: DOM builder, pan/zoom canvas view, colours.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') el.className = v; else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, ''); else if (v !== false && v != null) el.setAttribute(k, v);
  }
  kids.flat().forEach(c => { if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return el;
}
export const clone = o => JSON.parse(JSON.stringify(o));
export const hex = n => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
export const unhex = s => parseInt(String(s).replace('#', ''), 16) || 0;
export const SC = 2.3, S = 2.5;      // image px -> map px; map px -> world units

// A canvas you can pan (drag) and zoom (wheel). World = whatever units the caller draws in (map px for the map, etc.)
export class View {
  constructor(canvas, draw) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.draw = draw; this.k = 0.5; this.ox = 0; this.oy = 0; this.drag = null; this.raf = 0;
    new ResizeObserver(() => this.fit()).observe(canvas.parentElement);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, w = this.toWorld(sx, sy), f = Math.exp(-e.deltaY * 0.0015);
      this.k = Math.max(0.05, Math.min(12, this.k * f)); this.ox = sx - w[0] * this.k; this.oy = sy - w[1] * this.k; this.redraw();
    }, { passive: false });
  }
  fit() { const p = this.c.parentElement, dpr = window.devicePixelRatio || 1; this.w = p.clientWidth; this.h = p.clientHeight; this.c.width = this.w * dpr; this.c.height = this.h * dpr; this.c.style.width = this.w + 'px'; this.c.style.height = this.h + 'px'; this.dpr = dpr; if (this.w > 0 && this.h > 0 && this.initial) { const i = this.initial; this.initial = null; this.centreOn(...i); } this.redraw(); }
  toScreen(x, y) { return [x * this.k + this.ox, y * this.k + this.oy]; }
  toWorld(sx, sy) { return [(sx - this.ox) / this.k, (sy - this.oy) / this.k]; }
  mouse(e) { const r = this.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  centreOn(x0, y0, x1, y1) { if (!(this.w > 0 && this.h > 0)) { this.initial = [x0, y0, x1, y1]; return; } const k = Math.min(this.w / (x1 - x0), this.h / (y1 - y0)) * 0.92; this.k = k; this.ox = this.w / 2 - (x0 + x1) / 2 * k; this.oy = this.h / 2 - (y0 + y1) / 2 * k; this.redraw(); }
  panStart(e) { this.drag = { sx: e.clientX, sy: e.clientY, ox: this.ox, oy: this.oy }; }
  panMove(e) { if (!this.drag) return false; this.ox = this.drag.ox + e.clientX - this.drag.sx; this.oy = this.drag.oy + e.clientY - this.drag.sy; this.redraw(); return true; }
  panEnd() { const was = !!this.drag; this.drag = null; return was; }
  redraw() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; const c = this.ctx; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, this.w, this.h); this.draw(c, this); }); }
}
export function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return { d: Math.hypot(px - ax - dx * t, py - ay - dy * t), t, x: ax + dx * t, y: ay + dy * t };
}
export function field(label, input, hint) { return h('label', { class: 'f' }, h('span', {}, label), input, hint ? h('em', {}, hint) : null); }
export function numInput(v, on, step = 'any', w = '70px') { const i = h('input', { type: 'number', step, value: v, style: 'width:' + w }); i.addEventListener('input', () => { const n = parseFloat(i.value); if (Number.isFinite(n)) on(n); }); return i; }
export function textInput(v, on, w = '140px') { const i = h('input', { type: 'text', value: v ?? '', style: 'width:' + w }); i.addEventListener('input', () => on(i.value)); return i; }
export function selectInput(v, opts, on) { const s = h('select', {}, opts.map(o => h('option', { value: Array.isArray(o) ? o[0] : o, selected: (Array.isArray(o) ? o[0] : o) === v }, Array.isArray(o) ? o[1] : o))); s.addEventListener('change', () => on(s.value)); return s; }
export function colorInput(v, on) { const i = h('input', { type: 'color', value: hex(v) }); i.addEventListener('input', () => on(unhex(i.value))); return i; }

export const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
