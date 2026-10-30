import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildParkedCars, parkedCarStyle } from '../vehicleModels.js';
import { collapse } from '../collapse.js';
import { snowCap, bakeSnowHeights } from '../surfaceShaders.js';
import { createGroundGlow, createHalo, setGlow } from '../glow.js';

function treeMesh() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0x5b4632 }));
  trunk.position.y = 0.6; trunk.castShadow = true;
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.2, 7), new THREE.MeshStandardMaterial({ color: 0x3f8f4a }));
  leaves.position.y = 2.1; leaves.castShadow = true;
  g.add(trunk, leaves);
  return g;
}

// Sodium-vapor streetlight color — the characteristic warm amber-orange of old-school
// high-pressure-sodium street lamps, not a neutral white/yellow. Shared by the lens
// material and the actual light so the glow and the light it casts match.
const SODIUM_COLOR = 0xffa033;
const SODIUM_EMISSIVE = 0xff8c1a;

// One lamp head — arm, housing, lens, and an aimed SpotLight (not an omnidirectional
// PointLight) so it actually points where the arm points rather than glowing equally
// in every direction. Built pointing local +z/down by default; buildHead's `mirror`
// flag spins the whole head 180° to point the other way, which is how the two-headed
// median variant below gets its second head without duplicating geometry.
function lampHead(poleMat, mirror) {
  const g = new THREE.Group();

  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.7, 6), poleMat);
  arm1.position.set(0, 3.6, 0.22);
  arm1.rotation.x = Math.PI / 2.6;
  arm1.castShadow = false;
  const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 6), poleMat);
  arm2.position.set(0, 3.85, 0.62);
  arm2.rotation.x = Math.PI / 2.1;
  arm2.castShadow = false;

  const headMat = new THREE.MeshStandardMaterial({ color: 0x1d2127, roughness: 0.5, metalness: 0.5 });
  headMat.userData.snow = { skip: true };
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.6), headMat);
  head.position.set(0, 3.78, 0.85);
  head.castShadow = false;

  const lensMat = new THREE.MeshStandardMaterial({
    color: SODIUM_COLOR, emissive: SODIUM_EMISSIVE, emissiveIntensity: 1.1, roughness: 0.4
  });
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.46), lensMat);
  lens.position.set(0, 3.70, 0.85);

  // No THREE.SpotLight per lamp any more: a real light on every one of dozens of lamps
  // made every pixel of the scene pay for all of them (and risks blowing past a phone GPU's
  // uniform limit as the city grows). Instead each lamp carries (a) a soft sodium pool of
  // light on the road under it, always on and nearly free, and (b) two invisible anchor
  // points marking where a *real* spotlight should sit and aim; main.js keeps a small pool
  // of real spotlights and parks them on whichever lamps are nearest the player, fading
  // them in and out with distance (see updateLampLights there). Anchors are plain child
  // Object3Ds so the lamp's rotation (and the `mirror` flip) carries them along for free.
  const spotAnchor = new THREE.Object3D();
  spotAnchor.position.set(0, 3.65, 0.85);
  const targetAnchor = new THREE.Object3D();
  targetAnchor.position.set(0, 0, 4.4);
  const pool = createGroundGlow(SODIUM_COLOR, 13, 13);
  pool.position.set(0, 0.03, 3.4);
  setGlow(pool, 0.28);
  g.add(arm1, arm2, head, lens, spotAnchor, targetAnchor, pool);
  snowCap(g, 0.34, 0.07, 0.5, 0, 3.86, 0.85);

  if (mirror) g.rotation.y = Math.PI;
  return { group: g, lensMat, spotAnchor, targetAnchor, pool };
}

