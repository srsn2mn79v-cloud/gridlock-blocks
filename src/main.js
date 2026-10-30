import { createSprays } from './spray.js';
import { KMH_PER_U } from './units.js';
import * as THREE from 'three';
import { tick, loadingDone } from './loading.js';
import { buildChicago } from './chicago/chicago.js';
import { buildRoads } from './generators/roads.js';
import { buildStructures } from './structures.js';
import { buildCuts, groundGeometry } from './generators/cuts.js';
import { buildShopBays } from './shopBays.js';
import { buildSigns } from './generators/signs.js';
import { buildParcels } from './generators/parcels.js';
import { buildDoors } from './generators/doors.js';
import { buildProps } from './generators/props.js';
import { getSpawn } from './generators/gameplay.js';
import { createRaces } from './races.js';
import { createFuel } from './fuel.js';
import { createHarbour } from './harbour.js';
import { createHail } from './hail.js';
import { districtAt, fromWorld } from './chicago/map.js';
import { Car } from './car.js';
import { createInput } from './input.js';
import { updateFollowCamera, createCameraRig, CAM_MODES } from './camera.js';
import { createInterior } from './interior.js';
import { createGroundSampler } from './terrain.js';
import { buildCollisionWorld, resolveCarCollisions, pointInPolygon } from './collision.js';
import { spawnDebris, spawnLeaves, updateEffects } from './effects.js';
import { createDestruction } from './destruction.js';
import { createGraphics } from './graphics.js';
import { createPedestrianSystem } from './pedestrians.js';
import { createDriftTracks } from './driftTrack.js';
import { buildSidewalks } from './sidewalks.js';
import { createTrafficSystem } from './traffic.js';
import { loadCustom } from './customData.js';
import { buildTransit, clearTransitSpots } from './transit.js';
import { createTransitScene } from './transitScene.js';
import { createPuffs } from './puffs.js';
import { setGlow } from './glow.js';
import { createEnvironment } from './environment.js';
import { createMinimap } from './minimap.js';
import { pointInPoly } from './chicago/geom.js';
import { createMenu, loadSettings, saveSettings } from './menu.js';
import { createWorld } from './world.js';
import { createTaxi } from './taxi.js';
import { createWeather } from './weather.js';
import { createPlowFx } from './plowfx.js';
import { createRadio } from './radio.js';
import { createAudio } from './audio.js';
import { createDrawbridge } from './drawbridge.js';
import { createDrivetrain } from './drivetrain.js';
import { isCovered } from './covered.js';
import { createSkidMarks } from './skidmarks.js';
import { createParkedCars } from './parked.js';
import { createShopLots } from './lots.js';
import { installSnowCap } from './surfaceShaders.js';
import { findSignalForApproach, phaseAt, isApproachClear } from './signals.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.Fog(0x0b0f14, 60, 260);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 600);
let gfx = null;   // graphics pipeline, created once the world exists (graphics.js)
const renderer = new THREE.WebGLRenderer({ antialias: true });
let resScale = 1, viewMul = 1;
const applyRatio = () => renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * resScale);
applyRatio();
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyRatio();
  renderer.setSize(innerWidth, innerHeight);
  if (gfx) gfx.resize(innerWidth, innerHeight);
});

