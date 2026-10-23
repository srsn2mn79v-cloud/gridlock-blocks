// Procedural surface detail, done in the materials' shaders from world position so it needs no
// texture files and no UVs, scales to any city size and costs nothing in geometry or draw calls:
//   - asphalt grain, patches and hairline cracks on roads,
//   - mottled ground / grass,
//   - building facades: window grid with reflective glass, warm lit windows at night, panel
//     lines, and a baked-style ambient-occlusion gradient where walls meet the ground.
// `gfxU.uQuality` (0 low / 1 medium / 2 high) is the Textures setting; `gfxU.uNight` follows the
// time of day.
import * as THREE from 'three';

export const gfxU = {
  uQuality: { value: 2 },
  uNight: { value: 1 }, uTime: { value: 0 }
};

const NOISE = `
  float gh21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float gvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(gh21(i), gh21(i + vec2(1.0, 0.0)), f.x), mix(gh21(i + vec2(0.0, 1.0)), gh21(i + vec2(1.0, 1.0)), f.x), f.y); }
`;

// ---- roads: called from environment.js's road hook (which also does the snow dots) -------
export const roadDecl = NOISE + `uniform float uQuality; varying vec3 vGW;\n`;
export const roadVertex = `vGW = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
export const roadFrag = `
  if (uQuality > 0.5) {
    vec2 gw = vGW.xz;
    float far = 1.0 - smoothstep(30.0, 90.0, length(vViewPosition));
    float g = gvn(gw * 0.8) * 0.5 + gvn(gw * 5.0) * 0.3 * (0.4 + 0.6 * far) + gvn(gw * 21.0) * 0.2 * far;
    diffuseColor.rgb *= 0.82 + 0.34 * g;
    // cracks (thin ridged-noise lines, two scales), oil/tyre stains, tar-sealed repair strips and patched squares
    float cr1 = smoothstep(0.03, 0.0, abs(gvn(gw * 0.45 + 7.3) - 0.5));
    float cr2 = smoothstep(0.045, 0.0, abs(gvn(gw * 1.3 + 41.7) - 0.5)) * smoothstep(0.45, 0.62, gvn(gw * 0.2 + 5.0));
    float crack = max(cr1 * 0.9, cr2) * (0.35 + 0.65 * far);
    diffuseColor.rgb *= 1.0 - 0.55 * crack;
    float st = smoothstep(0.66, 0.78, gvn(gw * 0.16 + 19.0) * 0.6 + gvn(gw * 0.9) * 0.4);
    diffuseColor.rgb *= 1.0 - 0.38 * st;
    float oil = smoothstep(0.78, 0.9, gvn(gw * 0.5 + 91.0)) * (0.4 + 0.6 * gvn(gw * 4.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.55, 0.6), oil * 0.8);
    float tar = smoothstep(0.02, 0.0, abs(gvn(gw * vec2(0.07, 0.9) + 3.0) - 0.5)) * step(0.55, gvn(gw * 0.05 + 2.0));
    diffuseColor.rgb *= 1.0 - 0.45 * tar * (0.4 + 0.6 * far);
    vec2 pc = floor(gw / vec2(5.0, 3.2)); float pexists = step(0.93, gh21(pc + 17.0));
    diffuseColor.rgb *= 1.0 - 0.2 * pexists;
    float pch = smoothstep(0.62, 0.7, gvn(gw * 0.11));
    diffuseColor.rgb *= 1.0 - 0.08 * pch;
  }
