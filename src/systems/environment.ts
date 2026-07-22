import { createSystem, Group, Vector3 } from '@iwsdk/core';

import {
  GRID_CLIMB_HEIGHT,
  PHASE_HEIGHTS,
  SLIDE_SPEED,
  TOTAL_ROUNDS,
  WINNER_HEIGHT
} from '../constants.js';
import type { SignBoard } from '../env/beacon.js';
import type { CloudHandles } from '../env/clouds.js';
import type { Confetti } from '../env/extras.js';
import type { GraffitiField } from '../env/graffiti.js';
import type { PlatformHandles } from '../env/platform.js';
import type { SkyHandles } from '../env/sky.js';
import type { CityHandles } from '../env/structures.js';
import type { StreakHandles } from '../env/track.js';
import { game } from '../state.js';

export interface EnvHandles {
  sky: SkyHandles;
  platform: PlatformHandles;
  signs: SignBoard;
  confetti: Confetti;
  streaks: StreakHandles;
  city: CityHandles;
  clouds: CloudHandles;
  /** Hidden until the final drop begins. */
  finish: Group;
  /** Decorative finish debris, revealed incrementally near the landing. */
  finishDetails: Group;
  /** "X WAS HERE" marks sprayed through the finish zone. */
  graffiti: GraffitiField;
}

/**
 * Keeps the world alive: shader clocks, the platform tracking the rig,
 * sign crossfades, confetti physics, and comfort FX that follow slide speed.
 */
export class EnvironmentSystem extends createSystem({}) {
  private headWorld = new Vector3();
  private finishWorld = new Vector3();
  private riserY = -12;
  private finishDetailCursor = 0;
  private finalRevealActive = false;
  /** First seconds of boot: force-render normally-hidden materials (the
   * streaks) at zero strength so their shaders compile before gameplay —
   * a mid-slide compile drops frames, which in VR reads as flicker. */
  private warmTimer = 2;

  private get env(): EnvHandles {
    return this.globals.env as EnvHandles;
  }

