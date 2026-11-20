// Studio: city builder. A toolbar in the spirit of a city-building game: pick a road type, a building, a service or a transit piece from a menu of
// cards (picture, name, what it does), then click the map to put it down. Roads are drawn point by point (pins mark each point, coloured by type),
// bridges and tunnels are dropped onto a road, and the map can show the roads the game really builds: every lane, the traffic lights, the stop signs
// and where the road changes width (the lanes merge there).
import { BKINDS, FIELDS } from '../buildKinds.js';
import { put, h, View, SC, S } from './common.js';
import refUrl from './ref-map.png';
import { SHOP_KINDS } from '../chicago/chicago.js';
import { nearestRoadPoint } from './snap.js';
import { roundabout, ROUNDABOUTS, slipRoads, interchange, elevatedStructs, HW_OFF, gridStreets, ZONES, zoneFill } from './pieces.js';
import { CLASSES } from '../chicago/network.js';

const M_PER_U = 1.25;
const ROAD_TYPES = [
  { id: 'six', name: 'Express avenue', color: '#e8a21a', pin: 'E', blurb: 'The widest street: fast traffic, long junction spacing.' },
  { id: 'four', name: 'Main avenue', color: '#f0d23c', pin: 'M', blurb: 'A main arterial: shops and bus routes line it.' },
  { id: 'two', name: 'Local street', color: '#e8605f', pin: 'L', blurb: 'A quiet residential street, slow and narrow.' },
  { id: 'tram', cls: 'four', name: 'Tram avenue', color: '#d9534f', pin: 'T', blurb: 'A main avenue with a tram track in the lane next to the middle, each way. A tram line runs along it, out and back, stopping at its stops.', tram: true },
  { id: 'ped', cls: 'two', name: 'Pedestrian street', color: '#c8b89a', pin: 'P', blurb: 'Paved and car-free: no traffic drives here, but people walk. Good for shopping streets.', ped: true },
  { id: 'hw', name: 'Highway', color: '#2e9d5a', pin: 'H', blurb: 'Two carriageways of 3 lanes, 120 km/h, one-way each. It crosses other roads at ground level unless you put a bridge or tunnel there.', pair: true },
  { id: 'hwE', cls: 'hw', name: 'Elevated highway', color: '#1f8f8f', pin: 'V', blurb: 'A highway on a long viaduct, 8 m up: streets and buildings fit underneath. It comes down in ramps at both ends.', pair: true, elev: true }
];
const rtOfStreet = s => (s.tram ? ROAD_TYPES.find(r => r.id === 'tram') : s.ped ? ROAD_TYPES.find(r => r.id === 'ped') : ROAD_TYPES.find(r => r.id === s.cls)) || ROAD_TYPES[2];
const roadType = id => ROAD_TYPES.find(r => r.id === id) || ROAD_TYPES[2];
const CATS = [
  { id: 'road', name: 'Roads', color: '#f0d23c', tools: [
    { id: 'select', name: 'Select', blurb: 'Click a road pin or a bridge/tunnel pin to select it: change its type, rename it, edit a bridge, or delete it. Right-click a pin also deletes. Pin letters are the road type: E express, M main, L local, T tram, P pedestrian, H highway, V elevated highway.' },
    ...ROAD_TYPES.map(r => ({ id: 'road:' + r.id, name: r.name, road: r.id, blurb: r.blurb })),
    { id: 'grid', name: 'Street grid', rect: 'grid', blurb: 'Click two corners: a block of streets, one every 90 m (set below). Ends join the roads they touch.' },
    { id: 'bridge', name: 'Bridge', blurb: 'Click a road: that stretch is lifted over what it crosses, with ramps up and down.', struct: 1 },
    { id: 'tunnel', name: 'Tunnel', blurb: 'Click a road: that stretch goes underground, with ramps down and up.', struct: -1 } ] },
  { id: 'junction', name: 'Junctions', color: '#3dd6a5', tools: [
    { id: 'inter:diamond', name: 'Highway interchange', piece: 'inter', blurb: 'Click a highway: a street crosses it on a bridge, with four slip roads (diamond interchange).' },
    { id: 'inter:round', name: 'Roundabout interchange', piece: 'inter', round: true, blurb: 'Click a highway: a street crosses it on a bridge, with a roundabout and slip roads on each side.' },
    { id: 'inter:clover', name: 'Cloverleaf', piece: 'inter', clover: true, blurb: 'Click a highway: a street crosses on a bridge, with four 35 km/h loop ramps that climb to it and four outer ramps. Needs a long highway.' },
    { id: 'slip', name: 'Exit & entry ramps', piece: 'slip', blurb: 'Click a highway carriageway: an exit and an entry ramp with a short street to connect to.' },
    ...Object.entries(ROUNDABOUTS).map(([k, r]) => ({ id: 'round:' + k, name: r.name, piece: 'round', kind: k, blurb: r.blurb + ' Click a junction: the streets are cut back to the ring.' })) ] },
  { id: 'nature', name: 'Trees & props', color: '#6aa56b', tools: [
    { id: 'prop:tree', name: 'Tree', prop: 'tree', blurb: 'A street tree.' }, { id: 'prop:oak', name: 'Oak', prop: 'oak', blurb: 'A big round tree: shade for a park or a square.' },
    { id: 'prop:bush', name: 'Bush', prop: 'bush', blurb: 'A bush or hedge piece. You can drive through it.' }, { id: 'prop:bench', name: 'Bench', prop: 'bench', blurb: 'A park bench.' },
    { id: 'prop:fountain', name: 'Fountain', prop: 'fountain', blurb: 'A fountain for a square.' }, { id: 'prop:gazebo', name: 'Gazebo', prop: 'gazebo', blurb: 'A park gazebo.' },
    { id: 'prop:picnic', name: 'Picnic table', prop: 'picnic', blurb: 'A picnic table.' }, { id: 'prop:foodstand', name: 'Food stand', prop: 'foodstand', blurb: 'A snack stand.' },
    { id: 'prop:cafeset', name: 'Cafe tables', prop: 'cafeset', blurb: 'Outdoor tables and chairs.' }, { id: 'prop:hydrant', name: 'Hydrant', prop: 'hydrant', blurb: 'A fire hydrant.' },
    { id: 'prop:mailbox', name: 'Mailbox', prop: 'mailbox', blurb: 'A mailbox.' } ] },
  { id: 'zone', name: 'Zones', color: '#7bd36a', tools: Object.entries(ZONES).map(([k, z]) => ({ id: 'zone:' + k, name: z.name, rect: 'zone', zone: k, color: z.color, blurb: z.blurb + ' Click two corners: buildings fill the space between the streets.' })) },
  { id: 'build', name: 'Buildings', color: '#e56bb0', tools: Object.entries(BKINDS).map(([k, b]) => ({ id: 'b:' + k, bk: k, name: b.name, size: b.size, hgt: b.h, blurb: b.blurb })) },
  { id: 'land', name: 'Land', color: '#8fae3c', tools: Object.entries(FIELDS).map(([k, f]) => ({ id: 'field:' + k, field: k, name: f.name, rect: 'field', color: '#' + f.color.toString(16).padStart(6, '0'), blurb: f.blurb + ' Click two corners. Roads can cross it; generated buildings keep off it.' })) },
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
    const k = CLASSES[roadType(t.road).cls || t.road], hwy = (roadType(t.road).cls || t.road) === 'hw', lanes = hwy ? 3 : k.lanes, wpx = Math.min(W - 10, 30 + (hwy ? 46 : k.width) * 4.2), x0 = (W - wpx) / 2, sw = 5;
    c.fillStyle = '#9aa0a6'; c.fillRect(x0 - sw, 4, wpx + 2 * sw, H - 8); c.fillStyle = '#3b4048'; c.fillRect(x0, 4, wpx, H - 8);
    const n = lanes * 2, lw = wpx / n; if (hwy) { c.fillStyle = '#5b6068'; c.fillRect(x0 + wpx / 2 - 3, 4, 6, H - 8); } c.strokeStyle = '#e9e9e4'; c.lineWidth = 1.2; c.setLineDash([5, 5]);
    for (let i = 1; i < n; i++) { if (i === lanes) continue; c.beginPath(); c.moveTo(x0 + lw * i, 4); c.lineTo(x0 + lw * i, H - 4); c.stroke(); } c.setLineDash([]);
    c.strokeStyle = hwy ? 'rgba(0,0,0,0)' : '#f0c020'; c.lineWidth = 1.6; [-1.5, 1.5].forEach(o => { c.beginPath(); c.moveTo(x0 + wpx / 2 + o, 4); c.lineTo(x0 + wpx / 2 + o, H - 4); c.stroke(); });
    c.fillStyle = t.color || roadType(t.road).color; c.beginPath(); c.arc(14, 14, 7, 0, 7); c.fill(); c.fillStyle = '#000'; c.font = 'bold 9px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(roadType(t.road).pin, 14, 14.5); return;
  }
  if (t.bk) { const B = BKINDS[t.bk], hh = Math.min(H - 16, 14 + B.h * 0.5), ww = Math.min(70, 16 + B.size[0] * 4), hex = '#' + B.color.toString(16).padStart(6, '0'); box(W / 2 - ww / 2, H - 10 - hh, ww, hh, hex, B.h > 10); if (B.podium) box(W / 2 - 40, H - 22, 80, 12, '#d9a066', 1); if (B.roof === 'gable') { c.fillStyle = '#7a3a2e'; c.beginPath(); c.moveTo(W / 2 - ww / 2 - 3, H - 10 - hh); c.lineTo(W / 2, H - 22 - hh); c.lineTo(W / 2 + ww / 2 + 3, H - 10 - hh); c.fill(); } return; }
  if (t.field) { const F = FIELDS[t.field], hex = n => '#' + n.toString(16).padStart(6, '0'); c.fillStyle = hex(F.color); c.fillRect(0, 0, W, H); if (F.furrow) { c.fillStyle = hex(F.furrow); for (let y = 8; y < H; y += 12) c.fillRect(0, y, W, 5); } if (F.trees) { for (let i = 0; i < 14; i++) { c.fillStyle = i % 3 ? '#3f7a3a' : '#2a5a2a'; c.beginPath(); c.arc(12 + (i * 37) % (W - 20), 12 + (i * 23) % (H - 20), 9, 0, 7); c.fill(); } } return; }
  if (t.rect === 'grid' || t.rect === 'zone') {
    c.fillStyle = '#2f3a2a'; c.fillRect(0, 0, W, H);
    if (t.rect === 'grid') { c.strokeStyle = '#59616b'; c.lineWidth = 5; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(18 + i * 31, 6); c.lineTo(18 + i * 31, H - 6); c.stroke(); } for (let j = 0; j < 3; j++) { c.beginPath(); c.moveTo(8, 12 + j * 26); c.lineTo(W - 8, 12 + j * 26); c.stroke(); } }
    else { c.strokeStyle = '#59616b'; c.lineWidth = 4; c.beginPath(); c.moveTo(W / 2, 4); c.lineTo(W / 2, H - 4); c.moveTo(6, H / 2); c.lineTo(W - 6, H / 2); c.stroke();
      const col = t.color || '#7bd36a'; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 3; k++) for (let m = 0; m < 2; m++) { const bh = t.zone === 'commercial' ? 14 + ((i + j + k) % 3) * 5 : t.zone === 'industrial' ? 9 : 7 + (k % 2) * 3; c.fillStyle = col; c.globalAlpha = 0.85; c.fillRect(i * (W / 2) + 8 + k * 16, j * (H / 2) + 6 + m * 14, 12, Math.min(11, bh)); c.globalAlpha = 1; } }
    return;
  }
  if (t.prop) {
    c.fillStyle = '#4c7a3e'; c.fillRect(0, H - 22, W, 22); const cx = W / 2, g0 = H - 18, k = t.prop;
    if (k === 'tree' || k === 'oak') { c.fillStyle = '#6b4a2b'; c.fillRect(cx - 3, g0 - 26, 6, 26); c.fillStyle = k === 'oak' ? '#2f7a34' : '#3e9a43'; c.beginPath(); c.arc(cx, g0 - 38, k === 'oak' ? 22 : 16, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.arc(cx - 6, g0 - 44, 8, 0, 7); c.fill(); }
    else if (k === 'bush') { c.fillStyle = '#2f7a34'; [[-14, 0, 12], [0, -4, 15], [14, 0, 12]].forEach(([x, y, r]) => { c.beginPath(); c.arc(cx + x, g0 - 10 + y, r, 0, 7); c.fill(); }); }
    else if (k === 'bench') { c.fillStyle = '#8a5a34'; c.fillRect(cx - 24, g0 - 18, 48, 6); c.fillRect(cx - 24, g0 - 10, 48, 5); c.fillStyle = '#333'; [-20, 20].forEach(x => c.fillRect(cx + x - 2, g0 - 6, 4, 8)); }
    else if (k === 'fountain') { c.fillStyle = '#9aa6b4'; c.beginPath(); c.ellipse(cx, g0 - 6, 28, 9, 0, 0, 7); c.fill(); c.fillStyle = '#4aa3df'; c.beginPath(); c.ellipse(cx, g0 - 8, 22, 6, 0, 0, 7); c.fill(); c.strokeStyle = '#bfe6ff'; c.lineWidth = 2; c.beginPath(); c.moveTo(cx, g0 - 8); c.quadraticCurveTo(cx - 8, g0 - 40, cx - 16, g0 - 14); c.moveTo(cx, g0 - 8); c.quadraticCurveTo(cx + 8, g0 - 40, cx + 16, g0 - 14); c.moveTo(cx, g0 - 8); c.lineTo(cx, g0 - 38); c.stroke(); }
    else if (k === 'gazebo') { c.fillStyle = '#e8e0d0'; [-18, 18].forEach(x => c.fillRect(cx + x - 2, g0 - 30, 4, 30)); c.fillStyle = '#b0503c'; c.beginPath(); c.moveTo(cx - 28, g0 - 30); c.lineTo(cx, g0 - 50); c.lineTo(cx + 28, g0 - 30); c.fill(); }
    else if (k === 'picnic') { c.fillStyle = '#8a5a34'; c.fillRect(cx - 24, g0 - 18, 48, 5); c.fillRect(cx - 28, g0 - 8, 56, 4); c.fillRect(cx - 18, g0 - 13, 4, 14); c.fillRect(cx + 14, g0 - 13, 4, 14); }
    else if (k === 'foodstand') { c.fillStyle = '#e8e8e8'; c.fillRect(cx - 22, g0 - 26, 44, 26); for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? '#fff' : '#d4442b'; c.fillRect(cx - 24 + i * 8, g0 - 34, 8, 9); } c.fillStyle = '#333'; c.fillRect(cx - 14, g0 - 18, 28, 8); }
    else if (k === 'cafeset') { c.fillStyle = '#ddd'; [-18, 16].forEach(x => { c.beginPath(); c.ellipse(cx + x, g0 - 14, 12, 5, 0, 0, 7); c.fill(); c.fillRect(cx + x - 1, g0 - 14, 2, 14); }); c.fillStyle = '#d4442b'; [-4, 30].forEach(x => c.fillRect(cx + x - 8, g0 - 8, 5, 8)); }
    else if (k === 'hydrant') { c.fillStyle = '#d4442b'; c.fillRect(cx - 6, g0 - 24, 12, 24); c.beginPath(); c.arc(cx, g0 - 26, 7, 0, 7); c.fill(); c.fillRect(cx - 12, g0 - 18, 24, 5); }
    else if (k === 'mailbox') { c.fillStyle = '#2b4a8c'; c.fillRect(cx - 10, g0 - 28, 20, 18); c.beginPath(); c.arc(cx, g0 - 28, 10, Math.PI, 0); c.fill(); c.fillStyle = '#555'; c.fillRect(cx - 2, g0 - 10, 4, 12); }
    return;
  }
  if (t.piece === 'inter' || t.piece === 'slip') {
    const cx = W / 2; c.fillStyle = '#2f3a2a'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#3b4048'; c.fillRect(cx - 9, 0, 18, H); c.strokeStyle = '#e9e9e4'; c.lineWidth = 1; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx, H); c.stroke(); c.setLineDash([]);
    const ramp = (x0, y0, x1, y1, x2, y2) => { c.strokeStyle = '#4a5058'; c.lineWidth = 5; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(x1, y1, x2, y2); c.stroke(); };
    if (t.piece === 'inter') {
      c.strokeStyle = '#59616b'; c.lineWidth = 9; c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
      c.fillStyle = '#6b727c'; c.fillRect(cx - 14, H / 2 - 6, 28, 12); c.strokeStyle = '#e9e9e4'; c.lineWidth = 1; c.strokeRect(cx - 14, H / 2 - 6, 28, 12);
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy]) => ramp(cx + sx * 9, H / 2 + sy * 34, cx + sx * 20, H / 2 + sy * 14, cx + sx * 36, H / 2));
      if (t.clover) { c.strokeStyle = '#59616b'; c.lineWidth = 3; [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sy]) => { c.beginPath(); c.arc(cx + sx * 20, H / 2 + sy * 17, 8, 0, 7); c.stroke(); }); }
      if (t.round) { c.strokeStyle = '#59616b'; c.lineWidth = 4; [-1, 1].forEach(sx => { c.beginPath(); c.arc(cx + sx * 40, H / 2, 7, 0, 7); c.stroke(); }); }
    } else { ramp(cx + 9, H - 6, cx + 26, H / 2 + 6, cx + 40, H / 2 - 4); ramp(cx + 40, H / 2 - 4, cx + 24, H / 2 - 14, cx + 9, 6); c.strokeStyle = '#59616b'; c.lineWidth = 7; c.beginPath(); c.moveTo(cx + 40, H / 2 - 4); c.lineTo(W - 2, H / 2 - 4); c.stroke(); }
    return;
  }
  if (t.piece === 'round') {
    const R = { small: 16, medium: 21, large: 27 }[t.kind] || 21, cx = W / 2, cy = H / 2;
    c.fillStyle = '#3b4048'; [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dx, dy]) => { c.fillRect(cx + dx * (R + 18) - (dy ? 5 : 20), cy + dy * (R + 18) - (dx ? 5 : 20), dy ? 10 : 40, dx ? 10 : 40); });
    c.strokeStyle = '#3b4048'; c.lineWidth = 11; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
    c.fillStyle = '#4c7a3e'; c.beginPath(); c.arc(cx, cy, R - 6, 0, 7); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.fillStyle = '#fff'; for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.7, x = cx + Math.cos(a) * R, y = cy - Math.sin(a) * R; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a + 1.57) * 5, y - Math.sin(a + 1.57) * 5); c.stroke(); }
    return;
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
const roadSpec = id => { const k = CLASSES[roadType(id).cls || id]; if (roadType(id).cls === 'hw' || id === 'hw') return '3+3 lanes · 2 carriageways · ' + k.speedLimit + ' km/h'; return `${k.lanes}+${k.lanes} lanes · ${Math.round(k.width * M_PER_U)} m · ${k.speedLimit} km/h`; };