// A proper street lamp — tapered pole plus one or two aimed lamp heads. Pass
// `{ twin: true }` for a median/center-of-road fixture with a head reaching each way
// (one bulb lighting each side) instead of the usual single roadside head that should
// be rotated (via the prop's own `rotation` field) to overhang the road it's lighting.
function lightMesh(prop) {
  const twin = !!(prop && prop.twin);
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.4 });
  poleMat.userData.snow = { grad: [1.9, 3.7] };

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.18, 10), poleMat);
  base.position.y = 0.09; base.castShadow = false;

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 8), poleMat);
  pole.position.y = 1.9; pole.castShadow = false;
  g.add(base, pole);

  const heads = [lampHead(poleMat, false)];
  if (twin) heads.push(lampHead(poleMat, true));
  heads.forEach(h => g.add(h.group));

  bakeSnowHeights(g);
  g.scale.setScalar(1.7); // 8 m pole (1 u = 1.25 m): taller pole, longer arm: light falls from higher up and spreads wider
  g.userData.lampPools = heads.map(h => h.pool);
  g.userData.lensMaterials = heads.map(h => h.lensMat);
  g.userData.lampAnchors = heads.map(h => ({ spot: h.spotAnchor, target: h.targetAnchor }));
  return g;
}

function benchMesh() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 0.5), new THREE.MeshStandardMaterial({ color: 0xa9825c }));
  mesh.position.y = 0.22; mesh.castShadow = true;
  return mesh;
}


// ---- street furniture (Phase 2 town life) ----------------------------------------------------------------------------------------
function hydrantMesh() {
  const g = new THREE.Group(), red = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.55 }), cap = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.62, 10), red); body.position.y = 0.38;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.3, 0.1, 10), red); base.position.y = 0.05;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), cap); dome.position.y = 0.69;
  const nub1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), red); nub1.rotation.z = Math.PI / 2; nub1.position.y = 0.45;
  g.add(body, base, dome, nub1);
  g.children.forEach(c => { c.castShadow = true; });
  return g;
}
function mailboxMesh() {
  const g = new THREE.Group(), blue = new THREE.MeshStandardMaterial({ color: 0x2457a6, roughness: 0.5 }), dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), dark); post.position.y = 0.35;
  const box = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.6, 12, 1, false, 0, Math.PI), blue); box.rotation.z = Math.PI / 2; box.rotation.y = 0; box.position.y = 0.98;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.28, 0.56), blue); body.position.y = 0.84;
  g.add(post, body, box);
  g.children.forEach(c => { c.castShadow = true; });
  return g;
}
function cafeSetMesh() {
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0xb98b5e, roughness: 0.7 }), metal = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.5, metalness: 0.3 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 14), wood); top.position.y = 0.78;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.76, 8), metal); leg.position.y = 0.38;
  g.add(top, leg);
  [[0.95, 0], [-0.95, 0], [0, 0.95]].forEach(([x, z], i) => {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), wood); seat.position.set(x, 0.45, z);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.05), wood); back.position.set(x * 1.18, 0.7, z * 1.18); back.rotation.y = Math.atan2(x, z);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.44, 0.36), metal); legs.position.set(x, 0.22, z);
    g.add(seat, back, legs);
  });
  g.children.forEach(c => { c.castShadow = true; });
  return g;
}

function picnicMesh() {
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x9c6e45, roughness: 0.8 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.8), wood); top.position.y = 0.78;
  g.add(top);
  [-0.8, 0.8].forEach(z => { const b = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.3), wood); b.position.set(0, 0.45, z * 0.9 + (z > 0 ? 0.1 : -0.1)); g.add(b); });
  [-0.65, 0.65].forEach(x => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.78, 1.5), wood); l.position.set(x, 0.39, 0); g.add(l); });
  g.children.forEach(c => { c.castShadow = true; });
  return g;
}
// a striped canopy sloping down away from the wall (local +z points away from the building)
function awningMesh(prop) {
  const g = new THREE.Group(), w = prop.w || 4, n = Math.max(3, Math.round(w / 0.55));
  const a = new THREE.MeshStandardMaterial({ color: prop.color || 0xc0392b, roughness: 0.8, side: THREE.DoubleSide }), b = new THREE.MeshStandardMaterial({ color: 0xf1ece0, roughness: 0.8, side: THREE.DoubleSide });
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w / n, 0.05, 1.7), i % 2 ? b : a);
    s.position.set(-w / 2 + (i + 0.5) * w / n, 0, 0); s.rotation.x = 0.28; g.add(s);
  }
  const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.28, 0.04), a); edge.position.set(0, -0.37, 0.84); g.add(edge);
  g.children.forEach(c => { c.castShadow = true; });
  return g;
}

