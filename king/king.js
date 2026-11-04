// King Brain: the last output gate of the Kingfischer council.
//
// Every engine brain (the Council) reports on the same position; the King Brain weighs those reports and decides the one
// move Kingfischer plays, with a plain-language account of why. The function is pure: it never starts an engine, never
// touches the network and never reads a clock, so the desktop UCI engine, the Lichess bot and the browser all share it.
//
// A report (one per engine voice):
//   { engine: 'stockfish', role: 'search' | 'human', name?: 'Stockfish 19',
//     bestmove: 'e2e4',
//     lines: [{ move, cp?, mate?, wdl?: [w, d, l], depth?, pv?: [] }],   // search engines (MultiPV); side-to-move view
//     policy: { e2e4: 0.36, ... } }                                       // human engines (Maia): move probabilities
//
// The referee is the search report named by options.referee (Stockfish by default). Its lines put every candidate on one
// scale (expected score for the side to move), which is what the safety check uses.

export const MODES = ['full', 'human', 'teach'];

// Rules of the gate. Margins are in expected score (0..1) for the side to move, measured by the referee.
export const DEFAULT_RULES = {
  // A council candidate may replace the referee's own choice only if the referee rates it this close.
  fullMargin: 0.02,
  // Human mode: how much expected score a human-like move may give away before the blunder guard steps in, by level.
  // 'soft' keeps human mistakes but blocks the worst; 'strict' plays nearer to the engines; 'off' plays Maia as is.
  humanMargins: { soft: { 1100: 0.30, 1500: 0.20, 1900: 0.12 }, strict: { 1100: 0.12, 1500: 0.08, 1900: 0.05 }, off: null },
  // Mates the human mode will always find, by level (mate in N moves for the side to move).
  humanMateHorizon: { 1100: 1, 1500: 2, 1900: 3 },
  // A search engine's non-best MultiPV lines earn partial support that fades to zero at this loss.
  supportFade: 0.05,
  // Weight of the human (Maia) voice in full and teach modes: a style tiebreak, not a decision maker.
  humanWeightInFull: 0.15,
};

// Base weights from rating: an engine 400 points below the strongest gets a tenth of its vote (the Elo scale).
export function ratingWeights(ratings) {
  const top = Math.max(...Object.values(ratings));
  return Object.fromEntries(Object.entries(ratings).map(([k, r]) => [k, Math.pow(10, (r - top) / 400)]));
}

// Expected score for the side to move from a line: win-draw-loss when the engine gives it, else the logistic of the
// centipawn score (400 cp ≈ 10:1 odds, the Elo convention), mates as certain.
export function expectedScore(line) {
  if (!line) return null;
  if (line.mate != null) return line.mate > 0 ? 1 : 0;
  if (Array.isArray(line.wdl) && line.wdl.length === 3) {
    const [w, d, l] = line.wdl; const t = w + d + l;
    if (t > 0) return (w + d / 2) / t;
  }
  if (line.cp != null) return 1 / (1 + Math.pow(10, -line.cp / 400));
  return null;
}

function nearestLevel(table, elo) {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) if (Math.abs(k - elo) < Math.abs(best - elo)) best = k;
  // interpolate linearly between the nearest two levels so 1300 sits between 1100 and 1500
  const lo = [...keys].reverse().find(k => k <= elo) ?? keys[0];
  const hi = keys.find(k => k >= elo) ?? keys[keys.length - 1];
  if (lo === hi || typeof table[lo] !== 'number') return table[best];
  return table[lo] + (table[hi] - table[lo]) * (elo - lo) / (hi - lo);
}

function fmtES(x) { return x == null ? 'unrated' : `${(x * 100).toFixed(1)}%`; }
function label(r) { return r.name || r.engine; }

