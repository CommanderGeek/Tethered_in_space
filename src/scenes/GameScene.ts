import Phaser from 'phaser';
import * as C from '../sim/constants';
import { planetRadius, type PlayerInput, type SimEvent } from '../sim/sim';
import { EntityRenderer } from '../render/entities';
import type { ViewPlanet, ViewState } from '../sim/snapshot';
import { Session } from '../session';
import { sfx } from '../render/sfx';
import { ASTEROID_RADIUS_IN_TEX, ASTEROID_VARIANTS, PLANET_DIAM, createTextures } from '../render/textures';
import { quality, isTouchDevice, type QualityProfile } from '../render/quality';
import { touch } from '../input/touch';

export const SHIP_COLORS = [0x3ef3ff, 0xff4fd8] as const;
const BOOST_COLOR = 0xffc94a;
const HOT_COLOR = 0xff4646;
const SHIP_SCALE = 0.52; // texture ~90px long -> ~47px in game
const PLANET_ATMO_TINT = [0xffaa66, 0x88ccff, 0xff6633, 0x88ffaa];

type KeyMap = {
  up: Phaser.Input.Keyboard.Key[]; down: Phaser.Input.Keyboard.Key[];
  left: Phaser.Input.Keyboard.Key[]; right: Phaser.Input.Keyboard.Key[]; anchor: Phaser.Input.Keyboard.Key[];
};

export interface SceneHooks {
  onGameOver(score: number, wave: number): void;
  /** a new round started (e.g. the other player pressed "Play again") */
  onRestarted(): void;
  onDisconnect(): void;
}

interface ShipGfx {
  glow: Phaser.GameObjects.Image;
  flame: Phaser.GameObjects.Image;
  body: Phaser.GameObjects.Image;
  shield: Phaser.GameObjects.Image;
}

/** Colour mix without allocations (runs many times per frame) */
const lerpColor = (a: number, b: number, t: number) => {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return ((r & 255) << 16) | ((g & 255) << 8) | (bl & 255);
};

function setTextIfChanged(t: Phaser.GameObjects.Text, value: string) {
  if (t.text !== value) t.setText(value);
}

interface PlanetGfx {
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  ripples: Phaser.GameObjects.Image[];
  zone: Phaser.GameObjects.Image;
}

export class GameScene extends Phaser.Scene {
  private session?: Session;
  private demo = true;
  private hooks?: SceneHooks;

  // layers (back to front)
  private bg!: Phaser.GameObjects.Layer;
  private worldBack!: Phaser.GameObjects.Layer;
  private worldMid!: Phaser.GameObjects.Layer;
  private worldFront!: Phaser.GameObjects.Layer;
  private hud!: Phaser.GameObjects.Layer;

  /** moving stars/dust as individual small sprites (instead of full-screen tile sprites) */
  private stars: { img: Phaser.GameObjects.Image; x: number; y: number }[] = [];
  private dust: { img: Phaser.GameObjects.Image; x: number; y: number }[] = [];
  private glints: Phaser.GameObjects.Image[] = [];
  private fpsText!: Phaser.GameObjects.Text;
  private showFps = new URLSearchParams(location.search).has('debug');
  private prof: QualityProfile = quality.profile;
  private trailAcc = 0;
  private gBack!: Phaser.GameObjects.Graphics; // warning arrows
  private gTether!: Phaser.GameObjects.Graphics; // additive
  private gFront!: Phaser.GameObjects.Graphics; // anchor rings, markers
  private gFx!: Phaser.GameObjects.Graphics; // additive: tentacles, wrap ring, telegraphs
  private entities!: EntityRenderer;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossLabel!: Phaser.GameObjects.Text;
  private bossKey = '';

  private shipGfx: ShipGfx[] = [];
  private asteroidImgs = new Map<number, Phaser.GameObjects.Image>();
  private planetImgs = new Map<string, PlanetGfx>();

  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private debris!: Phaser.GameObjects.Particles.ParticleEmitter;
  private embers!: Phaser.GameObjects.Particles.ParticleEmitter;
  private trails: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private boostTrail!: Phaser.GameObjects.Particles.ParticleEmitter;

  private hullBar!: Phaser.GameObjects.Graphics;
  private hullLabel!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private scoreLabel!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private subBanner!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private netText!: Phaser.GameObjects.Text;

  private keysP1!: KeyMap;
  private keysP2!: KeyMap;
  private keysAny!: KeyMap;
  private lastView?: ViewState;
  private overShown = false;
  private shownScore = 0;
  private lastSlingPop = 0;
  private hullKey = -1;

  constructor() {
    super('game');
  }

  // ============================================================ Setup

  create() {
    createTextures(this, SHIP_COLORS);

    // The canvas is transparent (background is CSS). Phaser's default ADD blend uses
    // DST_ALPHA, which produces invalid premultiplied pixels over transparent areas
    // (dark boxes around glows in some browsers). Plain ONE/ONE stays valid.
    if (this.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      const gl = this.renderer.gl;
      // (Phaser types say Function, but the renderer expects the GL factor array)
      this.renderer.updateBlendMode(Phaser.BlendModes.ADD, [gl.ONE, gl.ONE, gl.ONE, gl.ONE] as unknown as Function, gl.FUNC_ADD as unknown as Function);
    }

    this.bg = this.add.layer();
    this.worldBack = this.add.layer();
    this.worldMid = this.add.layer();
    this.worldFront = this.add.layer();
    this.hud = this.add.layer();

    const ui = this.cameras.add(0, 0, C.WORLD_W, C.WORLD_H);
    this.cameras.main.ignore(this.hud);
    ui.ignore([this.bg, this.worldBack, this.worldMid, this.worldFront]);
    this.makeBackground();
    this.applyQuality(quality.profile);
    quality.onChange((p) => this.applyQuality(p));

    this.gBack = this.add.graphics();
    this.gTether = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.gFront = this.add.graphics();
    this.gFx = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);

