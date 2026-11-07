#!/usr/bin/env node
// Summarise test-match results: node tools/match/summarise.mjs [resultsDir]
// Reads <match>.pgn (score, terminations) and <match>.moves.jsonl (what each voice wanted) and prints a Markdown table.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'tools/match/results';
const ORDER = ['stockfish', 'leela', 'maia1100', 'maia1500', 'maia1900'];
const matches = ORDER.filter(m => fs.existsSync(path.join(dir, `${m}.pgn`)));
if (!matches.length) { console.error(`no results in ${dir}`); process.exit(1); }

// Elo from score fraction, with the usual ±1.96 σ error bar (per-game variance; fastchess prints the pair-based one).
const elo = p => p <= 0 ? -Infinity : p >= 1 ? Infinity : -400 * Math.log10(1 / p - 1);
function pgnStats(file) {
  const text = fs.readFileSync(file, 'utf8');
  const games = text.split(/\r?\n\r?\n(?=\[Event)/).filter(g => g.includes('[Result'));
  const s = { games: 0, w: 0, d: 0, l: 0, timeLoss: 0, plies: 0, term: {} };
  for (const g of games) {
    const tag = n => g.match(new RegExp(`\\[${n} "([^"]*)"`))?.[1];
    const res = tag('Result'); if (!res || res === '*') continue;
    const kfWhite = tag('White') === 'Kingfischer';
    const kf = res === '1/2-1/2' ? 'd' : (res === '1-0') === kfWhite ? 'w' : 'l';
    s.games++; s[kf]++; s.plies += +(tag('PlyCount') || 0);
    const t = tag('Termination') || 'normal'; s.term[t] = (s.term[t] || 0) + 1;
    if (/time forfeit/i.test(t) && kf === 'l') s.timeLoss++;
  }
  const p = s.games ? (s.w + s.d / 2) / s.games : 0;
  const sd = s.games ? Math.sqrt(((s.w * (1 - p) ** 2) + (s.d * (0.5 - p) ** 2) + (s.l * p ** 2)) / s.games / s.games) : 0;
  const err = s.games && p > 0 && p < 1 ? Math.round((elo(Math.min(1, p + 1.96 * sd)) - elo(Math.max(0, p - 1.96 * sd))) / 2) : NaN;
  return { ...s, p, elo: Math.round(elo(p)), err };
}
function moveStats(file) {
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const agree = {}, reasons = {}; let ms = 0;
  for (const m of lines) {
    for (const [e, best] of Object.entries(m.voices || {})) { agree[e] ??= { n: 0, same: 0 }; agree[e].n++; if (best === m.move) agree[e].same++; }
    reasons[m.reason] = (reasons[m.reason] || 0) + 1;
    ms += m.ms || 0;
  }
  return { n: lines.length, agree, reasons, avgMs: lines.length ? Math.round(ms / lines.length) : 0 };
}

const fmt = n => Number.isFinite(n) ? (n > 0 ? `+${n}` : `${n}`) : (n > 0 ? '+∞' : '−∞');
console.log('| Match | Kingfischer | Games | W–D–L | Score | Elo diff | Avg plies | Time losses |');
console.log('|---|---|---|---|---|---|---|---|');
const names = { stockfish: 'Stockfish 19 alone', leela: 'Leela alone (CPU)', maia1100: 'Maia 1100 alone', maia1500: 'Maia 1500 alone', maia1900: 'Maia 1900 alone' };
const modes = { stockfish: 'full', leela: 'full', maia1100: 'human 1100', maia1500: 'human 1500', maia1900: 'human 1900' };
const details = [], terms = [];
for (const m of matches) {
  const s = pgnStats(path.join(dir, `${m}.pgn`));
  const mv = moveStats(path.join(dir, `${m}.moves.jsonl`));
  console.log(`| vs ${names[m]} | ${modes[m]} | ${s.games} | ${s.w}–${s.d}–${s.l} | ${(100 * s.p).toFixed(1)} % | ${Number.isFinite(s.err) ? `${fmt(s.elo)} ± ${s.err}` : 'not estimated'} | ${s.games ? Math.round(s.plies / s.games) : 0} | ${s.timeLoss} |`);
  terms.push({ m, s });
  if (mv) details.push({ m, s, mv });
}
console.log('\n| Match | King moves | Played Stockfish\'s move | Played Leela\'s move | Played Maia\'s move | Reasons | Avg ms/move |');
console.log('|---|---|---|---|---|---|---|');
for (const { m, mv } of details) {
  const pct = e => { const a = Object.entries(mv.agree).find(([k]) => k.startsWith(e))?.[1]; return a ? `${(100 * a.same / a.n).toFixed(0)} %` : '—'; };
  const reasons = Object.entries(mv.reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`| vs ${names[m]} | ${mv.n} | ${pct('stockfish')} | ${pct('leela')} | ${pct('maia')} | ${reasons} | ${mv.avgMs} |`);
}
for (const { m, s } of terms) console.log(`\nvs ${names[m]} terminations: ${Object.entries(s.term).map(([k, v]) => `${k} ${v}`).join(', ')}`);
