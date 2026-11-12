// Batches street furniture. A lamp, sign or signal is still built as its own little object (so it can be hit,
// toppled or broken apart exactly as before), but identical parts of identical objects are DRAWN together: every
// part that has the same shape, the same place within its object and an equivalent material becomes one streamed
// InstancedMesh (instanceStream.js), and the original part is hidden. 1000 street lamps then cost a handful of
// draw calls instead of four each.
//
// What stays an ordinary mesh: anything see-through, anything whose material is flagged `userData.live` (signal
// lenses, snow lids: they change per object), multi-material meshes, and shapes with fewer than MIN copies.
// When an object is about to be knocked over call unbatch(inst): its own parts are shown again and its copy is
// dropped from the batches, so the destruction code works on a normal object.
import * as THREE from 'three';
import { matKey } from './collapse.js';

const MIN = 3;
const r3 = v => Math.round(v * 1000);

function geoHash(geo) {
  const p = geo.attributes.position.array;
  let h = p.length | 0;
  for (let i = 0; i < p.length; i++) h = (Math.imul(h, 31) + r3(p[i])) | 0;
  const n = geo.attributes.normal && geo.attributes.normal.array;
  if (n) for (let i = 0; i < n.length; i += 3) h = (Math.imul(h, 31) + r3(n[i]) + 7 * r3(n[i + 1])) | 0;
  return h + ':' + p.length + ':' + (geo.index ? geo.index.count : 0) + ':' + Object.keys(geo.attributes).sort().join(',');
}

// instances: [{ x, z, mesh }] whose mesh is a Group already placed in the scene. opts.near: see instanceStream.js.
export function batchProps(instances, stream, group, opts = {}) {
  const buckets = new Map(), inv = new THREE.Matrix4(), rel = new THREE.Matrix4();
  instances.forEach(inst => {
    const root = inst.mesh;
    if (!root || root.isMesh || !root.parent || inst._batch) return;
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    let item = null;
    root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || o.children.length) return;
      const m = o.material, mk = matKey(m);
      if (mk === null || m.transparent) return;
      rel.multiplyMatrices(inv, o.matrixWorld);
      const key = mk + '#' + geoHash(o.geometry) + '#' + rel.elements.map(r3).join(',') + '#' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0);
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = { mesh: o, rel: rel.clone(), items: [], parts: [] });
      item ||= { x: root.position.x, y: root.position.y, z: root.position.z, scale: root.scale.x, matrix: root.matrixWorld.clone(), hidden: false };
      b.items.push(item); b.parts.push([inst, o]);
    });
  });
  let made = 0;
  buckets.forEach(b => {
    if (b.items.length < MIN) return;
    const geo = b.mesh.geometry.clone().applyMatrix4(b.rel);
    geo.computeBoundingSphere();
    const bs = geo.boundingSphere;
    const im = new THREE.InstancedMesh(geo, b.mesh.material, b.items.length);
    im.castShadow = b.mesh.castShadow; im.receiveShadow = b.mesh.receiveShadow;
    group.add(im);
    stream.addSet([im], b.items, null, { radius: bs.radius + Math.hypot(bs.center.x, bs.center.z), yOff: bs.center.y, near: !!opts.near, shadow: im.castShadow });
    b.parts.forEach(([inst, o], i) => {
      o.visible = false;
      (inst._batch ||= { item: b.items[i], parts: [] }).parts.push(o);
    });
    made++;
  });
  return made;
}

// Street furniture never moves until it is hit, yet three.js recomputes the position matrix of every object and
// every one of its parts on every frame (about 20 000 of them here). freeze() works them out once and then skips
// the whole object; unbatch() switches the per-frame update back on the moment something knocks it over.
const frozen = function () {};
export function freeze(instances) {
  instances.forEach(inst => {
    const root = inst.mesh;
    if (!root || !root.parent) return;
    root.updateMatrixWorld(true);
    root.updateMatrixWorld = frozen;
  });
}

// The object is about to move or break: draw it as itself again, and let it move.
export function unbatch(inst) {
  if (!inst) return;
  if (inst.mesh && inst.mesh.updateMatrixWorld === frozen) delete inst.mesh.updateMatrixWorld;
  const b = inst._batch;
  if (!b) return;
  b.item.hidden = true;
  b.parts.forEach(o => { o.visible = true; });
  inst._batch = null;
}
