# Release log

## 0.1.0 — 2026-11-04 (first build, private)

- **King Brain** (`king/king.js`): pure decision function with tablebase, forced-mate, weighted-vote, safety-veto and seeded human sampling rules; three modes (full, human, teach); reasons in plain language. 14 unit tests.
- **Council** (`council/`): engine-agnostic; asks all voices in parallel, has the referee re-search unrated candidates with `searchmoves`, asks the Lichess tablebase at ≤7 pieces. Node voices are UCI processes (`council/node.js`).
- **Desktop** (`bot/desktop/`): UCI engine with Mode / HumanElo / Guard / Explain / Seed / Config options and `.sh` / `.cmd` launchers. Checked: after 1.e4 e5 2.Nf3 Stockfish 19, Leela and Maia 1500 agree on Nc6.
- **Lichess** (`bot/lichess/`): Bot API client, challenge policy, chat mode commands, teach-mode chat. 9 policy tests; full game run against `tools/fake-lichess.mjs` (accepted blitz, declined bullet with `tooFast`, switched to human 1100 from chat, played 3 moves). Not yet run on lichess.org: needs the owner's BOT account.
- **Browser** (`bot/browser/`): Stockfish 19 lite + Maia ONNX + King Brain in one tab. Maia encoder matches Lc0 on 10 positions per level (1100/1500/1900), largest gap 0.06 percentage points. Playwright run: moves, all three modes, play as Black, take-back, promotion dialog, tablebase endgame, checkmate result, 375 px layout.
- **Brains** (`brains/`): King Brain (14 neurons, 33 synapses), Leela (7 / 14), Maia (6 / 11), all cited; Stockfish keeps a council seat and is not duplicated.
- **Fixes found while building**: Maia was read at Lc0's default policy temperature 1.36 (now 1); Lc0's `e1h1` castling name was not matched to `e1g1`; a hidden promotion overlay blocked board clicks; board colours were inverted.

Open: licence decision; Lichess BOT account; SPRT backtest to replace the starting ratings and margins; Leela in the browser.
