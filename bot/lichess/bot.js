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

async function say(id, text) { await api('POST', `/api/bot/game/${id}/chat`, new URLSearchParams({ room: 'player', text: chatLine(text) })); }

let myName = '';
async function playGame(gameId, myId, challenge) {
  const st = { id: gameId, color: null, fen: undefined, ...modeFromChallenge(challenge, lcfg), lastMoves: null, chatSent: false, plies: 0, myName };
  live.set(gameId, st);
  try {
    for await (const ev of ndjson(`/api/bot/game/stream/${gameId}`)) {
      if (ev.type === 'gameFull') {
        st.color = ev.white?.id === myId ? 'white' : 'black';
        st.fen = ev.initialFen && ev.initialFen !== 'startpos' ? ev.initialFen : undefined;
        if (!st.chatSent) { await say(gameId, lcfg.greeting || 'Kingfischer here. Before move 2 you can type !full, !teach or !human 1100-1900.'); st.chatSent = true; }
        await onState(st, ev.state);
      } else if (ev.type === 'gameState') await onState(st, ev);
      else if (ev.type === 'chatLine' && ev.room === 'player' && ev.username?.toLowerCase() !== st.myName) {
        const m = modeFromChat(ev.text);
        if (m && st.plies < 2) { Object.assign(st, m); await say(gameId, `Mode: ${st.mode}${st.mode === 'human' ? ' ' + st.humanElo : ''}.`); }
        else if (m) await say(gameId, 'The mode is fixed once the game is under way.');
      }
    }
  } finally { live.delete(gameId); }
}

async function onState(st, s) {
  if (s.status !== 'started') return;
  const moves = s.moves ? s.moves.split(' ') : [];
  st.plies = moves.length;
  if (st.lastMoves === s.moves) return;
  st.lastMoves = s.moves;
  const game = new Chess(st.fen); for (const m of moves) game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  if ((game.turn() === 'w') !== (st.color === 'white')) return;
  const budget = budgetForLichess(s, st.color, lcfg);
  const v = await council.think({ fen: st.fen, moves, budgetMs: budget, mode: st.mode, humanElo: st.humanElo, guard: lcfg.guard, seed: st.mode === 'human' ? moves.length + 1 : null });
  console.log(`[${st.id}] ${moves.length + 1}: ${v.move} · ${v.explanation[0]}`);
  if (!v.move) return;
  const r = await api('POST', `/api/bot/game/${st.id}/move/${v.move}`);
  if (!r.ok) console.error(`[${st.id}] move ${v.move} refused: HTTP ${r.status} ${await r.text()}`);
  else if (st.mode === 'teach' && v.explanation[0]) await say(st.id, v.explanation[0]);
}

async function main() {
  const acc = await me();
  if (acc.title !== 'BOT') { console.error(`@${acc.username} is not a BOT account; see docs/LICHESS.md. Nothing was changed.`); process.exit(3); }
  myName = acc.username.toLowerCase();
  console.log(`Kingfischer online as @${acc.username}${DRY ? ' (dry run: nothing will be accepted or played)' : ''}`);
  if (!DRY) council = await nodeCouncil(cfg).start();
  const pending = new Map();
  for await (const ev of ndjson('/api/stream/event')) {
    if (ev.type === 'challenge') {
      const c = ev.challenge; const verdict = acceptable(c, lcfg, live.size);
      console.log(`challenge ${c.id} from ${c.challenger?.name}: ${verdict.ok ? 'accept' : 'decline (' + verdict.reason + ')'}`);
      if (DRY) continue;
      if (verdict.ok) { pending.set(c.id, c); await api('POST', `/api/challenge/${c.id}/accept`); }
      else await api('POST', `/api/challenge/${c.id}/decline`, new URLSearchParams({ reason: verdict.reason }));
    } else if (ev.type === 'gameStart' && !DRY) {
      const id = ev.game.gameId || ev.game.id;
      if (live.has(id)) continue;
      const ch = pending.get(id); pending.delete(id);
      playGame(id, acc.id, ch).catch(e => console.error(`[${id}] ${e.message}`));
    }
  }
}

main().catch(e => { console.error(e.message); council?.quit(); process.exit(1); });
