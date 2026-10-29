// Alle Grafiken werden beim Start prozedural per Canvas erzeugt – keine Bilddateien nötig.
// Lichtquelle für alle Objekte: oben links (passend zur Sonne im Hintergrund).

import Phaser from 'phaser';
import { WORLD_H, WORLD_W } from '../sim/constants';

export const SHIP_TEX_SIZE = 128;
export const PLANET_TEX = 512; // Canvas-Größe
export const PLANET_DIAM = 220; // Durchmesser des Planeten im Canvas
export const ASTEROID_VARIANTS = 8;
export const ASTEROID_TEX = 160;
export const ASTEROID_RADIUS_IN_TEX = 64;

type Ctx = CanvasRenderingContext2D;

/** kleiner, deterministischer Zufall für reproduzierbare Texturen */
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
  backgroundTextures(scene);
}

// ------------------------------------------------------------ Kleinkram

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

  canvas(scene, 'shard', 12, 10, (c) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(12, 4);
    c.lineTo(3, 10);
    c.closePath();
    c.fill();
  });

  // Stern mit Lichtkreuz
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

  // Triebwerksflamme (zeigt nach links, Ursprung rechts)
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

// ------------------------------------------------------------ Schiffe

function shipTextures(scene: Phaser.Scene, colors: readonly number[]) {
  colors.forEach((col, i) => {
    const S = SHIP_TEX_SIZE;
    canvas(scene, `ship${i}`, S, S, (c) => {
      const C = hex(col);
      c.translate(S / 2, S / 2);
      // Schiff zeigt nach rechts; Länge ~90px

      // Glow
      c.shadowColor = C;
      c.shadowBlur = 18;

      // Flügel
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

      // Rumpf
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

      // Farbstreifen auf den Flügeln
      c.strokeStyle = C;
      c.globalAlpha = 0.85;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(-8, 14); c.lineTo(-28, 30);
      c.moveTo(-8, -14); c.lineTo(-28, -30);
      c.stroke();
      c.globalAlpha = 1;

      // Cockpit
      const cg = c.createLinearGradient(8, -6, 26, 6);
      cg.addColorStop(0, '#ffffff');
      cg.addColorStop(0.4, C);
      cg.addColorStop(1, '#0a0d1d');
      c.fillStyle = cg;
      c.beginPath();
      c.ellipse(16, 0, 12, 5, 0, 0, Math.PI * 2);
      c.fill();

      // Triebwerksdüsen
      c.fillStyle = '#ffffff';
      c.shadowColor = C;
      c.shadowBlur = 12;
      c.fillRect(-36, -8, 5, 5);
      c.fillRect(-36, 3, 5, 5);
      c.shadowBlur = 0;

      // Glanzlicht oben
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(40, -2);
      c.quadraticCurveTo(14, -10, -20, -8);
      c.stroke();
    });
  });

  // Schild-Blase
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

// ------------------------------------------------------------ Asteroiden

/** Konturfaktoren für Variante v (vom Renderer auch für die Physik-Optik genutzt) */
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

      // Grundkörper
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
      // Körnung
      for (let i = 0; i < 260; i++) {
        c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
        c.fillRect(S / 2 + (rnd() - 0.5) * 2 * R, S / 2 + (rnd() - 0.5) * 2 * R, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
      }
      // Krater
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
        // heller Kraterrand unten rechts (Licht von oben links)
        c.strokeStyle = 'rgba(220,210,255,0.18)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(x, y, cr * 0.95, 0.1 * Math.PI, 0.9 * Math.PI);
        c.stroke();
      }
      c.restore();

      // Randlicht
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

// ------------------------------------------------------------ Planeten

interface PlanetStyle {
  base: [string, string, string];
  bands: string[];
  atmo: string;
  ring?: string;
  spots?: string;
  cracks?: string;
}

export const PLANET_STYLES: PlanetStyle[] = [
  // 0: Gasriese mit Ring
  { base: ['#ffe2b0', '#d98a4e', '#5a2a1a'], bands: ['rgba(255,240,210,0.35)', 'rgba(140,60,30,0.35)', 'rgba(255,190,120,0.3)'], atmo: 'rgba(255,170,100,', ring: 'rgba(240,210,170,' },
  // 1: Eis
  { base: ['#f2fbff', '#7cc6ee', '#163a6e'], bands: ['rgba(255,255,255,0.3)', 'rgba(60,140,210,0.25)'], atmo: 'rgba(120,200,255,', spots: 'rgba(255,255,255,0.45)' },
  // 2: Lava
  { base: ['#8a4a3a', '#3a1414', '#120505'], bands: ['rgba(0,0,0,0.25)'], atmo: 'rgba(255,90,40,', cracks: '#ff7a2a' },
  // 3: Toxisch
  { base: ['#e8ffcf', '#5fc48a', '#0f3a3a'], bands: ['rgba(200,255,150,0.3)', 'rgba(20,90,80,0.35)', 'rgba(120,230,170,0.25)'], atmo: 'rgba(120,255,170,' },
];

function planetTextures(scene: Phaser.Scene) {
  PLANET_STYLES.forEach((st, kind) => {
    canvas(scene, `planet${kind}`, PLANET_TEX, PLANET_TEX, (c) => {
      const rnd = seeded(9000 + kind * 13);
      const cx = PLANET_TEX / 2;
      const cy = PLANET_TEX / 2;
      const R = PLANET_DIAM / 2;

      // Atmosphäre (außen)
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
        // vordere Hälfte = untere Hälfte der Ellipse
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

      // Kugel
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

      // Bänder (leicht wellig, schräg)
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

      // Schattenseite (Licht von oben links)
      const shade = c.createRadialGradient(cx - R * 0.55, cy - R * 0.6, R * 0.3, cx - R * 0.2, cy - R * 0.2, R * 1.75);
      shade.addColorStop(0, 'rgba(0,0,0,0)');
      shade.addColorStop(0.55, 'rgba(0,0,10,0.25)');
      shade.addColorStop(1, 'rgba(0,0,10,0.92)');
      c.fillStyle = shade;
      c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      c.restore();

      // Lichtsaum oben links
      c.strokeStyle = st.atmo + '0.8)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(cx, cy, R - 1, Math.PI * 0.95, Math.PI * 1.6);
      c.stroke();

      ring(true);
    });
  });
}

// ------------------------------------------------------------ Hintergrund

function backgroundTextures(scene: Phaser.Scene) {
  const W = WORLD_W;
  const H = WORLD_H;
  const rnd = seeded(4242);

  canvas(scene, 'nebula', W, H, (c) => {
    c.fillStyle = '#03040b';
    c.fillRect(0, 0, W, H);

    // weiche Nebelwolken
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

    // Staubbänder (abdunkeln)
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

    // ferne Spiralgalaxie
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

    // Sonne oben links (teilweise außerhalb)
    const sun = c.createRadialGradient(-60, -80, 0, -60, -80, 520);
    sun.addColorStop(0, 'rgba(255,240,210,0.55)');
    sun.addColorStop(0.15, 'rgba(255,200,150,0.18)');
    sun.addColorStop(0.5, 'rgba(255,140,120,0.05)');
    sun.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = sun;
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
  });

  const layers = [
    { key: 'stars0', n: 380, size: 0.8, alpha: 0.5 },
    { key: 'stars1', n: 120, size: 1.3, alpha: 0.75 },
    { key: 'stars2', n: 35, size: 2, alpha: 1 },
  ];
  for (const l of layers) {
    canvas(scene, l.key, 512, 512, (c) => {
      for (let i = 0; i < l.n; i++) {
        c.globalAlpha = l.alpha * (0.35 + rnd() * 0.65);
        c.fillStyle = ['#ffffff', '#cfe6ff', '#ffe9d6', '#d9d0ff', '#bfefff'][i % 5];
        c.beginPath();
        c.arc(rnd() * 512, rnd() * 512, l.size * (0.6 + rnd() * 0.7), 0, Math.PI * 2);
        c.fill();
      }
    });
  }

  // Vordergrund-Staub (weich, unscharf)
  canvas(scene, 'dust', 512, 512, (c) => {
    for (let i = 0; i < 18; i++) {
      const x = rnd() * 512;
      const y = rnd() * 512;
      const r = 2 + rnd() * 5;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(180,200,255,0.35)');
      g.addColorStop(1, 'rgba(180,200,255,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  });
}
