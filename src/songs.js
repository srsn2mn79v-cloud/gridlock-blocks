// The songs of the built-in radio stations, as data, and the code that turns one into a bar-by-bar plan.
// A song is a form (intro, A, B, A, B, bridge ... outro) over two four-chord progressions. The melody is composed once per song from a fixed
// seed, so every verse repeats exactly, like a real tune: a four-bar phrase that asks a question (lands on the fifth) and an answer that comes
// home to the tonic. Notes mix long and short values (whole and half notes beside eighths and sixteenths), strong beats lean on chord tones and
// everything moves mostly by step. The B section is a contrasting, higher phrase pair; the bridge strips back to a few held notes.
// radio.js plays the plan; tools/check.mjs (`songs`) checks every song for range, leaps and length.

export const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11], minpent: [0, 3, 5, 7, 10],
  pent: [0, 2, 4, 7, 9], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11]
};
export const CHORDS = { m: [0, 3, 7], M: [0, 4, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14] };

// rhythm templates for one bar: [start step, length in sixteenths]. 'flow' is long notes, 'mid' mixes, 'busy' is lively.
const RH = {
  flow: [[[0, 8], [8, 4], [12, 4]], [[0, 6], [6, 2], [8, 8]], [[0, 4], [4, 4], [8, 8]], [[2, 6], [8, 4], [12, 4]], [[0, 12], [12, 4]], [[0, 16]], [[0, 10], [10, 2], [12, 4]]],
  mid: [[[0, 4], [4, 2], [6, 2], [8, 8]], [[0, 2], [2, 2], [4, 4], [8, 6], [14, 2]], [[0, 6], [6, 2], [8, 6], [14, 2]], [[0, 4], [4, 4], [8, 2], [10, 2], [12, 4]], [[0, 8], [8, 2], [10, 2], [12, 2], [14, 2]]],
  busy: [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 8]], [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]], [[0, 4], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4]], [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]]]
};
const CADENCE = [[[0, 8], [8, 8]], [[0, 12], [12, 4]], [[0, 16]], [[0, 6], [6, 2], [8, 8]]];

const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
const hash = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0; return h; };
export const noteName = m => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1);

