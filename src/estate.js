// The built side of the apartments: the flat itself (laid out inside the real building, on its floor, so the
// windows look out over the actual city), the underground garage (a pocket far from the map: a two-lane ramp that
// dips down, then a hall with one bay per parking space), and the garage door in the building front.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FLOOR_H } from './chicago/chicago.js';

export const POCKET_X = 8000, POCKET_STEP = 320;
export const pocketOrigin = idx => ({ x: POCKET_X + idx * POCKET_STEP, z: 0 });
export const inPocket = x => x > 4000;

const mats = {};
// no real lights indoors (they would cost every material in the city a light): a little emissive stands in for the room lighting
let BASE_EMI = 0.34;   // garages stay unlit (emissive stands in for lighting); flats drop it to 0.1 because they get real lamps
const M = (hex, o = {}) => { const k = hex + JSON.stringify(o) + BASE_EMI; return (mats[k] ||= new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, metalness: 0.02, emissive: o.emissive !== undefined ? o.emissive : hex, emissiveIntensity: o.emissiveIntensity !== undefined ? o.emissiveIntensity : BASE_EMI, ...o })); };

// collects boxes per material, merged into one mesh each
class Boxes {
  constructor() { this.by = new Map(); this.solid = []; }
  add(w, h, d, x, y, z, hex, opts = {}, solid = false) {
    const key = hex + JSON.stringify(opts), g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y + h / 2, z); g.deleteAttribute('uv');
    if (!this.by.has(key)) this.by.set(key, { hex, opts, geos: [] });
    this.by.get(key).geos.push(g);
    if (solid) this.solid.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
  }
  mesh() {
    const grp = new THREE.Group();
    this.by.forEach(b => { const m = new THREE.Mesh(mergeGeometries(b.geos, false), M(b.hex, b.opts)); m.castShadow = false; m.receiveShadow = false; grp.add(m); });
    return grp;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The flat. Local frame: x across the front (-W/2..W/2), z into the building (0 = the street wall), y up from the floor.
// ---------------------------------------------------------------------------------------------------------------------------
export function buildInterior(a) {
  BASE_EMI = 0.1;
  const W = a.w, D = a.d, H = 2.75, t = 0.16, bx = new Boxes(), glass = [], lamps = [], windows = [];
  let wardrobeAt = null;
  const tier = a.tier, rich = tier >= 4, posh = tier >= 3;
  const WALL = tier >= 3 ? 0xf1ede4 : 0xe6e0d4, FLOOR = tier >= 4 ? 0xcfc8bd : tier >= 2 ? 0xa57d52 : 0x93724c, ACC = [0x7aa0b8, 0xb8896f, 0x7da38a, 0xa7a3c9, 0x4a4f5a, 0x2d3440][tier];
  const wall = (w, h, d, x, y, z, solid = true) => bx.add(w, h, d, x, y, z, WALL, {}, solid);
  // shell: floor, ceiling, back and side walls
  bx.add(W + 0.7, 0.3, D + 0.5, 0, -0.3, D / 2 - 0.05, FLOOR);
  bx.add(W + 0.7, 0.2, D + 0.5, 0, H, D / 2 - 0.05, 0xf5f3ee);
  wall(W + 0.4, H, t, 0, 0, D + t / 2); wall(t, H, D, -W / 2 - t / 2, 0, D / 2); wall(t, H, D, W / 2 + t / 2, 0, D / 2);
  // the street wall: windows (bigger the dearer the flat) with glass, and the blocks between them
  const nWin = Math.max(1, Math.floor(W / 2.4)), slot = W / nWin;
  const wwid = rich ? slot - 0.5 : posh ? slot * 0.74 : Math.min(slot - 0.5, 1.5), y0 = rich ? 0.12 : 0.65, y1 = rich ? H - 0.15 : 2.2;
  for (let i = 0; i < nWin; i++) {
    const cx = -W / 2 + slot * (i + 0.5);
    const isDoor = posh && i === Math.floor(nWin / 2);                                                                // that window is the glass door to the terrace
    if (!isDoor) wall(wwid + 0.2, y0, t, cx, 0, t / 2, false); wall(wwid + 0.2, H - y1, t, cx, y1, t / 2, false);       // below / above the opening
    if (i < nWin - 1 || true) wall(slot - wwid - 0.2, H, t, cx + slot / 2, 0, t / 2, false);                         // pier to the next window
    if (!isDoor) bx.add(wwid, 0.06, t + 0.1, cx, y0 - 0.06, t / 2, 0xdedbd2);                                       // sill
    glass.push({ x: cx, y: (y0 + y1) / 2, w: wwid, h: y1 - y0 });
    windows.push({ x: cx, y0, y1, w: wwid });
  }
  wall(slot - wwid - 0.2, H, t, -W / 2 + 0.0, 0, t / 2, false);
  const solids = () => bx.solid;
  // rooms: an open living area in front, bedrooms and bathrooms behind a partition (studios: just a bath closet)
  const Df = a.beds > 0 ? D * 0.54 : D;
  const door = 1.0;
  const bath = (cx, cz0, cz1, w) => {                                     // bathroom with toilet, basin and shower, rooted at the back wall
    const d = cz1 - cz0, tub = a.baths > 1 && w > 2.6;
    bx.add(0.62, 0.38, 0.4, cx + w / 2 - 0.45, 0, D - 0.3, 0xf2f2f2, {}, true); bx.add(0.5, 0.45, 0.2, cx + w / 2 - 0.45, 0.2, D - 0.1, 0xf2f2f2);   // toilet
    bx.add(0.7, 0.78, 0.45, cx - w / 2 + 0.55, 0, D - 0.3, 0xe9eef2, {}, true); bx.add(0.42, 0.3, 0.02, cx - w / 2 + 0.55, 1.2, D - 0.05, 0xbfd9ea, { metalness: 0.7, roughness: 0.15 });  // basin + mirror
    bx.add(1.05, 0.06, 1.05, cx + 0.0, 0, D - 0.62, 0xdfe5ea);                                                     // shower tray
    glass.push({ x: cx - 0.0, y: 1.0, w: 0.04, h: 2.0, z: D - 1.2, side: true, len: 1.05 });
    bx.add(0.05, 2.0, 1.05, cx - 0.52, 0, D - 0.62, 0xaad4ee, { transparent: true, opacity: 0.25, roughness: 0.1 });
    bx.add(1.05, 2.0, 0.05, cx, 0, D - 1.15, 0xaad4ee, { transparent: true, opacity: 0.25, roughness: 0.1 });
    bx.add(0.1, 0.1, 0.1, cx + 0.38, 1.7, D - 0.1, 0xc9ced6, { metalness: 0.9, roughness: 0.2 });                  // shower head
    if (tub) bx.add(w * 0.55, 0.55, 0.8, cx - w * 0.1, 0, cz0 + 0.7, 0xf2f2f2, {}, true);
  };
  let bedAt = null;
  const bed = (cx, cz, headUp = true, big = true) => {
    if (!bedAt) bedAt = { x: cx, z: cz - 1.1 };                      // bed with its head against a wall at cz
    const bw = big ? 1.55 : 1.2, bl = 1.95;
    bx.add(bw, 0.34, bl, cx, 0, cz - bl / 2, 0x4a4036, {}, true);
    bx.add(bw - 0.1, 0.18, bl - 0.12, cx, 0.34, cz - bl / 2, ACC);
    bx.add(bw - 0.1, 0.06, 0.4, cx, 0.52, cz - 0.35, 0xf4f4f4);
    bx.add(bw, 0.8, 0.1, cx, 0, cz - 0.05, 0x3a342e);
    [-1, 1].forEach(s => bx.add(0.4, 0.4, 0.4, cx + s * (bw / 2 + 0.3), 0, cz - 0.3, 0x5a4a3a, {}, true));
    tableLamp(cx + (bw / 2 + 0.3), 0.4, cz - 0.3);
  };
  const wardrobe = (x, z, w, d, rot) => { bx.add(rot ? d : w, 2.1, rot ? w : d, x, 0, z, 0xb59b7c, {}, true); bx.add(rot ? d - 0.1 : w - 0.1, 0.04, rot ? w - 0.1 : d - 0.1, x, 2.1, z, 0x8f7a5e); };
  const WARM = 0xfff1c8;
  const ceilingLamp = (x, z, cast = false) => { bx.add(0.46, 0.07, 0.46, x, H - 0.07, z, WARM, { emissive: WARM, emissiveIntensity: 2.4 }); lamps.push({ x, y: H - 0.4, z, cast, k: 1 }); };
  const floorLamp = (x, z) => { bx.add(0.05, 1.45, 0.05, x, 0, z, 0x2a2a2a); bx.add(0.3, 0.3, 0.3, x, 1.4, z, WARM, { emissive: WARM, emissiveIntensity: 2.0 }); lamps.push({ x, y: 1.55, z, cast: false, k: 0.7 }); };
  const tableLamp = (x, y, z) => { bx.add(0.14, 0.22, 0.14, x, y, z, WARM, { emissive: WARM, emissiveIntensity: 2.0 }); lamps.push({ x, y: y + 0.3, z, cast: false, k: 0.45 }); };

  if (a.beds === 0) {
    // one room: bed in a back corner, bath closet in the other, kitchenette on the right, table by the window
    const bw = Math.min(1.9, W * 0.42), bz = D - 0.1;
    bed(-W / 2 + bw / 2 + 0.15, bz, true, tier >= 1);
    const cw = Math.min(1.9, W * 0.4), cz0 = D - 2.4;
    wall(t, H, 2.4, W / 2 - cw, 0, D - 1.2); wall(cw - door * 0.5, H, t, W / 2 - cw / 2 + door * 0.25 + 0.0, 0, cz0 - 0.0 + 0.0);
    bath(W / 2 - cw / 2, cz0, D, cw);
    const kz = D * 0.42;
    bx.add(0.62, 0.92, Math.min(2.6, D * 0.5), W / 2 - 0.35, 0, kz + 0.2, 0xd8d3c8, {}, true);                       // counter
    bx.add(0.6, 0.04, Math.min(2.6, D * 0.5), W / 2 - 0.35, 0.92, kz + 0.2, 0x333840);
    bx.add(0.5, 0.05, 0.5, W / 2 - 0.35, 0.96, kz + 0.2 - 0.4, 0x1c1f24); bx.add(0.5, 0.06, 0.4, W / 2 - 0.35, 0.96, kz + 0.2 + 0.5, 0xbfc7d0, { metalness: 0.8, roughness: 0.2 });   // hob + sink
    bx.add(0.62, 1.8, 0.62, W / 2 - 0.35, 0, kz + 0.2 - Math.min(2.6, D * 0.5) / 2 - 0.4, 0xdfe3e8, { metalness: 0.5 }, true);   // fridge
    const tx = -W * 0.05, tz = Math.min(2.0, D * 0.38);
    bx.add(0.95, 0.74, 0.7, tx, 0, tz, 0x7b5b3a, {}, true);
    [[-0.7, 0], [0.7, 0]].forEach(([dx]) => bx.add(0.4, 0.45, 0.4, tx + dx, 0, tz, 0x4b4f58));
    ceilingLamp(0, D * 0.38, true); if (tier >= 1) floorLamp(W * 0.3, D * 0.8);
    wardrobe(-W / 2 + 0.4, D * 0.6, 0.7, 1.5, false); wardrobeAt = { x: -W / 2 + 1.35, z: D * 0.6 };
    if (tier >= 1) { bx.add(1.5, 0.4, 0.7, -W * 0.15, 0, D * 0.62, ACC, {}, true); bx.add(1.5, 0.45, 0.14, -W * 0.15, 0.4, D * 0.62 + 0.3, ACC); }
  } else {
    // front area: kitchen along the right wall, dining table, sofa + TV
    const kl = Math.min(3.4, Df * 0.65), kz0 = Df * 0.3;
    bx.add(0.7, 0.92, kl, W / 2 - 0.4, 0, kz0 + kl / 2, 0xd8d3c8, {}, true); bx.add(0.7, 0.04, kl, W / 2 - 0.4, 0.92, kz0 + kl / 2, 0x2e333b);
    bx.add(0.6, 1.9, 0.7, W / 2 - 0.4, 0, kz0 - 0.4, 0xdfe3e8, { metalness: 0.5 }, true);
    bx.add(0.5, 0.05, 0.5, W / 2 - 0.4, 0.96, kz0 + 0.8, 0x1c1f24); bx.add(0.5, 0.06, 0.4, W / 2 - 0.4, 0.96, kz0 + kl - 0.7, 0xbfc7d0, { metalness: 0.8, roughness: 0.2 });
    if (posh) bx.add(0.9, 0.95, Math.max(1.6, kl * 0.55), W / 2 - 1.6, 0, kz0 + kl / 2, 0xe4dfd4, {}, true);          // island
    const tx = W * 0.08, tz = Math.min(2.2, Df * 0.4);
    bx.add(1.5, 0.74, 0.9, tx, 0, tz, 0x7b5b3a, {}, true); [[-0.55, -0.7], [0.55, -0.7], [-0.55, 0.7], [0.55, 0.7]].forEach(([dx, dz]) => bx.add(0.42, 0.46, 0.42, tx + dx, 0, tz + dz, 0x4b4f58));
    const sz = Df * 0.85;
    bx.add(2.1, 0.42, 0.9, -W * 0.16, 0, sz, ACC, {}, true); bx.add(2.1, 0.5, 0.18, -W * 0.16, 0.42, sz + 0.4, ACC);
    bx.add(1.1, 0.34, 0.6, -W * 0.16, 0, sz - 1.1, 0x5a4a3a, {}, true);
    bx.add(1.5, 0.55, 0.12, -W * 0.16, 0.9, Df - 0.05 > sz + 1.2 ? Df - 0.05 : sz + 1.45, 0x101216);                  // TV
    if (rich) bx.add(2.4, 0.04, 2.0, -W * 0.16, 0.01, sz - 0.6, 0xb9b3a6);                                              // rug
    ceilingLamp(0, Df * 0.4, true); ceilingLamp(W * 0.25, Df * 0.8); floorLamp(-W * 0.16 - 1.5, Df - 0.4);
    // partition with door gaps, then the cells behind it
    const cells = [];
    for (let i = 0; i < a.beds; i++) cells.push({ kind: 'bed', w: 1.0 });
    for (let i = 0; i < a.baths; i++) cells.push({ kind: 'bath', w: 0.62 });
    const tw = cells.reduce((s, c) => s + c.w, 0); let cx0 = -W / 2;
    cells.forEach((c, i) => { c.w = c.w / tw * W; c.x0 = cx0; c.x1 = cx0 + c.w; cx0 += c.w; });
    cells.forEach((c, i) => {
      const cx = (c.x0 + c.x1) / 2;
      wall((c.w - door) / 2, H, t, c.x0 + (c.w - door) / 4, 0, Df); wall((c.w - door) / 2, H, t, c.x1 - (c.w - door) / 4, 0, Df); wall(door, H - 2.05, t, cx, 2.05, Df, false);
      if (i < cells.length - 1) wall(t, H, D - Df, c.x1, 0, (Df + D) / 2);
      if (c.kind === 'bed') { bed(cx, D, true, true); wardrobe(c.x0 + 0.5, (Df + D) / 2 - 0.2, 0.9, 1.6, true); ceilingLamp(cx, (Df + D) / 2, !wardrobeAt); if (!wardrobeAt) wardrobeAt = { x: c.x0 + 0.5, z: (Df + D) / 2 - 1.15 }; if (rich) bx.add(1.1, 0.4, 0.5, cx, 0, Df + 0.9, 0x5a4a3a, {}, true); }
      else bath(cx, Df, D, c.w);
    });
  }
  // ---- the touches that make it a home: a desk with a screen (stats), plants, wall art, curtains, a bookshelf and, in the dearer flats, a terrace ----
  const plantSpots = [];
  const plant = (x, z, sc = 1, y = 0) => {
    bx.add(0.3 * sc, 0.28 * sc, 0.3 * sc, x, y, z, 0xb4694a); bx.add(0.34 * sc, 0.03, 0.34 * sc, x, y + 0.28 * sc, z, 0x3a2c22);
    bx.add(0.04, 0.42 * sc, 0.04, x, y + 0.3 * sc, z, 0x5a4630); plantSpots.push({ x, y: y + 0.28 * sc + 0.62 * sc, z, sc });
  };
  const deskX = W / 2 - 1.25, deskAt = { x: deskX, z: 1.55 };
  bx.add(1.35, 0.05, 0.62, deskX, 0.72, 0.55, 0x8a6a46, {}, true);                                              // desk top
  bx.add(0.05, 0.72, 0.58, deskX - 0.62, 0, 0.55, 0x5d4630); bx.add(0.05, 0.72, 0.58, deskX + 0.62, 0, 0.55, 0x5d4630);
  bx.add(0.62, 0.36, 0.04, deskX - 0.1, 0.99, 0.32, 0x101216);                                                    // monitor, screen towards you
  bx.add(0.56, 0.3, 0.02, deskX - 0.1, 1.02, 0.355, 0x2a6df4, { emissive: 0x2a6df4, emissiveIntensity: 1.5 });
  bx.add(0.05, 0.2, 0.05, deskX - 0.1, 0.77, 0.32, 0x23262c); bx.add(0.4, 0.015, 0.14, deskX - 0.1, 0.77, 0.66, 0x2d3036);   // stand, keyboard
  bx.add(0.1, 0.08, 0.1, deskX + 0.45, 0.77, 0.4, 0x23262c); bx.add(0.03, 0.34, 0.03, deskX + 0.45, 0.85, 0.4, 0x23262c); bx.add(0.16, 0.05, 0.12, deskX + 0.45, 1.17, 0.4, WARM, { emissive: WARM, emissiveIntensity: 2.0 });   // desk lamp
  bx.add(0.46, 0.07, 0.46, deskX, 0.44, 1.2, 0x2d3440, {}, true); bx.add(0.46, 0.5, 0.07, deskX, 0.5, 1.43, 0x2d3440); bx.add(0.06, 0.4, 0.06, deskX, 0, 1.2, 0x15171b);   // chair
  lamps.push({ x: deskX + 0.45, y: 1.2, z: 0.5, cast: false, k: 0.35 });
  const nm = a.beds > 0 ? 2 : 1;
  plant(-W / 2 + 0.35, 0.45, 1.1); if (tier >= 1) plant(W / 2 - 0.4, Df - 0.55, 1.0); if (posh) { plant(-W / 2 + 0.4, Df - 0.5, 1.5); plant(W * 0.28, Df - 0.4, 1.2); }
  if (rich) { plant(-W * 0.4, D * 0.45, 1.7); plant(W * 0.4, D * 0.78, 1.4); }
  if (tier >= 1) {                                                                                                  // curtains + a gallery of frames
    windows.forEach(wn => [-1, 1].forEach(sd => bx.add(0.16, wn.y1 - wn.y0 + 0.32, 0.07, wn.x + sd * (wn.w / 2 + 0.04), wn.y0 - 0.06, 0.2, ACC)));
    const fr = (x, z, w, h, y, col, rotY) => { const sx = rotY ? 0.04 : w, sz = rotY ? w : 0.04; bx.add(sx + 0.06, h + 0.06, sz + (rotY ? 0.06 : 0.0), x, y, z, 0x2a2420); bx.add(sx, h, sz, x + (rotY ? -0.01 : 0), y + 0.03, z + (rotY ? 0 : -0.01), col, { emissive: col, emissiveIntensity: 0.12 }); };
    const ART = [0xd2553b, 0x3a74b8, 0xe8c24a, 0x3f9d7a, 0x8a56b8];
    if (a.beds === 0) { const bxp = bedAt ? bedAt.x : 0; fr(bxp - 0.45, D - 0.07, 0.5, 0.7, 1.15, ART[a.tier % 5]); fr(bxp + 0.35, D - 0.07, 0.4, 0.55, 1.25, ART[(a.tier + 2) % 5]); }
    else { fr(W / 2 - 0.07, Df * 0.72, 0.9, 0.6, 1.4, ART[a.tier % 5], true); fr(-W / 2 + 0.07, Df * 0.5, 0.7, 0.5, 1.5, ART[(a.tier + 3) % 5], true); }
  }
  if (a.beds > 0 && Df > 5.2) {                                                                                     // bookshelf on the left wall of the living area
    const L = Math.min(2.2, Df - 4.4), zc = Df - 0.7 - L / 2;
    if (L > 0.8) { bx.add(0.3, 1.9, L, -W / 2 + 0.2, 0, zc, 0x8a6a46, {}, true); for (let k = 0; k < 5; k++) bx.add(0.26, 0.05, L - 0.06, -W / 2 + 0.2, 0.3 + k * 0.38, zc, 0x5d4630); for (let k = 0; k < 4; k++) for (let m = 0; m < 6; m++) bx.add(0.2, 0.26, 0.07, -W / 2 + 0.22, 0.35 + k * 0.38, zc - L / 2 + 0.2 + m * ((L - 0.4) / 5), [0xb23a3a, 0x2f5fa8, 0xd4a72c, 0x3d8f6a, 0x6b4a8f, 0xe8e2d4][(k * 2 + m) % 6]); }
  }
  // a terrace for the dearer flats: a glass door in the middle window, a slab out over the street with a railing, a table and plants
  let terrace = null;
  if (posh) {
    const wi = Math.floor(nWin / 2), wn = windows[wi], tw = wn.w + 0.7, td = rich ? 2.4 : 1.7, tx = wn.x;
    bx.add(tw, 0.3, td + 0.2, tx, -0.3, -td / 2 + 0.1, 0x8d8f93);                                                // slab
    bx.add(tw, 0.05, 0.07, tx, 1.05, -td, 0xcfd4dc, { metalness: 0.9, roughness: 0.2 });                          // top rails
    bx.add(0.07, 0.05, td, tx - tw / 2, 1.05, -td / 2, 0xcfd4dc, { metalness: 0.9 }); bx.add(0.07, 0.05, td, tx + tw / 2, 1.05, -td / 2, 0xcfd4dc, { metalness: 0.9 });
    bx.add(tw, 1.0, 0.03, tx, 0.04, -td, 0xaad4ee, { transparent: true, opacity: 0.22, roughness: 0.1 });         // glass balustrade
    bx.add(0.03, 1.0, td, tx - tw / 2, 0.04, -td / 2, 0xaad4ee, { transparent: true, opacity: 0.22, roughness: 0.1 }); bx.add(0.03, 1.0, td, tx + tw / 2, 0.04, -td / 2, 0xaad4ee, { transparent: true, opacity: 0.22, roughness: 0.1 });
    bx.add(0.8, 0.04, 0.8, tx - 0.1, 0.72, -td * 0.55, 0x3a3f46); bx.add(0.08, 0.72, 0.08, tx - 0.1, 0, -td * 0.55, 0x3a3f46);
    [[-0.75, 0], [0.55, 0]].forEach(([dx]) => { bx.add(0.4, 0.05, 0.4, tx + dx - 0.1, 0.42, -td * 0.55, 0x4b5058); bx.add(0.4, 0.4, 0.05, tx + dx - 0.1, 0.45, -td * 0.55 + (dx < 0 ? -0.2 : 0.2), 0x4b5058); });
    plant(tx - tw / 2 + 0.3, -td + 0.3, 1.4); plant(tx + tw / 2 - 0.3, -td + 0.3, 1.2);
    bx.add(tw - 0.2, 0.025, 0.025, tx, 2.6, -td * 0.5, 0x222, {}, false);                                          // wire for fairy lights
    for (let k = 0; k < 7; k++) bx.add(0.06, 0.06, 0.06, tx - (tw - 0.4) / 2 + k * ((tw - 0.4) / 6), 2.55, -td * 0.5, 0xffe9a8, { emissive: 0xffe9a8, emissiveIntensity: 2.4 });
    terrace = { x0: tx - tw / 2 + 0.2, x1: tx + tw / 2 - 0.2, depth: td - 0.15, doorIdx: wi };
  }
  const group = bx.mesh();
  group.children.forEach(m => { m.castShadow = true; m.receiveShadow = true; });
  // foliage: soft green blobs on the plants (one merged mesh)
  if (plantSpots.length) {
    const geos = []; plantSpots.forEach(p => [[0, 0, 0, 1], [0.13, -0.12, 0.06, 0.7], [-0.12, -0.2, -0.05, 0.75]].forEach(([dx, dy, dz, k]) => { const g = new THREE.IcosahedronGeometry(0.26 * p.sc * k, 0).toNonIndexed(); g.translate(p.x + dx * p.sc, p.y + dy * p.sc, p.z + dz * p.sc); g.deleteAttribute('uv'); geos.push(g); }));
    const fm = new THREE.Mesh(mergeGeometries(geos, false), M(0x3e8f4d, { roughness: 0.9 })); fm.castShadow = true; group.add(fm);
  }
  // glass panes
  const gm = new THREE.MeshStandardMaterial({ color: 0x9fc4de, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false });
  glass.filter((g, gi) => !g.side && !(terrace && gi === terrace.doorIdx)).forEach(g => { const m = new THREE.Mesh(new THREE.BoxGeometry(g.w, g.h, 0.02), gm); m.position.set(g.x, g.y, 0.08); group.add(m); });
  BASE_EMI = 0.34;
  return {
    group, W, D, H, solids: solids(), floorY: a.floor * FLOOR_H, bedAt, lamps, windows, wardrobeAt, deskAt, terrace,
    exitAt: { x: -W / 2 + 0.75, z: 1.1 }, liftAt: { x: -W / 2 + 0.75, z: Math.min(D - 0.6, 2.7) },
    spawn: { x: -W / 2 + 1.7, z: 1.9 }
  };
}

// The clothes shop: a ground-floor boutique with racks, a counter and a fitting mirror at the back (E there opens the shop).
export function buildStoreInterior(a) {
  BASE_EMI = 0.1;
  const W = a.w, D = a.d, H = 3.0, t = 0.16, bx = new Boxes(), glass = [], lamps = [], windows = [];
  const WALL = 0xf1ede4, FLOOR = 0xb89b78, WARM = 0xfff1c8;
  const wall = (w, h, d, x, y, z, solid = true) => bx.add(w, h, d, x, y, z, WALL, {}, solid);
  bx.add(W + 0.7, 0.3, D + 0.5, 0, -0.3, D / 2 - 0.05, FLOOR);
  bx.add(W + 0.7, 0.2, D + 0.5, 0, H, D / 2 - 0.05, 0xf5f3ee);
  wall(W + 0.4, H, t, 0, 0, D + t / 2); wall(t, H, D, -W / 2 - t / 2, 0, D / 2); wall(t, H, D, W / 2 + t / 2, 0, D / 2);
  // shop front: two big windows with a door-sized gap at the left (the way out is the exit marker)
  const wwid = Math.min(3.6, (W - 3) / 2), y0 = 0.5, y1 = 2.6;
  [-1, 1].forEach((sd, i) => {
    const cx = sd * (W / 2 - wwid / 2 - 0.9);
    wall(wwid + 0.2, y0, t, cx, 0, t / 2, false); wall(wwid + 0.2, H - y1, t, cx, y1, t / 2, false);
    glass.push({ x: cx, y: (y0 + y1) / 2, w: wwid, h: y1 - y0 }); windows.push({ x: cx, y0, y1, w: wwid });
  });
  wall(W + 0.4 - 2 * (wwid + 0.2) - 1.8, H, t, 0, 0, t / 2, false);
  [-1, 1].forEach(sd => wall(0.9 + 0.1, H, t, sd * (W / 2 - 0.45), 0, t / 2, false));
  // racks of clothes along both side walls and two islands
  const COLS = [0xd23b34, 0x2f6fe0, 0x1fa88a, 0xf0c542, 0x6a3d8f, 0xf0f0f0, 0x24324f, 0xe77f24];
  const rack = (x, z, len, rot) => {
    const w = rot ? 0.5 : len, d = rot ? len : 0.5;
    bx.add(w, 0.04, d, x, 1.55, z, 0xc7ccd3, { metalness: 0.8 }, false);
    [-1, 1].forEach(e => bx.add(0.05, 1.55, 0.05, x + (rot ? 0 : e * (len / 2 - 0.05)), 0, z + (rot ? e * (len / 2 - 0.05) : 0), 0xc7ccd3, { metalness: 0.8 }, true));
    for (let i = 0; i < Math.floor(len / 0.2); i++) { const o = -len / 2 + 0.15 + i * 0.2; bx.add(rot ? 0.42 : 0.12, 0.62, rot ? 0.12 : 0.42, x + (rot ? 0 : o), 0.9, z + (rot ? o : 0), COLS[(i * 3 + Math.floor(len * 7)) % COLS.length], {}, false); }
    bx.add(w, 0.5, d, x, 0, z, 0x8f7a5e, {}, true);
  };
  const rl = Math.min(5.5, D - 3);
  rack(-W / 2 + 0.5, 1.7 + rl / 2, rl, true); rack(W / 2 - 0.5, 1.7 + rl / 2, rl, true);
  rack(-W * 0.18, D * 0.5, 2.6, false); rack(W * 0.18, D * 0.5 + 0.8, 2.6, false);
  // counter by the door, with a till
  bx.add(2.2, 1.0, 0.7, W / 2 - 2.4, 0, 1.4, 0xb59b7c, {}, true); bx.add(0.4, 0.3, 0.35, W / 2 - 2.0, 1.0, 1.4, 0x25282e);
  // mannequins in the windows
  [-1, 1].forEach(sd => { const x = sd * (W / 2 - wwid / 2 - 0.9), c = COLS[(sd + 3) % COLS.length]; bx.add(0.4, 0.15, 0.4, x, 0, 1.2, 0x5a5f68, {}, true); bx.add(0.08, 0.6, 0.08, x, 0.15, 1.2, 0x5a5f68); bx.add(0.42, 0.62, 0.24, x, 0.75, 1.2, c); bx.add(0.2, 0.22, 0.2, x, 1.38, 1.2, 0xd9c6ae); });
  // fitting mirror on the back wall
  bx.add(1.6, 2.1, 0.06, 0, 0.2, D - 0.12, 0xbfd9ea, { metalness: 0.9, roughness: 0.08, emissive: 0x6f8fa8, emissiveIntensity: 0.2 });
  bx.add(1.8, 0.12, 0.1, 0, 2.3, D - 0.13, 0x3a342e); bx.add(0.1, 2.4, 0.1, -0.85, 0.1, D - 0.13, 0x3a342e); bx.add(0.1, 2.4, 0.1, 0.85, 0.1, D - 0.13, 0x3a342e);
  bx.add(2.2, 0.06, 1.5, 0, 0, D - 1.0, 0x6d4c8f);   // rug in front of the mirror
  const lampAt = (x, z, cast) => { bx.add(0.5, 0.07, 0.5, x, H - 0.07, z, WARM, { emissive: WARM, emissiveIntensity: 2.4 }); lamps.push({ x, y: H - 0.45, z, cast, k: 1.1 }); };
  lampAt(0, D * 0.3, true); lampAt(-W * 0.25, D * 0.7, false); lampAt(W * 0.25, D * 0.7, false);
  const group = bx.mesh();
  group.children.forEach(m => { m.castShadow = true; m.receiveShadow = true; });
  const gm = new THREE.MeshStandardMaterial({ color: 0x9fc4de, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false });
  glass.forEach(g => { const m = new THREE.Mesh(new THREE.BoxGeometry(g.w, g.h, 0.02), gm); m.position.set(g.x, g.y, 0.08); group.add(m); });
  BASE_EMI = 0.34;
  return { group, W, D, H, solids: bx.solid, floorY: 0, bedAt: null, lamps, windows, wardrobeAt: null, fitAt: { x: 0, z: D - 1.6 }, exitAt: { x: 0, z: 1.0 }, liftAt: null, spawn: { x: 0, z: 1.9 }, store: true };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The underground garage. Local frame: x along the ramp (0 = the mouth), z across, y 0 at street level.
// ---------------------------------------------------------------------------------------------------------------------------
export const RAMP = { L: 44, W: 9, DROP: 6.5 };       // the ramp is the garage's drive-in from the street: it runs under the building, in the real city
const hash01 = (a, b) => { let h = (Math.imul(a + 1, 374761393) ^ Math.imul(b + 7, 668265263)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// Bays are 5.4 u wide with a pillar only every third bay (the old 4.2 u bays with a pillar between each pair were tight to park in).
// Besides your own n bays the hall has bays for the other residents: some hold a parked car, some stand empty but are NOT yours
// (marked "no parking": leave a car there for a minute and you are fined).
export const BAYW = 5.4, FINE_SECS = 60;
export function garageLayout(n) {
  const extra = Math.max(6, n * 2 + 2), K = Math.ceil((n + extra) / 2), AISLE = 8.4, BAY = 6.2, HL = 14 + K * BAYW;
  const x0 = RAMP.L, slots = [];
  for (let k = 0; k < K; k++) for (const side of [1, -1]) slots.push({ k, side, x: x0 + 7 + k * BAYW, z: side * (AISLE / 2 + BAY / 2), heading: side > 0 ? 0 : Math.PI, r: hash01(k * 2 + (side > 0 ? 0 : 1), n) });
  // pick which slots are yours: spread out over the hall, in order of distance from the entrance
  const order = slots.slice().sort((p, q) => p.r - q.r), own = order.slice(0, n).sort((p, q) => p.k - q.k || q.side - p.side);
  const spots = own.map((sp, i) => ({ ...sp, i, kind: 'own' }));
  const ownSet = new Set(own);
  const others = slots.filter(sp => !ownSet.has(sp)).map(sp => ({ ...sp, kind: hash01(sp.k + 31, sp.side + 5 + n) < 0.6 ? 'taken' : 'banned', variant: Math.floor(hash01(sp.k + 3, sp.side + 99) * 1000) }));
  return { x0, HL, HW: AISLE / 2 + BAY + 0.4, AISLE, BAY, spots, others, bays: spots.concat(others), floorY: -RAMP.DROP, ceilY: -RAMP.DROP + 4.6, lift: { x: x0 + HL - 2.2, z: 0 } };
}
// which bay (if any) a local point is in
export function bayAt(lay, x, z) {
  for (const b of lay.bays) if (Math.abs(x - b.x) < BAYW / 2 - 0.2 && Math.abs(z - b.z) < lay.BAY / 2) return b;
  return null;
}
export function garageHeight(lay, x, z) {
  if (x < RAMP.L) { if (Math.abs(z) > RAMP.W / 2 + 0.5) return null; const u = Math.max(0, Math.min(1, x / RAMP.L)); return -RAMP.DROP * (u * u * (3 - 2 * u)); }
  if (x > lay.x0 + lay.HL || Math.abs(z) > lay.HW) return null;
  return lay.floorY;
}
export function buildGarage(n) {
  const lay = garageLayout(n), bx = new Boxes(), grp = new THREE.Group();
  const { L, W, DROP } = RAMP, steps = 28;
  // ramp: a strip of slabs following the smoothstep profile
  for (let i = 0; i < steps; i++) {
    const xa = L * i / steps, xb = L * (i + 1) / steps, ya = garageHeight(lay, xa, 0), yb = garageHeight(lay, xb, 0);
    const len = Math.hypot(xb - xa, yb - ya), ang = Math.atan2(yb - ya, xb - xa);
    const g = new THREE.BoxGeometry(len + 0.05, 0.3, W).toNonIndexed(); g.rotateZ(ang); g.translate((xa + xb) / 2, (ya + yb) / 2 - 0.15, 0); g.deleteAttribute('uv');
    const key = 'ramp'; (bx.by.get(key) || bx.by.set(key, { hex: 0x35383d, opts: {}, geos: [] }).get(key)).geos.push(g);
    // side walls and ceiling
    [-1, 1].forEach(s => { const w = new THREE.BoxGeometry(len + 0.05, 4.4, 0.5).toNonIndexed(); w.rotateZ(ang); w.translate((xa + xb) / 2, (ya + yb) / 2 + 1.9, s * (W / 2 + 0.25)); w.deleteAttribute('uv'); (bx.by.get('wall') || bx.by.set('wall', { hex: 0x8d8a84, opts: {}, geos: [] }).get('wall')).geos.push(w); });
    { const c = new THREE.BoxGeometry(len + 0.05, 0.4, W + 1).toNonIndexed(); c.rotateZ(ang); c.translate((xa + xb) / 2, (ya + yb) / 2 + 3.5, 0); c.deleteAttribute('uv'); (bx.by.get('ceil') || bx.by.set('ceil', { hex: 0x6b6963, opts: {}, geos: [] }).get('ceil')).geos.push(c); }
    if (i % 2 === 1 && xa > 3) { const lg = new THREE.BoxGeometry(1.8, 0.1, 0.4).toNonIndexed(); lg.translate((xa + xb) / 2, (ya + yb) / 2 + 3.25, 0); lg.deleteAttribute('uv'); (bx.by.get('strip') || bx.by.set('strip', { hex: 0xfff3d0, opts: { emissive: 0xfff0c0, emissiveIntensity: 2.2 }, geos: [] }).get('strip')).geos.push(lg); }
  }
  // hall
  const fy = lay.floorY, hx = lay.x0 + lay.HL / 2;
  bx.add(lay.HL + 0.5, 0.4, lay.HW * 2 + 1, hx, fy - 0.4, 0, 0x3a3d42);
  bx.add(lay.HL + 0.5, 0.4, lay.HW * 2 + 1, hx, lay.ceilY, 0, 0x6b6963);
  bx.add(0.6, 4.7, lay.HW * 2 + 1, lay.x0 + lay.HL + 0.3, fy, 0, 0x8d8a84, {}, true);
  [-1, 1].forEach(s => bx.add(lay.HL + 1, 4.7, 0.6, hx, fy, s * (lay.HW + 0.3), 0x8d8a84, {}, true));
  // the ramp-side wall of the hall either side of the ramp mouth
  [-1, 1].forEach(s => bx.add(0.6, 4.7, lay.HW - W / 2, lay.x0 - 0.3, fy, s * (W / 2 + (lay.HW - W / 2) / 2), 0x8d8a84, {}, true));
  // bays: painted lines, wheel stops, a column between every pair
  lay.bays.forEach(sp => {
    const sgn = sp.side;
    [-1, 1].forEach(dx => bx.add(0.1, 0.02, lay.BAY - 0.4, sp.x + dx * (BAYW / 2 - 0.35), fy + 0.005, sp.z, sp.kind === 'banned' ? 0xe05252 : 0xe8e8e8));
    bx.add(2.6, 0.12, 0.25, sp.x, fy, sp.z + sgn * (lay.BAY / 2 - 0.5), sp.kind === 'banned' ? 0xe05252 : 0xd9c441);
  });
  for (let j = 0; j * 3 * BAYW <= lay.HL - 12; j++) [-1, 1].forEach(s => bx.add(0.7, 4.6, 0.7, lay.x0 + 7 + (j * 3 - 0.5) * BAYW, fy, s * (lay.AISLE / 2 + 0.15), 0x9a978f, {}, true));
  // ceiling lights down the aisle
  for (let k = 0; k < Math.ceil(lay.HL / 7); k++) bx.add(2.4, 0.1, 0.5, lay.x0 + 4 + k * 7, lay.ceilY - 0.1, 0, 0xfff3d0, { emissive: 0xfff0c0, emissiveIntensity: 2.4 });
  // the lift at the far end: steel surround, two sliding doors with a seam, a floor display, a call panel, a lit sign and a mat
  const E = lay.x0 + lay.HL;
  bx.add(4.6, 3.9, 0.3, E - 0.15, fy, 0, 0x30343b, { metalness: 0.6, roughness: 0.45 });                                  // surround
  bx.add(0.12, 3.2, 0.1, E - 0.33, fy, -1.78, 0xcfd4dc, { metalness: 0.95, roughness: 0.2 }); bx.add(0.12, 3.2, 0.1, E - 0.33, fy, 1.78, 0xcfd4dc, { metalness: 0.95, roughness: 0.2 });
  bx.add(0.12, 0.12, 3.66, E - 0.33, fy + 3.2, 0, 0xcfd4dc, { metalness: 0.95, roughness: 0.2 });                              // chrome jamb
  bx.add(0.1, 3.1, 1.72, E - 0.36, fy, -0.87, 0xa9b0b8, { metalness: 0.88, roughness: 0.32 });                                // door panels
  bx.add(0.1, 3.1, 1.72, E - 0.36, fy, 0.87, 0xa9b0b8, { metalness: 0.88, roughness: 0.32 });
  bx.add(0.12, 3.1, 0.05, E - 0.37, fy, 0, 0x14161a);                                                                          // seam
  [-0.87, 0.87].forEach(zz => { for (let k = 0; k < 7; k++) bx.add(0.02, 0.012, 1.5, E - 0.42, fy + 0.35 + k * 0.42, zz, 0x8d949c, { metalness: 0.9, roughness: 0.4 }); });   // brushed lines
  bx.add(0.12, 0.34, 1.4, E - 0.36, fy + 3.45, 0, 0x0a0b0d); bx.add(0.04, 0.2, 1.1, E - 0.43, fy + 3.52, 0, 0x2dff7a, { emissive: 0x2dff7a, emissiveIntensity: 2.2 });   // floor display
  bx.add(0.08, 0.7, 0.34, E - 0.34, fy + 1.0, 2.9, 0x20242a, { metalness: 0.5 });                                              // call panel
  bx.add(0.04, 0.1, 0.1, E - 0.4, fy + 1.45, 2.9, 0xffb020, { emissive: 0xffb020, emissiveIntensity: 2.4 }); bx.add(0.04, 0.1, 0.1, E - 0.4, fy + 1.2, 2.9, 0xffb020, { emissive: 0xffb020, emissiveIntensity: 1.2 });
  bx.add(2.6, 0.03, 4.8, E - 1.5, fy, 0, 0x575c64);                                                                            // mat in front of the doors
  for (let k = 0; k < 9; k++) bx.add(0.5, 0.05, 0.3, E - 2.9, fy, -2.4 + k * 0.6, k % 2 ? 0x15161a : 0xf2c500);              // hazard line
  bx.add(0.06, 0.18, 3.6, E - 0.3, fy + 3.85, 0, 0xfff0c0, { emissive: 0xfff0c0, emissiveIntensity: 2.0 });                // light above the lift
  {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const q = c.getContext('2d'); q.fillStyle = '#0d0f12'; q.fillRect(0, 0, 256, 64);
    q.fillStyle = '#7fe3ff'; q.font = 'bold 36px system-ui'; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillText('▲ LIFT ▼', 128, 34);
    const t = new THREE.CanvasTexture(c), sg = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: t }));
    sg.position.set(E - 0.5, fy + 4.0, 0); sg.rotation.y = -Math.PI / 2; grp.add(sg);
  }
  // the mouth of the ramp, in the building front: a wall with a door-sized opening (the street shows through it), so from inside you look out onto the road
  [-1, 1].forEach(sd => bx.add(0.6, 5.2, W / 2 + 0.6 - 2.15, 0.3, -0.5, sd * (2.15 + (W / 2 + 0.6 - 2.15) / 2), 0x8d8a84, {}, true));
  bx.add(0.6, 1.6, 4.3, 0.3, 3.1, 0, 0x8d8a84);
  const mesh = bx.mesh();
  grp.add(mesh);
  // floor decals: a red "no parking" sign (also on the back wall) in bays that are not yours, a green P in yours
  const decal = kind => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const q = c.getContext('2d'); q.clearRect(0, 0, 128, 128);
    const col = kind === 'banned' ? '#e03a3a' : '#2ecc71';
    q.lineWidth = 12; q.strokeStyle = col; q.fillStyle = kind === 'banned' ? 'rgba(20,20,22,0.55)' : 'rgba(20,20,22,0.35)';
    q.beginPath(); q.arc(64, 64, 52, 0, Math.PI * 2); q.fill(); q.stroke();
    q.fillStyle = '#fff'; q.font = 'bold 64px system-ui'; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillText('P', 64, 68);
    if (kind === 'banned') { q.strokeStyle = col; q.lineWidth = 12; q.beginPath(); q.moveTo(26, 26); q.lineTo(102, 102); q.stroke(); }
    return new THREE.CanvasTexture(c);
  };
  const dTex = { banned: decal('banned'), own: decal('own') };
  lay.bays.forEach(sp => {
    if (sp.kind === 'taken') return;
    const mat = new THREE.MeshBasicMaterial({ map: dTex[sp.kind], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const f = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), mat); f.rotation.x = -Math.PI / 2; f.position.set(sp.x, fy + 0.03, sp.z - sp.side * 0.3); grp.add(f);
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: dTex[sp.kind], transparent: true })); w.position.set(sp.x, fy + 2.5, sp.side * (lay.HW - 0.02)); w.rotation.y = sp.side > 0 ? Math.PI : 0; grp.add(w);
  });
  // solid rects (local) for cars and for walking
  const solids = bx.solid.slice();
  solids.push({ x0: 0, x1: L, z0: W / 2 + 0.05, z1: W / 2 + 0.6 }, { x0: 0, x1: L, z0: -W / 2 - 0.6, z1: -W / 2 - 0.05 });
  return { group: grp, lay, solids };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The garage door in the building front (a roller door that rolls up as you come near) and the street sign for it.
