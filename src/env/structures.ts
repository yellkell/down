import {
  AdditiveBlending,
  BoxGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  ShaderMaterial,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3
} from '@iwsdk/core';

import { NEON, OBSTACLE_COLORS } from '../constants.js';
import { makeGlow, makeWindowTexture, NOISE_GLSL } from './fx.js';

export interface CityHandles {
  group: Group;
  uniforms: {
    uTime: { value: number };
    /** Player rig position, fed each frame — drives proximity brightness. */
    uPlayer: { value: Vector3 };
  };
}

/**
 * The mist band: towers start dissolving at MIST_TOP and are fully melted
 * into haze by MIST_FULL — just above the cloud-sea disc, so no geometry
 * ever hard-intersects the sea.
 */
const MIST_TOP = -170;
const MIST_FULL = -228;
/** Haze the tower bases melt into — must match the cloud sea's glow. */
const HAZE_COLOR = [0.11, 0.04, 0.14] as const;

/**
 * The skyline: dark glass towers with real massing — most rise in 2-3
 * setback tiers like actual skyscrapers, crowned with mechanical blocks
 * and antenna masts, sparsely lit, their bases lost in the cloud sea.
 * All tiers live in one instanced mesh; form comes from face shading.
 */
export function createMegastructures(): CityHandles {
  const group = new Group();
  const uniforms = { uTime: { value: 0 }, uPlayer: { value: new Vector3() } };
  const rng = mulberry32(1337);

  interface Segment {
    x: number;
    z: number;
    bottom: number;
    height: number;
    width: number;
    depth: number;
    rotY: number;
  }
  const segments: Segment[] = [];
  const antennas: Array<{ x: number; z: number; bottom: number; height: number }> = [];
  const beacons: Vector3[] = [];

  const TOWERS = 46;
  for (let i = 0; i < TOWERS; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    // Two depth bands: a near wall and a taller far wall, for a layered skyline.
    const near = rng() < 0.5;
    const x = side * (near ? 90 + rng() * 150 : 260 + rng() * 320);
    const z = 90 - rng() * 1500;
    const total = (near ? 190 : 280) + rng() * 280;
    const width = 30 + rng() * 55;
    const depth = width * (0.7 + rng() * 0.6); // rectangular slabs, not cubes
    const baseY = -262 + rng() * 12; // pierce the sea, never seen below it
    const rotY = rng() * Math.PI;

    // Setback massing: 1-3 tiers, each narrower than the last.
    const tiers = rng() < 0.25 ? 1 : rng() < 0.6 ? 2 : 3;
    const fractions =
      tiers === 1 ? [1] : tiers === 2 ? [0.68, 0.32] : [0.55, 0.3, 0.15];
    let bottom = baseY;
    let tierW = width;
    let tierD = depth;
    for (let t = 0; t < tiers; t++) {
      const h = total * fractions[t];
      segments.push({ x, z, bottom, height: h, width: tierW, depth: tierD, rotY });
      bottom += h;
      tierW *= 0.62 + rng() * 0.16;
      tierD *= 0.62 + rng() * 0.16;
    }

    const top = bottom;
    if (top > 60 && rng() < 0.55) {
      // Antenna mast with a red aircraft light.
      const mastH = 14 + rng() * 30;
      antennas.push({ x, z, bottom: top, height: mastH });
      beacons.push(new Vector3(x, top + mastH + 2, z));
    } else if (top > 120) {
      beacons.push(new Vector3(x, top + 5, z));
    }
  }

  const boxGeometry = new BoxGeometry(1, 1, 1);
  const fill = new InstancedMesh(
    boxGeometry,
    makeWindowMaterial(uniforms),
    segments.length
  );
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const up = new Vector3(0, 1, 0);
  segments.forEach((s, i) => {
    quaternion.setFromAxisAngle(up, s.rotY);
    matrix.compose(
      new Vector3(s.x, s.bottom + s.height / 2, s.z),
      quaternion,
      new Vector3(s.width, s.height, s.depth)
    );
    fill.setMatrixAt(i, matrix);
  });
  fill.instanceMatrix.needsUpdate = true;
  fill.frustumCulled = false;
  group.add(fill);

  // Antenna masts: one dark instanced set, glow tips added as beacons above.
  const mastMesh = new InstancedMesh(
    boxGeometry,
    new MeshBasicMaterial({ color: 0x05050f }),
    antennas.length
  );
  antennas.forEach((a, i) => {
    matrix.compose(
      new Vector3(a.x, a.bottom + a.height / 2, a.z),
      quaternion.identity(),
      new Vector3(1.6, a.height, 1.6)
    );
    mastMesh.setMatrixAt(i, matrix);
  });
  mastMesh.instanceMatrix.needsUpdate = true;
  mastMesh.frustumCulled = false;
  group.add(mastMesh);

  beacons.forEach((p, i) => {
    const glow = makeGlow(i % 3 === 0 ? NEON.cyan : NEON.red, 6, 0.55);
    glow.position.copy(p);
    group.add(glow);
  });

  // Colored volumetric haze pooled among the towers — the city's own glow.
  const hazeColors = [NEON.magenta, NEON.cyan, NEON.purple, NEON.amber];
  const hrng = mulberry32(555);
  for (let i = 0; i < 14; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const haze = makeGlow(hazeColors[i % hazeColors.length], 120 + hrng() * 160, 0.12);
    haze.position.set(
      side * (110 + hrng() * 360),
      -170 + hrng() * 240,
      50 - hrng() * 1400
    );
    group.add(haze);
  }

  return { group, uniforms };
}

