// The Council in Node: every voice is a UCI engine process.
import { Council } from './council.js';
import { UciEngine } from './uci.js';

export function nodeCouncil(cfg) {
  return new Council(cfg, { makeEngine: v => new UciEngine(v.id, { cmd: v.cmd, args: v.args || [], options: v.options || {}, cwd: v.cwd }) });
}
