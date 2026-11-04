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
  const g = {};
  for (let i = 0; i < tok.length; i++) if (['wtime', 'btime', 'winc', 'binc', 'movestogo', 'movetime', 'depth', 'nodes'].includes(tok[i])) g[tok[i]] = +tok[++i];
  return g;
}

async function go(tok) {
  const c = await ensure();
  const g = parseGo(tok);
  const side = (() => { const ch = new Chess(fen); for (const m of moves) ch.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }); return ch.turn(); })();
  const seed = opts.Mode === 'human' && +opts.Seed ? (+opts.Seed + moves.length) : null;
  const v = await c.think({ fen, moves, budgetMs: budgetFrom(g, side), mode: opts.Mode, humanElo: +opts.HumanElo, guard: opts.Guard, seed });
  if (opts.Explain) for (const line of v.explanation) out(`info string ${line}`);
  const ref = v.reports.find(r => r.engine === c.referee);
  const l = ref?.lines?.find(x => x.move === v.move);
  if (l) out(`info depth ${l.depth || 1} score ${l.mate != null ? `mate ${l.mate}` : `cp ${l.cp ?? 0}`}${l.wdl ? ` wdl ${l.wdl.join(' ')}` : ''} pv ${(l.pv || [v.move]).join(' ')}`);
  out(`bestmove ${v.move || '0000'}`);
}

readline.createInterface({ input: process.stdin }).on('line', raw => {
  const line = raw.trim(); const tok = line.split(/\s+/); const cmd = tok[0];
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
      if (m) { if (m[1] === 'Config') { cfgPath = m[2]; council?.quit(); council = null; } else if (m[1] in opts) opts[m[1]] = m[1] === 'Explain' ? m[2] === 'true' : m[2]; }
    } else if (cmd === 'ucinewgame') { if (council) await council.newGame(); }
    else if (cmd === 'position') {
      const mi = tok.indexOf('moves');
      fen = tok[1] === 'fen' ? tok.slice(2, mi < 0 ? undefined : mi).join(' ') : undefined;
      moves = mi < 0 ? [] : tok.slice(mi + 1);
    } else if (cmd === 'go') await go(tok.slice(1)).catch(e => { out(`info string error: ${e.message}`); out('bestmove 0000'); });
    else if (cmd === 'quit') { council?.quit(); process.exit(0); }
  });
});
