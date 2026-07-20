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
  [-2.66, -0.82],
  [-1.92, 1.12],
  [-1.28, -0.58],
  [-0.48, 0.82],
  [0.16, -0.68],
  [0.94, 1.02],
  [2.26, -0.8]
];

type RouteMode = 'idle' | 'climb' | 'drop' | 'finish';

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
  private mode: RouteMode = 'idle';

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
    const shaft = new Mesh(new BoxGeometry(0.42, 0.11, 0.035), this.arrowMaterial);
    shaft.position.x = -0.16;
    const upper = new Mesh(new BoxGeometry(0.32, 0.1, 0.035), this.arrowMaterial);
    upper.position.set(0.12, 0.1, 0);
    upper.rotation.z = -0.62;
    const lower = new Mesh(new BoxGeometry(0.32, 0.1, 0.035), this.arrowMaterial);
    lower.position.set(0.12, -0.1, 0);
    lower.rotation.z = 0.62;
    this.arrow.add(shaft, upper, lower);
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
    this.mode = 'idle';
    this.placeArrow(0);
  }

  update(dt: number, routePosition: number | null, mode: RouteMode): void {
    this.time += dt;
    this.group.position.y = 2.4 + Math.sin(this.time * 0.6) * 0.18;

    if (routePosition !== null) {
      this.targetProgress = Math.min(ROUTE.length - 1, Math.max(0, routePosition));
    }
    this.mode = mode;
    const response = mode === 'drop' ? 12 : 4.5;
    this.progress += (this.targetProgress - this.progress) * Math.min(1, dt * response);
    this.placeArrow(this.progress);

    this.arrowMaterial.color.setHex(
      mode === 'drop'
        ? NEON.amber
        : mode === 'finish'
          ? NEON.lime
          : mode === 'climb'
            ? NEON.cyan
            : NEON.magenta
    );

    this.milestonePulse = Math.max(0, this.milestonePulse - dt * 1.3);
    const pulse = 1 + this.milestonePulse * 0.55 + Math.sin(this.time * 7) * 0.07;
    this.arrow.scale.setScalar(pulse);
    this.arrowMaterial.opacity = 0.78 + 0.22 * Math.sin(this.time * 8) ** 2;

    const scanT = (this.time * 0.18) % 1;
    this.scanLine.position.y = -1.75 + scanT * 3.5;
  }

  private placeArrow(progress: number): void {
    const i = Math.min(ROUTE.length - 2, Math.floor(progress));
    const t = progress - i;
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
  ctx.fillText('RUN SCORE // MUSIC LOCKED', 52, 72);
  ctx.font = '700 20px monospace';
  ctx.fillStyle = '#ff3df2';
  ctx.fillText('3 ASCENTS // 3 DROPS', 730, 68);

  const toCanvas = ([x, y]: readonly [number, number]): [number, number] => [
    canvas.width / 2 + (x / BEACON_W) * canvas.width,
    canvas.height / 2 - (y / BEACON_H) * canvas.height
  ];
  const route = ROUTE.map(toCanvas);

  // Three distinct mountain faces. Their peaks and valleys are the actual
  // phase boundaries, so the artwork is also a readable score of the run.
  const faces = [
    { points: [route[0], route[1], route[2]], fill: 'rgba(13, 74, 94, 0.38)', edge: '#29f3ff' },
    { points: [route[2], route[3], route[4]], fill: 'rgba(104, 20, 96, 0.34)', edge: '#ff3df2' },
    { points: [route[4], route[5], route[6]], fill: 'rgba(57, 29, 118, 0.38)', edge: '#8a2bff' }
  ];
  faces.forEach((face) => {
    ctx.beginPath();
    face.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = face.fill;
    ctx.fill();
    ctx.strokeStyle = face.edge;
    ctx.lineWidth = 4;
    ctx.shadowColor = face.edge;
    ctx.shadowBlur = 13;
    ctx.stroke();

    const [left, peak, right] = face.points;
    const baseMidX = (left[0] + right[0]) * 0.5;
    const baseMidY = (left[1] + right[1]) * 0.5;
    ctx.beginPath();
    ctx.moveTo(peak[0], peak[1]);
    ctx.lineTo(baseMidX, baseMidY);
    ctx.moveTo(peak[0], peak[1]);
    ctx.lineTo((peak[0] + right[0]) * 0.5, (peak[1] + right[1]) * 0.5 + 34);
    ctx.strokeStyle = face.edge;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  // Route legs alternate deliberately: slow cyan climb during each block
  // section, sharp amber plunge when the soundtrack releases into a slide.
  for (let i = 0; i < route.length - 1; i++) {
    const climb = i % 2 === 0;
    ctx.beginPath();
    ctx.moveTo(route[i][0], route[i][1]);
    ctx.lineTo(route[i + 1][0], route[i + 1][1]);
    ctx.strokeStyle = climb ? '#29f3ff' : '#ffb347';
    ctx.lineWidth = climb ? 9 : 7;
    ctx.setLineDash(climb ? [] : [15, 10]);
    ctx.shadowColor = climb ? '#29f3ff' : '#ff6a2f';
    ctx.shadowBlur = 22;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  route.forEach(([x, y], i) => {
    const peak = i % 2 === 1;
    ctx.fillStyle = i === route.length - 1 ? '#54ff7a' : peak ? '#ff3df2' : '#ffb347';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-8, -8, 16, 16);
    ctx.restore();
  });

  ctx.shadowBlur = 8;
  ctx.font = '700 16px monospace';
  ctx.fillStyle = '#29f3ff';
  ctx.fillText('BLOCK ASCENT 01', 88, 545);
  ctx.fillText('BLOCK ASCENT 02', 310, 535);
  ctx.fillText('BLOCK ASCENT 03', 548, 545);
  ctx.fillStyle = '#ffb347';
  ctx.fillText('SLIDE 01', 230, 312);
  ctx.fillText('SLIDE 02', 462, 322);
  ctx.fillText('FINAL DROP', 700, 316);

  const gateX = 846;
  const gateY = 430;
  ctx.strokeStyle = '#54ff7a';
  ctx.lineWidth = 11;
  ctx.shadowColor = '#54ff7a';
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.moveTo(gateX, gateY + 108);
  ctx.lineTo(gateX, gateY);
  ctx.lineTo(gateX + 126, gateY);
  ctx.lineTo(gateX + 126, gateY + 108);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#05050d' : '#e8ecff';
    ctx.fillRect(gateX + i * 15.75, gateY - 5, 15.75, 16);
  }
  ctx.shadowBlur = 10;
  ctx.font = '700 25px monospace';
  ctx.fillStyle = '#54ff7a';
  ctx.fillText('FINISH', gateX + 13, gateY + 68);

  ctx.font = '700 19px monospace';
  ctx.fillStyle = '#29f3ff';
  ctx.fillText('GRID = CLIMB SLOW', 54, 646);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffb347';
  ctx.fillText('SLIDE = DROP FAST', 970, 646);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
