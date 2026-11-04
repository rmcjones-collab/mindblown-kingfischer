// What the Lichess bot accepts and how it spends its clock. Pure functions, so they are unit-tested without Lichess.
import { budgetFrom } from '../../council/config.js';

export const DEFAULTS = {
  maxGames: 1,                                   // games at once (each game runs the whole council)
  speeds: ['blitz', 'rapid', 'classical', 'correspondence'],
  variants: ['standard', 'fromPosition'],
  rated: true, casual: true,
  bots: false,                                   // accept challenges from other bots
  minInitialSeconds: 60,                         // the council needs time to talk; bullet is declined
  mode: 'full', humanElo: 1500, guard: 'soft',
  correspondenceMs: 20000,                       // thinking time per move when there is no clock
};

// Decide on a challenge. Returns { ok, reason } with a reason from the Lichess decline list.
export function acceptable(c, cfg = {}, liveGames = 0) {
  const k = { ...DEFAULTS, ...cfg };
  if (!k.variants.includes(c.variant?.key)) return { ok: false, reason: 'variant' };
  if (c.challenger?.title === 'BOT' && !k.bots) return { ok: false, reason: 'noBot' };
  if (c.rated && !k.rated) return { ok: false, reason: 'casual' };
  if (!c.rated && !k.casual) return { ok: false, reason: 'rated' };
  if (!k.speeds.includes(c.speed)) return { ok: false, reason: c.speed === 'bullet' || c.speed === 'ultraBullet' ? 'tooFast' : 'timeControl' };
  const tc = c.timeControl || {};
  if (tc.type === 'clock' && tc.limit < k.minInitialSeconds) return { ok: false, reason: 'tooFast' };
  // capacity last, so a challenge that would never be accepted gets its real reason rather than 'later'
  if (liveGames >= k.maxGames) return { ok: false, reason: 'later' };
  return { ok: true, reason: null };
}

// Mode for a new game: the configured default.
export function modeFromChallenge(_c, cfg = {}) {
  const k = { ...DEFAULTS, ...cfg };
  return { mode: k.mode, humanElo: k.humanElo };
}

// A chat command from the opponent before move 2 switches the mode: "!full", "!teach", "!human 1300".
export function modeFromChat(text) {
  const m = String(text || '').trim().toLowerCase().match(/^!(full|teach|human)(?:\s+(\d{4}))?$/);
  if (!m) return null;
  const out = { mode: m[1] };
  if (m[1] === 'human') out.humanElo = Math.min(1900, Math.max(1100, m[2] ? +m[2] : 1500));
  return out;
}

// Thinking time for one move from a Lichess gameState (clock fields in milliseconds).
export function budgetForLichess(s, color, cfg = {}) {
  const k = { ...DEFAULTS, ...cfg };
  const big = 2 ** 31 - 1;   // correspondence and unlimited games report huge or missing clocks
  if (s.wtime == null || s.wtime >= big || s.btime >= big) return k.correspondenceMs;
  return budgetFrom({ wtime: s.wtime, btime: s.btime, winc: s.winc, binc: s.binc }, color === 'white' ? 'w' : 'b');
}

// Lichess chat lines are short; keep the King's first reason to 140 characters.
export function chatLine(text) { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length <= 140 ? t : t.slice(0, 139) + '…'; }
