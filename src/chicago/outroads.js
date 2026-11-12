// The roads out of town: one per city, each ending in the tunnel that leads to another city (see interstate.js and travel.js).
// Coordinates are map px of that city's own map, like everything else in the map data. pts[0] must sit on (or just beyond the end of)
// a street at the edge of the city: the road is hooked onto the nearest street within 60 px-units. The last point is the tunnel mouth.
// To add a city: give it an entry here (and one pointing back in the other city's list when cities get more than one exit).
//   to       the city the tunnel leads to (the value stored as `gridlock-city`)
//   name     what the road is called on signs
//   sign     the destination as written on the tunnel and the signs
//   clover   (optional) the label of an interchange on the city's own interstate: the road crosses there on a full cloverleaf
//   exit     (optional) what that interchange is called on the exit signs
//   landfill (optional, px) water outlines this close to the road are left out, so it runs on land (see map.js)
export const OUTROADS = {
  // west across the city interstate at the 'Clover' interchange (which it takes over as a full cloverleaf), then a long sweep south-west
  // across open country. pts[0] is replaced by that interchange's city-side junction.
  // (Keep it between world x = -5500 and 3700: the garages, flats and the drift arena live beyond those, see estate.js / driftTrack.js.)
  chicago: { to: 'sf', name: 'Interstate 80', exit: 'I-80 West', sign: 'SAN FRANCISCO', clover: 'Clover',
    pts: [[180.7, 817.1], [57.1, 817.6], [-60, 817.6], [-200, 805], [-380, 800], [-560, 860], [-700, 1000], [-790, 1180], [-830, 1380], [-800, 1580], [-760, 1700]] },
  // north from the top of the Marin loop, beyond the Golden Gate
  sf: { to: 'chicago', name: 'Interstate 80', sign: 'CHICAGO', landfill: 70,
    pts: [[329.8, 23], [338, -12], [362, -66], [384, -150], [386, -260], [386, -330], [360, -520], [330, -760], [350, -1000], [390, -1180], [386, -1300]] }
};
