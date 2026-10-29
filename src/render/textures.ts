// All graphics are generated procedurally via canvas at startup — no image files needed.
// Light source for everything: top left (matching the sun in the background).

import Phaser from 'phaser';
import { WALL_MARGIN, WORLD_H, WORLD_W } from '../sim/constants';

export const SHIP_TEX_SIZE = 128;
export const PLANET_TEX = 512; // canvas size
export const PLANET_DIAM = 220; // planet diameter inside the canvas
export const ASTEROID_VARIANTS = 8;
export const ASTEROID_TEX = 160;
export const ASTEROID_RADIUS_IN_TEX = 64;

type Ctx = CanvasRenderingContext2D;

/** small deterministic random numbers for reproducible textures */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx) => void) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h)!;
  draw(tex.getContext());
  tex.refresh();
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export function createTextures(scene: Phaser.Scene, shipColors: readonly number[]) {
  softDots(scene);
  shipTextures(scene, shipColors);
  asteroidTextures(scene);
  planetTextures(scene);
  enemyTextures(scene);
  whaleTextures(scene);
  backgroundTextures(scene);
}

// ------------------------------------------------------------ Small stuff

function softDots(scene: Phaser.Scene) {
  canvas(scene, 'dot', 32, 32, (c) => {
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
  });

  canvas(scene, 'glow', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });

  canvas(scene, 'ring', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 40, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });

  // thin ring for gravity ripples (scaled instead of redrawn every frame)
  canvas(scene, 'thinring', 256, 256, (c) => {
    c.strokeStyle = 'rgba(255,255,255,1)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(128, 128, 124, 0, Math.PI * 2);
    c.stroke();
  });

  // dashed ring for the slingshot zone
  canvas(scene, 'dashring', 512, 512, (c) => {
    c.strokeStyle = 'rgba(255,255,255,1)';
    c.lineWidth = 4;
    c.setLineDash([14, 14]);
    c.beginPath();
    c.arc(256, 256, 250, 0, Math.PI * 2);
    c.stroke();
  });

  canvas(scene, 'shard', 12, 10, (c) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(12, 4);
    c.lineTo(3, 10);
    c.closePath();
    c.fill();
  });

  // star with a light cross
  canvas(scene, 'glint', 64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 10);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    for (const [w, h] of [[64, 2], [2, 64]]) {
      const lg = w > h ? c.createLinearGradient(0, 0, 64, 0) : c.createLinearGradient(0, 0, 0, 64);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = lg;
      c.fillRect(32 - w / 2, 32 - h / 2, w, h);
    }
  });

  // engine flame (points left, origin on the right)
  canvas(scene, 'flame', 128, 48, (c) => {
    const g = c.createLinearGradient(128, 0, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(128, 8);
    c.quadraticCurveTo(40, 14, 0, 24);
    c.quadraticCurveTo(40, 34, 128, 40);
    c.closePath();
    c.fill();
  });
}

// ------------------------------------------------------------ Ships

