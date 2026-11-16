// Downloads AWS Terrain Tiles (Terrarium, free, no account) for a lat/lon box and stitches them into one PNG heightmap plus a small JSON header.
//   node tools/fetch_elevation.mjs            (San Francisco peninsula, zoom 13, about 19 m per pixel)
//   node tools/fetch_elevation.mjs 37.84 37.69 -122.53 -122.35 13 sf_elevation
// Needs Node 18+ and `npm i pngjs` once. Run it on your own computer (the build sandbox cannot reach the tile server), then send me sf_elevation.png and sf_elevation.json.
// Height in metres = (R * 256 + G + B / 256) - 32768
import fs from 'node:fs';
const [north = 37.84, south = 37.69, west = -122.53, east = -122.35, z = 13, name = 'sf_elevation'] = process.argv.slice(2).map((v, i) => (i === 5 ? v : +v));
const { PNG } = await import('pngjs');
const n = 2 ** z, tx = l => Math.floor((l + 180) / 360 * n), ty = a => { const r = a * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
const x0 = tx(west), x1 = tx(east), y0 = ty(north), y1 = ty(south), W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256;
const out = new PNG({ width: W, height: H });
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
  const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`); if (!r.ok) throw new Error('tile ' + x + '/' + y + ' ' + r.status);
  const t = PNG.sync.read(Buffer.from(await r.arrayBuffer())); PNG.bitblt(t, out, 0, 0, 256, 256, (x - x0) * 256, (y - y0) * 256); process.stdout.write('.');
}
fs.writeFileSync(name + '.png', PNG.sync.write(out));
// geographic box of the stitched image (tile corners)
const lon = x => x / n * 360 - 180, lat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
fs.writeFileSync(name + '.json', JSON.stringify({ zoom: z, width: W, height: H, west: lon(x0), east: lon(x1 + 1), north: lat(y0), south: lat(y1 + 1), encoding: 'terrarium' }, null, 1));
console.log('\nwrote', name + '.png', W + 'x' + H, 'and', name + '.json');
