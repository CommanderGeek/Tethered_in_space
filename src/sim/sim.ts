// Pure game logic without Phaser — runs only on the host (or locally).
// The client only receives snapshots of it (see snapshot.ts).

import * as C from './constants';
import { addScore, damageHull, rand, range, spawnAsteroid, tetherContact } from './core';
import { edgeSpawn, shipsVsEnemies, spawnEnemy, tetherVsEnemies, updateEnemies } from './enemies';
import { spawnBoss, updateBoss } from './boss';
import {
  applyRopeForce, bounceOffWalls, collideShipWithPlanets, gravityAt, integrateShip, makeShip, planetRadius,
} from './physics';
import { NO_INPUT, type Asteroid, type PlayerInput, type World } from './types';

export * from './types';
export { planetRadius, lerpAngle } from './physics';
export { spawnAsteroid } from './core';

export function createWorld(seed = (Math.random() * 2 ** 31) | 0): World {
  const cx = C.WORLD_W / 2;
  const cy = C.WORLD_H / 2;
  return {
    tick: 0,
    ships: [makeShip(cx - 120, cy), makeShip(cx + 120, cy)],
    asteroids: [],
    planets: [],
    enemies: [],
    bullets: [],
    boss: null,
    nextId: 1,
    linked: true,
    tension: 0,
    hull: C.HULL_MAX,
    score: 0,
    wave: 0,
    combo: 1,
    comboTimer: 0,
    phase: 'intermission',
    phaseTimer: 1.2,
    rng: seed,
    events: [],
  };
}

export const isBossWave = (wave: number) => wave > 0 && wave % C.BOSS_EVERY === 0;

// ---------------------------------------------------------------- Step

export function step(w: World, inputs: [PlayerInput, PlayerInput], dt: number): void {
  w.tick++;

  if (w.phase === 'over') {
    // the wreck keeps drifting a little, looks nicer
    updatePlanets(w, dt);
    for (const s of w.ships) integrateShip(s, NO_INPUT, dt);
    moveAsteroids(w, dt);
    updateEnemies(w, dt);
    updateBoss(w, dt);
    return;
  }

  if (w.phase === 'intermission') {
    w.phaseTimer -= dt;
    if (w.phaseTimer <= 0) startWave(w);
  }

  updatePlanets(w, dt);
  applyGravity(w, dt);
  for (let i = 0; i < 2; i++) integrateShip(w.ships[i], inputs[i], dt);
  updateRope(w, dt);
  for (const s of w.ships) bounceOffWalls(s, C.SHIP_RADIUS);
  moveAsteroids(w, dt);
  updateEnemies(w, dt);
  updateBoss(w, dt);
  tetherVsAsteroids(w);
  tetherVsEnemies(w);
  shipsVsAsteroids(w);
  shipsVsEnemies(w);
  planetCollisions(w);
  detectSlingshots(w);

  if (w.comboTimer > 0) {
    w.comboTimer -= dt;
    if (w.comboTimer <= 0) w.combo = 1;
  }

  const cleared = w.asteroids.length === 0 && w.enemies.length === 0 && !w.boss;
  if (w.phase === 'play' && cleared) {
    w.phase = 'intermission';
    w.phaseTimer = C.INTERMISSION_TIME;
    w.bullets = [];
    w.hull = Math.min(C.HULL_MAX, w.hull + C.HULL_REGEN_PER_WAVE);
  }

  if (w.hull <= 0) {
    w.hull = 0;
    w.phase = 'over';
    w.linked = false;
    w.events.push({ k: 'over' });
  }
}

function startWave(w: World): void {
  w.wave++;
  w.phase = 'play';
  const boss = isBossWave(w.wave);
  w.events.push({ k: 'wave', n: w.wave, boss });

  // switch planet layout: old ones shrink away, new ones grow in.
  // Boss waves are fought in open space.
  for (const p of w.planets) p.dying = true;
  if (!boss) {
    const layout = C.PLANET_LAYOUTS[(w.wave - 1) % C.PLANET_LAYOUTS.length];
    for (const [x, y, r, kind] of layout) {
      w.planets.push({ x, y, r, kind, g: C.PLANET_SURFACE_G * Math.sqrt(r / 70), grow: 0, dying: false });
    }
  }

  if (boss) {
    spawnBoss(w);
    // a few rocks to keep the combo going
    spawnAsteroidWave(w, 3, 0.2, 60);
    return;
  }

  spawnAsteroidWave(w, 3 + w.wave * 2, Math.min(0.75, 0.3 + w.wave * 0.06), 55 + w.wave * 9);

  // drones from wave 2, jellyfish from wave 3 — more over time
  const drones = w.wave >= 2 ? Math.min(4, Math.floor(w.wave / 2)) : 0;
  const jellies = w.wave >= 3 ? Math.min(4, Math.floor((w.wave - 1) / 2)) : 0;
  for (let i = 0; i < drones; i++) {
    const [x, y] = edgeSpawn(w, 60 + i * 80);
    spawnEnemy(w, 'drone', x, y);
  }
  for (let i = 0; i < jellies; i++) {
    const [x, y] = edgeSpawn(w, 60 + i * 60);
    spawnEnemy(w, 'jelly', x, y);
  }
}

