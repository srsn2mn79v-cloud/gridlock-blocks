// Painted parking bays in the alleys in front of the shops (chicago.js picks where there is room: shop.bays).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function buildShopBays(city, heightAt) {
  const geos = [];
  (city.shops || []).forEach(sh => (sh.bays || []).forEach(b => {
    [-1.6, 1.6].forEach(o => {
      // a line along the car's axis, from the aisle edge to the back of the bay
      const mx = b.x + b.nx * o + b.fx * 0.1, mz = b.z + b.nz * o + b.fz * 0.1, len = 3.8;
      const g = new THREE.PlaneGeometry(0.14, len); g.rotateX(-Math.PI / 2); g.rotateY(Math.atan2(b.fx, b.fz));
      g.translate(mx, heightAt(mx, mz, 0) + 0.045, mz); geos.push(g);
    });
  }));
  const group = new THREE.Group();
  if (geos.length) {
    const m = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.receiveShadow = true; group.add(m);
  }
  return group;
}
