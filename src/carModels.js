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
  { key: 'hatch',  name: 'Hatchback',   cls: 'F', color: 0xff5e3a, maxSpeed: 19.4, accel: 3.05, mass: 1100, brake: 0.7, handling: 0.8 },   // 120 km/h, 0-100 in 7.6 s
  { key: 'taxi',   name: 'Taxi',        job: true, cls: 'F', color: 0xf4c400, maxSpeed: 21.8, accel: 2.99, mass: 1500, brake: 0.8, handling: 0.85 },  // 135 km/h, 0-100 in 6.9 s
  { key: 'van',    name: 'Van',         cls: 'F', color: 0xe9ecef, maxSpeed: 18.1, accel: 2.90, mass: 2700, brake: 0.65, handling: 0.7 },  // 112 km/h, 0-100 in 9.4 s
  { key: 'bus',    name: 'City bus',    job: true, cls: 'F', color: 0xd9a21b, maxSpeed: 17.7, accel: 2.58, mass: 7200, brake: 0.55, handling: 0.55, len: 7.2, wid: 2.0, height: 3.2 },  // 110 km/h, 0-100 in 12.4 s
  { key: 'pickup', name: 'Pickup',      cls: 'E', color: 0x3f8f52, maxSpeed: 24.2, accel: 2.97, mass: 2300, brake: 0.85, handling: 0.85 }, // 150 km/h, 0-100 in 6.6 s
  { key: 'muscle', name: 'Muscle',      cls: 'E', color: 0x1c1d22, maxSpeed: 29.8, accel: 3.59, mass: 1800, brake: 0.9, handling: 0.8 },  // 185 km/h, 0-100 in 5.1 s
  { key: 'sport',  name: 'Sport coupe', cls: 'E', color: 0x2f6fe0, maxSpeed: 32.3, accel: 3.81, mass: 1350, brake: 1.0, handling: 1.0 }   // 200 km/h, 0-100 in 4.7 s
];

// Returns a Group with the body parts plus `userData.wheels` (the four wheel meshes).
export function buildCarModel(key = 'hatch') {
  const style = CAR_STYLES.find(s => s.key === key) || CAR_STYLES[0];
  const g = buildCarBody(style.key, style.color);
  g.userData.style = style;
  g.scale.x = CAR_WIDTH_K;
  return g;
}
