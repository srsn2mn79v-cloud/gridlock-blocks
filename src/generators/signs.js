// Road-side signs generated from the road data: STOP signs on every approach that must stop
// (see junctionRules.js) and speed-limit signs along each road.
import * as THREE from 'three';
import { collapse } from '../collapse.js';
import { pointInPolygon } from '../collision.js';
import { snowCap } from '../surfaceShaders.js';
import { buildEdgesByNode, intersectionClearance } from '../roadMath.js';
import { computeStopApproaches, speedLimitFor } from '../junctionRules.js';
import { makeRoadClearance } from '../roadClearance.js';

const postMat = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.6, metalness: 0.5 });

function labelTexture(draw, w = 128, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

let _stopTex = null;
function stopSignMesh() {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 6), postMat);
  post.position.y = 1.15; post.castShadow = true;
  // octagon painted on a canvas whose corners sit exactly on the CircleGeometry's 8 vertices
  _stopTex ||= labelTexture((c, w, h) => {
    const oct = r => {
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + i * Math.PI / 4;
        const x = w / 2 + Math.cos(a) * r, y = h / 2 - Math.sin(a) * r;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.closePath();
    };
    c.fillStyle = '#c8102e'; oct(w / 2); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 8; oct(w / 2 - 9); c.stroke();
    c.fillStyle = '#fff'; c.font = 'bold 74px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('STOP', w / 2, h / 2 + 2);
  }, 256, 256);
  // thetaStart = PI/8 puts a flat edge on top, so the sign stands upright
  const geo = new THREE.CircleGeometry(0.37, 8, Math.PI / 8);
  const frontMat = new THREE.MeshStandardMaterial({ map: _stopTex, emissive: 0x330000, emissiveMap: _stopTex, roughness: 0.5 });
  frontMat.userData.snow = { plaster: true };
  const front = new THREE.Mesh(geo, frontMat);
  const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x999999, side: THREE.BackSide }));
  front.position.set(0, 1.95, 0.07); back.position.copy(front.position);
  front.castShadow = true;
  g.add(post, front, back);
  snowCap(g, 0.3, 0.07, 0.12, 0, 2.3, 0.07);
  return g;
}

const _limitTex = {};
function speedSignMesh(limit) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 6), postMat);
  post.position.y = 1.15; post.castShadow = true;
  _limitTex[limit] ||= labelTexture((c, w, h) => {
    c.fillStyle = '#f4f4f0'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#111'; c.lineWidth = 6; c.strokeRect(5, 5, w - 10, h - 10);
    c.fillStyle = '#111'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 17px sans-serif'; c.fillText('SPEED', w / 2, 24); c.fillText('LIMIT', w / 2, 42);
    c.font = 'bold 56px sans-serif'; c.fillText(String(limit), w / 2, 90);
  });
  const mat = new THREE.MeshStandardMaterial({ map: _limitTex[limit], emissive: 0x222222, emissiveMap: _limitTex[limit], roughness: 0.5 });
  mat.userData.snow = { plaster: true };
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.04), mat);
  board.position.set(0, 1.95, 0.04); board.castShadow = true;
  g.add(post, board);
  snowCap(g, 0.6, 0.07, 0.08, 0, 2.34, 0.04);
  return g;
}

// `dir` = unit direction of travel the sign is read from; the face must look back at the
// oncoming driver, i.e. along -dir. A prop with rotation.y = t faces (sin t, cos t).
function place(mesh, x, y, z, dir) {
  mesh.position.set(x, y, z);
  mesh.rotation.y = Math.atan2(-dir.x, -dir.z);
  return mesh;
}


