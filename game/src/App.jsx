import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { World } from './components/World.jsx';
import { Hud, Loading, Menu, Results, Toasts } from './components/Overlays.jsx';
import { ExploreHud } from './components/ExploreHud.jsx';
import { loadAssets } from './engine/assets.js';
import { store } from './engine/store.js';
import { useStore } from './useStore.js';

export default function App() {
  const assets = useStore((s) => s.assets);
  const phase = useStore((s) => s.phase);

  useEffect(() => {
    loadAssets((loaded, total) => store.set({ load: { loaded, total } }))
      .then((loadedAssets) => store.set({ assets: loadedAssets }))
      .catch((err) => store.set({ error: err?.message ?? String(err) }));
  }, []);

  return (
    <>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 60, near: 0.5, far: 9000, position: [0, 40, -40] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        {assets && <World assets={assets} />}
      </Canvas>
      {phase === 'loading' && <Loading />}
      {phase === 'menu' && <Menu />}
      {phase === 'explore' && <ExploreHud />}
      {['countdown', 'race', 'done'].includes(phase) && <Hud />}
      <Results />
      <Toasts />
    </>
  );
}
