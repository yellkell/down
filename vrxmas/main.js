import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { VRButton } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/webxr/VRButton.js";

const canvas = document.getElementById("c");
const loadingEl = document.getElementById("loading");
const healthEl = document.getElementById("health");
const difficultyEl = document.getElementById("difficulty");
const distanceEl = document.getElementById("distance");

// ---------- Renderer / Scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x9fc2ff, 0.0006);

// ---------- Camera Rig ----------
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 5000);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

// VR-only: keep a non-interactive desktop preview camera.
camera.position.set(0, 1.6, 2.8);
camera.lookAt(0, 1.2, 0);

// All gameplay objects that should "stay under the player" (platform, hazards, HUD)
// live inside sledSpace. We can nudge sledSpace to recenter roomscale without moving
// the sled's world position down the mountain.
const sledSpace = new THREE.Group();
rig.add(sledSpace);

// ---------- Platform (2m x 2m sled + 2x2 squares) ----------
const PLATFORM_SIZE = 2.0;
const HALF_PLATFORM = PLATFORM_SIZE * 0.5;
const GRID_COLS = 3;
const GRID_ROWS = 2;
const TILE_W = PLATFORM_SIZE / GRID_COLS; // 0.666..
const TILE_D = PLATFORM_SIZE / GRID_ROWS; // 1.0
const TILE_COUNT = GRID_COLS * GRID_ROWS;

const TILE_CENTERS = (() => {
  const centers = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = -HALF_PLATFORM + TILE_W * (col + 0.5);
      const z = -HALF_PLATFORM + TILE_D * (row + 0.5);
      centers.push(new THREE.Vector3(x, 0, z));
    }
  }
  return centers;
})();

const platform = new THREE.Group();
sledSpace.add(platform);

// Base sled platform (top surface is y=0)
{
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(PLATFORM_SIZE, 0.12, PLATFORM_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.9, metalness: 0.05 })
  );
  base.position.y = -0.06;
  platform.add(base);

  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(PLATFORM_SIZE, PLATFORM_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x2b3a4c, roughness: 0.85, metalness: 0.0 })
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.001;
  platform.add(top);

  // Grid lines
  const lineMat = new THREE.LineBasicMaterial({ color: 0x9fd2ff, transparent: true, opacity: 0.35 });
  const x1 = -HALF_PLATFORM + TILE_W; // first vertical division
  const x2 = -HALF_PLATFORM + TILE_W * 2; // second vertical division
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    // horizontal divider between the two rows
    new THREE.Vector3(-HALF_PLATFORM, 0.01, 0),
    new THREE.Vector3(HALF_PLATFORM, 0.01, 0),
    // vertical dividers between 3 columns
    new THREE.Vector3(x1, 0.01, -HALF_PLATFORM),
    new THREE.Vector3(x1, 0.01, HALF_PLATFORM),
    new THREE.Vector3(x2, 0.01, -HALF_PLATFORM),
    new THREE.Vector3(x2, 0.01, HALF_PLATFORM),
  ]);
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  platform.add(lines);

  // Outer border
  const borderGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-HALF_PLATFORM, 0.012, -HALF_PLATFORM),
    new THREE.Vector3(HALF_PLATFORM, 0.012, -HALF_PLATFORM),
    new THREE.Vector3(HALF_PLATFORM, 0.012, -HALF_PLATFORM),
    new THREE.Vector3(HALF_PLATFORM, 0.012, HALF_PLATFORM),
    new THREE.Vector3(HALF_PLATFORM, 0.012, HALF_PLATFORM),
    new THREE.Vector3(-HALF_PLATFORM, 0.012, HALF_PLATFORM),
    new THREE.Vector3(-HALF_PLATFORM, 0.012, HALF_PLATFORM),
    new THREE.Vector3(-HALF_PLATFORM, 0.012, -HALF_PLATFORM),
  ]);
  const border = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
  platform.add(border);
}

// Per-square overlays for telegraphs + player location
const squareOverlays = [];
{
  const overlayGeo = new THREE.PlaneGeometry(TILE_W, TILE_D);
  overlayGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < TILE_COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x2aa7ff, transparent: true, opacity: 0.0, depthWrite: false });
    const m = new THREE.Mesh(overlayGeo, mat);
    m.position.copy(TILE_CENTERS[i]);
    m.position.y = 0.02;
    platform.add(m);
    squareOverlays.push(m);
  }
}

// Player marker (projects headset XZ onto platform)
const playerMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.12, 0.18, 24),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
);
playerMarker.rotation.x = -Math.PI / 2;
playerMarker.position.set(0, 0.03, 0);
platform.add(playerMarker);

// ---------- In-world HUD panel (visible in VR) ----------
const hudCanvas = document.createElement("canvas");
hudCanvas.width = 512;
hudCanvas.height = 256;
const hudCtx = hudCanvas.getContext("2d");
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace;
const hudPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1.25, 0.62),
  new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, opacity: 0.92 })
);
hudPlane.position.set(0, 1.35, -1.65);
sledSpace.add(hudPlane);

