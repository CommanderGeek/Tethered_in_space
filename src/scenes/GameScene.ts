import Phaser from 'phaser';
import * as C from '../sim/constants';
import { planetRadius, type PlayerInput, type SimEvent } from '../sim/sim';
import type { ViewPlanet, ViewState } from '../sim/snapshot';
import { Session } from '../session';
import { sfx } from '../render/sfx';
import { ASTEROID_RADIUS_IN_TEX, ASTEROID_VARIANTS, PLANET_DIAM, createTextures } from '../render/textures';

export const SHIP_COLORS = [0x3ef3ff, 0xff4fd8] as const;
const BOOST_COLOR = 0xffc94a;
const HOT_COLOR = 0xff4646;
const SHIP_SCALE = 0.52; // Textur ~90px lang -> ~47px im Spiel
const PLANET_ATMO_TINT = [0xffaa66, 0x88ccff, 0xff6633, 0x88ffaa];

type KeyMap = {
  up: Phaser.Input.Keyboard.Key[]; down: Phaser.Input.Keyboard.Key[];
  left: Phaser.Input.Keyboard.Key[]; right: Phaser.Input.Keyboard.Key[]; anchor: Phaser.Input.Keyboard.Key[];
};

export interface SceneHooks {
  onGameOver(score: number, wave: number): void;
  onDisconnect(): void;
}

interface ShipGfx {
  glow: Phaser.GameObjects.Image;
  flame: Phaser.GameObjects.Image;
  body: Phaser.GameObjects.Image;
  shield: Phaser.GameObjects.Image;
}

const lerpColor = (a: number, b: number, t: number) => {
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(
    Phaser.Display.Color.ValueToColor(a), Phaser.Display.Color.ValueToColor(b), 1000, Math.round(Phaser.Math.Clamp(t, 0, 1) * 1000),
  );
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
};

export class GameScene extends Phaser.Scene {
  private session?: Session;
  private demo = true;
  private hooks?: SceneHooks;

  // Ebenen (von hinten nach vorne)
  private bg!: Phaser.GameObjects.Layer;
  private worldBack!: Phaser.GameObjects.Layer;
  private worldMid!: Phaser.GameObjects.Layer;
  private worldFront!: Phaser.GameObjects.Layer;
  private hud!: Phaser.GameObjects.Layer;

  private stars: Phaser.GameObjects.TileSprite[] = [];
  private dust!: Phaser.GameObjects.TileSprite;
  private gBack!: Phaser.GameObjects.Graphics; // Gravitationsfelder, Warnpfeile
  private gTether!: Phaser.GameObjects.Graphics; // additiv
  private gFront!: Phaser.GameObjects.Graphics; // Anker-Ringe, Markierungen

  private shipGfx: ShipGfx[] = [];
  private asteroidImgs = new Map<number, Phaser.GameObjects.Image>();
  private planetImgs = new Map<string, { img: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image }>();

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

  constructor() {
    super('game');
  }

  // ============================================================ Setup

  create() {
    createTextures(this, SHIP_COLORS);

    this.bg = this.add.layer();
    this.worldBack = this.add.layer();
    this.worldMid = this.add.layer();
    this.worldFront = this.add.layer();
    this.hud = this.add.layer();

    const ui = this.cameras.add(0, 0, C.WORLD_W, C.WORLD_H);
    this.cameras.main.ignore(this.hud);
    ui.ignore([this.bg, this.worldBack, this.worldMid, this.worldFront]);
    if (this.renderer.type === Phaser.WEBGL) {
      this.cameras.main.postFX.addBloom(0xffffff, 1, 1, 1, 1.1, 4);
      this.cameras.main.postFX.addVignette(0.5, 0.5, 0.92, 0.32);
    }

    this.makeBackground();

    this.gBack = this.add.graphics();
    this.gTether = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.gFront = this.add.graphics();

    this.makeParticles();
    this.makeShips();

    // Reihenfolge: Planeten & Felder hinten, Asteroiden, Spuren, Seil, Schiffe, Funken
    this.worldBack.add([this.gBack]);
    this.worldMid.add([...this.trails, this.boostTrail]);
    this.worldFront.add([this.gTether]);
    for (const s of this.shipGfx) this.worldFront.add([s.glow, s.flame, s.body, s.shield]);
    this.worldFront.add([this.gFront, this.debris, this.embers, this.sparks]);

    this.makeHud();
    this.makeKeys();
    this.startDemo();
  }

