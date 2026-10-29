// Rendering for enemies (drones, jellyfish), bullets and the boss whale.

import Phaser from 'phaser';
import * as C from '../sim/constants';
import type { ViewBoss, ViewState } from '../sim/snapshot';
import { DRONE_TEX, JELLY_TEX, WHALE_BODY_LEN } from './textures';

const DRONE_COLOR = 0xff3b5c;
const JELLY_COLOR = 0xb48cff;
const WRAP_COLOR = 0xffc94a;

interface DroneGfx { kind: 'drone'; body: Phaser.GameObjects.Image; eye: Phaser.GameObjects.Image }
interface JellyGfx { kind: 'jelly'; body: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image; seed: number }
type EnemyGfx = DroneGfx | JellyGfx;

export class EntityRenderer {
  private enemies = new Map<number, EnemyGfx>();
  private bullets = new Map<number, { core: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image }>();
  private boss?: {
    glow: Phaser.GameObjects.Image;
    body: Phaser.GameObjects.Image;
    tail: Phaser.GameObjects.Image;
    eye: Phaser.GameObjects.Image;
  };

  constructor(
    private scene: Phaser.Scene,
    /** layer for bodies */
    private layer: Phaser.GameObjects.Layer,
    /** additive graphics for tentacles, wrap ring, telegraphs */
    private g: Phaser.GameObjects.Graphics,
  ) {}

  draw(v: ViewState) {
    this.drawEnemies(v);
    this.drawBullets(v);
    this.drawBoss(v.boss);
  }

  // ------------------------------------------------------------ enemies

  private drawEnemies(v: ViewState) {
    const t = this.scene.time.now / 1000;
    const alive = new Set<number>();
    for (const e of v.enemies) {
      alive.add(e.id);
      let gfx = this.enemies.get(e.id);
      if (!gfx) {
        gfx = this.createEnemy(e.kind, e.id);
        this.enemies.set(e.id, gfx);
      }

      if (gfx.kind === 'drone') {
        const hover = Math.sin(t * 4 + e.id) * 2;
        gfx.body.setPosition(e.x, e.y + hover).setRotation(e.angle).setScale((e.r * 2.7) / DRONE_TEX);
        // the eye glows up before it fires
        const ex = e.x + Math.cos(e.angle) * e.r * 0.35;
        const ey = e.y + hover + Math.sin(e.angle) * e.r * 0.35;
        const pulse = e.charging ? 0.9 + Math.sin(t * 40) * 0.3 : 0.35;
        gfx.eye.setPosition(ex, ey).setScale(e.charging ? 0.55 : 0.3).setAlpha(pulse);
        if (e.charging) {
          // aim line
          this.g.lineStyle(2, DRONE_COLOR, 0.35);
          this.g.lineBetween(ex, ey, ex + Math.cos(e.angle) * 140, ey + Math.sin(e.angle) * 140);
        }
      } else {
        // jellyfish: pulsing bell + wavy tentacles trailing behind
        const pulse = 1 + Math.sin(t * 5 + gfx.seed) * 0.08;
        const scale = (e.r * 2.6) / JELLY_TEX;
        gfx.body.setPosition(e.x, e.y).setRotation(e.angle + Math.PI / 2).setScale(scale * pulse, scale / pulse);
        gfx.glow.setPosition(e.x, e.y).setScale((e.r * 4) / 128);

        const bx = -Math.cos(e.angle);
        const by = -Math.sin(e.angle);
        const nx = -by;
        const ny = bx;
        const n = 5;
        for (let k = 0; k < n; k++) {
          const off = (k / (n - 1) - 0.5) * e.r * 1.3;
          let px = e.x + nx * off + bx * e.r * 0.3;
          let py = e.y + ny * off + by * e.r * 0.3;
          this.g.lineStyle(2, JELLY_COLOR, 0.55);
          this.g.beginPath();
          this.g.moveTo(px, py);
          for (let s = 1; s <= 6; s++) {
            const wave = Math.sin(t * 6 + s * 0.9 + k * 1.3 + gfx.seed) * (s * 1.4);
            px += bx * e.r * 0.28 + nx * wave * 0.3;
            py += by * e.r * 0.28 + ny * wave * 0.3;
            this.g.lineTo(px, py);
          }
          this.g.strokePath();
        }
      }
    }
    for (const [id, gfx] of this.enemies) {
      if (alive.has(id)) continue;
      gfx.body.destroy();
      if (gfx.kind === 'drone') gfx.eye.destroy();
      else gfx.glow.destroy();
      this.enemies.delete(id);
    }
  }

