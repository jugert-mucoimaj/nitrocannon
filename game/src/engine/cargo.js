// Cargo runs (Explore): outposts with landing pads and job boards; crates you hook on a cable and fly,
// swinging, to another outpost; credits for delivering them in one piece.
// Outposts come from deterministic per-region specs (like landmarks), plus two fixed ones up the canyon
// from the start, so there's always a short first run.
import * as THREE from 'three';
import { courseX, groundHeight, sampleTerrain, newSample, rng, hash2 } from './world.js';
import { biomeWeights, dominant, BIOMES } from './biomes.js';
import { glowTexture } from './effects.js';

const REGION = 2000, CHANCE = 0.75, SPAWN = 3800, KEEP = 4500;
const PAD_R = 16;               // landing pad radius (m)
const CABLE = 14;               // cable length (m)
const HOOK_RANGE = 12;          // how close (horizontally) you must be above a crate to hook it
const DEST_MIN = 1200, DEST_MAX = 7000;
const BOARD_RANGE = 160;        // job board opens when you're this close to a pad
const RAID_MIN_DIST = 2500, RAID_CHANCE = 0.65; // long hauls may get ambushed part-way
const BOLT_DAMAGE = 6;          // per drone laser hit on the crate
const AIR_DRAG = 0.08;          // how much the crate trails behind at speed
const SWING_DAMP = 1.2;         // calms the pendulum (relative to the ship) without adding drag
const SAFE_FALL = 10, SAFE_SLIDE = 25; // m/s the crate can hit the ground / scrape along it unharmed
const TUG_DECAY = 1.5, TUG_MAX = 25;
const CREDITS_KEY = 'nitro-canyon.credits';

// Cargo by the biome it comes from (red, frost, volcanic, crystal).
export const CARGO_TYPES = [
  { name: 'Supplies', mass: 1.0, fragile: 0.3, color: 0xd9a23a, size: [3, 2.4, 3] },
  { name: 'Ice cores', mass: 1.2, fragile: 0.7, color: 0x9fdcff, size: [3, 2.4, 3] },
  { name: 'Ore', mass: 1.8, fragile: 0.1, color: 0x8a5a3a, size: [5.5, 2.6, 2.6] },
  { name: 'Crystal shards', mass: 0.8, fragile: 1.2, color: 0xd08bff, size: [2.6, 2.6, 2.6] },
];

const NAMES = [
  'Kappa', 'Vega', 'Orin', 'Talos', 'Nova', 'Juno', 'Hadar', 'Rigel', 'Lyra', 'Echo', 'Atlas', 'Cygnus', 'Draco', 'Halcyon',
  'Mira', 'Pyxis', 'Kepler', 'Sirius', 'Altair', 'Deneb', 'Castor', 'Antares', 'Hydra', 'Corvus', 'Fornax', 'Tycho',
];
const KINDS = ['Station', 'Depot', 'Outpost', 'Relay', 'Yard', 'Post'];
const BUILDINGS = ['outpost_a', 'outpost_b', 'outpost_hut'];
// The fixed outposts: [id, name, distance up the canyon, side of the centre line, building].
const FIXED = [
  ['home', 'Canyon Depot', 520, 1, 'outpost_b'],
  ['ridge', 'Ridge Post', 2500, -1, 'outpost_a'],
];

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _bw = new Float32Array(4), _sample = newSample();
const PAD_PROBE = [[0, 0], [PAD_R, 0], [-PAD_R, 0], [0, PAD_R], [0, -PAD_R]];

/** Of `n` candidate spots from pick(k) → [x, z], the one where a pad would sit most level (never on lava). */
function flattest(pick, n) {
  let best = null, bestSlope = Infinity;
  for (let k = 0; k < n; k++) {
    const [x, z] = pick(k);
    let lo = Infinity, hi = -Infinity, lava = 0;
    for (const [dx, dz] of PAD_PROBE) {
      sampleTerrain(x + dx * 1.5, z + dz * 1.5, _sample);
      lo = Math.min(lo, _sample.h);
      hi = Math.max(hi, _sample.h);
      lava = Math.max(lava, _sample.lava);
    }
    const slope = lava > 0 ? Infinity : hi - lo;
    if (slope < bestSlope || !best) [best, bestSlope] = [{ x, z }, slope];
  }
  return { best, bestSlope };
}