function plasterMat(c) { const m = new THREE.MeshStandardMaterial({ color: c }); m.userData.snow = { plaster: true }; return m; }
function signMesh() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 6), new THREE.MeshStandardMaterial({ color: 0x8a8f97 }));
  pole.position.y = 1.15; pole.castShadow = true;
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.05), plasterMat(0xe05252));
  board.position.y = 1.95; board.castShadow = true;
  g.add(pole, board);
  return g;
}

// A vehicle traffic signal: a tall pole with a mast arm that reaches out over the approach
// lane, and a big signal head hanging from the end of it (a white backplate frames it, so
// it reads from a distance), plus a separate, smaller pedestrian signal box low on the pole.
// `prop.arm` is how far the arm reaches toward the road centre (cityData.js's
// signalPoles() computes it so the head sits over the lane it governs); the arm points
// along the prop's local -x, which is the traffic's left, i.e. toward the road centreline.
// Both signals are driven every frame from main.js (which looks up the real signal via
// signals.js's phaseAt/isApproachClear) by swapping emissiveIntensity on the lens
// materials and the opacity of a camera-facing halo around each lens, stashed in
// userData. The mesh itself is just geometry — it has no idea what phase it's in.
function trafficLightMesh(prop) {
  const arm = (prop && prop.arm) || 3;
  const heads = (prop && prop.heads && prop.heads.length) ? prop.heads : [arm];   // distances from the pole toward the centreline, one per lane
  const wire = !!(prop && prop.span);                  // suspended style: a cable to a pole on the other kerb, heads hang from it
  const bare = !!(prop && prop.spanPole);              // the far pole of a suspended pair: just a pole (and a cable clip)
  const over = heads.length > 1 || wire;
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.4 });
  const POLE_H = over || bare ? 7 : 5.8, SPLIT = 2.9;
  poleMat.userData.snow = { grad: [2.9, POLE_H] };
  // Built as separate parts (each centred on its own origin) so a crash can break them apart;
  // only a thin base plate stays bolted to the ground.
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.08, 10), poleMat);
  plate.position.y = 0.04;
  const lowerG = new THREE.Group(); lowerG.position.set(0, 0.08 + (SPLIT - 0.08) / 2, 0);
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, SPLIT - 0.08, 8), poleMat);
  lower.castShadow = true; lowerG.add(lower);
  const upperG = new THREE.Group(); upperG.position.set(0, SPLIT + (POLE_H - SPLIT) / 2, 0);
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, POLE_H - SPLIT, 8), poleMat);
  upper.castShadow = true; upperG.add(upper);
  g.add(plate, lowerG, upperG);
  g.userData.parts = { lower: lowerG, upper: upperG };
  if (bare) { bakeSnowHeights(g); return g; }

  const reach = Math.max(...heads) + (wire ? 0 : 0.5);
  const spanLen = wire ? prop.span : reach;
  const armG = new THREE.Group(); armG.position.set(-spanLen / 2, POLE_H - 0.35, 0);
  const armBar = new THREE.Mesh(wire ? new THREE.BoxGeometry(spanLen, 0.06, 0.06) : new THREE.BoxGeometry(spanLen, over ? 0.22 : 0.16, over ? 0.22 : 0.16), poleMat);
  armBar.castShadow = true; armG.add(armBar);
  g.add(armG);
  g.userData.parts.arm = armG;

  const housingMat = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.7 });
  const lensDefs = [['red', 0xff2a2a, 0.6], ['yellow', 0xffc02a, 0], ['green', 0x2aff6a, -0.6]];
  const lenses = {}, halos = {};
  lensDefs.forEach(([name, color]) => { lenses[name] = new THREE.MeshStandardMaterial({ color: 0x241a1a, emissive: color, emissiveIntensity: 0.05 }); });
  const headY = POLE_H - (wire ? 1.9 : 1.5);
  let mainHead = null;
  heads.forEach((hx, idx) => {
    const headG = new THREE.Group(); headG.position.set(-hx, headY, 0);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.66, 1.9, 0.5), housingMat);
    housing.castShadow = true;
    const backplate = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.16, 0.05), backMat);
    backplate.position.set(0, 0, -0.27);
    headG.add(housing, backplate);
    snowCap(headG, 0.6, 0.12, 0.42, 0, 0.95, 0.02);
    snowCap(headG, 0.88, 0.07, 0.1, 0, 1.08, -0.24);
    if (wire) {   // two droppers up to the cable
      [-0.22, 0.22].forEach(dx => { const d = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.0, 0.04), poleMat); d.position.set(dx, 1.45, 0); headG.add(d); });
    }
    lensDefs.forEach(([name, color, dy]) => {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16), lenses[name]);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, dy, 0.27);
      const halo = createHalo(color, 2.6);
      halo.position.set(0, dy, 0.5);
      if (idx === 0) halos[name] = halo; else halo.material = halos[name].material;   // one opacity drives every head
      headG.add(lens, halo);
    });
    g.add(headG);
    if (idx === 0) mainHead = headG; else g.userData.parts['head' + idx] = headG;
  });

  // The pedestrian signal: its own small box lower on the pole, with just two lenses
  // in the walk/don't-walk vocabulary (white = walk, red = don't walk).
  const makeLens = (y, color, z) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x241a1a, emissive: color, emissiveIntensity: 0.08 });
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 12), mat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, y, z);
    return { mesh: lens, mat };
  };
  const pedG = new THREE.Group(); pedG.position.set(0, 2.05, 0);
  const pedHousing = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.28), housingMat);
  pedHousing.castShadow = true;
  const walk = makeLens(0.12, 0xf2f2f2, 0.17);
  const dontWalk = makeLens(-0.12, 0xff5a1a, 0.17);
  pedG.add(pedHousing, walk.mesh, dontWalk.mesh);
  g.add(pedG);
  bakeSnowHeights(g);
  g.userData.parts.head = mainHead; g.userData.parts.ped = pedG;

  g.userData.lenses = lenses;
  g.userData.halos = halos;
  g.userData.pedLenses = { walk: walk.mat, dontWalk: dontWalk.mat };
  return g;
}

