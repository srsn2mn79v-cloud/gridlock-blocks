// Car classes (Test Drive Unlimited style): F (slowest) .. A (fastest) and G (classic, reserved for
// collectables). Every style has a base class; fitting EVERY upgrade lifts a car one class.
// Pure data + a tiny integrator, so tools and the menu can use it without three.js.
export const CLASS_ORDER = ['F', 'E', 'D', 'C', 'B', 'A'];          // slowest -> fastest (G = classic, not part of the ladder)
export const CLASS_COLOR = { G: '#c9a227', A: '#ff3b3b', B: '#ff8a1f', C: '#e8d21f', D: '#7ed321', E: '#2fb5ff', F: '#9aa4b2' };
// the reference speed (world units/s) of a typical car in a class: the ghosts in a race of that class run at this pace
export const CLASS_REF_SPEED = { F: 22, E: 31, D: 40, C: 48, B: 56, A: 66 };
export const CLASS_PRIZE_MUL = { F: 1, E: 1.8, D: 3, C: 5, B: 8, A: 14 };

export const classIndex = c => Math.max(0, CLASS_ORDER.indexOf(c));
// total number of upgrade "slots" (perf stages, stripping, nitro) that make a fully built car
export const FULL_BUILD = 7 * 3 + 2 + 3;   // engine,turbo,gearbox,tyres,suspension,brakes,weight x3 + seats + limiter + nitro 3
export function buildProgress(mods) {
  if (!mods) return 0;
  const P = mods.perf || {};
  const n = (P.engine || 0) + (P.turbo || 0) + (P.gearbox || 0) + (P.tires || 0) + (P.suspension || 0) + (P.brakes || 0) + (P.weight || 0) + (P.seats ? 1 : 0) + (P.limiter ? 1 : 0) + (mods.nitro || 0);
  return Math.min(1, n / FULL_BUILD);
}
// -> { cls, base, progress, maxed }: a maxed-out car moves up one class (never past A)
export function carClass(baseClass, mods) {
  const progress = buildProgress(mods), bi = classIndex(baseClass), maxed = progress >= 0.999;
  return { cls: baseClass === 'G' ? 'G' : CLASS_ORDER[Math.min(5, bi + (maxed ? 1 : 0))], base: baseClass, progress, maxed };
}
// 0-100 km/h in seconds with car.js's longitudinal model (full throttle, dry road)
export function zeroTo100(accel, maxSpeed, mass = 1100, baseMass = mass) {
  let v = 0, t = 0; const dt = 0.01, target = 100 / 6.2;
  if (maxSpeed < target) return Infinity;
  while (v < target && t < 60) {
    const k = Math.min(1, v / maxSpeed);
    v += accel * Math.pow(baseMass / mass, 0.8) * Math.max(-0.6, 1 - Math.pow(k, 3)) * dt;
    v *= Math.exp(-0.03 * dt); t += dt;
  }
  return t;
}
