import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial
} from '@iwsdk/core';

import { makeCloudTexture, NOISE_GLSL } from './fx.js';

export interface CloudHandles {
  group: Group;
  uniforms: { uTime: { value: number } };
}

/** City extents the sea has to cover (towers span z 90..-1500, x +-580). */
const SEA_CENTER_Z = -700;

/**
 * The bottom of the world is light, not geometry: an opaque haze floor
 * under the whole city (nothing below it can ever be seen), a translucent
 * glowing sea above it for texture, and flat horizontal mist sheets around
 * the tower bases. Everything here is fixed-orientation — no camera-facing
 * sprites, which visibly swim when the player pitches their head in VR.
 */
export function createClouds(): CloudHandles {
  const group = new Group();
  const uTime = { value: 0 };

  const makeSea = (
    y: number,
    radius: number,
    intensity: number,
    opaque: boolean
  ): Mesh => {
    const material = new ShaderMaterial({
      transparent: !opaque,
      depthWrite: opaque,
      uniforms: {
        uTime,
        uIntensity: { value: intensity },
        uOpaque: { value: opaque ? 1 : 0 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        uniform float uTime;
        uniform float uIntensity;
        uniform float uOpaque;
        ${NOISE_GLSL}
        void main() {
          float r = distance(vUv, vec2(0.5)) * 2.0;

          float n = fbm(vec3(vWorld.xz * 0.0011, uTime * 0.02));
          float n2 = fbm(vec3(vWorld.xz * 0.0042 + 40.0, uTime * 0.03));

          vec3 deep = vec3(0.05, 0.022, 0.09);
          vec3 magenta = vec3(0.40, 0.10, 0.38);
          vec3 cyan = vec3(0.07, 0.28, 0.36);

          vec3 col = deep;
          col += magenta * (0.3 + 0.7 * n);
          col += cyan * smoothstep(0.55, 0.9, n2) * 0.5;
          col *= uIntensity;

          // The opaque floor blends toward the nebula's below-horizon glow
          // at its rim instead of fading out — no hole to the abyss.
          vec3 horizon = vec3(0.14, 0.05, 0.15);
          col = mix(col, horizon, smoothstep(0.72, 1.0, r));

          float edge = 1.0 - smoothstep(0.35, 0.95, r);
          float a = mix(edge * (0.85 + 0.15 * n), 1.0, uOpaque);
          gl_FragColor = vec4(col, a);
        }
      `
    });
    const mesh = new Mesh(new CircleGeometry(radius, 48), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, y, SEA_CENTER_Z);
    return mesh;
  };

  // Opaque haze floor: everything below -300 simply does not exist.
  group.add(makeSea(-300, 3400, 0.75, true));
  // Translucent glowing sea above it, for depth and drift.
  group.add(makeSea(-232, 2700, 1.0, false));

  // --- Flat mist sheets around the tower bases ------------------------------
  // Horizontal planes (NOT sprites): stable when the player looks around.
  const cloudTexture = makeCloudTexture();
  const sheetGeometry = new PlaneGeometry(1, 1);
  const rng = mulberry32(4242);
  const sheetColors = [0xb44ba0, 0x5a3d96, 0x3e7d96, 0x8a4870];
  for (let i = 0; i < 54; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const nearCorridor = rng() < 0.3;
    const x = nearCorridor ? (rng() - 0.5) * 200 : side * (80 + rng() * 480);
    const z = 120 - rng() * 1600;
    const y = -248 + rng() * 55; // band: -248..-193, below the finish at -170
    const sheet = new Mesh(
      sheetGeometry,
      new MeshBasicMaterial({
        map: cloudTexture,
        color: sheetColors[Math.floor(rng() * sheetColors.length)],
        transparent: true,
        opacity: 0.14 + rng() * 0.16,
        depthWrite: false,
        side: DoubleSide
      })
    );
    sheet.rotation.x = -Math.PI / 2;
    sheet.rotation.z = rng() * Math.PI * 2;
    sheet.position.set(x, y, z);
    sheet.scale.setScalar(90 + rng() * 130);
    group.add(sheet);
  }

  return { group, uniforms: { uTime } };
}

/** Deterministic PRNG so the cloudscape is identical every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
