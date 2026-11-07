# Test matches — Kingfischer against each engine alone

First run, 2026-11-04, in the build sandbox (2 CPU cores, no GPU). 20 games per match (10 openings from
`tools/match/openings.epd`, both colours), one game at a time, through
[fastchess](https://github.com/Disservin/fastchess). Games: `tools/match/results/*.pgn`; every Kingfischer move with
what each voice wanted: `tools/match/results/*.moves.jsonl`. Reproduce with `ROUNDS=10 TC=20+0.3 sh tools/match/all.sh`, the defaults (docs/SETUP.md).
Kingfischer has a 20-second clock plus 0.3 seconds per move. Stockfish and Leela opponents use the same clock;
Maia opponents use an untimed one-node limit. Human mode uses desktop Seed 0, selecting the highest-ranked allowed
move rather than randomly sampling. These 60 Maia games therefore test deterministic guarded selection.

Opponents are the same binaries and networks the council uses: Stockfish 19 (1 thread, Hash 128), Lc0 0.32.1 with the
`t1-256x10-distilled` net (1 thread, CPU), and the Maia nets at one node, so Maia alone plays its most likely move.
Kingfischer runs its usual council (Stockfish 19, Leela, Maia) on the same two cores.
All processes share the machine; no dedicated-core allocation was measured. The standalone opponent can use its
own time-management policy, while Kingfischer allocates 65 % of its calculated move budget to the initial
Stockfish search before the candidate check. The comparison therefore includes both voting and resource/time-management differences.

## Results

| Match | Kingfischer | Games | W–D–L | Score | Elo diff | Avg plies | Time losses |
|---|---|---|---|---|---|---|---|
| vs Stockfish 19 alone | full | 20 | 0–11–9 | 27.5 % | −168 ± 99 | 124 | 0 |
| vs Leela alone (CPU) | full | 20 | 18–2–0 | 95.0 % | not estimated | 73 | 0 |
| vs Maia 1100 alone | human 1100 | 20 | 19–1–0 | 97.5 % | not estimated | 60 | 0 |
| vs Maia 1500 alone | human 1500 | 20 | 20–0–0 | 100.0 % | not estimated | 79 | 0 |
| vs Maia 1900 alone | human 1900 | 20 | 18–1–1 | 92.5 % | not estimated | 75 | 0 |

The Stockfish Elo transformation uses the score with an approximate ±1.96 σ bar (fastchess reports −168 ± 99 too).
For high/perfect scores the current normal approximation fails; those estimates are withheld rather than implying certainty.
Twenty games is a smoke test, not a rating. Draws and resignations are adjudicated by fastchess
(resign at 8 pawns for 3 moves by both sides, draw at under 0.1 pawn for 8 moves after move 40, 200-move cap).

## What the King did

| Match | King moves | Played Stockfish's move | Played Leela's move | Played Maia's move | Reasons | Avg ms/move |
|---|---|---|---|---|---|---|
| vs Stockfish 19 alone | 1244 | 96 % | 57 % | 38 % | vote 1240, only-move 4 | 504 |
| vs Leela alone (CPU) | 725 | 97 % | 65 % | 45 % | vote 705, mate 17, only-move 3 | 581 |
| vs Maia 1100 alone | 600 | 50 % | 52 % | 89 % | human 581, mate 13, only-move 6 | 648 |
| vs Maia 1500 alone | 792 | 51 % | 56 % | 88 % | human 758, mate 27, only-move 7 | 601 |
| vs Maia 1900 alone | 753 | 54 % | 58 % | 88 % | human 728, mate 18, only-move 7 | 619 |

- **Full strength usually follows Stockfish.** The move log has 1244 decisions, of which 1240 include a Stockfish
  report; 54 differ from that report's first choice. Of those 54, 36 match Leela's first choice. Agreement alone
  does not establish which vote was decisive or which move caused a loss. The match finished 0 wins, 11 draws,
  9 losses. A zero-vote control retains Leela's workload while removing its direct vote.
- **Against Leela alone on CPU the council wins 18–2–0**, which says more about Leela on a CPU than about the council.
- **Human mode beat one-node Maia in these samples** (57–2–1 combined). The logs report 88–89 % agreement with Maia's
  top choice and 58 `mate` decisions. Deterministic guarded selection and mate selection are plausible contributors, but the
  individual effects were not isolated. These results do not establish a human Elo rating or prove that one-node
  Maia is systematically weaker than a particular human rating.
- **No time losses at 20+0.3.** At 10+0.1 the first attempt lost on time: the council's fixed cost per move (Leela's
  reply, Maia's single node, the candidate re-search) is 180–250 ms on this machine, more than the increment. Budget
  handling should drop the candidate check and Leela when the clock is short; logged as open work.
- fastchess logged 27 missing-score warnings. Kingfischer emits a score only when the referee has a line for the
  played move. Missing scores may affect score-based adjudication; these warnings were not mapped individually
  to move reasons, and it is not established that the opponent's score substitutes for them.

## Open

- Control match: Kingfischer with Leela's vote weight 0 against Stockfish alone, same conditions, to measure the overrides.
- Same matches on the Windows GPU desktop, where Leela is a real voice and Maia costs nothing.
- Short-clock budget: skip the candidate check and the slowest voice when the remaining time is under about two seconds.
- More games (SPRT) before any rating or margin in `kingfischer.config.json` is changed.
