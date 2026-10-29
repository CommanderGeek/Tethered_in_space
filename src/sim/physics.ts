// Pure physics helpers shared by the host simulation and client-side prediction.
// Keeping them in one place guarantees the client predicts exactly what the host computes.

import * as C from './constants';
import type { Planet, PlayerInput, Ship } from './types';

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function makeShip(x: number, y: number): Ship {
  return { x, y, vx: 0, vy: 0, angle: -Math.PI / 2, anchor: false, thrust: false, invuln: 0, boost: 0 };
}

/** Thrust, speed cap, drag, movement and facing for one ship. */
export function integrateShip(s: Ship, inp: PlayerInput, dt: number): void {
  let ix = inp.x;
  let iy = inp.y;
  const len = Math.hypot(ix, iy);
  if (len > 1) { ix /= len; iy /= len; }

  s.anchor = inp.anchor;
  s.thrust = len > 0.1;
  const accel = C.SHIP_ACCEL * (s.anchor ? C.ANCHOR_ACCEL_FACTOR : 1);
  s.vx += ix * accel * dt;
  s.vy += iy * accel * dt;

  // The cap only limits your own thrust — momentum from the tether may exceed it
  const sp = Math.hypot(s.vx, s.vy);
  const cap = s.boost > 0 ? C.SHIP_MAX_SPEED * C.SLING_SPEED_FACTOR : C.SHIP_MAX_SPEED;
  if (s.thrust && sp > cap) {
    const k = Math.max(cap / sp, 1 - 3 * dt);
    s.vx *= k;
    s.vy *= k;
  }

  const drag = Math.exp(-(s.anchor ? C.ANCHOR_DRAG : C.SHIP_DRAG) * dt);
  s.vx *= drag;
  s.vy *= drag;

  s.x += s.vx * dt;
  s.y += s.vy * dt;

  // Face the input direction (or the direction of travel)
  const target = s.thrust ? Math.atan2(iy, ix) : sp > 40 ? Math.atan2(s.vy, s.vx) : s.angle;
  s.angle = lerpAngle(s.angle, target, 1 - Math.exp(-12 * dt));

  if (s.invuln > 0) s.invuln -= dt;
  if (s.boost > 0) s.boost -= dt;
}

export function bounceOffWalls(o: { x: number; y: number; vx: number; vy: number }, r: number): boolean {
  const minX = C.WALL_MARGIN + r;
  const maxX = C.WORLD_W - C.WALL_MARGIN - r;
  const minY = C.WALL_MARGIN + r;
  const maxY = C.WORLD_H - C.WALL_MARGIN - r;
  let hit = false;
  if (o.x < minX) { o.x = minX; o.vx = Math.abs(o.vx) * 0.6; hit = true; }
  if (o.x > maxX) { o.x = maxX; o.vx = -Math.abs(o.vx) * 0.6; hit = true; }
  if (o.y < minY) { o.y = minY; o.vy = Math.abs(o.vy) * 0.6; hit = true; }
  if (o.y > maxY) { o.y = maxY; o.vy = -Math.abs(o.vy) * 0.6; hit = true; }
  return hit;
}

/** Effective radius (including the grow-in animation) */
export function planetRadius(p: { r: number; grow: number }): number {
  const t = Math.max(0, Math.min(1, p.grow));
  return p.r * (1 - (1 - t) ** 3);
}

/** Acceleration from all planets at point (x, y) */
export function gravityAt(planets: readonly Planet[], x: number, y: number): [number, number] {
  let ax = 0;
  let ay = 0;
  for (const p of planets) {
    const R = planetRadius(p);
    if (R < 1) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    const d = Math.max(Math.hypot(dx, dy), R);
    // g * (R/d)^2, faded out smoothly towards GRAVITY_RANGE * R
    const fade = Math.max(0, 1 - d / (R * C.GRAVITY_RANGE));
    const a = p.g * Math.min(1, p.grow) * (R / d) ** 2 * Math.min(1, fade * 3);
    ax += (dx / d) * a;
    ay += (dy / d) * a;
  }
  return [ax, ay];
}

/**
 * Spring force of the taut tether. Returns the overstretch (<= 0 means slack).
 * With `onlyA`, the force is applied to ship a only (used by client prediction,
 * where the partner is authoritative on the host).
 */
export function applyRopeForce(a: Ship, b: Ship, dt: number, onlyA = false): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 0.0001;
  const stretch = d - C.ROPE_LENGTH;
  if (stretch <= 0 || stretch > C.ROPE_SNAP_STRETCH) return stretch;

  const nx = dx / d;
  const ny = dy / d;
  const wa = a.anchor ? C.ANCHOR_INV_MASS : 1;
  const wb = b.anchor ? C.ANCHOR_INV_MASS : 1;
  const relV = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  // spring + damping (only damp while pulling apart)
  const f = (C.ROPE_STIFFNESS * stretch + C.ROPE_DAMPING * Math.max(0, relV)) * dt;
  // normalised so the weights sum to 2
  const norm = 2 / (wa + wb);
  a.vx += nx * f * wa * norm;
  a.vy += ny * f * wa * norm;
  if (!onlyA) {
    b.vx -= nx * f * wb * norm;
    b.vy -= ny * f * wb * norm;
  }
  return stretch;
}

/**
 * Pushes a ship out of planets and bounces it off.
 * Returns the hardest impact (speed + contact point) or null.
 */
export function collideShipWithPlanets(s: Ship, planets: readonly Planet[]): { speed: number; x: number; y: number } | null {
  let worst: { speed: number; x: number; y: number } | null = null;
  for (const p of planets) {
    const R = planetRadius(p);
    if (R < 2) continue;
    const dx = s.x - p.x;
    const dy = s.y - p.y;
    const d = Math.hypot(dx, dy) || 0.0001;
    const min = R + C.SHIP_RADIUS;
    if (d >= min) continue;
    const nx = dx / d;
    const ny = dy / d;
    s.x = p.x + nx * min;
    s.y = p.y + ny * min;
    const vn = s.vx * nx + s.vy * ny;
    if (vn < 0) {
      s.vx -= nx * vn * 1.5;
      s.vy -= ny * vn * 1.5;
      if (!worst || -vn > worst.speed) worst = { speed: -vn, x: s.x - nx * C.SHIP_RADIUS, y: s.y - ny * C.SHIP_RADIUS };
    }
  }
  return worst;
}

/** Closest point on segment a-b to point p: returns t in 0..1, the point and its distance. */
export function closestOnSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  const sx = bx - ax;
  const sy = by - ay;
  const len2 = sx * sx + sy * sy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * sx + (py - ay) * sy) / len2));
  const cx = ax + sx * t;
  const cy = ay + sy * t;
  return { t, x: cx, y: cy, dist: Math.hypot(px - cx, py - cy) };
}
