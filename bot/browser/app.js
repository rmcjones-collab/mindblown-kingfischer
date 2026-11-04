// Kingfischer in the browser: the board and controls. The thinking happens in council-web.js and king/king.js.
import { Chess } from '../../vendor/chess.js';
import { browserCouncil } from './council-web.js';

const $ = id => document.getElementById(id);
const FILES = 'abcdefgh';
const HINTS = {
  full: 'Stockfish and Maia vote; Stockfish, as referee, vetoes anything that gives away more than 2% expected score.',
  human: 'Plays a move a person at this level would choose (Maia), with the blunder guard deciding how many human mistakes get through.',
  teach: 'Full strength, and every voice explains its choice: scores, win/draw/loss odds, its main line and how people play here.',
};
const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

const START_FEN = new URLSearchParams(location.search).get('fen') || undefined;   // ?fen=… starts from a position (for practice and tests)
const state = { game: new Chess(START_FEN), you: 'w', flipped: false, sel: null, last: null, busy: false, council: null, gen: 0,
  mode: 'full', level: 1500, guard: 'soft', think: 2500 };

// ---------- board ----------
function squares() {
  const out = [];
  const ranks = state.flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = state.flipped ? [...FILES].reverse() : [...FILES];
  for (const r of ranks) for (const f of files) out.push(f + r);
  return out;
}
function render() {
  const g = state.game, b = $('board');
  const targets = state.sel ? g.moves({ square: state.sel, verbose: true }) : [];
  const checkSq = g.inCheck() ? findKing(g.turn()) : null;
  b.replaceChildren();
  const list = squares();
  list.forEach((sq, i) => {
    const el = document.createElement('button');
    const dark = (FILES.indexOf(sq[0]) + +sq[1]) % 2 === 1;   // a1 is dark
    el.className = 'sq' + (dark ? ' dark' : '');
    el.dataset.sq = sq;
    el.setAttribute('role', 'gridcell');
    const pc = g.get(sq);
    el.setAttribute('aria-label', sq + (pc ? ` ${pc.color === 'w' ? 'white' : 'black'} ${NAMES[pc.type]}` : ''));
    if (state.last && (state.last.from === sq || state.last.to === sq)) el.classList.add('last');
    if (state.sel === sq) el.classList.add('sel');
    const t = targets.find(m => m.to === sq);
    if (t) el.classList.add('target', ...(t.captured ? ['capture'] : []));
    if (checkSq === sq) el.classList.add('check');
    if (pc) { const img = document.createElement('img'); img.src = `pieces/${pc.color}${pc.type.toUpperCase()}.svg`; img.alt = ''; el.append(img); }
    if (i % 8 === 0) el.append(coord('r', sq[1]));
    if (i >= 56) el.append(coord('f', sq[0]));
    b.append(el);
  });
  const youTop = state.flipped !== (state.you === 'b');
  $('top-player').className = 'player ' + (youTop ? (state.you === 'w' ? 'w' : 'b') + ' you' : (state.you === 'w' ? 'b' : 'w'));
  $('bottom-player').className = 'player ' + (youTop ? (state.you === 'w' ? 'b' : 'w') : state.you);
  $('top-name').textContent = youTop ? 'You' : kingName();
  $('bottom-name').textContent = youTop ? kingName() : 'You';
  $('top-player').append($('thinking'));
  if (youTop) $('bottom-player').append($('thinking'));
  renderMoves();
  $('undo').disabled = state.busy || g.history().length < (state.you === 'w' ? 1 : 2);
}
function coord(kind, text) { const s = document.createElement('span'); s.className = 'coord ' + kind; s.textContent = text; return s; }
function findKing(color) { for (const row of state.game.board()) for (const c of row) if (c && c.type === 'k' && c.color === color) return c.square; return null; }
function kingName() { return state.mode === 'human' ? `Kingfischer · human ${state.level}` : state.mode === 'teach' ? 'Kingfischer · teach' : 'Kingfischer'; }
function renderMoves() {
  const ol = $('movelist'); ol.replaceChildren();
  const h = state.game.history();
  for (let i = 0; i < h.length; i += 2) {
    const n = document.createElement('li'); n.className = 'n'; n.textContent = i / 2 + 1 + '.';
    const w = document.createElement('li'); w.textContent = h[i];
    const bl = document.createElement('li'); bl.textContent = h[i + 1] || '';
    ol.append(n, w, bl);
  }
  ol.scrollTop = ol.scrollHeight;
}