function drawHudPanel({ health, difficultyName, distance, speed, message }) {
  if (!hudCtx) return;
  hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);

  // Background
  hudCtx.fillStyle = "rgba(0,0,0,0.45)";
  hudCtx.fillRect(0, 0, hudCanvas.width, hudCanvas.height);
  hudCtx.strokeStyle = "rgba(255,255,255,0.10)";
  hudCtx.lineWidth = 4;
  hudCtx.strokeRect(10, 10, hudCanvas.width - 20, hudCanvas.height - 20);

  hudCtx.fillStyle = "rgba(234,242,255,0.95)";
  hudCtx.font = "bold 34px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  hudCtx.fillText("SLED RUN", 26, 52);

  hudCtx.font = "22px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  hudCtx.fillStyle = "rgba(234,242,255,0.9)";
  hudCtx.fillText(`Health: ${health}`, 26, 98);
  hudCtx.fillText(`Difficulty: ${difficultyName}`, 26, 132);
  hudCtx.fillText(`Distance: ${Math.floor(distance)} m`, 26, 166);
  hudCtx.fillText(`Speed: ${Math.floor(speed)} m/s`, 26, 200);

  if (message) {
    const lines = String(message).split("\n");
    hudCtx.fillStyle = "rgba(255,225,140,0.95)";
    hudCtx.font = "bold 20px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    let y = 230;
    for (const line of lines) {
      hudCtx.fillText(line, 26, y);
      y += 22;
      if (y > 252) break;
    }
  }

  hudTex.needsUpdate = true;
}

// ---------- Lights / Sky ----------
scene.background = new THREE.Color(0x0b2037);

const hemi = new THREE.HemisphereLight(0xd8ecff, 0x2a2a34, 0.85);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.25);
sun.position.set(200, 400, 150);
sun.castShadow = false;
scene.add(sun);

// Simple skydome gradient
{
  const geo = new THREE.SphereGeometry(2500, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top: { value: new THREE.Color(0x9fd2ff) },
      bottom: { value: new THREE.Color(0x071425) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 top;
      uniform vec3 bottom;
      void main() {
        float h = normalize(vPos).y * 0.5 + 0.5;
        vec3 col = mix(bottom, top, smoothstep(0.0, 1.0, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  scene.add(sky);
}

// ---------- Terrain (snowy steep hill) ----------
// Height function used both for mesh deformation and for sled height sampling.
function heightAt(x, z) {
  // Simple deterministic value-noise + fbm for a mountainy heightfield (no deps).
  const lerp = (a, b, t) => a + (b - a) * t;
  const fade = (t) => t * t * (3 - 2 * t);
  const hash2 = (ix, iz) => {
    const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  };
  const noise2 = (x2, z2) => {
    const x0 = Math.floor(x2);
    const z0 = Math.floor(z2);
    const xf = x2 - x0;
    const zf = z2 - z0;
    const u = fade(xf);
    const v = fade(zf);
    const a = hash2(x0, z0);
    const b = hash2(x0 + 1, z0);
    const c = hash2(x0, z0 + 1);
    const d = hash2(x0 + 1, z0 + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v); // 0..1
  };
  const fbm2 = (x2, z2) => {
    let amp = 0.55;
    let freq = 1.0;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < 5; i++) {
      sum += noise2(x2 * freq, z2 * freq) * amp;
      norm += amp;
      amp *= 0.55;
      freq *= 2.02;
    }
    return sum / norm; // 0..1
  };
  const ridge = (n01) => {
    const n = n01 * 2 - 1; // -1..1
    return 1 - Math.abs(n); // 0..1
  };

  const startZ = 2600;

  // Long descent + peak near the start.
  const baseSlope = -z * 0.11;
  const peak = 520 * Math.exp(-((x * x) / (2 * 420 * 420) + ((z - startZ) * (z - startZ)) / (2 * 620 * 620)));

  // Mountain ridges at multiple scales.
  const nBig = ridge(fbm2(x * 0.0016, z * 0.0016));
  const nMed = ridge(fbm2(x * 0.004, z * 0.004));
  const nFine = fbm2(x * 0.02, z * 0.02);

  const ridges = (nBig * nBig) * 240 + (nMed * nMed) * 110;
  const snowRipples = (nFine * 2 - 1) * 6.0;

  // Keep a gentler "track" band near center so the run is readable.
  const track = Math.exp(-(x * x) / (2 * 115 * 115));
  const trackCarve = -track * (22 + 18 * Math.sin(z * 0.01));

  return baseSlope + peak + ridges + snowRipples + trackCarve;
}

const world = {
  terrainSize: 6000,
  terrainSegs: 260,
};

const terrainGeo = new THREE.PlaneGeometry(world.terrainSize, world.terrainSize, world.terrainSegs, world.terrainSegs);
terrainGeo.rotateX(-Math.PI / 2);

// Deform the plane by heightAt()
{
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
  }
  terrainGeo.computeVertexNormals();
}

const snowMat = new THREE.MeshStandardMaterial({
  color: 0xf2f7ff,
  roughness: 0.95,
  metalness: 0.0,
});

const terrain = new THREE.Mesh(terrainGeo, snowMat);
terrain.position.set(0, 0, 0);
scene.add(terrain);

// ---------- Scenery (trees on the sides) ----------
function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.35, 3.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x5b3d2a, roughness: 1 })
  );
  trunk.position.y = 1.75;
  g.add(trunk);

  const leavesMat = new THREE.MeshStandardMaterial({ color: 0x184a2a, roughness: 1 });
  const cone1 = new THREE.Mesh(new THREE.ConeGeometry(1.8, 4.5, 10), leavesMat);
  cone1.position.y = 5.0;
  g.add(cone1);
  const cone2 = new THREE.Mesh(new THREE.ConeGeometry(1.35, 3.6, 10), leavesMat);
  cone2.position.y = 6.3;
  g.add(cone2);
  return g;
}

