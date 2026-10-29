// Kompaktes Netzwerkformat für den Weltzustand + Interpolation auf dem Client.

import type { Phase, SimEvent, World } from './sim';
import { lerpAngle } from './sim';

/** [x, y, angle, flags]  flags: 1=anchor 2=thrust 4=invuln 8=boost */
export type ShipSnap = [number, number, number, number];
/** [id, x, y, r, rot] */
export type AstSnap = [number, number, number, number, number];
/** [x, y, r, grow, kind] */
export type PlanetSnap = [number, number, number, number, number];

export interface Snapshot {
  tick: number;
  ships: [ShipSnap, ShipSnap];
  ast: AstSnap[];
  pl: PlanetSnap[];
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

export function makeSnapshot(w: World, events: SimEvent[]): Snapshot {
  return {
    tick: w.tick,
    ships: w.ships.map((s) => [
      r1(s.x),
      r1(s.y),
      r2(s.angle),
      (s.anchor ? 1 : 0) | (s.thrust ? 2 : 0) | (s.invuln > 0 ? 4 : 0) | (s.boost > 0 ? 8 : 0),
    ]) as [ShipSnap, ShipSnap],
    ast: w.asteroids.map((a) => [a.id, r1(a.x), r1(a.y), r1(a.r), r2(a.rot)]),
    pl: w.planets.map((p) => [p.x, p.y, p.r, r2(p.grow), p.kind]),
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

/** Das, was der Renderer braucht – egal ob Host oder Client. */
export interface ViewShip {
  x: number;
  y: number;
  angle: number;
  anchor: boolean;
  thrust: boolean;
  invuln: boolean;
  boost: boolean;
}
export interface ViewPlanet {
  x: number;
  y: number;
  r: number;
  grow: number;
  kind: number;
}
export interface ViewAsteroid {
  id: number;
  x: number;
  y: number;
  r: number;
  rot: number;
}
export interface ViewState {
  ships: [ViewShip, ViewShip];
  asteroids: ViewAsteroid[];
  planets: ViewPlanet[];
  linked: boolean;
  tension: number;
  hull: number;
  score: number;
  wave: number;
  combo: number;
  phase: Phase;
}

function shipFromSnap(s: ShipSnap): ViewShip {
  return { x: s[0], y: s[1], angle: s[2], anchor: !!(s[3] & 1), thrust: !!(s[3] & 2), invuln: !!(s[3] & 4), boost: !!(s[3] & 8) };
}

export function viewFromWorld(w: World): ViewState {
  return {
    ships: w.ships.map((s) => ({
      x: s.x, y: s.y, angle: s.angle, anchor: s.anchor, thrust: s.thrust, invuln: s.invuln > 0, boost: s.boost > 0,
    })) as [ViewShip, ViewShip],
    asteroids: w.asteroids.map((a) => ({ id: a.id, x: a.x, y: a.y, r: a.r, rot: a.rot })),
    planets: w.planets.map((p) => ({ x: p.x, y: p.y, r: p.r, grow: p.grow, kind: p.kind })),
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
 * Puffert Snapshots und rendert leicht in der Vergangenheit (INTERP_DELAY),
 * damit immer zwischen zwei bekannten Zuständen interpoliert werden kann.
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

function toView(a: Snapshot, b: Snapshot, k: number): ViewState {
  const ships = b.ships.map((sb, i) => {
    const sa = a.ships[i];
    const v = shipFromSnap(sb);
    v.x = lerp(sa[0], sb[0], k);
    v.y = lerp(sa[1], sb[1], k);
    v.angle = lerpAngle(sa[2], sb[2], k);
    return v;
  }) as [ViewShip, ViewShip];

  const prev = new Map(a.ast.map((x) => [x[0], x]));
  const asteroids = b.ast.map(([id, x, y, r, rot]) => {
    const p = prev.get(id);
    if (!p) return { id, x, y, r, rot };
    return { id, x: lerp(p[1], x, k), y: lerp(p[2], y, k), r, rot: lerpAngle(p[4], rot, k) };
  });

  const planets = b.pl.map(([x, y, r, grow, kind], i) => {
    const p = a.pl[i];
    return { x, y, r, kind, grow: p && p[0] === x && p[1] === y ? lerp(p[3], grow, k) : grow };
  });

  return {
    ships,
    asteroids,
    planets,
    linked: b.linked,
    tension: lerp(a.tension, b.tension, k),
    hull: b.hull,
    score: b.score,
    wave: b.wave,
    combo: b.combo,
    phase: b.phase,
  };
}
