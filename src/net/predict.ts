// Client-side prediction for your own ship.
//
// Without it, your inputs travel to the host and back before you see your ship move
// (a full round trip + interpolation delay). With it, the client simulates its own ship
// immediately using the same physics as the host, and corrects itself whenever a
// snapshot arrives: it resets to the host's state and replays all inputs the host
// hasn't processed yet. Small differences are smoothed out instead of snapping.

import * as C from '../sim/constants';
import {
  applyRopeForce, bounceOffWalls, collideShipWithPlanets, gravityAt, integrateShip, makeShip,
} from '../sim/physics';
import type { Snapshot } from '../sim/snapshot';
import type { Planet, PlayerInput, Ship } from '../sim/types';

const DT = 1 / C.TICK_RATE;

export class Predictor {
  /** predicted state of our own ship (null until the first snapshot) */
  private ship: Ship | null = null;
  private partner: Ship = makeShip(0, 0);
  /** when the partner state was received (performance.now) */
  private partnerTime = 0;
  private planets: Planet[] = [];
  private linked = true;
  private active = true;
  private history: { seq: number; input: PlayerInput }[] = [];
  /** visual correction offset that fades out */
  private offX = 0;
  private offY = 0;

  constructor(private readonly me: number) {}

  /** One fixed tick with our current input. */
  step(seq: number, input: PlayerInput): void {
    this.history.push({ seq, input });
    if (this.history.length > 240) this.history.shift();
    if (!this.ship) return;
    const age = Math.min(0.25, (performance.now() - this.partnerTime) / 1000);
    this.simulate(this.ship, input, age);
  }

  /** A snapshot arrived: rewind to the host's state and replay unacknowledged inputs. */
  reconcile(snap: Snapshot): void {
    const before = this.ship ? this.display() : null;

    const s = snap.ships[this.me];
    const p = snap.ships[1 - this.me];
    const ship = makeShip(s[0], s[1]);
    Object.assign(ship, { angle: s[2], anchor: !!(s[3] & 1), thrust: !!(s[3] & 2), vx: s[4], vy: s[5], invuln: s[6], boost: s[7] });
    Object.assign(this.partner, { x: p[0], y: p[1], angle: p[2], anchor: !!(p[3] & 1), vx: p[4], vy: p[5] });
    this.partnerTime = performance.now();
    this.planets = snap.pl.map(([x, y, r, grow, kind]) => ({
      x, y, r, kind, grow, dying: false, g: C.PLANET_SURFACE_G * Math.sqrt(r / 70),
    }));
    this.linked = snap.linked;
    this.active = snap.phase !== 'over';

    this.history = this.history.filter((h) => h.seq > snap.ack);
    let age = 0;
    for (const h of this.history) {
      this.simulate(ship, h.input, age);
      age += DT;
    }
    this.ship = ship;

    // Keep what's on screen continuous: the jump becomes an offset that fades out
    if (before) {
      this.offX = before.x - ship.x;
      this.offY = before.y - ship.y;
      if (Math.hypot(this.offX, this.offY) > C.PREDICTION_SNAP_DIST) {
        this.offX = 0;
        this.offY = 0;
      }
    }
  }

  private simulate(ship: Ship, input: PlayerInput, partnerAge: number) {
    // partner position extrapolated from its last known velocity
    const partner = { ...this.partner, x: this.partner.x + this.partner.vx * partnerAge, y: this.partner.y + this.partner.vy * partnerAge };
    const [ax, ay] = gravityAt(this.planets, ship.x, ship.y);
    ship.vx += ax * DT;
    ship.vy += ay * DT;
    integrateShip(ship, this.active ? input : { x: 0, y: 0, anchor: false }, DT);
    if (this.linked && this.active) applyRopeForce(ship, partner, DT, true);
    bounceOffWalls(ship, C.SHIP_RADIUS);
    collideShipWithPlanets(ship, this.planets);
  }

  /** Fades out the correction offset; call once per rendered frame. */
  update(deltaMs: number): void {
    const k = Math.exp(-C.PREDICTION_SMOOTHING * deltaMs / 1000);
    this.offX *= k;
    this.offY *= k;
  }

  /** The predicted ship as it should be drawn, or null before the first snapshot. */
  display(): (Ship & { x: number; y: number }) | null {
    if (!this.ship) return null;
    return { ...this.ship, x: this.ship.x + this.offX, y: this.ship.y + this.offY };
  }
}
