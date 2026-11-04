// The Council: ask every engine voice about one position, probe the candidates the referee has not rated, look up
// the endgame tablebase when 7 or fewer pieces remain, then hand everything to the King Brain.
import { Chess } from '../vendor/chess.js';
import { decide, ratingWeights, unratedCandidates } from '../king/king.js';

export const TABLEBASE_URL = 'https://tablebase.lichess.org/standard';

export class Council {
  /**
   * @param {object} cfg  see kingfischer.config.example.json
   * @param {object} host
   * @param {(voice: object) => object} host.makeEngine  builds an engine for a voice; it needs start(), search(position, go,
   *        { options }) resolving to parseSearch() output, newGame() and quit(). Node uses UCI processes (council/node.js),
   *        the browser uses Web Workers and ONNX (bot/browser/council-web.js).
   */
  constructor(cfg, { makeEngine } = {}) {
    if (!makeEngine) throw new Error('Council needs a makeEngine(voice) function; in Node use nodeCouncil() from council/node.js');
    this.makeEngine = makeEngine;
    this.cfg = cfg;
    this.voices = new Map();
    this.weights = ratingWeights(Object.fromEntries(cfg.voices.filter(v => v.role === 'search').map(v => [v.id, v.rating])));
    for (const v of cfg.voices) if (v.role === 'human') this.weights[v.id] = 1;
    this.referee = cfg.referee || 'stockfish';
    this.fetch = cfg.fetch || (globalThis.fetch ? (...a) => globalThis.fetch(...a) : null);
  }

  async start() {
    for (const v of this.cfg.voices) {
      if (v.enabled === false) continue;
      const e = this.makeEngine(v);
      await e.start();
      this.voices.set(v.id, { cfg: v, engine: e });
    }
    if (!this.voices.has(this.referee)) throw new Error(`the referee voice "${this.referee}" is not configured or not enabled`);
    return this;
  }

  async newGame() { await Promise.all([...this.voices.values()].map(v => v.engine.newGame())); }

  quit() { for (const v of this.voices.values()) v.engine.quit(); }

  // Ask one voice. Human voices (Maia) run one node so the move is the network's own human prediction.
  // PolicyTemperature 1 reads the network's own probabilities; lc0's default (1.36) is tuned for search and flattens them.
  // `limits` carries UCI depth / nodes limits; an infinite budget runs `go infinite` until the Council is stopped.
  async ask(v, position, budgetMs, { limits = {}, searchmoves = null } = {}) {
    const c = v.cfg;
    if (c.role === 'human') {
      const r = await v.engine.search(position, 'nodes 1', { timeoutMs: HUMAN_TIMEOUT_MS, options: { VerboseMoveStats: 'true', PolicyTemperature: c.policyTemperature ?? 1 } });
      return { engine: c.id, role: 'human', name: c.name || v.engine.name, bestmove: r.bestmove, policy: r.policy || (r.bestmove ? { [r.bestmove]: 1 } : {}), lines: [] };
    }
    // UCI depth / node limits bind the referee, so fixed-depth tests stay meaningful; the other search voices then get
    // `limitGo` (default one second), because Leela on a CPU cannot reach a Stockfish-sized depth or node count.
    const limited = (limits.depth || limits.nodes) && c.id !== this.referee;
    const g = c.go || (limited ? c.limitGo || `movetime ${LIMITED_VOICE_MS}` : goFor(budgetMs, limits));
    const go = g + (searchmoves ? ` searchmoves ${searchmoves.join(' ')}` : '');
    const timeoutMs = limited ? (c.limitGo ? LIMIT_TIMEOUT_MS : LIMITED_VOICE_MS + GRACE_MS) : timeoutFor(budgetMs, limits);
    const r = await v.engine.search(position, go, { timeoutMs, options: { MultiPV: c.multipv || 3 } });
    return { engine: c.id, role: 'search', name: c.name || v.engine.name, bestmove: r.bestmove, lines: r.lines };
  }