  update(delta: number, time: number): void {
    const env = this.env;
    if (!env) return;

    // The block sections are the route's short uphill legs. Lift the whole
    // player rig slowly; the platform follows below, so the ascent is real in
    // VR and the altitude readout naturally rolls upward. The fixed cap keeps
    // music timing or a stalled phase from accumulating extra height.
    const roundIndex = Math.min(game.round, TOTAL_ROUNDS) - 1;
    if (game.phase === 'GRID' && game.timeInPhase > 0) {
      const climbDuration = game.timeInPhase + game.roundRemaining;
      const climbProgress =
        climbDuration > 0
          ? Math.min(1, Math.max(0, game.timeInPhase / climbDuration))
          : 1;
      const climbEase =
        climbProgress * climbProgress * (3 - 2 * climbProgress);
      this.player.position.y =
        PHASE_HEIGHTS[roundIndex] + GRID_CLIMB_HEIGHT * climbEase;
    }

    const t = time / 1000;
    env.sky.uniforms.uTime.value = t;
    env.platform.uniforms.uTime.value = t;
    env.city.uniforms.uTime.value = t;
    env.city.uniforms.uPlayer.value.copy(this.player.position);
    env.clouds.uniforms.uTime.value = t;

    // Platform rides with the rig — but hides during slides: seen edge-on
    // at foot level while descending, its translucent plane cuts a huge
    // shimmering band across the view (the "everything flickers" bug).
    env.platform.group.position.copy(this.player.position);
    env.platform.group.visible = game.phase !== 'SLIDE';

    // Reactive uniforms — eased so pulses breathe instead of popping.
    const pu = env.platform.uniforms;
    pu.uWarning.value += (game.warning - pu.uWarning.value) * Math.min(1, delta * 6);
    pu.uDanger.value += (game.danger - pu.uDanger.value) * Math.min(1, delta * 8);

    // Arrival shockwave: snap to 1 on landing, then decay over ~0.9s.
    if (game.arrival > 0) game.arrival = Math.max(0, game.arrival - delta / 0.9);
    pu.uArrival.value = game.arrival;

    // "LOOK FORWARD" riser: launches right behind the round's final block
    // and climbs to just under the deck, pulsing — the cue to lift your eyes.
    const riserActive = game.phase === 'GRID' && game.lookForward;
    if (riserActive) {
      this.riserY = Math.min(this.riserY + 6.5 * delta, -1.6);
      env.platform.riser.visible = true;
      env.platform.riser.position.y = this.riserY;
      const pulse = 0.55 + 0.4 * Math.sin(t * 7);
      env.platform.riserMaterials.forEach((m) => (m.opacity = pulse));
    } else {
      this.riserY = -12;
      env.platform.riser.visible = false;
    }

    // Slide speed FX (world-anchored only — nothing head-locked).
    const speedRatio = game.slideSpeed / SLIDE_SPEED;
    const streaks = env.streaks.uniforms;
    streaks.uStrength.value += (speedRatio - streaks.uStrength.value) * Math.min(1, delta * 4);
    streaks.uOffset.value += game.slideSpeed * delta * 1.35;
    if (this.warmTimer > 0) this.warmTimer -= delta;
    env.streaks.object.visible =
      streaks.uStrength.value > 0.02 || this.warmTimer > 0;

    const finalSlide = game.phase === 'SLIDE' && game.isFinal;
    if (finalSlide && !this.finalRevealActive) {
      this.finalRevealActive = true;
      this.finishDetailCursor = 0;
    } else if (!finalSlide) {
      this.finalRevealActive = false;
    }
    if (finalSlide) {
      env.finish.getWorldPosition(this.finishWorld);
      if (this.player.position.distanceTo(this.finishWorld) < 190) {
        // Upload and reveal only two debris shapes per frame. Revealing all
        // 46 at final-slide launch caused a Quest render spike and made the
        // slide, obstacles, and UI appear to flicker together.
        for (let i = 0; i < 2; i++) {
          const detail = env.finishDetails.children[this.finishDetailCursor];
          if (!detail) break;
          detail.visible = true;
          this.finishDetailCursor += 1;
        }
      }
    }

    let routePosition: number | null = null;
    let routeMode: 'idle' | 'climb' | 'drop' | 'finish' = 'idle';

    if (game.phase === 'GRID') {
      const climb = Math.min(
        1,
        Math.max(
          0,
          (this.player.position.y - PHASE_HEIGHTS[roundIndex]) /
            GRID_CLIMB_HEIGHT
        )
      );
      routePosition = roundIndex * 2 + climb;
      routeMode = 'climb';
    } else if (game.phase === 'SLIDE') {
      const startY = PHASE_HEIGHTS[roundIndex] + GRID_CLIMB_HEIGHT;
      const targetY = game.isFinal ? WINNER_HEIGHT : PHASE_HEIGHTS[roundIndex + 1];
      const drop = Math.min(
        1,
        Math.max(0, (startY - this.player.position.y) / (startY - targetY))
      );
      routePosition = roundIndex * 2 + 1 + drop;
      routeMode = 'drop';
    } else if (game.phase === 'WIN') {
      routePosition = 6;
      routeMode = 'finish';
    } else if (game.phase === 'START') {
      routePosition = 0;
    }

    const altitude = Math.max(0, Math.round(this.player.position.y - WINNER_HEIGHT));
    const countdown =
      game.phase === 'GRID' && game.warning > 0 && game.roundRemaining > 0
        ? Math.max(1, Math.min(3, Math.ceil(game.roundRemaining)))
        : null;
    env.signs.update(delta, routePosition, routeMode, altitude, countdown);

    this.player.head.getWorldPosition(this.headWorld);
    env.confetti.update(delta, this.headWorld);
  }
}