// A real "ONE WAY"-style sign: black board, white arrow pointing straight UP the
// board's own face (local +y), not sideways. A sideways arrow is what a real ONE WAY
// sign uses when it's mounted at a right angle to the street it's describing (telling
// you which way a *cross* street runs) — mounted facing oncoming traffic head-on, like
// this one, a sideways arrow reads as ambiguous ("turn which way?"). An arrow pointing
// straight up the sign, facing the driver, reads unambiguously as "the road continues
// this way, away from you" regardless of which direction the sign itself is rotated to
// face — so the fix here is the arrow's own orientation, not which way the prop points.
function onewaySignMesh() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x8a8f97 }));
  pole.position.y = 1.1; pole.castShadow = true;
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.05), plasterMat(0x14161a));
  board.position.y = 2.25; board.castShadow = true;
  const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.03), arrowMat);
  shaft.position.set(0, 2.1, 0.03);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.32, 3), arrowMat);
  head.position.set(0, 2.52, 0.03);
  snowCap(g, 0.6, 0.07, 0.09, 0, 2.725, 0);
  g.add(pole, board, shaft, head);
  return g;
}

const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, ...o });
function oakMesh(prop) {
  const g = new THREE.Group();
  const k = 0.85 + ((Math.abs(Math.sin((prop.x || 0) * 12.9 + (prop.z || 0) * 7.7)) * 1000) % 1) * 0.5;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * k, 0.32 * k, 2.2 * k, 7), M(0x5a4430));
  trunk.position.y = 1.1 * k; trunk.castShadow = true;
  g.add(trunk);
  [[0, 3.4, 0, 1.7], [0.9, 3.0, 0.3, 1.2], [-0.8, 3.1, -0.4, 1.25], [0.1, 4.2, 0.2, 1.1]].forEach(([x, y, z, r], i) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * k, 1), M(i % 2 ? 0x4b9a4f : 0x3f8a46, { flatShading: true }));
    m.position.set(x * k, y * k, z * k); m.castShadow = true; g.add(m);
  });
  return g;
}
function bushMesh(prop) {
  const g = new THREE.Group();
  const k = 0.8 + ((Math.abs(Math.sin((prop.x || 0) * 3.1 + (prop.z || 0) * 5.3)) * 1000) % 1) * 0.5;
  [[0, 0.55, 0, 0.75], [0.55, 0.42, 0.2, 0.55], [-0.5, 0.4, -0.2, 0.55]].forEach(([x, y, z, r]) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * k, 1), M(0x2f7a3c, { flatShading: true }));
    m.position.set(x * k, y * k, z * k); m.castShadow = true; g.add(m);
  });
  return g;
}
function fountainMesh(prop) {
  const g = new THREE.Group();
  const stone = M(0xb9b6ae, { roughness: 0.9 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.7, 20), stone);
  basin.position.y = 0.35; basin.castShadow = true;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.05, 20), M(0x4aa3d6, { roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 }));
  water.position.y = 0.62;
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.6, 10), stone);
  col.position.y = 1.4; col.castShadow = true;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.5, 0.35, 14), stone);
  bowl.position.y = 2.1;
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.1, 8), M(0xbfe6f7, { transparent: true, opacity: 0.6 }));
  jet.position.y = 2.7;
  g.add(basin, water, col, bowl, jet);
  if (prop.small) g.scale.setScalar(0.6);
  return g;
}
function gazeboMesh() {
  const g = new THREE.Group();
  const wood = M(0xf1ece0), roofM = M(0x7a3b34, { flatShading: true });
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.3, 8), M(0x9b8a73));
  floor.position.y = 0.15; floor.receiveShadow = true;
  g.add(floor);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.2, 6), wood);
    post.position.set(Math.cos(a) * 2.7, 1.9, Math.sin(a) * 2.7); post.castShadow = true; g.add(post);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.6, 8), roofM);
  roof.position.y = 4.5; roof.castShadow = true;
  g.add(roof);
  return g;
}
function foodstandMesh(prop) {
  const g = new THREE.Group();
  const cols = [[0xd9453b, 0xf4efe4], [0x2f8f5b, 0xf4efe4], [0xe0a82e, 0xf4efe4], [0x3b6fd1, 0xf4efe4]];
  const [c1, c2] = cols[(prop.variant || 0) % cols.length];
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1.4), M(0x7b5a3c));
  body.position.y = 0.55; body.castShadow = true;
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.6), M(0xcfc6b5));
  counter.position.y = 1.16;
  g.add(body, counter);
  [[-1.2, -0.7], [1.2, -0.7], [-1.2, 0.7], [1.2, 0.7]].forEach(([x, z]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 5), M(0x555555));
    p.position.set(x, 1.6, z); g.add(p);
  });
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 1.9), M(i % 2 ? c2 : c1));
    s.position.set(-1.1 + i * 0.44, 2.7 - 0.0, 0); s.rotation.z = 0; g.add(s);
  }
  return g;
}

