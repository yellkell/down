import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  RepeatWrapping,
  Sprite,
  SpriteMaterial,
  Texture
} from '@iwsdk/core';

let glowTexture: Texture | null = null;

/** Tiny deterministic PRNG so baked textures are identical every run. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 16807) % 2147483647 || 1;
    return s / 2147483647;
  };
}

/**
 * Lit-window texture for the tower faces, baked once to a canvas so it
 * mipmaps cleanly — procedural per-pixel grids shimmer badly in VR at
 * distance; a baked texture stays rock-solid. One tile covers 16m x 24m
 * of facade: 6 window columns, 8 floors, with real structure — dark
 * floors, dense floors, warm/cool/neon color mix.
 */
export function makeWindowTexture(): CanvasTexture {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  const cols = 6;
  const rows = 8;
  const cw = w / cols;
  const ch = h / rows;
  const rnd = seededRandom(1979);
  // Weighted palette: mostly warm sodium/amber, cyan accents, rare magenta.
  const palette: Array<[string, number]> = [
    ['#ffb45e', 0.3],
    ['#ffd9a0', 0.24],
    ['#7defff', 0.17],
    ['#29f3ff', 0.12],
    ['#ff3df2', 0.07],
    ['#ffffff', 0.1]
  ];
  const pick = (): string => {
    let p = rnd();
    for (const [color, weight] of palette) {
      p -= weight;
      if (p <= 0) return color;
    }
    return palette[0][0];
  };

  for (let r = 0; r < rows; r++) {
    // Whole floors go dark; others are busy — that's what makes it read
    // as a lived-in building instead of static.
    const density = rnd() < 0.22 ? 0.08 : 0.3 + rnd() * 0.55;
    for (let c = 0; c < cols; c++) {
      if (rnd() > density) continue;
      const color = pick();
      ctx.globalAlpha = 0.5 + rnd() * 0.5;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
      ctx.fillRect(c * cw + cw * 0.2, r * ch + ch * 0.24, cw * 0.6, ch * 0.46);
    }
  }
  ctx.globalAlpha = 1;

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Soft multi-lobed cloud puff on a transparent canvas, for mist sprites. */
export function makeCloudTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const rnd = seededRandom(777);
  for (let i = 0; i < 9; i++) {
    const cx = size * 0.5 + (rnd() - 0.5) * size * 0.45;
    const cy = size * 0.55 + (rnd() - 0.5) * size * 0.3;
    const radius = size * (0.12 + rnd() * 0.17);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, 'rgba(255,255,255,0.42)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

/** Soft radial glow sprite texture, generated once on a canvas. */
export function getGlowTexture(): Texture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new CanvasTexture(canvas);
  return glowTexture;
}

/** Neon text rendered to a transparent canvas, for floor/track decals. */
export function makeTextTexture(
  text: string,
  opts?: { color?: string; width?: number; height?: number }
): CanvasTexture {
  const width = opts?.width ?? 1024;
  const height = opts?.height ?? 256;
  const color = opts?.color ?? '#29f3ff';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  ctx.font = `900 ${Math.floor(height * 0.52)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = height * 0.24;
  ctx.fillStyle = color;
  // Two passes to bloom the glow, then a white-hot core for legibility.
  ctx.fillText(text, width / 2, height / 2);
  ctx.fillText(text, width / 2, height / 2);
  ctx.shadowBlur = height * 0.06;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, width / 2, height / 2);
  const texture = new CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

/** Additive glow sprite — the poor VR dev's bloom. */
export function makeGlow(color: number | string, scale: number, opacity = 1): Sprite {
  const material = new SpriteMaterial({
    map: getGlowTexture(),
    color: new Color(color),
    blending: AdditiveBlending,
    transparent: true,
    opacity,
    depthWrite: false
  });
  const sprite = new Sprite(material);
  sprite.scale.setScalar(scale);
  return sprite;
}

/** Shared GLSL: cheap value-noise + fbm used by the sky + floor shaders. */
export const NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i);
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.02 + vec3(13.7);
      a *= 0.5;
    }
    return v;
  }
`;