const trees = new THREE.Group();
scene.add(trees);

// Place trees mostly away from the "track" center (x near 0)
{
  const rand = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 260; i++) {
    const t = makeTree();
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * rand(90, 520) + rand(-25, 25);
    const z = rand(-2600, 2800);
    const y = heightAt(x, z);
    t.position.set(x, y, z);
    t.rotation.y = rand(0, Math.PI * 2);
    const s = rand(0.8, 1.35);
    t.scale.setScalar(s);
    trees.add(t);
  }
}

// Extra track props (rocks / dead stumps) for "obstacle awareness" vibes
{
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7f8a95, roughness: 0.95, metalness: 0.0 });
  const rockCount = 900;
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const sca = new THREE.Vector3();

  for (let i = 0; i < rockCount; i++) {
    // Keep a mostly-clear central track, but not perfectly empty.
    const inTrack = Math.random() < 0.22;
    const x = inTrack ? (Math.random() - 0.5) * 260 : (Math.random() < 0.5 ? -1 : 1) * (260 + Math.random() * 650);
    const z = -2600 + Math.random() * 5200;
    const y = heightAt(x, z);
    pos.set(x, y + 0.12, z);
    quat.setFromEuler(new THREE.Euler(Math.random() * 0.6, Math.random() * Math.PI * 2, Math.random() * 0.6));
    const s = 0.25 + Math.random() * (inTrack ? 0.55 : 0.95);
    sca.set(s * (0.8 + Math.random() * 0.6), s * (0.6 + Math.random() * 0.6), s * (0.8 + Math.random() * 0.6));
    m.compose(pos, quat, sca);
    rocks.setMatrixAt(i, m);
  }
  rocks.instanceMatrix.needsUpdate = true;
  rocks.castShadow = false;
  rocks.receiveShadow = false;
  scene.add(rocks);

  // A few dead stumps near the track edges
  const stumpGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.2, 7);
  const stumpMat = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 1.0 });
  const stumpCount = 140;
  const stumps = new THREE.InstancedMesh(stumpGeo, stumpMat, stumpCount);
  for (let i = 0; i < stumpCount; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * (220 + Math.random() * 520) + (Math.random() - 0.5) * 90;
    const z = -2400 + Math.random() * 5000;
    const y = heightAt(x, z);
    pos.set(x, y + 0.5, z);
    quat.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.25, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.25));
    const s = 0.75 + Math.random() * 0.6;
    sca.setScalar(s);
    m.compose(pos, quat, sca);
    stumps.setMatrixAt(i, m);
  }
  stumps.instanceMatrix.needsUpdate = true;
  scene.add(stumps);
}

// ---------- Snow particles ----------
const snow = (() => {
  const count = 2500;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const spread = 550;
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * spread;
    positions[i * 3 + 1] = 40 + Math.random() * 140;
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
    speeds[i] = 10 + Math.random() * 25;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.5,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.spread = spread;
  return pts;
})();
scene.add(snow);

// ---------- VR Input (roomscale + optional recenter) ----------
const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
controllers.forEach((c) => scene.add(c));

const tmpV3 = new THREE.Vector3();

function getHeadLocalToSledSpace(out = tmpV3) {
  const xrCam = renderer.xr.getCamera(camera);
  xrCam.getWorldPosition(out);
  return sledSpace.worldToLocal(out);
}

function clampToPlatformXZ(v) {
  v.x = THREE.MathUtils.clamp(v.x, -HALF_PLATFORM, HALF_PLATFORM);
  v.z = THREE.MathUtils.clamp(v.z, -HALF_PLATFORM, HALF_PLATFORM);
  v.y = 0;
  return v;
}

function getSquareInfo(localX, localZ) {
  const inBounds = Math.abs(localX) <= HALF_PLATFORM && Math.abs(localZ) <= HALF_PLATFORM;
  if (!inBounds) return { inBounds: false, idx: -1 };
  const col = THREE.MathUtils.clamp(Math.floor((localX + HALF_PLATFORM) / TILE_W), 0, GRID_COLS - 1);
  const row = THREE.MathUtils.clamp(Math.floor((localZ + HALF_PLATFORM) / TILE_D), 0, GRID_ROWS - 1);
  return { inBounds: true, idx: row * GRID_COLS + col };
}

function recenterPlatformToPlayer() {
  if (!renderer.xr.isPresenting) return;
  const headLocal = getHeadLocalToSledSpace(new THREE.Vector3());
  // Move platform/hazards/HUD so the user's head XZ is centered over the platform.
  sledSpace.position.x -= headLocal.x;
  sledSpace.position.z -= headLocal.z;

  // Start the run once the player has intentionally recentered.
  if (game.phase === "intro") game.phase = "running";
}

