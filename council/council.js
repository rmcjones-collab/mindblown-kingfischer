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
  async ask(v, position, budgetMs) {
    const c = v.cfg;
    if (c.role === 'human') {
      const r = await v.engine.search(position, 'nodes 1', { options: { VerboseMoveStats: 'true', PolicyTemperature: c.policyTemperature ?? 1 } });
      return { engine: c.id, role: 'human', name: c.name || v.engine.name, bestmove: r.bestmove, policy: r.policy || (r.bestmove ? { [r.bestmove]: 1 } : {}), lines: [] };
    }
    const go = c.go || `movetime ${Math.max(50, Math.round(budgetMs))}`;
    const r = await v.engine.search(position, go, { options: { MultiPV: c.multipv || 3 } });
    return { engine: c.id, role: 'search', name: c.name || v.engine.name, bestmove: r.bestmove, lines: r.lines };
  }

  async tablebase(fen) {
    if (this.cfg.tablebase === false || !this.fetch) return null;
    const pieces = fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
    if (pieces > 7) return null;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
      const res = await this.fetch(`${this.cfg.tablebaseUrl || TABLEBASE_URL}?fen=${encodeURIComponent(fen)}`, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const tb = await res.json();
      return tb && tb.category && tb.category !== 'unknown' ? tb : null;
    } catch { return null; }
  }

  /**
   * @param {object} p
   * @param {string} [p.fen]        start position (omit for the normal start)
   * @param {string[]} [p.moves]    moves played since, UCI
   * @param {number} [p.budgetMs]   total thinking time for this move
   * @param {string} [p.mode]       'full' | 'human' | 'teach'
   * @param {number} [p.humanElo]
   * @param {string} [p.humanVoice] which human voice to use in human mode (e.g. 'maia1500'); defaults to the nearest level
   */
  async think({ fen, moves = [], budgetMs = 1000, mode = 'full', humanElo = 1500, humanVoice, guard = 'soft', seed = null }) {
    const game = new Chess(fen);
    for (const m of moves) game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    const legal = game.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
    const position = (fen ? `fen ${fen}` : 'startpos') + (moves.length ? ` moves ${moves.join(' ')}` : '');
    const tb = await this.tablebase(game.fen());
    if (legal.length <= 1 || tb) return { ...decide({ legal, reports: [], tablebase: tb, mode, humanElo }), reports: [] };

    // pick the human voice: the configured one nearest the requested level
    const humans = [...this.voices.values()].filter(v => v.cfg.role === 'human');
    const chosenHuman = humanVoice ? this.voices.get(humanVoice) : humans.sort((a, b) => Math.abs((a.cfg.level || 1500) - humanElo) - Math.abs((b.cfg.level || 1500) - humanElo))[0];
    const asked = [...this.voices.values()].filter(v => v.cfg.role === 'search' || v === chosenHuman);
    const first = budgetMs * 0.65;
    const reports = (await Promise.all(asked.map(v => this.ask(v, position, first).catch(e => ({ engine: v.cfg.id, error: e.message }))))).filter(r => !r.error);
    for (const r of reports) if (r.policy) r.policy = standardCastling(r.policy, legal);

    // probe: the referee rates every candidate the others proposed, on its own scale
    const ref = reports.find(r => r.engine === this.referee);
    const todo = ref ? unratedCandidates(reports, { referee: this.referee }) : [];
    if (ref && todo.length) {
      const v = this.voices.get(this.referee);
      // the referee's own choice is searched again alongside the candidates, so the comparison comes from one search
      const probe = ref.bestmove ? [ref.bestmove, ...todo] : todo;
      const r = await v.engine.search(position, `movetime ${Math.max(50, Math.round(budgetMs * 0.3))} searchmoves ${probe.join(' ')}`, { options: { MultiPV: probe.length } });
      for (const l of r.lines) {
        const i = ref.lines.findIndex(x => x.move === l.move);
        if (i >= 0) ref.lines[i] = { ...l, probed: true }; else ref.lines.push({ ...l, probed: true });
      }
    }
    const verdict = decide({ legal, reports, weights: this.weights, mode, humanElo, guard, seed, referee: this.referee, rules: this.cfg.rules });
    return { ...verdict, reports };
  }
}

// Lc0's VerboseMoveStats names castling "king takes rook" (e1h1, e1a1); everything else here uses UCI's e1g1 / e1c1.
const CASTLE = { e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' };
export function standardCastling(policy, legal) {
  const ok = new Set(legal), out = {};
  for (const [m, p] of Object.entries(policy)) out[!ok.has(m) && CASTLE[m] && ok.has(CASTLE[m]) ? CASTLE[m] : m] = p;
  return out;
}