// A deliberately dim, night-time ambient: the dark sky/fog color above was always
// meant to read as night, but these were bright enough to light the city like
// daytime anyway — which is exactly why the street lamps and headlights (see
// props.js / car.js) didn't visibly do anything: a dim light adds nothing next to
// already-bright ambient. Dialed down so the city needs those lights to see by, and
// they visibly matter when switched on.
// Dialed down further — the previous pass still left enough ambient to see most of the
// road by, which undercut the whole point of having headlights/streetlights at all.
// Night should actually be dark away from a light source now.
const hemi = new THREE.HemisphereLight(0x8fa6c9, 0x1a1410, 0.09);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xaebbd9, 0.12); // moonlight, not sunlight
sun.position.set(-40, 60, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
sun.shadow.camera.far = 250;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; sun.shadow.radius = 3;
scene.add(sun);
scene.add(sun.target);
// The shadow camera only covers a fixed box around the sun's target, so the sun (and its
// target) follow the player — otherwise shadows stop at ~120 units from the origin, which
// the bigger city is well outside of. Moved each frame in animate().



// Swap this for your own exported city — paste the Gridlock City Editor's
// Export JSON in place of the object in src/cityData.js.
await tick('Building the city streets...', 0.05);
const city = buildChicago();

await tick('Laying roads...', 0.45);
const roadsGroup = buildRoads(city);
const structures = buildStructures(city);
roadsGroup.add(structures.group);
scene.add(roadsGroup);
scene.add(buildSidewalks(city));

await tick('Raising buildings...', 0.58);
const { group: parcelGroup, instances: parcelInstances } = buildParcels(city);
scene.add(buildDoors(city));
scene.add(parcelGroup);
const waterParcels = parcelInstances.filter(p => p.type === 'water');

await tick('Planting trees and lamps...', 0.7);
const transit = buildTransit(city, loadCustom().transit); clearTransitSpots(city, transit);     // (bus stops and cab stands keep their kerb free of parked cars)
const { group: propGroup, instances: propInstances } = buildProps(city);
scene.add(propGroup);

// Time of day / weather live in environment.js; it calls back with how "night" it is (0..1)
// so the lamps, their ground pools and the reflectors can follow.
let nightK = 1;
const lampLights = [];   // filled once props exist (see below)
function onNight(k) {
  nightK = k;
  if (gfx) gfx.setNight(k);
  lampLights.forEach(l => {
    if (l.dead) return;
    l.lens.forEach(m => { m.emissiveIntensity = 0.05 + 1.05 * nightK; });
    l.pools.forEach(pl => setGlow(pl, 0.28));
  });
  const neon = propGroup.userData.neon; if (neon) neon.mats.forEach(m => { m.opacity = Math.min(1, nightK * 1.15); });
  const pth = propGroup.userData.pathLights;
  if (pth) { pth.lensMat.emissiveIntensity = 0.1 + 1.6 * nightK; pth.glowMat.opacity = 0.75 * nightK; }
}

// Reflector brightness: a fixed, precomputed glow for studs sitting near a (static)
// streetlamp, plus a brighter dynamic one for whichever studs are actually inside the
// player's headlight cone this frame — see the comment on reflectorBaseMats in
// roads.js for why this is driven directly rather than left to material specular alone.
const reflectors = roadsGroup.userData.reflectors || [];
// Far lamps and signal heads are hidden: each is a handful of draw calls and at 150+ units they are a speck.
// Only what this function hid is shown again, so knocked-down props stay gone.
const cullSet = propInstances.filter(p => p.mesh && ['light', 'trafficlight', 'shoplamp', 'shopsign', 'sign', 'oneway', 'hydrant', 'mailbox', 'cafeset', 'bush', 'picnic'].includes(p.type));
let cullT = 0;
function cullProps(dt) {
  cullT -= dt; if (cullT > 0) return; cullT = 0.25;
  const R = Math.max(90, camera.far * 0.55), R2 = R * R, cx = camera.position.x, cz = camera.position.z;
  for (const p of cullSet) {
    const dx = p.x - cx, dz = p.z - cz, far = dx * dx + dz * dz > R2;
    if (far && p.mesh.visible) { p.mesh.visible = false; p._cull = true; }
    else if (!far && p._cull) { p.mesh.visible = true; p._cull = false; }
  }
}
const lampXZ = propInstances.filter(p => p.type === 'light').map(p => ({ x: p.mesh.position.x, z: p.mesh.position.z, owner: p }));
const lampGrid = new Map();
function lampGridRebuild() {
  lampGrid.clear();
  lampXZ.forEach(l => { const k = Math.floor(l.x / 16) + ',' + Math.floor(l.z / 16); if (!lampGrid.has(k)) lampGrid.set(k, []); lampGrid.get(k).push(l); });
}
lampGridRebuild();
function computeLampGlow(only) {
  if (only) lampGridRebuild();
  reflectors.forEach(r => {
    if (only && Math.hypot(r.x - only.x, r.z - only.z) > 14) return;
    let nearest = Infinity;
    const gx = Math.floor(r.x / 16), gz = Math.floor(r.z / 16);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const L = lampGrid.get((gx + i) + ',' + (gz + j));
      if (L) L.forEach(l => { const d = Math.hypot(r.x - l.x, r.z - l.z); if (d < nearest) nearest = d; });
    }
    r.lampGlow0 = nearest < 14 ? 0.5 * Math.max(0, 1 - nearest / 14) : 0;
  });
}
computeLampGlow();
// Lit by the same geometry that really lights the road: every reflector is tested against
// each headlight's actual world position, aim direction and cone (the SpotLight's own
// angle/penumbra, with the same smoothstep falloff three.js uses), not against the car's
// centre point with a made-up box. The old test used the car's centre and a fixed
// range/width, so studs kept glowing beside and behind the beams and after the lights went
// off. AI cars get a simpler fixed cone — their lights aren't real THREE.Lights.
const _lp = new THREE.Vector3(), _lt = new THREE.Vector3();
const lightSources = [], _tc = new THREE.Color();
function gatherLightSources(car) {
  lightSources.length = 0;
  if (car.lightsOn) {
    car.headSpots.forEach(sp => {
      sp.getWorldPosition(_lp); sp.target.getWorldPosition(_lt);
      const dx = _lt.x - _lp.x, dy = _lt.y - _lp.y, dz = _lt.z - _lp.z, l = Math.hypot(dx, dy, dz) || 1;
      lightSources.push({
        px: _lp.x, py: _lp.y, pz: _lp.z, dx: dx / l, dy: dy / l, dz: dz / l,
        coneCos: Math.cos(sp.angle), penCos: Math.cos(sp.angle * (1 - sp.penumbra)),
        range: 30, gain: 3.2, col: car.headColor != null ? car.headColor : 0xfff2d0
      });
    });
  }
  traffic.cars.forEach(c => {
    if (!c.active) return;
    if (Math.abs(c.mesh.position.x - car.x) > 70 || Math.abs(c.mesh.position.z - car.z) > 70) return;   // far cars can't light anything you can see
    const mh = c.mesh.rotation.y;
    const fx = Math.sin(mh), fz = Math.cos(mh);
    const n = Math.hypot(fx, 0.1, fz);
    lightSources.push({
      px: c.mesh.position.x + fx * 1.8, py: c.mesh.position.y + 0.5, pz: c.mesh.position.z + fz * 1.8,
      dx: fx / n, dy: -0.1 / n, dz: fz / n,
      coneCos: Math.cos(0.62), penCos: Math.cos(0.3), range: 16, gain: 2.0
    });
  });
}
function updateReflectors(car) {
  gatherLightSources(car);
  const _col = new THREE.Color(), dirty = new Set();
  reflectors.forEach(r => {
    if (r.last >= 0 && (Math.abs(r.x - car.x) > 90 || Math.abs(r.z - car.z) > 90)) return;
    let boost = 0, tint = null;
    for (let i = 0; i < lightSources.length; i++) {
      const L = lightSources[i];
      const vx = r.x - L.px, vz = r.z - L.pz;
      if (vx > L.range || vx < -L.range || vz > L.range || vz < -L.range) continue;
      const vy = r.y + 0.05 - L.py;
      const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (d > L.range || d < 0.01) continue;
      const cosA = (vx * L.dx + vy * L.dy + vz * L.dz) / d;
      if (cosA <= L.coneCos) continue;
      const t = Math.min(1, (cosA - L.coneCos) / (L.penCos - L.coneCos));
      const lit = t * t * (3 - 2 * t) * (1 - d / L.range) * L.gain;
      if (lit > boost) { boost = lit; tint = L.col; }
    }
    const v = 0.5 - 0.38 * nightK + Math.max(r.lampGlow0 * nightK, boost * nightK) * 2.2;
    const tc = boost * nightK > 0.05 && tint != null && tint !== 0xfff2d0 ? tint : 0;
    if (Math.abs(v - r.last) > 0.02 || tc !== r.tc) {
      r.last = v; r.tc = tc; _col.copy(r.base).multiplyScalar(v);
      if (tc) { const k = Math.min(1, boost * nightK * 1.5); _tc.set(tc); _col.r += (_tc.r * v * 1.6 - _col.r) * k; _col.g += (_tc.g * v * 1.6 - _col.g) * k; _col.b += (_tc.b * v * 1.6 - _col.b) * k; }
      r.im.setColorAt(r.idx, _col); dirty.add(r.im); }
  });
  dirty.forEach(im => { im.instanceColor.needsUpdate = true; });
}

// Streetlamp lighting. Every lamp has a nearly-free glow pool on the road under it (props.js);
// the *real* spotlights are a small fixed pool that parks on whichever lamps are nearest the
// player. A fixed number of lights keeps the shader the same size every frame (adding or
// removing a light recompiles it) and well under a phone GPU's uniform limits however big
// the city gets. Intensity fades with both distance and rank, so lamps ease in and out
// rather than popping as the nearest set changes.
const LAMP_POOL = 14, LAMP_RANGE = 100, LAMP_FADE = 30, LAMP_INTENSITY = 60;
const lampDefs = [];
propInstances.filter(p => p.type === 'light').forEach(p => {
  (p.mesh.userData.lampAnchors || []).forEach(a => {
    const pos = new THREE.Vector3(), target = new THREE.Vector3();
    a.spot.getWorldPosition(pos); a.target.getWorldPosition(target);
    lampDefs.push({ pos, target, d: 0, owner: p });
  });
});
propInstances.filter(p => p.type === 'light').forEach(p => {
  lampLights.push({ owner: p, dead: false, lens: p.mesh.userData.lensMaterials || [], pools: p.mesh.userData.lampPools || [] });
});
// Tunnel ceiling lights: real lights too, and always on (it's dark in there at noon).
(roadsGroup.userData.tunnelLights || []).forEach(t => {
  lampDefs.push({ pos: new THREE.Vector3(t.x, t.y, t.z), target: new THREE.Vector3(t.x, t.ground, t.z), d: 0, always: true, color: 0xfff1d0 });
});
// A lamp that has been knocked over goes dark for good: no spotlight, no glow, no lens, and
// the studs it used to light on the road lose their share of its glow.
function lampOff(inst) {
  for (let i = lampDefs.length - 1; i >= 0; i--) if (lampDefs[i].owner === inst) lampDefs.splice(i, 1);
  const l = lampLights.find(x => x.owner === inst);
  if (l) { l.dead = true; l.lens.forEach(m => { m.emissiveIntensity = 0; }); l.pools.forEach(p => { p.visible = false; p.material.opacity = 0; }); }
  const k = lampXZ.findIndex(x => x.owner === inst);
  if (k >= 0) { const at = lampXZ.splice(k, 1)[0]; computeLampGlow(at); }
}
const lampPool = [];
for (let i = 0; i < LAMP_POOL; i++) {
  const sp = new THREE.SpotLight(0xffa033, 0, 34, Math.PI / 3, 0.65, 1.7);
  sp.castShadow = false;
  sp.position.set(0, -50, 0);
  scene.add(sp); scene.add(sp.target);
  lampPool.push(sp);
}
function updateLampLights(car) {
  for (const l of lampDefs) l.d = Math.hypot(l.pos.x - car.x, l.pos.z - car.z);
  const near = lampDefs.filter(l => l.d < LAMP_RANGE).sort((a, b) => a.d - b.d).slice(0, LAMP_POOL);
  lampPool.forEach((sp, i) => {
    const l = near[i];
    if (!l) { sp.intensity = 0; return; }
    sp.position.copy(l.pos);
    sp.target.position.copy(l.target);
    sp.color.setHex(l.color || 0xffa033);
    const distFade = Math.min(1, (LAMP_RANGE - l.d) / LAMP_FADE);
    const rankFade = Math.min(1, (LAMP_POOL - i) / 3);
    sp.intensity = LAMP_INTENSITY * Math.min(distFade, rankFade) * (l.always ? 1 : nightK);
  });
}


