import {
  BoxGeometry,
  createSystem,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
  Vector3
} from '@iwsdk/core';

import {
  BARRIER_COLORS,
  BARRIER_SIZE,
  BARRIER_SPACING,
  LANE_X,
  PHASE_HEIGHTS,
  SLIDE_ACCEL_TIME,
  SLIDE_ANGLE,
  SLIDE_SPEED
} from '../constants.js';
import { makeGlow } from '../env/fx.js';
import { createSlideTrack, type TrackHandles } from '../env/track.js';
import { emit, game, on } from '../state.js';

/**
 * Gate patterns per slide difficulty: each entry is the set of lanes
 * blocked at that gate. Single-lane gates leave two ways through;
 * double-lane gates force one specific opening.
 */
const PATTERNS: Record<string, ReadonlyArray<ReadonlyArray<number>>> = {
  easy: [[0], [1], [2], [0], [2], [1]],
  medium: [[0], [2], [0, 1], [1], [1, 2], [0], [0, 2], [2]],
  final: [[1], [0, 1], [2], [0], [1, 2], [0, 2], [1], [2], [0, 1]]
};

export interface SlideRequest {
  targetY: number;
  isFinal: boolean;
}

interface PendingBarrier {
  x: number;
  y: number;
  z: number;
}

interface BarrierDetail {
  group: Group;
  wire: LineSegments;
  material: LineBasicMaterial;
  glow: Sprite;
  glowMaterial: SpriteMaterial;
}

const BARRIER_BUILD_DISTANCE = 190;
const BARRIER_BODY_DISTANCE = 185;
const BARRIER_WIRE_DISTANCE = 125;
const BARRIER_GLOW_DISTANCE = 65;

/**
 * Rides the rig down the 20° descent line: eased launch and landing,
 * a generated light-track to follow, and slalom barriers to dodge.
 */
export class SlideSystem extends createSystem({}) {
  private active = false;
  private targetY = 0;
  private isFinal = false;
  private speed = 0;
  private elapsed = 0;
  private track: TrackHandles | null = null;
  private barriers: Group[] = [];
  private pendingBarriers: PendingBarrier[] = [];
  /** Fine details are only rendered when useful. Far transparent draws were
   * saturating Quest's tiled GPU at the top of each slide. */
  private barrierDetails: BarrierDetail[] = [];
  private fadeWorld = new Vector3();
  private barrierGeometry = new BoxGeometry(
    BARRIER_SIZE.w,
    BARRIER_SIZE.h,
    BARRIER_SIZE.d
  );
  private barrierEdges = new EdgesGeometry(this.barrierGeometry);
  private barrierFill = new MeshBasicMaterial({
    color: 0x02020a,
    transparent: false,
    depthTest: true,
    depthWrite: true
  });
  private warmup: Group | null = null;
  private warmupTrack: TrackHandles | null = null;
  private warmupDetail: BarrierDetail | null = null;
  private warmupTimer = 3;

  init(): void {
    on('game-over', () => this.endSlide(false));
    on('game-reset', () => this.endSlide(true));
    this.spawnWarmup();
  }

  /**
   * Render every slide-course material once at boot, microscopically. A
   * slide track is otherwise first drawn the moment a slide launches, and
   * the shader compiles / pipeline setup right then drop frames — which in
   * VR reads as the whole world flickering through the descent's first
   * seconds (worst on slide 1, when nothing was cached yet).
   */
  private spawnWarmup(): void {
    const group = new Group();
    this.warmupTrack = createSlideTrack(4);
    group.add(this.warmupTrack.group);
    const barrier = this.spawnBarrier(0, 0, 0);
    barrier.removeFromParent();
    this.warmupDetail = this.barrierDetails.pop() ?? null;
    group.add(barrier);
    group.scale.setScalar(0.001); // sub-centimetre: draws, but invisible
    group.position.set(0, PHASE_HEIGHTS[0] - 2, -2);
    group.traverse((node) => (node.frustumCulled = false));
    this.scene.add(group);
    this.warmup = group;
  }

  getBarriers(): Group[] {
    return this.barriers;
  }

  /** Kick off a slide from wherever the rig currently is. */
  begin(request: SlideRequest): void {
    this.active = true;
    this.targetY = request.targetY;
    this.isFinal = request.isFinal;
    this.speed = 0;
    this.elapsed = 0;
    this.pendingBarriers = [];

    const start = this.player.position;
    const drop = start.y - this.targetY;
    const length = drop / Math.sin(SLIDE_ANGLE);

    // Track ends right where the slide does — riding it should feel like
    // reaching the end, not stopping partway down a longer ribbon.
    this.track = createSlideTrack(length + 4);
    this.track.group.position.copy(start);
    this.scene.add(this.track.group);

    this.queueBarriers(start.clone(), length);
    // The first rendered slide frame must never contain every distant hoop
    // and glow. Cull the track immediately, before control returns to render.
    this.cullCourseDetail();
    emit('slide-start');
  }

