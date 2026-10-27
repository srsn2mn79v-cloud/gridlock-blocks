// A fake gearbox shared by the HUD and the engine sound, so what you see is what you hear.
// update() -> { r: 0..1 of the rev range (idle ~0.14, red zone above 0.85), gear: 'R' | 'N' | 1..6, speedFrac }
const TOPS = [0.15, 0.29, 0.45, 0.62, 0.8, 1.0];          // top of each gear as a fraction of top speed
export function createDrivetrain() {
  let r = 0.14, gear = 1, shift = 0, shown = 'N', hold = 0;
  // ---- manual mode (drag races): you pick the gear, rpm follows speed in that gear, and shifting near the top of the
  // rev range (the shift light) gives the best acceleration. accelMul is read by the car physics.
  const MT = [0.2, 0.36, 0.52, 0.68, 0.84, 1.0];          // speed fraction at which each gear hits its limiter
  const M = { on: false, gear: 0, cool: 0, boost: 0, boostT: 0, label: '', labelT: 0, quality: 0, mul: 1 };
  const band = x => x > 0.97 ? 0.12 : x >= 0.78 ? 1 : Math.max(0.35, 1 - (0.78 - x) * 1.55);
  const manualUpdate = (dt, car, throttle) => {
    const vmax = Math.max(8, car.maxSpeed || 20), f = Math.max(0, car.speed || 0) / vmax;
    M.cool = Math.max(0, M.cool - dt); M.boostT = Math.max(0, M.boostT - dt); M.labelT = Math.max(0, M.labelT - dt);
    if (M.labelT <= 0) M.label = '';
    let target;
    if (f < 0.012 && M.gear === 0) target = 0.14 + 0.66 * throttle;
    else target = 0.14 + 0.86 * Math.min(1.04, f / MT[M.gear]);
    if (M.cool > 0) target = Math.max(0.14, target - 0.1);
    r += (target - r) * Math.min(1, dt * (target > r ? 9 : 6)); r = Math.max(0.1, Math.min(1, r));
    M.quality = r;
    M.mul = M.cool > 0 ? 0.04 : band(r) * (M.boostT > 0 ? 1 + M.boost : 1);
    return { r, gear: M.gear + 1, speedFrac: f, accelMul: M.mul, manual: true, shiftLabel: M.label, boost: M.boostT > 0 };
  };
  return {
    manual: M,
    setManual(on) { M.on = !!on; M.gear = 0; M.boostT = 0; M.cool = 0; M.label = ''; },
    shiftUp() {
      if (!M.on || M.gear >= MT.length - 1 || M.cool > 0) return;
      const q = r; M.gear++; M.cool = 0.16;
      if (q >= 0.84 && q <= 0.95) { M.boost = 0.12; M.boostT = 1.6; M.label = 'PERFECT SHIFT'; }
      else if (q >= 0.74 && q < 0.84) { M.boost = 0.05; M.boostT = 1.2; M.label = 'good shift'; }
      else if (q > 0.95) { M.label = 'too late'; M.boost = 0; M.boostT = 0; }
      else { M.label = 'too early'; M.boost = 0; M.boostT = 0; }
      M.labelT = 1.2;
    },
    shiftDown() { if (!M.on || M.gear <= 0 || M.cool > 0) return; M.gear--; M.cool = 0.1; M.label = ''; },
    update(dt, car, throttle, onFoot) {
      if (M.on && !onFoot) return manualUpdate(dt, car, throttle);
      const vmax = Math.max(8, car.maxSpeed || 20), sp = onFoot ? 0 : (car.speed || 0), f = Math.abs(sp) / vmax;
      let target;
      if (onFoot) { target = 0.14; }
      else if (f < 0.012) { target = 0.14 + 0.5 * throttle; gear = 1; }       // revving it in neutral
      else {
        let g = TOPS.findIndex(t => f <= t + 0.0001); if (g < 0) g = TOPS.length - 1;
        if (g !== gear) { if (g > gear) shift = 0.16; gear = g; }
        const lo = g ? TOPS[g - 1] * 0.55 : 0, p = Math.max(0, (f - lo) / Math.max(0.01, TOPS[g] - lo));
        const peak = g === TOPS.length - 1 ? 0.8 : 0.74;
        target = 0.17 + (peak - 0.17) * Math.min(1.25, p) + (f > 1 ? (f - 1) * 1.2 : 0);          // boosting past top speed runs into the red
        target += throttle * 0.04;
      }
      if (shift > 0) { shift -= dt; target -= 0.14; }
      r += (target - r) * Math.min(1, dt * (target > r ? 8 : 5));
      r = Math.max(0.1, Math.min(1, r));
      if (onFoot) shown = 'N';
      else if (sp < -0.3) shown = 'R';
      else if (f < 0.012) shown = 'N';
      else shown = gear + 1;
      return { r, gear: shown, speedFrac: f };
    }
  };
}