const spawn = getSpawn(city);
await tick('Fuelling up...', 0.78);
const car = new Car(spawn);
scene.add(car.group);

// Terrain following: each wheel samples its own height off the road graph (car.js
// does the per-wheel sampling; this just hands it the height function — see terrain.js).
const heightAt = createGroundSampler(city);

const cuts = buildCuts(city, heightAt);
scene.add(cuts.group);
scene.add(buildShopBays(city, heightAt));
const signs = buildSigns(city, heightAt, roadsGroup.userData.mapPaths);
scene.add(signs.group);
signs.group.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(installSnowCap); });
const destruction = createDestruction(scene);
const ground = new THREE.Mesh(
  groundGeometry(2600, cuts.holes),
  new THREE.MeshStandardMaterial({ color: 0x575c61, roughness: 0.95 })
);
const baseHoles = cuts.holes.slice();
const setGarageHoles = polys => { ground.geometry.dispose(); ground.geometry = groundGeometry(2600, baseHoles.concat(polys.map(poly => ({ poly })))); };   // an owned apartment's garage ramp is cut into the ground
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// AI traffic: a handful of cars driving the same road graph, stopping for red signals
// and slowing for whatever's ahead of them (the player included). Each one hands back a
// small circular collider that's kept in sync with its position every frame, so the
// player's car can bump against them the same way it bumps against a building or a
// prop — see traffic.js.
await tick('Starting traffic...', 0.84);
const traffic = createTrafficSystem(city, scene, heightAt, 40, 800, transit);

// Collision + destruction: buildings, blocking props, and AI traffic are all in this
// world. Pedestrians are deliberately never added to it — see pedestrians.js.
const collisionWorld = buildCollisionWorld(propInstances.concat(signs.instances), parcelInstances).concat(structures.colliders, traffic.colliders);
traffic.setSink(collisionWorld);   // cars created later (when the Traffic slider goes up) add their colliders here

// Pedestrians walk a sidewalk/crossing graph built from the same data — see
// pedestrians.js for the two independent reasons hitting one isn't possible.
await tick('Adding pedestrians...', 0.9);
const pedestrians = createPedestrianSystem(city, scene, 100, 2000);

// Traffic-light props don't know their own phase — each frame we look up the real
// signal for the approach it was tagged with in cityData.js and recolor its vehicle
// lenses, its separate pedestrian walk/don't-walk lenses, and its glow light to match
// (see props.js's trafficLightMesh and signals.js's phaseAt/isApproachClear). The
// pedestrian lenses read the same underlying signal timing as the vehicle ones — real
// signal controllers work the same way, one timing plan driving both — but they're a
// distinct fixture with their own white/red vocabulary, not the vehicle light reused.
const trafficLightProps = propInstances.filter(p => p.type === 'trafficlight');
function breakTrafficLightInst(inst) {
  inst.broken = true;
  const u = inst.mesh.userData;
  Object.values(u.lenses || {}).forEach(m => { m.emissiveIntensity = 0; });
  Object.values(u.halos || {}).forEach(h => { h.visible = false; h.material.opacity = 0; });
  if (u.pedLenses) { u.pedLenses.walk.emissiveIntensity = 0; u.pedLenses.dontWalk.emissiveIntensity = 0; }
}
function updateTrafficLights() {
  const now = performance.now();
  trafficLightProps.forEach(inst => {
    if (inst.broken) return;
    const lenses = inst.mesh.userData.lenses;
    if (!lenses) return;
    const sig = findSignalForApproach(city, inst.signalNode, inst.signalApproach);
    const phase = sig ? phaseAt(sig, now) : 'green';
    const halos = inst.mesh.userData.halos;
    ['red', 'yellow', 'green'].forEach(k => {
      const on = phase === k;
      lenses[k].emissiveIntensity = on ? 2.6 : 0.05;
      if (halos) { halos[k].material.opacity = on ? 0.95 : 0; halos[k].visible = on; }
    });

    const pedLenses = inst.mesh.userData.pedLenses;
    if (pedLenses) {
      const canWalk = sig ? isApproachClear(sig, now) : true;
      pedLenses.walk.emissiveIntensity = canWalk ? 1.5 : 0.08;
      pedLenses.dontWalk.emissiveIntensity = canWalk ? 0.08 : 1.5;
    }
  });
}

const sprays = createSprays(scene);
const input = createInput();
const camOffset = new THREE.Vector3(0, 5.2, 9.5);
const camBase = camOffset.clone();
// chase-camera offset from the tunable distance/height, scaled for the size of the car
function refreshCamOffset() {
  const big = (car.dimLen || 3.6) / 3.6, h = Number(settings.camHeight) || 5.2, d = Number(settings.camDist) || 9.5;
  camOffset.set(0, h * (0.8 + 0.2 * big) + (big > 1.2 ? 1.2 : 0), d * (0.75 + 0.25 * big));
}

const speedEl = document.getElementById('speed');
const fpsEl = document.getElementById('fps');
const splashEl = document.getElementById('splash');

// Drive into water and it actually sinks you — checked against the real water
// parcel footprints (the same polygon test buildings use for collision), not a
// height/color guess. Steering locks out, but the car doesn't freeze in place: it
// keeps drifting on its last heading while water drag bleeds off its speed, and
// gradually noses down and rolls over as it sinks — "slow down and fall", not an
// instant stop. Respawns at the start a few seconds after going under.
let sinking = false, sinkTimer = 0;
const SINK_DURATION = 4.5;

const deckParcels = (city.harbour ? city.harbour.decks : []);
function isCarInWater() {
  if (car.y > 0.7) return false;                       // on a bridge deck (the drawbridge's is 1.6 up; when its leaves are raised the road is gone and the car drops)
  return waterParcels.some(w => pointInPolygon(car.x, car.z, w.footprint)) && !deckParcels.some(w => pointInPolygon(car.x, car.z, w));
}

function respawnCar() {
  car.teleport(spawn.x, spawn.z, 0, spawn.heading || 0);
  sinking = false;
  splashEl.style.display = 'none';
}

// One-way enforcement (player side): AI traffic is kept off the wrong end of a one-way
// edge entirely (traffic.js), but the player can still physically steer onto one — so
// this detects it instead, as an "offence" to build a ticketing/scoring system on top
// of later, rather than hard-blocking the player's own car. Flags whenever the player
// is on a one-way edge's roadway heading opposite to its allowed `from`->`to` direction.
const oneWayEdges = (city.roadEdges || []).filter(e => e.oneWay).map(e => {
  const a = city.roadNodes[e.from], b = city.roadNodes[e.to];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { ax: a.x, az: a.z, bx: b.x, bz: b.z, dirX: (b.x - a.x) / len, dirZ: (b.z - a.z) / len, halfWidth: e.width / 2 };
});
const wrongwayEl = document.getElementById('wrongway');
let wrongWay = false;
let wrongWayOffences = 0;
function updateWrongWay() {
  let onWrongWayEdge = false;
  for (const e of oneWayEdges) {
    const dx = car.x - e.ax, dz = car.z - e.az;
    const along = dx * e.dirX + dz * e.dirZ;
    const edgeLen = Math.hypot(e.bx - e.ax, e.bz - e.az);
    if (along < -1 || along > edgeLen + 1) continue;
    const lateral = Math.abs(dx * e.dirZ - dz * e.dirX);
    if (lateral > e.halfWidth + 0.6) continue;
    // car.js's own forward convention: (sin heading, cos heading).
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const facing = fx * e.dirX + fz * e.dirZ;
    if (facing < -0.25 && Math.abs(car.speed) > 1) { onWrongWayEdge = true; break; }
  }
  if (onWrongWayEdge && !wrongWay) wrongWayOffences++; // count each new wrong-way entry, not every frame
  wrongWay = onWrongWayEdge;
  wrongwayEl.style.display = wrongWay ? 'block' : 'none';
}

