// The drawbridge: a low double-leaf bascule bridge on the street that crosses the north river (chicago.js marks its deck edge
// `drawbridge`). Every 5 minutes it opens for 60 seconds:
//   t = -10 .. 0 s   warning: red lights flash, the bell rings, the gates come down (traffic stops at them)
//   t =   0 .. 12 s  the two leaves swing up (the bell stops as soon as they move)
//   t =  12 .. 72 s  fully open (60 s)
//   t =  62 .. 72 s  warning that it is about to close: lights flash and the bell rings again until the leaves move
//   t =  72 .. 84 s  the leaves come down;  t = 84 .. 88 s the gates lift and traffic moves again
// `city.drawbridgeOpen` is read by terrain.js (the span has no road surface while the leaves are up); `city.drawbridgeStop` makes the AI
// traffic (traffic.js) halt at the gates.
import * as THREE from 'three';
import { createHalo, setGlow } from './glow.js';

export const CYCLE = 300, OPEN_FOR = 60, RAISE = 12, WARN = 10, OFFSET = 190;      // first opening ~ 110 s after the game starts
const LEAF_MAX = 1.32;                                                            // ~76 degrees

export function bridgePhase(clock) {
  const t = (((clock + OFFSET + WARN) % CYCLE) + CYCLE) % CYCLE - WARN;           // -10 .. 290: 0 is the moment the leaves start to rise
  const sm = k => k * k * (3 - 2 * k), end = OPEN_FOR + 2 * RAISE;                // 84: the leaves are down again
  let angle = 0, bell = false, gate = 0, flash = false;
  if (t < 0) { bell = true; flash = true; gate = sm(Math.min(1, (t + WARN) / 1.5)); }                          // warning before opening: the gates come down
  else if (t < RAISE) { angle = sm(t / RAISE); flash = true; gate = 1; }
  else if (t < OPEN_FOR + RAISE - WARN) { angle = 1; flash = true; gate = 1; }                                  // open
  else if (t < OPEN_FOR + RAISE) { angle = 1; bell = true; flash = true; gate = 1; }                           // warning before closing
  else if (t < end) { angle = 1 - sm((t - OPEN_FOR - RAISE) / RAISE); flash = true; gate = 1; }
  else if (t < end + 4) { flash = true; gate = 1 - sm((t - end) / 4); }                                         // gates lift, traffic moves
  return { t, angle, bell, flash, gate };
}