controllers.forEach((c) => {
  c.addEventListener("selectstart", recenterPlatformToPlayer);
  c.addEventListener("squeezestart", recenterPlatformToPlayer);
});

// ---------- Dodge hazards ----------
const hazardGroup = new THREE.Group();
sledSpace.add(hazardGroup);

const hazardMatRock = new THREE.MeshStandardMaterial({ color: 0x9aa6b3, roughness: 0.9, metalness: 0.0 });
const hazardMatIce = new THREE.MeshStandardMaterial({ color: 0xcfefff, roughness: 0.25, metalness: 0.0, emissive: 0x10344f, emissiveIntensity: 0.22 });
const hazardMatLog = new THREE.MeshStandardMaterial({ color: 0x5a3d2b, roughness: 1.0, metalness: 0.0 });
const itemMat = new THREE.MeshStandardMaterial({ color: 0x2de27a, roughness: 0.35, metalness: 0.0, emissive: 0x0b4a25, emissiveIntensity: 0.45 });
const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });

const hazardGeoRock = new THREE.DodecahedronGeometry(0.24, 0);
const hazardGeoIce = new THREE.ConeGeometry(0.18, 0.62, 10);
const hazardGeoLog = new THREE.CylinderGeometry(0.12, 0.12, 0.7, 10);
const itemGeoPresent = new THREE.BoxGeometry(0.28, 0.28, 0.28);

function pickTargets(k) {
  const pool = Array.from({ length: TILE_COUNT }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k);
}

function hasAdjacentSafePair(safeSet) {
  for (let idx = 0; idx < TILE_COUNT; idx++) {
    if (!safeSet.has(idx)) continue;
    const col = idx % GRID_COLS;
    const row = Math.floor(idx / GRID_COLS);
    if (col + 1 < GRID_COLS && safeSet.has(idx + 1)) return true;
    if (row + 1 < GRID_ROWS && safeSet.has(idx + GRID_COLS)) return true;
  }
  return false;
}

function getBlockedTiles() {
  const blocked = new Set();
  for (const h of hazards) {
    if ((h.mode === "static" || h.mode === "crashStatic") && h.targetIdx >= 0) blocked.add(h.targetIdx);
  }
  return blocked;
}

function chooseTelegraphTargets({ wantedCount, blockedSet, avoidSet = new Set() }) {
  const all = Array.from({ length: TILE_COUNT }, (_, i) => i);
  const safeNow = all.filter((i) => !blockedSet.has(i) && !avoidSet.has(i));
  const blockedNow = all.filter((i) => blockedSet.has(i));

  // If the board is already tight (<=2 safe), aim new telegraphs at blocked tiles to preserve the safe pair.
  const candidates = safeNow.length <= 2 ? (blockedNow.length ? blockedNow : safeNow) : safeNow;

  const k = Math.max(0, Math.min(wantedCount, candidates.length));
  if (k === 0) return [];

  const attempt = (src) => {
    const a = src.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, k);
  };

  const isValid = (targetsArr) => {
    const targets = new Set(targetsArr);
    const safe = new Set();
    for (const idx of all) {
      if (blockedSet.has(idx)) continue;
      if (avoidSet.has(idx)) continue;
      if (targets.has(idx)) continue;
      safe.add(idx);
    }
    // Must always have a connecting pair of free tiles.
    return safe.size >= 2 && hasAdjacentSafePair(safe);
  };

  // Try random subsets first (fast, arcade-y variety).
  for (let i = 0; i < 70; i++) {
    const t = attempt(candidates);
    if (isValid(t)) return t;
  }

  // Fallback greedy: add targets only if we preserve a safe pair.
  const shuffled = candidates.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const out = [];
  for (const idx of shuffled) {
    if (out.length >= k) break;
    const next = out.concat([idx]);
    if (isValid(next)) out.push(idx);
  }
  return out;
}

const fx = [];
const hazards = [];
const items = [];
const game = {
  started: false,
  phase: "idle", // idle | intro | running
  health: 3,
  maxHealth: 5,
  distance: 0,
  difficulty: 0, // 0 easy, 1 medium, 2 hard
  waveState: "idle", // idle | telegraph
  waveT: 0,
  telegraphT: 0,
  telegraphTargets: [],
  itemState: "idle", // idle | telegraph
  itemT: 0,
  itemTelegraphT: 0,
  itemTargetIdx: -1,
  itemType: "heal", // heal | shield | boost
  shieldT: 0,
  boostT: 0,
  noticeT: 0,
  noticeText: "",
  // Hazard-on-platform contact handling
  lastPlayerSquareIdx: -1,
  onHazardT: 0,
  offPlatformT: 0,
  hitFlashT: 0,
};

function difficultyName(level) {
  return level === 0 ? "Easy" : level === 1 ? "Medium" : "Hard";
}

