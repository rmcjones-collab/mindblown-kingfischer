# Kingfischer

A chess player built as a council. Stockfish 19, Leela (Lc0) and Maia each give their view of a position; the **King Brain** is the last gate and decides the move, with reasons. Part of MindBlown: the knowledge brains in `brains/` explain the King, Leela and Maia (the Stockfish brain lives in its own repo).

## Three bots, one King

| Bot | Run | Voices |
|---|---|---|
| Desktop (UCI engine for Arena, Cute Chess, Nibbler, En Croissant…) | `bot/desktop/kingfischer.sh` / `.cmd` | Stockfish 19, Leela, Maia 1100/1500/1900 |
| Lichess bot | `node bot/lichess/bot.js` — see [docs/LICHESS.md](docs/LICHESS.md) | same |
| Browser (one page, no server) | `node tools/build-browser.mjs`, serve `dist/site` | Stockfish 19 lite (WebAssembly), Maia 1100/1500/1900 (ONNX); no Leela |

Modes: **full** (strongest), **human** (plays like a 1100/1500/1900 player, guarded against blunders), **teach** (full strength, explains every move). Rules, margins and weights: [docs/KING-RULES.md](docs/KING-RULES.md).

## Layout

- `king/king.js`: the King Brain, a pure `decide()` function.
- `council/`: gathers the voices (engine-agnostic), UCI process wrapper, config loading.
- `bot/desktop`, `bot/lichess`, `bot/browser`: the three front ends.
- `brains/`: cited MindBlown knowledge brains (`python3 brains/build_brains.py`).
- `tools/`: browser build, asset fetch, Maia encoder check, fake Lichess server.

## Setup and tests

[docs/SETUP.md](docs/SETUP.md). In short: put engines under `engines/`, copy `kingfischer.config.example.json` to `kingfischer.config.json`, then `npm test` and `node tools/validate-maia.mjs`.

## Limits

- Ratings and margins are starting assumptions; no SPRT match against Stockfish alone has been run yet.
- Leela on CPU is slow (about 22 nodes/s with the small network here), so on CPU its vote is shallow. A GPU makes it a real voice.
- The browser bot has no Leela.
- The Lichess bot is tested against a fake server only until the owner creates a BOT account.

## Licence

GPL-3.0-or-later ([LICENSE](LICENSE)), the same family as Stockfish, Lc0 and Maia, so every build can be shared with its source. The repo stays private until the owner decides to publish. Credits: [CREDITS.md](CREDITS.md). Log: [docs/LOG.md](docs/LOG.md).