  private queueBarriers(start: Vector3, length: number): void {
    let spacing: number;
    let pattern: ReadonlyArray<ReadonlyArray<number>>;
    if (this.isFinal) {
      spacing = BARRIER_SPACING[2];
      pattern = PATTERNS.final;
    } else if (start.y > 100) {
      spacing = BARRIER_SPACING[0];
      pattern = PATTERNS.easy;
    } else {
      spacing = BARRIER_SPACING[1];
      pattern = PATTERNS.medium;
    }

    // No barriers in the final stretch — leave room to land.
    const count = Math.floor((length - 12) / spacing);
    for (let i = 1; i <= count; i++) {
      const distance = i * spacing;
      const lanes = pattern[i % pattern.length];
      const y = start.y - Math.sin(SLIDE_ANGLE) * distance;
      const z = start.z - Math.cos(SLIDE_ANGLE) * distance;
      for (const lane of lanes) {
        const x = start.x + LANE_X[lane];
        this.pendingBarriers.push({
          x,
          y: y + BARRIER_SIZE.h / 2,
          z
        });
      }
    }
  }

  /** Build at most one upcoming obstacle per frame. Constructing the entire
   * course in the launch frame stalls Quest long enough to break stereo
   * reprojection, which makes unrelated UI flicker too. */
  private spawnQueuedBarrier(): void {
    const next = this.pendingBarriers[0];
    if (!next) return;
    this.fadeWorld.set(next.x, next.y, next.z);
    if (this.fadeWorld.distanceTo(this.player.position) > BARRIER_BUILD_DISTANCE) {
      return;
    }
    this.pendingBarriers.shift();
    this.barriers.push(this.spawnBarrier(next.x, next.y, next.z));
  }

  private spawnBarrier(x: number, y: number, z: number): Group {
    const color = BARRIER_COLORS[Math.floor(Math.random() * BARRIER_COLORS.length)];
    const group = new Group();
    group.position.set(x, y, z);

    const fill = new Mesh(this.barrierGeometry, this.barrierFill);
    fill.scale.setScalar(0.94);
    group.add(fill);

    const wireMaterial = new LineBasicMaterial({
      color,
      transparent: false,
      depthTest: true,
      depthWrite: true
    });
    const wire = new LineSegments(this.barrierEdges, wireMaterial);
    group.add(wire);

    const glow = makeGlow(color, 1.1, 0.35);
    glow.position.y = BARRIER_SIZE.h / 2;
    group.add(glow);
    this.barrierDetails.push({
      group,
      wire,
      material: wireMaterial,
      glow,
      glowMaterial: glow.material
    });

    this.scene.add(group);
    return group;
  }

  private clearCourse(): void {
    this.pendingBarriers = [];
    this.barriers.forEach((b) => b.removeFromParent());
    this.barriers = [];
    this.barrierDetails.forEach((detail) => {
      detail.material.dispose();
      detail.glowMaterial.dispose();
    });
    this.barrierDetails = [];
    if (this.track) {
      this.track.dispose();
      this.track = null;
    }
  }

  /** Hard visibility gates avoid both subpixel shimmer and zero-opacity
   * transparent draw calls. Everything remains world-anchored. */
  private cullCourseDetail(): void {
    const eye = this.player.position;
    for (const detail of this.barrierDetails) {
      const { group, wire, glow } = detail;
      const d = group.position.distanceTo(eye);
      group.visible = d < BARRIER_BODY_DISTANCE;
      wire.visible = d < BARRIER_WIRE_DISTANCE;
      glow.visible = d < BARRIER_GLOW_DISTANCE;
    }
    if (this.track) {
      for (const hoop of this.track.hoops) {
        hoop.mesh.getWorldPosition(this.fadeWorld);
        const d = this.fadeWorld.distanceTo(eye);
        hoop.mesh.visible = d < 140;
        hoop.glow.visible = d < 75;
      }
    }
  }

  endSlide(clear: boolean): void {
    this.active = false;
    game.slideSpeed = 0;
    if (clear) this.clearCourse();
  }

  update(delta: number, time: number): void {
    if (this.warmup) {
      this.warmupTimer -= delta;
      if (this.warmupTimer <= 0) {
        this.warmup.removeFromParent();
        this.warmupTrack?.dispose();
        this.warmupDetail?.material.dispose();
        this.warmupDetail?.glowMaterial.dispose();
        this.warmup = null;
        this.warmupTrack = null;
        this.warmupDetail = null;
      }
    }
    if (this.track) this.track.uniforms.uTime.value = time / 1000;
    if (!this.active) return;

    this.spawnQueuedBarrier();
    this.cullCourseDetail();

    this.elapsed += delta;

    // Ease in for comfort — then full speed all the way into the landing.
    // No end-of-slide braking: the arrival shockwave sells the stop, and a
    // hard cut reads better in VR than a long decel.
    const launch = Math.min(1, this.elapsed / SLIDE_ACCEL_TIME);
    this.speed = SLIDE_SPEED * launch * launch;
    game.slideSpeed = this.speed;

    const dy = -Math.sin(SLIDE_ANGLE) * this.speed * delta;
    const dz = -Math.cos(SLIDE_ANGLE) * this.speed * delta;
    this.player.position.y += dy;
    this.player.position.z += dz;

    if (this.player.position.y <= this.targetY + 0.5) {
      this.player.position.y = this.targetY;
      this.active = false;
      game.slideSpeed = 0;
      this.clearCourse();
      emit(this.isFinal ? 'final-slide-complete' : 'slide-complete');
    }
  }
}
