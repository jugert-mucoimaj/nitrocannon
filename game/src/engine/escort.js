// The hauler's wingman: a Phoenix that answers the radio (H), flies in formation off your right wing,
// breaks off to dogfight any drone that comes near you, and heads home when its time is up.
import * as THREE from 'three';
import { Racer } from './racers.js';
import { clamp } from './world.js';
import { BOLT_SPEED } from './lasers.js';

const STAY = 75;          // seconds on station
const COOLDOWN = 45;      // after it leaves, before you can call it again
const ARRIVE_FROM = 700;  // it flies in from this far behind you
const ENGAGE_RANGE = 650; // drones this close to you get chased
const FIRE_RANGE = 420;
const FIRE_CONE = 0.985;  // cos of the angle it will shoot within
const SPREAD = 0.04;      // radians of scatter, so it doesn't win every fight for you
export const ESCORT_BOLT = 0xffc84a;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _slot = new THREE.Vector3(), _aim = new THREE.Vector3();

export class Escort {
  constructor({ scene, def, model, lasers, particles, sfx, toast }) {
    Object.assign(this, { scene, lasers, particles, sfx, toast });
    this.ship = new Racer(def, model);
    this.ship.object.visible = false;
    scene.add(this.ship.object);
    this.vel = new THREE.Vector3();
    this.reset();
  }

  dispose() {
    this.scene.remove(this.ship.object);
  }

  reset() {
    this.state = 'idle'; // idle → inbound → escort → leaving → idle
    this.readyAt = 0;
    this.target = null;
    this.kills = 0;
    this.ship.object.visible = false;
  }

  get active() {
    return this.state === 'inbound' || this.state === 'escort';
  }

  /** H on the radio. Returns nothing; reports through toasts. */
  call(t, player, yaw) {
    if (this.active) return this.toast('Phoenix is already flying with you');
    if (this.state === 'leaving' || t < this.readyAt) {
      return this.toast(`Escort refuelling · ${Math.ceil(Math.max(this.readyAt - t, 1))}s`);
    }
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const s = this.ship;
    s.pos.set(player.pos.x - fx * ARRIVE_FROM + fz * 90, player.pos.y + 140, player.pos.z - fz * ARRIVE_FROM - fx * 90);
    s.prev.copy(s.pos);
    this.vel.set(fx, 0, fz).multiplyScalar(Math.max(player.fwd, 60));
    this.yaw = yaw;
    this.pitch = 0;
    s.roll = 0;
    s.object.visible = true;
    this.state = 'inbound';
    this.until = t + STAY;
    this.target = null;
    this.fireCd = 0;
    this.sfx.boost();
    this.toast('Phoenix escort inbound', 'scan');
  }