/**
 * Facade shader for the instanced towers. Samples the baked, mipmapped
 * window texture (stable in VR — no per-pixel procedural shimmer) with UVs
 * in real-world metres derived from each instance's scale, breathes the
 * city's light with slow low-frequency noise, and melts the tower bases
 * into haze so they dissolve into the cloud sea instead of intersecting it.
 */
function makeWindowMaterial(uniforms: CityHandles['uniforms']): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...uniforms,
      uWindows: { value: makeWindowTexture() },
      uMistTop: { value: MIST_TOP },
      uMistFull: { value: MIST_FULL },
      uHaze: { value: [...HAZE_COLOR] }
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vNormalL;
      varying vec3 vScale;
      varying vec3 vWorld;
      varying vec3 vRand;
      varying float vShade;
      varying float vProx;
      uniform vec3 uPlayer;
      void main() {
        vLocal = position;
        vNormalL = normal;
        vScale = vec3(
          length(instanceMatrix[0].xyz),
          length(instanceMatrix[1].xyz),
          length(instanceMatrix[2].xyz)
        );
        // Three stable per-instance randoms from the tower's footprint —
        // they de-uniform the windows: offset, scale, and brightness.
        vec2 fp = instanceMatrix[3].xz;
        vRand = vec3(
          fract(sin(dot(fp, vec2(12.9898, 78.233))) * 43758.5453),
          fract(sin(dot(fp, vec2(39.3468, 11.135))) * 24634.6345),
          fract(sin(dot(fp, vec2(73.156, 52.235))) * 12345.6789)
        );

        // Fake moonlight from one side of the sky: each face gets a fixed
        // shade so the monoliths read as 3D glass, not flat cutouts.
        vec3 wn = normalize(mat3(instanceMatrix) * normal);
        if (abs(wn.y) > 0.5) {
          vShade = 1.0;
        } else {
          vShade = 0.72 + 0.28 * dot(normalize(wn.xz), normalize(vec2(0.45, -0.89)));
        }

        // Aerial perspective: towers near the player burn bright, the deep
        // skyline recedes into ember-glow. Follows the rig down the descent.
        float dCity = distance(instanceMatrix[3].xz, uPlayer.xz);
        vProx = 1.0 - smoothstep(240.0, 950.0, dCity);

        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vNormalL;
      varying vec3 vScale;
      varying vec3 vWorld;
      varying vec3 vRand;
      varying float vShade;
      varying float vProx;
      uniform float uTime;
      uniform sampler2D uWindows;
      uniform float uMistTop;
      uniform float uMistFull;
      uniform vec3 uHaze;
      ${NOISE_GLSL}

      void main() {
        vec3 an = abs(vNormalL);
        // Dark blue glass, shaded per face, with a faint sheen rising
        // toward the crown — form without a single drawn line.
        float sheen = 0.8 + 0.5 * clamp((vWorld.y + 80.0) / 420.0, 0.0, 1.0);
        vec3 body = vec3(0.014, 0.02, 0.05) * vShade * sheen;
        vec3 col = body;

        if (an.y < 0.5) {
          // Facade coordinates in real-world metres.
          vec2 wm = (an.x > an.z)
            ? vec2(vLocal.z * vScale.z, (vLocal.y + 0.5) * vScale.y)
            : vec2(vLocal.x * vScale.x, (vLocal.y + 0.5) * vScale.y);

          // Per-tower window scale (floor heights differ building to
          // building), per-tower + per-face crop offset so no two towers
          // show the same patch of the atlas.
          float tileW = mix(28.0, 42.0, vRand.y);
          vec2 uv = wm / vec2(tileW, tileW * 1.4);
          uv += vec2(vRand.x * 5.13, vRand.z * 3.71);
          if (an.x > an.z) uv += vec2(0.37, 0.19);
          vec4 win = texture2D(uWindows, uv);

          // Slow "city breathing" — low-frequency only, so nothing shimmers.
          float breathe = 0.8 + 0.2 * vnoise(vec3(vWorld.xz * 0.012, uTime * 0.06));

          // Every tower carries decent light; some blaze.
          float towerLit = 0.42 + 0.85 * pow(vRand.z, 1.4);

          // Near towers blaze; the deep skyline dims but stays alive.
          float distMul = 0.3 + 0.7 * vProx;

          col += win.rgb * win.a * 1.6 * breathe * towerLit * distMul;
        } else {
          col = body * 1.4; // roof caps read slightly lighter
        }

        // Melt into the mist: fully haze-colored before the cloud sea.
        float t = clamp((uMistTop - vWorld.y) / (uMistTop - uMistFull), 0.0, 1.0);
        t = t * t * (3.0 - 2.0 * t);
        col = mix(col, uHaze, t);
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}

/**
 * The finish zone: a landing pad, a portal arch of stacked rings, and the
 * debris field of every shape that was ever fired at you, drifting in glow.
 */
export function createFinishZone(center: Vector3): Group {
  const group = new Group();
  group.position.copy(center);
  const rng = mulberry32(99);

  // Landing pad ring.
  const padRing = new Mesh(
    new TorusGeometry(4, 0.07, 10, 64),
    new MeshBasicMaterial({
      color: NEON.lime,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    })
  );
  padRing.rotation.x = Math.PI / 2;
  padRing.position.y = 0.05;
  group.add(padRing);

  const padGlow = makeGlow(NEON.lime, 10, 0.25);
  padGlow.position.y = 0.4;
  group.add(padGlow);

  // Debris field of neon polyhedra.
  const geometries = [
    new TetrahedronGeometry(1),
    new OctahedronGeometry(1),
    new DodecahedronGeometry(1),
    new IcosahedronGeometry(1)
  ];
  for (let i = 0; i < 46; i++) {
    const angle = (i / 46) * Math.PI * 2 + (rng() - 0.5);
    const radius = 17 + rng() * 26;
    const scale = 0.5 + rng() * 2.0;
    const color = OBSTACLE_COLORS[Math.floor(rng() * OBSTACLE_COLORS.length)];
    const geometry = geometries[Math.floor(rng() * geometries.length)];

    const shape = new Group();
    const core = new Mesh(geometry, new MeshBasicMaterial({ color: 0x000000 }));
    core.scale.setScalar(scale * 0.92);
    const wire = new Mesh(
      geometry,
      new MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.9 })
    );
    wire.scale.setScalar(scale);
    shape.add(core, wire);
    shape.position.set(
      Math.cos(angle) * radius,
      rng() * 8 - 3,
      Math.sin(angle) * radius - 4
    );
    shape.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    group.add(shape);
  }

  return group;
}

/** Deterministic PRNG so the skyline is identical every run. */
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
