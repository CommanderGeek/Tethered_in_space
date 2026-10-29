import type { PlayerInput } from '../sim/sim';
import type { Snapshot } from '../sim/snapshot';

export type Msg =
  | { t: 'hello'; v: number }
  | { t: 'welcome'; v: number }
  | { t: 'reject'; reason: string }
  | { t: 'input'; i: PlayerInput }
  | { t: 'snap'; s: Snapshot }
  | { t: 'restart' }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number };

/** Eine bestehende Verbindung zum anderen Spieler – egal welcher Transport. */
export interface Link {
  send(msg: Msg): void;
  onMessage(cb: (msg: Msg) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/** Ohne 0/O/1/I/L – lässt sich gut vorlesen */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomRoomCode(len = 5): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
