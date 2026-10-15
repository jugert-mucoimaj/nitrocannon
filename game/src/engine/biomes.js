// The four biomes: where they are (very low-frequency noise), how the ground is coloured, and the
// sky/light each one brings. Weights blend smoothly so borders fade over a few hundred metres.
import * as THREE from 'three';
import { noise, smoothstep } from './noise.js';

export const RED = 0, FROST = 1, VOLCANIC = 2, CRYSTAL = 3;

const C = (hex) => new THREE.Color(hex);

export const BIOMES = [
  {
    name: 'Red Canyon',
    sky: ['#1d3577', '#ffb487', '#d48a66'], sun: ['#ffd8b4', 2.8], hemi: ['#c6d8ff', '#d08a5e'], fog: 1,
  },
  {
    name: 'Frost Wastes',
    sky: ['#2f5d9e', '#d6e6f4', '#b4c8dc'], sun: ['#f2f6ff', 2.5], hemi: ['#dbe8ff', '#9fb3c8'], fog: 0.85,
  },
  {
    name: 'Volcanic Badlands',
    sky: ['#26141c', '#b4573a', '#5a2a22'], sun: ['#ff9a6a', 1.7], hemi: ['#8a5a6a', '#4a2018'], fog: 0.7,
  },
  {
    name: 'Crystal Fields',
    sky: ['#170d3c', '#b07ad8', '#6a4a9a'], sun: ['#e9d2ff', 2.2], hemi: ['#b9a6ff', '#4a3a7a'], fog: 0.95,
  },
].map((b) => ({
  ...b,
  top: C(b.sky[0]), horizon: C(b.sky[1]), below: C(b.sky[2]),
  sunColor: C(b.sun[0]), sunIntensity: b.sun[1], hemiSky: C(b.hemi[0]), hemiGround: C(b.hemi[1]),
}));

/** Live sky colours. The sky shader reads these objects; the engine blends them every frame. */
export const ATMOS = { top: BIOMES[RED].top.clone(), horizon: BIOMES[RED].horizon.clone(), below: BIOMES[RED].below.clone() };

// Each biome owns a direction in a 2-D "biome space" sampled from very low-frequency noise,
// so each covers roughly a quarter of the world in blobs a few kilometres across.
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const SCALE = 1 / 5200;

/** Blend weights of the four biomes at a world point (they sum to 1). The start area is always Red Canyon. */
export function biomeWeights(x, z, out) {
  const a = noise(x * SCALE, z * SCALE, 101.3);
  const b = noise(x * SCALE + 40.7, z * SCALE - 13.1, 57.9);
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const d = Math.max(0, a * DIRS[i][0] + b * DIRS[i][1]);
    out[i] = d * d * d;
    sum += out[i];
  }
  out[RED] += 0.0004; // calm spots of biome space default to the canyon
  sum += 0.0004;
  for (let i = 0; i < 4; i++) out[i] /= sum;
  const home = smoothstep(2800, 1400, Math.hypot(x, z));
  if (home > 0) for (let i = 0; i < 4; i++) out[i] = out[i] * (1 - home) + (i === RED ? home : 0);
  return out;
}

export const dominant = (w) => {
  let best = 0;
  for (let i = 1; i < 4; i++) if (w[i] > w[best]) best = i;
  return best;
};

const PAL = {
  sandA: C('#e6b075'), sandB: C('#c98a52'), rockA: C('#a85a3b'), rockB: C('#6a3427'), snow: C('#f6ede3'),
  frostA: C('#eef4fa'), frostB: C('#d3e0ec'), iceA: C('#a6cde3'), iceB: C('#5f7a90'),
  ashA: C('#3d3637'), ashB: C('#292325'), basaltA: C('#1d191b'), basaltB: C('#55302a'), crack: C('#ff5a1a'),
  lavaA: C('#e8480c'), lavaB: C('#ffa22a'), crust: C('#2a0e08'),
  cryA: C('#43316e'), cryB: C('#245866'), cryRockA: C('#62449a'), cryRockB: C('#1f7480'), vein: C('#8ff6ff'),
};

