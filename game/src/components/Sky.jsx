import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SKY } from '../engine/config.js';
import { SUN_DIR } from '../engine/engine.js';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vDir = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 top;
  uniform vec3 horizon;
  uniform vec3 below;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    vec3 col = d.y > 0.0 ? mix(horizon, top, pow(d.y, 0.45)) : mix(horizon, below, pow(-d.y, 0.4));
    float s = max(dot(d, sunDir), 0.0);
    col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Gradient sky dome with a sun glow; it follows the camera so it never gets closer.
export function Sky() {
  const ref = useRef();
  const uniforms = useMemo(
    () => ({
      top: { value: new THREE.Color(SKY.top) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      below: { value: new THREE.Color(SKY.below) },
      sunDir: { value: SUN_DIR },
      sunColor: { value: new THREE.Color('#fff0d8') },
    }),
    [],
  );
  useFrame(({ camera }) => ref.current.position.copy(camera.position));
  return (
    <mesh ref={ref} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[5000, 32, 16]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
      />
    </mesh>
  );
}