export function createDrawbridge({ city, scene, collisionWorld, audio, heightAt }) {
  const e = (city.roadEdges || []).find(q => q.drawbridge);
  if (!e) return { update() {}, phase: null };
  const N = city.roadNodes, A = N[e.from], B = N[e.to];
  const len = Math.hypot(B.x - A.x, B.z - A.z), ux = (B.x - A.x) / len, uz = (B.z - A.z) / len, hw = e.width / 2, deckY = A.elevation;
  const rx = uz, rz = -ux;                                         // right of travel A -> B
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.92 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8c9199, roughness: 0.5, metalness: 0.55 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.92 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xd9b52b, roughness: 0.8 }), white = new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.8 }), red = new THREE.MeshStandardMaterial({ color: 0xd6342c, roughness: 0.7 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.4 });
  const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };

  // ---- the two leaves -------------------------------------------------------------------------------------------------------------------------
  const leaves = [];
  const leaf = (px, pz, dx, dz) => {
    const root = new THREE.Group(); root.position.set(px, deckY, pz); root.rotation.y = -Math.atan2(dz, dx);
    const pivot = new THREE.Group(); root.add(pivot);
    const L = len / 2;
    box(L, 0.9, e.width, asphalt, L / 2, -0.47, 0, pivot);                                     // slab (its top is the road surface)
    box(L - 1, 0.02, 0.28, yellow, L / 2, 0.0, 0, pivot);                                      // centre line
    for (let x = 1; x < L - 1; x += 3) box(1.2, 0.02, 0.1, white, x, 0.0, hw - 0.5, pivot), box(1.2, 0.02, 0.1, white, x, 0.0, -hw + 0.5, pivot);
    [1, -1].forEach(s => { box(L, 0.7, 0.3, concrete, L / 2, 0.35, s * (hw + 0.15), pivot); box(L, 0.1, 0.4, white, L / 2, 0.75, s * (hw + 0.15), pivot); });   // parapets
    box(5, 3.0, e.width, concrete, -2.4, -2.6, 0, pivot);                                      // counterweight tail: swings down below the roadway as the leaf rises
    box(1.2, 1.1, e.width + 0.4, steel, 0.2, -0.3, 0, pivot);                                  // the hinge beam
    scene.add(root);
    // a solid abutment under the hinge on the bank
    return { root, pivot, dx, dz };
  };
  leaves.push(leaf(A.x, A.z, ux, uz), leaf(B.x, B.z, -ux, -uz));
  // concrete abutments at both banks
  [[A, 1], [B, -1]].forEach(([P, s]) => { const g = new THREE.Group(); g.position.set(P.x - ux * s * 2.5, 0, P.z - uz * s * 2.5); g.rotation.y = -Math.atan2(uz, ux); box(5, deckY + 0.2, e.width + 1.0, concrete, 0, (deckY + 0.2) / 2 - 0.4, 0, g); scene.add(g); });

  // ---- gates: a post at each kerb and a striped arm over that half of the road; two at each end -----------------------------------------------
  const gates = [], halos = [];
  const mkGate = (endPt, outward, side) => {              // endPt: where the gate stands; outward: unit vector pointing away from the span; side: +1 = right of A->B
    const g = new THREE.Group();
    const px = endPt.x + rx * side * (hw + 0.7), pz = endPt.z + rz * side * (hw + 0.7), py = heightAt ? heightAt(endPt.x, endPt.z, deckY) : deckY;
    g.position.set(px, py, pz);
    // local +x points across the road toward the centre line: -side * (rx, rz)
    const ang = Math.atan2(-side * rz, -side * rx); g.rotation.y = -ang;
    box(0.6, 1.6, 0.6, steel, 0, 0.8, 0, g); box(0.9, 0.2, 0.9, concrete, 0, 0.1, 0, g);
    const arm = new THREE.Group(); arm.position.set(0, 1.5, 0); g.add(arm);
    const AL = hw + 0.5;
    for (let i = 0; i < 8; i++) box(AL / 8, 0.16, 0.16, i % 2 ? white : red, AL / 8 * (i + 0.5), 0, 0, arm);
    const lamps = [];
    [0.25, 0.62, 1].forEach(k => { const lm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), lampMat.clone()); lm.position.set(AL * k - 0.1, 0.22, 0); arm.add(lm); lamps.push(lm); const h = createHalo(0xff3020, 2.2); h.position.set(0, 0, 0); lm.add(h); halos.push(h); });
    const sign = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), red); sign.position.set(0, 1.9, 0.32); g.add(sign);       // a red disc on the post
    scene.add(g);
    // collider: the arm across the road while it is down (a thin slab, car height)
    const cx = px - side * rx * (AL / 2), cz = pz - side * rz * (AL / 2);
    const hl = AL / 2, hwid = 0.5;
    const quad = [[cx + rx * hl - ux * hwid, cz + rz * hl - uz * hwid], [cx + rx * hl + ux * hwid, cz + rz * hl + uz * hwid], [cx - rx * hl + ux * hwid, cz - rz * hl + uz * hwid], [cx - rx * hl - ux * hwid, cz - rz * hl - uz * hwid]];
    const col = { kind: 'parcel', footprint: quad, blocksCar: true, destructible: false, response: 'bounce', destroyed: false, gate: true };
    if (collisionWorld) collisionWorld.push(col);
    gates.push({ arm, lamps, col });
  };
  [[A, -1, [1, -1]], [B, 1, [1, -1]]].forEach(([P, out, sides]) => {
    const d = 5;                                                       // 5 u before the leaf hinge, on the approach ramp
    const pt = { x: P.x + ux * out * d, z: P.z + uz * out * d };
    sides.forEach(sd => mkGate(pt, out, sd * (out > 0 ? 1 : -1)));
  });

  let clock = 0, lastBell = -9, hi = false, flashPhase = 0;
  const phase = { t: 0, angle: 0, bell: false, flash: false, gate: 1 };
  const apply = (p) => {
    leaves.forEach(l => { l.pivot.rotation.z = p.angle * LEAF_MAX; });
    gates.forEach(g => { g.arm.rotation.z = (1 - p.gate) * 1.45; g.col.blocksCar = p.gate > 0.5; });
    city.drawbridgeOpen = p.angle > 0.04;
    city.drawbridgeStop = p.gate > 0.05 || p.angle > 0.001;
  };
  apply(bridgePhase(0));
  return {
    phase, edge: e, deckEdgeId: e.id, skipTo(t) { clock = t; },
    update(dt, camera) {
      clock += dt;
      Object.assign(phase, bridgePhase(clock));
      apply(phase);
      flashPhase += dt;
      const on = phase.flash && Math.floor(flashPhase * 2.2) % 2 === 0;
      gates.forEach((g, i) => g.lamps.forEach((lm, k) => { const lit = phase.flash && ((Math.floor(flashPhase * 2.2) + i + (k === 1 ? 1 : 0)) % 2 === 0); lm.material.emissiveIntensity = lit ? 3 : 0.05; }));
      halos.forEach((h, i) => setGlow(h, phase.flash && ((Math.floor(flashPhase * 2.2) + (i >> 1) + (i % 3 === 1 ? 1 : 0)) % 2 === 0) ? 0.9 : 0));
      if (phase.bell && audio && flashPhase - lastBell > 0.42) { lastBell = flashPhase; hi = !hi; audio.bell(A.x, A.z, hi); audio.bell(B.x, B.z, hi); }
    }
  };
}
