import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace
} from '@iwsdk/core';

import { NEON } from '../constants.js';

const BEACON_W = 6.4;
const BEACON_H = 4.35;

const ROUTE: ReadonlyArray<readonly [number, number]> = [
  [-2.42, 1.02],
  [-1.78, 0.62],
  [-1.2, 0.82],
  [-0.52, 0.18],
  [0.18, -0.12],
  [0.92, -0.7],
  [2.18, -0.7]
];

/** A live holographic route map whose arrow follows the player's altitude. */
export class SignBoard {
  readonly group = new Group();
  private readonly arrow = new Group();
  private readonly arrowMaterial: MeshBasicMaterial;
  private readonly scanLine: Mesh;
  private progress = 0;
  private targetProgress = 0;
  private milestonePulse = 0;
  private time = 0;

  constructor() {
    const panel = new Mesh(
      new PlaneGeometry(BEACON_W, BEACON_H),
      new MeshBasicMaterial({
        map: drawBeaconTexture(),
        transparent: true,
        side: DoubleSide,
        depthWrite: false
      })
    );
    this.group.add(panel);

    // This is a real mesh above the map, not another baked texture frame.
    this.arrowMaterial = new MeshBasicMaterial({
      color: NEON.amber,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide
    });
    const shaft = new Mesh(new BoxGeometry(0.42, 0.12, 0.035), this.arrowMaterial);
    shaft.position.x = -0.13;
    const head = new Mesh(new BoxGeometry(0.28, 0.28, 0.035), this.arrowMaterial);
    head.rotation.z = Math.PI / 4;
    head.position.x = 0.13;
    this.arrow.add(shaft, head);
    this.arrow.position.z = 0.06;
    this.group.add(this.arrow);

    this.scanLine = new Mesh(
      new PlaneGeometry(BEACON_W - 0.48, 0.025),
      new MeshBasicMaterial({
        color: NEON.cyan,
        transparent: true,
        opacity: 0.48,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide
      })
    );
    this.scanLine.position.z = 0.045;
    this.group.add(this.scanLine);

    this.group.position.set(-7.5, 2.4, -9.5);
    this.group.rotation.y = Math.PI / 7;
    this.placeArrow(0);
  }

  /** Flash the arrow when a new descent sector is reached. */
  show(_index: number): void {
    this.milestonePulse = 1;
  }

  reset(): void {
    this.progress = 0;
    this.targetProgress = 0;
    this.milestonePulse = 0;
    this.placeArrow(0);
  }

  update(dt: number, descentProgress: number): void {
    this.time += dt;
    this.group.position.y = 2.4 + Math.sin(this.time * 0.6) * 0.18;

    this.targetProgress = Math.max(
      this.targetProgress,
      Math.min(1, Math.max(0, descentProgress))
    );
    this.progress += (this.targetProgress - this.progress) * Math.min(1, dt * 4.5);
    this.placeArrow(this.progress);

    this.milestonePulse = Math.max(0, this.milestonePulse - dt * 1.3);
    const pulse = 1 + this.milestonePulse * 0.55 + Math.sin(this.time * 7) * 0.07;
    this.arrow.scale.setScalar(pulse);
    this.arrowMaterial.opacity = 0.78 + 0.22 * Math.sin(this.time * 8) ** 2;

    const scanT = (this.time * 0.18) % 1;
    this.scanLine.position.y = -1.75 + scanT * 3.5;
  }

  private placeArrow(progress: number): void {
    const scaled = progress * (ROUTE.length - 1);
    const i = Math.min(ROUTE.length - 2, Math.floor(scaled));
    const t = scaled - i;
    const a = ROUTE[i];
    const b = ROUTE[i + 1];
    this.arrow.position.x = a[0] + (b[0] - a[0]) * t;
    this.arrow.position.y = a[1] + (b[1] - a[1]) * t;
    this.arrow.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]);
  }
}

function drawBeaconTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 696;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(2, 3, 12, 0.94)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(41, 243, 255, 0.10)';
  for (let x = 32; x < canvas.width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 24; y < canvas.height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.lineWidth = 8;
  ctx.strokeStyle = '#29f3ff';
  ctx.shadowColor = '#29f3ff';
  ctx.shadowBlur = 22;
  ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
  ctx.strokeStyle = '#ff3df2';
  ctx.beginPath();
  ctx.moveTo(18, 170);
  ctx.lineTo(18, 18);
  ctx.lineTo(310, 18);
  ctx.stroke();

  ctx.shadowBlur = 12;
  ctx.font = '700 32px monospace';
  ctx.fillStyle = '#29f3ff';
  ctx.fillText('DESCENT // LIVE NAV', 52, 72);
  ctx.font = '700 20px monospace';
  ctx.fillStyle = '#ff3df2';
  ctx.fillText('ALTITUDE LINK: ACTIVE', 704, 68);

  const ridges = [
    [[70, 508], [170, 348], [248, 445], [372, 228], [495, 430], [590, 318], [720, 510]],
    [[74, 548], [214, 436], [308, 514], [424, 350], [536, 520], [650, 410], [748, 548]],
    [[104, 576], [252, 502], [354, 568], [474, 474], [602, 568], [734, 494], [818, 576]]
  ];
  const colors = ['#29f3ff', '#ff3df2', '#8a2bff'];
  ridges.forEach((points, i) => {
    ctx.beginPath();
    points.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = i === 0 ? 8 : 6;
    ctx.shadowColor = colors[i];
    ctx.shadowBlur = 18;
    ctx.stroke();
  });

  const toCanvas = ([x, y]: readonly [number, number]): [number, number] => [
    canvas.width / 2 + (x / BEACON_W) * canvas.width,
    canvas.height / 2 - (y / BEACON_H) * canvas.height
  ];
  ctx.beginPath();
  ROUTE.forEach((point, i) => {
    const [x, y] = toCanvas(point);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = '#ffb347';
  ctx.lineWidth = 5;
  ctx.setLineDash([14, 12]);
  ctx.shadowColor = '#ff7a2f';
  ctx.shadowBlur = 16;
  ctx.stroke();
  ctx.setLineDash([]);

  [0, 2, 4, 6].forEach((routeIndex, checkpoint) => {
    const [x, y] = toCanvas(ROUTE[routeIndex]);
    ctx.fillStyle = checkpoint === 3 ? '#54ff7a' : '#ffb347';
    ctx.fillRect(x - 8, y - 8, 16, 16);
  });

  const gateX = 844;
  const gateY = 490;
  ctx.strokeStyle = '#54ff7a';
  ctx.lineWidth = 11;
  ctx.shadowColor = '#54ff7a';
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.moveTo(gateX, gateY + 94);
  ctx.lineTo(gateX, gateY);
  ctx.lineTo(gateX + 126, gateY);
  ctx.lineTo(gateX + 126, gateY + 94);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#05050d' : '#e8ecff';
    ctx.fillRect(gateX + i * 15.75, gateY - 5, 15.75, 16);
  }
  ctx.shadowBlur = 10;
  ctx.font = '700 25px monospace';
  ctx.fillStyle = '#54ff7a';
  ctx.fillText('FINISH', gateX + 13, gateY + 62);

  ctx.font = '700 19px monospace';
  ctx.fillStyle = '#9ba0b5';
  ctx.fillText('SUMMIT / 300M', 54, 642);
  ctx.textAlign = 'right';
  ctx.fillText('TERMINAL / -180M', 970, 642);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
