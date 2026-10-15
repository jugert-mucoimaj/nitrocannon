// Loads all GLBs in parallel with byte-accurate progress. Memoized so React StrictMode's
// double effect doesn't download everything twice.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SHIPS, HAULER, PHOENIX, UFO_URL, PROP_URLS } from './config.js';

let pending = null;

export function loadAssets(onProgress) {
  if (pending) return pending;
  const loader = new GLTFLoader();
  const propNames = Object.keys(PROP_URLS);
  const urls = [...SHIPS.map((s) => s.url), HAULER.url, PHOENIX.url, UFO_URL, ...propNames.map((n) => PROP_URLS[n])];
  const progress = urls.map(() => ({ loaded: 0, total: 0 }));
  const report = () => {
    let loaded = 0, total = 0;
    for (const p of progress) {
      loaded += p.loaded;
      total += p.total;
    }
    onProgress?.(loaded, total);
  };
  const models = Promise.all(
    urls.map((url, i) =>
      loader.loadAsync(url, (e) => {
        progress[i].loaded = e.loaded;
        progress[i].total = e.total || e.loaded;
        report();
      }),
    ),
  );
  // The finish-line banner is drawn on a canvas with Orbitron, so wait for the font too.
  const font = document.fonts?.load('900 40px Orbitron').catch(() => {}) ?? Promise.resolve();
  pending = Promise.all([models, font]).then(([gltfs]) => {
    let k = 0;
    const ships = gltfs.slice(k, (k += SHIPS.length));
    const hauler = gltfs[k++], phoenix = gltfs[k++], ufo = gltfs[k++];
    const props = Object.fromEntries(propNames.map((n) => [n, gltfs[k++]]));
    return { ships, hauler, phoenix, ufo, props };
  });
  return pending;
}
