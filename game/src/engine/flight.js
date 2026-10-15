// Free-flight controls for the player's ship, shared by both modes:
// mouse aims (pitch + yaw), W/S thrust/brake, A/D turn, Space up, Shift+S down, Shift nitro.
// Speed lives on the ship (ship.speed / ship.burst) so crashes, bumps, hits and boost rings
// can act on the player exactly as they do on the AI racers.
import * as THREE from 'three';
import { groundHeight, clamp } from './world.js';
import { NITRO_DRAIN, NITRO_MULT } from './config.js';

const MOUSE_SENS = 0.0022; // radians per pixel
const LIFT_SPEED = 45;     // m/s straight up (Space) or down (Shift+S)

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Unit vector for a heading (yaw 0 = +Z, positive = towards +X) and pitch (positive = up). */
export const forward = (out, yaw, pitch) =>
  out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));

/**
 * Swing a camera offset (ship → camera) around the ship by the numpad orbit:
 * negative yaw moves the camera to the ship's left, positive pitch raises it.
 */
export function applyOrbit(offset, orbit) {
  if (!orbit.yaw && !orbit.pitch) return offset;
  const dist = offset.length();
  const az = Math.atan2(offset.x, offset.z) + orbit.yaw;
  const el = clamp(Math.atan2(offset.y, Math.hypot(offset.x, offset.z)) + orbit.pitch, -0.35, 1.45);
  return offset.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
}

/** How much to keep looking ahead of the ship (1 = straight behind, 0 = swung round to the side or above). */
export const lookAhead = (orbit) => Math.max(0, Math.cos(orbit.yaw)) * Math.max(0, Math.cos(orbit.pitch));

export class Flight {
  constructor({ camera, particles, orbit }) {
    Object.assign(this, { camera, particles, orbit });
    this.zoom = 22;
    this.invert = false;
    this.fov = 60;
    this.dir = new THREE.Vector3(0, 0, 1);
    this.ship = null;
    this.hauling = false; // set while a crate hangs below: the camera backs off and looks lower to keep it in view
    this.haul = 0;
  }

  /** Take over `ship` where it stands, nose down the canyon (+Z). */
  takeControl(ship, speed = 0) {
    this.ship = ship;
    ship.speed = speed;
    ship.burst = 0;
    Object.assign(this, { yaw: 0, pitch: 0, aimYaw: 0, aimPitch: 0, yawRate: 0, lift: 0, camYaw: 0, camPitch: 0, shake: 0 });
    forward(this.dir, 0, 0);
  }

  /** Mouse movement in pixels (pointer-locked). */
  aim(dx, dy) {
    this.aimYaw -= dx * MOUSE_SENS;
    this.aimPitch -= dy * MOUSE_SENS * (this.invert ? -1 : 1);
    this.clampAim();
  }

  clampAim() {
    this.aimYaw = clamp(this.aimYaw, this.yaw - 1, this.yaw + 1);
    this.aimPitch = clamp(this.aimPitch, -1.3, 1.3);
  }

  /**
   * One physics step.
   * cruise:  top speed reachable with W (nitro and boost rings go beyond it)
   * move:    false = held in place (race countdown) but still animated
   * ceiling: (groundY) => highest allowed y
   * ground:  (x, z, y) => surface height; lets Explore add floating isles you can land on
   * maxSink: fastest straight-down speed with Shift+S (slower while a crate hangs below you)
   */
  update(dt, t, keys, { cruise, move = true, ceiling = () => Infinity, ground = groundHeight, maxSink = LIFT_SPEED }) {
    const s = this.ship, st = s.def.stats;
    this.ground = ground;
    const held = (...codes) => codes.some((c) => keys.has(c));
    s.prev.copy(s.pos);

    if (move) {
      // A/D (or ←/→) turn; ↑/↓ pitch as a fallback for players without a mouse.
      this.aimYaw += ((held('KeyA', 'ArrowLeft') ? 1 : 0) - (held('KeyD', 'ArrowRight') ? 1 : 0)) * 1.1 * st.handling * dt;
      this.aimPitch += ((held('ArrowUp') ? 1 : 0) - (held('ArrowDown') ? 1 : 0)) * 1.1 * dt;
      this.clampAim();

      // The ship chases the aim at a limited turn rate, which also smooths out mouse jitter.
      const maxRate = 1.8 * st.handling;
      const lastYaw = this.yaw;
      this.yaw += clamp((this.aimYaw - this.yaw) * 5, -maxRate, maxRate) * dt;
      this.pitch += clamp((this.aimPitch - this.pitch) * 5, -maxRate, maxRate) * dt;
      this.yawRate = (this.yaw - lastYaw) / Math.max(dt, 1e-4);

      // Throttle: W thrusts, S brakes (down to a hover), nothing held = keep your speed.
      // Shift is nitro on its own, but Shift+S means "descend", so it neither boosts nor brakes.
      const shift = held('ShiftLeft', 'ShiftRight');
      const descend = shift && held('KeyS');
      const boosting = shift && !descend && s.nitro > 0.004;
      if (held('KeyW') && s.speed < cruise) s.speed = Math.min(cruise, s.speed + 55 * st.accel * dt);
      if (held('KeyS') && !descend) s.speed -= 95 * dt;
      if (boosting) {
        s.speed += 120 * st.accel * dt;
        s.nitro = Math.max(0, s.nitro - (dt * NITRO_DRAIN) / st.nitro);
      }
      const cap = boosting ? cruise * NITRO_MULT : cruise;
      if (s.speed > cap) s.speed += (cap - s.speed) * (1 - Math.exp(-dt * 1.2));
      s.speed = Math.max(0, s.speed);
      s.burst *= Math.exp(-dt * 0.8);
      s.nitroActive = boosting;

      // Vertical thrusters: Space rises, Shift+S sinks, straight up/down whatever the nose is doing.
      const liftTarget = (held('Space') ? LIFT_SPEED : 0) - (descend ? maxSink : 0);
      this.lift += (liftTarget - this.lift) * (1 - Math.exp(-dt * 4));

      forward(this.dir, this.yaw, this.pitch);
      s.pos.addScaledVector(this.dir, s.fwd * dt);
      s.pos.y += this.lift * dt;
      this.collide(dt, ceiling);
      s.topSpeed = Math.max(s.topSpeed, s.fwd);
    } else {
      s.nitroActive = false;
      this.yawRate = 0;
      this.lift = 0;
    }

    // Bank into turns; tip the nose slightly with the vertical thrusters so rising/sinking reads visually.
    s.roll += (clamp(-this.yawRate * 0.55, -1.1, 1.1) - s.roll) * (1 - Math.exp(-dt * 5));
    s.object.position.copy(s.pos);
    s.object.rotation.set(-this.pitch - this.lift * 0.004, this.yaw, s.roll);
    const thrust = Math.max(s.fwd / Math.max(cruise, 60), (Math.abs(this.lift) / LIFT_SPEED) * 0.6);
    s.animate(dt, t, clamp(thrust, 0.08, 1));
  }

