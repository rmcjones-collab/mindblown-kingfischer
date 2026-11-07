// MindBlown QA: after a keyboard-started Randonaut journey, focus moves to the details close button (#panel-close),
// unless the user deliberately focused something else while the journey was pending.
// usage: node tools/qa-journey-focus.cjs http://localhost:8124/index.html
const pw = (() => {
  try { return require('playwright'); } catch {}
  const roots = [process.env.PLAYWRIGHT_ROOT, '/home/user/workspace/mindblown-demo-qa/node_modules'].filter(Boolean);
  for (const r of roots) { try { return require(require.resolve('playwright', { paths: [r] })); } catch {} }
  return require(require.resolve('playwright', { paths: [require('child_process').execSync('npm root -g').toString().trim()] }));
})();
const url = process.argv[2];
const modes = ['generate', 'moved-away', 'replaced-lobe', 'hidden-dock', 'visible-dock', 'fixed-dock'];
const onlyMode = process.argv.find(a => a.startsWith('--mode='))?.slice(7);
if (onlyMode && !modes.includes(onlyMode)) { console.error('Unknown focus mode:', onlyMode); process.exit(2); }
if (!/^https?:\/\//.test(url || '')) { console.error('Usage: node qa-journey-focus.cjs <http(s) URL>'); process.exit(2); }
(async () => {
  const b = await pw.chromium.launch(); let fail = 0;
  try {
  const context = await b.newContext();
  // Keep the browser's asset cache, but reset persisted UI state for every case.
  await context.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  for (const [w, h] of [[1440, 900], [390, 844], [375, 667]]) for (const mode of onlyMode ? [onlyMode] : modes) {
    const tag = `${w}x${h} ${mode}`;
    const p = await context.newPage(), errs = [];
    await p.setViewportSize({ width: w, height: h });
    p.on('pageerror', e => errs.push(e.message));
    try {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForFunction(() => (!document.getElementById('loading') || document.getElementById('loading').classList.contains('done')) && document.getElementById('mb-rando-dock'), null, { timeout: 60000 });
      await p.waitForTimeout(800);
      await p.evaluate(() => document.getElementById('mb-rando-dock').click());
      await p.locator('#mb-rando-panel').waitFor({ state: 'visible', timeout: 3000 });
      await p.locator('#mb-rando-toggle').focus(); await p.keyboard.press('Enter');
      // Keep the production 220 ms pending window; perform the focus transition in
      // the same browser task so a slow CI runner cannot accidentally miss it.
      await p.evaluate(mode => {
        const gen = document.getElementById('mb-rando-generate');
        const dock = document.getElementById('mb-rando-dock');
        if (mode.endsWith('dock')) {
          const adapter = window.MINDBLOWN_RANDONAUT_ADAPTER;
          window.MINDBLOWN_RANDONAUT_ADAPTER = { ...adapter, navigate(id) {
            if (mode !== 'hidden-dock') {
              dock.style.setProperty('display', 'block', 'important');
              dock.style.setProperty('visibility', 'visible', 'important');
              if (mode === 'fixed-dock') dock.style.setProperty('position', 'fixed', 'important');
            }
            const result = adapter.navigate(id);
            if (mode === 'hidden-dock') dock.style.setProperty('visibility', 'hidden', 'important');
            return result;
          } };
          // A changed adapter resets the session. Install before enabling below.
          dock.click(); dock.click();
          if (!window.MB_RANDONAUT.enabled) document.getElementById('mb-rando-toggle').click();
        }
        gen.focus(); gen.click();
        if (mode === 'moved-away') document.getElementById('q').focus();
        if (mode === 'replaced-lobe') {
          document.getElementById('lobes').classList.add('open');
          const lobe = [...document.querySelectorAll('#lobe-list button, .mbar-row.lobes button')].find(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
          if (!lobe) throw new Error('missing lobe button');
          lobe.focus();
          if (document.activeElement !== lobe) throw new Error('lobe fixture did not receive focus');
          lobe.replaceWith(lobe.cloneNode(true));
        }
        if (mode.endsWith('dock')) dock.focus();
      }, mode);
      await p.waitForFunction(() => /Arrived|could not|cancelled|changed|No other/.test(document.getElementById('mb-rando-status').textContent), null, { timeout: 4000 });
      await p.waitForTimeout(300);
      const s = await p.evaluate(() => ({ status: document.getElementById('mb-rando-status').textContent, active: document.activeElement?.id || document.activeElement?.tagName, details: !document.getElementById('panel').hidden }));
      if (!/Arrived/.test(s.status)) throw new Error('journey did not arrive: ' + s.status);
      if (mode === 'generate' && !s.details) throw new Error('arrival did not open the details panel');
      const want = mode === 'moved-away' ? 'q' : mode === 'replaced-lobe' ? 'BODY' : ['visible-dock', 'fixed-dock'].includes(mode) ? 'mb-rando-dock' : s.details ? 'panel-close' : 'mb-rando-dock';
      if (s.active !== want) throw new Error(`focus on ${s.active}, expected ${want}`);
      if (mode === 'generate' && s.details) {
        await p.locator('#panel-close').focus(); await p.keyboard.press('Enter');
        const closed = await p.evaluate(() => document.getElementById('panel').hidden && document.activeElement === document.getElementById('q'));
        if (!closed) throw new Error('closing details did not return focus to search');
      }
      if (errs.length) throw new Error(errs.join(' | '));
      console.log('PASS', tag, 'focus ->', s.active);
    } catch (e) { fail++; console.log('FAIL', tag, String(e.message).split('\n')[0]); } finally { await p.close(); }
  }
  process.exitCode = fail ? 1 : 0;
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