function resetRun() {
  sled.x = 0;
  sled.z = 2600;
  sled.speed = 0;
  game.phase = "intro";
  game.health = 3;
  game.maxHealth = 5;
  game.distance = 0;
  game.difficulty = 0;
  game.waveState = "idle";
  game.waveT = 0;
  game.telegraphT = 0;
  game.telegraphTargets = [];
  game.itemState = "idle";
  game.itemT = 0;
  game.itemTelegraphT = 0;
  game.itemTargetIdx = -1;
  game.itemType = "heal";
  game.shieldT = 0;
  game.boostT = 0;
  game.noticeT = 0;
  game.noticeText = "";
  game.lastPlayerSquareIdx = -1;
  game.onHazardT = 0;
  game.offPlatformT = 0;
  game.hitFlashT = 0;
  hazards.splice(0, hazards.length);
  items.splice(0, items.length);
  fx.splice(0, fx.length);
  hazardGroup.clear();
  sledSpace.position.set(0, 0, 0);
}

function damage(amount) {
  // Shield blocks ONE hit, then ends.
  if (game.shieldT > 0) {
    game.shieldT = 0;
    game.noticeT = 0.8;
    game.noticeText = "SHIELD BLOCK!";
    return;
  }
  game.health = Math.max(0, game.health - amount);
  game.hitFlashT = 0.35;
  if (game.health <= 0) resetRun();
}

function randomObstacleKind() {
  // Bias toward rocks, with occasional logs/ice.
  const r = Math.random();
  if (r < 0.62) return "rock";
  if (r < 0.85) return "log";
  return "ice";
}

function makeHazardMesh(kind) {
  if (kind === "log") {
    const m = new THREE.Mesh(hazardGeoLog, hazardMatLog);
    m.rotation.z = Math.PI / 2;
    return m;
  }
  if (kind === "ice") {
    const m = new THREE.Mesh(hazardGeoIce, hazardMatIce);
    m.rotation.x = Math.PI;
    return m;
  }
  return new THREE.Mesh(hazardGeoRock, hazardMatRock);
}

function spawnHazard(targetIdx, mode = "impact") {
  const center = TILE_CENTERS[targetIdx];
  const kind = randomObstacleKind();
  const m = makeHazardMesh(kind);
  const spawnY = mode === "static" ? 0.22 : 5.4 + Math.random() * 1.4;
  m.position.set(center.x + (Math.random() - 0.5) * 0.12, spawnY, center.z + (Math.random() - 0.5) * 0.12);
  hazardGroup.add(m);
  hazards.push({
    mesh: m,
    targetIdx,
    vy: mode === "static" ? 0 : 10 + Math.random() * 4,
    kind,
    spin: (Math.random() - 0.5) * 6.0,
    wobble: Math.random() * 3.0,
    mode, // impact | crashStatic | static | sweeper
    ttl: mode === "static" ? 4.8 + Math.random() * 2.4 : 0,
    hitT: 0,
  });
}

function spawnStaticBlocker(targetIdx) {
  // A persistent obstacle sitting on a square for a few seconds.
  spawnHazard(targetIdx, "static");
}

function spawnCrashToStatic(targetIdx) {
  // Falls down and then stays on the square briefly (arcade “oh no it landed there!”).
  spawnHazard(targetIdx, "crashStatic");
}

function spawnSweeperRow(row) {
  // A moving log that sweeps across two squares in a row (moving obstacle).
  // row: 0 = back row (z=-0.5), 1 = front row (z=+0.5)
  const z = row === 0 ? (-HALF_PLATFORM + TILE_D * 0.5) : (-HALF_PLATFORM + TILE_D * 1.5);
  const m = makeHazardMesh("log");
  m.scale.set(1.15, 1.0, 1.15);
  m.position.set(-HALF_PLATFORM - 0.45, 0.28, z);
  hazardGroup.add(m);
  hazards.push({
    mesh: m,
    targetIdx: -1,
    vy: 0,
    kind: "log",
    spin: 0,
    wobble: 0,
    mode: "sweeper",
    ttl: 1.8,
    hitT: 0,
    vx: 1.9, // meters/sec across platform
    row,
  });
}

function spawnItem(targetIdx, itemType) {
  const center = TILE_CENTERS[targetIdx];
  const m = new THREE.Mesh(itemGeoPresent, itemMat);
  m.position.set(center.x, 4.8, center.z);
  m.rotation.y = Math.random() * Math.PI * 2;
  hazardGroup.add(m);
  items.push({ mesh: m, targetIdx, itemType, vy: 7.8 });
}

function spawnPuff(x, z) {
  const p = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), puffMat.clone());
  p.position.set(x, 0.12, z);
  hazardGroup.add(p);
  fx.push({ mesh: p, t: 0 });
}

