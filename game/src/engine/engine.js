// Game engine: state machine for both modes (race + explore), race simulation, lasers, cameras and input.
// Framework-agnostic: React Three Fiber calls frame() from useFrame, and the UI reads the store.
// The player always flies with the same free-flight controls (flight.js); AI racers use racers.js.
import * as THREE from 'three';
import {
  SHIPS, RACE_LENGTH, START_SPEED, MAX_BASE_SPEED, SPEED_RAMP, COUNTDOWN, NITRO_PER_UFO, RING_BURST, AI_LASERS,
  LASER_SLOWDOWN, cssColor,
} from './config.js';
import { Terrain, courseX, groundHeight, clamp, smoothstep } from './world.js';
import { Course } from './course.js';
import { Racer, aiControl } from './racers.js';
import { Particles, SpeedStreaks } from './effects.js';
import { UfoSwarm } from './ufos.js';
import { Flight, applyOrbit, lookAhead } from './flight.js';
import { Explorer } from './explore.js';
import { Lasers, BOLT_SPEED, segmentSphere } from './lasers.js';
import { ATMOS, BIOMES, biomeWeights } from './biomes.js';
import { Sfx } from './audio.js';
import { store } from './store.js';

export const SUN_DIR = new THREE.Vector3(0.55, 0.4, 0.73).normalize();
const HUD_INTERVAL = 0.05;
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'Tab'];
const FOG = { race: [260, 1550], explore: [300, 1450] };
const FIRE_INTERVAL = 0.11;   // ~9 shots a second, alternating guns
const AIM_DIST = 250;         // metres ahead of the nose where both guns converge (the crosshair)
const PLAYER_BOLT = 0x7ff6ff;
const AI_BOLT = 0xff4d4d;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _aimDir = new THREE.Vector3(), _aimTo = new THREE.Vector3(), _aimHit = new THREE.Vector3();

export const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
};

export class Engine {
  constructor(assets) {
    this.assets = assets;
    this.sfx = new Sfx();
    this.keys = new Set();
    this.attached = false;
    this.state = 'menu';
    this.mode = store.get().mode;
    this.selected = store.get().selected;
    this.player = null;
    this.paused = false;
    this.showHulls = false;
    this.firing = false;
    this.fireCd = 0;
    this.toastId = 0;
    this.countKey = 0;
    // Chase camera used once the race autopilot takes over after the finish line.
    this.cam = { rel: new THREE.Vector3(0, 7, -22), look: new THREE.Vector3(0, 2, 28), shake: 0 };
    // Numpad camera: 4/6 swing it round the ship, 8/2 raise/lower it, 5 eases it back behind.
    this.orbit = { yaw: 0, pitch: 0, returning: false };

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => {
      this.keys.clear();
      this.firing = false;
      this.autoPause();
    };
    this.onVisibility = () => document.hidden && this.autoPause();
    this.onMouseMove = (e) => {
      if (this.flightActive() && !this.paused && this.locked()) this.flight.aim(e.movementX, e.movementY);
    };
    this.onMouseDown = (e) => {
      if (e.button === 0 && this.flightActive() && !this.paused && this.locked()) this.firing = true;
    };
    this.onMouseUp = (e) => {
      if (e.button === 0) this.firing = false;
    };
    this.onWheel = (e) => {
      if (this.flightActive()) this.flight.zoom = clamp(this.flight.zoom + Math.sign(e.deltaY) * 2.5, 12, 48);
    };
    this.onCanvasClick = () => {
      if (!this.flying()) return;
      if (this.paused) this.resume();
      else this.lockPointer();
    };
    this.onLockChange = () => {
      const locked = this.locked();
      if (!locked) {
        this.unlockedAt = performance.now();
        this.firing = false;
      }
      store.set({ locked });
      // Esc releases the mouse — treat that as "pause" so you never fly on without control.
      if (!locked && this.flying() && !this.paused) this.togglePause();
    };
  }

