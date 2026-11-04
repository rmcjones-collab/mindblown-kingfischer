# Test matches — Kingfischer against each engine alone

First run, 2026-11-04, in the build sandbox (2 CPU cores, no GPU). 20 games per match (10 openings from
`tools/match/openings.epd`, both colours), 20 s + 0.3 s per game, one game at a time, through
[fastchess](https://github.com/Disservin/fastchess). Games: `tools/match/results/*.pgn`; every Kingfischer move with
what each voice wanted: `tools/match/results/*.moves.jsonl`. Reproduce with `ROUNDS=10 TC=20+0.3 sh tools/match/all.sh`, the defaults (docs/SETUP.md).

Opponents are the same binaries and networks the council uses: Stockfish 19 (1 thread, Hash 128), Lc0 0.32.1 with the
`t1-256x10-distilled` net (1 thread, CPU), and the Maia nets at one node, so Maia alone plays its most likely move.
Kingfischer runs its usual council (Stockfish 19, Leela, Maia) on the same two cores, so in the Stockfish match the
opponent has a whole core and the full clock while Kingfischer's Stockfish voice shares the machine with Leela and gets
about 65 % of the move budget before the candidate check. That handicap is built into the numbers below.

## Results

| Match | Kingfischer | Games | W–D–L | Score | Elo diff | Avg plies | Time losses |
|---|---|---|---|---|---|---|---|
| vs Stockfish 19 alone | full | 20 | 0–11–9 | 27.5 % | −168 ± 99 | 124 | 0 |
| vs Leela alone (CPU) | full | 20 | 18–2–0 | 95.0 % | +512 | 73 | 0 |
| vs Maia 1100 alone | human 1100 | 20 | 19–1–0 | 97.5 % | +636 | 60 | 0 |
| vs Maia 1500 alone | human 1500 | 20 | 20–0–0 | 100.0 % | +∞ | 79 | 0 |
| vs Maia 1900 alone | human 1900 | 20 | 18–1–1 | 92.5 % | +436 | 75 | 0 |

Elo differences are from the score with a ±1.96 σ bar where one can be computed (fastchess reports −168 ± 99 for the
Stockfish match too); 20 games is a smoke test, not a rating. Draws and resignations are adjudicated by fastchess
(resign at 8 pawns for 3 moves by both sides, draw at under 0.1 pawn for 8 moves after move 40, 200-move cap).

## What the King did

| Match | King moves | Played Stockfish's move | Played Leela's move | Played Maia's move | Reasons | Avg ms/move |
|---|---|---|---|---|---|---|
| vs Stockfish 19 alone | 1244 | 96 % | 57 % | 38 % | vote 1240, only-move 4 | 504 |
| vs Leela alone (CPU) | 725 | 97 % | 65 % | 45 % | vote 705, mate 17, only-move 3 | 581 |
| vs Maia 1100 alone | 600 | 50 % | 52 % | 89 % | human 581, mate 13, only-move 6 | 648 |
| vs Maia 1500 alone | 792 | 51 % | 56 % | 88 % | human 758, mate 27, only-move 7 | 601 |
| vs Maia 1900 alone | 753 | 54 % | 58 % | 88 % | human 728, mate 18, only-move 7 | 619 |

- **Full strength is Stockfish with a few overrides.** In the Stockfish match the King left Stockfish's first choice 54
  times in 1244 moves; 36 of those were Leela's first choice, carried by the vote. With Leela at about 20 nodes a second
  on this CPU those overrides are shallow opinions outvoting a deep one, and the match was lost 0–9 with 11 draws. The
  loss has two parts that this run cannot separate: the CPU and clock handicap, and the overrides themselves. The
  next run should add Kingfischer with Leela's weight at 0 as a control.
- **Against Leela alone on CPU the council wins 18–2–0**, which says more about Leela on a CPU than about the council.
- **Human mode beats Maia alone at every level** (57–2–1 across the three matches). Kingfischer's human mode samples
  from the same Maia net, so 88–89 % of its moves are Maia's own top choice; the difference is the rest: the sampled
  second choices stay inside the blunder guard, Stockfish's forced mates are played when they are within the level's
  reach (58 `mate` moves), and the losing side of a Maia-vs-Maia game is never rescued. A deterministic one-node Maia
  is also a weaker opponent than Maia's own rating suggests: it never varies and walks into the same tactics.
- **No time losses at 20+0.3.** At 10+0.1 the first attempt lost on time: the council's fixed cost per move (Leela's
  reply, Maia's single node, the candidate re-search) is 180–250 ms on this machine, more than the increment. Budget
  handling should drop the candidate check and Leela when the clock is short; logged as open work.
- fastchess warned 27 times that Kingfischer sent no `info score` line: those are tablebase, only-move and mate moves
  where the referee has no line for the move played. Harmless for play; adjudication uses the opponent's score then.

## Open

- Control match: Kingfischer with Leela's vote weight 0 against Stockfish alone, same conditions, to measure the overrides.
- Same matches on the Windows GPU desktop, where Leela is a real voice and Maia costs nothing.
- Short-clock budget: skip the candidate check and the slowest voice when the remaining time is under about two seconds.
- More games (SPRT) before any rating or margin in `kingfischer.config.json` is changed.