/** Boulder colours per biome: [light, dark]. */
export const BIOME_ROCK = [
  [PAL.rockA, PAL.rockB],
  [C('#c9d6e2'), C('#7d8e9e')],
  [C('#2a2426'), C('#141113')],
  [C('#4b3a7a'), C('#20545e')],
];

/** Accent glow per biome (monolith runes, orbs). */
export const BIOME_ACCENT = [C('#5ff2ff'), C('#8fd8ff'), C('#ff7a2a'), C('#e08bff')];

const _t = new THREE.Color(), _u = new THREE.Color();

function add(out, c, w) {
  out.r += c.r * w;
  out.g += c.g * w;
  out.b += c.b * w;
}

/**
 * Ground colour at a terrain vertex. Returns its glow (0..1): lava, volcanic cracks and crystal
 * veins light up on their own (the terrain shader adds colour × glow as emission).
 */
export function biomeColor(out, w, h, ny, x, z, lava) {
  const v = noise(x * 0.018, z * 0.018, 5.5) * 0.5 + 0.5;
  const steep = smoothstep(0.93, 0.72, ny);
  out.setRGB(0, 0, 0);
  let glow = 0, total = 0;
  if (w[RED] > 0.01) {
    _t.copy(PAL.sandA).lerp(PAL.sandB, v);
    _u.copy(PAL.rockA).lerp(PAL.rockB, (Math.sin(h * 0.12 + v * 2) * 0.5 + 0.5) * 0.7 + v * 0.3);
    _t.lerp(_u, steep).lerp(PAL.snow, smoothstep(230, 290, h) * smoothstep(0.55, 0.8, ny));
    add(out, _t, w[RED]);
    total += w[RED];
  }
  if (w[FROST] > 0.01) {
    _t.copy(PAL.frostA).lerp(PAL.frostB, v);
    _u.copy(PAL.iceA).lerp(PAL.iceB, Math.sin(h * 0.09 + v * 3) * 0.5 + 0.5);
    _t.lerp(_u, steep);
    add(out, _t, w[FROST]);
    total += w[FROST];
  }
  if (w[VOLCANIC] > 0.01) {
    _t.copy(PAL.ashA).lerp(PAL.ashB, v);
    _u.copy(PAL.basaltA).lerp(PAL.basaltB, Math.sin(h * 0.15 + v * 2) * 0.5 + 0.5);
    _t.lerp(_u, steep);
    const crack = smoothstep(0.035, 0, Math.abs(noise(x * 0.012, z * 0.012, 31.7))) * smoothstep(0.6, 0.85, ny);
    _t.lerp(PAL.crack, crack);
    add(out, _t, w[VOLCANIC]);
    total += w[VOLCANIC];
    glow += w[VOLCANIC] * crack * 0.9;
  }
  if (w[CRYSTAL] > 0.01) {
    _t.copy(PAL.cryA).lerp(PAL.cryB, v);
    _u.copy(PAL.cryRockA).lerp(PAL.cryRockB, Math.sin(h * 0.2) * 0.5 + 0.5);
    _t.lerp(_u, steep);
    const vein = smoothstep(0.03, 0, Math.abs(noise(x * 0.01, z * 0.01, 77.1)));
    _t.lerp(PAL.vein, vein);
    add(out, _t, w[CRYSTAL]);
    total += w[CRYSTAL];
    glow += w[CRYSTAL] * vein * 0.8;
  }
  out.multiplyScalar(1 / Math.max(total, 1e-4));
  if (lava > 0) {
    // Molten channels between patches of dark, cooled crust.
    const crust = smoothstep(-0.05, -0.35, noise(x * 0.018, z * 0.018, 44.4));
    _t.copy(PAL.lavaA).lerp(PAL.lavaB, smoothstep(0, 0.45, noise(x * 0.03, z * 0.03, 12.3))).lerp(PAL.crust, crust);
    out.lerp(_t, lava);
    glow = Math.max(glow, lava * (1 - crust * 0.85));
  }
  return glow;
}
