import {
  AdditiveBlending,
  BackSide,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry
} from '@iwsdk/core';

export interface HoopFlashHandles {
  mesh: Mesh;
  uniforms: {
    uColor: { value: Color };
    uStrength: { value: number };
  };
}

/**
 * An edgeless visor tint for the instant the player crosses a track hoop.
 *
 * This is deliberately a constant-colour sphere around both eyes, not the
 * old angle-based comfort vignette. With no gradient or boundary anywhere
 * in the fragment shader, head rotation cannot reveal a tilting line. The
 * material stays renderable at zero strength so its GPU program is compiled
 * before the first mid-slide crossing.
 */
export function createHoopFlash(): HoopFlashHandles {
  const uniforms = {
    uColor: { value: new Color(0x29f3ff) },
    uStrength: { value: 0 }
  };
  const material = new ShaderMaterial({
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: BackSide,
    uniforms,
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      void main() {
        gl_FragColor = vec4(uColor, uStrength);
      }
    `
  });
  const mesh = new Mesh(new SphereGeometry(0.35, 24, 16), material);
  mesh.renderOrder = 10000;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
