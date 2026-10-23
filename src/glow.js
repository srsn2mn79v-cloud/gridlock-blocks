// Cheap "light on the ground" and "light halo" effects: additive-blended, unlit quads and
// sprites with a soft radial falloff. A real THREE.Light costs every pixel of every lit
// material in the scene something, whether or not it's near that light, so giving every
// brake light, indicator and AI headlight its own real light would tank frame rate (worst
// on phones). These fake the *look* of light spilling onto the road instead — a coloured
// pool that brightens and fades — at the cost of one transparent quad each.
import * as THREE from 'three';

let _tex = null;
function glowTexture() {
  if (_tex) return _tex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  _tex = new THREE.CanvasTexture(c);
  return _tex;
}

// A flat pool of coloured light lying on the ground (child it to a car group, a lamp,
// whatever). `width` runs across, `depth` along the local z axis, so an elongated pool
// ahead of a headlight is just a bigger depth. Set its brightness with setGlow(mesh, v).
export function createGroundGlow(color, width, depth) {
  const mat = new THREE.MeshBasicMaterial({
    map: glowTexture(), color, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}

// A camera-facing halo — the bloom around a lit signal lens, readable from far away.
export function createHalo(color, size) {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  s.visible = false;
  return s;
}

// Ground light pools only read at night; fade them out as it gets light (main.js sets this).
let _night = 1;
export function setNightFactor(n) { _night = n; }

export function setGlow(mesh, v) {
  v *= _night;
  mesh.material.opacity = Math.max(0, Math.min(1, v));
  mesh.visible = v > 0.01;
}

// A wedge of light that fans out behind/ahead of a lamp: narrow at the lamp, wide and
// fading at the far end — what a tail light or headlight really throws on the road.
// Local +z is "away from the car" for `dir = 1`; use dir = -1 for a rear cone (extends to -z).
let _cone = null;
function coneTexture() {
  if (_cone) return _cone;
  const w = 128, h = 128;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  // canvas top = far end (wide), bottom = at the lamp (narrow)
  const grad = g.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(w * 0.42, h); g.lineTo(w * 0.58, h); g.lineTo(w * 0.98, 0); g.lineTo(w * 0.02, 0);
  g.closePath(); g.fill();
  // soften the edges sideways
  g.globalCompositeOperation = 'destination-in';
  const side = g.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, 'rgba(255,255,255,0.15)'); side.addColorStop(0.25, 'rgba(255,255,255,1)');
  side.addColorStop(0.75, 'rgba(255,255,255,1)'); side.addColorStop(1, 'rgba(255,255,255,0.15)');
  g.fillStyle = side; g.fillRect(0, 0, w, h);
  _cone = new THREE.CanvasTexture(c);
  return _cone;
}

// `length` = how far the cone reaches, `width` = its width at the far end. The returned
// mesh's origin is the lamp: put it where the light sits and it fans out along -z (rear).
export function createGroundCone(color, width, length) {
  const mat = new THREE.MeshBasicMaterial({
    map: coneTexture(), color, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  const geo = new THREE.PlaneGeometry(width, length);
  geo.translate(0, length / 2, 0); // lamp end at the origin
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2; // plane +y -> world -z (behind the car)
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}

// Two separate red lobes thrown behind a car, one per tail lamp: a hot spot right behind
// each lamp that stretches into a soft, widening, fading streak, with a faint shared wash
// where they overlap. Plane origin = the rear of the car; lobes fan out along -z.
// `lampX` = lateral offset of each lamp from the centre, `width` = plane width.
let _tail = null;
function tailTexture(lampFrac) {
  if (_tail) return _tail;
  const w = 256, h = 256;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  [0.5 - lampFrac, 0.5 + lampFrac].forEach((cx, side) => {
    const dir = side === 0 ? -1 : 1;
    const steps = 28;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);                 // 0 at the lamp, 1 at the far end
      const y = h - 6 - t * (h - 12);
      const x = cx * w + dir * t * w * 0.04;     // lobes drift slightly outward
      const rx = w * (0.035 + 0.07 * t), ry = h * 0.05;
      const a = 0.9 * Math.pow(1 - t, 1.6) + 0.02;
      g.save();
      g.translate(x, y); g.scale(rx / ry, 1);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, ry, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  });
  _tail = new THREE.CanvasTexture(c);
  return _tail;
}

export function createTailLightPattern(color, width, length, lampX) {
  const mat = new THREE.MeshBasicMaterial({
    map: tailTexture(lampX / width), color, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  const geo = new THREE.PlaneGeometry(width, length);
  geo.translate(0, length / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}
