import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace
} from '@iwsdk/core';

import { NEON } from '../constants.js';

/**
 * The graffiti field: every player who survives the descent tags the bottom
 * of the world with "<NAME> WAS HERE". No leaderboard panel — the marks live
 * *in* the finish zone as hand-sprayed neon, stencilled flat around the
 * landing pad and floating in the mist among the debris shapes. A handful
 * reads as scattered signatures; a hundred reads as a shrine.
 *
 * Everything is canvas-baked (mipmapped, VR-stable) and cheap: one small
 * texture + one plane per mark.
 */

const TAG_COLORS = [
  NEON.cyan,
  NEON.magenta,
  NEON.lime,
  NEON.amber,
  NEON.yellow,
  NEON.purple
];

const CANVAS_W = 384;
const CANVAS_H = 144;

export class GraffitiField {
  readonly group = new Group();

  /** Rebuild the whole field from a list of names (newest first). */
  setMarks(names: string[]): void {
    this.clear();
    names.forEach((name, i) => this.group.add(buildTag(name, hashSeed(name, i))));
  }

  /**
   * The player's own freshly sprayed tag — bigger, brighter, and placed by
   * the caller right where they're standing so they watch it appear.
   */
  spawnPersonal(name: string): Group {
    const tag = buildTagMesh(name, hashSeed(name, 777), 3.4, 1.0);
    this.group.add(tag);
    return tag;
  }

  private clear(): void {
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];
      this.group.remove(child);
      child.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mat = mesh.material as MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
      });
    }
  }
}

/**
 * One placed tag in finish-zone local space. Roughly a third are stencilled
 * flat on the deck in a tight ring around the pad; the rest hang in the air
 * amongst the debris field, facing inward so the landing player is
 * surrounded by everyone who came before.
 */
function buildTag(name: string, seed: number): Group {
  const rng = mulberry32(seed);
  const width = 1.1 + rng() * 2.0;
  const tag = buildTagMesh(name, seed, width, 0.55 + rng() * 0.35);

  if (rng() < 0.35) {
    // Deck stencil: flat, just off the floor, random yaw. Tiny per-tag
    // height offset so overlapping sprays never z-fight.
    const radius = 2.6 + rng() * 10;
    const angle = rng() * Math.PI * 2;
    tag.position.set(
      Math.cos(angle) * radius,
      0.03 + rng() * 0.02,
      Math.sin(angle) * radius - 2
    );
    tag.rotation.set(-Math.PI / 2, 0, rng() * Math.PI * 2);
  } else {
    // Floating spray: hangs in the mist among the debris. Face the pad
    // properly (lookAt, not hand-rolled yaw — v1 had tags side-on, which
    // read as mirrored text through their DoubleSide backs), then add a
    // little hand-hung jitter.
    const radius = 4.5 + rng() * 13;
    const angle = rng() * Math.PI * 2;
    tag.position.set(
      Math.cos(angle) * radius,
      0.4 + rng() * 5.2,
      Math.sin(angle) * radius - 2
    );
    tag.lookAt(0, tag.position.y * 0.6 + 0.8, -2);
    tag.rotation.y += (rng() - 0.5) * 0.35;
    tag.rotation.z += (rng() - 0.5) * 0.2;
  }
  return tag;
}

/** The tag plane itself: canvas art on an unlit, fog-proof, additive plane. */
function buildTagMesh(
  name: string,
  seed: number,
  width: number,
  opacity: number
): Group {
  const rng = mulberry32(seed);
  const color = TAG_COLORS[Math.floor(rng() * TAG_COLORS.length)];
  const style = Math.floor(rng() * 3);

  const texture = new CanvasTexture(drawTag(name, color, style, rng));
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;

  const mesh = new Mesh(
    new PlaneGeometry(width, width * (CANVAS_H / CANVAS_W)),
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      fog: false
    })
  );
  const group = new Group();
  group.add(mesh);
  return group;
}

