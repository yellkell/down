import { createSystem, Group, Vector3 } from '@iwsdk/core';

import { SLIDE_SPEED } from '../constants.js';
import type { CloudHandles } from '../env/clouds.js';
import type { Confetti, SignBoard } from '../env/extras.js';
import type { PlatformHandles } from '../env/platform.js';
import type { SkyHandles } from '../env/sky.js';
import type { CityHandles } from '../env/structures.js';
import type { StreakHandles, VignetteHandles } from '../env/track.js';
import { game } from '../state.js';

export interface EnvHandles {
  sky: SkyHandles;
  platform: PlatformHandles;
  signs: SignBoard;
  confetti: Confetti;
  streaks: StreakHandles;
  vignette: VignetteHandles;
  city: CityHandles;
  clouds: CloudHandles;
  /** Hidden until the final drop begins. */
  finish: Group;
}

/**
 * Keeps the world alive: shader clocks, the platform tracking the rig,
 * sign crossfades, confetti physics, and comfort FX that follow slide speed.
 */
export class EnvironmentSystem extends createSystem({}) {
  private headWorld = new Vector3();

  private get env(): EnvHandles {
    return this.globals.env as EnvHandles;
  }

  update(delta: number, time: number): void {
    const env = this.env;
    if (!env) return;

    const t = time / 1000;
    env.sky.uniforms.uTime.value = t;
    env.platform.uniforms.uTime.value = t;
    env.city.uniforms.uTime.value = t;
    env.clouds.uniforms.uTime.value = t;

    // Platform rides with the rig (rig only moves during slides).
    env.platform.group.position.copy(this.player.position);

    // Reactive uniforms — eased so pulses breathe instead of popping.
    const pu = env.platform.uniforms;
    pu.uWarning.value += (game.warning - pu.uWarning.value) * Math.min(1, delta * 6);
    pu.uDanger.value += (game.danger - pu.uDanger.value) * Math.min(1, delta * 8);

    // Arrival shockwave: snap to 1 on landing, then decay over ~0.9s.
    if (game.arrival > 0) game.arrival = Math.max(0, game.arrival - delta / 0.9);
    pu.uArrival.value = game.arrival;

    // Slide comfort FX.
    const speedRatio = game.slideSpeed / SLIDE_SPEED;
    const vig = env.vignette.uniforms;
    vig.uStrength.value += (speedRatio * 0.85 - vig.uStrength.value) * Math.min(1, delta * 3);

    const streaks = env.streaks.uniforms;
    streaks.uStrength.value += (speedRatio - streaks.uStrength.value) * Math.min(1, delta * 4);
    streaks.uOffset.value += game.slideSpeed * delta * 1.35;
    env.streaks.object.visible = streaks.uStrength.value > 0.02;

    env.signs.update(delta);

    this.player.head.getWorldPosition(this.headWorld);
    env.confetti.update(delta, this.headWorld);
  }
}
