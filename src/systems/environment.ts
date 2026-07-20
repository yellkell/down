import { createSystem, Group, Vector3 } from '@iwsdk/core';

import { SLIDE_SPEED } from '../constants.js';
import type { CloudHandles } from '../env/clouds.js';
import type { Confetti, SignBoard } from '../env/extras.js';
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
  /** "X WAS HERE" marks sprayed through the finish zone. */
  graffiti: GraffitiField;
}

/**
 * Keeps the world alive: shader clocks, the platform tracking the rig,
 * sign crossfades, confetti physics, and comfort FX that follow slide speed.
 */
export class EnvironmentSystem extends createSystem({}) {
  private headWorld = new Vector3();
  private riserY = -12;

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
    env.city.uniforms.uPlayer.value.copy(this.player.position);
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
    env.streaks.object.visible = streaks.uStrength.value > 0.02;

    env.signs.update(delta);

    this.player.head.getWorldPosition(this.headWorld);
    env.confetti.update(delta, this.headWorld);
  }
}
