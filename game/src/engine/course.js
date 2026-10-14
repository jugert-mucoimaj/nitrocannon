// Things placed along the canyon: pylons, boost rings, rock spires, UFO collectibles and the start/finish gates.
// Content is generated per 200 m segment ahead of the player and dropped once it is behind.
import * as THREE from 'three';
import { courseX, groundHeight, maxGround, noise, rng, clamp } from './world.js';
import { RACE_LENGTH } from './config.js';
import { sweepCollect } from './ufos.js';

const SEG = 200;
const SPIRE_HP = 8; // laser hits to bring one down
const VIEW_BEHIND = 250;
const VIEW_AHEAD = 1700;

function bannerTexture(text) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 96;
  const g = c.getContext('2d');
  const sq = 12;
  for (let x = 0; x < c.width / sq; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#141414' : '#f4f4f4';
      g.fillRect(x * sq, y * sq, sq, sq);
      g.fillRect(x * sq, c.height - (y + 1) * sq, sq, sq);
    }
  }
  g.fillStyle = '#0d1022';
  g.fillRect(0, 24, c.width, 48);
  g.fillStyle = '#ffffff';
  g.font = '900 40px Orbitron, "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = '14px';
  g.fillText(text, c.width / 2, 49);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Course {
  constructor(scene, swarm) {
    this.scene = scene;
    this.swarm = swarm;
    this.segments = new Map();
    this.rings = [];
    this.spires = [];
    this.statics = [];

    this.pylonGeo = new THREE.CylinderGeometry(0.5, 0.9, 18, 6).translate(0, 9, 0);
    this.pylonMat = new THREE.MeshStandardMaterial({ color: 0x2b303d, roughness: 0.45, metalness: 0.6, flatShading: true });
    this.capGeo = new THREE.OctahedronGeometry(1.3, 0);
    this.capMats = [0x5ff2ff, 0xff9d3d].map((color) => new THREE.MeshBasicMaterial({ color, toneMapped: false }));

    this.ringGeo = new THREE.TorusGeometry(10, 0.75, 10, 48);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xff7a2f, toneMapped: false });
    this.ringDiscGeo = new THREE.CircleGeometry(9.3, 40);
    this.ringDiscMat = new THREE.MeshBasicMaterial({
      color: 0xff8a3d, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
    });

    this.spireMat = new THREE.MeshStandardMaterial({ color: 0x9a5236, flatShading: true, roughness: 0.9 });
    this.beaconGeo = new THREE.SphereGeometry(1.2, 10, 8);
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, toneMapped: false });

    for (const [z, label] of [[60, 'START'], [RACE_LENGTH, 'FINISH']]) this.addStatic(this.makeGate(z, label));
  }

  /** Start/finish gates are hidden while exploring. */
  setVisible(on) {
    for (const o of this.statics) o.visible = on;
  }

  ufoLists() {
    return [...this.segments.values()].map((seg) => seg.ufos);
  }

  collect(a, b, radius) {
    return sweepCollect(this.ufoLists(), a, b, radius);
  }

  /** Shot to pieces: remove the spire's meshes and its collision. */
  destroySpire(sp) {
    for (const m of sp.meshes) this.scene.remove(m);
    const seg = this.segments.get(sp.seg);
    if (seg) seg.spires = seg.spires.filter((x) => x !== sp);
    this.spires = this.spires.filter((x) => x !== sp);
  }

  addStatic(o) {
    this.scene.add(o);
    this.statics.push(o);
    return o;
  }

  dispose() {
    this.reset();
    for (const o of this.statics) this.scene.remove(o);
    this.statics = [];
  }

  makeGate(z, label) {
    const group = new THREE.Group();
    const cx = courseX(z), half = 120;
    let base = -Infinity;
    for (let x = cx - half; x <= cx + half; x += 8) base = Math.max(base, groundHeight(x, z));
    const top = base + 72;
    const frame = new THREE.MeshStandardMaterial({ color: 0x1d2230, metalness: 0.7, roughness: 0.35 });
    const strip = new THREE.MeshBasicMaterial({ color: label === 'FINISH' ? 0xff9d3d : 0x5ff2ff, toneMapped: false });
    for (const side of [-1, 1]) {
      const x = cx + side * half, g = groundHeight(x, z) - 4, h = top - g;
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(8, h, 8), frame);
      pillar.position.set(x, g + h / 2, z);
      const light = new THREE.Mesh(new THREE.BoxGeometry(1.2, h * 0.92, 8.4), strip);
      light.position.set(x - side * 4.2, g + h / 2, z);
      group.add(pillar, light);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 8, 8, 8), frame);
    beam.position.set(cx, top + 4, z);
    const w = half * 2 - 16;
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(w, (w * 96) / 1024),
      new THREE.MeshBasicMaterial({ map: bannerTexture(label), side: THREE.DoubleSide, toneMapped: false }),
    );
    banner.rotation.y = Math.PI; // face the racers coming from -Z
    banner.position.set(cx, top - 12, z);
    group.add(beam, banner);
    return group;
  }

  reset() {
    for (const s of [...this.segments.keys()]) this.removeSegment(s);
    this.rings = [];
    this.spires = [];
  }

  update(t, focusZ) {
    const sMin = Math.max(0, Math.floor((focusZ - VIEW_BEHIND) / SEG));
    const sMax = Math.floor((focusZ + VIEW_AHEAD) / SEG);
    let changed = false;
    for (const s of [...this.segments.keys()]) {
      if (s < sMin || s > sMax + 1) {
        this.removeSegment(s);
        changed = true;
      }
    }
    for (let s = sMin; s <= sMax; s++) {
      if (!this.segments.has(s)) {
        this.spawnSegment(s);
        changed = true;
      }
    }
    if (changed) {
      this.rings = [];
      this.spires = [];
      for (const seg of this.segments.values()) {
        this.rings.push(...seg.rings);
        this.spires.push(...seg.spires);
      }
    }
    this.ringDiscMat.opacity = 0.1 + 0.07 * Math.sin(t * 6);
    for (const ring of this.rings) ring.mesh.scale.setScalar(1 + 0.03 * Math.sin(t * 6 + ring.z));
    this.swarm.draw(t, this.ufoLists());
  }

  removeSegment(s) {
    const seg = this.segments.get(s);
    for (const o of seg.objects) this.scene.remove(o);
    for (const g of seg.geometries) g.dispose();
    this.segments.delete(s);
  }

  spawnSegment(s) {
    const r = rng(Math.imul(s + 1, 2654435761) ^ 0x9e3779b9);
    const z0 = s * SEG;
    const seg = { objects: [], geometries: [], rings: [], spires: [], ufos: [] };
    const add = (o) => {
      this.scene.add(o);
      seg.objects.push(o);
      return o;
    };

    // Track-edge pylons: cyan on the left, orange on the right.
    for (const dz of [0, 100]) {
      const z = z0 + dz, cx = courseX(z);
      for (const side of [1, -1]) {
        const x = cx + side * 95, g = groundHeight(x, z);
        add(new THREE.Mesh(this.pylonGeo, this.pylonMat)).position.set(x, g - 1, z);
        add(new THREE.Mesh(this.capGeo, this.capMats[side > 0 ? 0 : 1])).position.set(x, g + 18.5, z);
      }
    }
    if (s < 1) {
      this.segments.set(s, seg);
      return;
    }

    // Rock spires to weave around.
    if (s >= 2 && r() < 0.6) {
      const n = r() < 0.35 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const z = z0 + 20 + r() * 160, x = courseX(z) + (r() - 0.5) * 170;
        const radius = 4 + r() * 4, h = 45 + r() * 55, g = groundHeight(x, z) - 3;
        const geo = new THREE.CylinderGeometry(radius * 0.5, radius, h, 7, 6).translate(0, h / 2, 0);
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const j = 1 + noise(p.getY(i) * 0.08, s * 1.37 + k, 0.5) * 0.45;
          p.setX(i, p.getX(i) * j);
          p.setZ(i, p.getZ(i) * j);
        }
        geo.computeVertexNormals();
        const mesh = add(new THREE.Mesh(geo, this.spireMat));
        mesh.position.set(x, g, z);
        mesh.castShadow = mesh.receiveShadow = true;
        const beacon = add(new THREE.Mesh(this.beaconGeo, this.beaconMat));
        beacon.position.set(x, g + h + 0.8, z);
        seg.geometries.push(geo);
        seg.spires.push({ x, z, r: radius, base: g, top: g + h, hp: SPIRE_HP, seg: s, meshes: [mesh, beacon] });
      }
    }

    // Boost ring every third segment.
    if (s % 3 === 1) {
      const z = z0 + 110;
      let x = courseX(z) + (r() - 0.5) * 70;
      for (const sp of seg.spires) {
        if (Math.abs(sp.z - z) < 30 && Math.abs(sp.x - x) < sp.r + 16) x = sp.x + Math.sign(x - sp.x || 1) * (sp.r + 18);
      }
      const y = maxGround(x, z, 14) + 18 + r() * 14;
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(this.ringGeo, this.ringMat), new THREE.Mesh(this.ringDiscGeo, this.ringDiscMat));
      mesh.position.set(x, y, z);
      add(mesh);
      seg.rings.push({ x, y, z, radius: 10, mesh, hit: new Set() });
    }

    this.placeUfos(seg, z0, r);
    this.segments.set(s, seg);
  }

  placeUfos(seg, z0, r) {
    const spots = [];
    const roll = r();
    const zBase = z0 + 30 + r() * 120;
    if (roll < 0.45) {
      // a trail down the canyon
      const lat = (r() - 0.5) * 130, alt = 12 + r() * 18;
      for (let k = 0; k < 5; k++) {
        const z = zBase + k * 24;
        spots.push([courseX(z) + lat, z, alt]);
      }
    } else if (roll < 0.82) {
      // a V across the canyon
      const lat = (r() - 0.5) * 60, alt = 14 + r() * 14;
      for (let k = -2; k <= 2; k++) {
        const z = zBase + Math.abs(k) * 10;
        spots.push([courseX(z) + lat + k * 17, z, alt + Math.abs(k) * 3]);
      }
    } else {
      // a high bonus stack: worth the climb
      const lat = (r() - 0.5) * 120;
      for (let k = 0; k < 3; k++) {
        const z = zBase + k * 30;
        spots.push([courseX(z) + lat, z, 55 + k * 10]);
      }
    }
    for (const [x, z, alt] of spots) {
      if (seg.spires.some((sp) => Math.hypot(sp.x - x, sp.z - z) < sp.r + 9)) continue;
      seg.ufos.push({ x, y: maxGround(x, z, 10) + alt, z, g: groundHeight(x, z), phase: r() * 6.28, taken: false });
    }
  }

  /** Boost ring crossed by this racer during the last step, if any. */
  ringPass(racer) {
    for (const ring of this.rings) {
      if (ring.hit.has(racer) || racer.prev.z >= ring.z || racer.pos.z < ring.z) continue;
      const dx = racer.pos.x - ring.x, dy = racer.pos.y - ring.y;
      if (dx * dx + dy * dy < (ring.radius + 1.5) ** 2) {
        ring.hit.add(racer);
        return ring;
      }
    }
    return null;
  }

  hitSpire(pos, rad) {
    for (const sp of this.spires) {
      const dz = pos.z - sp.z;
      if (Math.abs(dz) > sp.r + rad || pos.y > sp.top) continue;
      const k = clamp((pos.y - sp.base) / (sp.top - sp.base), 0, 1);
      const rr = sp.r * (1 - 0.45 * k) + rad;
      const dx = pos.x - sp.x;
      if (dx * dx + dz * dz < rr * rr) return { sp, dx, dz, rr };
    }
    return null;
  }
}