// ---------------------------------------------------------------------------------------------------------------------------
export function buildGateMesh(a) {
  const g = new THREE.Group(), gt = a.gate;
  // what you see when the door is up: a dark ramp going down into the building (painted as a receding tunnel)
  const c0 = document.createElement('canvas'); c0.width = 128; c0.height = 128; const q = c0.getContext('2d');
  q.fillStyle = '#07080a'; q.fillRect(0, 0, 128, 128);
  q.fillStyle = '#16181c'; q.beginPath(); q.moveTo(0, 128); q.lineTo(128, 128); q.lineTo(86, 74); q.lineTo(42, 74); q.closePath(); q.fill();   // the ramp surface, going away
  q.strokeStyle = '#d9c441'; q.lineWidth = 2; q.beginPath(); q.moveTo(64, 128); q.lineTo(64, 74); q.stroke();                                    // centre line
  q.strokeStyle = '#3a3d42'; q.lineWidth = 3; q.beginPath(); q.moveTo(0, 128); q.lineTo(42, 74); q.moveTo(128, 128); q.lineTo(86, 74); q.stroke();
  q.fillStyle = '#fff3c0'; [[64, 22, 18], [64, 40, 12], [64, 54, 8], [64, 64, 5]].forEach(([x, y, w]) => q.fillRect(x - w / 2, y, w, 2));      // ceiling lights
  const grad = q.createLinearGradient(0, 0, 0, 128); grad.addColorStop(0, 'rgba(0,0,0,0.9)'); grad.addColorStop(0.5, 'rgba(0,0,0,0)'); q.fillStyle = grad; q.fillRect(0, 0, 128, 128);
  const open = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 3.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c0) })); open.position.set(0, 1.55, 0.2); g.add(open);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.0, 3.5, 0.35), M(0x2c2f34)); frame.position.set(0, 1.75, 0.0);
  const hole = new THREE.Mesh(new THREE.BoxGeometry(4.3, 3.1, 0.4), M(0x2c2f34)); hole.visible = false;
  g.add(frame);
  // hazard stripes along the sill and the posts, so it reads as a vehicle entrance
  for (let i = 0; i < 9; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.06), M(i % 2 ? 0x15161a : 0xf2c500)); st.position.set(-2.0 + i * 0.5, 0.06, 0.4); g.add(st); }
  const slab = new THREE.Mesh(new THREE.BoxGeometry(4.3, 3.1, 0.12), M(0x4b6f9a, { metalness: 0.5, roughness: 0.4 })); slab.position.set(0, 1.55, 0.3);
  const door = new THREE.Group(); door.add(slab);
  for (let i = 0; i < 6; i++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.06, 0.06), M(0xdfe6ee)); rib.position.set(0, 0.35 + i * 0.5, 0.37); door.add(rib); }
  g.add(door); g.userData.door = door;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.25, 0.9), M(0x2c2f34)); hood.position.set(0, 3.55, 0.45); g.add(hood);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.1), M(0x1b6fe0, { emissive: 0x1b6fe0, emissiveIntensity: 0.9 })); sign.position.set(0, 4.3, 0.35); g.add(sign);
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.font = 'bold 50px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('P', 32, 36);
  const tex = new THREE.CanvasTexture(c); const p = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: tex, transparent: true })); p.position.set(0, 4.3, 0.41); g.add(p);
  g.rotation.y = Math.atan2(gt.nx, gt.nz);        // local +z = out of the wall, to the street
  g.position.set(gt.x, 0.02, gt.z);
  return g;
}
