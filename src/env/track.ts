import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry
} from '@iwsdk/core';

import { NEON, SLIDE_ANGLE } from '../constants.js';
import { makeGlow, makeTextTexture } from './fx.js';

export interface TrackHandles {
  group: Group;
  uniforms: { uTime: { value: number } };
  dispose: () => void;
}

/**
 * A neon half-pipe of light, generated at slide start from wherever the rig
 * is to wherever it's going. Local -Z runs downhill; the group is pitched
 * by the slide angle so the ribbon hugs the descent line.
 */
export function createSlideTrack(length: number): TrackHandles {
  const group = new Group();
  group.rotation.x = -SLIDE_ANGLE;
  const uniforms = { uTime: { value: 0 } };
  const disposables: Array<{ dispose: () => void }> = [];

  // --- Ribbon -----------------------------------------------------------
  const ribbonMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { ...uniforms, uLength: { value: length } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec2 vLocal;
      uniform float uLength;
      void main() {
        vUv = uv;
        vLocal = vec2(position.x, uv.y * uLength);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec2 vLocal;
      uniform float uTime;
      uniform float uLength;

      float lineAt(float x, float target) {
        float d = abs(x - target);
        float w = fwidth(d) * 1.5;
        return 1.0 - smoothstep(0.0, w + 0.02, d);
      }

      void main() {
        vec3 cyan = vec3(0.16, 0.95, 1.0);
        vec3 magenta = vec3(1.0, 0.24, 0.95);

        // End fades so the ribbon dissolves into the void.
        float endFade = smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.92, vUv.y);

        vec3 col = vec3(0.012, 0.014, 0.035); // dark glass bed
        float alpha = 0.62;

        // Chevron arrows flowing downhill.
        float chev = fract((vLocal.y + abs(vLocal.x) * 1.6) * 0.14 + uTime * 1.4);
        float arrow = smoothstep(0.0, 0.05, chev) * smoothstep(0.16, 0.11, chev);
        col += cyan * arrow * 0.5;

        // Lane dividers framing the three lanes (centers at -0.5, 0, 0.5).
        float divider = lineAt(vLocal.x, -0.75) + lineAt(vLocal.x, -0.25)
                      + lineAt(vLocal.x, 0.25) + lineAt(vLocal.x, 0.75);
        col += magenta * divider * (0.55 + 0.25 * sin(uTime * 3.0));
        alpha = max(alpha, divider * 0.9);

        // Edge glow toward the rails.
        float edge = smoothstep(0.55, 1.05, abs(vLocal.x));
        col += cyan * edge * 0.35;

        gl_FragColor = vec4(col, alpha * endFade);
      }
    `
  });
  const ribbon = new Mesh(new PlaneGeometry(2.3, length, 1, 1), ribbonMaterial);
  ribbon.rotation.x = -Math.PI / 2;
  ribbon.position.set(0, -0.02, -length / 2);
  group.add(ribbon);
  disposables.push(ribbon.geometry, ribbonMaterial);

  // --- "LOOK FORWARD" decals painted on the track surface across the first
  // stretch, so the cue sits beneath the player through the whole drop-in. --
  const forwardTexture = makeTextTexture('LOOK  FORWARD');
  const chevronTexture = makeTextTexture('▼', { width: 256, height: 256 });
  disposables.push(forwardTexture, chevronTexture);
  const decalGeometry = new PlaneGeometry(3.4, 0.85);
  const chevronGeometry = new PlaneGeometry(0.9, 0.9);
  disposables.push(decalGeometry, chevronGeometry);
  const makeDecal = (texture: typeof forwardTexture, geo: typeof decalGeometry, z: number) => {
    const mat = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide
    });
    const mesh = new Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; // lie flat on the ribbon
    mesh.position.set(0, 0.02, z);
    group.add(mesh);
    disposables.push(mat);
  };
  // Repeat down the entry so it stays under you as you accelerate away.
  makeDecal(forwardTexture, decalGeometry, -6);
  makeDecal(chevronTexture, chevronGeometry, -9);
  makeDecal(forwardTexture, decalGeometry, -18);
  makeDecal(chevronTexture, chevronGeometry, -22);

  // --- Rails ------------------------------------------------------------
  const railGeometry = new BoxGeometry(0.06, 0.06, length);
  [-1.15, 1.15].forEach((x) => {
    const rail = new Mesh(
      railGeometry,
      new MeshBasicMaterial({
        color: NEON.cyan,
        blending: AdditiveBlending,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      })
    );
    rail.position.set(x, 0.05, -length / 2);
    group.add(rail);
  });
  disposables.push(railGeometry);

  // --- Energy hoops every 40m — motion + progress cue ------------------
  const hoopGeometry = new TorusGeometry(1.7, 0.035, 10, 48);
  const hoopCount = Math.floor(length / 40);
  for (let i = 1; i <= hoopCount; i++) {
    const color = i % 2 === 0 ? NEON.cyan : NEON.magenta;
    const hoop = new Mesh(
      hoopGeometry,
      new MeshBasicMaterial({
        color,
        blending: AdditiveBlending,
        transparent: true,
        opacity: 0.75,
        depthWrite: false
      })
    );
    hoop.position.set(0, 1.3, -i * 40);
    group.add(hoop);
    const glow = makeGlow(color, 4.5, 0.2);
    glow.position.copy(hoop.position);
    group.add(glow);
  }
  disposables.push(hoopGeometry);

  return {
    group,
    uniforms,
    dispose: () => {
      group.removeFromParent();
      disposables.forEach((d) => d.dispose());
    }
  };
}

// ---------------------------------------------------------------------------

export interface StreakHandles {
  object: LineSegments;
  uniforms: {
    uOffset: { value: number };
    uStrength: { value: number };
  };
}

/**
 * Wind streaks that whip past during slides. One draw call; the whole field
 * scrolls via a wrap-around offset in the vertex shader.
 */
export function createStreaks(): StreakHandles {
  const COUNT = 170;
  const WINDOW = 46; // recycling window along Z
  const positions: number[] = [];
  const alphas: number[] = [];
  const colors: number[] = [];
  const cyan = new Color(NEON.cyan);
  const magenta = new Color(NEON.magenta);
  const white = new Color(0xffffff);

  for (let i = 0; i < COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 2.6 + Math.random() * 5.5;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * 0.7 + 1.2;
    const z = -Math.random() * WINDOW;
    const len = 1.2 + Math.random() * 2.2;
    positions.push(x, y, z, x, y, z - len);
    const c = Math.random() < 0.5 ? cyan : Math.random() < 0.5 ? magenta : white;
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    alphas.push(0.85, 0.0); // bright head, invisible tail
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aAlpha', new Float32BufferAttribute(alphas, 1));

  const uniforms = { uOffset: { value: 0 }, uStrength: { value: 0 } };
  const material = new ShaderMaterial({
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aAlpha;
      uniform float uOffset;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vec3 p = position;
        p.z = mod(p.z + uOffset, ${'46.0'}) - 38.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(vColor, vAlpha * uStrength * 0.55);
      }
    `
  });

  const object = new LineSegments(geometry, material);
  object.frustumCulled = false;
  object.visible = false;
  // Streaks only ever show mid-slide, so rake the whole field down the slope:
  // pitched by the slide angle, the lines (and their scroll) run parallel to
  // the descent instead of straight along the rig's horizontal -Z.
  object.rotation.x = -SLIDE_ANGLE;
  return { object, uniforms };
}

// ---------------------------------------------------------------------------

export interface VignetteHandles {
  mesh: Mesh;
  uniforms: { uStrength: { value: number } };
}

/**
 * Comfort vignette: a small sphere AROUND the camera (never a flat quad —
 * in stereo a quad's edge shows as a hard line across the view). Darkens
 * purely by angle from the view axis, so there is no edge to see, and
 * only softly at that.
 */
export function createVignette(): VignetteHandles {
  const uniforms = { uStrength: { value: 0 } };
  const material = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: BackSide,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position); // sphere is centered on the camera
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uStrength;
      void main() {
        // Angle away from straight-ahead (-Z in camera space).
        float ang = acos(clamp(dot(normalize(vDir), vec3(0.0, 0.0, -1.0)), -1.0, 1.0));
        float a = smoothstep(0.95, 1.9, ang) * uStrength;
        gl_FragColor = vec4(0.0, 0.0, 0.02, a);
      }
    `
  });
  const mesh = new Mesh(new SphereGeometry(0.35, 32, 16), material);
  mesh.renderOrder = 999;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
