/**
 * Central tuning for DOWN.
 * The descent: 3 dodge rounds at 150m / 75m / 0m, connected by 20° slides,
 * then a final 150m victory drop to the finish zone at -150m.
 */
export const PHASE_HEIGHTS = [150, 75, 0];
export const WINNER_HEIGHT = -150;
export const TOTAL_ROUNDS = 3;

/** `?turbo` shortens rounds — handy when testing slides and the win flow. */
const TURBO =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('turbo');

export const GRID_DURATION = TURBO ? 6 : 30; // seconds of dodging per round
export const SLIDE_ANGLE = 32 * (Math.PI / 180); // steeper than the original 20° — it has to LOOK like a drop
export const SLIDE_SPEED = 20; // m/s along the slide
export const SLIDE_ACCEL_TIME = 1.2; // ease-in seconds for comfort

/** Platform: 1.5m x 1.5m pad split into 2x2 dodge quadrants. */
export const GRID_SIZE = 1.5;
export const KILL_ZONE = GRID_SIZE + 0.4; // leave this square and you're gone

/** Rising projectiles, tuned per round (index 0 = round 1). */
export const SPAWN_INTERVAL = [1.5, 1.2, 0.95]; // seconds between waves
export const PROJECTILE_SPEED = [14, 16, 18]; // m/s upwards
export const PROJECTILE_SPAWN_Y = -60;
export const PROJECTILE_DESPAWN_Y = 3;

/** Slide barriers: lane offsets across the 3-lane track. */
export const LANE_X = [-0.4, 0, 0.4];
export const BARRIER_SIZE = { w: 0.25, h: 2.4, d: 0.15 };
export const BARRIER_SPACING = [20, 15, 15]; // per slide (1st, 2nd, final) — tighter to match the shorter, steeper runs

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
