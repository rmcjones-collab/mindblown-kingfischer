// A tiny stand-in for the Lichess Bot API, so bot/lichess/bot.js can be tested end to end without an account.
//   node tools/fake-lichess.mjs          → starts on :8787, plays 1.e4 / 2.d4 / 3.Nc3 as White, then ends the game
//   LICHESS_API=http://127.0.0.1:8787 LICHESS_TOKEN=fake node bot/lichess/bot.js
//   FAKE_DROP=1 node tools/fake-lichess.mjs   also drops the game stream once mid-game, to test that the bot reconnects
import http from 'node:http';
const WHITE = ['e2e4', 'd2d4', 'b1c3'];
let moves = [], game = null, events = null, log = [], dropped = !process.env.FAKE_DROP;
const send = (res, o) => res.write(JSON.stringify(o) + '\n');
const state = (status = 'started') => ({ type: 'gameState', moves: moves.join(' '), wtime: 300000, btime: 300000, winc: 3000, binc: 3000, status });
http.createServer((req, res) => {
  log.push(`${req.method} ${req.url}`);
  const u = req.url;
  if (u === '/api/account') return res.end(JSON.stringify({ id: 'kingfischer', username: 'Kingfischer', title: 'BOT' }));
  if (u === '/api/stream/event') {
    events = res; res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    send(res, { type: 'challenge', challenge: { id: 'g1', rated: false, speed: 'blitz', variant: { key: 'standard' }, challenger: { name: 'tester' }, timeControl: { type: 'clock', limit: 300, increment: 3 } } });
    send(res, { type: 'challenge', challenge: { id: 'g2', rated: false, speed: 'bullet', variant: { key: 'standard' }, challenger: { name: 'speedy' }, timeControl: { type: 'clock', limit: 30, increment: 0 } } });
    return;
  }
  if (u === '/api/challenge/g1/accept') { res.end('{"ok":true}'); setTimeout(() => send(events, { type: 'gameStart', game: { gameId: 'g1' } }), 50); return; }
  if (u.startsWith('/api/challenge/g2/decline')) { let b = ''; req.on('data', d => b += d); req.on('end', () => { log.push('  body ' + b); res.end('{"ok":true}'); }); return; }
  if (u === '/api/bot/game/stream/g1') {
    game = res; res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    if (!moves.length) moves = [WHITE[0]];
    send(res, { type: 'gameFull', id: 'g1', white: { id: 'tester' }, black: { id: 'kingfischer' }, initialFen: 'startpos', state: state() });
    setTimeout(() => send(res, { type: 'chatLine', room: 'player', username: 'tester', text: '!human 1100' }), 10);
    return;
  }
  if (u.startsWith('/api/bot/game/g1/chat')) { let b = ''; req.on('data', d => b += d); req.on('end', () => { log.push('  chat ' + decodeURIComponent(b.replace(/\+/g, ' '))); res.end('{"ok":true}'); }); return; }
  const mv = u.match(/^\/api\/bot\/game\/g1\/move\/(\w+)$/);
  if (mv) {
    res.end('{"ok":true}'); moves.push(mv[1]);
    const next = WHITE[moves.length / 2];
    if (next && !dropped) { dropped = true; moves.push(next); log.push('  (game stream dropped)'); game.end(); }
    else if (next) { moves.push(next); send(game, state()); }
    else { send(game, state('resign')); game.end(); console.log(log.join('\n')); console.log('MOVES ' + moves.join(' ')); process.exit(0); }
    return;
  }
  res.writeHead(404); res.end();
}).listen(8787, '127.0.0.1', () => console.error('fake lichess on :8787'));
