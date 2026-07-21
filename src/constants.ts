/**
 * Central tuning for DOWN.
 * The descent: 3 dodge rounds at 300m / 170m / 40m, connected by long 32°
 * slides (130m drops, ~12s each), then a final 220m victory drop (~21s)
 * to the finish zone at -180m.
 */
export const PHASE_HEIGHTS = [300, 170, 40];
export const WINNER_HEIGHT = -180;
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

/** Each dodge section is a gentle ascent before its much larger drop. */
export const GRID_CLIMB_HEIGHT = 12;

/**
 * "Run" rides a strict 5s bar loop starting at 1.5s, with section crashes
 * at 61.5 / 121.5 / 181.5 (measured by FFT band analysis). Slides launch
 * on the bar grid at 31.5 / 76.5 / 121.5 — ~30s dodge rounds, ~12s slides
 * between them, and the final drop launches on the song's biggest crash
 * (the 121.5s section change) riding its most intense stretch down.
 */
export const MUSIC_DROPS = [31.5, 76.5, 121.5];
export const SLIDE_ANGLE = 32 * (Math.PI / 180); // steeper than the original 20° — it has to LOOK like a drop
export const SLIDE_SPEED = 20; // m/s along the slide
export const SLIDE_ACCEL_TIME = 1.2; // ease-in seconds for comfort

/** Platform: 1.5m x 1.5m pad split into 2x2 dodge quadrants. */
export const GRID_SIZE = 1.5;
export const KILL_ZONE = GRID_SIZE + 0.4; // leave this square and you're gone

/** Rising projectiles, tuned per round (index 0 = round 1). */
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
