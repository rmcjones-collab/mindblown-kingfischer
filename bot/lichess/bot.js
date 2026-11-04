#!/usr/bin/env node
// Kingfischer on Lichess, through the Bot API. Needs a Lichess BOT account and its token in LICHESS_TOKEN.
//
//   LICHESS_TOKEN=... node bot/lichess/bot.js [kingfischer.config.json] [--dry-run]
//
// Converting an account to BOT is permanent and only works on an account that has never played a game, so this script
// never does it; see docs/LICHESS.md. --dry-run connects, prints what it would accept and plays nothing.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from '../../vendor/chess.js';
import { nodeCouncil } from '../../council/node.js';
import { loadConfig } from '../../council/config.js';
import { replay } from '../../council/council.js';
import { acceptable, budgetForLichess, modeFromChallenge, modeFromChat, chatLine, DEFAULTS } from './policy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const cfgPath = args.find(a => !a.startsWith('--')) || path.join(HERE, '..', '..', 'kingfischer.config.json');
const API = process.env.LICHESS_API || 'https://lichess.org';
const TOKEN = process.env.LICHESS_TOKEN;
if (!TOKEN) { console.error('Set LICHESS_TOKEN to the BOT account token (scope bot:play).'); process.exit(2); }

const cfg = loadConfig(cfgPath);
const lcfg = { ...DEFAULTS, ...(cfg.lichess || {}) };
const H = { Authorization: `Bearer ${TOKEN}` };
const live = new Map();   // gameId → state
let council;

async function api(method, p, body) {
  const res = await fetch(API + p, { method, headers: { ...H, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body });
  if (res.status === 429) { await new Promise(r => setTimeout(r, 60000)); return api(method, p, body); }   // the docs ask for a one-minute wait
  return res;
}

// Read an ND-JSON stream: one JSON object per line, empty keep-alive lines skipped.
async function* ndjson(p) {
  const res = await api('GET', p);
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) yield JSON.parse(line); }
  }
}

async function me() { const r = await api('GET', '/api/account'); if (!r.ok) throw new Error(`account: HTTP ${r.status}`); return r.json(); }

// Chat is optional: it never holds up a move, and a failed or rate-limited message is only logged.
function say(id, text) {
  fetch(`${API}/api/bot/game/${id}/chat`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ room: 'player', text: chatLine(text) }) })
    .then(r => { if (!r.ok) console.error(`[${id}] chat: HTTP ${r.status}`); }, e => console.error(`[${id}] chat: ${e.message}`));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoff = n => Math.min(30000, 1000 * 2 ** n);

let myName = '';
async function playGame(gameId, myId, challenge) {
  const st = { id: gameId, color: null, fen: undefined, ...modeFromChallenge(challenge, lcfg), done: null, inflight: null, chatSent: false, plies: 0, myName, over: false };
  live.set(gameId, st);
  try {
    // The game stream can drop while the game goes on; reopen it (its first gameFull restores the position) until the
    // game is over or Lichess no longer knows it.
    for (let attempt = 0; !st.over && attempt < 12; attempt++) {
      try {
        for await (const ev of ndjson(`/api/bot/game/stream/${gameId}`)) {
          attempt = 0;
          if (ev.type === 'gameFull') {
            st.color = ev.white?.id === myId ? 'white' : 'black';
            st.fen = ev.initialFen && ev.initialFen !== 'startpos' ? ev.initialFen : undefined;
            if (!st.chatSent) { say(gameId, lcfg.greeting || 'Kingfischer here. Before move 2 you can type !full, !teach or !human 1100-1900.'); st.chatSent = true; }
            onState(st, ev.state);
          } else if (ev.type === 'gameState') onState(st, ev);
          else if (ev.type === 'chatLine' && ev.room === 'player' && ev.username?.toLowerCase() !== st.myName) {
            const m = modeFromChat(ev.text);
            if (m && st.plies < 2) { Object.assign(st, m); say(gameId, `Mode: ${st.mode}${st.mode === 'human' ? ' ' + st.humanElo : ''}.`); }
            else if (m) say(gameId, 'The mode is fixed once the game is under way.');
          }
        }
      } catch (e) {
        if (/HTTP 404/.test(e.message)) break;
        console.error(`[${gameId}] stream: ${e.message}`);
      }
      if (!st.over) await sleep(backoff(attempt));
    }
  } finally { live.delete(gameId); }
}

