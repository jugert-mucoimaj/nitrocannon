// Cheap visual effects: glow sprites, particle bursts, speed streaks and engine flames.
import * as THREE from 'three';

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export class Particles {
  constructor(scene, max = 900) {
    this.max = max;
    this.alive = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({
      size: 2.4, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    }));
    this.points.frustumCulled = false;
    this.scene = scene;
    scene.add(this.points);
  }

  dispose() {
    this.scene.remove(this.points);
    this.geo.dispose();
  }

  emit(p, count, { color = 0xffffff, speed = 20, life = 0.8, vel = null, gravity = 0.3 } = {}) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count && this.alive < this.max; n++) {
      const k = this.alive++;
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const v = speed * (0.3 + Math.random() * 0.7);
      this.pos[k * 3] = p.x; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z;
      this.vel[k * 3] = s * Math.cos(th) * v + (vel ? vel.x : 0);
      this.vel[k * 3 + 1] = u * v + (vel ? vel.y : 0);
      this.vel[k * 3 + 2] = s * Math.sin(th) * v + (vel ? vel.z : 0);
      this.base[k * 3] = c.r; this.base[k * 3 + 1] = c.g; this.base[k * 3 + 2] = c.b;
      this.life[k] = this.maxLife[k] = life * (0.6 + Math.random() * 0.4);
      this.grav[k] = gravity;
    }
  }

  update(dt) {
    const drag = Math.exp(-dt * 2);
    for (let k = 0; k < this.alive; k++) {
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        const last = --this.alive;
        for (let a = 0; a < 3; a++) {
          this.pos[k * 3 + a] = this.pos[last * 3 + a];
          this.vel[k * 3 + a] = this.vel[last * 3 + a];
          this.base[k * 3 + a] = this.base[last * 3 + a];
        }
        this.life[k] = this.life[last];
        this.maxLife[k] = this.maxLife[last];
        this.grav[k] = this.grav[last];
        k--;
        continue;
      }
      this.vel[k * 3] *= drag; this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * drag - 9.8 * this.grav[k] * dt; this.vel[k * 3 + 2] *= drag;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      const f = this.life[k] / this.maxLife[k];
      this.col[k * 3] = this.base[k * 3] * f;
      this.col[k * 3 + 1] = this.base[k * 3 + 1] * f;
      this.col[k * 3 + 2] = this.base[k * 3 + 2] * f;
    }
    this.geo.setDrawRange(0, this.alive);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

const PLUS_Z = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _head = new THREE.Vector3();

/** World-fixed streaks around the camera; flying past them reads as speed. */
export class SpeedStreaks {
  constructor(scene, n = 180) {
    this.n = n;
    this.heads = new Float32Array(n * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({
      color: 0xdcecff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
    });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    this.scene = scene;
    scene.add(this.lines);
    this.ready = false;
  }

  dispose() {
    this.scene.remove(this.lines);
    this.geo.dispose();
  }

  respawn(k, cam, dir, ahead) {
    let x, y;
    do {
      x = (Math.random() - 0.5) * 100;
      y = (Math.random() - 0.5) * 56;
    } while (Math.abs(x) < 9 && Math.abs(y) < 6);
    const along = ahead ? 60 + Math.random() * 240 : Math.random() * 300;
    _head.copy(cam).addScaledVector(dir, along).addScaledVector(_right, x).addScaledVector(_up, y);
    _head.toArray(this.heads, k * 3);
  }

  /** `dir` is the unit direction of travel (race mode always flies down +Z). */
  update(cam, speed, intensity, dir = PLUS_Z) {
    _right.crossVectors(dir, WORLD_UP);
    if (_right.lengthSq() < 1e-4) _right.set(1, 0, 0);
    _right.normalize();
    _up.crossVectors(_right, dir).normalize();
    if (!this.ready) {
      for (let k = 0; k < this.n; k++) this.respawn(k, cam, dir, false);
      this.ready = true;
    }
    const len = 2 + speed * 0.06;
    const a = this.geo.attributes.position.array;
    for (let k = 0; k < this.n; k++) {
      _head.fromArray(this.heads, k * 3).sub(cam);
      const along = _head.dot(dir);
      if (along < -5 || _head.lengthSq() - along * along > 75 * 75) this.respawn(k, cam, dir, true);
      _head.fromArray(this.heads, k * 3);
      _head.toArray(a, k * 6);
      _head.addScaledVector(dir, -len).toArray(a, k * 6 + 3);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.mat.opacity = intensity;
  }

  reset() {
    this.ready = false;
  }
}

let flameGeo = null;
function getFlameGeometry() {
  if (flameGeo) return flameGeo;
  // Open cone, base at the nozzle (z=0), tip pointing backwards (-Z), length 1. Fades to black → invisible when additive.
  const g = new THREE.ConeGeometry(0.55, 1, 14, 1, true);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -0.5);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const f = 1 + p.getZ(i); // 1 at the nozzle, 0 at the tip
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flameGeo = g;
  return g;
}

export function makeFlame(color) {
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false };
  const group = new THREE.Group();
  const outer = new THREE.Mesh(getFlameGeometry(), new THREE.MeshBasicMaterial({ color, vertexColors: true, side: THREE.DoubleSide, ...additive }));
  const inner = new THREE.Mesh(getFlameGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, ...additive }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, ...additive }));
  group.add(outer, inner, glow);
  group.userData = { outer, inner, glow };
  return group;
}
