// The car radio. Stations come from two places:
//   * built-in synthesised stations (Neon Drive, Low Key): played by a tiny step sequencer, no files needed;
//   * folders of songs you add under public/radio/<station>/ (listed in radio/stations.json by tools/radio-manifest.mjs).
// Every station has a DJ who talks between songs using the browser's built-in speech synthesis: the time, the current weather and
// temperature, and the outlook for the rest of the day and tomorrow (from weather.js). Music ducks while the DJ speaks.
// Press R (or tap the radio pill) to change station. The radio keeps playing in garages (with the garage echo) and quietly in flats.
const midi = n => 440 * Math.pow(2, (n - 69) / 12);

const SYNTH = [
  { id: 'neon', name: 'Neon Drive', synth: 'neon', tag: 'all night, all neon', dj: { name: 'DJ Vega', pitch: 0.9, rate: 1.04,
    greet: ['Hey night owls.', 'Good to have you out there.', 'Keep it between the lines, drivers.', 'Neon Drive, still rolling.', 'Hello night owls, DJ Vega here.', 'Stay safe out there.', 'Good to see you on the road tonight.',
      "Don't do anything I wouldn't do. Which, admittedly, leaves you plenty of room.", 'Headlights on, volume up.', 'Eyes on the road, ears on me.', 'Another song down, another block to go.', 'If you can hear me, you are doing it right.'],
    quips: ['Red means stop, green means go, and yellow means please do not floor it.', 'The city never sleeps, but you could at least blink between songs.', 'Remember, the horn is not a musical instrument. Mostly.', 'Somebody out there is doing ninety in a thirty. Not naming names. Okay, it is probably you.',
      'The lights are on, the streets are wet with neon, and you have got the best seat in the city.', 'If you are lost, congratulations, you are exploring.', 'Buckle up, hydrate, and keep your hands at ten and two. Or one hand on the wheel, if you are cool. Do not be cool.',
      'This one goes out to everyone stuck at a red light with nowhere to be.', 'Stay in your lane, drivers. Unless you are drifting. Then stay in the car park.'] } },
  { id: 'lowkey', name: 'Low Key', synth: 'lowkey', tag: 'slow roads and soft lights', dj: { name: 'Maya', pitch: 1.12, rate: 0.93,
    greet: ['Easy does it.', 'Take your time out there.', 'Nowhere to be, nothing to prove.', 'Low Key, keeping it mellow.', 'Hello again, lovely drivers.', 'Stay safe out there, okay?', 'So good to see you on the road tonight.', 'Keep it gentle on the pedals.', 'Windows down if you like.'],
    quips: ['Breathe in, breathe out, indicate.', 'Drive as if the road were made of glass, and the glass were made of something very soft.', 'The best parking spot is the one you do not have to fight for.', 'Sip your coffee, watch the lights go by.',
      'If the person in front of you is slow, they are probably enjoying the song too.', 'Keep a little space between you and the car ahead. Space is a kindness.', 'There is no rush hour in this studio.', 'Remember to look up once in a while. The sky is free.',
      'Whatever today was, the road is quiet now.'] } },
  { id: 'cruise', name: 'Night Cruise FM', synth: 'cruise', tag: 'long roads, low lights', dj: { name: 'Cass', pitch: 0.82, rate: 0.9,
    greet: ['Night Cruise FM.', 'Still with you out on the interstate.', 'Lean back. We have got a long way to go.', 'This is Cass, riding along.', 'Nothing but road ahead.', 'Set the cruise and stay a while.'],
    quips: ['Count the lamps if you like. I lost track around four hundred.', 'Somewhere up ahead there is a tunnel, and a different city on the other side of it.', 'Tail lights ahead, headlights behind, and you in the middle of it.',
      'If you see a rest stop, wave at it for me.', 'Keep it steady. The road is doing most of the work tonight.', 'Next exit: wherever you like.'] } },
  { id: 'mix', name: 'Non-Stop Mix', synth: 'mix', tag: 'no talking, just music', dj: null }
];
const PERSONAS = [{ pitch: 1.0, rate: 1.0 }, { pitch: 0.85, rate: 0.98 }, { pitch: 1.2, rate: 1.05 }, { pitch: 0.95, rate: 0.92 }];

