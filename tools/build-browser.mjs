// Assemble the site into dist/site: the browser player at the root (index.html) and the knowledge brains under brains/.
//   node tools/build-browser.mjs        (run tools/fetch-browser-assets.sh first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist/site');
const need = ['bot/browser/vendor/stockfish/stockfish-19-lite-single.wasm', 'bot/browser/vendor/ort/ort-wasm-simd-threaded.wasm',
  'bot/browser/models/maia-1100.onnx', 'bot/browser/models/maia-1500.onnx', 'bot/browser/models/maia-1900.onnx'];
for (const f of need) if (!fs.existsSync(path.join(ROOT, f))) { console.error(`missing ${f}: run tools/fetch-browser-assets.sh`); process.exit(1); }
fs.rmSync(OUT, { recursive: true, force: true });
const copy = (rel, filter = () => true) => fs.cpSync(path.join(ROOT, rel), path.join(OUT, rel), { recursive: true, filter: s => filter(path.relative(ROOT, s)) });
copy('bot/browser');
copy('brains', f => !/\.(py|pyc)$|__pycache__|template/.test(f));
for (const f of ['council/council.js', 'council/parse.js', 'king/king.js', 'vendor/chess.js', 'vendor/chess.js.LICENSE']) if (fs.existsSync(path.join(ROOT, f))) copy(f);
// Entry page at the root: the same page with its base set to bot/browser/.
const page = fs.readFileSync(path.join(ROOT, 'bot/browser/index.html'), 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <base href="bot/browser/">');
fs.writeFileSync(path.join(OUT, 'index.html'), page);
let bytes = 0; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size; } }; walk(OUT);
console.log(`dist/site ready (${(bytes / 1048576).toFixed(1)} MB)`);