// Songs. style picks the drums and accompaniment in radio.js. A/B are [root midi, chord quality] x 4 (one bar each).
// feel: which rhythm families the melody draws from. hi: shift the melody up (in scale steps). mins: how long the song runs.
const S = (name, style, bpm, mode, voice, A, B, o = {}) => ({ name, style, bpm, mode, voice, A, B, swing: 0, feel: ['mid'], hi: 0, mins: 3.2, melody: true, ...o });
export const SONGS = [
  // ---- Neon Drive: four on the floor, a pulsing bass, arpeggios and a bright lead
  S('Midnight Interchange', 'neon', 108, 'minor', 'synth', [[57, 'm'], [53, 'M'], [48, 'M'], [55, 'M']], [[53, 'M'], [55, 'M'], [57, 'm'], [57, 'm']], { feel: ['mid'], mins: 3.2 }),
  S('Gridlock Sunrise', 'neon', 124, 'major', 'synth', [[52, 'm'], [48, 'M'], [55, 'M'], [50, 'M']], [[48, 'M'], [50, 'M'], [52, 'm'], [52, 'm']], { feel: ['mid', 'busy'], mins: 3.4 }),
  S('Lakeshore Run', 'neon', 100, 'minor', 'synth', [[50, 'm'], [46, 'M'], [53, 'M'], [48, 'M']], [[46, 'M'], [48, 'M'], [50, 'm'], [50, 'm']], { swing: 0.04, feel: ['flow', 'mid'], mins: 3.2 }),
  S('Harbor After Dark', 'neon', 112, 'dorian', 'flute', [[50, 'm'], [55, 'M'], [48, 'M'], [50, 'm']], [[53, 'M'], [48, 'M'], [55, 'M'], [50, 'm']], { feel: ['flow', 'mid'], mins: 3.3 }),
  S('Overdrive District', 'neon', 132, 'phrygian', 'synth', [[45, 'm'], [41, 'M'], [43, 'M'], [45, 'm']], [[41, 'M'], [43, 'M'], [45, 'm'], [45, 'm']], { feel: ['busy', 'mid'], mins: 3.6 }),
  S('Chrome Boulevard', 'neon', 116, 'minor', 'synth', [[48, 'm'], [44, 'M'], [51, 'M'], [46, 'M']], [[44, 'M'], [46, 'M'], [48, 'm'], [48, 'm']], { feel: ['mid'], hi: 1, mins: 3.3 }),
  S('Rooftop Static', 'neon', 120, 'dorian', 'flute', [[43, 'm'], [39, 'M'], [46, 'M'], [41, 'M']], [[39, 'M'], [41, 'M'], [43, 'm'], [43, 'm']], { feel: ['flow', 'mid'], mins: 3.4 }),
  S('Night Shift Groove', 'neon', 118, 'minpent', 'synth', [[52, 'm'], [52, 'm'], [55, 'M'], [50, 'M']], [[50, 'M'], [52, 'm'], [55, 'M'], [52, 'm']], { feel: ['busy'], melody: false, mins: 3.0 }),   // no lead: the groove is the song

  // ---- Low Key: slow, soft, electric piano and a round bass
  S('Soft Lights', 'lowkey', 78, 'major', 'epiano', [[53, 'M7'], [52, 'm7'], [50, 'm9'], [48, 'M7']], [[48, 'M7'], [50, 'm7'], [52, 'm7'], [53, 'M7']], { swing: 0.12, feel: ['flow'], mins: 3.8 }),
  S('Lamplit Lullaby', 'lowkey', 70, 'pent', 'lute', [[48, 'M7'], [45, 'm7'], [50, 'm7'], [55, 'M7']], [[53, 'M7'], [48, 'M7'], [50, 'm7'], [55, 'M7']], { swing: 0.1, feel: ['flow', 'mid'], mins: 3.8 }),
  S('Tavern After Rain', 'lowkey', 84, 'dorian', 'flute', [[50, 'm7'], [55, 'M7'], [48, 'M7'], [45, 'm7']], [[53, 'M7'], [55, 'M7'], [50, 'm7'], [50, 'm7']], { swing: 0.18, feel: ['flow', 'mid'], mins: 3.6 }),
  S('Harp for Harbor Lights', 'lowkey', 66, 'major', 'harp', [[53, 'M7'], [48, 'M7'], [50, 'm7'], [55, 'M7']], [[48, 'M7'], [53, 'M7'], [55, 'M7'], [53, 'M7']], { swing: 0.06, feel: ['mid'], mins: 4.0 }),
  S('Slow Boat to Port', 'lowkey', 74, 'minpent', 'epiano', [[46, 'M7'], [43, 'm7'], [48, 'm7'], [53, 'M7']], [[43, 'm7'], [46, 'M7'], [53, 'M7'], [48, 'm7']], { swing: 0.14, feel: ['flow'], mins: 3.8 }),
  S('Window Seat', 'lowkey', 72, 'major', 'lute', [[55, 'M7'], [52, 'm7'], [48, 'M7'], [50, 'm7']], [[48, 'M7'], [50, 'm7'], [55, 'M7'], [55, 'M7']], { swing: 0.1, feel: ['mid', 'flow'], mins: 3.8 }),
  S('Sunday Streets', 'lowkey', 80, 'major', 'epiano', [[48, 'M7'], [55, 'M7'], [57, 'm7'], [53, 'M7']], [[53, 'M7'], [55, 'M7'], [48, 'M7'], [48, 'M7']], { swing: 0.16, feel: ['mid'], melody: false, mins: 3.4 }),   // instrumental groove

  // ---- Night Cruise FM: slow synthwave for the interstate, steady bass, wide pads
  S('Mile Marker 80', 'cruise', 88, 'minor', 'synth', [[45, 'm7'], [41, 'M7'], [48, 'M7'], [43, 'M']], [[41, 'M7'], [43, 'M'], [45, 'm7'], [45, 'm7']], { feel: ['flow'], mins: 3.6 }),
  S('Sodium Lights', 'cruise', 84, 'dorian', 'epiano', [[50, 'm7'], [46, 'M7'], [41, 'M7'], [48, 'M']], [[46, 'M7'], [48, 'M'], [50, 'm7'], [50, 'm7']], { feel: ['flow', 'mid'], mins: 3.8 }),
  S('Tail Lights West', 'cruise', 92, 'minor', 'synth', [[52, 'm7'], [48, 'M7'], [43, 'M'], [50, 'M']], [[48, 'M7'], [50, 'M'], [52, 'm7'], [52, 'm7']], { feel: ['flow', 'mid'], mins: 3.5 }),
  S('Tunnel Under the Hills', 'cruise', 80, 'dorian', 'flute', [[47, 'm7'], [43, 'M7'], [50, 'M'], [45, 'M']], [[43, 'M7'], [45, 'M'], [47, 'm7'], [47, 'm7']], { feel: ['flow'], mins: 4.0 }),
  S('Last Exit Before Dawn', 'cruise', 86, 'major', 'epiano', [[48, 'M7'], [45, 'm7'], [41, 'M7'], [43, 'M']], [[41, 'M7'], [43, 'M'], [45, 'm7'], [48, 'M7']], { feel: ['flow', 'mid'], mins: 3.8 }),
  S('Weigh Station', 'cruise', 82, 'minpent', 'synth', [[43, 'm7'], [48, 'M7'], [40, 'M7'], [47, 'M']], [[48, 'M7'], [47, 'M'], [43, 'm7'], [43, 'm7']], { feel: ['flow'], mins: 3.8 }),
  S('Two Lane Blacktop', 'cruise', 90, 'minor', 'synth', [[50, 'm7'], [43, 'M'], [48, 'M7'], [45, 'm7']], [[43, 'M'], [45, 'm7'], [50, 'm7'], [50, 'm7']], { feel: ['mid'], melody: false, mins: 3.4 })        // instrumental groove
];
export const songsFor = style => (style === 'mix' ? SONGS : SONGS.filter(s => s.style === style));

