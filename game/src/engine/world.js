// Infinite procedural world: a deterministic height function shaped by four biomes (see biomes.js),
// plus a chunk streamer that builds terrain tiles and their decorations around the player.
import * as THREE from 'three';
import { noise, fbm, clamp, smoothstep, rng, hash2 } from './noise.js';
import { biomeWeights, biomeColor, BIOME_ROCK, RED, FROST, VOLCANIC, CRYSTAL } from './biomes.js';

export { noise, fbm, clamp, smoothstep, rng, hash2 };

export const CHUNK = 256;      // metres per terrain tile
const RES = 40;                // quads per tile edge (6.4 m spacing)
const STEP = CHUNK / RES;
const SIDE = 3;                // race: tiles kept left/right of the player
const AHEAD = 6;               // race: tiles kept ahead (+Z) of the player
const RADIUS = 6;              // explore: tiles kept in every direction
export const LAVA_Y = -9;      // lava fills the badlands' low ground up to this height
const VOLCANIC_SINK = 175;      // how far the badlands' valleys sink below the other biomes (more = more lava)

// Which tiles to keep around the player. Race only looks down the canyon; explore needs a full circle.
const SHAPES = {
  race: { keep: (di, dj, pad) => Math.abs(di) <= SIDE + pad && dj >= -1 - pad && dj <= AHEAD + pad, focus: 1 },
  around: { keep: (di, dj, pad) => di * di + dj * dj <= (RADIUS + pad) ** 2, focus: 0 },
};
const SCAN = Math.max(SIDE, AHEAD, RADIUS) + 1;

/** X position of the canyon's centre line at distance z. The race runs along +Z. */
export function courseX(z) {
  return 160 * Math.sin(z * 0.0012) + 80 * Math.sin(z * 0.0029 + 1.3) + 25 * Math.sin(z * 0.0071 + 2.1);
}

/** Flat steps with steep risers: the crystal fields' terraced mesas. */
const terrace = (h, step) => {
  const k = h / step, f = Math.floor(k);
  return (f + smoothstep(0.55, 1, k - f)) * step;
};

/**
 * Everything about the ground at a point: height `h`, biome weights `w`, how much of it is lava,
 * and `wall` (0 on the canyon floor, 1 out on the mountains). Used by the mesh, collisions and AI alike.
 */
export function sampleTerrain(x, z, out) {
  const w = biomeWeights(x, z, out.w);
  const wall = smoothstep(70, 320, Math.abs(x - courseX(z)));
  const dunes = fbm(x * 0.004, z * 0.004, 3, 1.7) * 34;                              // rolling floor
  const ridge = smoothstep(0.12, 0.5, noise(z * 0.0021 + x * 0.0007, 3.1, 9.4)) * 58; // hills across the canyon
  const m = Math.max(0, fbm(x * 0.0021, z * 0.0021, 5, 4.2) * 0.5 + 0.55);
  const detail = noise(x * 0.035, z * 0.035, 2.2) * 1.5;
  const mountains = Math.pow(m, 1.8) * 360 + 25;
  let h = 0;
  if (w[RED] > 1e-3) h += w[RED] * (dunes + ridge + mountains * wall + detail);
  // Frost: softer snow drifts and rounder mountains.
  if (w[FROST] > 1e-3) h += w[FROST] * (dunes * 0.45 + ridge * 0.8 + (Math.pow(m, 1.3) * 290 + 15) * wall + detail * 0.4);
  // Volcanic: knife-edge ridged peaks and a sunken floor that fills with lava.
  if (w[VOLCANIC] > 1e-3) {
    // A sunken rolling base (its low ground floods) with narrow sharp ridges rising out of it.
    const ridges = Math.pow(Math.max(0, 1 - Math.abs(fbm(x * 0.0026, z * 0.0026, 4, 8.8)) * 5), 3) * 260;
    h += w[VOLCANIC] * (dunes - 16 + ridge * 0.6 + (mountains - VOLCANIC_SINK + ridges) * wall + detail * 2.2);
  }
  // Crystal: terraced mesas.
  if (w[CRYSTAL] > 1e-3) h += w[CRYSTAL] * (terrace(dunes * 0.6 + ridge + mountains * wall, 24) + detail * 0.5);

  const mask = smoothstep(0.3, 0.6, w[VOLCANIC]);
  out.lava = 0;
  if (mask > 0 && h < LAVA_Y) {
    out.lava = mask;
    h += (LAVA_Y - h) * mask;
  }
  out.h = h;
  out.wall = wall;
  return out;
}