function updateHazards(dt, playerSquare) {
  if (game.phase !== "running") return;
  // Decide difficulty by distance
  game.difficulty = game.distance > 2200 ? 2 : game.distance > 900 ? 1 : 0;

  // Wave scheduling
  const interval = game.difficulty === 0 ? 1.65 : game.difficulty === 1 ? 1.42 : 1.2;
  const telegraphDur = game.difficulty === 0 ? 0.9 : game.difficulty === 1 ? 0.78 : 0.66;

  game.waveT += dt;
  if (game.waveState === "idle" && game.waveT >= interval) {
    game.waveT = 0;
    game.waveState = "telegraph";
    game.telegraphT = 0;

    const blocked = getBlockedTiles();

    // With 6 tiles, the arcade pressure comes from leaving exactly ONE connected safe pair on harder waves.
    const r = Math.random();
    const wanted =
      game.difficulty === 0 ? (r < 0.65 ? 2 : 3) :
      game.difficulty === 1 ? (r < 0.45 ? 2 : r < 0.85 ? 3 : 4) :
      (r < 0.2 ? 2 : r < 0.65 ? 3 : 4);

    // Avoid selecting the item telegraph tile if one is active (items are meant to be “good” targets).
    const avoid = new Set();
    if (game.itemState === "telegraph" && game.itemTargetIdx >= 0) avoid.add(game.itemTargetIdx);

    game.telegraphTargets = chooseTelegraphTargets({ wantedCount: wanted, blockedSet: blocked, avoidSet: avoid });
  }

  if (game.waveState === "telegraph") {
    game.telegraphT += dt;
    if (game.telegraphT >= telegraphDur) {
      // Mostly static-ish arcade obstacles; occasional moving sweeper.
      const movingChance = game.difficulty === 0 ? 0.06 : game.difficulty === 1 ? 0.12 : 0.18;
      const doSweeper = Math.random() < movingChance && hazards.filter((h) => h.mode === "sweeper").length === 0;

      if (doSweeper) {
        // Pick row 0 or 1, telegraph already did (usually 1-2 squares) so this is a “surprise” moving hazard.
        spawnSweeperRow(Math.random() < 0.5 ? 0 : 1);
      } else {
        for (const idx of game.telegraphTargets) {
          const rr = Math.random();
          // Distribution: mostly persistent, some immediate impacts.
          if (rr < 0.62) spawnCrashToStatic(idx);
          else if (rr < 0.82) spawnStaticBlocker(idx);
          else spawnHazard(idx, "impact");
        }
      }
      game.telegraphTargets = [];
      game.waveState = "idle";
      game.telegraphT = 0;
    }
  }

  // Special item scheduling (independent of hazard waves)
  game.itemT += dt;
  const itemInterval = game.difficulty === 0 ? 7.0 : game.difficulty === 1 ? 6.0 : 5.0;
  const itemTelegraphDur = 1.05;
  if (game.itemState === "idle" && game.itemT >= itemInterval) {
    game.itemT = 0;
    game.itemState = "telegraph";
    game.itemTelegraphT = 0;
    // Prefer a square that is NOT currently hazard-telegraphed.
    const pool = Array.from({ length: TILE_COUNT }, (_, i) => i).filter((i) => !game.telegraphTargets.includes(i));
    game.itemTargetIdx = pool.length ? pool[Math.floor(Math.random() * pool.length)] : Math.floor(Math.random() * TILE_COUNT);
    const r = Math.random();
    game.itemType = r < 0.55 ? "heal" : r < 0.82 ? "shield" : "boost";
  }
  if (game.itemState === "telegraph") {
    game.itemTelegraphT += dt;
    if (game.itemTelegraphT >= itemTelegraphDur) {
      spawnItem(game.itemTargetIdx, game.itemType);
      game.itemState = "idle";
      game.itemTelegraphT = 0;
      game.itemTargetIdx = -1;
    }
  }

  // Update hazards (falling / static / sweeper)
  for (let i = hazards.length - 1; i >= 0; i--) {
    const h = hazards[i];
    h.hitT = Math.max(0, (h.hitT || 0) - dt);

    if (h.mode === "sweeper") {
      h.mesh.position.x += h.vx * dt;
      h.ttl -= dt;
      // Determine which square(s) are currently occupied.
      const sq = getSquareInfo(h.mesh.position.x, h.mesh.position.z);
      if (playerSquare.inBounds && sq.inBounds && playerSquare.idx === sq.idx && h.hitT <= 0) {
        damage(1);
        h.hitT = 0.55;
      }
      if (h.mesh.position.x > HALF_PLATFORM + 0.45 || h.ttl <= 0) {
        hazardGroup.remove(h.mesh);
        hazards.splice(i, 1);
      }
      continue;
    }

    // Falling styles
    if (h.mode === "impact" || h.mode === "crashStatic") {
      h.mesh.position.y -= h.vy * dt;
      h.mesh.rotation.y += h.spin * dt;
      if (h.mesh.position.y <= 0.18) {
        spawnPuff(h.mesh.position.x, h.mesh.position.z);
        if (playerSquare.inBounds && playerSquare.idx === h.targetIdx) damage(1);

        if (h.mode === "crashStatic") {
          // Become a temporary static blocker *only if* it still leaves a connected safe pair.
          const blockedNow = getBlockedTiles();
          blockedNow.add(h.targetIdx);
          const safe = new Set();
          for (let idx = 0; idx < TILE_COUNT; idx++) {
            if (!blockedNow.has(idx)) safe.add(idx);
          }
          if (safe.size >= 2 && hasAdjacentSafePair(safe)) {
            h.mode = "static";
            h.ttl = 4.0 + Math.random() * 2.0;
            h.mesh.position.y = 0.22;
            // Slight scale squash for “crash” feel.
            h.mesh.scale.multiplyScalar(1.15);
          } else {
            // Shatter instead of becoming a blocker (prevents impossible boards).
            hazardGroup.remove(h.mesh);
            hazards.splice(i, 1);
          }
        } else {
          hazardGroup.remove(h.mesh);
          hazards.splice(i, 1);
        }
      }
      continue;
    }

    // Static blockers
    if (h.mode === "static") {
      h.ttl -= dt;
      // Arcade idle wobble
      h.mesh.rotation.y += dt * 0.35;
      // If the player stands on it, take periodic damage.
      if (playerSquare.inBounds && playerSquare.idx === h.targetIdx && h.hitT <= 0) {
        damage(1);
        h.hitT = 0.7;
      }
      if (h.ttl <= 0) {
        hazardGroup.remove(h.mesh);
        hazards.splice(i, 1);
      }
    }
  }

  // Update falling items
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.mesh.position.y -= it.vy * dt;
    it.mesh.rotation.y += dt * 2.2;
    if (it.mesh.position.y <= 0.22) {
      spawnPuff(it.mesh.position.x, it.mesh.position.z);
      if (playerSquare.inBounds && playerSquare.idx === it.targetIdx) {
        if (it.itemType === "heal") {
          game.health = Math.min(game.maxHealth, game.health + 1);
          game.noticeT = 0.9;
          game.noticeText = "HEAL +1";
        } else if (it.itemType === "shield") {
          game.shieldT = 8.0;
          game.noticeT = 0.9;
          game.noticeText = "SHIELD!";
        } else if (it.itemType === "boost") {
          game.boostT = 3.5;
          game.noticeT = 0.9;
          game.noticeText = "BOOST!";
        }
      }
      hazardGroup.remove(it.mesh);
      items.splice(i, 1);
    }
  }

  // Update impact FX
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    const s = 1 + f.t * 3.2;
    f.mesh.scale.setScalar(s);
    f.mesh.material.opacity = Math.max(0, 0.55 * (1 - f.t / 0.35));
    if (f.t >= 0.35) {
      hazardGroup.remove(f.mesh);
      fx.splice(i, 1);
    }
  }

  // Off-platform penalty (encourages staying in the 2m x 2m zone)
  if (!playerSquare.inBounds) {
    game.offPlatformT += dt;
    if (game.offPlatformT >= 1.25) {
      game.offPlatformT = 0;
      damage(1);
    }
  } else {
    game.offPlatformT = 0;
  }
}