  attach({ scene, camera, sun, hemi, dom }) {
    if (this.attached) return;
    Object.assign(this, { scene, camera, sun, hemi, dom });
    this.biomeW = new Float32Array(4);
    this.biome = null;
    scene.add(sun.target);
    this.terrain = new Terrain(scene);
    this.swarm = new UfoSwarm(scene, this.assets.ufo.scene);
    this.course = new Course(scene, this.swarm);
    this.particles = new Particles(scene);
    this.streaks = new SpeedStreaks(scene);
    this.lasers = new Lasers(scene);
    this.racers = SHIPS.map((def, i) => {
      const r = new Racer(def, this.assets.ships[i].scene);
      scene.add(r.object);
      return r;
    });
    this.flight = new Flight({ camera, particles: this.particles, orbit: this.orbit });
    this.explorer = new Explorer({
      scene, flight: this.flight, swarm: this.swarm, particles: this.particles, lasers: this.lasers, sfx: this.sfx,
      toast: (text, kind) => this.toast(text, kind), ufoTemplate: this.assets.ufo.scene,
      shipTemplates: this.assets.ships.map((g) => g.scene), shipNames: SHIPS.map((s) => s.name),
    });
    this.terrain.update(courseX(0), 0, Infinity);
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
    addEventListener('mousemove', this.onMouseMove);
    addEventListener('mousedown', this.onMouseDown);
    addEventListener('mouseup', this.onMouseUp);
    addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('pointerlockchange', this.onLockChange);
    dom.addEventListener('click', this.onCanvasClick);
    this.attached = true;
    store.set({ engine: this });
    if (import.meta.env.DEV) window.__nitro = this; // poke at the game from devtools
    this.enterMenu();
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    removeEventListener('mousemove', this.onMouseMove);
    removeEventListener('mousedown', this.onMouseDown);
    removeEventListener('mouseup', this.onMouseUp);
    removeEventListener('wheel', this.onWheel);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.dom.removeEventListener('click', this.onCanvasClick);
    if (this.locked()) document.exitPointerLock();
    this.terrain.clear();
    this.explorer.dispose();
    this.course.dispose();
    this.swarm.dispose();
    this.particles.dispose();
    this.streaks.dispose();
    this.lasers.dispose();
    for (const r of this.racers) this.scene.remove(r.object);
    this.scene.remove(this.sun.target);
    this.sfx.stop();
    store.set({ engine: null });
  }

  // ---------- actions (called by keyboard and React UI) ----------

  selectShip(i) {
    this.selected = (i + SHIPS.length) % SHIPS.length;
    store.set({ selected: this.selected });
    if (this.state === 'menu') this.layoutGrid();
  }

  setMode(mode) {
    this.mode = mode;
    store.set({ mode });
  }

  /** Start whichever mode is selected in the menu. */
  start() {
    if (this.mode === 'explore') this.startExplore();
    else this.startRace();
  }

  enterMenu() {
    if (this.locked()) document.exitPointerLock();
    this.useWorld('race');
    this.resetOrbit();
    this.lasers.clear();
    Object.assign(this, { state: 'menu', paused: false, running: false, player: null, resultsShown: false, firing: false });
    this.layoutGrid();
    this.course.reset();
    this.course.update(0, 0);
    this.sfx.engine(0, false, false);
    store.set({
      phase: 'menu', selected: this.selected, hud: null, explore: null, results: null, paused: false, countdown: null, toasts: [],
    });
  }

  /** Switch the shared world between the race canyon setup and the open-world setup. */
  useWorld(kind) {
    const explore = kind === 'explore';
    this.terrain.shape = explore ? 'around' : 'race';
    this.course.setVisible(!explore);
    if (!explore) this.explorer.clear();
    for (const r of this.racers) r.object.visible = !explore || r === this.player;
    this.biome = null; // re-detect quietly; no "Entering …" banner on a mode switch
  }

  /** Blend sky, fog, sun and ambient light from the biomes around `pos`, and announce biome changes. */
  updateAtmosphere(pos) {
    const w = biomeWeights(pos.x, pos.z, this.biomeW);
    const mix = (out, key) => {
      out.setRGB(0, 0, 0);
      for (let i = 0; i < 4; i++) {
        out.r += BIOMES[i][key].r * w[i];
        out.g += BIOMES[i][key].g * w[i];
        out.b += BIOMES[i][key].b * w[i];
      }
    };
    mix(ATMOS.top, 'top');
    mix(ATMOS.horizon, 'horizon');
    mix(ATMOS.below, 'below');
    mix(this.sun.color, 'sunColor');
    mix(this.hemi.color, 'hemiSky');
    mix(this.hemi.groundColor, 'hemiGround');
    let density = 0, sunI = 0, best = 0;
    for (let i = 0; i < 4; i++) {
      density += BIOMES[i].fog * w[i];
      sunI += BIOMES[i].sunIntensity * w[i];
      if (w[i] > w[best]) best = i;
    }
    this.sun.intensity = sunI;
    const [near, far] = FOG[this.state === 'explore' ? 'explore' : 'race'];
    this.scene.fog.color.copy(ATMOS.horizon);
    this.scene.fog.near = near * density;
    this.scene.fog.far = far * density;
    if (best !== this.biome && w[best] > 0.62) {
      const announce = this.biome !== null && (this.state === 'explore' || this.state === 'race');
      this.biome = best;
      if (announce) this.toast(`Entering ${BIOMES[best].name}`, 'biome');
    }
  }

  startExplore() {
    if (!this.attached) return;
    this.sfx.start();
    this.player = this.racers[this.selected];
    this.course.reset();
    this.useWorld('explore');
    this.explorer.start(this.player);
    this.resetOrbit();
    this.lasers.clear();
    this.terrain.update(this.player.pos.x, this.player.pos.z, Infinity);
    this.streaks.reset();
    Object.assign(this, { state: 'explore', paused: false, running: true, resultsShown: false, hudTimer: 0, fireCd: 0 });
    store.set({ phase: 'explore', results: null, paused: false, countdown: null, toasts: [], hud: null });
    this.lockPointer();
    this.publishExplore();
  }