// ---- US-style overhead exit signs over the highway --------------------------------------
// Green panels with white lettering on a gantry that spans the carriageway, placed before each
// exit ramp (an edge with `exit: { no, label }`): two advance signs and one at the gore point.
const _gantryTex = {};
function gantryTexture(exitNo, label, dist, rightExit) {
  const key = [exitNo, label, dist, rightExit].join('|');
  if (_gantryTex[key]) return _gantryTex[key];
  const t = labelTexture((c, w, h) => {
    c.fillStyle = '#0b6b3a'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#fff'; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
    // yellow exit-number tab
    c.fillStyle = '#f2c500'; c.fillRect(24, 24, 150, 48);
    c.fillStyle = '#111'; c.font = 'bold 34px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('EXIT ' + exitNo, 99, 49);
    c.fillStyle = '#fff'; c.textAlign = 'left';
    if (dist) { c.font = 'bold 34px Arial, sans-serif'; c.fillText(dist, 192, 49); }
    c.font = 'bold 62px Arial, sans-serif'; c.fillText(label, 30, 140);
    // arrow
    c.save(); c.translate(w - 80, 130); if (!rightExit) c.scale(-1, 1);
    c.fillStyle = '#fff'; c.beginPath();            // up-right diagonal arrow
    c.moveTo(-34, 34); c.lineTo(-34, 20); c.lineTo(8, -22); c.lineTo(-10, -22); c.lineTo(-10, -36); c.lineTo(36, -36); c.lineTo(36, 10); c.lineTo(22, 10); c.lineTo(22, -8); c.lineTo(-20, 34); c.closePath();
    c.fill(); c.restore();
  }, 512, 200);
  _gantryTex[key] = t;
  return t;
}
const gantryMat = new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.5, metalness: 0.6 });
function gantryMesh(tex, rightSide, W = 9) {
  const g = new THREE.Group();
  [-W, W].forEach(x => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 8.6, 0.45), gantryMat);
    post.position.set(x, 4.3, 0); post.castShadow = true; g.add(post);
  });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.5, 0.5, 0.6), gantryMat);
  beam.position.set(0, 8.3, 0); beam.castShadow = true; g.add(beam);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.25, 0.25), gantryMat);
  brace.position.set(0, 7.9, 0); g.add(brace);
  const pw = 7.6, ph = 3.0, px = rightSide ? W - 4.1 : -(W - 4.1);
  if (!tex) return g;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.12), [
    gantryMat, gantryMat, gantryMat, gantryMat,
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22, roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ color: 0x6f767e, roughness: 0.6, metalness: 0.4 })
  ]);
  panel.position.set(px, 6.3, 0.4); panel.castShadow = true;
  g.add(panel);
  // hanger bars
  [-3, 3].forEach(dx => { const h = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 0.2), gantryMat); h.position.set(px + dx, 7.9, 0.2); g.add(h); });
  return g;
}
function nextTexture(list) {
  const key = 'next|' + list.map(x => x.no + x.label + x.dist).join('|');
  if (_gantryTex[key]) return _gantryTex[key];
  const t = labelTexture((c, w, h) => {
    c.fillStyle = '#0b6b3a'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#fff'; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#fff'; c.font = 'bold 28px Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('NEXT EXITS', 30, 40);
    list.slice(0, 2).forEach((x, i) => {
      const y = 92 + i * 54;
      c.fillStyle = '#f2c500'; c.fillRect(26, y - 21, 112, 42);
      c.fillStyle = '#111'; c.font = 'bold 28px Arial, sans-serif'; c.fillText('EXIT ' + x.no, 34, y + 1);
      c.fillStyle = '#fff'; c.font = 'bold 34px Arial, sans-serif'; c.fillText(x.label, 150, y + 1);
      c.font = 'bold 24px Arial, sans-serif'; c.textAlign = 'right'; c.fillText(x.dist, w - 30, y + 1); c.textAlign = 'left';
    });
  }, 512, 200);
  _gantryTex[key] = t;
  return t;
}
function panelMesh(tex, px) {
  const pw = 7.6, ph = 3.0;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.12), [
    gantryMat, gantryMat, gantryMat, gantryMat,
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22, roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ color: 0x6f767e, roughness: 0.6, metalness: 0.4 })
  ]);
  panel.position.set(px, 6.3, 0.4); panel.castShadow = true;
  return panel;
}
function addGantries(city, heightAt, group, instances, distToRoad) {
  const nodes = city.roadNodes, hw = city.roadEdges.filter(e => e.type === 'highway');
  const hAt = id => hw.filter(e => e.from === id || e.to === id);
  const CORNER = 66;
  const other = (e, id) => (e.from === id ? e.to : e.from);
  const isCorner = id => {
    const es = hAt(id);
    if (es.length !== 2) return false;
    const dir = e => { const o = nodes[other(e, id)], n = nodes[id], l = Math.hypot(o.x - n.x, o.z - n.z) || 1; return [(o.x - n.x) / l, (o.z - n.z) / l]; };
    const a = dir(es[0]), b = dir(es[1]);
    return -(a[0] * b[0] + a[1] * b[1]) < 0.95;
  };
  city.roadEdges.filter(e => e.exit).forEach(ramp => {
    const g0 = nodes[ramp.from], g1 = nodes[ramp.to];
    const rl = Math.hypot(g1.x - g0.x, g1.z - g0.z) || 1;
    const rdir = { x: (g1.x - g0.x) / rl, z: (g1.z - g0.z) / rl };
    // the highway edge arriving at the exit node, heading the same way the ramp leaves
    let first = null, bd = -2;
    hw.forEach(h => [[h.from, h.to], [h.to, h.from]].forEach(([a, b]) => {
      if (b !== ramp.from) return;
      const A = nodes[a], B = nodes[b], l = Math.hypot(B.x - A.x, B.z - A.z) || 1;
      const dot = ((B.x - A.x) / l) * rdir.x + ((B.z - A.z) / l) * rdir.z;
      if (dot > bd) { bd = dot; first = h; }
    }));
    if (!first) return;
    // walk back along the highway from the exit, edge by edge, so signs can sit on earlier straights
    const segs = [];
    let cur = first, b = ramp.from, acc = 0;
    for (let k = 0; k < 12 && cur; k++) {
      const a = other(cur, b), A = nodes[a], B = nodes[b], l = Math.hypot(B.x - A.x, B.z - A.z) || 1;
      segs.push({ a, b, len: l, d: { x: (B.x - A.x) / l, z: (B.z - A.z) / l }, start: acc, aCorner: isCorner(a), bCorner: k > 0 && isCorner(b) });
      acc += l; b = a; cur = hAt(a).find(e => e !== cur);
    }
    const at = s => {
      for (const sg of segs) {
        if (s < sg.start || s > sg.start + sg.len) continue;
        const local = s - sg.start;
        if (sg.aCorner && sg.len - local < CORNER) return null;
        if (sg.bCorner && local < CORNER) return null;
        const B = nodes[sg.b];
        return { x: B.x - sg.d.x * local, z: B.z - sg.d.z * local, d: sg.d };
      }
      return null;
    };
    const firstValid = from => { for (let s = from; s < acc; s += 4) if (at(s)) return s; return null; };
    const sHalf = firstValid(100);
    const sMile = sHalf === null ? null : firstValid(sHalf + 120);
    const spots = [];
    if (sMile !== null) spots.push([sMile, '1 MILE', true]);
    if (sHalf !== null) spots.push([sHalf, '1/2 MILE', true]);
    spots.push([10, '', false]);
    spots.forEach(([s, dist, withNext]) => {
      const p = at(s); if (!p) return;
      const d = p.d, right = { x: -d.z, z: d.x };
      const rightExit = (rdir.x * right.x + rdir.z * right.z) > 0;
      // a gantry's two legs must not stand inside a building (the highway bends away from the chord here and there)
      if ([-9, 9].some(lx => (city.parcels || []).some(q => (q.type === 'building' || q.type === 'water') && pointInPolygon(p.x + right.x * lx, p.z + right.z * lx, q.footprint)))) return;
      if ([-9, 9].some(lx => distToRoad(p.x + right.x * lx, p.z + right.z * lx) < 0.5)) return;      // a leg must not stand on the slip road
      const mesh = gantryMesh(gantryTexture(ramp.exit.no, ramp.exit.label, dist, rightExit), true);
      if (withNext && ramp.exit.next) mesh.add(panelMesh(nextTexture(ramp.exit.next), -4.9));
      mesh.position.set(p.x, heightAt(p.x, p.z), p.z);
      mesh.rotation.y = Math.atan2(-d.x, -d.z);
      group.add(mesh);
      [-9, 9].forEach(lx => {
        instances.push({ type: 'gantry', x: p.x + right.x * lx, z: p.z + right.z * lx, mesh });
      });
    });
  });
  // boards for the other carriageway: every direction also gets "next exits" gantries for the exits ahead of it
  (city.hwSigns || []).forEach(h => {
    const right = { x: -h.d.z, z: h.d.x };
    if ([-9, 9].some(lx => (city.parcels || []).some(q => (q.type === 'building' || q.type === 'water') && pointInPolygon(h.x + right.x * lx, h.z + right.z * lx, q.footprint)))) return;
    if ([-9, 9].some(lx => distToRoad(h.x + right.x * lx, h.z + right.z * lx) < 0.5)) return;
    const mesh = gantryMesh(null, true);
    mesh.add(panelMesh(nextTexture(h.next), 0));
    [-3, 3].forEach(dx => { const hb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 0.2), gantryMat); hb.position.set(dx, 7.9, 0.2); mesh.add(hb); });
    mesh.position.set(h.x, heightAt(h.x, h.z), h.z);
    mesh.rotation.y = Math.atan2(-h.d.x, -h.d.z);
    group.add(mesh);
    [-9, 9].forEach(lx => instances.push({ type: 'gantry', x: h.x + right.x * lx, z: h.z + right.z * lx, mesh }));
  });
}

