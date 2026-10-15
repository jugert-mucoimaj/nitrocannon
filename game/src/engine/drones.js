// Hostile mini-UFO drones launched by red motherships. They circle the player, keep pace with it,
// spread out from each other and fire short laser bursts. Drawn with instancing like the collectibles.
import * as THREE from 'three';
import { clamp } from './world.js';
import { glowTexture } from './effects.js';

const CAP = 48;
const SCALE = 0.42; // same 4 m size as the collectible UFOs
export const DRONE_HP = 2;
export const DRONE_RADIUS = 5.5; // laser hitbox, a little bigger than the 4 m model to keep dogfights fun

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/** Returns m => red-tinted clone of a UFO material (cached), shared by hostile motherships and drones. */
export function hostileMaterials() {
  const cache = new Map();
  const glow = new THREE.Color(0xff2a2a), hull = new THREE.Color(0x5a0a0a);
  return (m) => {
    if (!cache.has(m)) {
      const h = m.clone();
      if (h.emissive && h.emissive.getHex() !== 0) h.emissive.copy(glow);
      h.color?.lerp(hull, 0.55);
      cache.set(m, h);
    }
    return cache.get(m);
  };
}

export class Drones {
  constructor(scene, template, hostile) {
    this.scene = scene;
    this.list = [];
    this.parts = [];
    template.updateMatrixWorld(true);
    template.traverse((o) => {
      if (!o.isMesh || o.userData.collision) return;
      const im = new THREE.InstancedMesh(o.geometry, hostile(o.material), CAP);
      im.count = 0;
      im.frustumCulled = false;
      scene.add(im);
      this.parts.push({ im, local: o.matrixWorld.clone() });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.glow = new THREE.Points(g, new THREE.PointsMaterial({
      size: 12, map: glowTexture(), color: 0xff3a3a, transparent: true, opacity: 0.7,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    }));
    this.glow.frustumCulled = false;
    scene.add(this.glow);
  }

  spawn(at, mother) {
    if (this.list.length >= CAP) return null;
    const d = {
      pos: at.clone(),
      vel: new THREE.Vector3((Math.random() - 0.5) * 40, -25, (Math.random() - 0.5) * 40),
      hp: DRONE_HP,
      mother,
      fireCd: 1.5 + Math.random() * 2,
      shots: 0,
      phase: Math.random() * Math.PI * 2,
      orbit: 70 + Math.random() * 50,
      height: 10 + Math.random() * 30,
      spin: Math.random() * 6,
    };
    this.list.push(d);
    return d;
  }

  /** Remove every drone, or only the ones belonging to `mother`. */
  clear(mother = null) {
    this.list = mother ? this.list.filter((d) => d.mother !== mother) : [];
  }

  remove(d) {
    this.list = this.list.filter((x) => x !== d);
  }

  /**
   * ctx: { player (ship), playerVel (m/s vector), ground(x, z, y), fire(drone) }.
   * Each drone circles the player at its own radius and height, leading where it's heading.
   */
  update(dt, t, ctx) {
    const p = ctx.player.pos;
    const maxSpeed = Math.max(95, ctx.player.fwd * 1.15);
    for (const d of this.list) {
      const a = t * 0.6 + d.phase;
      _v.set(p.x + Math.cos(a) * d.orbit, p.y + d.height, p.z + Math.sin(a) * d.orbit).addScaledVector(ctx.playerVel, 0.8);
      _w.subVectors(_v, d.pos);
      const dist = _w.length();
      const speed = dist > 250 ? maxSpeed * 1.8 : maxSpeed; // sprint in from the hangar, then dogfight
      _w.multiplyScalar(Math.min(speed, dist * 1.5) / Math.max(dist, 1e-3));
      d.vel.lerp(_w, 1 - Math.exp(-dt * 2.2));
    }
    // Keep them from stacking on top of each other.
    for (let i = 0; i < this.list.length; i++) {
      for (let j = i + 1; j < this.list.length; j++) {
        const a = this.list[i], b = this.list[j];
        _v.subVectors(a.pos, b.pos);
        const d2 = _v.lengthSq();
        if (d2 > 14 * 14 || d2 < 1e-4) continue;
        _v.multiplyScalar((60 * dt) / Math.sqrt(d2));
        a.vel.add(_v);
        b.vel.sub(_v);
      }
    }
    for (const d of this.list) {
      d.pos.addScaledVector(d.vel, dt);
      const floor = ctx.ground(d.pos.x, d.pos.z, d.pos.y) + 10;
      if (d.pos.y < floor) {
        d.pos.y = floor;
        d.vel.y = Math.max(d.vel.y, 0);
      }
      d.fireCd -= dt;
      if (d.fireCd > 0) continue;
      const toPlayer = d.pos.distanceTo(p);
      if (toPlayer > 25 && toPlayer < 380) {
        ctx.fire(d);
        d.shots++;
        d.fireCd = d.shots % 2 ? 0.18 : 2.2 + Math.random() * 1.6; // bursts of two
      } else {
        d.fireCd = 0.3;
      }
    }
  }

  render(t) {
    let n = 0;
    const gp = this.glow.geometry.attributes.position;
    for (const d of this.list) {
      // spin, and lean a little into the direction of travel
      _q.setFromEuler(_e.set(clamp(d.vel.z * 0.004, -0.4, 0.4), t * 3 + d.spin, clamp(-d.vel.x * 0.004, -0.4, 0.4)));
      _m.compose(d.pos, _q, _s.setScalar(SCALE));
      for (const part of this.parts) part.im.setMatrixAt(n, _m2.multiplyMatrices(_m, part.local));
      gp.setXYZ(n, d.pos.x, d.pos.y, d.pos.z);
      n++;
    }
    for (const part of this.parts) {
      part.im.count = n;
      part.im.instanceMatrix.needsUpdate = true;
    }
    this.glow.geometry.setDrawRange(0, n);
    gp.needsUpdate = true;
  }

  dispose() {
    for (const { im } of this.parts) {
      this.scene.remove(im);
      im.dispose();
    }
    this.scene.remove(this.glow);
    this.glow.geometry.dispose();
  }
}
