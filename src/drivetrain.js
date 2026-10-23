// A fake gearbox shared by the HUD and the engine sound, so what you see is what you hear.
// update() -> { r: 0..1 of the rev range (idle ~0.14, red zone above 0.85), gear: 'R' | 'N' | 1..6, speedFrac }
const TOPS = [0.15, 0.29, 0.45, 0.62, 0.8, 1.0];          // top of each gear as a fraction of top speed
export function createDrivetrain() {
  let r = 0.14, gear = 1, shift = 0, shown = 'N', hold = 0;
  return {
    update(dt, car, throttle, onFoot) {
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
