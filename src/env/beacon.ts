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

const ROUTE: ReadonlyArray<readonly [number, number]> = [
  [-2.7, 0.78],
  [-2.28, 1.1],
  [-1.45, 0.02],
  [-1.05, 0.32],
  [0.05, -0.68],
  [0.48, -0.38],
  [2.05, -1.18]
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
      new PlaneGeometry(0.72, 0.27),
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
    this.drawAltitude(0, 1);

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

  /** Flash the arrow when a new descent sector is reached. */
  show(_index: number): void {
    this.milestonePulse = 1;
  }

  reset(): void {
    this.progress = 0;
    this.targetProgress = 0;
    this.milestonePulse = 0;
    this.mode = 'idle';
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

    const routeColor =
      mode === 'drop'
        ? NEON.amber
        : mode === 'finish'
          ? NEON.lime
          : mode === 'climb'
            ? NEON.cyan
            : NEON.magenta;
    this.arrowMaterial.color.setHex(routeColor);
    this.arrowGlowMaterial.color.setHex(routeColor);
    this.drawAltitude(altitudeMeters, mode === 'drop' ? 10 : 1);
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
    const targetY = a[1] + (b[1] - a[1]) * t;
    const pointsDownLeft = this.mode === 'drop' || this.mode === 'finish';
    this.arrow.position.set(targetX, targetY, 0.12);
    this.arrow.rotation.z = Math.atan2(-0.72, pointsDownLeft ? -0.68 : 0.68);
    this.youLabel.position.set(
      targetX + (pointsDownLeft ? 0.62 : -0.62),
      targetY + 0.67,
      0.13
    );
  }

  private drawAltitude(
    altitudeMeters: number,
    altitudeStep: number
  ): void {
    // During a drop this is a GPU texture upload, not just a text change.
    // Ten-metre steps remain easy to read at slide speed while reducing the
    // update cadence to well under once per second; stationary/grid altitude
    // retains one-metre precision.
    const altitude = Math.max(
      0,
      Math.round(altitudeMeters / altitudeStep) * altitudeStep
    );
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

  const toCanvas = ([x, y]: readonly [number, number]): [number, number] => [
    canvas.width / 2 + (x / BEACON_W) * canvas.width,
    canvas.height / 2 - (y / BEACON_H) * canvas.height
  ];
  const route = ROUTE.map(toCanvas);

  // One descending ridge rather than three equal mountains. Each block is a
  // short shoulder-to-peak climb; every slide is a much longer plunge.
  const mountainBase = canvas.height - 18;
  const mountainFill = ctx.createLinearGradient(0, 150, 0, mountainBase);
  mountainFill.addColorStop(0, 'rgba(23, 125, 145, 0.52)');
  mountainFill.addColorStop(0.48, 'rgba(80, 26, 112, 0.42)');
  mountainFill.addColorStop(1, 'rgba(8, 8, 30, 0.12)');
  const mountainLeft = 18;
  ctx.beginPath();
  ctx.moveTo(mountainLeft, route[0][1] + 42);
  route.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(route[route.length - 1][0], mountainBase);
  ctx.lineTo(mountainLeft, mountainBase);
  ctx.closePath();
  ctx.fillStyle = mountainFill;
  ctx.fill();

  // Broad, uneven facets keep the silhouette mountainous without turning
  // each gameplay phrase into a symmetrical triangle.
  const facetColors = [
    'rgba(41, 243, 255, 0.16)',
    'rgba(255, 61, 242, 0.14)',
    'rgba(138, 43, 255, 0.18)'
  ];
  for (let i = 0; i < 3; i++) {
    const shoulder = route[i * 2];
    const peak = route[i * 2 + 1];
    const landing = route[i * 2 + 2];
    const anchorX = peak[0] + (landing[0] - peak[0]) * 0.42;
    const anchorY = Math.min(mountainBase, landing[1] + 142 + i * 18);

    ctx.beginPath();
    ctx.moveTo(shoulder[0], shoulder[1]);
    ctx.lineTo(peak[0], peak[1]);
    ctx.lineTo(anchorX, anchorY);
    ctx.lineTo(landing[0], landing[1]);
    ctx.closePath();
    ctx.fillStyle = facetColors[i];
    ctx.fill();

    // The illuminated seam is a single deliberate cut from summit to base.
    // Following the inner facet anchor gave the middle magenta seam a kink.
    ctx.beginPath();
    ctx.moveTo(peak[0], peak[1]);
    ctx.lineTo(landing[0] - 18, mountainBase);
    ctx.strokeStyle = i === 0 ? '#29f3ff' : i === 1 ? '#ff3df2' : '#8a2bff';
    ctx.globalAlpha = 0.36;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

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
    // The finish gate is the final marker; another green node here would sit
    // directly over its label and make FINISH harder to read.
    if (i === route.length - 1) return;
    const peak = i % 2 === 1;
    ctx.fillStyle = peak ? '#ff3df2' : '#ffb347';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-8, -8, 16, 16);
    ctx.restore();
  });

  const finishPoint = route[route.length - 1];
  const gateX = finishPoint[0] - 27;
  const gateY = finishPoint[1] - 46;
  const gateWidth = 126;
  const gateBottom = mountainBase;
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

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
