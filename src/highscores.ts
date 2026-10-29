// Highscore list, stored per browser (localStorage). Both players save the run
// on their own device, so each of you builds up your own list.

export interface Highscore {
  team: string;
  score: number;
  wave: number;
  /** ISO date */
  date: string;
  mode: 'online' | 'local';
}

const KEY = 'tethered.highscores';
const NAME_KEY = 'tethered.teamName';
const MAX_ENTRIES = 10;

export function loadHighscores(): Highscore[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Highscore[]) : [];
    return Array.isArray(list) ? list.filter((h) => typeof h.score === 'number') : [];
  } catch {
    return [];
  }
}

/** Would this score make it onto the list? */
export function qualifies(score: number): boolean {
  if (score <= 0) return false;
  const list = loadHighscores();
  return list.length < MAX_ENTRIES || score > list[list.length - 1].score;
}

/** Saves a run and returns its rank (1-based), or 0 if it didn't make the list. */
export function saveHighscore(entry: Highscore): number {
  const list = loadHighscores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score || b.wave - a.wave);
  const trimmed = list.slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    localStorage.setItem(NAME_KEY, entry.team);
  } catch { /* private mode etc. — the list just won't persist */ }
  return trimmed.indexOf(entry) + 1;
}

export function lastTeamName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
