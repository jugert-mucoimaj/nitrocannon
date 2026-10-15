// Race tuning and ship definitions. All models are the normalized GLBs:
// 10 m on the longest side, pivot at the centre, nose along +Z, up +Y.
import dusterUrl from '../../../normalized/duster_46_-_sci-fi_hovercraft.glb?url';
import jetUrl from '../../../normalized/futuristic_sci-fi_jet__plasticity_boxcutter.glb?url';
import o100Url from '../../../normalized/spaceship_o-100.glb?url';
import haulerUrl from '../../../normalized/hauler.glb?url';
import phoenixUrl from '../../../normalized/phoenix.glb?url';
import outpostAUrl from '../../../normalized/props/outpost_a.glb?url';
import outpostBUrl from '../../../normalized/props/outpost_b.glb?url';
import outpostHutUrl from '../../../normalized/props/outpost_hut.glb?url';
import antennaUrl from '../../../normalized/props/antenna.glb?url';
import ufoUrl from '../assets/ufo_collectible.glb?url';

export const RACE_LENGTH = 15000;   // metres
export const START_SPEED = 75;      // m/s the moment the lights go green
export const SPEED_RAMP = 1.6;      // m/s added to the base speed every second
export const MAX_BASE_SPEED = 210;  // m/s cap for the ramp (nitro and boost rings go beyond it)
export const COUNTDOWN = 3;         // seconds

export const NITRO_PER_UFO = 0.2;   // fraction of the tank refilled by one UFO
export const NITRO_DRAIN = 0.22;    // tank fraction used per second while boosting
export const NITRO_MULT = 1.45;     // target-speed multiplier while boosting
export const RING_BURST = 55;       // m/s kick from flying through a boost ring
export const AI_LASERS = true;      // rivals shoot back in short bursts (set false for a peaceful race)
export const LASER_SLOWDOWN = 0.86; // speed multiplier for a racer hit by a laser

export const UFO_URL = ufoUrl;

/** Outpost buildings (props: real-world metres, pivot at the bottom centre). */
export const PROP_URLS = { outpost_a: outpostAUrl, outpost_b: outpostBUrl, outpost_hut: outpostHutUrl, antenna: antennaUrl };

export const cssColor = (n) => '#' + n.toString(16).padStart(6, '0');

// 3D model credits (all from Sketchfab). The game uses modified copies: rescaled, recentred,
// reoriented and given convex-hull colliders; the UFO collectible is also simplified.
export const CREDITS = [
  {
    short: 'Duster 46', author: 'mgfxer', authorUrl: 'https://sketchfab.com/mgfxer',
    url: 'https://sketchfab.com/3d-models/duster-46-sci-fi-hovercraft-25376ae6a4674c21b164ebc7b84fd80f',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    short: 'Boxcutter jet', author: 'mgfxer', authorUrl: 'https://sketchfab.com/mgfxer',
    url: 'https://sketchfab.com/3d-models/futuristic-sci-fi-jet-plasticity-boxcutter-251ddfbb6a35472aa30d227f9b518230',
    license: 'CC BY-NC 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  },
  {
    short: 'Spaceship O-100', author: 'FilipZelinka', authorUrl: 'https://sketchfab.com/FilipZelinka',
    url: 'https://sketchfab.com/3d-models/spaceship-o-100-d974d8927cab4aeba394255ba70a77ad',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    short: 'Flying Saucer UFO', author: 'Xicor_Devstar', authorUrl: 'https://sketchfab.com/Xicor_Devstar',
    url: 'https://sketchfab.com/3d-models/classic-sci-fi-flying-saucer-ufo-a2c877aab2b64c6db0f69d2e5b5d88d3',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    short: 'Hauler', author: 'VertaScan', authorUrl: 'https://sketchfab.com/VertaScan',
    url: 'https://sketchfab.com/3d-models/hauler-77fcd0f605ed43da82b214127f44d95d',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    short: 'Phoenix', author: 'Andrzej Borkowski', authorUrl: 'https://sketchfab.com/abg_3d',
    url: 'https://sketchfab.com/3d-models/phoenix-sci-fi-spaceship-748271a4f7604d9cb2a6e7bf1e6e437e',
    license: 'CC BY-NC 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  },
  {
    short: 'Antenna', author: 'Scarecrow_original', authorUrl: 'https://sketchfab.com/Scarecrow_original',
    url: 'https://sketchfab.com/3d-models/antenna-77dfdf9a1c2945d7aec3f33e74c65ac4',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    short: 'Sci-Fi Buildings', author: 'Robin Butler', authorUrl: 'https://sketchfab.com/StarTrekGuy',
    url: 'https://sketchfab.com/3d-models/stylized-low-poly-sci-fi-buildings-701381fef32444e79ad804315e563049',
    license: 'CC BY-NC 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  },
];

export const SHIPS = [
  {
    id: 'duster46',
    name: 'Duster 46',
    tag: 'Hovercraft',
    blurb: 'Grippy and nimble. Owns the twisty sections.',
    url: dusterUrl,
    stats: { speed: 0.97, accel: 1.15, handling: 1.2, nitro: 1.0 },
    engines: [[-2.5, 0.5, -4.6], [2.5, 0.5, -4.6]],
    flame: 0xb6ff5c,
  },
  {
    id: 'jet',
    name: 'Boxcutter',
    tag: 'Interceptor jet',
    blurb: 'Highest top speed, balanced everywhere else.',
    url: jetUrl,
    stats: { speed: 1.06, accel: 1.0, handling: 1.0, nitro: 0.95 },
    engines: [[-1.25, 0.1, -2.3], [1.25, 0.1, -2.3]],
    flame: 0x7fe6ff,
  },
  {
    id: 'o100',
    name: 'O-100',
    tag: 'Heavy runner',
    blurb: 'Slow to turn, but its nitro tank lasts forever.',
    url: o100Url,
    stats: { speed: 1.02, accel: 0.95, handling: 0.88, nitro: 1.25 },
    engines: [[-1.85, 0.0, -5.0], [1.85, 0.0, -5.0]],
    flame: 0xff9a3c,
  },
];

/** Explore-only cargo ship: slow and heavy, so a swinging load barely moves it. Can radio for an escort. */
export const HAULER = {
  id: 'hauler',
  name: 'Hauler',
  tag: 'Cargo dropship',
  blurb: 'Explore only. Heavy loads barely slow it, and H calls a Phoenix escort.',
  url: haulerUrl,
  stats: { speed: 0.85, accel: 0.8, handling: 0.82, nitro: 1.1 },
  mass: 3,
  engines: [[0, -0.3, -4.9]],
  flame: 0xff5a2a,
  exploreOnly: true,
};

/** The hauler's NPC wingman. */
export const PHOENIX = {
  id: 'phoenix',
  name: 'Phoenix',
  url: phoenixUrl,
  stats: { speed: 1.1, accel: 1.2, handling: 1.2, nitro: 1 },
  engines: [[-1.3, 0.1, -4.7], [0, 0.1, -4.8], [1.3, 0.1, -4.7]],
  flame: 0x9fe8ff,
};

/** Ships offered in each mode's menu. */
export const EXPLORE_SHIPS = [...SHIPS, HAULER];
