import {
  AssetManifest,
  AssetType,
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
import { createClouds } from './env/clouds.js';
import { Confetti, SignBoard } from './env/extras.js';
import { createPlatform } from './env/platform.js';
import { createSky } from './env/sky.js';
import { createFinishZone, createMegastructures } from './env/structures.js';
import { createStreaks } from './env/track.js';
import { EnvironmentSystem, type EnvHandles } from './systems/environment.js';
import { GameSystem, type PanelEntities } from './systems/game.js';
import { GridSpawnerSystem } from './systems/spawner.js';
import { SlideSystem } from './systems/slide.js';

const assets: AssetManifest = {
  signTop: { url: './textures/sign.png', type: AssetType.Texture, priority: 'critical' },
  signMiddle: {
    url: './textures/middlesign.jpeg',
    type: AssetType.Texture,
    priority: 'critical'
  },
  signBottom: {
    url: './textures/bottomsign.jpeg',
    type: AssetType.Texture,
    priority: 'critical'
  },
  signFinish: {
    url: './textures/finishsign.jpeg',
    type: AssetType.Texture,
    priority: 'critical'
  }
};

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
    finish
  } satisfies EnvHandles;

  // --- UI panels (compiled from ui/*.uikitml) -----------------------------
  const hudPanel = world
    .createTransformEntity(undefined, world.playerEntity)
    .addComponent(PanelUI, { config: './ui/hud.json', maxWidth: 1.1, maxHeight: 0.7 });
  hudPanel.object3D!.position.set(0, 2.45, -3.6);
  hudPanel.object3D!.rotation.x = 0.14;
  hudPanel.object3D!.visible = false;

  // The end panel stays live from boot (visibility-toggling a panel can
  // leave its ray interaction stale) — it parks far below until needed.
  const endPanel = world
    .createTransformEntity(undefined, world.playerEntity)
    .addComponent(PanelUI, { config: './ui/end.json', maxWidth: 1.3, maxHeight: 1.1 })
    .addComponent(Interactable);
  endPanel.object3D!.position.set(0, -9999, -1.8);

  const warnPanel = world
    .createTransformEntity(undefined, world.playerEntity)
    .addComponent(PanelUI, { config: './ui/warn.json', maxWidth: 2.2, maxHeight: 0.5 });
  warnPanel.object3D!.position.set(0, 1.05, -2.6);
  warnPanel.object3D!.rotation.x = -0.25;
  warnPanel.object3D!.visible = false;

  world.globals.panels = {
    hud: hudPanel,
    end: endPanel,
    warn: warnPanel
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

  let entered = false;
  const enterExperience = (): void => {
    if (entered) return;
    entered = true;
    intro?.classList.add('gone');
    window.setTimeout(() => intro?.remove(), 700);
    wordmark?.removeAttribute('hidden');
    hint?.removeAttribute('hidden');
    game?.beginRun();
  };

  // ENTER VR: request the immersive session; the run auto-starts and the
  // 2D page dismisses when the session becomes visible (below).
  enterVrBtn?.addEventListener('click', () => {
    if (enterVrBtn.classList.contains('disabled')) return;
    world.launchXR();
  });
  previewBtn?.addEventListener('click', () => enterExperience());
  world.visibilityState.subscribe((state) => {
    if (state !== VisibilityState.NonImmersive) enterExperience();
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