// Exposed for poking at from the browser console while tuning/debugging — not used by
// the game itself. `offences` is a first cut at a detectable-violation record (right
// now just wrong-way driving) for a scoring/ticketing system to build on later.

const clock = new THREE.Clock();
// --- Environment, settings menu, minimap -----------------------------------------------
const settings = loadSettings();
sun.shadow.mapSize.set(Number(settings.shadow) || 2048, Number(settings.shadow) || 2048);
gfx = createGraphics({ renderer, scene, camera, parcelInstances, ground, initial: { ao: settings.ao, bloom: settings.bloom, tone: settings.tone, tex: settings.tex, fx: settings.fx !== false, quality: settings.quality } });
if (settings.rain && settings.snow) settings.snow = false;
await tick('Setting up the world...', 0.94);
const env = createEnvironment({ scene, camera, hemi, sun, ground, roadsGroup, parcelGroup, propGroup, onNight, bounds: city.bounds });
const minimap = createMinimap(city, roadsGroup);
const weather = createWeather({ env, settings, save: () => saveSettings(settings) });
const plowFx = createPlowFx(scene);
const taxi = createTaxi({ city, scene, heightAt, snowing: () => !!settings.snow });
let modalPause = false;
const world = createWorld({ transit, setGarageHoles, city, scene, camera, car, input, heightAt, collisionWorld, parcelInstances, taxi, env, setModalPause: v => { modalPause = v; },
  chooseCar: key => { settings.car = key; saveSettings(settings); applySetting('car', key); menu.refresh?.(); } });
if (!world.ownedCars().includes(settings.car)) settings.car = 'hatch';
const arena = createDriftTracks({ scene });
world.setArena(arena.heightAt);
let lastRev = null;
const races = createRaces({ city, scene, heightAt, car, world, transit, arena, collisionWorld,
  gearbox: { setManual: v => drive.setManual(v), shiftUp: () => drive.shiftUp(), shiftDown: () => drive.shiftDown(), state: () => lastRev },
  tune: { rivals: { add: o => traffic.addRival(o), clear: () => traffic.clearRivals() }, settings, limits: { traffic: traffic.maxCount, peds: pedestrians.maxCount }, clearZone: z => traffic.setClearZone(z),
    set: (k, v) => { menu.set(k, v); } }, districtName: (x, z) => { const [X, Y] = fromWorld(x, z); const d = districtAt(X, Y); return d ? d.name : 'City'; } });
collisionWorld.push(...races.solids);
const harbour = createHarbour({ city, scene });
const fuel = createFuel({ city, scene, heightAt, car, world, active: () => !races.active() });
collisionWorld.push(...fuel.colliders);
const hail = createHail({ city, scene, heightAt: world.heightAt, world, camera, minimap, toast: msg => world.toast(msg) });
world.setDestinations(() => races.plan.map(r => ({ name: r.name + ' (class ' + r.cls + ')', group: 'Races', sub: ({ drag: 'Drag', drift: 'Drift', circuit: 'Circuit', sprint: 'Sprint' })[r.kind], x: r.start.x - Math.sin(r.start.heading) * 14, z: r.start.z - Math.cos(r.start.heading) * 14, h: r.start.heading })));
world.setBlocked(() => races.active() || races.offering() || hail.busy());
world.setRaceInfo(() => races.plan);
world.setSleepHook(h => weather.advance(h));
// walls the chase camera must not sit inside: building footprints (bucketed) and, in a garage, its concrete
const shopLots = createShopLots({ scene, cityData: city, collisionWorld, heightAt, pedestrians, adopt: (x, z, fx, fz, col) => traffic.adopt(x, z, fx, fz, col) });
const parkedCars = createParkedCars({ scene, propInstances, handles: propGroup.userData.parkedHandles, collisionWorld, heightAt, events: traffic.events });
const camGrid = new Map();
collisionWorld.forEach(c => {
  if (c.kind !== 'parcel' || !c.blocksCar || c.ymax !== undefined || !c.footprint || c.garage) return;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; c.footprint.forEach(([x, z]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
  for (let i = Math.floor(x0 / 48); i <= Math.floor(x1 / 48); i++) for (let j = Math.floor(z0 / 48); j <= Math.floor(z1 / 48); j++) { const k = i + ',' + j; (camGrid.get(k) || camGrid.set(k, []).get(k)).push(c.footprint); }
});
function camBlocked(x, z) {
  if (world.mode === 'garage') return world.pocketWall(x, z);
  const cell = camGrid.get(Math.floor(x / 48) + ',' + Math.floor(z / 48));
  return !!cell && cell.some(f => pointInPolygon(x, z, f));
}
// markers that would sit on top of each other on the map are fanned out sideways so each stays readable
function spreadMarkers(list) {
  const out = [];
  list.forEach(m => {
    const near = out.filter(o => Math.hypot(o.x - m.x, o.z - m.z) < 30);
    if (!near.length) { out.push({ ...m }); return; }
    const k = near.length, side = k % 2 ? 1 : -1, step = Math.ceil(k / 2) * 26;
    out.push({ ...m, x: m.x + side * step, z: m.z + 6 * (k % 3) });
  });
  return out;
}
const transitScene = createTransitScene({ scene, transit, heightAt });
// metro entrances are solid (a 6 x 5 m building each, front toward the road)
((transit.metro && transit.metro.lines) || []).forEach(l => l.stations.forEach(st => {
  const fx = Math.cos(st.h), fz = Math.sin(st.h), rx = -fz, rz = fx, hw = 3.1, hd = 2.6;
  const corner = (a, b) => [st.x + rx * hw * a + fx * hd * b, st.z + rz * hw * a + fz * hd * b];
  collisionWorld.push({ kind: 'parcel', instance: null, footprint: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], blocksCar: true, destructible: false, response: 'bounce', destroyed: false });
}));
// transport markers on the minimap: bus depot, and cab stands / bus stops only when you zoom out to the whole map
const transitMarkers = all => {
  const out = [];
  if (world.mode !== 'city') return out;
  if (transit.depot) out.push({ x: transit.depot.x, z: transit.depot.z, color: '#2f6fb5', label: 'B' });
  ((transit.metro && transit.metro.lines) || []).forEach(l => l.stations.forEach(s => out.push({ x: s.x, z: s.z, color: '#' + l.color.toString(16).padStart(6, '0'), label: 'M' })));
  transit.stands.forEach(s => { if (all || Math.hypot(s.x - car.x, s.z - car.z) < 500) out.push({ x: s.x, z: s.z, color: '#f2c200', label: 'T' }); });
  if (!all) transit.stops.forEach(s => { if (Math.hypot(s.x - car.x, s.z - car.z) < 260) out.push({ x: s.x, z: s.z, color: '#4aa3ff', label: 'b' }); });
  return out;
};
const stationMarkers = (all) => (world.mode !== 'city' ? [] : (city.stations || []).filter(st => all || Math.hypot(st.x - car.x, st.z - car.z) < 260).map(st => ({ x: st.door.x, z: st.door.z, color: st.kind === 'hospital' ? '#ff4d4d' : st.kind === 'police' ? '#4a86ff' : st.kind === 'market' ? '#38d96a' : '#ff9a2e', label: st.kind === 'hospital' ? '✚' : st.kind === 'police' ? 'PD' : st.kind === 'market' ? '🛒' : 'FD' })));
const mapExtras = (all) => { const tx = taxi.mapExtras(); return { route: races.route() || (tx && tx.route), markers: spreadMarkers((tx ? tx.markers : []).concat(world.mapMarkers(all), races.markers(), fuel.markers(), transitMarkers(all), stationMarkers(all))) }; };

let autoLights = null;   // headlights follow night/day, but only when it actually crosses
function syncLights() {
  const isNight = env.nightK > 0.5;
  if (autoLights !== isNight) { autoLights = isNight; input.lightsOn = isNight; }
}

function applySetting(k, v) {
  if (k === 'traffic') traffic.setCount(v);
  else if (k === 'peds') pedestrians.setCount(v);
  else if (k === 'hour') { env.setHour(v, true); weather.refresh(); }
  else if (k === 'dynWeather' || k === 'clockRun') weather.refresh();
  else if (k === 'fog') env.setFog(v);
  else if (k === 'rain') env.setRain(v);
  else if (k === 'snow') env.setSnow(v);
  else if (k === 'car') { car.setStyle(v); refreshCamOffset(); camRig.setMode(camRig.mode); world.applyMods(); taxi.setEnabled(false, car); }
  else if (k === 'res') { resScale = Number(v) || 1; applyRatio(); renderer.setSize(innerWidth, innerHeight); gfx.resize(innerWidth, innerHeight); }
  else if (k === 'view') viewMul = Number(v) || 1;
  else if (k === 'camDist' || k === 'camHeight') refreshCamOffset();
  else if (k === 'swapSticks') input.setSwap(v);
  else if (k === 'sound') audio.setEnabled(v);
  else if (k === 'volume') audio.setVolume(v);
  else if (k === 'fps') fpsEl.style.display = v ? '' : 'none';
  else if (k === 'ao' || k === 'bloom' || k === 'tone' || k === 'tex' || k === 'fx') gfx.set(k, v);
  else if (k === 'quality') gfx.set('quality', v);
  else if (k === 'shadow') { const n = Number(v) || 2048; if (sun.shadow.mapSize.x !== n) { sun.shadow.mapSize.set(n, n); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } } }
  if (k === 'hour') dayBtn.textContent = env.nightK > 0.5 ? '🌙' : '☀️';
}
let paused = false;
const menu = createMenu({
  settings,
  limits: { traffic: traffic.maxCount, peds: pedestrians.maxCount },
  onChange: applySetting,
  onOpenChange: open => { paused = open; },
  ownedCars: () => world.ownedCars(),
  canOpen: () => !world.modal && !races.menuOpen() && !minimap.isFullOpen() && performance.now() - minimap.escAt() > 80 && performance.now() - world.escAt() > 80
});

