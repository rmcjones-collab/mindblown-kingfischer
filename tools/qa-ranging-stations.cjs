// MindBlown QA: Lidar ranging never targets a station-to-station link (stations are drawn flat, so that hit would be invisible).
// usage: node tools/qa-ranging-stations.cjs http://localhost:8124/index.html
// Fixture (in the browser only): a second page joins the hub lobe and links to the centre; it and one ordinary neighbour of the
// centre carry `scan`. Ranging must arrive at the neighbour while no ranging pulse ever arrives at (or lights) a station.
// Arrivals are read from the time-of-flight pulses themselves, captured as they are queued, so a sweep hit cannot stand in for one.
const pw = (() => {
  try { return require('playwright'); } catch {}
  const roots = [process.env.PLAYWRIGHT_ROOT, '/home/user/workspace/mindblown-demo-qa/node_modules'].filter(Boolean);
  for (const r of roots) { try { return require(require.resolve('playwright', { paths: [r] })); } catch {} }
  return require(require.resolve('playwright', { paths: [require('child_process').execSync('npm root -g').toString().trim()] }));
})();
const url = process.argv[2];
const grouped = process.argv.includes('--grouped');
const roundtrip = process.argv.includes('--roundtrip');
(async () => {
  const browser = await pw.chromium.launch(), errs = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(grouped => {
    const push = Array.prototype.push; window.__qaTof = [];
    Array.prototype.push = function (...a) { for (const x of a) if (x && x.tof === true && x.l && this !== window.__qaTof) window.__qaTof.push(x); return push.apply(this, a); };
    let v; Object.defineProperty(window, 'MINDBLOWN', { configurable: true, get: () => v, set: D => {
      v = D; if (!D || !D.pages || !D.center) return;
      const c = D.center, linked = new Set(D.links.filter(l => l.s === c || l.t === c).map(l => (l.s === c ? l.t : l.s)));
      const free = D.pages.filter(p => !p.parent && p.id !== c && p.lobe !== 'self');
      const st = free[0], nb = free.find(p => p !== st && linked.has(p.id));
      st.lobe = 'self'; st.scan = true; nb.scan = true;
      if (grouped) {
        // A composed brain's self-lobe hub is a grouped return, not the network station.
        D.brains = [{ id: 'qa-network', self: 'self', title: 'QA network' }, { id: 'qa-brain', self: 'qa-self', title: 'QA brain' }];
        D.lobes.forEach(l => { if (l.id !== 'self') l.brain = 'qa-brain'; });
        D.lobes.push({ id: 'qa-self', name: 'QA hub', color: '#abcdef', self: true, brain: 'qa-brain' });
        nb.lobe = 'qa-self'; nb.isCenter = true;
      }
      if (!linked.has(st.id)) D.links.push({ s: c, t: st.id, w: 3, kinds: ['see-also'], notes: ['qa'] });
      window.__qaRanging = { stations: grouped ? [c] : [c, st.id], target: nb.id };
    } });
  }, grouped);
  await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  if (errs.length) { console.log('fixture errors:', JSON.stringify(errs)); await browser.close(); process.exit(1); }
  await page.evaluate(() => window.MINDBLOWN_QA.setLayout('lidar')); await page.waitForTimeout(3000);
  if (roundtrip) {
    await page.evaluate(() => window.MINDBLOWN_QA.setLayout('orbit'));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.MINDBLOWN_QA.setLayout('neural'));
    await page.evaluate(() => { window.__qaTof.length = 0; });
  }
  const r = await page.evaluate(async () => {
    const Q = window.MINDBLOWN_QA, F = window.__qaRanging, arrivals = new Set(); let stationHit = 0;
    for (let i = 0; i < 80; i++) { await new Promise(res => setTimeout(res, 100)); F.stations.forEach(id => { stationHit = Math.max(stationHit, Q.hit(id)); });
      window.__qaTof.forEach(p => { if (p.back) arrivals.add((p.dir < 0 ? p.l.target : p.l.source).id); }); }   // on arrival the echo turns back, so the hit end is the one it now leaves
    return { ...F, layout: Q.layout(), stationHit, pulses: window.__qaTof.length, arrivals: [...arrivals] };
  });
  console.log(JSON.stringify(r));
  if (r.layout !== (roundtrip ? 'neural' : 'lidar')) errs.push('layout ' + r.layout);
  if (!r.arrivals.includes(r.target)) errs.push('no ranging arrival at the ordinary scan neighbour');
  if (r.arrivals.some(id => r.stations.includes(id))) errs.push('a ranging pulse arrived at a station (station-to-station link was chosen)');
  if (r.stationHit) errs.push('a station recorded a hit');
  console.log('errors:', JSON.stringify(errs)); await browser.close(); process.exit(errs.length ? 1 : 0);
})();
