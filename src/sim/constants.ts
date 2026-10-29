// All tuning values in one place — this is where the game feel lives.

/** Bump on any incompatible change to messages or snapshots! */
export const PROTOCOL_VERSION = 3;

export const WORLD_W = 1600;
export const WORLD_H = 900;
export const WALL_MARGIN = 20;

export const TICK_RATE = 60; // simulation steps per second (host only)
export const SNAPSHOT_EVERY = 2; // every 2nd tick => 30 snapshots/s

// Ships
export const SHIP_RADIUS = 14;
export const SHIP_ACCEL = 900;
export const SHIP_MAX_SPEED = 520;
export const SHIP_DRAG = 0.8; // per second (exponential)
export const ANCHOR_DRAG = 7;
export const ANCHOR_ACCEL_FACTOR = 0.2;
export const ANCHOR_INV_MASS = 0.15; // anchored = heavy
export const SHIP_INVULN_TIME = 1.2;
export const SHIP_KNOCKBACK = 380;

// Tether
export const ROPE_LENGTH = 320; // the tether goes taut beyond this
export const ROPE_STIFFNESS = 14;
export const ROPE_DAMPING = 4;
export const ROPE_SNAP_STRETCH = 58; // overstretch at which the tether snaps
export const ROPE_RELINK_DIST = 200; // fly this close to reconnect
export const ROPE_CUT_SPEED = 140; // min. sideways tether speed needed to slice

// Asteroids
export const AST_SPLIT_MIN_R = 34; // smaller => destroyed instead of split
export const AST_CHILD_SCALE = 0.62;
export const AST_GRACE_TIME = 0.35; // freshly split chunks are briefly unsliceable

// Team
export const HULL_MAX = 100;
export const HULL_REGEN_PER_WAVE = 15;
export const COMBO_WINDOW = 1.6;
export const COMBO_MAX = 8;
export const INTERMISSION_TIME = 2.5;

// Planets & slingshot
export const PLANET_SURFACE_G = 620; // surface gravity of an r=70 planet
export const GRAVITY_RANGE = 5.5; // reach, in planet radii
export const ASTEROID_GRAVITY_FACTOR = 0.45;
export const PLANET_FADE_TIME = 1.4;
export const PLANET_CRASH_SPEED = 220; // impacts faster than this cost hull
export const PLANET_CRASH_DAMAGE = 6;
export const SLING_ZONE = 2.3; // within r * SLING_ZONE ...
export const SLING_MIN_SPEED = 430; // ... and faster than this => slingshot!
export const SLING_TIME = 1.8; // boost duration
export const SLING_SPEED_FACTOR = 1.5; // higher top speed while boosted
export const SLING_SCORE_FACTOR = 2; // score multiplier for slices while boosted

/** Planets per wave: [x, y, radius, kind]. The list repeats. */
export const PLANET_LAYOUTS: [number, number, number, number][][] = [
  [[1180, 300, 70, 0]],
  [[420, 640, 58, 1], [1220, 260, 48, 3]],
  [[800, 450, 85, 2]],
  [[300, 250, 42, 3], [1300, 650, 52, 1], [820, 160, 34, 2]],
  [[560, 330, 64, 0], [1110, 600, 64, 1]],
];

// Enemies (shared)
export const ENEMY_CUT_SPEED = 110; // enemies are softer than asteroids

// Drones: keep their distance, dodge the tether, shoot
export const DRONE_RADIUS = 18;
export const DRONE_ACCEL = 520;
export const DRONE_MAX_SPEED = 250;
export const DRONE_PREFERRED_DIST = 280; // distance they try to keep from the nearest ship
export const DRONE_DODGE_RANGE = 85; // they react when the tether gets this close
export const DRONE_DODGE_ACCEL = 620;
export const DRONE_FIRE_INTERVAL: [number, number] = [2.4, 3.6];
export const DRONE_TELEGRAPH = 0.55; // glow before firing, so you can react
export const DRONE_POINTS = 40;
export const BULLET_SPEED = 330;
export const BULLET_RADIUS = 6;
export const BULLET_DAMAGE = 6;
export const BULLET_LIFETIME = 4;

// Space jellyfish: drift towards you in pulses, split when sliced, sting
export const JELLY_RADIUS_BIG = 32;
export const JELLY_RADIUS_SMALL = 19;
export const JELLY_PULSE_INTERVAL = 1.3;
export const JELLY_PULSE_IMPULSE = 110;
export const JELLY_DRAG = 0.9;
export const JELLY_SPLIT_COUNT = 3;
export const JELLY_STING_DAMAGE = 7;
export const JELLY_POINTS_BIG = 20;
export const JELLY_POINTS_SMALL = 30;

// Boss: the space whale ("Leviathan"), every BOSS_EVERY waves
export const BOSS_EVERY = 5;
export const BOSS_RADIUS = 92;
export const BOSS_BASE_HP = 160;
export const BOSS_HP_PER_LEVEL = 60; // extra HP per boss encounter
export const BOSS_CRUISE_SPEED = 90;
export const BOSS_CHARGE_SPEED = 620;
export const BOSS_CHARGE_TIME = 1.1;
export const BOSS_WINDUP_TIME = 1.0;
export const BOSS_CHARGE_INTERVAL: [number, number] = [5, 7.5];
export const BOSS_SPAWN_INTERVAL = 7; // spits out small asteroids
export const BOSS_SQUEEZE_DPS = 6; // damage/s while the taut tether presses into it
export const BOSS_WRAP_DAMAGE = 0.16; // fraction of max HP per full wrap
export const BOSS_STUN_TIME = 2.6; // stunned after a wrap: takes double damage
export const BOSS_CONTACT_DAMAGE = 10;
export const BOSS_CHARGE_DAMAGE = 16;
export const BOSS_WRAP_POINTS = 150;
export const BOSS_KILL_POINTS = 600;

// Client-side prediction
export const PREDICTION_SMOOTHING = 12; // how fast correction errors fade out (1/s)
export const PREDICTION_SNAP_DIST = 160; // teleport instead of smoothing above this error
