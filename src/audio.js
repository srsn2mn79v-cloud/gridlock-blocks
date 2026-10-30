// All the sound, synthesised with the Web Audio API (no files): engines (revs follow the speed through a gearbox; a small
// petrol four, a V8, diesels), horns, tyre squeal, indicators, rolling noise (asphalt / grass / snow, wet), wind, rain, cars
// passing, air brakes and crashes. `createAudio({ camera })` returns { unlock, setEnabled, setVolume, update, honk, crash }.
import * as THREE from 'three';

// engine "kinds": cylinders, idle / redline rpm, how much the pulses are chopped (clatter), growl, base tone
const ENGINES = {
  i4:     { cyl: 4, idle: 850,  red: 6800, am: 0.10, drive: 1.4, saw: 1.0, sub: 0.35, cut: 1.0, vol: 0.55, name: 'petrol four' },
  hatch:  { cyl: 3, idle: 900,  red: 6400, am: 0.16, drive: 1.6, saw: 1.0, sub: 0.25, cut: 0.9, vol: 0.5,  name: 'small three-pot' },
  sport:  { cyl: 6, idle: 900,  red: 8200, am: 0.05, drive: 2.0, saw: 1.0, sub: 0.2,  cut: 1.4, vol: 0.55, name: 'inline six' },
  v8:     { cyl: 8, idle: 700,  red: 6200, am: 0.30, drive: 3.2, saw: 0.8, sub: 0.9,  cut: 0.7, vol: 0.7,  name: 'V8' },
  diesel: { cyl: 4, idle: 650,  red: 3300, am: 0.55, drive: 2.4, saw: 0.5, sub: 0.7,  cut: 0.55, vol: 0.6, name: 'diesel', clatter: 0.5 },
  heavy:  { cyl: 6, idle: 600,  red: 2700, am: 0.62, drive: 2.8, saw: 0.4, sub: 1.0,  cut: 0.45, vol: 0.75, name: 'heavy diesel', clatter: 0.8, turbo: 1 }
};
export const ENGINE_FOR = { hatch: 'hatch', taxi: 'i4', sport: 'sport', muscle: 'v8', wagon: 'i4', suv: 'diesel', rally: 'i4', roadster: 'sport', supercar: 'sport', hyper: 'v8', pickup: 'diesel', van: 'diesel', bus: 'heavy', truck: 'heavy', sedan: 'i4', police: 'sport', ambulance: 'diesel', fire: 'heavy', plow: 'heavy' };
const HEAVY = { bus: 1, truck: 1, van: 0.5, pickup: 0.35, fire: 1, plow: 1, ambulance: 0.5 };