// Deterministic pseudo-random in [0, 1) from a seed, for reproducible human-mode sampling.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Which candidate moves the referee has not rated yet. The council probes these (UCI `searchmoves`) and adds the lines
// to the referee report before calling decide(), so every candidate is judged on the same scale.
// Human moves are probed when they are among the top `humanTop` or at least `humanMin` likely, up to `humanMax` of them.
export function unratedCandidates(reports, { referee = 'stockfish', humanTop = 3, humanMin = 0.05, humanMax = 6 } = {}) {
  const ref = reports.find(r => r.engine === referee);
  if (!ref) return [];
  const rated = new Set((ref.lines || []).map(l => l.move));
  const want = new Set();
  for (const r of reports) {
    if (r.bestmove) want.add(r.bestmove);
    if (r.policy) Object.entries(r.policy).sort((a, b) => b[1] - a[1]).filter(([, p], i) => i < humanTop || p >= humanMin).slice(0, humanMax).forEach(([m]) => want.add(m));
  }
  return [...want].filter(m => !rated.has(m));
}

// Pick a tablebase move. `tb` is the Lichess tablebase reply: `category` for the position and `moves` best-first, each
// with the category for the opponent after the move (so 'loss' there is a win for us).
function tablebaseChoice(tb, legal, human) {
  if (!tb || !Array.isArray(tb.moves) || !tb.moves.length) return null;
  const moves = tb.moves.filter(m => legal.includes(m.uci));
  if (!moves.length) return null;
  const bestCat = moves[0].category;
  if (human && human.policy) {
    // keep the result the tablebase promises, but play the most human of the moves that keep it
    const keep = moves.filter(m => m.category === bestCat);
    const pick = keep.slice().sort((a, b) => (human.policy[b.uci] || 0) - (human.policy[a.uci] || 0))[0];
    return { move: pick.uci, category: tb.category, kept: keep.length };
  }
  return { move: moves[0].uci, category: tb.category, kept: 1 };
}

/**
 * Decide the move.
 * @param {object} input
 * @param {string[]} input.legal       legal moves in UCI
 * @param {object[]} input.reports     council reports (see top of file)
 * @param {object} [input.weights]     engine id → vote weight (ratingWeights() of the roster)
 * @param {string} [input.mode]        'full' | 'human' | 'teach'
 * @param {number} [input.humanElo]    1100..1900, human mode
 * @param {string} [input.guard]       'soft' | 'strict' | 'off', human mode blunder guard
 * @param {object} [input.tablebase]   Lichess tablebase reply for this position, if it has 7 or fewer pieces
 * @param {number|null} [input.seed]   human mode: sample Maia's distribution with this seed; null plays its top move
 * @param {string} [input.referee]     engine id of the referee
 * @param {object} [input.rules]       overrides for DEFAULT_RULES
 * @returns {{move: string|null, mode: string, reason: string, explanation: string[], votes: object[], vetoed: object[]}}
 */
