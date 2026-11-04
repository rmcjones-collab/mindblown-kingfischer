// King Brain rules. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, expectedScore, ratingWeights, unratedCandidates } from '../king/king.js';

const legal = ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'h2h4', 'f2f3'];
const sf = (lines, bestmove = lines[0].move) => ({ engine: 'stockfish', role: 'search', name: 'Stockfish', bestmove, lines });
const lz = (lines, bestmove = lines[0].move) => ({ engine: 'leela', role: 'search', name: 'Leela', bestmove, lines });
const maia = policy => ({ engine: 'maia', role: 'human', name: 'Maia', bestmove: Object.entries(policy).sort((a, b) => b[1] - a[1])[0][0], policy });
const W = { stockfish: 1, leela: 0.6, maia: 1 };

test('expected score: wdl first, then centipawns, mates certain', () => {
  assert.equal(expectedScore({ wdl: [500, 0, 500] }), 0.5);
  assert.equal(expectedScore({ wdl: [0, 1000, 0] }), 0.5);
  assert.equal(expectedScore({ cp: 0 }), 0.5);
  assert.ok(Math.abs(expectedScore({ cp: 400 }) - 10 / 11) < 1e-9);
  assert.equal(expectedScore({ mate: 3 }), 1);
  assert.equal(expectedScore({ mate: -2 }), 0);
  assert.equal(expectedScore(null), null);
});

test('rating weights follow the Elo scale', () => {
  const w = ratingWeights({ a: 3650, b: 3250 });
  assert.equal(w.a, 1);
  assert.ok(Math.abs(w.b - 0.1) < 1e-9);
});

test('only move and game over', () => {
  assert.equal(decide({ legal: ['e1e2'], reports: [] }).move, 'e1e2');
  const r = decide({ legal: [], reports: [] });
  assert.equal(r.move, null); assert.equal(r.reason, 'game-over');
});

test('tablebase overrides every voice and keeps the result', () => {
  const tb = { category: 'win', moves: [{ uci: 'h2h4', category: 'loss' }, { uci: 'd2d4', category: 'loss' }, { uci: 'e2e4', category: 'draw' }] };
  const r = decide({ legal, reports: [sf([{ move: 'e2e4', cp: 30 }])], tablebase: tb, weights: W });
  assert.equal(r.move, 'h2h4'); assert.equal(r.reason, 'tablebase');
  // human mode: the most human of the winning moves, never the drawing one
  const h = decide({ legal, mode: 'human', reports: [maia({ e2e4: 0.7, d2d4: 0.2, h2h4: 0.1 })], tablebase: tb });
  assert.equal(h.move, 'd2d4');
});

test('forced mate from the referee is played in full mode', () => {
  const r = decide({ legal, weights: W, reports: [sf([{ move: 'f2f3', mate: 2 }, { move: 'e2e4', cp: 500 }]), lz([{ move: 'e2e4', cp: 300 }])] });
  assert.equal(r.move, 'f2f3'); assert.equal(r.reason, 'mate');
});

test('human mode only plays mates within its level horizon', () => {
  const reports = [sf([{ move: 'f2f3', mate: 3 }, { move: 'e2e4', cp: 500 }, { move: 'd2d4', cp: 450 }]), maia({ e2e4: 0.6, d2d4: 0.3, f2f3: 0.1 })];
  assert.equal(decide({ legal, mode: 'human', humanElo: 1100, reports }).move, 'e2e4');
  assert.equal(decide({ legal, mode: 'human', humanElo: 1900, reports }).move, 'f2f3');
});

test('full mode: a council favourite replaces the referee only within the margin', () => {
  // Leela and Maia prefer d2d4, which Stockfish rates 1 point (0.01) below e2e4: allowed
  const close = [sf([{ move: 'e2e4', wdl: [100, 860, 40] }, { move: 'd2d4', wdl: [90, 860, 50] }]), lz([{ move: 'd2d4', wdl: [200, 700, 100] }]), { ...lz([{ move: 'd2d4', cp: 30 }]), engine: 'leela2', name: 'Leela 2' }];
  const r1 = decide({ legal, weights: { stockfish: 1, leela: 0.8, leela2: 0.8 }, reports: close });
  assert.equal(r1.move, 'd2d4');
  // the same vote, but d2d4 is 10 points worse by Stockfish: vetoed, Stockfish's move stands
  const far = [sf([{ move: 'e2e4', wdl: [100, 860, 40] }, { move: 'd2d4', wdl: [20, 760, 220] }]), lz([{ move: 'd2d4', cp: 30 }]), { ...lz([{ move: 'd2d4', cp: 30 }]), engine: 'leela2', name: 'Leela 2' }];
  const r2 = decide({ legal, weights: { stockfish: 1, leela: 0.8, leela2: 0.8 }, reports: far });
  assert.equal(r2.move, 'e2e4');
  assert.ok(r2.vetoed.some(v => v.move === 'd2d4'));
  assert.ok(r2.explanation.some(s => s.includes('safety check')));
});