  async tablebase(fen, timeoutMs = 2500) {
    if (this.cfg.tablebase === false || !this.fetch) return null;
    const pieces = fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
    if (pieces > 7) return null;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await this.fetch(`${this.cfg.tablebaseUrl || TABLEBASE_URL}?fen=${encodeURIComponent(fen)}`, { signal: ctl.signal });
      if (!res.ok) return null;
      const tb = await res.json();   // still under the timeout: a reply that stalls after its headers is aborted too
      return tb && tb.category && tb.category !== 'unknown' ? tb : null;
    } catch { return null; } finally { clearTimeout(t); }
  }

  /**
   * @param {object} p
   * @param {string} [p.fen]        start position (omit for the normal start)
   * @param {string[]} [p.moves]    moves played since, UCI
   * @param {number} [p.budgetMs]   total thinking time for this move; Infinity searches until `signal` aborts
   * @param {string} [p.mode]       'full' | 'human' | 'teach'
   * @param {number} [p.humanElo]
   * @param {string} [p.humanVoice] which human voice to use in human mode (e.g. 'maia1500'); defaults to the nearest level
   * @param {{depth?: number, nodes?: number}} [p.limits]  UCI search limits for the search voices
   * @param {string[]} [p.searchmoves]  only these root moves may be played (UCI `go searchmoves`)
   * @param {AbortSignal} [p.signal]    abort to stop every search now; the Council then decides with what it has
   */
  async think({ fen, moves = [], budgetMs = 1000, mode = 'full', humanElo = 1500, humanVoice, guard = 'soft', seed = null, limits = {}, searchmoves = null, signal = null }) {
    const game = new Chess(fen);
    for (const m of moves) game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    let legal = game.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
    const restricted = searchmoves?.length ? legal.filter(m => searchmoves.includes(m)) : null;
    if (restricted?.length) legal = restricted;
    const position = (fen ? `fen ${fen}` : 'startpos') + (moves.length ? ` moves ${moves.join(' ')}` : '');
    const base = { legal, mode, humanElo, guard, referee: this.referee, rules: this.cfg.rules };
    // rule 1 first: a sole legal move (or none) needs nobody, not even the tablebase
    if (legal.length <= 1) return { ...decide({ ...base, reports: [] }), reports: [] };
    const tb = restricted ? null : await this.tablebase(game.fen(), Number.isFinite(budgetMs) ? Math.max(100, Math.min(2500, budgetMs * 0.3)) : 2500);
    if (tb) return { ...decide({ ...base, reports: [], tablebase: tb }), reports: [] };

    // pick the human voice: the configured one nearest the requested level
    const humans = [...this.voices.values()].filter(v => v.cfg.role === 'human');
    const chosenHuman = humanVoice ? this.voices.get(humanVoice) : humans.sort((a, b) => Math.abs((a.cfg.level || 1500) - humanElo) - Math.abs((b.cfg.level || 1500) - humanElo))[0];
    const asked = [...this.voices.values()].filter(v => v.cfg.role === 'search' || v === chosenHuman);
    const stopAll = () => { for (const v of asked) v.engine.stop?.(); };
    signal?.addEventListener('abort', stopAll, { once: true });
    const notes = [];
    try {
      const first = Number.isFinite(budgetMs) ? budgetMs * 0.65 : Infinity;
      const sm = restricted ? legal : null;
      const answers = await Promise.all(asked.map(v => this.ask(v, position, first, { limits, searchmoves: sm }).catch(e => ({ engine: v.cfg.id, error: e.message }))));
      for (const r of answers) if (r.error) notes.push(`${r.engine} did not answer (${r.error}); it was left out.`);
      const reports = answers.filter(r => !r.error);
      for (const r of reports) if (r.policy) r.policy = standardCastling(r.policy, legal);

      // probe: the referee rates every candidate the others proposed, on its own scale
      const ref = reports.find(r => r.engine === this.referee);
      const todo = ref ? unratedCandidates(reports, { referee: this.referee }).filter(m => legal.includes(m)) : [];
      if (ref && todo.length) {
        const v = this.voices.get(this.referee);
        // the referee's own choice is searched again alongside the candidates, so the comparison comes from one search
        const probe = ref.bestmove ? [ref.bestmove, ...todo] : todo;
        const probeMs = signal?.aborted || !Number.isFinite(budgetMs) ? PROBE_AFTER_STOP_MS : Math.max(50, Math.round(budgetMs * 0.3));
        const probeLimits = limits.depth || limits.nodes ? limits : {};
        try {
          const r = await v.engine.search(position, `${goFor(probeMs, probeLimits)} searchmoves ${probe.join(' ')}`, { timeoutMs: timeoutFor(probeMs, probeLimits), options: { MultiPV: probe.length } });
          for (const l of r.lines) {
            const i = ref.lines.findIndex(x => x.move === l.move);
            if (i >= 0) ref.lines[i] = { ...l, probed: true }; else ref.lines.push({ ...l, probed: true });
          }
        } catch (e) {
          // no extra ratings: the King still vetoes every candidate the referee has not rated
          notes.push(`The referee's check of the other candidates failed (${e.message}); unrated moves were blocked.`);
        }
      }
      const verdict = decide({ ...base, reports, weights: this.weights, seed });
      verdict.explanation.push(...notes);
      return { ...verdict, reports };
    } finally { signal?.removeEventListener('abort', stopAll); }
  }
}

const HUMAN_TIMEOUT_MS = 15000;       // one network evaluation; generous for the first load of a net
const PROBE_AFTER_STOP_MS = 200;      // after `stop` or an infinite search, the referee gets a short final check
const LIMIT_TIMEOUT_MS = 10 * 60000;  // fixed depth / node searches: no clock, but never hang forever
const GRACE_MS = 5000;
const LIMITED_VOICE_MS = 1000;       // non-referee search voices under a UCI depth / nodes limit                // a timed search may overrun its movetime by this much before it counts as hung

function goFor(ms, limits = {}) {
  if (limits.depth) return `depth ${limits.depth}`;
  if (limits.nodes) return `nodes ${limits.nodes}`;
  return Number.isFinite(ms) ? `movetime ${Math.max(50, Math.round(ms))}` : 'infinite';
}
function timeoutFor(ms, limits = {}) {
  if (limits.depth || limits.nodes) return LIMIT_TIMEOUT_MS;
  return Number.isFinite(ms) ? Math.max(50, Math.round(ms)) + GRACE_MS : null;   // null: no timeout, ended by stop()
}

// Lc0's VerboseMoveStats names castling "king takes rook" (e1h1, e1a1); everything else here uses UCI's e1g1 / e1c1.
const CASTLE = { e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' };
export function standardCastling(policy, legal) {
  const ok = new Set(legal), out = {};
  for (const [m, p] of Object.entries(policy)) out[!ok.has(m) && CASTLE[m] && ok.has(CASTLE[m]) ? CASTLE[m] : m] = p;
  return out;
}
