// Load kingfischer.config.json and resolve every engine path against the config file's folder.
import fs from 'node:fs';
import path from 'node:path';

export function loadConfig(file) {
  const abs = path.resolve(file);
  const cfg = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const base = path.dirname(abs);
  const rel = p => (p && !path.isAbsolute(p) && (p.includes('/') || p.includes('\\')) ? path.join(base, p) : p);
  for (const v of cfg.voices || []) {
    v.cmd = rel(v.cmd);
    v.args = (v.args || []).map(a => a.replace(/^(--weights=)(.+)$/, (_, k, p) => k + rel(p)));
  }
  return cfg;
}

// Thinking time for one move from the UCI `go` arguments.
export function budgetFrom(go, side) {
  if (go.movetime) return go.movetime;
  const left = side === 'w' ? go.wtime : go.btime;
  const inc = (side === 'w' ? go.winc : go.binc) || 0;
  if (left == null) return 1000;
  const mtg = go.movestogo || 30;
  return Math.max(50, Math.min(left / mtg + inc * 0.8, left / 5) - 100);   // 100 ms for the council's own overhead
}
