// Verbindungsaufbau. Standard: WebRTC über PeerJS (funktioniert zwischen
// zwei verschiedenen GitHub-Pages-URLs). Für die Entwicklung gibt es mit
// ?local im URL einen BroadcastChannel-Transport: zwei Tabs im selben
// Browser, kein Internet nötig.

import Peer, { type DataConnection } from 'peerjs';
import { PROTOCOL_VERSION } from '../sim/constants';
import { type Link, type Msg, randomRoomCode } from './protocol';

/** Präfix, damit sich unsere IDs auf dem öffentlichen PeerJS-Server nicht mit anderen beißen. */
const PEER_PREFIX = 'tethered-in-space-';

export interface HostedRoom {
  code: string;
  /** Wartet auf den Mitspieler; resolved nach erfolgreichem Handshake. */
  guest: Promise<Link>;
  cancel(): void;
}

const useLocalTransport = () => new URLSearchParams(location.search).has('local');

export function hostRoom(): Promise<HostedRoom> {
  return useLocalTransport() ? hostLocal() : hostPeer();
}

export function joinRoom(code: string): Promise<Link> {
  return useLocalTransport() ? joinLocal(code) : joinPeer(code);
}

// ------------------------------------------------------------- Handshake

/** Host-Seite: erster Nachricht muss ein passendes hello sein. */
function acceptHandshake(link: Link, timeoutMs = 8000): Promise<Link> {
  return new Promise((resolve, reject) => {
    const timer = timeoutMs ? setTimeout(() => reject(new Error('Handshake-Timeout')), timeoutMs) : undefined;
    link.onMessage((m) => {
      if (m.t !== 'hello') return;
      clearTimeout(timer);
      if (m.v !== PROTOCOL_VERSION) {
        link.send({ t: 'reject', reason: `Version passt nicht (Host v${PROTOCOL_VERSION}, du v${m.v}). Beide Seiten neu laden / updaten.` });
        setTimeout(() => link.close(), 300);
        reject(new Error('Versionskonflikt'));
        return;
      }
      link.send({ t: 'welcome', v: PROTOCOL_VERSION });
      resolve(link);
    });
  });
}

/** Client-Seite */
function doHandshake(link: Link): Promise<Link> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Keine Antwort vom Host')), 8000);
    link.onMessage((m) => {
      if (m.t === 'welcome') { clearTimeout(timer); resolve(link); }
      if (m.t === 'reject') { clearTimeout(timer); link.close(); reject(new Error(m.reason)); }
    });
    link.send({ t: 'hello', v: PROTOCOL_VERSION });
  });
}

// ------------------------------------------------------------- PeerJS

function wrapConnection(conn: DataConnection, onDispose: () => void): Link {
  let msgCb: (m: Msg) => void = () => {};
  let closeCb: () => void = () => {};
  let closed = false;
  const fireClose = () => {
    if (closed) return;
    closed = true;
    closeCb();
    onDispose();
  };
  conn.on('data', (d) => msgCb(d as Msg));
  conn.on('close', fireClose);
  conn.on('error', fireClose);
  // ICE-Verbindung bricht weg (z.B. Tab zu, WLAN weg) – 'close' kommt da nicht immer
  conn.peerConnection?.addEventListener('iceconnectionstatechange', () => {
    const s = conn.peerConnection?.iceConnectionState;
    if (s === 'failed' || s === 'closed') fireClose();
  });
  return {
    send: (m) => { if (conn.open) conn.send(m); },
    onMessage: (cb) => { msgCb = cb; },
    onClose: (cb) => { closeCb = cb; },
    close: () => { conn.close(); fireClose(); },
  };
}

function peerErrorText(err: { type?: string; message?: string }): string {
  switch (err.type) {
    case 'peer-unavailable': return 'Raum nicht gefunden. Code richtig?';
    case 'network':
    case 'server-error':
    case 'socket-error': return 'Signaling-Server nicht erreichbar (Internet/Firewall?).';
    case 'browser-incompatible': return 'Dein Browser unterstützt kein WebRTC.';
    default: return err.message ?? String(err.type ?? err);
  }
}