// ---------- your moves ----------
$('board').addEventListener('click', e => {
  const el = e.target.closest('.sq'); if (!el) return;
  clickSquare(el.dataset.sq);
});
function clickSquare(sq) {
  const g = state.game;
  if (state.busy || g.isGameOver() || g.turn() !== state.you || !state.council) return;
  const pc = g.get(sq);
  if (state.sel) {
    const legal = g.moves({ square: state.sel, verbose: true }).filter(m => m.to === sq);
    if (legal.length) {
      if (legal.some(m => m.promotion)) return askPromotion(state.sel, sq);
      return play({ from: state.sel, to: sq });
    }
  }
  state.sel = pc && pc.color === state.you ? (state.sel === sq ? null : sq) : null;
  render();
}
function askPromotion(from, to) {
  const box = $('promo'); box.replaceChildren(); box.hidden = false;
  for (const p of ['q', 'r', 'b', 'n']) {
    const b = document.createElement('button'); b.setAttribute('aria-label', NAMES[p]);
    const img = document.createElement('img'); img.src = `pieces/${state.you}${p.toUpperCase()}.svg`; img.alt = '';
    b.append(img); b.onclick = () => { box.hidden = true; play({ from, to, promotion: p }); };
    box.append(b);
  }
  box.querySelector('button').focus();
}
function play(m) {
  const r = state.game.move(m);
  state.sel = null; state.last = r; render();
  if (!checkOver()) kingMove();
}

