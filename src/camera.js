import * as THREE from 'three';

// How much of the car's own roll/pitch the chase camera inherits. Kept well under 1 so
// banked corners and bridge ramps read without making the view queasy.
const ROLL_FACTOR = 0.35;

// 0 on the surface, 1 underground — eased, so the camera glides down into a tunnel instead
// of snapping. Underground (a tunnel, or a ramp that's dipped below the ground plane) the
// camera drops low and close: at its normal height it ended up above the tunnel roof, with
// the roof sitting between the camera and the car.
let underground = 0;
let camBlock = 0;
const UNDERGROUND_HEIGHT = 2.4, UNDERGROUND_DISTANCE = 7.2;

export function updateFollowCamera(camera, car, offset, dt, blocked) {
  const isUnder = (car.y < -0.6 || car.inGarage) ? 1 : 0;
  underground += (isUnder - underground) * Math.min(1, dt * 3);
  let h = offset.y + (UNDERGROUND_HEIGHT - offset.y) * underground;
  let d = offset.z + (UNDERGROUND_DISTANCE - offset.z) * underground;
  // A wall behind the car: the camera comes in and climbs, and with the car against the wall it looks straight down on it.
  if (blocked) {
    const bx = -Math.sin(car.heading), bz = -Math.cos(car.heading);
    let free = d;
    for (let t = 1.0; t <= d; t += 0.6) if (blocked(car.x + bx * t, car.z + bz * t)) { free = Math.max(0, t - 0.9); break; }
    const k = Math.max(0, Math.min(1, 1 - free / d));
    camBlock += (k - camBlock) * Math.min(1, dt * 6);
    d = Math.max(1.4, d * (1 - camBlock * 0.92));
    h = h + (15 - h) * Math.pow(camBlock, 1.3);
  }
  const behind = new THREE.Vector3(
    car.x - Math.sin(car.heading) * d,
    car.y + h,
    car.z - Math.cos(car.heading) * d
  );
  camera.position.lerp(behind, 1 - Math.pow(0.001, dt));
  const roll = (car.roll || 0) * ROLL_FACTOR;
  camera.up.set(Math.sin(roll), Math.cos(roll), 0);
  camera.lookAt(car.x, car.y + 1.2, car.z);
}

// ---- camera views: chase (tunable distance/height), front bumper, top-down, inside the car ----------------------------------------
export const CAM_MODES = [['chase', 'Chase'], ['bumper', 'Bumper'], ['top', 'Top'], ['inside', 'Inside']];
export function createCameraRig({ camera, car, getOffset, interior, onMode }) {
  let mode = 'chase', prev = 'chase';
  const eye = new THREE.Vector3(), look = new THREE.Vector3();
  const rig = {
    get mode() { return mode; },
    setMode(m) {
      if (!CAM_MODES.some(x => x[0] === m)) return;
      mode = m; interior.setVisible(m === 'inside');
      if (m === 'inside') interior.fit();
      if (car.model) car.model.visible = m !== 'inside';
      document.body.classList.toggle('cam-inside', m === 'inside');
      onMode && onMode(m);
    },
    cycle() { const i = CAM_MODES.findIndex(x => x[0] === mode); rig.setMode(CAM_MODES[(i + 1) % CAM_MODES.length][0]); },
    update(dt, blocked) {
      if (mode === 'chase') { updateFollowCamera(camera, car, getOffset(), dt, blocked); return; }
      const sin = Math.sin(car.heading), cos = Math.cos(car.heading), roll = (car.roll || 0) * 0.5, pitch = (car.pitch || 0);
      const off = getOffset();
      if (mode === 'top') {
        const H = Math.max(14, off.y * 3.8);
        eye.set(car.x - sin * 2.5, car.y + H, car.z - cos * 2.5);
        camera.position.lerp(eye, 1 - Math.pow(0.0005, dt));
        camera.up.set(sin, 0, cos); camera.lookAt(car.x + sin * 3, car.y, car.z + cos * 3);
        return;
      }
      if (mode === 'bumper') {
        const len = (car.dimLen || 3.6) * 0.5;
        eye.set(car.x + sin * (len + 0.15), car.y + 0.55 + ((car.dimHeight || 1.5) - 1.5) * 0.3, car.z + cos * (len + 0.15));
        camera.position.copy(eye);
        camera.up.set(Math.sin(roll), Math.cos(roll), 0);
        camera.lookAt(eye.x + sin * 20, eye.y + 0.55 - pitch * 8, eye.z + cos * 20);
        return;
      }
      // inside: the driver's eye, a little left of centre
      const k = interior.root.position.y, side = 0.4;
      const cs = Math.cos(car.heading), sn = Math.sin(car.heading);
      eye.set(car.x + cs * side + sin * 0.02, car.y + 1.08 + k, car.z - sn * side + cos * 0.02);
      camera.position.copy(eye);
      camera.up.set(Math.sin(roll), Math.cos(roll), 0);
      look.set(eye.x + sin * 12, eye.y - 0.22 - pitch * 6 + (car.vy || 0) * 0, eye.z + cos * 12);
      camera.lookAt(look);
    }
  };
  return rig;
}
