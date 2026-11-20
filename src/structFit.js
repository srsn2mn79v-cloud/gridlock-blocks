// A bridge or tunnel from the city builder is a level deck with a ramp at each end. The ramps are long (depth / grade), so a structure that is
// too long for its street cannot be built as drawn. The game and the studio both use this one function, so the editor shows what the game will do.
export const FIT_MARGIN = 26;          // u of ordinary road kept between the end of a ramp and the junction at the end of the street
// d1: half the deck (u), h: signed height (u, negative = tunnel), g: ramp grade, plat: level stretch before the ramps (u, 0 if none),
// along/total: where the middle sits along the street and the street's length (u)
export function fitStruct({ d1, h, g, plat = 0, along, total }) {
  const rampOf = hh => Math.abs(hh) / g, want = (plat || d1) + rampOf(h), room = Math.min(along, total - along) - FIT_MARGIN;
  if (want <= room) return { fits: true, d1, h, d2: want, room, want, needTotal: 2 * (want + FIT_MARGIN), builtLen: 2 * d1 };
  let nd1 = room - rampOf(h), nh = h;
  if (nd1 < 3) { nd1 = 3; nh = Math.sign(h) * Math.max(0, (room - 3) * g); }
  const built = Math.abs(nh) >= 1.2;
  return { fits: false, built, d1: nd1, h: nh, d2: nd1 + rampOf(nh), room, want, needTotal: 2 * (want + FIT_MARGIN), builtLen: built ? 2 * nd1 : 0 };
}
