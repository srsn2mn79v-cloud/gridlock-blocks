// The far end of the road out of town (city.interstate, laid out by chicago/gen_network.js from chicago/outroads.js): a hill with a
// twin-tube tunnel in it. Driving into either tube hands over to travel.js, which takes the player to the city the road leads to;
// arriving from that city, the player comes out of the inbound tube.
// Inside the hill the road is a hidden turning loop (AI traffic drives in and a steady stream drives back out), so the tubes are
// only modelled a little way in and then closed by a black curtain that traffic passes through.
// Local frame: +z runs into the hill along the road, +x is the LEFT of that (three.js), so the outbound carriageway is at x = -off.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const WALL_W = 37, WALL_H = 15, MOUTH_W = 8.2, MOUTH_H = 7.4, TUBE = 66, HILL_W = 118, HILL_H = 44;

function signTexture(text, sub) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  if (g && g.fillRect) {
    g.fillStyle = '#0b6b3a'; g.fillRect(0, 0, 512, 128); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(6, 6, 500, 116);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 58; g.font = 'bold ' + size + 'px Arial, sans-serif';
    const w = g.measureText(text).width; if (w > 470) { size = Math.floor(size * 470 / w); g.font = 'bold ' + size + 'px Arial, sans-serif'; }
    g.fillText(text, 256, sub ? 52 : 66);
    if (sub) { g.font = 'bold 26px Arial, sans-serif'; g.fillText(sub, 256, 100); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// the hill: a flat-shaded mound over the turning loop, cut off square at the tunnel face
function hillGeometry(depth) {
  const NX = 22, NZ = 20, pos = [], idx = [];
  const sm = k => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
  const hAt = (x, z) => {
    const fx = 1 - sm((Math.abs(x) - WALL_W * 0.75) / (HILL_W - WALL_W * 0.75));
    const fz = (WALL_H / HILL_H + (1 - WALL_H / HILL_H) * sm(z / 70)) * (1 - sm((z - depth * 0.62) / (depth * 0.38)));
    const lump = 1 + 0.16 * Math.sin(x * 0.071 + 1.3) * Math.cos(z * 0.053) + 0.09 * Math.sin(x * 0.19 + z * 0.13);
    return Math.max(0, HILL_H * fx * fz * lump);
  };
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const x = -HILL_W + 2 * HILL_W * i / NX, z = depth * j / NZ;
    pos.push(x, hAt(x, z), z);
  }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const base = pos.length / 3;                                   // a skirt down the front edge, so the cut face is closed either side of the concrete face
  for (let i = 0; i <= NX; i++) pos.push(-HILL_W + 2 * HILL_W * i / NX, 0, 0);
  for (let i = 0; i < NX; i++) {
    const xa = -HILL_W + 2 * HILL_W * i / NX, xb = -HILL_W + 2 * HILL_W * (i + 1) / NX;
    if (Math.abs(xa) < WALL_W && Math.abs(xb) < WALL_W) continue;      // behind the concrete face: leave it open, or it would wall up the tubes
    idx.push(i, i + 1, base + i, i + 1, base + i + 1, base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const flat = g.toNonIndexed(); flat.computeVertexNormals();
  return flat;
}

export function createInterstate({ city, scene, car, heightAt, onEnter }) {
  const io = city.interstate;
  if (!io) return { update() {}, colliders: [], arrive: () => null, info: null };
  const M = io.mouth, off = io.off, depth = (io.tube || 0) + io.loopL + io.loopR + 80;
  const y0 = heightAt ? heightAt(M.x, M.z, 0) : 0;
  const g = new THREE.Group(); g.name = 'interstate-tunnel';
  g.position.set(M.x, y0, M.z); g.rotation.y = Math.atan2(M.dx, M.dz);
  const box = (w, h, d, x, y, z) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); return b; };

  // the face: two wings, a pier between the tubes and a lintel across the top
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8b8e8f, roughness: 0.9 });
  const x0 = off - MOUTH_W, x1 = off + MOUTH_W;                  // one mouth spans x0..x1 either side of the middle
  const face = [box(WALL_W - x1, WALL_H, 3, (WALL_W + x1) / 2, WALL_H / 2, 1.5), box(WALL_W - x1, WALL_H, 3, -(WALL_W + x1) / 2, WALL_H / 2, 1.5),
    box(2 * x0, WALL_H, 3, 0, WALL_H / 2, 1.5), box(2 * WALL_W, WALL_H - MOUTH_H, 3, 0, (WALL_H + MOUTH_H) / 2, 1.5), box(2 * WALL_W + 3, 1.2, 4.2, 0, WALL_H + 0.6, 1.5)];
  const wall = new THREE.Mesh(mergeGeometries(face), concrete); wall.castShadow = true; g.add(wall);

  // inside each tube: dark walls and roof, a strip of lamps along the roof, and the curtain
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.95 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff9a3c, emissiveIntensity: 2.4, roughness: 0.4 });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  const shell = [], lamps = [];
  [-1, 1].forEach(s => {
    const cx = s * off;
    shell.push(box(0.6, MOUTH_H, TUBE, cx - MOUTH_W + 0.3, MOUTH_H / 2, 3 + TUBE / 2), box(0.6, MOUTH_H, TUBE, cx + MOUTH_W - 0.3, MOUTH_H / 2, 3 + TUBE / 2), box(2 * MOUTH_W, 0.6, TUBE, cx, MOUTH_H - 0.3, 3 + TUBE / 2));
    for (let z = 5; z < TUBE; z += 9) [-1, 1].forEach(k => lamps.push(box(0.9, 0.14, 2.6, cx + k * (MOUTH_W - 2.2), MOUTH_H - 0.68, z)));
    const cur = new THREE.Mesh(new THREE.PlaneGeometry(2 * MOUTH_W, MOUTH_H), black); cur.position.set(cx, MOUTH_H / 2, 3 + TUBE - 1); cur.rotation.y = Math.PI; g.add(cur);
  });
  g.add(new THREE.Mesh(mergeGeometries(shell), dark));
  g.add(new THREE.Mesh(mergeGeometries(lamps), lampMat));
  // a row of lamps over each mouth, and the destination over the way in
  const rim = []; [-1, 1].forEach(s => { for (let k = -3; k <= 3; k++) rim.push(box(0.8, 0.3, 0.3, s * off + k * 2.1, MOUTH_H + 0.7, -0.2)); });
  g.add(new THREE.Mesh(mergeGeometries(rim), lampMat));
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture(io.sign, io.name), emissive: 0xffffff, emissiveMap: signTexture(io.sign, io.name), emissiveIntensity: 0.55, roughness: 0.5 });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(15, 3.75), signMat); sign.position.set(-off, MOUTH_H + 3.6, -0.25); sign.rotation.y = Math.PI; g.add(sign);
  const noEntry = new THREE.MeshStandardMaterial({ map: signTexture('NO ENTRY', ''), emissive: 0xffffff, emissiveMap: signTexture('NO ENTRY', ''), emissiveIntensity: 0.4, roughness: 0.5 });
  const sign2 = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), noEntry); sign2.position.set(off, MOUTH_H + 3.2, -0.25); sign2.rotation.y = Math.PI; g.add(sign2);

  const hillMat = new THREE.MeshStandardMaterial({ color: 0x4d5a45, roughness: 1, flatShading: true });
  const hill = new THREE.Mesh(hillGeometry(depth), hillMat); hill.position.z = 1.5; hill.receiveShadow = true; g.add(hill);
  g.updateMatrixWorld(true);
  g.traverse(o => { o.matrixAutoUpdate = false; });
  scene.add(g);

  // solid: everything but the two mouths (a car that drives into a mouth is taken on before it can reach the curtain)
  const W = (x, z) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(g.matrixWorld); return [v.x, v.z]; };
  const slab = (xa, xb, za, zb) => ({ kind: 'parcel', footprint: [W(xa, za), W(xa, zb), W(xb, zb), W(xb, za)], blocksCar: true, destructible: false, response: 'bounce', destroyed: false });
  const colliders = [slab(x1, HILL_W, 0, depth), slab(-HILL_W, -x1, 0, depth), slab(-x0, x0, 0, depth), slab(-x1, x1, TUBE, depth)];

  const rx = -M.dz, rz = M.dx;                                  // right of the outbound direction
  let fired = false;
  return {
    info: io, colliders, group: g,
    // where a car that has just come through from the other city appears: just inside the inbound tube, heading for the city
    arrive() { const z = 10; return { x: M.x - rx * off + M.dx * z, z: M.z - rz * off + M.dz * z, heading: Math.atan2(-M.dx, -M.dz) }; },
    update() {
      if (fired) return;
      const px = car.x - M.x, pz = car.z - M.z, along = px * M.dx + pz * M.dz, side = px * rx + pz * rz;
      if (along > 14 && along < TUBE + 20 && Math.abs(side) < off + MOUTH_W && (car.y || 0) < y0 + 4) { fired = true; onEnter(io); }
    },
    night(k) { lampMat.emissiveIntensity = 1.2 + 1.6 * k; }
  };
}