  private makeBackground() {
    this.bg.add(this.add.image(0, 0, 'nebula').setOrigin(0));
    this.stars = ['stars0', 'stars1', 'stars2'].map((k) =>
      this.add.tileSprite(0, 0, C.WORLD_W, C.WORLD_H, k).setOrigin(0),
    );
    this.bg.add(this.stars);

    // funkelnde Sterne
    for (let i = 0; i < 22; i++) {
      const s = this.add.image(Math.random() * C.WORLD_W, Math.random() * C.WORLD_H, 'glint')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.2 + Math.random() * 0.35)
        .setTint([0xffffff, 0xcfe6ff, 0xffe2c4, 0xd9d0ff][i % 4])
        .setAlpha(0.2);
      this.bg.add(s);
      this.tweens.add({
        targets: s, alpha: { from: 0.15, to: 0.85 }, scale: s.scale * 1.25,
        duration: 900 + Math.random() * 2200, yoyo: true, repeat: -1, delay: Math.random() * 3000, ease: 'Sine.InOut',
      });
    }

    // Arena-Rand: weicher Energiezaun
    const border = this.add.graphics();
    const m = C.WALL_MARGIN;
    border.lineStyle(6, 0x6a7cff, 0.05).strokeRoundedRect(m, m, C.WORLD_W - 2 * m, C.WORLD_H - 2 * m, 22);
    border.lineStyle(1.5, 0x8fa0ff, 0.22).strokeRoundedRect(m, m, C.WORLD_W - 2 * m, C.WORLD_H - 2 * m, 22);
    this.bg.add(border);

    this.dust = this.add.tileSprite(0, 0, C.WORLD_W, C.WORLD_H, 'dust').setOrigin(0).setAlpha(0.7);
    this.bg.add(this.dust);

