// The Chicago map, transcribed from the street map the user supplied. Everything here is in the
// map's own pixel space (4x enlarged: X 0..988 east, Y 0..1412 south) and `T` turns it into world
// units: x is flipped (the game's minimap draws east on the right = -x) and z points north.
import { spline, offsetPoly, ribbonPoly, nearestOnPoly, pointInPoly, distToSeg, dist, polyLen, atLen } from './geom.js';

export const S = 2.5, X0 = 450, Y0 = 900;
export const T = (X, Y) => [-(X - X0) * S, (Y0 - Y) * S];
export const TP = pts => pts.map(p => T(p[0], p[1]));
export const fromWorld = (x, z) => [X0 - x / S, Y0 - z / S];

// ---- water -----------------------------------------------------------------------------------------------------
// Lake Michigan: north and east of the city. Navy Pier is the strip of land left out of it.
export const LAKE_N = TP([[285, 196], [330, 180], [420, 210], [500, 266], [590, 282], [650, 290], [705, 318], [742, 372], [766, 470], [766, 478],
  [1100, 478], [1100, -400], [250, -400]]);
export const LAKE_S = TP([[766, 522], [770, 640], [744, 760], [742, 900], [784, 1000], [820, 1090], [1100, 1090], [1100, 522]]);
export const PIER = TP([[752, 478], [988, 478], [988, 522], [752, 522]]);

// the river: main branch from the lake, then the trunk south; the north branch comes in from the west
export const RIVERS = [
  { id: 'main',  half: 21.25, pts: spline(TP([[760, 572], [640, 572], [530, 575], [430, 580], [330, 580], [262, 588], [205, 612]]), 40) },
  { id: 'north', half: 18.75, pts: spline(TP([[-60, 515], [30, 522], [90, 538], [150, 566], [205, 612]]), 40) },
  { id: 'trunk', half: 28.75, pts: spline(TP([[205, 612], [200, 700], [201, 800], [206, 900], [214, 1000], [212, 1040], [192, 1118], [142, 1208], [72, 1280], [-40, 1340]]), 40) }
];

// ---- the interstate (dark green) ---------------------------------------------------------------------------------------
export const HIGHWAY_PX = [[272, 268], [215, 350], [150, 455], [100, 560], [60, 650], [32, 740], [22, 850], [20, 960], [24, 1060], [48, 1150], [110, 1205], [200, 1245], [300, 1288], [400, 1345], [500, 1392], [580, 1425]];

// ---- parks and landmarks ---------------------------------------------------------------------------------------------------------
export const PARKS = [
  { name: 'Grant Park', pts: TP([[655, 770], [718, 770], [738, 925], [786, 1012], [792, 1180], [756, 1262], [662, 1305], [655, 1010]]) },
  { name: 'Lincoln Green', pts: TP([[382, 326], [448, 326], [448, 380], [382, 380]]) },
  { name: 'Riverwalk Park', pts: TP([[252, 640], [372, 640], [372, 735], [252, 735]]) },
  { name: 'Chinatown Square', pts: TP([[432, 1040], [502, 1040], [502, 1092], [432, 1092]]) },
  { name: 'Gold Coast Gardens', pts: TP([[452, 300], [515, 300], [515, 336], [452, 336]]) },
  { name: 'Hancock Plaza', pts: TP([[652, 330], [704, 330], [704, 384], [652, 384]]) }
];
// big pink boxes on the map: [name, x1, y1, x2, y2, height]
export const LANDMARKS = [
  ['Zoo Hall', 320, 225, 375, 282, 14], ['Hancock Tower', 592, 326, 636, 372, 150], ['Mid-North Tower', 612, 488, 654, 530, 90],
  ['Willis Tower', 246, 856, 306, 908, 210], ['Art Institute', 662, 722, 712, 758, 22], ['Aqua Tower', 408, 1002, 462, 1024, 70],
  ['Millennium Hall', 676, 872, 724, 906, 26], ['McCormick North', 538, 1245, 626, 1312, 24], ['McCormick South', 612, 1262, 672, 1332, 24],
  ['Mega Field', 870, 1116, 962, 1330, 36]
];
// Soldier-Field style stadium ring in Grant Park (centre, radii in map px)
export const STADIUM = { cx: 718, cy: 1130, rx: 30, ry: 78 };

// the district a point belongs to decides what gets built there
export const DISTRICTS = [
  { name: 'Downtown',     poly: [[300, 736], [650, 736], [650, 1000], [300, 1000]], h: [70, 190], style: 'tower' },
  { name: 'Loop Edge',    poly: [[262, 600], [652, 600], [652, 1050], [262, 1050]], h: [28, 80], style: 'mid' },
  { name: 'River North',  poly: [[420, 380], [750, 380], [750, 560], [420, 560]], h: [38, 110], style: 'tower' },
  { name: 'Gold Coast',   poly: [[285, 200], [750, 200], [750, 380], [285, 380]], h: [22, 60], style: 'mid' },
  { name: 'Old Town',     poly: [[200, 300], [430, 300], [430, 570], [200, 570]], h: [10, 24], style: 'low' },
  { name: 'Industrial',   poly: [[20, 640], [200, 640], [200, 1100], [20, 1100]], h: [8, 18], style: 'warehouse' },
  { name: 'Chinatown',    poly: [[260, 1050], [640, 1050], [640, 1400], [260, 1400]], h: [9, 22], style: 'china' }
];
export function districtAt(X, Y) {
  for (const d of DISTRICTS) if (pointInPoly(X, Y, d.poly)) return d;
  return null;
}
export { spline, offsetPoly, ribbonPoly, nearestOnPoly, pointInPoly, distToSeg, dist, polyLen, atLen };
