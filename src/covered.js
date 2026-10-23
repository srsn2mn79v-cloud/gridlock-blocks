// What counts as a covered (indoor / roofed) space, where it neither rains nor snows:
//  - anything in a pocket world (an apartment's garage or a flat: x beyond POCKET_X - 4000),
//  - tunnels and underpasses below street level (y < -1.5),
//  - the world mode is not the open city (garage / flat transitions).
// Everything else - streets, bridges, parks, rooftops - is open sky.
import { inPocket } from './estate.js';
export const TUNNEL_Y = -1.5;
export function isCovered(x, y, mode = 'city') { return mode !== 'city' || inPocket(x) || y < TUNNEL_Y; }
