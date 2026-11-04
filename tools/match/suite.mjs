#!/usr/bin/env node
// Cross-platform suite; no shell, no downloads, no publication. One game at a time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../../council/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function suitePlan({ config, fastchess, out, rounds = 10, tc = '20+0.3' }) {
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 16) throw new Error('rounds must be an integer from 1 to 16');
  return [...['stockfish', 'leela', 'maia1100', 'maia1500', 'maia1900'].map(match => ({ match, variant: 'baseline' })),
    { match: 'stockfish', variant: 'leela-zero' }].map(({ match, variant }) => ({
    match, variant, out: path.join(out, variant),
    args: [path.join(ROOT, 'tools/match/run.mjs'), match, '--config', config, '--fastchess', fastchess,
      '--rounds', String(rounds), '--tc', tc, '--out', path.join(out, variant),
      ...(variant === 'leela-zero' ? ['--leela-weight', '0'] : [])],
  }));
}

function main() {
  const { values } = parseArgs({ options: {
    config: { type: 'string', default: path.join(ROOT, 'kingfischer.config.json') },
    fastchess: { type: 'string' }, out: { type: 'string' },
    rounds: { type: 'string', default: '10' }, tc: { type: 'string', default: '20+0.3' },
    'dry-run': { type: 'boolean', default: false },
  } });
  if (!values.fastchess || !values.out) throw new Error('usage: suite.mjs --fastchess PATH --out NEW_DIRECTORY [--config PATH] [--rounds 10] [--tc 20+0.3] [--dry-run]');
  const config = path.resolve(values.config), out = path.resolve(values.out), fastchess = path.resolve(values.fastchess);
  const plan = suitePlan({ config, out, fastchess, rounds: +values.rounds, tc: values.tc });
  if (values['dry-run']) { console.log(JSON.stringify(plan, null, 2)); return; }
  if (fs.existsSync(out)) throw new Error('Use a new output directory; an existing suite will not be overwritten');
  if (!fs.existsSync(fastchess)) throw new Error('fastchess executable not found');
  const cfg = loadConfig(config);
  const leela = cfg.voices.find(v => v.id === 'leela');
  if (!leela || leela.enabled === false || leela.voteWeight !== undefined) throw new Error('Baseline requires enabled Leela with its default vote weight');
  fs.mkdirSync(out, { recursive: true });
  const state = { started: new Date().toISOString(), status: 'running', completed: [], failed: null };
  const save = () => fs.writeFileSync(path.join(out, 'suite.json'), JSON.stringify(state, null, 2) + '\n');
  save();
  for (const run of plan) {
    console.log(`\n${run.variant}: ${run.match}`);
    const r = spawnSync(process.execPath, run.args, { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) {
      Object.assign(state, { status: 'failed', failed: `${run.variant}/${run.match}`, finished: new Date().toISOString() });
      save();
      throw new Error(r.error?.message || 'Match failed; partial outputs retained, suite stopped');
    }
    state.completed.push(`${run.variant}/${run.match}`); save();
  }
  const summary = ['# Match suite results', '', 'Fixed-sample exploratory results, not established ratings.', ''];
  for (const variant of ['baseline', 'leela-zero']) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/match/summarise.mjs'), path.join(out, variant)], { encoding: 'utf8' });
    if (r.status !== 0) {
      Object.assign(state, { status: 'summary-failed', finished: new Date().toISOString() }); save();
      throw new Error(r.stderr || r.error?.message || 'Summary failed');
    }
    summary.push(`## ${variant}`, '', r.stdout);
  }
  fs.writeFileSync(path.join(out, 'SUMMARY.md'), summary.join('\n'));
  Object.assign(state, { status: 'complete', finished: new Date().toISOString() }); save();
  console.log(`Suite complete: ${path.join(out, 'SUMMARY.md')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
