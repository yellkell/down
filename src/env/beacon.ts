import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SRGBColorSpace
} from '@iwsdk/core';

import { NEON } from '../constants.js';

const BEACON_W = 6.4;
const BEACON_H = 4.35;
const MOUNTAIN_BOTTOM_OFFSET = 18;
const MOUNTAIN_Y_OFFSET = (MOUNTAIN_BOTTOM_OFFSET / 696) * BEACON_H;

const ROUTE: ReadonlyArray<readonly [number, number]> = [
  [-2.82, 0.28],
  [-2.52, 0.76],
  [-0.68, -0.9],
  [-0.18, -0.44],
  [1.18, -1.46],
  [1.76, -1.05],
  [2.55, -1.7]
];

type RouteMode = 'idle' | 'climb' | 'drop' | 'finish';

/** A live holographic route map whose arrow follows the player's altitude. */
export class SignBoard {
  readonly group = new Group();
  private readonly arrow = new Group();
  private readonly youLabel: Mesh;
  private readonly arrowMaterial: MeshBasicMaterial;
  private readonly arrowGlowMaterial: MeshBasicMaterial;
  private readonly altitudeContext: CanvasRenderingContext2D;
  private readonly altitudeTexture: CanvasTexture;
  private readonly countdownContext: CanvasRenderingContext2D;
  private readonly countdownTexture: CanvasTexture;
  private readonly countdownPlate: Mesh;
  private readonly bravoLabel: Mesh;
  private altitudeValue = -1;
  private countdownValue: number | null = null;
  private progress = 0;
  private targetProgress = 0;
  private milestonePulse = 0;
  private time = 0;
  private mode: RouteMode = 'idle';
  private failed = false;