// quick day/night toggle (button or N): sweeps between noon and night
const dayBtn = document.getElementById('daynight');
function toggleDayNight() {
  const toDay = env.nightK > 0.5;
  settings.hour = toDay ? 12 : 22;
  env.setHour(settings.hour);          // eased: sweeps through dusk/dawn
  dayBtn.textContent = toDay ? '☀️' : '🌙';
  menu.refresh();
}
dayBtn.addEventListener('click', () => { toggleDayNight(); dayBtn.blur(); });
addEventListener('keydown', e => { if (e.code === 'KeyN' && !e.repeat) toggleDayNight(); });


// ---- camera views: chase / bumper / top / inside, with a small tuner (distance + height) that leaves the car in view ----
const interior = createInterior({ car, input });
const camRig = createCameraRig({ camera, car, getOffset: () => camOffset, interior, getInside: () => ({ back: Number(settings.camInBack ?? 0.5), up: Number(settings.camInUp ?? 0.08) }), onMode: mode => { settings.camMode = mode; saveSettings(settings); camSync(); } });
const camBtn = document.createElement('button'); camBtn.id = 'cambtn'; camBtn.textContent = '📷'; camBtn.tabIndex = -1; camBtn.setAttribute('aria-label', 'Camera views');
const camPanel = document.createElement('div'); camPanel.id = 'campanel';
const camStyle = document.createElement('style');
camStyle.textContent = `#cambtn, #resetbtn { position: fixed; top: 64px; right: 12px; z-index: 5; width: 44px; height: 44px; border-radius: 10px; border: 0; font-size: 21px; background: rgba(14,18,24,.72); color: #fff; cursor: pointer; touch-action: manipulation; }
  #resetbtn { top: 116px; } #campanel { position: fixed; top: 64px; right: 64px; z-index: 6; display: none; width: 190px; padding: 8px 10px; border-radius: 12px; background: rgba(10,14,22,.55); backdrop-filter: blur(3px); color: #fff; font: 600 12px system-ui, sans-serif; }
  #campanel .seg { display: flex; gap: 4px; margin-bottom: 6px; } #campanel .seg button { flex: 1; border: 0; border-radius: 7px; padding: 6px 0; font: 700 11px system-ui; background: rgba(255,255,255,.14); color: #fff; cursor: pointer; } #campanel .seg button.on { background: #ffd21f; color: #111; }
  #campanel label { display: flex; justify-content: space-between; margin-top: 4px; } #campanel input { width: 100%; margin: 2px 0 0; }
  html.touch #campanel { top: auto; bottom: 74px; right: 170px; }`;
document.head.appendChild(camStyle); document.body.append(camPanel);
// reset: put the car back on the nearest free bit of road (when it is wedged between cars or props)
const resetBtn = document.createElement('button'); resetBtn.id = 'resetbtn'; resetBtn.textContent = '⟲'; resetBtn.tabIndex = -1; resetBtn.setAttribute('aria-label', 'Reset car onto the road (U)'); resetBtn.title = 'Reset car onto the road (U)';
{ const grid = document.getElementById('tgrid'); if (grid) { camBtn.className = resetBtn.className = 'tb'; grid.append(camBtn, resetBtn); } else document.body.append(camBtn, resetBtn); }
let unstickCool = 0;
function unstick() {
  if (world.onFoot || world.mode !== 'city' || races.active() || performance.now() < unstickCool) return;
  const nodes = city.roadNodes, cars = traffic.cars.filter(c => c.active), hdg = car.heading;
  let best = null, bd = 1e9;
  for (const e of city.roadEdges) {
    if ((e.structure && e.structure !== 'surface') || e.ramp || e.type === 'highway') continue;
    const a = nodes[e.from], b = nodes[e.to]; if (!a || !b || a.elevation > 0.5 || b.elevation > 0.5) continue;
    const len = Math.hypot(b.x - a.x, b.z - a.z); if (len < 6) continue;
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    for (let t = 4; t < len - 4; t += 8) {
      const x = a.x + ux * t, z = a.z + uz * t, d = Math.hypot(x - car.x, z - car.z);
      if (d < 7 || d > 120 || d >= bd) continue;
      if (cars.some(c => Math.hypot(c.mesh.position.x - x, c.mesh.position.z - z) < 7)) continue;
      const hz = world.heightAt(x, z, 0); if (world.heightAt.kind !== 'road') continue;
      // face along the road, whichever way is closer to where the car was pointing
      let h = Math.atan2(ux, uz); const dh = Math.atan2(Math.sin(h - hdg), Math.cos(h - hdg)); if (Math.abs(dh) > Math.PI / 2) h += Math.PI;
      best = { x, z, y: hz, h }; bd = d;
    }
  }
  if (!best) { world.toast('No free road nearby'); return; }
  unstickCool = performance.now() + 2500;
  car.teleport(best.x, best.z, best.y, best.h); car.speed = 0;
  world.toast('Car reset onto the road');
}
resetBtn.addEventListener('click', () => { unstick(); resetBtn.blur(); });
addEventListener('keydown', e => { if (e.code === 'KeyU' && !e.repeat && !e.target.closest?.('input,textarea')) unstick(); });
// a nudge when the player has been on the gas but going nowhere for a few seconds
let stuckT = 0;
setInterval(() => { if (!world.onFoot && world.mode === 'city' && input.forward && Math.abs(car.speed) < 0.4 && !fuel.noFuelNow?.() && !car.noFuel) { stuckT++; if (stuckT === 4) world.toast('Stuck? Press U (or the ⟲ button) to reset the car onto the road'); } else stuckT = 0; }, 1000);
camPanel.innerHTML = '<div class="seg">' + CAM_MODES.map(([k, n]) => `<button data-m="${k}">${n}</button>`).join('') + '</div>' +
  '<div class="tune"><label>Distance <b class="vd"></b></label><input type="range" data-k="camDist" min="4" max="18" step="0.5"><label>Height <b class="vh"></b></label><input type="range" data-k="camHeight" min="1.5" max="11" step="0.25"></div>' +
  '<div class="tune in"><label>Seat back <b class="ib"></b></label><input type="range" data-k="camInBack" min="0" max="1" step="0.05"><label>Eye height <b class="iu"></b></label><input type="range" data-k="camInUp" min="-0.1" max="0.35" step="0.01"></div>';
