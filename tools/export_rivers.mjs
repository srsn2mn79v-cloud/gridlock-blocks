// writes the splined river centre lines (in map px) used by the game, so tools/apply_new_map.py tests roads against the same water
import fs from 'node:fs'; import { RIVERS, fromWorld } from '../src/chicago/map.js';
fs.writeFileSync(process.argv[2], JSON.stringify(RIVERS.map(r => ({ id: r.id, half: r.half / 2.5, pts: r.pts.map(p => fromWorld(p[0], p[1]).map(v => Math.round(v * 10) / 10)) }))));
