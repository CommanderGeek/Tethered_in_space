// Graphics quality levels. "auto" starts at a level that suits the device and
// steps down automatically when the frame rate keeps dropping.

export type QualityLevel = 'high' | 'medium' | 'low';
export type QualitySetting = 'auto' | QualityLevel;

export interface QualityProfile {
  bloom: boolean;
  vignette: boolean;
  /** foreground dust and twinkling stars */
  extraBackground: boolean;
  /** multiplier for particle counts */
  particles: number;
  /** tether segments (fewer = cheaper) */
  tetherSegments: number;
  /** wide soft glow around the tether */
  tetherGlow: boolean;
  /** gravity ripples + atmosphere glow around planets */
  planetFx: boolean;
  /** moving star layer (parallax) */
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
  } catch { /* private mode etc. */ }
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

  /** cycles: auto -> high -> medium -> low -> auto */
  cycle(): QualitySetting {
    const all: QualitySetting[] = ['auto', 'high', 'medium', 'low'];
    this.setting = all[(all.indexOf(this.setting) + 1) % all.length];
    try { localStorage.setItem(STORAGE_KEY, this.setting); } catch { /* ignore */ }
    this.apply(this.setting === 'auto' ? (isTouchDevice() ? 'medium' : 'high') : this.setting);
    return this.setting;
  }

  /** Call every frame. In auto mode, steps down when FPS stay below 45. */
  tick(deltaMs: number, now: number) {
    if (deltaMs <= 0 || deltaMs > 500) return; // tab was in the background
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
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
