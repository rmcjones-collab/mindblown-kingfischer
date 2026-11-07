// Council plumbing: UCI parsing, Lc0 castling names, time budgets, and how the Council copes with slow or failing
// voices. Engines here are fakes, so no binaries are needed. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearch } from '../council/parse.js';
import { Council, standardCastling, replay } from '../council/council.js';
import { Chess } from '../vendor/chess.js';
import { budgetFrom } from '../council/config.js';

test('parseSearch: last line per multipv, bounds skipped, mate and wdl read', () => {
  const r = parseSearch([
    'info depth 10 multipv 1 score cp 20 wdl 300 600 100 nodes 900 pv e2e4 e7e5',
    'info depth 11 multipv 1 score cp 35 lowerbound pv d2d4',
    'info depth 11 multipv 2 score mate -3 pv h2h4 d8h4',
    'info depth 11 multipv 1 score cp 31 wdl 310 600 90 pv e2e4 c7c5',
    'bestmove e2e4 ponder c7c5',
  ]);
  assert.equal(r.bestmove, 'e2e4');
  assert.deepEqual(r.lines.map(l => [l.move, l.cp ?? null, l.mate ?? null]), [['e2e4', 31, null], ['h2h4', null, -3]]);
  assert.deepEqual(r.lines[0].wdl, [310, 600, 90]);
  assert.equal(r.policy, null);
});

test('parseSearch: no move, and the Lc0 policy with its node summary line', () => {
  assert.equal(parseSearch(['bestmove (none)']).bestmove, null);
  assert.equal(parseSearch(['bestmove 0000']).bestmove, null);
  const r = parseSearch([
    'info string e7e5  (322 ) N:       1 (+ 0) (P: 36.67%) (WL:  -0.01) (D: 0.000) (M:  0.0) (Q: -0.01) (U: 0.34) (S:  0.35) (V: -0.0136)',
    'info string c7c5  (288 ) N:       0 (+ 0) (P: 20.10%) (WL:  -.---) (D: -.---) (M:  -.-) (Q: -0.02) (U: 0.19) (S:  0.17) (V:  -.----)',
    'info string node  ( 20 ) N:       1 (+ 0) (P: 100.00%) (WL:  0.01)',
    'bestmove e7e5',
  ]);
  assert.deepEqual(r.policy, { e7e5: 0.3667, c7c5: 0.201 });
});

test('standardCastling maps king-takes-rook names only when that is the legal castle', () => {
  assert.deepEqual(standardCastling({ e1h1: 0.4, e1a1: 0.1, d2d4: 0.5 }, ['e1g1', 'e1c1', 'd2d4']), { e1g1: 0.4, e1c1: 0.1, d2d4: 0.5 });
  // a rook really on h1 being taken by a king on e1 cannot happen, but a legal e1h1 (Chess960-style) is left alone
  assert.deepEqual(standardCastling({ e1h1: 1 }, ['e1h1']), { e1h1: 1 });
});

test('budgetFrom: movetime, clock share with increment, a fifth of the clock at most', () => {
  assert.equal(budgetFrom({ movetime: 700 }, 'w'), 700);
  assert.equal(budgetFrom({}, 'w'), 1000);
  assert.equal(budgetFrom({ wtime: 60000, winc: 1000 }, 'w'), 60000 / 30 + 800 - 100);
  assert.equal(budgetFrom({ btime: 1000, binc: 5000 }, 'b'), 1000 / 5 - 100);
  assert.equal(budgetFrom({ wtime: 100 }, 'w'), 50);
});

// ---------------------------------------------------------------- Council with fake engines
// A fake engine answers each search from `script(go, position)`: a parseSearch() result, a promise, or a thrown error.
function fake(script) {
  return { started: false, gos: [], stopped: 0, name: 'fake',
    async start() { this.started = true; return this; },
    async search(position, go) { this.gos.push(go); return script(go, position); },
    stop() { this.stopped++; }, async newGame() {}, quit() {} };
}
const cfg = (extra = {}) => ({ referee: 'stockfish', tablebase: true, voices: [
  { id: 'stockfish', role: 'search', rating: 3650 }, { id: 'leela', role: 'search', rating: 3500 }, { id: 'maia1500', role: 'human', level: 1500 }], ...extra });
async function council(engines, extra) {
  const c = new Council(cfg(extra), { makeEngine: v => engines[v.id] });
  return c.start();
}
const line = (move, cp) => ({ move, cp, depth: 10, pv: [move] });