function shipTextures(scene: Phaser.Scene, colors: readonly number[]) {
  colors.forEach((col, i) => {
    const S = SHIP_TEX_SIZE;
    canvas(scene, `ship${i}`, S, S, (c) => {
      const C = hex(col);
      c.translate(S / 2, S / 2);
      // ship points right; ~90px long

      // Glow
      c.shadowColor = C;
      c.shadowBlur = 18;

      // wings
      c.beginPath();
      c.moveTo(6, 0);
      c.lineTo(-30, 34);
      c.lineTo(-40, 32);
      c.lineTo(-24, 6);
      c.lineTo(-24, -6);
      c.lineTo(-40, -32);
      c.lineTo(-30, -34);
      c.closePath();
      const wg = c.createLinearGradient(-40, -34, 6, 34);
      wg.addColorStop(0, '#2a3358');
      wg.addColorStop(1, '#0c1024');
      c.fillStyle = wg;
      c.fill();
      c.lineWidth = 2.5;
      c.strokeStyle = C;
      c.stroke();

      // hull
      c.beginPath();
      c.moveTo(46, 0);
      c.quadraticCurveTo(20, -14, -34, -11);
      c.lineTo(-28, 0);
      c.lineTo(-34, 11);
      c.quadraticCurveTo(20, 14, 46, 0);
      c.closePath();
      const hg = c.createLinearGradient(0, -14, 0, 14);
      hg.addColorStop(0, '#5a6696');
      hg.addColorStop(0.45, '#1b2140');
      hg.addColorStop(1, '#0a0d1d');
      c.fillStyle = hg;
      c.fill();
      c.shadowBlur = 10;
      c.lineWidth = 2;
      c.strokeStyle = C;
      c.stroke();
      c.shadowBlur = 0;

      // colour stripes on the wings
      c.strokeStyle = C;
      c.globalAlpha = 0.85;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(-8, 14); c.lineTo(-28, 30);
      c.moveTo(-8, -14); c.lineTo(-28, -30);
      c.stroke();
      c.globalAlpha = 1;

      // cockpit
      const cg = c.createLinearGradient(8, -6, 26, 6);
      cg.addColorStop(0, '#ffffff');
      cg.addColorStop(0.4, C);
      cg.addColorStop(1, '#0a0d1d');
      c.fillStyle = cg;
      c.beginPath();
      c.ellipse(16, 0, 12, 5, 0, 0, Math.PI * 2);
      c.fill();

      // engine nozzles
      c.fillStyle = '#ffffff';
      c.shadowColor = C;
      c.shadowBlur = 12;
      c.fillRect(-36, -8, 5, 5);
      c.fillRect(-36, 3, 5, 5);
      c.shadowBlur = 0;

      // highlight on top
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(40, -2);
      c.quadraticCurveTo(14, -10, -20, -8);
      c.stroke();
    });
  });

  // shield bubble
  canvas(scene, 'shield', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 30, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.25)');
    g.addColorStop(0.95, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
}

// ------------------------------------------------------------ Asteroids

/** outline radius factors for variant v */
export function asteroidOutline(v: number): number[] {
  const rnd = seeded(1000 + v * 77);
  const n = 13;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) pts.push(0.8 + rnd() * 0.24);
  return pts;
}

