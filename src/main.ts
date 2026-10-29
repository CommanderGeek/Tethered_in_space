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
import { lastTeamName, loadHighscores, qualifies, saveHighscore } from './highscores';

// ------------------------------------------------------------ Phaser

const scene = new GameScene();
// for debugging in the browser console: __tethered.scene
if (import.meta.env.DEV) Object.assign(window, { __tethered: { scene } });

async function boot() {
  // load the font before Phaser renders text (otherwise the HUD uses a fallback font)
  try {
    await Promise.race([document.fonts.load('700 20px Orbitron'), new Promise((r) => setTimeout(r, 1500))]);
  } catch { /* ignore */ }

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: C.WORLD_W,
    height: C.WORLD_H,
    // transparent: the background (nebula) is CSS behind the canvas
    transparent: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene,
    render: { antialias: true, powerPreference: 'high-performance' },
    // own touch controls in the DOM, Phaser doesn't need multi-touch
    input: { activePointers: 1 },
    fps: { smoothStep: true },
  });
}
void boot();

// ------------------------------------------------------------ Menu

const overlay = document.getElementById('overlay')!;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Screen = 'main' | 'hosting' | 'join' | 'message' | 'over' | 'scores';

let session: Session | undefined;
let pendingRoom: HostedRoom | undefined;
/** bumped on every return to the menu, so stale async operations don't show anything */
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
      $('final-score').textContent = score.toLocaleString('en-US');
      $('final-wave').textContent = `You reached wave ${wave}.`;
      pendingScore = { score, wave, mode: s.mode === 'local' ? 'local' : 'online' };
      const form = $('score-form');
      form.hidden = !qualifies(score);
      $('score-saved').hidden = true;
      $<HTMLInputElement>('team-name').value = lastTeamName();
      show('over');
    },
    onRestarted() {
      show(null);
    },
    onDisconnect() {
      session = undefined;
      message('Connection lost', 'The other player is gone. Maybe they closed the tab or lost their internet connection.');
      scene.startDemo();
    },
  });
  show(null);
}

async function host() {
  const gen = generation;
  message('Creating room …', 'Connecting to the signaling server.', false);
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
    if (gen !== generation) return; // cancelled
    message('That didn\'t work', (e as Error).message);
  }
}

async function join(raw: string) {
  const code = normalizeCode(raw);
  if (code.length < 4) return;
  const gen = generation;
  message('Connecting …', `Looking for room ${code}.`, true);
  try {
    const link = await joinRoom(code);
    if (gen !== generation) return link.close();
    startGame(new Session('client', link));
  } catch (e) {
    if (gen !== generation) return;
    message('Could not join', (e as Error).message);
  }
}

function inviteLink(code: string) {
  return `${location.origin}${location.pathname}${location.search}#join=${code}`;
}

async function copy(text: string, btn: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => (btn.textContent = old), 1200);
  } catch {
    prompt('Copy:', text);
  }
}

/** On phones: fullscreen + lock landscape (only allowed right after a tap) */
async function goFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch { /* iOS Safari has no fullscreen API — ignore */ }
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
    case 'show-scores': renderScores(); show('scores'); break;
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

// ------------------------------------------------------------ Toolbar, phone

if (isTouchDevice()) document.body.classList.add('touch');
touch.mount($('touch'));

const qualityBtn = $('quality');
const updateQualityLabel = () => {
  const lvl = quality.setting === 'auto' ? ` (${QUALITY_LABELS[quality.level]})` : '';
  qualityBtn.textContent = `Graphics: ${QUALITY_LABELS[quality.setting]}${lvl}`;
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

// invite link: …/#join=ABCDE
const hashCode = new URLSearchParams(location.hash.slice(1)).get('join');
if (hashCode) {
  $<HTMLInputElement>('join-code').value = normalizeCode(hashCode);
  show('join');
} else {
  show('main');
}

$('version').textContent = `v${__APP_VERSION__} · protocol ${C.PROTOCOL_VERSION}`;

// ------------------------------------------------------------ Highscores

let pendingScore: { score: number; wave: number; mode: 'online' | 'local' } | undefined;

$('score-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!pendingScore) return;
  const team = $<HTMLInputElement>('team-name').value.trim().slice(0, 20) || 'Nameless crew';
  const rank = saveHighscore({ team, ...pendingScore, date: new Date().toISOString() });
  pendingScore = undefined;
  $('score-form').hidden = true;
  const saved = $('score-saved');
  saved.textContent = rank ? `Saved — rank #${rank}!` : 'Saved.';
  saved.hidden = false;
});

function renderScores() {
  const list = loadHighscores();
  const ol = $('score-list');
  ol.replaceChildren(
    ...list.map((h) => {
      const li = document.createElement('li');
      const team = document.createElement('span');
      team.className = 'team';
      team.textContent = h.team; // textContent: team names are user input
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `wave ${h.wave} · ${new Date(h.date).toLocaleDateString()}`;
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = h.score.toLocaleString('en-US');
      li.append(team, meta, score);
      return li;
    }),
  );
  $('score-empty').hidden = list.length > 0;
}
