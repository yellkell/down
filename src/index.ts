import {
  AssetManifest,
  FogExp2,
  Interactable,
  PanelUI,
  ReferenceSpaceType,
  SessionMode,
  Vector3,
  VisibilityState,
  World
} from '@iwsdk/core';

import { audio } from './audio.js';
import { PHASE_HEIGHTS, SLIDE_ANGLE, WINNER_HEIGHT } from './constants.js';
import { SignBoard } from './env/beacon.js';
import { createClouds } from './env/clouds.js';
import { Confetti } from './env/extras.js';
import { GraffitiField } from './env/graffiti.js';
import { createPlatform } from './env/platform.js';
import { createSky } from './env/sky.js';
import { createFinishZone, createMegastructures } from './env/structures.js';
import { createStreaks } from './env/track.js';
import { fetchMarks } from './marks.js';
import { EnvironmentSystem, type EnvHandles } from './systems/environment.js';
import { GameSystem, type PanelEntities } from './systems/game.js';
import { GridSpawnerSystem } from './systems/spawner.js';
import { SlideSystem } from './systems/slide.js';

const assets: AssetManifest = {};

World.create(document.getElementById('scene-container') as HTMLDivElement, {
  assets,
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    referenceSpace: { type: ReferenceSpaceType.LocalFloor },
    offer: 'always'
  },
  render: {
    far: 4000,
    defaultLighting: false,
    camera: { position: [0, 2.1, 4.2], lookAt: [0, 1.0, -6] }
  },
  features: {
    locomotion: false,
    grabbing: false,
    spatialUI: true
  }
}).then((world) => {
  // Three.js defaults WebXR to maximum fixed foveation. On Quest that
  // produces a visible, head-locked dark band in this high-contrast scene.
  // Keep it disabled for the current and subsequent XR projection layers.
  world.renderer.xr.setFoveation(0);

  const { scene, player } = world;

  scene.fog = new FogExp2(0x050510, 0.002); // the original's density — the deep world stays hidden until you're in it
  player.position.set(0, PHASE_HEIGHTS[0], 0);

  // --- World dressing -----------------------------------------------------
  const sky = createSky();
  scene.add(sky.group);

  const platform = createPlatform();
  platform.group.position.copy(player.position);
  scene.add(platform.group);

  const city = createMegastructures();
  scene.add(city.group);

  const clouds = createClouds();
  scene.add(clouds.group);

  // Finish zone sits where the final slide lands — but stays hidden until
  // the final drop begins, so the bottom is a mystery from up top.
  // (Computed from the real phase heights — hardcoded drops once left the
  // decorations ~150m short of the actual landing point.)
  const slideRun = (drop: number) => drop / Math.tan(SLIDE_ANGLE);
  const finishZ = -(
    slideRun(PHASE_HEIGHTS[0] - PHASE_HEIGHTS[1]) +
    slideRun(PHASE_HEIGHTS[1] - PHASE_HEIGHTS[2]) +
    slideRun(PHASE_HEIGHTS[2] - WINNER_HEIGHT)
  );
  const finish = createFinishZone(new Vector3(0, WINNER_HEIGHT, finishZ));
  finish.visible = false;
  scene.add(finish);

  // The graffiti wall: everyone who ever finished, sprayed around the pad.
  // Loads in the background — the field just starts empty if it can't.
  const graffiti = new GraffitiField();
  finish.add(graffiti.group);
  void fetchMarks().then((names) => graffiti.setMarks(names));

  const signs = new SignBoard();
  player.add(signs.group);

  const streaks = createStreaks();
  player.add(streaks.object);

  const confetti = new Confetti();
  scene.add(confetti.mesh);

  world.globals.env = {
    sky,
    platform,
    signs,
    confetti,
    streaks,
    city,
    clouds,
    finish,
    graffiti
  } satisfies EnvHandles;

  // --- UI panels (compiled from ui/*.uikitml) -----------------------------
  // In-VR start lobby — parked below until the player enters VR, then shown
  // so they press BEGIN themselves (the run never auto-starts in VR).
  const startPanel = world
    .createTransformEntity(undefined, world.playerEntity)
    .addComponent(PanelUI, { config: './ui/start.json', maxWidth: 1.35, maxHeight: 1.15 })
    .addComponent(Interactable);
  startPanel.object3D!.position.set(0, -9999, -1.9);

  // Begin in-frustum behind the opaque loader so UIKit prepares its glyph
  // meshes before an early first-run failure; GameSystem parks it afterward.
  const endPanel = world
    .createTransformEntity(undefined, world.playerEntity)
    .addComponent(PanelUI, { config: './ui/end.json', maxWidth: 1.3, maxHeight: 1.1 })
    .addComponent(Interactable);
  endPanel.object3D!.position.set(0, 1.45, -1.8);

  const warnPanel = world
    .createTransformEntity(undefined, world.playerEntity)
    .addComponent(PanelUI, { config: './ui/warn.json', maxWidth: 2.2, maxHeight: 0.5 });
  warnPanel.object3D!.position.set(0, 1.05, -2.6);
  warnPanel.object3D!.rotation.x = -0.25;
  warnPanel.object3D!.visible = false;

  // The finish-line keyboard — parked below like the other menus until the
  // player survives the descent and gets to sign the bottom of the world.
  const namePanel = world
    .createTransformEntity(undefined, world.playerEntity)
    .addComponent(PanelUI, { config: './ui/name.json', maxWidth: 1.65, maxHeight: 1.3 })
    .addComponent(Interactable);
  namePanel.object3D!.position.set(0, -9999, -1.75);

  world.globals.panels = {
    start: startPanel,
    end: endPanel,
    warn: warnPanel,
    name: namePanel
  } satisfies PanelEntities;

  // --- Game --------------------------------------------------------------
  audio.init();
  world
    .registerSystem(EnvironmentSystem)
    .registerSystem(GridSpawnerSystem)
    .registerSystem(SlideSystem)
    .registerSystem(GameSystem);

  // --- 2D intro / entry ---------------------------------------------------
  const game = world.getSystem(GameSystem);
  const intro = document.getElementById('intro');
  const enterVrBtn = document.getElementById('enter-vr');
  const previewBtn = document.getElementById('play-browser');
  const vrStatus = document.getElementById('vr-status');
  const wordmark = document.getElementById('wordmark');
  const hint = document.getElementById('hint');

  let dismissed = false;
  const dismissIntro = (): void => {
    if (dismissed) return;
    dismissed = true;
    intro?.classList.add('gone');
    window.setTimeout(() => intro?.remove(), 700);
    wordmark?.removeAttribute('hidden');
    hint?.removeAttribute('hidden');
  };

  // ENTER VR: request the session. The run does NOT auto-start — once the
  // session is visible, the in-VR lobby appears and the player presses
  // BEGIN there (handled by the visibility subscription below).
  enterVrBtn?.addEventListener('click', () => {
    if (enterVrBtn.classList.contains('disabled')) return;
    world.launchXR();
  });
  // PREVIEW: desktop spectator — starts straight away.
  previewBtn?.addEventListener('click', () => {
    dismissIntro();
    game?.beginRun();
  });
  world.visibilityState.subscribe((state) => {
    if (state !== VisibilityState.NonImmersive) {
      dismissIntro();
      game?.showStartLobby();
    }
  });

  // Reveal the intro now that the world is ready.
  const loading = document.getElementById('loading');
  loading?.classList.add('done');
  window.setTimeout(() => loading?.remove(), 700);
  intro?.removeAttribute('hidden');

  // Probe for a headset to tailor the call-to-action.
  const xr = (navigator as Navigator & {
    xr?: { isSessionSupported(mode: string): Promise<boolean> };
  }).xr;
  const noHeadset = (msg: string): void => {
    enterVrBtn?.classList.add('disabled');
    if (vrStatus) vrStatus.textContent = msg;
  };
  if (xr?.isSessionSupported) {
    xr.isSessionSupported('immersive-vr')
      .then((ok) => {
        if (ok) {
          if (vrStatus) vrStatus.textContent = 'Headset ready — clear a 2m × 2m space';
        } else {
          noHeadset('No headset detected — preview in your browser');
        }
      })
      .catch(() => noHeadset('No headset detected — preview in your browser'));
  } else {
    noHeadset('WebXR not available — preview in your browser');
  }
});
