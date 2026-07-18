import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial
} from '@iwsdk/core';

import { GRID_SIZE, KILL_ZONE, NEON } from '../constants.js';
import { makeGlow } from './fx.js';

export interface PlatformHandles {
  group: Group;
  uniforms: {
    uTime: { value: number };
    uWarning: { value: number };
    uDanger: { value: number };
    /** 1 at the instant a slide lands, eased back to 0 — drives the shockwave. */
    uArrival: { value: number };
  };
}

/**
 * The floating dodge pad. One shader plane draws: the ambient far grid, the
 * bright 2x2 play grid, the red kill-zone boundary, and the "slide incoming"
 * magenta pulse — all reactive via uniforms fed by the game systems.
 */
export function createPlatform(): PlatformHandles {
  const group = new Group();
  const uniforms = {
    uTime: { value: 0 },
    uWarning: { value: 0 },
    uDanger: { value: 0 },
    uArrival: { value: 0 }
  };

  const half = GRID_SIZE / 2; // 0.75
  const kill = KILL_ZONE / 2; // 0.95

  const deckMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      ...uniforms,
      uHalf: { value: half },
      uKill: { value: kill }
    },
    vertexShader: /* glsl */ `
      varying vec2 vPos;
      void main() {
        vPos = position.xy; // plane local, becomes XZ after rotation
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vPos;
      uniform float uTime;
      uniform float uWarning;
      uniform float uDanger;
      uniform float uArrival;
      uniform float uHalf;
      uniform float uKill;

      float gridLine(vec2 p, float cell) {
        vec2 g = abs(fract(p / cell - 0.5) - 0.5) * cell;
        float d = min(g.x, g.y);
        float w = fwidth(d) * 1.5;
        return 1.0 - smoothstep(0.0, w + 0.012, d);
      }
      float rectEdge(vec2 p, float halfSize) {
        float d = abs(max(abs(p.x), abs(p.y)) - halfSize);
        float w = fwidth(d) * 1.5;
        return 1.0 - smoothstep(0.0, w + 0.014, d);
      }

      void main() {
        float r = length(vPos);
        // Fade the whole deck out towards its rim.
        float fade = 1.0 - smoothstep(2.2, 6.5, r);
        if (fade <= 0.0) discard;

        vec3 cyan = vec3(0.16, 0.95, 1.0);
        vec3 magenta = vec3(1.0, 0.24, 0.95);
        vec3 red = vec3(1.0, 0.13, 0.27);

        vec3 col = vec3(0.0);
        float alpha = 0.0;

        // Ambient wide grid, drifting slowly — gives the void a floor.
        float wide = gridLine(vPos, 0.75) * 0.16;
        col += cyan * wide;
        alpha += wide * 0.8;

        // Faint tint inside the play area — kept low-alpha so the rising
        // blocks stay clearly visible coming up through the deck.
        float inPad = step(max(abs(vPos.x), abs(vPos.y)), uKill + 0.12);
        col += vec3(0.02, 0.06, 0.09) * inPad;
        alpha = max(alpha, inPad * 0.22);

        // Bright 2x2 play grid + cross.
        float inGrid = step(max(abs(vPos.x), abs(vPos.y)), uHalf);
        float fineGrid = gridLine(vPos, uHalf) * inGrid;
        float frame = rectEdge(vPos, uHalf);
        float pulse = 0.75 + 0.25 * sin(uTime * 2.2);
        col += cyan * (fineGrid * 0.75 + frame * pulse);
        alpha = max(alpha, fineGrid * 0.75 + frame);

        // Kill-zone boundary: red, breathing, flaring with uDanger.
        float killEdge = rectEdge(vPos, uKill);
        float danger = 0.45 + 0.3 * sin(uTime * 3.0) + uDanger * 1.6;
        col += red * killEdge * danger;
        alpha = max(alpha, killEdge * min(danger, 1.0));

        // Slide-incoming pulse: magenta waves sweeping forward (-Z ahead).
        float sweep = sin(vPos.y * 4.0 + uTime * 9.0) * 0.5 + 0.5;
        col += magenta * uWarning * sweep * inPad * 0.6;
        alpha = max(alpha, uWarning * sweep * inPad * 0.5);

        // Arrival shockwave: a bright cyan ring blasts outward when a slide
        // lands, so touching down on a new platform reads as a real impact.
        float ringR = (1.0 - uArrival) * 4.5;
        float ring = smoothstep(0.35, 0.0, abs(r - ringR)) * uArrival;
        col += mix(cyan, vec3(1.0), 0.4) * ring * 2.2;
        alpha = max(alpha, ring);

        gl_FragColor = vec4(col, alpha * fade);
      }
    `
  });

  const deck = new Mesh(new PlaneGeometry(14, 14), deckMaterial);
  deck.rotation.x = -Math.PI / 2;
  group.add(deck);

  // Corner hex beacons on the kill boundary.
  const hexGeometry = new CylinderGeometry(0.05, 0.05, 0.012, 6);
  const corners: Array<[number, number]> = [
    [-kill, -kill],
    [kill, -kill],
    [-kill, kill],
    [kill, kill]
  ];
  corners.forEach(([x, z]) => {
    const hex = new Mesh(
      hexGeometry,
      new MeshBasicMaterial({
        color: NEON.red,
        blending: AdditiveBlending,
        transparent: true,
        opacity: 0.9,
        depthWrite: false
      })
    );
    hex.position.set(x, 0.015, z);
    group.add(hex);
    const glow = makeGlow(NEON.red, 0.35, 0.5);
    glow.position.set(x, 0.05, z);
    group.add(glow);
  });

  // Soft light pooling under the pad — sells "floating in the void".
  const under = makeGlow(NEON.cyan, 6, 0.16);
  under.position.y = -1.4;
  group.add(under);

  return { group, uniforms };
}