function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    peer.once('open', () => resolve(peer));
    peer.once('error', (e) => { peer.destroy(); reject(e); });
  });
}

async function hostPeer(): Promise<HostedRoom> {
  let peer: Peer | undefined;
  let code = '';
  for (let attempt = 0; attempt < 5 && !peer; attempt++) {
    code = randomRoomCode();
    try {
      peer = await openPeer(PEER_PREFIX + code);
    } catch (e) {
      const err = e as { type?: string };
      if (err.type !== 'unavailable-id') throw new Error(peerErrorText(err));
    }
  }
  if (!peer) throw new Error('Konnte keinen Raum erstellen.');
  const p = peer;

  let cancelled = false;
  const guest = new Promise<Link>((resolve, reject) => {
    p.on('connection', (conn) => {
      conn.on('open', async () => {
        let accepted = false;
        const link = wrapConnection(conn, () => { if (accepted) p.destroy(); });
        try {
          const ok = await acceptHandshake(link);
          accepted = true;
          resolve(ok);
          // Nach dem ersten Spieler keine weiteren annehmen
          p.disconnect();
        } catch (e) {
          // falscher Client (z.B. alte Version) – weiter auf den nächsten warten
          console.warn(e);
        }
      });
    });
    p.on('error', (e) => { if (!cancelled) reject(new Error(peerErrorText(e))); });
  });

  return { code, guest, cancel: () => { cancelled = true; p.destroy(); } };
}

async function joinPeer(code: string): Promise<Link> {
  let peer: Peer;
  try {
    peer = await openPeer();
  } catch (e) {
    throw new Error(peerErrorText(e as { type?: string }));
  }
  const link = await new Promise<Link>((resolve, reject) => {
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    const timer = setTimeout(() => { peer.destroy(); reject(new Error('Verbindung dauert zu lange (NAT/Firewall?).')); }, 15000);
    conn.on('open', () => { clearTimeout(timer); resolve(wrapConnection(conn, () => peer.destroy())); });
    peer.on('error', (e) => { clearTimeout(timer); peer.destroy(); reject(new Error(peerErrorText(e))); });
  });
  return doHandshake(link);
}

// ------------------------------------------------------------- BroadcastChannel (Dev)

function channelLink(room: string, me: 'host' | 'guest'): Link {
  const ch = new BroadcastChannel('tethered-' + room);
  const other = me === 'host' ? 'guest' : 'host';
  let msgCb: (m: Msg) => void = () => {};
  let closeCb: () => void = () => {};
  let lastSeen = 0; // 0 = Gegenseite noch nie gehört
  let closed = false;
  const fireClose = (why = '?') => {
    if (closed) return;
    console.info('[local-link] closed:', why);
    closed = true;
    clearInterval(hb);
    ch.close();
    closeCb();
  };
  ch.onmessage = (e) => {
    const { from, m } = e.data as { from: string; m: Msg | 'bye' | 'hb' };
    if (from !== other) return;
    lastSeen = performance.now();
    if (m === 'bye') fireClose('bye');
    else if (m !== 'hb') msgCb(m);
  };
  // Heartbeat, um geschlossene Tabs zu erkennen. Großzügig, weil Browser
  // Timer in Hintergrund-Tabs drosseln.
  const hb = setInterval(() => {
    ch.postMessage({ from: me, m: 'hb' });
    if (lastSeen && performance.now() - lastSeen > 10000) fireClose('timeout');
  }, 500);
  addEventListener('beforeunload', () => ch.postMessage({ from: me, m: 'bye' }));
  return {
    send: (m) => { if (!closed) ch.postMessage({ from: me, m }); },
    onMessage: (cb) => { msgCb = cb; },
    onClose: (cb) => { closeCb = cb; },
    close: () => { if (!closed) ch.postMessage({ from: me, m: 'bye' }); fireClose('local close'); },
  };
}

async function hostLocal(): Promise<HostedRoom> {
  const code = randomRoomCode();
  const link = channelLink(code, 'host');
  return { code, guest: acceptHandshake(link, 0), cancel: () => link.close() };
}

async function joinLocal(code: string): Promise<Link> {
  return doHandshake(channelLink(code, 'guest'));
}
