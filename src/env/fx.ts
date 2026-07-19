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
 * distance; a baked texture stays rock-solid. 12 columns x 16 floors per
 * tile, built the way real skylines light up: windows in clustered runs
 * (offices share lights), whole floors dark, occasional fully-lit strip
 * floors, and each floor holding a dominant color temperature. Towers
 * then sample this at per-instance offsets/scales so no two look alike.
 */
export function makeWindowTexture(): CanvasTexture {
  const w = 512;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  const cols = 16;
  const rows = 20;
  const cw = w / cols;
  const ch = h / rows;
  const rnd = seededRandom(1979);
  // Near-monochrome office light: warm white / cool white, faint amber.
  // Saturated neon is reserved for signage and the environment — colored
  // window confetti is what makes a skyline look cheap.
  const palette: Array<[string, number]> = [
    ['#ffe6bf', 0.38],
    ['#d9e6ff', 0.3],
    ['#ffd28f', 0.16],
    ['#c3f2ff', 0.1],
    ['#ffffff', 0.04],
    ['#ffb0ef', 0.02]
  ];
  const pick = (): string => {
    let p = rnd();
    for (const [color, weight] of palette) {
      p -= weight;
      if (p <= 0) return color;
    }
    return palette[0][0];
  };

  // Small, crisp panes — barely any bloom. Sharp lights read expensive.
  const drawPane = (c: number, r: number, color: string, alpha: number): void => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 1.5;
    ctx.fillRect(c * cw + cw * 0.26, r * ch + ch * 0.3, cw * 0.48, ch * 0.36);
  };

  // Baseline glazing first: every pane gets a whisper of blue-grey, so a
  // facade reads as a glass curtain wall even where no lights are on —
  // that's the difference between a building and a black box with dots.
  ctx.shadowBlur = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.globalAlpha = 0.07 + rnd() * 0.07;
      ctx.fillStyle = '#8fa8d8';
      ctx.fillRect(c * cw + cw * 0.24, r * ch + ch * 0.28, cw * 0.52, ch * 0.4);
    }
  }

  for (let r = 0; r < rows; r++) {
    // Each floor leans toward one color temperature — offices share lighting.
    const floorColor = pick();

    if (rnd() < 0.2) {
      // Dark floor: at most a lone late-night window.
      if (rnd() < 0.35) drawPane(Math.floor(rnd() * cols), r, pick(), 0.75);
      continue;
    }

    // Normal floor: windows lit in clustered runs of 1-4.
    const density = 0.1 + rnd() * 0.3;
    let c = 0;
    while (c < cols) {
      if (rnd() < density) {
        const run = 1 + Math.floor(rnd() * rnd() * 4);
        const runColor = rnd() < 0.8 ? floorColor : pick();
        for (let k = 0; k < run && c + k < cols; k++) {
          drawPane(c + k, r, runColor, 0.55 + rnd() * 0.45);
        }
        c += run + 1;
      } else {
        c++;
      }
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
