# Windows GPU match runbook

Prepared for local execution, not a completed Windows/GPU benchmark. The suite repeats the five baseline matches
and adds the Leela-zero-vote control, without merging PR 3, publishing anything, or enabling Lichess.

## Prepare the machine

- **Checkout:** use `claude/test-matches` from this repository, not master while PR 3 remains unmerged.
  Use Node.js 20+ and run `npm install` then `npm test` from the repository root.
- **Engine versions:** for the closest comparison, retain Stockfish 19, Lc0 0.32.1, the same small Leela network
  (`t1-256x10-distilled-swa-2432500.pb.gz`), and the same Maia 1100/1500/1900 networks.
  Keep one thread per voice and Stockfish Hash 128. Do not upgrade the network and hardware in the same experiment.
- **GPU package:** select a Windows Lc0 package appropriate to the actual GPU. The official download page distinguishes
  NVIDIA CUDA/CUDNN packages and ONNX-DML for AMD/Intel; consult that page rather than assuming the CPU executable can use a GPU
  ([Lc0 downloads](https://lczero.org/play/download/)).
- **Backend:** explicitly select the backend for your installed build, using its `--help` output.
  Lc0 supports the `--backend` flag / `Backend` UCI option and `--backend-opts` / `BackendOptions`
  ([Lc0 backend configuration](https://lczero.org/blog/2019/04/backend-configuration/)).
- **Local config:** copy `kingfischer.config.example.json` to `kingfischer.config.json` if no local config exists.
  Set the executable paths to the Windows binaries. Relative paths are resolved from the config's folder.
  Set Leela's `options.Backend` explicitly and retain `options.Threads: 1`; choose and record Maia's backend too.
  Leave Leela enabled and omit `voteWeight` in this baseline config.

Do not use a weights/network filename bundled with a newer release as an accidental replacement. Keep any downloaded
engine DLL dependencies with its executable, and use full paths for fastchess in the commands below.

## Prove GPU use before the full run

Record the GPU model and driver, Windows version, CPU, and engine versions in a local text file.
For example, in PowerShell:

```powershell
Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion
Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors
```

Start the configured Lc0 executable interactively with the exact Leela weights and selected backend, then issue
`uci`, `isready`, `position startpos`, and `go movetime 5000`. Wait for `bestmove` before issuing `quit`.
Save the startup/backend output and search output. A detected GPU or a configured Backend field alone is not proof
that this engine actually used it; require the engine's device/backend output and observe GPU activity during search.

Next run a two-game smoke test in a separate new folder:

```powershell
node tools/match/run.mjs stockfish --config kingfischer.config.json --fastchess C:\Chess\fastchess\fastchess.exe --rounds 1 --tc 20+0.3 --out qa/gpu-smoke
```

Inspect the move JSONL: ordinary voting moves should have Stockfish, Leela and Maia reports.
Only-move/tablebase decisions can legitimately omit voices. Resolve engine failures, missing voices, illegal moves
and time forfeits before proceeding; a successful exit by itself does not prove a healthy GPU council.
Logging is currently best-effort: an append error may not fail the match. Check log coverage against the PGNs
before using agreement statistics; strict failure propagation is open work.

## Run the suite

Use an output folder that does not already exist. The cross-platform runner uses Node directly, not `sh`, and keeps
the original CPU results untouched.

```powershell
node tools/match/suite.mjs --config kingfischer.config.json --fastchess C:\Chess\fastchess\fastchess.exe --rounds 10 --tc 20+0.3 --out qa/gpu-series
```

The runner plays the five baseline matches and the Stockfish control sequentially, 20 games each.
It keeps the same ten openings, both colours, one game at a time, and the same adjudication settings.
`--dry-run` prints the commands without starting engines or creating output.

- **`baseline/`:** full-mode matches versus Stockfish and Leela, plus deterministic Seed-0 human 1100/1500/1900
  versus untimed one-node Maia. These are not sampled-human-policy tests.
- **`leela-zero/`:** full-mode versus Stockfish with Leela's vote zeroed but its search still active.
- **`*.manifest.json`:** engine/network hashes, CPU/platform, selected options, time control, book hash, code revision,
  expected/completed games, and the vote override. Backend settings describe intent; attach device logs as evidence.
- **`SUMMARY.md` and `suite.json`:** readable totals and suite completion status. The runner stops on a failed match.
- **PGN/JSONL/log files:** games, per-move votes/weights, and fastchess warnings. Keep the files together.

## Acceptance and interpretation

Require all 120 games, inspect both sides' terminations, and confirm zero-weight logs still contain Leela reports.
Keep the device proof beside the results; review local paths and personal machine details before sharing the folder.
Send the result folder back for analysis rather than editing the original CPU results.

Compare baseline and zero-vote conditions within the same machine first. CPU-to-GPU changes also alter scheduling,
inference speed and potentially engine build/backend behavior, so they do not isolate voting logic.
Twenty games per condition remain exploratory; no permanent weight change or strength claim follows automatically.
The human-mode comparisons are against deterministic one-node Maia, not evidence of a human Elo rating.
