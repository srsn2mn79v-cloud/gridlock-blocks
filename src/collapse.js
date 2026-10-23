import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Cuts the draw calls of a small composite object (a lamp, a traffic light, a sign...) by merging every
// group of meshes that share an equivalent material into one mesh, per parent node. Parent groups are
// kept as they are, so anything that moves, hides or breaks off a whole sub-group still works.
function matKey(m) {
  if (Array.isArray(m) || !m.isMeshStandardMaterial) return null;
  return [m.type, m.color.getHex(), m.emissive.getHex(), m.emissiveIntensity, m.roughness, m.metalness, m.flatShading ? 1 : 0, m.transparent ? 1 : 0,
    m.opacity, m.side, m.map ? m.map.uuid : '', m.vertexColors ? 1 : 0, JSON.stringify(m.userData && m.userData.snow || null)].join('|');
}
export function collapse(root) {
  const visit = node => {
    node.children.slice().forEach(c => { if (!c.isMesh) visit(c); });
    const buckets = new Map();
    node.children.slice().forEach(c => {
      if (!c.isMesh || c.isInstancedMesh || c.isSkinnedMesh || c.userData.keep || c.children.length) return;
      const key = matKey(c.material);
      if (key === null) return;
      const sig = Object.keys(c.geometry.attributes).sort().join(',');
      const bk = key + '#' + sig;
      if (!buckets.has(bk)) buckets.set(bk, []);
      buckets.get(bk).push(c);
    });
    buckets.forEach(list => {
      if (list.length < 2) return;
      const geos = list.map(c => {
        c.updateMatrix();
        const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        g.applyMatrix4(c.matrix);
        return g;
      });
      let merged;
      try { merged = mergeGeometries(geos, false); } catch (e) { return; }
      if (!merged) return;
      const m = new THREE.Mesh(merged, list[0].material);
      m.castShadow = list.some(c => c.castShadow); m.receiveShadow = list.some(c => c.receiveShadow);
      list.forEach(c => node.remove(c));
      node.add(m);
    });
  };
  visit(root);
  return root;
}
