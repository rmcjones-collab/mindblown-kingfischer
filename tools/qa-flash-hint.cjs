// MindBlown QA: a flashed warning survives zoom frames.
// A refused layout flashes "nothing changed"; a camera transition in flight (here the + zoom button) must not
// overwrite it before its 2.2 s are up, and the normal hint must come back afterwards.
// usage: node tools/qa-flash-hint.cjs http://localhost:8130/index.html  — prints `failures: []` on success
const { chromium } = require('playwright');
const url = process.argv[2] || 'http://localhost:8130/index.html';
const failures = [], check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures.push(msg); };
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const load = async () => { await p.goto(url, { waitUntil: 'load' }); await p.waitForFunction(() => window.MINDBLOWN_QA && window.MINDBLOWN_MODIFIERS && document.getElementById('loading')?.classList.contains('done'), null, { timeout: 30000 }); await p.waitForTimeout(1500); };
  await load();
  // save a layout, then make its scenario cyclic so applying it is refused with a flash
  await p.click('#save-layout'); await p.waitForTimeout(250); await p.fill('#layout-name', 'QA flash'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const ids = await p.evaluate(() => MINDBLOWN.pages.filter(x => x.parent).slice(0, 2).map(x => x.id));
  await p.evaluate(([a, c]) => { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('mindblown.layouts.')) {
    const list = JSON.parse(localStorage.getItem(k)); list[0].modifiers = { modifiers: [], edges: [{ from: a, to: c, weight: 0.5 }, { from: c, to: a, weight: 0.5 }] }; localStorage.setItem(k, JSON.stringify(list)); } } }, ids);
  await load();
  const normal = await p.textContent('#hint');
  // the zoom is measured as the screen distance between two neurons: the 0.1× readout rounds a 1.6× step away on wide networks
  const pair = await p.evaluate(() => MINDBLOWN.pages.map(x => x.id).filter(id => window.MINDBLOWN_QA.screenOf(id)).slice(0, 2));
  const span = () => p.evaluate(([a, c]) => { const s = window.MINDBLOWN_QA.screenOf(a), t = window.MINDBLOWN_QA.screenOf(c); return Math.hypot(s[0] - t[0], s[1] - t[1]); }, pair);
  const span0 = await span();
  await p.click('#save-layout'); await p.waitForTimeout(250);
  // apply (flash) and start a zoom transition in the same task, so zoom frames run while the warning shows
  // the hint is sampled in the page every 50 ms from the flash until just before its 2.2 s expiry
  const seen = await p.evaluate(() => new Promise(done => {
    const t0 = performance.now(), out = [], h = document.getElementById('hint');   // anchored before the click that flashes, so a slow click cannot stretch the window past expiry
    document.querySelector('#layouts-list .apply').click(); document.getElementById('z-in').click();
    const tick = () => { const t = performance.now() - t0; if (t > 2150) return done(out); out.push([Math.round(t), h.textContent]); setTimeout(tick, 50); };
    tick();
  }));
  const last = seen.length ? seen[seen.length - 1][0] : 0;
  check(last >= 1900 && seen.every(([, t]) => /could not be restored · nothing changed/.test(t)), `the warning holds for its whole 2.2 s, through the zoom transition (${seen.length} samples to ${last} ms: ${[...new Set(seen.map(([, t]) => t.slice(0, 40)))].join(' | ')})`);
  const span1 = await span();
  check(span1 / span0 > 1.4, `the zoom still ran while the warning showed (×${(span1 / span0).toFixed(2)})`);
  await p.waitForTimeout(700);
  const after = await p.textContent('#hint');
  // no-flash control: the same zoom from a fresh load, read after the same wait, is the normal hint expected at that level
  await load(); await p.evaluate(() => document.getElementById('z-in').click()); await p.waitForTimeout(2800);
  const control = await p.textContent('#hint');
  check(!/nothing changed/.test(control) && after === control, `the normal hint returns after the flash (${after.slice(0, 40)} | control ${control.slice(0, 40)})`);
  check(normal.length > 0, 'a normal hint was showing before');
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  console.log('failures:', JSON.stringify(failures)); await b.close(); process.exit(failures.length ? 1 : 0);
})();
