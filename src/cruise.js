// Cruise control: press C (or tap CRUISE on a phone) and the car holds the speed it is doing, so a long highway can be driven
// with just the steering. Pressing the gas speeds up and the new speed is kept when you let go; any touch of the brake switches it
// off, like the real thing. It only ever adds throttle (input.cruise, read by car.js and audio.js); it never brakes for you.
const MIN = 11;        // u/s, about 50 km/h: below this it will not engage

export function createCruise({ car, input, world, toast, kmh }) {
  let on = false, target = 0, pressing = false, trim = 0.15;
  const el = document.createElement('button'); el.id = 'cruise'; el.type = 'button'; el.tabIndex = -1;
  const css = document.createElement('style');
  css.textContent = '#cruise{position:fixed;top:68px;right:10px;z-index:6;font:600 12px system-ui,sans-serif;color:#fff;background:rgba(14,18,26,.55);padding:4px 10px;border-radius:12px;border:1px solid rgba(255,255,255,.14);cursor:pointer;touch-action:manipulation}' +
    '#cruise.on{background:rgba(40,150,90,.75);border-color:rgba(160,255,200,.5)}html.touch #cruise{top:auto;bottom:max(96px,calc(env(safe-area-inset-bottom) + 74px));right:50%;transform:translateX(50%);padding:8px 16px;font-size:13px}body.cam-inside #cruise{opacity:.6}';
  document.head.appendChild(css); document.body.appendChild(el);
  const refresh = () => { el.classList.toggle('on', on); el.textContent = on ? 'CRUISE ' + Math.round(kmh(target)) + ' km/h' : 'CRUISE  (C)'; };
  const usable = () => !world.onFoot && world.mode === 'city';
  function set(v, why) {
    if (v === on) return;
    if (v) {
      if (!usable()) return;
      if (car.speed < MIN) { toast('Cruise control needs ' + Math.round(kmh(MIN)) + ' km/h or more'); return; }
      on = true; target = car.speed; pressing = false; toast('Cruise control on: ' + Math.round(kmh(target)) + ' km/h');
    } else { on = false; input.cruise = 0; if (why) toast(why); }
    refresh();
  }
  el.addEventListener('click', () => { set(!on, on ? 'Cruise control off' : ''); el.blur(); });
  addEventListener('keydown', e => { if (e.code === 'KeyC' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target && e.target.closest && e.target.closest('input,textarea'))) set(!on, on ? 'Cruise control off' : ''); });
  refresh();
  return {
    get on() { return on; }, get target() { return target; },
    set,
    // engage at a given speed without the toast (arriving through the tunnel)
    resume(speed) { if (!usable()) return; on = true; target = Math.max(MIN, speed); pressing = false; refresh(); },
    // call once a frame after the input has been read
    update(dt = 0.016) {
      el.style.display = usable() ? '' : 'none';
      if (!on) { input.cruise = 0; return; }
      if (!usable() || car.noFuel) { set(false, car.noFuel ? 'Cruise control off: out of fuel' : ''); return; }
      if (input.back || input.brake || input.handbrake) { set(false, 'Cruise control off'); return; }
      if (input.forward) { pressing = true; input.cruise = 0; return; }             // the driver is on the gas
      if (pressing) { pressing = false; if (car.speed > target) { target = car.speed; refresh(); } }
      // feather the gas near the target and lift off above it; `trim` slowly learns how much gas this car needs to hold this speed
      // (wind, hills, a heavy car), so it settles on the target instead of a little under it
      const err = target - car.speed;
      trim = Math.max(0, Math.min(0.7, trim + err * dt * 0.22));
      input.cruise = err > -0.25 ? Math.max(0.15, Math.min(1, 0.2 + trim + err * 0.5)) : 0;
    }
  };
}
