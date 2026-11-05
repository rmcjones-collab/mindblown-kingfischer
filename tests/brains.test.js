// The knowledge brains: the imported Stockfish brain matches the published file, and shared neurons agree. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../brains');
const data = name => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8').replace(/^window\.\w+ = /, '').replace(/;\s*$/, ''));
const published = JSON.parse(fs.readFileSync(path.join(DIR, 'import/stockfish-public.json'), 'utf8'));
const built = data('stockfish-data.js');
const net = data('network-data.js');
const RENAMED = { 'shared/brain/stockfish-public': 'stockfish', 'shared/concept/source': 'self/source', 'shared/concept/ai-hub': 'self/hub' };
const rid = id => RENAMED[id] || id;

test('every published Stockfish page is in the built brain with the same title, text, synapses and citations', () => {
  const pages = Object.fromEntries(built.pages.map(p => [p.id, p]));
  const syn = Object.fromEntries(built.synapses.map(s => [s.id, s]));
  const pubSyn = Object.fromEntries(published.synapses.map(s => [s.id, s]));
  for (const p of published.pages) {
    const q = pages[rid(p.id)];
    assert.ok(q, `missing ${p.id}`);
    assert.equal(q.title, p.title); assert.equal(q.desc, p.desc); assert.equal(q.created, p.created);
    assert.equal(q.synapses.length, p.synapses.length, `synapse count on ${p.id}`);
    p.synapses.forEach((sid, i) => {
      const a = pubSyn[sid], b = syn[q.synapses[i].id];
      assert.equal(b.lead, a.lead); assert.equal(b.text, a.text);
      assert.deepEqual(b.cites, a.cites);
      assert.deepEqual(b.links, a.links.map(rid));
    });
  }
  assert.equal(published.pages.length, 23); assert.equal(published.synapses.length, 49);
  assert.ok(built.pages.length > 23, 'the Kingfischer pages were added');
  for (const p of built.pages) for (const s of p.synapses) assert.ok(s.cites.length > 0, `uncited ${s.id}`);
});

test('shared neurons exist in every listed brain with one title, and no id is shared by accident', () => {
  const brains = Object.fromEntries(net.brains.map(b => [b.id, data(`${b.id}-data.js`)]));
  assert.deepEqual(Object.keys(brains).sort(), ['king', 'leela', 'maia', 'stockfish']);
  const seen = {};
  for (const [bid, d] of Object.entries(brains)) for (const p of d.pages) (seen[p.id] ||= {})[bid] = p.title;
  for (const [pid, copies] of Object.entries(seen)) {
    const ids = Object.keys(copies);
    if (ids.length > 1) {
      assert.ok(net.shared[pid], `${pid} is in ${ids} but not in the network file`);
      assert.deepEqual(Object.keys(net.shared[pid]).sort(), ids.sort());
      assert.equal(new Set(Object.values(copies)).size, 1, `${pid} titles differ: ${JSON.stringify(copies)}`);
    } else assert.ok(!net.shared[pid]);
  }
  assert.deepEqual(Object.keys(net.shared).sort(), ['compare/human-moves', 'open/leela-data', 'results/tcec', 'voice/stockfish']);
  assert.ok(net.shared['voice/stockfish'].king && net.shared['voice/stockfish'].stockfish);
  assert.ok(net.shared['compare/human-moves'].maia);
  assert.ok(net.shared['open/leela-data'].leela && net.shared['results/tcec'].leela);
});

test('the committed brain files are what build_brains.py produces today', { skip: !hasPython() && 'python3 is not installed' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-brains-'));
  try {
    const r = spawnSync('python3', [path.join(DIR, 'build_brains.py'), '--out', tmp], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const strip = d => { const { built, ...rest } = d; return rest; };   // the build date is the only thing allowed to differ
    for (const name of [...net.brains.map(b => `${b.id}-data.js`), 'network-data.js', 'network-brain-data.js']) {
      const fresh = JSON.parse(fs.readFileSync(path.join(tmp, name), 'utf8').replace(/^window\.\w+ = /, '').replace(/;\s*$/, ''));
      assert.deepEqual(strip(fresh), strip(data(name)), `${name} is stale: run python3 brains/build_brains.py`);
    }
    for (const f of [...net.brains.map(b => `${b.id}.html`), 'network.html']) assert.equal(fs.readFileSync(path.join(tmp, f), 'utf8'), fs.readFileSync(path.join(DIR, f), 'utf8'), `${f} is stale`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the network brain holds every brain once, with shared neurons as single nodes and nothing dropped', () => {
  const nb = data('network-brain-data.js');
  const brains = Object.fromEntries(net.brains.map(b => [b.id, data(`${b.id}-data.js`)]));
  const shared = Object.keys(net.shared);
  assert.deepEqual(nb.brains.map(b => b.id), net.brains.map(b => b.id));
  const total = Object.values(brains).reduce((n, d) => n + d.pages.length, 0);
  const copies = shared.reduce((n, pid) => n + Object.keys(net.shared[pid]).length, 0);
  assert.equal(nb.pages.length, total - copies + shared.length, 'each shared neuron is one node');
  assert.equal(nb.synapses.length, Object.values(brains).reduce((n, d) => n + d.synapses.length, 0), 'no synapse dropped');
  const pages = Object.fromEntries(nb.pages.map(p => [p.id, p]));
  for (const pid of shared) { assert.equal(pages[pid].lobe, 'shared'); assert.deepEqual([...pages[pid].brains].sort(), Object.keys(net.shared[pid]).sort()); }
  const syn = Object.fromEntries(nb.synapses.map(s => [s.id, s])), src = new Set(nb.sources.map(s => s.id));
  for (const [bid, d] of Object.entries(brains)) for (const s of d.synapses) {
    const m = syn[`${bid}:${s.id}`];
    assert.ok(m, `missing ${bid}:${s.id}`); assert.equal(m.text, s.text); assert.ok(m.cites.length > 0 && m.cites.every(c => src.has(c)), `cites on ${m.id}`);
    assert.ok(pages[m.page] && m.links.every(t => pages[t]), `dangling page/link on ${m.id}`);
  }
  for (const l of nb.links) assert.ok(pages[l.s] && pages[l.t]);
  const urls = new Set(Object.values(brains).flatMap(d => d.sources.map(x => x.id)));
  assert.equal(nb.sources.length, urls.size, 'one source per URL'); assert.ok(nb.sources.every(x => urls.has(x.id)), 'source ids stay plain URLs');
  assert.ok(fs.readFileSync(path.join(DIR, 'king.html'), 'utf8').includes('href="network.html"'), 'brain pages link to the network');
});

function hasPython() { return spawnSync('python3', ['--version']).status === 0; }
