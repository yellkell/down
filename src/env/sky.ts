import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry
} from '@iwsdk/core';

import { NEON } from '../constants.js';
import { makeGlow, NOISE_GLSL } from './fx.js';

export interface SkyHandles {
  group: Group;
  uniforms: {
    uTime: { value: number };
    uDepthLight: { value: number };
    uHoopPulse: { value: number };
    uHoopColor: { value: Color };
  };
}

/**
 * The void the player falls through: a nebula dome, ~2600 twinkling GPU
 * stars, and a ringed gas giant anchoring the horizon. Replaces the 25
 * hand-placed star spheres of the 2019 original.
 */
export function createSky(): SkyHandles {
  const group = new Group();
  const uTime = { value: 0 };
  const uDepthLight = { value: 0 };
  const uHoopPulse = { value: 0 };
  const uHoopColor = { value: new Color(NEON.cyan) };

  // --- Nebula dome ------------------------------------------------------
  const nebulaMaterial = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { uTime, uDepthLight, uHoopPulse, uHoopColor },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uTime;
      uniform float uDepthLight;
      uniform float uHoopPulse;
      uniform vec3 uHoopColor;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float drift = uTime * 0.004;
        float n1 = fbm(d * 3.1 + vec3(drift, 0.0, -drift));
        float n2 = fbm(d * 6.3 + vec3(-drift * 1.7, drift, 4.2));

        vec3 base = vec3(0.008, 0.008, 0.022);
        vec3 purple = vec3(0.16, 0.02, 0.30);
        vec3 magenta = vec3(0.38, 0.03, 0.30);
        vec3 cyan = vec3(0.02, 0.22, 0.30);

        float band = smoothstep(0.45, 0.85, n1);
        float wisp = smoothstep(0.55, 0.95, n2);
        vec3 col = base;
        col += purple * band * 0.55;
        col += magenta * wisp * band * 0.45;
        col += cyan * smoothstep(0.6, 1.0, fbm(d * 4.7 + 21.0)) * 0.35;

        // Horizon glow — the world below burns faint magenta.
        float horizon = pow(1.0 - abs(d.y), 6.0);
        col += vec3(0.30, 0.05, 0.26) * horizon * 0.55;

        // The whole lower dome glows: light rising off the cloud sea.
        float below = smoothstep(0.05, -0.45, d.y);
        col += vec3(0.20, 0.055, 0.21) * below * 0.6;

        // The finish grows lighter through the world itself, never through a
        // camera-facing overlay. Looking up or down cannot change its strength.
        col += vec3(0.055, 0.070, 0.110) * uDepthLight;

        // Brief, restrained feedback when crossing a slide hoop. This is a
        // uniform atmospheric tint, not geometry that can enter either eye.
        col += uHoopColor * uHoopPulse * 0.120;

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  const nebula = new Mesh(new SphereGeometry(1400, 48, 32), nebulaMaterial);
  group.add(nebula);

  // --- Starfield --------------------------------------------------------
  const STAR_COUNT = 2600;
  const positions: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const phases: number[] = [];

  const palette = [
    new Color(0xffffff),
    new Color(0xffffff),
    new Color(0xaaccff),
    new Color(0xffd9aa),
    new Color(0xffb3d9)
  ];

  for (let i = 0; i < STAR_COUNT; i++) {
    // Shell distribution, biased away from straight down (the descent path).
    const theta = Math.random() * Math.PI * 2;
    const y = Math.pow(Math.random(), 0.6) * 2 - 1;
    const r = Math.sqrt(1 - y * y);
    const radius = 900 + Math.random() * 400;
    positions.push(
      Math.cos(theta) * r * radius,
      y * radius,
      Math.sin(theta) * r * radius
    );
    const c = palette[Math.floor(Math.random() * palette.length)];
    colors.push(c.r, c.g, c.b);
    sizes.push(1.5 + Math.random() * Math.random() * 5.0);
    phases.push(Math.random() * Math.PI * 2);
  }

  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  starGeometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3));
  starGeometry.setAttribute('aSize', new Float32BufferAttribute(sizes, 1));
  starGeometry.setAttribute('aPhase', new Float32BufferAttribute(phases, 1));

  const starMaterial = new ShaderMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    uniforms: { uTime },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vColor = aColor;
        vTwinkle = 0.72 + 0.28 * sin(uTime * (0.6 + fract(aPhase) * 1.7) + aPhase * 7.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (1400.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        float a = smoothstep(0.5, 0.05, d);
        a *= a;
        gl_FragColor = vec4(vColor * vTwinkle, a * vTwinkle);
      }
    `
  });
  group.add(new Points(starGeometry, starMaterial));

  // --- Ringed gas giant -------------------------------------------------
  const planet = new Group();
  const planetMaterial = new ShaderMaterial({
    uniforms: { uTime },
    vertexShader: /* glsl */ `
      varying vec3 vWorldN;
      varying vec3 vPos;
      void main() {
        // World-space normal: the planet's lighting must be pinned to the
        // world, not the view — a view-space rim swims when the player
        // pitches their head in VR.
        vWorldN = normalize(mat3(modelMatrix) * normal);
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldN;
      varying vec3 vPos;
      uniform float uTime;
      ${NOISE_GLSL}
      void main() {
        // Banded clouds along latitude, slow churn.
        float bands = fbm(vec3(vPos.y * 0.045, uTime * 0.01, vPos.x * 0.004));
        vec3 dark = vec3(0.03, 0.015, 0.07);
        vec3 mid = vec3(0.14, 0.04, 0.22);
        vec3 col = mix(dark, mid, bands);
        // Fixed crescent lit from the nebula's bright quarter — stable
        // no matter where the player looks from.
        vec3 lightDir = normalize(vec3(-0.55, 0.3, 0.78));
        float crescent = smoothstep(-0.05, 0.75, dot(vWorldN, lightDir));
        col += vec3(0.13, 0.6, 0.7) * crescent * 0.38;
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  planet.add(new Mesh(new SphereGeometry(110, 48, 32), planetMaterial));

  const ringMaterial = new ShaderMaterial({
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        float t = vUv.x; // radial across the ring
        float a = smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.6, t);
        a *= 0.35 + 0.4 * sin(t * 60.0);
        vec3 col = mix(vec3(0.16, 0.9, 1.0), vec3(1.0, 0.24, 0.95), t);
        gl_FragColor = vec4(col * 0.7, max(a, 0.0) * 0.55);
      }
    `
  });
  const ring = new Mesh(new RingGeometry(140, 235, 96, 1), ringMaterial);
  ring.rotation.x = Math.PI / 2.25;
  planet.add(ring);
  planet.add(makeGlow(NEON.cyan, 420, 0.3));

  planet.position.set(560, 60, -1050);
  planet.rotation.z = 0.35;
  group.add(planet);

  // A couple of bright hero stars with real glow.
  const heroes: Array<[number, number, number, number]> = [
    [-700, 420, -900, NEON.cyan],
    [820, 520, -600, NEON.magenta],
    [-350, 180, -1200, 0xffffff]
  ];
  heroes.forEach(([x, y, z, color]) => {
    const glow = makeGlow(color, 42, 0.8);
    glow.position.set(x, y, z);
    group.add(glow);
  });

  // Distant floor of the world — a deep indigo bowl far below the cloud
  // sea, so any gap between mist layers still reads as glowing depth.
  const abyss = new Mesh(
    new SphereGeometry(900, 32, 16, 0, Math.PI * 2, Math.PI * 0.82, Math.PI * 0.18),
    new MeshBasicMaterial({ color: 0x120826 })
  );
  abyss.position.y = -420;
  group.add(abyss);

  return {
    group,
    uniforms: { uTime, uDepthLight, uHoopPulse, uHoopColor }
  };
}