const SHOP_HEX = { dealer: 0x17d6c8, perf: 0x2f7bff, paint: 0xff3b3b, tuning: 0xffd21f, body: 0x33d65a };
// NFSU-style shop beacon: a tall coloured lamp at the alley mouth, glowing so you can spot it from the avenue
let _beamTex = null;
function beamTexture() {
  if (_beamTex) return _beamTex;
  const c = document.createElement('canvas'); c.width = 4; c.height = 64;
  const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0.1)');
  x.fillStyle = gr; x.fillRect(0, 0, 4, 64);
  _beamTex = new THREE.CanvasTexture(c);
  return _beamTex;
}
// (a lamp on a pole whose spotlight beam shines straight down onto the alley mouth, as in NFSU)
function shopLampMesh(p) {
  const hex = SHOP_HEX[p.shop] || 0xffffff, g = new THREE.Group();
  const H = 7.2;
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, H, 8), M(0x2b2f36)).translateY(H / 2));
  // the lamp head is tipped over towards the street (local +z, the prop is rotated to face it) and throws its beam
  // down and out at an angle, landing on the pavement in front of the alley
  const TILT = 0.5, L = (H - 0.1) / Math.cos(TILT);
  const pivot = new THREE.Group(); pivot.position.set(0, H, 0); pivot.rotation.x = -TILT; g.add(pivot);
  pivot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.55, 0.3, 14), M(0x2b2f36)).translateY(0.1));
  const glow = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 2.6, roughness: 0.4 });
  glow.userData.snow = { skip: true };
  pivot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 14), glow).translateY(-0.07));
  const beamMat = new THREE.MeshBasicMaterial({ color: hex, map: beamTexture(), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  beamMat.userData.snow = { skip: true };
  pivot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 3.4, L, 28, 1, true), beamMat).translateY(-L / 2 - 0.05));
  const poolGeo = new THREE.CircleGeometry(3.4, 32); poolGeo.rotateX(-Math.PI / 2); poolGeo.scale(1, 1, 1.35);
  const pool = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  pool.position.set(0, 0.07, Math.tan(TILT) * H); g.add(pool);
  g.userData.shopBeacon = glow;
  return g;
}
function shopSignMesh(p) {
  const hex = SHOP_HEX[p.shop] || 0xffffff, g = new THREE.Group();
  const glow = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1.6 });
  glow.userData.snow = { skip: true };
  g.add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.7, 0.2), glow).translateY(4.6));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.4, 0.2), M(0x2b2f36)).translateY(2.2).translateX(-1.6));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.4, 0.2), M(0x2b2f36)).translateY(2.2).translateX(1.6));
  return g;
}