// Called for every state without waiting, so chat and later states are read while the council thinks. `inflight`
// stops a second think for the same position; `done` is set only once the move has been accepted, so a failed think
// or a refused move is tried again (once here, and again on any later state for the same position).
function onState(st, s) {
  if (s.status !== 'started') { st.over = true; return; }
  st.plies = s.moves ? s.moves.split(' ').length : 0;
  if (st.done === s.moves || st.inflight === s.moves) return;
  const game = new Chess(st.fen);
  let moves;
  try { moves = replay(game, s.moves ? s.moves.split(' ') : []); }   // castling may come as king-to-rook (e1h1)
  catch (e) { console.error(`[${st.id}] could not replay the moves: ${e.message}`); return; }
  if ((game.turn() === 'w') !== (st.color === 'white')) return;
  st.inflight = s.moves;
  (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const budget = budgetForLichess(s, st.color, lcfg) * (attempt ? 0.3 : 1);
        const v = await council.think({ fen: st.fen, moves, budgetMs: budget, mode: st.mode, humanElo: st.humanElo, guard: lcfg.guard, seed: st.mode === 'human' ? moves.length + 1 : null });
        console.log(`[${st.id}] ${moves.length + 1}: ${v.move} · ${v.explanation[0]}`);
        if (!v.move) { st.done = s.moves; return; }
        const r = await api('POST', `/api/bot/game/${st.id}/move/${v.move}`);
        if (r.ok) { st.done = s.moves; if (st.mode === 'teach' && v.explanation[0]) say(st.id, v.explanation[0]); return; }
        console.error(`[${st.id}] move ${v.move} refused: HTTP ${r.status} ${await r.text()}`);
        if (r.status === 400 || r.status === 404) return;   // game over or not our turn any more
      } catch (e) { console.error(`[${st.id}] think: ${e.message}`); }
    }
  })().finally(() => { if (st.inflight === s.moves) st.inflight = null; });
}

async function main() {
  const acc = await me();
  if (acc.title !== 'BOT') { console.error(`@${acc.username} is not a BOT account; see docs/LICHESS.md. Nothing was changed.`); process.exit(3); }
  myName = acc.username.toLowerCase();
  console.log(`Kingfischer online as @${acc.username}${DRY ? ' (dry run: nothing will be accepted or played)' : ''}`);
  if (!DRY) council = await nodeCouncil(cfg).start();
  const pending = new Map();   // accepted challenges whose game has not started yet; they count against maxGames
  // The event stream replays open challenges and running games each time it opens, so handling is idempotent and the
  // stream is simply reopened when it ends.
  for (let attempt = 0; ; attempt++) {
    try {
      for await (const ev of ndjson('/api/stream/event')) {
        attempt = 0;
        if (ev.type === 'challenge') {
          const c = ev.challenge;
          if (pending.has(c.id) || live.has(c.id) || c.challenger?.name?.toLowerCase() === myName) continue;
          const verdict = acceptable(c, lcfg, live.size + pending.size);
          console.log(`challenge ${c.id} from ${c.challenger?.name}: ${verdict.ok ? 'accept' : 'decline (' + verdict.reason + ')'}`);
          if (DRY) continue;
          if (verdict.ok) {
            pending.set(c.id, c);
            const r = await api('POST', `/api/challenge/${c.id}/accept`);
            if (!r.ok) { pending.delete(c.id); console.error(`challenge ${c.id}: accept failed, HTTP ${r.status}`); }
          } else await api('POST', `/api/challenge/${c.id}/decline`, new URLSearchParams({ reason: verdict.reason }));
        } else if (ev.type === 'challengeCanceled' || ev.type === 'challengeDeclined') pending.delete(ev.challenge?.id);
        else if (ev.type === 'gameStart' && !DRY) {
          const id = ev.game.gameId || ev.game.id;
          const ch = pending.get(id); pending.delete(id);
          if (live.has(id)) continue;
          playGame(id, acc.id, ch).catch(e => console.error(`[${id}] ${e.message}`));
        }
      }
      console.error('event stream closed; reconnecting');
    } catch (e) { console.error(`event stream: ${e.message}; reconnecting`); }
    await sleep(backoff(attempt));
  }
}

main().catch(e => { console.error(e.message); council?.quit(); process.exit(1); });
