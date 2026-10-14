// Laser bolts: glowing instanced streaks (two draw calls for all of them), moved and hit-tested
// every frame. What a bolt can hit is decided by the engine through the `onHit` callback.
import * as THREE from 'three';
import { clamp } from './world.js';
import { glowTexture } from './effects.js';

const CAP = 400;
export const BOLT_SPEED = 650; // m/s on top of the shooter's own speed
const LIFE = 1.4;              // seconds → roughly 1 km of range

const _a = new THREE.Vector3(), _d = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _z = new THREE.Vector3(0, 0, 1), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const WHITE = new THREE.Color(0xffffff);

/** True if the segment a→b passes within `r` of point `c`. */
export function segmentSphere(a, b, c, r) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz || 1;
  const k = clamp(((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / len2, 0, 1);
  const dx = a.x + abx * k - c.x, dy = a.y + aby * k - c.y, dz = a.z + abz * k - c.z;
  return dx * dx + dy * dy + dz * dz < r * r;
}

export class Lasers {
  constructor(scene) {
    this.scene = scene;
    this.bolts = [];
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false };
    this.core = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.18, 7), new THREE.MeshBasicMaterial(additive), CAP);
    this.glow = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 1.1, 12), new THREE.MeshBasicMaterial({ opacity: 0.35, ...additive }), CAP);
    for (const im of [this.core, this.glow]) {
      im.count = 0;
      im.frustumCulled = false;
      im.setColorAt(0, WHITE); // allocates the per-instance colour buffer
      scene.add(im);
    }
    // Seen from the chase camera, bolts fly away end-on and the streak shrinks to a dot,
    // so each bolt also carries a glowing head that reads at any angle.
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.heads = new THREE.Points(hg, new THREE.PointsMaterial({ size: 5, map: glowTexture(), vertexColors: true, ...additive }));
    this.heads.frustumCulled = false;
    scene.add(this.heads);
  }

  /** Shoot from `origin` along unit `dir`; `inherit` is the shooter's forward speed. */
  fire(origin, dir, inherit, owner, color) {
    if (this.bolts.length >= CAP) this.bolts.shift();
    const glow = new THREE.Color(color);
    this.bolts.push({
      pos: origin.clone(),
      vel: dir.clone().multiplyScalar(BOLT_SPEED + Math.max(0, inherit)),
      life: LIFE,
      owner,
      glow,
      core: glow.clone().lerp(WHITE, 0.6),
    });
  }

  clear() {
    this.bolts.length = 0;
    this.render();
  }

  /** Move every bolt; `onHit(bolt, from, to)` returns true when the bolt struck something. */
  update(dt, onHit) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      _a.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      if (b.life <= 0 || onHit(b, _a, b.pos)) {
        this.bolts[i] = this.bolts[this.bolts.length - 1];
        this.bolts.pop();
      }
    }
    this.render();
  }

  render() {
    const n = this.bolts.length;
    const hp = this.heads.geometry.attributes.position, hc = this.heads.geometry.attributes.color;
    for (let i = 0; i < n; i++) {
      const b = this.bolts[i];
      _m.compose(b.pos, _q.setFromUnitVectors(_z, _d.copy(b.vel).normalize()), _s);
      this.core.setMatrixAt(i, _m);
      this.glow.setMatrixAt(i, _m);
      this.core.setColorAt(i, b.core);
      this.glow.setColorAt(i, b.glow);
      hp.setXYZ(i, b.pos.x, b.pos.y, b.pos.z);
      hc.setXYZ(i, b.core.r, b.core.g, b.core.b);
    }
    for (const im of [this.core, this.glow]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
    }
    this.heads.geometry.setDrawRange(0, n);
    hp.needsUpdate = hc.needsUpdate = true;
  }

  dispose() {
    for (const im of [this.core, this.glow]) {
      this.scene.remove(im);
      im.dispose();
    }
    this.scene.remove(this.heads);
    this.heads.geometry.dispose();
  }
}