function asteroidTextures(scene: Phaser.Scene) {
  const S = ASTEROID_TEX;
  const R = ASTEROID_RADIUS_IN_TEX;
  for (let v = 0; v < ASTEROID_VARIANTS; v++) {
    canvas(scene, `ast${v}`, S, S, (c) => {
      const rnd = seeded(500 + v * 31);
      const outline = asteroidOutline(v);
      const path = () => {
        c.beginPath();
        outline.forEach((k, i) => {
          const a = (i / outline.length) * Math.PI * 2;
          const x = S / 2 + Math.cos(a) * R * k;
          const y = S / 2 + Math.sin(a) * R * k;
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        });
        c.closePath();
      };

      // base body
      const hue = 250 + rnd() * 40;
      path();
      const base = c.createRadialGradient(S / 2 - R * 0.35, S / 2 - R * 0.4, R * 0.1, S / 2, S / 2, R * 1.1);
      base.addColorStop(0, `hsl(${hue}, 18%, 46%)`);
      base.addColorStop(0.55, `hsl(${hue}, 20%, 24%)`);
      base.addColorStop(1, `hsl(${hue}, 25%, 9%)`);
      c.fillStyle = base;
      c.fill();

      c.save();
      path();
      c.clip();
      // grain
      for (let i = 0; i < 260; i++) {
        c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
        c.fillRect(S / 2 + (rnd() - 0.5) * 2 * R, S / 2 + (rnd() - 0.5) * 2 * R, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
      }
      // craters
      const craters = 4 + Math.floor(rnd() * 4);
      for (let i = 0; i < craters; i++) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * R * 0.7;
        const x = S / 2 + Math.cos(a) * d;
        const y = S / 2 + Math.sin(a) * d;
        const cr = R * (0.08 + rnd() * 0.18);
        const g = c.createRadialGradient(x + cr * 0.25, y + cr * 0.25, 0, x, y, cr);
        g.addColorStop(0, 'rgba(0,0,0,0.5)');
        g.addColorStop(0.75, 'rgba(0,0,0,0.25)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, cr, 0, Math.PI * 2);
        c.fill();
        // bright crater rim bottom right (light from top left)
        c.strokeStyle = 'rgba(220,210,255,0.18)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(x, y, cr * 0.95, 0.1 * Math.PI, 0.9 * Math.PI);
        c.stroke();
      }
      c.restore();

      // rim light
      path();
      c.lineWidth = 2.5;
      const rim = c.createLinearGradient(S / 2 - R, S / 2 - R, S / 2 + R, S / 2 + R);
      rim.addColorStop(0, 'rgba(200,190,255,0.9)');
      rim.addColorStop(0.5, 'rgba(140,120,220,0.35)');
      rim.addColorStop(1, 'rgba(90,70,170,0.15)');
      c.strokeStyle = rim;
      c.stroke();
    });
  }
}

// ------------------------------------------------------------ Planets

interface PlanetStyle {
  base: [string, string, string];
  bands: string[];
  atmo: string;
  ring?: string;
  spots?: string;
  cracks?: string;
}

export const PLANET_STYLES: PlanetStyle[] = [
  // 0: gas giant with ring
  { base: ['#ffe2b0', '#d98a4e', '#5a2a1a'], bands: ['rgba(255,240,210,0.35)', 'rgba(140,60,30,0.35)', 'rgba(255,190,120,0.3)'], atmo: 'rgba(255,170,100,', ring: 'rgba(240,210,170,' },
  // 1: ice
  { base: ['#f2fbff', '#7cc6ee', '#163a6e'], bands: ['rgba(255,255,255,0.3)', 'rgba(60,140,210,0.25)'], atmo: 'rgba(120,200,255,', spots: 'rgba(255,255,255,0.45)' },
  // 2: lava
  { base: ['#8a4a3a', '#3a1414', '#120505'], bands: ['rgba(0,0,0,0.25)'], atmo: 'rgba(255,90,40,', cracks: '#ff7a2a' },
  // 3: toxic
  { base: ['#e8ffcf', '#5fc48a', '#0f3a3a'], bands: ['rgba(200,255,150,0.3)', 'rgba(20,90,80,0.35)', 'rgba(120,230,170,0.25)'], atmo: 'rgba(120,255,170,' },
];

function planetTextures(scene: Phaser.Scene) {
  PLANET_STYLES.forEach((st, kind) => {
    canvas(scene, `planet${kind}`, PLANET_TEX, PLANET_TEX, (c) => {
      const rnd = seeded(9000 + kind * 13);
      const cx = PLANET_TEX / 2;
      const cy = PLANET_TEX / 2;
      const R = PLANET_DIAM / 2;

      // atmosphere (outside)
      const atmo = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.45);
      atmo.addColorStop(0, st.atmo + '0.55)');
      atmo.addColorStop(0.3, st.atmo + '0.18)');
      atmo.addColorStop(1, st.atmo + '0)');
      c.fillStyle = atmo;
      c.fillRect(0, 0, PLANET_TEX, PLANET_TEX);

      const tilt = -0.35;
      const ring = (front: boolean) => {
        if (!st.ring) return;
        c.save();
        c.translate(cx, cy);
        c.rotate(tilt);
        c.beginPath();
        // front half = lower half of the ellipse
        if (front) c.rect(-PLANET_TEX, 0, PLANET_TEX * 2, PLANET_TEX);
        else c.rect(-PLANET_TEX, -PLANET_TEX, PLANET_TEX * 2, PLANET_TEX);
        c.clip();
        for (let i = 0; i < 26; i++) {
          const rr = R * (1.35 + i * 0.033);
          c.strokeStyle = st.ring + (0.08 + rnd() * 0.35) + ')';
          c.lineWidth = 2 + rnd() * 2;
          c.beginPath();
          c.ellipse(0, 0, rr, rr * 0.26, 0, 0, Math.PI * 2);
          c.stroke();
        }
        c.restore();
      };

      ring(false);

      // sphere
      c.save();
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.clip();
      const base = c.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.05, cx, cy, R * 1.05);
      base.addColorStop(0, st.base[0]);
      base.addColorStop(0.5, st.base[1]);
      base.addColorStop(1, st.base[2]);
      c.fillStyle = base;
      c.fillRect(cx - R, cy - R, 2 * R, 2 * R);

      // bands (slightly wavy, tilted)
      c.save();
      c.translate(cx, cy);
      c.rotate(tilt * 0.6);
      for (let i = 0; i < 18; i++) {
        const y = -R + rnd() * 2 * R;
        const h = 3 + rnd() * 16;
        c.fillStyle = st.bands[Math.floor(rnd() * st.bands.length)];
        c.beginPath();
        c.moveTo(-R * 1.2, y);
        for (let x = -R * 1.2; x <= R * 1.2; x += 12) c.lineTo(x, y + Math.sin(x * 0.05 + i) * 3);
        for (let x = R * 1.2; x >= -R * 1.2; x -= 12) c.lineTo(x, y + h + Math.sin(x * 0.04 + i * 2) * 3);
        c.closePath();
        c.fill();
      }
      c.restore();

      if (st.spots) {
        for (let i = 0; i < 30; i++) {
          c.fillStyle = st.spots;
          c.beginPath();
          c.ellipse(cx + (rnd() - 0.5) * 2 * R, cy + (rnd() - 0.5) * 2 * R, 4 + rnd() * 18, 2 + rnd() * 6, rnd(), 0, Math.PI * 2);
          c.fill();
        }
      }
      if (st.cracks) {
        c.strokeStyle = st.cracks;
        c.shadowColor = st.cracks;
        c.shadowBlur = 8;
        for (let i = 0; i < 14; i++) {
          let x = cx + (rnd() - 0.5) * 2 * R;
          let y = cy + (rnd() - 0.5) * 2 * R;
          c.lineWidth = 1 + rnd() * 2.5;
          c.beginPath();
          c.moveTo(x, y);
          for (let j = 0; j < 6; j++) {
            x += (rnd() - 0.5) * 40;
            y += (rnd() - 0.5) * 40;
            c.lineTo(x, y);
          }
          c.stroke();
        }
        c.shadowBlur = 0;
      }

      // shadow side (light from top left)
      const shade = c.createRadialGradient(cx - R * 0.55, cy - R * 0.6, R * 0.3, cx - R * 0.2, cy - R * 0.2, R * 1.75);
      shade.addColorStop(0, 'rgba(0,0,0,0)');
      shade.addColorStop(0.55, 'rgba(0,0,10,0.25)');
      shade.addColorStop(1, 'rgba(0,0,10,0.92)');
      c.fillStyle = shade;
      c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      c.restore();

      // lit rim top left
      c.strokeStyle = st.atmo + '0.8)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(cx, cy, R - 1, Math.PI * 0.95, Math.PI * 1.6);
      c.stroke();

      ring(true);
    });
  });
}