  constructor() {
    const panel = new Mesh(
      new PlaneGeometry(BEACON_W, BEACON_H),
      new MeshBasicMaterial({
        map: drawBeaconTexture(),
        // The texture paints the entire rectangular board, so treating this
        // nearly opaque surface as transparent only forces it into Quest's
        // expensive stereo transparency pass. Make it a normal depth-writing
        // surface; the arrow, telemetry, and scan remain separate overlays.
        transparent: false,
        side: DoubleSide,
        depthTest: true,
        depthWrite: true
      })
    );
    this.group.add(panel);

    // This is a real mesh above the map, not another baked texture frame.
    this.arrowMaterial = new MeshBasicMaterial({
      color: NEON.amber,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide
    });

    const arrowShape = new Shape();
    // Tip is local origin. That lets the group sit on the exact route point
    // while the arrow extends up-right and points down-left at the player.
    // Pulsing around this origin cannot pull the tip away from its target.
    arrowShape.moveTo(-0.7, 0.055);
    arrowShape.lineTo(-0.315, 0.055);
    arrowShape.lineTo(-0.315, 0.15);
    arrowShape.lineTo(0, 0);
    arrowShape.lineTo(-0.315, -0.15);
    arrowShape.lineTo(-0.315, -0.055);
    arrowShape.lineTo(-0.7, -0.055);
    arrowShape.closePath();
    const arrowGeometry = new ShapeGeometry(arrowShape);
    const arrowCore = new Mesh(arrowGeometry, this.arrowMaterial);
    arrowCore.position.z = 0.01;
    arrowCore.renderOrder = 50;
    arrowCore.frustumCulled = false;

    this.arrowGlowMaterial = new MeshBasicMaterial({
      color: NEON.amber,
      transparent: true,
      opacity: 0.2,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide
    });
    const arrowGlow = new Mesh(arrowGeometry, this.arrowGlowMaterial);
    arrowGlow.scale.setScalar(1.2);
    arrowGlow.renderOrder = 49;
    arrowGlow.frustumCulled = false;
    this.arrow.add(arrowGlow, arrowCore);
    this.arrow.position.z = 0.12;
    this.arrow.renderOrder = 49;
    this.group.add(this.arrow);

    const youCanvas = document.createElement('canvas');
    youCanvas.width = 256;
    youCanvas.height = 96;
    const youContext = youCanvas.getContext('2d')!;
    youContext.font = '900 68px monospace';
    youContext.textAlign = 'center';
    youContext.textBaseline = 'middle';
    youContext.fillStyle = '#ffffff';
    youContext.shadowColor = '#29f3ff';
    youContext.shadowBlur = 12;
    youContext.fillText('YOU', youCanvas.width / 2, youCanvas.height / 2 + 2);
    const youTexture = new CanvasTexture(youCanvas);
    youTexture.colorSpace = SRGBColorSpace;
    youTexture.generateMipmaps = false;
    youTexture.minFilter = LinearFilter;
    youTexture.magFilter = LinearFilter;
    this.youLabel = new Mesh(
      new PlaneGeometry(0.96, 0.36),
      new MeshBasicMaterial({
        map: youTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide
      })
    );
    this.youLabel.position.z = 0.13;
    this.youLabel.renderOrder = 51;
    this.youLabel.frustumCulled = false;
    this.group.add(this.youLabel);

    const altitudeCanvas = document.createElement('canvas');
    altitudeCanvas.width = 576;
    altitudeCanvas.height = 128;
    this.altitudeContext = altitudeCanvas.getContext('2d')!;
    this.altitudeTexture = new CanvasTexture(altitudeCanvas);
    this.altitudeTexture.colorSpace = SRGBColorSpace;
    // This canvas changes during play. Regenerating its full mip chain on
    // every altitude step stalls Quest's render thread, so use one filtered
    // level and upload only the source pixels.
    this.altitudeTexture.generateMipmaps = false;
    this.altitudeTexture.minFilter = LinearFilter;
    this.altitudeTexture.magFilter = LinearFilter;
    const altitudePlate = new Mesh(
      new PlaneGeometry(2.1, 0.46),
      new MeshBasicMaterial({
        map: this.altitudeTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide
      })
    );
    altitudePlate.position.set(1.78, 1.78, 0.1);
    altitudePlate.renderOrder = 35;
    altitudePlate.frustumCulled = false;
    this.group.add(altitudePlate);
    this.drawAltitude(0);

    // Countdown has its own tiny texture. Hiding it at slide launch changes
    // only mesh visibility; it no longer forces the altitude canvas to redraw
    // and upload on the busiest frame of the transition.
    const countdownCanvas = document.createElement('canvas');
    countdownCanvas.width = 192;
    countdownCanvas.height = 128;
    this.countdownContext = countdownCanvas.getContext('2d')!;
    this.countdownTexture = new CanvasTexture(countdownCanvas);
    this.countdownTexture.colorSpace = SRGBColorSpace;
    this.countdownTexture.generateMipmaps = false;
    this.countdownTexture.minFilter = LinearFilter;
    this.countdownTexture.magFilter = LinearFilter;
    this.countdownPlate = new Mesh(
      new PlaneGeometry(0.7, 0.46),
      new MeshBasicMaterial({
        map: this.countdownTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide
      })
    );
    this.countdownPlate.position.set(0.42, 1.78, 0.1);
    this.countdownPlate.renderOrder = 35;
    this.countdownPlate.frustumCulled = false;
    this.countdownPlate.visible = false;
    this.group.add(this.countdownPlate);

    const bravoCanvas = document.createElement('canvas');
    bravoCanvas.width = 768;
    bravoCanvas.height = 192;
    const bravoContext = bravoCanvas.getContext('2d')!;
    bravoContext.font = '900 132px monospace';
    bravoContext.textAlign = 'center';
    bravoContext.textBaseline = 'middle';
    bravoContext.fillStyle = '#ffffff';
    bravoContext.shadowColor = '#29f3ff';
    bravoContext.shadowBlur = 22;
    bravoContext.fillText('BRAVO!', bravoCanvas.width / 2, bravoCanvas.height / 2 + 4);
    const bravoTexture = new CanvasTexture(bravoCanvas);
    bravoTexture.colorSpace = SRGBColorSpace;
    bravoTexture.generateMipmaps = false;
    bravoTexture.minFilter = LinearFilter;
    bravoTexture.magFilter = LinearFilter;
    this.bravoLabel = new Mesh(
      new PlaneGeometry(3.55, 0.88),
      new MeshBasicMaterial({
        map: bravoTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide
      })
    );
    this.bravoLabel.position.set(0.35, 0.55, 0.14);
    this.bravoLabel.renderOrder = 52;
    this.bravoLabel.frustumCulled = false;
    this.bravoLabel.visible = false;
    this.group.add(this.bravoLabel);

    this.group.position.set(-7.5, 2.4, -9.5);
    this.group.rotation.y = Math.PI / 7;
    this.placeArrow(0);
  }

  setBravo(visible: boolean): void {
    this.bravoLabel.visible = visible;
  }

  setFailed(failed: boolean): void {
    this.failed = failed;
    if (failed) {
      this.arrowMaterial.color.setHex(NEON.red);
      this.arrowGlowMaterial.color.setHex(NEON.red);
    }
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
    this.failed = false;
    this.bravoLabel.visible = false;
    this.placeArrow(0);
  }

