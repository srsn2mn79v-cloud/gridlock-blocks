// The city map. All of it is data (mapdata.json, traced from the street map the user supplied by tools/build_mapdata.py, and
// editable in the studio). Coordinates in the data are "map px" (reference image px x 2.3); T() turns them into world units:
// x is flipped (the game's minimap draws east on the right = -x) and z points north.
// The exports are live bindings: setMapData() swaps the whole map (the studio does this to preview an edit).
import DEFAULT_MAP from './mapdata.js';
import SF_MAP from '../sf/mapdata_sf.js';
import { OUTROADS } from './outroads.js';
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
export let OUTROAD = null;   // this city's road out of town (outroads.js), or null

export function setMapData(md) {
  MAP = md;
  X0 = md.origin[0]; Y0 = md.origin[1];
  // interstate.landfill (map px): water outlines whose middle lies within that distance of the road out of town are left out, so the road
  // runs on a strip of land (the San Francisco map's bay is a grid of square water tiles; this lifts the tiles the road crosses)
  const io = OUTROAD = md.interstate || OUTROADS[md.city || 'chicago'] || null, fill = io && io.landfill, mid = l => [l.reduce((t, p) => t + p[0], 0) / l.length, l.reduce((t, p) => t + p[1], 0) / l.length];
  const dry = l => { if (!fill) return false; const c = mid(l); return nearestOnPoly(c[0], c[1], io.pts).d < fill; };
  LAKES = (md.lakes ? md.lakes : [md.lake]).filter(l => !dry(l)).map(TP);
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
export function citySel() {
  try {
    if (typeof location !== 'undefined') { const q = new URLSearchParams(location.search).get('city'); if (q) { try { localStorage.setItem('gridlock-city', q); } catch (e) {} return q; } }
    if (typeof localStorage !== 'undefined') return localStorage.getItem('gridlock-city') || 'chicago';
  } catch (e) { /* ignore */ }
  return (typeof process !== 'undefined' && process.env && process.env.CITY) || 'chicago';
}
export function loadMapData() {
  if (citySel() === 'sf') return SF_MAP;
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