test('a move the referee has not rated cannot win', () => {
  const r = decide({ legal, weights: W, reports: [sf([{ move: 'e2e4', cp: 30 }]), lz([{ move: 'c2c4', cp: 40 }]), { ...lz([{ move: 'c2c4', cp: 40 }]), engine: 'l2' }] });
  assert.equal(r.move, 'e2e4');
});

test('human mode plays the human favourite unless it blunders', () => {
  const lines = [{ move: 'e2e4', cp: 30 }, { move: 'd2d4', cp: 25 }, { move: 'h2h4', cp: -400 }];
  // Maia's favourite h2h4 loses 4 pawns: blocked at 1900 strict, soft at 1100 lets a 1-pawn slip but not this
  const reports = [sf(lines), maia({ h2h4: 0.5, d2d4: 0.3, e2e4: 0.2 })];
  assert.equal(decide({ legal, mode: 'human', humanElo: 1900, guard: 'strict', reports }).move, 'd2d4');
  assert.equal(decide({ legal, mode: 'human', humanElo: 1100, guard: 'soft', reports }).move, 'd2d4');
  // guard off: Maia exactly
  assert.equal(decide({ legal, mode: 'human', humanElo: 1100, guard: 'off', reports }).move, 'h2h4');
});

test('human mode sampling is reproducible and stays within the allowed moves', () => {
  const reports = [sf([{ move: 'e2e4', cp: 30 }, { move: 'd2d4', cp: 25 }, { move: 'g1f3', cp: 20 }, { move: 'h2h4', cp: -600 }]), maia({ e2e4: 0.4, d2d4: 0.3, g1f3: 0.2, h2h4: 0.1 })];
  const seen = new Set();
  for (let s = 1; s <= 200; s++) {
    const a = decide({ legal, mode: 'human', humanElo: 1500, reports, seed: s });
    const b = decide({ legal, mode: 'human', humanElo: 1500, reports, seed: s });
    assert.equal(a.move, b.move);
    seen.add(a.move);
  }
  assert.ok(!seen.has('h2h4'), 'the blunder is never sampled');
  assert.ok(seen.size >= 2, 'sampling varies the move');
});

test('illegal suggestions are set aside', () => {
  const r = decide({ legal, weights: W, reports: [sf([{ move: 'e2e4', cp: 30 }]), { engine: 'leela', role: 'search', bestmove: 'e7e5', lines: [{ move: 'e7e5', cp: 0 }] }] });
  assert.equal(r.move, 'e2e4');
  assert.ok(r.explanation.some(s => s.includes('not legal')));
});

test('no referee: the vote alone decides', () => {
  const r = decide({ legal, weights: W, reports: [lz([{ move: 'd2d4', cp: 30 }])] });
  assert.equal(r.move, 'd2d4');
});

test('teach mode explains every voice', () => {
  const r = decide({ legal, mode: 'teach', weights: W, reports: [sf([{ move: 'e2e4', cp: 30, pv: ['e2e4', 'e7e5'] }]), lz([{ move: 'e2e4', wdl: [300, 500, 200] }]), maia({ e2e4: 0.5, d2d4: 0.5 })] });
  assert.equal(r.move, 'e2e4');
  assert.ok(r.explanation.some(s => s.startsWith('Stockfish: e2e4')));
  assert.ok(r.explanation.some(s => s.startsWith('Maia (how people play)')));
});

test('unrated candidates lists what the referee must probe', () => {
  const reports = [sf([{ move: 'e2e4', cp: 30 }]), lz([{ move: 'd2d4', cp: 30 }]), maia({ e2e4: 0.5, c2c4: 0.3, g1f3: 0.15, h2h4: 0.04, f2f3: 0.01 })];
  assert.deepEqual(unratedCandidates(reports).sort(), ['c2c4', 'd2d4', 'g1f3'].sort());
});
