// Per-type physical behavior for parcels and props: collision radius, whether the car
// is blocked by it, how it reacts to being hit hard enough, and how the impact itself
// feels (see `response` below). This is tuning data — every tree behaves like every
// other tree — so it lives here as a lookup table rather than being stored per-instance
// in the city editor's exported JSON. Add a line here whenever the editor grows a new
// prop/parcel type you want the car to physically interact with; anything left out of
// these tables is purely decorative (no collision).
//
// `response` picks how collision.js resolves an impact against this thing:
//   'bounce'   — solid, heavy stuff you shouldn't be able to shove aside: you lose a
//                lot of speed hitting it head-on, barely any grazing past it, but you
//                don't get steered around it. Buildings, trees, other traffic.
//   'redirect' — something slender enough that a car would realistically deflect off
//                rather than crunch into: you keep most of your speed but get steered
//                around it instead. Lamp posts, sign posts, traffic-light poles,
//                benches.
// Anything left unset defaults to 'bounce' (see collision.js).
export const propPhysics = {
  tree:  { radius: 1.1, blocksCar: true, destructible: false, response: 'bounce' },
  // speedPenalty: a fraction of the car's speed shaved off the instant this breaks
  // (0.3 = a 30% cut), on top of whatever the redirect nudge already costs. Only light
  // has one set explicitly right now; anything else left at 0 keeps the old "breaks
  // clean, no extra penalty" behavior once it's going fast enough to break at all.
  light: { radius: 0.3, blocksCar: true, destructible: true, destroy: 'topple', debrisColor: 0xffd23f, speedPenalty: 0.3, response: 'redirect', mass: 220,
           fall: { len: 6.6, kind: 'drive', penalty: 0.1, lift: 0.22 } },
  bench: { radius: 0.9, blocksCar: true, destructible: true, destroy: 'topple', debrisColor: 0xa9825c, response: 'redirect', mass: 70,
           fall: { len: 1.6, kind: 'push', mass: 0.8, radius: 0.9, lift: 0.2 } },
  // Road signs: knocked over at modest speed; the car keeps ~88% of its speed through one.
  sign:  { radius: 0.3, blocksCar: true, destructible: true, destroy: 'topple', debrisColor: 0xe05252, speedPenalty: 0.12, response: 'redirect', breakSpeed: 3, mass: 12,
           fall: { len: 2.2, kind: 'drive', penalty: 0.05, lift: 0.05 } },
  signpost: { radius: 0.3, blocksCar: true, destructible: true, destroy: 'topple', debrisColor: 0xe05252, speedPenalty: 0.12, response: 'redirect', breakSpeed: 3, mass: 15,
           fall: { len: 2.6, kind: 'drive', penalty: 0.05, lift: 0.05 } },
  oak:   { radius: 1.0, blocksCar: true, destructible: false, response: 'bounce' },
  bush:  { radius: 0.8, blocksCar: true, destructible: false, response: 'redirect' },
  fountain: { radius: 3.3, blocksCar: true, destructible: false, response: 'bounce' },
  gazebo: { radius: 3.0, blocksCar: true, destructible: false, response: 'bounce' },
  foodstand: { radius: 1.5, blocksCar: true, destructible: false, response: 'bounce' },
  shoplamp: { radius: 0.35, blocksCar: true, destructible: false, response: 'redirect' },
  shopsign: { radius: 0.9, blocksCar: true, destructible: false, response: 'bounce' },
  parkedcar: { radius: 1.45, blocksCar: true, destructible: false, response: 'bounce' },
  gantry: { radius: 0.9, blocksCar: true, destructible: false, response: 'bounce' },
  // Signal masts shatter into pieces (see destruction.js); a heavy hit, so a real speed cost.
  trafficlight: { radius: 0.35, blocksCar: true, destructible: true, destroy: 'break', speedPenalty: 0.22, response: 'redirect', breakSpeed: 7 }
};

export const parcelPhysics = {
  building: { blocksCar: true, destructible: false, response: 'bounce' },
  park:     { blocksCar: false, destructible: false },
  plaza:    { blocksCar: false, destructible: false },
  water:    { blocksCar: false, destructible: false }
};

// Minimum impact speed (same units as Car.speed, world units/sec) before a destructible
// object actually breaks, so a slow nudge doesn't flatten every sign you brush past.
export const destroySpeedThreshold = 6;
