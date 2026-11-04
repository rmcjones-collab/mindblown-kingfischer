#!/usr/bin/env bash
# Fetch the large browser assets that are not kept in git:
#   Stockfish 19 lite (npm "stockfish", GPL-3.0), onnxruntime-web (MIT), and Maia 1100/1500/1900 converted to ONNX.
# Needs npm, and engines/lc0/lc0 plus engines/nets/maia-*.pb.gz for the conversion (see docs/SETUP.md).
set -euo pipefail
cd "$(dirname "$0")/.."
B=bot/browser; T=$(mktemp -d)
( cd "$T" && npm pack stockfish@19.0.1 onnxruntime-web@1.31.1 --silent >/dev/null && for f in *.tgz; do mkdir -p "${f%.tgz}" && tar xzf "$f" -C "${f%.tgz}"; done )
mkdir -p $B/vendor/stockfish $B/vendor/ort $B/models
cp "$T"/stockfish-19.0.1/package/bin/stockfish-19-lite-single.{js,wasm} $B/vendor/stockfish/
cp "$T"/stockfish-19.0.1/package/Copying.txt $B/vendor/stockfish/COPYING.txt
cp "$T"/onnxruntime-web-1.31.1/package/dist/{ort.wasm.min.mjs,ort-wasm-simd-threaded.wasm,ort-wasm-simd-threaded.mjs} $B/vendor/ort/
for e in 1100 1500 1900; do
  engines/lc0/lc0 leela2onnx --input=engines/nets/maia-$e.pb.gz --output=$B/models/maia-$e.onnx >/dev/null 2>&1
done
rm -rf "$T"
ls -la $B/vendor/stockfish $B/vendor/ort $B/models
