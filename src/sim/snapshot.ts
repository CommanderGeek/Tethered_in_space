// Compact network format for the world state + interpolation on the client.

import * as C from './constants';
import type { BossState, EnemyKind, Phase, SimEvent, World } from './types';
import { lerpAngle } from './physics';

/** [x, y, angle, flags, vx, vy, invuln, boost]  flags: 1=anchor 2=thrust */
export type ShipSnap = [number, number, number, number, number, number, number, number];
/** [id, x, y, r, rot] */
export type AstSnap = [number, number, number, number, number];
/** [x, y, r, grow, kind] */
export type PlanetSnap = [number, number, number, number, number];
/** [id, kind (0 drone, 1 jelly), x, y, r, angle, charging] */
export type EnemySnap = [number, number, number, number, number, number, number];
/** [id, x, y] */
export type BulletSnap = [number, number, number];
/** [x, y, angle, hp, maxHp, state, wrap, squeezing] */
export type BossSnap = [number, number, number, number, number, number, number, number];

const BOSS_STATES: BossState[] = ['enter', 'cruise', 'windup', 'charge', 'stunned', 'dying'];

export interface Snapshot {
  tick: number;
  /** last client input sequence number the host has applied (for prediction) */
  ack: number;
  ships: [ShipSnap, ShipSnap];
  ast: AstSnap[];
  pl: PlanetSnap[];
  en: EnemySnap[];
  bl: BulletSnap[];
  boss: BossSnap | null;
  linked: boolean;
  tension: number;
  hull: number;
  score: number;
  wave: number;
  combo: number;
  phase: Phase;
  ev: SimEvent[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function makeSnapshot(w: World, events: SimEvent[], ack: number): Snapshot {
  const b = w.boss;
  return {
    tick: w.tick,
    ack,
    ships: w.ships.map((s) => [
      r1(s.x), r1(s.y), r2(s.angle),
      (s.anchor ? 1 : 0) | (s.thrust ? 2 : 0),
      r1(s.vx), r1(s.vy), r2(Math.max(0, s.invuln)), r2(Math.max(0, s.boost)),
    ]) as [ShipSnap, ShipSnap],
    ast: w.asteroids.map((a) => [a.id, r1(a.x), r1(a.y), r1(a.r), r2(a.rot)]),
    pl: w.planets.map((p) => [p.x, p.y, p.r, r2(p.grow), p.kind]),
    en: w.enemies.map((e) => [
      e.id, e.kind === 'drone' ? 0 : 1, r1(e.x), r1(e.y), e.r, r2(e.angle),
      e.kind === 'drone' && e.entered && e.timer < C.DRONE_TELEGRAPH ? 1 : 0,
    ]),
    bl: w.bullets.map((bl) => [bl.id, r1(bl.x), r1(bl.y)]),
    boss: b ? [r1(b.x), r1(b.y), r2(b.angle), r1(b.hp), b.maxHp, BOSS_STATES.indexOf(b.state), r2(b.wrap), b.squeezing ? 1 : 0] : null,
    linked: w.linked,
    tension: r2(w.tension),
    hull: w.hull,
    score: w.score,
    wave: w.wave,
    combo: w.combo,
    phase: w.phase,
    ev: events,
  };
}

// ------------------------------------------------------------ View state

/** What the renderer needs — no matter whether we're host or client. */
export interface ViewShip {
  x: number;
  y: number;
  angle: number;
  anchor: boolean;
  thrust: boolean;
  invuln: boolean;
  boost: boolean;
}
export interface ViewPlanet { x: number; y: number; r: number; grow: number; kind: number }
export interface ViewAsteroid { id: number; x: number; y: number; r: number; rot: number }
export interface ViewEnemy { id: number; kind: EnemyKind; x: number; y: number; r: number; angle: number; charging: boolean }
export interface ViewBullet { id: number; x: number; y: number }
export interface ViewBoss {
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  state: BossState;
  /** wrap progress, -1..1 (one full wrap = ±1) */
  wrap: number;
  squeezing: boolean;
}
export interface ViewState {
  ships: [ViewShip, ViewShip];
  asteroids: ViewAsteroid[];
  planets: ViewPlanet[];
  enemies: ViewEnemy[];
  bullets: ViewBullet[];
  boss: ViewBoss | null;
  linked: boolean;
  tension: number;
  hull: number;
  score: number;
  wave: number;
  combo: number;
  phase: Phase;
}

function shipFromSnap(s: ShipSnap): ViewShip {
  return { x: s[0], y: s[1], angle: s[2], anchor: !!(s[3] & 1), thrust: !!(s[3] & 2), invuln: s[6] > 0, boost: s[7] > 0 };
}

export function viewFromWorld(w: World): ViewState {
  const b = w.boss;
  return {
    ships: w.ships.map((s) => ({
      x: s.x, y: s.y, angle: s.angle, anchor: s.anchor, thrust: s.thrust, invuln: s.invuln > 0, boost: s.boost > 0,
    })) as [ViewShip, ViewShip],
    asteroids: w.asteroids.map((a) => ({ id: a.id, x: a.x, y: a.y, r: a.r, rot: a.rot })),
    planets: w.planets.map((p) => ({ x: p.x, y: p.y, r: p.r, grow: p.grow, kind: p.kind })),
    enemies: w.enemies.map((e) => ({
      id: e.id, kind: e.kind, x: e.x, y: e.y, r: e.r, angle: e.angle,
      charging: e.kind === 'drone' && e.entered && e.timer < C.DRONE_TELEGRAPH,
    })),
    bullets: w.bullets.map((bl) => ({ id: bl.id, x: bl.x, y: bl.y })),
    boss: b ? { x: b.x, y: b.y, angle: b.angle, hp: b.hp, maxHp: b.maxHp, state: b.state, wrap: b.wrap / (Math.PI * 2), squeezing: b.squeezing } : null,
    linked: w.linked,
    tension: w.tension,
    hull: w.hull,
    score: w.score,
    wave: w.wave,
    combo: w.combo,
    phase: w.phase,
  };
}

/**
 * Buffers snapshots and renders slightly in the past (delayMs), so we can
 * always interpolate between two known states.
 */
export class SnapshotBuffer {
  private buf: { t: number; s: Snapshot }[] = [];
  constructor(private delayMs = 80) {}

  push(s: Snapshot, now = performance.now()): void {
    this.buf.push({ t: now, s });
    if (this.buf.length > 30) this.buf.shift();
  }

  get latest(): Snapshot | undefined {
    return this.buf[this.buf.length - 1]?.s;
  }

  /** time (performance.now) at which the latest snapshot arrived */
  get latestTime(): number {
    return this.buf[this.buf.length - 1]?.t ?? 0;
  }

  sample(now = performance.now()): ViewState | undefined {
    if (this.buf.length === 0) return undefined;
    const target = now - this.delayMs;
    let i = this.buf.length - 1;
    while (i > 0 && this.buf[i - 1].t > target) i--;
    const b = this.buf[i];
    const a = this.buf[i - 1];
    if (!a || b.t <= target) return toView(b.s, b.s, 1);
    const k = Math.max(0, Math.min(1, (target - a.t) / (b.t - a.t)));
    return toView(a.s, b.s, k);
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Calls fn for every entry of `next`, paired with the entry of the same id in `prev` (if any). */
function lerpById<T extends number[]>(prev: T[], next: T[], fn: (p: T | undefined, n: T) => void) {
  const map = new Map(prev.map((x) => [x[0], x]));
  for (const n of next) fn(map.get(n[0]), n);
}

function toView(a: Snapshot, b: Snapshot, k: number): ViewState {
  const ships = b.ships.map((sb, i) => {
    const sa = a.ships[i];
    const v = shipFromSnap(sb);
    v.x = lerp(sa[0], sb[0], k);
    v.y = lerp(sa[1], sb[1], k);
    v.angle = lerpAngle(sa[2], sb[2], k);
    return v;
  }) as [ViewShip, ViewShip];

  const asteroids: ViewAsteroid[] = [];
  lerpById(a.ast, b.ast, (p, [id, x, y, r, rot]) => {
    asteroids.push(p ? { id, x: lerp(p[1], x, k), y: lerp(p[2], y, k), r, rot: lerpAngle(p[4], rot, k) } : { id, x, y, r, rot });
  });

  const enemies: ViewEnemy[] = [];
  lerpById(a.en, b.en, (p, [id, kind, x, y, r, angle, charging]) => {
    enemies.push({
      id, kind: kind === 0 ? 'drone' : 'jelly', r, charging: !!charging,
      x: p ? lerp(p[2], x, k) : x, y: p ? lerp(p[3], y, k) : y, angle: p ? lerpAngle(p[5], angle, k) : angle,
    });
  });

  const bullets: ViewBullet[] = [];
  lerpById(a.bl, b.bl, (p, [id, x, y]) => {
    bullets.push({ id, x: p ? lerp(p[1], x, k) : x, y: p ? lerp(p[2], y, k) : y });
  });

  const planets = b.pl.map(([x, y, r, grow, kind], i) => {
    const p = a.pl[i];
    return { x, y, r, kind, grow: p && p[0] === x && p[1] === y ? lerp(p[3], grow, k) : grow };
  });

  let boss: ViewBoss | null = null;
  if (b.boss) {
    const [x, y, angle, hp, maxHp, state, wrap, squeezing] = b.boss;
    const p = a.boss;
    boss = {
      x: p ? lerp(p[0], x, k) : x, y: p ? lerp(p[1], y, k) : y, angle: p ? lerpAngle(p[2], angle, k) : angle,
      hp, maxHp, state: BOSS_STATES[state], wrap: wrap / (Math.PI * 2), squeezing: !!squeezing,
    };
  }

  return {
    ships, asteroids, planets, enemies, bullets, boss,
    linked: b.linked,
    tension: lerp(a.tension, b.tension, k),
    hull: b.hull,
    score: b.score,
    wave: b.wave,
    combo: b.combo,
    phase: b.phase,
  };
}
