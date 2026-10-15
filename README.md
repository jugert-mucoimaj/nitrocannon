# Nitro Canyon

A browser flying game built with Three.js, React and React Three Fiber.

- **Race:** a 15 km sprint down an endless procedural canyon against two rivals. The speed cap climbs as the race goes on.
- **Explore:** an endless open world across four biomes (Red Canyon, Frost Wastes, Volcanic Badlands, Crystal Fields). Discover landmarks (crashed ships, monolith circles, stone arches, floating isles), hunt rare UFOs, clear peaceful motherships guarded by orbiting escorts, and fight hostile red motherships: survive three waves of attack drones, then shoot the exposed core. Your ship has a recharging shield and a hull; lose the hull and you respawn out of range.

Both modes use the same flight controls and lasers.

## Run it

Needs [Node.js](https://nodejs.org/) 20 or newer.

```bash
cd game
npm install
npm run dev
```

Then open http://localhost:5173. To build a static site instead, run `npm run build`; the output goes to `game/dist/`.

## Controls

| Input | Action |
|---|---|
| Mouse | Aim (click the game once to capture the mouse; Esc releases it and pauses) |
| W / S | Thrust / brake |
| A / D | Turn |
| Space | Rise straight up |
| Shift + S | Drop straight down |
| Shift | Nitro (refilled by UFOs) |
| Click / F | Fire lasers |
| Q | Scanner (Explore): marks the nearest UFO, landmark and mothership |
| Numpad 4 / 6 / 8 / 2 | Swing the camera around the ship (Numpad 5 resets it) |
| Mouse wheel | Camera zoom |
| I | Invert mouse Y |
| C | Show collision hulls |
| P | Pause |
| M | Mute |
| R | Restart the race |

In the menu, ← → picks a ship, Tab switches mode and Enter starts.

## Project layout

```
game/                 Vite + React app
  src/engine/         game logic in plain JS (terrain, flight, race, explore, lasers, audio)
  src/components/     React: 3D scene setup and the HUD/menu overlays
  src/assets/         simplified UFO used for the collectibles
normalized/           the ship models used by the game (see below)
originals/            the untouched Sketchfab downloads
```

The tuning numbers (race length, speed ramp, nitro, ship stats, rival lasers) are in `game/src/engine/config.js`.

## 3D model credits

The models come from Sketchfab and Kenney and are used under Creative Commons licenses:

| Model | Author | License |
|---|---|---|
| [Duster 46 - Sci-Fi Hovercraft](https://sketchfab.com/3d-models/duster-46-sci-fi-hovercraft-25376ae6a4674c21b164ebc7b84fd80f) | [mgfxer](https://sketchfab.com/mgfxer) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [Futuristic Sci-Fi Jet, Plasticity, Boxcutter](https://sketchfab.com/3d-models/futuristic-sci-fi-jet-plasticity-boxcutter-251ddfbb6a35472aa30d227f9b518230) | [mgfxer](https://sketchfab.com/mgfxer) | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |
| [Spaceship O-100](https://sketchfab.com/3d-models/spaceship-o-100-d974d8927cab4aeba394255ba70a77ad) | [FilipZelinka](https://sketchfab.com/FilipZelinka) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [Classic Sci-Fi Flying Saucer UFO](https://sketchfab.com/3d-models/classic-sci-fi-flying-saucer-ufo-a2c877aab2b64c6db0f69d2e5b5d88d3) | [𝖝𝖎𝖈𝖔𝖗 𝖉𝖊𝖛𝖘𝖙𝖆𝖗 (Xicor_Devstar)](https://sketchfab.com/Xicor_Devstar) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [Hauler](https://sketchfab.com/3d-models/hauler-77fcd0f605ed43da82b214127f44d95d) | [VertaScan](https://sketchfab.com/VertaScan) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [PHOENIX Sci-Fi Spaceship](https://sketchfab.com/3d-models/phoenix-sci-fi-spaceship-748271a4f7604d9cb2a6e7bf1e6e437e) | [Andrzej Borkowski](https://sketchfab.com/abg_3d) | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |
| [Antenna](https://sketchfab.com/3d-models/antenna-77dfdf9a1c2945d7aec3f33e74c65ac4) | [Scarecrow_original](https://sketchfab.com/Scarecrow_original) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [Stylized Low Poly Sci-Fi Buildings](https://sketchfab.com/3d-models/stylized-low-poly-sci-fi-buildings-701381fef32444e79ad804315e563049) | [Robin Butler](https://sketchfab.com/StarTrekGuy) | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |
| [Space Kit](https://kenney.nl/assets/space-kit) | [Kenney](https://kenney.nl) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (credit not required, given anyway) |

**Changes made:** the files in `normalized/` were rescaled so each model is 10 m on its longest side, recentred on its bounding box, rotated so the nose points along +Z, flattened into a single mesh under one root, and given a convex-hull collision mesh. `game/src/assets/ufo_collectible.glb` is the UFO further simplified to about 6,000 triangles. The hauler was simplified from 351k to 70k triangles and the Phoenix's textures halved to 512 px. The props in `normalized/props/` (antenna, three outpost buildings split out of the buildings pack, scaled up 10×) use real-world metres with their pivot at the bottom centre, so they sit on the ground. The files in `originals/` are unmodified.

The Boxcutter jet is licensed for **non-commercial use only** (CC BY-NC 4.0). This is a non-commercial project; it would need to be replaced or relicensed before any commercial use.

## License

The code is released under the [MIT License](LICENSE). The MIT License does **not** cover the 3D models in `originals/`, `normalized/` and `game/src/assets/`: each stays under the Creative Commons license of its author, listed above.