  startRace() {
    if (!this.attached) return;
    this.sfx.start();
    if (this.state === 'explore') this.enterMenu();
    this.player = this.racers[this.selected];
    this.layoutGrid();
    this.racers.forEach((r) => {
      Object.assign(r, {
        lane: (r.pos.x - courseX(0)) * 0.8 + (Math.random() - 0.5) * 12,
        cruise: 10 + Math.random() * 10,
        seed: Math.random() * 100,
        ringHunter: Math.random() < 0.6,
        hits: 0,
        shotsLeft: 3,
        fireCd: 2 + Math.random() * 2,
      });
    });
    this.flight.takeControl(this.player, 0);
    this.course.reset();
    this.course.update(0, 0);
    this.streaks.reset();
    this.lasers.clear();
    Object.assign(this, {
      state: 'countdown', countdown: COUNTDOWN, lastCount: 0, time: 0, baseSpeed: 0, running: false, paused: false,
      resultsShown: false, resultsAt: 0, resultsTimer: 0, hudTimer: 0, bumpCooldown: 0, fireCd: 0, hitToastAt: -9,
    });
    this.cam.shake = 0;
    this.resetOrbit();
    store.set({ phase: 'countdown', results: null, paused: false, countdown: null, toasts: [] });
    this.lockPointer();
    this.publishHud();
  }

  togglePause() {
    if (!this.pausable()) return;
    if (this.paused) return this.resume();
    this.paused = true;
    this.firing = false;
    this.sfx.engine(0, false, false);
    if (this.locked()) document.exitPointerLock(); // give the mouse back for the pause menu
    store.set({ paused: true });
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    store.set({ paused: false });
    this.lockPointer();
  }

  pausable() {
    return this.state === 'race' || this.state === 'countdown' || this.state === 'explore';
  }

  /** The player is flying with the mouse-aimed controls right now. */
  flying() {
    return this.pausable();
  }

  flightActive() {
    if (this.state === 'explore' && this.explorer.disabled) return false; // waiting to respawn
    return this.flying() && !!this.player && !this.player.finished;
  }

  autoPause() {
    if (this.pausable() && !this.paused) this.togglePause();
  }

  locked() {
    return !!this.dom && document.pointerLockElement === this.dom;
  }

  /** Capture the mouse for steering. Browsers only allow this right after a click or key press. */
  lockPointer() {
    if (!this.flightActive() || this.locked() || !this.dom.requestPointerLock) return;
    try {
      this.dom.requestPointerLock()?.catch?.(() => {});
    } catch {
      // not allowed right now (no user gesture) — the "click to steer" hint stays up
    }
  }

  toggleInvert() {
    this.flight.invert = !this.flight.invert;
    this.toast(`Mouse Y ${this.flight.invert ? 'inverted' : 'normal'}`);
  }

  scan() {
    const found = this.explorer.scan(this.t ?? 0);
    if (found === null) this.toast(`Scanner recharging · ${Math.ceil(this.explorer.scanCooldown(this.t ?? 0))}s`);
    else {
      this.sfx.countdown(false);
      this.toast(found ? `Scanner: ${found} contact${found > 1 ? 's' : ''} marked` : 'Scanner: nothing in range', 'scan');
    }
    this.publishExplore();
  }

  toggleHulls() {
    this.showHulls = !this.showHulls;
    for (const r of this.racers) r.showHull(this.showHulls);
    this.toast(`Collision hulls ${this.showHulls ? 'on' : 'off'}`);
  }

  toggleMute() {
    this.sfx.toggleMute();
    this.toast(this.sfx.muted ? 'Sound off' : 'Sound on');
  }

  shake(amount) {
    this.cam.shake = Math.max(this.cam.shake, amount);
    this.flight.shake = Math.max(this.flight.shake, amount);
  }

  // ---------- frame ----------

  frame(dt, t) {
    if (!this.attached || this.paused) return;
    this.dt = dt;
    this.t = t;
    if (this.state === 'menu') this.updateMenu(dt, t);
    else if (this.state === 'explore') this.updateExplore(dt, t);
    else this.updateRace(dt, t);
  }

  updateMenu(dt, t) {
    const r = this.racers[this.selected];
    for (const x of this.racers) x.pose(dt, t);
    const a = t * 0.22;
    this.camera.position.set(r.pos.x + Math.sin(a) * 23, r.pos.y + 5 + Math.sin(t * 0.4) * 1.2, r.pos.z + Math.cos(a) * 23);
    this.camera.lookAt(r.pos.x, r.pos.y - 2.5, r.pos.z);
    this.setFov(50, 1);
    this.streaks.update(this.camera.position, 0, 0);
    this.updateWorld(dt, t, r.pos);
  }