// ---------- Sled motion ----------
const sled = {
  x: 0,
  z: 2600,
  y: 0,
  speed: 0, // forward speed (downhill is -z)
};

function terrainSlopeForward(x, z) {
  const d = 0.75;
  const h0 = heightAt(x, z);
  const h1 = heightAt(x, z - d); // forward (downhill direction)
  return (h1 - h0) / d; // negative = going downhill
}

function updateSled(dt) {
  // VR-only: sled auto-descends; roomscale movement is used for dodging on-platform.
  const slope = terrainSlopeForward(sled.x, sled.z); // negative downhill
  const gravityAccel = THREE.MathUtils.clamp(-slope * 34, 0, 20); // 0..20

  const boost = game.boostT > 0 ? 10.5 : 0;
  sled.speed += (gravityAccel + boost) * dt;
  sled.speed *= Math.pow(0.988, dt * 60);
  sled.speed = THREE.MathUtils.clamp(sled.speed, 0, 58);

  // Move straight downhill (-z). Keep centered; terrain itself provides the spectacle.
  sled.z -= sled.speed * dt;

  // Keep within terrain bounds; softly push back
  const half = world.terrainSize * 0.5 - 30;
  sled.x = THREE.MathUtils.clamp(sled.x, -half, half);
  sled.z = THREE.MathUtils.clamp(sled.z, -half, half);

  // Height from terrain
  const ground = heightAt(sled.x, sled.z);
  sled.y = ground + 0.15; // sled platform rides slightly above snow

  // Reset if we reach the end
  if (sled.z < -2600) {
    sled.x = 0;
    sled.z = 2600;
    sled.speed = 0;
  }
}

function updateCamera(dt) {
  rig.position.set(sled.x, sled.y, sled.z);
  // Keep sled facing downhill; headset drives view.
  rig.rotation.y = 0;

  // Snow field follows the rider
  snow.position.set(rig.position.x, rig.position.y, rig.position.z);
  snow.rotation.y += dt * 0.1;
}

function updateSnow(dt) {
  const pos = snow.geometry.attributes.position;
  const speeds = snow.geometry.attributes.aSpeed;
  const spread = snow.userData.spread;
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i);
    y -= speeds.getX(i) * dt;
    if (y < 0) {
      y = 60 + Math.random() * 140;
      pos.setX(i, (Math.random() - 0.5) * spread);
      pos.setZ(i, (Math.random() - 0.5) * spread);
    }
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
}