  update(
    dt: number,
    routePosition: number | null,
    mode: RouteMode,
    altitudeMeters: number,
    countdown: number | null
  ): void {
    this.time += dt;
    this.group.position.y = 2.4 + Math.sin(this.time * 0.6) * 0.18;

    if (routePosition !== null) {
      this.targetProgress = Math.min(ROUTE.length - 1, Math.max(0, routePosition));
    }
    this.mode = mode;
    const response = mode === 'drop' ? 12 : 4.5;
    this.progress += (this.targetProgress - this.progress) * Math.min(1, dt * response);
    this.placeArrow(this.progress);

    const routeColor = this.failed
      ? NEON.red
      : mode === 'drop'
        ? NEON.amber
        : mode === 'finish'
          ? NEON.lime
          : mode === 'climb'
            ? NEON.cyan
            : NEON.magenta;
    this.arrowMaterial.color.setHex(routeColor);
    this.arrowGlowMaterial.color.setHex(routeColor);
    this.drawAltitude(altitudeMeters);
    this.drawCountdown(countdown);

    this.milestonePulse = Math.max(0, this.milestonePulse - dt * 1.3);
    const pulse = 1 + this.milestonePulse * 0.28 + Math.sin(this.time * 6) * 0.025;
    this.arrow.scale.setScalar(pulse);
    this.arrowGlowMaterial.opacity = 0.14 + 0.08 * Math.sin(this.time * 5) ** 2;

  }

  private placeArrow(progress: number): void {
    const i = Math.min(ROUTE.length - 2, Math.floor(progress));
    const t = progress - i;
    const a = ROUTE[i];
    const b = ROUTE[i + 1];
    const targetX = a[0] + (b[0] - a[0]) * t;
    const targetY = a[1] + (b[1] - a[1]) * t - MOUNTAIN_Y_OFFSET;
    const pointsDownLeft = this.mode === 'drop' || this.mode === 'finish';
    this.arrow.position.set(targetX, targetY, 0.12);
    this.arrow.rotation.z = Math.atan2(-0.72, pointsDownLeft ? -0.68 : 0.68);
    const labelX = targetX + (pointsDownLeft ? 0.72 : -0.72);
    this.youLabel.position.set(
      labelX,
      targetY + 0.72,
      0.13
    );
  }

  private drawAltitude(altitudeMeters: number): void {
    const altitude = Math.max(0, Math.round(altitudeMeters));
    if (altitude === this.altitudeValue) return;
    this.altitudeValue = altitude;

    const ctx = this.altitudeContext;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = 'middle';
    ctx.font = '700 58px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#29f3ff';
    ctx.shadowBlur = 15;
    ctx.fillText(`ALT ${altitude}M`, width - 36, height / 2 + 3);

    this.altitudeTexture.needsUpdate = true;
  }

  private drawCountdown(countdown: number | null): void {
    if (countdown === this.countdownValue) return;
    this.countdownValue = countdown;

    if (countdown === null) {
      this.countdownPlate.visible = false;
      return;
    }

    const ctx = this.countdownContext;
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = 'middle';
    ctx.font = '800 112px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffb347';
    ctx.shadowColor = '#ff6a2f';
    ctx.shadowBlur = 26;
    ctx.fillText(String(countdown), width / 2, height / 2 + 2);
    this.countdownTexture.needsUpdate = true;
    this.countdownPlate.visible = true;
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

  const toCanvas = ([x, y]: readonly [number, number]): [number, number] => [
    canvas.width / 2 + (x / BEACON_W) * canvas.width,
    canvas.height / 2 - ((y - MOUNTAIN_Y_OFFSET) / BEACON_H) * canvas.height
  ];
  const route = ROUTE.map(toCanvas);
  const mountainBase = canvas.height;
  drawFinishGate(ctx, route[route.length - 1], mountainBase);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;

  // Bake the generated transparent artwork into this already-opaque canvas.
  // The board remains a single depth-writing draw call on Quest instead of
  // adding another large transparent layer that could revive slide flicker.
  const mountain = new Image();
  mountain.onload = () => {
    ctx.drawImage(
      mountain,
      0,
      MOUNTAIN_BOTTOM_OFFSET,
      canvas.width,
      canvas.height
    );
    drawFinishGate(ctx, route[route.length - 1], mountainBase);
    texture.needsUpdate = true;
  };
  mountain.src = './images/mountain-route-v2.png';

  return texture;
}

function drawFinishGate(
  ctx: CanvasRenderingContext2D,
  finishPoint: readonly [number, number],
  gateBottom: number
): void {
  const gateX = finishPoint[0] - 27;
  const gateY = finishPoint[1] - 46;
  const gateWidth = 126;

  ctx.save();
  ctx.strokeStyle = '#54ff7a';
  ctx.lineWidth = 11;
  ctx.shadowColor = '#54ff7a';
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.moveTo(gateX, gateBottom);
  ctx.lineTo(gateX, gateY);
  ctx.lineTo(gateX + gateWidth, gateY);
  ctx.lineTo(gateX + gateWidth, gateBottom);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#05050d' : '#e8ecff';
    ctx.fillRect(gateX + i * (gateWidth / 8), gateY - 5, gateWidth / 8, 16);
  }
  ctx.shadowBlur = 10;
  ctx.font = '700 25px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#54ff7a';
  ctx.fillText('FINISH', gateX + gateWidth / 2, gateY + (gateBottom - gateY) / 2);
  ctx.restore();
}
