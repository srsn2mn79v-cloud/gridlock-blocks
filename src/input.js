export function createInput() {
  const state = {
    forward: false, back: false, left: false, right: false, brake: false, boost: false,
    steerAxis: null, throttle: 1,   // analog (touch): steerAxis -1..1 (+ = left), throttle 0..1
    lightsOn: false, blinkerLeft: false, blinkerRight: false,
    // on foot: analog move (x + = right, y + = forward) and look (x + = right, y + = up) vectors, fed by WASD / arrow keys,
    // the two touch thumbsticks and a gamepad's sticks. `swapSticks` puts the camera stick on the left instead.
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, swapSticks: false, footMode: false, run: false
  };
  const keys = new Set();
  const stick = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } };
  let padActive = false;
  const heldMap = {
    KeyW: 'forward', ArrowUp: 'forward',
    KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    Space: 'brake', ShiftLeft: 'boost', ShiftRight: 'boost'
  };
  // L/O/P are toggles (one press flips them, like a real headlight switch or indicator
  // stalk) rather than held keys — e.repeat guards against the browser's key-repeat
  // re-firing keydown while held, which would otherwise flicker the toggle.
  const toggleMap = { KeyL: 'lightsOn', KeyO: 'blinkerLeft', KeyP: 'blinkerRight' };

  // Shared by the keyboard and the touch buttons below, so both go through exactly the
  // same indicator rule (turning one on turns the other off, like a real stalk).
  function toggle(t) {
    state[t] = !state[t];
    if (t === 'blinkerLeft' && state.blinkerLeft) state.blinkerRight = false;
    if (t === 'blinkerRight' && state.blinkerRight) state.blinkerLeft = false;
    refreshToggleButtons();
  }

  window.addEventListener('keydown', e => {
    keys.add(e.code);
    const h = heldMap[e.code];
    if (h) state[h] = true;
    const t = toggleMap[e.code];
    if (t && !e.repeat) toggle(t);
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); const h = heldMap[e.code]; if (h) state[h] = false; });
  window.addEventListener('blur', () => keys.clear());

  // --- Touch controls ----------------------------------------------------------------
  // On-screen buttons, only shown on touch-first devices (a phone/tablet opening the
  // standalone HTML) — a desktop with a mouse never sees them. Each held button is its
  // own element with its own pointer capture, so several can be down at once (steer with
  // one thumb while the other holds the gas), which a single shared touch area couldn't
  // do. They write into the very same `state` object the keyboard does, so car.js can't
  // tell the difference.
  const toggleButtons = [];
  function refreshToggleButtons() {
    toggleButtons.forEach(({ el, key }) => el.classList.toggle('on', !!state[key]));
  }

  const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) ||
    'ontouchstart' in window || navigator.maxTouchPoints > 0;

  if (isTouch) {
    document.documentElement.classList.add('touch');

    const style = document.createElement('style');
    style.textContent = `
      #touch { position: fixed; inset: 0; pointer-events: none; z-index: 5;
        font-family: ui-monospace, monospace; user-select: none; -webkit-user-select: none;
        -webkit-touch-callout: none; touch-action: none; }
      #touch .tb { position: absolute; pointer-events: auto; touch-action: none;
        display: flex; align-items: center; justify-content: center;
        color: #e8ecf1; font-weight: bold; border-radius: 18px;
        background: rgba(20,26,34,0.55); border: 2px solid rgba(190,210,235,0.35);
        backdrop-filter: blur(2px); -webkit-tap-highlight-color: transparent; }
      #touch .tb.down { background: rgba(80,150,230,0.65); border-color: rgba(200,225,255,0.85); }
      #touch .tb.brake.down { background: rgba(220,70,60,0.7); }
      #touch .tb.on { background: rgba(255,190,50,0.6); border-color: rgba(255,230,150,0.9); color: #1a1405; }
      #touch .steer { bottom: max(22px, env(safe-area-inset-bottom)); width: 22vw; max-width: 130px; min-width: 76px; height: 22vw; max-height: 130px; min-height: 76px; font-size: 38px; }
      #touch .pedal { right: max(18px, env(safe-area-inset-right)); width: 24vw; max-width: 140px; min-width: 84px; font-size: 20px; }
      #touch .small { top: max(12px, env(safe-area-inset-top)); width: 54px; height: 44px; font-size: 18px; border-radius: 12px; }
      #touch .wheel { left: max(18px, env(safe-area-inset-left)); bottom: max(22px, env(safe-area-inset-bottom)); width: min(46vw, 300px); height: 96px; border-radius: 48px; }
      #touch .wheel .hint { font-size: 11px; opacity: .6; pointer-events: none; }
      #touch .wheel .knob { position: absolute; left: calc(50% - 30px); top: 18px; width: 60px; height: 60px; border-radius: 50%; background: rgba(230,240,255,.55); pointer-events: none; }
      #touch .wheel.down .knob { background: rgba(110,170,240,.9); }
      #touch .gas { right: max(18px, env(safe-area-inset-right)); bottom: calc(max(22px, env(safe-area-inset-bottom)) + 74px); width: min(24vw, 110px); min-width: 84px; height: min(40vh, 190px); overflow: hidden; align-items: flex-start; justify-content: center; }
      #touch .gas .fill { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: rgba(80,200,120,.55); pointer-events: none; }
      #touch .gas .lbl { position: relative; margin-top: 10px; font-size: 16px; text-align: center; pointer-events: none; }
      html.touch #hud small { display: none; }
      #touch .ft { display: none; }
      #touch.foot .ft { display: block; }
      #touch.foot .tb.wheel, #touch.foot .tb.gas, #touch.foot .tb.pedal { display: none; }
      #touch .stick { position: absolute; bottom: max(26px, env(safe-area-inset-bottom)); width: 150px; height: 150px; border-radius: 50%; pointer-events: auto; touch-action: none; background: rgba(20,26,34,0.45); border: 2px solid rgba(190,210,235,0.35); }
      #touch .stick .knob { position: absolute; left: 45px; top: 45px; width: 60px; height: 60px; border-radius: 50%; background: rgba(230,240,255,.6); pointer-events: none; }
      #touch .stick.down { background: rgba(80,150,230,0.4); } #touch .stick .cap { position: absolute; left: 0; right: 0; top: -20px; text-align: center; font-size: 11px; color: #cfe0f5; opacity: .75; pointer-events: none; }
    `;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'touch';
    document.body.appendChild(root);

    // Held button: sets state[key] while any finger is on it.
    function holdButton(label, key, cls, css) {
      const el = document.createElement('div');
      el.className = 'tb ' + cls;
      el.textContent = label;
      Object.assign(el.style, css);
      let active = new Set();
      const set = () => { state[key] = active.size > 0; el.classList.toggle('down', state[key]); };
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
        active.add(e.pointerId); set();
      });
      const up = e => { active.delete(e.pointerId); set(); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', e => e.preventDefault());
      root.appendChild(el);
      return el;
    }

    // Toggle button: one tap flips it, same as the L/O/P keys.
    function toggleButton(label, key, css) {
      const el = document.createElement('div');
      el.className = 'tb small';
      el.textContent = label;
      Object.assign(el.style, css);
      el.addEventListener('pointerdown', e => { e.preventDefault(); toggle(key); });
      el.addEventListener('contextmenu', e => e.preventDefault());
      root.appendChild(el);
      toggleButtons.push({ el, key });
      return el;
    }

    // Steering on the left thumb, pedals on the right — the usual mobile racing layout.
    // Steering wheel strip: put a thumb on it and slide left/right - the further from the
    // middle, the sharper the turn.
    const wheel = document.createElement('div');
    wheel.className = 'tb wheel';
    wheel.innerHTML = '<div class="hint">◀ slide to steer ▶</div><div class="knob"></div>';
    root.appendChild(wheel);
    const knob = wheel.querySelector('.knob');
    const steerFrom = e => {
      const r = wheel.getBoundingClientRect(), half = r.width / 2 - 34;
      const dx = e.clientX - (r.left + r.width / 2);
      const ax = Math.max(-1, Math.min(1, -dx / half));
      // progressive: the first half of the slide barely turns, full lock only at the far end
      state.steerAxis = Math.abs(ax) < 0.08 ? 0 : Math.sign(ax) * Math.pow(Math.abs(ax), 2);
      knob.style.transform = `translateX(${-ax * half}px)`;
    };
    wheel.addEventListener('pointerdown', e => { e.preventDefault(); try { wheel.setPointerCapture(e.pointerId); } catch (err) {} wheel.classList.add('down'); steerFrom(e); });
    wheel.addEventListener('pointermove', e => { if (wheel.classList.contains('down')) steerFrom(e); });
    const wheelUp = () => { state.steerAxis = null; wheel.classList.remove('down'); knob.style.transform = 'translateX(0)'; };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => wheel.addEventListener(n, wheelUp));
    wheel.addEventListener('contextmenu', e => e.preventDefault());

    // Gas slider: hold and slide up for more throttle, down for less. Lift off to coast.
    const gas = document.createElement('div');
    gas.className = 'tb gas';
    gas.innerHTML = '<div class="fill"></div><div class="lbl">GAS<br>▲</div>';
    root.appendChild(gas);
    const fill = gas.querySelector('.fill');
    const gasFrom = e => {
      const r = gas.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
      state.throttle = 0.15 + 0.85 * f;
      state.forward = true;
      fill.style.height = Math.round(f * 100) + '%';
    };
    gas.addEventListener('pointerdown', e => { e.preventDefault(); try { gas.setPointerCapture(e.pointerId); } catch (err) {} gas.classList.add('down'); gasFrom(e); });
    gas.addEventListener('pointermove', e => { if (gas.classList.contains('down')) gasFrom(e); });
    const gasUp = () => { state.forward = false; state.throttle = 1; gas.classList.remove('down'); fill.style.height = '0%'; };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => gas.addEventListener(n, gasUp));
    gas.addEventListener('contextmenu', e => e.preventDefault());
    // Brake/reverse: like the S/Down key, brakes first and only reverses once nearly stopped.
    holdButton('BRAKE', 'back', 'pedal brake', { bottom: 'max(22px, env(safe-area-inset-bottom))', height: 'min(14vw, 84px)', minHeight: '60px' });

    toggleButton('◀ind', 'blinkerLeft', { top: 'calc(max(12px, env(safe-area-inset-top)) + 58px)', right: 'calc(max(12px, env(safe-area-inset-right)) + 120px)' });
    toggleButton('ind▶', 'blinkerRight', { top: 'calc(max(12px, env(safe-area-inset-top)) + 58px)', right: 'calc(max(12px, env(safe-area-inset-right)) + 60px)' });
    toggleButton('💡', 'lightsOn', { top: 'calc(max(12px, env(safe-area-inset-top)) + 58px)', right: 'max(12px, env(safe-area-inset-right))' });

    // on foot: two thumbsticks (move + camera). Which side is which is the swapSticks setting.
    function makeStick(name, label) {
      const el = document.createElement('div'); el.className = 'stick ft'; el.innerHTML = '<div class="cap">' + label + '</div><div class="knob"></div>';
      root.appendChild(el);
      const knob = el.querySelector('.knob'); let id = null;
      const upd = e => {
        const r = el.getBoundingClientRect(), R = r.width / 2 - 8;
        let dx = (e.clientX - (r.left + r.width / 2)) / R, dy = (e.clientY - (r.top + r.height / 2)) / R;
        const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
        stick[name].x = dx; stick[name].y = -dy;
        knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
      };
      el.addEventListener('pointerdown', e => { e.preventDefault(); id = e.pointerId; try { el.setPointerCapture(id); } catch (err) {} el.classList.add('down'); upd(e); });
      el.addEventListener('pointermove', e => { if (e.pointerId === id) upd(e); });
      const end = e => { if (e.pointerId !== id) return; id = null; el.classList.remove('down'); stick[name].x = stick[name].y = 0; knob.style.transform = ''; };
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => el.addEventListener(n, end));
      el.addEventListener('contextmenu', e => e.preventDefault());
      return el;
    }
    const moveEl = makeStick('move', 'MOVE'), lookEl = makeStick('look', 'LOOK');
    state._layoutSticks = () => {
      const left = state.swapSticks ? lookEl : moveEl, right = state.swapSticks ? moveEl : lookEl;
      left.style.left = 'max(22px, env(safe-area-inset-left))'; left.style.right = 'auto';
      right.style.right = 'max(22px, env(safe-area-inset-right))'; right.style.left = 'auto';
    };
    state._layoutSticks();
    state._root = root;

    // A phone is easy to rotate or pinch by accident mid-drive; neither should move the page.
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('touchmove', e => { if (e.target.closest && e.target.closest('#touch')) e.preventDefault(); }, { passive: false });
  }

  // called once a frame: merges keyboard, touch sticks and a gamepad into the on-foot vectors (and, with a pad, the driving controls)
  let actHeld = false;
  state.setSwap = v => { state.swapSticks = !!v; if (state._layoutSticks) state._layoutSticks(); };
  state.poll = (onFoot) => {
    state.footMode = onFoot;
    if (state._root) state._root.classList.toggle('foot', onFoot);
    let mx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), my = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    let lx = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0), ly = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
    const dz = v => Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86;
    const left = state.swapSticks ? stick.look : stick.move, right = state.swapSticks ? stick.move : stick.look;
    // (the touch sticks are named by role: move/look; layout puts them on whichever side)
    if (stick.move.x || stick.move.y) { mx = dz(stick.move.x); my = dz(stick.move.y); }
    if (stick.look.x || stick.look.y) { lx = dz(stick.look.x); ly = dz(stick.look.y); }
    // gamepad (standard mapping): left stick = move, right stick = camera (swapped with swapSticks); A = act, RT/LT = gas/brake, left stick steers
    const pads = navigator.getGamepads ? navigator.getGamepads() : [], pad = pads && Array.from(pads).find(p => p && p.connected);
    let run = !!(keys.has('ShiftLeft') || keys.has('ShiftRight'));
    if (pad) {
      const a = pad.axes, ls = { x: dz(a[0] || 0), y: -dz(a[1] || 0) }, rs = { x: dz(a[2] || 0), y: -dz(a[3] || 0) };
      const mv = state.swapSticks ? rs : ls, lk = state.swapSticks ? ls : rs;
      if (onFoot) { if (mv.x || mv.y) { mx = mv.x; my = mv.y; } if (lk.x || lk.y) { lx = lk.x; ly = lk.y; } }
      const b = pad.buttons, pr = i => b[i] && (b[i].pressed || b[i].value > 0.2);
      if (pr(10) || pr(1) && onFoot) run = true;
      if (pr(0) && !actHeld) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' })); actHeld = !!pr(0);
      if (!onFoot) {
        const gas = b[7] ? b[7].value : 0, br = b[6] ? b[6].value : 0, sx = dz(a[0] || 0);
        if (gas > 0.05 || br > 0.05 || sx) { padActive = true; state.forward = gas > 0.05; state.throttle = gas > 0.05 ? Math.max(0.15, gas) : 1; state.back = br > 0.05; state.steerAxis = sx ? -Math.sign(sx) * Math.pow(Math.abs(sx), 1.6) : 0; }
        else if (padActive) { padActive = false; state.forward = state.back = false; state.steerAxis = null; state.throttle = 1; }
        state.brake = !!pr(2) || keys.has('Space');
        state.boost = !!pr(5) || keys.has('ShiftLeft');
      }
    }
    const m = Math.hypot(mx, my); if (m > 1) { mx /= m; my /= m; }
    state.moveX = mx; state.moveY = my; state.lookX = lx; state.lookY = ly; state.run = run || m > 0.93 && (stick.move.x || stick.move.y) ? true : run;
  };

  return state;
}