function spawnAsteroidWave(w: World, count: number, bigChance: number, speed: number) {
  for (let i = 0; i < count; i++) {
    // spawn off-screen, fly towards the middle, slightly staggered
    const side = Math.floor(rand(w) * 4);
    let x = 0;
    let y = 0;
    const pad = 70 + rand(w) * 40 + i * 25;
    if (side === 0) { x = range(w, 0, C.WORLD_W); y = -pad; }
    if (side === 1) { x = C.WORLD_W + pad; y = range(w, 0, C.WORLD_H); }
    if (side === 2) { x = range(w, 0, C.WORLD_W); y = C.WORLD_H + pad; }
    if (side === 3) { x = -pad; y = range(w, 0, C.WORLD_H); }

    const tx = range(w, C.WORLD_W * 0.25, C.WORLD_W * 0.75);
    const ty = range(w, C.WORLD_H * 0.25, C.WORLD_H * 0.75);
    const d = Math.hypot(tx - x, ty - y);
    const v = speed * range(w, 0.7, 1.3);
    spawnAsteroid(w, x, y, ((tx - x) / d) * v, ((ty - y) / d) * v, rand(w) < bigChance ? 60 : 42, false);
  }
}

// ---------------------------------------------------------------- Tether

function updateRope(w: World, dt: number): void {
  const [a, b] = w.ships;
  const d = Math.hypot(b.x - a.x, b.y - a.y);

  if (!w.linked) {
    w.tension = 0;
    if (d < C.ROPE_RELINK_DIST && w.phase !== 'over') {
      w.linked = true;
      w.events.push({ k: 'link', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    return;
  }

  const stretch = applyRopeForce(a, b, dt);
  w.tension = Math.max(0, Math.min(1, stretch / C.ROPE_SNAP_STRETCH));
  if (stretch > C.ROPE_SNAP_STRETCH) {
    w.linked = false;
    w.tension = 0;
    w.combo = 1;
    w.events.push({ k: 'snap', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
}

function tetherVsAsteroids(w: World): void {
  if (!w.linked || w.phase === 'over') return;
  const [a, b] = w.ships;
  const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / segLen;
  const uy = (b.y - a.y) / segLen;

  const spawned: Asteroid[] = [];
  const removed = new Set<number>();

  for (const ast of w.asteroids) {
    if (!ast.entered) continue;
    const c = tetherContact(w, ast.x, ast.y, ast.r, ast.vx, ast.vy);
    if (!c) continue;

    if (c.crossSpeed >= C.ROPE_CUT_SPEED && ast.grace <= 0) {
      removed.add(ast.id);
      const split = ast.r >= C.AST_SPLIT_MIN_R;
      const pts = addScore(w, split ? 10 : 25);
      w.events.push({ k: 'cut', x: ast.x, y: ast.y, r: ast.r, split, pts });

      if (split) {
        const cr = ast.r * C.AST_CHILD_SCALE;
        const fwd = 60 + c.crossSpeed * 0.2;
        for (const sgn of [-1, 1]) {
          // the halves fly along with the tether and slightly apart (not into the ships)
          const child = spawnAsteroid(
            w,
            ast.x + ux * sgn * cr * 0.6 + c.nx * c.sweep * cr * 0.4,
            ast.y + uy * sgn * cr * 0.6 + c.ny * c.sweep * cr * 0.4,
            ast.vx * 0.4 + c.nx * c.sweep * fwd + ux * sgn * 50,
            ast.vy * 0.4 + c.ny * c.sweep * fwd + uy * sgn * 50,
            cr,
            true,
          );
          w.asteroids.pop(); // insert after the loop
          spawned.push(child);
        }
      }
    } else if (ast.grace <= 0) {
      // too slow: the asteroid bounces off the tether
      const side = (ast.x - c.px) * c.nx + (ast.y - c.py) * c.ny >= 0 ? 1 : -1;
      const pen = ast.r + 3 - c.dist;
      ast.x += c.nx * side * pen;
      ast.y += c.ny * side * pen;
      const vn = -(c.vpx * c.nx + c.vpy * c.ny); // asteroid velocity relative to the tether
      if (vn * side < 0) {
        ast.vx -= c.nx * vn * 1.6;
        ast.vy -= c.ny * vn * 1.6;
        w.events.push({ k: 'bounce', x: c.px, y: c.py });
      }
    }
  }

  if (removed.size) w.asteroids = w.asteroids.filter((x) => !removed.has(x.id));
  w.asteroids.push(...spawned);
}

// ---------------------------------------------------------------- Asteroids

function moveAsteroids(w: World, dt: number): void {
  for (const a of w.asteroids) {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.rot += a.spin * dt;
    if (a.grace > 0) a.grace -= dt;
    if (!a.entered) {
      const inside =
        a.x > C.WALL_MARGIN + a.r && a.x < C.WORLD_W - C.WALL_MARGIN - a.r &&
        a.y > C.WALL_MARGIN + a.r && a.y < C.WORLD_H - C.WALL_MARGIN - a.r;
      if (inside) a.entered = true;
    } else {
      // asteroids keep their energy when bouncing off walls
      const vx = a.vx;
      const vy = a.vy;
      if (bounceOffWalls(a, a.r)) {
        a.vx = Math.sign(a.vx || -vx) * Math.abs(vx);
        a.vy = Math.sign(a.vy || -vy) * Math.abs(vy);
      }
    }
  }
}

function shipsVsAsteroids(w: World): void {
  if (w.phase === 'over') return;
  w.ships.forEach((s, i) => {
    for (const a of w.asteroids) {
      const dx = s.x - a.x;
      const dy = s.y - a.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      const min = a.r + C.SHIP_RADIUS;
      if (d >= min) continue;
      const nx = dx / d;
      const ny = dy / d;
      s.x = a.x + nx * min;
      s.y = a.y + ny * min;
      s.vx = nx * C.SHIP_KNOCKBACK + a.vx;
      s.vy = ny * C.SHIP_KNOCKBACK + a.vy;
      a.vx -= nx * 40;
      a.vy -= ny * 40;
      if (s.invuln <= 0 && a.grace <= 0) {
        damageHull(w, i, Math.round(a.r / 5), s.x - nx * C.SHIP_RADIUS, s.y - ny * C.SHIP_RADIUS);
      }
    }
  });
}

// ---------------------------------------------------------------- Planets & slingshot

function updatePlanets(w: World, dt: number): void {
  for (const p of w.planets) {
    if (p.dying) p.grow -= dt / C.PLANET_FADE_TIME;
    else if (p.grow < 1) p.grow = Math.min(1, p.grow + dt / C.PLANET_FADE_TIME);
  }
  w.planets = w.planets.filter((p) => !p.dying || p.grow > 0);
}

function applyGravity(w: World, dt: number): void {
  for (const s of w.ships) {
    const [ax, ay] = gravityAt(w.planets, s.x, s.y);
    s.vx += ax * dt;
    s.vy += ay * dt;
  }
  for (const a of w.asteroids) {
    if (!a.entered) continue;
    const [ax, ay] = gravityAt(w.planets, a.x, a.y);
    a.vx += ax * C.ASTEROID_GRAVITY_FACTOR * dt;
    a.vy += ay * C.ASTEROID_GRAVITY_FACTOR * dt;
  }
}

function planetCollisions(w: World): void {
  w.ships.forEach((s, i) => {
    const hit = collideShipWithPlanets(s, w.planets);
    if (hit && hit.speed > C.PLANET_CRASH_SPEED && s.invuln <= 0) damageHull(w, i, C.PLANET_CRASH_DAMAGE, hit.x, hit.y);
  });

  for (const p of w.planets) {
    const R = planetRadius(p);
    if (R < 2) continue;
    // asteroids crash into the planet (no points)
    w.asteroids = w.asteroids.filter((a) => {
      if (!a.entered) return true;
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d >= R + a.r * 0.6) return true;
      const k = R / (d || 1);
      w.events.push({ k: 'impact', x: p.x + (a.x - p.x) * k, y: p.y + (a.y - p.y) * k, r: a.r });
      return false;
    });
    // enemies bounce off planets
    for (const e of w.enemies) {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < R + e.r) {
        e.x = p.x + (dx / d) * (R + e.r);
        e.y = p.y + (dy / d) * (R + e.r);
        e.vx += (dx / d) * 80;
        e.vy += (dy / d) * 80;
      }
    }
  }
}

function detectSlingshots(w: World): void {
  w.ships.forEach((s, i) => {
    const speed = Math.hypot(s.vx, s.vy);
    if (speed < C.SLING_MIN_SPEED) return;
    for (const p of w.planets) {
      if (p.grow < 1 || p.dying) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d > p.r * C.SLING_ZONE) continue;
      if (s.boost <= 0) w.events.push({ k: 'sling', x: s.x, y: s.y, ship: i });
      s.boost = C.SLING_TIME;
    }
  });
}
