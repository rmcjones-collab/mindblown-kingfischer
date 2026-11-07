// Test-match tooling: the opening book parses and the runner refuses unknown matches. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Chess } from '../vendor/chess.js';
import { suitePlan } from '../tools/match/suite.mjs';
import { compareControl } from '../tools/match/compare-control.mjs';

test('openings.epd: 16 legal, balanced, named positions', () => {
  const lines = fs.readFileSync('tools/match/openings.epd', 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 16);
  const names = new Set();
  for (const l of lines) {
    const [board, side, castle, ep, ...ops] = l.split(' ');
    const hm = /hmvc (\d+);/.exec(l)?.[1], fm = /fmvn (\d+);/.exec(l)?.[1], name = /c0 "([^"]+)";/.exec(l)?.[1];
    assert.ok(hm && fm && name, `fields missing in: ${l}`);
    const ch = new Chess(`${board} ${side} ${castle} ${ep} ${hm} ${fm}`);
    assert.ok(!ch.isGameOver(), `${name} is already over`);
    assert.ok(ch.moves().length > 10, `${name} is too forced`);
    names.add(name);
  }
  assert.equal(names.size, 16, 'duplicate opening names');
});

test('run.mjs: unknown match is a usage error', () => {
  const r = spawnSync(process.execPath, ['tools/match/run.mjs', 'nope'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /stockfish\|leela\|maia1100/);
});

test('run.mjs: validates control options before loading config or starting engines', () => {
  for (const args of [
    ['--leela-weight', '-1'], ['--leela-weight', 'NaN'], ['--leela-weight'],
    ['--config'], ['--rounds', '0'], ['--rounds', '1.5'], ['--rounds', '17'],
  ]) {
    const r = spawnSync(process.execPath, ['tools/match/run.mjs', 'stockfish', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${args}: ${r.stderr}`);
  }
});

test('suite plan keeps baseline and zero-vote outputs separate and preserves paths with spaces', () => {
  const plan = suitePlan({ config: 'config with spaces.json', fastchess: 'engine with spaces', out: 'results with spaces' });
  assert.equal(plan.length, 6);
  assert.equal(plan.filter(run => run.args.includes('--leela-weight')).length, 1);
  assert.equal(plan.at(-1).match, 'stockfish');
  assert.equal(plan.at(-1).variant, 'leela-zero');
  assert.ok(plan.every(run => run.args.includes('config with spaces.json')));
  assert.ok(plan.every(run => run.args.includes('engine with spaces')));
  assert.notEqual(plan[0].out, plan.at(-1).out);
  assert.throws(() => suitePlan({ rounds: 0 }), /rounds/);
});

test('control comparison requires matched games and verified zero weights', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-control-'));
  try {
    const a = path.join(dir, 'baseline'), b = path.join(dir, 'control');
    fs.mkdirSync(a); fs.mkdirSync(b);
    const pgn = '[Event "x"]\n[White "Kingfischer"]\n[Black "Stockfish"]\n[Result "1/2-1/2"]\n[FEN "test-position"]\n[TimeControl "20+0.3"]\n[Termination "normal"]\n\n1. e4 1/2-1/2\n';
    const row = { reason: 'vote', move: 'e2e4', voices: { stockfish: 'e2e4', leela: 'd2d4' }, weights: { leela: 0 }, ms: 20 };
    for (const d of [a, b]) {
      fs.writeFileSync(path.join(d, 'stockfish.pgn'), pgn.replaceAll('\n', '\r\n'));
      fs.writeFileSync(path.join(d, 'stockfish.moves.jsonl'), JSON.stringify(row) + '\n');
    }
    const result = compareControl(a, b);
    assert.equal(result.scoreDeltaPercentagePoints, 0);
    assert.equal(result.control.stockfishAgreementPct, 100);
    assert.equal(result.control.votingMovesMissingLeela, 0);
    fs.writeFileSync(path.join(b, 'stockfish.moves.jsonl'), JSON.stringify({ ...row, weights: { leela: 1 } }));
    assert.throws(() => compareControl(a, b), /zero Leela weight/);
    fs.writeFileSync(path.join(b, 'stockfish.pgn'), pgn.replace('test-position', 'another-position'));
    assert.throws(() => compareControl(a, b), /mismatch/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('summarise.mjs: scores games from Kingfischer\'s side', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-sum-'));
  const g = (w, b, res) => `[Event "x"]\n[White "${w}"]\n[Black "${b}"]\n[Result "${res}"]\n[PlyCount "40"]\n[Termination "normal"]\n\n1. e4 ${res}\n`;
  fs.writeFileSync(`${dir}/maia1500.pgn`, [g('Kingfischer', 'Maia', '1-0'), g('Maia', 'Kingfischer', '1-0'), g('Kingfischer', 'Maia', '1/2-1/2')].join('\n'));
  fs.writeFileSync(`${dir}/maia1500.moves.jsonl`, [{ move: 'e2e4', reason: 'human', voices: { stockfish: 'e2e4', maia1500: 'd2d4' }, vetoed: ['h2h4'], ms: 100 }].map(JSON.stringify).join('\n') + '\n');
  const r = spawnSync(process.execPath, ['tools/match/summarise.mjs', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| 3 \| 1–1–1 \| 50\.0 % \| 0 ± \d+ \|/);
  assert.match(r.stdout, /\| 1 \| 100 % \| — \| 0 % \| human 1 \| 100 \|/);
  fs.rmSync(dir, { recursive: true });
});