export function createAudio({ camera }) {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  let ctx = null, master = null, comp = null, enabled = true, volume = 0.7, ready = false;
  let noiseBuf = null;
  const v3 = new THREE.Vector3(), camDir = new THREE.Vector3();

  function init() {
    if (ctx || !AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = enabled ? volume : 0;
    master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // a shared reverb for garages and tunnels (rain, engine and drips are fed into it) and a bus the radio plays through
    revIn = ctx.createGain(); revOut = ctx.createGain(); revOut.gain.value = 0; conv = ctx.createConvolver(); setIR(1.8);
    revIn.connect(conv); conv.connect(revOut); revOut.connect(master);
    radioBus = ctx.createGain(); radioBus.gain.value = 1; radioLP = biquad('lowpass', 18000, 0.5); radioBus.connect(radioLP); radioLP.connect(master); radioSend = gain(0); radioLP.connect(radioSend); radioSend.connect(revIn);
    build();
    ready = true;
    readyCbs.splice(0).forEach(f => f());
  }
  let revIn = null, revOut = null, conv = null, radioBus = null, radioLP = null, radioSend = null, irSec = 0; const readyCbs = [];
  function setIR(sec) {            // a synthetic room: decaying stereo noise
    if (irSec === sec) return; irSec = sec;
    const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6); }
    conv.buffer = b;
  }
  const noiseSrc = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 1.5); return s; };
  const biquad = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const curve = amt => { const n = 256, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * amt) / Math.tanh(amt); } return c; };

  // ---- an engine voice (used for the player and, lighter, for nearby traffic) ----------------------------------------------------
  function makeEngine(kindKey, out, withPan) {
    const E = ENGINES[kindKey] || ENGINES.i4;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'triangle';
    const g1 = gain(E.saw * 0.85), g2 = gain(0.1 * E.cut), g3 = gain(E.sub * 1.1);
    const shaper = ctx.createWaveShaper(); shaper.curve = curve(E.drive * 0.5); shaper.oversample = 'none';
    const lp = biquad('lowpass', 600, 0.5), lp2 = biquad('lowpass', 1500, 0.4), body = biquad('peaking', 140, 1.0); body.gain.value = 5;
    // a slow random-ish wobble in pitch keeps it from sounding like a clean synth tone
    const wob = ctx.createOscillator(), wobG = gain(14); wob.frequency.value = 4.7 + Math.random() * 3; wob.connect(wobG); wobG.connect(o1.detune); wobG.connect(o3.detune);
    const wob2 = ctx.createOscillator(), wob2G = gain(9); wob2.frequency.value = 11 + Math.random() * 5; wob2.connect(wob2G); wob2G.connect(o2.detune);
    const am = gain(1 - E.am * 0.5), lfo = ctx.createOscillator(), lfoG = gain(E.am * 0.5); lfo.type = E.clatter ? 'square' : 'sine';
    lfo.connect(lfoG); lfoG.connect(am.gain);
    o1.connect(g1); o2.connect(g2); o3.connect(g3); g1.connect(shaper); g2.connect(shaper); g3.connect(shaper);
    shaper.connect(lp); lp.connect(lp2); lp2.connect(body); body.connect(am);
    const outG = gain(0); am.connect(outG);
    // intake / exhaust hiss and (diesel) mechanical clatter
    const ns = noiseSrc(), nbp = biquad('bandpass', 900, 0.8), ng = gain(0), nAm = gain(1);
    ns.connect(nbp); nbp.connect(ng); ng.connect(outG);
    let turbo = null, tg = null;
    if (E.turbo) { turbo = ctx.createOscillator(); turbo.type = 'sine'; tg = gain(0); turbo.connect(tg); tg.connect(outG); turbo.start(); }
    let last = outG;
    if (withPan) { const p = ctx.createStereoPanner(); outG.connect(p); p.connect(out); last = p; } else outG.connect(out);
    [o1, o2, o3, lfo, wob, wob2].forEach(o => o.start());
    return {
      E, outG, pan: withPan ? last : null,
      set(rpm, load, vol, doppler = 1) {
        const fire = rpm / 60 * E.cyl / 2 * doppler;
        const t = ctx.currentTime, k = 0.04;
        o1.frequency.setTargetAtTime(fire, t, k); o2.frequency.setTargetAtTime(fire * 2.01, t, k); o3.frequency.setTargetAtTime(fire * 0.5, t, k);
        lfo.frequency.setTargetAtTime(E.clatter ? fire * 0.5 : fire * (E.cyl >= 8 ? 0.25 : 0.5), t, k);
        const f = (E.red / 6800);
        lp.frequency.setTargetAtTime((170 + load * 380 + rpm * 0.1) * (E.cut), t, 0.06);
        lp2.frequency.setTargetAtTime(900 + rpm * 0.14, t, 0.1);
        body.frequency.setTargetAtTime(Math.max(70, fire * 0.5), t, 0.1);
        lfoG.gain.setTargetAtTime(E.am * (0.35 + 0.65 * (1 - load * 0.5)) * 0.5, t, 0.1);
        outG.gain.setTargetAtTime(vol * E.vol * 0.8 * (0.35 + 0.65 * load) * (0.85 + 0.15 * Math.min(1, rpm / E.red)), t, 0.06);
        nbp.frequency.setTargetAtTime(400 + rpm * 0.2, t, 0.1); ng.gain.setTargetAtTime((E.clatter ? 0.10 * E.clatter : 0.05) * (0.3 + load) , t, 0.1);
        if (turbo) { turbo.frequency.setTargetAtTime(1500 + rpm * 1.1, t, 0.1); tg.gain.setTargetAtTime(0.012 * load * Math.min(1, (rpm - E.idle) / 1500), t, 0.1); }
      },
      stop() { try { [o1, o2, o3, lfo, wob, wob2, ns, turbo].forEach(o => o && o.stop()); outG.disconnect(); } catch (e) { /* already stopped */ } }
    };
  }

  // ---- long-running layers ------------------------------------------------------------------------------------------------------------------
  let player = null, playerKind = null, traffic = [], layers = null, engSend = null;
  function build() {
    const L = layers = {};
    const loop = (type, f, q) => { const s = noiseSrc(), b = biquad(type, f, q), g = gain(0); s.connect(b); b.connect(g); g.connect(master); return { s, b, g }; };
    L.roll = loop('bandpass', 500, 0.7); L.rollHi = loop('highpass', 2500, 0.5); L.wind = loop('lowpass', 900, 0.4);
    L.skid = loop('bandpass', 1500, 6); L.skid2 = loop('bandpass', 2400, 10); L.gravel = loop('lowpass', 700, 0.6);
    L.rain = loop('highpass', 1400, 0.5); L.rainLo = loop('lowpass', 7000, 0.5); L.rainBody = loop('bandpass', 400, 0.6);
    L.snow = loop('bandpass', 260, 0.5);
    L.hum = loop('lowpass', 170, 0.5); L.bed = loop('bandpass', 420, 0.5); L.crowd = loop('bandpass', 1000, 0.7); L.crowd2 = loop('bandpass', 1800, 1.2);
    L.tun = loop('lowpass', 260, 0.7); L.scrape = loop('bandpass', 2600, 1.5);
    [L.rain, L.rainLo, L.rainBody].forEach(l => l.g.connect(revIn));
  }
  function setPlayer(kind) {
    if (player && playerKind === kind) return;
    if (player) player.stop();
    player = makeEngine(kind, master, false); playerKind = kind;
    engSend = engSend || gain(0); engSend.connect(revIn); player.outG.connect(engSend);
  }
  const T = (p, v, tc = 0.06) => p.g.gain.setTargetAtTime(v, ctx.currentTime, tc);

  // ---- one-shots ------------------------------------------------------------------------------------------------------------------------------
  function spatial(x, z, ref = 12) {
    camera.getWorldDirection(camDir);
    const dx = x - camera.position.x, dz = z - camera.position.z, d = Math.hypot(dx, dz) || 1;
    const pan = Math.max(-1, Math.min(1, (dx * -camDir.z + dz * camDir.x) / d));
    return { pan, vol: 1 / (1 + Math.pow(d / ref, 1.5)), d };
  }
  const out = (pan, v) => { const g = gain(v), p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(master); return g; };
  function tick(on) {                 // indicator relay: a dry click, higher on the way on
    if (!ready || !enabled) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = gain(0); o.type = 'square'; o.frequency.value = on ? 2300 : 1750;
    const b = biquad('bandpass', on ? 2300 : 1750, 3); o.connect(b); b.connect(g); g.connect(master);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(on ? 0.16 : 0.1, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.028);
    o.start(t); o.stop(t + 0.04);
  }
  const PATTERNS = {
    tap: [[0.13, 0]], double: [[0.12, 0.09], [0.12, 0]], long: [[0.8, 0]], triple: [[0.1, 0.07], [0.1, 0.07], [0.1, 0]],
    angry: [[0.18, 0.06], [0.18, 0.06], [0.55, 0]], shave: [[0.16, 0.08], [0.1, 0.05], [0.1, 0.05], [0.4, 0]], blast: [[1.3, 0]]
  };
  // a horn: two reed tones a third apart. Heavy vehicles are lower, longer and rougher.
  function honk(x, z, heavy = 0, pattern = null, seed = Math.random()) {
    if (!ready || !enabled) return;
    const sp = spatial(x, z, 22); if (sp.d > 220) return;
    const names = heavy >= 1 ? ['long', 'blast', 'double', 'angry'] : ['tap', 'double', 'long', 'triple', 'angry', 'shave'];
    const pat = PATTERNS[pattern || names[Math.floor(seed * 997) % names.length]];
    const base = heavy >= 1 ? 150 + seed * 50 : heavy > 0 ? 270 + seed * 80 : 330 + seed * 190;
    const ratio = [1.19, 1.25, 1.33, 1.5][Math.floor(seed * 31) % 4];
    const g = out(sp.pan, 0.55 * sp.vol * (heavy >= 1 ? 1.3 : 1));
    const lp = biquad('lowpass', heavy >= 1 ? 1500 : 2600, 0.7), sh = ctx.createWaveShaper(); sh.curve = curve(heavy >= 1 ? 3 : 1.6);
    lp.connect(sh); sh.connect(g);
    const mk = (f, type) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; const og = gain(0); o.connect(og); og.connect(lp); return { o, og }; };
    const a = mk(base, 'sawtooth'), b = mk(base * ratio, 'square'), c = mk(base * 2.01, 'sawtooth');
    let t = ctx.currentTime + 0.01;
    const gains = [[a, 0.5], [b, 0.3], [c, 0.12]];
    pat.forEach(([on, off]) => {
      gains.forEach(([v, lv]) => { v.og.gain.setValueAtTime(0, t); v.og.gain.linearRampToValueAtTime(lv, t + 0.02); v.og.gain.setValueAtTime(lv, t + on - 0.03); v.og.gain.linearRampToValueAtTime(0, t + on); });
      t += on + off;
    });
    [a, b, c].forEach(v => { v.o.start(); v.o.stop(t + 0.1); });
    setTimeout(() => { try { g.disconnect(); } catch (e) { /* gone */ } }, (t - ctx.currentTime + 0.4) * 1000);
  }
  function burst(pan, vol, f0, f1, dur, q = 1.2, type = 'bandpass') {      // a sweep of filtered noise: whoosh, hiss, thump
    const t = ctx.currentTime, s = noiseSrc(), b = biquad(type, f0, q), g = out(pan, 0);
    s.connect(b); b.connect(g);
    b.frequency.setValueAtTime(f0, t); b.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.08, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    s.stop(t + dur + 0.05); setTimeout(() => { try { g.disconnect(); } catch (e) { /* gone */ } }, (dur + 0.3) * 1000);
  }
  function crash(x, z, power = 1) {
    if (!ready || !enabled) return;
    const sp = spatial(x, z, 10), v = Math.min(1, power) * sp.vol * 1.3;
    burst(sp.pan, v * 0.9, 900, 120, 0.35, 0.6, 'lowpass');
    burst(sp.pan, v * 0.5, 3200, 700, 0.18, 1.5);
    const t = ctx.currentTime, o = ctx.createOscillator(), g = out(sp.pan, 0); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25); o.connect(g);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.start(t); o.stop(t + 0.35);
  }
  function whoosh(x, z, rel) {          // a car goes by at speed: wind slap with a falling pitch
    if (!ready || !enabled) return;
    const sp = spatial(x, z, 14); burst(sp.pan, Math.min(0.55, rel / 70) * (0.4 + sp.vol), 1900, 420, 0.7, 0.9);
  }
  function airBrake(x, z) { if (!ready || !enabled) return; const sp = spatial(x, z, 20); burst(sp.pan, 0.5 * sp.vol, 5200, 2600, 0.9, 0.6, 'highpass'); setTimeout(() => squeak(sp), 0); }
  function squeak(sp) {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = out(sp.pan, 0); o.type = 'sawtooth'; o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.5);
    const f = biquad('bandpass', 1200, 6); o.connect(f); f.connect(g); g.gain.setValueAtTime(0.06 * sp.vol, t); g.gain.linearRampToValueAtTime(0.0, t + 0.5); o.start(t); o.stop(t + 0.6);
  }

  // ---- per-frame --------------------------------------------------------------------------------------------------------------------------------
  const GEARS = [0.17, 0.32, 0.48, 0.64, 0.8, 1.0];
  let rpm = 800, gear = 0, shiftT = 0, blinkSeen = 0, rainAmt = 0, snowAmt = 0, coverSm = 0;
  let ambT = 0;
  const sirenVoices = new Map();
  const prevPos = new Map(), passCool = new Map(), stopSeen = new Map();
  function engineRpm(E, speed, vmax, thr, dt) {
    const f = Math.min(1, Math.abs(speed) / vmax);
    let g = GEARS.findIndex(top => f <= top + 0.001); if (g < 0) g = GEARS.length - 1;
    if (speed < -0.3) { g = 0; shiftT = 0; gear = 0; }   // reversing: one low gear, no shift dips
    else if (g !== gear) { gear = g; shiftT = 0.22; }
    const lo = g ? GEARS[g - 1] * 0.62 : 0, hi = GEARS[g];
    const p = Math.max(0, Math.min(1, (f - lo) / Math.max(0.01, hi - lo)));
    let target = E.idle + (E.red * 0.96 - E.idle) * (0.18 + 0.82 * p) * (f < 0.01 ? 0 : 1) + thr * (f < 0.02 ? (E.red - E.idle) * 0.55 : 0);
    if (shiftT > 0) { shiftT -= dt; target *= 0.78; }
    rpm += (target - rpm) * Math.min(1, dt * (target > rpm ? 7 : 5));
    return rpm;
  }

  function update(dt, S) {
    if (!ready) return;
    if (ctx.state === 'suspended') return;
    const { car, input, onFoot, wet, rain, snow, covered, surface, cars, paused, place = 'open', crowd = 0, density = 0, hour = 12, sirens = [] } = S;
    const live = enabled && !paused;
    master.gain.setTargetAtTime(live ? volume : 0, ctx.currentTime, 0.08);
    if (!live) return;
    const kind = ENGINE_FOR[car.styleKey] || 'i4', E0 = ENGINES[kind];
    setPlayer(kind);
    const speed = Math.abs(car.speed || 0), vmax = Math.max(10, car.maxSpeed || 30);
    const thr = onFoot ? 0 : (input.forward ? 1 : (input.back && car.speed <= 0.3 ? 0.6 : 0)) * (input.throttle == null ? 1 : Math.max(0.3, input.throttle));
    // a burnout: throttle held against the brakes / handbrake (or a standing start with the pedal floored) - the engine screams on the limiter
    const burnout = !onFoot && !car.airborne && thr > 0.7 && ((input.brake || input.handbrake) && speed < 16 || (speed < 2.5 && thr > 0.95 && car.speed >= 0 && !input.back));
    let r = E0.idle + (E0.red - E0.idle) * Math.max(0, (S.rev ? S.rev.r : 0.14) - 0.14) / 0.86;
    if (burnout) r = Math.max(r, E0.red * (0.78 + 0.1 * Math.sin(performance.now() * 0.03)));
    const load = Math.max(0.12, (burnout ? 1 : thr) * (car.airborne ? 0.5 : 1));
    // the player's engine is heard at its full level in the cabin; on foot it fades with the distance to the car
    const dFoot = onFoot ? Math.hypot(camera.position.x - car.x, camera.position.z - car.z) : 0;
    const vol = (onFoot ? 0.5 / (1 + dFoot / 8) : 1) * (covered ? 1.1 : 1);
    player.set(r, load, vol);

    // road noise
    const sp01 = Math.min(1, speed / vmax);
    const L = layers, grass = surface === 'ground', snowy = snow && !covered;
    const rollV = onFoot ? 0 : Math.pow(sp01, 0.85) * (car.airborne ? 0 : 1);
    L.roll.b.frequency.setTargetAtTime(grass ? 220 : 380 + sp01 * 500, ctx.currentTime, 0.1);
    T(L.roll, rollV * (grass ? 0.1 : snowy ? 0.12 : wet ? 0.32 : 0.24));
    T(L.rollHi, rollV * (grass ? 0.025 : wet ? 0.12 * Math.min(1, sp01 * 1.6) : 0.025));    // wet roads hiss at speed
    T(L.snow, snowy && !grass ? rollV * 0.3 : 0);
    T(L.wind, onFoot ? 0 : Math.pow(Math.max(0, sp01 - 0.3) / 0.7, 2) * 0.32 + speed / vmax * 0.02);
    L.wind.b.frequency.setTargetAtTime(500 + sp01 * 1400, ctx.currentTime, 0.2);

    // tyre noise while sliding, braking hard or burning rubber. The surface decides what it sounds like:
    //   dry tarmac: a high, singing squeal; wet tarmac: lower and hissier; snowy tarmac: a soft scrubbing crunch; grass: dull dirt/rustle, no squeal.
    let slip = 0;
    if (!onFoot && !car.airborne && speed > 5) {
      const side = Math.abs((car.vx || 0) * Math.cos(car.heading) - (car.vz || 0) * Math.sin(car.heading));
      slip = Math.max(0, Math.min(1, (side - 2.2) / 6));
      if (input.brake && speed > 14) slip = Math.max(slip, 0.35 * Math.min(1, speed / 24));
      if (car.drifting) slip = Math.max(slip, 0.9);
    }
    if (burnout) slip = Math.max(slip, 0.95);
    const onSnow = snowy && !grass, onWet = wet > 0.3 && !grass && !onSnow;
    const squeal = grass ? 0 : onSnow ? 0.18 : onWet ? 0.62 : 1;
    const t0 = ctx.currentTime;
    T(L.skid, slip * 0.16 * squeal, 0.04); T(L.skid2, slip * 0.1 * squeal * (burnout ? 1.2 : 1), 0.04);
    L.skid.b.frequency.setTargetAtTime((onWet ? 1050 : 1300) + slip * 500 + sp01 * 400 - (burnout ? 250 : 0), t0, 0.05);
    L.skid2.b.frequency.setTargetAtTime((onWet ? 1700 : 2400) + slip * 300 - (burnout ? 400 : 0), t0, 0.05);
    T(L.gravel, grass ? slip * 0.4 : onSnow ? slip * 0.3 : 0, 0.05);                 // dirt / rustle on grass, crunch in snow
    if (onSnow) T(L.snow, Math.max(rollV * 0.3, slip * 0.38), 0.05);                   // scrubbing through the snow
    if (onWet) T(L.rollHi, Math.max(rollV * 0.12 * Math.min(1, sp01 * 1.6), slip * 0.1), 0.05);   // hiss thrown up from wet asphalt

    // indicators
    if (car.blinkEvent) { tick(car.blinkEvent > 0); car.blinkEvent = 0; }

    // where we are: open streets / tunnel / underground garage / inside a flat
    const open = place === 'open', tunnel = place === 'tunnel', garage = place === 'garage', flat = place === 'flat';
    // weather
    const wantRain = rain ? 1 : 0; rainAmt += (wantRain - rainAmt) * Math.min(1, dt * 1.5);
    coverSm += ((covered ? 1 : 0) - coverSm) * Math.min(1, dt * 4);
    const rv = rainAmt * (1 - (garage ? 0.82 : tunnel ? 0.6 : flat ? 0.7 : 0.72) * coverSm);
    T(L.rain, rv * (garage ? 0.06 : 0.1), 0.2); T(L.rainLo, rv * 0.1, 0.2); T(L.rainBody, rv * (garage ? 0.2 : tunnel ? 0.12 : 0.14), 0.2);
    L.rain.b.frequency.setTargetAtTime(coverSm > 0.5 ? (garage ? 450 : 700) : 1400, t0, 0.2);
    L.rainLo.b.frequency.setTargetAtTime(coverSm > 0.5 ? (garage ? 700 : 1100) : 7000, t0, 0.2);
    // echo: more in the tunnel (long), a short boxy one in the garage; engine, rain and radio ring in it
    revOut.gain.setTargetAtTime(tunnel ? 1.0 : garage ? 0.8 : flat ? 0.15 : 0, t0, 0.3);
    setIR(tunnel ? 2.6 : 1.3);
    engSend.gain.setTargetAtTime(tunnel ? 0.5 : garage ? 0.4 : 0, t0, 0.2);
    radioSend.gain.setTargetAtTime(tunnel ? 0.3 : garage ? 0.35 : 0, t0, 0.3);
    // drips in a wet garage / tunnel
    if (rainAmt > 0.3 && (garage || tunnel) && Math.random() < dt * 0.9) drip();

    // ambience: city hum, distant traffic, crowd murmur, birds. Busier streets and more pedestrians make it livelier; none of it underground.
    const dens = Math.max(0, Math.min(1, density)), crd = Math.max(0, Math.min(1, crowd));
    const outdoors = open ? 1 : flat ? 0.18 : 0;
    const night = hour > 21 || hour < 5.5;
    T(L.hum, outdoors * (0.035 + 0.1 * dens + 0.03 * crd) * (night ? 0.8 : 1), 0.5);
    T(L.bed, outdoors * (0.015 + 0.14 * dens) , 0.5);
    T(L.tun, tunnel ? 0.06 + 0.1 * dens + sp01 * 0.1 : 0, 0.4);
    L.bed.b.frequency.setTargetAtTime(330 + dens * 280 + 90 * Math.sin(t0 * 0.17), t0, 0.5);
    ambT -= dt;
    if (ambT <= 0) {            // the murmur of a crowd swells and falls: re-roll its level a few times a second
      ambT = 0.25 + Math.random() * 0.3;
      const m = outdoors * crd * (0.55 + Math.random() * 0.9);
      L.crowd.g.gain.setTargetAtTime(m * 0.09, t0, 0.25); L.crowd2.g.gain.setTargetAtTime(m * 0.045 * (Math.random() < 0.3 ? 1.8 : 1), t0, 0.15);
      L.crowd.b.frequency.setTargetAtTime(700 + Math.random() * 500, t0, 0.2);
    }
    // birds by day on quiet streets, a distant siren now and then handled by the vehicles themselves
    if (open && hour > 6 && hour < 18.5 && !rain && !snow && dens < 0.6 && Math.random() < dt * 0.35) chirp();

    // sirens of emergency vehicles that are running them
    sirenSound(dt, car, sirens, onFoot, tunnel || garage);

    // traffic: engines of the nearest cars, passing whooshes, air brakes
    if (cars) trafficSound(dt, car, cars, onFoot);
  }

  // a water drip falling in a garage or tunnel: a short sine ping fed into the reverb
  function drip() {
    if (!ready || !enabled) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = gain(0); o.type = 'sine'; const f = 1200 + Math.random() * 1500;
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.08);
    o.connect(g); g.connect(revIn); const dry = gain(0.05); g.connect(dry); dry.connect(master);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.18); o.start(t); o.stop(t + 0.22);
  }
  function chirp() {
    const t = ctx.currentTime, pan = Math.random() * 2 - 1, n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1600, g = out(pan, 0);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = 'sine'; const st = t + i * 0.11;
      o.frequency.setValueAtTime(base, st); o.frequency.exponentialRampToValueAtTime(base * (1.15 + Math.random() * 0.3), st + 0.07); o.connect(g);
      o.start(st); o.stop(st + 0.09);
    }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.025 + Math.random() * 0.02, t + 0.01); g.gain.setValueAtTime(0.03, t + n * 0.11); g.gain.linearRampToValueAtTime(0, t + n * 0.11 + 0.05);
    setTimeout(() => { try { g.disconnect(); } catch (e) { /* gone */ } }, (n * 0.11 + 0.4) * 1000);
  }
  // Sirens: ambulances and fire engines "hee-haw" / sweep, police cars wail and now and then yelp. Up to 3 nearest are voiced, with Doppler and panning.
  function sirenSound(dt, car, list, onFoot, enclosed) {
    const cx = camera.position.x, cz = camera.position.z, want = [];
    list.forEach(c => { const p = c.mesh.position, d = Math.hypot(p.x - cx, p.z - cz); if (d < 260) want.push({ c, d }); });
    want.sort((a, b) => a.d - b.d); want.length = Math.min(3, want.length);
    const keep = new Set(want.map(w => w.c));
    sirenVoices.forEach((v, c) => { if (!keep.has(c)) { v.g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); v.dead = (v.dead || 0) + dt; if (v.dead > 0.6) { try { v.o1.stop(); v.o2.stop(); v.p.disconnect(); } catch (e) { /* gone */ } sirenVoices.delete(c); } } });
    const t = ctx.currentTime, now = performance.now() / 1000;
    want.forEach(({ c, d }) => {
      let v = sirenVoices.get(c);
      if (!v) {
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square';
        const bp = biquad('bandpass', 1100, 0.6), g = gain(0), p = ctx.createStereoPanner(), g2 = gain(0.35);
        o1.connect(bp); o2.connect(g2); g2.connect(bp); bp.connect(g); g.connect(p); p.connect(master); g.connect(revIn);
        o1.start(); o2.start(); v = { o1, o2, g, p, bp, seed: Math.random() * 10 }; sirenVoices.set(c, v);
      }
      v.dead = 0;
      const pos = c.mesh.position, sp = spatial(pos.x, pos.z, 26);
      let f;
      if (c.svc === 'police') {
        const yelp = ((now + v.seed) % 18) > 12;                       // 12 s of slow wail, then 6 s of fast yelp
        const ph = yelp ? ((now + v.seed) * 3.2) % 1 : ((now + v.seed) / 3.4) % 1;
        f = 650 + 800 * (ph < 0.5 ? ph * 2 : 2 - ph * 2);
      } else if (c.svc === 'ambulance') f = ((now + v.seed) % 1.3) < 0.65 ? 780 : 1040;           // "hee-haw"
      else f = 600 + 700 * (((now + v.seed) % 4) < 2 ? ((now + v.seed) % 2) / 2 : 1 - (((now + v.seed) % 2) / 2));   // fire engine: slow rise and fall
      const pv = v.px === undefined ? pos : { x: v.px, z: v.pz };
      const rad = ((pos.x - pv.x) * (pos.x - cx) + (pos.z - pv.z) * (pos.z - cz)) / Math.max(0.001, dt) / Math.max(1, d);
      v.px = pos.x; v.pz = pos.z;
      const doppler = 343 / (343 + Math.max(-60, Math.min(60, rad)) * 1.25 * 1.2);
      v.o1.frequency.setTargetAtTime(f * doppler, t, 0.03); v.o2.frequency.setTargetAtTime(f * doppler * 2.01, t, 0.03);
      v.bp.frequency.setTargetAtTime(1000 + f * 0.3, t, 0.1);
      v.p.pan.setTargetAtTime(sp.pan, t, 0.05);
      v.g.gain.setTargetAtTime(0.5 * sp.vol * (enclosed ? 0.9 : 1) * (c.svc === 'fire' ? 1.1 : 1), t, 0.06);
    });
  }

  function trafficSound(dt, car, cars, onFoot) {
    const cx = camera.position.x, cz = camera.position.z, near = [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]; if (!c.active) continue;
      const p = c.mesh.position, d = Math.hypot(p.x - cx, p.z - cz);
      if (d < 90) near.push({ c, d, i });
    }
    near.sort((a, b) => a.d - b.d);
    const want = near.slice(0, 5), keep = new Set(want.map(w => w.c));
    for (let k = traffic.length - 1; k >= 0; k--) if (!keep.has(traffic[k].c)) { traffic[k].v.stop(); traffic.splice(k, 1); }
    want.forEach(w => {
      let t = traffic.find(q => q.c === w.c);
      if (!t) { const kk = ENGINE_FOR[w.c.type] || 'i4'; t = { c: w.c, v: makeEngine(kk, master, true), kind: kk, rpm: 900 }; traffic.push(t); }
      const c = w.c, E = t.v.E, vmax = Math.max(8, c.targetSpeed || 16), sp = c.knock || c.wreck ? 0 : c.speed || 0;
      const r = engineRpm2(t, E, sp, vmax, dt);
      const pos = c.mesh.position, pv = prevPos.get(c) || { x: pos.x, z: pos.z };
      const vx = (pos.x - pv.x) / Math.max(dt, 1e-3), vz = (pos.z - pv.z) / Math.max(dt, 1e-3);
      const dx = pos.x - camera.position.x, dz = pos.z - camera.position.z, d = Math.hypot(dx, dz) || 1;
      const rad = (vx * dx + vz * dz) / d - ((car.vx || 0) * dx + (car.vz || 0) * dz) / d * (onFoot ? 0 : 1);   // + = moving apart
      const doppler = 343 / (343 + rad * 1.25 * 1.2);
      const load = c.speed > 0.5 && c.speed < (c.targetSpeed || 10) * 0.97 ? 0.7 : 0.25;
      const sp2 = spatial(pos.x, pos.z, 9);
      t.v.set(r, load, sp2.vol * 0.9 * (c.knock ? 0.3 : 1), Math.max(0.7, Math.min(1.4, doppler)));
      t.v.pan.pan.setTargetAtTime(sp2.pan, ctx.currentTime, 0.05);
    });
    // passing: closest approach at speed
    near.forEach(w => {
      const c = w.c, pos = c.mesh.position, pv = prevPos.get(c);
      if (pv) {
        const dPrev = Math.hypot(pv.x - camera.position.x, pv.z - camera.position.z);
        const vx = (pos.x - pv.x) / Math.max(dt, 1e-3), vz = (pos.z - pv.z) / Math.max(dt, 1e-3);
        const rel = Math.hypot(vx - (car.vx || 0), vz - (car.vz || 0));
        if (dPrev > w.d + 0.001 || true) { /* tracked below */ }
        const last = passCool.get(c) || 0;
        if (w.d < 13 && rel > 16 && dPrev <= w.d && (w.d - dPrev) > -1 && performance.now() > last && pv.closing) { whoosh(pos.x, pos.z, rel); passCool.set(c, performance.now() + 1800); }
        pv.closing = dPrev - w.d > 0.01;   // was it getting closer last frame?
        pv.x = pos.x; pv.z = pos.z; pv.d = w.d;
      } else prevPos.set(c, { x: pos.x, z: pos.z, closing: false });
      // heavy vehicles hiss to a stop
      if (HEAVY[c.type] >= 1) {
        const was = stopSeen.get(c) || 0;
        if (was > 4 && (c.speed || 0) < 0.3 && w.d < 80) airBrake(pos.x, pos.z);
        stopSeen.set(c, c.speed || 0);
      }
    });
  }
  function engineRpm2(t, E, speed, vmax, dt) {
    const f = Math.min(1, speed / vmax), g = Math.min(4, Math.floor(f * 4.2));
    const target = E.idle + (E.red * 0.55 - E.idle) * (f === 0 ? 0 : (0.25 + 0.75 * ((f * 4.2) % 1))) * (0.5 + 0.1 * g);
    t.rpm += (target - t.rpm) * Math.min(1, dt * 4);
    return t.rpm;
  }

  return {
    unlock() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    setEnabled(v) { enabled = !!v; if (master) master.gain.setTargetAtTime(enabled ? volume : 0, ctx.currentTime, 0.05); },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master && enabled) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05); },
    update, honk, crash, airBrake, tick, get ready() { return ready; },
    // for the radio: the shared audio context, a bus that plays through the master (with the garage / tunnel echo) and a ready hook
    get ctx() { return ctx; }, get radioBus() { return radioBus; }, get radioFilter() { return radioLP; }, whenReady(f) { if (ready) f(); else readyCbs.push(f); }
  };
}
