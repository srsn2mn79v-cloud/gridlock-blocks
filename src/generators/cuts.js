// Open cuts and portals for tunnels. The ground is a flat plane at y=0, so a road that dips
// below it simply vanished under the grass, and from above the highway ring looked broken.
// This cuts a rectangular hole in the ground along each downhill ramp, lines it with
// retaining walls that follow the road's grade, and caps each tunnel end with a concrete
// portal. Only straight, axis-aligned ramps are handled (all this city has).
import * as THREE from 'three';

const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 1, side: THREE.DoubleSide });
const portalMat = new THREE.MeshStandardMaterial({ color: 0x5b6169, roughness: 0.95 });
const TUNNEL_H = 7.2;

export function buildCuts(city, heightAt) {
  const nodes = city.roadNodes;
  const group = new THREE.Group();
  const holes = [];
  const EPS = 0.5;

  const axis = e => {
    const a = nodes[e.from], b = nodes[e.to];
    if (Math.abs(a.z - b.z) < 0.01) return 'x';
    if (Math.abs(a.x - b.x) < 0.01) return 'z';
    return null;
  };

  city.roadEdges.forEach(e => {
    const a = nodes[e.from], b = nodes[e.to];
    const ax = axis(e);
    if (!ax) return;
    const hw = e.width / 2 + 0.4;

    if (e.structure === 'tunnel') {
      // Portals at both ends.
      [[a, b], [b, a]].forEach(([end, other]) => {
        const dirX = ax === 'x' ? Math.sign(other.x - end.x) : 0;
        const dirZ = ax === 'z' ? Math.sign(other.z - end.z) : 0;
        const y = heightAt(end.x, end.z);
        const pier = 1.6, thick = 1.6;
        const rotY = ax === 'x' ? Math.PI / 2 : 0; // box local z = along the road
        const place = (mesh, lat, up) => {
          const px = ax === 'x' ? end.x : end.x + lat;
          const pz = ax === 'x' ? end.z + lat : end.z;
          mesh.position.set(px, y + up, pz);
          mesh.rotation.y = rotY;
          mesh.castShadow = true;
          group.add(mesh);
        };
        const top = 0.4 - y;                 // up to just above the ground plane
        [1, -1].forEach(s => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(pier, top + 0.4, thick), portalMat);
          place(m, s * (hw + pier / 2 - 0.2), (top - 0.4) / 2);
        });
        const lintelH = Math.max(0.5, top - TUNNEL_H + 0.4);
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(2 * hw + 2 * pier - 0.4, lintelH, thick), portalMat);
        place(lintel, 0, TUNNEL_H + lintelH / 2 - 0.2);
      });
      return;
    }

    if (Math.min(a.elevation || 0, b.elevation || 0) < -EPS) {
      // Hole in the ground over the whole ramp.
      let x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
      let z1 = Math.min(a.z, b.z), z2 = Math.max(a.z, b.z);
      // The vertical curve starts dipping before the ramp's top node, so keep digging
      // outward from the high end until the road is back above ground.
      const hi = (a.elevation || 0) >= (b.elevation || 0) ? a : b;
      const lo = hi === a ? b : a;
      const sgn = ax === 'x' ? Math.sign(hi.x - lo.x) : Math.sign(hi.z - lo.z);
      for (let d = 0; d < 60; d++) {
        const px = ax === 'x' ? hi.x + sgn * d : hi.x, pz = ax === 'x' ? hi.z : hi.z + sgn * d;
        if (heightAt(px, pz) >= -0.04) break;
        if (ax === 'x') { if (sgn > 0) x2 = px + 1; else x1 = px - 1; } else { if (sgn > 0) z2 = pz + 1; else z1 = pz - 1; }
      }
      const H = ax === 'x' ? { x1, x2, z1: a.z - hw, z2: a.z + hw } : { x1: a.x - hw, x2: a.x + hw, z1, z2 };
      holes.push(H);

      // Retaining walls along both sides, bottom following the road.
      const len = ax === 'x' ? x2 - x1 : z2 - z1;
      const steps = Math.max(2, Math.round(len / 2));
      [1, -1].forEach(side => {
        const pos = [], idx = [];
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = ax === 'x' ? x1 + (x2 - x1) * t : a.x + side * hw;
          const z = ax === 'x' ? a.z + side * hw : z1 + (z2 - z1) * t;
          const cx = ax === 'x' ? x : a.x, cz = ax === 'x' ? a.z : z;
          const yr = Math.min(0, heightAt(cx, cz)) - 0.05;
          pos.push(x, yr, z, x, 0.02, z);
          if (i < steps) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        group.add(new THREE.Mesh(g, wallMat));
      });
    }
  });

  return { group, holes };
}

// A big ground plane with rectangular holes punched out (x/z world coords).
export function groundGeometry(size, holes) {
  const h = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-h, -h); shape.lineTo(h, -h); shape.lineTo(h, h); shape.lineTo(-h, h); shape.closePath();
  holes.forEach(r => {
    // rotation.x = -PI/2 maps shape y -> world -z
    const p = new THREE.Path();
    p.moveTo(r.x1, -r.z1); p.lineTo(r.x2, -r.z1); p.lineTo(r.x2, -r.z2); p.lineTo(r.x1, -r.z2); p.closePath();
    shape.holes.push(p);
  });
  return new THREE.ShapeGeometry(shape);
}
