// Explore mode: free flight (see flight.js) over the endless, biome-varied world. It holds rare UFOs,
// boost rings, landmarks to discover (landmarks.js) and the odd mothership: peaceful ones are circled
// by collectible escorts, hostile (red) ones launch waves of attack drones (drones.js) that you must
// clear before you can destroy them. Everything comes from deterministic per-cell / per-region specs,
// so the world is the same every visit and the scanner can find things that haven't been built yet.
import * as THREE from 'three';
import { courseX, groundHeight, maxGround, rng, hash2 } from './world.js';
import { biomeWeights, dominant, BIOMES } from './biomes.js';
import { LandmarkKit, LANDMARK_NAMES, pickLandmarkType } from './landmarks.js';
import { Drones, hostileMaterials, DRONE_RADIUS } from './drones.js';
import { sweepCollect } from './ufos.js';
import { segmentSphere, BOLT_SPEED } from './lasers.js';
import { glowTexture } from './effects.js';
import { NITRO_PER_UFO, RING_BURST } from './config.js';

const CELL = 400, CELL_RADIUS = 4;   // small stuff: lone UFOs and boost rings
const UFO_CHANCE = 0.16;             // ≈ one stray UFO per km²
const RING_CHANCE = 0.25;
const LM_REGION = 1600, LM_CHANCE = 0.75, LM_SPAWN = 3600, LM_KEEP = 4200;  // landmarks
const MS_REGION = 4000, MS_CHANCE = 0.6, MS_SPAWN = 6000, MS_KEEP = 6800;   // motherships
const DISCOVER_RADIUS = 160;
const SCAN_COOLDOWN = 8, SCAN_SHOW = 15;
const RADAR_RANGE = 900;
const MAX_ALT = 1100;
const MOTHER_SCALE = 7;    // the UFO model is 10 m wide → 70 m motherships
const MOTHER_RADIUS = 30;  // laser-blocking sphere around the hull
const ESCORTS = 8, ESCORT_ORBIT = 95, ESCORT_SPIN = 0.3;

// Hostile motherships and combat.
const HOSTILE_CHANCE = 0.5;     // share of motherships that are hostile
const ALERT_RANGE = 1000;       // they launch drones when you come this close…
const DISENGAGE_RANGE = 2200;   // …and the fight resets if you get this far away
const WAVES = [4, 5, 6];        // drones per wave
const LAUNCH_EVERY = 0.45;      // seconds between drones leaving the hangar
const SHIELD_RADIUS = 48;       // the red bubble that blocks shots until every wave is down
const CORE_HP = 30;             // laser hits to destroy the core once the shield is down
const DRONE_DAMAGE = 6;         // per drone laser hit (shield first, then hull)
const SHIELD_REGEN = 25;        // per second, after…
const REGEN_DELAY = 3;          // …this long without being hit
const RESPAWN_DELAY = 2.5;
const ENEMY_BOLT = 0xff4d4d;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _bw = new Float32Array(4);

function fadingCone(rTop, rBottom) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, 1, 32, 1, true).translate(0, -0.5, 0);
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 1 + p.getY(i);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Call fn(i, j) for every region of `size` whose cell overlaps a circle of `radius` around p. */
function forRegions(p, size, radius, fn) {
  const i0 = Math.floor((p.x - radius) / size), i1 = Math.floor((p.x + radius) / size);
  const j0 = Math.floor((p.z - radius) / size), j1 = Math.floor((p.z + radius) / size);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i, j);
}

