// The city map. All of it is data (mapdata.json, traced from the street map the user supplied by tools/build_mapdata.py, and
// editable in the studio). Coordinates in the data are "map px" (reference image px x 2.3); T() turns them into world units:
// x is flipped (the game's minimap draws east on the right = -x) and z points north.
// The exports are live bindings: setMapData() swaps the whole map (the studio does this to preview an edit).
import DEFAULT_MAP from './mapdata.js';
import { spline, offsetPoly, ribbonPoly, nearestOnPoly, pointInPoly, distToSeg, dist, polyLen, atLen } from './geom.js';

export const S = 2.5;
export let X0 = 450, Y0 = 900;
export const T = (X, Y) => [-(X - X0) * S, (Y0 - Y) * S];
export const TP = pts => pts.map(p => T(p[0], p[1]));
export const fromWorld = (x, z) => [X0 - x / S, Y0 - z / S];

export const CUSTOM_KEY = 'gridlock-custom-v1';
export let MAP = DEFAULT_MAP;
export let LAKES = [], RIVERS = [], PARKS = [], LANDMARKS = [], DECKS = [], STADIUM = { cx: 0, cy: 0, rx: 1, ry: 1 }, DISTRICTS = [], HIGHWAY_PX = [], STREETS = [], IXS = [];
export let SPOTS = { shops: [], stations: [], gas: [] };

export function setMapData(md) {
  MAP = md;
  X0 = md.origin[0]; Y0 = md.origin[1];
  LAKES = [TP(md.lake)];
  RIVERS = md.rivers.map(r => ({ id: r.id, half: r.half * S, pts: spline(TP(r.pts), 40) }));
  PARKS = md.parks.map(p => ({ name: p.name, pts: TP(p.pts) }));
  LANDMARKS = md.landmarks;
  DECKS = md.decks.map(d => ({ name: d.name, color: d.color, pts: TP(d.pts) }));
  STADIUM = md.stadium;
  DISTRICTS = md.districts;
  HIGHWAY_PX = md.highway;
  STREETS = md.streets;
  IXS = md.interchanges;
  SPOTS = { shops: md.shops, stations: md.stations, gas: md.gas };
}
// a saved edit from the studio (same origin) replaces the built-in map
export function loadMapData() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(CUSTOM_KEY);
    if (raw) { const c = JSON.parse(raw); if (c && c.map && c.map.streets && c.map.lake) return c.map; }
  } catch (e) { /* fall through to the built-in map */ }
  return DEFAULT_MAP;
}
setMapData(loadMapData());

export function districtAt(X, Y) {
  for (const d of DISTRICTS) if (pointInPoly(X, Y, d.poly)) return d;
  return null;
}
export { spline, offsetPoly, ribbonPoly, nearestOnPoly, pointInPoly, distToSeg, dist, polyLen, atLen };
