// Time of day, fog, rain and snow. Everything that changes with them is a lerp of a few
// numbers, so none of it rebuilds geometry or recompiles shaders:
//   - time of day: keyframes (hour -> sky/fog colour, sun colour+strength, ambient, how
//     "night" the lamps/ground glows are) interpolated every frame;
//   - fog: just pulls the fog distances in and greys the sky;
//   - rain: a camera-following cloud of falling streaks, darker/wetter roads;
//   - snow: a camera-following cloud of flakes, and a slow ACCUMULATION that whitens the
//     ground, roofs and (less) the roads the longer it keeps snowing, and melts back after.
import { installSnowCap, snowCapU, updateSnowCaps } from './surfaceShaders.js';
import * as THREE from 'three';
import { setNightFactor } from './glow.js';
import { createSky, skyU, skyGLSL } from './sky.js';
import { gfxU, roadDecl, roadVertex, roadFrag } from './surfaceShaders.js';

const C = h => new THREE.Color(h);
// hour, sky/fog colour, fog near, fog far, ambient strength, ambient sky, ambient ground,
// sun strength, sun colour, night (0..1: how much lamps/glows show)
const KEYS = [
  [0,    C(0x0b0f14), 60, 260, 0.09, C(0x8fa6c9), C(0x1a1410), 0.12, C(0xaebbd9), 1],
  [5,    C(0x0b0f14), 60, 260, 0.09, C(0x8fa6c9), C(0x1a1410), 0.12, C(0xaebbd9), 1],
  [6.2,  C(0xe3946a), 70, 330, 0.34, C(0xf0b090), C(0x3a2c26), 0.42, C(0xff9b5e), 0.65],
  [7.6,  C(0xa8cde6), 100, 460, 0.75, C(0xdbe8f5), C(0x6a685f), 1.0, C(0xffe2b8), 0.12],
  [11,   C(0x8cc4ec), 120, 560, 1.04, C(0xcfe4ff), C(0x77756b), 1.6, C(0xfff0d8), 0],
  [16.5, C(0x8cc4ec), 120, 560, 1.04, C(0xcfe4ff), C(0x77756b), 1.5, C(0xfff0d8), 0],
  [18.2, C(0xf29c60), 90, 420, 0.62, C(0xffc9a0), C(0x4a3a2e), 0.95, C(0xff9a4d), 0.3],
  [19.4, C(0x3a3d66), 70, 320, 0.22, C(0x9aa0d0), C(0x201a20), 0.25, C(0x8a7fb0), 0.85],
  [21,   C(0x0b0f14), 60, 260, 0.09, C(0x8fa6c9), C(0x1a1410), 0.12, C(0xaebbd9), 1],
  [24,   C(0x0b0f14), 60, 260, 0.09, C(0x8fa6c9), C(0x1a1410), 0.12, C(0xaebbd9), 1]
];

const lerp = (a, b, t) => a + (b - a) * t;
const _a = new THREE.Color(), _sunP = new THREE.Vector3();