const COLLAPSE_TYPES = new Set(['picnic', 'hydrant', 'mailbox', 'cafeset', 'light', 'trafficlight', 'bench', 'shoplamp', 'shopsign', 'fountain', 'gazebo', 'foodstand', 'sign', 'oneway']);
const MERGE_TYPES = new Set(['oak', 'tree']);   // bushes stay separate: you can drive through them and they burst
function mergeStaticProps(meshes) {
  const out = new THREE.Group(), mats = new Map(), buckets = new Map();
  meshes.forEach(root => {
    root.updateMatrixWorld(true);
    const cx = Math.floor(root.position.x / 160), cz = Math.floor(root.position.z / 160);
    root.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material, mk = m.color.getHex() + '|' + (m.flatShading ? 1 : 0) + '|' + m.roughness;
      if (!mats.has(mk)) mats.set(mk, m);
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      Object.keys(g.attributes).forEach(k => { if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); });
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(o.matrixWorld);
      const bk = mk + '#' + cx + ',' + cz;
      (buckets.get(bk) || buckets.set(bk, { mk, geos: [] }).get(bk)).geos.push(g);
    });
  });
  buckets.forEach(b => {
    const mesh = new THREE.Mesh(mergeGeometries(b.geos, false), mats.get(b.mk));
    mesh.castShadow = true;
    out.add(mesh);
  });
  return out;
}

