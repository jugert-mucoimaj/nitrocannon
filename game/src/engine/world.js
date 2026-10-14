// Infinite procedural canyon: a deterministic height function plus a chunk streamer around the player.
import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

export const CHUNK = 256;      // metres per terrain tile
const RES = 40;                // quads per tile edge (6.4 m spacing)
const STEP = CHUNK / RES;
const SIDE = 3;                // race: tiles kept left/right of the player
const AHEAD = 6;               // race: tiles kept ahead (+Z) of the player
const RADIUS = 6;              // explore: tiles kept in every direction

// Which tiles to keep around the player. Race only looks down the canyon; explore needs a full circle.
const SHAPES = {
  race: { keep: (di, dj, pad) => Math.abs(di) <= SIDE + pad && dj >= -1 - pad && dj <= AHEAD + pad, focus: 1 },
  around: { keep: (di, dj, pad) => di * di + dj * dj <= (RADIUS + pad) ** 2, focus: 0 },
};
const SCAN = Math.max(SIDE, AHEAD, RADIUS) + 1;

const perlin = new ImprovedNoise();
export const noise = (x, y, z = 0) => perlin.noise(x, y, z);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash2 = (i, j) => (Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0;

function fbm(x, z, octaves, seed) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, z * freq, seed + i * 17.31);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** X position of the canyon's centre line at distance z. The race runs along +Z. */
export function courseX(z) {
  return 160 * Math.sin(z * 0.0012) + 80 * Math.sin(z * 0.0029 + 1.3) + 25 * Math.sin(z * 0.0071 + 2.1);
}

/** Terrain height at any world point. Used by the mesh, collisions and AI alike. */
export function groundHeight(x, z) {
  const d = Math.abs(x - courseX(z));
  const wall = smoothstep(70, 320, d);                                    // 0 on the canyon floor, 1 on the walls
  const dunes = fbm(x * 0.004, z * 0.004, 3, 1.7) * 34;                   // rolling floor
  const ridge = smoothstep(0.12, 0.5, noise(z * 0.0021 + x * 0.0007, 3.1, 9.4)) * 58; // hills across the track
  const m = fbm(x * 0.0021, z * 0.0021, 5, 4.2) * 0.5 + 0.55;
  const mountains = Math.pow(Math.max(0, m), 1.8) * 360 + 25;
  const detail = noise(x * 0.035, z * 0.035, 2.2) * 1.5;
  return dunes + ridge + mountains * wall + detail;
}

/** Highest ground at a point and four neighbours `rad` metres away. */
export function maxGround(x, z, rad) {
  return Math.max(groundHeight(x, z), groundHeight(x + rad, z), groundHeight(x - rad, z), groundHeight(x, z + rad), groundHeight(x, z - rad));
}

const PALETTE = {
  sandA: new THREE.Color('#e6b075'),
  sandB: new THREE.Color('#c98a52'),
  rockA: new THREE.Color('#a85a3b'),
  rockB: new THREE.Color('#6a3427'),
  snow: new THREE.Color('#f6ede3'),
};
const tmpColor = new THREE.Color();

function terrainColor(out, h, ny, x, z) {
  const v = noise(x * 0.018, z * 0.018, 5.5) * 0.5 + 0.5;
  out.copy(PALETTE.sandA).lerp(PALETTE.sandB, v);
  const strata = Math.sin(h * 0.12 + v * 2) * 0.5 + 0.5;
  tmpColor.copy(PALETTE.rockA).lerp(PALETTE.rockB, strata * 0.7 + v * 0.3);
  out.lerp(tmpColor, smoothstep(0.93, 0.72, ny));
  out.lerp(PALETTE.snow, smoothstep(230, 290, h) * smoothstep(0.55, 0.8, ny));
  return out;
}

function makeRockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(1 + noise(v.x * 1.7, v.y * 1.7, v.z * 1.7 + 3.3) * 0.5);
    v.y *= 0.75;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.shape = 'race';
    this.material =new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
    this.rockGeo = makeRockGeometry();
    this.rockMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
    this.crystalGeo = new THREE.OctahedronGeometry(1, 0);
    this.crystalMat = new THREE.MeshStandardMaterial({
      color: 0x9ff4ff, emissive: 0x1fb4e6, emissiveIntensity: 1.6, flatShading: true, roughness: 0.2, metalness: 0.1,
    });
  }

  /** Streams tiles around (px, pz). Builds at most `budget` new tiles per call; returns how many are still missing. */
  update(px, pz, budget = 2) {
    const ci = Math.floor(px / CHUNK);
    const cj = Math.floor(pz / CHUNK);
    const shape = SHAPES[this.shape];
    for (const [key, ch] of this.chunks) {
      if (!shape.keep(ch.i - ci, ch.j - cj, 1)) {
        this.dispose(ch);
        this.chunks.delete(key);
      }
    }
    const missing = [];
    for (let dj = -SCAN; dj <= SCAN; dj++) {
      for (let di = -SCAN; di <= SCAN; di++) {
        const i = ci + di, j = cj + dj;
        if (shape.keep(di, dj, 0) && !this.chunks.has(i + ',' + j)) missing.push([i, j, di * di + (dj - shape.focus) ** 2]);
      }
    }
    missing.sort((a, b) => a[2] - b[2]);
    const n = Math.min(budget, missing.length);
    for (let k = 0; k < n; k++) {
      const [i, j] = missing[k];
      this.chunks.set(i + ',' + j, this.build(i, j));
    }
    return missing.length - n;
  }

  clear() {
    for (const ch of this.chunks.values()) this.dispose(ch);
    this.chunks.clear();
  }

  dispose(ch) {
    this.scene.remove(ch.group);
    ch.geometry.dispose();
    ch.group.traverse((o) => o.isInstancedMesh && o.dispose());
  }

  build(i, j) {
    const x0 = i * CHUNK, z0 = j * CHUNK;
    const N = RES + 1, W = N + 2;
    // Heights with a one-vertex border so normals match across tile seams.
    const H = new Float32Array(W * W);
    for (let b = 0; b < W; b++) {
      for (let a = 0; a < W; a++) H[b * W + a] = groundHeight(x0 + (a - 1) * STEP, z0 + (b - 1) * STEP);
    }
    const pos = new Float32Array(N * N * 3);
    const nor = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const c = new THREE.Color();
    for (let b = 0; b < N; b++) {
      for (let a = 0; a < N; a++) {
        const k = (b * N + a) * 3;
        const h = H[(b + 1) * W + a + 1];
        const dx = H[(b + 1) * W + a + 2] - H[(b + 1) * W + a];
        const dz = H[(b + 2) * W + a + 1] - H[b * W + a + 1];
        const len = Math.hypot(dx, 2 * STEP, dz);
        nor[k] = -dx / len; nor[k + 1] = (2 * STEP) / len; nor[k + 2] = -dz / len;
        pos[k] = a * STEP; pos[k + 1] = h; pos[k + 2] = b * STEP;
        terrainColor(c, h, nor[k + 1], x0 + a * STEP, z0 + b * STEP);
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
    }
    const idx = new Uint16Array(RES * RES * 6);
    let t = 0;
    for (let b = 0; b < RES; b++) {
      for (let a = 0; a < RES; a++) {
        const p = b * N + a, q = p + 1, r = p + N, s = r + 1;
        idx[t++] = p; idx[t++] = r; idx[t++] = q;
        idx[t++] = q; idx[t++] = r; idx[t++] = s;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.position.set(x0, 0, z0);
    group.add(mesh);
    this.addDecor(group, i, j, x0, z0);
    this.scene.add(group);
    return { i, j, group, geometry };
  }

  addDecor(group, i, j, x0, z0) {
    const r = rng(hash2(i, j));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();

    // Boulders: small ones on the canyon floor (you fly over them), big ones up on the walls.
    const rocks = new THREE.InstancedMesh(this.rockGeo, this.rockMat, 34);
    for (let k = 0; k < 34; k++) {
      const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK;
      const wall = smoothstep(70, 320, Math.abs(x - courseX(z)));
      const size = wall < 0.15 ? 0.8 + r() * 2 : 2 + r() * r() * 12;
      p.set(x - x0, groundHeight(x, z) - size * 0.25, z - z0);
      q.setFromEuler(e.set(r() * 6.28, r() * 6.28, r() * 6.28));
      s.set(size, size * (0.6 + r() * 0.5), size);
      rocks.setMatrixAt(k, m.compose(p, q, s));
      rocks.setColorAt(k, c.copy(PALETTE.rockA).lerp(PALETTE.rockB, r()));
    }
    rocks.receiveShadow = true;
    group.add(rocks);

    // Glowing crystal clusters on the slopes.
    const spots = [];
    for (let k = 0; k < 14 && spots.length < 6; k++) {
      const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK;
      if (smoothstep(70, 320, Math.abs(x - courseX(z))) > 0.3) spots.push([x, z]);
    }
    if (!spots.length) return;
    const crystals = new THREE.InstancedMesh(this.crystalGeo, this.crystalMat, spots.length * 3);
    let n = 0;
    for (const [x, z] of spots) {
      const g = groundHeight(x, z);
      for (let k = 0; k < 3; k++) {
        const size = 3 + r() * 7;
        p.set(x - x0 + (r() - 0.5) * 8, g + size * 0.8, z - z0 + (r() - 0.5) * 8);
        q.setFromEuler(e.set((r() - 0.5) * 0.8, r() * 6.28, (r() - 0.5) * 0.8));
        s.set(size * 0.35, size * 1.8, size * 0.35);
        crystals.setMatrixAt(n++, m.compose(p, q, s));
      }
    }
    group.add(crystals);
  }
}