  private createEnemy(kind: 'drone' | 'jelly', id: number): EnemyGfx {
    if (kind === 'drone') {
      const body = this.scene.add.image(0, 0, 'drone');
      const eye = this.scene.add.image(0, 0, 'glow').setTint(DRONE_COLOR).setBlendMode(Phaser.BlendModes.ADD);
      this.layer.add([body, eye]);
      return { kind, body, eye };
    }
    const glow = this.scene.add.image(0, 0, 'glow').setTint(JELLY_COLOR).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35);
    const body = this.scene.add.image(0, 0, 'jelly').setBlendMode(Phaser.BlendModes.ADD);
    this.layer.add([glow, body]);
    return { kind, body, glow, seed: id * 1.7 };
  }

  // ------------------------------------------------------------ bullets

  private drawBullets(v: ViewState) {
    const alive = new Set<number>();
    for (const b of v.bullets) {
      alive.add(b.id);
      let gfx = this.bullets.get(b.id);
      if (!gfx) {
        const glow = this.scene.add.image(b.x, b.y, 'glow').setTint(0xff4060).setBlendMode(Phaser.BlendModes.ADD).setScale(0.28);
        const core = this.scene.add.image(b.x, b.y, 'dot').setTint(0xffe0e6).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5);
        this.layer.add([glow, core]);
        gfx = { core, glow };
        this.bullets.set(b.id, gfx);
      }
      gfx.core.setPosition(b.x, b.y);
      gfx.glow.setPosition(b.x, b.y);
    }
    for (const [id, gfx] of this.bullets) {
      if (alive.has(id)) continue;
      gfx.core.destroy();
      gfx.glow.destroy();
      this.bullets.delete(id);
    }
  }

  // ------------------------------------------------------------ boss

  private drawBoss(b: ViewBoss | null) {
    if (!b) {
      if (this.boss) {
        for (const o of Object.values(this.boss)) o.destroy();
        this.boss = undefined;
      }
      return;
    }
    if (!this.boss) {
      const glow = this.scene.add.image(0, 0, 'glow').setTint(0x3fd6ff).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.3);
      const tail = this.scene.add.image(0, 0, 'whaleTail').setOrigin(110 / 120, 0.5);
      const body = this.scene.add.image(0, 0, 'whale');
      const eye = this.scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setScale(0.25);
      this.layer.add([glow, tail, body, eye]);
      this.boss = { glow, body, tail, eye };
    }
    const gfx = this.boss;
    const t = this.scene.time.now / 1000;
    const scale = (C.BOSS_RADIUS * 2.7) / WHALE_BODY_LEN;
    const cos = Math.cos(b.angle);
    const sin = Math.sin(b.angle);

    let x = b.x;
    let y = b.y;
    if (b.state === 'windup') {
      // shiver before the charge
      x += (Math.random() - 0.5) * 6;
      y += (Math.random() - 0.5) * 6;
    }
    const dying = b.state === 'dying';
    const alpha = dying ? Math.max(0, 0.4 + Math.sin(t * 30) * 0.4) : 1;

    gfx.body.setPosition(x, y).setRotation(b.angle).setScale(scale).setAlpha(alpha);
    gfx.body.setTint(b.state === 'stunned' ? 0xfff2b0 : b.squeezing ? 0xffd0d0 : 0xffffff);
    // tail swings faster while charging
    const swing = Math.sin(t * (b.state === 'charge' ? 14 : 4)) * 0.35;
    const rearX = x - cos * (WHALE_BODY_LEN / 2) * scale * 0.95;
    const rearY = y - sin * (WHALE_BODY_LEN / 2) * scale * 0.95;
    gfx.tail.setPosition(rearX, rearY).setRotation(b.angle + swing).setScale(scale).setAlpha(alpha);
    gfx.glow.setPosition(x, y).setScale((C.BOSS_RADIUS * 5) / 128).setAlpha(b.state === 'charge' ? 0.5 : 0.25);

    const eyeX = x + cos * C.BOSS_RADIUS * 0.82 - sin * -6 * scale;
    const eyeY = y + sin * C.BOSS_RADIUS * 0.82 + cos * -6 * scale;
    const angry = b.state === 'windup' || b.state === 'charge';
    gfx.eye.setPosition(eyeX, eyeY).setTint(angry ? 0xff3030 : 0x9ff7ff).setScale(angry ? 0.45 : 0.22).setAlpha(dying ? 0 : 0.9);

    if (dying) return;

    // wrap progress: golden arc around the whale (fills up as you orbit)
    const R = C.BOSS_RADIUS * 1.25;
    const prog = Math.min(1, Math.abs(b.wrap));
    this.g.lineStyle(3, WRAP_COLOR, 0.15).strokeCircle(b.x, b.y, R);
    if (prog > 0.02) {
      const dir = b.wrap >= 0 ? 1 : -1;
      this.g.lineStyle(6, WRAP_COLOR, 0.35 + prog * 0.5);
      this.g.beginPath();
      this.g.arc(b.x, b.y, R, -Math.PI / 2, -Math.PI / 2 + dir * prog * Math.PI * 2, dir < 0);
      this.g.strokePath();
    }

    if (b.state === 'stunned') {
      // circling stars
      for (let k = 0; k < 4; k++) {
        const a = t * 3 + (k * Math.PI) / 2;
        this.g.fillStyle(0xffe680, 0.9).fillCircle(x + Math.cos(a) * 60, y - 70 + Math.sin(a) * 14, 5);
      }
    }
    if (b.state === 'windup') {
      // charge direction telegraph
      this.g.lineStyle(10, 0xff3030, 0.18);
      this.g.lineBetween(x, y, x + cos * 520, y + sin * 520);
    }
  }
}
