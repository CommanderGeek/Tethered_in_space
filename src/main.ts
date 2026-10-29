import Phaser from 'phaser';
import './style.css';
import * as C from './sim/constants';
import { GameScene } from './scenes/GameScene';
import { Session } from './session';
import { hostRoom, joinRoom, type HostedRoom } from './net/net';
import { normalizeCode } from './net/protocol';
import { toggleMute, unlockAudio } from './render/sfx';
import { isTouchDevice, quality, QUALITY_LABELS } from './render/quality';
import { touch } from './input/touch';

// ------------------------------------------------------------ Phaser

const scene = new GameScene();
// Zum Debuggen in der Browser-Konsole: __tethered.scene
if (import.meta.env.DEV) Object.assign(window, { __tethered: { scene } });

async function boot() {
  // Schrift laden, bevor Phaser Texte rendert (sonst Fallback-Font im HUD)
  try {
    await Promise.race([document.fonts.load('700 20px Orbitron'), new Promise((r) => setTimeout(r, 1500))]);
  } catch { /* egal */ }

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: C.WORLD_W,
    height: C.WORLD_H,
    // transparent: der Hintergrund (Nebel) liegt per CSS hinter dem Canvas
    transparent: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene,
    render: { antialias: true, powerPreference: 'high-performance' },
    // eigene Touch-Steuerung im DOM, Phaser braucht kein Multi-Touch
    input: { activePointers: 1 },
    fps: { smoothStep: true },
  });
}
void boot();

// ------------------------------------------------------------ Menü

const overlay = document.getElementById('overlay')!;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Screen = 'main' | 'hosting' | 'join' | 'message' | 'over';

let session: Session | undefined;
let pendingRoom: HostedRoom | undefined;
/** wird bei jedem Zurück-zum-Menü erhöht, damit alte async-Vorgänge nichts mehr anzeigen */
let generation = 0;

function show(screen: Screen | null) {
  overlay.classList.toggle('hidden', screen === null);
  document.body.classList.toggle('playing', screen === null);
  overlay.querySelectorAll<HTMLElement>('[data-screen]').forEach((el) => {
    el.hidden = el.dataset.screen !== screen;
  });
  if (screen === 'join') setTimeout(() => $<HTMLInputElement>('join-code').focus(), 50);
}

function message(title: string, text: string, canGoBack = true) {
  $('msg-title').textContent = title;
  $('msg-text').textContent = text;
  $('msg-back').hidden = !canGoBack;
  show('message');
}

function backToMenu() {
  generation++;
  pendingRoom?.cancel();
  pendingRoom = undefined;
  session?.dispose();
  session = undefined;
  scene.startDemo();
  history.replaceState(null, '', location.pathname + location.search);
  show('main');
}

function startGame(s: Session) {
  session = s;
  scene.startSession(s, {
    onGameOver(score, wave) {
      $('final-score').textContent = score.toLocaleString('de-DE');
      $('final-wave').textContent = `Ihr habt Welle ${wave} erreicht.`;
      show('over');
    },
    onDisconnect() {
      session = undefined;
      message('Verbindung verloren', 'Dein Mitspieler ist weg. Vielleicht Tab geschlossen oder Internet weg.');
      scene.startDemo();
    },
  });
  show(null);
}

async function host() {
  const gen = generation;
  message('Erstelle Raum …', 'Verbinde mit dem Signaling-Server.', false);
  try {
    const room = await hostRoom();
    if (gen !== generation) return room.cancel();
    pendingRoom = room;
    $('room-code').textContent = room.code;
    show('hosting');
    const link = await room.guest;
    if (gen !== generation) return link.close();
    pendingRoom = undefined;
    startGame(new Session('host', link));
  } catch (e) {
    if (gen !== generation) return; // abgebrochen
    message('Hat nicht geklappt', (e as Error).message);
  }
}

async function join(raw: string) {
  const code = normalizeCode(raw);
  if (code.length < 4) return;
  const gen = generation;
  message('Verbinde …', `Suche Raum ${code}.`, true);
  try {
    const link = await joinRoom(code);
    if (gen !== generation) return link.close();
    startGame(new Session('client', link));
  } catch (e) {
    if (gen !== generation) return;
    message('Beitreten fehlgeschlagen', (e as Error).message);
  }
}

function inviteLink(code: string) {
  return `${location.origin}${location.pathname}${location.search}#join=${code}`;
}

async function copy(text: string, btn: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Kopiert ✓';
    setTimeout(() => (btn.textContent = old), 1200);
  } catch {
    prompt('Kopieren:', text);
  }
}

/** Auf dem Handy: Vollbild + Querformat sperren (geht nur direkt nach einem Tipp) */
async function goFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch { /* iOS Safari kann kein Fullscreen-API – egal */ }
}

overlay.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!btn) return;
  unlockAudio();
  if (isTouchDevice() && ['host', 'show-join', 'restart'].includes(btn.dataset.action ?? '')) void goFullscreen();
  switch (btn.dataset.action) {
    case 'host': void host(); break;
    case 'show-join': show('join'); break;
    case 'local': startGame(new Session('local')); break;
    case 'back': backToMenu(); break;
    case 'leave': backToMenu(); break;
    case 'restart':
      scene.restart();
      show(null);
      break;
    case 'copy-code': void copy($('room-code').textContent ?? '', btn); break;
    case 'copy-link': void copy(inviteLink($('room-code').textContent ?? ''), btn); break;
  }
});

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  unlockAudio();
  if (isTouchDevice()) void goFullscreen();
  void join($<HTMLInputElement>('join-code').value);
});
$<HTMLInputElement>('join-code').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  el.value = normalizeCode(el.value);
});

// ------------------------------------------------------------ Toolbar, Handy

if (isTouchDevice()) document.body.classList.add('touch');
touch.mount($('touch'));

const qualityBtn = $('quality');
const updateQualityLabel = () => {
  const lvl = quality.setting === 'auto' ? ` (${QUALITY_LABELS[quality.level]})` : '';
  qualityBtn.textContent = `Grafik: ${QUALITY_LABELS[quality.setting]}${lvl}`;
};
updateQualityLabel();
quality.onChange(updateQualityLabel);
qualityBtn.addEventListener('click', () => { quality.cycle(); updateQualityLabel(); });

const fsBtn = $('fullscreen');
if (!document.fullscreenEnabled) fsBtn.hidden = true;
fsBtn.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void goFullscreen();
});

const menuBtn = $('menu-btn');
menuBtn.addEventListener('click', () => { if (session) backToMenu(); });

const muteBtn = $('mute');
const flipMute = () => muteBtn.classList.toggle('off', toggleMute());
muteBtn.addEventListener('click', flipMute);
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'm' && !(e.target instanceof HTMLInputElement)) flipMute();
  if (e.key === 'Escape' && session && overlay.classList.contains('hidden')) backToMenu();
});

// Einladungslink: …/#join=ABCDE
const hashCode = new URLSearchParams(location.hash.slice(1)).get('join');
if (hashCode) {
  $<HTMLInputElement>('join-code').value = normalizeCode(hashCode);
  show('join');
} else {
  show('main');
}

$('version').textContent = `v${__APP_VERSION__} · Protokoll ${C.PROTOCOL_VERSION}`;
