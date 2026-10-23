import * as THREE from 'three';
import { createGroundGlow, createHalo, setGlow } from './glow.js';
import { buildCarModel, CAR_WIDTH_K as WK } from './carModels.js';

export class Car {
  constructor(spawn) {
    this.group = new THREE.Group();

    this.model = null;
    this.wheels = [];
    this.setStyle(spawn.style || 'hatch');

    // --- Lighting: headlights (actually illuminate), brake lights, turn signals -----
    // Small emissive lenses double as the visible "lamp", each paired 1:1 with a real
    // light where it matters (headlights only — brake lights and blinkers are common
    // enough and numerous enough across a city that giving every one of them a real
    // THREE.Light would tank performance for no visible benefit at this scale).
    const addLens = (x, y, z, w, h, color) => {
      x *= WK;
      const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: color, emissiveIntensity: 0 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), mat);
      m.position.set(x, y, z);
      this.group.add(m);
      return m;
    };

    this.headlightMeshes = [-0.62, 0.62].map(x => addLens(x, 0.55, 1.79, 0.26, 0.16, 0xfff6d0));
    this.headSpots = [-0.62 * WK, 0.62 * WK].map(x => {
      // Intensity/distance tuned against this scene's (deliberately dim, night-time)
      // ambient + moonlight — see main.js, now dialed down further so headlights
      // actually matter. Widened and thrown further than before: the previous cone
      // read as a narrow tunnel of light rather than the broad wash of a real low-beam.
      const sp = new THREE.SpotLight(0xfff6d0, 65, 42, Math.PI / 4.2, 0.5, 1.05);
      sp.position.set(x, 0.55, 1.8);
      sp.castShadow = false;
      this.group.add(sp);
      sp.target.position.set(x * 0.3, 0.1, 10);
      this.group.add(sp.target);
      return sp;
    });

    this.brakeMeshes = [-0.62, 0.62].map(x => addLens(x, 0.6, -1.8, 0.24, 0.14, 0xff2a2a));

    this.blinkers = {
      frontLeft: addLens(0.9, 0.5, 1.7, 0.16, 0.14, 0xffa726),
      frontRight: addLens(-0.9, 0.5, 1.7, 0.16, 0.14, 0xffa726),
      rearLeft: addLens(0.9, 0.6, -1.8, 0.16, 0.14, 0xffa726),
      rearRight: addLens(-0.9, 0.6, -1.8, 0.16, 0.14, 0xffa726)
    };
    this.blinkPhase = 0;

    // Light spilling onto the road from the lamps that aren't real THREE.Lights (see the
    // note above): a red wash behind the car that flares on braking, and an amber pool at
    // the front and rear corners of whichever side is indicating, blinking in time with the
    // lenses. Fake, additive and nearly free — see glow.js.
    // reverse lights: white lenses inside the brake lights, a white wash behind the car while backing up
    this.reverseMeshes = [-0.34, 0.34].map(x => addLens(x, 0.52, -1.8, 0.16, 0.12, 0xffffff));
    this.reversePool = createGroundGlow(0xffffff, 3.0, 3.2);
    this.reversePool.position.set(0, 0.06, -3.0);
    this.group.add(this.reversePool);
    this.reverseHalos = [-0.34 * WK, 0.34 * WK].map(x => { const h = createHalo(0xffffff, 1.0); h.position.set(x, 0.52, -1.9); this.group.add(h); return h; });
    this.brakePool = createGroundGlow(0xff2a1a, 3.6, 2.8);
    this.brakePool.position.set(0, 0.06, -3.2);
    this.brakeHalos = [-0.62 * WK, 0.62 * WK].map(x => { const h = createHalo(0xff2a1a, 1.4); h.position.set(x, 0.6, -1.9); this.group.add(h); return h; });
    this.group.add(this.brakePool);
    const blinkPool = (x, z) => {
      const m = createGroundGlow(0xffa726, 3.2, 3.6);
      m.position.set(x, 0.06, z);
      this.group.add(m);
      return m;
    };
    this.blinkPools = {
      left: [blinkPool(1.7, 2.2), blinkPool(1.7, -2.4)],
      right: [blinkPool(-1.7, 2.2), blinkPool(-1.7, -2.4)]
    };

    this.x = spawn.x;
    this.z = spawn.z;
    this.y = 0;
    this.heading = spawn.heading || 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0; this.vy = 0; this.airborne = false;
    this.pitchV = 0; this.rollV = 0; this.wheelDy = [0, 0, 0, 0];
    this.vx = 0; this.vz = 0;   // real world velocity: trails the heading when grip is low
    this.grip = 1;              // 1 dry road, lower when wet / snowy (set from main.js)
    this.steerAngle = 0; // eased "steering wheel" angle, see update()
    this.maxReverse = -10;
    this.collisionRadius = 1.1; // used by collision.js for car-vs-world hit tests
    // YXZ so yaw (heading) applies first in world space, then pitch/roll apply in the
    // car's own local frame — the nose tips and the body leans relative to where it's
    // actually pointing, not relative to world axes.
    this.group.rotation.order = 'YXZ';
    this.group.position.set(this.x, 0, this.z);
    if (this._lightK && (this._lightK[0] !== 1 || this._lightK[1] !== 1)) this.layoutLights(...this._lightK);
  }

  // Called by collision.js with the surface normal (pointing away from the obstacle): cancels
  // the part of the real velocity heading into it, so a sliding car scrapes along instead of
  // grinding into the wall.
  absorb(nx, nz, bounce = 0.15) {
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) { this.vx -= (1 + bounce) * vn * nx; this.vz -= (1 + bounce) * vn * nz; }
  }

  // Swap the body (see carModels.js). Lights, collision and wheel sampling are shared by
  // every model, so only the visible shell and wheels change.
  setStyle(key) {
    if (this.model) this.group.remove(this.model);
    this.model = buildCarModel(key);
    this.group.add(this.model);
    this.wheels = this.model.userData.wheels;
    this.wheels.forEach(w => { w.userData.baseY = w.position.y; });
    this.wheelDy = [0, 0, 0, 0];
    this.styleKey = key;
    // per-car handling: top speed, acceleration, mass (see carModels.js)
    const st = this.model.userData.style;
    this.maxSpeed = st.maxSpeed; this.accel = st.accel; this.mass = st.mass; this.baseMass = st.mass;
    this.massFactor = Math.max(0.6, Math.min(1.6, Math.pow(st.mass / 1300, 0.6)));  // how hard objects slow it
    this.brakeMul = st.brake || 1; this.handlingMul = st.handling || 1;
    // long bodies (the bus): more collision circles and the lamps moved out to the ends of the body
    const zK = (st.len || 3.6) / 3.6, yK = st.height ? 1.35 : 1;
    this.bodyOffsets = zK > 1.2 ? [zK * 1.25, zK * 0.45, -zK * 0.45, -zK * 1.25] : null;
    this.collisionRadius = zK > 1.2 ? 1.5 : 1.1;
    this.dimLen = st.len || 3.6; this.dimHeight = st.height || 1.5;
    if (this.headlightMeshes) this.layoutLights(zK, yK);
    this._lightK = [zK, yK];
  }

  // scale the lamps' z (towards the ends of a long body) and y (higher on a tall one)
  layoutLights(zK, yK) {
    const objs = [...this.headlightMeshes, ...this.headSpots, ...this.brakeMeshes, ...Object.values(this.blinkers), ...this.reverseMeshes, ...this.blinkPools.left, ...this.blinkPools.right, this.reversePool];
    objs.forEach(o => {
      if (!o.userData.p0) o.userData.p0 = o.position.clone();
      o.position.set(o.userData.p0.x, o.userData.p0.y * (o.isMesh && !o.isLight && o.material && o.material.emissive ? yK : 1), o.userData.p0.z * zK);
    });
    this.headSpots.forEach(sp => { if (!sp.target.userData.p0) sp.target.userData.p0 = sp.target.position.clone(); sp.target.position.z = sp.target.userData.p0.z + (zK - 1) * 1.8; });
  }

  // Put the car somewhere and forget any motion (respawn, shop bay, dealership preview).
  teleport(x, z, y, heading) {
    this.x = x; this.z = z; this.y = y || 0; this.heading = heading || 0;
    this.speed = 0; this.vx = 0; this.vz = 0; this.vy = 0; this.airborne = false;
    this.pitch = 0; this.roll = 0; this.pitchV = 0; this.rollV = 0; this.yV = 0; this.steerAngle = 0;
    this.gTarget = null; this.drifting = false; this.yawRate = 0;
    this.wheelDy = [0, 0, 0, 0];
    this.wheels.forEach((w, i) => { w.position.y = w.userData.baseY; });
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(0, this.heading, 0);
  }

  // Driving model: arcade (NFSU-ish) -- strong grip, quick turn-in that relaxes at speed, a handbrake that
  // throws the tail out, slippery grass -- plus a real vertical model: the body rides on a spring over four
  // wheel contact points, so braking dips the nose, kerbs and bumps jolt it, and driving off an edge is a
  // proper fall. heightAt(x, z, refY) gives the surface under each wheel (terrain.js); `heightAt.kind` says
  // what it is ('road' | 'curb' | 'plaza' | 'ground'). Pass null to stay flat.
  update(dt, input, heightAt) {
    // Back / brake logic: the brake pedal (S / Down / on-screen BRAKE, and Space) brakes while you are rolling and keeps braking
    // until you stop - holding it never flips into reverse. Release it and press it again at a standstill to reverse.
    const pedal = !!(input.back || (input.brake && !input.forward && !input.parked));
    if (pedal && !this._backHeld) this._revOK = this.speed <= 0.3;
    if (!pedal) this._revOK = false;
    this._backHeld = pedal;
    if (this.speed < -0.3 && pedal) this._revOK = true;
    const reversing = pedal && this._revOK && this.speed <= 0.3;
    const accelInput = input.forward ? 1 : (reversing ? -1 : 0);
    const steerInput = (input.steerAxis != null) ? input.steerAxis : (input.left ? 1 : input.right ? -1 : 0);
    const thr = input.throttle == null ? 1 : input.throttle;   // analog gas (touch slider)
    const braking = !!(input.brake || pedal) && !reversing;

    const sinH0 = Math.sin(this.heading), cosH0 = Math.cos(this.heading);
    const HALF_TRACK = WK, HALF_WB = 1.25 * Math.min(1.6, (this.dimLen || 3.6) / 3.6 * 0.85 + 0.15);
    const LX = [HALF_TRACK, -HALF_TRACK, HALF_TRACK, -HALF_TRACK], LZ = [HALF_WB, HALF_WB, -HALF_WB, -HALF_WB];   // fl fr rl rr (+x = the side a +roll raises)

    // ---- what is under the wheels ------------------------------------------------------------------
    const gy = this._gy || (this._gy = [0, 0, 0, 0]);
    let offRoad = 0, gCenter = this.y;
    if (heightAt) {
      for (let i = 0; i < 4; i++) {
        gy[i] = heightAt(this.x + sinH0 * LZ[i] + cosH0 * LX[i], this.z + cosH0 * LZ[i] - sinH0 * LX[i], this.y);
        if (heightAt.kind === 'ground') offRoad++;
      }
      gCenter = heightAt(this.x, this.z, this.y);
    } else { gy[0] = gy[1] = gy[2] = gy[3] = 0; gCenter = 0; }
    const grass = offRoad / 4;
    this.surface = grass > 0.5 ? 'ground' : 'road';
    const surf = 1 - 0.3 * grass;                       // grass is a little slick

    const g = Math.max(0.15, Math.min(1, (this.grip + (this.gripBonus || 0)) * surf));
    const speedAbs = Math.abs(this.speed);

    // ---- longitudinal -------------------------------------------------------------------------------
    const air = this.airborne;
    const k = Math.min(1, speedAbs / this.maxSpeed);
    if (!air) {
      if (accelInput > 0) {
        const kt = k / Math.max(0.15, thr);
        this.speed += this.accel * Math.pow((this.baseMass || this.mass) / this.mass, 0.8) * (0.45 + 0.55 * g) * Math.min(1, thr * 1.2) * Math.max(-0.6, 1 - Math.pow(kt, 3)) * dt;
      } else if (accelInput < 0) this.speed -= this.accel * 0.55 * dt;
      // braking is a constant deceleration (~1.1 g at stock, more with brake upgrades and lighter cars) rather than a
      // fixed fraction of speed, which used to slam the car to a stop from any speed
      const brakeDec = 11 * (this.brakeMul || 1) * Math.pow(1100 / this.mass, 0.3) * (0.3 + 0.7 * g) * (this.drifting ? 0.15 : 1);
      if (braking) { const d = Math.min(Math.abs(this.speed), brakeDec * dt); this.speed -= Math.sign(this.speed) * d; this.speed *= Math.exp(-0.05 * dt); }
      else this.speed *= Math.exp(-(accelInput > 0 ? 0.03 : 0.4) * dt);
      if (grass > 0.5 && this.speed > 0) { const cap = this.maxSpeed * 0.94 * (1 - 0.2 * grass); if (this.speed > cap) this.speed += (cap - this.speed) * (1 - Math.exp(-12 * dt)); }   // grass costs about 20 % of the top speed
    }
    this.speed = Math.max(this.maxReverse, Math.min(this.maxSpeed, this.speed));
    if (Math.abs(this.speed) < 0.02) this.speed = 0;

    // ---- steering: quick turn-in, relaxes with speed, handbrake slides -----------------------------------
    const steerEase = 1 - Math.pow(0.00002, dt);
    this.steerAngle += (steerInput - this.steerAngle) * steerEase;
    const hand = !!input.brake && speedAbs > 7 && Math.abs(this.steerAngle) > 0.15 && !air;
    this.drifting = hand;
    const speedFactor = Math.min(1, speedAbs / 4);
    const relax = 1 / (1 + 1.1 * k * k * 2.2);                           // 1 at crawl -> ~0.45 at top speed
    const hm = (this.handlingMul || 1) * Math.pow(1100 / this.mass, 0.25);   // suspension/tyres, and lighter cars turn in quicker
    // a real car's turning circle: about 6.5 m radius at a walking pace (bicycle model: yaw rate <= speed / radius)
    const rMin = 5.3 * Math.max(1, (this.dimLen || 3.6) / 3.6) * (hand ? 0.75 : 1) / Math.max(0.7, this.handlingMul || 1) ** 0.5;
    const turnRate = Math.min(2.45 * hm * relax * (hand ? 1.25 : 1), speedAbs / rMin) * (this.speed < 0 ? -1 : 1);
    const wMax = (58 * hm * Math.pow(g, 1.5) * (hand ? 1.15 : 1)) / Math.max(speedAbs, 1);
    let w = 0;
    if (!air) w = Math.max(-wMax, Math.min(wMax, this.steerAngle * turnRate));
    this.heading += w * dt;
    this.yawRate = w;

    // velocity follows the heading; the lag is the slide
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    if (!air) {
      const kFollow = hand ? 2.6 : 15 * Math.pow(g, 2.2);
      const follow = 1 - Math.exp(-kFollow * dt);
      this.vx += (fx * this.speed - this.vx) * follow;
      this.vz += (fz * this.speed - this.vz) * follow;
      if (hand) this.speed *= Math.exp(-0.28 * dt);
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // ---- vertical: spring body over the wheel contact points ----------------------------------------------
    let aLong = (this.speed - (this._lastSpeed ?? this.speed)) / Math.max(dt, 1e-4);
    this._lastSpeed = this.speed;
    this._aLong = (this._aLong || 0) + (Math.max(-60, Math.min(40, aLong)) - (this._aLong || 0)) * Math.min(1, dt * 9);

    const DROP = 0.5;                                      // a wheel with the ground this far below the body is hanging
    let supported = 0, sumY = 0;
    for (let i = 0; i < 4; i++) if (gy[i] >= this.y - DROP) { supported++; sumY += gy[i]; }
    const centerOK = gCenter >= this.y - DROP;
    let grounded = heightAt ? (supported >= 3 || (supported >= 2 && centerOK)) : true;
    // Take-off: climbing a ramp the body carries the ramp's vertical speed. If the ground then falls away faster than
    // gravity pulls the car down (a crest taken fast, a ramp that ends), it leaves the road. Speed and slope decide the
    // height; a heavier car's springs stay planted a little longer.
    if (grounded && !air && heightAt && this.gTarget != null && speedAbs > 9 && this.vy > 0.7) {
      const gT0 = supported ? sumY / supported : gCenter;
      const ball = this.y + this.vy * dt - 0.5 * 26 * dt * dt;
      if (gT0 < ball - (0.02 + 0.03 * this.mass / 1300)) grounded = false;
    }

    const STEP_CLAMP = 12;
    let targetPitch = 0, targetRoll = 0;
    if (grounded) {
      if (air) {                                           // touchdown: the springs soak up the impact
        this.airborne = false;
        const impact = Math.max(0, -this.vy);
        if (impact > 6) this.speed *= Math.max(0.6, 1 - (impact - 6) * 0.012);
        this.landed = impact;
      }
      const gT = supported ? sumY / supported : gCenter;
      const gRate = this.gTarget == null ? 0 : Math.max(-STEP_CLAMP, Math.min(STEP_CLAMP, (gT - this.gTarget) / Math.max(dt, 1e-4)));
      this.gTarget = gT; this.gRate = gRate;
      // spring toward the ground height with feed-forward of the ground's own motion (so a steady slope
      // is tracked exactly, and only steps / bumps set the body bouncing)
      const K = 260, C = 2 * 0.52 * Math.sqrt(K);
      let vy = this.vy;
      vy += (-K * (this.y - gT) - C * (vy - gRate)) * dt;
      this.y += vy * dt;
      this.vy = vy;
      // bump stops: the body can't sink through the contact points
      if (this.y < gT - 0.09) { this.y = gT - 0.09; if (this.vy < gRate) this.vy = gRate; }
      const frontY = (gy[0] + gy[1]) / 2, rearY = (gy[2] + gy[3]) / 2;
      const leftY = (gy[0] + gy[2]) / 2, rightY = (gy[1] + gy[3]) / 2;
      const lim = (v, m) => Math.max(-m, Math.min(m, v));
      targetPitch = lim(Math.atan2(rearY - frontY, HALF_WB * 2), 0.6);
      targetRoll = lim(Math.atan2(leftY - rightY, HALF_TRACK * 2), 0.6);
    } else {
      // in the air: ballistic, nose follows the flight path
      if (!air) { this.airborne = true; this.gTarget = null; if (!(this.vy < 0)) this.vy = Math.max(this.vy, 0); }
      this.vy -= 26 * dt;
      this.y += this.vy * dt;
      const hs = Math.max(3, Math.hypot(this.vx, this.vz));
      targetPitch = Math.max(-0.45, Math.min(0.55, Math.atan2(-this.vy, hs) * 0.8));
      targetRoll = 0;
      if (heightAt && this.y <= gCenter) {                // landing on whatever is under the middle of the car
        this.y = gCenter; this.airborne = false; this.gTarget = gCenter; this.gRate = 0;
        if (this.vy < -6) this.speed *= Math.max(0.6, 1 - (-this.vy - 6) * 0.012);
        this.landed = -this.vy;
      }
    }
    this._wasGrounded = grounded;

    // dynamic weight transfer: dive under braking, squat under power, lean in the corners
    if (grounded) {
      targetPitch += Math.max(-0.06, Math.min(0.07, -this._aLong * 0.0038));
      targetRoll += Math.max(-0.08, Math.min(0.08, w * speedAbs * 0.0021 * (this.speed < 0 ? -1 : 1)));
    }
    // the pitch and roll are springs too (underdamped, so a kerb or bump unsettles the body), with the target's own
    // rate fed forward so they track slopes without lagging
    const pr = this._tp === undefined ? 0 : Math.max(-4, Math.min(4, (targetPitch - this._tp) / Math.max(dt, 1e-4)));
    const rr2 = this._tr === undefined ? 0 : Math.max(-4, Math.min(4, (targetRoll - this._tr) / Math.max(dt, 1e-4)));
    this._tp = targetPitch; this._tr = targetRoll;
    const KA = grounded ? 190 : 22, CA = 2 * (grounded ? 0.5 : 0.9) * Math.sqrt(KA);
    this.pitchV += (-KA * (this.pitch - targetPitch) - CA * (this.pitchV - pr)) * dt;
    this.rollV += (-KA * (this.roll - targetRoll) - CA * (this.rollV - rr2)) * dt;
    this.pitch += this.pitchV * dt; this.roll += this.rollV * dt;

    // ---- wheels: each reaches for its own contact point (pushes in on a bump, droops in the air) ---------------
    const sp = Math.sin(this.pitch), sr = Math.sin(this.roll);
    for (let i = 0; i < 4 && i < this.wheels.length; i++) {
      const wh = this.wheels[i], base = wh.userData.baseY;
      let d;
      if (grounded) {
        const lx = wh.position.x > 0 ? 1 : -1, lz = wh.position.z > 0 ? 1 : -1;
        const j = lz > 0 ? (lx > 0 ? 0 : 1) : (lx > 0 ? 2 : 3);
        const corner = this.y - wh.position.z * sp + wh.position.x * sr;
        d = Math.max(-0.16, Math.min(0.14, gy[j] - corner));
      } else d = -0.12;
      const wd = this.wheelDy[i] += (d - this.wheelDy[i]) * Math.min(1, dt * (grounded ? 40 : 8));
      wh.position.y = base + wd;
    }

    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(this.pitch, this.heading, this.roll);
    this.wheels.forEach(w => { w.rotation.x += this.speed * dt * 1.4; });

    // --- Lighting state ----------------------------------------------------------
    const lightsOn = !!input.lightsOn;
    this.lightsOn = lightsOn; // exposed for things outside this class (e.g. main.js's reflector glow)
    this.headlightMeshes.forEach(m => { m.material.emissiveIntensity = lightsOn ? 1.4 : 0; });
    this.headSpots.forEach(sp => { sp.intensity = lightsOn ? 40 : 0; });

    const brakeOn = !!braking;
    this.brakeMeshes.forEach(m => { m.material.emissiveIntensity = brakeOn ? 1.8 : (lightsOn ? 0.25 : 0); });

    this.blinkPhase += dt;
    const blinkOn = Math.floor(this.blinkPhase * 3) % 2 === 0; // ~1.5Hz blink rate
    if ((input.blinkerLeft || input.blinkerRight) && blinkOn !== this._blinkPrev) this.blinkEvent = blinkOn ? 1 : -1;
    this._blinkPrev = (input.blinkerLeft || input.blinkerRight) ? blinkOn : null;
    const leftOn = !!input.blinkerLeft && blinkOn;
    const rightOn = !!input.blinkerRight && blinkOn;
    this.blinkers.frontLeft.material.emissiveIntensity = leftOn ? 2 : 0;
    this.blinkers.rearLeft.material.emissiveIntensity = leftOn ? 2 : 0;
    this.blinkers.frontRight.material.emissiveIntensity = rightOn ? 2 : 0;
    this.blinkers.rearRight.material.emissiveIntensity = rightOn ? 2 : 0;

    const revOn = accelInput < 0 || this.speed < -0.3;
    this.reverseMeshes.forEach(m => { m.material.emissiveIntensity = revOn ? 0.9 : 0; });
    this.reverseHalos.forEach(h => { h.material.opacity = revOn ? 0.22 : 0; h.visible = revOn; });
    setGlow(this.reversePool, revOn ? 0.1 : 0);
    setGlow(this.brakePool, brakeOn ? 0.32 : (lightsOn ? 0.08 : 0));
    this.brakeHalos.forEach(h => { const o = brakeOn ? 0.8 : (lightsOn ? 0.22 : 0); h.material.opacity = o; h.visible = o > 0; });
    this.blinkPools.left.forEach(m => setGlow(m, leftOn ? 0.9 : 0));
    this.blinkPools.right.forEach(m => setGlow(m, rightOn ? 0.9 : 0));
  }
}
