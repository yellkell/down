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
  TetrahedronGeometry,
  TorusGeometry,
  Vector3
} from '@iwsdk/core';

import { NEON, OBSTACLE_COLORS } from '../constants.js';
import { makeGlow } from './fx.js';

/**
 * Monolithic dark towers lining the descent corridor — one instanced mesh
 * for the fills, one merged line-set for their neon edge trim, plus beacon
 * glows on the tallest roofs. Replaces the four lonely boxes of the original.
 */
export function createMegastructures(): Group {
  const group = new Group();
  const COUNT = 42;

  const boxGeometry = new BoxGeometry(1, 1, 1);
  const fill = new InstancedMesh(
    boxGeometry,
    new MeshBasicMaterial({ color: 0x05050f }),
    COUNT
  );

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
    const x = side * (130 + rng() * 380);
    const z = 60 - rng() * 1100;
    const height = 90 + rng() * 320;
    const width = 22 + rng() * 46;
    const baseY = -260 + rng() * 60;
    const rotY = rng() * Math.PI;

    quaternion.setFromAxisAngle(up, rotY);
    const position = new Vector3(x, baseY + height / 2, z);
    const scale = new Vector3(width, height, width);
    matrix.compose(position, quaternion, scale);
    fill.setMatrixAt(i, matrix);

    // Bake this instance's edges into one static line geometry.
    const v = new Vector3();
    for (let j = 0; j < edgeArray.length; j += 3) {
      v.set(edgeArray[j], edgeArray[j + 1], edgeArray[j + 2]).applyMatrix4(matrix);
      edgePositions.push(v.x, v.y, v.z);
    }

    if (height > 280) {
      beacons.push(new Vector3(x, baseY + height + 6, z));
    }
  }
  fill.instanceMatrix.needsUpdate = true;
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
      opacity: 0.28,
      blending: AdditiveBlending,
      depthWrite: false
    })
  );
  group.add(edges);

  beacons.forEach((p, i) => {
    const glow = makeGlow(i % 2 === 0 ? NEON.red : NEON.cyan, 10, 0.55);
    glow.position.copy(p);
    group.add(glow);
  });

  return group;
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
