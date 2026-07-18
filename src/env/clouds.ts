import {
  CircleGeometry,
  Group,
  Mesh,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Texture
} from '@iwsdk/core';

import { makeCloudTexture, NOISE_GLSL } from './fx.js';

export interface CloudHandles {
  group: Group;
  uniforms: { uTime: { value: number } };
}

/**
 * The bottom of the world is light, not geometry: a luminous mist sea far
 * below the city (soft radial gradient + slow noise — no cutout edges, so
 * nothing ever reads as a flat card), with a field of very soft cloud-puff
 * sprites drifting around the tower bases where they sink into the glow.
 * Everything lives outside the 20–220m gameplay corridor.
 */
export function createClouds(): CloudHandles {
  const group = new Group();
  const uTime = { value: 0 };

  // --- The sea of light -----------------------------------------------------
  const makeSea = (y: number, radius: number, intensity: number): Mesh => {
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime, uIntensity: { value: intensity } },
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
        ${NOISE_GLSL}
        void main() {
          float r = distance(vUv, vec2(0.5)) * 2.0;
          float edge = 1.0 - smoothstep(0.25, 1.0, r);

          float n = fbm(vec3(vWorld.xz * 0.0011, uTime * 0.02));
          float n2 = fbm(vec3(vWorld.xz * 0.0042 + 40.0, uTime * 0.03));

          vec3 deep = vec3(0.05, 0.022, 0.09);
          vec3 magenta = vec3(0.40, 0.10, 0.38);
          vec3 cyan = vec3(0.07, 0.28, 0.36);

          vec3 col = deep;
          col += magenta * (0.3 + 0.7 * n);
          col += cyan * smoothstep(0.55, 0.9, n2) * 0.5;
          col *= uIntensity;

          float a = edge * (0.85 + 0.15 * n);
          gl_FragColor = vec4(col, a);
        }
      `
    });
    const mesh = new Mesh(new CircleGeometry(radius, 48), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    return mesh;
  };

  // Two stacked layers: the sea itself, and a dimmer, wider under-glow so
  // looking straight down never finds a hard rim.
  group.add(makeSea(-235, 1700, 1.0));
  group.add(makeSea(-320, 2400, 0.55));

  // --- Soft mist puffs around the tower bases -------------------------------
  const cloudTexture = makeCloudTexture();
  const rng = mulberry32(4242);
  const makePuff = (
    texture: Texture,
    x: number,
    y: number,
    z: number,
    scale: number,
    color: number,
    opacity: number
  ): Sprite => {
    const sprite = new Sprite(
      new SpriteMaterial({
        map: texture,
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        rotation: rng() * Math.PI * 2
      })
    );
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(scale);
    return sprite;
  };

  // Warm-lit mist against the towers' own glow.
  const puffColors = [0xb44ba0, 0x5a3d96, 0x3e7d96, 0x8a4870];
  for (let i = 0; i < 60; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const nearCorridor = rng() < 0.3;
    const x = nearCorridor
      ? (rng() - 0.5) * 160
      : side * (80 + rng() * 460);
    const z = 120 - rng() * 1550;
    const y = -250 + rng() * 62; // band: -250..-188, below the finish at -170
    group.add(
      makePuff(
        cloudTexture,
        x,
        y,
        z,
        55 + rng() * 85,
        puffColors[Math.floor(rng() * puffColors.length)],
        0.1 + rng() * 0.14
      )
    );
  }

  // A few huge, whisper-faint wisps high above the start for depth.
  for (let i = 0; i < 7; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    group.add(
      makePuff(
        cloudTexture,
        side * (150 + rng() * 500),
        280 + rng() * 120,
        60 - rng() * 1200,
        180 + rng() * 120,
        0x4a3d86,
        0.05 + rng() * 0.05
      )
    );
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
