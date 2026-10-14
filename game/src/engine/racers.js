// A racer = one ship model + flight physics. The same physics drive the player and the AI;
// only the source of the controls differs.
import * as THREE from 'three';
import { courseX, groundHeight, clamp } from './world.js';
import { makeFlame } from './effects.js';
import { NITRO_DRAIN, NITRO_MULT } from './config.js';

const NITRO_COLOR = new THREE.Color(0x7b6bff);
const _box = new THREE.Box3();
const _size = new THREE.Vector3();

export class Racer {
  constructor(def, model) {
    this.def = def;
    this.object = new THREE.Group();
    this.object.rotation.order = 'YXZ'; // yaw, then pitch, then roll
    this.model = model;
    this.object.add(model);

    this.hull = null;
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.collision) {
        this.hull = o;
        o.visible = false;
      } else {
        o.castShadow = true;
      }
    });
    // Size comes from the convex hull baked in Blender (same bounds as the visible mesh).
    _box.setFromObject(this.hull ?? model, true).getSize(_size);
    this.halfWidth = _size.x / 2;
    this.halfHeight = _size.y / 2;
    this.halfLength = _size.z / 2;

    this.flameColor = new THREE.Color(def.flame);
    this.flames = def.engines.map(([x, y, z]) => {
      const f = makeFlame(def.flame);
      f.position.set(x, y, z);
      this.object.add(f);
      return f;
    });

    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.bob = Math.random() * 6;
    this.reset(0, 0, 0);
  }

  reset(x, y, z) {
    this.pos.set(x, y, z);
    this.prev.copy(this.pos);
    this.vx = this.vy = 0;
    this.speed = 0;
    this.burst = 0;
    this.nitro = 0.5;
    this.nitroActive = false;
    this.nitroGlow = 0;
    this.steer = 0;
    this.roll = 0;
    this.rubber = 1;
    this.aiBoost = false;
    this.ground = groundHeight(x, z);
    this.scraping = false;
    this.finished = false;
    this.finishTime = 0;
    this.ufos = 0;
    this.topSpeed = 0;
    this.pose(0, 0);
  }

  /** Forward speed including the decaying kick from boost rings. */
  get fwd() {
    return this.speed + this.burst;
  }

  step(dt, ctrl, race) {
    const st = this.def.stats;
    this.steer = ctrl.steer;
    this.prev.copy(this.pos);

    let target = race.baseSpeed * st.speed * this.rubber;
    const boosting = ctrl.nitro && this.nitro > 0.004 && race.running;
    this.nitroActive = boosting;
    if (boosting) {
      target *= NITRO_MULT;
      this.nitro = Math.max(0, this.nitro - (dt * NITRO_DRAIN) / st.nitro);
    }
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * (boosting ? 2.2 : 0.8) * st.accel));
    this.burst *= Math.exp(-dt * 0.8);
    const f = this.fwd;

    // Steering authority grows with speed so the canyon's bends stay followable at 700+ km/h.
    this.vx = (this.vx + ctrl.steer * (70 + f * 0.9) * st.handling * dt) * Math.exp(-dt * 2.4);
    this.vy = (this.vy + ctrl.climb * (60 + f * 0.45) * st.handling * dt) * Math.exp(-dt * 2.8);

    // Soft pull back into the canyon if you wander up the walls.
    const off = this.pos.x - courseX(this.pos.z);
    if (Math.abs(off) > 230) this.vx -= Math.sign(off) * (Math.abs(off) - 230) * 3 * dt;

    this.pos.x += this.vx * dt;
    this.pos.y += this.vy * dt;
    this.pos.z += f * dt;

    const { x, z } = this.pos;
    const hw = this.halfWidth * 0.6, hl = this.halfLength * 0.8;
    const g = Math.max(groundHeight(x, z), groundHeight(x, z + hl), groundHeight(x, z - hl), groundHeight(x + hw, z), groundHeight(x - hw, z));
    this.ground = g;
    const minY = g + this.halfHeight + 1.2;
    this.scraping = this.pos.y < minY;
    if (this.scraping) {
      this.pos.y = minY;
      if (this.vy < 0) this.vy *= -0.25;
      this.speed *= Math.exp(-dt * 0.9);
    }
    if (this.pos.y > g + 150) {
      this.pos.y = g + 150;
      this.vy = Math.min(this.vy, 0);
    }
    this.topSpeed = Math.max(this.topSpeed, f);
  }

  /** Visual pose: heading follows velocity, banks into turns, flames react to throttle and nitro. */
  pose(dt, t) {
    const f = Math.max(this.fwd, 0) + 30;
    const maxLat = 25 + f * 0.42;
    const targetRoll = clamp(-this.vx / maxLat, -1, 1) * 0.8 - this.steer * 0.22;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-dt * 6));
    this.object.position.copy(this.pos);
    this.object.rotation.set(-Math.atan2(this.vy, f), Math.atan2(this.vx, f), this.roll);
    this.animate(dt, t, clamp(this.speed / 200, 0.12, 1));
  }

  /** Hover bob, nitro glow and engine flames. `thrust` is 0..1. Shared with free flight. */
  animate(dt, t, thrust) {
    this.model.position.y = Math.sin(t * 2.3 + this.bob) * 0.18;
    this.nitroGlow += ((this.nitroActive ? 1 : 0) - this.nitroGlow) * (1 - Math.exp(-dt * 8));
    const kick = clamp(this.burst / 55, 0, 1);
    for (const fl of this.flames) {
      const { outer, inner, glow } = fl.userData;
      const flick = 0.85 + Math.random() * 0.3;
      const len = (1.4 + thrust * 3 + this.nitroGlow * 7 + kick * 4) * flick;
      const w = 0.8 + this.nitroGlow * 0.45 + kick * 0.2;
      outer.scale.set(w, w, len);
      inner.scale.set(w * 0.45, w * 0.45, len * 0.55);
      glow.scale.setScalar((2.2 + this.nitroGlow * 3 + kick * 2) * flick);
      outer.material.color.copy(this.flameColor).lerp(NITRO_COLOR, this.nitroGlow);
      glow.material.color.copy(outer.material.color);
    }
  }

  showHull(on) {
    if (!this.hull) return;
    this.hullMat ??= new THREE.MeshBasicMaterial({ color: 0x3dffd2, wireframe: true, transparent: true, opacity: 0.7, toneMapped: false });
    this.hull.material = this.hullMat;
    this.hull.visible = on;
  }
}