/**
 * Spray-paint the words. Three hand styles — wet fill, hollow stencil,
 * marker-over-glow — with per-letter wobble and paint drips so no two
 * signatures come out alike even for the same name.
 */
function drawTag(
  name: string,
  color: number,
  style: number,
  rng: () => number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d')!;
  const hex = `#${color.toString(16).padStart(6, '0')}`;

  // Fit the name: shrink the font until it fits the canvas with margins.
  let fontSize = 64;
  ctx.font = graffitiFont(fontSize);
  while (ctx.measureText(name).width > CANVAS_W - 70 && fontSize > 22) {
    fontSize -= 4;
    ctx.font = graffitiFont(fontSize);
  }

  const baseline = CANVAS_H * 0.52;
  const totalW = ctx.measureText(name).width;
  let x = (CANVAS_W - totalW) / 2;
  const slant = (rng() - 0.5) * 0.1; // whole-tag lean

  ctx.save();
  ctx.translate(CANVAS_W / 2, baseline);
  ctx.rotate(slant);
  ctx.translate(-CANVAS_W / 2, -baseline);

  const letters: Array<{ ch: string; x: number; y: number; w: number }> = [];
  for (const ch of name) {
    const w = ctx.measureText(ch).width;
    letters.push({ ch, x, y: baseline + (rng() - 0.5) * 7, w });
    x += w;
  }

  const drawLetters = (): void => {
    for (const l of letters) {
      ctx.save();
      ctx.translate(l.x + l.w / 2, l.y);
      ctx.rotate((rng() - 0.5) * 0.14);
      if (style === 1) ctx.strokeText(l.ch, -l.w / 2, 0);
      else ctx.fillText(l.ch, -l.w / 2, 0);
      ctx.restore();
    }
  };

  ctx.font = graffitiFont(fontSize);
  ctx.textBaseline = 'alphabetic';

  // Pass 1 — spray halo.
  ctx.shadowColor = hex;
  ctx.shadowBlur = 26;
  ctx.fillStyle = hex;
  ctx.strokeStyle = hex;
  ctx.lineWidth = 4;
  drawLetters();

  // Pass 2 — the paint itself.
  ctx.shadowBlur = style === 2 ? 14 : 6;
  if (style === 2) ctx.fillStyle = '#ffffff'; // marker core over color glow
  drawLetters();
  ctx.shadowBlur = 0;

  // Drips: gravity always finds fresh paint.
  const drips = 2 + Math.floor(rng() * 3);
  ctx.fillStyle = hex;
  for (let i = 0; i < drips; i++) {
    const dripX = 40 + rng() * (CANVAS_W - 80);
    const top = baseline - 6;
    const len = 12 + rng() * 34;
    const w = 2.5 + rng() * 3;
    const grad = ctx.createLinearGradient(0, top, 0, top + len);
    grad.addColorStop(0, hex);
    grad.addColorStop(1, `${hex}00`);
    ctx.fillStyle = grad;
    ctx.fillRect(dripX, top, w, len);
    ctx.beginPath();
    ctx.arc(dripX + w / 2, top + len * 0.85, w * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // "WAS HERE" — the stamp that makes it a signature, not a name.
  ctx.fillStyle = '#e8ecff';
  ctx.shadowColor = hex;
  ctx.shadowBlur = 8;
  ctx.font = `600 ${Math.max(15, fontSize * 0.3)}px Arial, sans-serif`;
  const stamp = 'WAS HERE';
  const stampW = ctx.measureText(stamp).width;
  ctx.fillText(stamp, (CANVAS_W - stampW) / 2 + (rng() - 0.5) * 30, CANVAS_H * 0.86);

  ctx.restore();
  return canvas;
}

function graffitiFont(size: number): string {
  return `italic 900 ${size}px "Arial Black", Arial, sans-serif`;
}

/** Stable per-name seed so a mark lands in the same spot every visit. */
function hashSeed(name: string, index: number): number {
  let h = 2166136261 ^ index;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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
