import type { PlayerInput } from '../sim/types';
import type { Snapshot } from '../sim/snapshot';

export type Msg =
  | { t: 'hello'; v: number }
  | { t: 'welcome'; v: number }
  | { t: 'reject'; reason: string }
  /** sent by the client every tick; seq lets the host acknowledge it for prediction */
  | { t: 'input'; i: PlayerInput; seq: number }
  | { t: 'snap'; s: Snapshot }
  | { t: 'restart' }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number };

/** An established connection to the other player — regardless of transport. */
export interface Link {
  send(msg: Msg): void;
  onMessage(cb: (msg: Msg) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/** No 0/O/1/I/L — easy to read out loud */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomRoomCode(len = 5): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