const builders = {
  shoplamp: shopLampMesh, shopsign: shopSignMesh,
  oak: oakMesh, bush: bushMesh, fountain: fountainMesh, gazebo: gazeboMesh, foodstand: foodstandMesh,
  tree: treeMesh, light: lightMesh, bench: benchMesh, sign: signMesh,
  trafficlight: trafficLightMesh, oneway: onewaySignMesh, picnic: picnicMesh, hydrant: hydrantMesh, mailbox: mailboxMesh, cafeset: cafeSetMesh
};

// Neon signs: each word is drawn once into a glowing-tube texture; every sign is an instanced quad tinted with its own colour.
// One draw call per word (12) however many signs there are. main.js fades the whole set in with the night (userData.mats).
function neonTexture(word, blade) {
  const c = document.createElement('canvas'), W = blade ? 64 : 256, H = blade ? 256 : 96; c.width = W; c.height = H;
  const g = c.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const draw = (txt, x, y, size) => {
    g.font = '900 ' + size + 'px "Arial Black", system-ui, sans-serif';
    if (!blade) { const mw = g.measureText(txt).width; if (mw > W - 28) { size = Math.floor(size * (W - 28) / mw); g.font = '900 ' + size + 'px "Arial Black", system-ui, sans-serif'; } }
    g.shadowColor = '#fff'; g.shadowBlur = 14; g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 9; g.strokeText(txt, x, y);
    g.shadowBlur = 0; g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeText(txt, x, y);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillText(txt, x, y);
  };
  if (blade) { const ch = word.split(''); const step = H / (ch.length + 0.6); ch.forEach((t, i) => draw(t, W / 2, step * (i + 0.8), Math.min(52, step * 0.95))); }
  else draw(word, W / 2, H / 2, 64);
  g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(5, 5, W - 10, H - 10);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildNeonSigns(list) {
  const g = new THREE.Group(), mats = [], byKey = new Map();
  list.forEach(p => { const k = p.word + (p.blade ? '|b' : ''); (byKey.get(k) || byKey.set(k, []).get(k)).push(p); });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const geo = new THREE.PlaneGeometry(1, 1);
  byKey.forEach((arr, k) => {
    const mat = new THREE.MeshBasicMaterial({ map: neonTexture(arr[0].word, arr[0].blade), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(geo, mat, arr.length);
    arr.forEach((p, i) => {
      q.setFromAxisAngle(up, (p.rotation || 0) * Math.PI / 180); sc.set(p.w, p.h, 1); pos.set(p.x, p.y + p.h / 2, p.z);
      m.compose(pos, q, sc); im.setMatrixAt(i, m); col.setHex(p.color).multiplyScalar(2.2); im.setColorAt(i, col);
    });
    im.frustumCulled = false; im.renderOrder = 3; g.add(im); mats.push(mat);
  });
  g.userData = { mats };
  return g;
}

// Pedestrian path lights: ~2.6 m posts with a warm lantern head, instanced (3 draw calls for all of them) plus a soft glow
// pool on the ground. main.js sets userData.lensMat.emissiveIntensity / glowMat.opacity from the time of day.
function buildPathLights(list) {
  const g = new THREE.Group(), n = list.length;
  const postGeo = new THREE.CylinderGeometry(0.05, 0.07, 2.0, 6); postGeo.translate(0, 1.0, 0);
  const headGeo = new THREE.SphereGeometry(0.2, 10, 8); headGeo.translate(0, 2.15, 0);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xffe8b8, emissive: 0xffc878, emissiveIntensity: 0.1, roughness: 0.4 });
  const post = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.6, metalness: 0.4 }), n);
  const head = new THREE.InstancedMesh(headGeo, lensMat, n);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const cx = c.getContext('2d'), gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,200,120,0.9)'); gr.addColorStop(0.4, 'rgba(255,190,110,0.3)'); gr.addColorStop(1, 'rgba(255,180,100,0)');
  cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
  const glowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const glowGeo = new THREE.PlaneGeometry(9, 9); glowGeo.rotateX(-Math.PI / 2);
  const glow = new THREE.InstancedMesh(glowGeo, glowMat, n); glow.renderOrder = 3;
  const m = new THREE.Matrix4();
  list.forEach((p, i) => { m.makeTranslation(p.x, 0.02, p.z); post.setMatrixAt(i, m); head.setMatrixAt(i, m); m.makeTranslation(p.x, 0.06, p.z); glow.setMatrixAt(i, m); });
  [post, head, glow].forEach(o => { o.frustumCulled = false; g.add(o); });
  g.userData = { lensMat, glowMat };
  return g;
}