    this.makeParticles();
    this.makeShips();

    // order: planets & fields at the back, asteroids/enemies, trails, tether, ships, sparks
    this.worldBack.add([this.gBack]);
    this.worldMid.add([this.gFx, ...this.trails, this.boostTrail]);
    this.entities = new EntityRenderer(this, this.worldMid, this.gFx);
    this.worldFront.add([this.gTether]);
    for (const s of this.shipGfx) this.worldFront.add([s.glow, s.flame, s.body, s.shield]);
    this.worldFront.add([this.gFront, this.debris, this.embers, this.sparks]);

    this.makeHud();
    this.makeKeys();
    this.startDemo();
  }

  /** Turn effects on/off depending on the quality level */
  private applyQuality(p: QualityProfile) {
    this.prof = p;
    const cam = this.cameras.main;
    if (this.renderer.type === Phaser.WEBGL) {
      cam.postFX.clear();
      // bloom is by far the most expensive effect (several blur passes over the whole image)
      if (p.bloom) cam.postFX.addBloom(0xffffff, 1, 1, 1, 1.1, 2);
    }
    // vignette via CSS (no shader pass)
    document.body.classList.toggle('vignette', p.vignette);
    for (const s of this.stars) s.img.setVisible(p.parallaxStars);
    for (const d of this.dust) d.img.setVisible(p.extraBackground);
    for (const gfx of this.planetImgs.values()) {
      gfx.glow.setVisible(p.planetFx);
      for (const r of gfx.ripples) r.setVisible(p.planetFx);
    }
    for (const g of this.glints) g.setVisible(p.extraBackground);
  }

  private makeBackground() {
    // Nebula + static stars + border live as a CSS background behind the (transparent) canvas.
    // The browser's compositor draws that almost for free — saves a full-screen image per frame.
    const neb = this.textures.get('nebula').getSourceImage() as HTMLCanvasElement;
    neb.toBlob((blob) => {
      if (!blob) return;
      const c = this.game.canvas;
      c.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
      c.style.backgroundSize = '100% 100%';
    });
    for (let i = 0; i < 50; i++) {
      const img = this.add.image(0, 0, 'dot')
        .setScale(0.08 + Math.random() * 0.1)
        .setTint([0xffffff, 0xcfe6ff, 0xffe9d6, 0xd9d0ff][i % 4])
        .setAlpha(0.6 + Math.random() * 0.4);
      this.stars.push({ img, x: Math.random() * C.WORLD_W, y: Math.random() * C.WORLD_H });
      this.bg.add(img);
    }

    // twinkling stars
    for (let i = 0; i < 22; i++) {
      const s = this.add.image(Math.random() * C.WORLD_W, Math.random() * C.WORLD_H, 'glint')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.2 + Math.random() * 0.35)
        .setTint([0xffffff, 0xcfe6ff, 0xffe2c4, 0xd9d0ff][i % 4])
        .setAlpha(0.2);
      this.bg.add(s);
      this.glints.push(s);
      this.tweens.add({
        targets: s, alpha: { from: 0.15, to: 0.85 }, scale: s.scale * 1.25,
        duration: 900 + Math.random() * 2200, yoyo: true, repeat: -1, delay: Math.random() * 3000, ease: 'Sine.InOut',
      });
    }

    // foreground dust
    for (let i = 0; i < 16; i++) {
      const img = this.add.image(0, 0, 'dot').setScale(0.25 + Math.random() * 0.35).setTint(0xb4c8ff).setAlpha(0.18);
      this.dust.push({ img, x: Math.random() * C.WORLD_W, y: Math.random() * C.WORLD_H });
      this.bg.add(img);
    }

    // occasional shooting stars
    this.time.addEvent({ delay: 3500, loop: true, callback: () => { if (this.prof.extraBackground && Math.random() < 0.55) this.shootingStar(); } });
  }

  private shootingStar() {
    const x = Math.random() * C.WORLD_W;
    const y = Math.random() * C.WORLD_H * 0.5;
    const ang = Math.PI * (0.15 + Math.random() * 0.2) * (Math.random() < 0.5 ? 1 : -1) + (Math.random() < 0.5 ? 0 : Math.PI);
    const len = 180 + Math.random() * 160;
    const streak = this.add.image(x, y, 'flame')
      .setRotation(ang + Math.PI).setOrigin(1, 0.5).setScale(len / 128, 0.12)
      .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.bg.add(streak);
    this.tweens.add({
      targets: streak, x: x + Math.cos(ang) * 420, y: y + Math.sin(ang) * 420,
      alpha: { from: 0.9, to: 0 }, duration: 750, ease: 'Quad.In', onComplete: () => streak.destroy(),
    });
  }

  private makeParticles() {
    this.sparks = this.add.particles(0, 0, 'dot', {
      speed: { min: 80, max: 460 }, scale: { start: 0.55, end: 0 }, lifespan: { min: 250, max: 700 },
      blendMode: 'ADD', emitting: false,
    });
    this.embers = this.add.particles(0, 0, 'dot', {
      speed: { min: 20, max: 120 }, scale: { start: 0.35, end: 0 }, alpha: { start: 1, end: 0 },
      lifespan: { min: 600, max: 1400 }, blendMode: 'ADD', emitting: false, tint: [0xffd27a, 0xff8a3d, 0xffffff],
    });
    this.debris = this.add.particles(0, 0, 'shard', {
      speed: { min: 40, max: 240 }, scale: { start: 1.1, end: 0.2 }, alpha: { start: 1, end: 0 },
      rotate: { min: 0, max: 360 }, lifespan: { min: 600, max: 1400 }, tint: [0x7d6fb0, 0xb9a8ff, 0x4b4070, 0x9a8ccc],
      emitting: false,
    });
    this.trails = SHIP_COLORS.map((tint) =>
      this.add.particles(0, 0, 'dot', {
        tint, speed: { min: 5, max: 40 }, scale: { start: 0.45, end: 0 }, alpha: { start: 0.9, end: 0 },
        lifespan: 420, blendMode: 'ADD', emitting: false,
      }),
    );
    this.boostTrail = this.add.particles(0, 0, 'dot', {
      tint: [BOOST_COLOR, 0xffffff, 0xff9d3d], speed: { min: 0, max: 30 }, scale: { start: 0.7, end: 0 },
      alpha: { start: 1, end: 0 }, lifespan: 700, blendMode: 'ADD', emitting: false,
    });
  }

  private makeShips() {
    this.shipGfx = SHIP_COLORS.map((col, i) => ({
      glow: this.add.image(0, 0, 'glow').setTint(col).setBlendMode(Phaser.BlendModes.ADD).setScale(0.75).setAlpha(0.55),
      flame: this.add.image(0, 0, 'flame').setOrigin(1, 0.5).setTint(col).setBlendMode(Phaser.BlendModes.ADD),
      body: this.add.image(0, 0, `ship${i}`).setScale(SHIP_SCALE),
      shield: this.add.image(0, 0, 'shield').setTint(col).setBlendMode(Phaser.BlendModes.ADD).setScale(0.55).setVisible(false),
    }));
  }

  private makeHud() {
    const font = 'Orbitron, system-ui, sans-serif';
    const label = { fontFamily: font, fontSize: '12px', color: '#7f89c4' };
    this.hullBar = this.add.graphics();
    this.hullLabel = this.add.text(40, 26, 'HULL', label).setLetterSpacing(3);
    this.scoreLabel = this.add.text(C.WORLD_W - 40, 26, 'SCORE', label).setOrigin(1, 0).setLetterSpacing(3);
    this.scoreText = this.add.text(C.WORLD_W - 40, 42, '0', { fontFamily: font, fontSize: '34px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(1, 0);
    this.comboText = this.add.text(C.WORLD_W - 40, 84, '', { fontFamily: font, fontSize: '20px', color: '#ffd166', fontStyle: 'bold' }).setOrigin(1, 0);
    this.waveText = this.add.text(C.WORLD_W / 2, 30, '', { fontFamily: font, fontSize: '18px', color: '#9fb3ff' }).setOrigin(0.5, 0).setLetterSpacing(6);
    this.banner = this.add.text(C.WORLD_W / 2, C.WORLD_H * 0.26, '', { fontFamily: font, fontSize: '76px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5).setAlpha(0).setStroke('#141a4a', 10).setLetterSpacing(8);
    this.subBanner = this.add.text(C.WORLD_W / 2, C.WORLD_H * 0.26 + 64, '', { fontFamily: font, fontSize: '20px', color: '#b8c4ff' })
      .setOrigin(0.5).setAlpha(0).setLetterSpacing(4);
    this.hint = this.add.text(40, C.WORLD_H - 36, '', { fontFamily: font, fontSize: '14px', color: '#7f89c4' }).setOrigin(0, 1);
    this.netText = this.add.text(C.WORLD_W - 40, C.WORLD_H - 36, '', { fontFamily: font, fontSize: '13px', color: '#5d6596' }).setOrigin(1, 1);
    this.fpsText = this.add.text(C.WORLD_W / 2, C.WORLD_H - 36, '', { fontFamily: 'monospace', fontSize: '14px', color: '#9fffb0' }).setOrigin(0.5, 1);
    this.bossBar = this.add.graphics();
    this.bossLabel = this.add.text(C.WORLD_W / 2, 58, 'LEVIATHAN', { fontFamily: font, fontSize: '13px', color: '#9ff7ff' })
      .setOrigin(0.5, 0).setLetterSpacing(6).setVisible(false);
    this.hud.add([this.fpsText, this.bossBar, this.bossLabel]);
    this.hud.add([this.hullBar, this.hullLabel, this.scoreLabel, this.scoreText, this.comboText, this.waveText, this.banner, this.subBanner, this.hint, this.netText]);
  }

  private makeKeys() {
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    const k = (...codes: number[]) => codes.map((c) => kb.addKey(c, true, false));
    this.keysP1 = { up: k(K.W), down: k(K.S), left: k(K.A), right: k(K.D), anchor: k(K.SPACE) };
    this.keysP2 = { up: k(K.UP), down: k(K.DOWN), left: k(K.LEFT), right: k(K.RIGHT), anchor: k(K.ENTER, K.NUMPAD_ZERO) };
    this.keysAny = {
      up: [...this.keysP1.up, ...this.keysP2.up], down: [...this.keysP1.down, ...this.keysP2.down],
      left: [...this.keysP1.left, ...this.keysP2.left], right: [...this.keysP1.right, ...this.keysP2.right],
      anchor: [...this.keysP1.anchor, ...this.keysP2.anchor, ...k(K.SHIFT)],
    };
    kb.on('keydown', (e: KeyboardEvent) => {
      if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      if (e.key === 'F3' || e.key === 'f') this.showFps = !this.showFps;
    });
  }

  // ============================================================ Session control

  startSession(session: Session, hooks: SceneHooks) {
    this.session?.dispose();
    this.session = session;
    this.hooks = hooks;
    this.demo = false;
    this.overShown = false;
    this.shownScore = 0;
    session.onEvent((e) => this.handleEvent(e));
    session.onDisconnect(() => this.hooks?.onDisconnect());
    this.hint.setText(
      isTouchDevice() && session.mode !== 'local'
        ? ''
        : session.mode === 'local'
          ? 'P1: WASD + SPACE to anchor     P2: ARROWS + ENTER to anchor'
          : 'WASD / ARROWS to fly     SPACE / SHIFT to anchor',
    );
    touch.setVisible(isTouchDevice() && session.mode !== 'local');
    this.netText.setText('');
  }

  startDemo() {
    this.session?.dispose();
    this.session = new Session('local');
    this.session.onEvent((e) => this.handleEvent(e, true));
    this.demo = true;
    this.hooks = undefined;
    touch.setVisible(false);
    this.hint.setText('');
    this.netText.setText('');
  }

  restart() {
    this.overShown = false;
    this.shownScore = 0;
    this.session?.restart();
  }

  // ============================================================ Loop

  update(_time: number, delta: number) {
    const s = this.session;
    if (!s) return;
    quality.tick(delta, this.time.now);
    if (this.showFps) setTextIfChanged(this.fpsText, `${Math.round(quality.fps)} FPS · ${quality.level}${quality.setting === 'auto' ? ' (auto)' : ''}`);
    this.fpsText.setVisible(this.showFps);

    if (this.demo) s.update(delta, this.demoInputs());
    else if (s.mode === 'local') s.update(delta, [this.readKeys(this.keysP1), this.readKeys(this.keysP2)]);
    else {
      // combine keyboard and touch
      const k = this.readKeys(this.keysAny);
      const t = touch.read();
      s.update(delta, [{ x: Phaser.Math.Clamp(k.x + t.x, -1, 1), y: Phaser.Math.Clamp(k.y + t.y, -1, 1), anchor: k.anchor || t.anchor }]);
      setTextIfChanged(this.netText, s.rtt ? `PING ${Math.round(s.rtt)} ms` : '');
    }

    const v = s.view();
    if (!v) return;
    this.lastView = v;
    if (this.demo && v.phase === 'over') s.restart();

    this.drawBackground(v);
    this.gBack.clear();
    this.gFront.clear();
    this.gTether.clear();
    this.drawPlanets(v);
    this.drawAsteroids(v);
    this.gFx.clear();
    this.entities.draw(v);
    this.drawTether(v);
    this.drawShips(v);
    this.drawHud(v, delta);

    if (!this.demo && v.phase === 'over' && !this.overShown) {
      this.overShown = true;
      this.time.delayedCall(1400, () => { if (this.lastView?.phase === 'over') this.hooks?.onGameOver(v.score, v.wave); });
    } else if (!this.demo && v.phase !== 'over' && this.overShown) {
      // the other player restarted the game
      this.overShown = false;
      this.shownScore = 0;
      this.hooks?.onRestarted();
    }
  }

  private readKeys(m: KeyMap): PlayerInput {
    const down = (ks: Phaser.Input.Keyboard.Key[]) => ks.some((k) => k.isDown);
    return {
      x: (down(m.right) ? 1 : 0) - (down(m.left) ? 1 : 0),
      y: (down(m.down) ? 1 : 0) - (down(m.up) ? 1 : 0),
      anchor: down(m.anchor),
    };
  }

  /** Menu demo: ship 0 anchors roughly in the middle, ship 1 swings around it */
  private demoInputs(): PlayerInput[] {
    const v = this.lastView;
    if (!v) return [{ x: 0, y: 0, anchor: true }, { x: 0, y: 0, anchor: false }];
    const [a, b] = v.ships;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    if (!v.linked) return [{ x: dx / d, y: dy / d, anchor: false }, { x: -dx / d, y: -dy / d, anchor: false }];
    // anchor point: a free spot away from planets
    let tx = C.WORLD_W / 2;
    let ty = C.WORLD_H / 2;
    for (const p of v.planets) {
      if (Math.hypot(p.x - tx, p.y - ty) < p.r + 380) { tx = p.x < C.WORLD_W / 2 ? C.WORLD_W * 0.72 : C.WORLD_W * 0.28; }
    }
    const cx = tx - a.x;
    const cy = ty - a.y;
    const cd = Math.hypot(cx, cy) || 1;
    const pull = cd > 60 ? 0.8 : 0;
    return [
      { x: (cx / cd) * pull, y: (cy / cd) * pull, anchor: cd < 120 },
      { x: -dy / d - (dx / d) * 0.35, y: dx / d - (dy / d) * 0.35, anchor: false },
    ];
  }

  // ============================================================ Drawing

  private drawBackground(v: ViewState) {
    const mx = (v.ships[0].x + v.ships[1].x) / 2 - C.WORLD_W / 2;
    const my = (v.ships[0].y + v.ships[1].y) / 2 - C.WORLD_H / 2;
    const t = this.time.now;
    if (!this.prof.parallaxStars) return;
    const wrap = (v: number, m: number) => ((v % m) + m) % m;
    for (const s of this.stars) {
      s.img.setPosition(wrap(s.x - mx * 0.06 - t * 0.008, C.WORLD_W), wrap(s.y - my * 0.06, C.WORLD_H));
    }
    if (!this.prof.extraBackground) return;
    for (const d of this.dust) {
      d.img.setPosition(wrap(d.x - mx * 0.18 - t * 0.02, C.WORLD_W), wrap(d.y - my * 0.18 - t * 0.006, C.WORLD_H));
    }
  }

  private drawPlanets(v: ViewState) {
    const seen = new Set<string>();
    const t = this.time.now / 1000;

    for (const p of v.planets) {
      const key = `${p.x},${p.y},${p.kind}`;
      seen.add(key);
      let gfx = this.planetImgs.get(key);
      const col = PLANET_ATMO_TINT[p.kind];
      if (!gfx) {
        const glow = this.add.image(p.x, p.y, 'glow').setTint(col).setBlendMode(Phaser.BlendModes.ADD);
        // gravity ripples + slingshot zone as ready-made textures (instead of computing circles every frame)
        const ripples = [0, 1, 2].map(() => this.add.image(p.x, p.y, 'thinring').setTint(col).setBlendMode(Phaser.BlendModes.ADD));
        const zone = this.add.image(p.x, p.y, 'dashring').setTint(BOOST_COLOR).setBlendMode(Phaser.BlendModes.ADD);
        const img = this.add.image(p.x, p.y, `planet${p.kind}`);
        this.worldBack.add([glow, ...ripples, zone, img]);
        this.worldBack.bringToTop(this.gBack);
        gfx = { img, glow, ripples, zone };
        glow.setVisible(this.prof.planetFx);
        for (const r of ripples) r.setVisible(this.prof.planetFx);
        this.planetImgs.set(key, gfx);
        if (p.grow < 0.5) this.planetSpawnFx(p);
      }
      const R = planetRadius(p);
      const grow = Phaser.Math.Clamp(p.grow, 0, 1);
      gfx.img.setScale(R / (PLANET_DIAM / 2)).setAlpha(Phaser.Math.Clamp(p.grow * 2, 0, 1));
      gfx.glow.setScale((R * 4.2) / 128).setAlpha(0.22 * grow);

      // rings flow inwards
      const range = R * 3.4;
      gfx.ripples.forEach((r, i) => {
        const ph = (t * 0.25 + i / 3) % 1;
        const rr = range - ph * (range - R * 1.1);
        r.setScale(rr / 124).setAlpha(Math.sin(ph * Math.PI) * 0.12 * grow);
      });
      gfx.zone.setScale((p.r * C.SLING_ZONE) / 250).setRotation(t * 0.15).setAlpha(0.2 * grow);
    }
    for (const [key, gfx] of this.planetImgs) {
      if (!seen.has(key)) {
        for (const o of [gfx.img, gfx.glow, gfx.zone, ...gfx.ripples]) o.destroy();
        this.planetImgs.delete(key);
      }
    }
  }

  private planetSpawnFx(p: ViewPlanet) {
    const ring = this.add.image(p.x, p.y, 'ring').setTint(PLANET_ATMO_TINT[p.kind]).setBlendMode(Phaser.BlendModes.ADD).setScale(0.2);
    this.worldBack.add(ring);
    this.tweens.add({ targets: ring, scale: (p.r * 3) / 64, alpha: { from: 0.8, to: 0 }, duration: 1300, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
    if (!this.demo) sfx.planet();
  }

  private drawAsteroids(v: ViewState) {
    const alive = new Set<number>();
    const g = this.gBack;
    for (const ast of v.asteroids) {
      alive.add(ast.id);
      let img = this.asteroidImgs.get(ast.id);
      if (!img) {
        img = this.add.image(ast.x, ast.y, `ast${ast.id % ASTEROID_VARIANTS}`);
        this.worldMid.add(img);
        this.asteroidImgs.set(ast.id, img);
      }
      img.setPosition(ast.x, ast.y).setRotation(ast.rot).setScale(ast.r / ASTEROID_RADIUS_IN_TEX);

      const onScreen = ast.x > -ast.r && ast.x < C.WORLD_W + ast.r && ast.y > -ast.r && ast.y < C.WORLD_H + ast.r;
      if (!onScreen) {
        // warning arrow at the edge
        const ex = Phaser.Math.Clamp(ast.x, 34, C.WORLD_W - 34);
        const ey = Phaser.Math.Clamp(ast.y, 34, C.WORLD_H - 34);
        const ang = Math.atan2(ast.y - ey, ast.x - ex);
        const pulse = 0.55 + Math.sin(this.time.now / 120) * 0.25;
        g.fillStyle(0xff6b6b, pulse);
        g.fillTriangle(
          ex + Math.cos(ang) * 13, ey + Math.sin(ang) * 13,
          ex + Math.cos(ang + 2.4) * 10, ey + Math.sin(ang + 2.4) * 10,
          ex + Math.cos(ang - 2.4) * 10, ey + Math.sin(ang - 2.4) * 10,
        );
      }
    }
    for (const [id, img] of this.asteroidImgs) {
      if (!alive.has(id)) {
        img.destroy();
        this.asteroidImgs.delete(id);
      }
    }
  }

  private drawTether(v: ViewState) {
    const g = this.gTether;
    const [a, b] = v.ships;
    const t = this.time.now / 1000;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d;
    const ny = dx / d;

    if (!v.linked) {
      if (v.phase === 'over') return;
      // dashed guide line towards reconnecting
      const near = Phaser.Math.Clamp(1 - (d - C.ROPE_RELINK_DIST) / 600, 0.15, 1);
      const n = Math.floor(d / 16);
      g.lineStyle(2, 0x8899cc, 0.4 * near);
      for (let i = 0; i < n; i += 2) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        g.lineBetween(a.x + dx * t0, a.y + dy * t0, a.x + dx * t1, a.y + dy * t1);
      }
      return;
    }

    // sag when the tether is slack (gentle wave)
    const slack = Math.max(0, C.ROPE_LENGTH - d);
    const sag = Math.sqrt(slack * C.ROPE_LENGTH) * 0.22 * Math.sin(t * 2.2);
    const N = this.prof.tetherSegments;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const bulge = Math.sin(u * Math.PI) * sag + Math.sin(u * Math.PI * 3 + t * 6) * slack * 0.03;
      pts.push({ x: a.x + dx * u + nx * bulge, y: a.y + dy * u + ny * bulge });
    }

    const tension = v.tension;
    const flicker = tension > 0.7 ? 0.55 + Math.random() * 0.45 : 1;
    const boosted = v.ships[0].boost || v.ships[1].boost;
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      // gradient: player 1 colour -> bright -> player 2 colour, towards red under tension
      let col = u < 0.5 ? lerpColor(SHIP_COLORS[0], 0xe8f6ff, u * 2) : lerpColor(0xe8f6ff, SHIP_COLORS[1], (u - 0.5) * 2);
      if (boosted) col = lerpColor(col, BOOST_COLOR, 0.6);
      col = lerpColor(col, HOT_COLOR, tension * tension);
      const p0 = pts[i];
      const p1 = pts[i + 1];
      if (this.prof.tetherGlow) g.lineStyle(16, col, 0.07 * flicker).lineBetween(p0.x, p0.y, p1.x, p1.y);
      g.lineStyle(7, col, 0.25 * flicker).lineBetween(p0.x, p0.y, p1.x, p1.y);
      g.lineStyle(2.2, lerpColor(col, 0xffffff, 0.7), 0.95 * flicker).lineBetween(p0.x, p0.y, p1.x, p1.y);
    }

    // energy pulses run from both ends to the middle
    for (let k = 0; k < 3; k++) {
      const ph = (t * 0.9 + k / 3) % 1;
      for (const side of [0, 1]) {
        const u = side === 0 ? ph * 0.5 : 1 - ph * 0.5;
        const idx = Math.min(N - 1, Math.floor(u * N));
        const f = u * N - idx;
        const px = pts[idx].x + (pts[idx + 1].x - pts[idx].x) * f;
        const py = pts[idx].y + (pts[idx + 1].y - pts[idx].y) * f;
        const col = boosted ? BOOST_COLOR : SHIP_COLORS[side];
        const alpha = Math.sin(ph * Math.PI) * flicker;
        g.fillStyle(col, 0.35 * alpha).fillCircle(px, py, 6);
        g.fillStyle(0xffffff, 0.9 * alpha).fillCircle(px, py, 2.2);
      }
    }
  }

  private drawShips(v: ViewState) {
    const t = this.time.now;
    v.ships.forEach((s, i) => {
      const gfx = this.shipGfx[i];
      const col = s.boost ? BOOST_COLOR : SHIP_COLORS[i];
      const cos = Math.cos(s.angle);
      const sin = Math.sin(s.angle);
      const blink = s.invuln && Math.floor(t / 70) % 2 === 0;

      gfx.body.setPosition(s.x, s.y).setRotation(s.angle).setAlpha(blink ? 0.35 : 1);
      gfx.glow.setPosition(s.x, s.y).setTint(col).setScale(s.boost ? 1.1 : 0.75).setAlpha(s.boost ? 0.75 : 0.5);

      // flame behind the ship
      const rearX = s.x - cos * 19;
      const rearY = s.y - sin * 19;
      const thrusting = s.thrust && v.phase !== 'over';
      const len = thrusting ? (s.boost ? 0.75 : 0.45) + Math.random() * 0.15 : 0.12 + Math.random() * 0.04;
      gfx.flame.setPosition(rearX, rearY).setRotation(s.angle).setTint(col).setScale(len, thrusting ? 0.4 : 0.25).setAlpha(thrusting ? 1 : 0.6);

      // particle count depends on the quality level
      const n = this.trailCount(i);
      if (thrusting && n) this.trails[i].emitParticleAt(rearX, rearY, n);
      if (s.boost && n) this.boostTrail.emitParticleAt(rearX, rearY, n);

      gfx.shield.setVisible(s.invuln).setPosition(s.x, s.y).setAlpha(0.5 + Math.sin(t / 60) * 0.3);

      // anchor: rotating brackets
      if (s.anchor && v.phase !== 'over') {
        const R = 30 + Math.sin(t / 110) * 2;
        const rot = t / 400;
        this.gFront.lineStyle(3, SHIP_COLORS[i], 0.85);
        for (let k = 0; k < 4; k++) {
          const a0 = rot + (k * Math.PI) / 2;
          this.gFront.beginPath();
          this.gFront.arc(s.x, s.y, R, a0, a0 + 0.8);
          this.gFront.strokePath();
        }
        this.gFront.lineStyle(1, SHIP_COLORS[i], 0.3).strokeCircle(s.x, s.y, R + 7);
      }
    });

    // marker for your own ship (online)
    const me = this.session?.me ?? -1;
    if (!this.demo && me >= 0 && v.phase !== 'over') {
      const s = v.ships[me];
      const bob = Math.sin(t / 200) * 3;
      this.gFront.fillStyle(SHIP_COLORS[me], 0.9).fillTriangle(s.x - 6, s.y - 40 + bob, s.x + 6, s.y - 40 + bob, s.x, s.y - 32 + bob);
    }
  }

  /** returns 0..2 particles per frame, on average 2 * quality factor */
  private trailCount(i: number): number {
    if (i === 0) this.trailAcc += 2 * this.prof.particles;
    const n = Math.floor(this.trailAcc);
    if (i === 1) this.trailAcc -= n;
    return n;
  }

  private drawHud(v: ViewState, delta: number) {
    const show = !this.demo;
    for (const o of [this.scoreText, this.scoreLabel, this.comboText, this.waveText, this.hullLabel, this.hullBar]) o.setVisible(show);
    this.drawBossBar(show ? v.boss : null);
    if (!show) return;

    // segmented hull display — only redrawn when something changes
    const frac = v.hull / C.HULL_MAX;
    const blink = frac <= 0.25 && Math.floor(this.time.now / 250) % 2 === 0;
    const key = v.hull * 2 + (blink ? 1 : 0);
    if (key !== this.hullKey) {
      this.hullKey = key;
      this.hullBar.clear();
      const segs = 10;
      const w = 26;
      const gap = 4;
      const col = frac > 0.5 ? 0x3ef3a0 : frac > 0.25 ? 0xffd166 : 0xff4f4f;
      for (let i = 0; i < segs; i++) {
        const fill = Phaser.Math.Clamp(frac * segs - i, 0, 1);
        const x = 40 + i * (w + gap);
        this.hullBar.fillStyle(0xffffff, 0.07).fillRoundedRect(x, 44, w, 12, 3);
        if (fill > 0) this.hullBar.fillStyle(col, blink ? 0.45 : 0.95).fillRoundedRect(x, 44, w * fill, 12, 3);
      }
    }

    // score counts up instead of jumping
    this.shownScore += (v.score - this.shownScore) * Math.min(1, delta / 120);
    if (Math.abs(v.score - this.shownScore) < 1) this.shownScore = v.score;
    // setText re-renders the text texture — so only on change
    setTextIfChanged(this.scoreText, Math.round(this.shownScore).toLocaleString('en-US'));
    setTextIfChanged(this.comboText, v.combo > 1 ? `COMBO ×${v.combo}` : '');
    setTextIfChanged(this.waveText, v.wave > 0 ? `WAVE ${v.wave}` : '');
  }

  private drawBossBar(b: ViewState['boss']) {
    const visible = !!b && b.state !== 'dying';
    this.bossLabel.setVisible(visible);
    const key = visible ? `${Math.ceil(b!.hp)}|${b!.state}` : '';
    if (key === this.bossKey) return;
    this.bossKey = key;
    this.bossBar.clear();
    if (!visible) return;
    const w = 520;
    const x = C.WORLD_W / 2 - w / 2;
    const y = 78;
    const frac = Math.max(0, b!.hp / b!.maxHp);
    this.bossBar.fillStyle(0xffffff, 0.08).fillRoundedRect(x, y, w, 10, 5);
    this.bossBar.fillStyle(b!.state === 'stunned' ? 0xffe680 : 0x3fd6ff, 0.95).fillRoundedRect(x, y, Math.max(10, w * frac), 10, 5);
    this.bossBar.lineStyle(1, 0x9ff7ff, 0.4).strokeRoundedRect(x, y, w, 10, 5);
  }

  // ============================================================ Events (Juice)

  private handleEvent(e: SimEvent, quiet = false) {
    const play = !quiet;
    switch (e.k) {
      case 'cut': {
        this.burst(e.x, e.y, e.split ? 0xcfd8ff : 0xffffff, e.split ? 16 : 28);
        this.shockwave(e.x, e.y, e.r * 1.8, 0xb9c8ff);
        this.debris.explode(Math.round((e.r / 2.5) * this.prof.particles), e.x, e.y);
        if (!e.split) this.embers.explode(Math.round(14 * this.prof.particles), e.x, e.y);
        if (play) {
          if (e.split) sfx.cut(this.lastView?.combo ?? 1);
          else sfx.shatter();
          this.cameras.main.shake(90, e.split ? 0.003 : 0.006);
          this.popText(e.x, e.y, `+${e.pts}`, e.pts >= 50 ? '#ffd166' : '#ffe9b0');
        }
        break;
      }
      case 'hit':
        this.burst(e.x, e.y, 0xff5050, 26);
        this.shockwave(e.x, e.y, 50, 0xff5050);
        if (play) { sfx.hit(); this.cameras.main.shake(200, 0.012); this.cameras.main.flash(120, 120, 0, 0); }
        break;
      case 'bounce':
        if (play) sfx.bounce();
        break;
      case 'snap':
        this.burst(e.x, e.y, 0xff7070, 30);
        this.shockwave(e.x, e.y, 70, 0xff7070);
        if (play) { sfx.snap(); this.cameras.main.shake(140, 0.008); this.showBanner('TETHER SNAPPED', 'Fly close together to reconnect', 1100, '#ff8a8a', 46); }
        break;
      case 'link':
        this.burst(e.x, e.y, 0xaaf0ff, 18);
        this.shockwave(e.x, e.y, 60, 0xaaf0ff);
        if (play) sfx.link();
        break;
      case 'sling':
        this.shockwave(e.x, e.y, 70, BOOST_COLOR);
        this.embers.explode(18, e.x, e.y);
        // both ships often trigger at the same time: show it only once
        if (play && this.time.now - this.lastSlingPop > 500) {
          this.lastSlingPop = this.time.now;
          sfx.sling();
          this.popText(e.x, e.y - 20, 'SLINGSHOT! ×2', '#ffc94a', 24);
        }
        break;
      case 'impact':
        this.burst(e.x, e.y, 0xffa060, 24);
        this.embers.explode(22, e.x, e.y);
        this.shockwave(e.x, e.y, e.r * 2.2, 0xffa060);
        if (play) { sfx.impact(); this.cameras.main.shake(120, 0.004); }
        break;
      case 'wave':
        if (!play) break;
        if (e.boss) {
          sfx.bossWave();
          this.showBanner('LEVIATHAN', 'Squeeze it with the taut tether — orbit it together to wrap it up!', 2600, '#9ff7ff');
        } else {
          sfx.wave();
          const tips: Record<number, string> = {
            1: 'Fly fast past planets for a SLINGSHOT boost',
            2: 'Drones incoming — your tether blocks their shots',
            3: 'Jellyfish split when sliced — and they sting',
          };
          this.showBanner(`WAVE ${e.n}`, tips[e.n] ?? '', 1800);
        }
        break;
      case 'enemyKill':
        if (e.kind === 'drone') {
          this.burst(e.x, e.y, 0xff3b5c, 26);
          this.shockwave(e.x, e.y, 60, 0xff3b5c);
          this.embers.explode(Math.round(10 * this.prof.particles), e.x, e.y);
        } else {
          this.burst(e.x, e.y, 0xd2b0ff, 20);
          this.shockwave(e.x, e.y, 50, 0xb48cff);
        }
        if (play) {
          if (e.kind === 'drone') sfx.droneDown();
          else sfx.jellyPop();
          this.cameras.main.shake(80, 0.004);
          this.popText(e.x, e.y, `+${e.pts}`, '#ffd166');
        }
        break;
      case 'shoot':
        if (play) sfx.shoot();
        break;
      case 'block':
        this.burst(e.x, e.y, 0xffe0e6, 8);
        if (play) sfx.block();
        break;
      case 'bossCharge':
        if (play) { sfx.bossCharge(); this.cameras.main.shake(300, 0.006); }
        break;
      case 'wrap':
        this.shockwave(e.x, e.y, 220, 0xffc94a);
        this.embers.explode(40, e.x, e.y);
        if (play) {
          sfx.wrap();
          this.cameras.main.shake(250, 0.01);
          this.showBanner('WRAPPED!', `+${e.pts} · Leviathan is stunned — squeeze it now!`, 1400, '#ffc94a', 60);
        }
        break;
      case 'bossDown':
        for (let i = 0; i < 6; i++) {
          this.time.delayedCall(i * 220, () => {
            const ox = e.x + (Math.random() - 0.5) * 160;
            const oy = e.y + (Math.random() - 0.5) * 100;
            this.burst(ox, oy, 0x9ff7ff, 30);
            this.shockwave(ox, oy, 140, 0x3fd6ff);
            this.embers.explode(20, ox, oy);
          });
        }
        if (play) {
          sfx.bossDown();
          this.cameras.main.shake(900, 0.012);
          this.showBanner('LEVIATHAN DEFEATED', `+${e.pts}`, 2400, '#9ff7ff', 56);
        }
        break;
      case 'over':
        if (play) { sfx.over(); this.showBanner('GAME OVER', '', 2000, '#ff6b6b'); }
        break;
    }
  }

  private burst(x: number, y: number, tint: number, n: number) {
    this.sparks.setParticleTint(tint);
    this.sparks.explode(Math.max(4, Math.round(n * this.prof.particles)), x, y);
    const flash = this.add.image(x, y, 'glow').setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setScale(0.6);
    this.worldFront.add(flash);
    this.tweens.add({ targets: flash, scale: 1.6, alpha: 0, duration: 260, ease: 'Quad.Out', onComplete: () => flash.destroy() });
  }

  private shockwave(x: number, y: number, radius: number, tint: number) {
    const ring = this.add.image(x, y, 'ring').setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setScale(0.1);
    this.worldFront.add(ring);
    this.tweens.add({ targets: ring, scale: radius / 60, alpha: { from: 0.9, to: 0 }, duration: 420, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
  }

  private showBanner(text: string, sub: string, ms: number, color = '#ffffff', size = 76) {
    this.tweens.killTweensOf([this.banner, this.subBanner]);
    this.banner.setText(text).setColor(color).setFontSize(size).setAlpha(0).setScale(0.8);
    this.subBanner.setText(sub).setAlpha(0).setY(this.banner.y + size * 0.85);
    this.tweens.add({ targets: this.banner, alpha: 1, scale: 1, duration: 260, ease: 'Back.Out' });
    this.tweens.add({ targets: this.subBanner, alpha: 1, duration: 400, delay: 150 });
    this.tweens.add({ targets: [this.banner, this.subBanner], alpha: 0, delay: ms, duration: 450 });
  }

  private popText(x: number, y: number, text: string, color: string, size = 20) {
    const t = this.add.text(x, y, text, { fontFamily: 'Orbitron, sans-serif', fontSize: `${size}px`, color, fontStyle: 'bold' })
      .setOrigin(0.5).setStroke('#0b0e24', 4);
    this.hud.add(t);
    this.tweens.add({ targets: t, y: y - 55, alpha: { from: 1, to: 0 }, scale: { from: 1.2, to: 1 }, duration: 900, ease: 'Cubic.Out', onComplete: () => t.destroy() });
  }
}