  /** Terrain: sample nose, tail and wingtips; on contact slide along it and get nudged nose-up. */
  collide(dt, ceiling) {
    const s = this.ship, v = s.fwd;
    const { x, y, z } = s.pos;
    const ground = this.ground;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const hl = s.halfLength * 0.8, hw = s.halfWidth * 0.6;
    const g = Math.max(
      ground(x, z, y),
      ground(x + fx * hl, z + fz * hl, y),
      ground(x - fx * hl, z - fz * hl, y),
      ground(x - fz * hw, z + fx * hw, y),
      ground(x + fz * hw, z - fx * hw, y),
    );
    s.ground = g;
    const minY = g + s.halfHeight + 1.2;
    s.scraping = s.pos.y < minY;
    if (s.scraping) {
      s.pos.y = minY;
      this.lift = Math.max(this.lift, 0);
      s.speed *= Math.exp(-dt * 0.5);
      // Ride up the slope ahead instead of grinding into it (not when gently settling at a hover).
      const slope = Math.atan2(ground(x + fx * 12, z + fz * 12, y) - ground(x, z, y), 12);
      const climb = Math.max(0.15, slope + 0.12);
      if (v > 15 && this.pitch < climb) {
        this.pitch += (climb - this.pitch) * (1 - Math.exp(-dt * 10));
        this.aimPitch = Math.max(this.aimPitch, this.pitch);
      }
      this.shake = Math.max(this.shake, 0.25);
      if (v > 20) {
        this.particles.emit(_v.set(s.pos.x, s.pos.y - s.halfHeight, s.pos.z), 3, {
          color: 0xffb04a, speed: 12, life: 0.5, vel: _w.copy(this.dir).multiplyScalar(-v * 0.2),
        });
      }
    }
    const top = ceiling(g);
    if (s.pos.y > top) {
      s.pos.y = top;
      this.lift = Math.min(this.lift, 0);
      this.aimPitch = Math.min(this.aimPitch, 0);
    }
  }

  updateCamera(dt) {
    const s = this.ship, cam = this.camera;
    const k = 1 - Math.exp(-dt * 5);
    this.camYaw += (this.yaw - this.camYaw) * k;
    this.camPitch += (this.pitch * 0.7 - this.camPitch) * k;
    const sp = clamp(s.fwd / 220, 0, 1);
    this.haul += ((this.hauling ? 1 : 0) - this.haul) * (1 - Math.exp(-dt * 2));
    forward(_v, this.camYaw, this.camPitch).multiplyScalar(-(this.zoom + sp * 4 + s.nitroGlow * 3 + this.haul * 16));
    _v.y += 4 + this.zoom * 0.1 + this.haul * 20;
    cam.position.copy(s.pos).add(applyOrbit(_v, this.orbit));
    const floor = groundHeight(cam.position.x, cam.position.z) + 2.5;
    if (cam.position.y < floor) cam.position.y = floor;
    if (this.shake > 0.002) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 5);
    }
    _w.copy(s.pos).addScaledVector(this.dir, 30 * lookAhead(this.orbit));
    _w.y += 1.5 - this.haul * 19;
    cam.lookAt(_w);
    this.fov = 60 + sp * 12 + s.nitroGlow * 8;
  }
}
