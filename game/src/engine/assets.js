// Loads all GLBs in parallel with byte-accurate progress. Memoized so React StrictMode's
// double effect doesn't download everything twice.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SHIPS, UFO_URL } from './config.js';

let pending = null;

export function loadAssets(onProgress) {
  if (pending) return pending;
  const loader = new GLTFLoader();
  const urls = [...SHIPS.map((s) => s.url), UFO_URL];
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
  pending = Promise.all([models, font]).then(([gltfs]) => ({
    ships: gltfs.slice(0, SHIPS.length),
    ufo: gltfs[SHIPS.length],
  }));
  return pending;
}
