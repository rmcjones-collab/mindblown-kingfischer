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
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../council/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (n, d) => {   // a flag that is present needs an operand; `--out --tc` would otherwise write to a folder named --tc
  const i = args.indexOf(n); if (i < 0) return d;
  const v = args[i + 1]; if (v == null || v.startsWith('--')) { console.error(`${n} needs a value`); process.exit(2); } return v;
};
const match = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const rounds = +flag('--rounds', 10), tc = flag('--tc', '20+0.3');
const fastchessArg = flag('--fastchess', 'fastchess');
const fastchess = /[/\\]/.test(fastchessArg) ? path.resolve(fastchessArg) : fastchessArg;
const out = path.resolve(flag('--out', path.join(ROOT, 'tools/match/results')));
const configPath = path.resolve(flag('--config', path.join(ROOT, 'kingfischer.config.json')));
const leelaWeightArg = flag('--leela-weight', null);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 16) { console.error('--rounds must be an integer from 1 to 16 (the book size)'); process.exit(2); }
if (leelaWeightArg !== null && (!Number.isFinite(+leelaWeightArg) || +leelaWeightArg < 0)) { console.error('--leela-weight must be a nonnegative finite number'); process.exit(2); }
const voice = id => { const v = cfg.voices.find(x => x.id === id); if (!v) throw new Error(`no voice ${id} in kingfischer.config.json`); return v; };
// fastchess takes one args= field and splits it on spaces, so an argument with spaces is quoted with whichever quote it lacks.
const quote = a => !/[\s'"]/.test(a) ? a : !a.includes('"') ? `"${a}"` : !a.includes("'") ? `'${a}'` : (() => { throw new Error(`cannot pass to fastchess: ${a}`); })();
const engineArgs = v => [`cmd=${v.cmd}`, ...(v.args?.length ? [`args=${v.args.map(quote).join(' ')}`] : []),
  ...Object.entries(v.options || {}).map(([k, v]) => `option.${k}=${v}`)];

const MATCHES = {
  stockfish: () => ({ name: 'Stockfish 19', opp: [...engineArgs(voice('stockfish')), 'option.Threads=1', 'option.Hash=128', `tc=${tc}`], kf: ['option.Mode=full'] }),
  leela: () => ({ name: 'Leela', opp: [...engineArgs(voice('leela')), 'option.Threads=1', `tc=${tc}`], kf: ['option.Mode=full'] }),
};
for (const lvl of [1100, 1500, 1900]) MATCHES[`maia${lvl}`] = () => ({ name: `Maia ${lvl}`, opp: [...engineArgs(voice(`maia${lvl}`)), 'option.Threads=1', 'nodes=1'], kf: ['option.Mode=human', `option.HumanElo=${lvl}`] });
if (!MATCHES[match]) { console.error(`usage: run.mjs <${Object.keys(MATCHES).join('|')}> [--rounds 10] [--tc 20+0.3]`); process.exit(2); }
// The usage check comes first: kingfischer.config.json is a local, git-ignored file.
const cfg = loadConfig(configPath);
if (leelaWeightArg !== null) {
  const leela = voice('leela');
  if (leela.enabled === false) throw new Error('The zero-vote control requires Leela to remain enabled');
  leela.voteWeight = +leelaWeightArg;
}
const m = MATCHES[match]();
fs.mkdirSync(out, { recursive: true });
// A resolved private copy leaves the user's config unchanged and works on Windows too.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kingfischer-match-'));
const runConfig = path.join(configDir, 'config.json');
fs.writeFileSync(runConfig, JSON.stringify(cfg, null, 2));
// Write to <match>.tmp.* and replace the kept files only when fastchess finishes, so a failed rerun keeps the last results.
const tmp = ext => path.join(out, `${match}.tmp${ext}`), keep = ext => path.join(out, `${match}${ext}`);
const EXTS = ['.pgn', '.log', '.moves.jsonl'];
const [pgn, log, moves] = EXTS.map(tmp);
for (const f of [pgn, log, moves]) fs.rmSync(f, { force: true });

const fc = [
  '-engine', 'name=Kingfischer', `cmd=${process.execPath}`, `args=${[path.join(ROOT, 'bot/desktop/kingfischer.js'), runConfig].map(quote).join(' ')}`, `dir=${ROOT}`, `tc=${tc}`, 'timemargin=100', ...m.kf,
  '-engine', `name=${m.name.replace(/ /g, '_')}`, ...m.opp, 'timemargin=100',
  '-each', 'proto=uci', 'restart=off',
  '-openings', `file=${path.join(ROOT, 'tools/match/openings.epd')}`, 'format=epd', 'order=sequential',
  '-rounds', String(rounds), '-games', '2', '-repeat', '-concurrency', '1', '-maxmoves', '200',
  '-resign', 'movecount=3', 'score=800', 'twosided=true', '-draw', 'movenumber=40', 'movecount=8', 'score=10',
  '-ratinginterval', '2', '-pgnout', `file=${pgn}`, 'nodes=false', '-log', `file=${log}`, 'level=warn',
];
const hash = file => fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const manifest = {
  started: new Date().toISOString(), match, rounds, expectedGames: rounds * 2, tc,
  platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model,
  logicalCpus: os.cpus().length, node: process.version,
  codeCommit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout?.trim(),
  trackedDirty: Boolean(spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).stdout?.trim()),
  openingSha256: hash(path.join(ROOT, 'tools/match/openings.epd')), fastchessSha256: hash(fastchess),
  tablebase: cfg.tablebase !== false, referee: cfg.referee, leelaWeightOverride: leelaWeightArg === null ? null : +leelaWeightArg,
  voices: cfg.voices.map(v => ({ id: v.id, enabled: v.enabled !== false, rating: v.rating, voteWeight: v.voteWeight,
    multipv: v.multipv, options: v.options, binary: path.basename(v.cmd), binarySha256: hash(v.cmd),
    networks: (v.args || []).filter(a => a.startsWith('--weights=')).map(a => ({ file: path.basename(a.slice(10)), sha256: hash(a.slice(10)) })) })),
};
console.log(`${match}: Kingfischer vs ${m.name}, ${rounds} rounds × 2 games, tc ${tc}, Leela vote ${leelaWeightArg ?? 'default'}`);
const r = spawnSync(fastchess, fc, { cwd: out, stdio: 'inherit', env: { ...process.env, KINGFISCHER_LOG: moves } });
fs.rmSync(configDir, { recursive: true, force: true });
if (r.error) console.error(`${fastchess}: ${r.error.message}`);
const games = fs.existsSync(pgn) ? [...fs.readFileSync(pgn, 'utf8').matchAll(/^\[Result "(1-0|0-1|1\/2-1\/2)"\]/gm)].length : 0;
const complete = r.status === 0 && games === rounds * 2 && EXTS.every(e => fs.existsSync(tmp(e)));
if (complete) {
  fs.writeFileSync(tmp('.manifest.json'), JSON.stringify({ ...manifest, finished: new Date().toISOString(), games }, null, 2) + '\n');
  for (const e of [...EXTS, '.manifest.json']) fs.renameSync(tmp(e), keep(e));
}
else console.error(`${match}: ${r.status === 0 ? 'run incomplete (an output file is missing)' : 'fastchess failed'}; partial output left as ${tmp('.*')}, previous results kept`);
process.exit(complete ? 0 : (r.status || 1));
