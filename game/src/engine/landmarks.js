// Procedural landmarks for Explore: crashed ships, monolith circles, stone arches and floating isles.
// build() returns the meshes plus plain data the explorer uses for collisions, pickups and discovery.
import * as THREE from 'three';
import { groundHeight, maxGround, noise, rng } from './world.js';
import { BIOME_ROCK, BIOME_ACCENT } from './biomes.js';
import { glowTexture } from './effects.js';

const TYPES = ['wreck', 'monolith', 'arch', 'isle'];
export const LANDMARK_NAMES = { wreck: 'Wreck', monolith: 'Monolith Circle', arch: 'Stone Arch', isle: 'Floating Isle' };

// How likely each type is per biome (red, frost, volcanic, crystal); each column sums to 1.
const TYPE_WEIGHTS = {
  wreck: [0.3, 0.35, 0.35, 0.2],
  monolith: [0.15, 0.25, 0.15, 0.35],
  arch: [0.35, 0.15, 0.3, 0.15],
  isle: [0.2, 0.25, 0.2, 0.3],
};

export function pickLandmarkType(biome, u) {
  let acc = 0;
  for (const t of TYPES) {
    acc += TYPE_WEIGHTS[t][biome];
    if (u <= acc) return t;
  }
  return 'isle';
}

const ISLE_CAP = ['#b98a4a', '#f2f6fa', '#3a3233', '#5a3f8f'].map((c) => new THREE.Color(c));

/** Displace a geometry's vertices with smooth noise (shared vertices move together, so no cracks). */
function roughen(geo, amount, freq, seed, keep = () => false) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (keep(x, y, z)) continue;
    p.setXYZ(
      i,
      x + noise(x * freq + seed, y * freq, z * freq) * amount,
      y + noise(x * freq, y * freq + seed, z * freq + 7.1) * amount,
      z + noise(x * freq + 3.3, y * freq, z * freq + seed) * amount,
    );
  }
  geo.computeVertexNormals();
  return geo;
}

export class LandmarkKit {
  constructor({ shipTemplates, shipNames }) {
    this.shipTemplates = shipTemplates;
    this.shipNames = shipNames;
    this.burnt = new Map();
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.orbGeo = new THREE.IcosahedronGeometry(4.5, 1);
    this.gemGeo = new THREE.OctahedronGeometry(1, 0);
    this.stoneMat = new THREE.MeshStandardMaterial({ color: 0x2b2830, roughness: 0.85, flatShading: true });
    this.runeMats = BIOME_ACCENT.map((color) => new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    this.rockMats = BIOME_ROCK.map(([color]) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }));
    this.isleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const additive = { map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
    this.glowMats = BIOME_ACCENT.map((color) => new THREE.SpriteMaterial({ color, opacity: 0.6, ...additive }));
    this.fireMat = new THREE.SpriteMaterial({ color: 0xff7a2a, opacity: 0.75, ...additive });
  }

  build(spec) {
    const r = rng(spec.seed);
    const lm = this[spec.type](spec, r);
    return {
      id: spec.id, type: spec.type, biome: spec.biome, x: spec.x, z: spec.z,
      geometries: [], obstacles: [], surfaces: [], gates: [], orb: null, smoke: null, update: () => {},
      ...lm,
    };
  }

  /** A UFO hanging around this landmark; `noBeam` for ones floating high above the ground. */
  ufo(spec, k, x, y, z, noBeam = false) {
    return { id: `${spec.id}:u${k}`, x, y, z, g: noBeam ? y : groundHeight(x, z), phase: k + (spec.seed % 7), taken: false, noBeam };
  }

  burntMaterial(m) {
    if (!this.burnt.has(m)) {
      const b = m.clone();
      b.color?.multiplyScalar(0.28);
      b.emissive?.setRGB(0, 0, 0);
      b.roughness = 1;
      b.metalness = Math.min(b.metalness ?? 0, 0.3);
      this.burnt.set(m, b);
    }
    return this.burnt.get(m);
  }