test('zero vote keeps Leela searching and proposing referee candidates', async () => {
  const e = {
    stockfish: fake(go => ({ bestmove: 'e2e4', lines: go.includes('searchmoves') ? [line('e2e4', 20), line('c2c4', 20)] : [line('e2e4', 20)] })),
    leela: fake(() => ({ bestmove: 'c2c4', lines: [line('c2c4', 20)] })),
    maia1500: fake(() => ({ bestmove: 'e2e4', policy: { e2e4: 1 } })),
  };
  const setup = cfg({ tablebase: false });
  setup.voices.find(v => v.id === 'leela').voteWeight = 0;
  const c = await new Council(setup, { makeEngine: v => e[v.id] }).start();
  const r = await c.think({ budgetMs: 200 });
  assert.equal(c.weights.leela, 0);
  assert.equal(c.weights.stockfish, 1);
  assert.ok(e.leela.started && e.leela.gos.length);
  assert.ok(e.stockfish.gos.some(go => go.includes('searchmoves') && go.includes('c2c4')));
  assert.ok(r.reports.some(v => v.engine === 'leela'));
  assert.equal(r.move, 'e2e4');
  c.quit();
});

test('vote overrides reject negative, nonnumeric and infinite values', () => {
  for (const voteWeight of [-1, '0', Infinity, NaN, null]) {
    const setup = cfg();
    setup.voices[1].voteWeight = voteWeight;
    assert.throws(() => new Council(setup, { makeEngine: () => {} }), /voteWeight/);
  }
  const c = new Council(cfg(), { makeEngine: () => {} });
  assert.ok(c.weights.leela > 0 && c.weights.leela < 1);
});

test('a sole legal move is played without asking the tablebase or anyone', async () => {
  let asked = 0;
  const e = { stockfish: fake(() => assert.fail('asked')), leela: fake(() => assert.fail('asked')), maia1500: fake(() => assert.fail('asked')) };
  const c = await council(e, { fetch: async () => { asked++; throw new Error('no'); } });
  const r = await c.think({ fen: '7k/8/6K1/8/8/8/8/R7 b - - 0 1' });   // 4 pieces, so a tablebase position; only Kg8 is legal
  assert.equal(r.reason, 'only-move');
  assert.equal(r.move, 'h8g8');
  assert.equal(asked, 0);
});

test('a voice that fails is left out and noted; the referee still decides', async () => {
  const e = {
    stockfish: fake(go => go.includes('searchmoves') ? { bestmove: 'e2e4', lines: [line('e2e4', 30), line('d2d4', 25)] } : { bestmove: 'e2e4', lines: [line('e2e4', 30)] }),
    leela: fake(() => { throw new Error('engine leela: timeout'); }),
    maia1500: fake(() => ({ bestmove: 'd2d4', lines: [], policy: { d2d4: 0.6, e2e4: 0.4 } })),
  };
  const c = await council(e, { tablebase: false });
  const r = await c.think({ budgetMs: 200 });
  assert.equal(r.move, 'e2e4');
  assert.ok(r.explanation.some(s => s.startsWith('leela did not answer')));
});

test('a failed referee probe blocks the unrated candidates instead of failing the move', async () => {
  const e = {
    stockfish: fake(go => { if (go.includes('searchmoves')) throw new Error('probe broke'); return { bestmove: 'e2e4', lines: [line('e2e4', 30)] }; }),
    leela: fake(() => ({ bestmove: 'c2c4', lines: [line('c2c4', 20)] })),
    maia1500: fake(() => ({ bestmove: 'e2e4', lines: [], policy: { e2e4: 1 } })),
  };
  const c = await council(e, { tablebase: false });
  const r = await c.think({ budgetMs: 200 });
  assert.equal(r.move, 'e2e4');
  assert.ok(r.vetoed.some(v => v.move === 'c2c4'));
  assert.ok(r.explanation.some(s => s.includes("check of the other candidates failed")));
});

test('searchmoves restricts the move and is passed to the search voices', async () => {
  const e = {
    stockfish: fake(() => ({ bestmove: 'a2a3', lines: [line('a2a3', 0), line('h2h3', -5)] })),
    leela: fake(() => ({ bestmove: 'h2h3', lines: [line('h2h3', 0)] })),
    maia1500: fake(() => ({ bestmove: 'e2e4', lines: [], policy: { e2e4: 0.9, a2a3: 0.05, h2h3: 0.05 } })),
  };
  const c = await council(e, { tablebase: false });
  const r = await c.think({ budgetMs: 200, searchmoves: ['a2a3', 'h2h3'] });
  assert.ok(['a2a3', 'h2h3'].includes(r.move));
  assert.ok(e.stockfish.gos[0].endsWith('searchmoves a2a3 h2h3'));
});

test('depth limits bind the referee; other search voices get a short fixed time', async () => {
  const e = {
    stockfish: fake(() => ({ bestmove: 'e2e4', lines: [line('e2e4', 30)] })),
    leela: fake(() => ({ bestmove: 'e2e4', lines: [line('e2e4', 30)] })),
    maia1500: fake(() => ({ bestmove: 'e2e4', lines: [], policy: { e2e4: 1 } })),
  };
  const c = await council(e, { tablebase: false });
  await c.think({ budgetMs: Infinity, limits: { depth: 12 } });
  assert.equal(e.stockfish.gos[0], 'depth 12');
  assert.equal(e.leela.gos[0], 'movetime 1000');
  assert.equal(e.maia1500.gos[0], 'nodes 1');
});