// Returns both the Group to add to the scene and a flat `instances` list (each with a
// reference to its mesh) so collision.js can test against them and effects.js can
// knock them down or replace them with debris when destroyed. Traffic-light instances
// also carry the approach (signalNode/signalApproach) they should display, read by
// main.js each frame to drive their lens colors from the real signal state.
export function buildProps(cityData) {
  const group = new THREE.Group();
  const instances = [];
  const parked = [];
  const statics = [];
  const pathLights = [], awnings = [];
  const neonSigns = [];
  (cityData.props || []).forEach((p, i) => {
    if (p.type === 'parkedcar') {
      // drawn together as instanced meshes below; still gets a collider via the instance record
      const rec = { x: p.x, z: p.z, y: p.y || 0.02, heading: (p.rotation || 0) * Math.PI / 180, style: p.style || parkedCarStyle(i), color: p.color };
      parked.push(rec);
      instances.push({ id: 'prop' + i, type: 'parkedcar', x: p.x, z: p.z, mesh: new THREE.Group(), rec });
      return;
    }
    if (p.type === 'pathlight') { pathLights.push(p); return; }
    if (p.type === 'neonsign') { neonSigns.push(p); return; }
    if (p.type === 'awning') { const am = awningMesh(p); am.position.set(p.x, p.y || 3, p.z); am.rotation.y = (p.rotation || 0) * Math.PI / 180; awnings.push(am); return; }
    const build = builders[p.type] || treeMesh;
    const mesh = build(p);
    if (COLLAPSE_TYPES.has(p.type)) collapse(mesh);
    if (MERGE_TYPES.has(p.type)) {
      // non-destructible greenery: baked into shared per-area meshes instead of dozens of tiny ones
      mesh.position.set(p.x, 0.02, p.z); mesh.rotation.y = (p.rotation || 0) * Math.PI / 180;
      statics.push(mesh);
      instances.push({ id: 'prop' + i, type: p.type, x: p.x, z: p.z, mesh });
      return;
    }
    mesh.position.x = p.x;
    mesh.position.y = 0.02; // clears the ground plane's exact y=0 to avoid z-fighting
    mesh.position.z = p.z;
    mesh.rotation.y = (p.rotation || 0) * Math.PI / 180;
    group.add(mesh);
    instances.push({
      id: 'prop' + i, type: p.type, x: p.x, z: p.z, mesh,
      signalNode: p.signalNode, signalApproach: p.signalApproach
    });
  });
  if (parked.length) { const pg = buildParkedCars(parked); group.add(pg); group.userData.parkedHandles = pg.userData.handles; }
  if (statics.length) group.add(mergeStaticProps(statics));
  if (awnings.length) group.add(mergeStaticProps(awnings));
  if (neonSigns.length) { const ns = buildNeonSigns(neonSigns); group.add(ns); group.userData.neon = ns.userData; }
  if (pathLights.length) { const pl = buildPathLights(pathLights); group.add(pl); group.userData.pathLights = pl.userData; }
  return { group, instances };
}
