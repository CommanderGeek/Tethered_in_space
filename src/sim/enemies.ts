// Enemy behaviour: drones and space jellyfish, plus drone bullets.

import * as C from './constants';
import { bounceOffWalls, closestOnSegment } from './physics';
import type { Enemy, EnemyKind, World } from './types';
import { addScore, damageHull, rand, range, tetherContact } from './core';

export function spawnEnemy(w: World, kind: EnemyKind, x: number, y: number, vx = 0, vy = 0, r?: number, entered = false): Enemy {
  const e: Enemy = {
    id: w.nextId++,
    kind,
    x, y, vx, vy,
    r: r ?? (kind === 'drone' ? C.DRONE_RADIUS : C.JELLY_RADIUS_BIG),
    angle: 0,
    timer: kind === 'drone' ? range(w, ...C.DRONE_FIRE_INTERVAL) : rand(w) * C.JELLY_PULSE_INTERVAL,
    target: rand(w) < 0.5 ? 0 : 1,
    grace: entered ? C.AST_GRACE_TIME : 0,
    entered,
  };
  w.enemies.push(e);
  return e;
}

/** Spawn position just outside a random edge */
export function edgeSpawn(w: World, pad: number): [number, number] {
  const side = Math.floor(rand(w) * 4);
  if (side === 0) return [range(w, 100, C.WORLD_W - 100), -pad];
  if (side === 1) return [C.WORLD_W + pad, range(w, 100, C.WORLD_H - 100)];
  if (side === 2) return [range(w, 100, C.WORLD_W - 100), C.WORLD_H + pad];
  return [-pad, range(w, 100, C.WORLD_H - 100)];
}

function nearestShip(w: World, x: number, y: number): number {
  const [a, b] = w.ships;
  return Math.hypot(a.x - x, a.y - y) <= Math.hypot(b.x - x, b.y - y) ? 0 : 1;
}

export function updateEnemies(w: World, dt: number): void {
  for (const e of w.enemies) {
    if (e.grace > 0) e.grace -= dt;
    if (e.kind === 'drone') updateDrone(w, e, dt);
    else updateJelly(w, e, dt);

    e.x += e.vx * dt;
    e.y += e.vy * dt;

    if (!e.entered) {
      const inside = e.x > C.WALL_MARGIN + e.r && e.x < C.WORLD_W - C.WALL_MARGIN - e.r &&
        e.y > C.WALL_MARGIN + e.r && e.y < C.WORLD_H - C.WALL_MARGIN - e.r;
      if (inside) e.entered = true;
    } else {
      bounceOffWalls(e, e.r);
    }
  }
  updateBullets(w, dt);
}

function updateDrone(w: World, e: Enemy, dt: number): void {
  const ship = w.ships[nearestShip(w, e.x, e.y)];
  const dx = ship.x - e.x;
  const dy = ship.y - e.y;
  const d = Math.hypot(dx, dy) || 1;

  // Keep the preferred distance and strafe sideways
  const radial = (d - C.DRONE_PREFERRED_DIST) / C.DRONE_PREFERRED_DIST;
  const strafe = Math.sin(w.tick * 0.02 + e.id) > 0 ? 1 : -1;
  let ax = (dx / d) * radial * C.DRONE_ACCEL + (-dy / d) * strafe * C.DRONE_ACCEL * 0.5;
  let ay = (dy / d) * radial * C.DRONE_ACCEL + (dx / d) * strafe * C.DRONE_ACCEL * 0.5;
  if (!e.entered) {
    // fly straight in first
    ax = (C.WORLD_W / 2 - e.x) * 2;
    ay = (C.WORLD_H / 2 - e.y) * 2;
  }

  // Dodge the tether
  if (w.linked && e.entered) {
    const [a, b] = w.ships;
    const c = closestOnSegment(a.x, a.y, b.x, b.y, e.x, e.y);
    if (c.dist < C.DRONE_DODGE_RANGE && c.t > 0.05 && c.t < 0.95) {
      const nx = (e.x - c.x) / (c.dist || 1);
      const ny = (e.y - c.y) / (c.dist || 1);
      ax += nx * C.DRONE_DODGE_ACCEL * 2;
      ay += ny * C.DRONE_DODGE_ACCEL * 2;
    }
  }

  e.vx += ax * dt;
  e.vy += ay * dt;
  const sp = Math.hypot(e.vx, e.vy);
  if (sp > C.DRONE_MAX_SPEED) {
    e.vx *= C.DRONE_MAX_SPEED / sp;
    e.vy *= C.DRONE_MAX_SPEED / sp;
  }
  e.vx *= Math.exp(-1.2 * dt);
  e.vy *= Math.exp(-1.2 * dt);

  // Aim at its target ship and fire
  const tgt = w.ships[e.target];
  e.angle = Math.atan2(tgt.y - e.y, tgt.x - e.x);
  if (e.entered && w.phase === 'play') {
    e.timer -= dt;
    if (e.timer <= 0) {
      e.timer = range(w, ...C.DRONE_FIRE_INTERVAL);
      // lead the target slightly
      const lead = Math.hypot(tgt.x - e.x, tgt.y - e.y) / C.BULLET_SPEED * 0.5;
      const ang = Math.atan2(tgt.y + tgt.vy * lead - e.y, tgt.x + tgt.vx * lead - e.x);
      w.bullets.push({
        id: w.nextId++,
        x: e.x + Math.cos(ang) * e.r,
        y: e.y + Math.sin(ang) * e.r,
        vx: Math.cos(ang) * C.BULLET_SPEED,
        vy: Math.sin(ang) * C.BULLET_SPEED,
        life: C.BULLET_LIFETIME,
      });
      w.events.push({ k: 'shoot', x: e.x, y: e.y });
      e.target = rand(w) < 0.5 ? 0 : 1;
    }
  }
}

