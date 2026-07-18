import {
  AdditiveBlending,
  AssetManager,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3
} from '@iwsdk/core';

import { NEON } from '../constants.js';

// ---------------------------------------------------------------------------
// Mountain signs — the original hand-made artwork, now floating holograms.
// ---------------------------------------------------------------------------

const SIGN_IDS = ['signTop', 'signMiddle', 'signBottom', 'signFinish'] as const;

export class SignBoard {
  readonly group = new Group();
  private panels: Mesh[] = [];
  private materials: MeshBasicMaterial[] = [];
  private current = 0;
  private fade: { from: number; to: number; t: number } | null = null;
  private bobTime = 0;

  constructor() {
    const geometry = new PlaneGeometry(6, 4.5);
    SIGN_IDS.forEach((id, i) => {
      const texture = AssetManager.getTexture(id)!;
      texture.colorSpace = SRGBColorSpace;
      const material = new MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: i === 0 ? 1 : 0,
        side: DoubleSide,
        depthWrite: false
      });
      const panel = new Mesh(geometry, material);
      panel.visible = i === 0;
      this.group.add(panel);
      this.panels.push(panel);
      this.materials.push(material);
    });

    // Neon frame behind the sign.
    const frame = new Mesh(
      new PlaneGeometry(6.35, 4.85),
      new MeshBasicMaterial({
        color: NEON.cyan,
        transparent: true,
        opacity: 0.14,
        blending: AdditiveBlending,
        side: DoubleSide,
        depthWrite: false
      })
    );
    frame.position.z = -0.03;
    this.group.add(frame);

    this.group.position.set(-7.5, 2.4, -9.5);
    this.group.rotation.y = Math.PI / 7;
  }

  /** Crossfade to sign `index`; never regresses except to the finish sign. */
  show(index: number): void {
    if (index === this.current) return;
    if (index < this.current && index !== 3) return;
    this.panels[index].visible = true;
    this.fade = { from: this.current, to: index, t: 0 };
    this.current = index;
  }

  reset(): void {
    this.fade = null;
    this.current = 0;
    this.panels.forEach((p, i) => {
      p.visible = i === 0;
      this.materials[i].opacity = i === 0 ? 1 : 0;
    });
  }

  update(dt: number): void {
    this.bobTime += dt;
    this.group.position.y = 2.4 + Math.sin(this.bobTime * 0.6) * 0.18;

    if (this.fade) {
      this.fade.t += dt / 2; // 2s crossfade
      const t = Math.min(this.fade.t, 1);
      this.materials[this.fade.from].opacity = 1 - t;
      this.materials[this.fade.to].opacity = t;
      if (t >= 1) {
        this.panels[this.fade.from].visible = false;
        this.fade = null;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Confetti — one instanced mesh, ~450 pieces, CPU wobble physics.
// ---------------------------------------------------------------------------

const CONFETTI_COLORS = [
  0xff3355, 0xff8833, 0xfff35c, 0x54ff7a, 0x29f3ff, 0x3d6bff, 0xff3df2,
  0xffffff, 0xffcc00
];

interface ConfettiPiece {
  position: Vector3;
  velocity: Vector3;
  rotation: Vector3;
  spin: Vector3;
  wobble: number;
  wobbleSpeed: number;
}

export class Confetti {
  readonly mesh: InstancedMesh;
  private pieces: ConfettiPiece[] = [];
  private active = false;
  private elapsed = 0;
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly euler = new Euler();
  private readonly scale = new Vector3(1, 1, 1);
  private static readonly COUNT = 450;

  constructor() {
    this.mesh = new InstancedMesh(
      new PlaneGeometry(0.09, 0.05),
      new MeshBasicMaterial({ side: DoubleSide }),
      Confetti.COUNT
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const color = new Color();
    for (let i = 0; i < Confetti.COUNT; i++) {
      color.setHex(
        CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
      );
      this.mesh.setColorAt(i, color);
    }
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  /** Rain confetti around `center` (world space) for ~10 seconds. */
  start(center: Vector3): void {
    this.active = true;
    this.elapsed = 0;
    this.mesh.visible = true;
    this.pieces = [];
    for (let i = 0; i < Confetti.COUNT; i++) {
      this.pieces.push(this.spawnPiece(center, true));
    }
  }

  stop(): void {
    this.active = false;
    this.mesh.visible = false;
  }

  private spawnPiece(center: Vector3, initial: boolean): ConfettiPiece {
    return {
      position: new Vector3(
        center.x + (Math.random() - 0.5) * 7,
        center.y + 2.5 + Math.random() * (initial ? 5 : 1.5),
        center.z + (Math.random() - 0.5) * 7 - 2
      ),
      velocity: new Vector3(
        (Math.random() - 0.5) * 1.5,
        -1.2 - Math.random() * 1.8,
        (Math.random() - 0.5) * 1.5
      ),
      rotation: new Vector3(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      ),
      spin: new Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8
      ),
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 2 + Math.random() * 4
    };
  }

  update(dt: number, center: Vector3): void {
    if (!this.active) return;
    this.elapsed += dt;
    const stillRaining = this.elapsed < 10;

    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      p.wobble += p.wobbleSpeed * dt;
      p.position.y += p.velocity.y * dt;
      p.position.x += p.velocity.x * dt + Math.sin(p.wobble) * 0.02;
      p.position.z += p.velocity.z * dt + Math.cos(p.wobble) * 0.02;
      p.rotation.x += p.spin.x * dt;
      p.rotation.y += p.spin.y * dt;
      p.rotation.z += p.spin.z * dt;

      if (p.position.y < center.y - 3) {
        if (stillRaining) {
          this.pieces[i] = this.spawnPiece(center, false);
        } else {
          p.position.y = -9999; // parked far away until stop()
          p.velocity.y = 0;
        }
      }

      this.euler.set(p.rotation.x, p.rotation.y, p.rotation.z);
      this.quaternion.setFromEuler(this.euler);
      this.matrix.compose(p.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    if (!stillRaining && this.elapsed > 16) {
      this.stop();
    }
  }
}
