// Builds public/radio/stations.json from the folders in public/radio/: one folder = one station.
//   public/radio/<station-folder>/*.mp3 | .m4a | .ogg | .wav | .aac | .flac     <- your songs
//   public/radio/<station-folder>/station.json   (optional)  { "name": "Night Drive FM", "dj": true, "djName": "Maya", "pitch": 1.0, "rate": 1.0, "voice": "Samantha" }
// Run automatically before every build (see package.json); run by hand with `node tools/radio-manifest.mjs`.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'radio');
const AUDIO = /\.(mp3|m4a|ogg|wav|aac|flac)$/i;
const stations = [];
if (fs.existsSync(root)) for (const d of fs.readdirSync(root, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const dir = path.join(root, d.name), tracks = fs.readdirSync(dir).filter(f => AUDIO.test(f)).sort();
  if (!tracks.length) continue;
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'station.json'), 'utf8')); } catch (e) { /* optional */ }
  stations.push({ id: d.name, name: meta.name || d.name.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), dj: meta.dj !== false, djName: meta.djName || null, pitch: meta.pitch || null, rate: meta.rate || null, voice: meta.voice || null,
    tracks: tracks.map(f => ({ file: d.name + '/' + encodeURIComponent(f).replace(/%2F/g, '/'), title: f.replace(AUDIO, '').replace(/[-_]+/g, ' ') })) });
}
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'stations.json'), JSON.stringify({ stations }, null, 1));
console.log('radio: ' + stations.length + ' station(s), ' + stations.reduce((n, s) => n + s.tracks.length, 0) + ' track(s)');
