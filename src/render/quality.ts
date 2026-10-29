// Grafik-Qualitätsstufen. "auto" startet passend zum Gerät und schaltet
// automatisch herunter, wenn die Bildrate dauerhaft einbricht.

export type QualityLevel = 'high' | 'medium' | 'low';
export type QualitySetting = 'auto' | QualityLevel;

export interface QualityProfile {
  bloom: boolean;
  vignette: boolean;
  /** Vordergrund-Staub und funkelnde Sterne */
  extraBackground: boolean;
  /** Multiplikator für Partikelmengen */
  particles: number;
  /** Segmente des Seils (weniger = günstiger) */
  tetherSegments: number;
  /** breiter, weicher Glow ums Seil */
  tetherGlow: boolean;
  /** Gravitationswellen + Atmosphären-Glow um Planeten */
  planetFx: boolean;
  /** bewegte Sternebene (Parallaxe) */
  parallaxStars: boolean;
}

export const PROFILES: Record<QualityLevel, QualityProfile> = {
  high: { bloom: true, vignette: true, extraBackground: true, particles: 1, tetherSegments: 22, tetherGlow: true, planetFx: true, parallaxStars: true },
  medium: { bloom: false, vignette: true, extraBackground: true, particles: 0.7, tetherSegments: 16, tetherGlow: true, planetFx: true, parallaxStars: true },
  low: { bloom: false, vignette: true, extraBackground: false, particles: 0.4, tetherSegments: 10, tetherGlow: false, planetFx: false, parallaxStars: false },
};

const ORDER: QualityLevel[] = ['high', 'medium', 'low'];
const STORAGE_KEY = 'tethered.quality';

export const isTouchDevice = () =>
  matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

function loadSetting(): QualitySetting {
  const fromUrl = new URLSearchParams(location.search).get('quality');
  if (fromUrl && ['auto', 'high', 'medium', 'low'].includes(fromUrl)) return fromUrl as QualitySetting;
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s && ['auto', 'high', 'medium', 'low'].includes(s)) return s as QualitySetting;
  } catch { /* privater Modus o.ä. */ }
  return 'auto';
}

class QualityManager {
  setting: QualitySetting = loadSetting();
  level: QualityLevel = 'high';
  private listeners: ((p: QualityProfile, level: QualityLevel) => void)[] = [];
  private fpsAvg = 60;
  private lowSince = 0;
  private lastChange = 0;

  constructor() {
    this.level = this.setting === 'auto' ? (isTouchDevice() ? 'medium' : 'high') : this.setting;
  }

  get profile(): QualityProfile {
    return PROFILES[this.level];
  }

  get fps(): number {
    return this.fpsAvg;
  }

  onChange(cb: (p: QualityProfile, level: QualityLevel) => void) {
    this.listeners.push(cb);
  }

  /** Reihum: auto -> hoch -> mittel -> niedrig -> auto */
  cycle(): QualitySetting {
    const all: QualitySetting[] = ['auto', 'high', 'medium', 'low'];
    this.setting = all[(all.indexOf(this.setting) + 1) % all.length];
    try { localStorage.setItem(STORAGE_KEY, this.setting); } catch { /* egal */ }
    this.apply(this.setting === 'auto' ? (isTouchDevice() ? 'medium' : 'high') : this.setting);
    return this.setting;
  }

  /** Jeden Frame aufrufen. Senkt im Auto-Modus die Stufe bei dauerhaft < 45 FPS. */
  tick(deltaMs: number, now: number) {
    if (deltaMs <= 0 || deltaMs > 500) return; // Tab war im Hintergrund
    this.fpsAvg += (1000 / deltaMs - this.fpsAvg) * 0.05;
    if (this.setting !== 'auto') return;

    if (this.fpsAvg < 45) {
      if (!this.lowSince) this.lowSince = now;
      if (now - this.lowSince > 2500 && now - this.lastChange > 4000) {
        const i = ORDER.indexOf(this.level);
        if (i < ORDER.length - 1) {
          console.info(`[quality] ${Math.round(this.fpsAvg)} FPS -> ${ORDER[i + 1]}`);
          this.apply(ORDER[i + 1]);
        }
        this.lowSince = 0;
      }
    } else {
      this.lowSince = 0;
    }
  }

  private apply(level: QualityLevel) {
    this.level = level;
    this.lastChange = performance.now();
    this.fpsAvg = 60;
    for (const cb of this.listeners) cb(this.profile, level);
  }
}

export const quality = new QualityManager();

export const QUALITY_LABELS: Record<QualitySetting, string> = {
  auto: 'Auto',
  high: 'Hoch',
  medium: 'Mittel',
  low: 'Niedrig',
};