  updateExplore(dt, t) {
    const s = this.player;
    this.updateOrbit(dt);
    this.explorer.update(dt, t, this.keys);
    this.flight.updateCamera(dt);
    this.setFov(this.flight.fov, 1 - Math.exp(-dt * 4));
    this.updateWeapons(dt);
    this.updateReticle();
    this.updateWaypoints();
    const f = s.fwd;
    this.streaks.update(this.camera.position, f, smoothstep(120, 260, f) * 0.4 + s.nitroGlow * 0.35, this.flight.dir);
    this.sfx.engine(clamp(f / 260, 0, 1), s.nitroActive, true);
    this.updateWorld(dt, t, s.pos);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = HUD_INTERVAL;
      this.publishExplore();
    }
  }

  updateRace(dt, t) {
    const p = this.player;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount && n > 0) {
        this.lastCount = n;
        this.showCount(String(n), false);
        this.sfx.countdown(false);
      }
      if (this.countdown <= 0) {
        this.state = 'race';
        this.running = true;
        this.showCount('GO!', true);
        this.toast('Hold W to thrust · mouse to steer · click to fire');
        this.sfx.countdown(true);
        store.set({ phase: 'race' });
      }
      this.flight.update(dt, t, this.keys, { cruise: 0, move: false });
    } else {
      this.time += dt;
      this.baseSpeed = Math.min(MAX_BASE_SPEED, START_SPEED + SPEED_RAMP * this.time);
      for (const r of this.racers) {
        if (r === p && !r.finished) {
          // Same controls as Explore; the speed you can reach with W climbs as the race goes on.
          this.flight.update(dt, t, this.keys, { cruise: this.baseSpeed * r.def.stats.speed, ceiling: (g) => g + 150 });
        } else {
          // Rubber band: AI behind you push a little harder, AI far ahead ease off.
          if (r !== p) r.rubber = 1 + clamp((p.pos.z - r.pos.z) / 2500, -0.08, 0.14);
          r.step(dt, aiControl(r, this, this.course), this);
          if (r !== p) this.aiShoot(r, dt);
        }
        this.interact(r);
      }
      this.bumps(dt);
      this.checkFinish(dt);
    }
    for (const r of this.racers) if (r !== p || p.finished) r.pose(dt, t);
    this.updateOrbit(dt);
    if (p.finished) {
      this.updateCamera(dt);
    } else {
      this.flight.updateCamera(dt);
      this.setFov(this.flight.fov, 1 - Math.exp(-dt * 4));
    }
    this.updateWeapons(dt);
    this.updateReticle();
    const f = p.fwd;
    this.streaks.update(this.camera.position, f, smoothstep(110, 230, f) * 0.45 + p.nitroGlow * 0.35, p.finished ? undefined : this.flight.dir);
    this.sfx.engine(clamp(f / 260, 0, 1), p.nitroActive, true);
    this.updateWorld(dt, t, p.pos);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = HUD_INTERVAL;
      this.publishHud();
    }
  }

  updateWorld(dt, t, focus) {
    this.terrain.update(focus.x, focus.z, this.state === 'explore' ? 3 : 2);
    if (this.state !== 'explore') this.course.update(t, focus.z);
    this.particles.update(dt);
    this.sun.position.copy(focus).addScaledVector(SUN_DIR, 250);
    this.sun.target.position.copy(focus);
    this.updateAtmosphere(focus);
  }

  updateOrbit(dt) {
    const k = this.keys, o = this.orbit;
    const dYaw = (k.has('Numpad6') ? 1 : 0) - (k.has('Numpad4') ? 1 : 0);
    const dPitch = (k.has('Numpad8') ? 1 : 0) - (k.has('Numpad2') ? 1 : 0);
    if (dYaw || dPitch) o.returning = false;
    o.yaw = Math.atan2(Math.sin(o.yaw + dYaw * 1.6 * dt), Math.cos(o.yaw + dYaw * 1.6 * dt));
    o.pitch = clamp(o.pitch + dPitch * 1.0 * dt, -0.3, 1.2);
    if (o.returning) {
      const f = Math.exp(-dt * 6);
      o.yaw *= f;
      o.pitch *= f;
      if (Math.abs(o.yaw) + Math.abs(o.pitch) < 1e-3) Object.assign(o, { yaw: 0, pitch: 0, returning: false });
    }
  }

  resetOrbit() {
    Object.assign(this.orbit, { yaw: 0, pitch: 0, returning: false });
  }

  // ---------- lasers ----------

  updateWeapons(dt) {
    this.fireCd -= dt;
    const trigger = this.firing || this.keys.has('KeyF');
    if (trigger && this.running && this.flightActive() && this.fireCd <= 0) {
      this.fireCd = FIRE_INTERVAL;
      this.firePlayer();
    }
    this.lasers.update(dt, (bolt, from, to) => this.laserHit(bolt, from, to));
  }

  /** World position of the next gun (alternating wings), slightly ahead of the ship's centre. */
  muzzle(r) {
    r.gun = -(r.gun || 1);
    r.object.updateMatrixWorld();
    return r.object.localToWorld(_v.set(r.halfWidth * 0.55 * r.gun, -r.halfHeight * 0.1, r.halfLength * 0.4));
  }

  /** The point the guns converge on: straight off the nose. The crosshair is drawn here. */
  aimPoint(out) {
    return out.copy(this.player.pos).addScaledVector(this.flight.dir, AIM_DIST);
  }

  /**
   * Light aim assist: the UFO or rival nearest the nose line, returned as a lead point (where it
   * will be when the bolt arrives). A target counts if the nose would miss it by under 6 m
   * (close range) or ~3° (long range), and never beyond 8°.
   */
  assistTarget() {
    const from = this.player.pos, nose = this.flight.dir;
    let best = null, bestMiss = Infinity;
    const consider = (x, y, z, vx = 0, vy = 0, vz = 0) => {
      _aimTo.set(x - from.x, y - from.y, z - from.z);
      const d = _aimTo.length();
      if (d < 15 || d > 700) return;
      const c = _aimTo.dot(nose) / d;
      if (c < 0.99) return;
      const miss = d * Math.sqrt(Math.max(0, 1 - c * c));
      if (miss > Math.max(6, d * 0.05) || miss >= bestMiss) return;
      bestMiss = miss;
      const lead = d / BOLT_SPEED;
      best = _aimHit.set(x + vx * lead, y + vy * lead, z + vz * lead);
    };
    const lists = this.state === 'explore' ? this.explorer.ufoLists() : this.course.ufoLists();
    for (const list of lists) for (const u of list) if (!u.taken) consider(u.x, u.y, u.z, u.vx, u.vy, u.vz);
    if (this.state === 'explore') {
      for (const d of this.explorer.drones.list) consider(d.pos.x, d.pos.y, d.pos.z, d.vel.x, d.vel.y, d.vel.z);
    }
    if (this.state !== 'explore') {
      const inv = 1 / Math.max(this.dt || 1 / 60, 1e-3);
      for (const r of this.racers) {
        if (r === this.player) continue;
        consider(r.pos.x, r.pos.y, r.pos.z, (r.pos.x - r.prev.x) * inv, (r.pos.y - r.prev.y) * inv, (r.pos.z - r.prev.z) * inv);
      }
    }
    return best;
  }

  /** Move the crosshair to where the guns converge, and light it up when the assist has a lock. */
  updateReticle() {
    const el = document.getElementById('crosshair');
    if (!el || !this.flightActive()) return;
    this.camera.updateMatrixWorld();
    this.aimPoint(_aimDir).project(this.camera);
    const visible = _aimDir.z < 1 && Math.abs(_aimDir.x) < 1.1 && Math.abs(_aimDir.y) < 1.1;
    el.style.left = `${((_aimDir.x + 1) / 2) * 100}%`;
    el.style.top = `${((1 - _aimDir.y) / 2) * 100}%`;
    el.style.opacity = visible ? '' : '0';
    el.classList.toggle('locked', !!this.assistTarget());
  }

  /** Scanner markers: placed over their target, or pinned to the screen edge pointing at it. */
  updateWaypoints() {
    const wps = this.explorer.waypoints;
    for (let i = 0; i < 3; i++) {
      const el = document.getElementById(`wp-${i}`);
      if (!el) continue;
      const w = wps[i];
      if (!w) {
        el.style.opacity = '0';
        continue;
      }
      _aimDir.copy(w.pos).project(this.camera);
      let { x, y } = _aimDir;
      const behind = _aimDir.z > 1;
      if (behind) {
        x = -x;
        y = -y;
        if (Math.abs(x) + Math.abs(y) < 0.05) y = -1; // dead astern: park it at the bottom
      }
      const m = Math.max(Math.abs(x), Math.abs(y));
      const edge = behind || m > 0.9;
      if (edge) {
        x *= 0.9 / m;
        y *= 0.9 / m;
      }
      el.style.left = `${((x + 1) / 2) * 100}%`;
      el.style.top = `${((1 - y) / 2) * 100}%`;
      el.style.opacity = '';
      el.classList.toggle('edge', edge);
      const d = this.player.pos.distanceTo(w.pos);
      el.lastElementChild.textContent = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
    }
  }

  firePlayer() {
    const p = this.player;
    const target = this.assistTarget();
    const from = this.muzzle(p);
    _u.subVectors(target ?? this.aimPoint(_w), from).normalize();
    this.lasers.fire(from, _u, p.fwd, p, PLAYER_BOLT);
    this.particles.emit(from, 4, { color: PLAYER_BOLT, speed: 5, life: 0.12, gravity: 0, vel: _w.copy(_u).multiplyScalar(p.fwd) });
    this.sfx.laser(true);
  }

  /** Rivals fire short, slightly inaccurate bursts when you're in front of them. */
  aiShoot(r, dt) {
    if (!AI_LASERS || this.state !== 'race') return;
    r.fireCd -= dt;
    if (r.fireCd > 0) return;
    const p = this.player;
    _w.subVectors(p.pos, r.pos);
    const d = _w.length();
    r.object.getWorldDirection(_u);
    if (d < 30 || d > 320 || _w.dot(_u) / d < 0.96) {
      r.fireCd = 0.25;
      return;
    }
    // Lead the target, then add a little spread.
    _w.copy(p.pos).addScaledVector(_v.subVectors(p.pos, p.prev), (d / BOLT_SPEED) / Math.max(this.dt, 1e-3));
    _w.x += (Math.random() - 0.5) * 6;
    _w.y += (Math.random() - 0.5) * 4;
    const from = this.muzzle(r).clone();
    this.lasers.fire(from, _w.sub(from).normalize(), r.fwd, r, AI_BOLT);
    this.particles.emit(from, 3, { color: AI_BOLT, speed: 5, life: 0.12, gravity: 0 });
    if (d < 400) this.sfx.laser(false);
    r.shotsLeft--;
    if (r.shotsLeft > 0) {
      r.fireCd = 0.13;
    } else {
      r.shotsLeft = 3;
      r.fireCd = 1.8 + Math.random() * 2.2;
    }
  }

  /** A bolt moved from a to c this frame. Return true if it hit something (and is used up). */
  laserHit(b, a, c) {
    const g = groundHeight(c.x, c.z);
    if (c.y < g) {
      this.particles.emit(_v.set(c.x, g + 0.5, c.z), 8, { color: 0xffc48a, speed: 10, life: 0.5 });
      return true;
    }
    const mine = b.owner === this.player;
    if (this.state === 'explore') return this.explorer.laserHit(b, a, c, mine);

    if (mine) {
      const got = this.course.collect(a, c, 5);
      if (got.length) {
        for (const u of got) this.rewardUfo(u, true);
        return true;
      }
    }
    for (const r of this.racers) {
      if (r !== b.owner && segmentSphere(a, c, r.pos, Math.max(r.halfWidth * 0.8, 3))) {
        this.hitRacer(r, b, c);
        return true;
      }
    }
    for (let k = 1; k <= 4; k++) {
      const hit = this.course.hitSpire(_v.lerpVectors(a, c, k / 4), 0);
      if (!hit) continue;
      this.hitSpire(hit.sp, _v, mine);
      return true;
    }
    return false;
  }

  hitRacer(r, b, at) {
    r.speed *= LASER_SLOWDOWN;
    b.owner.hits = (b.owner.hits || 0) + 1;
    this.particles.emit(at, 18, { color: b.owner === this.player ? PLAYER_BOLT : 0xff6a4a, speed: 18, life: 0.5, gravity: 0 });
    if (r === this.player) {
      this.shake(0.6);
      this.sfx.hit();
      if (this.time - this.hitToastAt > 1) {
        this.hitToastAt = this.time;
        this.toast(`Hit by ${b.owner.def.name}!`, 'bad');
      }
    } else if (b.owner === this.player) {
      this.sfx.hit();
      if (!(this.time - (r.hitToastAt ?? -9) < 1)) {
        r.hitToastAt = this.time;
        this.toast(`Hit ${r.def.name}!`, 'boost');
      }
    }
  }

  hitSpire(sp, at, mine) {
    sp.hp--;
    this.particles.emit(at, 10, { color: 0xffb37a, speed: 14, life: 0.5 });
    if (sp.hp > 0) return;
    this.course.destroySpire(sp);
    for (let k = 0; k < 6; k++) {
      _w.set(sp.x, sp.base + ((sp.top - sp.base) * k) / 5, sp.z);
      this.particles.emit(_w, 14, { color: k % 2 ? 0xa85a3b : 0xffa060, speed: 26, life: 1.1, gravity: 1 });
    }
    this.sfx.crash();
    if (mine) {
      this.shake(0.5);
      this.toast('Spire destroyed!', 'boost');
    }
  }

  rewardUfo(u, zapped) {
    const p = this.player;
    p.ufos++;
    p.nitro = Math.min(1, p.nitro + NITRO_PER_UFO);
    this.particles.emit(u, 40, { color: 0x6fd6ff, speed: 24, life: 0.9, gravity: 0 });
    this.particles.emit(u, 16, { color: 0xffffff, speed: 12, life: 0.6, gravity: 0 });
    this.sfx.pickup();
    this.toast(`${zapped ? 'Zapped!' : '+1 UFO'} · nitro +${Math.round(NITRO_PER_UFO * 100)}%`, 'ufo');
  }

  // ---------- race rules ----------

  interact(r) {
    const me = r === this.player;
    const ring = this.course.ringPass(r);
    if (ring) {
      r.burst += RING_BURST;
      if (me) {
        this.toast(`BOOST +${Math.round(RING_BURST * 3.6)} km/h`, 'boost');
        this.sfx.boost();
        this.particles.emit(ring, 70, { color: 0xff8a3d, speed: 34, life: 0.9, gravity: 0 });
        this.shake(0.35);
      }
    }
    const hit = this.course.hitSpire(r.pos, r.halfWidth * 0.7);
    if (hit) {
      const side = Math.sign(hit.dx) || 1;
      r.pos.x = hit.sp.x + side * (Math.sqrt(Math.max(hit.rr * hit.rr - hit.dz * hit.dz, 0)) + 0.5);
      r.vx = side * 35;
      r.speed *= 0.55;
      r.burst = 0;
      if (me) {
        this.toast('CRASH!', 'bad');
        this.sfx.crash();
        this.shake(1.2);
        this.particles.emit(r.pos, 60, { color: 0xff6a3a, speed: 26, life: 1 });
      }
    }
    if (!me) return;
    for (const u of this.course.collect(r.prev, r.pos)) this.rewardUfo(u, false);
    if (r.scraping && r.finished) {
      this.particles.emit(_v.set(r.pos.x, r.pos.y - r.halfHeight, r.pos.z), 3, {
        color: 0xffb04a, speed: 12, life: 0.5, vel: { x: 0, y: 4, z: -r.fwd * 0.2 },
      });
    }
  }

  bumps(dt) {
    this.bumpCooldown -= dt;
    const rs = this.racers;
    for (let a = 0; a < rs.length; a++) {
      for (let b = a + 1; b < rs.length; b++) {
        const A = rs[a], B = rs[b];
        const dx = B.pos.x - A.pos.x, dy = B.pos.y - A.pos.y, dz = B.pos.z - A.pos.z;
        const wx = (A.halfWidth + B.halfWidth) * 0.8;
        if (Math.abs(dz) > (A.halfLength + B.halfLength) * 0.8 || Math.abs(dy) > A.halfHeight + B.halfHeight || Math.abs(dx) > wx) continue;
        const side = Math.sign(dx) || 1, push = (wx - Math.abs(dx)) / 2;
        A.pos.x -= side * push;
        B.pos.x += side * push;
        A.vx -= side * 22;
        B.vx += side * 22;
        (dz > 0 ? A : B).speed *= 0.97;
        if ((A === this.player || B === this.player) && this.bumpCooldown <= 0) {
          this.bumpCooldown = 0.4;
          this.shake(0.5);
          this.sfx.bump();
        }
      }
    }
  }

  checkFinish(dt) {
    for (const r of this.racers) {
      if (r.finished || r.pos.z < RACE_LENGTH) continue;
      r.finished = true;
      r.finishTime = this.time;
      if (r === this.player) {
        this.state = 'done';
        this.resultsAt = this.time + 2.2;
        // Autopilot takes over; carry the current heading into its velocity model.
        Object.assign(r, { lane: 0, cruise: 14, seed: 0, ringHunter: false, vx: this.flight.dir.x * r.fwd, vy: 0 });
        this.cam.rel.subVectors(this.camera.position, r.pos);
        this.cam.look.set(0, 2, 28);
        this.resetOrbit();
        this.firing = false;
        if (this.locked()) document.exitPointerLock();
        this.toast('FINISH!', 'big');
        this.sfx.finish();
        store.set({ phase: 'done' });
      }
    }
    if (this.state === 'done' && this.time >= this.resultsAt) {
      this.resultsTimer -= dt;
      if (!this.resultsShown || this.resultsTimer <= 0) {
        this.resultsShown = true;
        this.resultsTimer = 0.3;
        store.set({ results: this.resultRows() });
      }
    }
  }

  /** Chase camera for the post-finish autopilot. */
  updateCamera(dt) {
    const p = this.player, cam = this.camera;
    const sp = smoothstep(START_SPEED, MAX_BASE_SPEED * 1.2, p.fwd);
    _v.set(-p.vx * 0.07, 6.5 + p.vy * 0.04 - sp * 0.8, -21 - sp * 3 - p.nitroGlow * 3);
    this.cam.rel.lerp(_v, 1 - Math.exp(-dt * 4));
    cam.position.copy(p.pos).add(applyOrbit(_v.copy(this.cam.rel), this.orbit));
    const floor = groundHeight(cam.position.x, cam.position.z) + 2.5;
    if (cam.position.y < floor) cam.position.y = floor;
    if (this.cam.shake > 0.002) {
      cam.position.x += (Math.random() - 0.5) * this.cam.shake;
      cam.position.y += (Math.random() - 0.5) * this.cam.shake;
      this.cam.shake *= Math.exp(-dt * 5);
    }
    const ahead = lookAhead(this.orbit);
    _w.set(p.vx * 0.15 * ahead, 2.5, 30 * ahead);
    this.cam.look.lerp(_w, 1 - Math.exp(-dt * 5));
    cam.lookAt(_v.copy(p.pos).add(this.cam.look));
    this.setFov(60 + sp * 14 + p.nitroGlow * 8, 1 - Math.exp(-dt * 4));
  }

  setFov(target, k) {
    const fov = this.camera.fov + (target - this.camera.fov) * k;
    if (Math.abs(fov - this.camera.fov) < 1e-3) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  layoutGrid() {
    const others = this.racers.filter((_, i) => i !== this.selected);
    [others[0], this.racers[this.selected], others[1]].forEach((r, k) => {
      const x = courseX(0) + (k - 1) * 22;
      let g = -Infinity;
      for (const dx of [-6, 0, 6]) for (const dz of [-6, 0, 6]) g = Math.max(g, groundHeight(x + dx, dz));
      r.reset(x, g + r.halfHeight + 8, 0);
    });
  }

  ranking() {
    return [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.pos.z - a.pos.z;
    });
  }

  // ---------- store publishing ----------

  publishHud() {
    const p = this.player;
    const ranked = this.ranking();
    store.set({
      hud: {
        place: ranked.indexOf(p) + 1,
        total: this.racers.length,
        time: fmtTime(this.time),
        distLeft: (Math.max(0, RACE_LENGTH - p.pos.z) / 1000).toFixed(1),
        progress: clamp(p.pos.z / RACE_LENGTH, 0, 1),
        racers: this.racers.map((r) => ({
          id: r.def.id, name: r.def.name, color: cssColor(r.def.flame), me: r === p, t: clamp(r.pos.z / RACE_LENGTH, 0, 1),
        })),
        ufos: p.ufos,
        hits: p.hits || 0,
        speed: Math.round(p.fwd * 3.6),
        nitro: p.nitro,
        nitroActive: p.nitroActive,
        scraping: p.scraping,
        manual: !p.finished,
        invert: this.flight.invert,
      },
    });
  }

  publishExplore() {
    const ex = this.explorer, s = this.player, fl = this.flight;
    store.set({
      explore: {
        speed: Math.round(s.fwd * 3.6),
        nitro: s.nitro,
        nitroActive: s.nitroActive,
        alt: Math.max(0, Math.round(s.pos.y - s.ground - s.halfHeight)),
        lift: Math.round(fl.lift),
        heading: (((-fl.yaw * 180) / Math.PI) % 360 + 360) % 360,
        ufos: ex.found,
        mothers: ex.mothersFound.size,
        cleared: ex.mothersCleared.size,
        landmarks: ex.discovered.size,
        destroyed: ex.mothersDestroyed.size,
        kills: ex.kills,
        shield: ex.shield / 100,
        hull: ex.hull / 100,
        hurt: (this.t ?? 0) - ex.hurtAt < 0.25,
        disabled: ex.disabled,
        threat: ex.threat(),
        biome: BIOMES[this.biome ?? 0].name,
        scanIn: Math.ceil(ex.scanCooldown(this.t ?? 0)),
        waypoints: ex.waypoints.map((w) => ({ kind: w.kind, label: w.label })),
        time: fmtTime(ex.time),
        radar: ex.radar(),
        scraping: s.scraping,
        invert: fl.invert,
      },
    });
  }

  resultRows() {
    const ranked = this.ranking();
    return {
      place: ranked.indexOf(this.player) + 1,
      rows: ranked.map((r, i) => ({
        place: i + 1,
        id: r.def.id,
        name: r.def.name,
        color: cssColor(r.def.flame),
        me: r === this.player,
        time: r.finished ? fmtTime(r.finishTime) : null,
        top: Math.round(r.topSpeed * 3.6),
        hits: r.hits || 0,
        ufos: r === this.player ? r.ufos : null,
      })),
    };
  }

  toast(text, kind = '') {
    const id = ++this.toastId;
    store.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
  }

  showCount(text, go) {
    store.set({ countdown: { text, go, key: ++this.countKey } });
  }

  // ---------- input ----------

  onKeyDown(e) {
    if (GAME_KEYS.includes(e.code) && (e.code !== 'Tab' || this.state === 'menu')) e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat) return;
    const c = e.code;
    // The Esc that released the mouse already paused the game; don't let it also open the menu.
    if (c === 'Escape' && performance.now() - (this.unlockedAt ?? -1e9) < 300) return;
    if (c === 'KeyM') return this.toggleMute();
    if (c === 'KeyC') return this.toggleHulls();
    if (this.state === 'menu') {
      if (c === 'ArrowLeft' || c === 'KeyA') this.selectShip(this.selected - 1);
      else if (c === 'ArrowRight' || c === 'KeyD') this.selectShip(this.selected + 1);
      else if (c === 'Tab') this.setMode(this.mode === 'race' ? 'explore' : 'race');
      else if (c === 'Enter' || c === 'Space') this.start();
      return;
    }
    if (this.resultsShown) {
      if (c === 'Enter' || c === 'KeyR') this.startRace();
      else if (c === 'Escape') this.enterMenu();
      return;
    }
    if (c === 'KeyP') this.togglePause();
    else if (c === 'Numpad5') this.orbit.returning = true;
    else if (c === 'KeyI') this.toggleInvert();
    else if (c === 'KeyQ' && this.state === 'explore' && !this.paused) this.scan();
    else if (c === 'Escape') this.paused ? this.enterMenu() : this.togglePause();
    else if (this.paused && c === 'Enter') this.resume();
    else if (c === 'KeyR' && this.state !== 'explore') this.startRace();
  }
}
