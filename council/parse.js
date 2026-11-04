// Parse UCI search output. Shared by the Node engines (council/uci.js) and the browser Stockfish worker.

// Parse a search transcript: the last `info` line per multipv, `bestmove`, and lc0 VerboseMoveStats policy if present.
export function parseSearch(lines) {
  const byPv = new Map(); let bestmove = null; const policy = {};
  for (const line of lines) {
    if (line.startsWith('bestmove')) { bestmove = line.split(/\s+/)[1]; if (bestmove === '(none)' || bestmove === '0000') bestmove = null; continue; }
    if (line.startsWith('info string ')) {
      // lc0: "info string e7e5  (322 ) N: ... (P: 36.67%) ..."
      const m = line.match(/^info string (\S+)\s+\(\s*\d+\s*\).*?\(P:\s*([\d.]+)%\)/);
      if (m && m[1] !== 'node') policy[m[1]] = parseFloat(m[2]) / 100;
      continue;
    }
    if (!line.startsWith('info ') || !line.includes(' pv ')) continue;
    const tok = line.split(/\s+/); const L = {}; let mpv = 1;
    for (let i = 1; i < tok.length; i++) {
      const t = tok[i];
      if (t === 'multipv') mpv = +tok[++i];
      else if (t === 'depth') L.depth = +tok[++i];
      else if (t === 'nodes') L.nodes = +tok[++i];
      else if (t === 'score') { const k = tok[++i]; const v = +tok[++i]; if (k === 'cp') L.cp = v; else if (k === 'mate') L.mate = v; if (tok[i + 1] === 'lowerbound' || tok[i + 1] === 'upperbound') { L.bound = tok[i + 1]; i++; } }
      else if (t === 'wdl') { L.wdl = [+tok[i + 1], +tok[i + 2], +tok[i + 3]]; i += 3; }
      else if (t === 'pv') { L.pv = tok.slice(i + 1); L.move = L.pv[0]; break; }
    }
    if (L.move && !L.bound) byPv.set(mpv, L);
  }
  const lines_ = [...byPv.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
  return { bestmove, lines: lines_, policy: Object.keys(policy).length ? policy : null };
}
