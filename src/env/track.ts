import {
  AdditiveBlending,
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
  TorusGeometry
} from '@iwsdk/core';

import { NEON, SLIDE_ANGLE } from '../constants.js';
import { makeGlow } from './fx.js';

export interface TrackHandles {
  group: Group;
  uniforms: { uTime: { value: number } };
  /** Hoop meshes + materials so the slide can fade them by distance —
   * a 3.5cm neon ring is subpixel beyond ~100m and shimmers if left crisp. */
  hoops: Array<{ mesh: Mesh; material: MeshBasicMaterial; baseOpacity: number }>;
  dispose: () => void;
}

// The heavy GPU resources live at module scope and are built exactly once:
// a slide track is created at the MOMENT a slide launches, and paying a
// shader compile or geometry upload right then drops frames — which in VR
// reads as the whole world flickering through the first seconds of descent.
const ribbonUniforms = { uTime: { value: 0 }, uLength: { value: 1 } };
let ribbonMaterial: ShaderMaterial | null = null;
let ribbonGeometry: PlaneGeometry | null = null;
let railGeometry: BoxGeometry | null = null;
let railMaterial: MeshBasicMaterial | null = null;
let hoopGeometry: TorusGeometry | null = null;

/**
 * A neon half-pipe of light, generated at slide start from wherever the rig
 * is to wherever it's going. Local -Z runs downhill; the group is pitched
 * by the slide angle so the ribbon hugs the descent line.
 */
export function createSlideTrack(length: number): TrackHandles {
  const group = new Group();
  group.rotation.x = -SLIDE_ANGLE;
  ribbonUniforms.uLength.value = length; // only one track exists at a time
  const uniforms = { uTime: ribbonUniforms.uTime };
  const disposables: Array<{ dispose: () => void }> = [];

  // --- Ribbon -----------------------------------------------------------
  ribbonMaterial ??= new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: ribbonUniforms,
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
        float core = 1.0 - smoothstep(0.0, w + 0.02, d);
        // Energy-conserving AA: the smoothstep widens the line to pixel
        // size, so once w exceeds the true 2cm half-width, dim it by the
        // same ratio. Without this, a grazing view smears all four lane
        // dividers into one full-bright sheet that pulses with the sin()
        // below — the giant magenta strobe at the start of every slide.
        return core * min(1.0, 0.02 / max(w, 1e-4));
      }

      void main() {
        vec3 cyan = vec3(0.16, 0.95, 1.0);
        vec3 magenta = vec3(1.0, 0.24, 0.95);

        // End fades so the ribbon dissolves into the void.
        float endFade = smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.92, vUv.y);

        vec3 col = vec3(0.012, 0.014, 0.035); // dark glass bed
        float alpha = 0.62;

        // Chevron arrows flowing downhill. The pattern must dissolve where a
        // pixel spans a big slice of its wavelength (far away / grazing view):
        // an under-sampled scrolling pattern strobes every frame — the
        // "whole slide flickers" artifact at the start of each descent.
        float chevPhase = (vLocal.y + abs(vLocal.x) * 1.6) * 0.14 + uTime * 1.4;
        float fw = fwidth(chevPhase);
        float chev = fract(chevPhase);
        float arrow = smoothstep(0.0, 0.05 + fw, chev) * smoothstep(0.16 + fw, 0.11, chev);
        float melt = clamp(1.0 - fw * 6.0, 0.0, 1.0);
        col += cyan * (arrow * melt + (1.0 - melt) * 0.06) * 0.5;

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
  // Unit plane stretched to the slide length — geometry is never rebuilt.
  ribbonGeometry ??= new PlaneGeometry(2.3, 1, 1, 1);
  const ribbon = new Mesh(ribbonGeometry, ribbonMaterial);
  ribbon.rotation.x = -Math.PI / 2;
  ribbon.scale.y = length;
  ribbon.position.set(0, -0.02, -length / 2);
  group.add(ribbon);

  // (The "LOOK FORWARD" cue is the riser that rises from under the platform
  // before the slide — it is deliberately NOT written on the track ribbon.)

  // --- Rails ------------------------------------------------------------
  railGeometry ??= new BoxGeometry(0.06, 0.06, 1);
  railMaterial ??= new MeshBasicMaterial({
    color: NEON.cyan,
    blending: AdditiveBlending,
    transparent: true,
    opacity: 0.85,
    depthWrite: false
  });
  [-1.15, 1.15].forEach((x) => {
    const rail = new Mesh(railGeometry!, railMaterial!);
    rail.scale.z = length;
    rail.position.set(x, 0.05, -length / 2);
    group.add(rail);
  });

  // --- Energy hoops every 40m — motion + progress cue ------------------
  hoopGeometry ??= new TorusGeometry(1.7, 0.035, 10, 48);
  const hoopCount = Math.floor(length / 40);
  const hoops: TrackHandles['hoops'] = [];
  for (let i = 1; i <= hoopCount; i++) {
    const color = i % 2 === 0 ? NEON.cyan : NEON.magenta;
    const material = new MeshBasicMaterial({
      color,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 0.75,
      depthWrite: false
    });
    const hoop = new Mesh(hoopGeometry, material);
    hoop.position.set(0, 1.3, -i * 40);
    group.add(hoop);
    hoops.push({ mesh: hoop, material, baseOpacity: 0.75 });
    disposables.push(material);
    const glow = makeGlow(color, 4.5, 0.2);
    glow.position.copy(hoop.position);
    group.add(glow);
    disposables.push(glow.material);
  }

  return {
    group,
    uniforms,
    hoops,
    dispose: () => {
      group.removeFromParent();
      // Only the per-slide hoop/glow materials die here — the ribbon
      // program, rail material, and geometries are module singletons.
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

// NOTE: there is deliberately no comfort vignette. Any camera-attached
// darkening — quad or sphere — reads as a head-locked line/gradient
// sweeping across the world in stereo, which players find far worse
// than the motion it's meant to soften.
