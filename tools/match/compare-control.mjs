#!/usr/bin/env node
// Evidence-only comparison of matched opening/colour schedules; no causal or Elo inference.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function readGames(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n\r?\n(?=\[Event)/).filter(g => g.includes('[Result')).map(g => {
    const tag = name => g.match(new RegExp(`\\[${name} "([^"]*)"\\]`))?.[1];
    const result = tag('Result');
    if (!['1-0', '0-1', '1/2-1/2'].includes(result)) throw new Error('Incomplete/invalid result');
    if (![tag('White'), tag('Black')].includes('Kingfischer')) throw new Error('Missing Kingfischer player');
    const white = tag('White') === 'Kingfischer';
    return { fen: tag('FEN'), white, tc: tag('TimeControl'), termination: tag('Termination'),
      score: result === '1/2-1/2' ? 0.5 : Number((result === '1-0') === white) };
  });
}

export function compareControl(baselineDir, controlDir) {
  const a = readGames(path.join(baselineDir, 'stockfish.pgn'));
  const b = readGames(path.join(controlDir, 'stockfish.pgn'));
  if (!a.length || a.length !== b.length) throw new Error('Game counts do not match');
  a.forEach((g, i) => {
    if (!g.fen || g.fen !== b[i].fen || g.white !== b[i].white || !g.tc || g.tc !== b[i].tc) throw new Error(`Opening/colour/clock mismatch in game ${i + 1}`);
  });
  function summarize(dir, games, requireZero) {
    const rows = fs.readFileSync(path.join(dir, 'stockfish.moves.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(s => JSON.parse(s));
    if (!rows.length) throw new Error('Empty move log');
    if (requireZero && rows.some(r => r.weights?.leela !== 0)) throw new Error('Control did not log zero Leela weight on every move');
    const withSF = rows.filter(r => r.voices?.stockfish);
    const deviations = withSF.filter(r => r.move !== r.voices.stockfish);
    const voting = rows.filter(r => r.reason === 'vote');
    return {
      games: games.length, wins: games.filter(g => g.score === 1).length,
      draws: games.filter(g => g.score === 0.5).length, losses: games.filter(g => g.score === 0).length,
      scorePct: 100 * games.reduce((s, g) => s + g.score, 0) / games.length,
      terminations: games.reduce((s, g) => { s[g.termination || 'unspecified'] = (s[g.termination || 'unspecified'] || 0) + 1; return s; }, {}),
      loggedMoves: rows.length, movesWithStockfish: withSF.length, deviationsFromStockfish: deviations.length,
      stockfishAgreementPct: withSF.length ? 100 * (withSF.length - deviations.length) / withSF.length : null,
      votingMoves: voting.length, votingMovesMissingLeela: voting.filter(r => !r.voices?.leela).length,
      averageMoveMs: rows.reduce((s, r) => s + (r.ms || 0), 0) / rows.length,
    };
  }
  const baseline = summarize(baselineDir, a, false), control = summarize(controlDir, b, true);
  return { baseline, control, scoreDeltaPercentagePoints: control.scorePct - baseline.scorePct,
    matchedOpeningColourClock: true, interpretation: 'Descriptive comparison of sequential short runs; not a causal estimate or established rating.',
    schedule: a.map((g, i) => ({ game: i + 1, fen: g.fen, kingColour: g.white ? 'white' : 'black', baselineScore: g.score, controlScore: b[i].score })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('usage: compare-control.mjs BASELINE_DIRECTORY CONTROL_DIRECTORY');
    console.log(JSON.stringify(compareControl(process.argv[2], process.argv[3]), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
