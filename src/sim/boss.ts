// The space whale ("Leviathan"). It can't be sliced — you have to squeeze it with the
// taut tether and wrap the tether around it by orbiting together.

import * as C from './constants';
import { bounceOffWalls, closestOnSegment } from './physics';
import type { Boss, World } from './types';
import { damageHull, range, spawnAsteroid } from './core';

export function spawnBoss(w: World): void {
  const level = Math.max(1, Math.floor(w.wave / C.BOSS_EVERY));
  const maxHp = C.BOSS_BASE_HP + (level - 1) * C.BOSS_HP_PER_LEVEL;
  const x = C.WORLD_W + C.BOSS_RADIUS * 2;
  const y = C.WORLD_H / 2;
  w.boss = {
    x,
    y,
    vx: -C.BOSS_CRUISE_SPEED * 1.5,
    vy: 0,
    angle: Math.PI,
    hp: maxHp,
    maxHp,
    state: 'enter',
    stateTimer: 0,
    chargeTimer: range(w, ...C.BOSS_CHARGE_INTERVAL),
    spawnTimer: C.BOSS_SPAWN_INTERVAL * 0.6,
    wrap: 0,
    lastAngles: [Math.atan2(w.ships[0].y - y, w.ships[0].x - x), Math.atan2(w.ships[1].y - y, w.ships[1].x - x)],
    squeezing: false,
    wanderX: C.WORLD_W * 0.6,
    wanderY: C.WORLD_H * 0.5,
  };
}

const wrapDelta = (d: number) => {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export function updateBoss(w: World, dt: number): void {
  const b = w.boss;
  if (!b) return;

  if (b.state === 'dying') {
    b.stateTimer -= dt;
    b.vx *= Math.exp(-2 * dt);
    b.vy *= Math.exp(-2 * dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.stateTimer <= 0) w.boss = null;
    return;
  }

  move(w, b, dt);
  squeezeAndWrap(w, b, dt);
  collisions(w, b);

  if (b.hp <= 0) {
    b.hp = 0;
    b.state = 'dying';
    b.stateTimer = 2;
    b.squeezing = false;
    const pts = Math.round(C.BOSS_KILL_POINTS * w.combo);
    w.score += pts;
    w.events.push({ k: 'bossDown', x: b.x, y: b.y, pts });
  }
}

function setState(b: Boss, s: Boss['state'], t: number) {
  b.state = s;
  b.stateTimer = t;
}

function move(w: World, b: Boss, dt: number) {
  const [s0, s1] = w.ships;
  const target = Math.hypot(s0.x - b.x, s0.y - b.y) < Math.hypot(s1.x - b.x, s1.y - b.y) ? s0 : s1;

  switch (b.state) {
    case 'enter':
      if (b.x < C.WORLD_W - C.BOSS_RADIUS * 2.5) setState(b, 'cruise', 0);
      break;

    case 'cruise': {
      // swim towards a wander point in gentle curves
      if (Math.hypot(b.wanderX - b.x, b.wanderY - b.y) < 120) {
        b.wanderX = range(w, C.BOSS_RADIUS * 2, C.WORLD_W - C.BOSS_RADIUS * 2);
        b.wanderY = range(w, C.BOSS_RADIUS * 1.6, C.WORLD_H - C.BOSS_RADIUS * 1.6);
      }
      const ang = Math.atan2(b.wanderY - b.y, b.wanderX - b.x) + Math.sin(w.tick * 0.015) * 0.5;
      steer(b, Math.cos(ang) * C.BOSS_CRUISE_SPEED, Math.sin(ang) * C.BOSS_CRUISE_SPEED, 1.2, dt);

      b.chargeTimer -= dt;
      if (b.chargeTimer <= 0) setState(b, 'windup', C.BOSS_WINDUP_TIME);

      b.spawnTimer -= dt;
      if (b.spawnTimer <= 0) {
        b.spawnTimer = C.BOSS_SPAWN_INTERVAL;
        // spits two small rocks out of its mouth
        for (const side of [-1, 1]) {
          const a = b.angle + side * 0.5;
          spawnAsteroid(w, b.x + Math.cos(b.angle) * C.BOSS_RADIUS, b.y + Math.sin(b.angle) * C.BOSS_RADIUS,
            Math.cos(a) * 160, Math.sin(a) * 160, 26, true);
        }
      }
      break;
    }

    case 'windup':
      // slow down, turn towards the victim, shiver
      steer(b, 0, 0, 3, dt);
      b.angle = lerpTo(b.angle, Math.atan2(target.y - b.y, target.x - b.x), 4 * dt);
      b.stateTimer -= dt;
      if (b.stateTimer <= 0) {
        setState(b, 'charge', C.BOSS_CHARGE_TIME);
        b.vx = Math.cos(b.angle) * C.BOSS_CHARGE_SPEED;
        b.vy = Math.sin(b.angle) * C.BOSS_CHARGE_SPEED;
        w.events.push({ k: 'bossCharge', x: b.x, y: b.y });
      }
      break;

    case 'charge':
      b.stateTimer -= dt;
      if (b.stateTimer <= 0) {
        setState(b, 'cruise', 0);
        b.chargeTimer = range(w, ...C.BOSS_CHARGE_INTERVAL);
      }
      break;

    case 'stunned':
      steer(b, 0, 0, 1.5, dt);
      b.stateTimer -= dt;
      if (b.stateTimer <= 0) {
        setState(b, 'cruise', 0);
        b.chargeTimer = range(w, ...C.BOSS_CHARGE_INTERVAL) * 0.6;
      }
      break;
  }

  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.state !== 'enter') {
    if (bounceOffWalls(b, C.BOSS_RADIUS * 0.8) && b.state === 'charge') b.stateTimer = Math.min(b.stateTimer, 0.15);
  }
  if (b.state !== 'windup' && b.state !== 'stunned' && Math.hypot(b.vx, b.vy) > 10) {
    b.angle = lerpTo(b.angle, Math.atan2(b.vy, b.vx), 3 * dt);
  }
}