function sampleKeys(hour) {
  let i = 0;
  while (i < KEYS.length - 2 && hour > KEYS[i + 1][0]) i++;
  const A = KEYS[i], B = KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (hour - A[0]) / (B[0] - A[0])));
  const k = t * t * (3 - 2 * t);
  return {
    bg: new THREE.Color().lerpColors(A[1], B[1], k),
    near: lerp(A[2], B[2], k), far: lerp(A[3], B[3], k),
    hemiI: lerp(A[4], B[4], k),
    hemiSky: new THREE.Color().lerpColors(A[5], B[5], k),
    hemiGnd: new THREE.Color().lerpColors(A[6], B[6], k),
    sunI: lerp(A[7], B[7], k),
    sunC: new THREE.Color().lerpColors(A[8], B[8], k),
    night: lerp(A[9], B[9], k)
  };
}

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export function createEnvironment({ scene, camera, hemi, sun, ground, roadsGroup, parcelGroup, propGroup, onNight }) {
  const state = { hour: 22, targetHour: 22, fog: 0, rain: false, snow: false };
  let rainAmt = 0, snowAmt = 0, wet = 0, snowAcc = 0;
  // Effective intensities: the set amounts above multiplied by slow random gusts, so rain and
  // snow swell and ease off while you drive. Fog wobbles ~+-25% around the chosen value.
  let covered = false, rainEff = 0, snowEff = 0, fogEff = 0, rainPhase = 0, snowPhase = 0, gRain = 1, gSnow = 1;
  const noise = (t, s) => 0.5 + 0.5 * (0.5 * Math.sin(t * 0.21 + s) + 0.3 * Math.sin(t * 0.53 + s * 2.1) + 0.2 * Math.sin(t * 0.09 + s * 3.7));
  const sunOffset = new THREE.Vector3(-40, 60, 30);
  let nightK = 1;
  const sky = createSky(scene), _sd = new THREE.Vector3(); let lastSunC = new THREE.Color(0xfff0d8);

  // --- tintable materials (originals remembered so effects can fade back exactly) -------
  const tint = new Map();
  const remember = (mat, kind) => {
    if (!mat || tint.has(mat) || !mat.color) return;
    if (kind === 'parcel' && mat.color.b - mat.color.r > 0.18) return; // leave water alone
    tint.set(mat, { color: mat.color.clone(), rough: mat.roughness, env: mat.envMapIntensity, kind });
  };
  remember(ground.material, 'ground');
  roadsGroup.traverse(o => { if (o.isMesh && o.userData.isRoadSurface) remember(o.material, 'road'); });
  parcelGroup.traverse(o => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => remember(m, 'parcel'));
  });
  // props collect snow on their up-facing surfaces
  if (propGroup) propGroup.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(installSnowCap); });
  // Snow lying on the road: sparse white dots that appear, hold and fade (the road underneath
  // stays visible). Done in the road material's shader from world position, so it costs no
  // geometry and no extra draw calls; shared uniforms drive all road materials at once.
  const snowU = { uWet: { value: 0 }, uCover: { value: 0 }, uTime: { value: 0 }, uTunnel: { value: [new THREE.Vector4(1, 1, 0, 0), new THREE.Vector4(1, 1, 0, 0), new THREE.Vector4(1, 1, 0, 0), new THREE.Vector4(1, 1, 0, 0)] } };
  // roofed tunnel stretches get no snow (xz boxes, only below ground level)
  (roadsGroup.userData.mapPaths || []).filter(p => p.structure === 'tunnel').slice(0, 4).forEach((p, i) => {
    let x1 = 1e9, z1 = 1e9, x2 = -1e9, z2 = -1e9;
    p.pts.forEach(([x, z]) => { x1 = Math.min(x1, x); x2 = Math.max(x2, x); z1 = Math.min(z1, z); z2 = Math.max(z2, z); });
    const m = p.width / 2 + 1;
    snowU.uTunnel.value[i].set(x1 - m, z1 - m, x2 + m, z2 + m);
  });
  tint.forEach((o, mat) => {
    if (o.kind !== 'road') return;
    mat.onBeforeCompile = shader => {
      shader.uniforms.uCover = snowU.uCover; shader.uniforms.uWet = snowU.uWet; shader.uniforms.uTime = snowU.uTime; shader.uniforms.uTunnel = snowU.uTunnel; shader.uniforms.uQuality = gfxU.uQuality;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSnowW; varying vec3 vGW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvSnowW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' + roadVertex);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          ${roadDecl}
          varying vec3 vSnowW; uniform float uCover; uniform float uWet; uniform float uTime; uniform vec4 uTunnel[4];
          float puddleMask;
          float sh21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
            float a = sh21(i), b = sh21(i+vec2(1.0,0.0)), c = sh21(i+vec2(0.0,1.0)), d = sh21(i+vec2(1.0,1.0));
            return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
          float snowLayer(vec2 w, float scale, float seed, float speed){
            vec2 p = w * scale + seed;
            vec2 id = floor(p), f = fract(p) - 0.5;
            float h = sh21(id), h2 = sh21(id + 17.1), h3 = sh21(id + 3.7);
            vec2 off = (vec2(h2, h3) - 0.5) * 0.45;
            float r = length(f - off);
            float ph = fract(uTime * speed + h * 7.0);
            float life = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.8, 1.0, ph));
            float present = step(h, min(1.0, uCover * 1.5));
            return smoothstep(0.38, 0.12, r * (0.8 + h3 * 0.6)) * life * present;
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          ${roadFrag}
          float inTun = 0.0;
          for (int ti = 0; ti < 4; ti++) {
            vec4 tr = uTunnel[ti];
            if (vSnowW.x > tr.x && vSnowW.x < tr.z && vSnowW.z > tr.y && vSnowW.z < tr.w && vSnowW.y < -0.8) inTun = 1.0;
          }
          if (uCover > 0.001 && inTun < 0.5) {
            float d = max(snowLayer(vSnowW.xz, 1.1, 0.0, 0.022), snowLayer(vSnowW.xz, 2.3, 41.0, 0.035) * 0.85);
            float base = smoothstep(0.1, 0.9, uCover) * (0.35 + 0.25 * vn(vSnowW.xz * 0.7));   // a thin even layer under the drifts
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), clamp(max(d * 0.95, base), 0.0, 0.96));
          }
          // rain puddles: low spots (blotchy noise) go dark and mirror-smooth, the rest only gets damp
          puddleMask = 0.0;
          if (uWet > 0.25 && inTun < 0.5) {
            float n = vn(vSnowW.xz * 0.16) * 0.6 + vn(vSnowW.xz * 0.45 + 9.0) * 0.4;
            puddleMask = smoothstep(0.62 - 0.12 * uWet, 0.7 - 0.1 * uWet, n) * smoothstep(0.25, 0.8, uWet);
            diffuseColor.rgb *= 1.0 - 0.45 * puddleMask;
          }`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.04, puddleMask);');
        Object.assign(shader.uniforms, skyU);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\n' + skyGLSL)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            // wet asphalt mirrors the sky, the sun's glare path and (at night) smears of lit facades and neon
            vec3 rV = normalize(cameraPosition - vSnowW); vec3 rR = reflect(-rV, vec3(0.0, 1.0, 0.0));
            float rF = pow(1.0 - clamp(rV.y, 0.0, 1.0), 3.0) * 0.9 + 0.05;
            float rK = clamp(uWet * 0.75 + puddleMask * 0.9, 0.0, 1.0) * (1.0 - clamp(uCover * 1.6, 0.0, 1.0));
            if (rK > 0.01) {
              vec3 rc = skyBase(rR);
              // the glow of the lit city: soft warm-white streaks (the colour of the street lamps and windows) low over the horizon
              float az = atan(rR.x, rR.z), el = max(rR.y, 0.0);
              float gl = smoothstep(0.42, 0.85, skN(vec2(az * 30.0, 1.7)) * 0.6 + skN(vec2(az * 90.0, 5.3)) * 0.4);
              rc += vec3(1.0, 0.8, 0.55) * gl * (1.0 - smoothstep(0.02, 0.55, el)) * (0.03 + 0.4 * uSkyNight) * 0.4;
              totalEmissiveRadiance += rc * rF * rK * (0.35 + 0.5 * puddleMask);
            }
          }`);
    };
    mat.customProgramCacheKey = () => 'snowroad4';
    mat.needsUpdate = true;
  });
  const SNOW_GROUND = C(0xe8eff5), SNOW_ROAD = C(0xbfc7cf), SNOW_ROOF = C(0xdde5ec);
  function applyTints() {
    tint.forEach((o, mat) => {
      mat.color.copy(o.color);
      if (o.kind === 'ground') {
        mat.color.multiplyScalar(1 - 0.3 * wet);
        mat.color.lerp(SNOW_GROUND, snowAcc * 0.95);
      } else if (o.kind === 'road') {
        mat.color.multiplyScalar(1 - 0.38 * wet);
        mat.color.lerp(SNOW_ROAD, snowAcc * 0.3);   // the dots do most of the work (shader above)
        mat.envMapIntensity = (o.env ?? 0.12) + 0.55 * wet;
        mat.roughness = lerp(o.rough, Math.min(o.rough, 0.62), wet * 0.8);   // damp, not mirror-like: the shine lives in the puddles
      } else {
        mat.color.lerp(SNOW_ROOF, snowAcc * 0.6);
      }
    });
  }

  // --- rain: streaks in a box that follows the camera ------------------------------------
  const RAIN_N = 1500, RAIN_BOX = 46, RAIN_H = 30;
  const rainPos = new Float32Array(RAIN_N * 6);
  const rainSeed = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) {
    rainSeed[i * 3] = (Math.random() - 0.5) * RAIN_BOX * 2;
    rainSeed[i * 3 + 1] = Math.random() * RAIN_H;
    rainSeed[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX * 2;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xb9cfe6, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false; rain.visible = false;
  scene.add(rain);

  // --- snow: flakes drifting down ----------------------------------------------------------
  const SNOW_N = 2400, SNOW_BOX = 40, SNOW_H = 26;
  const snowPos = new Float32Array(SNOW_N * 3);
  const snowSeed = new Float32Array(SNOW_N * 4);
  for (let i = 0; i < SNOW_N; i++) {
    snowSeed[i * 4] = (Math.random() - 0.5) * SNOW_BOX * 2;
    snowSeed[i * 4 + 1] = Math.random() * SNOW_H;
    snowSeed[i * 4 + 2] = (Math.random() - 0.5) * SNOW_BOX * 2;
    snowSeed[i * 4 + 3] = Math.random() * Math.PI * 2;
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.26, map: dotTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false });
  const snow = new THREE.Points(snowGeo, snowMat);
  snow.frustumCulled = false; snow.visible = false;
  scene.add(snow);

  const wrap = (v, size) => ((v % size) + size) % size;
  let t = 0;

  function apply() {
    const base = sampleKeys(state.hour);
    nightK = base.night;
    setNightFactor(nightK);
    const fogK = fogEff, wx = Math.min(1, Math.max(fogK, rainEff * 0.45, snowEff * 0.4));
    const day = 1 - nightK;
    // sky greys out with fog / rain / snow, more so by day
    const grey = _a.setRGB(0.55, 0.58, 0.62).multiplyScalar(0.18 + 0.82 * day);
    const greying = Math.min(1, fogK * 0.85 + rainEff * 0.5 + snowEff * 0.45);
    base.bg.lerp(grey, greying);
    scene.background.copy(base.bg);
    scene.fog.color.copy(base.bg);
    scene.fog.near = lerp(base.near, 3, wx);
    scene.fog.far = lerp(base.far, 80, wx);
    hemi.color.copy(base.hemiSky);
    hemi.groundColor.copy(base.hemiGnd);
    hemi.intensity = base.hemiI * (1 - 0.3 * rainEff - 0.12 * snowEff);
    sun.color.copy(base.sunC); lastSunC.copy(base.sunC);
    sun.intensity = base.sunI * (1 - 0.55 * rainEff - 0.35 * snowEff - 0.3 * fogK);
    // the sun crosses the sky 06:00 -> 18:00; the moon sits at a fixed spot
    const u = (state.hour - 6) / 12;
    const a = Math.PI * Math.max(0, Math.min(1, u));
    const sunPos = _sunP.set(60 * Math.cos(a), Math.max(14, 62 * Math.sin(a)), 30);
    sunOffset.set(-40, 60, 30).lerp(sunPos, 1 - nightK);
    if (onNight) onNight(nightK);
  }

  function update(dt, camPos) {
    // time eases toward its target (a toggle sweeps through dawn/dusk in about a second)
    if (state.hour !== state.targetHour) {
      const step = 14 * dt;
      const d = state.targetHour - state.hour;
      state.hour += Math.sign(d) * Math.min(Math.abs(d), step);
    }
    const rr = state.rain ? 1 : 0, ss = state.snow ? 1 : 0;
    rainAmt += Math.sign(rr - rainAmt) * Math.min(Math.abs(rr - rainAmt), dt * 0.6);
    snowAmt += Math.sign(ss - snowAmt) * Math.min(Math.abs(ss - snowAmt), dt * 0.5);
    // roads dry slowly after rain; snow builds up over ~45 s of snowfall and melts in ~30 s
    wet += Math.sign(rainAmt - wet) * Math.min(Math.abs(rainAmt - wet), dt * (rainAmt > wet ? 0.4 : 0.03));
    snowAcc = Math.max(0, Math.min(1, snowAcc + (state.snow ? dt / 28 : -dt / 40)));
    t += dt;
    gRain = noise(t, 1.3); gSnow = noise(t, 4.1);
    const gFog = 0.75 + 0.5 * noise(t, 7.7);
    rainEff = rainAmt * (0.3 + 0.7 * gRain);
    snowEff = snowAmt * (0.3 + 0.7 * gSnow);
    fogEff = Math.min(1, state.fog * gFog);
    snowCapU.uSnowCap.value = snowAcc; updateSnowCaps(snowAcc);
    snowU.uCover.value = snowAcc; snowU.uWet.value = wet; snowU.uTime.value = t;
    apply();
    applyTints();
    sky.update(camPos, t, { bg: scene.background, nightK, sunDir: _sd.copy(sunOffset).normalize(), sunCol: lastSunC, cloud: Math.min(1, 0.38 + 0.5 * Math.max(rainEff, snowEff) + 0.15 * fogEff), haze: Math.min(1, fogEff * 0.95 + rainEff * 0.25) });

    const underground = camPos.y < -1.2 || covered;
    rain.visible = rainEff > 0.02 && !underground;
    snow.visible = snowEff > 0.02 && !underground;
    // Drops/flakes are fixed in the world and wrapped into a box around the camera, so they
    // stream past as you drive instead of moving rigidly with you.
    if (rain.visible) {
      rainMat.opacity = rainAmt * (0.2 + 0.4 * gRain);
      rainPhase += dt * 30 * (0.85 + 0.3 * gRain);
      const fall = rainPhase;
      const rn = Math.max(100, Math.floor(RAIN_N * (0.2 + 0.8 * gRain)));
      rainGeo.setDrawRange(0, rn * 2);
      for (let i = 0; i < rn; i++) {
        const x = camPos.x + wrap(rainSeed[i * 3] - camPos.x + RAIN_BOX, RAIN_BOX * 2) - RAIN_BOX;
        const z = camPos.z + wrap(rainSeed[i * 3 + 2] - camPos.z + RAIN_BOX, RAIN_BOX * 2) - RAIN_BOX;
        const y = camPos.y - 6 + wrap(rainSeed[i * 3 + 1] - fall, RAIN_H);
        const o = i * 6;
        rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z;
        rainPos[o + 3] = x + 0.25; rainPos[o + 4] = y + 1.0; rainPos[o + 5] = z;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    if (snow.visible) {
      snowMat.opacity = 0.9 * snowAmt;
      snowPhase += dt * 2.4 * (0.8 + 0.5 * gSnow);
      const fall = snowPhase;
      const sn = Math.max(150, Math.floor(SNOW_N * (0.2 + 0.8 * gSnow)));
      snowGeo.setDrawRange(0, sn);
      for (let i = 0; i < sn; i++) {
        const sx = snowSeed[i * 4], sy = snowSeed[i * 4 + 1], sz = snowSeed[i * 4 + 2], ph = snowSeed[i * 4 + 3];
        const x = camPos.x + wrap(sx - camPos.x + SNOW_BOX, SNOW_BOX * 2) - SNOW_BOX;
        const z = camPos.z + wrap(sz - camPos.z + SNOW_BOX, SNOW_BOX * 2) - SNOW_BOX;
        const o = i * 3;
        snowPos[o] = x + Math.sin(t * 0.9 + ph) * 0.6;
        snowPos[o + 1] = camPos.y - 6 + wrap(sy - fall, SNOW_H);
        snowPos[o + 2] = z + Math.cos(t * 0.7 + ph) * 0.6;
      }
      snowGeo.attributes.position.needsUpdate = true;
    }
  }

  return {
    state, sunOffset, update, apply, sky,
    get nightK() { return nightK; },
    get wetness() { return wet; },
    // covered = the camera is inside a garage / flat / tunnel: no precipitation is drawn there
    setCovered(b) { covered = !!b; },
    get isCovered() { return covered; },
    get snowAccumulation() { return snowAcc; },
    // road grip: 1 dry, ~0.7 wet, down to ~0.3 once snow has settled
    get grip() { return Math.max(0.28, 1 - 0.4 * wet - 0.65 * snowAcc); },
    setHour(h, immediate = false) { state.targetHour = Math.max(0, Math.min(24, h)); if (immediate) state.hour = state.targetHour; },
    _forceSnowAccumulation(v) { snowAcc = v; },
    _forceWet(v) { wet = v; },
    setFog(v) { state.fog = Math.max(0, Math.min(1, v)); fogEff = state.fog; },
    setRain(b) { state.rain = !!b; if (b) state.snow = false; },
    setSnow(b) { state.snow = !!b; if (b) state.rain = false; }
  };
}
