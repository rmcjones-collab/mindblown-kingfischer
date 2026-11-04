// Check the JavaScript Maia encoder against Lc0 itself: same network, same positions, the move probabilities must match.
//   node tools/validate-maia.mjs [level]      (needs engines/lc0/lc0, engines/nets/maia-<level>.pb.gz and the .onnx from lc0 leela2onnx)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';
import { UciEngine } from '../council/uci.js';
import { standardCastling } from '../council/council.js';
import { positions } from '../bot/browser/maia.js';
import { maiaPolicy } from '../bot/browser/maia.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const level = process.argv[2] || '1500';
const onnx = process.env.MAIA_ONNX || path.join(ROOT, 'bot/browser/models', `maia-${level}.onnx`);

// Each case exercises one part of the encoding.
const CASES = [
  { name: 'start position (White to move)', fen: null, moves: [] },
  { name: 'after 1.e4 e5 2.Nf3 (Black to move, mirrored)', fen: null, moves: ['e2e4', 'e7e5', 'g1f3'] },
  { name: 'Italian, both sides can castle', fen: null, moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'd2d3', 'f8c5'] },
  { name: 'queenside castling legal for Black', fen: null, moves: ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'b1c3', 'g8f6', 'g1f3', 'c8f5', 'e2e3', 'e7e6', 'f1d3', 'b8d7', 'e1g1', 'd8c7', 'd1e2'] },
  { name: 'repetition (knights out and back twice)', fen: null, moves: ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8', 'e2e4'] },
  { name: 'FEN only, history filled', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', moves: [] },
  { name: 'FEN with en passant square', fen: 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3', moves: [] },
  { name: 'promotion choices (White)', fen: '8/1P4k1/8/8/8/8/6K1/8 w - - 0 1', moves: [] },
  { name: 'promotion choices (Black)', fen: '8/6k1/8/8/8/8/1p4K1/8 b - - 0 1', moves: [] },
  { name: 'fifty-move counter at 37', fen: '8/5k2/8/3r4/8/8/2R2K2/8 w - - 37 80', moves: [] },
];

const pos = c => (c.fen ? `fen ${c.fen}` : 'startpos') + (c.moves.length ? ' moves ' + c.moves.join(' ') : '');
const session = await ort.InferenceSession.create(onnx);
const lc0 = await new UciEngine('maia', { cmd: path.join(ROOT, 'engines/lc0/lc0'), args: [`--weights=${path.join(ROOT, `engines/nets/maia-${level}.pb.gz`)}`], options: { Threads: 1, VerboseMoveStats: 'true', PolicyTemperature: 1 } }).start();
let worst = 0, fails = 0;
for (const c of CASES) {
  await lc0.newGame();
  const legal = positions(c.fen, c.moves).game.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
  const ref = standardCastling((await lc0.search(pos(c), 'nodes 1')).policy || {}, legal);
  const { policy } = await maiaPolicy(session, ort, c.fen, c.moves);
  const moves = new Set([...Object.keys(ref), ...Object.keys(policy)]);
  let diff = 0, worstMove = '';
  for (const m of moves) { const d = Math.abs((ref[m] ?? 0) - (policy[m] ?? 0)); if (d > diff) { diff = d; worstMove = m; } }
  const top = Object.entries(policy)[0];
  const refTop = Object.entries(ref).sort((a, b) => b[1] - a[1])[0];
  const ok = diff < 0.0011 && Object.keys(ref).length === Object.keys(policy).length;   // lc0 prints P% to two decimals
  if (!ok) fails++;
  worst = Math.max(worst, diff);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: JS top ${top[0]} ${(top[1] * 100).toFixed(2)}% · Lc0 top ${refTop?.[0]} ${(refTop?.[1] * 100).toFixed(2)}% · largest gap ${(diff * 100).toFixed(3)} points${diff > 0.0011 ? ' on ' + worstMove : ''}`);
}
lc0.quit();
console.log(`${CASES.length - fails}/${CASES.length} positions match Lc0 (largest gap ${(worst * 100).toFixed(3)} percentage points).`);
process.exit(fails ? 1 : 0);
