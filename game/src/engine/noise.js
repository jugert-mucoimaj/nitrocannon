// Shared math helpers: Perlin noise, fractal noise, easing and a seeded RNG.
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

const perlin = new ImprovedNoise();
export const noise = (x, y, z = 0) => perlin.noise(x, y, z);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function fbm(x, z, octaves, seed) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, z * freq, seed + i * 17.31);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

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
