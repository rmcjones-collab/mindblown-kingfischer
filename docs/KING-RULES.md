# King Brain rules

The King Brain (`king/king.js`) is the last output gate. It is a pure function, `decide()`: reports in, one move and its reasons out. The three bots call it through the Council (`council/council.js`), which gathers the reports.

## Order of rules

1. **Only move.** One legal move is played without asking anyone.
2. **Tablebase.** With 7 or fewer pieces the Council asks the Lichess tablebase (2.5 s timeout). If it answers, its move is played. In human mode the King picks the most human-looking move that keeps the same result.
3. **Forced mate.** A mate found by the referee is played. Human mode only insists on short mates: mate in 1 at 1100, 2 at 1500, 3 at 1900.
4. **Weighted vote.** Each search engine gives full weight to its best move and partial weight to its other MultiPV lines, fading to zero at 0.05 expected score below its best. Engine weights come from ratings on the Elo scale (`10^((r − top)/400)`). Maia's weight is 0.15 in full and teach modes and 1 in human mode.
5. **Safety veto.** The referee (Stockfish) re-searches, with `searchmoves`, every move it has not rated yet among: each voice's best move, the other search voices' MultiPV lines, and the human voice's top 3 moves plus any at 5 % or more (at most 6 per human voice). Its own best move is searched again alongside them, so all are rated in one search. A move outside that set has no rating and cannot be played. A candidate may beat the referee's own choice only if it is within the margin:

   | Mode | 1100 | 1500 | 1900 |
   |---|---|---|---|
   | Full / teach | 0.02 | 0.02 | 0.02 |
   | Human, soft guard | 0.30 | 0.20 | 0.12 |
   | Human, strict guard | 0.12 | 0.08 | 0.05 |
   | Human, guard off | no limit | no limit | no limit |

   Margins are expected score (0–1) for the side to move, from WDL when the engine gives it, otherwise from centipawns on the Elo logistic. Moves the referee never rated cannot win. If the referee gives no report at all (it crashed or timed out), the King says so in its explanation: no move could be safety-checked, and the vote alone decides.
6. **Pick.** Full and teach play the top allowed vote. Human mode samples the allowed moves in proportion to their Maia probability with a seeded generator (mulberry32), so a game can be replayed.
7. **Explain.** First line: the move and why. Then who disagreed, the referee's rating, what was blocked. Teach mode adds each voice's score, WDL, main line and Maia's top three.

## Time and failures

The Council spends 65 % of the move budget on the first round (all voices in parallel) and 30 % on the referee's probe. `budgetFrom()` turns a clock into a budget: remaining time over 30 moves plus 80 % of the increment, capped at a fifth of the clock, minus 100 ms overhead. The tablebase gets at most 30 % of the budget (2.5 s cap), and is not asked when there is only one legal move.

Every search has a timeout (its movetime plus 5 s; 15 s for one Maia evaluation). A voice that fails or times out is left out and named in the explanation. A timed-out engine is sent `stop`, and its late answer is discarded so it cannot answer the next position. An engine that does not stop is restarted (in the browser) or killed (in Node). If the referee's check of the candidates fails, the King plays on with the ratings it has, and unrated moves stay blocked.

UCI limits (desktop): `go depth N` / `go nodes N` bind the referee. Other search voices then get one second each (`limitGo` in a voice's config overrides this), because Leela on a CPU cannot reach those depths or node counts. `go infinite` / `ponder` run until `stop`, and `searchmoves` restricts every rule above to the listed moves; the tablebase is skipped then.

## Starting assumptions

The ratings in `kingfischer.config.example.json` (Stockfish 3650, Leela 3500) and every margin above are starting values, not measurements. The next step is a backtest: Kingfischer against Stockfish alone with SPRT (fastchess or cutechess-cli), then tune.

## Reading Maia

Maia runs one node (`go nodes 1`) with `PolicyTemperature 1`. Lc0's default temperature (1.36) is tuned for search and flattens the human probabilities. Lc0 reports castling as king-takes-rook (`e1h1`); the Council converts it to UCI's `e1g1` before voting.
