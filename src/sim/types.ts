// Shared data types for the simulation.

export interface PlayerInput {
  /** Movement direction, each -1..1 */
  x: number;
  y: number;
  /** Anchor: become heavy and brake hard, so your partner swings around you */
  anchor: boolean;
}

export const NO_INPUT: PlayerInput = { x: 0, y: 0, anchor: false };

export interface Ship {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  anchor: boolean;
  thrust: boolean;
  invuln: number;
  /** seconds of slingshot boost left */
  boost: number;
}

export interface Planet {
  x: number;
  y: number;
  r: number;
  /** surface gravity (px/s²) */
  g: number;
  /** visuals only: 0 gas giant + ring, 1 ice, 2 lava, 3 toxic */
  kind: number;
  /** 0..1 — planets grow in when they appear and shrink when they leave */
  grow: number;
  dying: boolean;
}

export interface Asteroid {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  spin: number;
  grace: number;
  entered: boolean;
}

export type EnemyKind = 'drone' | 'jelly';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  angle: number;
  /** drone: time until next shot; jelly: time until next pulse */
  timer: number;
  /** drone: aiming at this ship index */
  target: number;
  grace: number;
  entered: boolean;
}

export interface Bullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export type BossState = 'enter' | 'cruise' | 'windup' | 'charge' | 'stunned' | 'dying';

export interface Boss {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  maxHp: number;
  state: BossState;
  stateTimer: number;
  chargeTimer: number;
  spawnTimer: number;
  /** accumulated angle (rad) the ships have wound around the whale while squeezing */
  wrap: number;
  /** angles of both ships around the whale last tick (for the wrap counter) */
  lastAngles: [number, number];
  /** true while the taut tether presses into the whale (for visuals) */
  squeezing: boolean;
  wanderX: number;
  wanderY: number;
}

export type SimEvent =
  | { k: 'cut'; x: number; y: number; r: number; split: boolean; pts: number }
  | { k: 'hit'; x: number; y: number; ship: number }
  | { k: 'bounce'; x: number; y: number }
  | { k: 'snap'; x: number; y: number }
  | { k: 'link'; x: number; y: number }
  | { k: 'wave'; n: number; boss: boolean }
  | { k: 'sling'; x: number; y: number; ship: number }
  | { k: 'impact'; x: number; y: number; r: number }
  | { k: 'enemyKill'; x: number; y: number; kind: EnemyKind; pts: number }
  | { k: 'shoot'; x: number; y: number }
  | { k: 'block'; x: number; y: number }
  | { k: 'bossCharge'; x: number; y: number }
  | { k: 'wrap'; x: number; y: number; pts: number }
  | { k: 'bossDown'; x: number; y: number; pts: number }
  | { k: 'over' };

export type Phase = 'intermission' | 'play' | 'over';

export interface World {
  tick: number;
  ships: [Ship, Ship];
  asteroids: Asteroid[];
  planets: Planet[];
  enemies: Enemy[];
  bullets: Bullet[];
  boss: Boss | null;
  nextId: number;
  linked: boolean;
  /** 0..1, how close the tether is to snapping */
  tension: number;
  hull: number;
  score: number;
  wave: number;
  combo: number;
  comboTimer: number;
  phase: Phase;
  phaseTimer: number;
  rng: number;
  /** events of this tick (particles/sound) — collected by the caller */
  events: SimEvent[];
}
