import {
  AdditiveBlending,
  BufferGeometry,
  createSystem,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  LineSegments,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  Sprite,
  TetrahedronGeometry,
  Vector3,
  EdgesGeometry
} from '@iwsdk/core';

import {
  GRID_SIZE,
  KILL_ZONE,
  OBSTACLE_COLORS,
  PROJECTILE_DESPAWN_Y,
  PROJECTILE_SPAWN_Y,
  PROJECTILE_SPEED,
  SPAWN_INTERVAL
} from '../constants.js';
import { makeGlow } from './../env/fx.js';
import { game, on } from '../state.js';

export interface Projectile {
  group: Group;
  radius: number;
  speed: number;
  marker: Mesh;
  spinX: number;
  spinZ: number;
}

interface ShapeSet {
  geometry: BufferGeometry;
  edges: BufferGeometry;
}

/**
 * Round 1-3 dodge waves: neon polyhedra surge up through the platform.
 * Every wave leaves one quadrant safe; deck markers telegraph incoming
 * shapes so deaths feel earned, not random.
 */
export class GridSpawnerSystem extends createSystem({}) {
  private active = false;
  private timer = 0;
  private projectiles: Projectile[] = [];
  private shapes: ShapeSet[] = [];
  private markerGeometry = new RingGeometry(0.16, 0.22, 32);

  init(): void {
    const geometries = [
      new TetrahedronGeometry(1),
      new OctahedronGeometry(1),
      new DodecahedronGeometry(1),
      new IcosahedronGeometry(1)
    ];
    this.shapes = geometries.map((geometry) => ({
      geometry,
      edges: new EdgesGeometry(geometry) as unknown as BufferGeometry
    }));

    on('grid-start', () => {
      this.active = true;
      this.timer = 0;
    });
    on('slide-start', () => this.deactivate());
    on('game-over', () => this.deactivate());
    on('game-reset', () => this.deactivate());
  }

  getProjectiles(): Projectile[] {
    return this.projectiles;
  }

  /** True when a world-space point has left the kill zone around the rig. */
  isOutsideKillZone(worldPos: Vector3): boolean {
    const half = KILL_ZONE / 2;
    const dx = Math.abs(worldPos.x - this.player.position.x);
    const dz = Math.abs(worldPos.z - this.player.position.z);
    return dx > half || dz > half;
  }

  deactivate(): void {
    this.active = false;
    this.clear();
  }

  /** Stop launching new waves but let the airborne ones finish their rise. */
  holdFire(): void {
    this.active = false;
  }

  clear(): void {
    this.projectiles.forEach((p) => {
      p.group.removeFromParent();
      p.marker.removeFromParent();
    });
    this.projectiles = [];
  }

  update(delta: number): void {
    if (game.phase !== 'GRID') return;

    const round = Math.min(game.round, 3) - 1;

    // A block needs (spawn depth + overshoot) / speed seconds to clear the
    // deck. Never launch one that can't finish before the slide warning —
    // seeing blocks rise and then evaporate mid-flight feels broken.
    const flightTime =
      (Math.abs(PROJECTILE_SPAWN_Y) + PROJECTILE_DESPAWN_Y) /
      PROJECTILE_SPEED[round];
    const canFinish = game.roundRemaining > flightTime + 3.2;

    if (this.active && canFinish) {
      this.timer += delta;
      if (this.timer >= SPAWN_INTERVAL[round]) {
        this.timer = 0;
        this.spawnWave(round);
      }
    }

    const rigY = this.player.position.y;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.group.position.y += p.speed * delta;
      p.group.rotation.x += p.spinX * delta;
      p.group.rotation.z += p.spinZ * delta;

      // Telegraph marker brightens as the shape closes in from below.
      const distance = rigY - p.group.position.y;
      const material = p.marker.material as MeshBasicMaterial;
      if (distance > 0) {
        material.opacity = Math.min(1, Math.max(0, 1 - distance / 30)) * 0.85;
        const s = 1 + Math.min(1.2, Math.max(0, distance / 18));
        p.marker.scale.setScalar(s);
      } else {
        material.opacity = 0.2;
      }

      if (p.group.position.y > rigY + PROJECTILE_DESPAWN_Y) {
        p.group.removeFromParent();
        p.marker.removeFromParent();
        this.projectiles.splice(i, 1);
      }
    }
  }

  private spawnWave(round: number): void {
    const safeQuadrant = Math.floor(Math.random() * 4);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const idx = r * 2 + c;
        if (idx === safeQuadrant) continue;
        if (Math.random() > 0.6) continue;
        this.spawnProjectile(r, c, round);
      }
    }
  }

  private spawnProjectile(row: number, col: number, round: number): void {
    const cell = GRID_SIZE / 2;
    const x = this.player.position.x + (col - 0.5) * cell;
    const z = this.player.position.z + (row - 0.5) * cell;

    const shape = this.shapes[Math.floor(Math.random() * this.shapes.length)];
    const color = OBSTACLE_COLORS[Math.floor(Math.random() * OBSTACLE_COLORS.length)];
    const radius = 0.34 + Math.random() * 0.2;

    const group = new Group();
    group.position.set(x, this.player.position.y + PROJECTILE_SPAWN_Y, z);
    group.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );

    // Dark core so the bright edges have something solid to sit against.
    const core = new Mesh(shape.geometry, new MeshBasicMaterial({ color: 0x02020a }));
    core.scale.setScalar(radius * 0.82);
    group.add(core);

    // Additive body shell — gives the whole shape a lit, glowing volume
    // instead of a thin wire that reads as dim.
    const body = new Mesh(
      shape.geometry,
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28,
        blending: AdditiveBlending,
        depthWrite: false
      })
    );
    body.scale.setScalar(radius);
    group.add(body);

    const wire = new LineSegments(
      shape.edges,
      new LineBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        blending: AdditiveBlending,
        depthWrite: false
      })
    );
    wire.scale.setScalar(radius * 1.03);
    group.add(wire);

    // Bright halo so blocks pop out of the void the moment they rise.
    const glow: Sprite = makeGlow(color, radius * 5.0, 0.8);
    group.add(glow);

    this.scene.add(group);

    // Deck telegraph ring at the incoming quadrant.
    const marker = new Mesh(
      this.markerGeometry,
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false
      })
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(x, this.player.position.y + 0.03, z);
    this.scene.add(marker);

    this.projectiles.push({
      group,
      radius,
      speed: PROJECTILE_SPEED[round],
      marker,
      spinX: 1 + Math.random() * 1.5,
      spinZ: 0.7 + Math.random() * 1.3
    });
  }
}
