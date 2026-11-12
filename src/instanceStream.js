// Streamed instancing: thousands of copies of a thing (parked cars, neon signs) are spread over the whole city, but
// only the few in front of the camera matter. Splitting them into per-area InstancedMeshes costs one draw call per
// area, per model, per material (that was ~4600 tiny batches for 2200 parked cars). Instead each model keeps ONE
// InstancedMesh per material and, every frame, its instance buffer is refilled with just the copies that are inside
// the camera's view and draw distance. Draw calls then depend on how many different models are on screen, not on
// how big the city is.
//
// A "set" is a list of items that share the same instance transforms, drawn by one or more InstancedMeshes (one per
// material). The meshes of a set share a single instance-matrix buffer, so it is uploaded once.
import * as THREE from 'three';

const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4(), _sphere = new THREE.Sphere();

export function createInstanceStream() {
  const sets = [];

  // meshes: InstancedMeshes created with capacity >= items.length. items: [{ x, y, z, radius, matrix: Matrix4, color?: Color }]
  // colorMesh: the one mesh (if any) that is tinted per item. Returns the set; set item.hidden = true to drop a copy.
  // opts.radius / opts.yOff: one bounding radius and height offset for every item of the set (instead of item.radius / item.y);
  // opts.near: small street furniture, only drawn out to update()'s nearDist; opts.shadow: it casts a shadow, so copies
  // close to the camera are kept even when they are outside the view (their shadow may still fall into it).
  function addSet(meshes, items, colorMesh = null, opts = {}) {
    const cap = items.length;
    const mat = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
    mat.setUsage(THREE.DynamicDrawUsage);
    meshes.forEach(im => { im.instanceMatrix = mat; im.frustumCulled = false; im.count = 0; im.visible = false; });   // culled per item here instead
    let col = null;
    if (colorMesh) {
      col = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      col.setUsage(THREE.DynamicDrawUsage);
      colorMesh.instanceColor = col;
    }
    const src = new Float32Array(cap * 16), srcCol = col ? new Float32Array(cap * 3) : null;
    items.forEach((it, i) => {
      it.matrix.toArray(src, i * 16);
      if (srcCol) { const c = it.color || { r: 1, g: 1, b: 1 }; srcCol[i * 3] = c.r; srcCol[i * 3 + 1] = c.g; srcCol[i * 3 + 2] = c.b; }
    });
    const set = { meshes, items, mat, col, src, srcCol, shown: -1, radius: opts.radius, yOff: opts.yOff || 0, near: !!opts.near, shadow: !!opts.shadow };
    sets.push(set);
    return set;
  }

  // Refill every set with the items inside the camera frustum and within maxDist (nearDist for `near` sets) of the camera.
  const SHADOW_KEEP = 70 * 70;
  function update(camera, maxDist, nearDist = maxDist) {
    camera.updateMatrixWorld();
    _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const cx = camera.position.x, cz = camera.position.z;
    for (const s of sets) {
      const out = s.mat.array, outCol = s.col && s.col.array, src = s.src, srcCol = s.srcCol, items = s.items;
      const lim = s.near ? nearDist : maxDist, d2 = lim * lim, fixedR = s.radius, yOff = s.yOff;
      let n = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.hidden) continue;
        const dx = it.x - cx, dz = it.z - cz, dd = dx * dx + dz * dz;
        if (dd > d2) continue;
        if (!(s.shadow && dd < SHADOW_KEEP)) {
          _sphere.center.set(it.x, it.y + yOff * (it.scale || 1), it.z); _sphere.radius = (fixedR !== undefined ? fixedR * (it.scale || 1) : it.radius) + 2;   // +2: the camera moves a little between this test and the draw
          if (!_frustum.intersectsSphere(_sphere)) continue;
        }
        const a = i * 16, b = n * 16;
        for (let k = 0; k < 16; k++) out[b + k] = src[a + k];
        if (outCol) { outCol[n * 3] = srcCol[i * 3]; outCol[n * 3 + 1] = srcCol[i * 3 + 1]; outCol[n * 3 + 2] = srcCol[i * 3 + 2]; }
        n++;
      }
      if (n === 0 && s.shown === 0) continue;
      s.shown = n;
      for (const im of s.meshes) { im.count = n; im.visible = n > 0; }
      if (n > 0) {
        s.mat.clearUpdateRanges(); s.mat.addUpdateRange(0, n * 16); s.mat.needsUpdate = true;
        if (s.col) { s.col.clearUpdateRanges(); s.col.addUpdateRange(0, n * 3); s.col.needsUpdate = true; }
      }
    }
  }

  return { addSet, update, sets };
}
