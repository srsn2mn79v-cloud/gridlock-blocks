// The look of the game beyond the basic lit scene: reflections (a studio-style environment map
// that shows up in car paint and window glass), ACES tone mapping, bloom around bright lights,
// ambient occlusion (GTAO), and the procedural surface detail from surfaceShaders.js.
// Everything is switchable (see the Graphics tab in menu.js) because on a phone the AO pass in
// particular is expensive: with AO and bloom both off the scene renders straight to the screen
// with MSAA, exactly like before.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gfxU, installBuilding, installGround } from './surfaceShaders.js';

// Final look, done in linear HDR just before tone mapping: sun light shafts (from the bright sky between buildings),
// a radial speed blur, a touch of chromatic aberration, vignette, warm/cool grade and film grain.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uSpeed: { value: 0 }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uShaft: { value: 0 },
    uShaftCol: { value: new THREE.Color(1, 0.9, 0.7) }, uVig: { value: 0.3 }, uCA: { value: 0.0014 }, uGrain: { value: 0.008 },
    uTint: { value: new THREE.Color(1, 1, 1) }, uNite: { value: 0 }, uSat: { value: 1.06 }, uAspect: { value: 1.78 }, uShake: { value: new THREE.Vector2() }
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uSpeed, uShaft, uVig, uCA, uGrain, uSat, uAspect, uNite; uniform vec2 uSun, uShake; uniform vec3 uShaftCol, uTint;
    varying vec2 vUv;
    float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 uv = vUv + uShake, c = uv - 0.5;
      float r = length(c * vec2(uAspect, 1.0));
      vec3 col;
      if (uSpeed > 0.03) {                                   // radial speed blur, strongest at the edges
        float amt = uSpeed * uSpeed * 0.09 * smoothstep(0.12, 0.75, r);
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 8; i++) acc += texture2D(tDiffuse, uv - c * amt * (float(i) / 7.0)).rgb;
        col = acc / 8.0;
      } else {
        float ca = uCA * (0.4 + r * 2.0);
        col = vec3(texture2D(tDiffuse, uv + c * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ca).b);
      }
      if (uShaft > 0.001) {                                  // crepuscular rays: march towards the sun, keep only what is brighter than the sky
        vec2 d = (uSun - uv) * (1.0 / 22.0) * 0.95; vec2 p = uv; float w = 1.0, acc = 0.0;
        for (int i = 0; i < 22; i++) { p += d; vec3 s = texture2D(tDiffuse, p).rgb; float l = dot(s, vec3(0.3, 0.59, 0.11)); acc += max(l - 0.85, 0.0) * w; w *= 0.93; }
        float near = pow(clamp(1.0 - length((uv - uSun) * vec2(uAspect, 1.0)) * 0.8, 0.0, 1.0), 1.6);
        col += uShaftCol * acc * (1.0 / 22.0) * uShaft * (0.25 + 0.75 * near) * 2.2;
      }
      col *= uTint;
      float l = dot(col, vec3(0.3, 0.59, 0.11));
      // night look: cool blue-violet shadows, warm orange highlights, punchier contrast (the Need for Speed Underground palette)
      if (uNite > 0.001) {
        float sh = 1.0 - smoothstep(0.0, 0.45, l), hi = smoothstep(0.3, 1.4, l);
        col *= mix(vec3(1.0), vec3(0.74, 0.86, 1.3), sh * uNite * 0.85);
        col *= mix(vec3(1.0), vec3(1.22, 1.02, 0.78), hi * uNite * 0.7);
        col = max((col - 0.14) * (1.0 + 0.22 * uNite) + 0.14, 0.0);
        col += vec3(0.010, 0.008, 0.028) * uNite;
      }
      col = mix(vec3(l), col, uSat);
      col *= 1.0 - uVig * smoothstep(0.3, 0.95, r * 1.15);
      col += (hash(vUv * vec2(1280.0, 720.0) + fract(uTime) * 91.7) - 0.5) * uGrain * (0.4 + 0.6 * (1.0 - clamp(l, 0.0, 1.0)));
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`
};

const _p = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
export function createGraphics({ renderer, scene, camera, parcelInstances, ground, initial }) {
  const state = { ao: 'low', bloom: true, tone: true, tex: 2, fx: true, quality: 'custom', ...initial };
  let composer = null, gtao = null, bloom = null, grade = null, night = 1;

  // reflections / image-based light
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;

  // surface shaders
  (parcelInstances || []).forEach(p => {
    if (p.type === 'building') installBuilding(p.mesh.material);
    else if (p.type === 'park' || p.type === 'plaza') installGround(p.mesh.material);
  });
  installGround(ground.material);

  function dispose() {
    if (composer) { composer.dispose?.(); composer = null; gtao = null; bloom = null; grade = null; }
  }
  function build() {
    dispose();
    renderer.toneMapping = state.tone ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    const useComposer = state.ao !== 'off' || state.bloom || state.fx;
    if (!useComposer) return;
    const size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    if (state.ao !== 'off') {
      const hi = state.ao === 'high';
      gtao = new GTAOPass(scene, camera, size.x * pr, size.y * pr);
      gtao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.3, thickness: 1.6, scale: 1.0, samples: hi ? 16 : 8, distanceFallOff: 1.0 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8 });
      gtao.blendIntensity = 0.85;
      // the normal/depth pre-pass must not see glow quads, halos or other transparent overlays
      gtao.overrideVisibility = function () {
        const cache = this._visibilityCache;
        this.scene.traverse(o => {
          cache.set(o, o.visible);
          if (o.isPoints || o.isLine || o.isSprite || o.name === 'sky' || (o.material && o.material.transparent)) o.visible = false;
        });
      };
      composer.addPass(gtao);
    }
    if (state.bloom) {
      bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.35, 1.0);
      composer.addPass(bloom);
    }
    if (state.fx) { grade = new ShaderPass(GradeShader); composer.addPass(grade); }
    composer.addPass(new OutputPass());
    applyNight();
  }

  function applyNight() {
    gfxU.uNight.value = night;
    scene.environmentIntensity = 0.06 + 0.2 * (1 - night);
    renderer.toneMappingExposure = 1.35 - 0.1 * night;
    if (bloom) { bloom.threshold = 1.9 - 0.7 * night; bloom.strength = 0.12 + 0.28 * night; bloom.radius = 0.55 + 0.25 * night; }
  }

  build();
  gfxU.uQuality.value = state.tex;
  applyNight();

  return {
    state,
    set(k, v) {
      if (!(k in state)) return;
      const rebuild = state[k] !== v && (k === 'ao' || k === 'bloom' || k === 'tone' || k === 'fx');
      state[k] = v;
      if (k === 'tex') gfxU.uQuality.value = Number(v);
      if (rebuild) build();
    },
    setNight(k) { night = k; applyNight(); },
    _grade: () => grade,
    // per-frame inputs for the final grade: speed 0..1, sun direction (world), how visible the sun is, the sun colour, impact shake
    frame({ time, speed, sunDir, sunAmt, sunCol, shake, wet, nightK }) {
      gfxU.uTime.value = time;
      if (!grade) return;
      const u = grade.uniforms;
      gfxU.uTime.value = time; u.uTime.value = time; u.uSpeed.value = state.fx ? speed : 0;
      u.uAspect.value = camera.aspect;
      u.uShake.value.set(shake ? (Math.random() - 0.5) * shake * 0.01 : 0, shake ? (Math.random() - 0.5) * shake * 0.01 : 0);
      _p.copy(camera.position).addScaledVector(sunDir, 200).project(camera);
      _w.copy(sunDir).applyQuaternion(_q.copy(camera.quaternion).invert());
      const front = _w.z < -0.02;
      u.uSun.value.set(_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5);
      u.uShaft.value = front && state.quality !== 'low' ? sunAmt * (1 - wet) * 0.9 : 0;
      u.uShaftCol.value.copy(sunCol);
      // warm in the evening, cool at night, slightly desaturated in rain
      const low = Math.max(0, 1 - Math.abs(sunDir.y - 0.15) * 2.6) * (1 - nightK);
      u.uTint.value.setRGB(1 + 0.08 * low - 0.06 * nightK, 1 + 0.01 * low - 0.01 * nightK, 1 - 0.08 * low + 0.07 * nightK);
      u.uSat.value = 1.08 - 0.18 * wet + 0.2 * nightK * (1.0 - wet * 0.5); u.uNite.value = nightK * (1.0 - 0.35 * wet);
      u.uVig.value = 0.28 + 0.12 * nightK;
    },
    resize(w, h) { if (composer) composer.setSize(w, h); },
    render() { if (composer) composer.render(); else renderer.render(scene, camera); }
  };
}
