/**
 * Central tuning for DOWN.
 * The descent: 3 dodge rounds at 220m / 120m / 20m, connected by long 32°
 * slides, then a final ~190m victory drop to the finish zone at -170m.
 * Platforms are spread far apart vertically so each slide runs a good while.
 */
export const PHASE_HEIGHTS = [220, 120, 20];
export const WINNER_HEIGHT = -170;
export const TOTAL_ROUNDS = 3;

/** Total vertical descent, start pad to finish zone (drives the win stat). */
export const TOTAL_DESCENT = PHASE_HEIGHTS[0] - WINNER_HEIGHT;

/** `?turbo` shortens rounds — handy when testing slides and the win flow. */
const TURBO =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('turbo');

export const IS_TURBO = TURBO;

/** Fallback round length when the music clock isn't available. */
export const GRID_DURATION = TURBO ? 6 : 30;

/**
 * "Run" is built on a strict 60s section grid (measured by FFT band
 * analysis): crashes land at 61.5 / 121.5 / 181.5s and the outro begins
 * ~200s. Each slide launches exactly on a section change — and the final
 * drop (~19s) rides the climax straight into the outro as you land.
 */
export const MUSIC_DROPS = [61.5, 121.5, 181.5];
export const SLIDE_ANGLE = 32 * (Math.PI / 180); // steeper than the original 20° — it has to LOOK like a drop
export const SLIDE_SPEED = 20; // m/s along the slide
export const SLIDE_ACCEL_TIME = 1.2; // ease-in seconds for comfort

/** Platform: 1.5m x 1.5m pad split into 2x2 dodge quadrants. */
export const GRID_SIZE = 1.5;
export const KILL_ZONE = GRID_SIZE + 0.4; // leave this square and you're gone

/** Rising projectiles, tuned per round (index 0 = round 1). Rounds run to
 * the song's section boundaries (~61/47/47s), so waves come a bit faster. */
export const SPAWN_INTERVAL = [1.3, 1.05, 0.85]; // seconds between waves
export const PROJECTILE_SPEED = [14, 16, 18]; // m/s upwards
export const PROJECTILE_SPAWN_Y = -60;
export const PROJECTILE_DESPAWN_Y = 3;

/**
 * Slide barriers ("pegs"): lane offsets across the 3-lane track. Lanes are
 * spread to ±0.5m so the wider slabs still leave a clear gap to dodge into.
 */
export const LANE_X = [-0.5, 0, 0.5];
export const BARRIER_SIZE = { w: 0.42, h: 2.6, d: 0.22 }; // wider, chunkier walls
export const BARRIER_SPACING = [16, 12, 12]; // per slide (1st, 2nd, final) — dense

export const HEAD_RADIUS = 0.12;

export const NEON = {
  cyan: 0x29f3ff,
  magenta: 0xff3df2,
  purple: 0x8a2bff,
  lime: 0x54ff7a,
  amber: 0xffb347,
  red: 0xff2244,
  yellow: 0xfff35c
};

export const OBSTACLE_COLORS = [NEON.cyan, NEON.magenta, NEON.lime, NEON.yellow];
export const BARRIER_COLORS = [NEON.red, NEON.magenta, NEON.amber, NEON.yellow];
