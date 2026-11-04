// Test-match tooling: the opening book parses and the runner refuses unknown matches. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Chess } from '../vendor/chess.js';

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
