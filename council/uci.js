// A UCI engine process: start it, send commands, read `info` and `bestmove` lines.
// Used by the desktop engine and the Lichess bot (Node only; the browser council talks to Web Workers instead).
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { parseSearch } from './parse.js';

export class UciEngine {
  constructor(id, { cmd, args = [], options = {}, cwd } = {}) {
    if (!cmd) throw new Error(`engine ${id}: no command`);
    this.id = id; this.cmd = cmd; this.args = args; this.options = options; this.cwd = cwd;
    this.proc = null; this.listeners = new Set(); this.name = id; this.queue = Promise.resolve();
  }

  async start() {
    this.proc = spawn(this.cmd, this.args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.on('error', e => { for (const l of this.listeners) l(null, e); });
    this.proc.stderr.on('data', () => {});   // lc0 writes its banner to stderr
    readline.createInterface({ input: this.proc.stdout }).on('line', line => { for (const l of [...this.listeners]) l(line); });
    this.send('uci');
    await this.until(l => l === 'uciok', 30000, l => { if (l.startsWith('id name ')) this.name = l.slice(8).trim(); });
    for (const [k, v] of Object.entries(this.options)) this.send(`setoption name ${k} value ${v}`);
    await this.ready();
    return this;
  }

  send(cmd) { if (!this.proc) throw new Error(`engine ${this.id} not started`); this.proc.stdin.write(cmd + '\n'); }

  // Resolve when `done(line)` is true; `each(line)` sees every line until then.
  until(done, timeoutMs, each = () => {}) {
    return new Promise((resolve, reject) => {
      const lines = [];
      const t = setTimeout(() => { this.listeners.delete(f); reject(new Error(`engine ${this.id}: timeout`)); }, timeoutMs);
      const f = (line, err) => {
        if (err) { clearTimeout(t); this.listeners.delete(f); reject(err); return; }
        lines.push(line); each(line);
        if (done(line)) { clearTimeout(t); this.listeners.delete(f); resolve(lines); }
      };
      this.listeners.add(f);
    });
  }

  async ready() { this.send('isready'); await this.until(l => l === 'readyok', 60000); }

  // Run one search. `position` is a UCI position command body ("startpos moves e2e4" or "fen ... moves ...").
  // `go` is the go command body ("movetime 500", "nodes 1", "depth 14 searchmoves e2e4 d2d4").
  // Searches on one engine are serialised.
  search(position, go, { timeoutMs = 120000, options = {} } = {}) {
    const run = async () => {
      for (const [k, v] of Object.entries(options)) this.send(`setoption name ${k} value ${v}`);
      this.send(`position ${position}`);
      this.send(`go ${go}`);
      const lines = await this.until(l => l.startsWith('bestmove'), timeoutMs);
      return parseSearch(lines);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async newGame() { this.send('ucinewgame'); await this.ready(); }

  quit() { try { this.send('quit'); } catch { /* already gone */ } setTimeout(() => this.proc?.kill(), 500).unref?.(); }
}

export { parseSearch };
