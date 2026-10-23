// A plain north-up street map in the bottom-left corner: pale map-style land, grey buildings,
// green parks, blue water, white streets with grey casings and orange highways. The whole city
// is drawn once to an offscreen canvas; each frame only a window of it, centred on the player,
// is copied across, then the player arrow and checkpoint dots go on top.
//
// "Up" on the map is world +z (the way the car faces at spawn) and right is world -x, which is
// exactly what you'd see looking straight down on the city with +z at the top of the screen.

const MAX_SCALE = 1.2;       // offscreen pixels per world unit (lowered automatically so the canvas stays under ~10 megapixels)
const VIEW_UNITS_W = 340;    // how much world the box shows
const ROAD = {
  local:   { casing: '#b8b4aa', fill: '#ffffff', extra: 1.6 },
  avenue:  { casing: '#c9bb78', fill: '#fff6c8', extra: 1.8 },
  highway: { casing: '#c98a22', fill: '#f9b84c', extra: 2.2 }
};

export function createMinimap(city, roadsGroup) {
  const el = document.createElement('canvas');
  el.id = 'minimap';
  el.title = 'Click for the city map (M)';
  document.body.appendChild(el);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = 220, H = 150;
  el.width = W * dpr; el.height = H * dpr;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  const ctx = el.getContext('2d');

  // ---- bounds of everything worth drawing ----
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  Object.values(city.roadNodes).forEach(n => {
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minZ = Math.min(minZ, n.z); maxZ = Math.max(maxZ, n.z);
  });
  const realBounds = { minX, maxX, minZ, maxZ };
  const PAD = VIEW_UNITS_W / 2 + 12;   // the view window must never reach past the drawn map (browsers handle out-of-bounds drawImage differently - the highway ring sits right at the old edge)
  minX -= PAD; maxX += PAD; minZ -= PAD; maxZ += PAD;
  const SCALE = Math.min(MAX_SCALE, Math.sqrt(10e6 / ((maxX - minX) * (maxZ - minZ))));
  const toU = x => (-x - -maxX) * SCALE;   // right = -x
  const toV = z => (-z - -maxZ) * SCALE;   // up = +z
  const off = document.createElement('canvas');
  off.width = Math.ceil((maxX - minX) * SCALE); off.height = Math.ceil((maxZ - minZ) * SCALE);
  const o = off.getContext('2d');
  o.fillStyle = '#ece8df'; o.fillRect(0, 0, off.width, off.height);

  const poly = (fp, fill, stroke) => {
    o.beginPath();
    fp.forEach(([x, z], i) => (i ? o.lineTo(toU(x), toV(z)) : o.moveTo(toU(x), toV(z))));
    o.closePath();
    o.fillStyle = fill; o.fill();
    if (stroke) { o.strokeStyle = stroke; o.lineWidth = 1; o.stroke(); }
  };
  (city.parcels || []).forEach(p => {
    if (p.type === 'park') poly(p.footprint, '#c6e2b6');
    else if (p.type === 'water' || p.type === 'lake') poly(p.footprint, '#a9d3e8');
    else if (p.type === 'plaza') poly(p.footprint, '#e6e1d4', '#d6d0c0');
  });
  (city.parcels || []).forEach(p => { if (p.type === 'building') poly(p.footprint, '#d8d3c8', '#c4beb0'); });

  const paths = (roadsGroup.userData.mapPaths || []).slice();
  const order = { local: 0, avenue: 1, highway: 2 };
  paths.sort((a, b) => (order[a.type] || 0) - (order[b.type] || 0));
  const stroke = (p, color, extra, dash) => {
    o.beginPath();
    p.pts.forEach(([x, z], i) => (i ? o.lineTo(toU(x), toV(z)) : o.moveTo(toU(x), toV(z))));
    o.strokeStyle = color; o.lineWidth = Math.max(2, (p.width + extra) * SCALE);
    o.lineCap = 'round'; o.lineJoin = 'round';
    o.setLineDash(dash || []); o.stroke();
  };
  paths.forEach(p => stroke(p, (ROAD[p.type] || ROAD.local).casing, (ROAD[p.type] || ROAD.local).extra * 2));
  paths.forEach(p => stroke(p, (ROAD[p.type] || ROAD.local).fill, 0, p.structure === 'tunnel' ? [10, 8] : null));

  const unitsH = VIEW_UNITS_W * H / W;
  function update(car, checkpoints = [], extras = null) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ece8df'; ctx.fillRect(0, 0, W, H);
    // window into the offscreen map, centred on the car
    const cu = toU(car.x), cv = toV(car.z);
    const sw = VIEW_UNITS_W * SCALE, sh = unitsH * SCALE;
    let sx = cu - sw / 2, sy = cv - sh / 2;
    const cx0 = Math.max(0, sx), cy0 = Math.max(0, sy), cx1 = Math.min(off.width, sx + sw), cy1 = Math.min(off.height, sy + sh);
    if (cx1 > cx0 && cy1 > cy0) {
      ctx.drawImage(off, cx0, cy0, cx1 - cx0, cy1 - cy0, (cx0 - sx) / sw * W, (cy0 - sy) / sh * H, (cx1 - cx0) / sw * W, (cy1 - cy0) / sh * H);
    }
    const k = W / VIEW_UNITS_W; // css px per world unit
    const px = (x) => W / 2 + (-x - -car.x) * k;
    const py = (z) => H / 2 + (-z - -car.z) * k;

    // taxi job: the planned route, then the pickup / drop-off pin (clamped to the edge when off the map)
    if (extras && extras.route && extras.route.length > 1) {
      ctx.save();
      ctx.beginPath();
      extras.route.forEach(([x, z], i) => (i ? ctx.lineTo(px(x), py(z)) : ctx.moveTo(px(x), py(z))));
      ctx.strokeStyle = 'rgba(47,124,246,.85)'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      ctx.restore();
    }
    if (extras && extras.markers) extras.markers.forEach(m => {
      let x = px(m.x), y = py(m.z), edge = false;
      const cx = Math.max(10, Math.min(W - 10, x)), cy = Math.max(10, Math.min(H - 10, y));
      if (cx !== x || cy !== y) { edge = true; x = cx; y = cy; }
      ctx.beginPath(); ctx.arc(x, y, edge ? 7 : 9, 0, Math.PI * 2);
      ctx.fillStyle = m.color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#111'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(m.label, x, y + 0.5);
    });

    ctx.fillStyle = '#e53935'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    checkpoints.forEach(cp => {
      if (cp.hit) return;
      const x = px(cp.x), y = py(cp.z);
      if (x < 4 || x > W - 4 || y < 4 || y > H - 4) return;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });

    // the player: a blue arrow pointing the way the car faces (world forward = (sin h, cos h))
    const ang = Math.atan2(-Math.cos(car.heading), -Math.sin(car.heading));
    ctx.translate(W / 2, H / 2); ctx.rotate(ang);
    ctx.fillStyle = '#2f7cf6'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, 6); ctx.lineTo(-3, 0); ctx.lineTo(-6, -6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }


  // ---- the whole-city map (M, or tap the minimap): the same picture fitted to the screen, with every pin ----
  const full = document.createElement('div');
  full.id = 'fullmap';
  full.innerHTML = '<canvas></canvas><div class="fmhead">City map <small>· tap or press M / Esc to close</small></div><div class="fmleg"></div>';
  document.body.appendChild(full);
  const fcv = full.querySelector('canvas'), fctx = fcv.getContext('2d');
  const st = document.createElement('style');
  st.textContent = `#fullmap { position: fixed; inset: 0; z-index: 25; display: none; background: rgba(8,12,18,.88); cursor: pointer; }
    #fullmap canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    #fullmap .fmhead { position: absolute; left: 0; right: 0; top: 10px; text-align: center; color: #fff; font: 700 18px system-ui, sans-serif; text-shadow: 0 1px 6px #000; pointer-events: none; }
    #fullmap .fmhead small { font-weight: 400; font-size: 12px; opacity: .8; }
    #fullmap .fmleg { position: absolute; left: 0; right: 0; bottom: 10px; text-align: center; color: #dfe8f2; font: 12px system-ui, sans-serif; pointer-events: none; text-shadow: 0 1px 4px #000; }
    #minimap { cursor: pointer; }`;
  document.head.appendChild(st);
  let fullOpen = false, fbase = null, lastFull = 0;
  const fullRect = (() => {   // the drawn part of the offscreen map worth showing (roads +/- a margin), in offscreen pixels
    const m = 70, x0 = toU(realBounds.maxX + m), x1 = toU(realBounds.minX - m), y0 = toV(realBounds.maxZ + m), y1 = toV(realBounds.minZ - m);
    return { x0, y0, w: x1 - x0, h: y1 - y0 };
  })();
  function drawFull(car, checkpoints = [], extras = null) {
    const dp = Math.min(2, window.devicePixelRatio || 1), cw = innerWidth, ch = innerHeight;
    const now = performance.now();
    if (now - lastFull < 90) return;     // 10 fps is plenty for a pulsing ring
    lastFull = now;
    if (fcv.width !== Math.round(cw * dp) || fcv.height !== Math.round(ch * dp)) { fcv.width = Math.round(cw * dp); fcv.height = Math.round(ch * dp); fbase = null; }
    const topPad = 44, botPad = 40, aw = cw - 24, ah = ch - topPad - botPad;
    const f = Math.min(aw / fullRect.w, ah / fullRect.h);
    const dw = fullRect.w * f, dh = fullRect.h * f, ox = (cw - dw) / 2, oy = topPad + (ah - dh) / 2;
    if (!fbase) {   // the scaled-down city is drawn once per window size, not every frame
      fbase = document.createElement('canvas'); fbase.width = fcv.width; fbase.height = fcv.height;
      const bc = fbase.getContext('2d'); bc.setTransform(dp, 0, 0, dp, 0, 0);
      bc.imageSmoothingQuality = 'high';
      bc.drawImage(off, fullRect.x0, fullRect.y0, fullRect.w, fullRect.h, ox, oy, dw, dh);
      bc.strokeStyle = 'rgba(255,255,255,.8)'; bc.lineWidth = 2; bc.strokeRect(ox, oy, dw, dh);
    }
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, fcv.width, fcv.height);
    fctx.drawImage(fbase, 0, 0);
    fctx.setTransform(dp, 0, 0, dp, 0, 0);
    const X = x => ox + (toU(x) - fullRect.x0) * f, Y = z => oy + (toV(z) - fullRect.y0) * f;
    const pin = (x, z, color, label, r) => {
      const px = X(x), py = Y(z);
      fctx.beginPath(); fctx.arc(px, py, r, 0, Math.PI * 2); fctx.fillStyle = color; fctx.fill(); fctx.strokeStyle = '#fff'; fctx.lineWidth = 2; fctx.stroke();
      if (label) { fctx.fillStyle = '#111'; fctx.font = 'bold ' + Math.round(r * 1.1) + 'px system-ui'; fctx.textAlign = 'center'; fctx.textBaseline = 'middle'; fctx.fillText(label, px, py + 0.5); }
    };
    if (extras && extras.route && extras.route.length > 1) {
      fctx.beginPath(); extras.route.forEach(([x, z], i) => (i ? fctx.lineTo(X(x), Y(z)) : fctx.moveTo(X(x), Y(z))));
      fctx.strokeStyle = 'rgba(47,124,246,.85)'; fctx.lineWidth = 4; fctx.lineJoin = 'round'; fctx.stroke();
    }
    (extras && extras.markers || []).forEach(m => pin(m.x, m.z, m.color, m.label, 9));
    checkpoints.forEach(cp => { if (!cp.hit) pin(cp.x, cp.z, '#e53935', '', 4.5); });
    // you: a big arrow with a pulsing ring so it is easy to find
    const t = performance.now() / 1000, px = X(car.x), py = Y(car.z);
    fctx.beginPath(); fctx.arc(px, py, 14 + 5 * Math.sin(t * 4), 0, Math.PI * 2); fctx.strokeStyle = 'rgba(47,124,246,.7)'; fctx.lineWidth = 3; fctx.stroke();
    fctx.save(); fctx.translate(px, py); fctx.rotate(Math.atan2(-Math.cos(car.heading), -Math.sin(car.heading)));
    fctx.fillStyle = '#2f7cf6'; fctx.strokeStyle = '#fff'; fctx.lineWidth = 2.5;
    fctx.beginPath(); fctx.moveTo(13, 0); fctx.lineTo(-9, 9); fctx.lineTo(-4, 0); fctx.lineTo(-9, -9); fctx.closePath(); fctx.fill(); fctx.stroke();
    fctx.restore();
    fctx.fillStyle = '#fff'; fctx.font = 'bold 12px system-ui'; fctx.textAlign = 'center'; fctx.textBaseline = 'bottom'; fctx.fillText('YOU', px, py - 18);
  }
  const legend = full.querySelector('.fmleg');
  legend.innerHTML = '🔵 you &nbsp; <b style="color:#ffd21f">⌂</b> apartments (green = yours) &nbsp; <b style="color:#4aa3ff">P</b> your garage gate &nbsp; <b style="color:#19c6b7">RE</b> estate agents &nbsp; <b>D P R T B</b> dealer · performance · paint · tuning · body shops &nbsp; <b style="color:#ff4d4d">DR</b> drag · <b style="color:#ff9f1c">DF</b> drift · <b style="color:#3b82f6">CI</b> circuit · <b style="color:#2ee66b">SP</b> sprint races';
  let escAt = -1e9;
  addEventListener('keydown', e => {
    if (e.repeat || (e.target && e.target.closest && e.target.closest('input,textarea'))) return;
    const wp = document.getElementById('wpanel'), shopOpen = wp && wp.style.display === 'flex';
    if (e.code === 'KeyM' && !shopOpen && !document.querySelector('#menu.open, .menu.open')) setFull(!fullOpen);
    else if (e.code === 'Escape' && fullOpen) { setFull(false); escAt = performance.now(); }
  });
  const setFull = v => { fullOpen = v; lastFull = 0; full.style.display = v ? 'block' : 'none'; };
  full.addEventListener('click', () => setFull(false));
  el.addEventListener('click', () => setFull(true));

  return { el, update, drawFull, setFull, toggleFull: () => setFull(!fullOpen), escAt: () => escAt, isFullOpen: () => fullOpen, debug: { off, toU, toV, paths } };
}
