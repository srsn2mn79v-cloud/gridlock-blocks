// The car radio. Stations come from two places:
//   * built-in synthesised stations (Neon Drive, Low Key): played by a tiny step sequencer, no files needed;
//   * folders of songs you add under public/radio/<station>/ (listed in radio/stations.json by tools/radio-manifest.mjs).
// Every station has a DJ who talks between songs using the browser's built-in speech synthesis: the time, the current weather and
// temperature, and the outlook for the rest of the day and tomorrow (from weather.js). Music ducks while the DJ speaks.
// Press R (or tap the radio pill) to change station. The radio keeps playing in garages (with the garage echo) and quietly in flats.
const midi = n => 440 * Math.pow(2, (n - 69) / 12);

const SYNTH = [
  { id: 'neon', name: 'Neon Drive', synth: 'neon', tag: 'all night, all neon', dj: { name: 'DJ Vega', pitch: 0.9, rate: 1.04, greet: ['Hey night owls.', 'Good to have you out there.', 'Keep it between the lines, drivers.', 'Neon Drive, still rolling.'] } },
  { id: 'lowkey', name: 'Low Key', synth: 'lowkey', tag: 'slow roads and soft lights', dj: { name: 'Maya', pitch: 1.12, rate: 0.93, greet: ['Easy does it.', 'Take your time out there.', 'Nowhere to be, nothing to prove.', 'Low Key, keeping it mellow.'] } }
];
const PERSONAS = [{ pitch: 1.0, rate: 1.0 }, { pitch: 0.85, rate: 0.98 }, { pitch: 1.2, rate: 1.05 }, { pitch: 0.95, rate: 0.92 }];

