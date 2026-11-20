// F3 (or ?perf in the address): a small performance read-out. Frame rate, frame time (average / worst in the last second), draw calls,
// triangles, and a count of hitches (frames slower than 50 ms) with the last few, so freezes can be measured on a real device.
export function createPerfHud(renderer) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:10px;top:64px;z-index:20;font:12px/1.35 ui-monospace,monospace;color:#cfe;background:rgba(0,0,0,.72);padding:6px 9px;border-radius:8px;white-space:pre;pointer-events:none;display:none';
  document.body.appendChild(el);
  let on = /[?&]perf\b/.test(location.search), last = performance.now(), acc = 0, n = 0, worst = 0, t0 = last, hitches = 0; const recent = [];
  const load = performance.now();
  addEventListener('keydown', e => { if (e.code === 'F3') { on = !on; el.style.display = on ? 'block' : 'none'; e.preventDefault(); } });
  if (on) el.style.display = 'block';
  return function tick() {
    const now = performance.now(), dt = now - last; last = now;
    if (dt > 50 && now - load > 4000) { hitches++; recent.unshift(Math.round(dt) + ' ms @ ' + ((now - load) / 1000).toFixed(0) + ' s'); recent.length = Math.min(recent.length, 4); }
    acc += dt; n++; worst = Math.max(worst, dt);
    if (now - t0 >= 1000) {
      if (on) { const i = renderer.info.render; el.textContent = 'FPS ' + Math.round(1000 * n / acc) + '   frame ' + (acc / n).toFixed(1) + ' ms (worst ' + worst.toFixed(0) + ')\ndraw calls ' + i.calls + '   triangles ' + (i.triangles / 1000).toFixed(0) + 'k\nhitches >50 ms: ' + hitches + (recent.length ? '\n  ' + recent.join('\n  ') : ''); }
      acc = 0; n = 0; worst = 0; t0 = now;
    }
  };
}