`;

function hook(mat, key, decl, vertex, frag, extraFrag) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uQuality = gfxU.uQuality; shader.uniforms.uNight = gfxU.uNight; shader.uniforms.uTime = gfxU.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSW; varying vec3 vSN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE + 'varying vec3 vSW; varying vec3 vSN; uniform float uQuality; uniform float uNight; uniform float uTime;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat gWin = 0.0; float gLit = 0.0; vec3 gLitC = vec3(1.0, 0.78, 0.45);\n' + frag)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, gWin);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.2, gWin);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gLitC * gLit * 0.5;');
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
}

export function installBuilding(mat) {
  hook(mat, 'bld3', '', '', `
    float gAO = mix(0.5, 1.0, smoothstep(0.0, 7.0, vSW.y));
    vec3 gn = normalize(vSN);
    if (abs(gn.y) < 0.5 && uQuality > 0.5) {
      vec2 tdir = vec2(-gn.z, gn.x);
      vec2 uv = vec2(dot(vSW.xz, tdir), vSW.y);
      // 1 u = 1.25 m: storeys 2.8 u (3.5 m), a window bay every 2.4 u (3 m), windows ~1.4 u (1.8 m) wide and
      // ~1.4 u tall; the ground storey is a shopfront band of wider, lower glass (doors are real meshes, doors.js)
      vec2 cell = vec2(2.4, 2.8);
      vec2 id = floor(uv / cell); vec2 f = fract(uv / cell);
      float ground = 1.0 - step(2.8, vSW.y);
      float inX = mix(step(0.2, f.x) * step(f.x, 0.8), step(0.08, f.x) * step(f.x, 0.92), ground);
      float inY = mix(step(0.28, f.y) * step(f.y, 0.78), step(0.2, f.y) * step(f.y, 0.78), ground);
      float win = inX * inY;
      float r = gh21(id * vec2(1.7, 2.3) + gn.x * 7.0 + gn.z * 13.0);
      float lit = step(0.5, r);
      vec3 glassDay = vec3(0.12, 0.17, 0.24) * (0.8 + 0.5 * gh21(id + 3.0));
      float kind = gh21(id * vec2(3.1, 1.3) + gn.x * 5.0 + gn.z * 9.0);
      vec3 litC = kind < 0.6 ? vec3(1.0, 0.72, 0.4) : kind < 0.8 ? vec3(0.78, 0.88, 1.0) : kind < 0.92 ? vec3(0.32, 0.5, 1.0) : vec3(1.0, 0.45, 0.22);
      float flick = (kind >= 0.8 && kind < 0.92) ? 0.7 + 0.3 * sin(uTime * 6.0 + r * 40.0) * sin(uTime * 2.3 + r * 9.0) : 1.0;     // a TV on
      litC *= flick; gLitC = litC;
      vec3 glassNight = mix(vec3(0.03, 0.04, 0.06), litC * vec3(0.95, 0.9, 0.9), lit);
      vec3 glass = mix(glassDay, glassNight, uNight);
      diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
      gWin = win;
      gLit = win * lit * uNight;
      if (uQuality > 1.5) {
        // panel lines + sills, and slight per-floor tint variation
        float line = (1.0 - step(0.025, f.x)) + (1.0 - step(0.03, f.y));
        diffuseColor.rgb *= 1.0 - 0.18 * clamp(line, 0.0, 1.0) * (1.0 - win);
        float sill = step(0.14, f.y) * (1.0 - step(0.2, f.y)) * inX;
        diffuseColor.rgb *= 1.0 + 0.12 * sill;
        diffuseColor.rgb *= 0.94 + 0.12 * gh21(id + 11.0) * (1.0 - win);
      }
    } else if (gn.y > 0.5 && uQuality > 0.5) {
      diffuseColor.rgb *= 0.8 + 0.2 * gvn(vSW.xz * 0.6);   // roof: mottled
    }
    diffuseColor.rgb *= gAO;
  `);
}

export function installGround(mat) {
  hook(mat, 'gnd2', '', '', `
    if (uQuality > 0.5) {
      float far = 1.0 - smoothstep(40.0, 140.0, length(vViewPosition));
      float n = gvn(vSW.xz * 0.35) * 0.55 + gvn(vSW.xz * 1.7) * 0.3 + gvn(vSW.xz * 7.0) * 0.15 * far;
      diffuseColor.rgb *= 0.78 + 0.44 * n;
    }
  `);
}

// Snow settling on props (trees, poles, signs, benches...): up-facing surfaces whiten as
// `uSnowCap` rises from 0 to 1 (environment.js drives it from the snow accumulation).
export const snowCapU = { uSnowCap: { value: 0 } };
const _capped = new Set();
// mat.userData.snow tunes it: { skip } leaves the material alone, { grad:[y0,y1] } plasters poles and
// arms with a white coat that fades to the paint colour from y1 (object space) down to y0, and
// { plaster } clings snow to a sign face (thick along the top and edges, patchy and noisy).
// Gives every vertex of every mesh under `root` that uses a gradient-snow material its height in
// `root`'s own space (the shader can't see that: a mesh only knows its own local coordinates).
export function bakeSnowHeights(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh || !(o.material.userData && o.material.userData.snow && o.material.userData.snow.grad)) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    o.geometry = o.geometry.clone();
    const pos = o.geometry.attributes.position, gy = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m); gy[i] = v.y; }
    o.geometry.setAttribute('gy', new THREE.BufferAttribute(gy, 1));
  });
}
export function installSnowCap(mat) {
  if (!mat || _capped.has(mat) || !mat.isMeshStandardMaterial || mat.transparent) return;
  const cfg = (mat.userData && mat.userData.snow) || {};
  if (cfg.skip) return;
  _capped.add(mat);
  const grad = cfg.grad ? `smoothstep(${cfg.grad[0].toFixed(2)}, ${cfg.grad[1].toFixed(2)}, vSnObj.y)` : '0.0';
  const plaster = !!cfg.plaster;
  mat.onBeforeCompile = shader => {
    shader.uniforms.uSnowCap = snowCapU.uSnowCap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCapUp; varying vec3 vSnObj; varying vec2 vSnUv;' + (cfg.grad ? ' attribute float gy;' : ''))
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCapUp = normalize(mat3(modelMatrix) * objectNormal).y; vSnObj = position;' + (cfg.grad ? ' vSnObj.y = gy;' : '') + ' vSnUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vCapUp; varying vec3 vSnObj; varying vec2 vSnUv; uniform float uSnowCap;
float snH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float snN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(snH(i), snH(i+vec2(1,0)), f.x), mix(snH(i+vec2(0,1)), snH(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float snowPl = 0.0;
{
  float capUp = smoothstep(0.05, 0.65, vCapUp);
  float capK = uSnowCap * (0.08 + 0.92 * capUp);
  float hk = ${grad};
  capK = max(capK, uSnowCap * hk * (0.8 + 0.2 * capUp));
  ${plaster ? `
  float sn = clamp(uSnowCap * 1.4, 0.0, 1.0);
  float nz = snN(vSnUv * 11.0) * 0.6 + snN(vSnUv * 27.0) * 0.4;
  float eU = min(min(vSnUv.x, 1.0 - vSnUv.x), 1.0 - vSnUv.y);
  float eAll = min(eU, vSnUv.y * 0.6);
  float crust = 1.0 - smoothstep(0.02, 0.1 + 0.16 * sn + 0.08 * nz, eU + (nz - 0.5) * 0.14);
  float drift = smoothstep(0.0, 1.0, (vSnUv.y - (1.0 - 0.5 * sn)) * 6.0 + (nz - 0.5) * 2.0);
  float side = 1.0 - smoothstep(0.0, 0.07 + 0.06 * nz, min(vSnUv.x, 1.0 - vSnUv.x));
  snowPl = clamp(max(crust, max(drift, side * 0.8)) * smoothstep(0.08, 0.35, uSnowCap), 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.96, 1.0), snowPl * 0.96);` : ''}
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), capK * 0.95);
}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= (1.0 - snowPl);');
  };
  mat.customProgramCacheKey = () => 'snowcap2' + (cfg.grad ? 'g' + cfg.grad.join('_') : '') + (plaster ? 'p' : '');
  mat.needsUpdate = true;
}

// White snow lids sitting on top of things (lamp heads, signal housings, sign tops). They grow with
// the snow that has built up and are hidden when the ground is clear.
const _caps = [];
const _capMat = new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.95 });
_capMat.userData.snow = { skip: true };
export function snowCap(parent, w, h, d, x, y, z) {
  const geo = new THREE.BoxGeometry(w, h, d); geo.translate(0, h / 2, 0);
  const m = new THREE.Mesh(geo, _capMat);
  m.position.set(x, y, z); m.visible = false;
  parent.add(m); _caps.push(m);
  return m;
}
export function updateSnowCaps(acc) {
  const k = Math.max(0, Math.min(1, (acc - 0.08) / 0.5));
  const vis = k > 0.02;
  for (const m of _caps) { if (m.visible !== vis) m.visible = vis; if (vis) m.scale.set(1, 0.3 + 0.7 * k, 1); }
}
