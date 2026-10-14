// Explore mode: free flight (see flight.js) over the endless terrain, which is sprinkled with UFOs,
// boost rings and the odd mothership guarded by a ring of UFO escorts.
import * as THREE from 'three';
import { courseX, groundHeight, maxGround, rng, hash2 } from './world.js';
import { sweepCollect } from './ufos.js';
import { segmentSphere } from './lasers.js';
import { glowTexture } from './effects.js';
import { NITRO_PER_UFO, RING_BURST } from './config.js';

const CELL = 400;          // the world is populated in 400 m cells…
const CELL_RADIUS = 4;     // …kept in a circle around the ship
const RADAR_RANGE = 900;
const MAX_ALT = 1100;
const MOTHER_SCALE = 7;    // the UFO model is 10 m wide → 70 m motherships
const MOTHER_RADIUS = 30;  // laser-blocking sphere around the hull
const ESCORTS = 8;
const ESCORT_ORBIT = 95;
const ESCORT_SPIN = 0.3;   // rad/s around the mothership

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function fadingCone(rTop, rBottom) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, 1, 32, 1, true).translate(0, -0.5, 0);
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 1 + p.getY(i);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export class Explorer {
  constructor({ scene, flight, swarm, particles, sfx, toast, ufoTemplate }) {
    Object.assign(this, { scene, flight, swarm, particles, sfx, toast, ufoTemplate });
    this.cells = new Map();
    this.collected = new Set();

    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false };
    this.ringGeo = new THREE.TorusGeometry(12, 0.9, 10, 48);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xff7a2f, toneMapped: false });
    this.discGeo = new THREE.CircleGeometry(11.2, 40);
    this.discMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d, opacity: 0.14, side: THREE.DoubleSide, ...additive });
    this.beamGeo = fadingCone(6, 42);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xb48cff, vertexColors: true, opacity: 0.12, side: THREE.DoubleSide, ...additive });
    // Fog-free glow: motherships read as beacons even when the hull is lost in the haze.
    this.glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb48cff, opacity: 0.55, ...additive });
  }

  start(ship) {
    this.clear();
    this.collected.clear();
    this.ship = ship;
    this.found = 0;
    this.mothersFound = new Set();
    this.mothersCleared = new Set();
    this.time = 0;
    const x = courseX(0);
    ship.reset(x, maxGround(x, 0, 10) + ship.halfHeight + 25, 0);
    this.flight.takeControl(ship, 60);
  }

  clear() {
    for (const key of [...this.cells.keys()]) this.removeCell(key);
  }

  update(dt, t, keys) {
    this.time += dt;
    this.flight.update(dt, t, keys, { cruise: 150 * this.ship.def.stats.speed, ceiling: () => MAX_ALT });
    this.populate();
    this.animateWorld(t);
    this.interact(t);
    this.swarm.draw(t, this.ufoLists());
  }

  // ---------- world population ----------

  populate() {
    const ci = Math.floor(this.ship.pos.x / CELL), cj = Math.floor(this.ship.pos.z / CELL);
    for (const [key, c] of this.cells) {
      if ((c.i - ci) ** 2 + (c.j - cj) ** 2 > (CELL_RADIUS + 1) ** 2) this.removeCell(key);
    }
    for (let dj = -CELL_RADIUS; dj <= CELL_RADIUS; dj++) {
      for (let di = -CELL_RADIUS; di <= CELL_RADIUS; di++) {
        if (di * di + dj * dj > CELL_RADIUS * CELL_RADIUS) continue;
        const key = `${ci + di},${cj + dj}`;
        if (!this.cells.has(key)) this.cells.set(key, this.spawnCell(ci + di, cj + dj));
      }
    }
  }

  spawnCell(i, j) {
    const r = rng(hash2(i * 7 + 3, j * 13 + 5) ^ 0x51ed27);
    const x0 = i * CELL, z0 = j * CELL;
    const cell = { i, j, objects: [], ufos: [], rings: [], mother: null };
    const add = (o) => {
      this.scene.add(o);
      cell.objects.push(o);
      return o;
    };

    // Scattered UFOs. Ids are stable, so collected ones stay gone when you fly back.
    const n = Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const x = x0 + r() * CELL, z = z0 + r() * CELL, alt = 14 + r() * 50, phase = r() * 6.28;
      const id = `${i},${j}:${k}`;
      if (this.collected.has(id)) continue;
      cell.ufos.push({ id, x, y: maxGround(x, z, 10) + alt, z, g: groundHeight(x, z), phase, taken: false });
    }

    // A boost ring floating at a random heading.
    if (r() < 0.3) {
      const x = x0 + r() * CELL, z = z0 + r() * CELL, yaw = r() * Math.PI * 2, alt = 30 + r() * 60;
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(this.ringGeo, this.ringMat), new THREE.Mesh(this.discGeo, this.discMat));
      mesh.position.set(x, maxGround(x, z, 16) + alt, z);
      mesh.rotation.y = yaw;
      add(mesh);
      cell.rings.push({ pos: mesh.position, normal: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), radius: 12, ready: 0 });
    }

    // Now and then a mothership, circled by escorts. Never right on top of the start.
    if (r() < 0.08 && i * i + j * j > 2) {
      const x = x0 + CELL / 2, z = z0 + CELL / 2, phase = r() * 6.28;
      const y = maxGround(x, z, 130) + 170;
      const hull = add(this.ufoTemplate.clone());
      hull.scale.setScalar(MOTHER_SCALE);
      hull.position.set(x, y, z);
      const beam = add(new THREE.Mesh(this.beamGeo, this.beamMat));
      beam.position.set(x, y - 10, z);
      beam.scale.set(1, Math.max(1, y - 10 - groundHeight(x, z)), 1);
      const glow = add(new THREE.Sprite(this.glowMat));
      glow.position.set(x, y, z);
      glow.scale.setScalar(260);
      const id = `${i},${j}`;
      const escorts = [];
      for (let k = 0; k < ESCORTS; k++) {
        const uid = `${id}:m${k}`;
        if (!this.collected.has(uid)) escorts.push({ id: uid, k, x, y, z, g: y, phase: k, taken: false, noBeam: true });
      }
      cell.mother = { id, x, y, z, center: new THREE.Vector3(x, y, z), hull, escorts, phase };
    }
    return cell;
  }

  removeCell(key) {
    for (const o of this.cells.get(key).objects) this.scene.remove(o);
    this.cells.delete(key);
  }

  animateWorld(t) {
    for (const c of this.cells.values()) {
      const m = c.mother;
      if (!m) continue;
      m.hull.rotation.y = t * 0.08 + m.phase;
      for (const u of m.escorts) {
        const a = t * ESCORT_SPIN + (u.k / ESCORTS) * Math.PI * 2 + m.phase;
        u.x = m.x + Math.cos(a) * ESCORT_ORBIT;
        u.z = m.z + Math.sin(a) * ESCORT_ORBIT;
        u.y = m.y - 35 + Math.sin(t * 1.3 + u.k) * 6;
        // Velocity, so the laser aim assist can lead these moving targets.
        u.vx = -Math.sin(a) * ESCORT_ORBIT * ESCORT_SPIN;
        u.vz = Math.cos(a) * ESCORT_ORBIT * ESCORT_SPIN;
        u.vy = Math.cos(t * 1.3 + u.k) * 6 * 1.3;
      }
    }
    this.discMat.opacity = 0.1 + 0.07 * Math.sin(t * 6);
  }

  ufoLists() {
    const lists = [];
    for (const c of this.cells.values()) {
      lists.push(c.ufos);
      if (c.mother) lists.push(c.mother.escorts);
    }
    return lists;
  }

  // ---------- interaction ----------

  collectUfo(u, zapped) {
    const s = this.ship;
    this.collected.add(u.id);
    this.found++;
    s.nitro = Math.min(1, s.nitro + NITRO_PER_UFO);
    this.particles.emit(u, 40, { color: 0x6fd6ff, speed: 24, life: 0.9, gravity: 0 });
    this.particles.emit(u, 16, { color: 0xffffff, speed: 12, life: 0.6, gravity: 0 });
    this.sfx.pickup();
    this.toast(`${zapped ? 'Zapped!' : '+1 UFO'} · ${this.found} found`, 'ufo');
  }

  interact(t) {
    const s = this.ship;
    for (const u of sweepCollect(this.ufoLists(), s.prev, s.pos, 9)) this.collectUfo(u, false);
    for (const c of this.cells.values()) {
      for (const ring of c.rings) {
        if (t < ring.ready) continue;
        const a = _v.subVectors(s.prev, ring.pos).dot(ring.normal);
        const b = _w.subVectors(s.pos, ring.pos).dot(ring.normal);
        if (a > 0 === b > 0) continue;
        // Where we crossed the ring's plane — inside the hoop?
        if (_v.lerpVectors(s.prev, s.pos, a / (a - b)).distanceTo(ring.pos) > ring.radius + 1.5) continue;
        ring.ready = t + 4;
        s.burst += RING_BURST;
        this.flight.shake = Math.max(this.flight.shake, 0.35);
        this.particles.emit(ring.pos, 70, { color: 0xff8a3d, speed: 34, life: 0.9, gravity: 0 });
        this.sfx.boost();
        this.toast(`BOOST +${Math.round(RING_BURST * 3.6)} km/h`, 'boost');
      }
      const m = c.mother;
      if (!m) continue;
      if (!this.mothersFound.has(m.id) && Math.hypot(m.x - s.pos.x, m.z - s.pos.z) < 500) {
        this.mothersFound.add(m.id);
        this.toast(`Mothership found! Grab its ${ESCORTS} escorts`, 'mother');
      }
      if (!this.mothersCleared.has(m.id) && m.escorts.every((u) => u.taken)) {
        this.mothersCleared.add(m.id);
        s.nitro = 1;
        this.sfx.finish();
        this.toast('Mothership cleared! Nitro full', 'big');
      }
    }
  }

  /** A player laser moved from a to c this frame: zap UFOs, splash off mothership hulls. */
  laserHit(a, c) {
    const got = sweepCollect(this.ufoLists(), a, c, 5);
    if (got.length) {
      for (const u of got) this.collectUfo(u, true);
      return true;
    }
    for (const cell of this.cells.values()) {
      const m = cell.mother;
      if (m && segmentSphere(a, c, m.center, MOTHER_RADIUS)) {
        this.particles.emit(c, 14, { color: 0xc58bff, speed: 16, life: 0.5, gravity: 0 });
        return true;
      }
    }
    return false;
  }

  /** Radar blips in ship space: [right, forward, kind, clampedToEdge], ±1 = radar range. */
  radar() {
    const s = this.ship, yaw = this.flight.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw);
    const out = [];
    const plot = (x, z, kind, range = RADAR_RANGE) => {
      const dx = x - s.pos.x, dz = z - s.pos.z;
      let u = (dz * fx - dx * fz) / RADAR_RANGE;
      let v = (dx * fx + dz * fz) / RADAR_RANGE;
      const len = Math.hypot(u, v);
      if (len * RADAR_RANGE > range) return;
      if (len > 1) {
        u /= len;
        v /= len;
      }
      out.push([Math.round(u * 1000) / 1000, Math.round(v * 1000) / 1000, kind, len > 1]);
    };
    for (const c of this.cells.values()) {
      for (const u of c.ufos) if (!u.taken) plot(u.x, u.z, 'u');
      for (const ring of c.rings) plot(ring.pos.x, ring.pos.z, 'r');
      if (c.mother) {
        for (const u of c.mother.escorts) if (!u.taken) plot(u.x, u.z, 'u');
        plot(c.mother.x, c.mother.z, this.mothersCleared.has(c.mother.id) ? 'c' : 'm', 2500);
      }
    }
    return out;
  }
}