function steer(b: Boss, tvx: number, tvy: number, rate: number, dt: number) {
  const k = 1 - Math.exp(-rate * dt);
  b.vx += (tvx - b.vx) * k;
  b.vy += (tvy - b.vy) * k;
}

function lerpTo(a: number, target: number, t: number) {
  return a + wrapDelta(target - a) * Math.min(1, t);
}

function squeezeAndWrap(w: World, b: Boss, dt: number) {
  const [s0, s1] = w.ships;
  const angles: [number, number] = [Math.atan2(s0.y - b.y, s0.x - b.x), Math.atan2(s1.y - b.y, s1.x - b.x)];
  b.squeezing = false;

  if (w.linked && b.state !== 'enter') {
    const c = closestOnSegment(s0.x, s0.y, s1.x, s1.y, b.x, b.y);
    const touching = c.dist < C.BOSS_RADIUS * 0.9 && c.t > 0.08 && c.t < 0.92;
    if (touching && w.tension > 0.1) {
      b.squeezing = true;
      const mult = b.state === 'stunned' ? 2 : 1;
      b.hp -= C.BOSS_SQUEEZE_DPS * (0.5 + w.tension) * mult * dt;
    }
    // Wrap counter: while the tether lies across the whale, sum up how far
    // both ships have orbited around it (in the same direction)
    if (touching || c.dist < C.BOSS_RADIUS * 1.3) {
      const d0 = wrapDelta(angles[0] - b.lastAngles[0]);
      const d1 = wrapDelta(angles[1] - b.lastAngles[1]);
      b.wrap += (d0 + d1) / 2;
    } else {
      b.wrap *= Math.exp(-0.6 * dt);
    }
    if (Math.abs(b.wrap) >= Math.PI * 2) {
      b.wrap = 0;
      b.hp -= b.maxHp * C.BOSS_WRAP_DAMAGE;
      setState(b, 'stunned', C.BOSS_STUN_TIME);
      const pts = Math.round(C.BOSS_WRAP_POINTS * w.combo);
      w.score += pts;
      w.combo = Math.min(C.COMBO_MAX, w.combo + 1);
      w.comboTimer = C.COMBO_WINDOW * 2;
      w.events.push({ k: 'wrap', x: b.x, y: b.y, pts });
    }
  } else {
    b.wrap *= Math.exp(-1.5 * dt);
  }
  b.lastAngles = angles;
}

function collisions(w: World, b: Boss) {
  if (b.state === 'enter') return;
  w.ships.forEach((s, i) => {
    const dx = s.x - b.x;
    const dy = s.y - b.y;
    const d = Math.hypot(dx, dy) || 0.0001;
    const min = C.BOSS_RADIUS + C.SHIP_RADIUS;
    if (d >= min) return;
    const nx = dx / d;
    const ny = dy / d;
    s.x = b.x + nx * min;
    s.y = b.y + ny * min;
    const charging = b.state === 'charge';
    s.vx = nx * C.SHIP_KNOCKBACK * (charging ? 1.6 : 1) + b.vx * 0.5;
    s.vy = ny * C.SHIP_KNOCKBACK * (charging ? 1.6 : 1) + b.vy * 0.5;
    if (s.invuln <= 0) damageHull(w, i, charging ? C.BOSS_CHARGE_DAMAGE : C.BOSS_CONTACT_DAMAGE, s.x - nx * C.SHIP_RADIUS, s.y - ny * C.SHIP_RADIUS);
  });
  // rocks bounce off the whale
  for (const a of w.asteroids) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const d = Math.hypot(dx, dy) || 0.0001;
    const min = C.BOSS_RADIUS + a.r * 0.8;
    if (d >= min || a.grace > 0) continue;
    const nx = dx / d;
    const ny = dy / d;
    a.x = b.x + nx * min;
    a.y = b.y + ny * min;
    const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (vn < 0) {
      a.vx -= nx * vn * 2;
      a.vy -= ny * vn * 2;
    }
  }
}