// ---------- the King's moves ----------
async function kingMove() {
  const g = state.game, gen = state.gen;
  state.busy = true; $('thinking').hidden = false; render();
  setStatus(state.mode === 'human' ? `Kingfischer is choosing a ${state.level}-level move…` : 'The council is thinking…');
  try {
    const moves = g.history({ verbose: true }).map(m => m.from + m.to + (m.promotion || ''));
    const v = await state.council.think({ fen: START_FEN, moves, budgetMs: state.think, mode: state.mode, humanElo: state.level, guard: state.guard, seed: state.mode === 'human' ? (Date.now() & 0xffff) : null });
    if (gen !== state.gen) return;                       // a new game started while the King was thinking
    if (!v.move) throw new Error('no move');
    const r = g.move({ from: v.move.slice(0, 2), to: v.move.slice(2, 4), promotion: v.move[4] });
    state.last = r;
    showVerdict(v, r.san);
    setStatus('Your move.');
  } catch (e) {
    if (gen === state.gen) setStatus('Something went wrong: ' + e.message);
  } finally {
    if (gen === state.gen) { state.busy = false; $('thinking').hidden = true; render(); checkOver(); }
  }
}
function showVerdict(v, san) {
  const why = $('why'); why.replaceChildren();
  const head = document.createElement('li'); head.textContent = `Played ${san}. ` + (v.explanation[0] || ''); why.append(head);
  for (const line of v.explanation.slice(1)) { const li = document.createElement('li'); li.textContent = line; why.append(li); }
  const tb = $('votes'), body = tb.querySelector('tbody'); body.replaceChildren();
  const ref = v.reports?.find(r => r.engine === 'stockfish');
  const out = new Set((v.vetoed || []).map(x => x.move));
  const rows = (v.votes || []).filter(x => !out.has(x.move)).slice(0, 5);
  for (const vote of rows) body.append(voteRow(vote, ref, vote.move === v.move, false));
  for (const vt of (v.vetoed || []).filter(x => x.refereeLoss != null).slice(0, 2)) body.append(voteRow(vt, ref, false, true));
  tb.hidden = !body.children.length;
}
function voteRow(vote, ref, pick, blocked) {
  const tr = document.createElement('tr'); if (pick) tr.className = 'pick'; if (blocked) tr.className = 'blocked';
  const l = ref?.lines?.find(x => x.move === vote.move);
  const said = l ? (l.mate != null ? `mate in ${Math.abs(l.mate)}${l.mate < 0 ? ' (against)' : ''}` : `${l.cp >= 0 ? '+' : ''}${(l.cp / 100).toFixed(2)}`) : '—';
  for (const t of [sanOf(vote.move), vote.score != null ? vote.score.toFixed(2) : (blocked ? 'blocked' : '—'), said]) { const td = document.createElement('td'); td.textContent = t; tr.append(td); }
  return tr;
}
// SAN for a candidate the King considered, in the position before its move.
function sanOf(uci) {
  try {
    const g = new Chess(START_FEN);
    for (const m of state.game.history().slice(0, -1)) g.move(m);
    return g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch { return uci; }
}

function checkOver() {
  const g = state.game; if (!g.isGameOver()) { $('result').hidden = true; return false; }
  let title, sub = '';
  if (g.isCheckmate()) { title = g.turn() === state.you ? 'Kingfischer wins' : 'You win'; sub = 'Checkmate'; }
  else { title = 'Draw'; sub = g.isStalemate() ? 'Stalemate' : g.isThreefoldRepetition() ? 'Threefold repetition' : g.isInsufficientMaterial() ? 'Insufficient material' : 'Fifty-move rule'; }
  const box = $('result'); box.replaceChildren(document.createTextNode(title)); const s = document.createElement('small'); s.textContent = sub; box.append(s); box.hidden = false;
  setStatus(`${title} — ${sub.toLowerCase()}.`);
  return true;
}

// ---------- controls ----------
function seg(id, key, after) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $(id).children) x.setAttribute('aria-checked', String(x === b));
    state[key] = key === 'level' ? +b.dataset.v : b.dataset.v;
    after?.();
  });
}
seg('mode', 'mode', () => { $('level-field').hidden = state.mode !== 'human'; $('mode-hint').textContent = HINTS[state.mode]; if (state.mode === 'human') state.council?.preloadHuman(state.level).then(() => setStatus('Ready.')); render(); });
seg('level', 'level', () => { state.council?.preloadHuman(state.level).then(() => setStatus('Ready.')); render(); });
seg('guard', 'guard');
$('think').addEventListener('change', e => { state.think = +e.target.value; });
$('flip').addEventListener('click', () => { state.flipped = !state.flipped; render(); });
$('new-white').addEventListener('click', () => newGame('w'));
$('new-black').addEventListener('click', () => newGame('b'));
$('undo').addEventListener('click', () => {
  if (state.busy) return;
  const g = state.game; g.undo(); if (g.turn() !== state.you) g.undo();
  const h = g.history({ verbose: true }); state.last = h[h.length - 1] || null; state.sel = null; $('result').hidden = true; render();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('promo').hidden) { $('promo').hidden = true; } });

async function newGame(color) {
  state.gen++; state.game = new Chess(START_FEN); state.you = color; state.flipped = color === 'b'; state.sel = null; state.last = null; state.busy = false;
  $('thinking').hidden = true; $('result').hidden = true; $('promo').hidden = true; $('promo').replaceChildren();
  for (const v of state.council?.voices?.values() || []) v.engine.stop?.();   // a search for the old game ends now
  $('why').innerHTML = '<li class="muted">The King explains each decision here.</li>'; $('votes').hidden = true;
  await state.council?.newGame();
  render();
  if (color === 'b' && state.council) kingMove(); else setStatus(state.council ? 'Your move.' : 'Loading…');
}
function setStatus(t) { $('status').textContent = t; }

$('mode-hint').textContent = HINTS.full;
render();
browserCouncil({ onProgress: setStatus }).then(c => { state.council = c; window.kingfischer = { state, council: c }; setStatus(state.game.turn() === state.you ? 'Ready — your move.' : 'Ready.'); render(); if (state.game.turn() !== state.you) kingMove(); })
  .catch(e => setStatus('Could not start the engines: ' + e.message));