  /** ctx: { player, playerVel, yaw (player heading), drones, ground(x, z, y) } */
  update(dt, t, ctx) {
    if (this.state === 'idle') return;
    const s = this.ship, p = ctx.player;
    if (this.active && t > this.until) {
      this.state = 'leaving';
      this.leaveAt = t + 7;
      this.readyAt = t + COOLDOWN;
      this.target = null;
      this.toast('Phoenix heading home · H again in a bit', 'scan');
    }
    if (this.state === 'leaving' && t > this.leaveAt) {
      this.state = 'idle';
      s.object.visible = false;
      return;
    }

    // Pick (or keep) a drone to chase: the one nearest to you.
    if (this.state !== 'leaving') {
      if (this.state === 'inbound' && s.pos.distanceTo(p.pos) < 400 && ctx.drones.list.length) {
        this.state = 'escort'; // straight into the fight
        this.toast('Phoenix: “Engaging!”', 'scan');
      }
      if (this.target && (!ctx.drones.list.includes(this.target) || this.target.pos.distanceTo(p.pos) > ENGAGE_RANGE * 1.3)) this.target = null;
      if (!this.target) {
        let best = ENGAGE_RANGE;
        for (const d of ctx.drones.list) {
          const dist = d.pos.distanceTo(p.pos);
          if (dist < best) [this.target, best] = [d, dist];
        }
      }
    }

    // Where it wants to be, and how fast it may go to get there.
    const fx = Math.sin(ctx.yaw), fz = Math.cos(ctx.yaw);
    const cruise = Math.max(140, ctx.playerVel.length() * 1.35);
    const desired = _w;
    if (this.state === 'leaving') {
      desired.copy(this.vel).setY(0).normalize().multiplyScalar(cruise * 1.4);
      desired.y = 90;
    } else if (this.target) {
      // Pursuit: fly at a point a little behind the drone so it overshoots less, sliding past if too close.
      const d = this.target;
      _v.copy(d.pos).addScaledVector(d.vel, -0.4);
      desired.subVectors(_v, s.pos);
      const dist = desired.length();
      desired.multiplyScalar((dist < 45 ? cruise * 0.6 : cruise * 1.3) / Math.max(dist, 1e-3));
      if (dist < 45) desired.add(this.vel.clone().setLength(cruise * 0.6));
    } else {
      // Formation: off your right wing, a little above and behind, matching your velocity.
      _slot.set(p.pos.x - fz * 24 - fx * 14, p.pos.y + 7, p.pos.z + fx * 24 - fz * 14);
      desired.subVectors(_slot, s.pos);
      const dist = desired.length();
      desired.multiplyScalar(Math.min(dist * 1.4, dist > 300 ? cruise * 2 : cruise) / Math.max(dist, 1e-3)).add(ctx.playerVel);
      if (this.state === 'inbound' && dist < 50) {
        this.state = 'escort';
        this.toast('Phoenix: “On your wing.”', 'scan');
      }
    }
    if (desired.length() > cruise * 2.2) desired.setLength(cruise * 2.2);
    this.vel.lerp(desired, 1 - Math.exp(-dt * 2.4));

    s.prev.copy(s.pos);
    s.pos.addScaledVector(this.vel, dt);
    const floor = ctx.ground(s.pos.x, s.pos.z, s.pos.y) + s.halfHeight + 8;
    if (s.pos.y < floor) {
      s.pos.y = floor;
      this.vel.y = Math.max(this.vel.y, 0);
    }
    s.speed = this.vel.length();
    s.burst = 0;

    // Face where it's going, or the drone when it has a shot lined up.
    let aim = this.vel;
    if (this.target) {
      const lead = this.target.pos.distanceTo(s.pos) / BOLT_SPEED;
      _aim.copy(this.target.pos).addScaledVector(this.target.vel, lead).sub(s.pos);
      if (_aim.length() < FIRE_RANGE * 1.3) aim = _aim;
    }
    if (aim.lengthSq() > 25) {
      const yaw = Math.atan2(aim.x, aim.z), pitch = Math.atan2(aim.y, Math.hypot(aim.x, aim.z));
      const dy = Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
      const k = 1 - Math.exp(-dt * 4);
      this.yaw += dy * k;
      this.pitch += (clamp(pitch, -1, 1) - this.pitch) * k;
      s.roll += (clamp(-dy * 2, -1, 1) - s.roll) * (1 - Math.exp(-dt * 5));
    }
    s.object.position.copy(s.pos);
    s.object.rotation.set(-this.pitch, this.yaw, s.roll);
    s.animate(dt, t, clamp(s.speed / 200, 0.15, 1));

    // Guns.
    this.fireCd -= dt;
    if (!this.target || this.fireCd > 0) return;
    _v.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const dist = _aim.length();
    if (dist > FIRE_RANGE || _aim.dot(_v) / Math.max(dist, 1e-3) < FIRE_CONE) return;
    this.fire(_aim.normalize());
  }

  fire(dir) {
    const s = this.ship;
    s.gun = -(s.gun || 1);
    s.object.updateMatrixWorld();
    const from = s.object.localToWorld(_v.set(s.halfWidth * 0.5 * s.gun, 0, s.halfLength * 0.4));
    // A touch of spread so it doesn't one-shot everything for you.
    dir.x += (Math.random() - 0.5) * SPREAD;
    dir.y += (Math.random() - 0.5) * SPREAD;
    dir.normalize();
    this.lasers.fire(from, dir, s.speed, s, ESCORT_BOLT);
    this.particles.emit(from, 3, { color: ESCORT_BOLT, speed: 5, life: 0.12, gravity: 0 });
    this.shots = (this.shots ?? 0) + 1;
    this.fireCd = this.shots % 3 ? 0.14 : 1.3 + Math.random() * 0.8; // bursts of three
  }

  /** HUD summary. */
  hud(t) {
    if (this.active) return { state: this.state, left: Math.ceil(this.until - t), kills: this.kills, engaged: !!this.target };
    if (this.state === 'leaving' || t < this.readyAt) return { state: 'cooldown', left: Math.ceil(Math.max(this.readyAt - t, 0)) };
    return { state: 'ready' };
  }
}