// ------------------------------------------------------------ Background

function backgroundTextures(scene: Phaser.Scene) {
  const W = WORLD_W;
  const H = WORLD_H;
  const rnd = seeded(4242);

  canvas(scene, 'nebula', W, H, (c) => {
    c.fillStyle = '#03040b';
    c.fillRect(0, 0, W, H);

    // soft nebula clouds
    c.globalCompositeOperation = 'lighter';
    const palette = [
      [110, 50, 200], [40, 90, 200], [200, 50, 150], [30, 150, 170], [80, 40, 140],
    ];
    const clusters = [
      [0.18, 0.28], [0.78, 0.72], [0.62, 0.18], [0.32, 0.82], [0.92, 0.3],
    ];
    clusters.forEach(([fx, fy], ci) => {
      const col = palette[ci % palette.length];
      for (let i = 0; i < 26; i++) {
        const x = fx * W + (rnd() - 0.5) * 520;
        const y = fy * H + (rnd() - 0.5) * 360;
        const r = 60 + rnd() * 240;
        const a = 0.025 + rnd() * 0.05;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
    });

    // dust lanes (darken)
    c.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 40; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const r = 40 + rnd() * 140;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(2,3,8,0.22)');
      g.addColorStop(1, 'rgba(2,3,8,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, 2 * r, 2 * r);
    }

    // distant spiral galaxy
    c.globalCompositeOperation = 'lighter';
    c.save();
    c.translate(W * 0.86, H * 0.16);
    c.rotate(0.5);
    c.scale(1, 0.42);
    const core = c.createRadialGradient(0, 0, 0, 0, 0, 40);
    core.addColorStop(0, 'rgba(255,240,220,0.7)');
    core.addColorStop(1, 'rgba(255,200,160,0)');
    c.fillStyle = core;
    c.fillRect(-40, -40, 80, 80);
    for (let i = 0; i < 900; i++) {
      const arm = i % 2;
      const t = rnd() * 4.2;
      const ang = t * 1.6 + arm * Math.PI + (rnd() - 0.5) * 0.5;
      const rad = 6 + t * 22 + (rnd() - 0.5) * 8;
      c.fillStyle = `rgba(${200 + rnd() * 55},${200 + rnd() * 40},255,${0.15 + rnd() * 0.3})`;
      c.fillRect(Math.cos(ang) * rad, Math.sin(ang) * rad, 1.4, 1.4);
    }
    c.restore();

    // bake static stars straight into the background (saves full-screen layers)
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 700; i++) {
      const big = i % 7 === 0;
      c.globalAlpha = (big ? 0.8 : 0.45) * (0.35 + rnd() * 0.65);
      c.fillStyle = ['#ffffff', '#cfe6ff', '#ffe9d6', '#d9d0ff', '#bfefff'][i % 5];
      c.beginPath();
      c.arc(rnd() * W, rnd() * H, (big ? 1.3 : 0.8) * (0.6 + rnd() * 0.7), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // sun top left (partly off-screen)
    const sun = c.createRadialGradient(-60, -80, 0, -60, -80, 520);
    sun.addColorStop(0, 'rgba(255,240,210,0.55)');
    sun.addColorStop(0.15, 'rgba(255,200,150,0.18)');
    sun.addColorStop(0.5, 'rgba(255,140,120,0.05)');
    sun.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = sun;
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';

    // arena border (static, so it goes straight into the background image)
    const m = WALL_MARGIN;
    const rr = (lw: number, style: string) => {
      c.lineWidth = lw;
      c.strokeStyle = style;
      c.beginPath();
      c.roundRect(m, m, W - 2 * m, H - 2 * m, 22);
      c.stroke();
    };
    rr(6, 'rgba(106,124,255,0.06)');
    rr(1.5, 'rgba(143,160,255,0.24)');
  });
}

// ------------------------------------------------------------ Enemies

export const DRONE_TEX = 96;
export const JELLY_TEX = 128;

function enemyTextures(scene: Phaser.Scene) {
  // Drone: armoured saucer with a red eye, points right
  canvas(scene, 'drone', DRONE_TEX, DRONE_TEX, (c) => {
    const S = DRONE_TEX;
    c.translate(S / 2, S / 2);
    c.shadowColor = '#ff3b5c';
    c.shadowBlur = 14;
    // outer ring with notches
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const x = Math.cos(a) * 34;
      const y = Math.sin(a) * 34;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    const body = c.createLinearGradient(-30, -30, 30, 30);
    body.addColorStop(0, '#4a4f6e');
    body.addColorStop(1, '#141626');
    c.fillStyle = body;
    c.fill();
    c.lineWidth = 2.5;
    c.strokeStyle = '#ff5d73';
    c.stroke();
    c.shadowBlur = 0;
    // inner plate
    c.fillStyle = '#20233a';
    c.beginPath();
    c.arc(0, 0, 20, 0, Math.PI * 2);
    c.fill();
    // side fins
    c.fillStyle = '#ff5d73';
    c.fillRect(-36, -3, 8, 6);
    c.fillRect(-4, -38, 8, 6);
    c.fillRect(-4, 32, 8, 6);
    // eye (looks towards +x)
    const eye = c.createRadialGradient(10, 0, 0, 10, 0, 11);
    eye.addColorStop(0, '#ffffff');
    eye.addColorStop(0.35, '#ff3b5c');
    eye.addColorStop(1, 'rgba(255,59,92,0)');
    c.fillStyle = eye;
    c.beginPath();
    c.arc(10, 0, 11, 0, Math.PI * 2);
    c.fill();
    // highlight
    c.strokeStyle = 'rgba(255,255,255,0.3)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(0, 0, 28, Math.PI * 1.05, Math.PI * 1.55);
    c.stroke();
  });

  // Jellyfish bell (dome opening downwards in texture space = points +x after rotation is applied by the renderer)
  canvas(scene, 'jelly', JELLY_TEX, JELLY_TEX, (c) => {
    const S = JELLY_TEX;
    c.translate(S / 2, S / 2);
    // dome: drawn pointing up, renderer rotates it
    const dome = c.createRadialGradient(-10, -18, 4, 0, -4, 50);
    dome.addColorStop(0, 'rgba(255,255,255,0.95)');
    dome.addColorStop(0.3, 'rgba(190,140,255,0.75)');
    dome.addColorStop(0.75, 'rgba(120,70,220,0.45)');
    dome.addColorStop(1, 'rgba(80,40,180,0.15)');
    c.fillStyle = dome;
    c.shadowColor = '#b48cff';
    c.shadowBlur = 18;
    c.beginPath();
    c.moveTo(-46, 10);
    c.bezierCurveTo(-46, -50, 46, -50, 46, 10);
    // scalloped rim
    for (let i = 0; i <= 6; i++) {
      const x = 46 - (i / 6) * 92;
      c.quadraticCurveTo(x + 7.6, 20, x, 10);
    }
    c.closePath();
    c.fill();
    c.shadowBlur = 0;
    // inner organs glow
    const core = c.createRadialGradient(0, -8, 0, 0, -8, 18);
    core.addColorStop(0, 'rgba(255,170,255,0.9)');
    core.addColorStop(1, 'rgba(255,120,240,0)');
    c.fillStyle = core;
    c.beginPath();
    c.arc(0, -8, 18, 0, Math.PI * 2);
    c.fill();
    // rim line
    c.strokeStyle = 'rgba(230,200,255,0.8)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-46, 10);
    c.bezierCurveTo(-46, -50, 46, -50, 46, 10);
    c.stroke();
  });
}

// ------------------------------------------------------------ Boss: space whale

export const WHALE_W = 360;
export const WHALE_H = 220;
/** length of the whale body in the texture (used to scale it to the physics radius) */
export const WHALE_BODY_LEN = 280;

function whaleTextures(scene: Phaser.Scene) {
  // body points right; centre of the texture = centre of mass
  canvas(scene, 'whale', WHALE_W, WHALE_H, (c) => {
    const rnd = seeded(777);
    c.translate(WHALE_W / 2, WHALE_H / 2);
    const L = WHALE_BODY_LEN / 2;

    const bodyPath = () => {
      c.beginPath();
      c.moveTo(L, 4); // snout
      c.bezierCurveTo(L, -60, -L * 0.2, -78, -L, -18);
      c.quadraticCurveTo(-L - 8, 0, -L, 18);
      c.bezierCurveTo(-L * 0.3, 70, L * 0.7, 66, L, 4);
      c.closePath();
    };

    // glow
    c.shadowColor = '#3fd6ff';
    c.shadowBlur = 30;
    bodyPath();
    const g = c.createLinearGradient(0, -70, 0, 70);
    g.addColorStop(0, '#2b4f8f');
    g.addColorStop(0.5, '#173163');
    g.addColorStop(0.75, '#5b8fc9');
    g.addColorStop(1, '#9cc8ee');
    c.fillStyle = g;
    c.fill();
    c.shadowBlur = 0;

    c.save();
    bodyPath();
    c.clip();
    // belly grooves
    c.strokeStyle = 'rgba(220,240,255,0.25)';
    c.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      c.beginPath();
      c.moveTo(L * 0.9, 18 + i * 6);
      c.quadraticCurveTo(0, 40 + i * 7, -L * 0.7, 20 + i * 5);
      c.stroke();
    }
    // bioluminescent spots along the back
    for (let i = 0; i < 26; i++) {
      const x = -L * 0.8 + rnd() * L * 1.6;
      const y = -40 + rnd() * 40 - Math.abs(x) * 0.12;
      const r = 1.5 + rnd() * 3.5;
      const sg = c.createRadialGradient(x, y, 0, x, y, r * 2.5);
      sg.addColorStop(0, 'rgba(180,255,255,0.95)');
      sg.addColorStop(1, 'rgba(80,220,255,0)');
      c.fillStyle = sg;
      c.beginPath();
      c.arc(x, y, r * 2.5, 0, Math.PI * 2);
      c.fill();
    }
    // shading (light from the top left)
    const sh = c.createLinearGradient(0, -80, 0, 80);
    sh.addColorStop(0, 'rgba(255,255,255,0.12)');
    sh.addColorStop(0.5, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,20,0.35)');
    c.fillStyle = sh;
    c.fillRect(-L - 20, -90, L * 2 + 40, 180);
    c.restore();

    // outline
    bodyPath();
    c.strokeStyle = 'rgba(140,230,255,0.85)';
    c.lineWidth = 2.5;
    c.stroke();

    // pectoral fin
    c.beginPath();
    c.moveTo(L * 0.25, 30);
    c.quadraticCurveTo(L * 0.05, 85, -L * 0.25, 95);
    c.quadraticCurveTo(-L * 0.05, 60, -L * 0.05, 34);
    c.closePath();
    c.fillStyle = '#21457e';
    c.fill();
    c.strokeStyle = 'rgba(140,230,255,0.7)';
    c.stroke();

    // eye
    c.fillStyle = '#e8fbff';
    c.beginPath();
    c.ellipse(L * 0.62, -6, 7, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#04101f';
    c.beginPath();
    c.arc(L * 0.64, -6, 3.5, 0, Math.PI * 2);
    c.fill();
    // mouth line
    c.strokeStyle = 'rgba(10,20,40,0.7)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(L * 0.98, 8);
    c.quadraticCurveTo(L * 0.7, 20, L * 0.4, 14);
    c.stroke();
  });

  // tail flukes, pivot at the right edge (attached to the body's rear)
  canvas(scene, 'whaleTail', 120, 140, (c) => {
    c.translate(110, 70);
    c.shadowColor = '#3fd6ff';
    c.shadowBlur = 16;
    c.beginPath();
    c.moveTo(4, -10);
    c.quadraticCurveTo(-50, -12, -96, -62);
    c.quadraticCurveTo(-78, -10, -66, 0);
    c.quadraticCurveTo(-78, 10, -96, 62);
    c.quadraticCurveTo(-50, 12, 4, 10);
    c.closePath();
    const g = c.createLinearGradient(0, -60, 0, 60);
    g.addColorStop(0, '#2b4f8f');
    g.addColorStop(1, '#6f9fd6');
    c.fillStyle = g;
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(140,230,255,0.85)';
    c.lineWidth = 2.5;
    c.stroke();
  });
}
