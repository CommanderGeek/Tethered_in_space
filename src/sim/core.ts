// Small helpers used by several simulation modules.

import * as C from './constants';
import { closestOnSegment } from './physics';
import type { Asteroid, World } from './types';

/** mulberry32 — small, deterministic random numbers (state lives in the world) */
export function rand(w: World): number {
  let t = (w.rng = (w.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const range = (w: World, a: number, b: number) => a + rand(w) * (b - a);

/** Adds points with combo + slingshot multipliers, bumps the combo. Returns the points awarded. */
export function addScore(w: World, base: number): number {
  const boosted = w.ships[0].boost > 0 || w.ships[1].boost > 0;
  const pts = Math.round(base * w.combo * (boosted ? C.SLING_SCORE_FACTOR : 1));
  w.score += pts;
  w.combo = Math.min(C.COMBO_MAX, w.combo + 1);
  w.comboTimer = C.COMBO_WINDOW;
  return pts;
}

/** Damages the shared hull, makes the ship briefly invulnerable, resets the combo. */
export function damageHull(w: World, ship: number, amount: number, x: number, y: number): void {
  const s = w.ships[ship];
  s.invuln = C.SHIP_INVULN_TIME;
  w.hull -= amount;
  w.combo = 1;
  w.events.push({ k: 'hit', x, y, ship });
}

export interface TetherContact {
  /** position along the tether, 0..1 */
  t: number;
  /** closest point on the tether */
  px: number;
  py: number;
  dist: number;
  /** tether normal */
  nx: number;
  ny: number;
  /** how fast the tether sweeps sideways relative to the object */
  crossSpeed: number;
  /** which side the tether sweeps towards (+1 / -1 along the normal) */
  sweep: number;
  /** tether velocity relative to the object at the contact point */
  vpx: number;
  vpy: number;
}

/**
 * Checks whether a circular object touches the middle part of the tether.
 * The ends belong to the ships and are handled by ship collisions.
 */
export function tetherContact(w: World, x: number, y: number, r: number, vx: number, vy: number): TetherContact | null {
  const [a, b] = w.ships;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const len = Math.hypot(sx, sy);
  if (len < 1) return null;
  const c = closestOnSegment(a.x, a.y, b.x, b.y, x, y);
  if (c.dist > r + 3 || c.t <= 0.02 || c.t >= 0.98) return null;
  const nx = -sy / len;
  const ny = sx / len;
  const vpx = a.vx + (b.vx - a.vx) * c.t - vx;
  const vpy = a.vy + (b.vy - a.vy) * c.t - vy;
  const across = vpx * nx + vpy * ny;
  return { t: c.t, px: c.x, py: c.y, dist: c.dist, nx, ny, crossSpeed: Math.abs(across), sweep: across >= 0 ? 1 : -1, vpx, vpy };
}

export function spawnAsteroid(w: World, x: number, y: number, vx: number, vy: number, r: number, entered: boolean): Asteroid {
  const a: Asteroid = {
    id: w.nextId++,
    x, y, vx, vy, r,
    rot: rand(w) * Math.PI * 2,
    spin: range(w, -1.2, 1.2),
    grace: entered ? C.AST_GRACE_TIME : 0,
    entered,
  };
  w.asteroids.push(a);
  return a;
}
