/**
 * Shared game state + a tiny event bus.
 * Systems read/write this instead of poking at each other directly.
 */
export type Phase = 'START' | 'GRID' | 'SLIDE' | 'WIN' | 'GAME_OVER';

export const game = {
  phase: 'START' as Phase,
  /** 1-based dodge round (1..TOTAL_ROUNDS). */
  round: 1,
  /** Seconds elapsed in the current phase. */
  timeInPhase: 0,
  /** Seconds since BEGIN, for the end-screen stat. */
  runTime: 0,
  /** True while riding the last slide down to the finish zone. */
  isFinal: false,
  /** 0..1 — "slide incoming" pulse fed to the platform shader. */
  warning: 0,
  /** True once the final block has cleared — the LOOK FORWARD riser cue. */
  lookForward: false,
  /** 0..1 — proximity to the kill-zone edge, drives red glow. */
  danger: 0,
  /** Set to 1 when a slide lands; decays to 0, driving the deck shockwave. */
  arrival: 0,
  /** Seconds left in the current dodge round (music-synced). */
  roundRemaining: 999,
  /** Current slide speed in m/s, drives the wind streaks. */
  slideSpeed: 0,
  /** Eased atmospheric tint fired as the player crosses a slide hoop. */
  hoopPulse: 0,
  hoopColor: 0x29f3ff
};

export type GameEvent =
  | 'game-start'
  | 'grid-start'
  | 'slide-start'
  | 'slide-complete'
  | 'final-slide-complete'
  | 'game-over'
  | 'game-reset';

const listeners = new Map<GameEvent, Set<() => void>>();

export function on(event: GameEvent, cb: () => void): void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(cb);
}

export function emit(event: GameEvent): void {
  listeners.get(event)?.forEach((cb) => cb());
}

export function resetGameState(): void {
  game.phase = 'START';
  game.round = 1;
  game.timeInPhase = 0;
  game.runTime = 0;
  game.isFinal = false;
  game.warning = 0;
  game.lookForward = false;
  game.danger = 0;
  game.arrival = 0;
  game.roundRemaining = 999;
  game.slideSpeed = 0;
  game.hoopPulse = 0;
  game.hoopColor = 0x29f3ff;
}
