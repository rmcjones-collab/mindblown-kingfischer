# Release log

## 0.1.5 — 2026-11-04

- Renderer licence decided by the owner: the copied MindBlown renderer (`brains/app.js`, `brains/style.css`) is GPL-3.0-or-later in this repo and its builds (CREDITS.md, bot/browser/CREDITS.md, README). The files themselves are unchanged. This closes the open item from 0.1.2.

## 0.1.4 — 2026-11-04 (CodeRabbit pass 3 fixes, not re-reviewed: 3-pass cap)

- **Desktop UCI**: a `stop` that arrives before the search has registered (same input chunk as `go infinite`, or during engine start-up) is kept and ends the search. Checked: `bestmove` after 1.3 s; a stop during a tablebase lookup gives `bestmove` after 0.6 s.
- **Council**: an abort that came before the voices were asked shortens the round, and infinite searches re-send `stop` until they end, so a search cannot run on forever.
- **Lichess**: if both move attempts fail, the bot retries after a backoff while that position is still current. Challenges are answered in the background, so a 429 pause does not delay a starting game. LICHESS.md says HTTP 400/404 refusals are not retried.
- CodeRabbit is paused on PR 1 after pass 3, so it runs no more reviews.

## 0.1.3 — 2026-11-04 (CodeRabbit pass 2 fixes)

- **Council**: a voice that fails to start is left out (only the referee is required; if it fails, the others are shut down); a search voice without a rating is rejected at start; human mode in a tablebase endgame now asks Maia and keeps the tablebase result; the referee also rates the other search voices' MultiPV lines; king-to-rook castling (`e1h1`) is accepted everywhere (`replay()`).
- **Desktop UCI**: option names are case-insensitive; a bad config is reported and `isready` is still answered; closing standard input shuts the engines down.
- **Browser**: Maia loading and inference are bounded by the move's timeout; a quick second "New game" no longer lets the first one start a King move.
- **Docs**: KING-RULES rule 5 states exactly which moves the referee rates.
- **Tests**: 38 pass. Re-checked: desktop UCI (lowercase options, bad config, e1h1, no engines left after stdin closes), fake Lichess game with a dropped stream, browser player.
- **Open (owner)**: brain citations point at this private repo's `master`, so they will not open for the public until the repo is public and merged (or the links move).

## 0.1.2 — 2026-11-04 (CodeRabbit pass 1 fixes)

- **King**: with no referee report, the explanation says no move could be safety-checked; human mode rejects a bad HumanElo or guard.
- **Council**: the only-move rule runs before the tablebase; tablebase time is tied to the budget; every search has a timeout; a failed voice or failed candidate check is left out and named; `think()` takes depth/nodes limits (they bind the referee), `searchmoves`, `go infinite` and an abort signal.
- **UCI wrapper**: engine exit, error and broken pipe reject waiting calls; a timed-out search is stopped and its late answer discarded, or the engine is killed.
- **Desktop UCI**: `go infinite`/`ponder`/`stop`/`ponderhit`, `searchmoves`, `depth`, `nodes`, `mate`; `isready` answered during search; option values checked.
- **Lichess**: event and game streams reconnect; chat never delays a move; one retry on a failed move; accepted challenges count against `maxGames`; capacity checked last. Fake server: `FAKE_DROP=1` drops the game stream once (reconnected and played on).
- **Browser**: engine calls are queued, a stuck worker is restarted, Maia loads once, and a new game clears the promotion dialog and stops thinking.
- **Brains build**: bad links, see-also targets and parents now fail the build; `created` dates are kept from the previous build; runs on Python 3.10.
- **Build**: the browser build checks for the Stockfish and ONNX runtime scripts too.
- **Tests**: `tests/council.test.js` added (fake engines). 34 tests pass with `npm test`.
- **Open (owner)**: the MindBlown renderer copied into `brains/` is not under this repo's GPL. Licence it or leave the brain pages out before any public build (CREDITS.md).

## 0.1.1 — 2026-11-04

- Licence chosen by the owner: GPL-3.0-or-later (`LICENSE`, `package.json`, README, CREDITS).
- Private preview of `dist/site` approved by the owner and deployed (`node tools/build-browser.mjs --preview`).
- Browser: the preview frame is sandboxed (origin `null`), which blocked `new Worker(url)`. Stockfish now starts from a Blob copy there, with the wasm address in the hash; normal hosts still use the URL. Checked in a sandboxed frame locally and on the preview host: 1.d4 Nf6 with reasons.
- `--preview` build option: in the built copy only, the shared renderer's saved layouts and solved riddles live in page memory, because the preview frame has no web storage. `brains/app.js` itself is unchanged.
- Long status messages now wrap instead of running off the page.
- The built site now includes LICENSE and CREDITS.md.

## 0.1.0 — 2026-11-04 (first build, private)

- **King Brain** (`king/king.js`): pure decision function with tablebase, forced-mate, weighted-vote, safety-veto and seeded human sampling rules; three modes (full, human, teach); reasons in plain language. 14 unit tests.
- **Council** (`council/`): engine-agnostic; asks all voices in parallel, has the referee re-search unrated candidates with `searchmoves`, asks the Lichess tablebase at ≤7 pieces. Node voices are UCI processes (`council/node.js`).
- **Desktop** (`bot/desktop/`): UCI engine with Mode / HumanElo / Guard / Explain / Seed / Config options and `.sh` / `.cmd` launchers. Checked: after 1.e4 e5 2.Nf3 Stockfish 19, Leela and Maia 1500 agree on Nc6.
- **Lichess** (`bot/lichess/`): Bot API client, challenge policy, chat mode commands, teach-mode chat. 9 policy tests; full game run against `tools/fake-lichess.mjs` (accepted blitz, declined bullet with `tooFast`, switched to human 1100 from chat, played 3 moves). Not yet run on lichess.org: needs the owner's BOT account.
- **Browser** (`bot/browser/`): Stockfish 19 lite + Maia ONNX + King Brain in one tab. Maia encoder matches Lc0 on 10 positions per level (1100/1500/1900), largest gap 0.06 percentage points. Playwright run: moves, all three modes, play as Black, take-back, promotion dialog, tablebase endgame, checkmate result, 375 px layout.
- **Brains** (`brains/`): King Brain (14 neurons, 33 synapses), Leela (7 / 14), Maia (6 / 11), all cited; Stockfish keeps a council seat and is not duplicated.
- **Fixes found while building**: Maia was read at Lc0's default policy temperature 1.36 (now 1); Lc0's `e1h1` castling name was not matched to `e1g1`; a hidden promotion overlay blocked board clicks; board colours were inverted.

Open: Lichess BOT account; SPRT backtest to replace the starting ratings and margins; Leela in the browser.
