import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Engine } from '../engine/engine.js';
import { ATMOS } from '../engine/biomes.js';
import { Sky } from './Sky.jsx';

// Declarative scene setup (sky, fog, lights, reflections) + the imperative race engine, ticked every frame.
export function World({ assets }) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const dom = useThree((s) => s.gl.domElement);
  const sun = useRef();
  const hemi = useRef();
  const engine = useMemo(() => new Engine(assets), [assets]);

  useEffect(() => {
    engine.attach({ scene, camera, sun: sun.current, hemi: hemi.current, dom });
    return () => engine.detach();
  }, [engine, scene, camera, dom]);

  useFrame((state, dt) => engine.frame(Math.min(dt, 1 / 20), state.clock.elapsedTime));

  return (
    <>
      <Sky />
      {/* Fog colour/distance and both lights are re-blended every frame from the current biome. */}
      <fog attach="fog" args={[ATMOS.horizon.clone(), 260, 1550]} />
      <hemisphereLight ref={hemi} args={['#c6d8ff', '#d08a5e', 1]} />
      <directionalLight
        ref={sun}
        color="#ffd8b4"
        intensity={2.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.4}
      >
        <orthographicCamera attach="shadow-camera" args={[-45, 45, 45, -45, 1, 600]} />
      </directionalLight>
      {/* Warm studio-style reflections for the ships' metal and clearcoat, generated locally (no HDR download). */}
      <Environment resolution={256} environmentIntensity={0.6}>
        <Lightformer form="rect" intensity={1.6} color="#a9c1ff" position={[0, 10, 0]} scale={[30, 30, 1]} />
        <Lightformer form="rect" intensity={5} color="#ffd2a6" position={[7, 4, 9]} scale={[10, 4, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#d88a5c" position={[0, -8, 0]} scale={[30, 30, 1]} />
        <Lightformer form="ring" intensity={2} color="#ffffff" position={[-8, 3, -6]} scale={4} />
      </Environment>
    </>
  );
}
