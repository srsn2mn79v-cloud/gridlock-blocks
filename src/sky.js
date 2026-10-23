// A real sky: a gradient that follows the time of day, a sun disc with glare (HDR, so bloom and the light-shaft pass pick it
// up), drifting clouds, stars and a moon at night. The same GLSL is reused by the road shader so wet asphalt mirrors it.
import * as THREE from 'three';

export const skyU = {
  uSkyTop: { value: new THREE.Color(0x2a63b8) }, uSkyHor: { value: new THREE.Color(0x8cc4ec) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(0xfff0d8) },
  uSunAmt: { value: 1 }, uSkyNight: { value: 0 }, uCloud: { value: 0.35 }, uSkyTime: { value: 0 }, uHaze: { value: 0 }
};

export const skyGLSL = `
  uniform vec3 uSkyTop; uniform vec3 uSkyHor; uniform vec3 uSunDir; uniform vec3 uSunCol;
  uniform float uSunAmt; uniform float uSkyNight; uniform float uCloud; uniform float uSkyTime; uniform float uHaze;
  float skH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float skN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(skH(i), skH(i+vec2(1,0)), f.x), mix(skH(i+vec2(0,1)), skH(i+vec2(1,1)), f.x), f.y); }
  float skF(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * skN(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
  vec3 skyBase(vec3 d) {
    float h = clamp(d.y, 0.0, 1.0);
    vec3 c = mix(uSkyHor, uSkyTop, pow(h, 0.5));
    float s = max(dot(d, uSunDir), 0.0);
    float low = 1.0 - smoothstep(0.0, 0.5, uSunDir.y);                       // sun near the horizon: wide warm glow
    c += uSunCol * (pow(s, 900.0) * 9.0 + pow(s, 40.0) * 0.5 + pow(s, 6.0) * (0.12 + 0.3 * low)) * uSunAmt;
    c += uSkyHor * 0.25 * low * exp(-abs(d.y) * 6.0) * uSunAmt * smoothstep(-0.2, 0.6, dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-4)));
    return c;
  }
  vec3 skyFull(vec3 d) {
    vec3 c = skyBase(d);
    float up = max(d.y, 0.0);
    // clouds: a flat layer projected onto the sky, lit by the sun from the side it faces
    if (d.y > 0.0) {
      vec2 p = d.xz / (d.y + 0.22) * 0.9 + vec2(uSkyTime * 0.012, uSkyTime * 0.005);
      float n = skF(p), m = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.28, n);
      m *= smoothstep(0.0, 0.22, d.y);
      float lit = clamp(0.55 + 0.7 * (skF(p + uSunDir.xz * 0.08) - n) * 2.4, 0.2, 1.3);
      vec3 cc = mix(uSkyHor, vec3(1.0), 0.65) * (0.3 + 0.9 * (1.0 - uSkyNight)) * lit + uSunCol * 0.35 * lit * uSunAmt;
      cc = mix(cc, vec3(0.36, 0.38, 0.42) * (0.2 + 0.8 * (1.0 - uSkyNight)), clamp((uCloud - 0.55) * 2.2, 0.0, 0.85));   // overcast: grey and heavy
      c = mix(c, cc, m * 0.92);
    }
    // night: stars and a moon disc
    if (uSkyNight > 0.05) {
      vec2 sp = d.xz / (d.y + 0.6) * 90.0; float st = skH(floor(sp)); float tw = step(0.985, st) * (0.6 + 0.4 * sin(uSkyTime * 2.0 + st * 60.0));
      c += vec3(0.9, 0.95, 1.0) * tw * uSkyNight * (1.0 - clamp(uCloud * 1.5, 0.0, 1.0)) * smoothstep(0.05, 0.3, d.y);
      float md = max(dot(d, uSunDir), 0.0);
      c += vec3(0.75, 0.82, 1.0) * (smoothstep(0.9993, 0.9997, md) * 2.2 + pow(md, 60.0) * 0.12) * uSkyNight * (1.0 - clamp(uCloud, 0.0, 0.8));
    }
    return mix(c, uSkyHor, clamp(uHaze, 0.0, 1.0) * (1.0 - up * 0.3));
  }
`;

export function createSky(scene) {
  const mat = new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: skyGLSL + 'varying vec3 vD; void main(){ gl_FragColor = vec4(skyFull(normalize(vD)), 1.0); }'
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -1000; mesh.name = 'sky';
  scene.add(mesh);
  const C = h => new THREE.Color(h);
  const deep = C(0x2a63b8), dusk = C(0x4a4f9a), night = C(0x04060d);
  return {
    mesh,
    // bg = the fog/horizon colour, nightK 0..1, sunDir normalised, rainy/foggy 0..1
    update(camPos, t, { bg, nightK, sunDir, sunCol, cloud, haze }) {
      mesh.position.copy(camPos);
      const u = skyU;
      u.uSkyHor.value.copy(bg);
      const warm = Math.max(0, 1 - Math.abs(sunDir.y - 0.12) * 3.2) * (1 - nightK);          // low sun
      u.uSkyTop.value.copy(deep).lerp(dusk, warm * 0.8).lerp(night, nightK).multiplyScalar(1 - 0.45 * haze);
      u.uSkyTop.value.lerp(bg, Math.min(1, haze * 0.8));
      u.uSunDir.value.copy(sunDir); u.uSunCol.value.copy(sunCol);
      u.uSunAmt.value = (1 - nightK) * (1 - 0.8 * Math.min(1, cloud * 1.2));
      u.uSkyNight.value = nightK; u.uCloud.value = cloud; u.uSkyTime.value = t; u.uHaze.value = haze;
    }
  };
}
