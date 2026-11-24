// Share identical geometries and materials across a scene subtree. Props are built one by one, each with its own new
// geometry and material, so thousands of identical copies sat in memory (enough to crash Safari on an iPhone). Meshes keep
// their own position and can still be knocked over; only the shared data underneath is reused.
// Materials or geometries that a group lists in its userData (traffic-light lenses, lamp lenses, ...) are changed at run
// time on their own and are left alone.
function protectedSet(root) {
  const keep = new Set();
  const grab = (v, depth) => {
    if (!v || depth > 3) return;
    if (v.isMaterial || v.isBufferGeometry) { keep.add(v); return; }
    if (v.isObject3D) { v.traverse(o => { if (o.material) [].concat(o.material).forEach(m => keep.add(m)); }); return; }
    if (Array.isArray(v)) v.forEach(x => grab(x, depth + 1));
    else if (typeof v === 'object') Object.values(v).forEach(x => grab(x, depth + 1));
  };
  const MOVED_ONLY = new Set(['parts', 'lampAnchors']);   // these are pieces that get moved (knocked over), never recoloured: sharing their data is safe
  root.traverse(o => { if (o.userData) for (const k in o.userData) if (!MOVED_ONLY.has(k)) grab(o.userData[k], 1); });
  return keep;
}
const hex = c => (c && c.getHex ? c.getHex() : c);
function matKey(m) {
  if (Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile')) return null;   // a material with its own shader tweak
  if (m.userData && Object.keys(m.userData).length) return null;
  return [m.type, hex(m.color), hex(m.emissive), m.emissiveIntensity, m.roughness, m.metalness, m.transparent, m.opacity, m.side, m.map && m.map.uuid,
    m.emissiveMap && m.emissiveMap.uuid, m.vertexColors, m.flatShading, m.depthWrite, m.depthTest, m.toneMapped, m.fog, m.blending, m.alphaTest, m.wireframe, m.polygonOffset, m.polygonOffsetFactor].join('|');
}
function geoKey(g) {
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return null;
  if (g.parameters && g.type !== 'BufferGeometry') return g.type + JSON.stringify(g.parameters) + (g.index ? 'i' : '') + g.attributes.position.count + '|' + hashArr(g.attributes.position.array);
  let k = 'B' + (g.index ? 'i' + g.index.count + '|' + hashArr(g.index.array) : '');
  for (const name of Object.keys(g.attributes).sort()) { const a = g.attributes[name]; if (a.isInterleavedBufferAttribute) return null; k += '|' + name + a.itemSize + ':' + a.count + ':' + hashArr(a.array); }
  return k;
}
function hashArr(arr) {          // FNV-1a over the raw bytes
  const u = new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
  let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + u.length;
}
export function dedupe(root) {
  const keep = protectedSet(root), mats = new Map(), geos = new Map();
  let mSaved = 0, gSaved = 0, bytes = 0;
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    if (!Array.isArray(o.material) && !keep.has(o.material)) {
      const k = matKey(o.material);
      if (k) { const m = mats.get(k); if (m && m !== o.material) { o.material.dispose(); o.material = m; mSaved++; } else if (!m) mats.set(k, o.material); }
    }
    const g = o.geometry;
    if (g && !keep.has(g)) {
      const k = geoKey(g);
      if (k) { const h = geos.get(k); if (h && h !== g) { for (const n in g.attributes) bytes += g.attributes[n].array.byteLength; g.dispose(); o.geometry = h; gSaved++; } else if (!h) geos.set(k, g); }
    }
  });
  return { materials: mSaved, geometries: gSaved, mb: Math.round(bytes / 1e5) / 10 };
}

// Once the static city (roads, buildings, ground) is on the GPU, its vertex arrays are not needed in JavaScript any more:
// they were about half of the page's memory. Each attribute frees its array right after it is uploaded.
// (Without the arrays a lost WebGL context cannot be rebuilt, so main.js reloads the page if that happens.)
export function freeAfterUpload(roots) {
  const done = new Set(); let bytes = 0;
  const free = function () { this.array = null; };
  roots.forEach(root => root && root.traverse(o => {
    const g = o.geometry; if (!o.isMesh || !g || done.has(g) || g.morphAttributes && Object.keys(g.morphAttributes).length) return;
    done.add(g);
    if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox();
    for (const n in g.attributes) { const a = g.attributes[n]; if (a.isInterleavedBufferAttribute || a.usage !== 35044) continue; bytes += a.array.byteLength; a.onUpload(free); }
    if (g.index) { bytes += g.index.array.byteLength; g.index.onUpload(free); }
  }));
  return Math.round(bytes / 1e6);
}