function loadCredits() {
  try {
    return Number(localStorage.getItem(CREDITS_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveCredits(n) {
  try {
    localStorage.setItem(CREDITS_KEY, String(n));
  } catch {
    // storage blocked (private window etc.): credits just won't persist
  }
}

/** Light pillar shooting up from a pad, so outposts can be spotted from far away. */
function beaconGeometry() {
  const g = new THREE.CylinderGeometry(1.5, 5, 1, 16, 1, true).translate(0, 0.5, 0);
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 1 - p.getY(i);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function padMarkingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = '#ffd24a';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#ffd24a';
  for (let k = 0; k < 4; k++) {
    // four chevrons pointing in
    g.save();
    g.translate(128, 128);
    g.rotate((k * Math.PI) / 2);
    g.beginPath();
    g.moveTo(-26, -92);
    g.lineTo(0, -66);
    g.lineTo(26, -92);
    g.lineTo(26, -78);
    g.lineTo(0, -52);
    g.lineTo(-26, -78);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.fillRect(84, 112, 88, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Cargo {
  /** raid(at): called when raiders should ambush a cargo run, at the crate's position. */
  constructor({ scene, props, particles, sfx, toast, raid }) {
    Object.assign(this, { scene, props, particles, sfx, toast, raid });
    this.outposts = new Map();
    this.credits = loadCredits();
    this.job = null;
    this.epoch = 0;
    this.populateIn = 0;
    this.tug = new THREE.Vector3();
    this.destMark = new THREE.Vector3();
    this.propSize = {};
    for (const [name, gltf] of Object.entries(props)) {
      gltf.scene.traverse((o) => {
        if (o.userData.collision) o.visible = false;
      });
      this.propSize[name] = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    }
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false };
    this.padGeo = new THREE.CylinderGeometry(PAD_R, PAD_R + 1.5, 4, 8).translate(0, -2, 0);
    this.baseGeo = new THREE.CylinderGeometry(PAD_R * 0.75, PAD_R * 0.95, 40, 8).translate(0, -24, 0);
    this.padMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.6, roughness: 0.5, flatShading: true });
    this.markGeo = new THREE.CircleGeometry(PAD_R * 0.82, 32).rotateX(-Math.PI / 2);
    this.markMat = new THREE.MeshBasicMaterial({ map: padMarkingTexture(), transparent: true, toneMapped: false });
    this.lightGeo = new THREE.BoxGeometry(0.8, 0.5, 0.8);
    this.lightMat = new THREE.MeshBasicMaterial({ color: 0x5ff2ff, toneMapped: false });
    this.beaconGeo = beaconGeometry();
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0x5ff2ff, vertexColors: true, opacity: 0.22, side: THREE.DoubleSide, ...additive });
    this.destBeaconMat = new THREE.MeshBasicMaterial({ color: 0xffc040, vertexColors: true, opacity: 0.45, side: THREE.DoubleSide, ...additive });
    this.crateMats = CARGO_TYPES.map((t) => new THREE.MeshStandardMaterial({ color: t.color, metalness: 0.35, roughness: 0.55, flatShading: true }));
    this.bandMats = CARGO_TYPES.map((t) => new THREE.MeshBasicMaterial({ color: new THREE.Color(t.color).multiplyScalar(1.6), toneMapped: false }));
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.cable = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 1, 6).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ color: 0x3a4250 }),
    );
    this.cable.visible = false;
    this.cable.frustumCulled = false;
    scene.add(this.cable);
    this.glowSprite = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd24a, opacity: 0.6, ...additive });
  }

  dispose() {
    this.clear();
    this.scene.remove(this.cable);
  }

  clear() {
    for (const id of [...this.outposts.keys()]) this.removeOutpost(id);
    this.dropJob();
  }

  start() {
    this.clear();
    this.epoch++;
  }

  // ---------- outposts ----------

  fixedSpecs() {
    // On the canyon floor: the flattest of a few spots beside the centre line.
    this.fixed ??= FIXED.map(([id, name, z0, side, building], n) => {
      const { best } = flattest((k) => [courseX(z0 + k * 40) + side * (40 + (k % 3) * 25), z0 + k * 40], 8);
      const biome = dominant(biomeWeights(best.x, best.z, _bw));
      return { id, name, ...best, yaw: 0.4 + n * 2, biome, building, antenna: true, seed: 7 + n };
    });
    return this.fixed;
  }

  spec(ri, rj) {
    const r = rng(hash2(ri * 41 + 9, rj * 23 + 1) ^ 0xca460);
    if (r() > CHANCE) return null;
    // Try a few spots in the region and keep the flattest one for the pad.
    const { best, bestSlope } = flattest(() => [(ri + 0.15 + r() * 0.7) * REGION, (rj + 0.15 + r() * 0.7) * REGION], 6);
    const name = `${NAMES[Math.floor(r() * NAMES.length)]} ${KINDS[Math.floor(r() * KINDS.length)]}`;
    const yaw = r() * Math.PI * 2, building = BUILDINGS[Math.floor(r() * BUILDINGS.length)], antenna = r() < 0.6, seed = Math.floor(r() * 1e6);
    if (bestSlope > 16 || this.fixedSpecs().some((f) => Math.hypot(best.x - f.x, best.z - f.z) < 1200)) return null; // too steep, or crowding
    const biome = dominant(biomeWeights(best.x, best.z, _bw));
    return { id: `O${ri},${rj}`, name, x: best.x, z: best.z, yaw, biome, building, antenna, seed };
  }

  /** Every outpost spec within `radius` of a point (built or not). */
  specsAround(p, radius) {
    const out = this.fixedSpecs().filter((f) => Math.hypot(f.x - p.x, f.z - p.z) < radius);
    const i0 = Math.floor((p.x - radius) / REGION), i1 = Math.floor((p.x + radius) / REGION);
    const j0 = Math.floor((p.z - radius) / REGION), j1 = Math.floor((p.z + radius) / REGION);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const s = this.spec(i, j);
        if (s && Math.hypot(s.x - p.x, s.z - p.z) < radius) out.push(s);
      }
    }
    return out;
  }

  populate(p, dt) {
    this.populateIn -= dt;
    if (this.populateIn > 0) return;
    this.populateIn = 0.3;
    for (const [id, o] of this.outposts) if (Math.hypot(o.x - p.x, o.z - p.z) > KEEP && this.job?.to.id !== id) this.removeOutpost(id);
    for (const s of this.specsAround(p, SPAWN)) if (!this.outposts.has(s.id)) this.addOutpost(s);
    // The destination always gets built, however far away, so its beacon shows the way.
    if (this.job && !this.outposts.has(this.job.to.id)) this.addOutpost(this.job.to);
  }

  addOutpost(spec) {
    const r = rng(spec.seed);
    const objects = [], obstacles = [];
    const add = (o) => {
      this.scene.add(o);
      objects.push(o);
      return o;
    };
    const { x, z, yaw } = spec;
    let top = -Infinity;
    for (const [dx, dz] of [[0, 0], [PAD_R, 0], [-PAD_R, 0], [0, PAD_R], [0, -PAD_R]]) top = Math.max(top, groundHeight(x + dx, z + dz));
    top += 0.8;
    const pad = add(new THREE.Mesh(this.padGeo, this.padMat));
    pad.position.set(x, top, z);
    pad.rotation.y = yaw;
    pad.receiveShadow = true;
    const base = add(new THREE.Mesh(this.baseGeo, this.padMat)); // so a pad on a slope doesn't float
    base.position.copy(pad.position);
    base.rotation.y = yaw;
    const mark = add(new THREE.Mesh(this.markGeo, this.markMat));
    mark.position.set(x, top + 0.06, z);
    mark.rotation.y = yaw;
    const lights = add(new THREE.InstancedMesh(this.lightGeo, this.lightMat, 16));
    const m = new THREE.Matrix4();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + yaw;
      lights.setMatrixAt(k, m.makeTranslation(x + Math.cos(a) * (PAD_R - 0.6), top + 0.25, z + Math.sin(a) * (PAD_R - 0.6)));
    }
    const beacon = add(new THREE.Mesh(this.beaconGeo, this.beaconMat));
    beacon.position.set(x, top, z);
    beacon.scale.set(1, 240, 1);

    // Buildings around the pad, each standing on its own patch of ground.
    const place = (name, dist, angle) => {
      const size = this.propSize[name];
      const a = yaw + angle, d = PAD_R + 6 + Math.max(size.x, size.z) / 2 + dist;
      const bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d;
      const g = Math.min(groundHeight(bx, bz), groundHeight(bx + size.x / 3, bz), groundHeight(bx - size.x / 3, bz));
      const obj = add(this.props[name].scene.clone(true));
      obj.position.set(bx, g - 0.5, bz);
      obj.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)); // front (+Z) faces the pad
      obj.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      obstacles.push({ x: bx, z: bz, r: Math.max(size.x, size.z) * 0.42, bottom: g - 2, top: g + size.y });
    };
    place(spec.building, 0, 0);
    if (spec.antenna) place('antenna', 4, Math.PI * (0.6 + r() * 0.8));

    // A few crates stacked by the pad for flavour.
    const type = CARGO_TYPES[spec.biome];
    for (let k = 0; k < 3; k++) {
      const a = yaw - Math.PI / 2 + (k - 1) * 0.25, d = PAD_R + 5;
      const crate = add(new THREE.Mesh(this.box, this.crateMats[spec.biome]));
      crate.scale.set(...type.size);
      crate.position.set(x + Math.cos(a) * d, groundHeight(x + Math.cos(a) * d, z + Math.sin(a) * d) + type.size[1] / 2, z + Math.sin(a) * d);
      crate.rotation.y = r() * 0.6;
      crate.castShadow = true;
    }
    this.outposts.set(spec.id, { ...spec, top, objects, obstacles, beacon, surfaces: [{ x, z, r: PAD_R, top }] });
    if (this.job?.to.id === spec.id) beacon.material = this.destBeaconMat;
  }

  removeOutpost(id) {
    for (const o of this.outposts.get(id).objects) {
      this.scene.remove(o);
      if (o.isInstancedMesh) o.dispose();
    }
    this.outposts.delete(id);
  }

  obstacles() {
    const out = [];
    for (const o of this.outposts.values()) out.push(...o.obstacles);
    return out;
  }

  surfaces() {
    const out = [];
    for (const o of this.outposts.values()) out.push(...o.surfaces);
    return out;
  }

  // ---------- jobs ----------

  /** The outpost whose pad you're hovering near, if any. */
  nearby(p) {
    for (const o of this.outposts.values()) {
      if (Math.hypot(o.x - p.x, o.z - p.z) < BOARD_RANGE && p.y - o.top < 150) return o;
    }
    return null;
  }

  jobsAt(o) {
    if (o.jobs && o.jobsEpoch === this.epoch) return o.jobs;
    const r = rng(hash2(Math.round(o.x), Math.round(o.z)) ^ (this.epoch * 7919));
    const dests = this.specsAround(o, DEST_MAX).filter((s) => s.id !== o.id && Math.hypot(s.x - o.x, s.z - o.z) > DEST_MIN);
    dests.sort((a, b) => Math.hypot(a.x - o.x, a.z - o.z) - Math.hypot(b.x - o.x, b.z - o.z));
    const jobs = [];
    while (jobs.length < 3 && dests.length) {
      // There's always a run to the nearest outpost; the others are picked at random.
      const to = dests.splice(jobs.length ? Math.floor(r() * dests.length) : 0, 1)[0];
      const type = r() < 0.75 ? o.biome : Math.floor(r() * CARGO_TYPES.length);
      const t = CARGO_TYPES[type];
      const dist = Math.hypot(to.x - o.x, to.z - o.z);
      const reward = Math.round(((120 + dist * 0.11) * (1 + t.fragile * 0.4) * (0.8 + t.mass * 0.25)) / 10) * 10;
      jobs.push({ type, to, dist, reward });
    }
    jobs.sort((a, b) => a.dist - b.dist);
    o.jobs = jobs;
    o.jobsEpoch = this.epoch;
    return jobs;
  }

  accept(k, ship) {
    if (this.job) return this.toast('Finish (or drop with X) your current job first');
    const o = this.nearby(ship.pos);
    if (!o) return;
    const job = this.jobsAt(o)[k];
    if (!job) return;
    const t = CARGO_TYPES[job.type];
    const crate = new THREE.Group();
    const body = new THREE.Mesh(this.box, this.crateMats[job.type]);
    body.scale.set(...t.size);
    body.castShadow = true;
    crate.add(body);
    for (const s of [-0.3, 0.3]) {
      const band = new THREE.Mesh(this.box, this.bandMats[job.type]);
      band.scale.set(t.size[0] * 1.02, t.size[1] * 0.12, t.size[2] * 1.02);
      band.position.y = s * t.size[1];
      crate.add(band);
    }
    const glow = new THREE.Sprite(this.glowSprite);
    glow.scale.setScalar(5);
    glow.position.y = t.size[1] / 2 + 0.5;
    crate.add(glow);
    const pos = new THREE.Vector3(o.x, o.top + t.size[1] / 2, o.z);
    crate.position.copy(pos);
    this.scene.add(crate);
    this.job = {
      ...job, from: o, cargo: t, state: 'pickup', hooked: false, hp: 100, rest: 0,
      crate: { mesh: crate, pos, prev: pos.clone(), half: t.size[1] / 2, vel: new THREE.Vector3(), yaw: o.yaw },
    };
    // Long hauls can draw a raider ambush somewhere along the way.
    if (job.dist > RAID_MIN_DIST && Math.random() < RAID_CHANCE) this.job.raidAt = 0.3 + Math.random() * 0.35;
    this.sfx.pickup();
    this.toast(`Job: ${t.name} → ${job.to.name}. Hover over the crate and press E`, 'scan');
  }

  /** E: hook the crate if you're above it, or let go of it. */
  hook(ship) {
    const j = this.job;
    if (!j) return this.toast('No cargo job · land on an outpost pad to pick one');
    if (j.hooked) {
      this.release();
      this.toast('Cargo released');
      return;
    }
    const c = j.crate.pos;
    const dx = ship.pos.x - c.x, dz = ship.pos.z - c.z, dy = ship.pos.y - c.y;
    if (Math.hypot(dx, dz) < HOOK_RANGE && dy > -1 && dy < CABLE + 10) {
      j.hooked = true;
      j.state = 'carrying';
      this.sfx.pickup();
      this.toast(`Hooked! Deliver to ${j.to.name}`, 'scan');
    } else {
      this.toast('Get right above the crate to hook it');
    }
  }

  abandon() {
    if (!this.job) return;
    this.toast('Job abandoned', 'bad');
    this.dropJob();
    this.epoch++;
  }

  /** Let go of the crate (E, or your ship going down). */
  release() {
    const j = this.job;
    if (!j?.hooked) return;
    j.hooked = false;
    j.state = 'loose';
    this.cable.visible = false;
  }

  dropJob() {
    if (!this.job) return;
    this.scene.remove(this.job.crate.mesh);
    const dest = this.outposts.get(this.job.to.id);
    if (dest) dest.beacon.material = this.beaconMat;
    this.job = null;
    this.cable.visible = false;
    this.tug.set(0, 0, 0);
  }

  /** Cruise-speed multiplier while hauling: heavier cargo and lighter ships suffer more. */
  loadFactor(ship) {
    if (!this.job?.hooked) return 1;
    return 1 / (1 + (0.5 * this.job.cargo.mass) / (ship.def.mass ?? 1));
  }

  /** Called when a drone laser reaches the crate. */
  hitCrate(at) {
    if (!this.job) return false;
    this.damage(BOLT_DAMAGE, at);
    return true;
  }

  crateSphere() {
    return this.job ? { pos: this.job.crate.pos, r: Math.max(...this.job.cargo.size) * 0.6 } : null;
  }

  damage(amount, at) {
    const j = this.job;
    j.hp = Math.max(0, j.hp - amount);
    this.particles.emit(at ?? j.crate.pos, 8, { color: 0xffc070, speed: 10, life: 0.4 });
    if (j.hp > 0) {
      if (amount >= 10) this.toast(`Crate damaged · ${Math.round(j.hp)}% left`, 'bad');
      return;
    }
    this.particles.emit(j.crate.pos, 40, { color: j.cargo.color, speed: 22, life: 1, gravity: 0.6 });
    this.sfx.crash();
    this.toast(`${j.cargo.name} destroyed. Job failed`, 'bad');
    this.dropJob();
    this.epoch++;
  }

  // ---------- per frame ----------

  update(dt, t, ship, ground) {
    this.populate(ship.pos, dt);
    for (const o of this.outposts.values()) o.beacon.material.opacity = (o.beacon.material === this.destBeaconMat ? 0.4 : 0.2) + 0.06 * Math.sin(t * 3);
    const j = this.job;
    if (!j) return;
    if (!this.outposts.has(j.to.id)) this.addOutpost(j.to);
    this.outposts.get(j.to.id).beacon.material = this.destBeaconMat;

    // Verlet crate: gravity and a little air drag, plus damping of the swing relative to the ship.
    const c = j.crate, half = c.half;
    if (j.state !== 'pickup') {
      _v.subVectors(c.pos, c.prev).multiplyScalar(Math.exp(-dt * AIR_DRAG));
      if (j.hooked) {
        _w.subVectors(ship.pos, ship.prev); // the ship's step this frame
        _v.sub(_w).multiplyScalar(Math.exp(-dt * SWING_DAMP)).add(_w);
      }
      c.prev.copy(c.pos);
      c.pos.add(_v);
      c.pos.y -= 9.8 * dt * dt;
    }
    // The cable is a hard length limit on the crate; the pull it took to hold it tugs the ship back,
    // more for heavy cargo on a light ship.
    this.tug.multiplyScalar(Math.exp(-dt * TUG_DECAY));
    if (j.hooked) {
      _w.copy(ship.pos);
      _w.y -= ship.halfHeight;
      _v.copy(c.pos);
      _v.y += half;
      _v.sub(_w);
      const len = _v.length();
      if (len > CABLE) {
        _v.divideScalar(len);
        const excess = len - CABLE;
        c.pos.addScaledVector(_v, -excess);
        const share = j.cargo.mass / (j.cargo.mass + (ship.def.mass ?? 1));
        // Pull it took to hold the crate this frame, minus its hanging weight (the thrusters carry that).
        _v.multiplyScalar(Math.min(excess / (dt * dt), 80));
        _v.y += 9.8;
        this.tug.addScaledVector(_v, share * dt);
        if (this.tug.length() > TUG_MAX) this.tug.setLength(TUG_MAX);
      }
      ship.pos.addScaledVector(this.tug, dt);
      ship.object.position.copy(ship.pos);
    }
    // Ground (and pads / isles): land, slide, take damage on hard hits.
    const floor = ground(c.pos.x, c.pos.z, c.pos.y) + half;
    if (c.pos.y < floor) {
      const fall = (c.prev.y - c.pos.y) / dt;
      const slide = Math.hypot(c.pos.x - c.prev.x, c.pos.z - c.prev.z) / dt;
      c.pos.y = floor;
      c.prev.y = floor;
      const friction = Math.exp(-dt * 5);
      c.prev.x = c.pos.x - (c.pos.x - c.prev.x) * friction;
      c.prev.z = c.pos.z - (c.pos.z - c.prev.z) * friction;
      const hit = Math.max(0, fall - SAFE_FALL) + Math.max(0, slide - SAFE_SLIDE) * 0.5;
      if (hit > 0) this.damage(hit * 4 * (1 + j.cargo.fragile), c.pos);
      if (!this.job) return; // destroyed
    }
    c.vel.subVectors(c.pos, c.prev).divideScalar(Math.max(dt, 1e-3));

    // Delivered once it rests on the destination pad.
    const dest = this.outposts.get(j.to.id);
    const onPad = Math.hypot(c.pos.x - dest.x, c.pos.z - dest.z) < PAD_R - 1.5 && c.pos.y - (dest.top + half) < 1.2;
    j.rest = onPad && c.vel.length() < 5 ? j.rest + dt : 0;
    if (j.rest > 0.8) return this.deliver();

    // Part-way along a long haul, raiders may jump you.
    if (j.raidAt && j.hooked && !j.raided && 1 - Math.hypot(dest.x - c.pos.x, dest.z - c.pos.z) / j.dist > j.raidAt) {
      j.raided = true;
      this.raid(c.pos);
    }

    // Draw: the crate follows the simulation and, while the cable is taut, tilts to hang off it.
    c.mesh.position.copy(c.pos);
    _q2.setFromAxisAngle(_up, c.yaw);
    _w.copy(ship.pos);
    _w.y -= ship.halfHeight;
    if (j.hooked && _w.distanceTo(_v.copy(c.pos).setY(c.pos.y + half)) > CABLE - 0.5) {
      _q2.premultiply(_q.setFromUnitVectors(_up, _v.subVectors(_w, _v).normalize()));
    }
    c.mesh.quaternion.slerp(_q2, 1 - Math.exp(-dt * 8));
    this.cable.visible = j.hooked;
    if (j.hooked) {
      _v.set(0, half, 0).applyQuaternion(c.mesh.quaternion).add(c.pos); // top of the crate
      this.cable.position.copy(_v);
      this.cable.scale.set(1, _w.distanceTo(_v), 1);
      this.cable.quaternion.setFromUnitVectors(_up, _w.sub(_v).normalize());
    }
  }

  deliver() {
    const j = this.job;
    const pay = Math.round((j.reward * (0.4 + (0.6 * j.hp) / 100)) / 10) * 10;
    this.credits += pay;
    saveCredits(this.credits);
    this.particles.emit(j.crate.pos, 50, { color: 0xffd24a, speed: 20, life: 1, gravity: 0 });
    this.sfx.finish();
    this.toast(`Delivered ${j.cargo.name} to ${j.to.name} · +${pay} cr${j.hp < 100 ? ` (crate ${Math.round(j.hp)}%)` : ''}`, 'big');
    this.dropJob();
    this.epoch++;
  }

  /** On-screen marker for the current job: the crate while it isn't hooked, then the destination pad. */
  marker() {
    const j = this.job;
    if (!j) return null;
    if (!j.hooked) return { kind: 'k', label: `${j.cargo.name} crate`, pos: j.crate.pos };
    const d = this.outposts.get(j.to.id);
    return { kind: 'j', label: j.to.name, pos: this.destMark.set(j.to.x, (d?.top ?? groundHeight(j.to.x, j.to.z)) + 12, j.to.z) };
  }

  /** Radar blips: outposts (the destination stands out) and the crate when it's not on the hook. */
  blips(plot) {
    for (const o of this.outposts.values()) if (o.id !== this.job?.to.id) plot(o.x, o.z, 'o', 3000);
    const j = this.job;
    if (!j) return;
    plot(j.to.x, j.to.z, 'g', Infinity);
    if (!j.hooked) plot(j.crate.pos.x, j.crate.pos.z, 'k', Infinity);
  }

  /** HUD data. */
  hud(ship) {
    const j = this.job;
    let board = null;
    if (!j) {
      const o = this.nearby(ship.pos);
      if (o) {
        board = {
          name: o.name,
          biome: BIOMES[o.biome].name,
          jobs: this.jobsAt(o).map((jb) => ({ cargo: CARGO_TYPES[jb.type].name, to: jb.to.name, km: (jb.dist / 1000).toFixed(1), reward: jb.reward })),
        };
      }
    }
    let job = null;
    if (j) {
      const dist = Math.hypot(j.to.x - j.crate.pos.x, j.to.z - j.crate.pos.z);
      job = {
        cargo: j.cargo.name, to: j.to.name, km: (dist / 1000).toFixed(1), hp: Math.round(j.hp), reward: j.reward, state: j.state,
        hint: j.state === 'pickup' ? 'Hover over the crate and press E to hook it'
          : j.state === 'loose' ? 'Crate dropped. Get above it and press E to hook it again'
          : dist < 200 ? 'Lower it gently onto the pad' : 'Fly it to the gold beacon',
      };
    }
    return { credits: this.credits, board, job };
  }
}
