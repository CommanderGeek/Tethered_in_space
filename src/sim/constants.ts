// Alle Tuning-Werte an einem Ort – hier wird das Spielgefühl eingestellt.

/** Bei inkompatiblen Änderungen an Nachrichten/Snapshots hochzählen! */
export const PROTOCOL_VERSION = 2;

export const WORLD_W = 1600;
export const WORLD_H = 900;
export const WALL_MARGIN = 20;

export const TICK_RATE = 60; // Simulationsschritte pro Sekunde (nur Host)
export const SNAPSHOT_EVERY = 2; // jeder 2. Tick => 30 Snapshots/s

// Schiffe
export const SHIP_RADIUS = 14;
export const SHIP_ACCEL = 900;
export const SHIP_MAX_SPEED = 520;
export const SHIP_DRAG = 0.8; // pro Sekunde (exponentiell)
export const ANCHOR_DRAG = 7;
export const ANCHOR_ACCEL_FACTOR = 0.2;
export const ANCHOR_INV_MASS = 0.15; // verankert = schwer
export const SHIP_INVULN_TIME = 1.2;
export const SHIP_KNOCKBACK = 380;

// Seil
export const ROPE_LENGTH = 320; // ab hier spannt das Seil
export const ROPE_STIFFNESS = 14;
export const ROPE_DAMPING = 4;
export const ROPE_SNAP_STRETCH = 58; // Überdehnung, bei der das Seil reißt
export const ROPE_RELINK_DIST = 200; // so nah müsst ihr ran, um neu zu verbinden
export const ROPE_CUT_SPEED = 140; // min. Quergeschwindigkeit des Seils zum Schneiden

// Asteroiden
export const AST_SPLIT_MIN_R = 34; // kleiner => wird zerstört statt geteilt
export const AST_CHILD_SCALE = 0.62;
export const AST_GRACE_TIME = 0.35; // frisch geteilte Brocken sind kurz unschneidbar

// Team
export const HULL_MAX = 100;
export const HULL_REGEN_PER_WAVE = 15;
export const COMBO_WINDOW = 1.6;
export const COMBO_MAX = 8;
export const INTERMISSION_TIME = 2.5;

// Planeten & Slingshot
export const PLANET_SURFACE_G = 620; // Schwerkraft an der Oberfläche eines r=70-Planeten
export const GRAVITY_RANGE = 5.5; // Reichweite in Planetenradien
export const ASTEROID_GRAVITY_FACTOR = 0.45;
export const PLANET_FADE_TIME = 1.4;
export const PLANET_CRASH_SPEED = 220; // Aufprall schneller als das kostet Hülle
export const PLANET_CRASH_DAMAGE = 6;
export const SLING_ZONE = 2.3; // innerhalb von r * SLING_ZONE ...
export const SLING_MIN_SPEED = 430; // ... und schneller als das => Slingshot!
export const SLING_TIME = 1.8; // so lange hält der Boost
export const SLING_SPEED_FACTOR = 1.5; // höhere Höchstgeschwindigkeit im Boost
export const SLING_SCORE_FACTOR = 2; // Punkte-Multiplikator für Schnitte im Boost

/** Planeten pro Welle: [x, y, radius, kind]. Die Liste wiederholt sich. */
export const PLANET_LAYOUTS: [number, number, number, number][][] = [
  [[1180, 300, 70, 0]],
  [[420, 640, 58, 1], [1220, 260, 48, 3]],
  [[800, 450, 85, 2]],
  [[300, 250, 42, 3], [1300, 650, 52, 1], [820, 160, 34, 2]],
  [[560, 330, 64, 0], [1110, 600, 64, 1]],
];
