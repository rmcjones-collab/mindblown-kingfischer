// The Council in the browser: Stockfish 19 (lite, single-threaded WebAssembly) in a Web Worker, Maia through
// onnxruntime-web, the Lichess tablebase over the network, and the same King Brain as the desktop and Lichess versions.
import { Council } from '../../council/council.js';
import { parseSearch } from '../../council/parse.js';
import { maiaPolicy } from './maia.js';

const HERE = new URL('.', import.meta.url);

export const BROWSER_CONFIG = {
  referee: 'stockfish',
  tablebase: true,
  voices: [
    { id: 'stockfish', role: 'search', name: 'Stockfish 19', rating: 3650, multipv: 4, kind: 'stockfish',
      options: { Hash: 32, UCI_ShowWDL: 'true' } },
    { id: 'maia1100', role: 'human', level: 1100, name: 'Maia 1100', kind: 'maia', model: 'models/maia-1100.onnx' },
    { id: 'maia1500', role: 'human', level: 1500, name: 'Maia 1500', kind: 'maia', model: 'models/maia-1500.onnx' },
    { id: 'maia1900', role: 'human', level: 1900, name: 'Maia 1900', kind: 'maia', model: 'models/maia-1900.onnx' },
  ],
};

// Stockfish as a Web Worker speaking UCI, with the same interface as the Node UciEngine.
class WorkerEngine {
  constructor(v) { this.v = v; this.name = v.name; this.listeners = new Set(); this.queue = Promise.resolve(); }
  async start() {
    this.w = new Worker(new URL('vendor/stockfish/stockfish-19-lite-single.js', HERE));
    this.w.onmessage = e => { const line = typeof e.data === 'string' ? e.data : String(e.data); for (const l of [...this.listeners]) l(line); };
    this.w.onerror = e => { for (const l of [...this.listeners]) l(null, new Error(e.message || 'Stockfish worker failed')); };
    this.send('uci'); await this.until(l => l === 'uciok', 60000, l => { if (l.startsWith('id name ')) this.name = this.v.name || l.slice(8); });
    for (const [k, val] of Object.entries(this.v.options || {})) this.send(`setoption name ${k} value ${val}`);
    await this.ready();
    return this;
  }
  send(c) { this.w.postMessage(c); }
  until(done, ms, each = () => {}) {
    return new Promise((res, rej) => {
      const lines = [];
      const t = setTimeout(() => { this.listeners.delete(f); rej(new Error('Stockfish timed out')); }, ms);
      const f = (line, err) => { if (err) { clearTimeout(t); this.listeners.delete(f); rej(err); return; } lines.push(line); each(line); if (done(line)) { clearTimeout(t); this.listeners.delete(f); res(lines); } };
      this.listeners.add(f);
    });
  }
  async ready() { this.send('isready'); await this.until(l => l === 'readyok', 60000); }
  search(position, go, { options = {}, timeoutMs = 120000 } = {}) {
    const run = async () => {
      for (const [k, val] of Object.entries(options)) this.send(`setoption name ${k} value ${val}`);
      this.send(`position ${position}`); this.send(`go ${go}`);
      return parseSearch(await this.until(l => l.startsWith('bestmove'), timeoutMs));
    };
    const p = this.queue.then(run, run); this.queue = p.catch(() => {}); return p;
  }
  async newGame() { this.send('ucinewgame'); await this.ready(); }
  stop() { this.send('stop'); }
  quit() { this.w?.terminate(); }
}

// Maia as an ONNX network. "go nodes 1" is the only search it understands: read the policy, as Lc0 does for Maia.
class MaiaEngine {
  constructor(v, ort) { this.v = v; this.ort = ort; this.name = v.name; this.session = null; }
  async start() { return this; }                       // models load on first use, so only the chosen level is downloaded
  async load() {
    if (!this.session) this.session = await this.ort.InferenceSession.create(new URL(this.v.model, HERE).href, { executionProviders: ['wasm'] });
    return this.session;
  }
  async search(position) {
    const { fen, moves } = parsePosition(position);
    const { policy } = await maiaPolicy(await this.load(), this.ort, fen, moves);
    return { bestmove: Object.keys(policy)[0] || null, lines: [], policy };
  }
  async newGame() {}
  quit() { this.session?.release?.(); }
}

export function parsePosition(p) {
  const m = p.match(/^(startpos|fen (.+?))(?: moves (.+))?$/);
  if (!m) throw new Error(`bad position: ${p}`);
  return { fen: m[2] || null, moves: m[3] ? m[3].trim().split(/\s+/) : [] };
}

/** Start the browser council. onProgress(text) reports loading steps. */
export async function browserCouncil({ onProgress = () => {}, config = BROWSER_CONFIG } = {}) {
  onProgress('Loading the neural-network runtime…');
  const ort = await import(new URL('vendor/ort/ort.wasm.min.mjs', HERE).href);
  ort.env.wasm.numThreads = 1;                         // no cross-origin isolation needed
  ort.env.wasm.wasmPaths = new URL('vendor/ort/', HERE).href;
  onProgress('Starting Stockfish 19…');
  const council = new Council(config, { makeEngine: v => v.kind === 'maia' ? new MaiaEngine(v, ort) : new WorkerEngine(v) });
  await council.start();
  council.preloadHuman = async level => {
    const v = [...council.voices.values()].find(x => x.cfg.role === 'human' && x.cfg.level === level);
    if (v) { onProgress(`Loading ${v.cfg.name}…`); await v.engine.load(); }
  };
  onProgress('Ready');
  return council;
}
