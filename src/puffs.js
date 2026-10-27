// Particles: tyre smoke while the wheels slide, and sparks when the car hits something hard.
// Two pooled Points clouds (smoke = normal blending, sparks = additive and over-bright so bloom makes them glow).
import * as THREE from 'three';

function makePool(scene, max, additive, renderer) {
  const pos = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max), col = new Float32Array(max * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 }, uSoft: { value: additive ? 0.0 : 1.0 } },
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
    vertexShader: 'attribute float aSize; attribute float aAlpha; attribute vec3 aCol; varying float vA; varying vec3 vC; uniform float uScale; void main(){ vA = aAlpha; vC = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(0.5, -mv.z); }',
    fragmentShader: 'varying float vA; varying vec3 vC; uniform float uSoft; void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(uSoft > 0.5 ? 0.12 : 0.15, 0.5, d); if (a < 0.01) discard; gl_FragColor = vec4(vC, a * vA); }'
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 4; scene.add(pts);
  const P = Array.from({ length: max }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, a: 1, r: 1, g: 1, b: 1, grow: 0, drag: 1, grav: 0 }));
  let head = 0;
  return {
    mat,
    emit(o) { const p = P[head]; head = (head + 1) % max; Object.assign(p, { life: o.life, max: o.life, drag: 1, grav: 0, grow: 0 }, o); },
    update(dt, scale) {
      mat.uniforms.uScale.value = scale;
      for (let i = 0; i < max; i++) {
        const p = P[i];
        if (p.life <= 0) { alpha[i] = 0; size[i] = 0; continue; }
        p.life -= dt; const k = 1 - Math.max(0, p.life) / p.max;
        p.vy -= p.grav * dt; const d = Math.pow(p.drag, dt * 60); p.vx *= d; p.vz *= d; p.vy *= (p.grav ? 1 : d);
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        size[i] = p.s0 + (p.s1 - p.s0) * k;
        alpha[i] = p.a * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
        col[i * 3] = p.r; col[i * 3 + 1] = p.g; col[i * 3 + 2] = p.b;
      }
      geo.attributes.position.needsUpdate = geo.attributes.aSize.needsUpdate = geo.attributes.aAlpha.needsUpdate = geo.attributes.aCol.needsUpdate = true;
    }
  };
}

// same blotchy noise the road shader uses for its rain puddles (environment.js), so spray appears exactly where a puddle is drawn
const h21 = (x, y) => { let a = (x * 0.1031) % 1, b = (y * 0.1031) % 1, c = (x * 0.1031) % 1; if (a < 0) a += 1; if (b < 0) b += 1; if (c < 0) c += 1;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d; const r = (a + b) * c; return r - Math.floor(r); };
const vnoise = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h21(ix, iy), b = h21(ix + 1, iy), c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function puddleAt(x, z, wet) {
  if (wet <= 0.25) return 0;
  const n = vnoise(x * 0.16, z * 0.16) * 0.6 + vnoise(x * 0.45 + 9, z * 0.45 + 9) * 0.4;
  return sstep(0.62 - 0.12 * wet, 0.7 - 0.1 * wet, n) * sstep(0.25, 0.8, wet);
}

