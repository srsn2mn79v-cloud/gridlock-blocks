// Player car bodies (see vehicleModels.js for the geometry). All share the same footprint
// (3.6 long x 1.9 wide, wheels at the same spots) so the lights, collision and wheel-height
// sampling in car.js work for any of them; they differ in looks and, now, in how they drive:
//   maxSpeed (units/s; km/h on the HUD = x6.2), accel (units/s^2 off the line), mass (kg).
// Heavier cars brake and turn a little worse, and bleed more speed when they hit objects.
import { buildCarBody } from './vehicleModels.js';

// Real-world scale (1 u = 1.25 m): the bodies are modelled 1.9 u (2.4 m) wide, a touch fat; this narrows them to 1.52 u = 1.9 m.
export const CAR_WIDTH_K = 0.8;

// cls = base class (F slowest .. A fastest, G classic - see classes.js). maxSpeed in world units/s (km/h = x6.2);
// accel is calibrated so zeroTo100() gives the 0-100 time noted; brake / handling are base multipliers (1 = good).
export const CAR_STYLES = [
  { key: 'hatch',  name: 'Hatchback',   cls: 'F', color: 0xff5e3a, maxSpeed: 26.7, accel: 4.2, mass: 1100, brake: 0.7, handling: 0.8 },   // 120 km/h, 0-100 in 7.6 s
  { key: 'taxi',   name: 'Taxi',        job: true, cls: 'F', color: 0xf4c400, maxSpeed: 30.0, accel: 4.12, mass: 1500, brake: 0.8, handling: 0.85 },  // 135 km/h, 0-100 in 6.9 s
  { key: 'van',    name: 'Van',         cls: 'F', color: 0xe9ecef, maxSpeed: 24.9, accel: 4.0, mass: 2700, brake: 0.65, handling: 0.7 },  // 112 km/h, 0-100 in 9.4 s
  { key: 'bus',    name: 'City bus',    job: true, cls: 'F', color: 0xd9a21b, maxSpeed: 24.4, accel: 3.55, mass: 7200, brake: 0.55, handling: 0.55, len: 7.2, wid: 2.0, height: 3.2 },  // 110 km/h, 0-100 in 12.4 s
  { key: 'pickup', name: 'Pickup',      cls: 'E', color: 0x3f8f52, maxSpeed: 33.3, accel: 4.09, mass: 2300, brake: 0.85, handling: 0.85 }, // 150 km/h, 0-100 in 6.6 s
  { key: 'muscle', name: 'Muscle',      cls: 'E', color: 0x1c1d22, maxSpeed: 41.1, accel: 4.95, mass: 1800, brake: 0.9, handling: 0.8 },  // 185 km/h, 0-100 in 5.1 s
  { key: 'sport',  name: 'Sport coupe', cls: 'E', color: 0x2f6fe0, maxSpeed: 44.5, accel: 5.25, mass: 1350, brake: 1.0, handling: 1.0 }   // 200 km/h, 0-100 in 4.7 s
];

export const BASE_STYLES = CAR_STYLES.map(s => ({ ...s }));   // the built-in values (the Studio resets to these)
// cars edited in the Studio: per-style stat overrides (name, cls, color, maxSpeed, accel, mass, brake, handling)
try {
  const c = JSON.parse(localStorage.getItem('gridlock-custom-v1') || 'null');
  if (c && c.cars) CAR_STYLES.forEach(st => { const o = c.cars[st.key] && c.cars[st.key].stats; if (o) for (const k in o) if (o[k] !== '' && o[k] != null && k in st) st[k] = o[k]; });
} catch (e) { /* no custom data */ }

// Returns a Group with the body parts plus `userData.wheels` (the four wheel meshes).
export function buildCarModel(key = 'hatch') {
  const style = CAR_STYLES.find(s => s.key === key) || CAR_STYLES[0];
  const g = buildCarBody(style.key, style.color);
  g.userData.style = style;
  g.scale.x = CAR_WIDTH_K;
  return g;
}