// the pitches a melody may use: the song's scale around the tonic, between MIDI 62 and 88
function pool(P) {
  const tonic = P.A[0][0] % 12, out = [];
  for (let o = 48; o <= 84; o += 12) for (const d of SCALES[P.mode]) { const m = o + tonic + d; if (m >= 62 && m <= 88) out.push(m); }
  return out.sort((a, b) => a - b);
}

function phrase(chords, rhythm, rng, P, pl, start, endPC) {
  const out = []; let idx = start, k = 0; const total = rhythm.reduce((a, b) => a + b.length, 0);
  rhythm.forEach((bar, b) => {
    const ct = CHORDS[chords[b][1]].map(x => (chords[b][0] + x) % 12);
    bar.forEach(([s, len], j) => {
      const last = b === rhythm.length - 1 && j === bar.length - 1;
      let to = idx;
      if (last) {
        const c = pl.map((m, i) => i).filter(i => pl[i] % 12 === endPC); to = c.reduce((a, i) => (Math.abs(i - idx) < Math.abs(a - idx) ? i : a), c[0]);
      } else if (s % 8 === 0 || len >= 6) {
        const all = pl.map((m, i) => i), c = all.filter(i => ct.includes(pl[i] % 12) && Math.abs(i - idx) <= 3);
        const cand = c.length ? c : all.filter(i => ct.includes(pl[i] % 12));
        if (cand.length) { const near = cand.sort((a, b) => Math.abs(a - idx) - Math.abs(b - idx)).slice(0, 2); to = near[rng() < 0.7 ? 0 : near.length - 1]; }
        else to = Math.max(0, Math.min(pl.length - 1, idx + (rng() < 0.5 ? 1 : -1)));          // a pentatonic scale may hold no chord tone: just move by step
      } else {
        const stepN = rng() < 0.6 ? 1 : rng() < 0.65 ? 2 : 0, up = rng() < (k < total * 0.45 ? 0.62 : 0.3); to = Math.max(0, Math.min(pl.length - 1, idx + (up ? stepN : -stepN)));
      }
      idx = to; k++;
      out.push({ bar: b, s, len: last ? Math.min(16 - s, 16) : len, midi: pl[idx] });
    });
  });
  return { notes: out, idx };
}