export function createBuildEditor(ctx) {
  const root = h('div', { class: 'tab races' });
  const canvas = h('canvas'), wrap = h('div', { class: 'cv' }, canvas), side = h('div', { class: 'side', style: 'width:380px' });
  root.append(wrap, side);
  const img = new Image(); img.src = refUrl; img.onload = () => view.redraw();
  const r2 = v => Math.round(v * 100) / 100;
  let rectA = null, gridM = 90, gridCls = 'two', roadTrees = '', pieceNote = '', tool = 'road:four', cat = 'road', curved = true, snapInfo = null, selStruct = -1, mouse = null, drag = null, busSel = 0, metroSel = 0, roadPts = null, roadName = '', selStreet = -1, showLanes = true, showSigns = true, showImg = true, sLen = 70, sH = 6, hist = [];
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
    (md.fields || []).forEach((f, i) => { const F = FIELDS[f.kind] || {}; out.push({ k: 'field', px: [(f.rect[0] + f.rect[2]) / 2, (f.rect[1] + f.rect[3]) / 2], rect: f.rect, label: F.name || f.kind, color: '#' + (F.color || 0x5d9a45).toString(16).padStart(6, '0'), remove: () => md.fields.splice(i, 1), move: p => { const w = f.rect[2] - f.rect[0], hh = f.rect[3] - f.rect[1]; f.rect = [p[0] - w / 2, p[1] - hh / 2, p[0] + w / 2, p[1] + hh / 2].map(rd); } }); });
    (md.shops || []).forEach((s, i) => out.push({ k: 'shop', px: s.at, label: s.kind, color: '#ffb02e', remove: () => md.shops.splice(i, 1), move: p => { s.at = p; } }));
    (md.props || []).forEach((q, i) => out.push({ k: 'prop', px: q.at, label: q.type, color: '#6aa56b', remove: () => md.props.splice(i, 1), move: p => { q.at = p; } }));
    (md.stations || []).forEach((s, i) => out.push({ k: 'svc', px: s.at, label: s.kind, color: '#ff5555', remove: () => md.stations.splice(i, 1), move: p => { s.at = p; } }));
    (md.gas || []).forEach((g, i) => out.push({ k: 'gas', px: g, label: 'gas', color: '#ff7f2e', remove: () => md.gas.splice(i, 1), move: p => { md.gas[i] = p; } }));
    (md.structs || []).forEach((s, i) => { if (s.at) out.push({ k: s.h < 0 ? 'tunnel' : 'bridge', st: s, idx: i, px: s.at, label: (s.h < 0 ? 'Tunnel ' : 'Bridge ') + Math.round(s.len * M_PER_U) + ' m', color: s.h < 0 ? '#b08a5a' : '#6fb8ff', remove: () => md.structs.splice(i, 1), move: p => { s.at = p; } }); });
    T().bus.forEach(l => l.stops.forEach((s, i) => out.push({ k: 'busstop', px: toPx(s), label: l.name, color: '#ffd21f', remove: () => l.stops.splice(i, 1), move: p => { l.stops[i] = toWorld(p).map(rd); } })));
    T().metro.forEach(l => l.stations.forEach((s, i) => out.push({ k: 'metro', px: toPx(s.at), label: s.name || l.name, color: '#' + (l.color >>> 0).toString(16).padStart(6, '0').slice(-6), remove: () => l.stations.splice(i, 1), move: p => { s.at = toWorld(p).map(rd); } })));
    const d = T().depot; if (d && d.at) out.push({ k: 'depot', px: toPx(d.at), label: 'bus depot', color: '#9aa7b8', remove: () => { delete T().depot; }, move: p => { d.at = toWorld(p).map(rd); } });
    return out;
  }
  const isTransit = k => ['busstop', 'metro', 'depot'].includes(k);
  const hitThing = (mx, my) => { let b = null, bd = 14; things().forEach(t => { const q = sc(t.px), d = Math.hypot(q[0] - mx, q[1] - my); if (d < bd) { bd = d; b = t; } }); return b; };
  // streets: the pins sit on their points
  const streets = () => M().streets || [];
  function hitStreetPin(mx, my) { let b = null, bd = 12; streets().forEach((s, i) => shownPts(s).forEach((p, j) => { const q = sc(p), d = Math.hypot(q[0] - mx, q[1] - my); if (d < bd) { bd = d; b = { i, j }; } })); return b; }
  function nearRoad(p, maxPx) {         // the nearest point on any street or built road (to snap to, and to drop bridges and tunnels onto)
    let best = null;
    const test = (a, b, ref) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)), x = a[0] + dx * t, y = a[1] + dy * t, d = Math.hypot(x - p[0], y - p[1]) * view.k; if (d < maxPx && (!best || d < best.d)) best = { d, x, y, ref, ang: Math.atan2(dy, dx) }; };
    streets().forEach((s, i) => { for (let j = 1; j < s.pts.length; j++) test(s.pts[j - 1], s.pts[j], i); });
    return best;
  }
  // Snapping, in this order: the end of a road, an intersection (a built junction or a crossing of two roads), any other point of a road, and
  // finally the middle of a road (the nearest point on it). `snapAt` returns where the point goes and what it snapped to.
  const crossings = () => {                                  // where two drawn roads cross each other
    const out = [], ss = streets(); const key = ss.length + ':' + ss.reduce((t, q) => t + q.pts.length, 0);
    if (crossCache.key === key) return crossCache.v;
    for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) for (let a = 1; a < ss[i].pts.length; a++) for (let b = 1; b < ss[j].pts.length; b++) {
      const A = ss[i].pts[a - 1], B = ss[i].pts[a], C = ss[j].pts[b - 1], D = ss[j].pts[b];
      if (Math.max(A[0], B[0]) < Math.min(C[0], D[0]) || Math.max(C[0], D[0]) < Math.min(A[0], B[0]) || Math.max(A[1], B[1]) < Math.min(C[1], D[1]) || Math.max(C[1], D[1]) < Math.min(A[1], B[1])) continue;
      const d = (B[0] - A[0]) * (D[1] - C[1]) - (B[1] - A[1]) * (D[0] - C[0]); if (Math.abs(d) < 1e-9) continue;
      const t = ((C[0] - A[0]) * (D[1] - C[1]) - (C[1] - A[1]) * (D[0] - C[0])) / d, u = ((C[0] - A[0]) * (B[1] - A[1]) - (C[1] - A[1]) * (B[0] - A[0])) / d;
      if (t > 0 && t < 1 && u > 0 && u < 1) out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
    }
    crossCache = { key, v: out }; return out;
  };
  let crossCache = {};
  function snapAt(p) {
    const k = view.k, near = (q, px) => Math.hypot(q[0] - p[0], q[1] - p[1]) * k < px, ss = streets();
    let best = null, bd = 1e9; const tryPt = (q, kind, px) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]) * k; if (d < px && d < bd) { bd = d; best = { p: [q[0], q[1]], kind }; } };
    ss.forEach(s => { tryPt(s.pts[0], 'end', 16); tryPt(s.pts[s.pts.length - 1], 'end', 16); });
    if (best) return best;
    const city = ctx.cityIfBuilt();
    if (city && city.roadNodes) { const cnt = {}; city.roadEdges.forEach(e => { cnt[e.from] = (cnt[e.from] || 0) + 1; cnt[e.to] = (cnt[e.to] || 0) + 1; }); Object.keys(cnt).forEach(id => { if (cnt[id] >= 3) tryPt(toPx([city.roadNodes[id].x, city.roadNodes[id].z]), 'junction', 14); }); }
    crossings().forEach(q => tryPt(q, 'junction', 14));
    if (best) return best;
    ss.forEach(s => s.pts.forEach(q => tryPt(q, 'point', 12)));
    if (best) return best;
    const r = nearRoad(p, 12); return r ? { p: [r.x, r.y], kind: 'middle', street: r.ref } : { p, kind: 'free' };
  }
  const snapPoint = p => snapAt(p).p;

  // ---- bridges and tunnels: where they lie on their road, how long their ramps are, and what is wrong with them ----
  const polyLen = pts => pts.reduce((t, q, i) => i ? t + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0, 0);
  function alongOf(pts, pt) {        // arclength (px) of the point on the polyline, and how far off it is
    let acc = 0, best = { along: 0, d: 1e9 };
    for (let j = 1; j < pts.length; j++) { const A = pts[j - 1], B = pts[j], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-9, t = Math.max(0, Math.min(1, ((pt[0] - A[0]) * dx + (pt[1] - A[1]) * dy) / (L * L))), x = A[0] + dx * t, y = A[1] + dy * t, d = Math.hypot(x - pt[0], y - pt[1]);
      if (d < best.d) best = { along: acc + t * L, d, ang: Math.atan2(dy, dx) }; acc += L; }
    return best;
  }
  function slicePoly(pts, a, b) {    // the part of a polyline between two arclengths
    const out = []; let acc = 0;
    for (let j = 1; j < pts.length; j++) { const A = pts[j - 1], B = pts[j], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1e-9, s0 = acc, s1 = acc + L; acc = s1; if (s1 < a || s0 > b) continue;
      const f = v => { const t = (Math.max(a, Math.min(b, v)) - s0) / L; return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]; };
      if (!out.length) out.push(f(Math.max(a, s0))); out.push(f(Math.min(b, s1))); }
    return out;
  }
  function structGeo(st) {
    let best = null; streets().forEach((s, i) => { const r = alongOf(s.pts, st.at); if (!best || r.d < best.d) best = { i, s, ...r }; });
    if (!best || best.d > 6) return null;
    const k = CLASSES[best.s.cls] || CLASSES.two, g = 0.95 * (k.maxGrade || 0.06), d1 = st.len / 2, ramp = Math.abs(st.h) / g, total = polyLen(best.s.pts) * S, along = best.along * S;
    const warns = [], info = { ...best, d1, ramp, d2: (st.plat || d1) + ramp, g, total, along, warns };
    if (along - info.d2 < 4 || along + info.d2 > total - 4) warns.push('The ramps run past the end of the road (' + Math.round(info.d2 * M_PER_U) + ' m each side of the middle): the game now shortens it to fit; make the road longer or the structure shorter or lower to keep your size.');
    // junctions on the span or the ramps
    const pts = [], city = ctx.cityIfBuilt();
    streets().forEach((o, oi) => { if (oi === best.i) return; [o.pts[0], o.pts[o.pts.length - 1]].forEach(q => pts.push(q)); });
    crossings().forEach(q => pts.push(q));
    pts.forEach(q => { const r = alongOf(best.s.pts, q); if (r.d * S > 4) return; const dd = Math.abs(r.along * S - along); if (dd < d1) warns.push('A junction lies on the ' + (st.h < 0 ? 'tunnel' : 'bridge') + ' itself, ' + Math.round(dd * M_PER_U) + ' m from its middle.'); else if (dd < info.d2) warns.push('A junction lies on the ramp, ' + Math.round((dd - d1) * M_PER_U) + ' m from the ' + (st.h < 0 ? 'tunnel mouth' : 'bridge end') + ': the road would have to climb or dive through it.'); });
    (M().structs || []).forEach(o => { if (o === st || !o.at) return; const r = alongOf(best.s.pts, o.at); if (r.d * S > 6) return; const od2 = o.len / 2 + Math.abs(o.h) / g; if (Math.abs(r.along * S - along) < info.d2 + od2) warns.push('Another ' + (o.h < 0 ? 'tunnel' : 'bridge') + ' is so close that the ramps overlap.'); });
    return info;
  }
  function drawProfile(cv, st, geo) {      // side view of the road: ground, ramps, the structure and its height or depth
    const c = cv.getContext('2d'), W = cv.width, H = cv.height; c.clearRect(0, 0, W, H); c.fillStyle = '#161c24'; c.fillRect(0, 0, W, H);
    const d2 = (geo ? geo.d2 : st.len / 2 + Math.abs(st.h) / 0.057), X = u => W / 2 + u / (d2 * 1.25) * (W / 2 - 14), base = H * 0.55, hm = Math.abs(st.h) * M_PER_U, sy = Math.min(2.2, (H * 0.36) / Math.max(hm, 1)), top = base - Math.sign(st.h) * hm * sy, d1 = st.len / 2;
    c.fillStyle = '#4a3b2e'; c.fillRect(0, base, W, H - base);
    c.strokeStyle = '#8d9bb0'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(0, base); c.lineTo(W, base); c.stroke(); c.setLineDash([]);
    c.lineWidth = 4; c.strokeStyle = st.h < 0 ? '#c9a46a' : '#6fb8ff'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(X(-d2 * 1.25), base); c.lineTo(X(-d2), base); c.lineTo(X(-d1), top); c.lineTo(X(d1), top); c.lineTo(X(d2), base); c.lineTo(X(d2 * 1.25), base); c.stroke();
    c.fillStyle = '#e8edf4'; c.font = '11px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText((st.h < 0 ? 'depth ' : 'height ') + (hm).toFixed(1) + ' m', W / 2, top + (st.h < 0 ? 16 : -12));
    c.fillText('span ' + Math.round(st.len * M_PER_U) + ' m', W / 2, st.h < 0 ? top - 10 : top + 14);
    if (geo) { c.fillText('ramp ' + Math.round(geo.ramp * M_PER_U) + ' m @ ' + (geo.g * 100).toFixed(1) + '%', X(-(d1 + d2) / 2), base + (st.h < 0 ? -16 : 16)); c.fillText('ramp', X((d1 + d2) / 2), base + (st.h < 0 ? -16 : 16)); }
  }
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
    else { streets().forEach(s => { c.strokeStyle = rtOfStreet(s).color; c.lineWidth = 3; c.beginPath(); s.pts.forEach((q, i) => { const o = sc(q); i ? c.lineTo(o[0], o[1]) : c.moveTo(o[0], o[1]); }); c.stroke(); }); }
    (M().structs || []).forEach((st, i) => { if (!st.at) return; const geo = structGeo(st); if (!geo) return; const col = st.h < 0 ? '#c9a46a' : '#6fb8ff', P = geo.s.pts, a = geo.along / S;
      const ramp = (from, to) => { const q = slicePoly(P, from, to); if (q.length < 2) return; c.beginPath(); q.forEach((z, j) => { const o = sc(z); j ? c.lineTo(o[0], o[1]) : c.moveTo(o[0], o[1]); }); c.stroke(); };
      c.lineCap = 'butt'; c.setLineDash([]); c.lineWidth = (i === selStruct ? 12 : 8); c.strokeStyle = col + 'ee'; ramp(a - geo.d1 / S, a + geo.d1 / S);       // the structure itself
      c.lineWidth = 6; c.strokeStyle = col + '66'; c.setLineDash([6, 5]); ramp(a - geo.d2 / S, a - geo.d1 / S); ramp(a + geo.d1 / S, a + geo.d2 / S); c.setLineDash([]);   // the ramps
      if (geo.warns.length) { const o = sc(st.at); c.fillStyle = '#ff9f1a'; c.strokeStyle = '#000'; c.beginPath(); c.moveTo(o[0] + 14, o[1] - 24); c.lineTo(o[0] + 22, o[1] - 10); c.lineTo(o[0] + 6, o[1] - 10); c.closePath(); c.fill(); c.stroke(); } });
    streets().forEach(s => { c.strokeStyle = rtOfStreet(s).color + 'aa'; c.lineWidth = 1.5; c.setLineDash([5, 4]); c.beginPath(); s.pts.forEach((q, i) => { const o = sc(q); i ? c.lineTo(o[0], o[1]) : c.moveTo(o[0], o[1]); }); c.stroke(); c.setLineDash([]); });
    // pins: one at each end of every street (coloured by type, with its letter), small dots on the points between
    streets().forEach((s, i) => { const rt = rtOfStreet(s); if (s.pair && streets().findIndex(q => q.pair === s.pair) !== i) return; const SP = shownPts(s); SP.forEach((q, j) => { const o = sc(q), end = j === 0 || j === SP.length - 1; if (end) pin(c, o[0], o[1], i === selStreet ? '#fff' : rt.color, rt.pin, view.k > 0.8 ? 8 : 5.5); else if (view.k > 1.2) { c.fillStyle = rt.color; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(o[0], o[1], 3, 0, 7); c.fill(); c.stroke(); } }); });
    things().forEach(t => {
      const [x, y] = sc(t.px);
      if (t.rect) { const a = sc([t.rect[0], t.rect[1]]), b = sc([t.rect[2], t.rect[3]]); c.fillStyle = t.color + '88'; c.strokeStyle = t.color; c.lineWidth = 1.5; c.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); return; }
      if (t.k === 'bridge' || t.k === 'tunnel') { pin(c, x, y, t.color, t.k === 'bridge' ? '≍' : '∩', 10); if (view.k > 0.5) { c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 3; c.font = 'bold 11px system-ui'; c.textAlign = 'left'; c.textBaseline = 'middle'; const lb = (t.k === 'bridge' ? '+' : '−') + (Math.abs(t.st.h) * M_PER_U).toFixed(1) + ' m  ·  ' + Math.round(t.st.len * M_PER_U) + ' m long'; c.strokeText(lb, x + 14, y - 14); c.fillText(lb, x + 14, y - 14); } return; }
      c.fillStyle = t.color; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath();
      if (t.k === 'metro') c.rect(x - 8, y - 8, 16, 16); else if (t.k === 'depot') c.rect(x - 12, y - 8, 24, 16); else c.arc(x, y, t.k === 'busstop' ? 6 : 8, 0, 7);
      c.fill(); c.stroke(); c.fillStyle = '#fff'; c.font = 'bold 10px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText({ metro: 'M', busstop: 'B', depot: 'D', gas: 'G', svc: '+', shop: '$', prop: '♣' }[t.k] || '', x, y + 0.5);
    });
    T().metro.forEach(l => { if (l.stations.length < 2) return; c.strokeStyle = '#' + (l.color >>> 0).toString(16).padStart(6, '0').slice(-6) + '99'; c.lineWidth = 3; c.setLineDash([8, 6]); c.beginPath(); l.stations.forEach((s, i) => { const q = sc(toPx(s.at)); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.stroke(); c.setLineDash([]); });
    // the road being drawn: pins, a smooth rubber band at the road's real width
    const t = toolById[tool];
    if (roadPts && roadPts.length) {
      const k = CLASSES[roadType(t.road || 'four').cls || t.road || 'four'], rt = roadType(t.road || 'four'), ctl0 = mouse ? [...roadPts, snapPoint(view.toWorld(mouse[0], mouse[1]))] : roadPts, pts = curved && ctl0.length >= 3 ? curvePts(ctl0) : ctl0;
      c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = rt.color + '55'; c.lineWidth = Math.max(4, k.width / S * view.k); c.beginPath(); pts.forEach((q, i) => { const o = sc(q); i ? c.lineTo(o[0], o[1]) : c.moveTo(o[0], o[1]); }); c.stroke();
      c.strokeStyle = rt.color; c.lineWidth = 2; c.setLineDash([8, 5]); c.beginPath(); pts.forEach((q, i) => { const o = sc(q); i ? c.lineTo(o[0], o[1]) : c.moveTo(o[0], o[1]); }); c.stroke(); c.setLineDash([]);
      roadPts.forEach((q, j) => { const o = sc(q); pin(c, o[0], o[1], rt.color, j === 0 ? rt.pin : '•', 8); });
    }
    if (mouse && t && (t.road || t.struct)) { const sn = snapAt(view.toWorld(mouse[0], mouse[1])); if (sn.kind !== 'free') { const o = sc(sn.p); c.strokeStyle = { end: '#5dff9a', junction: '#ffd23c', point: '#8fc8ff', middle: '#ffffff' }[sn.kind]; c.lineWidth = 2.5; c.beginPath(); c.arc(o[0], o[1], sn.kind === 'middle' ? 6 : 11, 0, 7); c.stroke(); c.fillStyle = c.strokeStyle; c.font = '10px system-ui'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText({ end: 'end of road', junction: 'junction', point: 'road point', middle: 'on the road' }[sn.kind], o[0] + 15, o[1] + 14); } }
    if (mouse && t) {
      c.globalAlpha = 0.65; c.fillStyle = t.cat.color; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
      if (t.size) { const w = t.size[0] * view.k, hh = t.size[1] * view.k; c.fillRect(mouse[0] - w / 2, mouse[1] - hh / 2, w, hh); c.strokeRect(mouse[0] - w / 2, mouse[1] - hh / 2, w, hh); }
      else if (t.struct) { const r = nearRoad(view.toWorld(mouse[0], mouse[1]), 30); if (r) { const o = sc([r.x, r.y]), hl = sLen / M_PER_U / S * view.k / 2, ca = Math.cos(r.ang), sa = Math.sin(r.ang); c.lineWidth = 9; c.strokeStyle = t.struct > 0 ? '#6fb8ff' : '#b08a5a'; c.lineCap = 'butt'; c.beginPath(); c.moveTo(o[0] - ca * hl, o[1] - sa * hl); c.lineTo(o[0] + ca * hl, o[1] + sa * hl); c.stroke(); } }
      else if (t.rect) { c.globalAlpha = 1; const A = rectA || (mouse ? snapAt(view.toWorld(mouse[0], mouse[1])).p : null), B = mouse ? snapAt(view.toWorld(mouse[0], mouse[1])).p : null;
        if (rectA && B) { const a = sc(rectA), b = sc(B); c.fillStyle = (t.color || '#3dd6a5') + '33'; c.strokeStyle = t.color || '#3dd6a5'; c.lineWidth = 2; c.setLineDash([6, 4]); c.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.setLineDash([]);
          if (t.rect === 'grid') { const g = gridStreets(rectA, B, gridM, gridCls); c.lineWidth = 1.5; g.streets.forEach(q => { const u = sc(q.pts[0]), v = sc(q.pts[1]); c.beginPath(); c.moveTo(u[0], u[1]); c.lineTo(v[0], v[1]); c.stroke(); }); } }
        else if (A) { const o = sc(A); c.beginPath(); c.arc(o[0], o[1], 7, 0, 7); c.stroke(); } }
      else if (t.piece === 'round') { const sn = snapAt(view.toWorld(mouse[0], mouse[1])), q = sn.kind === 'free' ? mouse : sc(sn.p); c.beginPath(); c.arc(q[0], q[1], ROUNDABOUTS[t.kind].R / S * view.k, 0, 7); c.lineWidth = 8; c.globalAlpha = 0.3; c.stroke(); c.globalAlpha = 0.65; c.lineWidth = 1.5; c.stroke(); }
      else if (!t.road) { c.beginPath(); c.arc(mouse[0], mouse[1], 9, 0, 7); c.fill(); c.stroke(); }
      c.globalAlpha = 1; c.fillStyle = '#fff'; c.font = '11px system-ui'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText(t.name, mouse[0] + 14, mouse[1] - 8);
    }
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }

  function spliceOnto(pt, except) {     // a point that lies inside another road's segment becomes a point of that road too, so the two really meet there
    streets().forEach((s, si) => { if (si === except) return; for (let j = 1; j < s.pts.length; j++) { const A = s.pts[j - 1], B = s.pts[j]; if (Math.hypot(pt[0] - A[0], pt[1] - A[1]) < 0.25 || Math.hypot(pt[0] - B[0], pt[1] - B[1]) < 0.25) return;
      const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy || 1, t = ((pt[0] - A[0]) * dx + (pt[1] - A[1]) * dy) / l2; if (t <= 0 || t >= 1) continue;
      if (Math.hypot(A[0] + dx * t - pt[0], A[1] + dy * t - pt[1]) < 0.4) { s.pts.splice(j, 0, [rd(pt[0]), rd(pt[1])]); if (s.ctl) s.ctl = undefined; return; } } });
  }
  // a curve through the control points (centripetal Catmull-Rom), as points about every `step` px
  function curvePts(ctl, step = 6) {
    if (ctl.length < 3) return ctl.map(q => [q[0], q[1]]);
    const P = [ctl[0], ...ctl, ctl[ctl.length - 1]].map(q => ({ x: q[0], y: q[1] })), out = [[ctl[0][0], ctl[0][1]]];
    const kn = (a, b) => Math.pow(Math.hypot(b.x - a.x, b.y - a.y), 0.5) || 1e-3;
    for (let i = 1; i < P.length - 2; i++) {
      const p0 = i === 1 ? { x: 2 * P[1].x - P[2].x, y: 2 * P[1].y - P[2].y } : P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = i === P.length - 3 ? { x: 2 * P[i + 1].x - P[i].x, y: 2 * P[i + 1].y - P[i].y } : P[i + 2];
      const t0 = 0, t1 = t0 + kn(p0, p1), t2 = t1 + kn(p1, p2), t3 = t2 + kn(p2, p3), n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
      for (let k = 1; k <= n; k++) { const t = t1 + (t2 - t1) * k / n, L = (a, b, ta, tb) => ({ x: (a.x * (tb - t) + b.x * (t - ta)) / (tb - ta), y: (a.y * (tb - t) + b.y * (t - ta)) / (tb - ta) }), A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L({ x: A1.x, y: A1.y }, A2, t0, t2), B2 = L(A2, A3, t1, t3), C = L(B1, B2, t1, t2); out.push([C.x, C.y]); }
    }
    out[out.length - 1] = [ctl[ctl.length - 1][0], ctl[ctl.length - 1][1]]; return out;
  }
  const offsetLine = (pts, off) => pts.map((q, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [q[0] - dy / l * off, q[1] + dx / l * off]; });
  const shownPts = s => s.ctl || s.pts;
  // ---- actions ----
  function finishRoad() {
    const t = toolById[tool];
    if (roadPts && roadPts.length >= 2 && t && t.road) {
      snap(); const ctl = roadPts.map(q => [rd(q[0]), rd(q[1])]), pts = (curved && ctl.length >= 3 ? curvePts(ctl) : ctl).map(q => [rd(q[0]), rd(q[1])]), ss = (M().streets ||= []);
      const rt = roadType(t.road);
      if (rt.pair) {     // a highway is two one-way carriageways, driving on the right
        const id = 'hw' + Date.now().toString(36), off = HW_OFF / S, A = offsetLine(pts, off), B = offsetLine(pts, -off).reverse();
        ss.push({ cls: 'hw', pts: A.map(q => [rd(q[0]), rd(q[1])]), pair: id, name: roadName || undefined, trees: roadTrees || undefined, ctl: curved && ctl.length >= 3 ? ctl : undefined }, { cls: 'hw', pts: B.map(q => [rd(q[0]), rd(q[1])]), pair: id, name: roadName || undefined, trees: roadTrees || undefined });
        if (rt.elev) { const e = elevatedStructs(pts); if (e.error) { pieceNote = e.error; } else { const ph = pts; [A, B.slice().reverse()].forEach(L => { const mid = L[Math.floor(L.length / 2)], ps = L.map(q => [q[0], q[1]]); (M().structs ||= []).push({ at: mid.map(rd), len: r2(e.len), h: e.h }); }); pieceNote = 'Elevated: ' + Math.round(e.len * 1.25) + ' m on the viaduct, ramps of ' + Math.round(e.ramp * 1.25) + ' m at each end.'; } }
      } else { ss.push({ cls: rt.cls || t.road, tram: rt.tram || undefined, ped: rt.ped || undefined, pts, name: roadName || undefined, trees: roadTrees || undefined, ctl: curved && ctl.length >= 3 ? ctl : undefined }); }
      const ni = ss.length - 1; [pts[0], pts[pts.length - 1]].forEach(q => spliceOnto(q, rt.pair ? -1 : ni));
      selStreet = ni; dirtyMap(); autoBuild();
    }
    roadPts = null; roadName = ''; renderSide(); view.redraw();
  }
  function place2(t, w) {      // bus stops and metro stations sit on the road they snapped to
    if (t.id === 'busstop') { const L = T().bus; if (!L.length) L.push({ name: 'My bus line 1', color: 0xff7a1a, stops: [] }); L[Math.min(busSel, L.length - 1)].stops.push(w); ctx.dirty('transit'); }
    else { const L = T().metro; if (!L.length) L.push({ name: 'My metro line 1', color: 0x8e44ad, stations: [] }); const l = L[Math.min(metroSel, L.length - 1)]; l.stations.push({ at: w, name: 'Station ' + (l.stations.length + 1) }); ctx.dirty('transit'); }
  }
  function place(p) {
    const t = toolById[tool]; if (!t) return; const m = M(), w = toWorld(p).map(rd);
    if (t.rect) {
      if (!rectA) { rectA = snapAt(p).p; renderSide(); view.redraw(); return; }
      const a = rectA, b = snapAt(p).p; rectA = null; snap(); const ss = streets();
      if (t.rect === 'grid') { const g = gridStreets(a, b, gridM, gridCls); const n0 = ss.length; g.streets.forEach(q => ss.push(q)); g.streets.forEach((q, i) => [q.pts[0], q.pts[1]].forEach(e => spliceOnto(e, n0 + i))); pieceNote = g.nx + ' × ' + g.ny + ' blocks of ' + gridM + ' m.'; autoBuild(); }
      else if (t.rect === 'field') { (m.fields ||= []).push({ kind: t.field, rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])].map(rd) }); pieceNote = t.name + ' added.'; }
      else { const rows = zoneFill([a[0], a[1], b[0], b[1]], t.zone, ss, (Date.now() >>> 0) % 100000), md = M(); rows.forEach(r => md.landmarks.push(r)); pieceNote = rows.length + ' buildings placed.'; }
      dirtyMap(); renderSide(); view.redraw(); return;
    }
    if (t.piece === 'inter' || t.piece === 'slip') {
      snap(); const ss = streets(), r = t.piece === 'inter' ? interchange(ss, (M().structs ||= []), p, { round: !!t.round, clover: !!t.clover }) : slipRoads(ss, p);
      if (r.error) { hist.pop(); pieceNote = r.error; renderSide(); return; }
      pieceNote = [r.note, ...(r.warnings || [])].join(' '); dirtyMap(); autoBuild(); renderSide(); view.redraw(); return;
    }
    if (t.piece === 'round') { const sn = snapAt(p), at = sn.kind === 'free' ? p : sn.p; snap(); const r = roundabout(streets(), at, t.kind); pieceNote = r.warnings.join(' ') || (r.arms + ' roads meet at the roundabout.'); dirtyMap(); autoBuild(); renderSide(); view.redraw(); return; }
    if (t.road) { const sn = snapAt(p); (roadPts ||= []).push(sn.p); renderSide(); view.redraw(); return; }
    snap();
    if (t.struct) { const r = nearRoad(p, 30); if (!r) { hist.pop(); return; } (m.structs ||= []).push({ at: [rd(r.x), rd(r.y)], len: Math.round(sLen / M_PER_U), h: t.struct * Math.round(sH / M_PER_U * 10) / 10 }); dirtyMap(); autoBuild(); }
    else if (t.cat.id === 'build') { m.landmarks.push([t.name, rd(p[0] - t.size[0] / 2), rd(p[1] - t.size[1] / 2), rd(p[0] + t.size[0] / 2), rd(p[1] + t.size[1] / 2), t.hgt, 0, t.bk]); dirtyMap(); }
    else if (t.prop) { (m.props ||= []).push({ type: t.prop, at: [rd(p[0]), rd(p[1])], rot: 0 }); dirtyMap(); }
    else if (t.cat.id === 'shop') { (m.shops ||= []).push({ kind: t.kind, at: [rd(p[0]), rd(p[1])], r: 60 }); dirtyMap(); }
    else if (t.cat.id === 'svc' && t.kind) { (m.stations ||= []).push({ kind: t.kind, at: [rd(p[0]), rd(p[1])], r: 101 }); dirtyMap(); }
    else if (t.id === 'gas') { (m.gas ||= []).push([rd(p[0]), rd(p[1])]); dirtyMap(); }
    else if (t.id === 'busstop' || t.id === 'metro') { const r = nearestRoadPoint(ctx.cityIfBuilt(), w[0], w[1], 60); if (r) { w[0] = rd(r.x); w[1] = rd(r.z); } place2(t, w); }
    else if (false) { const L = T().bus; if (!L.length) L.push({ name: 'My bus line 1', color: 0xff7a1a, stops: [] }); L[Math.min(busSel, L.length - 1)].stops.push(w); ctx.dirty('transit'); }
    else if (t.id === 'metro') { const L = T().metro; if (!L.length) L.push({ name: 'My metro line 1', color: 0x8e44ad, stations: [] }); const l = L[Math.min(metroSel, L.length - 1)]; l.stations.push({ at: w, name: 'Station ' + (l.stations.length + 1) }); ctx.dirty('transit'); }
    else if (t.id === 'depot') { T().depot = { at: w }; ctx.dirty('transit'); }
    renderSide(); view.redraw();
  }
  function delStreet(i) { const ss = M().streets, pr = ss[i] && ss[i].pair; if (pr) { for (let k = ss.length - 1; k >= 0; k--) if (ss[k].pair === pr) ss.splice(k, 1); } else ss.splice(i, 1); }
  function undo() { if (roadPts && roadPts.length) { roadPts.pop(); if (!roadPts.length) roadPts = null; renderSide(); view.redraw(); return; } if (!hist.length) return; ctx.setMap(JSON.parse(hist.pop())); dirtyMap(); renderSide(); view.redraw(); }

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('dblclick', e => { if (roadPts) { roadPts.pop(); finishRoad(); } });
  canvas.addEventListener('mousedown', e => {
    const [mx, my] = view.mouse(e), hit = hitThing(mx, my);
    if (e.button === 2) {
      if (rectA) { rectA = null; renderSide(); view.redraw(); return; }
      if (roadPts) { finishRoad(); return; }
      if (hit) { snap(); hit.remove(); ctx.dirty(isTransit(hit.k) ? 'transit' : 'map'); renderSide(); view.redraw(); return; }
      const sp = hitStreetPin(mx, my); if (sp) { snap(); delStreet(sp.i); selStreet = -1; dirtyMap(); autoBuild(); renderSide(); view.redraw(); } return;
    }
    if (e.button === 1 || e.shiftKey) { view.panStart(e); return; }
    if (!roadPts && hit && e.ctrlKey) { snap(); drag = hit; return; }
    const pick = e.altKey || tool === 'select';
    if (!roadPts && pick && hit && hit.st) { selStruct = hit.idx; selStreet = -1; renderSide(); view.redraw(); return; }
    if (!roadPts && pick) { const sp = hitStreetPin(mx, my); if (sp) { selStreet = sp.i; selStruct = -1; renderSide(); view.redraw(); } return; }
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

  function selStructPanel() {
    const sS = (M().structs || [])[selStruct]; if (!sS) return null;
    const geo = structGeo(sS), cv = h('canvas', { width: 280, height: 130, style: 'width:100%;border-radius:6px' }); setTimeout(() => drawProfile(cv, sS, geo), 0);
    const re = () => { dirtyMap(); autoBuild(); renderSide(); view.redraw(); };
    return h('div', { class: 'grp' }, h('h4', {}, 'Selected ' + (sS.h < 0 ? 'tunnel' : 'bridge')), cv,
      h('div', { class: 'row' }, 'Length ', h('input', { type: 'number', value: Math.round(sS.len * M_PER_U), step: 10, min: 20, style: 'width:70px', onchange: e => { snap(); sS.len = Math.max(20, +e.target.value || 70) / M_PER_U; re(); } }), ' m   ', sS.h < 0 ? 'Depth ' : 'Height ', h('input', { type: 'number', value: +(Math.abs(sS.h) * M_PER_U).toFixed(1), step: 1, min: 2, style: 'width:60px', onchange: e => { snap(); sS.h = Math.sign(sS.h) * Math.max(2, +e.target.value || 6) / M_PER_U; re(); } }), ' m'),
      geo ? h('p', { class: 'hint' }, 'Each ramp is ' + Math.round(geo.ramp * M_PER_U) + ' m long at the ' + (geo.g * 100).toFixed(1) + '% grade limit, so the road is level again ' + Math.round(geo.d2 * M_PER_U) + ' m from the middle.') : h('p', { class: 'hint' }, 'This pin is not on a road any more.'),
      ...(geo ? geo.warns.map(w => h('p', { class: 'hint', style: 'color:#ff9f1a' }, '⚠ ' + w)) : []),
      h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: () => { snap(); M().structs.splice(selStruct, 1); selStruct = -1; re(); } }, 'Delete')));
  }
  function renderSide() {
    const counts = {}; things().forEach(t => { counts[t.k] = (counts[t.k] || 0) + 1; });
    const cur = toolById[tool], c0 = CATS.find(c => c.id === cat), st = streets()[selStreet];
    put(side, h('h3', {}, 'City builder'),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:4px;margin-bottom:8px' }, CATS.map(c => h('button', { class: 'btn' + (cat === c.id ? ' pri' : ''), onclick: () => { cat = c.id; if (!c.tools.some(t => t.id === tool)) tool = c.tools[0].id; roadPts = null; renderSide(); view.redraw(); } }, c.name))),
      h('div', { class: 'cards' }, c0.tools.map(t => card({ ...t, color: t.color }, () => { tool = t.id; roadPts = null; rectA = null; renderSide(); view.redraw(); }, tool === t.id))),
      cur && cur.road ? h('div', {}, h('p', { class: 'hint' }, roadPts ? `Drawing: ${roadPts.length} point${roadPts.length > 1 ? 's' : ''}. Click to add a point (it snaps to existing roads), double-click or Enter to finish, Esc to cancel, Backspace/Ctrl+Z removes a point.` : 'Click the map to start a road. Each click drops a pin; the road is drawn at its real width. Click near an existing road to join it. Alt + click a pin to select that road.'),
        h('div', { class: 'row' }, 'Name ', h('input', { type: 'text', value: roadName, placeholder: '(optional)', style: 'width:150px', oninput: e => { roadName = e.target.value; } })),
        h('div', { class: 'row' }, 'Roadside ', h('select', { onchange: e => { roadTrees = e.target.value; } }, [['', 'none'], ['tree', 'trees'], ['oak', 'oaks'], ['mixed', 'mixed trees'], ['hedge', 'hedge']].map(([v, n]) => h('option', { value: v, selected: v === roadTrees }, n)))),
        h('div', { class: 'row' }, h('label', {}, h('input', { type: 'checkbox', checked: curved, onchange: e => { curved = e.target.checked; view.redraw(); } }), ' Curved road (smooth curve through 3+ points)')),
        roadPts && roadPts.length >= 2 ? h('div', { class: 'row' }, h('button', { class: 'btn pri', onclick: finishRoad }, 'Finish road')) : null) : null,
      cur && cur.struct ? h('div', {}, h('p', { class: 'hint' }, cur.blurb),
        h('div', { class: 'row' }, 'Length ', h('input', { type: 'number', value: sLen, step: 10, min: 20, style: 'width:70px', oninput: e => { sLen = +e.target.value || 70; view.redraw(); } }), ' m   ', cur.struct > 0 ? 'Height ' : 'Depth ', h('input', { type: 'number', value: sH, step: 1, min: 2, style: 'width:60px', oninput: e => { sH = +e.target.value || 6; } }), ' m')) : null,
      cur && !cur.road && !cur.struct && cur.blurb ? h('p', { class: 'hint' }, cur.blurb) : null,
      cur && cur.rect === 'grid' ? h('div', { class: 'row' }, 'Block ', h('input', { type: 'number', value: gridM, step: 10, min: 40, style: 'width:60px', oninput: e => { gridM = Math.max(40, +e.target.value || 90); } }), ' m   Street ', h('select', { onchange: e => { gridCls = e.target.value; } }, ROAD_TYPES.filter(r => !r.pair).map(r => h('option', { value: r.id, selected: r.id === gridCls }, r.name)))) : null,
      cur && cur.rect ? h('p', { class: 'hint' }, rectA ? 'Now click the opposite corner (right-click to cancel).' : 'Click the first corner.') : null,
      cur && (cur.piece || cur.rect) && pieceNote ? h('p', { class: 'hint', style: 'color:#3dd6a5' }, pieceNote) : null,
      cur && cur.id === 'busstop' ? h('div', { class: 'row' }, 'Line ', h('select', { onchange: e => { busSel = +e.target.value; } }, (T().bus.length ? T().bus : [{ name: 'a new line' }]).map((l, i) => h('option', { value: i, selected: i === busSel }, l.name)))) : null,
      cur && cur.id === 'metro' ? h('div', { class: 'row' }, 'Line ', h('select', { onchange: e => { metroSel = +e.target.value; } }, (T().metro.length ? T().metro : [{ name: 'a new line' }]).map((l, i) => h('option', { value: i, selected: i === metroSel }, l.name)))) : null,
      st ? h('div', { class: 'grp' }, h('h4', {}, 'Selected road'), h('div', { class: 'row' }, 'Type ', h('select', { onchange: e => { snap(); const rt = roadType(e.target.value); st.cls = rt.cls || rt.id; st.tram = rt.tram || undefined; st.ped = rt.ped || undefined; dirtyMap(); autoBuild(); renderSide(); view.redraw(); } }, ROAD_TYPES.filter(r => !r.pair).map(r => h('option', { value: r.id, selected: r.id === (st.tram ? 'tram' : st.ped ? 'ped' : st.cls) }, r.name)))),
        h('div', { class: 'row' }, 'Roadside ', h('select', { onchange: e => { snap(); const v = e.target.value || undefined; (st.pair ? streets().filter(o => o.pair === st.pair) : [st]).forEach(o => { o.trees = v; }); dirtyMap(); } }, [['', 'none'], ['tree', 'trees'], ['oak', 'oaks'], ['mixed', 'mixed trees'], ['hedge', 'hedge']].map(([v, n]) => h('option', { value: v, selected: v === (st.trees || '') }, n)))),
        h('div', { class: 'row' }, 'Name ', h('input', { type: 'text', value: st.name || '', style: 'width:150px', oninput: e => { st.name = e.target.value || undefined; dirtyMap(); } })),
        h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: () => { snap(); delStreet(selStreet); selStreet = -1; dirtyMap(); autoBuild(); renderSide(); view.redraw(); } }, 'Delete road'))) : null,
      selStructPanel(),
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
  window.__bv = { view, sc, streets: () => M().streets, tools: id => { tool = id; renderSide(); } };
  return {
    el: root,
    show() { root.style.display = ''; view.fit(); renderSide(); view.redraw(); },
    hide() { root.style.display = 'none'; },
    refresh() { renderSide(); view.redraw(); }
  };
}