function updateJelly(w: World, e: Enemy, dt: number): void {
  e.timer -= dt;
  if (e.timer <= 0) {
    // pulse towards the nearest ship (a bit wobbly)
    e.timer = C.JELLY_PULSE_INTERVAL * range(w, 0.8, 1.2);
    const s = w.ships[nearestShip(w, e.x, e.y)];
    const tx = e.entered ? s.x : C.WORLD_W / 2;
    const ty = e.entered ? s.y : C.WORLD_H / 2;
    const ang = Math.atan2(ty - e.y, tx - e.x) + range(w, -0.5, 0.5);
    const k = e.r < C.JELLY_RADIUS_BIG ? 1.25 : 1;
    e.vx += Math.cos(ang) * C.JELLY_PULSE_IMPULSE * k;
    e.vy += Math.sin(ang) * C.JELLY_PULSE_IMPULSE * k;
  }
  e.vx *= Math.exp(-C.JELLY_DRAG * dt);
  e.vy *= Math.exp(-C.JELLY_DRAG * dt);
  // tentacles trail behind: face direction of travel
  if (Math.hypot(e.vx, e.vy) > 5) e.angle = Math.atan2(e.vy, e.vx);
}

function updateBullets(w: World, dt: number): void {
  const [a, b] = w.ships;
  w.bullets = w.bullets.filter((bl) => {
    bl.x += bl.vx * dt;
    bl.y += bl.vy * dt;
    bl.life -= dt;
    if (bl.life <= 0 || bl.x < -50 || bl.x > C.WORLD_W + 50 || bl.y < -50 || bl.y > C.WORLD_H + 50) return false;

    // The tether blocks bullets — position it as a shield!
    if (w.linked) {
      const c = closestOnSegment(a.x, a.y, b.x, b.y, bl.x, bl.y);
      if (c.dist < C.BULLET_RADIUS + 3 && c.t > 0.03 && c.t < 0.97) {
        w.events.push({ k: 'block', x: bl.x, y: bl.y });
        return false;
      }
    }
    for (let i = 0; i < 2; i++) {
      const s = w.ships[i];
      if (Math.hypot(s.x - bl.x, s.y - bl.y) < C.SHIP_RADIUS + C.BULLET_RADIUS) {
        if (s.invuln <= 0) damageHull(w, i, C.BULLET_DAMAGE, bl.x, bl.y);
        s.vx += bl.vx * 0.3;
        s.vy += bl.vy * 0.3;
        return false;
      }
    }
    return true;
  });
}

/** Tether vs enemies: fast enough => sliced (jellies split). Returns nothing, edits w.enemies. */
export function tetherVsEnemies(w: World): void {
  if (!w.linked || w.phase === 'over') return;
  const spawned: Enemy[] = [];
  const removed = new Set<number>();
  for (const e of w.enemies) {
    if (!e.entered || e.grace > 0) continue;
    const c = tetherContact(w, e.x, e.y, e.r, e.vx, e.vy);
    if (!c || c.crossSpeed < C.ENEMY_CUT_SPEED) continue;
    removed.add(e.id);
    const big = e.kind === 'jelly' && e.r >= C.JELLY_RADIUS_BIG;
    const base = e.kind === 'drone' ? C.DRONE_POINTS : big ? C.JELLY_POINTS_BIG : C.JELLY_POINTS_SMALL;
    const pts = addScore(w, base);
    w.events.push({ k: 'enemyKill', x: e.x, y: e.y, kind: e.kind, pts });

    if (big) {
      for (let i = 0; i < C.JELLY_SPLIT_COUNT; i++) {
        const ang = (i / C.JELLY_SPLIT_COUNT) * Math.PI * 2 + rand(w);
        const child = spawnEnemy(w, 'jelly', e.x + Math.cos(ang) * 14, e.y + Math.sin(ang) * 14,
          Math.cos(ang) * 140 + c.nx * c.sweep * 60, Math.sin(ang) * 140 + c.ny * c.sweep * 60, C.JELLY_RADIUS_SMALL, true);
        w.enemies.pop();
        spawned.push(child);
      }
    }
  }
  if (removed.size) w.enemies = w.enemies.filter((e) => !removed.has(e.id));
  w.enemies.push(...spawned);
}

export function shipsVsEnemies(w: World): void {
  if (w.phase === 'over') return;
  w.ships.forEach((s, i) => {
    for (const e of w.enemies) {
      const dx = s.x - e.x;
      const dy = s.y - e.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      const min = e.r + C.SHIP_RADIUS;
      if (d >= min) continue;
      const nx = dx / d;
      const ny = dy / d;
      s.x = e.x + nx * min;
      s.y = e.y + ny * min;
      s.vx = nx * C.SHIP_KNOCKBACK * 0.7 + e.vx;
      s.vy = ny * C.SHIP_KNOCKBACK * 0.7 + e.vy;
      e.vx -= nx * 120;
      e.vy -= ny * 120;
      if (s.invuln <= 0 && e.grace <= 0) {
        damageHull(w, i, e.kind === 'jelly' ? C.JELLY_STING_DAMAGE : 5, s.x - nx * C.SHIP_RADIUS, s.y - ny * C.SHIP_RADIUS);
      }
    }
  });
}