export function createRadio({ audio, weather, settings, onChange }) {
  let ctx = null, bus = null, noise = null, delay = null;
  const stations = SYNTH.map(s => ({ ...s, type: 'synth' }));
  let idx = -1, timer = null, seq = null, elem = null, elemSrc = null, trackTitle = '', djBusy = false, nextBreak = 0, files = null;

  // ---------------- UI -------------------------------------------------------------------------------------
  const el = document.createElement('div'); el.id = 'radio';
  const css = document.createElement('style');
  css.textContent = '#radio{position:fixed;top:40px;right:10px;z-index:6;font:600 12px system-ui,sans-serif;color:#fff;background:rgba(14,18,26,.55);padding:4px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.14);cursor:pointer;max-width:min(60vw,280px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px #000;pointer-events:auto}#radio.on{border-color:rgba(255,210,31,.6)}#radio.talk::after{content:" 🎙";}html.touch #radio{top:34px;font-size:11px}';
  document.head.appendChild(css); document.body.appendChild(el);
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

  // ---------------- a small step sequencer for the built-in stations -------------------------------------------
  function mkSeq(kind) {
    const out = musicGain(), P = kind === 'neon'
      ? { bpm: 108, chords: [[57, 'm'], [53, 'M'], [48, 'M'], [55, 'M']], swing: 0 }
      : { bpm: 78, chords: [[53, 'M7'], [52, 'm7'], [50, 'm9'], [48, 'M7']], swing: 0.12 };
    const tri = { m: [0, 3, 7], M: [0, 4, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m9: [0, 3, 7, 14] };
    let step = 0, t = ctx.currentTime + 0.1;
    const env = (g, t0, a, peak, d) => { g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0005, t0 + a + d); };
    const osc = (type, f, t0, dur, vol, a = 0.005, dest = out, filt = null) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f; env(g, t0, a, vol, dur); if (filt) { o.connect(filt); filt.connect(g); } else o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + a + dur + 0.05); return o; };
    const nz = (t0, dur, vol, ftype, f, q = 1) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; const b = ctx.createBiquadFilter(); b.type = ftype; b.frequency.value = f; b.Q.value = q; const g = ctx.createGain(); env(g, t0, 0.002, vol, dur); s.connect(b); b.connect(g); g.connect(out); s.start(t0, Math.random()); s.stop(t0 + dur + 0.05); };
    const kick = (t0, v = 0.9) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t0); o.frequency.exponentialRampToValueAtTime(42, t0 + 0.13); env(g, t0, 0.002, v, 0.28); o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.35); };
    const lpf = (f) => { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; return b; };
    const sixteenth = 60 / P.bpm / 4;
    function schedule() {
      while (t < ctx.currentTime + 0.4) {
        const bar = Math.floor(step / 16) % P.chords.length, s16 = step % 16, [root, q] = P.chords[bar], notes = tri[q];
        const sw = (s16 % 2 ? P.swing * sixteenth : 0), tt = t + sw;
        if (kind === 'neon') {
          if (s16 % 4 === 0) kick(tt);
          if (s16 === 4 || s16 === 12) { nz(tt, 0.16, 0.35, 'bandpass', 1800, 0.8); osc('triangle', 190, tt, 0.1, 0.25); }
          if (s16 % 2 === 0) nz(tt + (s16 % 4 === 2 ? 0 : 0.0), 0.04, s16 % 4 === 2 ? 0.16 : 0.07, 'highpass', 7500);
          if (s16 % 2 === 0) { const f = midi(root - 12 + (s16 % 8 === 6 ? 12 : 0)); osc('sawtooth', f, tt, sixteenth * 1.8, 0.24, 0.004, out, lpf(480 + 200 * Math.sin(step * 0.05))); }
          const arp = [0, 1, 2, 1, 0, 2, 1, 2], ni = notes[arp[(s16 >> 0) % 8] % notes.length] + (s16 % 8 > 4 ? 12 : 0);
          const pf = lpf(1600 + 1400 * Math.abs(Math.sin(step * 0.03)));
          const o = osc('sawtooth', midi(root + 12 + ni), tt, sixteenth * 1.4, 0.07, 0.003, out, pf); const pg = ctx.createGain(); pg.gain.value = 0.3; o.connect(pg); pg.connect(delay);
          if (s16 === 0) notes.forEach(n => { osc('triangle', midi(root + 12 + n), tt, sixteenth * 15, 0.06, 0.5); osc('sine', midi(root + n), tt, sixteenth * 15, 0.05, 0.4); });
        } else {
          if (s16 === 0 || s16 === 10) kick(tt, 0.55);
          if (s16 === 4 || s16 === 12) { nz(tt, 0.2, 0.18, 'bandpass', 1400, 0.6); osc('triangle', 170, tt, 0.12, 0.12); }
          if (s16 % 2 === 0) nz(tt, 0.03, 0.04, 'highpass', 8000);
          if (s16 === 0 || s16 === 7 || s16 === 12) osc('sine', midi(root - 12), tt, sixteenth * 4, 0.34, 0.01);
          if (s16 === 0 || s16 === 6 || s16 === 10) notes.forEach((n, i) => {      // soft electric-piano stabs: a sine plus a decaying overtone
            const f = midi(root + 12 + n), o = osc('sine', f, tt + i * 0.012, sixteenth * 6, 0.07, 0.004); osc('sine', f * 2, tt + i * 0.012, sixteenth * 2.5, 0.03, 0.002); osc('triangle', f * 4, tt + i * 0.012, sixteenth * 1, 0.012, 0.001);
            const pg = ctx.createGain(); pg.gain.value = 0.25; o.connect(pg); pg.connect(delay);
          });
          if (s16 === 0) nz(tt, 0.9, 0.012, 'highpass', 3000);        // a breath of vinyl
        }
        step++; t += sixteenth;
      }
    }
    return { start() { schedule(); this.iv = setInterval(schedule, 120); }, stop() { clearInterval(this.iv); } };
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
    if (s.dj && djOK() && Math.random() < 0.75) djBreak(s, () => playNext()); else playNext();
  }

  // ---------------- the DJ ---------------------------------------------------------------------------------------
  const djOK = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined' && settings.sound !== false;
  const spoken = n => (n < 0 ? 'minus ' + Math.abs(Math.round(n)) : String(Math.round(n))) + ' degrees';
  const timeWords = h => { const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60), ap = hh >= 12 ? 'PM' : 'AM', h12 = hh % 12 || 12; return mm === 0 ? `${h12} o'clock ${ap}` : `${h12}:${String(mm).padStart(2, '0')} ${ap}`; };
  const condWords = k => ({ clear: 'clear skies', cloudy: 'cloudy skies', fog: 'fog around', rain: 'rain falling', snow: 'snow falling' })[k] || 'quiet weather';
  function script(st, kind) {
    const dj = st.dj, now = weather.now, o = weather.outlook(), greet = dj.greet[Math.floor(Math.random() * dj.greet.length)];
    const time = `It's ${timeWords(settings.hour)}.`, cur = `Right now it's ${spoken(now.temp)} in Chicago with ${condWords(now.kind)}.`;
    const id = `You're listening to ${st.name}, ${st.tag || 'on the air'}.`;
    if (kind === 'ident') return `${greet} ${id}`;
    if (kind === 'forecast') return `${greet} ${time} ${cur} ${o.text}`;
    return `${greet} ${time} ${cur}${now.kind === 'snow' ? ' Watch the roads, the ploughs are out.' : now.kind === 'rain' ? ' Slow down on the wet stuff.' : ''}`;
  }
  function pickVoice(dj) {
    const vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); if (!vs.length) return null;
    if (dj.voice) { const m = vs.find(v => v.name.toLowerCase().includes(dj.voice.toLowerCase())); if (m) return m; }
    const key = (dj.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0); return vs[key % vs.length];
  }
  function say(st, text, done) {
    if (!djOK()) { done && done(); return; }
    djBusy = true; el.classList.add('talk'); duck(true);
    const u = new SpeechSynthesisUtterance(text), v = pickVoice(st.dj); if (v) u.voice = v;
    u.pitch = st.dj.pitch || 1; u.rate = st.dj.rate || 1; u.volume = Math.min(1, 0.9 * (settings.volume != null ? 1 : 1));
    let fin = false; const end = () => { if (fin) return; fin = true; djBusy = false; el.classList.remove('talk'); duck(false); done && done(); };
    u.onend = end; u.onerror = end; setTimeout(end, 40000);
    try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { end(); }
  }
  function djBreak(st, done) {
    const r = Math.random(), kind = r < 0.4 ? 'time' : r < 0.75 ? 'forecast' : 'ident';
    say(st, script(st, kind), done);
  }

  // ---------------- switching ------------------------------------------------------------------------------------------
  function stop() {
    if (seq) { seq.stop(); seq = null; } if (elem) { elem.pause(); }
    if (typeof speechSynthesis !== 'undefined') { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    djBusy = false; el.classList.remove('talk'); if (bus) duck(false); trackTitle = '';
  }
  function tune(i) {
    if (!setup()) return;
    stop(); idx = i;
    if (idx < 0) { refresh(); return; }
    const s = stations[idx]; queue = [];
    if (mg) mg.gain.value = 0.9;
    if (s.type === 'synth') { seq = mkSeq(s.synth); seq.start(); trackTitle = 'built-in'; nextBreak = performance.now() + 70000 + Math.random() * 60000; }
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
        nextBreak = performance.now() + 100000 + Math.random() * 100000; djBreak(stations[idx]);
      }
      // distance / place: on foot the car radio fades with distance; in a flat it plays quietly like a stereo in the next room
      if (bus && audio.radioFilter && st) {
        const v = st.place === 'flat' ? 0.35 : st.onFoot ? 1 / (1 + (st.dFoot || 0) / 9) : 1;
        if (mg) mg.gain.setTargetAtTime(0.9 * v, ctx.currentTime, 0.25);
        audio.radioFilter.frequency.setTargetAtTime(st.place === 'flat' ? 1400 : st.onFoot && (st.dFoot || 0) > 6 ? 2400 : 18000, ctx.currentTime, 0.3);
      }
    },
    next, tune, off: () => tune(-1), get names() { return stations.map(s => s.name); }
  };
}
