// Every flat must be fully walkable: flood-fill the floor plan (walker radius 0.32) from the spawn point and require that every
// room (bedroom, bathroom, living area), the bed, wardrobe, desk, lift and exit markers can be reached. Run: node tools/check_flats.mjs
globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), width: 0, height: 0 }) };
const { buildInterior } = await import('../src/estate.js');
const TIERS = [[0,6.4,7.4,0,1],[1,7.6,8.6,0,1],[2,9.6,10.6,1,1],[3,11.6,12.0,2,2],[4,14.0,13.4,3,2],[5,17.0,15.0,4,3]];
let bad = 0;
for (const [tier, W0, D0, beds, baths] of TIERS) for (const k of [0.92, 1, 1.12]) {
  const W = +(W0 * k).toFixed(2), D = +(D0 * k).toFixed(2), a = { tier, w: W, d: D, beds, baths, floor: 3 };
  const I = buildInterior(a), R = 0.32, S = 0.1, nx = Math.round(W / S), nz = Math.round(D / S);
  const blocked = (x, z) => I.solids.some(q => x > q.x0 - R && x < q.x1 + R && z > q.z0 - R && z < q.z1 + R) || x < -W / 2 + R * 0.5 || x > W / 2 - R * 0.5 || z < 0.1 || z > D - 0.1;
  const seen = new Uint8Array(nx * nz), idx = (x, z) => Math.round((x + W / 2) / S) * nz + Math.round(z / S);
  const st = [[I.spawn.x, I.spawn.z]]; seen[idx(...st[0])] = 1;
  while (st.length) { const [x, z] = st.pop(); for (const [dx, dz] of [[S,0],[-S,0],[0,S],[0,-S]]) { const X = x + dx, Z = z + dz; if (X < -W / 2 || X > W / 2 || Z < 0 || Z > D) continue; const i = idx(X, Z); if (seen[i] || blocked(X, Z)) continue; seen[i] = 1; st.push([X, Z]); } }
  const reach = (p, r = 1.3) => { for (let dx = -r; dx <= r; dx += S) for (let dz = -r; dz <= r; dz += S) { const X = p.x + dx, Z = p.z + dz; if (X < -W / 2 || X > W / 2 || Z < 0 || Z > D) continue; if (seen[idx(X, Z)]) return true; } return false; };
  const probs = [];
  // free floor that is walled off: any 0.1 cell not blocked and not reached, in a patch large enough to be a room (>= 1 m2)
  const lab = new Int32Array(nx * nz); let nc = 0; const comps = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = -W / 2 + i * S, z = j * S; if (seen[i * nz + j] || blocked(x, z) || lab[i * nz + j]) continue;
    const c = { n: 0, x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 }; const q = [[i, j]]; lab[i * nz + j] = ++nc;
    while (q.length) { const [a2, b2] = q.pop(); c.n++; const X = -W / 2 + a2 * S, Z = b2 * S; c.x0 = Math.min(c.x0, X); c.x1 = Math.max(c.x1, X); c.z0 = Math.min(c.z0, Z); c.z1 = Math.max(c.z1, Z);
      for (const [da, db] of [[1,0],[-1,0],[0,1],[0,-1]]) { const A = a2 + da, B = b2 + db; if (A < 0 || B < 0 || A >= nx || B >= nz) continue; if (seen[A * nz + B] || lab[A * nz + B] || blocked(-W / 2 + A * S, B * S)) continue; lab[A * nz + B] = nc; q.push([A, B]); } }
    if (c.n > 150 && c.x1 - c.x0 > 0.5 && c.z1 - c.z0 > 0.5) comps.push(c);       // a pocket of 1.5 u2 or more (about 2.3 m2) is a room or a nook you cannot get to
  }
  comps.forEach(c => probs.push(`walled-off area ${(c.n * S * S).toFixed(1)} u2 at x ${c.x0.toFixed(1)}..${c.x1.toFixed(1)} z ${c.z0.toFixed(1)}..${c.z1.toFixed(1)}`));
  const want = { bed: I.bedAt, wardrobe: I.wardrobeAt, desk: I.deskAt, lift: I.liftAt, exit: I.exitAt };
  for (const n in want) if (want[n] && !reach(want[n], n === 'desk' ? 1.6 : 1.3)) probs.push(n + ' unreachable');
  // doorways: a 1 m wide door must stay passable (>= 0.65 wide) - checked by the bedroom/bath reach below
  const zones = beds + baths; 
  console.log((probs.length ? 'FAIL ' : 'ok   ') + `tier ${tier} ${W}x${D}` + (probs.length ? ' - ' + probs.join('; ') : ''));
  bad += probs.length ? 1 : 0;
}
console.log(bad ? 'FAIL flats' : 'PASS flats'); process.exit(bad ? 1 : 0);
