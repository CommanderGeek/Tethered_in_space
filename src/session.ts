// Glues simulation and networking together. The renderer only calls view() and
// receives events — it doesn't know whether it's the host, the client or local.

import * as C from './sim/constants';
import { createWorld, step, type World } from './sim/sim';
import { NO_INPUT, type PlayerInput, type SimEvent } from './sim/types';
import { makeSnapshot, SnapshotBuffer, viewFromWorld, type ViewState } from './sim/snapshot';
import type { Link } from './net/protocol';
import { Predictor } from './net/predict';

export type Mode = 'local' | 'host' | 'client';

const STEP_MS = 1000 / C.TICK_RATE;
/** host drops queued client inputs beyond this to keep latency low */
const MAX_INPUT_QUEUE = 6;

export class Session {
  /** index of our own ship (local: -1 = both) */
  readonly me: number;
  private world?: World;
  private acc = 0;
  private pendingEvents: SimEvent[] = [];
  private eventCb: (e: SimEvent) => void = () => {};
  private disconnectCb: () => void = () => {};
  private pingTimer = 0;
  /** round-trip time in ms (online only) */
  rtt = 0;

  // host side: queue of client inputs, applied one per tick
  private remoteQueue: { i: PlayerInput; seq: number }[] = [];
  private remoteInput: PlayerInput = NO_INPUT;
  private remoteAck = 0;

  // client side
  private buffer = new SnapshotBuffer(80);
  private predictor?: Predictor;
  private seq = 0;

  constructor(readonly mode: Mode, private link?: Link) {
    this.me = mode === 'host' ? 0 : mode === 'client' ? 1 : -1;
    if (mode !== 'client') this.world = createWorld();
    if (mode === 'client') this.predictor = new Predictor(this.me);

    if (link) {
      link.onMessage((m) => {
        switch (m.t) {
          case 'input':
            this.remoteQueue.push({ i: m.i, seq: m.seq });
            if (this.remoteQueue.length > MAX_INPUT_QUEUE) this.remoteQueue.splice(0, this.remoteQueue.length - 2);
            break;
          case 'snap':
            this.buffer.push(m.s);
            this.predictor?.reconcile(m.s);
            for (const e of m.s.ev) this.eventCb(e);
            break;
          case 'ping': link.send({ t: 'pong', at: m.at }); break;
          case 'pong': this.rtt = performance.now() - m.at; break;
          case 'restart': this.restart(); break;
        }
      });
      link.onClose(() => this.disconnectCb());
      this.pingTimer = window.setInterval(() => link.send({ t: 'ping', at: performance.now() }), 1000);
    }
  }

  onEvent(cb: (e: SimEvent) => void) { this.eventCb = cb; }
  onDisconnect(cb: () => void) { this.disconnectCb = cb; }

  get isAuthority() { return this.mode !== 'client'; }

  /**
   * @param inputs local: [P1, P2]; online: [our own input]
   */
  update(dtMs: number, inputs: PlayerInput[]): void {
    // fixed timestep: identical physics at any frame rate
    this.acc += Math.min(dtMs, 250);
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      if (this.mode === 'client') this.clientTick(inputs[0]);
      else this.hostTick(inputs);
    }
    this.predictor?.update(dtMs);
  }

  private clientTick(input: PlayerInput) {
    this.seq++;
    this.link!.send({ t: 'input', i: input, seq: this.seq });
    this.predictor!.step(this.seq, input);
  }

  private hostTick(inputs: PlayerInput[]) {
    const w = this.world!;
    if (this.mode === 'host') {
      const next = this.remoteQueue.shift();
      if (next) {
        this.remoteInput = next.i;
        this.remoteAck = next.seq;
      }
    }
    const pair: [PlayerInput, PlayerInput] =
      this.mode === 'local' ? [inputs[0], inputs[1]] : [inputs[0], this.remoteInput];

    step(w, pair, STEP_MS / 1000);
    for (const e of w.events) {
      this.eventCb(e);
      this.pendingEvents.push(e);
    }
    w.events.length = 0;

    if (this.link && w.tick % C.SNAPSHOT_EVERY === 0) {
      this.link.send({ t: 'snap', s: makeSnapshot(w, this.pendingEvents, this.remoteAck) });
      this.pendingEvents = [];
    }
  }

  view(): ViewState | undefined {
    if (this.world) return viewFromWorld(this.world);
    const v = this.buffer.sample();
    // our own ship comes from the prediction, everything else is interpolated
    const own = this.predictor?.display();
    if (v && own && v.phase !== 'over') {
      const s = v.ships[this.me];
      Object.assign(s, { x: own.x, y: own.y, angle: own.angle, anchor: own.anchor, thrust: own.thrust });
    }
    return v;
  }

  /** The client asks the host to restart; host/local restart directly */
  restart(): void {
    if (!this.isAuthority) { this.link?.send({ t: 'restart' }); return; }
    this.world = createWorld();
    this.acc = 0;
  }

  dispose(): void {
    this.disconnectCb = () => {};
    this.eventCb = () => {};
    clearInterval(this.pingTimer);
    this.link?.close();
  }
}
