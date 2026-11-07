// Modifier history no-ops: a slider change that ends at its starting value, and a handle drag that returns to its start,
// must leave the scenario and both undo/redo stacks unchanged; a real slider change still adds one undo step.
// The return drag at high zoom-out is covered by qa-gate on a large brain (e.g. family-tree brain.html).
// usage: node tools/qa-modifier-history.cjs <brain-url>
const { chromium } = require('playwright');
const url = process.argv[2];
if (!url) { console.error('usage: node tools/qa-modifier-history.cjs <brain-url>'); process.exit(2); }
(async () => {
  const b = await chromium.launch({ channel: 'chromium' }); const errs = [], fails = [];
  const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.MINDBLOWN_MODIFIERS && window.MINDBLOWN_RENDERER && window.MINDBLOWN_RAIL, null, { timeout: 30000 });
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /modifier/i.test(x.getAttribute('aria-label') || x.title || '')); b.click(); });
  const snap = () => p.evaluate(() => JSON.stringify(window.MINDBLOWN_MODIFIERS.snapshot()));
  const beforePlacement = await snap();
  await p.click('#modifier-beside'); await p.waitForSelector('.modifier-card input[type=range]');
  const btns = () => p.evaluate(() => [document.getElementById('modifier-undo').disabled, document.getElementById('modifier-redo').disabled].join(','));
  const slide = vals => p.evaluate(vs => { const r = document.querySelector('.modifier-card input[type=range]'); for (const v of vs) { r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); } r.dispatchEvent(new Event('change', { bubbles: true })); }, vals);
  // give redo something to keep: a real slide, then undo it
  await slide([1.5]); const s1 = await snap(); await p.click('#modifier-undo');
  const s0 = await snap(), b0 = await btns();
  check(b0.endsWith('false'), 'redo is available after undoing a real slide (' + b0 + ')');
  await slide([1.5, 1]);   // the slider (re-rendered) ends at the starting value
  check(await snap() === s0 && await btns() === b0, 'slider back to its start keeps the scenario and redo (' + (await btns()) + ')');
  const handle = p.locator('.modifier-node').first(), box = await handle.boundingBox();
  if (!box) throw new Error('placed modifier handle is not visible');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await p.mouse.move(x, y); await p.mouse.down();
  await p.mouse.move(x + 60, y + 30, { steps: 5 });
  check(await snap() !== s0, 'handle drag changes the scenario before returning');
  await p.mouse.move(x, y, { steps: 5 }); await p.mouse.up();
  check(await snap() === s0 && await btns() === b0, 'return-to-start handle drag keeps scenario and redo');
  await p.click('#modifier-undo');   // button states can't see an extra undo entry; walk the stack instead
  check(await snap() === beforePlacement, 'undo skips the no-op slide and returns to before placement');
  await p.click('#modifier-redo');
  check(await snap() === s0 && await btns() === b0, 'redo restores the placed scenario and keeps redo of the undone slide');
  await p.click('#modifier-redo');
  check(await snap() === s1, 'remaining redo restores the original real slider change');
  await p.click('#modifier-undo');
  check(await snap() === s0, 'undo of that redo restores the placed scenario');
  await slide([1.25]);
  check(await snap() !== s0 && (await btns()) === 'false,true', 'a real slider change adds undo and clears redo');
  await p.click('#modifier-undo');
  check(await snap() === s0, 'one undo reverses the real slider change');
  await p.click('#modifier-undo');
  check(await snap() === beforePlacement, 'second undo reverses placement without an extra slider entry');
  console.log(fails.length ? 'failures: ' + JSON.stringify(fails) : 'all modifier history checks passed', errs.length ? 'errors ' + JSON.stringify(errs) : '');
  await b.close(); process.exit(fails.length || errs.length ? 1 : 0);
})();