function updatePlatformVisuals(playerLocal, playerSquare) {
  // Marker follows player (clamped) so you can see what square you're in.
  const clamped = clampToPlatformXZ(playerLocal);
  playerMarker.position.x = clamped.x;
  playerMarker.position.z = clamped.z;

  // Clear overlays
  for (let i = 0; i < squareOverlays.length; i++) {
    squareOverlays[i].material.opacity = 0.0;
    squareOverlays[i].material.color.setHex(0x2aa7ff);
  }

  // Persistent blockers (static/crashStatic) should read as "occupied" like an arcade board.
  for (const h of hazards) {
    if ((h.mode === "static" || h.mode === "crashStatic") && h.targetIdx >= 0) {
      const o = squareOverlays[h.targetIdx];
      o.material.color.setHex(0xff3b2e);
      o.material.opacity = Math.max(o.material.opacity, 0.09);
    }
  }

  // Telegraph targeted squares
  if (game.waveState === "telegraph" && game.telegraphTargets.length) {
    const pulse = 0.16 + 0.08 * Math.sin(game.telegraphT * 18);
    for (const idx of game.telegraphTargets) {
      squareOverlays[idx].material.color.setHex(0xff3b2e);
      squareOverlays[idx].material.opacity = pulse;
    }
  }

  // Telegraph special item square (green)
  if (game.itemState === "telegraph" && game.itemTargetIdx >= 0) {
    const pulse = 0.13 + 0.07 * Math.sin(game.itemTelegraphT * 16);
    const idx = game.itemTargetIdx;
    const isHazardAlso = game.telegraphTargets.includes(idx);
    squareOverlays[idx].material.color.setHex(isHazardAlso ? 0xffd166 : 0x2de27a);
    squareOverlays[idx].material.opacity = Math.max(squareOverlays[idx].material.opacity, pulse);
  }

  // Player square highlight
  if (playerSquare.inBounds) {
    const overlay = squareOverlays[playerSquare.idx];
    // If it's already targeted, shift to yellow-ish.
    const isTargeted = game.telegraphTargets.includes(playerSquare.idx);
    overlay.material.color.setHex(isTargeted ? 0xffd166 : 0x2aa7ff);
    overlay.material.opacity = Math.max(overlay.material.opacity, 0.12);
  } else {
    // If off platform, softly warn by tinting all squares.
    for (let i = 0; i < squareOverlays.length; i++) {
      squareOverlays[i].material.color.setHex(0xa3b7c9);
      squareOverlays[i].material.opacity = 0.06;
    }
  }
}

// ---------- Resize ----------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Animation loop ----------
let lastT = performance.now();

function syncDomHud() {
  if (healthEl) healthEl.textContent = String(game.health);
  if (difficultyEl) difficultyEl.textContent = difficultyName(game.difficulty);
  if (distanceEl) distanceEl.textContent = String(Math.floor(game.distance));
}

renderer.xr.addEventListener("sessionstart", () => {
  game.started = true;
  resetRun();
  loadingEl.classList.add("hidden");
  drawHudPanel({
    health: game.health,
    difficultyName: difficultyName(game.difficulty),
    distance: game.distance,
    speed: sled.speed,
    message:
      "Clear a 2mx2m space, stand in the centre and recenter yourself with your controller.\nBe mindful of your surroundings.\nLet's go!",
  });
  syncDomHud();
});

renderer.xr.addEventListener("sessionend", () => {
  game.started = false;
  game.phase = "idle";
  loadingEl.textContent = "Enter VR to start";
  loadingEl.classList.remove("hidden");
  syncDomHud();
});

renderer.setAnimationLoop(() => {
  const t = performance.now();
  const dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;

  if (!renderer.xr.isPresenting) {
    // Desktop preview only (not playable).
    sled.x = 0;
    sled.z = 2600;
    sled.y = heightAt(0, sled.z) + 0.15;
    rig.position.set(sled.x, sled.y, sled.z);
    rig.rotation.y = 0;
    updateSnow(dt);
    renderer.render(scene, camera);
    return;
  }

  // VR gameplay
  if (game.phase === "running") {
    updateSled(dt);
  } else {
    // Hold at the top while the player reads safety + recenters.
    sled.x = 0;
    sled.z = 2600;
    sled.speed = 0;
    sled.y = heightAt(0, sled.z) + 0.15;
  }
  updateCamera(dt);
  updateSnow(dt);

  // Distance and player location on platform
  if (game.phase === "running") game.distance += sled.speed * dt;
  const headLocal = getHeadLocalToSledSpace(new THREE.Vector3());
  const playerSquare = getSquareInfo(headLocal.x, headLocal.z);
  updatePlatformVisuals(headLocal, playerSquare);
  updateHazards(dt, playerSquare);

  // HUD updates (DOM is not visible in VR, but keep it in sync for mirroring)
  game.hitFlashT = Math.max(0, game.hitFlashT - dt);
  game.noticeT = Math.max(0, game.noticeT - dt);
  if (game.shieldT > 0) game.shieldT = Math.max(0, game.shieldT - dt);
  if (game.boostT > 0) game.boostT = Math.max(0, game.boostT - dt);

  const msg =
    game.phase !== "running"
      ? "Clear a 2mx2m space, stand in the centre and recenter yourself with your controller.\nBe mindful of your surroundings.\nLet's go!"
      : game.noticeT > 0
        ? game.noticeText
        : game.hitFlashT > 0
          ? "HIT!"
          : game.itemState === "telegraph"
            ? "Green = special item. Red = obstacle."
            : playerSquare.inBounds
              ? ""
              : "Stay on the platform!";
  drawHudPanel({ health: game.health, difficultyName: difficultyName(game.difficulty), distance: game.distance, speed: sled.speed, message: msg });
  syncDomHud();

  renderer.render(scene, camera);
});