// -> { bars: [{ sec, chord, next, level, kick, hats, arp, pad, mel: [{s, len, midi}], dbl, fill, last }], barSec, sixteenth }
export function buildPlan(P) {
  const rng = lcg(hash(P.name)), pl = pool(P), sixteenth = 60 / P.bpm / 4, barSec = sixteenth * 16, tonicPC = P.A[0][0] % 12;
  const fam = P.feel.flatMap(f => RH[f]), pickR = () => fam[Math.floor(rng() * fam.length)], pickC = () => CADENCE[Math.floor(rng() * CADENCE.length)];
  const rhA = [pickR(), pickR()], rhB = [pickR(), pickR()];
  const fifth = (tonicPC + 7) % 12, third = P.mode === 'major' || P.mode === 'lydian' || P.mode === 'pent' ? (tonicPC + 4) % 12 : (tonicPC + 3) % 12;
  const base = Math.floor(pl.length * 0.38) + P.hi;
  const p1 = phrase(P.A, [rhA[0], rhA[1], rhA[0], pickC()], rng, P, pl, base, fifth);
  const p2 = phrase(P.A, [rhA[0], rhA[1], rhA[1], pickC()], rng, P, pl, p1.idx, tonicPC);
  const p3 = phrase(P.B, [rhB[0], rhB[1], rhB[0], pickC()], rng, P, pl, Math.min(pl.length - 3, base + 3), third);
  const p4 = phrase(P.B, [rhB[0], rhB[1], rhB[1], pickC()], rng, P, pl, p3.idx, tonicPC);
  // form: intro, then A B A B bridge cycles until the song is long enough, a closing A, outro
  const secs = ['intro'], cyc = ['A', 'B', 'A', 'B', 'bridge']; let bars = 8, i = 0;
  while (bars * barSec < P.mins * 60 - 12 * barSec) { secs.push(cyc[i++ % cyc.length]); bars += 8; }
  if (secs[secs.length - 1] === 'bridge') secs.push('A'); else if (secs[secs.length - 1] === 'B') secs.push('A');
  secs.push('outro');
  const out = [];
  const hold = (m) => [{ s: 0, len: 16, midi: m }];
  secs.forEach((sec, si) => {
    const nBars = sec === 'outro' ? 4 : 8, lastSec = sec === 'outro';
    for (let b = 0; b < nBars; b++) {
      const prog = (sec === 'B' || sec === 'bridge') ? P.B : P.A, chord = prog[b % 4];
      const bar = { sec, chord, kick: false, hats: true, arp: true, pad: true, mel: [], dbl: false, fill: false, level: 1, bassLong: false };
      if (sec === 'intro') { bar.level = 0.55 + 0.4 * (b / 7); bar.kick = b >= 4 && P.style !== 'lowkey'; bar.arp = b >= 2; bar.hats = b >= 2; bar.bassLong = b < 4; }
      else if (sec === 'A') { bar.level = 0.85; bar.kick = true; bar.mel = P.melody ? (b < 4 ? p1 : p2).notes.filter(n => n.bar === b % 4) : []; }
      else if (sec === 'B') { bar.level = 1; bar.kick = true; bar.dbl = true; bar.mel = P.melody ? (b < 4 ? p3 : p4).notes.filter(n => n.bar === b % 4) : []; }
      else if (sec === 'bridge') { bar.level = 0.6; bar.arp = false; bar.bassLong = true; bar.hats = b >= 4; bar.mel = P.melody ? hold(pl[Math.min(pl.length - 1, base + 2 + (b % 4))]).map(n => ({ ...n, midi: pl.filter(m => CHORDS[chord[1]].map(x => (chord[0] + x) % 12).includes(m % 12))[2] || n.midi })) : []; }
      else { bar.level = 0.55 - 0.1 * b; bar.arp = b < 2; bar.hats = b < 2; bar.bassLong = true; bar.mel = (P.melody && b < 2) ? hold(pl[base]).map(n => ({ ...n, midi: pl.filter(m => m % 12 === tonicPC)[1] || n.midi })) : []; }
      // a drum fill into the next section on its last bar
      bar.fill = nBars === 8 && b === 7 && !lastSec;
      // a bar that follows a section which had a different chord set restarts the melody cleanly (nothing to do), the last bar is flagged so the music can ring out
      out.push(bar);
    }
  });
  out.forEach((b, i) => { b.next = (out[i + 1] || b).chord; });
  return { bars: out, barSec, sixteenth, forms: secs };
}

export const songSeconds = P => buildPlan(P).bars.length * buildPlan(P).barSec;
