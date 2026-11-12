// Seasons. A year is 28 game days: four seasons of 7 days (spring, summer, autumn, winter), each three months of the calendar (the date shows
// the month, not a day of the month). A new game starts on the first day of summer. Everything seasonal reads the same year phase `yp` (0..1):
//   - weather.js: the average temperature follows the year, winter has far fewer wet days (so it is not snowing all the time);
//   - trees: fresh light green in spring, deep green in summer, yellow / orange / red in autumn, brown, then bare in winter (the merged
//     leaf meshes are hidden; the bare boughs stay), spring buds again;
//   - leaves lie on the ground under the trees from mid autumn and thin out through the first days of winter;
//   - the grass turns straw coloured in autumn and dull in winter (env.setGroundTint).
import * as THREE from 'three';
import { LEAF } from './generators/props.js';

export const YEAR_DAYS = 28, SEASON_DAYS = 7, START_OFFSET = 7;          // day 0 = first day of summer
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const MONTHS = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'];       // spring starts in March
export const MONTHS_LONG = ['March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February'];

export function seasonAt(day, hour = 12) {
  const d = (((Math.floor(day) + START_OFFSET) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS, yp = (d + hour / 24) / YEAR_DAYS;
  const si = Math.min(3, Math.floor(yp * 4)), month = Math.min(11, Math.floor(yp * 12));
  return { yp, index: si, name: SEASONS[si], t: yp * 4 - si, month, monthName: MONTHS[month], monthLong: MONTHS_LONG[month], dayInSeason: d - si * SEASON_DAYS };
}
// average temperature (deg C) for the year phase: about 25 in mid summer, -3 in mid winter, 11 in the shoulder seasons
export const meanTemp = yp => 11 + 14 * Math.cos(2 * Math.PI * (yp - 0.375));

const C = h => new THREE.Color(h), tmp = new THREE.Color(), BROWN = C(0x6b4a2a), SPRING = C(0x86c765);
// -> { leaves: 0 (bare) .. 1 (full), colour factor per variety is computed by leafColor }
export function leafState(yp) {
  if (yp < 0.03) return { shown: false, aut: 0, spring: 0 };                                // winter's end: still bare
  if (yp < 0.25) return { shown: true, aut: 0, spring: 1 - (yp - 0.03) / 0.22 };            // spring: light green deepening to summer's
  if (yp < 0.5) return { shown: true, aut: 0, spring: 0 };
  if (yp < 0.5 + 0.25 * 0.9) return { shown: true, aut: (yp - 0.5) / (0.25 * 0.9), spring: 0 };
  return { shown: false, aut: 1, spring: 0 };                                                // the last tenth of autumn and all of winter: bare
}
function leafColor(L, ls, out) {
  const base = tmp.set(L.base);
  if (ls.spring > 0) return out.copy(base).lerp(SPRING, ls.spring * 0.8);
  const a = ls.aut;
  if (a <= 0) return out.copy(base);
  const fall = C(L.fall);
  if (a < 0.28) return out.copy(base).lerp(fall.clone().lerp(C(0xc9bd3a), 0.35), a / 0.28);       // green going yellow
  if (a < 0.75) return out.copy(fall).lerp(C(0xb53a1e), Math.sin((a - 0.28) / 0.47 * Math.PI) * 0.35);       // the full colour, a little redder in the middle
  return out.copy(fall).lerp(BROWN, (a - 0.75) / 0.25);                                            // going brown before it drops
}

export function createSeasons({ propGroup, env, scene }) {
  const leafMeshes = (propGroup && propGroup.userData.leafMeshes) || [], trees = (propGroup && propGroup.userData.trees) || [];
  // ---- fallen leaves: eight flat leaf-sized quads scattered under each tree, one instanced mesh for the whole city
  let piles = null;
  const PER = 8;
  if (trees.length) {
    const geo = new THREE.PlaneGeometry(0.42, 0.3); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide });
    piles = new THREE.InstancedMesh(geo, mat, trees.length * PER);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
    const pal = [0xd9b02a, 0xc4452a, 0xd2761f, 0x9a5a2a, 0xb8932a, 0x8a3b1e];
    let rs = 4242; const rnd = () => (rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296;
    let n = 0;
    trees.forEach(([x, z, r]) => {
      for (let i = 0; i < PER; i++) {
        const ang = rnd() * Math.PI * 2, d = 0.5 + Math.sqrt(rnd()) * r * 1.5;
        pos.set(x + Math.cos(ang) * d, 0.06 + rnd() * 0.01, z + Math.sin(ang) * d); e.set(0, rnd() * Math.PI * 2, 0); q.setFromEuler(e); const s = 0.8 + rnd() * 0.8; sc.set(s, 1, s);
        m.compose(pos, q, sc); piles.setMatrixAt(n, m); col.setHex(pal[Math.floor(rnd() * pal.length)]); piles.setColorAt(n, col); n++;
      }
    });
    piles.instanceMatrix.needsUpdate = true; if (piles.instanceColor) piles.instanceColor.needsUpdate = true;
    piles.frustumCulled = false; piles.visible = false; piles.castShadow = false; piles.receiveShadow = false;
    piles.name = 'fallen leaves'; piles.userData.live = true;
    (scene || propGroup).add(piles);
  }
  let lastKey = '';
  function apply(sea) {
    if (!sea) return;
    const ls = leafState(sea.yp), key = Math.round(sea.yp * 2000) + ':' + (ls.shown ? 1 : 0);
    if (key === lastKey) return; lastKey = key;
    const col = new THREE.Color();
    Object.values(LEAF).forEach(mat => { const L = mat.userData.leaf; mat.color.copy(leafColor(L, ls, col)); });
    // trees go bare in winter; bushes keep their (browned) leaves
    leafMeshes.forEach(mm => { mm.visible = ls.shown; });
    // leaves on the ground: from the middle of autumn until the first week of winter is mostly over
    const yp = sea.yp, amt = yp < 0.56 ? 0 : yp < 0.78 ? (yp - 0.56) / 0.22 : yp < 0.9 ? 1 - (yp - 0.78) / 0.12 : 0;
    if (piles) { piles.visible = amt > 0.03; piles.count = Math.round(trees.length * PER * Math.min(1, amt * 1.1)); }
    // the grass
    if (env && env.setGroundTint) {
      let tint = null, k = 0;
      if (yp >= 0.5 && yp < 0.75) { tint = 0x9a8a3c; k = Math.min(0.55, (yp - 0.5) / 0.25 * 0.7); }                  // straw coloured
      else if (yp >= 0.75) { tint = 0x7d7a62; k = 0.55; }                                                            // winter: dull
      else if (yp < 0.08) { tint = 0x7d7a62; k = 0.55 * (1 - yp / 0.08); }
      else if (yp < 0.25) { tint = 0x7bc35a; k = 0.12; }                                                              // spring: fresh
      env.setGroundTint(tint, k);
    }
  }
  return { apply, piles, get leafMeshes() { return leafMeshes; } };
}
