import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptable, modeFromChat, budgetForLichess, chatLine } from '../bot/lichess/policy.js';

const ch = (o = {}) => ({ id: 'abc', rated: false, speed: 'blitz', variant: { key: 'standard' }, challenger: { name: 'x' }, timeControl: { type: 'clock', limit: 300, increment: 3 }, ...o });

test('accepts a normal blitz challenge', () => assert.deepEqual(acceptable(ch()), { ok: true, reason: null }));
test('declines when busy', () => assert.equal(acceptable(ch(), {}, 1).reason, 'later'));
test('declines variants', () => assert.equal(acceptable(ch({ variant: { key: 'atomic' } })).reason, 'variant'));
test('declines bullet as too fast', () => assert.equal(acceptable(ch({ speed: 'bullet', timeControl: { type: 'clock', limit: 60, increment: 0 } })).reason, 'tooFast'));
test('declines bots unless allowed', () => {
  assert.equal(acceptable(ch({ challenger: { title: 'BOT' } })).reason, 'noBot');
  assert.equal(acceptable(ch({ challenger: { title: 'BOT' } }), { bots: true }).ok, true);
});
test('rated/casual switches', () => {
  assert.equal(acceptable(ch({ rated: true }), { rated: false }).reason, 'casual');
  assert.equal(acceptable(ch(), { casual: false }).reason, 'rated');
});
test('chat commands set the mode', () => {
  assert.deepEqual(modeFromChat('!teach'), { mode: 'teach' });
  assert.deepEqual(modeFromChat(' !Human 1300 '), { mode: 'human', humanElo: 1300 });
  assert.deepEqual(modeFromChat('!human 2500'), { mode: 'human', humanElo: 1900 });
  assert.deepEqual(modeFromChat('!human'), { mode: 'human', humanElo: 1500 });
  assert.equal(modeFromChat('hello'), null);
});
test('budget: correspondence uses the fixed time; clocks use budgetFrom', () => {
  assert.equal(budgetForLichess({}, 'white'), 20000);
  assert.equal(budgetForLichess({ wtime: 2 ** 31 - 1, btime: 2 ** 31 - 1 }, 'white', { correspondenceMs: 5000 }), 5000);
  const b = budgetForLichess({ wtime: 180000, btime: 180000, winc: 2000, binc: 2000 }, 'black');
  assert.ok(b > 500 && b < 30000, String(b));
});
test('chat lines are trimmed to 140 characters', () => {
  assert.equal(chatLine('a  b'), 'a b');
  assert.equal(chatLine('x'.repeat(200)).length, 140);
});