import { MAP } from './chicago/map.js';
import { songsFor, buildPlan, CHORDS } from './songs.js';
export function createRadio({ audio, weather, settings, onChange }) {
  let ctx = null, bus = null, noise = null, delay = null;
  const stations = SYNTH.map(s => ({ ...s, type: 'synth' }));
  let idx = -1, timer = null, seq = null, elem = null, elemSrc = null, trackTitle = '', djBusy = false, nextBreak = 0, files = null;

  // ---------------- UI -------------------------------------------------------------------------------------
  const el = document.createElement('div'); el.id = 'radio';
  const css = document.createElement('style');
  css.textContent = '#radiocap{position:fixed;top:68px;right:10px;z-index:6;max-width:min(70vw,340px);font:500 12px/1.35 system-ui,sans-serif;color:#fff;background:rgba(14,18,26,.62);padding:5px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);text-shadow:0 1px 2px #000;pointer-events:none;opacity:0;transition:opacity .4s}#radiocap.show{opacity:1}'+'#radio{position:fixed;top:40px;right:10px;z-index:6;font:600 12px system-ui,sans-serif;color:#fff;background:rgba(14,18,26,.55);padding:4px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.14);cursor:pointer;max-width:min(60vw,280px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px #000;pointer-events:auto}#radio.on{border-color:rgba(255,210,31,.6)}#radio.talk::after{content:" 🎙";}html.touch #radio{top:34px;font-size:11px}';
  document.head.appendChild(css); document.body.appendChild(el);
  const cap = document.createElement('div'); cap.id = 'radiocap'; document.body.appendChild(cap); let capT = 0;
  const caption = (who, text) => { clearTimeout(capT); if (!text) { capT = setTimeout(() => cap.classList.remove('show'), 2500); return; } cap.textContent = '🎙 ' + who + ': ' + text; cap.classList.add('show'); };
  const refresh = () => { const s = stations[idx]; el.classList.toggle('on', idx >= 0); el.textContent = idx < 0 ? '📻 Radio off  (R)' : '📻 ' + s.name + (trackTitle ? ' · ' + trackTitle : ''); if (onChange) onChange(idx, s); };
  el.addEventListener('click', () => next());
  addEventListener('keydown', e => { if (e.code === 'KeyR' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) next(e.shiftKey ? -1 : 1); });
  refresh();

  // file stations listed by the build
  fetch('radio/stations.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(j => {
    if (!j || !j.stations) return;
    j.stations.forEach((s, i) => stations.push({ id: s.id, name: s.name, type: 'files', tracks: s.tracks, tag: 'on the air', dj: s.dj === false ? null : { name: s.djName || 'the DJ', pitch: s.pitch || PERSONAS[i % 4].pitch, rate: s.rate || PERSONAS[i % 4].rate, voice: s.voice || null, greet: ['You are listening to ' + s.name + '.', 'Stay tuned.', 'More music coming up.', 'Keep it rolling.'] } }));
  }).catch(() => { /* no manifest: built-in stations only */ });

  // ---------------- audio plumbing ---------------------------------------------------------------------------
  function setup() {
    if (ctx) return true;
    ctx = audio.ctx; bus = audio.radioBus; if (!ctx || !bus) return false;
    const n = ctx.sampleRate; noise = ctx.createBuffer(1, n, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    delay = ctx.createDelay(1); delay.delayTime.value = 0.34; const fb = ctx.createGain(); fb.gain.value = 0.38; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    delay.connect(lp); lp.connect(fb); fb.connect(delay); const dg = ctx.createGain(); dg.gain.value = 0.5; lp.connect(dg); dg.connect(musicGain());
    return true;
  }
  let mg = null;
  function musicGain() { if (!mg) { mg = ctx.createGain(); mg.gain.value = 0.9; mg.connect(bus); } return mg; }
  const duck = on => { if (!bus) return; bus.gain.setTargetAtTime(on ? 0.22 : 1, ctx.currentTime, on ? 0.15 : 0.6); };

  // ---------------- the band for the built-in stations -------------------------------------------------------------
  // songs.js composes each song (form, chords, a repeating melody); this plays it. Every station has a rhythm section in its own style:
  //   neon    four on the floor, a pulsing bass, arpeggios, a bright lead     lowkey  soft kit, round walking bass, electric-piano chords
  //   cruise  steady kick, long gated snare, eighth-note bass, wide slow pads  mix     (Non-Stop Mix) plays songs from all three
  // The bass is a saw through a low-pass, a sine and a triangle an octave up, so small phone speakers (which cannot make 50 Hz) still hear it.
  function mkSeq(kind, onSong) {
    const dyn = ctx.createGain(); dyn.gain.value = 0.9; dyn.connect(musicGain()); const out = dyn;
    const songs = songsFor(kind); let si = Math.floor(Math.random() * songs.length), P = songs[si], plan = buildPlan(P);
    const tri = CHORDS;
    trackTitle = P.name; refresh();
    let step = 0, t = ctx.currentTime + 0.1, sixteenth = plan.sixteenth, rs = 99, lastBar = -1;
    const env = (g, t0, a, peak, d) => { g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0005, t0 + a + d); };
    const osc = (type, f, t0, dur, vol, a = 0.005, dest = out, filt = null) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f; env(g, t0, a, vol, dur); if (filt) { o.connect(filt); filt.connect(g); } else o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + a + dur + 0.05); return g; };
    // a held note: attack, sustain for `dur`, short release (flute, synth, e-piano); a gentle vibrato on long ones
    const held = (type, f, t0, dur, vol, a, rel, dest = out, filt = null, vib = 0) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f;
      if (vib && dur > 0.5) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.2; lg.gain.value = f * vib; l.connect(lg); lg.connect(o.frequency); l.start(t0 + 0.25); l.stop(t0 + dur + rel + 0.1); }
      g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + a); g.gain.setValueAtTime(vol, t0 + Math.max(a, dur - 0.02)); g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur + rel);
      if (filt) { o.connect(filt); filt.connect(g); } else o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + rel + 0.05); return g;
    };
    const nz = (t0, dur, vol, ftype, f, q = 1) => { const sN = ctx.createBufferSource(); sN.buffer = noise; sN.loop = true; const b = ctx.createBiquadFilter(); b.type = ftype; b.frequency.value = f; b.Q.value = q; const g = ctx.createGain(); env(g, t0, 0.002, vol, dur); sN.connect(b); b.connect(g); g.connect(out); sN.start(t0, Math.random() * 0.5); sN.stop(t0 + dur + 0.05); };
    const kick = (t0, v = 0.9) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t0); o.frequency.exponentialRampToValueAtTime(48, t0 + 0.12); env(g, t0, 0.002, v, 0.26); o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.35); nz(t0, 0.02, v * 0.18, 'bandpass', 2600, 1); };      // the click on top is what a phone speaker plays
    const lpf = f => { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; return b; };
    const send = (g, amt = 0.3) => { const pg = ctx.createGain(); pg.gain.value = amt; g.connect(pg); pg.connect(delay); };
    // keep the bass in E2..E3 (82-165 Hz): the song's own register, still audible
    const bassNote = m => { while (m > 52) m -= 12; while (m < 40) m += 12; return m; };
    const bass = (tt, m, durSteps, vol, bright = 700) => {
      const f = midi(m), d = durSteps * sixteenth;
      held('sawtooth', f, tt, d, vol * 0.7, 0.008, 0.08, out, lpf(bright)); held('sine', f, tt, d, vol, 0.006, 0.08); held('triangle', f * 2, tt, d, vol * 0.35, 0.006, 0.06);
    };
    // the lead: voices differ in attack and decay; long notes sustain, short ones are plucked
    function voice(v, m, tt, len, vol) {
      const f = midi(m), d = len * sixteenth, long = len >= 5;
      if (v === 'flute') { const g = held('sine', f, tt, d * 0.95, vol * 1.5, 0.06, 0.12, out, null, 0.004); held('triangle', f * 2, tt, d * 0.8, vol * 0.18, 0.06, 0.1); nz(tt, Math.min(d, 0.3), vol * 0.15, 'bandpass', f * 2, 3); send(g); }
      else if (v === 'lute') { const g = osc('triangle', f, tt, d * (long ? 1.6 : 0.9), vol * 1.6, 0.002); osc('square', f * 2, tt, 0.12, vol * 0.2, 0.001, out, lpf(2200)); send(g); }
      else if (v === 'harp') { const g = osc('sine', f, tt, d * (long ? 2 : 1.3), vol * 1.2, 0.002); osc('sine', f * 3, tt, 0.25, vol * 0.2, 0.001); send(g); }
      else if (v === 'epiano') { const g = osc('sine', f, tt, d * (long ? 1.5 : 1), vol * 1.1, 0.004); osc('sine', f * 2, tt, Math.min(0.9, d * 0.6), vol * 0.4, 0.002); osc('triangle', f * 4, tt, 0.12, vol * 0.12, 0.001); send(g); }
      else { const g = held('square', f, tt, d * 0.9, vol * 0.8, 0.01, 0.1, out, lpf(1900 + 700 * Math.sin(step * 0.03)), 0.003); held('sawtooth', f * 1.004, tt, d * 0.9, vol * 0.3, 0.01, 0.1, out, lpf(2400)); send(g); }
    }
    function nextSong() {
      si = (si + 1) % songs.length; if (songs.length > 2) { let k = Math.floor(Math.random() * songs.length); if (k === si && songs.length > 1) k = (k + 1) % songs.length; si = k; }
      P = songs[si]; plan = buildPlan(P); sixteenth = plan.sixteenth; step = 0; lastBar = -1; trackTitle = P.name; refresh(); if (onSong) onSong(P);
    }
    function schedule() {
      while (t < ctx.currentTime + 0.4) {
        const bar = Math.floor(step / 16), s16 = step % 16;
        if (bar >= plan.bars.length) { nextSong(); continue; }
        const B = plan.bars[bar], [root, q] = B.chord, notes = tri[q], style = P.style;
        const tt = t + (s16 % 2 ? P.swing * sixteenth : 0), nroot = B.next[0];
        if (bar !== lastBar) { lastBar = bar; dyn.gain.setTargetAtTime(0.9 * B.level, Math.max(ctx.currentTime, tt - 0.05), 0.4); }
        const fillNow = B.fill && s16 >= 12;
        // ---- drums
        if (style === 'neon') {
          if (B.kick && s16 % 4 === 0) kick(tt);
          if (B.kick && (s16 === 4 || s16 === 12)) { nz(tt, 0.16, 0.34, 'bandpass', 1800, 0.8); osc('triangle', 190, tt, 0.1, 0.22); }
          if (fillNow) { nz(tt, 0.08, 0.2, 'bandpass', 2200, 0.8); }
          if (B.hats && s16 % 2 === 0) nz(tt, 0.04, s16 % 4 === 2 ? 0.15 : 0.07, 'highpass', 7500);
        } else if (style === 'cruise') {
          if (B.kick && s16 % 4 === 0) kick(tt, 0.6);
          if (B.kick && (s16 === 4 || s16 === 12)) { nz(tt, 0.34, 0.2, 'bandpass', 1500, 0.5); osc('triangle', 180, tt, 0.12, 0.1); }
          if (fillNow && s16 % 2 === 0) nz(tt, 0.1, 0.12, 'bandpass', 2000, 0.6);
          if (B.hats && s16 % 4 === 2) nz(tt, 0.05, 0.06, 'highpass', 8000);
        } else {
          if (B.kick && (s16 === 0 || s16 === 10)) kick(tt, 0.55);
          if (B.kick && (s16 === 4 || s16 === 12)) { nz(tt, 0.2, 0.17, 'bandpass', 1400, 0.6); osc('triangle', 170, tt, 0.12, 0.11); }
          if (fillNow && s16 % 2 === 0) nz(tt, 0.08, 0.1, 'bandpass', 1800, 0.6);
          if (B.hats && s16 % 2 === 0) nz(tt, 0.03, 0.04, 'highpass', 8000);
          if (s16 === 0 && bar % 4 === 0) nz(tt, 0.9, 0.012, 'highpass', 3000);       // a breath of vinyl
        }
        // ---- bass
        const rb = bassNote(root), nb = bassNote(nroot);
        if (B.bassLong) { if (s16 === 0) bass(tt, rb, 15, 0.3, 520); }
        else if (style === 'neon') { if (s16 % 2 === 0) bass(tt, rb + (s16 % 8 === 6 ? 12 : 0), 1.8, 0.3, 520 + 260 * Math.sin(step * 0.05)); }
        else if (style === 'cruise') { if (s16 % 2 === 0) bass(tt, rb, 1.8, 0.28, 420 + 200 * Math.sin(step * 0.02)); }
        else {
          if (s16 === 0) bass(tt, rb, 6, 0.34, 460); if (s16 === 7) bass(tt, rb + 7, 3, 0.26, 460);
          if (s16 === 10) bass(tt, rb + 12 > 55 ? rb : rb + 12, 2, 0.24, 520); if (s16 === 14) bass(tt, nb - 1 < 40 ? nb : nb - 1, 2, 0.2, 460);       // an approach note into the next chord
        }
        // ---- chords
        if (B.pad && s16 === 0) {
          if (style === 'neon') notes.forEach(n => { osc('triangle', midi(root + 12 + n), tt, sixteenth * 15, 0.06, 0.5); osc('sine', midi(root + n), tt, sixteenth * 15, 0.05, 0.4); });
          else if (style === 'cruise') notes.forEach((n, i) => { const pf = lpf(700 + 900 * Math.abs(Math.sin(step * 0.012))); const o = osc('sawtooth', midi(root + 12 + n) * (1 + (i - 1) * 0.003), tt, sixteenth * 15.5, 0.035, 0.7, out, pf); osc('triangle', midi(root + n), tt, sixteenth * 15.5, 0.05, 0.6); send(o); });
          else notes.forEach((n, i) => osc('sine', midi(root + 12 + n), tt + i * 0.01, sixteenth * 15, 0.03, 0.6));
        }
        if (style === 'neon' && B.arp) {
          const arp = [0, 1, 2, 1, 0, 2, 1, 2], ni = notes[arp[s16 % 8] % notes.length] + (s16 % 8 > 4 ? 12 : 0), o = osc('sawtooth', midi(root + 12 + ni), tt, sixteenth * 1.4, 0.06, 0.003, out, lpf(1600 + 1400 * Math.abs(Math.sin(step * 0.03)))); send(o);
        }
        if (style === 'cruise' && (s16 === 6 || s16 === 14) && B.arp) { const o = osc('sine', midi(root + 24 + notes[(step >> 3) % notes.length]), tt, sixteenth * 3, 0.03, 0.01); send(o, 0.5); }       // a far-off bell
        if (style === 'lowkey' && B.arp && (s16 === 0 || s16 === 6 || s16 === 10)) notes.forEach((n, i) => {      // soft electric-piano stabs: a sine plus a decaying overtone
          const f = midi(root + 12 + n), o = osc('sine', f, tt + i * 0.012, sixteenth * 6, 0.06, 0.004); osc('sine', f * 2, tt + i * 0.012, sixteenth * 2.5, 0.025, 0.002); osc('triangle', f * 4, tt + i * 0.012, sixteenth * 1, 0.01, 0.001); send(o, 0.25);
        });
        // ---- melody (composed in songs.js; the B sections double it an octave up, quietly)
        for (const n of B.mel) if (n.s === s16) {
          const vol = P.voice === 'synth' ? 0.07 : 0.085; voice(P.voice, n.midi, tt, n.len, vol * (B.sec === 'bridge' || B.sec === 'outro' ? 0.8 : 1));
          if (B.dbl) osc('triangle', midi(n.midi + 12), tt, Math.min(n.len, 8) * sixteenth, vol * 0.18, 0.02);
        }
        step++; t += sixteenth;
      }
    }
    return { start() { schedule(); this.iv = setInterval(schedule, 120); }, stop() { clearInterval(this.iv); try { dyn.disconnect(); } catch (e) { /* ignore */ } } };
  }

  // ---------------- file stations -------------------------------------------------------------------------------
  function mediaEl() {
    if (elem) return elem;
    elem = new Audio(); elem.preload = 'auto'; elem.crossOrigin = 'anonymous';
    elemSrc = ctx.createMediaElementSource(elem); elemSrc.connect(musicGain());
    elem.addEventListener('ended', () => trackEnded());
    elem.addEventListener('error', () => { if (idx >= 0 && stations[idx].type === 'files') setTimeout(() => playNext(), 1500); });
    return elem;
  }
  let queue = [];
  function playNext() {
    const s = stations[idx]; if (!s || s.type !== 'files') return;
    if (!queue.length) queue = s.tracks.map((t, i) => i).sort(() => Math.random() - 0.5);
    const t = s.tracks[queue.shift()]; trackTitle = t.title; refresh();
    const e = mediaEl(); e.src = 'radio/' + t.file; e.play().catch(() => { /* needs a tap first */ });
  }
  function trackEnded() {
    const s = stations[idx]; if (!s || s.type !== 'files') return;
    if (s.dj) djBreak(s, () => playNext()); else playNext();
  }

  // ---------------- the DJ ---------------------------------------------------------------------------------------
  const djOK = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined' && settings.sound !== false;
  const spoken = n => (n < 0 ? 'minus ' + Math.abs(Math.round(n)) : String(Math.round(n))) + ' degrees';
  const timeWords = h => { const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60), ap = hh >= 12 ? 'PM' : 'AM', h12 = hh % 12 || 12; return mm === 0 ? `${h12} o'clock ${ap}` : `${h12}:${String(mm).padStart(2, '0')} ${ap}`; };
  const condWords = k => ({ clear: 'clear skies', cloudy: 'cloudy skies', fog: 'fog around', rain: 'rain falling', snow: 'snow falling' })[k] || 'quiet weather';
  // what's new in the city: the DJs read the latest big changes out between songs. NEWS is newest first and holds only the last five;
  // each item is read at most once an hour (remembered across reloads), so add a new item at the top and drop the oldest whenever the game changes.
  const NEWS = [
    { id: 'airport', text: () => cityName() === 'San Francisco' ? 'The new airport is open. Drive to the departures gate south east of SoMa, hold still for a moment, and you are on a flight to Chicago.' : 'The new airport has opened on the Meigs Field lakefront. Drive to the departures gate, hold still for a moment, and you are on a flight to San Francisco.' },
    { id: 'sf', text: () => 'San Francisco is now on the map. Take the Golden Gate Bridge north to Marin, and follow the arch that says Chicago. Or pick your city from the menu.' },
    { id: 'port', text: () => 'A big container terminal is open out on the lake, with working cranes unloading a container ship and a tanker all day long. Mind the forklifts.' },
    { id: 'signs', text: () => 'Highway crews have put lamps over every overhead sign, so you can read your exit even in the middle of the night.' },
    { id: 'metro', text: () => 'San Francisco has a two line metro now, and there are more boats moored along Navy Pier.' }
  ];
  const HOUR = 3600 * 1000, HEARD_KEY = 'gridlock-radio-heard';
  const heard = () => { try { return JSON.parse(localStorage.getItem(HEARD_KEY) || '{}'); } catch (e) { return {}; } };
  const nextNews = () => { const h = heard(), now = Date.now(); return NEWS.find(n => !(now - (h[n.id] || 0) < HOUR)) || null; };      // the newest item not heard in the last hour
  const markHeard = id => { try { const h = heard(); h[id] = Date.now(); localStorage.setItem(HEARD_KEY, JSON.stringify(h)); } catch (e) { /* ignore */ } };
  const cityName = () => (MAP && MAP.city === 'sf') ? 'San Francisco' : 'Chicago';
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function script(st, kind) {
    const dj = st.dj, now = weather.now, o = weather.outlook(), greet = pick(dj.greet), quip = dj.quips && Math.random() < 0.55 ? ' ' + pick(dj.quips) : '';
    const time = `It's ${timeWords(settings.hour)}.`, cur = `Right now it's ${spoken(now.temp)} in ${cityName()} with ${condWords(now.kind)}.`;
    const id = `You're listening to ${st.name}, ${st.tag || 'on the air'}.`;
    if (kind === 'ident') return `${greet} ${id}${quip}`;
    if (kind === 'quip') return `${greet} ${dj.quips ? pick(dj.quips) : id}`;
    if (kind === 'news') { const n = nextNews(); if (!n) return script(st, 'time'); markHeard(n.id); return `${greet} Here's what's new in the city. ${n.text()}${quip}`; }
    if (kind === 'forecast') return `${greet} ${time} ${cur} ${o.text}${quip}`;
    return `${greet} ${time} ${cur}${now.kind === 'snow' ? ' Watch the roads, the ploughs are out.' : now.kind === 'rain' ? ' Slow down on the wet stuff.' : ''}${quip}`;
  }
  function pickVoice(dj) {
    const vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); if (!vs.length) return null;
    if (dj.voice) { const m = vs.find(v => v.name.toLowerCase().includes(dj.voice.toLowerCase())); if (m) return m; }
    const key = (dj.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0); return vs[key % vs.length];
  }
  // The host talks through speechSynthesis. Three things used to go wrong: (1) the music was ducked as soon as we asked, so when the
  // browser silently refused to speak (no user activation after a page reload / tunnel trip, no voices yet) the radio stayed quiet for
  // 40 s with nobody talking; (2) cancel() straight before speak() is dropped by Chrome, and the cancelled line's end event ducked the
  // *next* line; (3) a refused line was never retried. Now: duck only once speech really starts, stale events are ignored by a token,
  // a refused line is retried on the next key press / click, and a watchdog un-ducks if the engine goes quiet.
  let sayTok = 0, pending = null;
  const retry = () => { if (pending && !djBusy) { const p = pending; pending = null; say(p.st, p.text, p.done); } };
  if (typeof window !== 'undefined') ['keydown', 'pointerdown', 'touchstart'].forEach(ev => window.addEventListener(ev, retry, { passive: true }));
  function say(st, text, done) {
    if (settings.sound === false) { done && done(); return; }
    caption(st.dj.name, text);
    if (!djOK()) { setTimeout(() => caption(), Math.min(9000, 2500 + text.length * 60)); done && done(); return; }        // no speech engine: show the host's words instead
    const tok = ++sayTok; djBusy = true; el.classList.add('talk'); let spoke = false, fin = false, wd = 0;
    const u = new SpeechSynthesisUtterance(text), v = pickVoice(st.dj); if (v) u.voice = v;
    u.pitch = st.dj.pitch || 1; u.rate = st.dj.rate || 1; u.volume = 1;
    const end = (refused) => {
      if (fin) return; fin = true; clearTimeout(wd); if (tok === sayTok) caption();
      if (tok === sayTok) { djBusy = false; el.classList.remove('talk'); duck(false); if (refused && !spoke) pending = { st, text, done }; }
      if (!refused || spoke) done && done(); else if (tok !== sayTok) done && done();
    };
    u.onstart = () => { spoke = true; if (tok === sayTok && !fin) duck(true); };
    u.onend = () => end(false); u.onerror = e => end(!!(e && (e.error === 'not-allowed' || e.error === 'synthesis-failed')));
    // watchdog: if nothing has started after 4 s the engine is not going to speak; if it started, allow the line's length
    wd = setTimeout(() => end(!spoke), Math.min(40000, 4000 + text.length * 110));
    try { if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); setTimeout(() => { if (tok === sayTok && !fin) speechSynthesis.speak(u); }, 80); } else speechSynthesis.speak(u); }
    catch (e) { end(false); }
  }
  function djBreak(st, done) {
    const r = Math.random(), kind = r < 0.22 ? 'time' : r < 0.42 ? 'forecast' : r < 0.62 ? (nextNews() ? 'news' : 'quip') : r < 0.82 ? 'quip' : 'ident';
    say(st, script(st, kind), done);
  }

  // ---------------- switching ------------------------------------------------------------------------------------------
  function stop() {
    if (seq) { seq.stop(); seq = null; } if (elem) { elem.pause(); }
    if (typeof speechSynthesis !== 'undefined') { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    sayTok++; pending = null; caption(); djBusy = false; el.classList.remove('talk'); if (bus) duck(false); trackTitle = '';
  }
  function tune(i) {
    if (!setup()) return;
    stop(); idx = i;
    if (idx < 0) { refresh(); return; }
    const s = stations[idx]; queue = [];
    if (mg) mg.gain.value = 0.9;
    if (s.type === 'synth') { seq = mkSeq(s.synth, () => { const st = stations[idx]; if (st && st.dj && !djBusy) setTimeout(() => { if (stations[idx] === st && !djBusy) djBreak(st); }, 700); }); seq.start(); nextBreak = performance.now() + 330000 + Math.random() * 60000; }
    else playNext();
    refresh();
    if (s.dj && djOK()) setTimeout(() => { if (idx === i && !djBusy) say(s, script(s, 'ident')); }, 1800);
  }
  function next(dir = 1) {
    audio.unlock && audio.unlock();
    audio.whenReady(() => { const n = stations.length + 1; tune(((idx + 1 + dir + n) % n) - 1); });
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = () => { /* voices load lazily; pickVoice reads them at speak time */ };

  return {
    get station() { return stations[idx] || null; },
    get playing() { return idx >= 0; },
    update(dt, st) {
      // synth stations: a DJ break every minute or two
      if (idx >= 0 && stations[idx].type === 'synth' && stations[idx].dj && !djBusy && performance.now() > nextBreak && djOK()) {
        nextBreak = performance.now() + 300000 + Math.random() * 120000; djBreak(stations[idx]);      // safety net in case a song change was missed
      }
      // distance / place: on foot the car radio fades with distance; in a flat it plays quietly like a stereo in the next room
      if (bus && audio.radioFilter && st) {
        const v = st.place === 'flat' ? 0.35 : st.onFoot ? 1 / (1 + (st.dFoot || 0) / 9) : 1;
        if (mg) mg.gain.setTargetAtTime(0.9 * v, ctx.currentTime, 0.25);
        audio.radioFilter.frequency.setTargetAtTime(st.place === 'flat' ? 1400 : st.onFoot && (st.dFoot || 0) > 6 ? 2400 : 18000, ctx.currentTime, 0.3);
      }
    },
    next, tune, off: () => tune(-1), get names() { return stations.map(s => s.name); },
    // by id (travel.js restores the station on the far side of the tunnel); false if there is no such station (yet)
    tuneId(id) { const i = stations.findIndex(s => s.id === id); if (i < 0) return false; if (i !== idx) audio.whenReady(() => tune(i)); return true; }
  };
}
