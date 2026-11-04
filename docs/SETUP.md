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