    // gelegentliche Sternschnuppen
    this.time.addEvent({ delay: 3500, loop: true, callback: () => { if (Math.random() < 0.55) this.shootingStar(); } });
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
    this.hullLabel = this.add.text(40, 26, 'HÜLLE', label).setLetterSpacing(3);
    this.scoreLabel = this.add.text(C.WORLD_W - 40, 26, 'PUNKTE', label).setOrigin(1, 0).setLetterSpacing(3);
    this.scoreText = this.add.text(C.WORLD_W - 40, 42, '0', { fontFamily: font, fontSize: '34px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(1, 0);
    this.comboText = this.add.text(C.WORLD_W - 40, 84, '', { fontFamily: font, fontSize: '20px', color: '#ffd166', fontStyle: 'bold' }).setOrigin(1, 0);
    this.waveText = this.add.text(C.WORLD_W / 2, 30, '', { fontFamily: font, fontSize: '18px', color: '#9fb3ff' }).setOrigin(0.5, 0).setLetterSpacing(6);
    this.banner = this.add.text(C.WORLD_W / 2, C.WORLD_H * 0.26, '', { fontFamily: font, fontSize: '76px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5).setAlpha(0).setStroke('#141a4a', 10).setLetterSpacing(8);
    this.subBanner = this.add.text(C.WORLD_W / 2, C.WORLD_H * 0.26 + 64, '', { fontFamily: font, fontSize: '20px', color: '#b8c4ff' })
      .setOrigin(0.5).setAlpha(0).setLetterSpacing(4);
    this.hint = this.add.text(40, C.WORLD_H - 36, '', { fontFamily: font, fontSize: '14px', color: '#7f89c4' }).setOrigin(0, 1);
    this.netText = this.add.text(C.WORLD_W - 40, C.WORLD_H - 36, '', { fontFamily: font, fontSize: '13px', color: '#5d6596' }).setOrigin(1, 1);
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
    });
  }

  // ============================================================ Session-Steuerung

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
      session.mode === 'local'
        ? 'P1: WASD + LEERTASTE ankern     P2: PFEILE + ENTER ankern'
        : 'WASD / PFEILE fliegen     LEERTASTE / SHIFT ankern',
    );
    this.netText.setText('');
  }

  startDemo() {
    this.session?.dispose();
    this.session = new Session('local');
    this.session.onEvent((e) => this.handleEvent(e, true));
    this.demo = true;
    this.hooks = undefined;
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

    if (this.demo) s.update(delta, this.demoInputs());
    else if (s.mode === 'local') s.update(delta, [this.readKeys(this.keysP1), this.readKeys(this.keysP2)]);
    else {
      s.update(delta, [this.readKeys(this.keysAny)]);
      this.netText.setText(s.rtt ? `PING ${Math.round(s.rtt)} ms` : '');
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
    this.drawTether(v);
    this.drawShips(v);
    this.drawHud(v, delta);

    if (!this.demo && v.phase === 'over' && !this.overShown) {
      this.overShown = true;
      this.time.delayedCall(1400, () => this.hooks?.onGameOver(v.score, v.wave));
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

  /** Menü-Demo: Schiff 0 ankert grob mittig, Schiff 1 schwingt drumherum */
  private demoInputs(): PlayerInput[] {
    const v = this.lastView;
    if (!v) return [{ x: 0, y: 0, anchor: true }, { x: 0, y: 0, anchor: false }];
    const [a, b] = v.ships;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    if (!v.linked) return [{ x: dx / d, y: dy / d, anchor: false }, { x: -dx / d, y: -dy / d, anchor: false }];
    // Ankerpunkt: freie Stelle weg von Planeten
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

  // ============================================================ Zeichnen

  private drawBackground(v: ViewState) {
    const mx = (v.ships[0].x + v.ships[1].x) / 2 - C.WORLD_W / 2;
    const my = (v.ships[0].y + v.ships[1].y) / 2 - C.WORLD_H / 2;
    const t = this.time.now;
    this.stars.forEach((s, i) => {
      const f = (i + 1) * 0.025;
      s.tilePositionX = mx * f + t * 0.003 * (i + 1);
      s.tilePositionY = my * f;
    });
    this.dust.tilePositionX = mx * 0.18 + t * 0.02;
    this.dust.tilePositionY = my * 0.18 + t * 0.006;
  }

  private drawPlanets(v: ViewState) {
    const seen = new Set<string>();
    const g = this.gBack;
    const t = this.time.now / 1000;

    for (const p of v.planets) {
      const key = `${p.x},${p.y},${p.kind}`;
      seen.add(key);
      let gfx = this.planetImgs.get(key);
      if (!gfx) {
        const glow = this.add.image(p.x, p.y, 'glow').setTint(PLANET_ATMO_TINT[p.kind]).setBlendMode(Phaser.BlendModes.ADD);
        const img = this.add.image(p.x, p.y, `planet${p.kind}`);
        this.worldBack.add([glow, img]);
        this.worldBack.bringToTop(this.gBack);
        gfx = { img, glow };
        this.planetImgs.set(key, gfx);
        if (p.grow < 0.5) this.planetSpawnFx(p);
      }
      const R = planetRadius(p);
      gfx.img.setScale(R / (PLANET_DIAM / 2)).setAlpha(Phaser.Math.Clamp(p.grow * 2, 0, 1));
      gfx.glow.setScale((R * 4.2) / 128).setAlpha(0.22 * Phaser.Math.Clamp(p.grow, 0, 1));

      if (R < 4) continue;
      // Gravitationsfeld: Ringe, die nach innen fließen
      const col = PLANET_ATMO_TINT[p.kind];
      const range = R * 3.4;
      for (let i = 0; i < 4; i++) {
        const ph = (t * 0.25 + i / 4) % 1;
        const rr = range - ph * (range - R * 1.1);
        const a = Math.sin(ph * Math.PI) * 0.09 * p.grow;
        g.lineStyle(1.5, col, a).strokeCircle(p.x, p.y, rr);
      }
      // Slingshot-Zone
      const zone = p.r * C.SLING_ZONE;
      const segs = 48;
      const a0 = t * 0.15;
      g.lineStyle(2, BOOST_COLOR, 0.16 * Phaser.Math.Clamp(p.grow, 0, 1));
      for (let i = 0; i < segs; i += 2) {
        g.beginPath();
        g.arc(p.x, p.y, zone, a0 + (i / segs) * Math.PI * 2, a0 + ((i + 1) / segs) * Math.PI * 2);
        g.strokePath();
      }
    }
    for (const [key, gfx] of this.planetImgs) {
      if (!seen.has(key)) {
        gfx.img.destroy();
        gfx.glow.destroy();
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
        // Warnpfeil am Rand
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
      // gestrichelte Hilfslinie + Reichweite fürs Neuverbinden
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

    // Durchhang, wenn das Seil locker ist (sanfte Welle)
    const slack = Math.max(0, C.ROPE_LENGTH - d);
    const sag = Math.sqrt(slack * C.ROPE_LENGTH) * 0.22 * Math.sin(t * 2.2);
    const N = 28;
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
      // Farbverlauf: Farbe Spieler 1 -> hell -> Farbe Spieler 2, bei Spannung Richtung Rot
      let col = u < 0.5 ? lerpColor(SHIP_COLORS[0], 0xe8f6ff, u * 2) : lerpColor(0xe8f6ff, SHIP_COLORS[1], (u - 0.5) * 2);
      if (boosted) col = lerpColor(col, BOOST_COLOR, 0.6);
      col = lerpColor(col, HOT_COLOR, tension * tension);
      const p0 = pts[i];
      const p1 = pts[i + 1];
      g.lineStyle(16, col, 0.07 * flicker).lineBetween(p0.x, p0.y, p1.x, p1.y);
      g.lineStyle(7, col, 0.25 * flicker).lineBetween(p0.x, p0.y, p1.x, p1.y);
      g.lineStyle(2.2, lerpColor(col, 0xffffff, 0.7), 0.95 * flicker).lineBetween(p0.x, p0.y, p1.x, p1.y);
    }

    // Energieimpulse laufen von beiden Seiten zur Mitte
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

      // Flamme hinter dem Schiff
      const rearX = s.x - cos * 19;
      const rearY = s.y - sin * 19;
      const thrusting = s.thrust && v.phase !== 'over';
      const len = thrusting ? (s.boost ? 0.75 : 0.45) + Math.random() * 0.15 : 0.12 + Math.random() * 0.04;
      gfx.flame.setPosition(rearX, rearY).setRotation(s.angle).setTint(col).setScale(len, thrusting ? 0.4 : 0.25).setAlpha(thrusting ? 1 : 0.6);

      if (thrusting) this.trails[i].emitParticleAt(rearX, rearY, 2);
      if (s.boost) this.boostTrail.emitParticleAt(rearX, rearY, 2);

      gfx.shield.setVisible(s.invuln).setPosition(s.x, s.y).setAlpha(0.5 + Math.sin(t / 60) * 0.3);

      // Anker: rotierende Klammern
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

    // Markierung für das eigene Schiff (online)
    const me = this.session?.me ?? -1;
    if (!this.demo && me >= 0 && v.phase !== 'over') {
      const s = v.ships[me];
      const bob = Math.sin(t / 200) * 3;
      this.gFront.fillStyle(SHIP_COLORS[me], 0.9).fillTriangle(s.x - 6, s.y - 40 + bob, s.x + 6, s.y - 40 + bob, s.x, s.y - 32 + bob);
    }
  }

  private drawHud(v: ViewState, delta: number) {
    const show = !this.demo;
    this.hullBar.clear();
    for (const o of [this.scoreText, this.scoreLabel, this.comboText, this.waveText, this.hullLabel]) o.setVisible(show);
    if (!show) return;

    // Hüllenanzeige in Segmenten
    const segs = 10;
    const w = 26;
    const gap = 4;
    const frac = v.hull / C.HULL_MAX;
    const col = frac > 0.5 ? 0x3ef3a0 : frac > 0.25 ? 0xffd166 : 0xff4f4f;
    for (let i = 0; i < segs; i++) {
      const fill = Phaser.Math.Clamp(frac * segs - i, 0, 1);
      const x = 40 + i * (w + gap);
      this.hullBar.fillStyle(0xffffff, 0.07).fillRoundedRect(x, 44, w, 12, 3);
      if (fill > 0) {
        const low = frac <= 0.25 && Math.floor(this.time.now / 250) % 2 === 0;
        this.hullBar.fillStyle(col, low ? 0.45 : 0.95).fillRoundedRect(x, 44, w * fill, 12, 3);
      }
    }

    // Punkte zählen hoch statt zu springen
    this.shownScore += (v.score - this.shownScore) * Math.min(1, delta / 120);
    if (Math.abs(v.score - this.shownScore) < 1) this.shownScore = v.score;
    this.scoreText.setText(Math.round(this.shownScore).toLocaleString('de-DE'));
    this.comboText.setText(v.combo > 1 ? `KOMBO ×${v.combo}` : '');
    this.waveText.setText(v.wave > 0 ? `WELLE ${v.wave}` : '');
  }

  // ============================================================ Events (Juice)

  private handleEvent(e: SimEvent, quiet = false) {
    const play = !quiet;
    switch (e.k) {
      case 'cut': {
        this.burst(e.x, e.y, e.split ? 0xcfd8ff : 0xffffff, e.split ? 16 : 28);
        this.shockwave(e.x, e.y, e.r * 1.8, 0xb9c8ff);
        this.debris.explode(Math.round(e.r / 2.5), e.x, e.y);
        if (!e.split) this.embers.explode(14, e.x, e.y);
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
        if (play) { sfx.snap(); this.cameras.main.shake(140, 0.008); this.showBanner('SEIL GERISSEN', 'Fliegt zusammen, um neu zu verbinden', 1100, '#ff8a8a', 46); }
        break;
      case 'link':
        this.burst(e.x, e.y, 0xaaf0ff, 18);
        this.shockwave(e.x, e.y, 60, 0xaaf0ff);
        if (play) sfx.link();
        break;
      case 'sling':
        this.shockwave(e.x, e.y, 70, BOOST_COLOR);
        this.embers.explode(18, e.x, e.y);
        // beide Schiffe lösen oft gleichzeitig aus: nur einmal anzeigen
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
        if (play) {
          sfx.wave();
          this.showBanner(`WELLE ${e.n}`, e.n === 1 ? 'Fliegt schnell an Planeten vorbei für SLINGSHOT-Boost' : '', 1600);
        }
        break;
      case 'over':
        if (play) { sfx.over(); this.showBanner('GAME OVER', '', 2000, '#ff6b6b'); }
        break;
    }
  }

  private burst(x: number, y: number, tint: number, n: number) {
    this.sparks.setParticleTint(tint);
    this.sparks.explode(n, x, y);
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
