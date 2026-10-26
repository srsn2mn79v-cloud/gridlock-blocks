// Dynamic weather. The weather is a pure function of the game clock (day number + hour), so a forecast is just the same function
// evaluated later: smooth noise decides cloud / precipitation / fog, a daily temperature curve decides whether the precipitation
// falls as rain or snow (snow only near or below freezing). The module also runs the game clock (time of day keeps moving unless
// paused), applies the result to the environment and shows a small weather + clock readout.
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const KIND_LABEL = { clear: 'clear', cloudy: 'cloudy', fog: 'foggy', rain: 'rain', snow: 'snow' };
export const KIND_ICON = { clear: '☀️', night: '🌙', cloudy: '☁️', fog: '🌫', rain: '🌧', snow: '❄️' };

// absolute game hour A = day * 24 + hour
export function weatherAt(A) {
  const day = Math.floor(A / 24), h = A - day * 24;
  const dayBase = 1.5 + (vnoise(day * 0.8 + 3.3) - 0.5) * 13;                 // late autumn / early winter in Chicago: roughly -5 .. +8 C
  const diurnal = 3.6 * Math.sin((h - 9) / 24 * Math.PI * 2);                  // coldest before dawn, warmest mid afternoon
  const w = vnoise(A / 7.5 + 11.7) * 0.75 + vnoise(A / 2.3 + 5.1) * 0.25;
  const cloud = sstep(0.38, 0.62, w);
  const precip = sstep(0.62, 0.8, w);
  const fogN = vnoise(A / 5 + 40.2);
  const temp = dayBase + diurnal - 1.6 * cloud - 1.2 * precip;
  let kind = 'clear', level = 0;
  if (precip > 0.18) { kind = temp <= 0.8 ? 'snow' : 'rain'; level = 0.3 + 0.7 * precip; }
  else if (fogN > 0.74 && (h < 9.5 || h > 19.5) && cloud < 0.9) { kind = 'fog'; level = Math.min(1, (fogN - 0.74) * 5); }
  else if (cloud > 0.45) kind = 'cloudy';
  return { kind, level, temp, cloud };
}

const fmtT = t => (Math.round(t) <= 0 && t > -0.5 ? 0 : Math.round(t)) + '°C';
export const fmtClock = h => { const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60); return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };

export function createWeather({ env, settings, save, onApply, dayMinutes = 60 }) {
  if (settings.day == null) settings.day = 0;
  const el = document.createElement('div'); el.id = 'wx';
  const st = document.createElement('style');
  st.textContent = '#wx{position:fixed;top:10px;right:10px;z-index:6;font:600 13px system-ui,sans-serif;color:#fff;background:rgba(14,18,26,.55);padding:4px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.14);pointer-events:none;text-shadow:0 1px 2px #000}html.touch #wx{top:6px;font-size:12px}';
  document.head.appendChild(st); document.body.appendChild(el);
  let cur = weatherAt(settings.day * 24 + settings.hour), saveT = 0, txtT = 0;

  const absHour = () => settings.day * 24 + settings.hour;
  function apply() {
    cur = weatherAt(absHour());
    env.setTemp(cur.temp);
    if (settings.dynWeather !== false) {
      const rain = cur.kind === 'rain', snow = cur.kind === 'snow';
      settings.rain = rain; settings.snow = snow;
      env.setRain(rain, cur.level); env.setSnow(snow, cur.level);
      settings.fog = cur.kind === 'fog' ? 0.25 + 0.55 * cur.level : cur.kind === 'cloudy' ? 0.05 : 0;
      env.setFog(settings.fog);
    }
    if (onApply) onApply(cur);
  }
  function text() {
    const night = env.nightK > 0.5;
    const icon = cur.kind === 'clear' && night ? KIND_ICON.night : KIND_ICON[cur.kind];
    const kindWord = settings.dynWeather === false ? (settings.snow ? 'snow' : settings.rain ? 'rain' : settings.fog > 0.3 ? 'foggy' : 'clear') : KIND_LABEL[cur.kind];
    el.textContent = `${icon} ${fmtT(cur.temp)} · ${kindWord} · ${fmtClock(settings.hour)}`;
  }
  apply(); text();

  return {
    get now() { return cur; },
    update(dt) {
      if (settings.clockRun !== false) {
        settings.hour += dt * 24 / (dayMinutes * 60);
        if (settings.hour >= 24) { settings.hour -= 24; settings.day++; }
        env.setHour(settings.hour, true);
        saveT += dt; if (saveT > 6) { saveT = 0; save && save(); }
      }
      txtT -= dt;
      if (txtT <= 0) { txtT = 0.5; apply(); text(); }
    },
    // after the player changes the hour (slider, sleeping) re-evaluate straight away
    refresh() { apply(); text(); },
    // sleep: jump forward by `hours`; the day counter follows
    advance(hours) {
      let h = settings.hour + hours; while (h >= 24) { h -= 24; settings.day++; }
      settings.hour = h; env.setHour(h, true); apply(); text(); save && save();
    },
    forecast(hoursAhead) { return weatherAt(absHour() + hoursAhead); },
    // a short plain-English forecast for the DJs: the rest of today and tomorrow
    outlook() {
      const A = absHour(), now = weatherAt(A), parts = [];
      const span = (from, to) => { let best = null, hi = -99, lo = 99; const kinds = {}; for (let t = from; t <= to; t += 1) { const w = weatherAt(A + t); kinds[w.kind] = (kinds[w.kind] || 0) + 1; hi = Math.max(hi, w.temp); lo = Math.min(lo, w.temp); } best = Object.entries(kinds).sort((a, b) => b[1] - a[1]); return { kinds, main: best[0][0], hi, lo }; };
      const left = Math.max(2, 24 - settings.hour);
      const rest = span(1, left);
      const snowSoon = Object.keys(rest.kinds).find(k => k === 'snow'), rainSoon = Object.keys(rest.kinds).find(k => k === 'rain');
      let todayTxt = rest.main === 'clear' ? 'mostly clear skies' : rest.main === 'cloudy' ? 'plenty of cloud' : rest.main === 'fog' ? 'fog patches' : rest.main === 'snow' ? 'snow on and off' : 'rain on and off';
      if (snowSoon && rest.main !== 'snow') todayTxt += ', with some snow later';
      else if (rainSoon && rest.main !== 'rain') todayTxt += ', with showers later';
      parts.push(`For the rest of today expect ${todayTxt}, temperatures between ${fmtT(rest.lo)} and ${fmtT(rest.hi)}.`);
      const tom = (() => { const start = (Math.floor(A / 24) + 1) * 24; const kinds = {}; let hi = -99, lo = 99; for (let t = 0; t < 24; t += 1) { const w = weatherAt(start + t); kinds[w.kind] = (kinds[w.kind] || 0) + 1; hi = Math.max(hi, w.temp); lo = Math.min(lo, w.temp); } const main = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0][0]; return { kinds, main, hi, lo }; })();
      const tw = tom.kinds.snow > 2 ? 'snow' : tom.kinds.rain > 2 ? 'rain' : tom.main === 'snow' ? 'snow' : tom.main === 'rain' ? 'rain' : tom.main;
      parts.push(`Tomorrow: ${tw === 'clear' ? 'clear and dry' : tw === 'cloudy' ? 'cloudy but dry' : tw === 'fog' ? 'foggy in places' : tw === 'snow' ? 'snow, so take it slow' : 'wet, with rain around'}, between ${fmtT(tom.lo)} and ${fmtT(tom.hi)}.`);
      return { now, text: parts.join(' ') };
    }
  };
}
export { fmtT };
