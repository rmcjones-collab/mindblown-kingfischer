// MindBlown QA: puzzle-solve focus and layout-flash visibility.
// 1. Solving a sealed synapse from its details form re-renders the panel. Keyboard focus must move to the
//    panel's close button rather than fall to <body>; a wrong answer keeps focus in the answer field, and a
//    solve made while focus is outside the panel (the QA hook) must not pull focus into it.
// 2. A non-silent layout change flashes its layout message. The message must stay visible (not be replaced
//    by the normal hint in the same action), then the normal hint must return once the 2.2 s flash ends.
// A brain without puzzles gets one injected into its first synapse, so the check runs on every renderer copy.
// usage: node tools/qa-canonical-minors.cjs http://127.0.0.1:8130/index.html  — prints `failures: []` on success
const pw = (() => {
  try { return require('playwright'); } catch {}
  const roots = [process.env.PLAYWRIGHT_ROOT, '/home/user/workspace/mindblown-demo-qa/node_modules'].filter(Boolean);
  for (const r of roots) { try { return require(require.resolve('playwright', { paths: [r] })); } catch {} }
  return require(require.resolve('playwright', { paths: [require('child_process').execSync('npm root -g').toString().trim()] }));
})();
const url = process.argv[2];
if (!url) { console.error('usage: node tools/qa-canonical-minors.cjs <url>'); process.exit(2); }
const failures = [], check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures.push(msg); };
const ANSWER = 'qa open sesame';
(async () => {
  const b = await pw.chromium.launch(), errors = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  // Seal the first synapse only when the brain has no puzzle of its own; runs before the renderer reads the data.
  await ctx.addInitScript(answer => {
    let D;
    Object.defineProperty(window, 'MINDBLOWN', { configurable: true, get: () => D, set: v => {
      D = v;
      if (v && Array.isArray(v.synapses) && v.synapses.length && !v.synapses.some(s => s.puzzle)) v.synapses[0].puzzle = { q: 'QA sealed prompt', a: answer, hint: 'QA hint' };
    } });
    try { sessionStorage.clear(); } catch { /* storage may be unavailable */ }
  }, ANSWER);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(url, { waitUntil: 'load', timeout: 120000 });
  await p.waitForFunction(() => window.MINDBLOWN_QA && document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
  await p.waitForTimeout(1500);

  // ---------- 1. puzzle-solve focus ----------
  const target = await p.evaluate(answer => {
    const s = window.MINDBLOWN.synapses.find(x => x.puzzle && (x.puzzle.a === answer || window.MINDBLOWN_QA.sealed().includes(x.id)));
    const pg = s && window.MINDBLOWN.pages.find(x => x.id === s.page);
    return s && pg ? { id: s.id, title: pg.title, injected: s.puzzle.a === answer } : null;
  }, ANSWER);
  check(!!target, 'a sealed synapse is available');
  if (target) {
    await p.fill('#q', target.title); await p.waitForTimeout(400); await p.keyboard.press('Enter'); await p.waitForTimeout(2600);
    const sealedEntry = p.locator(`.panel .syn.sealed[data-id="${target.id}"]`);
    check(await sealedEntry.count() === 1, 'the page panel lists the sealed entry');
    await sealedEntry.click(); await p.waitForTimeout(1200);
    const input = p.locator('form.puzzle input');
    check(await input.count() === 1, 'the synapse panel shows the answer form');
    await input.focus();
    await input.fill('definitely not the answer'); await input.press('Enter'); await p.waitForTimeout(300);
    check(await p.evaluate(() => document.activeElement?.matches('form.puzzle input')), 'a wrong answer keeps focus in the answer field');
    if (target.injected) {
      await input.fill(ANSWER); await input.press('Enter'); await p.waitForTimeout(400);
      const after = await p.evaluate(id => ({ solved: !window.MINDBLOWN_QA.sealed().includes(id), panel: !document.getElementById('panel').hidden,
        form: !!document.querySelector('form.puzzle'), active: document.activeElement?.id || document.activeElement?.tagName }), target.id);
      check(after.solved && after.panel && !after.form, `the right answer unfolds the synapse in an open panel (${JSON.stringify(after)})`);
      check(after.active === 'panel-close', `focus moves to the panel close button, not the page body (active: ${after.active})`);
      await p.keyboard.press('Enter'); await p.waitForTimeout(300);
      check(await p.evaluate(() => document.getElementById('panel').hidden), 'Enter on the focused close button closes the details');
    } else console.log('SKIP right-answer focus: authored puzzle answers are not known to this test');
    // A solve outside the form (focus elsewhere) must not steal focus.
    await p.reload({ waitUntil: 'load', timeout: 120000 });
    await p.waitForFunction(() => window.MINDBLOWN_QA && document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120000 });
    await p.waitForTimeout(800);
    await p.focus('#q');
    if (target.injected) {
      await p.evaluate(([id, a]) => window.MINDBLOWN_QA.solve(id, a), [target.id, ANSWER]);
      check(await p.evaluate(() => document.activeElement?.id) === 'q', 'a solve made with focus outside the panel leaves focus where it was');
    }
  }

  // ---------- 2. layout-flash visibility ----------
  await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement?.blur()); await p.waitForTimeout(300);
  const start = await p.evaluate(() => window.MINDBLOWN_QA.layout());
  const expectFlash = start === 'genome' ? 'neural layout' : 'genome layout';   // G toggles genome on, or off again from genome
  if (process.env.QA_TRACE) await p.evaluate(() => { const h = document.getElementById('hint'), d = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent'), t0 = performance.now(); window.__hintLog = [];
    Object.defineProperty(h, 'textContent', { configurable: true, get() { return d.get.call(this); }, set(v) { window.__hintLog.push([Math.round(performance.now() - t0), v.slice(0, 40), new Error().stack.split('\n').slice(2, 7).map(x => x.trim()).join(' < ')]); d.set.call(this, v); } }); });
  // Sample on the page's own clock from the keydown, so a slow or loaded machine cannot stretch the 1.5 s window past the 2.2 s flash.
  await p.evaluate(() => { window.__gDown = null; addEventListener('keydown', e => { if (e.key.toLowerCase() === 'g' && window.__gDown === null) window.__gDown = performance.now(); }, { capture: true }); });
  await p.keyboard.press('G');
  const seen = await p.evaluate(() => new Promise(resolve => { const out = [], h = document.getElementById('hint');
    const tick = () => { const dt = performance.now() - window.__gDown; if (dt > 1500) return resolve(out); out.push(h.textContent); setTimeout(tick, 100); }; tick(); }));
  check(seen.length >= 8, `the hint was sampled through the window (${seen.length} samples)`);
  const changed = await p.evaluate(s => window.MINDBLOWN_QA.layout() !== s, start);
  check(changed, `the layout key changed the layout (${start} → ${await p.evaluate(() => window.MINDBLOWN_QA.layout())})`);
  if (process.env.QA_TRACE) console.log(JSON.stringify(await p.evaluate(() => window.__hintLog), null, 1));
  await p.waitForTimeout(1600);
  const restored = await p.textContent('#hint');
  // The flash text must differ from the layout's normal hint, so an immediate updateHint() cannot pass this check.
  check(seen.every(t => t === seen[0] && t.startsWith(expectFlash)) && seen[0] !== restored,
    `the layout flash, not the normal hint, stays visible for 1.5 s (${[...new Set(seen.map(t => t.slice(0, 60)))].join(' | ')})`);
  check(restored.length > 0 && restored !== seen[0], `the normal hint returns after the flash (${restored.slice(0, 60)})`);
  // A silent change (the boot/saved-layout path) has no flash and refreshes the hint at once: toggle back silently via the hash restore path.
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  console.log('failures:', JSON.stringify(failures)); await b.close(); process.exit(failures.length ? 1 : 0);
})();
