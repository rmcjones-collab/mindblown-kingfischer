# Leela zero-vote control

Completed 2026-11-04 against standalone Stockfish 19 on the two-core Linux sandbox.
The control scored 35%, compared with 27.5% in the earlier baseline: a small descriptive improvement, not proof that
removing Leela's vote improves strength. Default weights remain unchanged.

## Results

Both conditions used 20 games, the same ten opening positions with colours swapped, and 20 seconds plus 0.3 seconds
per move. The comparison tool verifies each game's opening FEN, Kingfischer colour and time-control tag.

| Condition | Wins | Draws | Losses | Score | Agrees with Stockfish |
|---|---:|---:|---:|---:|---:|
| Original full council | 0 | 11 | 9 | 27.5% | 95.6% |
| Leela vote zero, still searching | 0 | 14 | 6 | 35.0% | 98.5% |

The difference is 1.5 points over 20 games, or 7.5 percentage points.
Neither run had a time-forfeit termination; both used score-based adjudication for some games.
This is a sequential comparison of short runs, not a randomized causal estimate or an established Elo rating.

## What changed and what stayed active

- **Vote intervention:** `--leela-weight 0` sets Leela's `voteWeight` in a temporary resolved config.
  The local config and default rating-derived weights are not changed.
- **Leela workload:** Leela remained enabled. Its report is present on all 1,165 control moves with reason `vote`,
  and every one of the 1,177 logged control decisions records a Leela weight of zero.
- **Candidate influence:** Leela still searches and supplies candidate moves for Stockfish's referee re-search.
  This is not an engine-disabled or Stockfish-only council.
- **Stockfish departures:** 54 of 1,240 decisions with a Stockfish report in the baseline, versus 17 of 1,165 in
  the control. Forced/other decisions without a Stockfish report are excluded from the agreement denominator.
- **Move time:** observed average logged think time was 504 ms in the baseline and 517 ms in the control.
  The positions differ once moves diverge, so this does not isolate overhead or explain the score difference.
- **Warnings:** the control log contains 12 missing-score warnings. They remain an adjudication-quality caveat;
  neither illegal moves nor time forfeits appear in the completed PGNs.

The runner also now forwards configured opponent UCI options, including Stockfish's `UCI_ShowWDL`.
The historical baseline lacked an engine/network hash manifest, so its binary identity cannot be retroactively
proved by hash. These are additional reasons not to present this historical comparison as a perfectly isolated experiment.

## Evidence and reproduction

The control ran from clean tracked code at commit `698f5e84f2ed6708118cbf034f47a4619615aa6e`.
Its manifest records the CPU/platform, Node version, engine and network SHA-256 hashes, opening hash, selected
options and time control. It completed all 20 expected games in about 22 minutes.

- **Baseline:** `tools/match/results/stockfish.pgn` and `stockfish.moves.jsonl`.
- **Control:** `tools/match/results/leela-zero/stockfish.pgn`, `.moves.jsonl`, `.log`, and `.manifest.json`.
- **Comparison:** `tools/match/results/leela-zero/comparison.json`, including per-game paired scores.
- **Validation:** all 40 PGNs replay legally with the repository's chess library; 50 automated tests pass.
  Maia policy validation passed all ten test positions, and the browser preview build succeeded.
  The local browser played `1. e4 e5` and displayed the King's verdict before returning the turn to the user.

Run a control in a new output folder, retaining the same config and installed engines:

```sh
node tools/match/run.mjs stockfish --config kingfischer.config.json --leela-weight 0 --rounds 10 --tc 20+0.3 --fastchess /path/to/fastchess --out qa/leela-zero-rerun
node tools/match/compare-control.mjs tools/match/results qa/leela-zero-rerun
```

## Decision and next step

Keep the default weights. The result supports further testing but does not establish that direct Leela voting caused
the original losses; the remaining Stockfish deficit may involve search-budget allocation, candidate processing,
resource contention, voting, or ordinary sample variation.

The Windows/GPU runner and [GPU runbook](GPU-MATCHES.md) are prepared but have not been executed on the user's desktop.
That suite repeats the five standalone-engine comparisons plus the zero-vote control, with fresh manifests for both
conditions. Confirm the actual GPU model/backend first and retain proof of GPU use.

PR 3 stays draft and unmerged. CodeRabbit remains paused at its existing three-pass cap; these follow-up changes were
checked locally, not submitted for a fourth automated review. Lichess remains shelved and no website was deployed.