/** AI pilot: follows the canyon line, dodges spires, hunts boost rings and fires nitro in bursts. */
export function aiControl(r, race, course) {
  const f = Math.max(r.fwd, 20);
  const lookZ = r.pos.z + 30 + f * 0.7;
  let tx = courseX(lookZ) + r.lane + Math.sin(race.time * 0.23 + r.seed) * 26;
  let ringY = null;
  if (r.ringHunter) {
    const ring = course.rings.find((g) => g.z - r.pos.z > 25 && g.z - r.pos.z < 380 && !g.hit.has(r));
    if (ring) {
      tx = ring.x;
      ringY = ring.y;
    }
  }
  for (const sp of course.spires) {
    const dz = sp.z - r.pos.z;
    if (dz < -10 || dz > 40 + f * 1.3) continue;
    const clear = sp.r + r.halfWidth + 10;
    const side = dz < 120 ? Math.sign(r.pos.x - sp.x) || 1 : Math.sign(tx - sp.x) || 1;
    if (Math.abs(tx - sp.x) < clear || Math.sign(tx - sp.x) !== side) tx = sp.x + side * clear;
  }
  const slope = (courseX(lookZ + 10) - courseX(lookZ - 10)) / 20;
  const desiredVx = clamp((tx - r.pos.x) * 1.1 + slope * f, -160, 160);
  const steer = clamp((desiredVx - r.vx) * 0.06, -1, 1);

  // Altitude: clear the highest ground over the next few hundred metres, climbing early for ridges.
  let g = -Infinity, gNear = -Infinity;
  for (const d of [0, 20, 45, 80, 130, 190, 260]) {
    const ahead = (d * f) / 150;
    const h = groundHeight(r.pos.x + (r.vx * ahead) / f, r.pos.z + ahead);
    g = Math.max(g, h);
    if (d <= 45) gNear = Math.max(gNear, h);
  }
  const ty = ringY !== null ? Math.max(ringY, gNear + r.halfHeight + 3) : g + r.halfHeight + r.cruise;
  const desiredVy = clamp((ty - r.pos.y) * 1.8, -70, 90);
  const climb = clamp((desiredVy - r.vy) * 0.07, -1, 1);

  // AI can't collect UFOs, so their tank refills slowly on its own.
  r.nitro = Math.min(1, r.nitro + race.dt * 0.035);
  if (!r.aiBoost && r.nitro > 0.65 && Math.random() < race.dt * 0.5) r.aiBoost = true;
  if (r.aiBoost && r.nitro < 0.12) r.aiBoost = false;
  return { steer, climb, nitro: r.aiBoost };
}