function camSync() {
  camPanel.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.m === camRig.mode));
  camPanel.querySelector('.tune:not(.in)').style.display = camRig.mode === 'chase' || camRig.mode === 'top' ? '' : 'none';
  camPanel.querySelector('.tune.in').style.display = camRig.mode === 'inside' ? '' : 'none';
  camPanel.querySelector('.ib').textContent = (+(settings.camInBack ?? 0.5)).toFixed(2); camPanel.querySelector('.iu').textContent = (+(settings.camInUp ?? 0.08)).toFixed(2);
  camPanel.querySelector('[data-k=camInBack]').value = settings.camInBack ?? 0.5; camPanel.querySelector('[data-k=camInUp]').value = settings.camInUp ?? 0.08;
  camPanel.querySelector('.vd').textContent = (+settings.camDist).toFixed(1); camPanel.querySelector('.vh').textContent = (+settings.camHeight).toFixed(1);
  camPanel.querySelector('[data-k=camDist]').value = settings.camDist; camPanel.querySelector('[data-k=camHeight]').value = settings.camHeight;
  camPanel.querySelector('[data-k=camDist]').disabled = camRig.mode !== 'chase';
}
camBtn.addEventListener('click', () => { camPanel.style.display = camPanel.style.display === 'block' ? 'none' : 'block'; camSync(); camBtn.blur(); });
camPanel.addEventListener('click', e => { const b = e.target.closest('button[data-m]'); if (b) camRig.setMode(b.dataset.m); });
camPanel.addEventListener('input', e => { const k = e.target.dataset.k; if (!k) return; settings[k] = Number(e.target.value); saveSettings(settings); applySetting(k, settings[k]); camSync(); });
addEventListener('keydown', e => { if (e.code === 'KeyV' && !e.repeat && !world.onFoot && !e.target.closest?.('input,textarea')) { camRig.cycle(); world.toast('Camera: ' + CAM_MODES.find(x => x[0] === camRig.mode)[1]); } });
// clicking a dash button from inside the car
renderer.domElement.addEventListener('pointerdown', e => {
  if (camRig.mode !== 'inside' || world.onFoot) return;
  const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const rc = new THREE.Raycaster(); rc.setFromCamera(v, camera);
  const hit = rc.intersectObjects(interior.buttons, false)[0];
  if (hit && input.toggle) input.toggle(hit.object.userData.key);
});

// apply the saved settings
['traffic', 'peds', 'fog', 'rain', 'snow', 'car', 'tex', 'res', 'view', 'fps', 'swapSticks'].forEach(k => applySetting(k, settings[k]));
camRig.setMode(settings.camMode || 'chase'); refreshCamOffset();
env.setHour(settings.hour, true);
env.apply();
dayBtn.textContent = env.nightK > 0.5 ? '🌙' : '☀️';
syncLights();

// --- dashboard: speed, gear, rev bar (green low, orange mid, red over-revving) ---------------------
await tick('Tuning the engine...', 0.97);
const drive = createDrivetrain();
const dashStyle = document.createElement('style');
dashStyle.textContent = `#dash { position: fixed; right: 16px; bottom: 16px; z-index: 6; width: 210px; padding: 10px 14px 12px; border-radius: 16px; background: rgba(10,14,22,.66); color: #fff; font-family: ui-monospace, monospace; pointer-events: none; backdrop-filter: blur(3px); }
  #dash .row { display: flex; align-items: baseline; justify-content: space-between; }
  #dash .spd { font-size: 44px; font-weight: 800; line-height: 1; letter-spacing: -1px; } #dash .unit { font-size: 12px; color: #9fb0c6; margin-left: 4px; }
  #dash .gear { font-size: 34px; font-weight: 800; color: #ffd21f; min-width: 30px; text-align: right; }
  #dash .bar { position: relative; height: 10px; margin-top: 8px; border-radius: 6px; overflow: hidden; background: rgba(255,255,255,.12); }
  #dash .fill { position: absolute; inset: 0 auto 0 0; width: 0; background: linear-gradient(90deg, #2ee66b 0%, #2ee66b 45%, #ffa51f 68%, #ff3b30 88%, #ff3b30 100%); background-size: 210px 100%; }
  #dash .ticks { position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 18px, rgba(0,0,0,.35) 18px 20px); }
  #dash.h0 .bar { display: none; } #dash.h0 { width: 150px; } #dash.h0 .spd { font-size: 34px; } #dash.h0 .gear { font-size: 24px; }
  #dash.h1, #dash.h2 { background: linear-gradient(180deg, rgba(0,18,30,.8), rgba(0,8,16,.85)); border: 1px solid #1fd2ff; box-shadow: 0 0 14px rgba(31,210,255,.55), inset 0 0 10px rgba(31,210,255,.18); }
  #dash.h1 .spd, #dash.h2 .spd { color: #7df; text-shadow: 0 0 10px #0af; } #dash.h1 .ticks, #dash.h2 .ticks { background: repeating-linear-gradient(90deg, transparent 0 8px, rgba(0,0,0,.7) 8px 10px); }
  #dash.h2 { border-color: #ffd21f; box-shadow: 0 0 16px rgba(255,210,31,.55), inset 0 0 10px rgba(255,210,31,.15); }
  html.touch #dash { bottom: 150px; right: 10px; transform: scale(.85); transform-origin: bottom right; }`;
document.head.appendChild(dashStyle);
const dash = document.createElement('div'); dash.id = 'dash';
dash.innerHTML = '<div class="row"><div><span class="spd">0</span><span class="unit">km/h</span></div><div class="gear">N</div></div><div class="bar"><div class="fill"></div><div class="ticks"></div></div>';
document.body.appendChild(dash);
const dashSpd = dash.querySelector('.spd'), dashGear = dash.querySelector('.gear'), dashFill = dash.querySelector('.fill');
let dashShown = '', dashLvl = -1;
function dashFrame(dt, rev) {
  const hl = world.hudLevel(); if (hl !== dashLvl) { dashLvl = hl; dash.className = 'h' + hl; }
  const kmh = Math.round(Math.hypot(car.vx || 0, car.vz || 0) * KMH_PER_U);
  if (dashSpd.textContent !== String(kmh)) dashSpd.textContent = kmh;
  const g = String(rev.gear); if (dashGear.textContent !== g) dashGear.textContent = g;
  dashFill.style.width = Math.round(Math.max(0, (rev.r - 0.1) / 0.9) * 100) + '%';
  dashGear.style.color = rev.r > 0.88 ? '#ff3b30' : '#ffd21f';
}

