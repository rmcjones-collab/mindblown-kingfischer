#!/usr/bin/env node
// Deferred sibling-review follow-ups (pass 3 of the 2026-11-06 sync), on the canonical renderer:
//   Modifiers: a render that replaces the handles (an arrow-key commit mid-drag) ends the drag, and the commit's undo step puts the
//   dragged handle back where it was pressed; two concurrent drags undo one at a time, the later release first.
//   Entangler: a held pair (its partner missing on this visit) keeps both of its neurons from being measured or offered to a new pair;
//   a forget fails while localStorage is present but unreadable, so a copy it may hold can't replay later.
//   Lidar: window cards never overlap each other; with the details panel opened by the API (no click to drop the cache) they stay clear of it;
//   Home frames a moved window's rim.
// usage: node tools/qa-followups.cjs [brain-url]
const { chromium } = require('playwright');
const url = process.argv[2] || 'http://localhost:8124/index.html';
const results = [], errs = [];
const check = (ok, msg, extra) => { results.push(!!ok); console.log((ok ? 'ok   ' : 'FAIL ') + msg + (ok || extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 600))); };
const ready = p => p.waitForFunction(() => window.MINDBLOWN_ENTANGLER && window.MINDBLOWN_ENTANGLER.booted() && window.MINDBLOWN_QA && window.MINDBLOWN_RENDERER && window.MINDBLOWN_MODIFIERS, null, { timeout: 30000 });
const measureOne = p => p.evaluate(() => { const E = window.MINDBLOWN_ENTANGLER; E.setOn(true); const R = window.MINDBLOWN_RENDERER;
  for (const n of R.nodes()) { if (n.id.startsWith('entangled')) continue; try { const a = E.measure(n.id, { force: true }); if (a) return a; } catch (e) { /* next */ } } return null; });
const overlap = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