export function decide(input) {
  const { legal = [], reports = [], weights = {}, mode = 'full', humanElo = 1500, guard = 'soft', tablebase = null, seed = null, referee = 'stockfish' } = input;
  const rules = { ...DEFAULT_RULES, ...(input.rules || {}) };
  if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode}`);
  if (mode === 'human') {
    if (!Number.isFinite(humanElo)) throw new Error(`humanElo must be a number, got ${humanElo}`);
    if (!Object.hasOwn(rules.humanMargins, guard)) throw new Error(`unknown guard ${guard}; use ${Object.keys(rules.humanMargins).join(', ')}`);
  }
  const explanation = [];
  const out = (move, reason, votes = [], vetoed = []) => ({ move, mode, reason, explanation, votes, vetoed });
  if (!legal.length) { explanation.push('No legal moves: the game is over.'); return out(null, 'game-over'); }

  const valid = reports.filter(r => r && (r.bestmove ? legal.includes(r.bestmove) : true));
  for (const r of reports) if (r && r.bestmove && !legal.includes(r.bestmove)) explanation.push(`${label(r)} suggested ${r.bestmove}, which is not legal here; its report was set aside.`);
  const ref = valid.find(r => r.engine === referee && r.role === 'search');
  const human = valid.find(r => r.role === 'human');
  const searchers = valid.filter(r => r.role === 'search');

  // 1. Only move.
  if (legal.length === 1) { explanation.push(`Only one legal move: ${legal[0]}.`); return out(legal[0], 'only-move'); }

  // 2. Endgame tablebase: perfect play beats every opinion.
  const tb = tablebaseChoice(tablebase, legal, mode === 'human' ? human : null);
  if (tb) {
    explanation.push(`Endgame tablebase: this position is a ${tb.category} with perfect play; ${tb.move} keeps that result` + (tb.kept > 1 ? ` (chosen as the most human of ${tb.kept} moves that do).` : '.'));
    return out(tb.move, 'tablebase');
  }

  if (!ref) explanation.push(`The referee (${referee}) did not report, so no move could be safety-checked; the vote alone decides.`);

  // Referee scale: expected score of every move the referee has rated.
  const refES = new Map();
  for (const l of (ref?.lines || [])) if (legal.includes(l.move)) refES.set(l.move, expectedScore(l));
  const refBest = ref?.bestmove && refES.has(ref.bestmove) ? ref.bestmove : (ref?.lines?.[0]?.move ?? null);
  const bestES = refBest != null ? refES.get(refBest) : null;
  const loss = m => (bestES == null || !refES.has(m) || refES.get(m) == null) ? null : Math.max(0, bestES - refES.get(m));

  // 3. Forced mate found by the referee.
  const mateLine = (ref?.lines || []).filter(l => l.mate > 0 && legal.includes(l.move)).sort((a, b) => a.mate - b.mate)[0];
  if (mateLine) {
    const horizon = mode === 'human' ? Math.round(nearestLevel(rules.humanMateHorizon, humanElo)) : Infinity;
    if (mateLine.mate <= horizon) {
      explanation.push(`${label(ref)} sees mate in ${mateLine.mate} starting ${mateLine.move}; the King plays it.`);
      return out(mateLine.move, 'mate');
    }
    explanation.push(`${label(ref)} sees mate in ${mateLine.mate}, deeper than a ${humanElo} player is expected to find, so the human voice decides.`);
  }

  // 4. Votes.
  const support = new Map();   // move → { engine: amount }
  const add = (m, e, v) => { if (!legal.includes(m) || v <= 0) return; const s = support.get(m) || {}; s[e] = (s[e] || 0) + v; support.set(m, s); };
  let w;
  if (mode === 'human') {
    if (!human) explanation.push('No human-like voice reported, so human mode falls back to the search engines.');
    w = human ? { [human.engine]: 1 } : weights;
  } else {
    w = { ...weights };
    if (human) w[human.engine] = rules.humanWeightInFull * (weights[human.engine] ?? 1);
  }
  for (const r of valid) {
    const wt = w[r.engine] ?? (mode === 'human' ? 0 : 1);
    if (!wt) continue;
    if (r.role === 'human' && r.policy) {
      for (const [m, p] of Object.entries(r.policy)) add(m, r.engine, wt * p);
    } else if (r.role === 'search') {
      if (r.bestmove) add(r.bestmove, r.engine, wt);
      const top = expectedScore(r.lines?.find(l => l.move === r.bestmove) || r.lines?.[0]);
      for (const l of (r.lines || [])) {
        if (l.move === r.bestmove || top == null) continue;
        const es = expectedScore(l); if (es == null) continue;
        add(l.move, r.engine, wt * 0.5 * Math.max(0, 1 - (top - es) / rules.supportFade));
      }
    }
  }

  // 5. Safety: the referee's judgement caps how much a council choice may give away.
  let margin;
  if (mode === 'human') {
    const table = rules.humanMargins[guard];
    margin = table ? nearestLevel(table, humanElo) : Infinity;
  } else margin = rules.fullMargin;

  const votes = [...support.entries()].map(([move, s]) => ({ move, score: Object.values(s).reduce((a, b) => a + b, 0), support: s, refereeLoss: loss(move) }))
    .sort((a, b) => b.score - a.score || (a.refereeLoss ?? 1) - (b.refereeLoss ?? 1) || (a.move < b.move ? -1 : 1));
  const vetoed = [];
  const allowed = votes.filter(v => {
    if (v.move === refBest) return true;
    if (v.refereeLoss == null) {
      if (!ref) return true;   // no referee: nothing to check against
      vetoed.push({ ...v, why: 'not rated by the referee' }); return false;
    }
    if (v.refereeLoss > margin) { vetoed.push({ ...v, why: `gives away ${fmtES(v.refereeLoss)} by ${label(ref)}'s count` }); return false; }
    return true;
  });

  let pick;
  if (mode === 'human' && human && seed != null && allowed.length) {
    // sample the allowed moves in proportion to their human vote, so the bot does not repeat itself
    const rnd = mulberry32(seed)(); const total = allowed.reduce((a, v) => a + v.score, 0);
    let acc = 0; pick = allowed[allowed.length - 1];
    for (const v of allowed) { acc += v.score / total; if (rnd < acc) { pick = v; break; } }
  } else pick = allowed[0];

  if (!pick) {
    const fb = refBest || searchers[0]?.bestmove || legal[0];
    explanation.push(`No council move passed the safety check; ${fb} from ${ref ? label(ref) : 'the first legal move'} is played.`);
    return out(fb, 'fallback', votes, vetoed);
  }

  // 6. Explanation.
  const agree = valid.filter(r => r.bestmove === pick.move).map(label);
  const differ = valid.filter(r => r.bestmove && r.bestmove !== pick.move).map(r => `${label(r)} preferred ${r.bestmove}`);
  if (mode === 'human') {
    const p = human?.policy?.[pick.move];
    explanation.push(`Human mode (${humanElo}): ${pick.move}` + (p != null ? `, which ${label(human)} gives a ${(p * 100).toFixed(0)}% chance a ${humanElo} player would choose.` : '.'));
  } else {
    explanation.push(`${pick.move} wins the council vote with ${pick.score.toFixed(2)}` + (agree.length ? ` (first choice of ${agree.join(', ')})` : '') + '.');
  }
  if (differ.length) explanation.push(differ.join('; ') + '.');
  if (pick.refereeLoss != null && ref) explanation.push(`${label(ref)} rates it ${fmtES(refES.get(pick.move))} for the side to move` + (pick.refereeLoss > 0 ? `, ${fmtES(pick.refereeLoss)} below its own choice ${refBest}.` : ', level with its best.'));
  const blocked = vetoed.filter(v => v.refereeLoss != null);
  // Unrated moves with almost no support (Maia's long tail) are not worth a line; only mention ones with a real vote.
  const unrated = vetoed.filter(v => v.refereeLoss == null && v.score >= 0.01).length;
  if (blocked.length) explanation.push(`Blocked by the safety check: ${blocked.slice(0, 3).map(v => `${v.move} (${v.why})`).join('; ')}.`);
  if (unrated) explanation.push(`${unrated} rarely chosen move${unrated === 1 ? ' was' : 's were'} left out because ${ref ? label(ref) : 'the referee'} had not checked ${unrated === 1 ? 'it' : 'them'}.`);
  if (mode === 'teach') {
    for (const r of valid) {
      if (r.role === 'search') {
        const l = r.lines?.find(x => x.move === r.bestmove) || r.lines?.[0];
        explanation.push(`${label(r)}: ${r.bestmove}` + (l ? ` (${l.mate != null ? `mate ${l.mate}` : `${l.cp ?? '?'} cp`}${l.wdl ? `, win/draw/loss ${l.wdl.join('/')}` : ''}${l.pv?.length ? `; line ${l.pv.slice(0, 6).join(' ')}` : ''})` : '') + '.');
      } else if (r.policy) {
        const top = Object.entries(r.policy).sort((a, b) => b[1] - a[1]).slice(0, 3);
        explanation.push(`${label(r)} (how people play): ` + top.map(([m, p]) => `${m} ${(p * 100).toFixed(0)}%`).join(', ') + '.');
      }
    }
  }
  return out(pick.move, mode === 'human' ? 'human' : 'vote', votes, vetoed);
}
