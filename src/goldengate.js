// The Golden Gate Bridge: two tall International-Orange towers with cross beams, a main cable down each side with orange
// suspender ropes, and lights (warm lamps along the cables at night, red beacons blinking on the tower tops).
// chicago.js marks the deck edge of the road named "Golden Gate Bridge" with `landmark: 'goldengate'`; the deck itself,
// its approaches and parapets come from the normal bridge code, this module only adds what stands above and beside it.
import * as THREE from 'three';
import { createHalo } from './glow.js';

const ORANGE = 0xc0392b, TOWER_H = 78;

export function createGoldenGate({ city, scene }) {
  const edges = (city.roadEdges || []).filter(e => e.landmark === 'goldengate');
  const g = new THREE.Group(); g.name = 'goldengate'; scene.add(g);
  const mat = new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.55, metalness: 0.25 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffd37a, emissiveIntensity: 0, roughness: 0.4 });
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 0.2 });
  const beacons = [], halos = [];
  const lampPts = [];
  edges.forEach(e => {
    const a = city.roadNodes[e.from], b = city.roadNodes[e.to];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, rx = -uz, rz = ux;
    const ya = a.elevation || 0, yb = b.elevation || 0, deckAt = s => ya + (yb - ya) * (s / L);
    const P = (s, lat, y) => new THREE.Vector3(a.x + ux * s + rx * lat, y, a.z + uz * s + rz * lat);
    const s1 = L * 0.24, s2 = L * 0.76, LEG = 14, CAB = 11;
    const top = deckAt(s1) + TOWER_H;
    // towers
    [s1, s2].forEach(s => {
      const yd = deckAt(s), grp = new THREE.Group(); grp.position.copy(P(s, 0, 0)); grp.rotation.y = Math.atan2(ux, uz);   // local +z = along the deck, +x = lateral
      const leg = (side) => {
        const lower = new THREE.Mesh(new THREE.BoxGeometry(4.6, top - 2, 4.6), mat); lower.position.set(side * LEG, (top - 2) / 2 - 2, 0); grp.add(lower);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(3.4, 5, 3.4), mat); cap.position.set(side * LEG, top + 0.5, 0); grp.add(cap);
      };
      leg(-1); leg(1);
      // portal cross beams (art-deco bracing), the top one carries the cable saddles
      [0.2, 0.45, 0.68, 0.92].forEach(k => { const y = yd + (top - yd) * k, bm = new THREE.Mesh(new THREE.BoxGeometry(LEG * 2 - 3.2, 3.2 - k * 1.2, 3.0), mat); bm.position.set(0, y, 0); grp.add(bm); });
      const saddle = new THREE.Mesh(new THREE.BoxGeometry(LEG * 2 + 3, 2.4, 3.6), mat); saddle.position.set(0, top + 3.2, 0); grp.add(saddle);
      for (const side of [-1, 1]) {
        const bc = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), beaconMat.clone()); bc.position.set(side * LEG, top + 4.2, 0); grp.add(bc); beacons.push(bc);
        const h = createHalo(0xff3020, 12); h.position.copy(bc.position); grp.add(h); halos.push(h);
      }
      g.add(grp);
    });
    // main cables (one each side): side span down to the deck ends, main span sagging to just above the deck at mid span
    const cableY = (s) => {
      if (s <= s1) return deckAt(s) + 3 + (top + 3.2 - deckAt(s1) - 3) * Math.pow(s / s1, 1.15);
      if (s >= s2) return deckAt(s) + 3 + (top + 3.2 - deckAt(s2) - 3) * Math.pow((L - s) / (L - s2), 1.15);
      const k = (s - (s1 + s2) / 2) / ((s2 - s1) / 2); return deckAt(s) + 5 + (top + 3.2 - deckAt(s) - 5) * k * k;
    };
    const susp = [];
    for (const side of [-1, 1]) {
      const pts = []; for (let s = 0; s <= L; s += L / 90) pts.push(P(s, side * CAB, cableY(s)));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 220, 0.75, 6, false), mat); g.add(tube);
      for (let s = 12; s < L - 12; s += 13) { const y = cableY(s), yd = deckAt(s) + 1.2; if (y - yd > 2.5) susp.push({ p: P(s, side * CAB, (y + yd) / 2), h: y - yd }); }
      for (let s = 30; s < L - 30; s += 42) lampPts.push(P(s, side * CAB, cableY(s) + 1.1));
    }
    if (susp.length) {
      const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 5), mat, susp.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
      susp.forEach((q0, i) => { sc.set(1, q0.h, 1); m4.compose(q0.p, q.identity(), sc); im.setMatrixAt(i, m4); }); g.add(im);
    }
    // lamps along the cables and along the deck edge
    const lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6), lampMat, lampPts.length + 1);
    const m4 = new THREE.Matrix4(); lampPts.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); lampMesh.setMatrixAt(i, m4); }); lampMesh.count = lampPts.length; g.add(lampMesh);
  });
  let t = 0;
  return {
    group: g, edges,
    update(dt, night = 1) {
      t += dt; const on = Math.floor(t * 0.8) % 2 === 0;
      lampMat.emissiveIntensity = 0.1 + 2.2 * night;
      beacons.forEach(b => { b.material.emissiveIntensity = (on ? 0.4 + 1.6 : 0.15) * (0.3 + 0.7 * night); });
      halos.forEach(h => { h.material.opacity = on ? 0.2 + 0.7 * night : 0; h.visible = h.material.opacity > 0.02; });
    }
  };
}
