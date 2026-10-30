// Everything the Studio can change lives in one localStorage key ('gridlock-custom-v1'):
//   { map: {...}, cars: { hatch: { stats:{...}, model:{...}, price } }, upgrades: {...}, races: [ {...} ] }
// The game reads it at start-up (map.js reads .map, carModels.js .cars, world.js .upgrades, races.js .races).
export const CUSTOM_KEY = 'gridlock-custom-v1';
export function loadCustom() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || 'null') || {}; } catch (e) { return {}; }
}
export function saveCustom(obj) { localStorage.setItem(CUSTOM_KEY, JSON.stringify(obj)); }

// ---- upgrade catalogue (prices and effects); world.js uses these instead of numbers written into the shop code ----
// perf stages: prices per stage, and what one stage adds. The effect keys are the ones perfStats() in world.js applies:
//   speed = +% top speed, accel = +% acceleration, grip, handling, brake = +% each, weight = -% mass.
const FX0 = { speed: 0, accel: 0, grip: 0, handling: 0, brake: 0, weight: 0 };
export const UPGRADE_DEFAULTS = {
  stages: {
    engine:     { name: 'Engine',               prices: [600, 1200, 2200],  desc: 'top speed and acceleration',               fx: { ...FX0, ...{ speed: 0.06, accel: 0.06 } } },
    turbo:      { name: 'Turbo',                prices: [500, 1000, 1800],  desc: 'mostly acceleration',                      fx: { ...FX0, ...{ speed: 0.01, accel: 0.10 } } },
    gearbox:    { name: 'Gearbox',              prices: [800, 1500, 2600],  desc: 'acceleration and top speed',               fx: { ...FX0, ...{ speed: 0.03, accel: 0.05 } } },
    tires:      { name: 'Tyres',                prices: [400, 800, 1400],   desc: 'handling and grip, especially wet and icy', fx: { ...FX0, ...{ grip: 0.07, handling: 0.06 } } },
    suspension: { name: 'Suspension',           prices: [450, 900, 1600],   desc: 'handling',                                 fx: { ...FX0, ...{ grip: 0.02, handling: 0.08 } } },
    brakes:     { name: 'Brakes',               prices: [350, 700, 1200],   desc: 'shorter stopping distance',                fx: { ...FX0, ...{ brake: 0.22 } } },
    weight:     { name: 'Lightweight materials', prices: [500, 1100, 2000], desc: 'quicker, brakes and turns better',         fx: { ...FX0, ...{ weight: 0.04 } } }
  },
  seats:   { price: 700,  kg: 80,   desc: 'acceleration and braking' },
  limiter: { price: 1500, speed: 0.08, desc: 'top speed' },
  nitro: { prices: [900, 1600, 2600], secs: [4, 7, 10] },
  tank:  { prices: [350, 700, 1200, 1800] },
  hud:   { prices: [500, 900] },
  paint: 200, decal: 300, neon: 400, xenon: 350, hlight: 300, rim: 250,
  kit: {
    front:   { names: ['Stock', 'Lip splitter', 'Sport bumper', 'Aggressive bumper'], prices: [0, 350, 600, 900] },
    rear:    { names: ['Stock', 'Diffuser', 'Race diffuser'], prices: [0, 400, 700] },
    skirts:  { names: ['Stock', 'Sport skirts', 'GT skirts'], prices: [0, 300, 550] },
    spoiler: { names: ['None', 'Lip', 'Ducktail', 'GT wing', 'Tall race wing'], prices: [0, 250, 450, 800, 1100] },
    fenders: { names: ['Stock', 'Bolt-on flares', 'Wide body'], prices: [0, 500, 900] },
    hood:    { names: ['Stock', 'Louvred vents', 'Power scoop', 'Carbon vented bonnet'], prices: [0, 300, 550, 950] }
  },
  carPrice: { van: 5000, wagon: 8000, bus: 9000, pickup: 12000, suv: 18000, muscle: 24000, sport: 28000, rally: 32000, roadster: 40000, supercar: 95000, hyper: 180000 }
};
const merge = (base, over) => {
  if (Array.isArray(base)) return Array.isArray(over) && over.length === base.length ? over.map(Number) : base;
  if (base && typeof base === 'object') { const o = {}; for (const k in base) o[k] = merge(base[k], over && over[k]); return o; }
  return typeof base === 'number' ? (Number.isFinite(+over) && over != null ? +over : base) : (typeof over === 'string' ? over : base);
};
export const mergeUpgrades = over => merge(UPGRADE_DEFAULTS, over);
export const getUpgrades = () => { const c = loadCustom(); const u = mergeUpgrades(c.upgrades || {}); (c.cars ? Object.keys(c.cars) : []).forEach(k => { if (c.cars[k] && Number.isFinite(+c.cars[k].price)) u.carPrice[k] = +c.cars[k].price; }); return u; };
