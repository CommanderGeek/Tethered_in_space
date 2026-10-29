// Reine Spiellogik ohne Phaser – läuft nur beim Host (bzw. lokal).
// Der Client bekommt davon nur Snapshots (siehe snapshot.ts).

import * as C from './constants';

export interface PlayerInput {
  /** Bewegungsrichtung, jeweils -1..1 */
  x: number;
  y: number;
  /** Verankern: schwer + bremst stark, der Partner schwingt um dich herum */
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
  /** Sekunden Slingshot-Boost übrig */
  boost: number;
}

export interface Planet {
  x: number;
  y: number;
  r: number;
  /** Schwerkraft an der Oberfläche (px/s²) */
  g: number;
  /** nur Optik: 0 Gas+Ring, 1 Eis, 2 Lava, 3 Toxisch */
  kind: number;
  /** 0..1 – Planeten wachsen beim Erscheinen und schrumpfen beim Verschwinden */
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

export type SimEvent =
  | { k: 'cut'; x: number; y: number; r: number; split: boolean; pts: number }
  | { k: 'hit'; x: number; y: number; ship: number }
  | { k: 'bounce'; x: number; y: number }
  | { k: 'snap'; x: number; y: number }
  | { k: 'link'; x: number; y: number }
  | { k: 'wave'; n: number }
  | { k: 'sling'; x: number; y: number; ship: number }
  | { k: 'impact'; x: number; y: number; r: number }
  | { k: 'over' };

export type Phase = 'intermission' | 'play' | 'over';

export interface World {
  tick: number;
  ships: [Ship, Ship];
  asteroids: Asteroid[];
  planets: Planet[];
  nextId: number;
  linked: boolean;
  /** 0..1, wie nah das Seil am Reißen ist */
  tension: number;
  hull: number;
  score: number;
  wave: number;
  combo: number;
  comboTimer: number;
  phase: Phase;
  phaseTimer: number;
  rng: number;
  /** Events dieses Ticks (Partikel/Sound) – werden vom Aufrufer abgeholt */
  events: SimEvent[];
}

function makeShip(x: number, y: number): Ship {
  return { x, y, vx: 0, vy: 0, angle: -Math.PI / 2, anchor: false, thrust: false, invuln: 0, boost: 0 };
}

export function createWorld(seed = (Math.random() * 2 ** 31) | 0): World {
  const cx = C.WORLD_W / 2;
  const cy = C.WORLD_H / 2;
  return {
    tick: 0,
    ships: [makeShip(cx - 120, cy), makeShip(cx + 120, cy)],
    asteroids: [],
    planets: [],
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

// mulberry32 – kleiner, deterministischer Zufall
function rand(w: World): number {
  let t = (w.rng = (w.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const range = (w: World, a: number, b: number) => a + rand(w) * (b - a);

// ---------------------------------------------------------------- Step

export function step(w: World, inputs: [PlayerInput, PlayerInput], dt: number): void {
  w.tick++;

  if (w.phase === 'over') {
    // Wrack treibt noch etwas weiter, sieht schöner aus
    updatePlanets(w, dt);
    for (const s of w.ships) integrateShip(s, NO_INPUT, dt);
    moveAsteroids(w, dt);
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
  ropeVsAsteroids(w);
  shipsVsAsteroids(w);
  planetCollisions(w);
  detectSlingshots(w);

  if (w.comboTimer > 0) {
    w.comboTimer -= dt;
    if (w.comboTimer <= 0) w.combo = 1;
  }

  if (w.phase === 'play' && w.asteroids.length === 0) {
    w.phase = 'intermission';
    w.phaseTimer = C.INTERMISSION_TIME;
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
  w.events.push({ k: 'wave', n: w.wave });

  // Planeten-Layout wechseln: alte schrumpfen weg, neue wachsen
  for (const p of w.planets) p.dying = true;
  const layout = C.PLANET_LAYOUTS[(w.wave - 1) % C.PLANET_LAYOUTS.length];
  for (const [x, y, r, kind] of layout) {
    w.planets.push({ x, y, r, kind, g: C.PLANET_SURFACE_G * Math.sqrt(r / 70), grow: 0, dying: false });
  }

  const count = 3 + w.wave * 2;
  const bigChance = Math.min(0.75, 0.3 + w.wave * 0.06);
  const speed = 55 + w.wave * 9;

  for (let i = 0; i < count; i++) {
    // Spawn außerhalb des Bildschirms, Flug Richtung Mitte
    const side = Math.floor(rand(w) * 4);
    let x = 0;
    let y = 0;
    // leicht gestaffelt, damit nicht alle gleichzeitig reinkommen
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

function spawnAsteroid(w: World, x: number, y: number, vx: number, vy: number, r: number, entered: boolean): Asteroid {
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

// ---------------------------------------------------------------- Schiffe

function integrateShip(s: Ship, inp: PlayerInput, dt: number): void {
  let ix = inp.x;
  let iy = inp.y;
  const len = Math.hypot(ix, iy);
  if (len > 1) { ix /= len; iy /= len; }

  s.anchor = inp.anchor;
  s.thrust = len > 0.1;
  const accel = C.SHIP_ACCEL * (s.anchor ? C.ANCHOR_ACCEL_FACTOR : 1);
  s.vx += ix * accel * dt;
  s.vy += iy * accel * dt;

  // Höchstgeschwindigkeit begrenzt nur den eigenen Schub, Schwung vom Seil darf drüber
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

  // Schiff zeigt in Bewegungs- bzw. Eingaberichtung
  const target = s.thrust ? Math.atan2(iy, ix) : sp > 40 ? Math.atan2(s.vy, s.vx) : s.angle;
  s.angle = lerpAngle(s.angle, target, 1 - Math.exp(-12 * dt));

  if (s.invuln > 0) s.invuln -= dt;
  if (s.boost > 0) s.boost -= dt;
}

function bounceOffWalls(o: { x: number; y: number; vx: number; vy: number }, r: number): boolean {
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

// ---------------------------------------------------------------- Seil

function updateRope(w: World, dt: number): void {
  const [a, b] = w.ships;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 0.0001;

  if (!w.linked) {
    w.tension = 0;
    if (d < C.ROPE_RELINK_DIST && w.phase !== 'over') {
      w.linked = true;
      w.events.push({ k: 'link', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    return;
  }

  const stretch = d - C.ROPE_LENGTH;
  w.tension = Math.max(0, Math.min(1, stretch / C.ROPE_SNAP_STRETCH));
  if (stretch <= 0) return; // Seil hängt locker

  if (stretch > C.ROPE_SNAP_STRETCH) {
    w.linked = false;
    w.tension = 0;
    w.combo = 1;
    w.events.push({ k: 'snap', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    return;
  }

  const nx = dx / d;
  const ny = dy / d;
  const wa = a.anchor ? C.ANCHOR_INV_MASS : 1;
  const wb = b.anchor ? C.ANCHOR_INV_MASS : 1;
  const relV = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  // Feder + Dämpfung (nur beim Auseinanderziehen dämpfen)
  const f = (C.ROPE_STIFFNESS * stretch + C.ROPE_DAMPING * Math.max(0, relV)) * dt;
  // so normiert, dass die Summe der Gewichte 2 ergibt (gleiche Stärke wie vorher)
  const norm = 2 / (wa + wb);
  a.vx += nx * f * wa * norm;
  a.vy += ny * f * wa * norm;
  b.vx -= nx * f * wb * norm;
  b.vy -= ny * f * wb * norm;
}

function ropeVsAsteroids(w: World): void {
  if (!w.linked || w.phase === 'over') return;
  const [a, b] = w.ships;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const segLen2 = sx * sx + sy * sy;
  if (segLen2 < 1) return;
  const segLen = Math.sqrt(segLen2);
  // Normale des Seils
  const nx = -sy / segLen;
  const ny = sx / segLen;

  const spawned: Asteroid[] = [];
  const removed = new Set<number>();

  for (const ast of w.asteroids) {
    if (!ast.entered) continue;
    let t = ((ast.x - a.x) * sx + (ast.y - a.y) * sy) / segLen2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + sx * t;
    const py = a.y + sy * t;
    const dx = ast.x - px;
    const dy = ast.y - py;
    const dist = Math.hypot(dx, dy);
    if (dist > ast.r + 3) continue;
    // Endpunkte (Schiffe) sind Sache der Schiffskollision
    if (t <= 0.02 || t >= 0.98) continue;

    // Geschwindigkeit des Seils an dieser Stelle relativ zum Asteroiden, quer zum Seil
    const vpx = a.vx + (b.vx - a.vx) * t - ast.vx;
    const vpy = a.vy + (b.vy - a.vy) * t - ast.vy;
    const crossSpeed = Math.abs(vpx * nx + vpy * ny);

    if (crossSpeed >= C.ROPE_CUT_SPEED && ast.grace <= 0) {
      removed.add(ast.id);
      const split = ast.r >= C.AST_SPLIT_MIN_R;
      const boosted = a.boost > 0 || b.boost > 0;
      const pts = Math.round((split ? 10 : 25) * w.combo * (boosted ? C.SLING_SCORE_FACTOR : 1));
      w.score += pts;
      w.events.push({ k: 'cut', x: ast.x, y: ast.y, r: ast.r, split, pts });
      w.combo = Math.min(C.COMBO_MAX, w.combo + 1);
      w.comboTimer = C.COMBO_WINDOW;

      if (split) {
        const cr = ast.r * C.AST_CHILD_SCALE;
        // Richtung, in die das Seil gerade fegt
        const sweep = vpx * nx + vpy * ny >= 0 ? 1 : -1;
        const fwd = 60 + crossSpeed * 0.2;
        for (const sgn of [-1, 1]) {
          // Hälften fliegen mit dem Seil mit und leicht auseinander (nicht in die Schiffe)
          const ux = (sx / segLen) * sgn;
          const uy = (sy / segLen) * sgn;
          const c = spawnAsteroid(
            w,
            ast.x + ux * cr * 0.6 + nx * sweep * cr * 0.4,
            ast.y + uy * cr * 0.6 + ny * sweep * cr * 0.4,
            ast.vx * 0.4 + nx * sweep * fwd + ux * 50,
            ast.vy * 0.4 + ny * sweep * fwd + uy * 50,
            cr,
            true,
          );
          w.asteroids.pop(); // erst nach der Schleife einfügen
          spawned.push(c);
        }
      }
    } else if (ast.grace <= 0) {
      // zu langsam: Asteroid prallt vom Seil ab
      const side = dx * nx + dy * ny >= 0 ? 1 : -1;
      const pen = ast.r + 3 - dist;
      ast.x += nx * side * pen;
      ast.y += ny * side * pen;
      // Normalgeschwindigkeit des Asteroiden relativ zum Seil
      const vn = -(vpx * nx + vpy * ny);
      if (vn * side < 0) {
        ast.vx -= nx * vn * 1.6;
        ast.vy -= ny * vn * 1.6;
        w.events.push({ k: 'bounce', x: px, y: py });
      }
    }
  }

  if (removed.size) w.asteroids = w.asteroids.filter((x) => !removed.has(x.id));
  w.asteroids.push(...spawned);
}

// ---------------------------------------------------------------- Asteroiden

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
      // Asteroiden behalten ihre Energie an der Wand
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
        s.invuln = C.SHIP_INVULN_TIME;
        w.hull -= Math.round(a.r / 5);
        w.combo = 1;
        w.events.push({ k: 'hit', x: s.x - nx * C.SHIP_RADIUS, y: s.y - ny * C.SHIP_RADIUS, ship: i });
      }
    }
  });
}

// ---------------------------------------------------------------- Planeten & Slingshot

/** Effektiver Radius (mit Wachs-Animation) */
export function planetRadius(p: { r: number; grow: number }): number {
  const t = Math.max(0, Math.min(1, p.grow));
  return p.r * (1 - (1 - t) ** 3);
}

function updatePlanets(w: World, dt: number): void {
  for (const p of w.planets) {
    if (p.dying) p.grow -= dt / C.PLANET_FADE_TIME;
    else if (p.grow < 1) p.grow = Math.min(1, p.grow + dt / C.PLANET_FADE_TIME);
  }
  w.planets = w.planets.filter((p) => !p.dying || p.grow > 0);
}

/** Beschleunigung durch alle Planeten an Punkt (x, y) */
function gravityAt(w: World, x: number, y: number): [number, number] {
  let ax = 0;
  let ay = 0;
  for (const p of w.planets) {
    const R = planetRadius(p);
    if (R < 1) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    const d = Math.max(Math.hypot(dx, dy), R);
    // g * (R/d)^2, sanft ausgeblendet ab GRAVITY_RANGE * R
    const fade = Math.max(0, 1 - d / (R * C.GRAVITY_RANGE));
    const a = p.g * Math.min(1, p.grow) * (R / d) ** 2 * Math.min(1, fade * 3);
    ax += (dx / d) * a;
    ay += (dy / d) * a;
  }
  return [ax, ay];
}

function applyGravity(w: World, dt: number): void {
  for (const s of w.ships) {
    const [ax, ay] = gravityAt(w, s.x, s.y);
    s.vx += ax * dt;
    s.vy += ay * dt;
  }
  for (const a of w.asteroids) {
    if (!a.entered) continue;
    const [ax, ay] = gravityAt(w, a.x, a.y);
    a.vx += ax * C.ASTEROID_GRAVITY_FACTOR * dt;
    a.vy += ay * C.ASTEROID_GRAVITY_FACTOR * dt;
  }
}

function planetCollisions(w: World): void {
  for (const p of w.planets) {
    const R = planetRadius(p);
    if (R < 2) continue;

    w.ships.forEach((s, i) => {
      const dx = s.x - p.x;
      const dy = s.y - p.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      const min = R + C.SHIP_RADIUS;
      if (d >= min) return;
      const nx = dx / d;
      const ny = dy / d;
      s.x = p.x + nx * min;
      s.y = p.y + ny * min;
      const vn = s.vx * nx + s.vy * ny;
      if (vn < 0) {
        s.vx -= nx * vn * 1.5;
        s.vy -= ny * vn * 1.5;
        if (-vn > C.PLANET_CRASH_SPEED && s.invuln <= 0) {
          s.invuln = C.SHIP_INVULN_TIME;
          w.hull -= C.PLANET_CRASH_DAMAGE;
          w.combo = 1;
          w.events.push({ k: 'hit', x: s.x - nx * C.SHIP_RADIUS, y: s.y - ny * C.SHIP_RADIUS, ship: i });
        }
      }
    });

    // Asteroiden stürzen in den Planeten (ohne Punkte)
    w.asteroids = w.asteroids.filter((a) => {
      if (!a.entered) return true;
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d >= R + a.r * 0.6) return true;
      const k = R / (d || 1);
      w.events.push({ k: 'impact', x: p.x + (a.x - p.x) * k, y: p.y + (a.y - p.y) * k, r: a.r });
      return false;
    });
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

// ---------------------------------------------------------------- Helfer

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
