// The container terminal: a rectangular deck out in the lake (map.port lists it, tools/add_port.py makes it) with a ring road round it.
// Inside the ring: stacks of shipping containers in blocks with lanes between, two hangars and a few pallet-lorry bays. On the quay: gantry
// cranes that really work (the trolley runs out along the boom, the spreader lowers a container and lifts it again). Moored alongside:
// a container ship stacked with containers and an oil tanker with domes and pipework. Everything is instanced, so it is cheap.
import * as THREE from 'three';

const rngOf = seed => { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONT_COLORS = [0xc0392b, 0x2e6fb7, 0xe0a82e, 0x2f8f5b, 0xd9d9d4, 0x8a4b2a, 0x1f3b5c, 0xd2691e, 0x6b7a8f, 0xb23a48];

export function createPort({ city, scene, collisionWorld }) {
  const list = (city.harbour && city.harbour.port) || [];
  const live = [];         // things that animate: {fn(t, dt)}
  const lamps = [];
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffd37a, emissiveIntensity: 0, roughness: 0.4 });
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.7, metalness: 0.15 }, o));
  const quadOf = (cx, cz, hx, hz) => [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]];
  const collide = (cx, cz, hx, hz) => { if (collisionWorld) collisionWorld.push({ kind: 'parcel', footprint: quadOf(cx, cz, hx, hz), blocksCar: true, destructible: false, response: 'bounce', destroyed: false }); };

  list.forEach((P, pi) => {
    const rnd = rngOf(9917 + pi * 31);
    const g = new THREE.Group(); g.name = 'port'; scene.add(g);
    const xs = P.footprint.map(p => p[0]), zs = P.footprint.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const DECK_Y = 0.12;
    // world: east (the lake) is -x, so the water side is x0; the entry road comes in from +x (land)
    const RING = 16 * 2.5 + 8;                    // from the deck edge to the inner side of the ring road
    const ix0 = x0 + RING + 6, ix1 = x1 - RING - 6, iz0 = z0 + RING + 6, iz1 = z1 - RING - 6;

    // ---- ground markings: the quay apron, lane paint ----
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat(0x8c8f92, { roughness: 0.95 })); apron.rotation.x = -Math.PI / 2; apron.position.set(cx, DECK_Y + 0.02, cz); apron.receiveShadow = true; g.add(apron);
    // ---- container blocks ----
    const CW = 5.0, CD = 2.0, CH = 2.1, BX = 11, BZ = 9;                  // a block: 11 containers long (along x), 9 rows deep (along z)
    const bw = BX * (CW + 0.25), bd = BZ * (CD + 0.25), LANE = 9;
    const instances = [];
    const HANG_W = 34, HANG_D = 72;                                       // hangars take the land-side corners
    const hangars = [[ix1 - HANG_W / 2 - 2, iz0 + HANG_D / 2 + 4], [ix1 - HANG_W / 2 - 2, iz1 - HANG_D / 2 - 4]];
    const blocks = [];
    for (let bx = ix0 + 6; bx + bw <= ix1 - HANG_W - 8; bx += bw + LANE) for (let bz = iz0 + 4; bz + bd <= iz1 - 2; bz += bd + LANE) {
      if (rnd() < 0.12) continue;
      blocks.push([bx + bw / 2, bz + bd / 2]);
      const hmax = 1 + Math.floor(rnd() * 4);
      for (let i = 0; i < BX; i++) for (let j = 0; j < BZ; j++) {
        const hgt = Math.max(1, Math.min(4, hmax - (rnd() < 0.3 ? 1 : 0) - (rnd() < 0.1 ? 1 : 0))), col = CONT_COLORS[Math.floor(rnd() * CONT_COLORS.length)];
        for (let k = 0; k < hgt; k++) instances.push([bx + (i + 0.5) * (CW + 0.25), DECK_Y + CH / 2 + k * CH, bz + (j + 0.5) * (CD + 0.25), col, rnd() < 0.5 ? 0 : 1]);
      }
      collide(bx + bw / 2, bz + bd / 2, bw / 2, bd / 2);
    }
    const contMesh = (arr) => {
      const im = new THREE.InstancedMesh(BOX, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.25 }), arr.length), m4 = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion(), sc = new THREE.Vector3(CW, CH - 0.06, CD), pos = new THREE.Vector3();
      arr.forEach((a, i) => { pos.set(a[0], a[1], a[2]); m4.compose(pos, q.identity(), sc); im.setMatrixAt(i, m4); c.setHex(a[3]); im.setColorAt(i, c); });
      im.castShadow = true; im.receiveShadow = true; return im;
    };
    g.add(contMesh(instances));
    // ---- hangars: a long low shed with a curved roof and big doors ----
    hangars.forEach(([hx, hz]) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(HANG_W, 9, HANG_D), mat(0xb9bec4)); wall.position.set(hx, DECK_Y + 4.5, hz); wall.castShadow = true; g.add(wall);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(HANG_W / 2, HANG_W / 2, HANG_D, 14, 1, false, -Math.PI / 2, Math.PI), mat(0x8f979e)); roof.scale.set(1, 1, 0.36); roof.position.set(hx, DECK_Y + 9, hz); roof.rotation.set(-Math.PI / 2, 0, 0); g.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.5, HANG_D * 0.7), mat(0x39434e)); door.position.set(hx - HANG_W / 2 - 0.1, DECK_Y + 3.3, hz); g.add(door);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, HANG_D), mat(0xd2493b)); stripe.position.set(hx - HANG_W / 2 - 0.05, DECK_Y + 8, hz); g.add(stripe);
      collide(hx, hz, HANG_W / 2, HANG_D / 2);
    });
    // ---- bollards along the quay ----
    { const pts = []; for (let z = z0 + 4; z <= z1 - 4; z += 14) pts.push([x0 + 2, z]); for (let x = x0 + 4; x <= x1 - 4; x += 14) { pts.push([x, z0 + 2]); pts.push([x, z1 - 2]); }
      const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.65, 1.3, 8), mat(0x22262b), pts.length), m4 = new THREE.Matrix4(); pts.forEach((p, i) => { m4.makeTranslation(p[0], DECK_Y + 0.65, p[1]); im.setMatrixAt(i, m4); }); g.add(im); }
    // ---- gantry cranes ----
    const crane = (px, pz, outward, phase, color) => {          // outward: yaw so that local +z points over the water
      const c = new THREE.Group(), M = mat(color, { roughness: 0.55 }), D = mat(0x30353b);
      const H = 30;
      [[-8, -7], [8, -7], [-8, 7], [8, 7]].forEach(([lx, lz]) => { const leg = new THREE.Mesh(new THREE.BoxGeometry(1.3, H, 1.3), M); leg.position.set(lx, H / 2, lz); leg.castShadow = true; c.add(leg); });
      [[-8, 0], [8, 0]].forEach(([lx]) => { const t = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 14), M); t.position.set(lx, H * 0.55, 0); c.add(t); });
      const top = new THREE.Mesh(new THREE.BoxGeometry(18, 1.8, 18), M); top.position.set(0, H, 0); c.add(top);
      const boom = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.8, 74), M); boom.position.set(0, H + 1.6, 14); boom.castShadow = true; c.add(boom);
      const back = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.8, 24), M); back.position.set(0, H + 1.6, -17); c.add(back);
      const house = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 7), D); house.position.set(0, H + 3.4, -14); c.add(house);
      const stay = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 44), D); stay.position.set(0, H + 12, 12); stay.rotation.x = 0.0; c.add(stay);
      const mast = new THREE.Mesh(new THREE.BoxGeometry(1.2, 14, 1.2), M); mast.position.set(0, H + 8, 2); c.add(mast);
      const stayF = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 41), D); stayF.position.set(0, H + 6.8, 21); stayF.rotation.x = -0.34; c.add(stayF);
      const stayB = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 21), D); stayB.position.set(0, H + 6.8, -9); stayB.rotation.x = 0.55; c.add(stayB);
      const trolley = new THREE.Group(); c.add(trolley);
      const tb = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.6, 3.6), D); tb.position.y = H + 0.2; trolley.add(tb);
      const rope = new THREE.Mesh(BOX, D); rope.scale.set(0.12, 1, 0.12); trolley.add(rope);
      const spreader = new THREE.Group(); trolley.add(spreader);
      const sp = new THREE.Mesh(BOX, D); sp.scale.set(2.2, 0.35, 5); spreader.add(sp);
      const box = new THREE.Mesh(BOX, mat(CONT_COLORS[Math.floor(rnd() * CONT_COLORS.length)])); box.scale.set(2, 2.05, 4.9); box.position.y = -1.2; spreader.add(box);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), lampMat); beacon.position.set(0, H + 3, 26); c.add(beacon); lamps.push(beacon);
      [-4, 4].forEach(lx => { const fl = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lampMat); fl.position.set(lx, H - 1, 0); c.add(fl); });
      c.position.set(px, DECK_Y, pz); c.rotation.y = outward; g.add(c);
      [[-8, -7], [8, -7], [-8, 7], [8, 7]].forEach(([lx, lz]) => { const wx = px + lx * Math.cos(outward) + lz * Math.sin(outward), wz = pz - lx * Math.sin(outward) + lz * Math.cos(outward); collide(wx, wz, 1.1, 1.1); });
      live.push((t) => {
        const k = (t * 0.045 + phase) % 1, tri = k < 0.5 ? k * 2 : 2 - k * 2;               // out and back along the boom
        const tz = 8 + 30 * (0.5 - 0.5 * Math.cos(tri * Math.PI)), drop = 0.5 + 0.5 * Math.sin(t * 0.22 + phase * 6.28);
        trolley.position.z = tz; const hang = 4 + drop * (H - 8);
        spreader.position.y = H - 1.5 - hang; rope.scale.y = hang; rope.position.y = H - 0.5 - hang / 2;
        box.visible = Math.sin(t * 0.11 + phase * 3) > -0.2;
      });
      return c;
    };
    const yawW = Math.atan2(-1, 0);                      // local +z -> world -x (towards the lake)
    const quayX = x0 + 20;
    [z0 + (z1 - z0) * 0.22, z0 + (z1 - z0) * 0.5, z0 + (z1 - z0) * 0.78].forEach((zz, i) => crane(quayX, zz, yawW, i * 0.31, i % 2 ? 0x2a6db8 : 0xd8392b));
    // ---- ships ----
    const hullGeo = (L, W, H, bowK = 0.22) => {            // top outline: blunt stern, pointed bow (+x)
      const s = new THREE.Shape(), hl = L / 2, hw = W / 2;
      s.moveTo(-hl, -hw * 0.92); s.lineTo(hl * (1 - bowK), -hw); s.quadraticCurveTo(hl, -hw * 0.45, hl, 0); s.quadraticCurveTo(hl, hw * 0.45, hl * (1 - bowK), hw); s.lineTo(-hl, hw * 0.92); s.closePath();
      const e = new THREE.ExtrudeGeometry(s, { depth: H, bevelEnabled: false }); e.rotateX(-Math.PI / 2); return e;
    };
    const ship = (kind, L, W, x, z, yaw) => {
      const sh = new THREE.Group(), H = 11, DRAFT = 4;
      const hull = new THREE.Mesh(hullGeo(L, W, H), mat(kind === 'tanker' ? 0x1c2430 : 0x1d2b4a, { roughness: 0.6 })); hull.position.y = -DRAFT; hull.castShadow = true; sh.add(hull);
      const boot = new THREE.Mesh(hullGeo(L * 0.998, W * 1.004, 1.8), mat(kind === 'tanker' ? 0xa8281f : 0xb02e26)); boot.position.y = -0.4; sh.add(boot);
      const deck = new THREE.Mesh(hullGeo(L * 0.985, W * 0.98, 0.3), mat(kind === 'tanker' ? 0x6d2a22 : 0x4f5a66)); deck.position.y = H - DRAFT; sh.add(deck);
      const bridgeX = -L / 2 + 20;
      const sup = new THREE.Mesh(BOX, mat(0xeeeeea)); sup.scale.set(18, kind === 'tanker' ? 17 : 22, W * 0.8); sup.position.set(bridgeX, H - DRAFT + (kind === 'tanker' ? 8.5 : 11), 0); sup.castShadow = true; sh.add(sup);
      const win = new THREE.Mesh(BOX, mat(0x1e2a36)); win.scale.set(0.3, 2.2, W * 0.75); win.position.set(bridgeX + 9.1, H - DRAFT + (kind === 'tanker' ? 14.5 : 19), 0); sh.add(win);
      const funnel = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 7, 10), mat(kind === 'tanker' ? 0xc2352a : 0x2a6db8)); funnel.position.set(bridgeX - 3, H - DRAFT + (kind === 'tanker' ? 20 : 25), 0); sh.add(funnel);
      if (kind === 'container') {
        const arr = [], span = L - 52, ncol = Math.floor(span / (CW + 0.3)), nrow = 7;
        for (let i = 0; i < ncol; i++) { const hgt = 3 + Math.floor(rnd() * 3); for (let j = 0; j < nrow; j++) for (let k = 0; k < hgt - (j === 0 || j === nrow - 1 ? 1 : 0); k++) arr.push([ -L / 2 + 38 + (i + 0.5) * (CW + 0.3) + 0 - 0, H - DRAFT + 0.2 + CH / 2 + k * CH, (j - (nrow - 1) / 2) * (CD + 0.28), CONT_COLORS[Math.floor(rnd() * CONT_COLORS.length)]]); }
        sh.add(contMesh(arr));
      } else {
        for (let i = 0; i < 5; i++) { const dome = new THREE.Mesh(new THREE.SphereGeometry(4.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xcfd3d6)); dome.position.set(-L / 2 + 44 + i * 24, H - DRAFT + 0.3, 0); sh.add(dome); }
        [-2.4, 2.4].forEach(zz => { const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, L - 60, 8), mat(0x8f9aa5)); pipe.rotation.z = Math.PI / 2; pipe.position.set(8, H - DRAFT + 1.4, zz); sh.add(pipe); });
        const walk = new THREE.Mesh(BOX, mat(0xd6c34a)); walk.scale.set(L - 62, 0.2, 1.5); walk.position.set(8, H - DRAFT + 1.0, 0); sh.add(walk);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 14, 6), mat(0xdddddd)); mast.position.set(L / 2 - 20, H - DRAFT + 7, 0); sh.add(mast);
      }
      const nav = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), lampMat); nav.position.set(bridgeX, H - DRAFT + (kind === 'tanker' ? 18 : 23), 0); sh.add(nav); lamps.push(nav);
      sh.position.set(x, 0.05, z); sh.rotation.y = yaw; g.add(sh);
      const ph = rnd() * 6;
      live.push((t) => { sh.position.y = 0.05 + Math.sin(t * 0.9 + ph) * 0.12; sh.rotation.z = Math.sin(t * 0.6 + ph) * 0.006; });
      return sh;
    };
    // the container ship lies along the quay (east side), bow towards +z (north); the tanker lies along the south side
    ship('container', 164, 26, x0 - 16, cz + (z1 - z0) * 0.04, -Math.PI / 2);
    ship('tanker', 176, 28, cx - 20, z0 - 18, Math.PI);
    live.__g = g;
  });
  let t = 0;
  return {
    list,
    update(dt, night = 1) {
      if (!list.length) return;
      t += dt; lampMat.emissiveIntensity = 0.1 + 2.0 * night;
      live.forEach(f => f(t));
    }
  };
}
