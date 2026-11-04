# Setup

Needs Node.js 20+. Engines and networks are not kept in git; put them under `engines/` (git-ignored).

## Engines

- **Stockfish 19**: download a release binary from `official-stockfish/Stockfish` (tag `sf_19`) into `engines/stockfish/`.
- **Lc0** (Leela and Maia both run on it): a release build, or build v0.32.1 from source. CPU build used here: `./build.sh -Dgtest=false -Dopenblas=true -Ddnnl=false -Donnx=false` (needs meson, ninja, libopenblas-dev, zlib1g-dev). Put the binary at `engines/lc0/lc0`.
- **Leela network**: one from https://lczero.org/play/networks/bestnets/ into `engines/nets/` (the example config uses `t1-256x10-distilled-swa-2432500.pb.gz`, small enough for CPU).
- **Maia**: `maia-1100.pb.gz` … `maia-1900.pb.gz` from https://github.com/CSSLab/maia-chess (`maia_weights/`) into `engines/nets/`.

Then `cp kingfischer.config.example.json kingfischer.config.json` and adjust paths, threads and hash.

## Check

```sh
npm install            # dev only: onnxruntime-node for the Maia check
npm test               # King Brain and Lichess policy unit tests
node tools/validate-maia.mjs 1500   # browser Maia encoder vs Lc0
```

## Browser build

```sh
tools/fetch-browser-assets.sh      # Stockfish 19 lite wasm, onnxruntime-web, Maia → ONNX
python3 brains/build_brains.py     # knowledge brains
node tools/build-browser.mjs       # → dist/site (player at index.html, brains under brains/)
node tools/build-browser.mjs --preview   # same, for sandboxed preview frames without web storage
```

Serve `dist/site` from any static host; no special headers are needed (single-threaded WebAssembly).

## Test matches

Kingfischer against one engine alone, through [fastchess](https://github.com/Disservin/fastchess) (build it with
`make`; no other dependency). Each match is a sequence of game pairs from `tools/match/openings.epd`, colours swapped:

```
FASTCHESS=/path/to/fastchess ROUNDS=10 TC=20+0.3 sh tools/match/all.sh     # all five matches, ~2 h on two cores
node tools/match/run.mjs stockfish --rounds 10 --tc 20+0.3 --fastchess /path/to/fastchess   # one match
node tools/match/summarise.mjs tools/match/results                           # Markdown tables
```

Matches: `stockfish` and `leela` (full strength, same clock), `maia1100` / `maia1500` / `maia1900` (human mode at that
level against the same Maia net alone at one node). Results in `tools/match/results/` and [MATCHES.md](MATCHES.md).
Run them one at a time: Kingfischer already runs Stockfish and Leela side by side.
The first 10+0.1 attempt produced a time loss; the completed 20+0.3 series did not.
Slow voice replies and candidate checks are possible contributors, but no precise safe clock threshold has been established.

For the vote-only control, keep the local config unchanged and use a separate output folder:

```sh
node tools/match/run.mjs stockfish --leela-weight 0 --rounds 10 --tc 20+0.3 --fastchess /path/to/fastchess --out tools/match/results/leela-zero
node tools/match/compare-control.mjs tools/match/results tools/match/results/leela-zero
```

`--config PATH` selects a machine-specific config for both the council and opponents. A private resolved copy
is passed to the council, and `--leela-weight 0` overrides only Leela's vote in that copy.
Leela still searches and supplies candidates; this is not a Leela-disabled benchmark.
The result manifest records engine/network hashes, options, opening hash and code revision.

For the same series plus control on Windows, use the shell-free `tools/match/suite.mjs` runner.
See [GPU-MATCHES.md](GPU-MATCHES.md) for the local hardware check and commands; Windows/GPU execution remains pending.
