// Maia in JavaScript: turns a game into Lc0's 112 input planes and reads the 1858-slot policy back as move probabilities.
// Works with onnxruntime-web in the browser and onnxruntime-node in tests; the ONNX files come from `lc0 leela2onnx`.
//
// The encoding follows Lc0's INPUT_CLASSICAL_112_PLANE format (src/neural/encoder.cc, GPL-3.0):
//   8 history slots × 13 planes (our P N B R Q K, their P N B R Q K, repeated-position flag), newest first,
//   all seen from the side to move (Black to move ⇒ ranks mirrored, colours swapped);
//   104–107 castling (we O-O-O, we O-O, they O-O-O, they O-O), 108 ones if Black to move, 109 fifty-move counter (plies),
//   110 zeros, 111 ones. Missing history is filled with the earliest position unless that is the standard start ("fen_only").
import { Chess } from '../../vendor/chess.js';
import { POLICY_INDEX } from './policy-index.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
const ORDER = 'pnbrqk';
const SLOT = new Map(POLICY_INDEX.map((m, i) => [m, i]));
const sqIdx = s => (s.charCodeAt(0) - 97) + (s.charCodeAt(1) - 49) * 8;   // a1 = 0 … h8 = 63
const flipSq = s => s[0] + String(9 - +s[1]);

// Replay a game into its positions (oldest first). Each entry keeps the piece list, side to move, castling, ep and clocks.
export function positions(fen, moves = []) {
  const g = new Chess(fen || undefined);
  const out = [snap(g)];
  for (const m of moves) {
    const r = g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    if (!r) throw new Error(`illegal move ${m}`);
    out.push(snap(g));
  }
  // Repetitions: how often this exact position (pieces, side, castling, ep) appeared earlier in the game.
  const seen = new Map();
  for (const p of out) { p.reps = seen.get(p.key) || 0; seen.set(p.key, p.reps + 1); }
  return { game: g, list: out };
}
function snap(g) {
  const f = g.fen().split(' ');
  const pieces = [];
  for (const row of g.board()) for (const c of row) if (c) pieces.push({ sq: c.square, type: c.type, color: c.color });
  return { pieces, turn: f[1], castling: f[2], ep: f[3], rule50: +f[4], key: f.slice(0, 4).join(' ') };
}

/** Encode the last position of the game for the network. Returns { planes: Float32Array(112*64), black: boolean }. */
export function encode(fen, moves = []) {
  const { list } = positions(fen, moves);
  const cur = list[list.length - 1];
  const us = cur.turn, black = us === 'b';
  const view = s => black ? flipSq(s) : s;
  const planes = new Float32Array(112 * 64);
  const fill = (p, v = 1) => planes.fill(v, p * 64, p * 64 + 64);
  const startOnly = list[0].key === START;
  for (let i = 0; i < 8; i++) {
    const h = list.length - 1 - i;
    if (h < 0 && startOnly) break;
    const pos = list[Math.max(h, 0)];
    const base = i * 13;
    let pieces = pos.pieces;
    if (h < 0 && pos.ep !== '-') {
      // Lc0 rebuilds the move before an en-passant square: the pawn goes back two ranks.
      const up = pos.ep[1] === '3';
      const from = pos.ep[0] + (up ? '4' : '5'), to = pos.ep[0] + (up ? '2' : '7');
      pieces = pieces.map(p => p.sq === from && p.type === 'p' ? { ...p, sq: to } : p);
    }
    for (const p of pieces) planes[(base + ORDER.indexOf(p.type) + (p.color === us ? 0 : 6)) * 64 + sqIdx(view(p.sq))] = 1;
    if (pos.reps >= 1) fill(base + 12);
  }
  const ours = black ? 'kq' : 'KQ', theirs = black ? 'KQ' : 'kq';
  if (cur.castling.includes(ours[1])) fill(104);
  if (cur.castling.includes(ours[0])) fill(105);
  if (cur.castling.includes(theirs[1])) fill(106);
  if (cur.castling.includes(theirs[0])) fill(107);
  if (black) fill(108);
  fill(109, cur.rule50);
  fill(111);
  return { planes, black };
}

/** The policy slot for a legal UCI move, seen from the mover. Castling is "king takes rook"; knight promotions use the plain slot. */
export function slotFor(uci, black, castleRook) {
  let from = uci.slice(0, 2), to = castleRook || uci.slice(2, 4);
  let promo = uci[4] && uci[4] !== 'n' ? uci[4] : '';
  if (black) { from = flipSq(from); to = flipSq(to); }
  return SLOT.get(from + to + promo);
}

/** Turn 1858 logits into probabilities over the legal moves (softmax at temperature 1 unless told otherwise). */
export function movePolicy(logits, game, black, temperature = 1) {
  const legal = game.moves({ verbose: true });
  const rows = legal.map(m => {
    const uci = m.from + m.to + (m.promotion || '');
    let rook = null;
    if (m.flags.includes('k')) rook = 'h' + m.from[1];
    if (m.flags.includes('q')) rook = 'a' + m.from[1];
    const s = slotFor(uci, black, rook);
    if (s === undefined) throw new Error(`no policy slot for ${uci}`);
    return { uci, logit: logits[s] / temperature };
  });
  const max = Math.max(...rows.map(r => r.logit));
  let sum = 0; for (const r of rows) { r.p = Math.exp(r.logit - max); sum += r.p; }
  const policy = {}; for (const r of rows.sort((a, b) => b.p - a.p)) policy[r.uci] = r.p / sum;
  return policy;
}

/** Ask a loaded ONNX session (web or node runtime) for Maia's human-move probabilities and its win/draw/loss guess. */
export async function maiaPolicy(session, ort, fen, moves = [], temperature = 1) {
  const { planes, black } = encode(fen, moves);
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', planes, [1, 112, 8, 8]) };
  const out = await session.run(feeds);
  const logits = out['/output/policy'].data, wdl = out['/output/wdl']?.data;
  const { game } = positions(fen, moves);
  let w = null;
  if (wdl) { const m = Math.max(...wdl), e = [...wdl].map(x => Math.exp(x - m)), s = e[0] + e[1] + e[2]; w = e.map(x => x / s); }
  return { policy: movePolicy(logits, game, black, temperature), wdl: w };
}