export function createPuffs({ scene, heightAt, renderer }) {
  const smoke = makePool(scene, 420, false), sparks = makePool(scene, 120, true);
  let acc = 0, prevImpact = 0, scrapeAcc = 0, splashAcc = 0, powderAcc = 0;
  const rnd = () => Math.random() - 0.5;
  return {
    update(dt, car, { sliding = false, snow = 0, wet = 0, onFoot = false, allow = true, covered = false, raining = false } = {}) {
      const scale = (renderer.domElement.height || 600) * 0.9;
      if (allow && !onFoot) {
        const sh = Math.sin(car.heading), ch = Math.cos(car.heading);
        const speed = Math.hypot(car.vx || 0, car.vz || 0);
        if (sliding && snow < 0.3) {
          acc += dt * 85;
          while (acc >= 1) {
            acc -= 1;
            const lx = (Math.random() < 0.5 ? 0.85 : -0.85), lz = -1.25;
            const x = car.x + sh * lz + ch * lx, z = car.z + ch * lz - sh * lx, y = heightAt(x, z, car.y) + 0.2;
            const g = 0.97 - 0.2 * wet;
            smoke.emit({ x, y, z, vx: (car.vx || 0) * 0.25 + rnd() * 0.8, vy: 0.7 + Math.random() * 1.0, vz: (car.vz || 0) * 0.25 + rnd() * 0.8, life: 1.5 + Math.random() * 1.0, s0: 0.9, s1: 4.2 + Math.random() * 1.6, a: 0.62, r: g, g: g, b: g * 1.02, drag: 0.985 });
          }
        }
        // spray: wheels throwing water out of puddles, and powder kicked up off snow-covered road
        const mph = speed;
        if (!covered && mph > 3.5 && !car.airborne) {
          const lat = (car.vx || 0) * ch - (car.vz || 0) * sh;
          if (raining || wet > 0.25) {
            const pm = puddleAt(car.x, car.z, wet);
            if (pm > 0.25) {
              splashAcc += dt * Math.min(200, 26 * mph) * pm;
              while (splashAcc >= 1) {
                splashAcc -= 1;
                const side = Math.random() < 0.5 ? 1 : -1, lz = Math.random() < 0.6 ? 1.3 : -1.3, lx = 0.95 * side;
                const x = car.x + sh * lz + ch * lx, z = car.z + ch * lz - sh * lx, y = heightAt(x, z, car.y) + 0.15;
                const out = (1.2 + Math.random() * 2.0) * side;
                smoke.emit({ x, y, z, vx: (car.vx || 0) * 0.5 + ch * out + rnd() * 0.8, vy: 1.4 + Math.random() * 2.0, vz: (car.vz || 0) * 0.5 - sh * out + rnd() * 0.8, life: 0.3 + Math.random() * 0.25, s0: 0.07, s1: 0.2 + Math.random() * 0.12, a: 0.38, r: 0.5, g: 0.54, b: 0.58, drag: 0.97, grav: 24 });
              }
            }
          }
          if (snow > 0.2) {
            // snow flung sideways off the tyres: small flakes thrown out to either side in a low arc that fall back to the road
            powderAcc += dt * Math.min(150, 12 * mph) * Math.min(1, snow * 1.3);
            while (powderAcc >= 1) {
              powderAcc -= 1;
              const side = Math.random() < 0.5 ? 1 : -1, lz = (Math.random() < 0.7 ? -1.2 : 1.2) + rnd() * 0.3, lx = 0.95 * side;
              const x = car.x + sh * lz + ch * lx, z = car.z + ch * lz - sh * lx, y = heightAt(x, z, car.y) + 0.12;
              const out = side * (2.2 + Math.random() * 3.2 + Math.min(2.5, mph * 0.06));
              smoke.emit({ x, y, z, vx: (car.vx || 0) * 0.55 + ch * out + rnd() * 0.5, vy: 0.7 + Math.random() * 1.5, vz: (car.vz || 0) * 0.55 - sh * out + rnd() * 0.5, life: 0.45 + Math.random() * 0.4, s0: 0.1, s1: 0.2 + Math.random() * 0.14, a: 0.42, r: 0.9, g: 0.93, b: 0.97, drag: 0.985, grav: 7 });
            }
          }
        }
        // sparks: a hard hit, or grinding along something at speed
        const imp = car.impactSpeed || 0;
        if (imp > 2.5 && prevImpact <= 2.5) {
          const n = Math.min(26, 8 + imp * 2);
          for (let i = 0; i < n; i++) {
            const a = car.heading + rnd() * 2.2, v = 3 + Math.random() * 7;
            sparks.emit({ x: car.x + sh * 1.8, y: car.y + 0.45, z: car.z + ch * 1.8, vx: Math.sin(a) * v, vy: 1.5 + Math.random() * 4, vz: Math.cos(a) * v, life: 0.35 + Math.random() * 0.45, s0: 0.1, s1: 0.04, a: 1, r: 3.2, g: 1.7, b: 0.5, grav: 14 });
          }
        }
        prevImpact = imp;
        if (car.scraping && speed > 5) {
          scrapeAcc += dt * 40;
          while (scrapeAcc >= 1) { scrapeAcc -= 1; sparks.emit({ x: car.x + sh * 0.5 + ch * 0.9 * (car.scrapeSide || 1), y: car.y + 0.3, z: car.z + ch * 0.5 - sh * 0.9 * (car.scrapeSide || 1), vx: (car.vx || 0) * 0.3 + rnd() * 3, vy: 1 + Math.random() * 2, vz: (car.vz || 0) * 0.3 + rnd() * 3, life: 0.3 + Math.random() * 0.3, s0: 0.09, s1: 0.03, a: 1, r: 3, g: 1.6, b: 0.5, grav: 12 }); }
        }
      }
      smoke.update(dt, scale); sparks.update(dt, scale);
    }
  };
}