export const newSample = () => ({ w: new Float32Array(4), h: 0, lava: 0, wall: 0 });
const _sample = newSample();

/** Terrain height at any world point. */
export const groundHeight = (x, z) => sampleTerrain(x, z, _sample).h;

/** Highest ground at a point and four neighbours `rad` metres away. */
export function maxGround(x, z, rad) {
  return Math.max(groundHeight(x, z), groundHeight(x + rad, z), groundHeight(x - rad, z), groundHeight(x, z + rad), groundHeight(x, z - rad));
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

/** Terrain material: flat-shaded vertex colours, plus a per-vertex `glow` attribute for lava and veins. */
function makeTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * 1.3;');
  };
  return mat;
}

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.shape = 'race';
    this.material = makeTerrainMaterial();
    this.rockGeo = makeRockGeometry();
    this.rockMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
    this.crystalGeo = new THREE.OctahedronGeometry(1, 0);
    this.spikeGeo = new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0);
    const gem = { flatShading: true, roughness: 0.2, metalness: 0.1 };
    this.mats = {
      cyan: new THREE.MeshStandardMaterial({ color: 0x9ff4ff, emissive: 0x1fb4e6, emissiveIntensity: 1.6, ...gem }),
      magenta: new THREE.MeshStandardMaterial({ color: 0xf0a8ff, emissive: 0xb03ad6, emissiveIntensity: 1.5, ...gem }),
      ice: new THREE.MeshStandardMaterial({ color: 0xd9f3ff, emissive: 0x2a7fb0, emissiveIntensity: 0.35, flatShading: true, roughness: 0.12, metalness: 0.05 }),
      obsidian: new THREE.MeshStandardMaterial({ color: 0x16121a, flatShading: true, roughness: 0.22, metalness: 0.5 }),
    };
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
    // Heights with a one-vertex border so normals match across tile seams; biome data for the inside.
    const H = new Float32Array(W * W);
    const BW = new Float32Array(N * N * 4);
    const LV = new Float32Array(N * N);
    const s = newSample();
    for (let b = 0; b < W; b++) {
      for (let a = 0; a < W; a++) {
        sampleTerrain(x0 + (a - 1) * STEP, z0 + (b - 1) * STEP, s);
        H[b * W + a] = s.h;
        if (a >= 1 && a <= N && b >= 1 && b <= N) {
          const k = (b - 1) * N + (a - 1);
          BW.set(s.w, k * 4);
          LV[k] = s.lava;
        }
      }
    }
    const pos = new Float32Array(N * N * 3);
    const nor = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const glow = new Float32Array(N * N);
    const c = new THREE.Color();
    const w = new Float32Array(4);
    for (let b = 0; b < N; b++) {
      for (let a = 0; a < N; a++) {
        const k = b * N + a, k3 = k * 3;
        const h = H[(b + 1) * W + a + 1];
        const dx = H[(b + 1) * W + a + 2] - H[(b + 1) * W + a];
        const dz = H[(b + 2) * W + a + 1] - H[b * W + a + 1];
        const len = Math.hypot(dx, 2 * STEP, dz);
        nor[k3] = -dx / len; nor[k3 + 1] = (2 * STEP) / len; nor[k3 + 2] = -dz / len;
        pos[k3] = a * STEP; pos[k3 + 1] = h; pos[k3 + 2] = b * STEP;
        w.set(BW.subarray(k * 4, k * 4 + 4));
        glow[k] = biomeColor(c, w, h, nor[k3 + 1], x0 + a * STEP, z0 + b * STEP, LV[k]);
        col[k3] = c.r; col[k3 + 1] = c.g; col[k3 + 2] = c.b;
      }
    }
    const idx = new Uint16Array(RES * RES * 6);
    let t = 0;
    for (let b = 0; b < RES; b++) {
      for (let a = 0; a < RES; a++) {
        const p = b * N + a, q = p + 1, r = p + N, u = r + 1;
        idx[t++] = p; idx[t++] = r; idx[t++] = q;
        idx[t++] = q; idx[t++] = r; idx[t++] = u;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
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

  /** Boulders everywhere, plus each biome's signature features up on the slopes. */
  addDecor(group, i, j, x0, z0) {
    const r = rng(hash2(i, j));
    const s = newSample();
    const pick = (w) => {
      const u = r();
      let acc = 0;
      for (let b = 0; b < 4; b++) {
        acc += w[b];
        if (u <= acc) return b;
      }
      return RED;
    };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
    const place = (list, x, y, z, sx, sy, sz, rx, ry, rz) => list.push([x - x0, y, z - z0, sx, sy, sz, rx, ry, rz]);

    const rocks = [], rockColors = [];
    for (let k = 0; k < 34; k++) {
      const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK;
      sampleTerrain(x, z, s);
      const biome = pick(s.w);
      const size = s.wall < 0.15 ? 0.8 + r() * 2 : 2 + r() * r() * 12;
      const rx = r() * 6.28, ry = r() * 6.28, rz = r() * 6.28, squash = 0.6 + r() * 0.5, tone = r();
      if (s.lava > 0.2) continue;
      place(rocks, x, s.h - size * 0.25, z, size, size * squash, size, rx, ry, rz);
      rockColors.push(c.copy(BIOME_ROCK[biome][0]).lerp(BIOME_ROCK[biome][1], tone).clone());
    }

    const feats = { cyan: [], magenta: [], ice: [], obsidian: [] };
    for (let k = 0; k < 16; k++) {
      const x = x0 + r() * CHUNK, z = z0 + r() * CHUNK;
      sampleTerrain(x, z, s);
      const biome = pick(s.w), roll = r();
      if (s.wall < 0.25 || s.lava > 0.1) continue;
      const tilt = () => (r() - 0.5) * 0.4;
      if (biome === RED && roll < 0.45) {
        for (let n = 0; n < 3; n++) {
          const size = 3 + r() * 7;
          place(feats.cyan, x + (r() - 0.5) * 8, s.h + size * 0.8, z + (r() - 0.5) * 8, size * 0.35, size * 1.8, size * 0.35, tilt(), r() * 6.28, tilt());
        }
      } else if (biome === FROST) {
        const size = 8 + r() * 22;
        place(feats.ice, x, s.h - 2, z, size * 0.22, size, size * 0.22, tilt() * 0.5, r() * 6.28, tilt() * 0.5);
      } else if (biome === VOLCANIC) {
        for (let n = 0; n < 2; n++) {
          const size = 4 + r() * 12;
          place(feats.obsidian, x + (r() - 0.5) * 10, s.h - 1, z + (r() - 0.5) * 10, size * 0.3, size, size * 0.3, tilt(), r() * 6.28, tilt());
        }
      } else if (biome === CRYSTAL && roll < 0.55) {
        const list = r() < 0.5 ? feats.cyan : feats.magenta;
        for (let n = 0, count = 1 + Math.floor(r() * 2); n < count; n++) {
          const size = 10 + r() * 30;
          place(list, x + (r() - 0.5) * 16, s.h + size * 0.5, z + (r() - 0.5) * 16, size * 0.3, size * 1.4, size * 0.3, tilt(), r() * 6.28, tilt());
        }
      }
    }

    const instanced = (list, geo, mat, colors) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, y, z, sx, sy, sz, rx, ry, rz], n) => {
        im.setMatrixAt(n, m.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), sc.set(sx, sy, sz)));
        if (colors) im.setColorAt(n, colors[n]);
      });
      im.receiveShadow = true;
      group.add(im);
    };
    instanced(rocks, this.rockGeo, this.rockMat, rockColors);
    instanced(feats.cyan, this.crystalGeo, this.mats.cyan);
    instanced(feats.magenta, this.crystalGeo, this.mats.magenta);
    instanced(feats.ice, this.spikeGeo, this.mats.ice);
    instanced(feats.obsidian, this.spikeGeo, this.mats.obsidian);
  }
}
