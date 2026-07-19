import {
  createSystem,
  eq,
  PanelDocument,
  PanelUI,
  RayDisplayMode,
  UIKit,
  UIKitDocument,
  Vector3,
  VisibilityState,
  type Entity
} from '@iwsdk/core';

import { audio } from '../audio.js';
import {
  BARRIER_SIZE,
  GRID_DURATION,
  HEAD_RADIUS,
  IS_TURBO,
  KILL_ZONE,
  MUSIC_DROPS,
  PHASE_HEIGHTS,
  TOTAL_DESCENT,
  TOTAL_ROUNDS,
  WINNER_HEIGHT
} from '../constants.js';
import { emit, game, on, resetGameState } from '../state.js';
import type { EnvHandles } from './environment.js';
import { GridSpawnerSystem } from './spawner.js';
import { SlideSystem } from './slide.js';

export interface PanelEntities {
  start: Entity;
  hud: Entity;
  end: Entity;
  warn: Entity;
}

/**
 * The referee: phase state machine, collision detection, HUD text,
 * warnings, audio stingers, and the win/lose panels.
 */
export class GameSystem extends createSystem({
  startPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', './ui/start.json')]
  },
  hudPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', './ui/hud.json')]
  },
  endPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', './ui/end.json')]
  },
  warnPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', './ui/warn.json')]
  }
}) {
  private headWorld = new Vector3();
  private projectilePos = new Vector3();

  // HUD element refs (resolved once each panel's document loads).
  private hudRound: UIKit.Text | null = null;
  private hudTimer: UIKit.Text | null = null;
  private hudAlt: UIKit.Text | null = null;
  private hudStatus: UIKit.Text | null = null;
  private warnText: UIKit.Text | null = null;
  private endTitle: UIKit.Text | null = null;
  private endStats: UIKit.Text | null = null;

  private hudCache: Record<string, string> = {};
  private warnTimer = 0;
  private introTimer = 0;
  private beepAt = 0;
  private started = false;
  /** Settle hold on a fresh platform before the blocks start rising. */
  private gridHold = 0;
  /** Seconds since the end panel appeared — arms the trigger-retry. */
  private endArm = 0;
  /** In-VR start lobby is up, waiting for BEGIN. */
  private lobbyActive = false;
  /** Seconds since the lobby appeared — arms the trigger-to-begin. */
  private lobbyArm = 0;

  private get panels(): PanelEntities {
    return this.globals.panels as PanelEntities;
  }

  private get env(): EnvHandles {
    return this.globals.env as EnvHandles;
  }

  init(): void {
    this.wireStartPanel();
    this.wireHudPanel();
    this.wireEndPanel();
    this.wireWarnPanel();

    on('slide-complete', () => this.onSlideComplete());
    on('final-slide-complete', () => this.onWin());
  }

  /** Start immediately — used by the 2D "PREVIEW IN BROWSER" (desktop). */
  beginRun(): void {
    this.startGame();
  }

  /**
   * Show the in-VR lobby and wait for BEGIN — the run does NOT auto-start
   * on entering VR. Called once the immersive session becomes visible.
   */
  showStartLobby(): void {
    if (this.started) return;
    this.lobbyActive = true;
    this.lobbyArm = 0;
    this.setStartPanelShown(true);
    this.setPointersVisible(true);
  }

  /**
   * Controller laser pointers are only wanted when a menu is up — otherwise
   * they hover over the whole experience (the ray keeps hitting scene
   * geometry, so the SDK's default "visible on intersection" leaves them on).
   * Force the display mode by game state instead.
   */
  private setPointersVisible(visible: boolean): void {
    const mode = visible ? RayDisplayMode.Visible : RayDisplayMode.Invisible;
    const pointers = this.input.xr.multiPointers;
    (['left', 'right'] as const).forEach((hand) => {
      const rp = (pointers[hand] as unknown as { ray?: { rayDisplayMode: RayDisplayMode } })
        .ray;
      if (rp) rp.rayDisplayMode = mode;
    });
  }

  // -- Panel wiring ---------------------------------------------------------

  private getDocument(entity: Entity): UIKitDocument | null {
    return (PanelDocument.data.document[entity.index] as UIKitDocument) ?? null;
  }

  private wireStartPanel(): void {
    this.queries.startPanel.subscribe('qualify', (entity) => {
      const doc = this.getDocument(entity);
      if (!doc) return;
      const beginBtn = doc.getElementById('begin-btn') as UIKit.Text;
      beginBtn?.addEventListener('click', () => this.startGame());
    });
  }

  private wireHudPanel(): void {
    this.queries.hudPanel.subscribe('qualify', (entity) => {
      const doc = this.getDocument(entity);
      if (!doc) return;
      this.hudRound = doc.getElementById('round-label') as UIKit.Text;
      this.hudTimer = doc.getElementById('timer-label') as UIKit.Text;
      this.hudAlt = doc.getElementById('alt-label') as UIKit.Text;
      this.hudStatus = doc.getElementById('status-label') as UIKit.Text;
    });
  }

  private wireEndPanel(): void {
    this.queries.endPanel.subscribe('qualify', (entity) => {
      const doc = this.getDocument(entity);
      if (!doc) return;
      this.endTitle = doc.getElementById('end-title') as UIKit.Text;
      this.endStats = doc.getElementById('end-stats') as UIKit.Text;
      const retryBtn = doc.getElementById('retry-btn') as UIKit.Text;
      retryBtn?.addEventListener('click', () => this.retry());
    });
  }

  private wireWarnPanel(): void {
    this.queries.warnPanel.subscribe('qualify', (entity) => {
      const doc = this.getDocument(entity);
      if (!doc) return;
      this.warnText = doc.getElementById('warn-text') as UIKit.Text;
    });
  }

  private setPanelVisible(entity: Entity | undefined, visible: boolean): void {
    if (!entity) return;
    if (entity.object3D) entity.object3D.visible = visible;
    // ScreenSpace can re-parent the UIKit document out of our object3D,
    // so toggle the document group too.
    const doc = this.getDocument(entity);
    if (doc) doc.visible = visible;
  }

  /**
   * The end panel is never visibility-toggled — hide/re-show cycles can
   * leave a panel's interaction stale for controller rays. It stays live
   * and simply parks far below the world until it's needed.
   */
  private setEndPanelShown(shown: boolean): void {
    const entity = this.panels?.end;
    if (!entity?.object3D) return;
    entity.object3D.position.set(0, shown ? 1.45 : -9999, -1.8);
  }

  /** Same park-below trick for the in-VR start lobby. */
  private setStartPanelShown(shown: boolean): void {
    const entity = this.panels?.start;
    if (!entity?.object3D) return;
    entity.object3D.position.set(0, shown ? 1.5 : -9999, -1.9);
  }

  private setHud(key: 'round' | 'timer' | 'alt' | 'status', value: string): void {
    if (this.hudCache[key] === value) return;
    this.hudCache[key] = value;
    const el =
      key === 'round'
        ? this.hudRound
        : key === 'timer'
          ? this.hudTimer
          : key === 'alt'
            ? this.hudAlt
            : this.hudStatus;
    el?.setProperties({ text: value });
  }

  private showWarning(text: string, seconds: number): void {
    this.warnText?.setProperties({ text });
    this.setPanelVisible(this.panels?.warn, true);
    this.warnTimer = seconds;
  }

  // -- Phase transitions ----------------------------------------------------

  private startGame(): void {
    if (this.started) return;
    this.started = true;
    this.lobbyActive = false;
    this.setStartPanelShown(false);
    audio.play('begin');
    window.setTimeout(() => audio.startMusic(), 400);
    this.setPanelVisible(this.panels?.hud, true);
    this.setPointersVisible(false);
    emit('game-start');
    this.enterGrid(1.6);
  }

  private retry(): void {
    resetGameState();
    emit('game-reset');
    this.env?.signs.reset();
    this.env?.confetti.stop();
    if (this.env) this.env.finish.visible = false;
    this.player.position.set(0, PHASE_HEIGHTS[0], 0);
    this.setEndPanelShown(false);
    this.setPanelVisible(this.panels?.hud, true);
    this.setPointersVisible(false);
    this.hudCache = {};
    // Same cadence as the first start so the BEGIN voice line is heard
    // clearly before the music comes in (not masked by it).
    audio.play('begin');
    window.setTimeout(() => audio.startMusic(), 400);
    this.enterGrid(1.6);
  }

  /**
   * Arrive on a platform. We hold for `hold` seconds — no blocks, no timer —
   * so landing reads as a distinct beat before the dodge round begins.
   * The rising blocks only start once the hold elapses (grid-start).
   */
  private enterGrid(hold: number): void {
    game.phase = 'GRID';
    game.timeInPhase = 0;
    game.warning = 0;
    game.lookForward = false;
    game.danger = 0;
    this.gridHold = hold;
    this.showWarning('LOOK DOWN', hold + 0.5);
  }

  private enterSlide(): void {
    game.phase = 'SLIDE';
    game.timeInPhase = 0;
    game.warning = 0;
    game.lookForward = false;
    game.danger = 0;
    game.isFinal = game.round >= TOTAL_ROUNDS;

    // Guarantee a clean launch: no stray blocks left rising into the slide.
    this.world.getSystem(GridSpawnerSystem)?.deactivate();

    const slide = this.world.getSystem(SlideSystem);
    if (!slide) return;
    const targetY = game.isFinal ? WINNER_HEIGHT : PHASE_HEIGHTS[game.round];
    slide.begin({ targetY, isFinal: game.isFinal });

    // The bottom of the world only materializes once you commit to it.
    if (game.isFinal && this.env) this.env.finish.visible = true;

    // Sign progression: heading to round 2 -> middle sign, round 3 -> bottom.
    this.env?.signs.show(Math.min(game.round, 2));
    this.showWarning(game.isFinal ? 'FINAL DROP' : 'SLIDE', 1.6);
  }

  private onSlideComplete(): void {
    // Escalating praise: "nice" after the first slide, "perfect" after the second.
    audio.play(game.round === 1 ? 'nice' : 'perfect');
    game.arrival = 1; // deck shockwave — you've touched down
    game.round += 1;
    this.enterGrid(2.0);
  }

  private onWin(): void {
    game.phase = 'WIN';
    audio.play('welldone');
    this.env?.signs.show(3);
    this.player.head.getWorldPosition(this.headWorld);
    this.env?.confetti.start(this.headWorld.clone());

    this.endTitle?.setProperties({ text: 'YOU MADE IT!' });
    this.endStats?.setProperties({
      text: `${TOTAL_DESCENT}M DESCENDED  ·  ${this.formatTime(game.runTime)}`
    });
    this.setPanelVisible(this.panels?.hud, false);
    this.setPanelVisible(this.panels?.warn, false);
    this.setEndPanelShown(true);
    this.setPointersVisible(true);
    this.endArm = 0;
  }

  private gameOver(): void {
    game.phase = 'GAME_OVER';
    audio.play('die');
    window.setTimeout(() => audio.play('gameover'), 250);
    audio.stopMusic();
    emit('game-over');

    const altitude = Math.round(this.player.position.y);
    this.endTitle?.setProperties({ text: 'GAME OVER' });
    this.endStats?.setProperties({
      text: `ROUND ${game.round}/${TOTAL_ROUNDS}  ·  ALT ${altitude}M  ·  ${this.formatTime(game.runTime)}`
    });
    this.setPanelVisible(this.panels?.hud, false);
    this.setPanelVisible(this.panels?.warn, false);
    this.setEndPanelShown(true);
    this.setPointersVisible(true);
    this.endArm = 0;
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Seconds until this round's slide. Runs off the soundtrack's playhead so
   * every slide launches exactly on a section change in "Run"; falls back
   * to the fixed round timer in turbo mode or if the music isn't running.
   */
  /** Rising-edge trigger press on either XR controller. */
  private selectPressed(): boolean {
    const gamepads = this.input.xr.gamepads;
    return Boolean(
      gamepads.left?.getSelectStart() || gamepads.right?.getSelectStart()
    );
  }

  private roundRemaining(): number {
    if (!IS_TURBO) {
      const mt = audio.musicTime();
      if (mt !== null) {
        const drop = MUSIC_DROPS[Math.min(game.round, TOTAL_ROUNDS) - 1];
        const remaining = drop - mt;
        // Sanity window: if the clock has looped or drifted wildly, fall back.
        if (remaining > -1 && remaining < 200) return Math.max(0, remaining);
      }
    }
    return Math.max(0, GRID_DURATION - game.timeInPhase);
  }

  // -- Per-frame ------------------------------------------------------------

  update(delta: number): void {
    if (game.phase === 'WIN' || game.phase === 'GAME_OVER') {
      // Escape hatch: after a short arm delay, a bare trigger pull on
      // either controller retries — no pointing at the panel required.
      this.endArm += delta;
      if (this.endArm > 1.2 && this.selectPressed()) this.retry();
      return;
    }
    if (game.phase === 'START') {
      // In-VR lobby: BEGIN button, or a bare trigger pull once armed.
      if (this.lobbyActive) {
        this.lobbyArm += delta;
        if (this.lobbyArm > 0.8 && this.selectPressed()) this.startGame();
      }
      return;
    }

    game.runTime += delta;

    // Panel timers always tick, even during the settle hold.
    if (this.warnTimer > 0) {
      this.warnTimer -= delta;
      if (this.warnTimer <= 0) this.setPanelVisible(this.panels?.warn, false);
    }
    if (this.introTimer > 0) this.introTimer -= delta;

    this.player.head.getWorldPosition(this.headWorld);
    this.setHud('alt', `ALT ${Math.round(this.player.position.y - WINNER_HEIGHT)}M`);

    // Settle beat: freshly landed, holding before the blocks rise. No timer,
    // no spawns, no collisions — just recover your footing and look down.
    if (game.phase === 'GRID' && this.gridHold > 0) {
      this.gridHold -= delta;
      game.roundRemaining = this.roundRemaining();
      this.setHud('round', `ROUND ${game.round}/${TOTAL_ROUNDS}`);
      this.setHud('timer', Math.ceil(game.roundRemaining).toFixed(0));
      this.setHud('status', 'STEADY — LOOK DOWN');
      if (this.gridHold <= 0) {
        this.beepAt = 3;
        this.introTimer = 2.5;
        emit('grid-start');
      }
      return;
    }

    game.timeInPhase += delta;

    if (game.phase === 'GRID') {
      this.updateGrid(delta);
    } else if (game.phase === 'SLIDE') {
      this.updateSlide();
    }
  }

  private updateGrid(delta: number): void {
    const remaining = this.roundRemaining();
    game.roundRemaining = remaining;
    this.setHud('round', `ROUND ${game.round}/${TOTAL_ROUNDS}`);
    this.setHud('timer', Math.ceil(remaining).toFixed(0));

    const spawner = this.world.getSystem(GridSpawnerSystem);

    // The LOOK FORWARD riser launches right behind the round's final
    // block — however early that lands — so there's never dead air spent
    // staring at an empty grid.
    if (!game.lookForward && (remaining <= 3 || spawner?.isFieldSpent())) {
      game.lookForward = true;
    }

    // Kill-zone proximity -> danger glow + status nag.
    const dx = Math.abs(this.headWorld.x - this.player.position.x);
    const dz = Math.abs(this.headWorld.z - this.player.position.z);
    const edge = Math.max(dx, dz);
    game.danger = Math.min(1, Math.max(0, (edge - 0.55) / (KILL_ZONE / 2 - 0.55)));

    if (remaining <= 3 && remaining > 0) {
      // Slide incoming: clear the field, pulse the deck, beep the countdown.
      game.warning = 1;
      this.setHud('status', game.round >= TOTAL_ROUNDS ? 'FINAL DROP INCOMING' : 'SLIDE INCOMING');
      spawner?.holdFire();
      if (remaining <= this.beepAt) {
        audio.play('square', 0.7);
        this.beepAt -= 1;
      }
    } else if (game.danger > 0.55) {
      this.setHud('status', 'STAY ON THE GRID');
    } else if (this.introTimer > 0) {
      this.setHud('status', 'DODGE WHAT RISES');
    } else {
      this.setHud('status', '');
    }

    if (remaining <= 0) {
      this.enterSlide();
      return;
    }

    // Desktop browser = spectator/attract mode: nothing can kill a viewer
    // who has no body to dodge with. All collisions live in VR only.
    if (this.visibilityState.value === VisibilityState.NonImmersive) return;

    // Collisions: head vs rising shapes, head vs kill zone.
    if (spawner) {
      if (game.timeInPhase > 0.5 && spawner.isOutsideKillZone(this.headWorld)) {
        this.gameOver();
        return;
      }
      for (const projectile of spawner.getProjectiles()) {
        projectile.group.getWorldPosition(this.projectilePos);
        if (
          this.headWorld.distanceTo(this.projectilePos) <
          HEAD_RADIUS + projectile.radius
        ) {
          this.gameOver();
          return;
        }
      }
    }
  }

  private updateSlide(): void {
    this.setHud('round', game.isFinal ? 'FINAL DROP' : `ROUND ${game.round}/${TOTAL_ROUNDS}`);
    this.setHud('timer', '▼');
    this.setHud('status', 'LEAN BETWEEN THE BARRIERS');

    if (this.visibilityState.value === VisibilityState.NonImmersive) return;

    const slide = this.world.getSystem(SlideSystem);
    if (!slide) return;

    const halfW = BARRIER_SIZE.w / 2 + 0.05;
    const halfH = BARRIER_SIZE.h / 2;
    const halfD = BARRIER_SIZE.d / 2 + 0.05;
    for (const barrier of slide.getBarriers()) {
      const dx = Math.abs(this.headWorld.x - barrier.position.x);
      const dy = Math.abs(this.headWorld.y - barrier.position.y);
      const dz = Math.abs(this.headWorld.z - barrier.position.z);
      if (
        dx < halfW + HEAD_RADIUS &&
        dy < halfH + HEAD_RADIUS &&
        dz < halfD + HEAD_RADIUS
      ) {
        this.gameOver();
        return;
      }
    }
  }
}
