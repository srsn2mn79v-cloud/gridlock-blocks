// Roadside advertising boards along the freeway: a steel frame on two posts, a big painted ad on both faces, floodlights on top.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const ADS = [
  { bg: '#d62828', fg: '#fff', big: 'BURGER BARN', small: 'Flame grilled since 1974', icon: 'burst' },
  { bg: '#1d6fd1', fg: '#fff', big: 'GRIDLOCK AUTO', small: 'Zero down. Zero worries.', icon: 'star' },
  { bg: '#2a9d4f', fg: '#fff', big: 'FRESHMART', small: 'Fresh every single day', icon: 'leaf' },
  { bg: '#f2b705', fg: '#222', big: 'SUNRISE FM 98.1', small: 'The best hits, all day', icon: 'sun' },
  { bg: '#7b2cbf', fg: '#fff', big: 'LAKE CITY BANK', small: 'Your money, your way', icon: 'star' },
  { bg: '#111827', fg: '#ffd23f', big: 'CITY LOTTO', small: 'Jackpot $5,000,000', icon: 'burst' },
  { bg: '#e76f51', fg: '#fff', big: 'PIZZA PLANET', small: 'Delivered in 20 minutes', icon: 'sun' },
  { bg: '#0b7285', fg: '#fff', big: 'METRO PASS', small: 'Skip the traffic. Ride.', icon: 'burst' },
];

function adTexture(a) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 400; const g = c.getContext('2d');
  g.fillStyle = a.bg; g.fillRect(0, 0, 1024, 400);
  g.fillStyle = 'rgba(255,255,255,.12)'; for (let i = 0; i < 6; i++) g.fillRect(i * 190 - 40, 0, 90, 400);
  g.fillStyle = a.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.beginPath(); const cx = 140, cy = 200, n = a.icon === 'star' ? 5 : 12;
  for (let i = 0; i < n * 2; i++) { const ang = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? (n === 5 ? 38 : 72) : 100; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(ang) * r, cy + Math.sin(ang) * r); } g.closePath(); g.fill();
  let size = 110; g.font = '900 ' + size + 'px "Arial Black", system-ui, sans-serif';
  const w = g.measureText(a.big).width; if (w > 700) { size = Math.floor(size * 700 / w); g.font = '900 ' + size + 'px "Arial Black", system-ui, sans-serif'; }
  g.fillText(a.big, 610, 160); g.font = '700 52px system-ui, sans-serif'; g.fillText(a.small, 610, 280);
  g.strokeStyle = a.fg; g.lineWidth = 8; g.strokeRect(12, 12, 1000, 376);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function buildBillboards(city, heightAt) {
  const root = new THREE.Group(), tex = ADS.map(adTexture), mats = tex.map(t => new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
  const steel = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.7, metalness: 0.4 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff2c4 });
  const W = 16, H = 6.2, postH = 7;
  const frame = [], lights = [];
  (city.billboards || []).forEach(b => {
    const y0 = heightAt(b.x, b.z, 0), grp = new THREE.Group(); grp.position.set(b.x, y0, b.z); grp.rotation.y = b.face; root.add(grp);
    const m = mats[b.ad % mats.length];
    [1, -1].forEach(s => { const f = new THREE.Mesh(new THREE.PlaneGeometry(W, H), m); f.position.set(0, postH + H / 2, s * 0.32); f.rotation.y = s > 0 ? 0 : Math.PI; grp.add(f); });
    const add = (w, h, d, x, y, z, list = frame) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); g.applyMatrix4(new THREE.Matrix4().makeRotationY(b.face).setPosition(b.x, y0, b.z)); list.push(g); };
    add(0.5, postH + 1, 0.5, -W * 0.3, (postH + 1) / 2 - 0.5, 0); add(0.5, postH + 1, 0.5, W * 0.3, (postH + 1) / 2 - 0.5, 0);
    add(W + 0.8, 0.4, 0.7, 0, postH - 0.1, 0); add(W + 0.8, 0.4, 0.7, 0, postH + H + 0.1, 0);
    add(0.4, H + 0.6, 0.7, -W / 2 - 0.2, postH + H / 2, 0); add(0.4, H + 0.6, 0.7, W / 2 + 0.2, postH + H / 2, 0);
    add(W * 0.8, 0.2, 0.2, 0, postH + H + 0.8, 0.9, frame);
    for (let i = -1; i <= 1; i++) add(0.6, 0.25, 0.4, i * W * 0.3, postH + H + 0.55, 0.9, lights);
  });
  if (frame.length) { const mesh = new THREE.Mesh(mergeGeometries(frame, false), steel); mesh.castShadow = true; root.add(mesh); }
  if (lights.length) root.add(new THREE.Mesh(mergeGeometries(lights, false), lamp));
  return root;
}
