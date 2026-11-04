#!/usr/bin/env node
// Test matches: Kingfischer against one engine alone, through fastchess (https://github.com/Disservin/fastchess).
//
//   node tools/match/run.mjs <match> [--rounds 10] [--tc 20+0.3] [--fastchess PATH] [--out DIR]
//
// Matches (each is a round-robin of 2 games per opening, colours swapped, from tools/match/openings.epd):
//   stockfish   Kingfischer, full strength, against Stockfish 19 alone on the same clock (1 thread, Hash 128).
//   leela       Kingfischer, full strength, against Leela alone on the same clock (the configured net, 1 thread).
//   maia1100 / maia1500 / maia1900
//               Kingfischer in human mode at that level against the same Maia net alone at one node (its most likely
//               move), so the match measures what the blunder guard adds. Kingfischer still gets the clock.
//
// Results go to <out>/<match>.pgn, <out>/<match>.log (fastchess) and <out>/<match>.moves.jsonl (what every voice
// wanted on each Kingfischer move; see KINGFISCHER_LOG in bot/desktop/kingfischer.js). `summarise.mjs` reads them.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../council/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const match = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const rounds = +flag('--rounds', 10), tc = flag('--tc', '20+0.3'), fastchess = flag('--fastchess', 'fastchess');
const out = path.resolve(flag('--out', path.join(ROOT, 'tools/match/results')));
const cfg = loadConfig(path.join(ROOT, 'kingfischer.config.json'));   // resolves engine paths; bare names stay on PATH
const voice = id => { const v = cfg.voices.find(x => x.id === id); if (!v) throw new Error(`no voice ${id} in kingfischer.config.json`); return v; };
const engineArgs = v => [`cmd=${v.cmd}`, ...(v.args || []).map(a => `args=${a}`)];

const MATCHES = {
  stockfish: () => ({ name: 'Stockfish 19', opp: [...engineArgs(voice('stockfish')), 'option.Threads=1', 'option.Hash=128', `tc=${tc}`], kf: ['option.Mode=full'] }),
  leela: () => ({ name: 'Leela', opp: [...engineArgs(voice('leela')), 'option.Threads=1', `tc=${tc}`], kf: ['option.Mode=full'] }),
};
for (const lvl of [1100, 1500, 1900]) MATCHES[`maia${lvl}`] = () => ({ name: `Maia ${lvl}`, opp: [...engineArgs(voice(`maia${lvl}`)), 'option.Threads=1', 'nodes=1'], kf: ['option.Mode=human', `option.HumanElo=${lvl}`] });
if (!MATCHES[match]) { console.error(`usage: run.mjs <${Object.keys(MATCHES).join('|')}> [--rounds 10] [--tc 20+0.3]`); process.exit(2); }
const m = MATCHES[match]();
fs.mkdirSync(out, { recursive: true });
// Write to <match>.tmp.* and replace the kept files only when fastchess finishes, so a failed rerun keeps the last results.
const tmp = ext => path.join(out, `${match}.tmp${ext}`), keep = ext => path.join(out, `${match}${ext}`);
const EXTS = ['.pgn', '.log', '.moves.jsonl'];
const [pgn, log, moves] = EXTS.map(tmp);
for (const f of [pgn, log, moves]) fs.rmSync(f, { force: true });

const fc = [
  '-engine', 'name=Kingfischer', `cmd=${process.execPath}`, `args=${path.join(ROOT, 'bot/desktop/kingfischer.js')}`, `dir=${ROOT}`, `tc=${tc}`, 'timemargin=100', ...m.kf,
  '-engine', `name=${m.name.replace(/ /g, '_')}`, ...m.opp, 'timemargin=100',
  '-each', 'proto=uci', 'restart=off',
  '-openings', `file=${path.join(ROOT, 'tools/match/openings.epd')}`, 'format=epd', 'order=sequential',
  '-rounds', String(rounds), '-games', '2', '-repeat', '-concurrency', '1', '-maxmoves', '200',
  '-resign', 'movecount=3', 'score=800', 'twosided=true', '-draw', 'movenumber=40', 'movecount=8', 'score=10',
  '-ratinginterval', '2', '-pgnout', `file=${pgn}`, 'nodes=false', '-log', `file=${log}`, 'level=warn',
];
console.log(`${match}: Kingfischer vs ${m.name}, ${rounds} rounds × 2 games, tc ${tc}`);
const r = spawnSync(fastchess, fc, { cwd: out, stdio: 'inherit', env: { ...process.env, KINGFISCHER_LOG: moves } });
if (r.error) console.error(`${fastchess}: ${r.error.message}`);
if (r.status === 0) { for (const e of EXTS) if (fs.existsSync(tmp(e))) fs.renameSync(tmp(e), keep(e)); }
else console.error(`${match}: fastchess failed; partial output left as ${tmp('.*')}`);
process.exit(r.status ?? 1);
