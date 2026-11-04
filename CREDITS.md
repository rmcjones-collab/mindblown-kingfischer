# Credits and licences

Kingfischer is licensed GPL-3.0-or-later (see LICENSE). It uses:

| Part | Where | Licence |
|---|---|---|
| Stockfish 19 | native binary (desktop, Lichess); stockfish.js 19.0.1 lite WebAssembly (browser) — https://github.com/official-stockfish/Stockfish, https://github.com/nmrugg/stockfish.js | GPL-3.0 |
| Lc0 (Leela Chess Zero) v0.32.1 | native binary running Leela and Maia — https://github.com/LeelaChessZero/lc0 | GPL-3.0-or-later |
| Leela network t1-256x10-distilled | https://lczero.org/play/networks/bestnets/ | GPL-3.0 (LCZero networks) |
| Maia 1100–1900 | networks, and ONNX conversions of them in the browser — https://github.com/CSSLab/maia-chess | GPL-3.0 |
| Lc0 input encoding and policy map | ported to JavaScript in `bot/browser/maia.js`, `bot/browser/policy-index.js` — `src/neural/encoder.cc`, `lczero-training/tf/policy_index.py` | GPL-3.0 |
| onnxruntime-web 1.31.1 | browser neural-network runtime — https://github.com/microsoft/onnxruntime | MIT |
| chess.js 1.4.0 | `vendor/chess.js` — https://github.com/jhlywa/chess.js | BSD-2-Clause |
| cburnett chess pieces | `bot/browser/pieces/` — Colin M.L. Burnett, via Lichess | GPL-2.0-or-later |
| Lichess tablebase and Bot API | network services — https://lichess.org/api | Lichess terms |
| MindBlown renderer (`brains/app.js`, `brains/style.css`) | copied unchanged from the private `rmcjones-collab/mindblown` repo | owner's |

Whoever distributes a build (including the browser player) must offer the corresponding source under GPL-3.0.