  /** One of the playable ships, crashed: scaled up, scorched, nose in the dirt, still burning. */
  wreck(spec, r) {
    const k = Math.floor(r() * this.shipTemplates.length);
    const g = groundHeight(spec.x, spec.z);
    const hull = this.shipTemplates[k].clone(true);
    hull.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.collision) {
        o.visible = false;
        return;
      }
      o.material = Array.isArray(o.material) ? o.material.map((m) => this.burntMaterial(m)) : this.burntMaterial(o.material);
      o.castShadow = true;
    });
    hull.scale.setScalar(2.2);
    hull.position.set(spec.x, g + 1.5, spec.z);
    hull.rotation.set(-0.2 - r() * 0.2, spec.yaw, (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.5));
    const fire = new THREE.Sprite(this.fireMat);
    fire.position.set(spec.x, g + 4, spec.z);
    const ux = spec.x + Math.cos(spec.yaw) * 24, uz = spec.z - Math.sin(spec.yaw) * 24;
    return {
      name: `Crashed ${this.shipNames[k]}`,
      objects: [hull, fire],
      obstacles: [{ x: spec.x, z: spec.z, r: 13, bottom: g - 5, top: g + 9 }],
      ufos: [this.ufo(spec, 0, ux, groundHeight(ux, uz) + 16, uz)],
      smoke: new THREE.Vector3(spec.x, g + 6, spec.z),
      update: (t) => fire.scale.setScalar(24 + Math.sin(t * 9 + spec.seed) * 3 + Math.sin(t * 23) * 1.5),
    };
  }

  /** A ring of rune-lit slabs around a hovering energy orb (fly through it for a nitro refill). */
  monolith(spec, r) {
    const n = 9, R = 34 + r() * 8;
    const objects = [], obstacles = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + spec.yaw;
      const px = spec.x + Math.cos(a) * R, pz = spec.z + Math.sin(a) * R;
      const g = groundHeight(px, pz), h = 22 + r() * 14;
      const slab = new THREE.Mesh(this.box, this.stoneMat);
      slab.scale.set(5.5, h, 2.6);
      slab.position.set(px, g + h / 2 - 2, pz);
      slab.rotation.set((r() - 0.5) * 0.12, Math.PI / 2 - a, (r() - 0.5) * 0.12); // broad side faces the centre
      slab.castShadow = slab.receiveShadow = true;
      const rune = new THREE.Mesh(this.box, this.runeMats[spec.biome]);
      rune.scale.set(0.9, h * 0.55, 2.8);
      rune.position.copy(slab.position);
      rune.position.y += h * 0.08;
      rune.rotation.copy(slab.rotation);
      objects.push(slab, rune);
      obstacles.push({ x: px, z: pz, r: 4, bottom: g - 3, top: g + h - 2 });
    }
    const center = new THREE.Vector3(spec.x, groundHeight(spec.x, spec.z) + 22, spec.z);
    const orb = new THREE.Mesh(this.orbGeo, this.runeMats[spec.biome]);
    const glow = new THREE.Sprite(this.glowMats[spec.biome]);
    glow.scale.setScalar(34);
    orb.position.copy(center);
    glow.position.copy(center);
    objects.push(orb, glow);
    return {
      name: 'Monolith Circle',
      objects,
      obstacles,
      orb: { pos: center, ready: 0 },
      ufos: [this.ufo(spec, 0, spec.x, center.y + 26, spec.z, true)],
      update: (t) => {
        orb.position.y = glow.position.y = center.y + Math.sin(t * 1.2 + spec.seed) * 2;
        orb.rotation.y = t * 0.6;
      },
    };
  }

  /** A huge natural arch. Threading it gives a boost. */
  arch(spec, r) {
    const R = 55 + r() * 25, tube = 9 + r() * 4;
    const geo = roughen(new THREE.TorusGeometry(R, tube, 7, 22, Math.PI), 2.6, 0.07, spec.seed % 97);
    const ca = Math.cos(spec.yaw), sa = Math.sin(spec.yaw);
    const feet = [[spec.x + ca * R, spec.z - sa * R], [spec.x - ca * R, spec.z + sa * R]];
    const base = Math.min(groundHeight(...feet[0]), groundHeight(...feet[1]), groundHeight(spec.x, spec.z)) - 5;
    const mesh = new THREE.Mesh(geo, this.rockMats[spec.biome]);
    mesh.position.set(spec.x, base, spec.z);
    mesh.rotation.y = spec.yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    return {
      name: 'Stone Arch',
      objects: [mesh],
      geometries: [geo],
      obstacles: feet.map(([x, z]) => ({ x, z, r: tube + 2, bottom: base - 5, top: base + R * 0.5 })),
      gates: [{ center: new THREE.Vector3(spec.x, base, spec.z), normal: new THREE.Vector3(sa, 0, ca), radius: R - tube - 1, minY: base + 4, ready: 0 }],
      ufos: [this.ufo(spec, 0, spec.x, base + R * 0.45, spec.z, true)],
    };
  }

  /** A chunk of ground floating high above the terrain. You can land on top; UFOs circle it. */
  isle(spec, r) {
    const rad = 24 + r() * 14, depth = 38 + r() * 20;
    const top = maxGround(spec.x, spec.z, rad) + 140 + r() * 90;
    const geo = new THREE.CylinderGeometry(rad, rad * 0.12, depth, 10, 5).translate(0, -depth / 2, 0);
    roughen(geo, 5, 0.06, spec.seed % 89, (x, y) => y > -0.5); // keep the top flat
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const cap = ISLE_CAP[spec.biome], [rockA, rockB] = BIOME_ROCK[spec.biome];
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > -0.5) c.copy(cap);
      else c.copy(rockA).lerp(rockB, Math.min(1, -y / depth + 0.2));
      c.toArray(col, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, this.isleMat);
    mesh.position.set(spec.x, top, spec.z);
    mesh.castShadow = mesh.receiveShadow = true;
    const objects = [mesh];
    for (let k = 0, n = 2 + Math.floor(r() * 3); k < n; k++) {
      const a = r() * Math.PI * 2, d = r() * rad * 0.6, size = 2 + r() * 4;
      const gem = new THREE.Mesh(this.gemGeo, this.runeMats[spec.biome]);
      gem.scale.set(size * 0.4, size * 1.6, size * 0.4);
      gem.position.set(spec.x + Math.cos(a) * d, top + size * 0.9, spec.z + Math.sin(a) * d);
      gem.rotation.set((r() - 0.5) * 0.5, r() * 6.28, (r() - 0.5) * 0.5);
      objects.push(gem);
    }
    const orbit = rad + 18, spin = 0.35;
    const ufos = [0, 1].map((k) => this.ufo(spec, k, spec.x, top + 14, spec.z, true));
    return {
      name: 'Floating Isle',
      objects,
      geometries: [geo],
      surfaces: [{ x: spec.x, z: spec.z, r: rad * 0.9, top }],
      obstacles: [{ x: spec.x, z: spec.z, r: rad * 0.85, bottom: top - depth * 0.7, top: top - 2 }],
      ufos,
      update: (t) => {
        for (const [k, u] of ufos.entries()) {
          const a = t * spin + k * Math.PI;
          u.x = spec.x + Math.cos(a) * orbit;
          u.z = spec.z + Math.sin(a) * orbit;
          u.vx = -Math.sin(a) * orbit * spin; // velocity, so the laser assist can lead them
          u.vz = Math.cos(a) * orbit * spin;
        }
      },
    };
  }
}