export class Explorer {
  constructor({ scene, flight, swarm, particles, lasers, sfx, toast, ufoTemplate, shipTemplates, shipNames }) {
    Object.assign(this, { scene, flight, swarm, particles, lasers, sfx, toast, ufoTemplate });
    this.kit = new LandmarkKit({ shipTemplates, shipNames });
    this.hostile = hostileMaterials();
    this.drones = new Drones(scene, ufoTemplate, this.hostile);
    this.playerVel = new THREE.Vector3();
    this.cells = new Map();
    this.landmarks = new Map();
    this.mothers = new Map();
    this.collected = new Set();
    this.waypoints = [];
    this.ground = (x, z, y) => this.surfaceAt(x, z, y);

    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false };
    this.ringGeo = new THREE.TorusGeometry(12, 0.9, 10, 48);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xff7a2f, toneMapped: false });
    this.discGeo = new THREE.CircleGeometry(11.2, 40);
    this.discMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d, opacity: 0.14, side: THREE.DoubleSide, ...additive });
    this.beamGeo = fadingCone(6, 42);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xb48cff, vertexColors: true, opacity: 0.12, side: THREE.DoubleSide, ...additive });
    // Fog-free glow: motherships read as beacons even when the hull is lost in the haze.
    this.glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb48cff, opacity: 0.55, ...additive });
    // Hostile variants: red beam, red glow, and a shield bubble that drops once all waves are cleared.
    this.redBeamMat = new THREE.MeshBasicMaterial({ color: 0xff4a3a, vertexColors: true, opacity: 0.14, side: THREE.DoubleSide, ...additive });
    this.redGlowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff3a3a, opacity: 0.6, ...additive });
    this.shieldGeo = new THREE.SphereGeometry(SHIELD_RADIUS, 32, 20);
    this.shieldMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, opacity: 0.1, side: THREE.DoubleSide, ...additive });
  }

  dispose() {
    this.clear();
    this.drones.dispose();
  }

  start(ship) {
    this.clear();
    this.collected.clear();
    this.ship = ship;
    this.found = 0;
    this.discovered = new Set();
    this.mothersFound = new Set();
    this.mothersCleared = new Set();
    this.waypoints = [];
    this.scanReadyAt = 0;
    this.time = 0;
    this.populateIn = 0;
    this.smokeAcc = 0;
    this.bumpAt = -9;
    this.mothersDestroyed = new Set();
    this.kills = 0;
    this.shield = 100;
    this.hull = 100;
    this.hurtAt = -9;
    this.disabledUntil = 0;
    const x = courseX(0); // the canyon start, where the race begins
    ship.reset(x, maxGround(x, 0, 10) + ship.halfHeight + 25, 0);
    this.flight.takeControl(ship, 60);
  }

  clear() {
    for (const key of [...this.cells.keys()]) this.removeCell(key);
    for (const id of [...this.landmarks.keys()]) this.removeLandmark(id);
    for (const id of [...this.mothers.keys()]) this.removeMother(id);
    this.drones.clear();
    this.drones.render(0);
  }

  get disabled() {
    return this.disabledUntil > 0;
  }

  update(dt, t, keys) {
    this.time += dt;
    this.t = t;
    if (this.disabled && t >= this.disabledUntil) this.respawn();
    if (!this.disabled) {
      this.flight.update(dt, t, keys, { cruise: 150 * this.ship.def.stats.speed, ceiling: () => MAX_ALT, ground: this.ground });
      this.playerVel.subVectors(this.ship.pos, this.ship.prev).divideScalar(Math.max(dt, 1e-3));
      if (t - this.hurtAt > REGEN_DELAY) this.shield = Math.min(100, this.shield + SHIELD_REGEN * dt);
    }
    this.populate(dt);
    this.animateWorld(t, dt);
    this.updateHostiles(dt, t);
    this.drones.update(dt, t, {
      player: this.ship, playerVel: this.playerVel, ground: this.ground, fire: (d) => this.droneFire(d),
    });
    if (!this.disabled) this.interact(t);
    this.swarm.draw(t, this.ufoLists());
    this.drones.render(t);
  }

  /** Terrain, or the top of a floating isle if you're above it. */
  surfaceAt(x, z, y) {
    let g = groundHeight(x, z);
    for (const lm of this.landmarks.values()) {
      for (const s of lm.surfaces) {
        if (y > s.top - 8 && (x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r) g = Math.max(g, s.top);
      }
    }
    return g;
  }

  // ---------- deterministic specs (no meshes) ----------

  cellSpec(i, j) {
    const r = rng(hash2(i * 7 + 3, j * 13 + 5) ^ 0x51ed27);
    const spec = { ufos: [], ring: null };
    if (r() < UFO_CHANCE) {
      spec.ufos.push({ id: `${i},${j}:0`, x: (i + r()) * CELL, z: (j + r()) * CELL, alt: 14 + r() * 50, phase: r() * 6.28 });
    }
    if (r() < RING_CHANCE) spec.ring = { x: (i + r()) * CELL, z: (j + r()) * CELL, yaw: r() * Math.PI * 2, alt: 30 + r() * 60 };
    return spec;
  }

  landmarkSpec(ri, rj) {
    const r = rng(hash2(ri * 31 + 7, rj * 17 + 3) ^ 0x1a2b3c);
    if (r() > LM_CHANCE) return null;
    const x = (ri + 0.15 + r() * 0.7) * LM_REGION, z = (rj + 0.15 + r() * 0.7) * LM_REGION;
    if (Math.hypot(x, z) < 900) return null; // keep the start area clear
    const biome = dominant(biomeWeights(x, z, _bw));
    return { id: `L${ri},${rj}`, type: pickLandmarkType(biome, r()), biome, x, z, yaw: r() * Math.PI * 2, seed: Math.floor(r() * 1e6) };
  }

  motherSpec(ri, rj) {
    const r = rng(hash2(ri * 13 + 5, rj * 29 + 11) ^ 0x5eed);
    if (r() > MS_CHANCE) return null;
    const x = (ri + 0.2 + r() * 0.6) * MS_REGION, z = (rj + 0.2 + r() * 0.6) * MS_REGION;
    if (Math.hypot(x, z) < 2500) return null;
    const phase = r() * 6.28;
    return { id: `M${ri},${rj}`, x, z, phase, hostile: r() < HOSTILE_CHANCE };
  }

  // ---------- streaming ----------

  populate(dt) {
    const p = this.ship.pos;
    const ci = Math.floor(p.x / CELL), cj = Math.floor(p.z / CELL);
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
    // Landmarks and motherships are big and sparse: check them a few times a second.
    this.populateIn -= dt;
    if (this.populateIn > 0) return;
    this.populateIn = 0.25;
    for (const [id, lm] of this.landmarks) if (Math.hypot(lm.x - p.x, lm.z - p.z) > LM_KEEP) this.removeLandmark(id);
    forRegions(p, LM_REGION, LM_SPAWN, (i, j) => {
      if (this.landmarks.has(`L${i},${j}`)) return;
      const spec = this.landmarkSpec(i, j);
      if (spec && Math.hypot(spec.x - p.x, spec.z - p.z) < LM_SPAWN) this.addLandmark(spec);
    });
    for (const [id, m] of this.mothers) if (Math.hypot(m.x - p.x, m.z - p.z) > MS_KEEP) this.removeMother(id);
    forRegions(p, MS_REGION, MS_SPAWN, (i, j) => {
      if (this.mothers.has(`M${i},${j}`)) return;
      const spec = this.motherSpec(i, j);
      if (spec && Math.hypot(spec.x - p.x, spec.z - p.z) < MS_SPAWN) this.addMother(spec);
    });
  }

  spawnCell(i, j) {
    const spec = this.cellSpec(i, j);
    const cell = { i, j, objects: [], ufos: [], rings: [] };
    for (const u of spec.ufos) {
      if (this.collected.has(u.id)) continue;
      cell.ufos.push({ id: u.id, x: u.x, y: maxGround(u.x, u.z, 10) + u.alt, z: u.z, g: groundHeight(u.x, u.z), phase: u.phase, taken: false });
    }
    if (spec.ring) {
      const { x, z, yaw, alt } = spec.ring;
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(this.ringGeo, this.ringMat), new THREE.Mesh(this.discGeo, this.discMat));
      mesh.position.set(x, maxGround(x, z, 16) + alt, z);
      mesh.rotation.y = yaw;
      this.scene.add(mesh);
      cell.objects.push(mesh);
      cell.rings.push({ pos: mesh.position, normal: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), radius: 12, minY: -Infinity, ready: 0 });
    }
    return cell;
  }

  removeCell(key) {
    for (const o of this.cells.get(key).objects) this.scene.remove(o);
    this.cells.delete(key);
  }

  addLandmark(spec) {
    const lm = this.kit.build(spec);
    lm.ufos = lm.ufos.filter((u) => !this.collected.has(u.id));
    for (const o of lm.objects) this.scene.add(o);
    this.landmarks.set(spec.id, lm);
  }

  removeLandmark(id) {
    const lm = this.landmarks.get(id);
    for (const o of lm.objects) this.scene.remove(o);
    for (const g of lm.geometries) g.dispose();
    this.landmarks.delete(id);
  }

  addMother(spec) {
    if (this.mothersDestroyed.has(spec.id)) return; // shot down earlier: stays gone
    const { x, z, hostile } = spec;
    const y = maxGround(x, z, 130) + 170;
    const hull = this.ufoTemplate.clone();
    if (hostile) {
      hull.traverse((o) => {
        if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(this.hostile) : this.hostile(o.material);
      });
    }
    hull.scale.setScalar(MOTHER_SCALE);
    hull.position.set(x, y, z);
    const beam = new THREE.Mesh(this.beamGeo, hostile ? this.redBeamMat : this.beamMat);
    beam.position.set(x, y - 10, z);
    beam.scale.set(1, Math.max(1, y - 10 - groundHeight(x, z)), 1);
    const glow = new THREE.Sprite(hostile ? this.redGlowMat : this.glowMat);
    glow.position.set(x, y, z);
    glow.scale.setScalar(260);
    const objects = [hull, beam, glow];
    let shield = null;
    if (hostile) {
      shield = new THREE.Mesh(this.shieldGeo, this.shieldMat);
      shield.position.set(x, y, z);
      objects.push(shield);
    }
    for (const o of objects) this.scene.add(o);
    const escorts = [];
    for (let k = 0; hostile ? false : k < ESCORTS; k++) {
      const uid = `${spec.id}:m${k}`;
      if (!this.collected.has(uid)) escorts.push({ id: uid, k, x, y, z, g: y, phase: k, taken: false, noBeam: true });
    }
    this.mothers.set(spec.id, {
      id: spec.id, x, y, z, center: new THREE.Vector3(x, y, z), hull, shield, objects, escorts, phase: spec.phase,
      hostile, state: 'idle', wave: 0, toLaunch: 0, launchAt: 0, coreHp: CORE_HP,
    });
  }

  removeMother(id) {
    const m = this.mothers.get(id);
    for (const o of m.objects) this.scene.remove(o);
    this.drones.clear(m);
    this.mothers.delete(id);
  }

  // ---------- per frame ----------

  animateWorld(t, dt) {
    // Shared shield material: a slow pulse, faster while a fight is on.
    this.shieldMat.opacity = 0.08 + 0.05 * Math.sin(t * 3);
    for (const m of this.mothers.values()) {
      // Hostile hulls spin up when they're fighting.
      m.spin = (m.spin ?? 0) + dt * (m.hostile && m.state !== 'idle' ? 0.7 : 0.08);
      m.hull.rotation.y = m.spin + m.phase;
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
    // Wrecks smoulder: a thin column of smoke when you're close enough to see it.
    this.smokeAcc += dt * 10;
    const puffs = Math.floor(this.smokeAcc);
    this.smokeAcc -= puffs;
    const p = this.ship.pos;
    for (const lm of this.landmarks.values()) {
      lm.update(t);
      if (lm.smoke && puffs && lm.smoke.distanceTo(p) < 1200) {
        this.particles.emit(lm.smoke, puffs, { color: 0x4a4440, speed: 2.5, life: 4, gravity: -0.12, vel: _v.set(1.5, 5, 0.5) });
      }
    }
    this.discMat.opacity = 0.1 + 0.07 * Math.sin(t * 6);
  }

  ufoLists() {
    const lists = [];
    for (const c of this.cells.values()) lists.push(c.ufos);
    for (const lm of this.landmarks.values()) lists.push(lm.ufos);
    for (const m of this.mothers.values()) lists.push(m.escorts);
    return lists;
  }

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

  /** Boost-ring style crossing test: did the ship pass through this hoop since last frame? */
  crossed(gate) {
    const s = this.ship;
    const a = _v.subVectors(s.prev, gate.pos ?? gate.center).dot(gate.normal);
    const b = _w.subVectors(s.pos, gate.pos ?? gate.center).dot(gate.normal);
    if (a > 0 === b > 0) return false;
    _v.lerpVectors(s.prev, s.pos, a / (a - b));
    return _v.y > gate.minY && _v.distanceTo(gate.pos ?? gate.center) < gate.radius + 1.5;
  }

  boost(at, text) {
    this.ship.burst += RING_BURST;
    this.flight.shake = Math.max(this.flight.shake, 0.35);
    this.particles.emit(at, 70, { color: 0xff8a3d, speed: 34, life: 0.9, gravity: 0 });
    this.sfx.boost();
    this.toast(text, 'boost');
  }

  interact(t) {
    const s = this.ship;
    for (const u of sweepCollect(this.ufoLists(), s.prev, s.pos, 9)) this.collectUfo(u, false);

    for (const c of this.cells.values()) {
      for (const ring of c.rings) {
        if (t < ring.ready || !this.crossed(ring)) continue;
        ring.ready = t + 4;
        this.boost(ring.pos, `BOOST +${Math.round(RING_BURST * 3.6)} km/h`);
      }
    }

    for (const lm of this.landmarks.values()) {
      const dist = Math.hypot(lm.x - s.pos.x, lm.z - s.pos.z);
      if (!this.discovered.has(lm.id) && dist < DISCOVER_RADIUS) {
        this.discovered.add(lm.id);
        s.nitro = Math.min(1, s.nitro + 0.25);
        this.sfx.pickup();
        this.toast(`Discovered: ${lm.name} · ${BIOMES[lm.biome].name}`, 'discover');
      }
      if (dist > 400) continue;
      for (const gate of lm.gates) {
        if (t < gate.ready || !this.crossed(gate)) continue;
        gate.ready = t + 5;
        this.boost(s.pos, 'Threaded the arch! Boost');
      }
      if (lm.orb && t > lm.orb.ready && lm.orb.pos.distanceTo(s.pos) < 11) {
        lm.orb.ready = t + 45;
        s.nitro = 1;
        this.sfx.finish();
        this.particles.emit(lm.orb.pos, 60, { color: 0xbff8ff, speed: 30, life: 1, gravity: 0 });
        this.toast('Monolith energy! Nitro full', 'discover');
      }
      for (const ob of lm.obstacles) this.collideObstacle(ob, t);
    }

    for (const m of this.mothers.values()) {
      if (m.hostile) continue; // hostile ones are handled by updateHostiles()
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

    // Scanner waypoints vanish when reached or after a while.
    this.waypoints = this.waypoints.filter((w) => t < w.until && w.pos.distanceTo(s.pos) > 150);
  }

  /** Solid landmark parts (slabs, arch feet, wrecks, isle bodies): push the ship out and slow it down. */
  collideObstacle(ob, t) {
    const s = this.ship;
    if (s.pos.y < ob.bottom || s.pos.y > ob.top) return;
    const dx = s.pos.x - ob.x, dz = s.pos.z - ob.z, d = Math.hypot(dx, dz);
    const rr = ob.r + s.halfWidth * 0.6;
    if (d >= rr) return;
    const k = (rr + 0.5) / Math.max(d, 1e-3);
    s.pos.x = ob.x + (d > 1e-3 ? dx : 1) * k;
    s.pos.z = ob.z + (d > 1e-3 ? dz : 0) * k;
    s.speed *= 0.6;
    s.burst = 0;
    this.flight.shake = Math.max(this.flight.shake, 0.9);
    if (t - this.bumpAt > 1) {
      this.bumpAt = t;
      this.sfx.crash();
      this.particles.emit(s.pos, 30, { color: 0xffb04a, speed: 18, life: 0.7 });
      this.toast('Bonk!', 'bad');
    }
  }

  /** A laser bolt moved from a to c this frame. `mine` = fired by the player, otherwise by a drone. */
  laserHit(b, a, c, mine) {
    if (!mine) {
      const s = this.ship;
      if (!this.disabled && segmentSphere(a, c, s.pos, Math.max(s.halfWidth * 0.7, 3.5))) {
        this.damage(DRONE_DAMAGE, c);
        return true;
      }
      return this.hitsLandmark(c);
    }
    for (const d of this.drones.list) {
      if (segmentSphere(a, c, d.pos, DRONE_RADIUS)) {
        this.hitDrone(d, c);
        return true;
      }
    }
    const got = sweepCollect(this.ufoLists(), a, c, 5);
    if (got.length) {
      for (const u of got) this.collectUfo(u, true);
      return true;
    }
    for (const m of this.mothers.values()) {
      const shielded = m.hostile && m.state !== 'exposed';
      if (!segmentSphere(a, c, m.center, shielded ? SHIELD_RADIUS : MOTHER_RADIUS)) continue;
      if (!m.hostile) {
        this.particles.emit(c, 14, { color: 0xc58bff, speed: 16, life: 0.5, gravity: 0 });
      } else if (shielded) {
        this.particles.emit(c, 12, { color: 0xff5a4a, speed: 14, life: 0.4, gravity: 0 }); // bounces off the bubble
      } else {
        m.coreHp--;
        this.particles.emit(c, 18, { color: 0xffa040, speed: 20, life: 0.6, gravity: 0 });
        this.sfx.hit();
        if (m.coreHp <= 0) this.destroyMother(m);
      }
      return true;
    }
    return this.hitsLandmark(c);
  }

  hitsLandmark(c) {
    for (const lm of this.landmarks.values()) {
      for (const ob of lm.obstacles) {
        if (c.y > ob.bottom && c.y < ob.top && Math.hypot(c.x - ob.x, c.z - ob.z) < ob.r) {
          this.particles.emit(c, 10, { color: 0xffc48a, speed: 12, life: 0.5 });
          return true;
        }
      }
    }
    return false;
  }

  // ---------- combat ----------

  /** Hostile motherships: idle → (you come close) → waves of drones → shield down → destroyed. */
  updateHostiles(dt, t) {
    const p = this.ship.pos;
    for (const m of this.mothers.values()) {
      if (!m.hostile) continue;
      const dist = Math.hypot(m.x - p.x, m.z - p.z);
      if (m.state === 'idle') {
        if (this.disabled || dist > ALERT_RANGE) continue;
        m.state = 'waves';
        m.wave = 0;
        this.queueWave(m, t);
        this.mothersFound.add(m.id);
        this.sfx.alarm();
        this.toast('Hostile mothership! Drones incoming', 'bad');
        continue;
      }
      if (dist > DISENGAGE_RANGE) {
        this.resetMother(m);
        this.toast('Mothership lost track of you', 'scan');
        continue;
      }
      if (m.state !== 'waves') continue;
      // Drones leave the hangar one at a time.
      if (m.toLaunch > 0 && t >= m.launchAt) {
        this.drones.spawn(_v.set(m.x + (Math.random() - 0.5) * 20, m.y - 18, m.z + (Math.random() - 0.5) * 20), m);
        m.toLaunch--;
        m.launchAt = t + LAUNCH_EVERY;
      }
      if (m.toLaunch > 0 || this.drones.list.some((d) => d.mother === m)) continue;
      // Wave cleared.
      if (m.wave + 1 < WAVES.length) {
        m.wave++;
        this.queueWave(m, t + 2.5);
        this.toast(`Wave ${m.wave + 1} of ${WAVES.length} incoming`, 'bad');
      } else {
        m.state = 'exposed';
        m.shield.visible = false;
        this.sfx.boost();
        this.toast('Shield down! Destroy the core', 'boost');
      }
    }
  }

  queueWave(m, at) {
    m.toLaunch = WAVES[m.wave];
    m.launchAt = at;
  }

  /** The fight resets: drones go home, the shield comes back up. */
  resetMother(m) {
    this.drones.clear(m);
    Object.assign(m, { state: 'idle', wave: 0, toLaunch: 0, coreHp: CORE_HP });
    m.shield.visible = true;
  }

  droneFire(d) {
    const s = this.ship;
    if (this.disabled) return;
    // Lead the player a little, with some spread so it's dodgeable.
    const dist = d.pos.distanceTo(s.pos);
    _w.copy(s.pos).addScaledVector(this.playerVel, dist / BOLT_SPEED);
    _w.x += (Math.random() - 0.5) * 5;
    _w.y += (Math.random() - 0.5) * 4;
    _w.z += (Math.random() - 0.5) * 5;
    _v.copy(d.pos);
    _v.y -= 1.5;
    this.lasers.fire(_v, _w.sub(_v).normalize(), d.vel.length() * 0.5, d, ENEMY_BOLT);
    this.particles.emit(_v, 3, { color: ENEMY_BOLT, speed: 5, life: 0.12, gravity: 0 });
    if (dist < 400) this.sfx.laser(false);
  }

  hitDrone(d, at) {
    d.hp--;
    this.particles.emit(at, 12, { color: 0xff7a4a, speed: 16, life: 0.4, gravity: 0 });
    if (d.hp > 0) return;
    this.drones.remove(d);
    this.kills++;
    this.ship.nitro = Math.min(1, this.ship.nitro + 0.05);
    this.particles.emit(d.pos, 40, { color: 0xff6a2a, speed: 26, life: 0.8, gravity: 0.3 });
    this.particles.emit(d.pos, 14, { color: 0xffffff, speed: 14, life: 0.4, gravity: 0 });
    this.sfx.bump();
  }

  destroyMother(m) {
    m.state = 'destroyed';
    this.mothersDestroyed.add(m.id);
    for (let k = 0; k < 8; k++) {
      _v.set(m.x + (Math.random() - 0.5) * 60, m.y + (Math.random() - 0.5) * 20, m.z + (Math.random() - 0.5) * 60);
      this.particles.emit(_v, 40, { color: k % 2 ? 0xff5a1a : 0xffc04a, speed: 45, life: 1.6, gravity: 0.4 });
    }
    this.particles.emit(m.center, 60, { color: 0xffffff, speed: 60, life: 0.8, gravity: 0 });
    this.removeMother(m.id);
    this.ship.nitro = 1;
    this.flight.shake = Math.max(this.flight.shake, 1.6);
    this.sfx.crash();
    this.sfx.finish();
    this.toast('Mothership destroyed! Nitro full', 'big');
  }

  damage(amount, at) {
    const t = this.t;
    this.hurtAt = t;
    const absorbed = Math.min(this.shield, amount);
    this.shield -= absorbed;
    this.hull = Math.max(0, this.hull - (amount - absorbed));
    this.flight.shake = Math.max(this.flight.shake, absorbed === amount ? 0.4 : 0.8);
    this.particles.emit(at, 10, { color: absorbed === amount ? 0x7fd8ff : 0xff6a3a, speed: 14, life: 0.4, gravity: 0 });
    this.sfx.hit();
    if (this.hull <= 0) this.disable();
  }

  /** Hull gone: explode, go dark for a moment, then respawn out of range. Discoveries and pickups are kept. */
  disable() {
    const s = this.ship;
    this.disabledUntil = this.t + RESPAWN_DELAY;
    s.object.visible = false;
    s.speed = s.burst = 0;
    s.nitroActive = false;
    this.particles.emit(s.pos, 70, { color: 0xff6a2a, speed: 34, life: 1.2, gravity: 0.3 });
    this.particles.emit(s.pos, 30, { color: 0xffffff, speed: 20, life: 0.6, gravity: 0 });
    this.flight.shake = 1.8;
    this.sfx.crash();
    this.toast('Ship disabled! Respawning…', 'bad');
    for (const m of this.mothers.values()) if (m.hostile && m.state !== 'destroyed' && m.state !== 'idle') this.resetMother(m);
    this.drones.clear();
  }

  respawn() {
    const s = this.ship;
    // Back off 1.5 km from the nearest hostile mothership (or stay put if there isn't one), facing it.
    let near = null, nearD = Infinity;
    for (const m of this.mothers.values()) {
      const d = Math.hypot(m.x - s.pos.x, m.z - s.pos.z);
      if (m.hostile && d < nearD) [near, nearD] = [m, d];
    }
    let x = s.pos.x, z = s.pos.z;
    if (near) {
      const dx = s.pos.x - near.x, dz = s.pos.z - near.z, len = Math.hypot(dx, dz) || 1;
      x = near.x + (dx / len) * 1500;
      z = near.z + (dz / len) * 1500;
    }
    s.reset(x, maxGround(x, z, 20) + s.halfHeight + 60, z);
    s.nitro = Math.max(s.nitro, 0.5);
    s.object.visible = true;
    this.flight.takeControl(s, 40);
    if (near) {
      const yaw = Math.atan2(near.x - x, near.z - z);
      Object.assign(this.flight, { yaw, aimYaw: yaw, camYaw: yaw });
    }
    this.shield = this.hull = 100;
    this.disabledUntil = 0;
    this.toast('Back in action', 'scan');
  }

  /** The fight you're in (nearest engaged hostile mothership), for the HUD. */
  threat() {
    const p = this.ship.pos;
    let best = null, bestD = Infinity;
    for (const m of this.mothers.values()) {
      if (!m.hostile || m.state === 'idle') continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d < bestD) [best, bestD] = [m, d];
    }
    if (!best) return null;
    return {
      exposed: best.state === 'exposed',
      wave: best.wave + 1,
      waves: WAVES.length,
      drones: best.toLaunch + this.drones.list.filter((d) => d.mother === best).length,
      core: best.coreHp / CORE_HP,
    };
  }

  // ---------- scanner ----------

  /** Ping the nearest UFO, undiscovered landmark and uncleared mothership. Returns how many it found, or null while recharging. */
  scan(t) {
    if (t < this.scanReadyAt) return null;
    this.scanReadyAt = t + SCAN_COOLDOWN;
    const p = this.ship.pos;
    const marks = [];
    const near = (x, z) => Math.hypot(x - p.x, z - p.z);

    // UFOs: stray ones from the cell specs (even ones not spawned yet), plus those already loaded.
    let ufo = null, ufoD = 4000;
    const cr = Math.ceil(4000 / CELL), ci = Math.floor(p.x / CELL), cj = Math.floor(p.z / CELL);
    for (let dj = -cr; dj <= cr; dj++) {
      for (let di = -cr; di <= cr; di++) {
        for (const u of this.cellSpec(ci + di, cj + dj).ufos) {
          const d = near(u.x, u.z);
          if (d < ufoD && !this.collected.has(u.id)) [ufo, ufoD] = [{ x: u.x, z: u.z, y: null, alt: u.alt }, d];
        }
      }
    }
    for (const list of this.ufoLists()) {
      for (const u of list) {
        const d = near(u.x, u.z);
        if (!u.taken && d < ufoD) [ufo, ufoD] = [{ x: u.x, z: u.z, y: u.y }, d];
      }
    }
    if (ufo) {
      const y = ufo.y ?? maxGround(ufo.x, ufo.z, 10) + ufo.alt;
      marks.push({ kind: 'u', label: 'UFO', pos: new THREE.Vector3(ufo.x, y, ufo.z) });
    }

    let lm = null, lmD = 9000;
    forRegions(p, LM_REGION, 9000, (i, j) => {
      const spec = this.landmarkSpec(i, j);
      if (!spec || this.discovered.has(spec.id)) return;
      const d = near(spec.x, spec.z);
      if (d < lmD) [lm, lmD] = [spec, d];
    });
    if (lm) marks.push({ kind: 'l', label: LANDMARK_NAMES[lm.type], pos: new THREE.Vector3(lm.x, groundHeight(lm.x, lm.z) + 30, lm.z) });

    let ms = null, msD = 16000;
    forRegions(p, MS_REGION, 16000, (i, j) => {
      const spec = this.motherSpec(i, j);
      if (!spec || this.mothersCleared.has(spec.id) || this.mothersDestroyed.has(spec.id)) return;
      const d = near(spec.x, spec.z);
      if (d < msD) [ms, msD] = [spec, d];
    });
    if (ms) {
      marks.push({
        kind: ms.hostile ? 'h' : 'm',
        label: ms.hostile ? 'Hostile mothership' : 'Mothership',
        pos: new THREE.Vector3(ms.x, maxGround(ms.x, ms.z, 130) + 170, ms.z),
      });
    }

    this.waypoints = marks.map((m) => ({ ...m, until: t + SCAN_SHOW }));
    return marks.length;
  }

  scanCooldown(t) {
    return Math.max(0, this.scanReadyAt - t);
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
    for (const list of this.ufoLists()) for (const u of list) if (!u.taken) plot(u.x, u.z, 'u');
    for (const c of this.cells.values()) for (const ring of c.rings) plot(ring.pos.x, ring.pos.z, 'r');
    for (const lm of this.landmarks.values()) plot(lm.x, lm.z, this.discovered.has(lm.id) ? 'd' : 'l', 2500);
    for (const m of this.mothers.values()) plot(m.x, m.z, m.hostile ? 'h' : this.mothersCleared.has(m.id) ? 'c' : 'm', MS_SPAWN);
    for (const d of this.drones.list) plot(d.pos.x, d.pos.z, 'e');
    return out;
  }
}