export function buildSigns(city, heightAt, mapPaths) {
  const solid = (city.parcels || []).filter(p => p.type === 'building' || p.type === 'water');
  const inSolid = (x, z) => solid.some(p => pointInPolygon(x, z, p.footprint));
  const distToRoad = makeRoadClearance(mapPaths);
  const MARGIN = 0.9;     // post centre must be at least this far off any road surface
  const group = new THREE.Group();
  const instances = [];
  const add = (mesh, x, z) => { collapse(mesh); group.add(mesh); instances.push({ type: 'signpost', x, z, mesh }); };
  const nodes = city.roadNodes;
  const byNode = buildEdgesByNode(city.roadEdges);
  const { stops } = computeStopApproaches(city);

  // --- stop signs: right of the approach lane, just before the stop line ------------
  stops.forEach(key => {
    const [nodeId, edgeId] = key.split('|');
    const e = city.roadEdges.find(x => x.id === edgeId);
    const other = nodes[e.from === nodeId ? e.to : e.from], n = nodes[nodeId];
    const len = Math.hypot(n.x - other.x, n.z - other.z);
    const d = { x: (n.x - other.x) / len, z: (n.z - other.z) / len };   // direction of travel toward the node
    const right = { x: -d.z, z: d.x };
    const back = intersectionClearance(nodeId, e, byNode) + 1.8;
    const lat = e.width / 2 + 0.9;
    // nudge along / out from the kerb until the post is clear of every road (a crossing street,
    // a slip road at an angle...) rather than standing in one
    let x = 0, z = 0, ok = false;
    for (const db of [0, 1.5, 3, -1.5, 4.5]) for (const dl of [0, 0.8, 1.6, 2.6, 4]) {
      if (ok) break;
      x = n.x - d.x * (back + db) + right.x * (lat + dl); z = n.z - d.z * (back + db) + right.z * (lat + dl);
      ok = distToRoad(x, z) >= MARGIN && !inSolid(x, z);
    }
    if (!ok) return;
    add(place(stopSignMesh(), x, heightAt(x, z), z, d), x, z);
  });

  // --- speed limit signs ---------------------------------------------------------------
  const isJunction = id => (byNode[id] || []).length >= 3;
  const bendTrim = e => (e.type === 'highway' ? 62 : e.type === 'avenue' ? 14 : 10);
  city.roadEdges.forEach(e => {
    if (e.structure === 'bridge' || e.structure === 'tunnel') return;
    const a = nodes[e.from], b = nodes[e.to];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const u = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    const startMargin = isJunction(e.from) ? 28 : bendTrim(e) + 8;
    const endMargin = isJunction(e.to) ? 28 : bendTrim(e) + 8;
    if (len - startMargin - endMargin < 12) return;
    const limit = speedLimitFor(e);
    const lat = e.width / 2 + (e.type === 'highway' ? 1.6 : 1.1);
    const spacing = e.type === 'highway' ? 200 : 140;
    // forward direction (from -> to): signs sit just after the entry margin, repeated.
    const dirs = e.oneWay ? [1] : [1, -1];
    dirs.forEach(sgn => {
      const dvec = { x: u.x * sgn, z: u.z * sgn };
      const right = { x: -dvec.z, z: dvec.x };
      const entry = sgn === 1 ? startMargin : endMargin;
      const exit = sgn === 1 ? endMargin : startMargin;
      for (let s = entry; s <= len - exit; s += spacing) {
        const p = sgn === 1 ? s : len - s;
        let x = a.x + u.x * p + right.x * lat, z = a.z + u.z * p + right.z * lat;
        for (let k = 0; k < 6 && (distToRoad(x, z) < MARGIN || inSolid(x, z)); k++) { x += right.x * 0.8; z += right.z * 0.8; }
        if (distToRoad(x, z) < MARGIN || distToRoad(x, z) > 8 || inSolid(x, z)) continue;
        add(place(speedSignMesh(limit), x, heightAt(x, z), z, dvec), x, z);
      }
    });
  });
  addGantries(city, heightAt, group, instances, distToRoad);
  return { group, instances };
}
