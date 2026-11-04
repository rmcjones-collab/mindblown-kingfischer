#!/usr/bin/env node
// Kingfischer as a UCI engine: load it in any chess program (Arena, Cute Chess, Banksia, Nibbler, En Croissant) or in a
// testing tool, and the whole council plays through it. The King Brain's reasons are sent as `info string` lines.
//
//   node bot/desktop/kingfischer.js [path/to/kingfischer.config.json]
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Chess } from '../../vendor/chess.js';
import { nodeCouncil } from '../../council/node.js';
import { loadConfig, budgetFrom } from '../../council/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let cfgPath = process.argv[2] || path.join(HERE, '..', '..', 'kingfischer.config.json');
const opts = { Mode: 'full', HumanElo: 1500, Guard: 'soft', Explain: true, Seed: 0 };
let council = null; let fen; let moves = []; let busy = Promise.resolve();
const out = s => process.stdout.write(s + '\n');

async function ensure() {
  if (council) return council;
  council = await nodeCouncil(loadConfig(cfgPath)).start();
  return council;
}

function parseGo(tok) {
  const g = { searchmoves: [] };
  const KEYS = ['wtime', 'btime', 'winc', 'binc', 'movestogo', 'movetime', 'depth', 'nodes', 'mate'];
  for (let i = 0; i < tok.length; i++) {
    if (KEYS.includes(tok[i])) g[tok[i]] = +tok[++i];
    else if (tok[i] === 'infinite' || tok[i] === 'ponder') g.infinite = true;
    else if (tok[i] === 'searchmoves') { while (i + 1 < tok.length && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(tok[i + 1])) g.searchmoves.push(tok[++i]); }
  }
  return g;
}

// The running search, so `stop`, `isready` and `quit` can be answered while it thinks.
let current = null;   // { ctl: AbortController, stopped: Promise, release() }

async function go(tok) {
  const c = await ensure();
  const g = parseGo(tok);
  const side = (() => { const ch = new Chess(fen); for (const m of moves) ch.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }); return ch.turn(); })();
  const seed = opts.Mode === 'human' && +opts.Seed ? (+opts.Seed + moves.length) : null;
  const ctl = new AbortController(); let release;
  const stopped = new Promise(r => { release = r; });
  ctl.signal.addEventListener('abort', () => release(), { once: true });
  current = { ctl, stopped };
  try {
    const limits = { depth: g.depth || undefined, nodes: g.nodes || undefined };
    const budgetMs = g.infinite ? Infinity : (limits.depth || limits.nodes) && g.movetime == null && g.wtime == null && g.btime == null ? Infinity : budgetFrom(g, side);
    const v = await c.think({ fen, moves, budgetMs, limits, searchmoves: g.searchmoves.length ? g.searchmoves : null, signal: ctl.signal,
      mode: opts.Mode, humanElo: +opts.HumanElo, guard: opts.Guard, seed });
    if (opts.Explain) for (const line of v.explanation) out(`info string ${line}`);
    const ref = v.reports.find(r => r.engine === c.referee);
    const l = ref?.lines?.find(x => x.move === v.move);
    if (l) out(`info depth ${l.depth || 1} score ${l.mate != null ? `mate ${l.mate}` : `cp ${l.cp ?? 0}`}${l.wdl ? ` wdl ${l.wdl.join(' ')}` : ''} pv ${(l.pv || [v.move]).join(' ')}`);
    if (g.infinite) await stopped;   // UCI: an infinite search reports bestmove only after `stop`
    out(`bestmove ${v.move || '0000'}`);
  } finally { current = null; }
}

const CHOICES = { Mode: ['full', 'human', 'teach'], Guard: ['soft', 'strict', 'off'] };
function setOption(name, value) {
  if (name === 'Config') { cfgPath = value; council?.quit(); council = null; return; }
  if (!(name in opts)) return;
  if (name === 'Explain') opts.Explain = value === 'true';
  else if (CHOICES[name]) { if (CHOICES[name].includes(value)) opts[name] = value; else out(`info string ${name} must be one of ${CHOICES[name].join(', ')}`); }
  else if (name === 'HumanElo') { const n = Math.round(+value); if (Number.isFinite(n)) opts.HumanElo = Math.min(1900, Math.max(1100, n)); else out('info string HumanElo must be a number'); }
  else if (name === 'Seed') { const n = Math.round(+value); if (Number.isFinite(n) && n >= 0) opts.Seed = n; }
}

readline.createInterface({ input: process.stdin }).on('line', raw => {
  const line = raw.trim(); const tok = line.split(/\s+/); const cmd = tok[0];
  // answered at once, even mid-search
  if (cmd === 'stop') { current?.ctl.abort(); return; }
  if (cmd === 'quit') { current?.ctl.abort(); council?.quit(); process.exit(0); }
  if (cmd === 'isready' && current) { out('readyok'); return; }
  if (cmd === 'ponderhit') { current?.ctl.abort(); return; }
  busy = busy.then(async () => {
    if (cmd === 'uci') {
      out('id name Kingfischer 0.1'); out('id author MindBlown Kingfischer project (council of Stockfish, Leela Chess Zero and Maia)');
      out('option name Mode type combo default full var full var human var teach');
      out('option name HumanElo type spin default 1500 min 1100 max 1900');
      out('option name Guard type combo default soft var soft var strict var off');
      out('option name Explain type check default true');
      out('option name Seed type spin default 0 min 0 max 2147483647');
      out('option name Config type string default ' + cfgPath);
      out('uciok');
    } else if (cmd === 'isready') { await ensure(); out('readyok'); }
    else if (cmd === 'setoption') {
      const m = line.match(/^setoption name (\S+)(?: value (.*))?$/);
      if (m) setOption(m[1], m[2]);
    } else if (cmd === 'ucinewgame') { if (council) await council.newGame(); }
    else if (cmd === 'position') {
      const mi = tok.indexOf('moves');
      fen = tok[1] === 'fen' ? tok.slice(2, mi < 0 ? undefined : mi).join(' ') : undefined;
      moves = mi < 0 ? [] : tok.slice(mi + 1);
    } else if (cmd === 'go') {
      // not awaited by the queue's stop/isready/quit handlers above; later position/go commands still wait their turn
      await go(tok.slice(1)).catch(e => { out(`info string error: ${e.message}`); out('bestmove 0000'); });
    }
  }).catch(e => out(`info string error: ${e.message}`));
});
