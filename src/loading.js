// Start-up progress bar. The game builds the whole city synchronously, so main.js calls `await tick(label, pct)`
// between the big stages: that updates the bar and lets the browser paint before the next stage blocks it.
// The shimmer is a CSS transform animation, so it keeps moving on the compositor even while a stage is running.
const $ = id => document.getElementById(id);
const t0 = performance.now();
export function tick(label, pct) {
  const box = $('loading'); if (!box) return Promise.resolve();
  $('loadingBar').style.width = Math.round(pct * 100) + '%';
  $('loadingLabel').textContent = label;
  $('loadingPct').textContent = Math.round(pct * 100) + '%';
  return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
}
export function loadingDone() {
  const box = $('loading'); if (!box) return;
  $('loadingBar').style.width = '100%'; $('loadingPct').textContent = '100%';
  box.classList.add('done');
  setTimeout(() => box.remove(), 600);
  try { console.info('start-up ' + Math.round(performance.now() - t0) + ' ms'); } catch (e) { /* ignore */ }
}
