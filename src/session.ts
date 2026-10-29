// Verbindet Simulation und Netzwerk. Der Renderer fragt nur view() ab und
// bekommt Events – er weiß nicht, ob er Host, Client oder lokal ist.

import * as C from './sim/constants';
import { createWorld, NO_INPUT, step, type PlayerInput, type SimEvent, type World } from './sim/sim';
import { makeSnapshot, SnapshotBuffer, viewFromWorld, type ViewState } from './sim/snapshot';
import type { Link } from './net/protocol';

export type Mode = 'local' | 'host' | 'client';

const STEP_MS = 1000 / C.TICK_RATE;

export class Session {
  /** Index des eigenen Schiffs (lokal: -1 = beide) */
  readonly me: number;
  private world?: World;
  private acc = 0;
  private remoteInput: PlayerInput = NO_INPUT;
  private pendingEvents: SimEvent[] = [];
  private buffer = new SnapshotBuffer(80);
  private lastSentInput = '';
  private lastInputSend = 0;
  private eventCb: (e: SimEvent) => void = () => {};
  private disconnectCb: () => void = () => {};
  private pingTimer = 0;
  /** Round-Trip-Zeit in ms (nur online) */
  rtt = 0;

  constructor(readonly mode: Mode, private link?: Link) {
    this.me = mode === 'host' ? 0 : mode === 'client' ? 1 : -1;
    if (mode !== 'client') this.world = createWorld();

    if (link) {
      link.onMessage((m) => {
        switch (m.t) {
          case 'input': this.remoteInput = m.i; break;
          case 'snap':
            this.buffer.push(m.s);
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
   * @param inputs lokal: [P1, P2]; online: [eigener Input]
   */
  update(dtMs: number, inputs: PlayerInput[]): void {
    if (this.mode === 'client') {
      this.sendInput(inputs[0]);
      return;
    }

    const w = this.world!;
    const pair: [PlayerInput, PlayerInput] =
      this.mode === 'local' ? [inputs[0], inputs[1]] : [inputs[0], this.remoteInput];

    // Fester Zeitschritt: gleiche Physik egal bei welcher Framerate
    this.acc += Math.min(dtMs, 250);
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      step(w, pair, STEP_MS / 1000);
      for (const e of w.events) {
        this.eventCb(e);
        this.pendingEvents.push(e);
      }
      w.events.length = 0;

      if (this.link && w.tick % C.SNAPSHOT_EVERY === 0) {
        this.link.send({ t: 'snap', s: makeSnapshot(w, this.pendingEvents) });
        this.pendingEvents = [];
      }
    }
  }

  private sendInput(i: PlayerInput): void {
    const key = `${i.x.toFixed(2)},${i.y.toFixed(2)},${i.anchor}`;
    const now = performance.now();
    // bei Änderung sofort, sonst alle 100ms als Keep-Alive
    if (key !== this.lastSentInput || now - this.lastInputSend > 100) {
      this.link!.send({ t: 'input', i });
      this.lastSentInput = key;
      this.lastInputSend = now;
    }
  }

  view(): ViewState | undefined {
    return this.world ? viewFromWorld(this.world) : this.buffer.sample();
  }

  /** Client bittet den Host um Neustart, Host/lokal startet direkt neu */
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