test('an infinite search runs until the signal aborts, then every voice is stopped', async () => {
  let release;
  const held = new Promise(r => { release = r; });
  const e = {
    stockfish: fake(async go => { if (go === 'infinite') await held; return { bestmove: 'e2e4', lines: [line('e2e4', 30)] }; }),
    leela: fake(async go => { if (go === 'infinite') await held; return { bestmove: 'e2e4', lines: [line('e2e4', 30)] }; }),
    maia1500: fake(() => ({ bestmove: 'e2e4', lines: [], policy: { e2e4: 1 } })),
  };
  for (const k of ['stockfish', 'leela']) e[k].stop = function () { this.stopped++; release(); };
  const c = await council(e, { tablebase: false });
  const ctl = new AbortController();
  const p = c.think({ budgetMs: Infinity, signal: ctl.signal });
  await new Promise(r => setTimeout(r, 30));
  ctl.abort();
  const r = await p;
  assert.equal(r.move, 'e2e4');
  assert.equal(e.stockfish.gos[0], 'infinite');
  assert.ok(e.stockfish.stopped >= 1 && e.leela.stopped >= 1);
});

test('replay accepts king-to-rook castling and returns standard moves', () => {
  const g = new Chess();
  const m = replay(g, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1h1']);
  assert.equal(m.at(-1), 'e1g1');
  assert.equal(g.get('g1')?.type, 'k');
  assert.throws(() => replay(new Chess(), ['e2e5']));
});

test('a voice that fails to start is left out; a failed referee shuts the others down', async () => {
  let brokenQuits = 0;
  const broken = { ...fake(() => ({})), async start() { throw new Error('no binary'); }, quit() { brokenQuits++; } };
  const ok = fake(() => ({ bestmove: 'e2e4', lines: [line('e2e4', 30)] }));
  const c = await new Council(cfg(), { makeEngine: v => (v.id === 'leela' ? broken : ok) }).start({ log: () => {} });
  assert.deepEqual([...c.voices.keys()], ['stockfish', 'maia1500']);
  assert.match(c.startNotes[0], /^leela failed to start/);
  assert.equal(brokenQuits, 1);   // a half-started engine is shut down too
  let quits = 0;
  const q = { ...fake(() => ({})), quit() { quits++; } };
  await assert.rejects(new Council(cfg({ voices: [{ id: 'maia1500', role: 'human', level: 1500 }, { id: 'stockfish', role: 'search', rating: 3650 }] }),
    { makeEngine: v => (v.id === 'stockfish' ? broken : q) }).start({ log: () => {} }), /referee "stockfish" failed to start/);
  assert.equal(quits, 1);
  assert.equal(brokenQuits, 2);
});

test('a search voice without a numeric rating is rejected at once', () => {
  assert.throws(() => new Council(cfg({ voices: [{ id: 'stockfish', role: 'search' }] }), { makeEngine: () => fake(() => ({})) }), /numeric rating/);
});

test('human mode in a tablebase position plays the most human move that keeps the result', async () => {
  const tb = { category: 'win', moves: [{ uci: 'a1a7', category: 'loss' }, { uci: 'a1a8', category: 'loss' }, { uci: 'g6f6', category: 'draw' }] };
  const e = { stockfish: fake(() => assert.fail('asked')), leela: fake(() => assert.fail('asked')),
    maia1500: fake(() => ({ bestmove: 'g6f6', lines: [], policy: { g6f6: 0.5, a1a8: 0.3, a1a7: 0.2 } })) };
  const c = await council(e, { fetch: async () => ({ ok: true, json: async () => tb }) });
  const fen = '6k1/8/6K1/8/8/8/8/R7 w - - 0 1';
  assert.equal((await c.think({ fen, mode: 'human' })).move, 'a1a8');   // Maia's favourite g6f6 would throw the win away
  assert.equal((await c.think({ fen })).move, 'a1a7');
});

test('after an abort the referee check still gets its short search (no repeated stop)', async () => {
  const ctl = new AbortController();
  const stops = { probe: 0 };
  let probing = false;
  const sf = { ...fake(async go => {
    if (go.includes('searchmoves')) { probing = true; await new Promise(r => setTimeout(r, 350)); probing = false; return { bestmove: 'e2e4', lines: [line('e2e4', 30), line('d2d4', 25)] }; }
    await new Promise(r => setTimeout(r, 150)); return { bestmove: 'e2e4', lines: [line('e2e4', 30)] };
  }), stop() { if (probing) stops.probe++; } };
  const e = { stockfish: sf, leela: fake(() => ({ bestmove: 'e2e4', lines: [line('e2e4', 20)] })), maia1500: fake(() => ({ bestmove: 'd2d4', lines: [], policy: { d2d4: 0.7, e2e4: 0.3 } })) };
  const c = await council(e, { tablebase: false });
  setTimeout(() => ctl.abort(), 20);
  const r = await c.think({ budgetMs: Infinity, signal: ctl.signal });
  assert.equal(stops.probe, 0);
  assert.ok(r.move);
});
