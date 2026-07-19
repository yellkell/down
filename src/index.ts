import {
  AssetManifest,
  AssetType,
  FogExp2,
  Interactable,
  PanelUI,
  ReferenceSpaceType,
  ScreenSpace,
  SessionMode,
  Vector3,
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
  const startPanel = world
    .createTransformEntity(undefined, world.playerEntity)
    .addComponent(PanelUI, {
      config: './ui/start.json',
      maxWidth: 1.45,
      maxHeight: 1.6
    })
    .addComponent(Interactable)
    .addComponent(ScreenSpace, { bottom: '24px', right: '24px', width: '30vw' });
  startPanel.object3D!.position.set(0, 1.45, -2.1);

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
    start: startPanel,
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

  document.getElementById('loading')?.classList.add('done');
  window.setTimeout(() => document.getElementById('loading')?.remove(), 900);
});
