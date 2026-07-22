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

import {
  MUSIC_TRACKS,
  audio,
  isMusicId,
  type MusicId
} from '../audio.js';
import {
  BARRIER_SIZE,
  GRID_CLIMB_HEIGHT,
  GRID_DURATION,
  HEAD_RADIUS,
  IS_TURBO,
  KILL_ZONE,
  MUSIC_DROPS,
  PHASE_HEIGHTS,
  TOTAL_ROUNDS,
  WINNER_HEIGHT
} from '../constants.js';
import { NAME_MAX, submitMark } from '../marks.js';
import { emit, game, on, resetGameState } from '../state.js';
import type { EnvHandles } from './environment.js';
import { GridSpawnerSystem } from './spawner.js';
import { SlideSystem } from './slide.js';

export interface PanelEntities {
  start: Entity;
  end: Entity;
  warn: Entity;
  name: Entity;
}

const SONGS_UNLOCKED_KEY = 'down.songs-unlocked.v1';
const SELECTED_SONG_KEY = 'down.selected-song.v1';

function readStoredSong(): MusicId {
  try {
    const stored = window.localStorage.getItem(SELECTED_SONG_KEY);
    return isMusicId(stored) ? stored : 'original';
  } catch {
    return 'original';
  }
}

function hasUnlockedSongs(): boolean {
  try {
    return window.localStorage.getItem(SONGS_UNLOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

function storeValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private/headset browser modes.
  }
}

/**
 * The referee: phase state machine, collision detection, warnings,
 * audio stingers, and the win/lose panels.
 */
export class GameSystem extends createSystem({
  startPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', './ui/start.json')]
  },
  endPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', './ui/end.json')]
  },
  warnPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', './ui/warn.json')]
  },
  namePanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', './ui/name.json')]
  }
}) {
  private headWorld = new Vector3();
  private projectilePos = new Vector3();

  private warnText: UIKit.Text | null = null;
  private endTitle: UIKit.Text | null = null;
  private endStats: UIKit.Text | null = null;
  private endAction: UIKit.Text | null = null;
  private nameDisplay: UIKit.Text | null = null;
  private songSelector: UIKit.Container | null = null;
  private songOptions: UIKit.Container | null = null;
  private songToggle: UIKit.Text | null = null;
  private creditsButton: UIKit.Text | null = null;
  private creditsWindow: UIKit.Container | null = null;

  private warnTimer = 0;
  private beepAt = 0;
  private started = false;
  private musicStartTimer: number | null = null;
  private lookDownTimer: number | null = null;
  /** Settle hold on a fresh platform before the blocks start rising. */
  private gridHold = 0;
  /** Seconds since the end panel appeared — arms the trigger-retry. */
  private endArm = 0;
  /** Post-win celebration beat before the keyboard rises. */
  private winWait = 0;
  /** The LEAVE YOUR MARK keyboard is up — trigger shortcuts disabled. */
  private nameActive = false;
  /** The name being typed on the finish-line keyboard. */
  private nameBuf = '';
  private endPanelShown = false;
  private endPanelCanHide = false;
  private endTitleValue = 'GAME OVER';
  private endStatsValue = 'ROUND 1/3';
  private endActionValue = 'GO AGAIN';
  private songsUnlocked = hasUnlockedSongs();
  private selectedSong = readStoredSong();
  private songMenuOpen = false;
  private creditsOpen = false;

  private get panels(): PanelEntities {
    return this.globals.panels as PanelEntities;
  }

  private get env(): EnvHandles {
    return this.globals.env as EnvHandles;
  }

  init(): void {
    audio.selectMusic(this.selectedSong);
    this.wireStartPanel();
    this.wireEndPanel();
    this.wireWarnPanel();
    this.wireNamePanel();

    on('slide-complete', () => this.onSlideComplete());
    on('final-slide-complete', () => this.onWin());

    // Desktop spectators have no controller ray to poke the VR keyboard
    // with — their real keyboard drives the tag entry instead.
    window.addEventListener('keydown', (e) => {
      if (!this.nameActive) return;
      if (e.key === 'Enter') this.sprayIt();
      else if (e.key === 'Backspace') this.deleteChar();
      else if (e.key === 'Escape') this.skipTag();
      else if (/^[a-zA-Z0-9 ]$/.test(e.key)) this.typeChar(e.key.toUpperCase());
    });
  }

  /**
   * Show the in-VR lobby and wait for BEGIN — the run does NOT auto-start
   * on entering VR. Called once the immersive session becomes visible.
   */
  showStartLobby(): void {
    if (this.started) return;
    // Keep the result panel renderable through boot so UIKit has time to
    // build its first glyph atlas. The lobby is the first safe point to hide
    // it: the start panel is now ready and no result can be showing yet.
    this.endPanelCanHide = true;
    this.setEndPanelShown(false);
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
      beginBtn?.addEventListener('click', () => {
        audio.blip(1250);
        this.startGame();
      });

      this.songSelector = doc.getElementById('song-selector') as UIKit.Container;
      this.songOptions = doc.getElementById('song-options') as UIKit.Container;
      this.songToggle = doc.getElementById('song-toggle') as UIKit.Text;
      this.songToggle?.addEventListener('click', () => {
        audio.blip(1100);
        this.songMenuOpen = !this.songMenuOpen;
        this.creditsOpen = false;
        this.applySongMenu();
      });
      MUSIC_TRACKS.forEach((track, index) => {
        const option = doc.getElementById(`song-${track.id}`) as UIKit.Text | null;
        option?.addEventListener('click', () => {
          audio.blip(900 + index * 90);
          this.selectSong(track.id);
        });
      });
      this.creditsButton = doc.getElementById('credits-btn') as UIKit.Text;
      this.creditsWindow = doc.getElementById('credits-window') as UIKit.Container;
      this.creditsButton?.addEventListener('click', () => {
        audio.blip(1050);
        this.songMenuOpen = false;
        this.creditsOpen = true;
        this.applySongMenu();
      });
      (doc.getElementById('credits-close') as UIKit.Text | null)?.addEventListener(
        'click',
        () => {
          audio.blip(850);
          this.creditsOpen = false;
          this.applySongMenu();
        }
      );
      this.applySongMenu();
    });
  }

  private selectSong(id: MusicId): void {
    this.selectedSong = id;
    this.songMenuOpen = false;
    storeValue(SELECTED_SONG_KEY, id);
    audio.selectMusic(id);
    this.applySongMenu();
  }

  private applySongMenu(): void {
    this.songSelector?.setProperties({ display: this.songsUnlocked ? 'flex' : 'none' });
    this.songOptions?.setProperties({ display: this.songMenuOpen ? 'flex' : 'none' });
    this.creditsButton?.setProperties({ display: this.songsUnlocked ? 'flex' : 'none' });
    this.creditsWindow?.setProperties({
      display: this.songsUnlocked && this.creditsOpen ? 'flex' : 'none'
    });
    const track = MUSIC_TRACKS.find((candidate) => candidate.id === this.selectedSong);
    this.songToggle?.setProperties({ text: `${track?.label ?? 'ORIGINAL'}  ▾` });
  }

  private wireEndPanel(): void {
    this.queries.endPanel.subscribe('qualify', (entity) => {
      const doc = this.getDocument(entity);
      if (!doc) return;
      this.endTitle = doc.getElementById('end-title') as UIKit.Text;
      this.endStats = doc.getElementById('end-stats') as UIKit.Text;
      this.endAction = doc.getElementById('retry-btn') as UIKit.Text;
      this.applyEndContent();
      this.endAction?.addEventListener('click', () => {
        audio.blip(1250);
        this.handleEndAction();
      });
      // The first result can arrive while UIKit is still constructing this
      // document. Reapply placement once its meshes actually exist, rather
      // than waiting for a second game over.
      if (this.endPanelShown) this.setEndPanelShown(true);
      else if (this.endPanelCanHide) this.setEndPanelShown(false);
    });
  }

  private wireWarnPanel(): void {
    this.queries.warnPanel.subscribe('qualify', (entity) => {
      const doc = this.getDocument(entity);
      if (!doc) return;
      this.warnText = doc.getElementById('warn-text') as UIKit.Text;
    });
  }

  private wireNamePanel(): void {
    this.queries.namePanel.subscribe('qualify', (entity) => {
      const doc = this.getDocument(entity);
      if (!doc) return;
      this.nameDisplay = doc.getElementById('name-display') as UIKit.Text;

      // Keys fire on pointerDOWN, not click. A UIKit "click" needs the ray on
      // the same element at BOTH press and release; on a small key the tiny
      // hand drift while releasing the trigger slips the ray off the key, so
      // ~half the presses never fire. pointerdown registers the instant the
      // trigger goes down, before any drift. We still bind click as a fallback
      // and pair it with the preceding pointerdown so one physical press types
      // exactly once — even double letters, since each press has its own down.
      const onKeyPress = (id: string, fn: () => void): void => {
        const el = doc.getElementById(id) as UIKit.Text | null;
        if (!el) return;
        let swallowClickUntil = 0;
        el.addEventListener('pointerdown', () => {
          swallowClickUntil = performance.now() + 1200;
          fn();
        });
        el.addEventListener('click', () => {
          // Trailing click of a press we already handled on pointerdown.
          if (performance.now() < swallowClickUntil) {
            swallowClickUntil = 0;
            return;
          }
          fn(); // pointerdown never arrived — take the click instead
        });
      };
      for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        onKeyPress(`key-${ch}`, () => this.typeChar(ch));
      }
      onKeyPress('key-space', () => this.typeChar(' '));
      onKeyPress('key-del', () => this.deleteChar());

      // Commit / skip stay on click — they're wide targets, and press-release
      // semantics guard against an accidental graze spraying or skipping.
      const wireClick = (id: string, fn: () => void): void => {
        (doc.getElementById(id) as UIKit.Text | null)?.addEventListener('click', fn);
      };
      wireClick('tag-btn', () => this.sprayIt());
      wireClick('skip-btn', () => this.skipTag());
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

  // NOTE: never mutate renderOrder/depth on a panel's meshes to force it
  // "on top" — uikit re-batches its instanced meshes when text changes, so
  // stale mutations end up on the background quad only, which then draws
  // over the freshly-batched glyphs: a blank panel. The clouds that washed
  // over menus are pushed behind instead (negative renderOrder in clouds.ts).

  /**
   * Park far below when hidden — never visibility-toggled, so its meshes
   * stay batched and its Interactable stays live for the retry ray.
   */
  private setEndPanelShown(shown: boolean): void {
    this.endPanelShown = shown;
    const entity = this.panels?.end;
    if (!entity?.object3D) return;
    entity.object3D.position.set(0, shown ? 1.45 : -9999, -1.8);
  }

  private setEndContent(title: string, stats: string, action = 'GO AGAIN'): void {
    this.endTitleValue = title;
    this.endStatsValue = stats;
    this.endActionValue = action;
    this.applyEndContent();
  }

  private applyEndContent(): void {
    this.endTitle?.setProperties({ text: this.endTitleValue });
    this.endStats?.setProperties({ text: this.endStatsValue });
    this.endAction?.setProperties({ text: this.endActionValue });
  }

  /** Same park-below trick for the in-VR start lobby. */
  private setStartPanelShown(shown: boolean): void {
    const entity = this.panels?.start;
    if (!entity?.object3D) return;
    entity.object3D.position.set(0, shown ? 1.5 : -9999, -1.9);
  }

  /** ...and for the finish-line keyboard. */
  private setNamePanelShown(shown: boolean): void {
    const entity = this.panels?.name;
    if (!entity?.object3D) return;
    entity.object3D.position.set(0, shown ? 1.45 : -9999, -1.75);
  }

  // -- The finish-line keyboard ---------------------------------------------

  private updateNameDisplay(): void {
    const caret = this.nameBuf.length < NAME_MAX ? '_' : '';
    this.nameDisplay?.setProperties({ text: `${this.nameBuf}${caret}` });
  }

  private typeChar(ch: string): void {
    if (!this.nameActive) return;
    if (this.nameBuf.length >= NAME_MAX || (ch === ' ' && this.nameBuf.length === 0)) {
      audio.blip(220, 0.09, 0.12); // rejected — low denial thunk, not silence
      return;
    }
    this.nameBuf += ch;
    audio.blip(1250);
    this.updateNameDisplay();
  }

  private deleteChar(): void {
    if (!this.nameActive) return;
    if (this.nameBuf.length === 0) {
      audio.blip(220, 0.09, 0.12);
      return;
    }
    this.nameBuf = this.nameBuf.slice(0, -1);
    audio.blip(700, 0.06, 0.15);
    this.updateNameDisplay();
  }

  /**
   * The moment: the name flies out of the keyboard and onto the world.
   * The tag sprays in above the pad while the panel drops away, the mark is
   * committed to the wall in the background, and only after a beat to admire
   * it does the regular end panel come up.
   */
  private sprayIt(): void {
    if (!this.nameActive) return;
    const name = this.nameBuf.trim();
    if (!name) return; // nothing typed — the caret keeps blinking at them
    this.env?.signs.setBravo(false);
    this.setNamePanelShown(false);
    void submitMark(name); // fire-and-forget; the wall catches up next visit
    const env = this.env;
    if (env) {
      const tag = env.graffiti.spawnPersonal(name);
      // Finish-local placement: floating just ahead of the landed player,
      // above where the end panel will rise, facing them.
      const p = this.player.position;
      const f = env.finish.position;
      tag.position.set(p.x - f.x, p.y - f.y + 2.5, p.z - f.z - 4.2);
      tag.rotation.x = 0.18;
    }
    audio.play('nice');
    window.setTimeout(() => {
      this.nameActive = false;
      this.setEndPanelShown(true);
      this.endArm = 0;
    }, 2400);
  }

  private skipTag(): void {
    if (!this.nameActive) return;
    this.nameActive = false;
    this.env?.signs.setBravo(false);
    this.setNamePanelShown(false);
    this.setEndPanelShown(true);
    this.endArm = 0;
  }

  private showWarning(text: string, seconds: number): void {
    const style =
      text === 'LOOK DOWN'
        ? { color: '#dffcff', fontSize: 6.8, letterSpacing: 1.1 }
        : text === 'SLIDE'
          ? { color: '#dffcff', fontSize: 7.4, letterSpacing: 1.35 }
          : text === 'FINAL DROP'
            ? { color: '#dffcff', fontSize: 5.8, letterSpacing: 0.85 }
            : { color: '#dffcff', fontSize: 7, letterSpacing: 1 };
    this.warnText?.setProperties({ text, ...style });
    this.setPanelVisible(this.panels?.warn, true);
    this.warnTimer = seconds;
  }

  // -- Phase transitions ----------------------------------------------------

  private startRunAudio(): void {
    if (this.musicStartTimer !== null) window.clearTimeout(this.musicStartTimer);
    if (this.lookDownTimer !== null) window.clearTimeout(this.lookDownTimer);
    this.lookDownTimer = null;
    audio.stopAll();
    audio.play('begin', 0.82);
    // begin.ogg is 560 ms. Give the full line clear air before Run enters.
    this.musicStartTimer = window.setTimeout(() => {
      audio.startMusic();
      this.musicStartTimer = null;
    }, 850);
  }

  private startGame(): void {
    if (this.started) return;
    this.started = true;
    this.setStartPanelShown(false);
    this.startRunAudio();
    this.setPointersVisible(false);
    emit('game-start');
    this.enterGrid(2.9);
  }

  private retry(): void {
    resetGameState();
    emit('game-reset');
    this.env?.signs.reset();
    this.env?.confetti.stop();
    if (this.env) this.env.finish.visible = false;
    this.player.position.set(0, PHASE_HEIGHTS[0], 0);
    this.setEndPanelShown(false);
    this.setNamePanelShown(false);
    this.winWait = 0;
    this.nameActive = false;
    this.nameBuf = '';
    this.setPointersVisible(false);
    this.startRunAudio();
    this.enterGrid(2.9);
  }

  /** A completed run returns to the summit lobby so the newly unlocked
   * soundtrack selector gets a deliberate moment before the next descent. */
  private returnToTop(): void {
    resetGameState();
    emit('game-reset');
    this.env?.signs.reset();
    this.env?.confetti.stop();
    if (this.env) this.env.finish.visible = false;
    this.player.position.set(0, PHASE_HEIGHTS[0], 0);
    this.setEndPanelShown(false);
    this.setNamePanelShown(false);
    this.setPanelVisible(this.panels?.warn, false);
    this.winWait = 0;
    this.nameActive = false;
    this.nameBuf = '';
    this.songMenuOpen = false;
    this.creditsOpen = false;
    this.applySongMenu();
    this.started = false;
    audio.stopAll();
    if (this.musicStartTimer !== null) {
      window.clearTimeout(this.musicStartTimer);
      this.musicStartTimer = null;
    }
    if (this.lookDownTimer !== null) {
      window.clearTimeout(this.lookDownTimer);
      this.lookDownTimer = null;
    }
    this.setStartPanelShown(true);
    this.setPointersVisible(true);
  }

  private handleEndAction(): void {
    if (game.phase === 'WIN') this.returnToTop();
    else this.retry();
  }

  /**
   * Arrive on a platform. We hold for `hold` seconds — no blocks, no timer —
   * so landing reads as a distinct beat before the dodge round begins.
   * The rising blocks only start once the hold elapses (grid-start).
   */
  private enterGrid(hold: number): void {
    game.phase = 'GRID';
    game.timeInPhase = 0;
    game.roundRemaining = GRID_DURATION;
    game.warning = 0;
    game.lookForward = false;
    game.danger = 0;
    this.gridHold = hold;
    // Let BEGIN or the longer landing praise finish, then speak the
    // instruction and reveal its panel on the same frame. The line is just
    // under a second long; keep the words up for one more second afterward.
    if (this.lookDownTimer !== null) window.clearTimeout(this.lookDownTimer);
    this.lookDownTimer = window.setTimeout(() => {
      this.showWarning('LOOK DOWN', 2.0);
      audio.play('lookdown');
      this.lookDownTimer = null;
    }, game.round === 1 ? 1800 : 2400);
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
    // Land the gentle lift exactly on its crest before generating the slide,
    // avoiding tiny timing-dependent differences in track and finish length.
    this.player.position.y =
      PHASE_HEIGHTS[game.round - 1] + GRID_CLIMB_HEIGHT;
    const targetY = game.isFinal ? WINNER_HEIGHT : PHASE_HEIGHTS[game.round];
    slide.begin({ targetY, isFinal: game.isFinal });

    // The bottom of the world only materializes once you commit to it.
    if (game.isFinal && this.env) {
      // Transparent graffiti waits until the rig is stationary. The opaque
      // debris was warmed at boot, so it can be present for the whole drop.
      this.env.graffiti.hide();
      this.env.finish.visible = true;
    }

    // Sign progression: heading to round 2 -> middle sign, round 3 -> bottom.
    this.env?.signs.show(Math.min(game.round, 2));
    this.showWarning(game.isFinal ? 'FINAL DROP' : 'SLIDE', 1.6);
  }

  private onSlideComplete(): void {
    // Escalating praise: "nice" after the first slide, "perfect" after the second.
    audio.play(game.round === 1 ? 'nice' : 'perfect');
    game.arrival = 1; // deck shockwave — you've touched down
    game.round += 1;
    this.enterGrid(3.5);
  }

  private onWin(): void {
    game.phase = 'WIN';
    this.songsUnlocked = true;
    storeValue(SONGS_UNLOCKED_KEY, '1');
    this.applySongMenu();
    this.env?.graffiti.show();
    audio.play('welldone');
    this.env?.signs.show(3);
    this.env?.signs.setBravo(true);
    this.player.head.getWorldPosition(this.headWorld);
    this.env?.confetti.start(this.headWorld.clone());

    this.setEndContent(
      'YOU MADE IT!',
      'THANKS FOR PLAYING!',
      'RETURN TO TOP'
    );
    this.setPanelVisible(this.panels?.warn, false);

    // Let the landing breathe — confetti and the finish sign get a few
    // seconds to themselves before the LEAVE YOUR MARK keyboard rises.
    this.winWait = 3.4;
    this.nameBuf = '';
    this.updateNameDisplay();
    this.setPointersVisible(true);
    this.endArm = 0;
  }

  private gameOver(): void {
    game.phase = 'GAME_OVER';
    this.env?.signs.setBravo(false);
    this.env?.signs.setFailed(true);
    audio.play('die');
    window.setTimeout(() => audio.play('gameover'), 250);
    audio.stopMusic();
    emit('game-over');

    const altitude = Math.round(this.player.position.y);
    this.setEndContent(
      'GAME OVER',
      `ROUND ${game.round}/${TOTAL_ROUNDS}  ·  ALT ${altitude}M  ·  ${this.formatTime(game.runTime)}`
    );
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
      // Post-win celebration beat, then the keyboard rises.
      if (this.winWait > 0) {
        this.winWait -= delta;
        if (this.winWait <= 0) {
          this.nameActive = true;
          this.updateNameDisplay();
          this.setNamePanelShown(true);
        }
        return;
      }
      // While the keyboard is up (or the tag is being admired), no
      // trigger shortcuts — a stray pull must not restart the run.
      if (this.nameActive) return;
      // Escape hatch: after a short arm delay, a bare trigger pull on
      // either controller retries — no pointing at the panel required.
      this.endArm += delta;
      if (this.endArm > 1.2 && this.selectPressed()) this.handleEndAction();
      return;
    }
    if (game.phase === 'START') {
      // In-VR lobby: only the BEGIN button starts the run — no bare-trigger
      // shortcut here, or an accidental pull anywhere launches the game.
      return;
    }

    game.runTime += delta;

    // Panel timers always tick, even during the settle hold.
    if (this.warnTimer > 0) {
      this.warnTimer -= delta;
      if (this.warnTimer <= 0) this.setPanelVisible(this.panels?.warn, false);
    }
    this.player.head.getWorldPosition(this.headWorld);

    // Settle beat: freshly landed, holding before the blocks rise.
    // no spawns, no collisions — just recover your footing and look down.
    if (game.phase === 'GRID' && this.gridHold > 0) {
      this.gridHold -= delta;
      game.roundRemaining = this.roundRemaining();
      if (this.gridHold <= 0) {
        this.beepAt = 3;
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
      spawner?.holdFire();
      if (remaining <= this.beepAt) {
        const cue = this.beepAt === 3 ? 'three' : this.beepAt === 2 ? 'two' : 'one';
        audio.play(cue, 0.9);
        this.beepAt -= 1;
      }
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