(async () => {
  const b = await chromium.launch();
  // ---------- Modifiers ----------
  { const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await c.addInitScript(() => { Element.prototype.setPointerCapture = function () {}; Element.prototype.releasePointerCapture = function () {}; });   // synthetic pointers have no capture
    const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(url); await ready(p);
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /modifier/i.test(x.getAttribute('aria-label') || x.title || '')); b.click(); });
    await p.click('#modifier-beside'); await p.click('#modifier-beside'); await p.waitForTimeout(200);
    const r = await p.evaluate(async () => {
      const M = window.MINDBLOWN_MODIFIERS, raf = () => new Promise(r => requestAnimationFrame(() => r()));
      const node = id => document.querySelector(`#modifier-overlay [data-modifier="${id}"], .modifier-node[data-modifier="${id}"]`);
      const pos = id => { const m = M.snapshot().modifiers.find(x => x.id === id); return [Math.round(m.x), Math.round(m.y)]; };
      const ev = (el, type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true }));
      const ids = M.snapshot().modifiers.map(m => m.id); if (ids.length < 2) return { err: 'need two modifiers', ids };
      const at = id => { const m = M.snapshot().modifiers.find(x => x.id === id); return window.MINDBLOWN_RENDERER.toScreen(m.x, m.y); };
      const [A, B] = ids, a0 = pos(A), b0 = pos(B), out = {};
      // 1. arrow-key commit mid-drag
      let [ax, ay] = at(A); let h = node(A); ev(h, 'pointerdown', 11, ax, ay); ev(h, 'pointermove', 11, ax + 60, ay + 40); await raf();
      out.dragsDuring = M.drags();
      h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await raf();
      out.dragsAfterCommit = M.drags();
      ev(h, 'pointerup', 11, ax + 60, ay + 40); await raf(); await raf();   // the old handle is detached; its release must change nothing
      out.afterArrow = pos(A);
      document.getElementById('modifier-undo').click(); await raf();
      out.undoArrow = pos(A); out.a0 = a0;
      // 2. two concurrent drags: A then B pressed, B released first, then A
      [ax, ay] = at(A); let [bx, by] = at(B); const hA = node(A), hB = node(B);
      ev(hA, 'pointerdown', 21, ax, ay); ev(hB, 'pointerdown', 22, bx, by);
      ev(hA, 'pointermove', 21, ax + 50, ay); ev(hB, 'pointermove', 22, bx, by + 50); await raf();
      ev(hB, 'pointerup', 22, bx, by + 50); await raf(); ev(hA, 'pointerup', 21, ax + 50, ay); await raf();
      out.moved = [pos(A), pos(B)]; out.dragsEnd = M.drags();
      document.getElementById('modifier-undo').click(); await raf(); out.undo1 = [pos(A), pos(B)];
      document.getElementById('modifier-undo').click(); await raf(); out.undo2 = [pos(A), pos(B)];
      // 3. B pressed and released where it was pressed while A is mid-drag: only A's move is a step
      const pre = JSON.stringify(M.snapshot()), n0 = M.snapshot().modifiers.length;
      [ax, ay] = at(A); [bx, by] = at(B);
      ev(hA2(), 'pointerdown', 31, ax, ay); ev(hA2(), 'pointermove', 31, ax + 40, ay + 30); await raf();
      const hb = node(B); ev(hb, 'pointerdown', 32, bx, by); ev(hb, 'pointermove', 32, bx + 30, by); ev(hb, 'pointermove', 32, bx, by); ev(hb, 'pointerup', 32, bx, by); await raf();
      ev(hA2(), 'pointerup', 31, ax + 40, ay + 30); await raf();
      document.getElementById('modifier-undo').click(); await raf(); out.noop1 = JSON.stringify(M.snapshot()) === pre;
      document.getElementById('modifier-undo').click(); await raf(); out.noop2 = JSON.stringify(M.snapshot()) !== pre || M.snapshot().modifiers.length !== n0;
      // 4. B's slider moved while A is mid-drag: the slider's step records A at its origin
      document.getElementById('modifier-redo').click(); await raf();   // part 3's second undo removed B's placement
      const gain = id => M.snapshot().modifiers.find(x => x.id === id).gain, g0 = gain(B), a1 = pos(A);
      [ax, ay] = at(A); ev(node(A), 'pointerdown', 41, ax, ay); ev(node(A), 'pointermove', 41, ax + 70, ay + 20); await raf();
      const rng = document.querySelectorAll('#modifier-list input[type=range]')[1]; rng.value = String(g0 === 1 ? 1.5 : 1); rng.dispatchEvent(new Event('input')); rng.dispatchEvent(new Event('change'));
      ev(node(A), 'pointerup', 41, ax + 70, ay + 20); await raf();
      document.getElementById('modifier-undo').click(); await raf(); out.sl1 = [pos(A), gain(B) !== g0];
      document.getElementById('modifier-undo').click(); await raf(); out.sl2 = [pos(A), gain(B) === g0]; out.a1 = a1;
      out.b0 = b0; return out;
      function hA2() { return node(A); } });
    if (r.err) check(false, 'modifier setup', r);
    else {
      const eq = (x, y) => Math.abs(x[0] - y[0]) <= 1 && Math.abs(x[1] - y[1]) <= 1;
      check(r.dragsDuring === 1 && r.dragsAfterCommit === 0, 'an arrow-key commit mid-drag ends the drag it re-rendered away', r);
      check(!eq(r.afterArrow, r.a0) && eq(r.undoArrow, r.a0), 'undoing that commit returns the handle to where the drag began', r);
      check(r.dragsEnd === 0 && !eq(r.moved[0], r.a0) && !eq(r.moved[1], r.b0), 'two concurrent drags both land', r);
      check(eq(r.undo1[0], r.a0) && eq(r.undo1[1], r.moved[1]), 'the first undo reverts only the later release (A)', r);
      check(eq(r.undo2[0], r.a0) && eq(r.undo2[1], r.b0), 'the second undo reverts the earlier release (B)', r);
      check(eq(r.sl1[0], r.a1) && r.sl1[1] && eq(r.sl2[0], r.a1) && r.sl2[1], 'a slider step taken mid-drag records the dragged handle at its origin', r);
      check(r.noop1 && r.noop2, 'a handle released where it was pressed, during another drag, adds no step of its own', r);
    }
    await c.close(); }

  // ---------- Entangler: held pairs keep their claims ----------
  { const c = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await c.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(url); await ready(p);
    const reload = p.waitForEvent('load', { timeout: 30000 }).catch(() => null); const act = await measureOne(p); await reload; await ready(p);
    const staged = await p.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('mbn:entangle:rec:')); if (!k) return null;
      const rec = JSON.parse(localStorage.getItem(k)); const a = rec.journal[0]; if (!a || a.afield) return { skip: true };
      a.b = 'qa-missing-neuron'; localStorage.setItem(k, JSON.stringify(rec)); return { a: a.a }; });
    if (!staged || staged.skip) check(true, 'skip: no local pair to hold');
    else {
      await p.reload(); await ready(p); await p.waitForTimeout(400);
      const r = await p.evaluate(a => { const E = window.MINDBLOWN_ENTANGLER; E.setOn(true);
        const j = E.journal().length, again = E.measure(a, { force: true });
        const offered = window.MINDBLOWN_RENDERER.nodes().filter(n => n.id !== a).slice(0, 40).some(n => E.candidates(n.id).some(c => c.id === a));
        return { j, again: !!again, offered }; }, staged.a);
      check(r.j === 0 && !r.again, 'a neuron in a held pair is not measured again', r);
      check(!r.offered, 'a neuron in a held pair is not offered as a partner', r);
    }
    void act; await c.close(); }

  // ---------- Entangler: replayed partners afield are claimed once, whether the first pair was held or drawn ----------
  { const c = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await c.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(url); await ready(p);
    const ids = await p.evaluate(() => { const R = window.MINDBLOWN_RENDERER, E = window.MINDBLOWN_ENTANGLER;
      for (const n of R.nodes()) { const c = E.candidates(n.id).filter(x => x.kind === 'here').map(x => x.id); if (c.length >= 5) return c.slice(0, 5); } return null; });   // all five eligible (the measured neuron itself may be a hub or a parent)
    if (!ids) check(true, 'skip: not enough eligible neurons for the replay check');
    else {
      await p.evaluate(ids => { const [X, Y, Z, W, V] = ids, key = (window.MINDBLOWN && window.MINDBLOWN.brain) || location.pathname.replace(/[^a-z0-9]+/gi, '-');
        const pair = (i, a, rest) => ({ act: 'pair', i, t: 1, a, odds: 1, shared: [], terms: 0, ...rest }), far = page => ({ afield: { brain: 'qa-far', name: 'QA far', page, title: 'QA ' + page } });
        const journal = [pair(0, X, { b: Y }), pair(1, X, far('f')), pair(2, Z, far('f')), pair(3, W, far('g')), pair(4, V, far('g'))];
        localStorage.setItem('mbn:entangle:rec:' + key, JSON.stringify({ rev: Date.now(), journal, on: false })); }, ids);
      await p.reload(); await ready(p); await p.waitForTimeout(500);
      const r = await p.evaluate(() => window.MINDBLOWN_ENTANGLER.journal().map(a => a.a + '>' + (a.afield ? a.afield.page : a.b)));
      const [X, Y, , W] = ids;
      check(r.length === 2 && r.includes(X + '>' + Y) && r.includes(W + '>g'), 'a partner afield taken by a held pair (f) or a drawn one (g) is not replayed for a later pair', r);
    }
    await c.close(); }

  // ---------- Entangler: unreadable localStorage ----------
  { const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await c.addInitScript(() => { for (const f of ['getItem', 'setItem', 'removeItem']) { const o = Storage.prototype[f]; Storage.prototype[f] = function (...a) { if (String(a[0]).startsWith('mbn:entangle') && (window.__qaUnread || window.__qaUnreadRW && f !== 'removeItem')) throw new DOMException('unreadable', 'SecurityError'); return o.apply(this, a); }; } });
    const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(url); await ready(p);
    const reload = p.waitForEvent('load', { timeout: 30000 }).catch(() => null); await measureOne(p); await reload; await ready(p);
    const r = await p.evaluate(() => { const E = window.MINDBLOWN_ENTANGLER, n0 = E.journal().length, out = { n0 };
      window.name = 'someone-else'; window.__qaUnread = true; out.r1 = E.clear(); out.n1 = E.journal().length; out.name1 = window.name;
      window.name = ''; out.r2 = E.clear(); out.n2 = E.journal().length; out.name2 = window.name; window.__qaUnread = false;
      out.left = Object.keys(localStorage).filter(k => k.startsWith('mbn:entangle:rec:')).length; return out; });
    check(r.n0 >= 1 && r.r1 === false && r.n1 === r.n0 && r.name1 === 'someone-else', 'unreadable storage, no tab fallback: the forget fails and keeps the pairs', r);
    check(r.r2 === false && r.n2 === r.n0 && r.name2 === '' && r.left >= 1, 'unreadable storage, a tab-only marker: the forget fails and the tab copy is put back', r);
    // reads and writes throw but removeItem works: a failed forget must not have removed the saved keys on its way to failing
    const r3 = await p.evaluate(() => { const E = window.MINDBLOWN_ENTANGLER, before = Object.keys(localStorage).filter(k => k.startsWith('mbn:entangle')).sort().join();
      const out = {}; for (const nm of ['', 'someone-else']) { window.name = nm; window.__qaUnreadRW = true; out[nm || 'empty'] = E.clear(); window.__qaUnreadRW = false;
        out[(nm || 'empty') + 'Keys'] = Object.keys(localStorage).filter(k => k.startsWith('mbn:entangle')).sort().join() === before; }
      window.name = ''; return out; });
    check(r3.empty === false && r3.emptyKeys && r3['someone-else'] === false && r3['someone-elseKeys'], 'a forget that fails on unreadable storage leaves every saved key in place', r3);
    const ok = await p.evaluate(() => window.MINDBLOWN_ENTANGLER.clear());
    check(ok === true, 'once storage is readable again the forget succeeds', ok);
    await c.close(); }

  // ---------- Lidar cards ----------
  for (const [w, h] of [[1440, 900], [1280, 600], [844, 390], [390, 844]]) {
    const c = await b.newContext({ viewport: { width: w, height: h } }), p = await c.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(url); await ready(p); await p.waitForTimeout(400);
    await p.keyboard.press('d'); await p.waitForTimeout(2600);
    if (await p.evaluate(() => window.MINDBLOWN_QA.layout()) !== 'lidar') { check(false, `${w}x${h} D opens the Lidar layout`); await c.close(); continue; }
    let pairs = [], n = 0;
    for (let i = 0; i < 6; i++) { const cards = await p.evaluate(() => (window.MBN_LIDAR_CARDS || []).map(x => x.box)); n = Math.max(n, cards.length);
      for (let x = 0; x < cards.length; x++) for (let y = x + 1; y < cards.length; y++) if (overlap(cards[x], cards[y])) pairs.push([cards[x], cards[y]]);
      await p.waitForTimeout(200); }
    check(n > 0 && pairs.length === 0, `${w}x${h} Lidar cards (${n}) never overlap one another`, pairs.slice(0, 2));
    if (w === 1440) {
      // the details panel opened by the API, sampled inside the 200 ms chrome cache window
      const r = await p.evaluate(async () => { const raf = () => new Promise(r => requestAnimationFrame(() => r()));
        for (let i = 0; i < 20; i++) await raf();   // warm the cache
        const R = window.MINDBLOWN_RENDERER, ids = R.nodes().map(n => n.id); R.focus(ids[Math.min(3, ids.length - 1)]);
        const el = document.getElementById('panel'); await raf(); await raf(); await raf();
        if (!el || el.hidden) return { skip: true };
        const c = document.querySelector('canvas').getBoundingClientRect(), b = el.getBoundingClientRect(), pr = [b.left - c.left, b.top - c.top, b.right - c.left, b.bottom - c.top];
        return { pr, under: (window.MBN_LIDAR_CARDS || []).filter(x => x.box[0] < pr[2] && x.box[2] > pr[0] && x.box[1] < pr[3] && x.box[3] > pr[1]).map(x => x.win) }; });
      if (r.skip) check(true, 'skip: no details panel opened'); else check(r.under.length === 0, 'cards clear the details panel within a frame of it opening by API', r);
      await p.evaluate(() => document.getElementById('panel') && window.MINDBLOWN_QA && document.querySelector('#panel .close, #panel [aria-label*=lose]')?.click());
      // Home frames a moved window's rim
      const fit = await p.evaluate(async () => { const Q = window.MINDBLOWN_QA, R = window.MINDBLOWN_RENDERER; const win = Q.windows()[0]; if (!win) return null;
        const saved = Q.captureLayout('qa-fit'); saved.groups = saved.groups || {}; saved.groups[win.id] = [900, 0]; if (!Q.applyLayout(saved)) return { applied: false };
        await new Promise(r => setTimeout(r, 1500)); const g = Q.lidarGates(), gap = g.length > 1 ? g[1] - g[0] : 0, w2 = Q.windows().find(o => o.id === win.id), cam = R.camera();
        return { ox: w2.ox, rim: w2.ox + w2.R + gap * 0.45, x1: cam.bounds && cam.bounds.x1 }; });
      if (!fit || fit.applied === false) check(true, 'skip: no movable window'); else check(fit.ox === 900 && fit.x1 >= fit.rim, 'Home frames a moved window out to its rim', fit);
    }
    await c.close();
  }
  check(errs.length === 0, 'no page errors', errs);
  await b.close();
  const f = results.filter(x => !x).length; console.log(f ? `${f} FAIL of ${results.length}` : `PASS ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})();
