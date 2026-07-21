import {
  AdditiveBlending,
  BoxGeometry,
  createSystem,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3
} from '@iwsdk/core';

import {
  BARRIER_COLORS,
  BARRIER_SIZE,
  BARRIER_SPACING,
  LANE_X,
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
  /** Wire materials per gate, faded by distance: a 1px additive line cage
   * hundreds of metres out is subpixel and strobes every frame — the far
   * glow sprite carries each gate's presence instead. */
  private barrierWires: Array<{ group: Group; material: LineBasicMaterial }> = [];
  private fadeWorld = new Vector3();
  private barrierGeometry = new BoxGeometry(
    BARRIER_SIZE.w,
    BARRIER_SIZE.h,
    BARRIER_SIZE.d
  );
  private barrierEdges = new EdgesGeometry(this.barrierGeometry);

  init(): void {
    on('game-over', () => this.endSlide(false));
    on('game-reset', () => this.endSlide(true));
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

    const start = this.player.position;
    const drop = start.y - this.targetY;
    const length = drop / Math.sin(SLIDE_ANGLE);

    // Track ends right where the slide does — riding it should feel like
    // reaching the end, not stopping partway down a longer ribbon.
    this.track = createSlideTrack(length + 4);
    this.track.group.position.copy(start);
    this.scene.add(this.track.group);

    this.spawnBarriers(start.clone(), length);
    emit('slide-start');
  }

  private spawnBarriers(start: Vector3, length: number): void {
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
        this.barriers.push(this.spawnBarrier(x, y + BARRIER_SIZE.h / 2, z));
      }
    }
  }

  private spawnBarrier(x: number, y: number, z: number): Group {
    const color = BARRIER_COLORS[Math.floor(Math.random() * BARRIER_COLORS.length)];
    const group = new Group();
    group.position.set(x, y, z);

    const fill = new Mesh(
      this.barrierGeometry,
      new MeshBasicMaterial({ color: 0x02020a, transparent: true, opacity: 0.88 })
    );
    fill.scale.setScalar(0.94);
    group.add(fill);

    const wireMaterial = new LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false
    });
    const wire = new LineSegments(this.barrierEdges, wireMaterial);
    group.add(wire);
    this.barrierWires.push({ group, material: wireMaterial });

    const glow = makeGlow(color, 1.1, 0.35);
    glow.position.y = BARRIER_SIZE.h / 2;
    group.add(glow);

    this.scene.add(group);
    return group;
  }

  private clearCourse(): void {
    this.barriers.forEach((b) => b.removeFromParent());
    this.barriers = [];
    this.barrierWires.forEach((w) => w.material.dispose());
    this.barrierWires = [];
    if (this.track) {
      this.track.dispose();
      this.track = null;
    }
  }

  /**
   * Distance-fade the crisp thin details (gate wires, hoops) so the far
   * course reads as calm glow markers instead of vibrating subpixel lines.
   * Everything is world-anchored — nothing here tracks the head.
   */
  private fadeCourseDetail(): void {
    const eye = this.player.position;
    for (const { group, material } of this.barrierWires) {
      const d = group.position.distanceTo(eye);
      material.opacity = 0.95 * Math.min(1, Math.max(0.12, (230 - d) / 160));
    }
    if (this.track) {
      for (const { mesh, material, baseOpacity } of this.track.hoops) {
        mesh.getWorldPosition(this.fadeWorld);
        const d = this.fadeWorld.distanceTo(eye);
        material.opacity = baseOpacity * Math.min(1, Math.max(0.15, (210 - d) / 140));
      }
    }
  }

  endSlide(clear: boolean): void {
    this.active = false;
    game.slideSpeed = 0;
    if (clear) this.clearCourse();
  }

  update(delta: number, time: number): void {
    if (this.track) this.track.uniforms.uTime.value = time / 1000;
    if (this.track || this.barrierWires.length > 0) this.fadeCourseDetail();
    if (!this.active) return;

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
