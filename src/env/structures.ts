import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  DodecahedronGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
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
  uniforms: { uTime: { value: number } };
}

/**
 * The mist band: towers start dissolving at MIST_TOP and are fully melted
 * into haze by MIST_FULL — just above the cloud-sea disc, so no geometry
 * ever hard-intersects the sea.
 */
const MIST_TOP = -175;
const MIST_FULL = -245;
/** Haze the tower bases melt into — must match the cloud sea's glow. */
const HAZE_COLOR = [0.11, 0.04, 0.14] as const;

/**
 * The skyline: dark towers lining the descent corridor, their faces alive with
 * procedurally-lit neon windows, rising out of the cloud sea. One instanced
 * mesh drives all of them via a window-grid shader; a merged line-set adds edge
 * trim and beacons crown the tallest roofs.
 */
export function createMegastructures(): CityHandles {
  const group = new Group();
  const COUNT = 60;
  const uniforms = { uTime: { value: 0 } };

  const boxGeometry = new BoxGeometry(1, 1, 1);
  const fill = new InstancedMesh(boxGeometry, makeWindowMaterial(uniforms), COUNT);

  const edgePositions: number[] = [];
  const edgeSource = new EdgesGeometry(boxGeometry);
  const edgeArray = edgeSource.attributes.position.array as Float32Array;

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const rng = mulberry32(1337);

  const beacons: Vector3[] = [];

  for (let i = 0; i < COUNT; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    // Two depth bands: a near wall and a taller far wall, for a layered skyline.
    const near = rng() < 0.5;
    const x = side * (near ? 90 + rng() * 150 : 260 + rng() * 320);
    const z = 90 - rng() * 1500;
    const height = (near ? 150 : 240) + rng() * 260;
    const width = 24 + rng() * 52;
    const baseY = -300 + rng() * 30; // bases sink into the cloud sea (~-200)
    const rotY = rng() * Math.PI;

    quaternion.setFromAxisAngle(up, rotY);
    const position = new Vector3(x, baseY + height / 2, z);
    const scale = new Vector3(width, height, width);
    matrix.compose(position, quaternion, scale);
    fill.setMatrixAt(i, matrix);

    // Bake this instance's edges into one static line geometry. Clamp the
    // verticals at the mist top so no crisp line runs down into the haze.
    const v = new Vector3();
    for (let j = 0; j < edgeArray.length; j += 3) {
      v.set(edgeArray[j], edgeArray[j + 1], edgeArray[j + 2]).applyMatrix4(matrix);
      edgePositions.push(v.x, Math.max(v.y, -172), v.z);
    }

    const top = baseY + height;
    if (top > 120) beacons.push(new Vector3(x, top + 6, z));
  }
  fill.instanceMatrix.needsUpdate = true;
  fill.frustumCulled = false;
  group.add(fill);

  const edgeGeometry = new BufferGeometry();
  edgeGeometry.setAttribute(
    'position',
    new Float32BufferAttribute(edgePositions, 3)
  );
  const edges = new LineSegments(
    edgeGeometry,
    new LineBasicMaterial({
      color: NEON.purple,
      transparent: true,
      opacity: 0.22,
      blending: AdditiveBlending,
      depthWrite: false
    })
  );
  edges.frustumCulled = false;
  group.add(edges);

  beacons.forEach((p, i) => {
    const glow = makeGlow(i % 2 === 0 ? NEON.red : NEON.cyan, 9, 0.6);
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
function makeWindowMaterial(uniforms: { uTime: { value: number } }): ShaderMaterial {
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
      uniform float uTime;
      uniform sampler2D uWindows;
      uniform float uMistTop;
      uniform float uMistFull;
      uniform vec3 uHaze;
      ${NOISE_GLSL}

      void main() {
        vec3 an = abs(vNormalL);
        vec3 body = vec3(0.012, 0.016, 0.045);
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
          float breathe = 0.78 + 0.22 * vnoise(vec3(vWorld.xz * 0.012, uTime * 0.06));

          // Some towers blaze, some sit nearly dark.
          float towerLit = 0.25 + 1.3 * pow(vRand.z, 1.7);

          col += win.rgb * win.a * 1.6 * breathe * towerLit;
        } else {
          col = body * 1.5; // roof caps read slightly lighter
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
    const radius = 12 + rng() * 24;
    const scale = 0.5 + rng() * 2.2;
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
