#!/usr/bin/env sh
# Run every test match in sequence (one at a time: the sandbox has two cores). Detach it; it takes an hour or more.
#   FASTCHESS=/path/to/fastchess ROUNDS=12 sh tools/match/all.sh
cd "$(dirname "$0")/../.." || exit 1
for m in stockfish leela maia1100 maia1500 maia1900; do
  node tools/match/run.mjs "$m" --rounds "${ROUNDS:-12}" --tc "${TC:-10+0.1}" --fastchess "${FASTCHESS:-fastchess}" --out "${OUT:-tools/match/results}" || exit $?
done
node tools/match/summarise.mjs "${OUT:-tools/match/results}"