// --- sound ---------------------------------------------------------------------------------
const skids = createSkidMarks({ scene, heightAt: world.heightAt });
const puffs = createPuffs({ scene, heightAt: world.heightAt, renderer });
const audio = createAudio({ camera });
const drawbridge = createDrawbridge({ city, scene, collisionWorld, audio, heightAt });
const radio = createRadio({ audio, weather, settings });
const unlockAudio = () => audio.unlock();
['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, unlockAudio, { passive: true }));
audio.setEnabled(settings.sound !== false); audio.setVolume(settings.volume ?? 0.7);
const HEAVY_TYPES = { bus: 2, truck: 2, van: 1, pickup: 1 };
// Cab stands: stop the car (any car) on a painted TAXI bay for a moment to start - or end - a taxi shift.
let standT = 0, standLock = false, standHint = null;
function standFrame(dt) {
  if (world.onFoot || world.mode !== 'city') { standT = 0; return; }
  const s = transit.stands.find(q => Math.hypot(car.x - q.x, car.z - q.z) < 3.8);
  if (!s) { standT = 0; standLock = false; return; }
  if (Math.abs(car.speed) > 1.0) { standT = 0; return; }
  if (standLock) return;
  standT += dt;
  if (standT > 1.2) {
    standLock = true;
    const on = !taxi.active;
    taxi.setEnabled(on, car);
    world.toast(on ? 'Taxi shift started - passengers will call you' : 'Taxi shift ended');
  }
}

// Speed feel: the field of view opens up and a radial blur grows with speed, impacts shake the picture; the grade pass also gets the sun.
let fxShake = 0, fxPrevImp = 0, fxHitCool = 0, fxSp = 0, baseFov = camera.fov, fxClock = 0;
const _sd = new THREE.Vector3();
function fxFrame(dt) {
  fxClock += dt;
  const kmh = world.onFoot ? 0 : Math.hypot(car.vx, car.vz) * KMH_PER_U;
  const target = Math.max(0, Math.min(1, (kmh - 110) / 190));
  fxSp += (target - fxSp) * Math.min(1, dt * 2.2);
  // shake only at the moment of a crash: one kick per new impact (impactSpeed lingers while you stay in contact), gone in ~0.4 s
  const imp = car.impactSpeed || 0;
  fxHitCool -= dt;
  if (imp > 3.5 && fxPrevImp < 1.5 && fxHitCool <= 0) { fxShake = Math.min(1.3, imp / 14); fxHitCool = 0.8; }
  fxPrevImp = imp;
  fxShake *= Math.exp(-dt * 9); if (fxShake < 0.02) fxShake = 0;
  const fov = baseFov + 13 * fxSp * (settings.fx === false ? 0 : 1);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  _sd.copy(env.sunOffset).normalize();
  gfx.frame({ time: fxClock, speed: fxSp, sunDir: _sd, sunAmt: (1 - env.nightK) * (1 - Math.min(1, env.wetness * 1.2)) * (world.mode === 'city' ? 1 : 0), sunCol: sun.color, shake: fxShake, wet: env.wetness, nightK: env.nightK });
}

// entering a district shows its name for a moment
const distEl = document.createElement('div'); distEl.id = 'district';
distEl.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:6;font:800 20px system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#fff;text-shadow:0 0 12px currentColor,0 2px 4px #000;opacity:0;transition:opacity .8s;pointer-events:none;text-align:center';
document.body.appendChild(distEl);
let distName = null, distT = 0, distHide = 0;
function districtFrame(dt) {
  distT -= dt; if (distHide > 0) { distHide -= dt; if (distHide <= 0) distEl.style.opacity = '0'; }
  if (distT > 0) return; distT = 0.6;
  const px = world.onFoot ? camera.position.x : car.x, pz = world.onFoot ? camera.position.z : car.z;
  if (world.mode !== 'city' || Math.abs(px) > 3000) { if (distName) { distName = null; distEl.style.opacity = '0'; } return; }
  const d = (city.districts || []).find(q => pointInPoly(px, pz, q.poly)) || null, name = d ? d.name : null;
  if (name === distName) return;
  distName = name;
  if (d) { distEl.style.color = d.color; distEl.innerHTML = d.name + '<div style="font:600 11px system-ui;letter-spacing:.12em;opacity:.85">' + d.blurb + '</div>'; distEl.style.opacity = '1'; distHide = 3.5; }
}
function audioFrame(dt) {
  const thr = (input.forward ? 1 : 0) * (input.throttle == null ? 1 : Math.max(0.3, input.throttle));
  const rev = drive.update(dt, car, world.onFoot ? 0 : thr, world.onFoot);
  lastRev = rev; car.accelMul = rev.manual ? rev.accelMul : 1;
  dashFrame(dt, rev);
  {
    const inside = camRig.mode === 'inside' && !world.onFoot;
    if (interior.root.visible !== inside) { interior.setVisible(inside); if (car.model) car.model.visible = !inside; document.body.classList.toggle('cam-inside', inside); if (inside) interior.fit(); }
    if (inside) interior.update(dt, { kmh: Math.hypot(car.vx || 0, car.vz || 0) * KMH_PER_U, maxKmh: car.maxSpeed * KMH_PER_U, rpm: rev.r, gear: rev.gear, fuel: fuel.level(),
      blinkL: car.blinkers.frontLeft.material.emissiveIntensity > 0.5, blinkR: car.blinkers.frontRight.material.emissiveIntensity > 0.5, lights: !!input.lightsOn, lit: !!input.lightsOn || env.nightK > 0.5 });
  }
  dash.style.display = world.onFoot ? 'none' : 'block';
  const ev = traffic.events.splice(0);
  ev.forEach(e => e.t === 'crash' ? audio.crash(e.x, e.z, e.power) : e.t === 'hiss' ? audio.airBrake && audio.airBrake(e.x, e.z) : audio.honk(e.x, e.z, HEAVY_TYPES[e.type] || 0, null, e.seed));
  const x = camera.position.x;
  const covered = isCovered(world.onFoot ? camera.position.x : x, world.onFoot ? camera.position.y - 1.5 : car.y, world.mode);
  env.setCovered(covered);
  const gk = heightAt && heightAt.kind;
  // what the soundscape needs to know: where we are, how busy the street is, who is running a siren
  audioT -= dt;
  if (audioT <= 0) {
    audioT = 0.25;
    const cx = camera.position.x, cz = camera.position.z;
    let nc = 0, np = 0;
    traffic.cars.forEach(c => { if (c.active && !c.svc && Math.abs(c.mesh.position.x - cx) < 90 && Math.abs(c.mesh.position.z - cz) < 90) nc++; });
    pedestrians.peds.forEach(p => { if (p.active && Math.abs(p.mesh.position.x - cx) < 40 && Math.abs(p.mesh.position.z - cz) < 40) np++; });
    audioCtx.density = Math.min(1, nc / 16); audioCtx.crowd = Math.min(1, np / 20);
    audioCtx.sirens = traffic.svcCars.filter(c => c.active && c.siren && c.svc !== 'plow');
  }
  const place = world.mode === 'garage' ? 'garage' : world.mode === 'flat' ? 'flat' : (covered ? 'tunnel' : 'open');
  audio.update(dt, { rev, car, input, onFoot: world.onFoot, wet: env.wetness, rain: settings.rain, snow: settings.snow && env.snowAccumulation > 0.15, covered,
    surface: car.surface, cars: traffic.cars, paused: false, place, hour: settings.hour, ...audioCtx });
  radio.update(dt, { place, onFoot: world.onFoot, dFoot: world.onFoot ? Math.hypot(camera.position.x - car.x, camera.position.z - car.z) : 0 });
  if ((car.impactSpeed || 0) > 2.5 && !car._crashHeard) { audio.crash(car.x, car.z, Math.min(1, car.impactSpeed / 14)); car._crashHeard = true; }
  else if ((car.impactSpeed || 0) <= 0.01) car._crashHeard = false;
}

let fpsFrames = 0, fpsT = 0, plowT = 0, audioT = 0;
const audioCtx = { density: 0, crowd: 0, sirens: [] };
function animate() {
  const rawDt = clock.getDelta();
  input.poll(world.onFoot);
  const dt = Math.min(0.1, rawDt);   // slow frames no longer run the game in slow motion
  fpsFrames++; fpsT += rawDt;
  if (fpsT >= 0.5) { fpsEl.textContent = Math.round(fpsFrames / fpsT) + ' FPS'; fpsFrames = 0; fpsT = 0; }
  env.update(dt, camera.position);
  // View distance: scale the fog and cut the camera's far plane just beyond it, so geometry
  // that fog would hide anyway isn't drawn at all.
  scene.fog.near *= viewMul; scene.fog.far *= viewMul;
  const wantFar = Math.max(80, scene.fog.far + 25);
  if (Math.abs(camera.far - wantFar) > 2) { camera.far = wantFar; camera.updateProjectionMatrix(); }
  syncLights();
  if (paused) {
    audio.update(dt, { car, input, onFoot: true, paused: true });
    // game is paused behind the menu; keep rendering so time/weather changes show live
    gfx.render();
    requestAnimationFrame(animate);
    return;
  }

  if (minimap.isFullOpen()) {
    // whole-city map: the world holds still
    const fx = world.focus();
    minimap.drawFull(fx, [], mapExtras(true));
    requestAnimationFrame(animate);
    return;
  }

  if (modalPause) {
    // shopping / apartment menu: the world holds still while the camera shows off the car
    world.updateModal(dt);
    // inside a shop the radio keeps playing, with the garage acoustics and no street noise or rain
    distEl.style.opacity = '0'; distName = null;
    if (world.inShop) { env.setCovered(true); radio.update(dt, { place: 'garage', onFoot: false, dFoot: 0 }); }
    gfx.render();
    requestAnimationFrame(animate);
    return;
  }
  world.update(dt);
  audioFrame(dt);
  districtFrame(dt);
  cullProps(dt);
  weather.update(dt);
  // snowploughs: out while it snows and until the road is clear again; each one clears a strip of snow and throws spray + salt
  plowT -= dt; if (plowT <= 0) { plowT = 1; traffic.setPlows(!!settings.snow || env.snowAccumulation > 0.12); }
  const working = traffic.svcCars.filter(c => c.type === 'plow' && c.active && c.plowing);
  if (working.length) {
    working.forEach(c => { if (c.speed > 0.5) { const m = c.mesh.position, h = c.mesh.rotation.y, rx = Math.cos(h), rz = -Math.sin(h); [-1.6, 0, 1.6].forEach(o => env.clearSnow(m.x + rx * o, m.z + rz * o, 3.2)); } });
  }
  plowFx.update(dt, working, camera.position, env.snowAccumulation > 0.04 || !!settings.snow);
  skids.update(dt, car, { snow: env.snowAccumulation, onFoot: world.onFoot, allow: world.mode === 'city' });
  puffs.update(dt, car, { sliding: skids.sliding, snow: env.snowAccumulation, wet: env.wetness, onFoot: world.onFoot, allow: world.mode === 'city', covered: env.isCovered, raining: !!settings.rain });
  const focus = world.focus();

  if (sinking) {
    sinkTimer += dt;
    // Water drag: the car keeps drifting on whatever heading/speed it went in with,
    // just losing speed fast (not instantly) rather than freezing on the spot.
    car.speed *= Math.max(0, 1 - 3 * dt);
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
    car.y -= dt * 1.4;
    car.pitch += (0.2 - car.pitch) * Math.min(1, dt * 1.2); // nose dips as it goes under
    car.roll += (Math.PI / 2 - car.roll) * Math.min(1, dt * 1.2); // then keels over
    car.group.position.set(car.x, car.y, car.z);
    car.group.rotation.set(car.pitch, car.heading, car.roll);
    if (sinkTimer >= SINK_DURATION) respawnCar();
  } else {
    // long frames are split so the car never moves more than ~1m per physics step
    car.grip = car.y < -1.5 ? 1 : env.grip;   // tunnels stay dry
    const steps = Math.max(1, Math.ceil(dt / 0.025));
    const pre = [];
    for (let i = 0; i < steps; i++) {
      world.beforeCar(dt / steps);
      car.update(dt / steps, (world.onFoot || races.frozen()) ? world.parkedInput(input) : input, world.heightAt);
      if (steps > 1) pre.push(...resolveCarCollisions(car, collisionWorld, dt / steps));
    }
    drawbridge.update(dt, camera);
    traffic.update(dt, hail.following() ? hail.proxy : car, world.onFoot && world.mode === 'city' ? world.focus() : null);
    if (traffic.walkerHit.on) world.shoveFoot(traffic.walkerHit.vx, traffic.walkerHit.vz);
    parkedCars.update(dt, car.x, car.z);
    races.update(dt);
    fuel.update(dt); harbour.update(dt); hail.update(dt, !races.active());
    taxi.update(dt, car);
    standFrame(dt);
    updateTrafficLights();
    updateReflectors(focus);
    updateLampLights(focus);
    sun.position.set(focus.x + env.sunOffset.x, env.sunOffset.y, focus.z + env.sunOffset.z);
    sun.target.position.set(focus.x, 0, focus.z);

    const destroyed = pre.concat(resolveCarCollisions(car, collisionWorld, dt));
    car.group.position.set(car.x, car.y, car.z); // re-sync after any collision push-back
    destroyed.forEach(c => {
      const inst = c.instance, mesh = inst.mesh;
      if (c.spray) sprays.add(mesh.position.x, mesh.position.y + 0.1, mesh.position.z);
      if (c.destroy === 'burst') {
        mesh.visible = false;
        spawnLeaves(scene, mesh.position.x, mesh.position.y, mesh.position.z, Math.sin(car.heading) * (Math.sign(car.speed) || 1), Math.cos(car.heading) * (Math.sign(car.speed) || 1), Math.abs(car.speed));
        return;
      }
      if (c.destroy === 'debris') {
        mesh.visible = false;
        spawnDebris(scene, mesh.position.x, mesh.position.y + 0.3, mesh.position.z, c.debrisColor, 6);
        return;
      }
      // fall the way the car was travelling (nudged away from the car), not a fixed way
      const sgn = Math.sign(car.speed) || 1;
      const fx = Math.sin(car.heading) * sgn, fz = Math.cos(car.heading) * sgn;
      const ax = mesh.position.x - car.x, az = mesh.position.z - car.z, al = Math.hypot(ax, az) || 1;
      const dx = fx + 0.35 * ax / al, dz = fz + 0.35 * az / al;
      if (inst.type === 'light') lampOff(inst);
      if (c.destroy === 'break') { breakTrafficLightInst(inst); destruction.breakTrafficLight(mesh, dx, dz, car.speed); }
      else destruction.topple(mesh, dx, dz, c.fall, { speed: Math.max(Math.abs(car.speed), c.breakSpeed || 0) / Math.max(0.3, 1 - (c.speedPenalty || 0)), carMass: car.mass, mass: c.mass });
    });
    destruction.update(dt, car);
    sprays.update(dt);
    updateEffects(dt);
    pedestrians.update(dt, hail.following() ? hail.proxy : car);
    shopLots.update(dt, car);
    updateWrongWay();

    if (isCarInWater()) {
      races.abort('Race over - you fell in the water');
      sinking = true;
      sinkTimer = 0;
      splashEl.textContent = 'Sleep with the fishes';
      splashEl.style.display = 'flex';
    }

    speedEl.textContent = Math.round(Math.hypot(car.vx, car.vz) * KMH_PER_U) + ' km/h · ' + (world.carClassInfo ? world.carClassInfo().cls : '') + (car.grip < 0.8 ? (car.grip < 0.55 ? ' ❄ icy' : ' 💧 wet') : '');
  }

  if (!window.__freeCam) { if (hail.cabCam()) hail.updateCamera(dt); else if (world.onFoot) world.updateCamera(dt); else camRig.update(dt, camBlocked); }
  minimap.update(focus, [], mapExtras(false));
  fxFrame(dt);
  gfx.render();
  requestAnimationFrame(animate);
}
window.__game = { shopLots, drawbridge, hail, camRig, interior, fuel, radio, weather, plowFx, puffs, gfx, transit, parkedCars, skids, audio, races, structures, world, renderer, taxi, input, destruction, collisionWorld, lampDefs, signs, propInstances, env, settings, menu, minimap, scene, camera, car, city, traffic, pedestrians, lampPool, reflectors, heightAt, offences: { get wrongWay() { return wrongWayOffences; } } };
loadingDone();
animate();
