// Collectible UFOs, drawn with instancing (one draw call per UFO material) plus a glow halo and a
// tractor beam each. Shared by both modes: whichever mode is active hands over its list every frame.
import * as THREE from 'three';
import { clamp } from './world.js';
import { glowTexture } from './effects.js';

const CAP = 320;
const UFO_SCALE = 0.42; // the UFO model is 10 m wide → ~4 m collectibles
export const UFO_RADIUS = 8;

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class UfoSwarm {
  constructor(scene, template) {
    this.scene = scene;
    this.objects = [];
    template.updateMatrixWorld(true);
    this.parts = [];
    template.traverse((o) => {
      if (!o.isMesh || o.userData.collision) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, CAP);
      im.count = 0;
      im.frustumCulled = false;
      this.add(im);
      this.parts.push({ im, local: o.matrixWorld.clone() });
    });

    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.halo = this.add(new THREE.Points(haloGeo, new THREE.PointsMaterial({
      size: 15, map: glowTexture(), color: 0x59c8ff, transparent: true, opacity: 0.6,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    })));
    this.halo.frustumCulled = false;

    // Tractor beam: open cone, top at y=0, fading towards the ground.
    const beamGeo = new THREE.CylinderGeometry(0.6, 6.5, 1, 20, 1, true).translate(0, -0.5, 0);
    const bp = beamGeo.attributes.position;
    const bc = new Float32Array(bp.count * 3);
    for (let i = 0; i < bp.count; i++) bc[i * 3] = bc[i * 3 + 1] = bc[i * 3 + 2] = 1 + bp.getY(i);
    beamGeo.setAttribute('color', new THREE.BufferAttribute(bc, 3));
    this.beams = this.add(new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({
      color: 0x7fd8ff, vertexColors: true, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
    }), CAP));
    this.beams.count = 0;
    this.beams.frustumCulled = false;
  }

  add(o) {
    this.scene.add(o);
    this.objects.push(o);
    return o;
  }

  dispose() {
    for (const o of this.objects) {
      this.scene.remove(o);
      if (o.isInstancedMesh) o.dispose();
    }
  }

  /** Draw every UFO not yet taken. `lists` is an array of arrays of { x, y, z, g, phase, taken, noBeam? }. */
  draw(t, lists) {
    let n = 0;
    const hp = this.halo.geometry.attributes.position.array;
    for (const list of lists) {
      for (const u of list) {
        if (u.taken || n >= CAP) continue;
        const y = u.y + Math.sin(t * 2 + u.phase) * 1.2;
        _p.set(u.x, y, u.z);
        _q.setFromEuler(_e.set(Math.sin(t + u.phase) * 0.12, t * 1.6 + u.phase, 0));
        _m.compose(_p, _q, _s.setScalar(UFO_SCALE));
        for (const part of this.parts) part.im.setMatrixAt(n, _m2.multiplyMatrices(_m, part.local));
        hp[n * 3] = u.x;
        hp[n * 3 + 1] = y;
        hp[n * 3 + 2] = u.z;
        _p.set(u.x, y - 0.8, u.z);
        if (u.noBeam) _s.set(0, 0, 0);
        else _s.set(1, Math.max(1, y - u.g), 1);
        this.beams.setMatrixAt(n, _m.compose(_p, _q.identity(), _s));
        n++;
      }
    }
    for (const part of this.parts) {
      part.im.count = n;
      part.im.instanceMatrix.needsUpdate = true;
    }
    this.beams.count = n;
    this.beams.instanceMatrix.needsUpdate = true;
    this.halo.geometry.setDrawRange(0, n);
    this.halo.geometry.attributes.position.needsUpdate = true;
  }
}

/** UFOs touched by something moving from `a` to `b` this frame (swept, so fast ships can't tunnel through). */
export function sweepCollect(lists, a, b, radius = UFO_RADIUS) {
  const got = [];
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz || 1;
  const minX = Math.min(a.x, b.x) - radius, maxX = Math.max(a.x, b.x) + radius;
  const minZ = Math.min(a.z, b.z) - radius, maxZ = Math.max(a.z, b.z) + radius;
  for (const list of lists) {
    for (const u of list) {
      if (u.taken || u.x < minX || u.x > maxX || u.z < minZ || u.z > maxZ) continue;
      const k = clamp(((u.x - a.x) * abx + (u.y - a.y) * aby + (u.z - a.z) * abz) / len2, 0, 1);
      const dx = a.x + abx * k - u.x, dy = a.y + aby * k - u.y, dz = a.z + abz * k - u.z;
      if (dx * dx + dy * dy + dz * dz < radius * radius) {
        u.taken = true;
        got.push(u);
      }
    }
  }
  return got;
}
