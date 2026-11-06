/* MindBlown — explode the Brain into lobes, neurons and synapses. */
(() => {
  // Browser initialization is optional: Node consumers can import the sampling module below.
  if (typeof document === 'undefined') return;
  // ---------- nav: one dropdown of every brain, in the header on every page ----------
  // Source, in order: window.MINDBLOWN_NAV ([{label, href, color?, sep?}]), or an existing <nav class="brains"> of links; the current page is marked by href or .on
  (() => {
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let nav = document.querySelector('nav.brains');
    const here = location.pathname.split('/').pop() || 'index.html';
    let items = Array.isArray(window.MINDBLOWN_NAV) ? window.MINDBLOWN_NAV : null;
    // links become items; a <select> of pages (as the genome's chromosome picker) unfolds into one item per option; anything else is a separator
    const ofLink = el => ({ label: el.textContent.trim(), href: el.getAttribute('href'), color: (el.querySelector('.dot') || {}).style?.background || '', on: el.classList.contains('on') });
    if (!items && nav) items = [...nav.children].flatMap(el => el.matches('a') ? [ofLink(el)] : el.matches('select') ? [{ sep: true }, ...[...el.options].filter(o => o.value).map(o => ({ label: o.textContent.trim(), href: o.value, on: o.selected && el.classList.contains('on') }))] : [{ sep: true }]);
    if (items) items = items.filter((it, k, a) => !it.sep || (k > 0 && k < a.length - 1 && !a[k - 1].sep)); // no leading, trailing or doubled separators
    if (!items || !items.filter(i => !i.sep).length) return;
    if (!nav) { nav = document.createElement('nav'); nav.className = 'brains'; const bt = document.querySelector('.brand-text'); if (bt) bt.after(nav); else document.getElementById('top').prepend(nav); }
    nav.classList.add('dd'); nav.setAttribute('aria-label', 'Brains');
    const cur = items.find(i => !i.sep && (i.on || (i.href || '').split('/').pop().split('#')[0] === here)) || items.find(i => !i.sep);
    const dot = c => c ? `<span class="dot" style="background:${esc(c)}"></span>` : '<span class="dot none"></span>';
    nav.innerHTML = `<button class="nav-btn" aria-haspopup="menu" aria-expanded="false" title="Switch brain">${dot(cur.color)}<span class="cur">${esc(cur.label)}</span><span class="chev" aria-hidden="true">▾</span></button>
      <ul class="nav-menu" role="menu" hidden>${items.map(i => i.sep ? '<li class="sep" role="separator"></li>' : `<li role="none"><a role="menuitem" href="${esc(i.href)}"${i === cur ? ' class="on" aria-current="page"' : ''}>${dot(i.color)}<span>${esc(i.label)}</span></a></li>`).join('')}</ul>`;
    const btn = nav.querySelector('.nav-btn'), menu = nav.querySelector('.nav-menu');
    const open = o => { menu.hidden = !o; btn.setAttribute('aria-expanded', String(o)); nav.classList.toggle('open', o); if (o) { nav.classList.remove('flip'); nav.classList.toggle('flip', menu.getBoundingClientRect().right > innerWidth - 8); menu.querySelector('a.on, a')?.focus(); } };
    btn.addEventListener('click', () => open(menu.hidden));
    document.addEventListener('click', e => { if (!nav.contains(e.target)) open(false); });
    nav.addEventListener('keydown', e => {
      const links = [...menu.querySelectorAll('a')], i = links.indexOf(document.activeElement);
      if (e.key === 'Escape') { open(false); btn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (menu.hidden) open(true); else links[(i + 1) % links.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (menu.hidden) { open(true); links[links.length - 1]?.focus(); } else links[(i - 1 + links.length) % links.length]?.focus(); }
    });
  })();
  // pages without a canvas (an overview or index page) load app.js for the nav alone
  if (!document.getElementById('brain') || !window.MINDBLOWN) return;

  const D = window.MINDBLOWN;
  // optional network layer: other brains that share neuron ids with this one (see build_network.py in a network repo)
  const N = window.MINDBLOWN_NETWORK || null;
  const otherBrains = id => (N && N.shared && N.shared[id]) ? N.brains.filter(b => b.id !== D.brain && N.shared[id][b.id]).map(b => ({ ...b, ...N.shared[id][b.id] })) : [];
  const isShared = n => n.kind === 'page' && otherBrains(n.id).length > 0;
  if (D.demo) { const sub = document.querySelector('.brand .sub'); if (sub) sub.textContent = 'demo brain · fictional data'; document.title = 'MindBlown — demo brain'; }
  if (D.subtitle) { const sub = document.querySelector('.brand .sub'); if (sub) sub.textContent = D.subtitle; }
  if (D.title) { document.title = D.title; const h = document.querySelector('.brand .title'); if (h) h.textContent = D.title; }
  const canvas = document.getElementById('brain');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- model ----------
  const lobes = D.lobes;
  const lobeById = Object.fromEntries(lobes.map(l => [l.id, l]));
  // a network data file lists several brains, each with its own hub ("self") lobe; a single brain has lobe 'self' and D.center
  const brainsIn = D.brains || null;
  const selfLobe = l => !!l.self || l.id === 'self';
  const selfIds = new Set(lobes.filter(selfLobe).map(l => l.id));
  const isSelf = n => selfIds.has(n.lobe);
  const centers = new Set(D.centers || (D.center ? [D.center] : []));
  const lobeOn = Object.fromEntries(lobes.map(l => [l.id, !l.hidden]));

  const pageById = {};
  const pages = D.pages.map(p0 => { const p = { ...p0, parentId: p0.parent || null }; delete p.parent;
    const n = { ...p, kind: 'page', nSyn: p.synapses.length, deg: 0, r: 0, neighbors: [], synNodes: [], srcNodes: [], children: [], parent: null, isCenter: centers.has(p.id) };
    pageById[p.id] = n; return n;
  });
  // one level deeper: a page may name a parent neuron; it then orbits that neuron as a sub-neuron
  // only one level is allowed: a parent must itself be top-level, so chains and cycles collapse to a single hop
  pages.forEach(n => { const p = n.parentId && pageById[n.parentId]; if (p && p !== n && !p.parentId) { n.parent = p; p.children.push(n); } });
  const isChild = n => n.kind === 'page' && !!n.parent;
  const hasSubs = pages.some(isChild);
  const synById = {};
  const syns = D.synapses.map((s, i) => {
    const n = { ...s, kind: 'syn', idx: i, lobe: pageById[s.page].lobe, ordinal: pageById[s.page].synNodes.length };
    synById[s.id] = n; pageById[s.page].synNodes.push(n); return n;
  });
  const srcById = {};
  const srcs = D.sources.map(s => {
    const n = { ...s, kindOf: s.kind, kind: 'src', lobe: pageById[s.pages[0]].lobe, pageNodes: s.pages.map(p => pageById[p]) };
    srcById[s.id] = n; n.pageNodes.forEach(p => p.srcNodes.push(n)); return n;
  });

  // ---------- puzzles: solve to unfold ----------
  // A synapse may carry `puzzle: { q, a, hint? }` (a prompt, an answer pattern, an optional hint). Such a synapse is sealed: its lead and text stay
  // hidden from the map, the panel, the tooltip and search until the answer matches, and it then stays unfolded for the session (sessionStorage).
  // Brains without the field never see any of this.
  const solvedKey = 'mindblown.solved.' + (D.title || location.pathname);
  const solved = new Set((() => { try { const ss = window.sessionStorage; const v = JSON.parse(ss.getItem(solvedKey) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; } })());   // a malformed stored value must not stop the renderer
  const sealed = n => n.kind === 'syn' && !!n.puzzle && !solved.has(n.id);
  const leadOf = n => sealed(n) ? '? ' + n.puzzle.q : n.lead;                 // what the map, tooltip and search may show
  const textOf = n => sealed(n) ? 'Sealed · solve to unfold' : n.text;
  const normAns = t => String(t).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}.,]+/gu, ' ').trim();
  function answerOk(n, text) {
    let re = null; try { re = new RegExp('^(?:' + n.puzzle.a + ')$', 'iu'); } catch { re = null; }   // the pattern is authored; a broken one falls back to a plain comparison
    return re ? re.test(normAns(text)) || re.test(String(text).trim()) : normAns(n.puzzle.a) === normAns(text);
  }
  let unfolding = null;   // { n, t0 } for the unfold ring drawn on a just-solved synapse
  function solve(n, text) {
    if (!sealed(n) || !answerOk(n, text)) return false;
    solved.add(n.id); try { const ss = window.sessionStorage; ss.setItem(solvedKey, JSON.stringify([...solved])); } catch { /* storage may be unavailable; the session still unfolds */ }
    unfolding = { n, t0: performance.now() }; pulseSyn = n; updateStats();
    if (selected && (selected === n || selected.id === n.page)) renderPanel(selected);
    return true;
  }

  const pageLinks = D.links.map(l => ({ source: pageById[l.s], target: pageById[l.t], w: l.w, kinds: l.kinds, notes: l.notes, kind: 'pp' }));
  pageLinks.forEach(l => {
    l.source.deg += l.w; l.target.deg += l.w;
    l.source.neighbors.push({ n: l.target, l }); l.target.neighbors.push({ n: l.source, l });
  });
  const synTethers = syns.map(s => ({ source: s, target: pageById[s.page], kind: 'st' }));
  const synCross = D.synLinks.map(l => ({ source: synById[l.s], target: pageById[l.t], kind: 'sx' }));
  const srcTethers = [];
  srcs.forEach(s => s.pageNodes.forEach(p => srcTethers.push({ source: s, target: p, kind: 'sr' })));
  const cociteLinks = D.cocite.map(l => ({ source: pageById[l.s], target: pageById[l.t], w: l.w, kind: 'cc' }));
  const childTethers = pages.filter(isChild).map(c => ({ source: c, target: c.parent, kind: 'pc' }));
  pages.forEach(p => { p.r = p.isCenter ? 16 : isChild(p) ? 3.6 + Math.sqrt(p.nSyn) * 0.9 : 5.5 + Math.sqrt(p.nSyn) * 1.25 + Math.min(p.deg, 12) * 0.25; p.spin = Math.random() * Math.PI * 2; });
  pages.forEach(p => { if (p.children.length) p.r += Math.min(p.children.length, 6) * 0.6; });
  const orbitR = p => 16 + p.nSyn * 1.7;
  // radius of the ring a parent's sub-neurons sit on once unfolded
  const childRingR = p => p.r + 42 + Math.sqrt(p.children.length) * 16 + explodeF * (orbitR(p) * 0.6);

  // lobe anchors: one brain puts its hub in the middle and its lobes on a ring around it.
  // A network puts each brain's hub on a big circle, that brain's lobes on an outward-facing arc around its hub,
  // and the shared lobes (same neuron ids in every brain) in the middle where all the brains can reach them.
  const anchor = {};
  const hubOf = {};   // lobe id → the point its halo label faces away from
  const lobeCount = {}; pages.forEach(p => { lobeCount[p.lobe] = (lobeCount[p.lobe] || 0) + 1; });
  function arcAnchors(ids, cx, cy, R, start, sweep) {
    const span = ids.map(id => Math.sqrt(lobeCount[id] || 1) + 2.6), total = d3.sum(span);
    let acc = start;
    ids.forEach((id, i) => { const a = acc + (span[i] / total) * sweep / 2; acc += (span[i] / total) * sweep; anchor[id] = { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }; hubOf[id] = { x: cx, y: cy }; });
  }
  if (!brainsIn) {
    anchor.self = { x: 0, y: 0 };
    const ring = lobes.filter(l => !selfLobe(l)).map(l => l.id);
    const span0 = Math.sqrt(lobeCount[ring[0]] || 1) + 2.6, total = d3.sum(ring.map(id => Math.sqrt(lobeCount[id] || 1) + 2.6));
    arcAnchors(ring, 0, 0, 760, -Math.PI / 2 - (span0 / total) * Math.PI, Math.PI * 2);
  } else {
    const NB = brainsIn.length, RB = NB === 1 ? 0 : 1550 + 250 * Math.max(0, NB - 2);
    brainsIn.forEach((b, i) => {
      const th = Math.PI + (Math.PI * 2 * i) / NB, hx = Math.cos(th) * RB, hy = Math.sin(th) * RB;
      b.hub = { x: hx, y: hy }; anchor[b.self] = b.hub;
      const own = lobes.filter(l => l.brain === b.id && !selfLobe(l)).map(l => l.id);
      arcAnchors(own, hx, hy, 820, th - Math.PI * 0.7, Math.PI * 1.4);   // the inner 0.6π stays open towards the shared lobes
    });
    const sharedL = lobes.filter(l => !l.brain && !selfLobe(l)).map(l => l.id);
    sharedL.forEach((id, j) => { const m = sharedL.length, a = -Math.PI / 2 + (Math.PI * 2 * j) / m, r = m === 1 ? 0 : 430; anchor[id] = { x: Math.cos(a) * r, y: Math.sin(a) * r }; hubOf[id] = { x: 0, y: 0 }; });
  }
  pages.forEach(p => { if (isChild(p)) return; const a = anchor[p.lobe]; p.x = a.x + (Math.random() - 0.5) * 220; p.y = a.y + (Math.random() - 0.5) * 220; });
  pages.forEach(p => { if (!isChild(p)) return; p.x = p.parent.x + (Math.random() - 0.5) * 6; p.y = p.parent.y + (Math.random() - 0.5) * 6; });
  syns.forEach(s => { const p = pageById[s.page]; s.x = p.x + (Math.random() - 0.5) * 4; s.y = p.y + (Math.random() - 0.5) * 4; });
  srcs.forEach(s => { const p = s.pageNodes[0]; s.x = p.x + (Math.random() - 0.5) * 4; s.y = p.y + (Math.random() - 0.5) * 4; });

  // ---------- state ----------
  let k = 0.3, tx = 0, ty = 0;           // zoom transform
  let explodeF = 0, explodeTarget = 0;   // 0 collapsed → 1 exploded
  let depthF = 0, depthTarget = 0;       // 0 sub-neurons folded into parents → 1 unfolded
  let forceExplode = false, showCocite = false;
  let hover = null, selected = null, pulseSyn = null;
  // labels toggle (L); when off, only the hovered neuron or lobe keeps its label. A page may start with labels off by setting
  // window.MINDBLOWN_OPTIONS = { labels: false } before app.js loads; the toggle, the lobes-panel switch and the L key still work.
  const OPT = window.MINDBLOWN_OPTIONS || {};
  let labelsOn = OPT.labels !== false, labelF = labelsOn ? 1 : 0;
  // layouts: 'neural' is the force-directed brain; the other three are maps that hold every neuron at a computed locus. 'genome' (G) arranges
  // the brain the way a genome is mapped, as a karyogram; 'cell' (K) as a karyocyte, one nucleated cell whose lobes are chromosome territories;
  // 'tree' (F) as a family tree, the hub the ancestor and each lobe a branch. A page may start in one with window.MINDBLOWN_OPTIONS = { layout: 'genome' }
  // or a #layout=genome hash; the tool buttons, the switches in the lobes panel and the keys toggle them.
  // 'table' (T) seats the brain around a round table with no head.
  // 'coil' (Z, for zap) makes the brain a Tesla coil in discharge: the hub in the toroid, every lobe a lightning streamer, every neuron a kink of it.
  // 'horizon' (E) is a black hole seen face-on: the hub in the event horizon, lobes as arcs of the accretion disk, neurons as knots.
  const LAYOUTS = ['neural', 'genome', 'cell', 'tree', 'table', 'coil', 'orbit', 'horizon'];
  const LAYOUT_NAME = { neural: 'neural', genome: 'genome', cell: 'karyocyte', tree: 'family tree', table: 'table', coil: 'coil', orbit: 'orbit', horizon: 'horizon' };
  // the page's default layout, then the link hash on top of it: a shared `#layout=` link (including `layout=neural`) opens as sent whatever the page defaults to
  const pageLayout = LAYOUTS.includes(OPT.layout) ? OPT.layout : 'neural';
  const hashLayout = () => { const m = /[#&]layout=(\w+)\b/.exec(location.hash); return m && LAYOUTS.includes(m[1]) ? m[1] : null; };
  let layout = hashLayout() || pageLayout;
  const genome = () => layout === 'genome', cell = () => layout === 'cell', tree = () => layout === 'tree', table = () => layout === 'table', coil = () => layout === 'coil', orbit = () => layout === 'orbit', horizon = () => layout === 'horizon';
  const radial = () => table() || coil() || orbit() || horizon();   // layouts whose synapse ladders and labels run along a per-neuron radius (n.gux, n.guy)
  const mapped = () => layout !== 'neural';   // any map: neurons are held at loci, connections are drawn but do not pull

  // ---------- genome layout: every brain mapped like a karyotype ----------
  // Chromosomes are the brains on a network screen (plus one per shared lobe) and the lobes on a single brain. Each is a vertical bar whose
  // length follows its content as a chromosome's follows its base pairs; bands are the lobes (network) or the neurons themselves, painted in
  // alternating density like G-banding; the hub neuron sits in the centromere constriction, placed submetacentric (38 % down) like most human
  // chromosomes; sub-neurons line up beside their parent on the left, synapses fan out to the right. Nothing here names a dataset: it is built
  // from lobes[].brain / self and D.brains alone, so any brain lays out the same way.
  const G = { barW: 44, gapX: 170, rowGap: 300, hubGap: 420 };
  const chromos = [];
  let layoutAspect = 0;   // viewport aspect the current genome layout was computed for
  const chromoOf = {};   // lobe id → chromosome
  if (brainsIn) {
    brainsIn.forEach(b => {
      const hub = pages.find(p => p.isCenter && p.lobe === b.self) || pages.find(p => p.lobe === b.self && !isChild(p)) || null;
      const c = { id: b.id, name: b.short || b.title, color: b.color || lobeById[b.self]?.color || '#9aa', hub, segs: lobes.filter(l => l.brain === b.id || l.id === b.self) };   // the self lobe rides along even when the composer left its brain field empty, so every top-level page of the brain gets a locus
      chromos.push(c); c.segs.forEach(l => { chromoOf[l.id] = c; });
    });
    lobes.filter(l => !l.brain && !selfLobe(l)).forEach(l => { const c = { id: l.id, name: l.name, color: l.color, hub: null, segs: [l] }; chromos.push(c); chromoOf[l.id] = c; });
  } else lobes.filter(l => !selfLobe(l)).forEach(l => { const c = { id: l.id, name: l.name, color: l.color, hub: null, segs: [l] }; chromos.push(c); chromoOf[l.id] = c; });
  // every map is made of groups the user can pick up whole: chromosomes here, cells in the karyocyte layout, branches in the family tree.
  // A group has .loci (its top-level neurons), .hubOn (a hub neuron that sits inside it) and .on; relayout() stamps p.grp on each member
  const groupsNow = () => genome() ? chromos : cell() ? cells : tree() ? branches : table() ? seats : coil() ? streamers : orbit() ? orbits : horizon() ? hzArcs : [];
  const grpOf = n => (isChild(n) ? n.parent : n).grp || null;
  const sameGroup = (a, b) => !!grpOf(a) && grpOf(a) === grpOf(b);
  const groupMembers = g => [...(g.hubOn ? [g.hubOn, ...g.hubOn.children] : []), ...g.loci, ...g.loci.flatMap(p => p.children)];
  // dragging in a map moves a whole group: bar, bands, sub-neurons and hub travel together, so the picture never splits. g.ox/g.oy (and
  // p.gox/p.goy for a neuron outside any group, like a single brain's hub) are the hand offsets; they survive a relayout so a toggled lobe
  // does not undo the user's arrangement. While a group is in hand its members ride along fixed (fx/fy); the anchor forces only learn the
  // new loci in refreshForces(), which the drop calls
  const nudge = p => { p.x = anchorX(p); p.y = anchorY(p); p.fx = p.x; p.fy = p.y; p.vx = p.vy = 0; };
  function moveGroups(groups, loose, dx, dy) {
    groups.forEach(g => { g.ox = (g.ox || 0) + dx; g.oy = (g.oy || 0) + dy; }); loose.forEach(p => { p.gox = (p.gox || 0) + dx; p.goy = (p.goy || 0) + dy; });
    relayout(false); [...groups.flatMap(groupMembers), ...loose, ...loose.flatMap(p => p.children)].forEach(nudge);
  }
  const mapMoved = () => groupsNow().some(g => g.ox || g.oy) || pages.some(p => p.gox || p.goy);
  function dropGroups(d) { [...d.groups.flatMap(groupMembers), ...d.loose, ...d.loose.flatMap(p => p.children)].forEach(p => { if (!p.pinned) { p.fx = null; p.fy = null; } }); refreshForces(); }
  // R puts every group back on its computed locus at once (a snap, not a glide): a long streamer's kinks rest against each other, so a glide
  // can settle a few pixels off the map
  function resetMap() { groupsNow().forEach(g => { g.ox = g.oy = 0; }); pages.forEach(p => { p.gox = p.goy = 0; }); relayout(true); refreshForces(); sim.alpha(0.5).restart(); }
  // The map is static: slots and columns are sized for the unfolded, exploded state up front, so zooming never shifts a locus.
  // the room a locus needs along the bar: its own body (drawn ~1.6× at karyogram zoom) or its sub-neuron column, whichever is taller
  const kidPitch = c => 2 * c.r * 1.5 + 8;
  const slotH = p => Math.max(2 * p.r * 1.6 + 8, d3.sum(p.children.filter(pageOn), kidPitch), 24);
  // how far a neuron's synapse ladder reaches sideways once exploded: one row, 9 units a rung
  const SYN_PITCH = 9;
  const synReach = p => p.nSyn ? p.r * 1.3 + 8 + p.nSyn * SYN_PITCH : 0;
  // a sub-neuron's slot is an offset from its parent; anchorX/Y scale it by depthF so children unfold out of the bar into their column
  const placeKids = p => { const kids = p.children.filter(pageOn), kh = d3.sum(kids, kidPitch); let ky = p.gy - kh / 2; kids.forEach(x => { const ph = kidPitch(x); x.gdx = -(G.barW / 2 + 16 + x.r * 1.5); x.gdy = ky + ph / 2 - p.gy; x.gx = p.gx + x.gdx; x.gy = p.gy + x.gdy; ky += ph; }); };
  function layoutGenome(snap) {
    pages.forEach(p => { p.grp = null; });
    chromos.forEach(c => {
      const segs = c.segs.map(l => ({ l, ps: pages.filter(p => p.lobe === l.id && p !== c.hub && !isChild(p) && pageOn(p)).sort((a, b) => b.deg - a.deg || a.title.localeCompare(b.title)) })).filter(s => s.ps.length);
      const loci = segs.flatMap(s => s.ps), hs = loci.map(slotH), total = d3.sum(hs);
      let acc = 0, cIdx = loci.length;
      for (let i = 0; i < loci.length; i++) { if (acc + hs[i] / 2 > total * 0.38) { cIdx = i; break; } acc += hs[i]; }
      c.hubOn = c.hub && pageOn(c.hub) ? c.hub : null;
      c.hubH = c.hubOn ? Math.max(2 * c.hubOn.r * 1.6 + 16, d3.sum(c.hubOn.children.filter(pageOn), kidPitch)) : loci.length > 1 ? 16 : 0;
      c.loci = loci; c.hs = hs; c.cIdx = cIdx;
      c.above = d3.sum(hs.slice(0, cIdx)) + c.hubH / 2; c.below = d3.sum(hs.slice(cIdx)) + c.hubH / 2;
      const withHub = c.hubOn ? [...loci, c.hubOn] : loci;   // the hub and its sub-neurons share the chromosome's horizontal extent
      c.reachR = Math.max(0, ...withHub.map(synReach));
      c.reachL = Math.max(0, ...withHub.map(p => { const kids = p.children.filter(pageOn); return kids.length ? 24 + Math.max(...kids.map(x => 2 * x.r * 1.5 + synReach(x))) : 0; }));
      c.on = loci.length > 0 || !!c.hubOn;
      if (c.on) { loci.forEach(p => { p.grp = c; }); if (c.hubOn) c.hubOn.grp = c; }
    });
    // a karyogram puts many chromosomes on two or three rows, centromeres aligned along each row; the row count that brings the whole
    // map closest to a landscape screen wins, so a brain with a handful of lobes stays on one row and a 26-brain network takes two or three
    const on = chromos.filter(c => c.on), n = on.length;
    const oneRowW = d3.sum(on, c => c.reachL + G.barW + c.reachR + G.gapX), tallest = Math.max(0, ...on.map(c => c.above + c.below)), hubExtra = brainsIn ? 0 : G.hubGap;
    const rows = rowsFor(n, r => (oneRowW / r) / (hubExtra + tallest * r + G.rowGap * (r - 1)));
    const per = Math.ceil(n / rows);
    let rowTop = 0; const spans = [];
    for (let r = 0; r < rows; r++) {
      const row = on.slice(r * per, (r + 1) * per); if (!row.length) break;
      const above = Math.max(...row.map(c => c.above)), below = Math.max(...row.map(c => c.below));
      let x = 0; row.forEach(c => { x += c.reachL + G.barW / 2; c.x = x; c.cy = rowTop + above; x += G.barW / 2 + c.reachR + G.gapX; });
      // c.ox/c.oy are the hand offsets from dragging a chromosome; they survive a relayout so a toggled lobe does not undo the user's arrangement
      const shift = (x - G.gapX) / 2; row.forEach(c => { c.x += (c.ox || 0) - shift; c.cy += c.oy || 0; });
      spans.push({ x0: -shift, x1: x - G.gapX - shift });
      rowTop += above + below + G.rowGap;
    }
    on.forEach(c => {
      let y = c.cy - c.above; c.top = y;
      c.loci.forEach((p, i) => {
        if (i === c.cIdx) y += c.hubH;
        const h = c.hs[i]; p.gx = c.x; p.gy = y + h / 2; y += h;
        placeKids(p);
      });
      if (c.cIdx >= c.loci.length) y += c.hubH;
      c.bot = y;
      if (c.hubOn) { c.hubOn.gx = c.x; c.hubOn.gy = c.cy; placeKids(c.hubOn); }
    });
    // a single brain's hub (and any other self-lobe neuron) sits above the karyogram, the nucleus the chromosomes came out of
    if (!brainsIn) { const hubs = pages.filter(p => isSelf(p) && !isChild(p) && pageOn(p)), span = spans[0] || { x0: 0, x1: 0 }, top = on.length ? Math.min(...on.map(c => c.top - (c.oy || 0))) : 0; hubs.forEach((p, i) => { p.gx = (span.x0 + span.x1) / 2 + (i - (hubs.length - 1) / 2) * 120 + (p.gox || 0); p.gy = top - G.hubGap + (p.goy || 0); placeKids(p); }); }
    if (snap) snapToMap();
  }
  // every map picks the row (or column) count that brings its shape closest to the screen's, so a phone gets a taller map; at most four
  function rowsFor(n, aspectOfRows) {
    layoutAspect = (W || 1600) / (H || 900);
    const target = Math.max(0.7, Math.min(2.2, layoutAspect)), off = r => Math.abs(Math.log(aspectOfRows(r) / target));
    let rows = 1; for (let r = 2; r <= Math.min(4, n); r++) if (off(r) < off(rows)) rows = r;
    return rows;
  }
  const snapToMap = () => pages.forEach(p => { if (p.gx !== undefined) { p.x = isChild(p) ? p.parent.gx : p.gx; p.y = isChild(p) ? p.parent.gy : p.gy; p.vx = p.vy = 0; } });

  // ---------- karyocyte layout: the brain as one nucleated cell ----------
  // Each brain is a cell. Its hub is the nucleolus; its lobes are chromosome territories, wedges of the nucleus sized to what they hold; its
  // neurons sit in their territory on rings, the best-connected nearest the nucleolus. Synapses orbit their neuron and sub-neurons ring their
  // parent, so every locus is a slot wide enough for its own explosion. Around the nucleus lies the cytoplasm, where the sources drift, and
  // the membrane closes the cell. A network is a tissue: one cell per brain, one more for the shared lobes, packed in rows. Dataset-agnostic:
  // built from lobes[].brain / self and D.brains alone.
  const C = { pad: 34, gap: 220 };
  const cells = [];
  if (brainsIn) {
    brainsIn.forEach(b => {
      const hub = pages.find(p => p.isCenter && p.lobe === b.self) || pages.find(p => p.lobe === b.self && !isChild(p)) || null;
      cells.push({ id: b.id, name: b.short || b.title, color: b.color || lobeById[b.self]?.color || '#9aa', hub, segs: lobes.filter(l => l.brain === b.id || l.id === b.self) });
    });
    const shared = lobes.filter(l => !l.brain && !selfLobe(l));
    if (shared.length) cells.push({ id: 'shared', name: 'Shared', color: '#b9c4e0', hub: null, segs: shared });
  } else cells.push({ id: 'cell', name: '', color: '#b9c4e0', hub: pages.find(p => p.isCenter && isSelf(p)) || pages.find(isSelf) || null, segs: lobes });
  // the ring a neuron's synapses settle on once exploded, and the ring its sub-neurons stand on
  const synRing = p => p.nSyn ? Math.max(p.r * 1.6 + 10, p.r + 4 + p.nSyn * SYN_PITCH / (2 * Math.PI)) : 0;
  const kidRing = (p, kids) => kids.length ? p.r + 14 + d3.sum(kids, kidPitch) / (2 * Math.PI) : 0;
  const cellSlot = p => { const kids = p.children.filter(pageOn); return Math.max(p.r * 1.6 + 8, synRing(p), kidRing(p, kids) + (kids.length ? Math.max(...kids.map(x => Math.max(x.r * 1.5, synRing(x)))) : 0)) + 6; };
  const ringKids = p => { const kids = p.children.filter(pageOn), m = kids.length, R = kidRing(p, kids); kids.forEach((x, i) => { const a = -Math.PI / 2 + (i / m) * Math.PI * 2; x.gdx = Math.cos(a) * R; x.gdy = Math.sin(a) * R; x.gx = p.gx + x.gdx; x.gy = p.gy + x.gdy; }); };
  function layoutCell(snap) {
    pages.forEach(p => { p.grp = null; });
    cells.forEach(c => {
      c.hubOn = c.hub && pageOn(c.hub) ? c.hub : null;
      c.terr = c.segs.map(l => ({ l, ps: pages.filter(p => p.lobe === l.id && p !== c.hub && !isChild(p) && pageOn(p)).sort((a, b) => b.deg - a.deg || a.title.localeCompare(b.title)) })).filter(t => t.ps.length);
      c.loci = c.terr.flatMap(t => t.ps); c.on = c.loci.length > 0 || !!c.hubOn;
      if (!c.on) return;
      c.loci.forEach(p => { p.grp = c; }); if (c.hubOn) c.hubOn.grp = c;
      c.terr.forEach(t => { t.slots = t.ps.map(cellSlot); t.area = d3.sum(t.slots, r => r * r) + 900; });
      const areaTotal = d3.sum(c.terr, t => t.area);
      // the nucleolus (hub and its sub-neurons) holds the middle; territories start outside it and fill their wedge ring by ring
      c.hubR = c.hubOn ? cellSlot(c.hubOn) + 20 : 30;
      let outer = c.hubR, a0 = -Math.PI / 2;
      c.terr.forEach(t => {
        const sweep = Math.PI * 2 * t.area / areaTotal; t.a0 = a0; t.a1 = a0 + sweep; a0 += sweep;
        let i = 0, R = c.hubR, prevMax = 0; t.rel = [];
        while (i < t.ps.length) {
          const items = []; let maxS = 0;
          // a ring takes loci while each still gets a pitch of twice the ring's widest slot along the wedge arc
          while (i < t.ps.length) { const s = Math.max(maxS, t.slots[i]), R0 = R + prevMax + s; if (items.length && (items.length + 1) * 2 * s > sweep * R0) break; items.push(i); maxS = s; i++; }
          R += prevMax + maxS;
          items.forEach((idx, j) => { const a = t.a0 + sweep * (j + 0.5) / items.length; t.rel.push([idx, Math.cos(a) * R, Math.sin(a) * R]); });
          prevMax = maxS;
        }
        t.outer = R + prevMax; outer = Math.max(outer, t.outer);
      });
      c.Rn = outer + C.pad; c.Rc = c.Rn * 1.3 + 70;
    });
    // a tissue: cells in rows, each row centred, the row count matched to the screen
    const on = cells.filter(c => c.on), n = on.length;
    const oneRowW = d3.sum(on, c => 2 * c.Rc + C.gap), tallest = Math.max(0, ...on.map(c => 2 * c.Rc));
    const rows = rowsFor(n, r => (oneRowW / r) / (tallest * r + C.gap * (r - 1))), per = Math.ceil(n / rows);
    let rowTop = 0;
    for (let r = 0; r < rows; r++) {
      const row = on.slice(r * per, (r + 1) * per); if (!row.length) break;
      const rowH = Math.max(...row.map(c => 2 * c.Rc)); let x = 0;
      row.forEach(c => { x += c.Rc; c.cx = x; c.cy = rowTop + rowH / 2; x += c.Rc + C.gap; });
      const shift = (x - C.gap) / 2; row.forEach(c => { c.cx += (c.ox || 0) - shift; c.cy += c.oy || 0; });
      rowTop += rowH + C.gap;
    }
    on.forEach(c => {
      c.terr.forEach(t => t.rel.forEach(([idx, dx, dy]) => { const p = t.ps[idx]; p.gx = c.cx + dx; p.gy = c.cy + dy; ringKids(p); }));
      if (c.hubOn) { c.hubOn.gx = c.cx; c.hubOn.gy = c.cy; ringKids(c.hubOn); }
    });
    if (snap) snapToMap();
  }

  // ---------- family tree layout: a descendant chart read left to right ----------
  // The hub is the ancestor at the left; each lobe is a branch of the family, drawn as a name plate; its neurons are the next generation,
  // stacked down the page with elbow connectors; their sub-neurons the generation after, in the next column; synapses ladder out to the
  // right of the youngest. A network is a forest: one tree per brain, one more for the shared lobes, trees stacked in as many columns as the
  // screen's shape asks for. Branches are the groups a user can pick up.
  const T = { hubGap: 230, plateW: 160, plateH: 30, plateGap: 70, pad: 24, subGap: 60, branchGap: 80, genGap: 90, treeGap: 240, rowGap: 260 };
  const branches = [], trees = [];
  {
    const mk = (id, name, color, hub, ls) => { const t = { id, name, color, hub, branches: ls.map(l => { const b = { id: l.id, name: l.name, color: l.color, lobe: l, tree: null }; branches.push(b); return b; }) }; t.branches.forEach(b => { b.tree = t; }); trees.push(t); };
    if (brainsIn) {
      brainsIn.forEach(b => mk(b.id, b.short || b.title, b.color || lobeById[b.self]?.color || '#9aa', pages.find(p => p.isCenter && p.lobe === b.self) || pages.find(p => p.lobe === b.self && !isChild(p)) || null, lobes.filter(l => l.brain === b.id || l.id === b.self)));
      const shared = lobes.filter(l => !l.brain && !selfLobe(l)); if (shared.length) mk('shared', 'Shared', '#b9c4e0', null, shared);
    } else mk('tree', '', '#b9c4e0', pages.find(p => p.isCenter && isSelf(p)) || pages.find(isSelf) || null, lobes);
  }
  const rowH = p => Math.max(2 * p.r * 1.6 + 10, 26);
  // a descendant chart, read top-down: the ancestor (hub) on top, one plate per lobe in the generation below, each lobe's neurons in a column
  // under its plate, and sub-neurons in a second column to the right of their parent. The ancestor's own sub-neurons stand to its left.
  function layoutTree(snap) {
    pages.forEach(p => { p.grp = null; });
    trees.forEach(t => {
      t.hubOn = t.hub && pageOn(t.hub) ? t.hub : null;
      t.branches.forEach(b => {
        b.loci = pages.filter(p => p.lobe === b.id && p !== t.hub && !isChild(p) && pageOn(p)).sort((a, c) => c.deg - a.deg || a.title.localeCompare(c.title));
        b.on = b.loci.length > 0; b.hubOn = null; if (b.on) b.loci.forEach(p => { p.grp = b; });
        // a neuron's extent is its own row or its sub-neurons' rows, whichever is taller; the column is its neurons stacked
        b.loci.forEach(p => { const kids = p.children.filter(pageOn); p.kidsH = d3.sum(kids, rowH); p.extent = Math.max(rowH(p), p.kidsH); });
        b.extent = d3.sum(b.loci, p => p.extent) + Math.max(0, b.loci.length - 1) * 6;
        const maxR = Math.max(0, ...b.loci.map(p => p.r)), reach = Math.max(0, ...b.loci.map(synReach));
        const kidReach = Math.max(0, ...b.loci.filter(p => p.children.some(pageOn)).map(synReach));   // a parent's ladder must clear the sub-neuron column
        const subReach = Math.max(0, ...b.loci.flatMap(p => p.children.filter(pageOn)).map(x => 2 * x.r * 1.5 + synReach(x)));
        b.subDX = subReach ? Math.max(kidReach, maxR * 1.3 + 8) + T.subGap : 0;
        b.nxOff = T.pad + 14 + maxR;                                     // spine at T.pad, neurons just right of it
        b.w = Math.max(T.plateW, b.nxOff + Math.max(reach, b.subDX + subReach) + T.pad);
      });
      const bs = t.branches.filter(b => b.on);
      t.on = bs.length > 0 || !!t.hubOn;
      const h = t.hubOn, kids = h ? h.children.filter(pageOn) : [], kidsH = d3.sum(kids, rowH), kidsW = kids.length ? Math.max(...kids.map(x => x.r * 1.5 + synReach(x))) + 40 : 0;
      t.hubH = h ? rowH(h) : 0; t.hubGap = h ? Math.max(T.hubGap, kidsH - t.hubH / 2 + 50) : 0;
      t.hubW = h ? 2 * (kidsW + h.r + synReach(h)) + 40 : 0;
      if (h) h.grp = null;
      t.bs = bs;
    });
    const on = trees.filter(t => t.on), n = on.length;
    // a lone tree wraps its plates into generations of rows when the screen is taller than the tree; a forest keeps one row per tree
    const rowsOf = (t, r) => { const per = Math.ceil(t.bs.length / r), rows = []; for (let i = 0; i < r; i++) { const bs = t.bs.slice(i * per, (i + 1) * per); if (bs.length) rows.push({ bs, w: d3.sum(bs, b => b.w) + (bs.length - 1) * T.branchGap, ext: Math.max(...bs.map(b => b.extent)) }); } return rows; };
    const sizeOf = (t, rows) => ({ w: Math.max(...rows.map(r => r.w), t.hubW, 200), h: t.hubH + t.hubGap + d3.sum(rows, r => T.plateH + T.plateGap + r.ext) + (rows.length - 1) * T.genGap });
    on.forEach(t => {
      let rows = t.bs.length ? rowsOf(t, 1) : [];
      if (n === 1 && t.bs.length > 1) { const r = rowsFor(t.bs.length, r => { const sz = sizeOf(t, rowsOf(t, r)); return sz.w / sz.h; }); rows = rowsOf(t, r); }
      const sz = sizeOf(t, rows); t.rows = rows; t.w = sz.w; t.h = sz.h;
      let py = t.hubH + t.hubGap + T.plateH / 2; rows.forEach(r => { r.py = py; py += T.plateH + T.plateGap + r.ext + T.genGap; });
    });
    // a forest: trees in rows, the row count matched to the screen
    const oneRowW = d3.sum(on, t => t.w + T.treeGap), tallest = Math.max(0, ...on.map(t => t.h));
    const rows = n > 1 ? rowsFor(n, r => (oneRowW / r) / ((tallest + T.rowGap) * r)) : 1, per = Math.ceil(n / rows);
    let rowY = 0;
    for (let r = 0; r < rows; r++) {
      const row = on.slice(r * per, (r + 1) * per); if (!row.length) break;
      let x = 0; row.forEach(t => { t.x = x; t.y = rowY; x += t.w + T.treeGap; });
      const shift = (x - T.treeGap) / 2; row.forEach(t => { t.x -= shift; });
      rowY += Math.max(...row.map(t => t.h)) + T.rowGap;
    }
    on.forEach(t => {
      t.cx = t.x + t.w / 2;
      // the ancestor on top, centred; its own sub-neurons stand in a column at its left, their ladders running left where nothing else is
      if (t.hubOn) { const h = t.hubOn; h.gx = t.cx + (h.gox || 0); h.gy = t.y + t.hubH / 2 + (h.goy || 0); let ky = h.gy - rowH(h) / 2; const kx = -(h.r * 1.3 + synReach(h) + 40); h.children.filter(pageOn).forEach(x => { const hh = rowH(x); x.gdx = kx - x.r * 1.5; x.gdy = ky + hh / 2 - h.gy; x.gx = h.gx + x.gdx; x.gy = h.gy + x.gdy; ky += hh; }); }
      t.rows.forEach(r => {
        let bx = t.x + (t.w - r.w) / 2;
        r.bs.forEach(b => {
          b.x0 = bx + (b.ox || 0); b.x1 = b.x0 + b.w; b.cx = b.x0 + b.w / 2; b.py = t.y + r.py + (b.oy || 0);
          b.sx = b.x0 + T.pad; b.nx = b.x0 + b.nxOff; b.subX = b.nx + b.subDX;
          b.y0 = b.py + T.plateH / 2 + T.plateGap; b.y1 = b.y0 + b.extent;
          let y = b.y0;
          b.loci.forEach(p => {
            p.gx = b.nx; p.gy = y + p.extent / 2;
            const kids = p.children.filter(pageOn); let ky = y + (p.extent - p.kidsH) / 2;
            kids.forEach(x => { const h = rowH(x); x.gdx = b.subX - p.gx; x.gdy = ky + h / 2 - p.gy; x.gx = p.gx + x.gdx; x.gy = p.gy + x.gdy; ky += h; });
            y += p.extent + 6;
          });
          bx += b.w + T.branchGap;
        });
      });
    });
    if (snap) snapToMap();
  }
  // ---------- table layout: a round table with no head ----------
  // Mensa means table: a round-table society where no seat is nearer the head because there is none. Here the lobes (or the brains of a
  // network, plus one seat per shared lobe) sit around one ring as equals; a single brain's hub takes a seat like everyone else instead of the
  // centre, and a network brain's hub takes the first chair of its brain's seat. Neurons are the chairs along the ring; synapses are laid on
  // the table (a ladder toward the centre); sub-neurons stand behind their parent's chair with their own ladders running outward; connections
  // run across the table as chords. The centre stays empty on purpose. Built from lobes[].brain / self alone, like the genome layout.
  const TB = { ring: 36, seatGap: 72, minR: 260 };
  const seats = brainsIn ? chromos.map(c => ({ id: c.id, name: c.name, color: c.color, hub: c.hub, segs: c.segs })) : [...lobes.filter(selfLobe).map(l => ({ id: l.id, name: l.name, color: l.color, hub: null, segs: [l] })), ...chromos];
  let tableR = 0;
  // sub-neurons stand behind the chair: a row outside the ring, centred on the parent's angle, each with the radial direction of its parent
  const placeKidsRadial = p => { const kids = p.children.filter(pageOn), kw = d3.sum(kids, kidPitch); let t = -kw / 2; kids.forEach(x => { const pw = kidPitch(x), d = TB.ring / 2 + 16 + x.r * 1.5, tt = t + pw / 2; x.gux = p.gux; x.guy = p.guy; x.gdx = p.gux * d - p.guy * tt; x.gdy = p.guy * d + p.gux * tt; x.gx = p.gx + x.gdx; x.gy = p.gy + x.gdy; t += pw; }); };
  function layoutTable(snap) {
    pages.forEach(p => { p.grp = null; });
    seats.forEach(c => {
      const segs = c.segs.map(l => ({ l, ps: pages.filter(p => p.lobe === l.id && p !== c.hub && !isChild(p) && pageOn(p)).sort((a, b) => b.deg - a.deg || a.title.localeCompare(b.title)) })).filter(s => s.ps.length);
      const loci = segs.flatMap(s => s.ps);
      c.hubOn = c.hub && pageOn(c.hub) ? c.hub : null;
      if (c.hubOn) loci.unshift(c.hubOn);
      c.loci = loci; c.ws = loci.map(slotH); c.on = loci.length > 0; loci.forEach(p => { p.grp = c; });
      const kids = loci.flatMap(p => p.children.filter(pageOn));
      c.kidR = kids.length ? Math.max(...kids.map(x => 16 + 2 * x.r * 1.5)) : 0; c.kidSyn = kids.length ? Math.max(...kids.map(synReach)) : 0;
    });
    const on = seats.filter(c => c.on);
    // the ring is as long as its chairs plus a gap between seats, and never so small that a synapse ladder would reach the centre
    const reach = Math.max(0, ...on.flatMap(c => c.loci.map(synReach))), need = d3.sum(on, c => d3.sum(c.ws)) + TB.seatGap * on.length;
    tableR = Math.max(TB.minR, need / (2 * Math.PI), reach + 90);
    // when the minimum radius or a long ladder sets the table, the spare circumference is shared out between the seats, so a sparse brain still sits all the way round
    const gap = TB.seatGap + Math.max(0, 2 * Math.PI * tableR - need) / Math.max(1, on.length);
    let a = -Math.PI / 2;   // the first seat starts at twelve o'clock
    on.forEach(c => {
      c.a0 = a;
      c.loci.forEach((p, i) => {
        const w = c.ws[i], am = a + w / 2 / tableR;
        p.ga = am; p.gux = Math.cos(am); p.guy = Math.sin(am); p.gx = tableR * p.gux + (c.ox || 0); p.gy = tableR * p.guy + (c.oy || 0);   // c.ox/c.oy: a seat pulled away from the table by hand
        placeKidsRadial(p); a += w / tableR;
      });
      c.a1 = a; c.am = (c.a0 + c.a1) / 2; a += gap / tableR;
    });
    if (snap) snapToMap();
  }
  // ---------- coil layout (Z): the Tesla coil ----------
  // The brain is a Tesla coil in discharge. The hub (a brain's self lobe; on the network screen the composition's centre) stands in the
  // toroid, the top load of the coil; the secondary winding and the primary stand beneath it, so the map reads as the apparatus seen from the
  // side. Every lobe (every brain on the network screen) is a streamer: a lightning channel that leaves the toroid rim and runs out through
  // the upper sky in kinks, one kink per neuron, the best-connected neurons nearest the terminal. A long lobe forks into two channels; a
  // brain's lobes fork off its trunk, whose root holds the brain's hub. Synapse ladders strike inward, perpendicular to the channel (the
  // table's radial-ladder machinery, with each kink's own perpendicular as the radius); sub-neurons stand on the channel's outer side.
  // Kinks are hashed from the streamer and the kink index, so a reload draws the same bolt; only the flicker and the discharges move.
  const CL = { R0: 160, fan: Math.PI * 1.36, top: -Math.PI / 2, kink: 0.6, step: 46, trunk: 110, fork: 12, forkAt: 0.45, ry: 0.36, body: 1.15, turns: 14 };
  // on the network screen the page named by D.center (the composition's centre) leaves its brain's streamer and stands in the toroid
  const coilCentre = brainsIn && D.center ? pageById[D.center] || null : null;
  const streamers = brainsIn
    ? chromos.map(c => ({ id: c.id, name: c.name, color: c.color, hub: c.hub === coilCentre ? null : c.hub, segs: c.segs }))
    : lobes.filter(l => !selfLobe(l)).map(l => ({ id: l.id, name: l.name, color: l.color, hub: null, segs: [l] }));
  const streamerIdx = {}; streamers.forEach((s, i) => { streamerIdx[s.id] = i; });
  let coilR = CL.R0;   // the toroid's radius once laid out
  const hash01 = (a, b) => { let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + 1013904223) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const coilPulses = [];   // discharges running out along the channels: { s, c (chain), t, speed }
  // one channel of kinks from a start point along a heading: each kink a neuron (its slot sets the step), the heading wandering by a bounded,
  // hashed amount and leaning back toward the channel's own heading so a channel never curls into its neighbour's sky
  function chain(s, ps, x0, y0, head, spread, seed, side) {
    let x = x0, y = y0, h = head; const pts = [[x, y]];
    ps.forEach((p, i) => {
      const z = (i % 2 ? 1 : -1) * (0.3 + 0.7 * hash01(seed, i + 1)), drift = i ? Math.atan2(y - y0, x - x0) : head, lean = Math.atan2(Math.sin(drift - head), Math.cos(drift - head));
      h = head + z * spread - lean * 0.5;
      const step = Math.max(CL.step, slotH(p) * 0.9) + (i ? 0 : 14);
      x += Math.cos(h) * step; y += Math.sin(h) * step;
      p.gx = x + (s.ox || 0); p.gy = y + (s.oy || 0); p.gh = h;
      // the ladder's radius is the channel's perpendicular on the streamer's outer side (away from the zenith), so labels fan outward
      p.gux = -Math.sin(h) * side; p.guy = Math.cos(h) * side;
      placeKidsRadial(p); pts.push([x, y]);
    });
    return { pts, ps, x, y, head: h, len: pts.length > 1 ? d3.sum(pts.slice(1), (q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1])) : 0 };
  }
  // a lobe's neurons run down one channel, or fork into two once the lobe is long; the fork opens by ±a third of the lobe's sky
  function lobeChains(s, ps, x0, y0, head, w, seed, side) {
    const spread = Math.min(CL.kink, w / 1.6);
    if (ps.length <= 2 * CL.fork) return [chain(s, ps, x0, y0, head, spread, seed, side)];
    const k0 = Math.max(2, Math.round(ps.length * CL.forkAt)), trunk = chain(s, ps.slice(0, k0), x0, y0, head, spread * 0.6, seed, side);
    const rest = ps.slice(k0), L = rest.filter((_, i) => i % 2 === 0), R = rest.filter((_, i) => i % 2 === 1);
    const bl = chain(s, L, trunk.x, trunk.y, head - w / 3.2, spread * 0.7, seed + 1, side), br = chain(s, R, trunk.x, trunk.y, head + w / 3.2, spread * 0.7, seed + 2, side);
    bl.from = br.from = trunk;   // the branches leave the trunk's tip; a discharge runs the trunk first
    return [trunk, bl, br];
  }
  function layoutCoil(snap) {
    pages.forEach(p => { p.grp = null; p.gflat = false; });
    streamers.forEach(s => {
      s.lobesOn = s.segs.map(l => ({ l, ps: pages.filter(p => p.lobe === l.id && p !== s.hub && p !== coilCentre && !isChild(p) && pageOn(p)).sort((a, b) => b.deg - a.deg || a.title.localeCompare(b.title)) })).filter(x => x.ps.length);
      s.hubOn = s.hub && pageOn(s.hub) ? s.hub : null;
      s.loci = s.lobesOn.flatMap(x => x.ps); s.on = s.loci.length > 0 || !!s.hubOn;
      s.reach = Math.max(0, ...s.loci.map(synReach), ...s.loci.flatMap(p => p.children.filter(pageOn)).map(x => 34 + 2 * x.r * 1.5 + synReach(x)));
      if (s.on) { s.loci.forEach(p => { p.grp = s; }); if (s.hubOn) s.hubOn.grp = s; }
    });
    const on = streamers.filter(s => s.on);
    // wide lobes take more sky; the toroid grows until every streamer's ladders (inward) and labels (outward) have room at its root
    const share = on.map(s => Math.sqrt(s.loci.length + 1) + (s.lobesOn.length > 1 ? 1 + s.lobesOn.length * 0.5 : 1.2)), total = d3.sum(share) || 1;
    coilR = Math.max(CL.R0, Math.min(420, 0.26 * Math.max(0, ...on.map((s, i) => (Math.max(s.reach, 40) + 120) / (CL.fan * share[i] / total)))));
    let a = CL.top - CL.fan / 2;
    on.forEach((s, i) => {
      const w = CL.fan * share[i] / total, head = a + w / 2; a += w;
      s.head = head; s.a0 = head - w / 2; s.a1 = head + w / 2;
      const side = Math.cos(head) >= -0.02 ? 1 : -1, seed = (streamerIdx[s.id] + 1) * 7919;
      // the root sits on the rim of the toroid, an ellipse because the toroid is seen a little from above
      let x = Math.cos(head) * coilR, y = Math.sin(head) * coilR * CL.ry; s.root = [x, y]; s.side = side;
      const h = s.hubOn;
      if (h) { x += Math.cos(head) * (h.r * 1.6 + 18); y += Math.sin(head) * (h.r * 1.6 + 18); h.gx = x + (s.ox || 0); h.gy = y + (s.oy || 0); h.gh = head; h.gux = -Math.sin(head) * side; h.guy = Math.cos(head) * side; placeKidsRadial(h); }
      s.chains = [];
      if (s.lobesOn.length <= 1) { if (s.lobesOn.length) s.chains = lobeChains(s, s.lobesOn[0].ps, x, y, head, w, seed, side).map(c => Object.assign(c, { l: s.lobesOn[0].l })); s.fork = [x, y]; }
      else {
        // a brain on the network screen: a bare trunk out of the hub, then one channel per lobe fanned across the brain's sky by size
        const tx = x + Math.cos(head) * CL.trunk, ty = y + Math.sin(head) * CL.trunk; s.fork = [tx, ty];
        const ws = s.lobesOn.map(x => Math.sqrt(x.ps.length) + 1), wt = d3.sum(ws); let b = head - w / 2;
        s.lobesOn.forEach((x, j) => { const lw = w * ws[j] / wt; s.chains.push(...lobeChains(s, x.ps, tx, ty, b + lw / 2, lw, seed + 10 * (j + 1), side).map(c => Object.assign(c, { l: x.l }))); b += lw; });
      }
      s.tip = s.chains.length ? s.chains.reduce((m, c) => (c.len > m.len ? c : m), s.chains[0]) : null;
    });
    // a single brain's hub (the self lobe) stands in the toroid; on the network screen the composition's centre does
    const inToroid = pages.filter(p => (isSelf(p) || p === coilCentre) && !isChild(p) && pageOn(p) && !p.grp);   // a non-self network centre still gets its locus
    inToroid.forEach((p, i) => { const m = inToroid.length, ang = -Math.PI / 2 + (Math.PI * 2 * i) / m, rr = m === 1 ? 0 : coilR * 0.42; p.gx = Math.cos(ang) * rr + (p.gox || 0); p.gy = Math.sin(ang) * rr * CL.ry + (p.goy || 0); p.gux = 0; p.guy = -1; p.gh = -Math.PI / 2; p.gflat = true; placeKidsRadial(p); p.children.forEach(x => { x.gflat = true; }); });
    coilPulses.length = 0;
    if (snap) snapToMap();
  }
  // ---------- horizon layout (E): the black hole ----------
  // The brain is a black hole seen face-on. The hub (a brain's self lobe; on the network screen the composition's centre) stands inside the
  // event horizon, a dark disc rimmed by the photon ring. Every lobe (every brain on the network screen) is an arc of the accretion disk:
  // the smallest lobes orbit nearest the horizon, the largest furthest out, and a few arcs share each orbit. Neurons are the knots of
  // matter along their arc, the best-connected first; synapse ladders fall inward toward the horizon (the table's radial machinery);
  // sub-neurons stand on the outer side of their parent's knot. Each orbit starts at its own hashed phase, so the arcs never line up and a
  // reload draws the same disk. The disk is brighter on its approaching side (Doppler beaming) and a faint pair of jets leaves the poles.
  // Connections across the disk bow toward the horizon, bent like light. Built from lobes[].brain / self alone, like the genome layout.
  const HZ = { band: 36, gap: 72, minR: 150, pad: 44, jet: 0.9 };
  const horizonCentre = brainsIn && D.center ? pageById[D.center] || null : null;
  const hzArcs = brainsIn
    ? chromos.map(c => ({ id: c.id, name: c.name, color: c.color, hub: c.hub === horizonCentre ? null : c.hub, segs: c.segs }))
    : lobes.filter(l => !selfLobe(l)).map(l => ({ id: l.id, name: l.name, color: l.color, hub: null, segs: [l] }));
  const hzArcIdx = {}; hzArcs.forEach((o, i) => { hzArcIdx[o.id] = i; });
  let horizonR = HZ.minR, horizonRings = [];   // the event horizon's radius and the orbits (each { R, groups }) once laid out
  function layoutHorizon(snap) {
    pages.forEach(p => { p.grp = null; p.gflat = false; });
    hzArcs.forEach(o => {
      // a page with a numeric `seq` keeps its place along the arc (a chain that reads in order); the rest follow, busiest first
      const seqOf = p => Number.isFinite(p.seq) ? p.seq : Infinity;
      const segs = o.segs.map(l => ({ l, ps: pages.filter(p => p.lobe === l.id && p !== o.hub && p !== horizonCentre && !isChild(p) && pageOn(p)).sort((a, b) => seqOf(a) - seqOf(b) || b.deg - a.deg || a.title.localeCompare(b.title)) })).filter(x => x.ps.length);
      const loci = segs.flatMap(x => x.ps);
      o.hubOn = o.hub && pageOn(o.hub) ? o.hub : null;
      if (o.hubOn) loci.unshift(o.hubOn);
      o.loci = loci; o.ws = loci.map(slotH); o.need = d3.sum(o.ws); o.on = loci.length > 0; loci.forEach(p => { p.grp = o; });
      const kids = loci.flatMap(p => p.children.filter(pageOn));
      o.kidR = kids.length ? Math.max(...kids.map(x => 16 + 2 * x.r * 1.5)) : 0; o.kidSyn = kids.length ? Math.max(...kids.map(synReach)) : 0;
      o.reach = Math.max(0, ...loci.map(synReach));
    });
    const on = hzArcs.filter(o => o.on).sort((a, b) => a.need - b.need || hzArcIdx[a.id] - hzArcIdx[b.id]);
    // orbits are spaced so that a knot's ladder (inward) and the sub-neurons and their ladders (outward) of the next orbit in never meet
    const gap = HZ.band + Math.max(0, ...on.map(o => o.reach)) + Math.max(0, ...on.map(o => o.kidR + o.kidSyn)) + HZ.pad;
    const inHorizon = pages.filter(p => (isSelf(p) || p === horizonCentre) && !isChild(p) && pageOn(p) && !p.grp);
    horizonR = Math.max(HZ.minR, gap * 0.55, ...inHorizon.map(p => p.r * 1.6 + 40 + (inHorizon.length > 1 ? 70 : 0)));   // the hole keeps a presence against the disk
    // the smallest arcs take the innermost orbit; about √n arcs share an orbit, so a brain of eight lobes spreads over three orbits
    const per = Math.max(1, Math.ceil(on.length / Math.ceil(Math.sqrt(on.length || 1))));
    horizonRings = []; let R = horizonR;
    on.forEach(o => {
      let ring = horizonRings[horizonRings.length - 1];
      if (!ring || ring.groups.length >= per) { R = Math.max(R + gap, (o.need + HZ.gap) / (2 * Math.PI)); ring = { R, groups: [] }; horizonRings.push(ring); }
      else if (ring.used + o.need + HZ.gap * (ring.groups.length + 1) > 2 * Math.PI * ring.R) { ring.R = R = (ring.used + o.need + HZ.gap * (ring.groups.length + 1)) / (2 * Math.PI); }
      ring.groups.push(o); ring.used = (ring.used || 0) + o.need; o.ring = horizonRings.length - 1;
    });
    horizonRings.forEach((ring, i) => {
      // the spare circumference is shared out between the arcs, so they sit evenly around their orbit like moons; the orbit's phase is hashed
      const spare = Math.max(0, 2 * Math.PI * ring.R - ring.used), g = spare / ring.groups.length;
      let a = hash01(i + 1, 11) * Math.PI * 2 + g / 2 / ring.R;
      ring.groups.forEach(o => {
        o.R = ring.R; o.a0 = a;
        o.loci.forEach((p, j) => {
          const w = o.ws[j], am = a + w / 2 / ring.R;
          p.ga = am; p.gux = Math.cos(am); p.guy = Math.sin(am); p.gx = ring.R * p.gux + (o.ox || 0); p.gy = ring.R * p.guy + (o.oy || 0);   // o.ox/o.oy: an arc pulled off its orbit by hand
          placeKidsRadial(p); a += w / ring.R;
        });
        o.a1 = a; o.am = (o.a0 + o.a1) / 2; a += g / ring.R;
      });
    });
    // a single brain's hub (the self lobe) stands in the horizon; on the network screen the composition's centre does
    inHorizon.forEach((p, i) => { const m = inHorizon.length, ang = -Math.PI / 2 + (Math.PI * 2 * i) / m, rr = m === 1 ? 0 : horizonR * 0.5; p.gx = Math.cos(ang) * rr + (p.gox || 0); p.gy = Math.sin(ang) * rr + (p.goy || 0); p.gux = 0; p.guy = -1; p.gflat = true; placeKidsRadial(p); p.children.forEach(x => { x.gflat = true; }); });
    if (snap) snapToMap();
  }
  const horizonOuter = () => horizonRings.length ? horizonRings[horizonRings.length - 1].R + HZ.band / 2 + Math.max(0, ...hzArcs.filter(o => o.on).map(o => o.kidR + o.kidSyn)) : horizonR;
  // ---------- orbit layout: the hub at the centre, the neurons on concentric rings ----------
  // A brain as a system of orbits. The hub sits at the centre and every other neuron takes a ring. A dataset can say which: an integer
  // `ring` on the page or on its lobe (0 is the centre). Without one, a hub is ring 0 and each lobe becomes a ring of its own in lobe order.
  // On a network screen the brains' hubs share a ring the same way. Inside a ring the neurons keep the dataset's order; on the rings further
  // out a neuron sits at the mean angle of the neurons it is connected to on the rings inside (or, on a network, at its brain's hub), so a
  // chain of connections runs outward like a spoke, and the ring is then spread (an isotonic fit) so nothing overlaps. Sub-neurons stand
  // outside their parent with their ladders running outward; a neuron's own ladder runs inward into the gap; connections are drawn straight
  // between rings. Built from pages[].ring / lobes[].ring / lobe order alone, so any brain has an orbit.
  const OB = { band: 30, gap: 70 };
  const orbits = [];
  const lobeOrder = Object.fromEntries(lobes.filter(l => !selfLobe(l)).map((l, i) => [l.id, i]));
  const ringOf = p => { const l = lobeById[p.lobe], r = p.ring ?? l?.ring; return Number.isFinite(r) ? r : p.isCenter || (l && selfLobe(l)) ? 0 : (lobeOrder[p.lobe] ?? 0) + 1; };   // the hub and the rest of its self lobe share ring 0
  // least-squares non-decreasing fit (pool adjacent violators): the angles of one ring, in order, pushed apart no more than they must be
  const pava = t => { const bl = []; t.forEach(v => { let b = { s: v, n: 1, v }; while (bl.length && bl[bl.length - 1].v > b.v) { const a = bl.pop(); b = { s: a.s + b.s, n: a.n + b.n, v: (a.s + b.s) / (a.n + b.n) }; } bl.push(b); }); return bl.flatMap(b => Array(b.n).fill(b.v)); };
  function layoutOrbit(snap) {
    pages.forEach(p => { p.grp = null; });
    const tops = pages.filter(p => !isChild(p) && pageOn(p));
    const byRing = d3.group(tops, ringOf), ringIds = [...byRing.keys()].sort((a, b) => a - b);
    const prev = Object.fromEntries(orbits.map(g => [g.ring, g]));
    orbits.length = 0;
    const slotW = p => Math.max(2 * p.r * 1.6 + 10, d3.sum(p.children.filter(pageOn), kidPitch));
    const kidOut = p => { const kids = p.children.filter(pageOn); return kids.length ? TB.ring / 2 + 16 + Math.max(...kids.map(x => 2 * x.r * 1.5 + synReach(x))) : 0; };
    // a network brain's hub gives its neurons their fallback angle, so each brain settles into a sector of the rings
    const hubOfBrain = {}; if (brainsIn) brainsIn.forEach((b, i) => { const h = pageById[(D.centers || [])[i]]; if (h) hubOfBrain[b.id] = h; });
    const placed = new Set(), origin = new Set();   // a neuron sitting at the centre has no direction to offer its neighbours
    let R = 0, prevOut = 0;
    ringIds.forEach((rid, ri) => {
      const ps = byRing.get(rid), g = prev[rid] || { id: 'ring-' + rid, ring: rid, ox: 0, oy: 0 };
      const ws = ps.map(slotW), need = d3.sum(ws) + ps.length * 8, inward = Math.max(0, ...ps.map(synReach));
      // only a lone centre neuron sits at the origin; when the centre lobe is hidden the first visible ring keeps a positive radius
      const loneCenter = rid === 0 && ps.length === 1 && ps[0].isCenter;
      R = ri === 0 ? (loneCenter ? 0 : Math.max(need / (2 * Math.PI), 60)) : Math.max(need / (2 * Math.PI), R + prevOut + inward + OB.gap + OB.band);
      // target angles: the mean direction of the already placed neighbours; a network brain's hub; else nothing (spread evenly in dataset order)
      const want = ps.map(p => {
        let sx = 0, sy = 0;
        p.neighbors.forEach(x => { if (x.l.kind === 'pp' && placed.has(x.n) && !origin.has(x.n)) { sx += Math.cos(x.n.ga); sy += Math.sin(x.n.ga); } });
        if (!sx && !sy && brainsIn) { const h = hubOfBrain[lobeById[p.lobe]?.brain]; if (h && h !== p && placed.has(h) && !origin.has(h)) { sx = Math.cos(h.ga); sy = Math.sin(h.ga); } }
        return sx || sy ? Math.atan2(sy, sx) : NaN;
      });
      const free = want.map((a, i) => Number.isNaN(a) ? i : -1).filter(i => i >= 0);
      free.forEach((i, j) => { want[i] = -Math.PI / 2 + (2 * Math.PI * j) / free.length; });
      let ang;
      if (R === 0) ang = want;
      else {
        // sort by wanted angle (dataset order breaks ties), cut the circle at the widest gap, unwrap, fit, then check the wrap-around gap
        const order = d3.range(ps.length).sort((i, j) => want[i] - want[j] || i - j), n = order.length;
        let cut = 0, widest = -1;
        for (let m = 0; m < n; m++) { const a = want[order[m]], b = want[order[(m + 1) % n]] + (m === n - 1 ? 2 * Math.PI : 0); if (b - a > widest) { widest = b - a; cut = (m + 1) % n; } }
        const seq = order.slice(cut).concat(order.slice(0, cut)), base = want[seq[0]];
        const t = seq.map(i => { let a = want[i] - base; while (a < 0) a += 2 * Math.PI; return a; });
        const pitch = i => (ws[i] + 8) / R, off = [0];
        for (let m = 1; m < n; m++) off.push(off[m - 1] + (pitch(seq[m - 1]) + pitch(seq[m])) / 2);
        const span = off[n - 1] + (pitch(seq[n - 1]) + pitch(seq[0])) / 2;
        let fit = pava(t.map((a, m) => a - off[m])).map((y, m) => y + off[m]);
        // if the fitted ring closes on itself (its first and last neuron overlap across the cut), fall back to even spacing around the mean want
        if (fit[n - 1] - fit[0] > 2 * Math.PI - (pitch(seq[n - 1]) + pitch(seq[0])) / 2) { const mid = (fit[0] + fit[n - 1]) / 2; fit = off.map(o => mid - span / 2 + o + pitch(seq[0]) / 2); }
        ang = new Array(n); seq.forEach((i, m) => { ang[i] = fit[m] + base; });
      }
      ps.forEach((p, i) => {
        p.ga = ang[i]; p.gux = Math.cos(p.ga); p.guy = Math.sin(p.ga);
        if (R === 0) { p.gux = 0; p.guy = -1; p.ga = -Math.PI / 2; origin.add(p); }   // the lone centre: ladder down, sub-neurons up
        p.gx = p.gux * R + (g.ox || 0) + (p.gox || 0); p.gy = p.guy * R + (g.oy || 0) + (p.goy || 0);
        placeKidsRadial(p); p.grp = g; placed.add(p);
      });
      g.loci = ps; g.hubOn = null; g.on = ps.length > 0; g.R = R; g.ws = ws;
      g.kidR = Math.max(0, ...ps.map(kidOut)); g.inward = inward;
      const lobesIn = new Set(ps.map(p => p.lobe));
      g.color = lobesIn.size === 1 ? lobeById[ps[0].lobe]?.color || '#9aa' : '#a7b2cc';
      g.name = (D.rings && (D.rings[rid] || D.rings[String(rid)])) || (ri === 0 && ps.length === 1 && ps[0].isCenter ? ps[0].title : lobesIn.size === 1 ? lobeById[ps[0].lobe].name : `ring ${rid}`);
      prevOut = R === 0 ? Math.max(g.kidR, ...ps.map(synReach)) : g.kidR;   // the lone centre's own ladder runs outward too
      orbits.push(g);
    });
    // rings whose lobes are all hidden keep their group (and a hand-moved or saved offset) for when they come back; they draw, fit and report nothing
    const shown = new Set(ringIds);
    [...new Set(pages.filter(p => !isChild(p)).map(ringOf))].filter(rid => !shown.has(rid)).forEach(rid => {
      const g = prev[rid] || { id: 'ring-' + rid, ring: rid, ox: 0, oy: 0 };
      g.loci = []; g.on = false; g.hubOn = null; g.R = g.R || 0; g.ws = []; g.kidR = 0; g.inward = 0; orbits.push(g);
    });
    orbits.sort((a, b) => a.ring - b.ring);
    if (snap) snapToMap();
  }
  const relayout = snap => {
    // Every map records its viewport, including aspect-independent Orbit,
    // Periodic and Structured maps which never call rowsFor().
    layoutAspect = (W || 1600) / (H || 900);
    if (genome()) layoutGenome(snap); else if (cell()) layoutCell(snap); else if (tree()) layoutTree(snap); else if (table()) layoutTable(snap); else if (coil()) layoutCoil(snap); else if (orbit()) layoutOrbit(snap); else if (horizon()) layoutHorizon(snap);
  };
  let mouseW = null;                      // cursor in world units, for lobe hover while labels are off
  // tools: 'select' = left-drag draws a marquee and moves neurons; 'pan' = left-drag pans (the classic behaviour)
  let mode = 'select', spaceDown = false;
  const multi = new Set();              // marquee-selected neurons; dragging one moves them all
  let marquee = null;                   // {x0,y0,x1,y1} in screen px while a marquee is open
  let drag = null;                      // {nodes:[{n,x,y}], sx, sy} while neurons are being moved
  let W = 0, H = 0, dpr = 1, searchBox = null;
  let activeNodes = [], activeLinks = [];

  // a sub-neuron is shown only while both its own lobe and its parent's lobe are on
  const pageOn = p => lobeOn[p.lobe] && (!p.parent || lobeOn[p.parent.lobe]);
  const visible = n => n.kind === 'page' ? pageOn(n) : n.kind === 'syn' ? pageOn(pageById[n.page]) : n.pageNodes.some(pageOn);
  // which side of a neuron its synapse ladder (and its label) takes in the ladder layouts: genome puts sub-neurons' on the left; the tree puts the ancestor's own sub-neurons' on the left
  const ladderSide = p => genome() ? (isChild(p) ? -1 : 1) : tree() && isChild(p) && !p.parent.grp ? -1 : 1;
  if (mapped()) relayout(true);

  // ---------- simulation ----------
  // a link that leaves a brain's own lobes (into a shared lobe or another brain) is long and slack on the network screen
  const lobeBrain = id => lobeById[id]?.brain || null;
  const crossBrain = l => !!brainsIn && lobeBrain(l.source.lobe) !== lobeBrain(l.target.lobe);
  const linkDist = l => {
    if (l.kind === 'pp') return (l.source.type === 'day' || l.target.type === 'day' ? 170 : crossBrain(l) ? 420 : l.source.lobe !== l.target.lobe ? 200 : 78 + 12 * (5 - Math.min(l.w, 4)) + 30) + explodeF * (orbitR(l.source) + orbitR(l.target)) * 0.7;
    if (l.kind === 'st') return 4 + explodeF * orbitR(l.target);
    if (l.kind === 'sx') return 110;
    if (l.kind === 'sr') return 12 + explodeF * (44 + (l.source.pageNodes.length > 1 ? 30 : 0));
    if (l.kind === 'pc') return 2 + depthF * (childRingR(l.target) + explodeF * orbitR(l.source) * 0.5);
    return 160;
  };
  const linkStrength = l => {
    // in the genome layout every neuron is held at its locus and every synapse at its rung, so connections are drawn but do not pull;
    // only a source's tether to its (first) neuron remains, so the sparks stay with their citation
    if (mapped() && l.kind !== 'sr') return 0;
    if (l.kind === 'pp') return l.source.type === 'day' || l.target.type === 'day' ? 0.02 : crossBrain(l) ? 0.015 : l.source.lobe !== l.target.lobe ? 0.08 : 0.3;
    if (l.kind === 'st') return 0.15;
    if (l.kind === 'sx') return 0.03;
    if (l.kind === 'sr') return l.source.pageNodes.length > 1 ? 0.12 : 0.5;
    if (l.kind === 'pc') return 0.6;
    return 0.01;
  };
  const charge = n => mapped() ? -2 : n.isCenter ? -1200 : isChild(n) ? -(30 + n.nSyn * 3) * depthF - 1 : -200 - n.nSyn * 7 - n.children.length * 40;
  // pages repel only pages; synapses and sources are held by tethers + collision, so they orbit instead of being blasted away
  const pageCharge = d3.forceManyBody().strength(charge).theta(0.9).distanceMax(900);
  const chargeForce = Object.assign(a => pageCharge(a), { initialize: (nodes, rnd) => pageCharge.initialize(nodes.filter(n => n.kind === 'page'), rnd), strength: f => (pageCharge.strength(f), chargeForce) });
  // genome layout: a folded sub-neuron sits inside its parent, so it must not collide with it until it has unfolded
  const collideR = n => n.kind === 'page' ? (mapped() ? (isChild(n) ? depthF : 1) * (n.r + 4) : n.r + 6) : n.kind === 'syn' ? (mapped() ? 2.5 : 1 + 4 * explodeF) : 1 + 3.5 * explodeF;
  // page-only collision keeps whole synapse clouds from overlapping once exploded
  const pageCollideR = n => mapped() ? (isChild(n) ? depthF : 1) * (n.r + 2) : isChild(n) ? depthF * (n.r + 6 + explodeF * (n.nSyn ? orbitR(n) + 8 : 0)) : n.r + 10 + explodeF * (n.nSyn ? orbitR(n) + 14 : 0) + depthF * (n.children.length ? 20 : 0);
  const pageCollide = d3.forceCollide().radius(pageCollideR).strength(0.7).iterations(2);
  const pageCollideForce = Object.assign(a => pageCollide(a), { initialize: (nodes, rnd) => pageCollide.initialize(nodes.filter(n => n.kind === 'page'), rnd), radius: f => (pageCollide.radius(f), pageCollideForce) });
  // orbit force: each synapse seeks an evenly spaced slot around its neuron (the dandelion explosion)
  function orbitForce(alpha) {
    const st = 0.3 * alpha;
    const ladder = genome() || tree(), c = cell(), tb = radial();
    for (const n of activeNodes) {
      if (n.kind !== 'syn') continue;
      const p = pageById[n.page], m = p.nSyn;
      if (ladder) {   // genome and tree layouts: a ladder of synapses on the locus line, to the right of the bar (to the left of a sub-neuron)
        const gx = p.x + ladderSide(p) * ((p.r * 1.3 + 8 + n.ordinal * SYN_PITCH) * explodeF + 2);
        n.vx += (gx - n.x) * st; n.vy += (p.y - n.y) * st; continue;
      }
      if (tb) {   // table layout: the same ladder along the radius, laid on the table for a neuron and running outward for a sub-neuron
        const side = isChild(p) ? 1 : -1, d = (p.r * 1.3 + 8 + n.ordinal * SYN_PITCH) * explodeF + 2;
        n.vx += (p.x + side * (p.gux || 0) * d - n.x) * st; n.vy += (p.y + side * (p.guy || 0) * d - n.y) * st; continue;
      }
      const a = p.spin + (n.ordinal / m) * Math.PI * 2;
      // karyocyte layout: one tight ring inside the neuron's slot, so a cell never spills into its neighbour's
      const rr = c ? synRing(p) * explodeF + 2 : (orbitR(p) + (n.ordinal % 2 ? 7 : -5)) * explodeF + 2;
      n.vx += (p.x + Math.cos(a) * rr - n.x) * st; n.vy += (p.y + Math.sin(a) * rr - n.y) * st;
    }
  }

  function childOrbitForce(alpha) {
    const st = 0.25 * alpha * depthF;
    if (st <= 0 || mapped()) return;   // maps: sub-neurons are anchored to their own slot instead
    for (const n of activeNodes) {
      if (!isChild(n)) continue;
      const p = n.parent, m = p.children.length, i = p.children.indexOf(n);
      const a = p.spin + Math.PI / 2 + (i / m) * Math.PI * 2, rr = childRingR(p);
      n.vx += (p.x + Math.cos(a) * rr - n.x) * st; n.vy += (p.y + Math.sin(a) * rr - n.y) * st;
    }
  }
  const lobeSize = {}; pages.forEach(p => { if (!isChild(p)) lobeSize[p.lobe] = (lobeSize[p.lobe] || 0) + 1; });
  // on the shared network screen the lobes hold their ground harder, otherwise the many links into the shared neurons drag every brain into the middle
  // genome layout: every neuron (sub-neurons included) is pulled firmly onto its locus; the lobe anchors are not used
  const anchorX = n => mapped() && n.gx !== undefined ? (isChild(n) ? n.parent.gx + depthF * n.gdx : n.gx) : anchor[n.lobe]?.x ?? 0;
  const anchorY = n => mapped() && n.gy !== undefined ? (isChild(n) ? n.parent.gy + depthF * n.gdy : n.gy) : anchor[n.lobe]?.y ?? 0;
  const anchorStrength = n => n.kind !== 'page' ? 0 : mapped() ? (n.gx !== undefined ? 0.9 : 0) : isChild(n) ? 0.02 : isSelf(n) ? (brainsIn ? 0.9 : 0.6) : n.type === 'day' ? 0.5 : (lobeSize[n.lobe] <= 4 ? 0.55 : lobeSize[n.lobe] <= 10 ? 0.4 : 0.22) * (brainsIn ? 1.7 : 1);
  const sim = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.id).distance(linkDist).strength(linkStrength))
    .force('charge', chargeForce)
    .force('collide', d3.forceCollide().radius(collideR).iterations(2))
    .force('orbit', orbitForce)
    .force('childOrbit', childOrbitForce)
    .force('pageCollide', pageCollideForce)
    .force('x', d3.forceX(anchorX).strength(anchorStrength))
    .force('y', d3.forceY(anchorY).strength(anchorStrength))
    .alphaDecay(0.03).velocityDecay(0.35)
    .stop();

  function rebuild(warm) {
    if (mapped()) relayout(false);
    const vp = pages.filter(visible);
    const vs = syns.filter(visible);
    const vr = srcs.filter(visible);
    activeNodes = [...vp, ...vs, ...vr];
    const on = new Set(activeNodes);
    // genome layout: a source cited by several neurons would pull them together, so it is tethered to its first neuron only
    const srcT = mapped() ? srcTethers.filter(l => l.source.pageNodes.find(on.has, on) === l.target) : srcTethers;
    activeLinks = [...pageLinks, ...childTethers, ...synTethers, ...synCross, ...srcT, ...(showCocite ? cociteLinks : [])]
      .filter(l => on.has(l.source) && on.has(l.target));
    sim.nodes(activeNodes);
    sim.force('link').links(activeLinks);
    if (warm) { sim.alpha(1); for (let i = 0; i < (brainsIn ? 420 : 260); i++) sim.tick(); }
    sim.alpha(warm ? 0.25 : 0.5).restart();
    updateStats();
  }
  // D3 caches per-node strengths/radii when an accessor is set, so re-set them whenever explodeF/depthF move
  function refreshForces() {
    sim.force('link').distance(linkDist).strength(linkStrength); sim.force('charge').strength(charge); sim.force('collide').radius(collideR); sim.force('pageCollide').radius(pageCollideR);
    sim.force('x').x(anchorX).strength(anchorStrength); sim.force('y').y(anchorY).strength(anchorStrength);
  }

  // ---------- canvas / camera ----------
  // Home is the fitted camera for the visible neurons, centred on the free stage (the canvas minus the chrome on top of it). The scale
  // floor hangs off Home, so the whole brain is always reachable; a gesture that ends past Home eases back to it (a rubber band).
  const K_MAX = 9, FLOOR = 0.75;         // floor as a share of Home: the brain shrinks to three quarters while a gesture runs past the whole brain
  let kMin = 0.08, home = null, atHome = false, homing = false, homeSeq = 0, bbox = null, free = null;   // homing: a transition toward Home is in flight (homeSeq: the latest one owns the flag); bbox/free: the fitted world box and the free stage it was fitted to
  // the stage minus the chrome actually drawn over it (header, lobes legend, right rail, level pill); measured, never hard-coded
  function freeRect() {
    const rect = el => { if (!el || el.hidden) return null; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? b : null; };
    const mobile = window.innerWidth <= 900;
    const top = rect(document.getElementById('top')), lob = rect(document.getElementById('lobes')), head = rect(document.querySelector('#lobes .lobes-head')),
      rail = rect(document.querySelector('.rail')), level = rect(document.querySelector('.level'));
    let l = 0, r = W, t = top ? Math.min(top.bottom, H * 0.3) : 0, b = H;
    if (rail) r = rail.left;
    if (!mobile) { if (lob) l = lob.right; if (level) b = level.top; }
    else b = H - 64 - (head ? head.height + 16 : 30);   // the collapsed lobes header above the level pill; an open sheet does not move Home
    const m = 20, w = Math.max(160, r - l - 2 * m), h = Math.max(160, b - t - 2 * m);
    return { l: l + m, r: l + m + w, t: t + m, b: t + m + h, w, h, cx: l + m + w / 2, cy: t + m + h / 2 };
  }
  function resize() {
    const previousWidth=W, previousHeight=H;
    const first = W === 0;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    { const qb = document.getElementById('q'), r = qb && (qb.closest('.search, form, label') || qb).getBoundingClientRect(); searchBox = r ? { l: r.left, r: r.right, t: r.top, b: r.bottom } : null; }   // table cards keep clear of the search bar
    canvas.width = W * dpr; canvas.height = H * dpr;
    if(previousWidth>0&&previousHeight>0&&W>0&&H>0){
      if (homing) { if (refreshHome()) goHome(600, d3.easeCubicOut); }   // a resize under the intro (a phone's address bar) retargets it instead of stranding the camera mid-flight
      else if (atHome && refreshHome()) d3.select(canvas).interrupt().call(zoom.transform, homeT());   // an untouched camera follows Home (rotation, address bar, window drag)
      else if (W !== previousWidth || H !== previousHeight) {
        const ratio=Math.min(W,H)/Math.min(previousWidth,previousHeight);
        refreshHome();
        d3.select(canvas).interrupt().call(zoom.transform,d3.zoomIdentity.translate(W/2+(tx-previousWidth/2)*ratio,H/2+(ty-previousHeight/2)*ratio).scale(Math.min(K_MAX, Math.max(kMin, k*ratio))));
      }
    }
    // the karyogram picks its row count from the viewport aspect, so once the shape drifts far from the one it was laid out for (a rotation, or a long window drag) it re-lays out and refits
    if (!first && mapped() && Math.abs(W / Math.max(1, H) - layoutAspect) > 0.25) { pages.forEach(n => { if (n.pinned) { n.pinned = false; n.fx = null; n.fy = null; } }); relayout(false); refreshForces(); rebuild(false); sim.alpha(0.6).restart(); setTimeout(() => fitAll(500), 350); }   // fit once the pages have moved toward the new loci, as the G toggle does
  }
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);   // phone address bar and keyboard
  resize();

  // panning: wheel and touch always; the mouse pans with the left button in Pan mode, with the middle/right button (or Space) in
  // Select mode, and never when the press lands on a neuron, because that press moves the neuron instead
  const zoom = d3.zoom().scaleExtent([kMin, K_MAX])
    .constrain(t => {
      // soft bounds: the brain's screen box keeps at least a quarter of the free stage covered on each axis, so a brain cannot be flung off
      // screen; zoomTo and fitAll set the camera directly and are not constrained, so a far neuron can still be centred
      if (!bbox) return t;
      const F = free || freeRect(), q = 0.25;
      const bx0 = t.x + bbox.x0 * t.k, bx1 = t.x + bbox.x1 * t.k, by0 = t.y + bbox.y0 * t.k, by1 = t.y + bbox.y1 * t.k;
      const mx = Math.min(F.w, bx1 - bx0) * q, my = Math.min(F.h, by1 - by0) * q;
      const dx = Math.max(0, F.l + mx - bx1) - Math.max(0, bx0 - (F.r - mx)), dy = Math.max(0, F.t + my - by1) - Math.max(0, by0 - (F.b - my));
      return dx || dy ? d3.zoomIdentity.translate(t.x + dx, t.y + dy).scale(t.k) : t;
    })
    .on('start', ev => { if (ev.sourceEvent) atHome = false; })
    .on('zoom', ev => { k = ev.transform.k; tx = ev.transform.x; ty = ev.transform.y; updateLevel(); })
    // fully out means Home: a gesture or zoom button that ends past the whole brain settles back on it, centred. A gesture that interrupts a
    // transition in flight ends that transition first (homing is still set, and d3 hands it the gesture's event), which must not settle again
    .on('end', ev => {
      if (!homing && isHome()) atHome = true;   // a press/release without movement still follows Home
      if (ev.sourceEvent && home && !atHome && !homing && k < home.kk * 0.98) fitAll(450);
    })
    .filter(ev => {
      if (ev.type === 'wheel' || ev.type.startsWith('touch')) return !ev.ctrlKey || ev.type === 'wheel';
      if (ev.type !== 'mousedown') return !ev.button;
      const onNeuron = pick(ev.clientX, ev.clientY)?.kind === 'page';
      if (ev.button === 1 || ev.button === 2) return !onNeuron;
      return ev.button === 0 && (mode === 'pan' || spaceDown) && !onNeuron;
    });
  d3.select(canvas).call(zoom).on('dblclick.zoom', null);

  const toWorld = (sx, sy) => [(sx - tx) / k, (sy - ty) / k];
  const toScreen = (x, y) => [x * k + tx, y * k + ty];

  // the transform that shows the whole brain: data-space margins for the lobe rings, plus screen-space room for the lobe titles,
  // which are drawn at a fixed pixel size and on the network screen sit outside the rings
  function fitTransform() {
    const vp = pages.filter(p => visible(p) && !isChild(p));
    const xs = vp.map(p => p.x), ys = vp.map(p => p.y);
    const mx = genome() ? 120 : tree() ? 60 : cell() ? 40 : radial() ? 120 : brainsIn ? 260 : 150, my = genome() ? 150 : tree() ? 80 : cell() ? 40 : radial() ? 120 : brainsIn ? 260 : 170;
    // the table is fitted as a whole: a sparse brain's chairs cover only part of a ring that still has to be on screen, with room behind the chairs for sub-neurons
    if (coil()) { xs.push(-coilR * 1.15, coilR * 1.15); ys.push(-coilR * CL.ry, coilR * CL.ry + 14 + coilR * CL.body + 16); }
    // the orbit layout fits every ring around its own (hand-moved) centre, with room past it for the sub-neurons standing outside their parents
    if (orbit()) orbits.filter(g => g.on).forEach(g => { const tr = g.R + OB.band / 2 + g.kidR, ox = g.ox || 0, oy = g.oy || 0; xs.push(ox - tr, ox + tr); ys.push(oy - tr, oy + tr); });
    if (table()) { const tr = tableR + TB.ring / 2 + Math.max(0, ...seats.filter(c => c.on).map(c => c.kidR)); xs.push(-tr, tr); ys.push(-tr, tr); }
    if (horizon()) { const hr = horizonOuter(); xs.push(-hr, hr); ys.push(-hr * 1.04, hr * 1.04); }   // the jets reach a little past the outer orbit
    // the family tree fits its plates and spines, which stand above and beside the neurons
    if (tree()) branches.filter(b => b.on).forEach(b => { xs.push(b.x0, b.x1); ys.push(b.py - T.plateH, b.y1); });
    // the karyocyte layout fits its membranes, which reach well past the outermost neuron
    if (cell()) cells.filter(c => c.on).forEach(c => { xs.push(c.cx - c.Rc, c.cx + c.Rc); ys.push(c.cy - c.Rc, c.cy + c.Rc); });
    const minX = Math.min(...xs) - mx, maxX = Math.max(...xs) + mx, minY = Math.min(...ys) - my, maxY = Math.max(...ys) + my;
    bbox = { x0: minX, x1: maxX, y0: minY, y1: maxY };
    const F = free = freeRect();
    // pixels reserved for titles beside/above the outer lobes (above the bars or cells in the maps); capped at a tenth of the free width so a phone keeps most of its screen for the brain
    const lx = Math.min(F.w * 0.1, brainsIn && !mapped() ? 210 : radial() ? 130 : 0), ly = genome() || cell() ? 40 : radial() ? 45 : brainsIn && !mapped() ? 30 : 0;
    const kk = Math.min((F.w - 2 * lx) / (maxX - minX), (F.h - 2 * ly) / (maxY - minY)) * 0.96;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { kk, tx: F.cx - cx * kk, ty: F.cy - cy * kk };
  }
  // Home and the scale floor move together; call after anything that changes the fitted box (layout, lobes, viewport)
  function refreshHome() {
    const f = fitTransform(); if (!(f.kk > 0)) return null;   // a very short canvas can make the fitted scale non-positive, which would mirror the map
    home = f; kMin = f.kk * FLOOR; zoom.scaleExtent([kMin, K_MAX]);
    return home;
  }
  const homeT = () => d3.zoomIdentity.translate(home.tx, home.ty).scale(home.kk);
  const isHome = () => !!home && Math.abs(k - home.kk) < 1e-6 && Math.abs(tx - home.tx) < 0.5 && Math.abs(ty - home.ty) < 0.5;   // the camera really rests at Home (a gesture may have run under the transition)
  function goHome(dur, ease = d3.easeCubicInOut) {
    const id = ++homeSeq; homing = true;   // a newer goHome pre-empts this one: d3 fires its interrupt/cancel, which must not clear the flag the newer one owns
    d3.select(canvas).transition().duration(dur).ease(ease).call(zoom.transform, homeT())
      .on('end', () => { if (id === homeSeq) { homing = false; atHome = isHome(); } })
      .on('interrupt cancel', () => { if (id === homeSeq) homing = false; });
  }
  function fitAll(dur = 900) { if (refreshHome()) goHome(dur); }
  // after Home moved under a resting camera (a lobe shown or hidden): a camera at the old Home follows to the new one, and a camera the new
  // floor overtook settles the way a gesture past Home does; the floor alone never moves the camera until the next gesture clamps it
  function settleToHome() { if (home && (homing || atHome || k < kMin)) fitAll(450); }
  function zoomTo(n, kk, dur = 1100) {
    const mobile = window.innerWidth <= 900;
    const panelW = mobile ? 0 : 380;
    const cy = mobile ? H * 0.24 : H / 2;
    const t = d3.zoomIdentity.translate((W - panelW) / 2 - n.x * kk, cy - n.y * kk).scale(kk);
    atHome = false;
    d3.select(canvas).transition().duration(dur).ease(d3.easeCubicInOut).call(zoom.transform, t);
  }

  // ---------- colour helpers ----------
  const colorCache = {};
  function rgba(hex, a) {
    a = Math.round(a * 200) / 200;   // quantised so per-frame flicker (coil discharge, sparks) cannot grow the cache without bound
    const key = hex + a; if (colorCache[key]) return colorCache[key];
    const c = d3.color(hex); c.opacity = a; return (colorCache[key] = c.formatRgb());
  }
  // grown material (grow.js: the Quantum Entangler) carries an origin tag and is painted in that origin's colour (MBN.originColors), never its lobe's
  const originColor = n => (n && n.origin && window.MBN && window.MBN.originColors && window.MBN.originColors[n.origin]) || null;
  const lobeColor = n => originColor(n) || lobeById[n.lobe]?.color || '#9aa';
  const clamp01 = v => Math.max(0, Math.min(1, v));

  // ---------- pulses (signals travelling along connections) ----------
  const pulses = [];
  // electric synapses (data-gated): a page with `spark: true` (or every page when the dataset says `spark: true`) discharges. Its synapse
  // tethers are drawn as small lightning strokes and its outgoing connections carry bolts instead of beads: a pulse always leaves the
  // sparking neuron, and a synapse that reaches another neuron fires toward it. Other brains render exactly as before.
  const sparkOf = n => n.spark !== undefined ? !!n.spark : !!D.spark, sparkAny = !!D.spark || pages.some(p => p.spark);
  const sparkDir = l => (sparkOf(l.source) && !sparkOf(l.target) ? 1 : sparkOf(l.target) && !sparkOf(l.source) ? -1 : Math.random() < 0.5 ? 1 : -1);
  // radiation: a neuron that sets `radiate` (or a page that sets it for every neuron) emits Hawking pairs: a quantum is born at its rim and
  // escapes along a connection while its partner falls back in and fades; the neuron dips a fraction and recovers (evaporation), and the
  // smaller a neuron the more often it radiates (temperature runs inverse to mass). Without the field nothing radiates and nothing changes.
  const radiateOf = n => n.radiate !== undefined ? !!n.radiate : !!D.radiate, radiateAny = !!D.radiate || pages.some(p => p.radiate);
  const radiateDir = l => (radiateOf(l.source) && !radiateOf(l.target) ? 1 : radiateOf(l.target) && !radiateOf(l.source) ? -1 : Math.random() < 0.5 ? 1 : -1);
  const hubPages = pages.filter(p => isSelf(p) && !isChild(p));   // the horizon: a quantum falling toward a hub slows as it nears it
  function spawnPulse(l, fast, spark, radiate, rdir) {
    if (!l || pulses.length > 60) return;
    if (radiate) {   // the pair: the escaping quantum rides the connection; its partner lives on the emitting neuron and falls back into it (rdir: the direction the caller already chose)
      const dir = rdir || (l.kind === 'sx' ? 1 : radiateDir(l)), src = dir > 0 ? l.source : l.target, emitter = src.kind === 'syn' ? pageById[src.page] : src;
      pulses.push({ l, t: 0, speed: 0.012 + Math.random() * 0.005, dir, radiate: true, seed: Math.floor(Math.random() * 1e6) });
      pulses.push({ l, t: 0, speed: 0.03 + Math.random() * 0.01, dir, partner: true, seed: 0 });
      if (emitter) emitter.evap = 1;
      return;
    }
    const sp = spark || (l.kind === 'pp' && (sparkOf(l.source) || sparkOf(l.target)));
    pulses.push({ l, t: 0, speed: (fast ? 0.028 : sp ? 0.016 : 0.009) + Math.random() * 0.006, dir: l.kind === 'sx' ? 1 : sp ? sparkDir(l) : Math.random() < 0.5 ? 1 : -1, spark: sp, seed: Math.floor(Math.random() * 1e6) });
  }
  let lastPulse = 0, lastSpark = 0, lastDischarge = 0, lastRadiate = 0;
  // a lightning stroke from one point to another: kinks displaced across the line by hashed amounts that re-roll every 90 ms (the flicker)
  function bolt(x0, y0, x1, y1, seed, amp, n = 4) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, f = reduceMotion ? 0 : Math.floor(performance.now() / 90);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < n; i++) { const t = i / n, z = hash01(seed + i * 131, f) * 2 - 1; ctx.lineTo(x0 + dx * t + nx * z * amp, y0 + dy * t + ny * z * amp); }
    ctx.lineTo(x1, y1);
  }
  const linkSeed = l => l.seed || (l.seed = 1 + Math.floor(hash01((l.source.idx ?? l.source.i ?? 3) * 17 + 5, (l.target.idx ?? l.target.i ?? 7) * 29 + 11) * 1e6));

  // ---------- map drawing ----------
  // connections bend in the maps: along one chromosome or branch they bow out to the right like a Circos ribbon, inside one cell they bow
  // toward the nucleolus, and between groups they arch
  const ctrlOf = l => {
    if (!mapped() || l.kind !== 'pp') return null;   // only page links are drawn curved; synapse bolts (sx) stay straight, so their pulses must too
    const a = l.source, b = l.target, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (orbit()) {   // between rings a connection runs straight, like a spoke; along one ring it bows a little toward the centre
      if (sameGroup(a, b)) { const g = grpOf(a), dx = mx - (g.ox || 0), dy = my - (g.oy || 0), d = Math.hypot(dx, dy) || 1, pull = Math.min(60, 6 + Math.hypot(b.x - a.x, b.y - a.y) * 0.2); return [mx - dx / d * pull, my - dy / d * pull]; }
      return [mx, my];
    }
    if (table()) {   // chords across the table bow toward the empty centre; neighbours at one seat take a shallow arc just inside the ring
      if (sameGroup(a, b)) { const d = Math.hypot(mx, my) || 1, pull = Math.min(90, 10 + Math.hypot(b.x - a.x, b.y - a.y) * 0.3); return [mx - mx / d * pull, my - my / d * pull]; }
      return [mx * 0.3, my * 0.3];
    }
    if (horizon()) {   // light bends toward the hole: a chord across the disk bows toward the horizon; neighbours on one arc take a shallow arc just inside it
      if (sameGroup(a, b)) { const d = Math.hypot(mx, my) || 1, pull = Math.min(90, 10 + Math.hypot(b.x - a.x, b.y - a.y) * 0.3); return [mx - mx / d * pull, my - my / d * pull]; }
      return [mx * 0.22, my * 0.22];
    }
    if (coil()) {   // inside one streamer a connection bows a little toward the terminal; across streamers it arches through the toroid's sky
      if (sameGroup(a, b)) return [mx * 0.82, my * 0.82];
      return [mx * 0.3, my * 0.3];
    }
    if (sameGroup(a, b)) {
      if (cell()) { const c = grpOf(a); return [mx + (c.cx - mx) * 0.35, my + (c.cy - my) * 0.35]; }
      return [mx + G.barW / 2 + 22 + Math.abs(b.y - a.y) * 0.25, my];
    }
    return [mx, my - Math.min(260, 14 + Math.abs(b.x - a.x) * 0.16)];
  };
  const linkPoint = (l, s, e, t) => { const c = ctrlOf(l); if (!c) return [s.x + (e.x - s.x) * t, s.y + (e.y - s.y) * t]; const u = 1 - t; return [u * u * s.x + 2 * u * t * c[0] + t * t * e.x, u * u * s.y + 2 * u * t * c[1] + t * t * e.y]; };
  // break a chromosome title into up to three lines that fit the column; the last line is cut with an ellipsis
  function wrapTitle(text, maxW, lines = 3) {
    const words = String(text).split(/\s+/), out = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { out.push(cur); cur = w; } }
    if (cur) out.push(cur);
    if (out.length > lines) { out.length = lines; let last = out[lines - 1]; while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1); out[lines - 1] = last + '…'; }
    return out;
  }
  function roundRect(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  // a group title drawn at screen size (like the lobe titles): a name in the group colour and a count line, anchored at a world point.
  // pitchPx is the room the group has on screen; names fade out once the groups are too tight to hold them
  // coil layout: the apparatus beneath the toroid, the toroid, the channels (glow and core, flickering), the discharges, the streamer titles
  function drawCoil(titleVis, tl) {
    const sw = px => px / k, now = performance.now(), frame = reduceMotion ? 0 : Math.floor(now / 90);
    const flick = (i, j) => reduceMotion ? 1 : 0.72 + 0.56 * hash01(i * 31 + j, frame);
    const hubL = lobes.find(selfLobe), base = hubL ? hubL.color : '#a7b2cc', ry = coilR * CL.ry;
    // the secondary winding: a cylinder of turns beneath the toroid; the primary: three wide flat turns at its foot; a base plate
    const w2 = coilR * 0.5, y0 = ry + 14, hgt = coilR * CL.body;
    ctx.fillStyle = rgba(base, 0.035); ctx.fillRect(-w2, y0 + 12, 2 * w2, hgt - 60);
    ctx.lineWidth = sw(1);
    for (let i = 0; i < CL.turns; i++) { const y = y0 + 12 + (hgt - 60) * (i / (CL.turns - 1)); ctx.beginPath(); ctx.ellipse(0, y, w2, w2 * 0.16, 0, 0, Math.PI * 2); ctx.strokeStyle = rgba(base, i % 2 ? 0.17 : 0.1); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-w2, y0 + 12); ctx.lineTo(-w2, y0 + hgt - 48); ctx.moveTo(w2, y0 + 12); ctx.lineTo(w2, y0 + hgt - 48); ctx.strokeStyle = rgba(base, 0.22); ctx.stroke();
    ctx.lineWidth = sw(2.2);
    [0.74, 0.86, 0.98].forEach((f, i) => { ctx.beginPath(); ctx.ellipse(0, y0 + hgt - 40 + i * 11, coilR * f, coilR * f * 0.2, 0, 0, Math.PI * 2); ctx.strokeStyle = rgba('#a7b2cc', 0.2); ctx.stroke(); });
    ctx.beginPath(); ctx.ellipse(0, y0 + hgt, coilR * 1.1, coilR * 0.22, 0, 0, Math.PI * 2); ctx.fillStyle = rgba('#a7b2cc', 0.05); ctx.fill(); ctx.lineWidth = sw(1); ctx.strokeStyle = rgba('#a7b2cc', 0.18); ctx.stroke();
    // the stem from the winding up into the toroid
    ctx.beginPath(); ctx.moveTo(0, y0 + 12); ctx.lineTo(0, ry * 0.4); ctx.lineWidth = sw(3); ctx.strokeStyle = rgba(base, 0.25); ctx.stroke();
    // the toroid: a ring seen from a little above, its hole dark, its upper rim lit by the discharge
    ctx.beginPath(); ctx.ellipse(0, 0, coilR, ry, 0, 0, Math.PI * 2); ctx.fillStyle = rgba(base, 0.08); ctx.fill(); ctx.lineWidth = sw(2.4); ctx.strokeStyle = rgba(base, 0.55 * flick(7, 7)); ctx.stroke();
    ctx.lineWidth = sw(9); ctx.strokeStyle = rgba(base, 0.1 * flick(7, 8)); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, coilR * 0.52, ry * 0.52, 0, 0, Math.PI * 2); ctx.fillStyle = rgba('#06080f', 0.45); ctx.fill(); ctx.lineWidth = sw(1.2); ctx.strokeStyle = rgba(base, 0.35); ctx.stroke();
    // the streamers
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    streamers.forEach(s => {
      if (!s.on) return;
      const ox = s.ox || 0, oy = s.oy || 0, si = streamerIdx[s.id] + 1;
      ctx.save(); ctx.translate(ox, oy);
      const hub = s.hubOn ? [s.hubOn.gx - ox, s.hubOn.gy - oy] : null;
      // the trunk: rim → hub → fork point (a brain on the network screen); for a plain lobe the rim is the fork point itself
      const trunk = [s.root, ...(hub ? [hub] : []), s.fork].filter((q, i, arr) => !i || q[0] !== arr[i - 1][0] || q[1] !== arr[i - 1][1]);
      const polys = [{ pts: trunk, col: s.color, j: 0 }, ...s.chains.map((c, j) => ({ pts: c.pts, col: c.l ? c.l.color : s.color, j: j + 1 }))];   // a chain's first point is where it leaves: the fork point, or its trunk's tip
      polys.forEach(({ pts, col, j }) => {
        if (pts.length < 2) return;
        ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.lineWidth = sw(8); ctx.strokeStyle = rgba(col, 0.075 * flick(si, j)); ctx.stroke();
        ctx.lineWidth = sw(1.4); ctx.strokeStyle = rgba(col, 0.6 * flick(si, j + 40)); ctx.stroke();
        ctx.lineWidth = sw(0.6); ctx.strokeStyle = rgba('#ffffff', 0.25 * flick(si, j + 80)); ctx.stroke();
      });
      // twigs: a short dead-end spark off most kinks, on the ladder side, gone once the ladders explode
      if (explodeF < 0.9) {
        ctx.lineWidth = sw(0.8);
        s.chains.forEach((c, j) => c.ps.forEach((p, i) => {
          const z = hash01(si * 97 + j, i + 500); if (z < 0.35) return;
          const L1 = 10 + z * 18, L2 = 6 + z * 8, a1 = p.gh - s.side * (0.9 + z * 0.8), a2 = a1 + (z - 0.5) * 1.6;
          const x1 = p.gx - ox + Math.cos(a1) * L1, y1 = p.gy - oy + Math.sin(a1) * L1;
          ctx.beginPath(); ctx.moveTo(p.gx - ox, p.gy - oy); ctx.lineTo(x1, y1); ctx.lineTo(x1 + Math.cos(a2) * L2, y1 + Math.sin(a2) * L2);
          ctx.strokeStyle = rgba(c.l ? c.l.color : s.color, 0.35 * (1 - explodeF) * flick(si + j, i + 120)); ctx.stroke();
        }));
      }
      ctx.restore();
    });
    // discharges: a bolt leaves the rim every so often and runs out along one channel to its tip
    if (!reduceMotion) {
      const on = streamers.filter(s => s.on && s.chains.length);
      if (on.length && now - lastDischarge > 380 && coilPulses.length < 14) {
        lastDischarge = now; const s = on[Math.floor(Math.random() * on.length)], c = s.chains[Math.floor(Math.random() * s.chains.length)];
        const path = [s.root, ...(s.hubOn ? [[s.hubOn.gx - (s.ox || 0), s.hubOn.gy - (s.oy || 0)]] : []), ...(s.fork !== s.root ? [s.fork] : []), ...(c.from ? c.from.pts.slice(1) : []), ...c.pts.slice(1)];
        const cum = [0]; for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
        if (cum[cum.length - 1] > 1) coilPulses.push({ s, c, path, cum, L: cum[cum.length - 1], t: 0, speed: 0.012 + Math.random() * 0.008, seed: Math.floor(Math.random() * 1e6) });
      }
      const at = (q, d) => { let i = 1; while (i < q.cum.length - 1 && q.cum[i] < d) i++; const f = (d - q.cum[i - 1]) / ((q.cum[i] - q.cum[i - 1]) || 1); return [q.path[i - 1][0] + (q.path[i][0] - q.path[i - 1][0]) * f, q.path[i - 1][1] + (q.path[i][1] - q.path[i - 1][1]) * f]; };
      for (let i = coilPulses.length - 1; i >= 0; i--) {
        const q = coilPulses[i]; q.t += q.speed; if (q.t >= 1) { coilPulses.splice(i, 1); continue; }
        const col = q.c.l ? q.c.l.color : q.s.color, a = Math.sin(q.t * Math.PI) * 0.9, ox = q.s.ox || 0, oy = q.s.oy || 0;
        const [x1, y1] = at(q, q.t * q.L), [x0, y0] = at(q, Math.max(0, q.t - 0.07) * q.L);
        ctx.beginPath(); bolt(x0 + ox, y0 + oy, x1 + ox, y1 + oy, q.seed, sw(3.5), 5);
        ctx.lineWidth = sw(6); ctx.strokeStyle = rgba(col, 0.3 * a); ctx.stroke();
        ctx.lineWidth = sw(1.6); ctx.strokeStyle = rgba('#ffffff', a); ctx.stroke();
        ctx.fillStyle = rgba('#ffffff', a); ctx.beginPath(); ctx.arc(x1 + ox, y1 + oy, sw(2), 0, Math.PI * 2); ctx.fill();
      }
    }
    // titles: a streamer's name beyond the tip of its longest channel; on the network screen the brain's name at its fork and each lobe's at its channel's tip
    const v = titleVis * Math.max(tl, 0.55);
    if (v > 0.02) streamers.forEach(s => {
      if (!s.on) return;
      const ox = s.ox || 0, oy = s.oy || 0;
      const tipOf = c => [c.x + ox + Math.cos(c.head) * 28, c.y + oy + Math.sin(c.head) * 28];
      if (s.lobesOn.length <= 1) { const c = s.tip; const [x, y] = c ? tipOf(c) : [s.fork[0] + ox, s.fork[1] + oy - 30]; drawGroupTitle(s, x, y, 160, v, { align: c && Math.cos(c.head) < -0.2 ? 'right' : c && Math.cos(c.head) > 0.2 ? 'left' : 'center' }); }
      else {
        const [fx, fy] = s.fork; drawGroupTitle(s, fx + ox - Math.cos(s.head) * 10, fy + oy - Math.sin(s.head) * 10 + 22, 160, v, { align: 'center' });
        const seen = new Set();
        s.chains.forEach(c => { if (!c.l || seen.has(c.l.id)) return; const best = s.chains.filter(x => x.l === c.l).reduce((m, x) => (x.len > m.len ? x : m)); seen.add(c.l.id); const [x, y] = tipOf(best); drawGroupTitle({ name: c.l.name, color: c.l.color, loci: best.ps }, x, y, 140, v * 0.85 * clamp01((k - 0.28) / 0.3), { align: Math.cos(best.head) < -0.2 ? 'right' : Math.cos(best.head) > 0.2 ? 'left' : 'center', count: false }); });
      }
    });
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';   // canvas state: the round caps must not leak into later strokes or frames
  }
  function drawGroupTitle(g, wx, wy, pitchPx, v, opts = {}) {
    const mobile = window.innerWidth <= 900, count = opts.count !== false;
    const fs = Math.max(9.5, Math.min(mobile ? 11 : 14, 10 + Math.sqrt(g.loci.length) * 1.2)), fs2 = Math.max(9, fs - 3);
    const [sx, sy] = toScreen(wx, wy);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.textAlign = opts.align || 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${fs}px 'Clash Display', 'Satoshi', sans-serif`; ctx.fillStyle = rgba(g.color, 0.9 * v);
    const lines = wrapTitle(g.name, Math.max(40, pitchPx)), dy = opts.below ? 0 : -(lines.length - 1) * (fs + 2);
    const y0 = opts.below ? sy + fs : sy - 10;
    lines.forEach((ln, i) => ctx.fillText(ln, sx, y0 + dy + i * (fs + 2)));
    if (count) {
      const subs = d3.sum(g.loci, p => p.children.filter(pageOn).length), syn = d3.sum(g.loci, p => p.nSyn) + (g.hubOn ? g.hubOn.nSyn : 0);
      ctx.font = `500 ${fs2}px 'Satoshi', sans-serif`; ctx.fillStyle = rgba('#a7b2cc', 0.8 * v);
      const cy = opts.below ? y0 + dy + lines.length * (fs + 2) : (opts.countAt ? toScreen(opts.countAt[0], opts.countAt[1])[1] + 8 + fs2 : y0 + fs2 + 4);
      ctx.fillText(`${g.loci.length + (g.hubOn ? 1 : 0)}${subs ? `+${subs}` : ''} · ${syn}`, sx, cy);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(tx, ty); ctx.scale(k, k);
  }
  // karyocyte layout: membrane, cytoplasm, nuclear envelope, chromosome territories and the nucleolus, titles for the territories and the cells
  function drawCells(titleVis, tl) {
    const sw = px => px / k;
    cells.forEach(c => {
      if (!c.on) return;
      const hovered = mouseW && Math.hypot(mouseW[0] - c.cx, mouseW[1] - c.cy) < c.Rc + 20;
      // membrane: a bilayer, then the cytoplasm
      ctx.beginPath(); ctx.arc(c.cx, c.cy, c.Rc, 0, Math.PI * 2); ctx.fillStyle = rgba(c.color, 0.035); ctx.fill();
      ctx.lineWidth = sw(2); ctx.strokeStyle = rgba(c.color, 0.4); ctx.stroke();
      const innerMembraneR = c.Rc - sw(5);
      if (innerMembraneR > 0) { ctx.beginPath(); ctx.arc(c.cx, c.cy, innerMembraneR, 0, Math.PI * 2); ctx.lineWidth = sw(1); ctx.strokeStyle = rgba(c.color, 0.18); ctx.stroke(); }
      // territories: wedges of the nucleus in each lobe's colour, from the nucleolus out to the envelope
      c.terr.forEach(t => {
        ctx.beginPath(); ctx.arc(c.cx, c.cy, c.Rn - 2, t.a0, t.a1); ctx.arc(c.cx, c.cy, c.hubR * 0.9, t.a1, t.a0, true); ctx.closePath();
        ctx.fillStyle = rgba(t.l.color, 0.10); ctx.fill();
        ctx.lineWidth = sw(0.8); ctx.strokeStyle = rgba(t.l.color, 0.16); ctx.stroke();
      });
      // nuclear envelope: a double line
      ctx.beginPath(); ctx.arc(c.cx, c.cy, c.Rn, 0, Math.PI * 2); ctx.fillStyle = rgba(c.color, 0.05); ctx.fill();
      ctx.lineWidth = sw(1.3); ctx.strokeStyle = rgba(c.color, 0.45); ctx.stroke();
      ctx.beginPath(); ctx.arc(c.cx, c.cy, c.Rn + sw(4), 0, Math.PI * 2); ctx.lineWidth = sw(0.8); ctx.strokeStyle = rgba(c.color, 0.18); ctx.stroke();
      // nucleolus: the dense body the hub sits in
      if (c.hubOn) { ctx.beginPath(); ctx.arc(c.cx, c.cy, c.hubR * 0.9, 0, Math.PI * 2); ctx.fillStyle = rgba(lobeColor(c.hubOn), 0.12); ctx.fill(); ctx.lineWidth = sw(1); ctx.strokeStyle = rgba(lobeColor(c.hubOn), 0.35); ctx.stroke(); }
      // territory names just outside the envelope, where the wedge points; the cell's name above the membrane on a network screen
      c.terr.forEach(t => {
        const mid = (t.a0 + t.a1) / 2, arcPx = (t.a1 - t.a0) * c.Rn * k;
        const th = mouseW && hovered && Math.hypot(mouseW[0] - c.cx, mouseW[1] - c.cy) < c.Rn + 10 && ((Math.atan2(mouseW[1] - c.cy, mouseW[0] - c.cx) - t.a0 + Math.PI * 4) % (Math.PI * 2)) < t.a1 - t.a0;
        const v = titleVis * Math.max(tl, th ? 1 : 0.55) * (th ? 1 : clamp01((arcPx - 24) / 30)); if (v < 0.02) return;
        const cs = Math.cos(mid), sn = Math.sin(mid), wx = c.cx + cs * (c.Rn + sw(14)), wy = c.cy + sn * (c.Rn + sw(14));
        drawGroupTitle({ name: t.l.name, color: t.l.color, loci: t.ps, hubOn: null }, wx, wy + (sn > 0 ? 0 : 0), Math.max(60, Math.min(180, arcPx)), v, { align: cs > 0.3 ? 'left' : cs < -0.3 ? 'right' : 'center', below: sn > 0 });
      });
      if (c.name) { const v = titleVis * Math.max(tl, hovered ? 1 : 0.55) * clamp01((2 * c.Rc * k - 30) / 40); if (v > 0.02) drawGroupTitle(c, c.cx, c.cy - c.Rc, Math.max(60, 2 * c.Rc * k), v, { countAt: [c.cx, c.cy + c.Rc] }); }
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  }
  // family tree layout: elbow connectors from the ancestor to the branch plates, from the plates to the neurons and from a neuron to its sub-neurons
  function elbow(x0, y0, x1, y1) { const mx = (x0 + x1) / 2; ctx.moveTo(x0, y0); ctx.lineTo(mx, y0); ctx.lineTo(mx, y1); ctx.lineTo(x1, y1); }
  function drawTree(titleVis, tl) {
    const sw = px => px / k;
    trees.forEach(t => {
      if (!t.on) return;
      const bs = t.branches.filter(b => b.on);
      // the trunk: down from the ancestor to a rail above the first generation of plates, then down into each plate; further generations
      // hang from the previous rail's left end, a staircase down the side
      if (t.rows.length) {
        const h = t.hubOn, rails = t.rows.map(r => ({ y: t.y + r.py - T.plateH / 2 - 26, x0: Math.min(...r.bs.map(b => b.x0)) - 30, bs: r.bs }));
        ctx.beginPath();
        if (h) { ctx.moveTo(h.x, h.y + h.r * 1.2); ctx.lineTo(h.x, rails[0].y); }
        rails.forEach((r, i) => {
          const xs = r.bs.map(b => b.cx), left = Math.min(h && i === 0 ? h.x : Infinity, r.x0, ...xs), right = Math.max(h && i === 0 ? h.x : -Infinity, ...xs);
          ctx.moveTo(left, r.y); ctx.lineTo(right, r.y);
          r.bs.forEach(b => { ctx.moveTo(b.cx, r.y); ctx.lineTo(b.cx, b.py - T.plateH / 2); });
          if (i + 1 < rails.length) { const nx = Math.min(r.x0, rails[i + 1].x0); ctx.moveTo(nx, r.y); ctx.lineTo(nx, rails[i + 1].y); rails[i + 1].x0 = nx; }
        });
        ctx.lineWidth = sw(1.2); ctx.strokeStyle = rgba(t.color, 0.35); ctx.stroke();
        // the ancestor's own sub-neurons hang off its left
        if (h && depthF > 0.03) { ctx.beginPath(); h.children.forEach(x => { if (pageOn(x)) elbow(h.x - h.r * 1.2, h.y, x.x + x.r * 1.3, x.y); }); ctx.lineWidth = sw(0.9); ctx.strokeStyle = rgba(lobeColor(h), 0.3 * depthF); ctx.stroke(); }
      }
      bs.forEach(b => {
        const px = b.cx - T.plateW / 2, pb = b.py + T.plateH / 2;
        // the plate, then a spine down the column with a tick into each neuron, and an elbow from a parent to each of its sub-neurons
        roundRect(px, b.py - T.plateH / 2, T.plateW, T.plateH, 8); ctx.fillStyle = rgba(b.color, 0.14); ctx.fill(); ctx.lineWidth = sw(1); ctx.strokeStyle = rgba(b.color, 0.5); ctx.stroke();
        const last = b.loci[b.loci.length - 1];
        ctx.beginPath(); ctx.moveTo(b.cx, pb); ctx.lineTo(b.cx, pb + 16); ctx.lineTo(b.sx, pb + 16); ctx.lineTo(b.sx, last.y);
        b.loci.forEach(p => { ctx.moveTo(b.sx, p.y); ctx.lineTo(p.x - p.r * 1.3, p.y); });
        ctx.lineWidth = sw(1); ctx.strokeStyle = rgba(b.color, 0.3); ctx.stroke();
        if (depthF > 0.03) { ctx.beginPath(); b.loci.forEach(p => p.children.forEach(x => { if (pageOn(x)) elbow(p.x + p.r * 1.3, p.y, x.x - x.r * 1.3, x.y); })); ctx.lineWidth = sw(0.9); ctx.strokeStyle = rgba(b.color, 0.3 * depthF); ctx.stroke(); }
        // the branch name on its plate at screen size; it stays while labels are off and fades once the plate is a sliver
        const hovered = mouseW && mouseW[0] > b.x0 - 20 && mouseW[0] < b.x1 + 20 && mouseW[1] > b.py - T.plateH && mouseW[1] < b.y1 + 20;
        const pitch = (b.w + T.branchGap) * k, v = titleVis * Math.max(tl, hovered ? 1 : 0.55) * (hovered ? 1 : clamp01((pitch - 44) / 40)); if (v < 0.02) return;
        drawGroupTitle(b, b.cx, b.py + sw(5), Math.max(60, pitch - 8), v, { count: false });
        const [sx, sy] = toScreen(b.cx, b.py + T.plateH / 2);
        const subs = d3.sum(b.loci, p => p.children.filter(pageOn).length), syn = d3.sum(b.loci, p => p.nSyn);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.font = `500 9.5px 'Satoshi', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = rgba('#a7b2cc', 0.8 * v);
        ctx.fillText(`${b.loci.length}${subs ? `+${subs}` : ''} · ${syn}`, sx, sy + 4);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(tx, ty); ctx.scale(k, k);
      });
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  }
  function drawKaryogram(titleVis, tl) {
    const sw = px => px / k, hw = G.barW / 2;
    const mobile = window.innerWidth <= 900;
    chromos.forEach(c => {
      if (!c.on) return;
      const x = c.x, pTop = c.top, pBot = c.cy - c.hubH / 2, qTop = c.cy + c.hubH / 2, qBot = c.bot;
      const arms = [[pTop, pBot], [qTop, qBot]].filter(([a, b]) => b - a > 1);
      // arms: rounded bars, banded by locus in the lobe colour at alternating density (the G-banding), clipped to the arm shape
      arms.forEach(([a, b]) => {
        roundRect(x - hw, a, G.barW, b - a, hw);
        ctx.fillStyle = rgba(c.color, 0.08); ctx.fill();
        ctx.save(); ctx.clip();
        let y = c.top; c.loci.forEach((p, i) => { if (i === c.cIdx) y += c.hubH; const h = c.hs[i]; if (y < b && y + h > a) { ctx.fillStyle = rgba(lobeColor(p), i % 2 ? 0.30 : 0.14); ctx.fillRect(x - hw, Math.max(y, a), G.barW, Math.min(y + h, b) - Math.max(y, a)); } y += h; });
        ctx.restore();
        roundRect(x - hw, a, G.barW, b - a, hw); ctx.lineWidth = sw(1); ctx.strokeStyle = rgba(c.color, 0.45); ctx.stroke();
      });
      // centromere: a waist between the arms, where the hub neuron sits on a network screen
      if (arms.length === 2) {
        const wy = c.hubH / 2, wx = hw * (c.hubOn ? 0.55 : 0.4);
        ctx.beginPath(); ctx.moveTo(x - hw + sw(0.5), pBot); ctx.bezierCurveTo(x - hw, pBot + wy * 0.6, x - wx, c.cy - wy * 0.35, x - wx, c.cy); ctx.bezierCurveTo(x - wx, c.cy + wy * 0.35, x - hw, qTop - wy * 0.6, x - hw + sw(0.5), qTop);
        ctx.lineTo(x + hw - sw(0.5), qTop); ctx.bezierCurveTo(x + hw, qTop - wy * 0.6, x + wx, c.cy + wy * 0.35, x + wx, c.cy); ctx.bezierCurveTo(x + wx, c.cy - wy * 0.35, x + hw, pBot + wy * 0.6, x + hw - sw(0.5), pBot); ctx.closePath();
        ctx.fillStyle = rgba(c.color, 0.16); ctx.fill(); ctx.lineWidth = sw(1); ctx.strokeStyle = rgba(c.color, 0.45); ctx.stroke();
      }
      // p / q arm marks, like a cytogenetic map
      if (arms.length === 2 && k > 0.42) {
        ctx.font = `500 ${sw(10)}px 'Satoshi', sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = rgba(c.color, 0.5 * clamp01((k - 0.42) / 0.3));
        ctx.fillText('p', x - hw - sw(6), (pTop + pBot) / 2); ctx.fillText('q', x - hw - sw(6), (qTop + qBot) / 2);
      }
      // title above the bar and a count below it, at screen size like the lobe titles; the hovered chromosome keeps its title while labels are off
      const hovered = mouseW && Math.abs(mouseW[0] - x) < hw + 20 && mouseW[1] > c.top - 30 && mouseW[1] < c.bot + 30;
      const [sx, sy] = toScreen(x, c.top), [, sb] = toScreen(x, c.bot);
      const pitch = (G.barW + G.gapX + c.reachL + c.reachR) * k - 8;
      // chromosome names are the map's axis, so they only dim when labels are off, and fade out once the columns are too tight to hold them
      const v = titleVis * Math.max(tl, hovered ? 1 : 0.55) * (hovered ? 1 : clamp01((pitch - 18) / 26)); if (v < 0.02) return;
      const fs = Math.max(9.5, Math.min(mobile ? 11 : 14, 10 + Math.sqrt(c.loci.length) * 1.2)), fs2 = Math.max(9, fs - 3);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = `600 ${fs}px 'Clash Display', 'Satoshi', sans-serif`; ctx.fillStyle = rgba(c.color, 0.9 * v);
      const lines = wrapTitle(c.name, Math.max(40, pitch)); lines.forEach((ln, i) => ctx.fillText(ln, sx, sy - 10 - (lines.length - 1 - i) * (fs + 2)));
      const subs = d3.sum(c.loci, p => p.children.filter(pageOn).length), syn = d3.sum(c.loci, p => p.nSyn) + (c.hubOn ? c.hubOn.nSyn : 0);
      ctx.font = `500 ${fs2}px 'Satoshi', sans-serif`; ctx.textBaseline = 'top'; ctx.fillStyle = rgba('#a7b2cc', 0.8 * v);
      ctx.fillText(`${c.loci.length + (c.hubOn ? 1 : 0)}${subs ? `+${subs}` : ''} · ${syn}`, sx, sb + 8);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(tx, ty); ctx.scale(k, k);
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  }

  // the radius a node is painted at, in world units (the draw loop and the orbit ring cards share it)
  const paintedR = n => n.kind === 'page' ? n.r / Math.pow(k, 0.45) * (isChild(n) ? 0.35 + 0.65 * depthF : 1) * (n.evap ? 1 - 0.16 * n.evap : 1) : n.kind === 'syn' ? 3.2 / k : 2.4 / k;
  function drawOrbit(titleVis, tl, drawn) {
    const world = () => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(tx, ty); ctx.scale(k, k); };
    const sw = px => px / k, mobile = window.innerWidth <= 900, cardBoxes = [], cardCosts = [];
    const liveRings = orbits.filter(g => g.on && g.R > 0);
    const outerEdge = liveRings.length ? d3.max(liveRings, g => g.R + OB.band / 2 + depthF * g.kidR) : 0;
    orbits.filter(g => g.on).forEach((g, ri) => {
      if (g.R === 0) return;
      const mRad = mouseW ? Math.hypot(mouseW[0] - (g.ox || 0), mouseW[1] - (g.oy || 0)) : -1;   // measured from this ring's own (possibly moved) centre
      // the orbit: a faint ring, a little brighter where neurons sit densely
      ctx.beginPath(); ctx.arc(g.ox || 0, g.oy || 0, g.R, 0, Math.PI * 2);
      ctx.lineWidth = sw(1); ctx.strokeStyle = rgba(g.color, 0.22); ctx.stroke();
      ctx.beginPath(); ctx.arc(g.ox || 0, g.oy || 0, g.R, 0, Math.PI * 2);
      ctx.lineWidth = OB.band; ctx.strokeStyle = rgba(g.color, 0.035); ctx.stroke();
      // ring card: name and count at screen size beside its ring. Its preferred seat steps around the rings (a quarter turn each, starting
      // at the top, so cards never stack on one radius). Each frame the card keeps its seat while that stays clear, else takes the nearest
      // seat just outside or just inside the ring, then past the outermost ring with a leader line, where it covers no drawn neuron or
      // synapse, no other card and stays on the canvas. Hover keeps a card while labels are off, and shows one that found no free seat.
      const hovered = mouseW && Math.abs(mRad - g.R) < OB.band / 2 + 20;
      const v = titleVis * Math.max(tl, hovered ? 1 : 0.55); if (v < 0.02) return;
      const fs = Math.max(9.5, Math.min(mobile ? 11 : 13, 9 + Math.sqrt(g.loci.length))), fs2 = Math.max(9, fs - 3), lh = fs + 2, block = lh + fs2 + 4;
      const subs = d3.sum(g.loci, p => p.children.filter(pageOn).length), syn = d3.sum(g.loci, p => p.nSyn), count = `${g.loci.length}${subs ? `+${subs}` : ''} · ${syn}`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `600 ${fs}px 'Clash Display', 'Satoshi', sans-serif`; const w1 = ctx.measureText(g.name).width;
      ctx.font = `500 ${fs2}px 'Satoshi', sans-serif`; const bw = Math.max(w1, ctx.measureText(count).width);
      const am0 = -Math.PI / 2 - (ri % 4) * Math.PI / 2 - Math.floor(ri / 4) * 0.5;
      // seat kinds: 0 just outside the ring, 1 just inside it, 2 past the outermost ring with a leader line (dense inner rings)
      const seat = (am, kind) => {
        const inner = kind === 1, cx = Math.cos(am), cy = Math.sin(am);
        const off = inner ? -(OB.band / 2 + 10) - (Math.abs(cx) * bw / 2 + Math.abs(cy) * block / 2 + 6) / k : kind === 2 ? outerEdge - g.R + 16 / k : OB.band / 2 + depthF * g.kidR + 14;
        if (inner && g.R + off < OB.band) return null;
        if (kind === 2 && off <= OB.band / 2 + depthF * g.kidR + 14) return null;
        const [sx, sy] = toScreen((g.ox || 0) + cx * (g.R + off), (g.oy || 0) + cy * (g.R + off));
        const flip = inner ? -1 : 1, align = cx * flip > 0.2 ? 'left' : cx * flip < -0.2 ? 'right' : 'center';
        const top = sy - block / 2 + (flip * cy * block) / 2, x0 = align === 'left' ? sx : align === 'right' ? sx - bw : sx - bw / 2;
        return { sx, sy, align, top, box: [x0 - 3, top - 2, x0 + bw + 3, top + block + 2] };
      };
      const cost = c => {
        const [x0, y0, x1, y1] = c.box; let n = 0;
        for (const nd of activeNodes) {
          if (!visible(nd) || (drawn && !drawn(nd))) continue;
          const [px, py] = toScreen(nd.x, nd.y), r = Math.max(2, paintedR(nd) * k * (nd.kind === 'src' ? 1.4 : 1));
          if (px + r > x0 && px - r < x1 && py + r > y0 && py - r < y1) n++;
        }
        for (const b of cardBoxes) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) n += 4;
        if (x0 < 4 || y0 < 70 || x1 > W - 4 || y1 > H - 4) n += 6;
        return n;
      };
      // a ring panned wholly off the canvas draws no card and spends no seat search
      { const [cx0, cy0] = toScreen(g.ox || 0, g.oy || 0), rr = (g.R + OB.band / 2 + depthF * g.kidR) * k + bw + block;
        if (cx0 + rr < 0 || cx0 - rr > W || cy0 + rr < 0 || cy0 - rr > H) { world(); return; } }
      let best = null;
      if (g.cardSeat) { const c = seat(g.cardSeat.am, g.cardSeat.kind); if (c && cost(c) === 0) best = { ...c, ...g.cardSeat }; }
      if (!best) {
        let bc = Infinity;
        for (const kinds of [[0, 1], [2]]) {
          for (let j = 0; j < 48 && bc > 0; j++) for (const kind of kinds) {
            const step = Math.ceil(j / 2) * (j % 2 ? 1 : -1), am = am0 + step * Math.PI / 24, c = seat(am, kind); if (!c) continue;
            const sc = cost(c) + (kind ? 0.5 : 0); if (sc < bc) { bc = sc; best = { ...c, am, kind }; }
          }
          if (bc < 1) break;
        }
        if (best) g.cardSeat = { am: best.am, kind: best.kind };
      }
      if (!best) { world(); return; }
      // on a crowded canvas a card that would sit on another card waits for hover rather than print over it
      if (!hovered && cardBoxes.some(b => best.box[0] < b[2] && best.box[2] > b[0] && best.box[1] < b[3] && best.box[3] > b[1])) { world(); return; }
      if (best.kind === 2) {   // a faint leader from the ring out to its card
        const [rx, ry] = toScreen((g.ox || 0) + Math.cos(best.am) * (g.R + OB.band / 2), (g.oy || 0) + Math.sin(best.am) * (g.R + OB.band / 2));
        const [ex, ey] = toScreen((g.ox || 0) + Math.cos(best.am) * (outerEdge + 8 / k), (g.oy || 0) + Math.sin(best.am) * (outerEdge + 8 / k));
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(ex, ey); ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.strokeStyle = rgba(g.color, 0.45 * v); ctx.stroke(); ctx.setLineDash([]);
      }
      cardCosts.push({ ring: g.name, cost: cost({ box: best.box }), box: best.box.map(Math.round) }); cardBoxes.push(best.box);
      ctx.textAlign = best.align; ctx.textBaseline = 'middle';
      ctx.font = `600 ${fs}px 'Clash Display', 'Satoshi', sans-serif`; ctx.fillStyle = rgba(g.color, 0.9 * v);
      ctx.fillText(g.name, best.sx, best.top + lh / 2);
      ctx.font = `500 ${fs2}px 'Satoshi', sans-serif`; ctx.fillStyle = rgba('#a7b2cc', 0.8 * v);
      ctx.fillText(count, best.sx, best.top + lh + 4 + fs2 / 2);
      world();
    });
    window.MBN_ORBIT_CARDS = cardCosts;   // read by the orbit QA: each drawn ring card and how many neurons or cards it covers
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  }

  function drawTable(titleVis, tl) {
    const sw = px => px / k, hw = TB.ring / 2, mobile = window.innerWidth <= 900;
    const sector = (r0, r1, a0, a1) => { ctx.beginPath(); ctx.arc(0, 0, r1, a0, a1); ctx.arc(0, 0, r0, a1, a0, true); ctx.closePath(); };
    // the table top: a faint disc with nothing on it but the chords
    ctx.beginPath(); ctx.arc(0, 0, tableR - hw - 6, 0, Math.PI * 2); ctx.fillStyle = rgba('#a7b2cc', 0.025); ctx.fill();
    ctx.lineWidth = sw(1); ctx.strokeStyle = rgba('#a7b2cc', 0.08); ctx.stroke();
    const inArc = (ang, a0, a1) => { let d = ang - a0; d -= Math.floor(d / (Math.PI * 2)) * Math.PI * 2; return d <= a1 - a0; };
    seats.forEach(c => {
      if (!c.on) return;
      // c.ox/c.oy: a seat dragged off the table carries its arc, bands, card and hover test with it
      const sox = c.ox || 0, soy = c.oy || 0;
      const mx = mouseW ? mouseW[0] - sox : 0, my = mouseW ? mouseW[1] - soy : 0, mAng = Math.atan2(my, mx), mRad = mouseW ? Math.hypot(mx, my) : -1;
      ctx.save(); ctx.translate(sox, soy);
      // the seat: an arc of the ring in the seat colour, banded chair by chair at alternating density like the karyogram's bars
      sector(tableR - hw, tableR + hw, c.a0, c.a1); ctx.fillStyle = rgba(c.color, 0.08); ctx.fill();
      // a chair with sub-neurons holds a slot wide enough for them to stand behind it; until they do (depth level), only the chair's own
      // width is painted at full density and the reserved room stays faint, so a seat does not read as an empty stretch of band
      let a = c.a0; c.loci.forEach((p, i) => {
        const w = c.ws[i] / tableR, own = Math.min(w, (2 * p.r * 1.6 + 8) / tableR), al = i % 2 ? 0.30 : 0.14;
        if (w - own > 0.001 && depthF < 0.97) {
          sector(tableR - hw, tableR + hw, a, a + w); ctx.fillStyle = rgba(lobeColor(p), al * (0.35 + 0.65 * depthF)); ctx.fill();
          sector(tableR - hw, tableR + hw, a + (w - own) / 2, a + (w + own) / 2); ctx.fillStyle = rgba(lobeColor(p), al * (1 - depthF)); ctx.fill();
        } else { sector(tableR - hw, tableR + hw, a, a + w); ctx.fillStyle = rgba(lobeColor(p), al); ctx.fill(); }
        a += w;
      });
      sector(tableR - hw, tableR + hw, c.a0, c.a1); ctx.lineWidth = sw(1); ctx.strokeStyle = rgba(c.color, 0.45); ctx.stroke();
      ctx.restore();
      // place card: the seat's name outside the ring at its middle angle, at screen size, with a count beneath; hover keeps it while labels are off
      const hovered = mouseW && mRad > tableR - hw - 30 && mRad < tableR + hw + 60 && inArc(mAng, c.a0 - 0.02, c.a1 + 0.02);
      const pitch = (c.a1 - c.a0) * tableR * k;
      const v = titleVis * Math.max(tl, hovered ? 1 : 0.55) * (hovered ? 1 : clamp01((pitch - 8) / 14)); if (v < 0.02) return;
      // the card stands clear of any sub-neurons behind the chairs and, once exploded, of their ladders
      const out = hw + depthF * c.kidR + explodeF * c.kidSyn, cx = Math.cos(c.am), cy = Math.sin(c.am), [sx, sy] = toScreen((tableR + out) * cx + sox, (tableR + out) * cy + soy);
      // when neuron labels are showing (or an outward-labelled chair of this seat is hovered, which shows its label even with labels off),
      // chairs near the card's angle carry their labels outward under it, so the card steps past the longest of them (measured, not guessed)
      const outward = p => !(p.children.some(pageOn) && depthF > 0.5), nearCard = p => Math.abs(Math.sin(p.ga - c.am)) * (tableR + hw) * k < 48;
      ctx.font = `500 ${sw(12)}px 'Satoshi', sans-serif`;
      const under = c.loci.filter(p => outward(p) && nearCard(p)), lblF = under.some(p => p === hover) ? 1 : tl;
      let reach = under.length ? Math.max(...under.map(p => (p.r / Math.pow(k, 0.45) + sw(6)) * k + ctx.measureText(p.title).width * k + 10)) : 0;
      // sub-neurons standing behind the chairs label outward too (smaller type, once the depth level is up), and the card already stands past their row
      if (depthF > 0.5) {
        ctx.font = `500 ${sw(10.5)}px 'Satoshi', sans-serif`;
        const kidsUnder = c.loci.flatMap(p => p.children.filter(x => pageOn(x) && Math.abs(Math.sin(Math.atan2(x.gy - soy, x.gx - sox) - c.am)) * (tableR + hw) * k < 48));
        if (kidsUnder.length) reach = Math.max(reach, clamp01((k - 1.05) / 0.1) * depthF * Math.max(...kidsUnder.map(x => (x.r / Math.pow(k, 0.45) + sw(6)) * k + ctx.measureText(x.title).width * k + 10)));
      }
      // the push follows the labels' own visibility: a label drawn at all (even faint, as the table first fits) is a label the card must not sit on
      let push = 14 + (lblF > 0.01 ? reach : 0);   // full measured reach as soon as the label paints; the on-screen fallback below still applies
      const fs = Math.max(9.5, Math.min(mobile ? 11 : 14, 10 + Math.sqrt(c.loci.length) * 1.2)), fs2 = Math.max(9, fs - 3);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = cx > 0.2 ? 'left' : cx < -0.2 ? 'right' : 'center'; ctx.textBaseline = 'middle';
      ctx.font = `600 ${fs}px 'Clash Display', 'Satoshi', sans-serif`;   // wrap with the card's own font, not the label font measured above
      const lines = wrapTitle(c.name, 150), lh = fs + 2, block = lines.length * lh + fs2 + 4;
      // the card stays on screen: on a small screen at a far fit the labels outreach the table itself, so when stepping past them would put the card
      // off screen (or under the search bar) it keeps its near place instead; a card beside the labels beats one nobody can see
      const subs = d3.sum(c.loci, p => p.children.filter(pageOn).length), syn = d3.sum(c.loci, p => p.nSyn), count = `${c.loci.length}${subs ? `+${subs}` : ''} · ${syn}`;
      let bw = Math.max(...lines.map(ln => ctx.measureText(ln).width));   // the card is as wide as its widest line, title or count, each in its own font
      ctx.font = `500 ${fs2}px 'Satoshi', sans-serif`; bw = Math.max(bw, ctx.measureText(count).width); ctx.font = `600 ${fs}px 'Clash Display', 'Satoshi', sans-serif`;
      const al = ctx.textAlign === 'left' ? 0 : ctx.textAlign === 'right' ? 1 : 0.5;
      const place = d => { const x = sx + cx * d, t = sy + cy * d - block / 2 + (cy * block) / 2, l = x - bw * al, r = x + bw * (1 - al);
        // a card in the search bar's columns is fine wholly above it or wholly below it (6 px clear), never across it
        const clear = !(searchBox && l < searchBox.r && r > searchBox.l) || t + block <= searchBox.t - 6 || t >= searchBox.b + 6;
        return { x, t, ok: l >= 8 && r <= W - 8 && t >= 8 && clear && t + block <= H - 56 }; };
      let at = place(push); if (!at.ok && push > 14) { push = 14; at = place(14); }
      if (!at.ok) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(tx, ty); ctx.scale(k, k); return; }   // neither place fits: no card rather than one across the search bar or off screen
      const px = at.x, top = at.t;
      ctx.fillStyle = rgba(c.color, 0.9 * v);
      lines.forEach((ln, i) => ctx.fillText(ln, px, top + lh / 2 + i * lh));
      ctx.font = `500 ${fs2}px 'Satoshi', sans-serif`; ctx.fillStyle = rgba('#a7b2cc', 0.8 * v);
      ctx.fillText(count, px, top + lines.length * lh + 4 + fs2 / 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(tx, ty); ctx.scale(k, k);
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  }

  // horizon layout: the disk (each orbit a faint band, brighter on its approaching side), the horizon and photon ring, the jets, the arcs
  // (banded knot by knot like the table's seats), the arc cards
  function drawHorizon(titleVis, tl) {
    const sw = px => px / k, hw = HZ.band / 2, mobile = window.innerWidth <= 900, now = performance.now();
    const hubL = lobes.find(selfLobe), base = hubL ? hubL.color : '#a7b2cc', outer = horizonOuter(), flick = reduceMotion ? 1 : 0.9 + 0.1 * Math.sin(now / 900);
    const sector = (r0, r1, a0, a1) => { ctx.beginPath(); ctx.arc(0, 0, r1, a0, a1); ctx.arc(0, 0, r0, a1, a0, true); ctx.closePath(); };
    const inArc = (ang, a0, a1) => { let d = ang - a0; d -= Math.floor(d / (Math.PI * 2)) * Math.PI * 2; return d <= a1 - a0; };
    // the jets: two faint tapers out of the poles, behind everything
    ctx.beginPath(); ctx.moveTo(-horizonR * 0.22, 0); ctx.lineTo(-horizonR * 0.06, -outer * HZ.jet * 1.15); ctx.lineTo(horizonR * 0.06, -outer * HZ.jet * 1.15); ctx.lineTo(horizonR * 0.22, 0); ctx.lineTo(horizonR * 0.06, outer * HZ.jet * 1.15); ctx.lineTo(-horizonR * 0.06, outer * HZ.jet * 1.15); ctx.closePath();
    ctx.fillStyle = rgba(base, 0.06 * flick); ctx.fill();
    // the orbits: a full faint band each, lit on the approaching (left) side; a conic gradient where the browser has one, flat otherwise
    horizonRings.forEach((ring, i) => {
      let fill;
      if (ctx.createConicGradient) { const g = ctx.createConicGradient(0, 0, 0); [0, 0.25, 0.5, 0.75, 1].forEach(t => g.addColorStop(t, rgba('#dbe4ff', 0.03 + 0.09 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2))))); fill = g; } else fill = rgba('#dbe4ff', 0.04);
      sector(ring.R - hw, ring.R + hw, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, ring.R, 0, Math.PI * 2); ctx.lineWidth = sw(0.8); ctx.strokeStyle = rgba('#a7b2cc', i % 2 ? 0.1 : 0.14); ctx.stroke();
    });
    // the horizon: a dark disc with a soft shadow at its edge; the photon ring just outside it in the hub's colour
    const sh = ctx.createRadialGradient(0, 0, horizonR * 0.8, 0, 0, horizonR * 1.6); sh.addColorStop(0, rgba('#000000', 0.9)); sh.addColorStop(0.3, rgba('#000000', 0.55)); sh.addColorStop(1, rgba('#000000', 0));
    ctx.beginPath(); ctx.arc(0, 0, horizonR * 1.6, 0, Math.PI * 2); ctx.fillStyle = sh; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, horizonR, 0, Math.PI * 2); ctx.fillStyle = rgba('#02030a', 0.96); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, horizonR * 1.07, 0, Math.PI * 2); ctx.lineWidth = sw(10); ctx.strokeStyle = rgba(base, 0.12 * flick); ctx.stroke();
    ctx.lineWidth = sw(2); ctx.strokeStyle = rgba(base, 0.7 * flick); ctx.stroke();
    ctx.lineWidth = sw(0.7); ctx.strokeStyle = rgba('#ffffff', 0.45 * flick); ctx.stroke();
    // the arcs
    hzArcs.forEach(o => {
      if (!o.on) return;
      const sox = o.ox || 0, soy = o.oy || 0, R = o.R;
      const mx = mouseW ? mouseW[0] - sox : 0, my = mouseW ? mouseW[1] - soy : 0, mAng = Math.atan2(my, mx), mRad = mouseW ? Math.hypot(mx, my) : -1;
      ctx.save(); ctx.translate(sox, soy);
      sector(R - hw, R + hw, o.a0, o.a1); ctx.fillStyle = rgba(o.color, 0.1); ctx.fill();
      let a = o.a0; o.loci.forEach((p, i) => {
        const w = o.ws[i] / R, own = Math.min(w, (2 * p.r * 1.6 + 8) / R), al = i % 2 ? 0.32 : 0.15;
        if (w - own > 0.001 && depthF < 0.97) {
          sector(R - hw, R + hw, a, a + w); ctx.fillStyle = rgba(lobeColor(p), al * (0.35 + 0.65 * depthF)); ctx.fill();
          sector(R - hw, R + hw, a + (w - own) / 2, a + (w + own) / 2); ctx.fillStyle = rgba(lobeColor(p), al * (1 - depthF)); ctx.fill();
        } else { sector(R - hw, R + hw, a, a + w); ctx.fillStyle = rgba(lobeColor(p), al); ctx.fill(); }
        a += w;
      });
      sector(R - hw, R + hw, o.a0, o.a1); ctx.lineWidth = sw(1); ctx.strokeStyle = rgba(o.color, 0.5); ctx.stroke();
      // the leading edge of the arc glows a little: matter piles up where the arc begins
      ctx.beginPath(); ctx.arc(0, 0, R, o.a0, Math.min(o.a1, o.a0 + 0.08)); ctx.lineWidth = HZ.band; ctx.strokeStyle = rgba(o.color, 0.12); ctx.stroke();
      ctx.restore();
      // the card: the arc's name outside its orbit at its middle angle, past any sub-neurons and, once exploded, their ladders, and past any outward labels
      const hovered = mouseW && mRad > R - hw - 30 && mRad < R + hw + 60 && inArc(mAng, o.a0 - 0.02, o.a1 + 0.02);
      const pitch = (o.a1 - o.a0) * R * k;
      const v = titleVis * Math.max(tl, hovered ? 1 : 0.55) * (hovered ? 1 : clamp01((pitch - 8) / 14)); if (v < 0.02) return;
      const out = hw + depthF * o.kidR + explodeF * o.kidSyn, cx = Math.cos(o.am), cy = Math.sin(o.am), [sx, sy] = toScreen((R + out) * cx + sox, (R + out) * cy + soy);
      const outward = p => !(p.children.some(pageOn) && depthF > 0.5), nearCard = p => Math.abs(Math.sin(p.ga - o.am)) * (R + hw) * k < 48;
      ctx.font = `500 ${sw(12)}px 'Satoshi', sans-serif`;
      const under = o.loci.filter(p => outward(p) && nearCard(p)), lblF = under.some(p => p === hover) ? 1 : tl;
      let reach = under.length ? Math.max(...under.map(p => (p.r / Math.pow(k, 0.45) + sw(6)) * k + ctx.measureText(p.title).width * k + 10)) : 0;
      if (depthF > 0.5) {
        ctx.font = `500 ${sw(10.5)}px 'Satoshi', sans-serif`;
        const kidsUnder = o.loci.flatMap(p => p.children.filter(x => pageOn(x) && Math.abs(Math.sin(Math.atan2(x.gy - soy, x.gx - sox) - o.am)) * (R + hw) * k < 48));
        if (kidsUnder.length) reach = Math.max(reach, clamp01((k - 1.05) / 0.1) * depthF * Math.max(...kidsUnder.map(x => (x.r / Math.pow(k, 0.45) + sw(6)) * k + ctx.measureText(x.title).width * k + 10)));
      }
      const push = 14 + lblF * clamp01((k - 0.45) / 0.25) * reach, ox = cx * push, oy = cy * push;
      const fs = Math.max(9.5, Math.min(mobile ? 11 : 14, 10 + Math.sqrt(o.loci.length) * 1.2)), fs2 = Math.max(9, fs - 3);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = cx > 0.2 ? 'left' : cx < -0.2 ? 'right' : 'center'; ctx.textBaseline = 'middle';
      const lines = wrapTitle(o.name, 150), lh = fs + 2, block = lines.length * lh + fs2 + 4, top = sy + oy - block / 2 + (cy * block) / 2;
      ctx.font = `600 ${fs}px 'Clash Display', 'Satoshi', sans-serif`; ctx.fillStyle = rgba(o.color, 0.9 * v);
      lines.forEach((ln, i) => ctx.fillText(ln, sx + ox, top + lh / 2 + i * lh));
      const subs = d3.sum(o.loci, p => p.children.filter(pageOn).length), syn = d3.sum(o.loci, p => p.nSyn);
      ctx.font = `500 ${fs2}px 'Satoshi', sans-serif`; ctx.fillStyle = rgba('#a7b2cc', 0.8 * v);
      ctx.fillText(`${o.loci.length}${subs ? `+${subs}` : ''} · ${syn}`, sx + ox, top + lines.length * lh + 4 + fs2 / 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(tx, ty); ctx.scale(k, k);
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  }

  // ---------- draw ----------
  function draw(now) {
    const captionPaint = [];
    // explode tween
    const want = forceExplode || k >= 1.5 ? 1 : 0;
    if (want !== explodeTarget) { explodeTarget = want; }
    if (Math.abs(explodeF - explodeTarget) > 0.004) {
      explodeF += (explodeTarget - explodeF) * 0.12;
      refreshForces(); if (sim.alpha() < 0.2) sim.alpha(0.35).restart();
    } else if (explodeF !== explodeTarget) { explodeF = explodeTarget; refreshForces(); }
    const wantD = hasSubs && (forceExplode || k >= 0.85) ? 1 : 0;
    if (wantD !== depthTarget) depthTarget = wantD;
    if (Math.abs(depthF - depthTarget) > 0.004) {
      depthF += (depthTarget - depthF) * 0.1;
      refreshForces(); if (sim.alpha() < 0.2) sim.alpha(0.3).restart();
    } else if (depthF !== depthTarget) { depthF = depthTarget; refreshForces(); }

    const wantL = labelsOn ? 1 : 0;
    if (Math.abs(labelF - wantL) > 0.004) labelF += (wantL - labelF) * 0.18; else labelF = wantL;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(tx, ty); ctx.scale(k, k);

    const lobeVis = clamp01((1.05 - k) / 0.45);           // lobe halos, visible when zoomed out
    const synVis = forceExplode ? 1 : clamp01((k - 1.25) / 0.45); // synapses fade in
    const labelVis = radial() ? clamp01((k - 0.42) / 0.2) : clamp01((k - 0.62) / 0.4);   // at the table the radial labels are the read, so they are up at the fitted zoom
    const synLabelVisAll = clamp01((k - 3.4) / 0.6);
    const synLabelVisFocus = clamp01((k - 1.6) / 0.4);
    const srcLabelVis = clamp01((k - 3.2) / 0.8);
    const focus = selected || hover;
    const focusSet = focus ? focusNeighborhood(focus) : null;
    const dim = focusSet ? 0.18 : 1;
    const sw = (px) => px / k; // screen px → world units
    const nodeR = paintedR;
    const depthA = n => n.kind === 'page' ? (isChild(n) ? depthF : 1) : n.kind === 'syn' ? (isChild(pageById[n.page]) ? depthF : 1) : 1;
    const childLabelVis = clamp01((k - 1.05) / 0.4) * depthF;
    const labelOf = n => n === hover ? 1 : labelF;   // the hovered node keeps its label while labels are toggled off

    // viewport culling bounds (world)
    const [vx0, vy0] = toWorld(-80, -80), [vx1, vy1] = toWorld(W + 80, H + 80);
    const inView = (x, y) => x > vx0 && x < vx1 && y > vy0 && y < vy1;

    // maps: the karyogram, the cells or the tree (bars, membranes, plates, titles) stand in for the lobe halos
    if (genome()) drawKaryogram(clamp01((1.7 - k) / 0.6), labelF); else if (cell()) drawCells(clamp01((1.7 - k) / 0.6), labelF); else if (tree()) drawTree(clamp01((1.7 - k) / 0.6), labelF); else if (table()) drawTable(clamp01((1.7 - k) / 0.6), labelF); else if (coil()) drawCoil(clamp01((1.7 - k) / 0.6), labelF); else if (orbit()) drawOrbit(clamp01((1.7 - k) / 0.6), labelF, n => depthA(n) >= 0.03 && (n.kind === 'page' || (synVis > 0.02 && explodeF > 0.05))); else if (horizon()) drawHorizon(clamp01((1.7 - k) / 0.6), labelF);
    // lobe halos
    if (lobeVis > 0 && !mapped()) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      // lobe circles first, so a title can avoid both other titles and other lobes' neurons
      const circles = lobes.filter(l => lobeOn[l.id] && !selfLobe(l)).map(l => {
        const ps = pages.filter(p => p.lobe === l.id); if (!ps.length) return null;
        const cx = d3.mean(ps, p => p.x), cy = d3.mean(ps, p => p.y);
        const rr = Math.max(44, d3.quantile(ps.map(p => Math.hypot(p.x - cx, p.y - cy)).sort(d3.ascending), 0.92) + 48);
        const [sx, sy] = toScreen(cx, cy); return { l, ps, cx, cy, rr, sx, sy, sr: rr * k };
      }).filter(Boolean).sort((a, b) => b.ps.length - a.ps.length);   // big lobes claim their spot first; small ones walk
      const placed = pages.filter(isSelf).map(p => { const [x,y]=toScreen(p.x,p.y);ctx.font="600 15px 'Satoshi', sans-serif";const w=ctx.measureText(p.title).width+24;return {x:x-w/2,y:y+8,w,h:36}; }); // Reserve hub titles.
      const hitsBox = b => placed.some(q => b.x < q.x + q.w && b.x + b.w > q.x && b.y < q.y + q.h && b.y + b.h > q.y);
      // A lobe's own painted neurons can sit outside its ring (dragged or outlying), so check them too.
      const ownCover = (b, self) => self.ps.reduce((a, p) => { if (!pageOn(p) || depthA(p) < 0.03) return a; const [x, y] = toScreen(p.x, p.y), r = nodeR(p) * k + 2; return a + Math.max(0, Math.min(b.x + b.w, x + r) - Math.max(b.x, x - r)) * Math.max(0, Math.min(b.y + b.h, y + r) - Math.max(b.y, y - r)); }, 0);
      const hitsCircle = (b, self) => circles.some(c => c !== self && Math.hypot(Math.max(b.x, Math.min(c.sx, b.x + b.w)) - c.sx, Math.max(b.y, Math.min(c.sy, b.y + b.h)) - c.sy) < c.sr * 0.9);
      // the screen area a title may use: right of the lobes legend, below the header, above the hint bar
      const edge = { x0: window.innerWidth <= 900 ? 8 : 238, x1: W - 80, y0: 78, y1: H - 70 };
      const offEdge = b => Math.max(0, edge.x0 - b.x) + Math.max(0, b.x + b.w - edge.x1) + Math.max(0, edge.y0 - b.y) + Math.max(0, b.y + b.h - edge.y1);
      // when every candidate collides, take the one that overlaps least rather than the first
      const penalty = (b, self) => offEdge(b) * 3
        + placed.reduce((a, q) => a + Math.max(0, Math.min(b.x + b.w, q.x + q.w) - Math.max(b.x, q.x)) * Math.max(0, Math.min(b.y + b.h, q.y + q.h) - Math.max(b.y, q.y)) / 40, 0)
        + circles.reduce((a, c) => a + (c === self ? 0 : Math.max(0, c.sr * 0.9 - Math.hypot(Math.max(b.x, Math.min(c.sx, b.x + b.w)) - c.sx, Math.max(b.y, Math.min(c.sy, b.y + b.h)) - c.sy))), 0);
      circles.forEach(c => {
        const { l, ps, cx, cy, rr } = c;
        // network screen: lobe titles shrink as the view zooms out so a dozen lobes can share one screen
        const shrink = brainsIn ? Math.min(1, Math.max(0.5, k / 0.3)) : 1;
        const fs = Math.min(W / (brainsIn ? 36 : 22), 13 + Math.sqrt(ps.length) * 2.4) * shrink, fs2 = Math.max(9.5, Math.min(W / 32, 12) * shrink);
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.fillStyle = rgba(l.color, 0.05 * lobeVis); ctx.fill();
        ctx.lineWidth = sw(1); ctx.strokeStyle = rgba(l.color, 0.22 * lobeVis); ctx.stroke();
        // labels prefer the outward side of the ring (away from the brain's hub); if that spot is taken they walk around the ring
        const o = hubOf[l.id] || { x: 0, y: 0 }, dl = Math.hypot(cx - o.x, cy - o.y) || 1;
        const a0 = dl > 1 ? Math.atan2(cy - o.y, cx - o.x) : -Math.PI / 2;
        const subs = ps.filter(isChild).length;
        const line2 = `${plural(ps.length - subs, 'neuron')}${subs ? ` · ${plural(subs, 'sub-neuron')}` : ''} · ${plural(d3.sum(ps, p => p.nSyn), 'synapse')}`;
        ctx.font = `600 ${fs}px 'Clash Display', 'Satoshi', sans-serif`; const w1 = ctx.measureText(l.name).width;
        ctx.font = `500 ${fs2}px 'Satoshi', sans-serif`; const w2 = ctx.measureText(line2).width;
        const bw = Math.max(w1, w2), bh = fs + fs2 + 10;
        const tl = Math.max(labelF, mouseW && Math.hypot(mouseW[0] - cx, mouseW[1] - cy) < rr ? 1 : 0);   // hovered lobe keeps its title
        if (tl < 0.02) return;   // a hidden caption reserves no space
        let best = null, bestPen = Infinity;
        const tries = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, Math.PI].flatMap(da => [[da, 18], [da, 18 + bh], [da, 18 + 2 * bh], [da,18+3*bh]]);
        tries.sort((p, q) => (Math.abs(p[0]) + p[1] / 40) - (Math.abs(q[0]) + q[1] / 40));
        for (const [da, off] of tries) {
          const ang = a0 + da, ux = Math.cos(ang), uy = Math.sin(ang);
          const [sx, sy] = toScreen(cx + ux * (rr + sw(off)), cy + uy * (rr + sw(off)));
          const align = Math.abs(ux) < 0.35 ? 'center' : ux > 0 ? 'left' : 'right';
          const bx = align === 'center' ? sx - bw / 2 : align === 'left' ? sx : sx - bw, by = uy < -0.35 ? sy - bh : uy > 0.35 ? sy : sy - bh / 2;
          // Reserve the painted background too, not only the text metrics.
          // Otherwise a later caption's padding can cover a neighbor's text.
          const box = { x: bx - 4, y: by - 2, w: bw + 8, h: bh + 4, textY: by, sx, sy, align };
          const cover = ownCover(box, c);
          if (!hitsBox(box) && !hitsCircle(box, c) && !offEdge(box) && !cover) { best = box; bestPen = 0; break; }
          const pen = penalty(box, c) + cover / 40; if (pen < bestPen) { bestPen = pen; best = box; }
        }
        if (bestPen > 0) return; // The sidebar retains labels that cannot fit without collisions.
        placed.push(best);
        captionPaint.push(() => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.textAlign = best.align; ctx.textBaseline = 'top';
        const lx=Math.max(best.x,Math.min(c.sx,best.x+best.w)), ly=Math.max(best.y,Math.min(c.sy,best.y+best.h));
        const length=Math.hypot(lx-c.sx,ly-c.sy)||1;
        ctx.beginPath();ctx.moveTo(c.sx+(lx-c.sx)*c.sr/length,c.sy+(ly-c.sy)*c.sr/length);ctx.lineTo(lx,ly);
        ctx.strokeStyle=rgba(l.color,0.65*lobeVis*tl);ctx.lineWidth=1.1;ctx.setLineDash([3,3]);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle=rgba('#080d16',0.9*lobeVis*tl);ctx.fillRect(best.x,best.y,best.w,best.h);
        ctx.font = `600 ${fs}px 'Clash Display', 'Satoshi', sans-serif`; ctx.fillStyle = rgba(l.color, 0.85 * lobeVis * tl); ctx.fillText(l.name, best.sx, best.textY + 2);
        ctx.font = `500 ${fs2}px 'Satoshi', sans-serif`; ctx.fillStyle = rgba('#a7b2cc', 0.8 * lobeVis * tl); ctx.fillText(line2, best.sx, best.textY + fs + 8);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.translate(tx, ty); ctx.scale(k, k);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        });
      });
    }

    // co-citation threads
    if (showCocite) {
      ctx.lineWidth = sw(0.6);
      activeLinks.forEach(l => {
        if (l.kind !== 'cc') return;
        const a = focusSet ? (focusSet.has(l.source) && focusSet.has(l.target) ? 0.35 : 0.04) : 0.08 + Math.min(l.w, 4) * 0.03;
        ctx.strokeStyle = rgba('#c7d2ea', a);
        ctx.beginPath(); ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); ctx.stroke();
      });
    }

    // parent → sub-neuron tethers
    if (depthF > 0.03) {
      activeLinks.forEach(l => {
        if (l.kind !== 'pc' || !inView(l.target.x, l.target.y)) return;
        const related = !focusSet || (focusSet.has(l.source) && focusSet.has(l.target));
        ctx.strokeStyle = rgba(lobeColor(l.source), (related ? 0.45 : 0.06) * depthF); ctx.lineWidth = sw(1.1);
        ctx.beginPath(); ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); ctx.stroke();
      });
    }
    // page-page connections
    activeLinks.forEach(l => {
      if (l.kind !== 'pp') return;
      const da = Math.min(depthA(l.source), depthA(l.target)); if (da < 0.03) return;
      if (!inView(l.source.x, l.source.y) && !inView(l.target.x, l.target.y)) return;
      const inFocus = focusSet && focusSet.has(l.source) && focusSet.has(l.target) && (l.source === focus || l.target === focus);
      const base = (0.16 + Math.min(l.w, 6) * 0.045) * (mapped() && !sameGroup(l.source, l.target) ? (radial() ? 0.7 : 0.45) : 1);   // table chords soften only a little so the ring still reads   // maps: arches between groups stay faint so the groups read
      const a = (focusSet ? (inFocus ? 0.85 : 0.05) : base) * da;
      const col = l.source.lobe === l.target.lobe ? lobeColor(l.source) : '#b9c4e0';
      ctx.strokeStyle = rgba(col, a);
      ctx.lineWidth = sw(inFocus ? 1.8 : 0.7 + Math.min(l.w, 6) * 0.18);
      ctx.beginPath(); ctx.moveTo(l.source.x, l.source.y);
      const c = ctrlOf(l); if (c) ctx.quadraticCurveTo(c[0], c[1], l.target.x, l.target.y); else ctx.lineTo(l.target.x, l.target.y);
      ctx.stroke();
    });

    // synapse tethers + cross links + source tethers
    if (synVis > 0.02 && explodeF > 0.05) {
      const v = synVis * explodeF;
      activeLinks.forEach(l => {
        if (l.kind === 'pp' || l.kind === 'cc' || l.kind === 'pc') return;
        if (!inView(l.target.x, l.target.y)) return;
        const da = depthA(l.source); if (da < 0.03) return;
        const related = (!focusSet || focusSet.has(l.source) || focusSet.has(l.target)) && da > 0.5;
        if (l.kind === 'st') {
          ctx.strokeStyle = rgba(lobeColor(l.source), (related ? 0.35 : 0.05) * v); ctx.lineWidth = sw(0.8); ctx.setLineDash([]);
        } else if (l.kind === 'sx') {
          ctx.strokeStyle = rgba('#ffffff', (related ? 0.55 : 0.06) * v); ctx.lineWidth = sw(0.9); ctx.setLineDash([sw(4), sw(4)]);
        } else {
          ctx.strokeStyle = rgba('#8ea2cc', (related ? 0.22 : 0.03) * v); ctx.lineWidth = sw(0.6); ctx.setLineDash([sw(1.5), sw(3)]);
        }
        const sp = sparkAny && l.kind !== 'sr' && sparkOf(pageById[l.source.page] || l.source);   // a synapse (st, sx) sparks with its page
        ctx.beginPath();
        if (sp) bolt(l.source.x, l.source.y, l.target.x, l.target.y, linkSeed(l), Math.min(5, sw(1.2) + Math.hypot(l.target.x - l.source.x, l.target.y - l.source.y) * 0.025), l.kind === 'st' ? 4 : 6); else { ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); }
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }

    // pulses
    if (!reduceMotion) {
      if (now - lastPulse > 260) { lastPulse = now; const cand = activeLinks.filter(l => l.kind === 'pp' && depthA(l.source) > 0.97 && depthA(l.target) > 0.97); spawnPulse(cand[Math.floor(Math.random() * cand.length)]); }
      // sparking neurons discharge more often, and once their synapses are out, the synapses that reach other neurons fire too
      if (sparkAny && now - lastSpark > 150) {
        lastSpark = now; const out = synVis > 0.02 && explodeF > 0.5;
        const cand = activeLinks.filter(l => (l.kind === 'pp' && (sparkOf(l.source) || sparkOf(l.target)) && depthA(l.source) > 0.97 && depthA(l.target) > 0.97) || (out && l.kind === 'sx' && sparkOf(pageById[l.source.page])));
        spawnPulse(cand[Math.floor(Math.random() * cand.length)], false, true);
      }
      // radiating neurons emit pairs; two candidates are drawn and the smaller emitter wins, so small neurons radiate more often
      if (radiateAny && now - lastRadiate > 190) {
        lastRadiate = now; const out = synVis > 0.02 && explodeF > 0.5;
        const cand = activeLinks.filter(l => (l.kind === 'pp' && (radiateOf(l.source) || radiateOf(l.target)) && depthA(l.source) > 0.97 && depthA(l.target) > 0.97) || (out && l.kind === 'sx' && radiateOf(pageById[l.source.page])));
        if (cand.length) {   // the direction is drawn once per candidate, so the emitter that is compared is the one that evaporates
          const draw = () => { const l = cand[Math.floor(Math.random() * cand.length)], dir = l.kind === 'sx' ? 1 : radiateDir(l), n = dir > 0 ? l.source : l.target; return { l, dir, r: n.kind === 'syn' ? pageById[n.page].r : n.r }; };
          const a = draw(), b = draw(), w = a.r <= b.r ? a : b; spawnPulse(w.l, false, false, true, w.dir);
        }
      }
      if (radiateAny) pages.forEach(n => { if (n.evap) n.evap = n.evap > 0.03 ? n.evap * 0.9 : 0; });
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        if (p.partner) {   // the infalling partner: from the rim back into the emitter, dim, gone in a few frames
          p.t += p.speed; if (p.t >= 1) { pulses.splice(i, 1); continue; }
          const s = p.dir > 0 ? p.l.source : p.l.target, e = p.dir > 0 ? p.l.target : p.l.source, em = s.kind === 'syn' ? pageById[s.page] : s;
          const [rx, ry] = linkPoint(p.l, s, e, Math.min(0.5, (nodeR(em) + sw(3)) / (Math.hypot(e.x - s.x, e.y - s.y) || 1))), u = p.t, aa = (1 - u) * 0.6 * Math.min(depthA(s), depthA(e)) * (focusSet ? 0.5 : 1);
          if (aa < 0.02) continue;
          ctx.fillStyle = rgba('#9aa3c7', aa); ctx.beginPath(); ctx.arc(rx + (em.x - rx) * u, ry + (em.y - ry) * u, sw(1.5), 0, Math.PI * 2); ctx.fill();
          continue;
        }
        // time dilation: an escaping quantum slows as it nears a hub (the horizon); elsewhere it runs free
        let dil = 1;
        if (p.radiate && hubPages.length) { const s0 = p.dir > 0 ? p.l.source : p.l.target, e0 = p.dir > 0 ? p.l.target : p.l.source, [qx, qy] = linkPoint(p.l, s0, e0, p.t); const dh = Math.min(...hubPages.map(h => Math.hypot(h.x - qx, h.y - qy))), near = horizon() ? horizonR * 1.6 : 160; dil = 0.3 + 0.7 * clamp01(dh / near); }
        p.t += p.speed * dil; if (p.t >= 1) { pulses.splice(i, 1); continue; }
        const s = p.dir > 0 ? p.l.source : p.l.target, e = p.dir > 0 ? p.l.target : p.l.source;
        const [x, y] = linkPoint(p.l, s, e, p.t);
        const col = s.lobe === e.lobe ? lobeColor(s) : '#ffffff';
        const a = Math.sin(p.t * Math.PI) * Math.min(depthA(s), depthA(e));
        if (a < 0.02) continue;
        if (p.radiate) {   // a quantum: a white core in a coloured halo with a short wave-packet tail, brightening as it gets away
          const g = focusSet ? 0.5 : 1, hc = s.kind === 'syn' ? lobeColor(pageById[s.page]) : lobeColor(s), aw = a * (0.55 + 0.45 * p.t) * g;
          for (let j = 3; j >= 1; j--) { const [tx2, ty2] = linkPoint(p.l, s, e, Math.max(0, p.t - j * 0.022)); ctx.fillStyle = rgba(hc, aw * (0.35 - j * 0.09)); ctx.beginPath(); ctx.arc(tx2, ty2, sw(3.2 - j * 0.5), 0, Math.PI * 2); ctx.fill(); }
          ctx.fillStyle = rgba(hc, 0.28 * aw); ctx.beginPath(); ctx.arc(x, y, sw(7), 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = rgba('#ffffff', 0.95 * aw); ctx.beginPath(); ctx.arc(x, y, sw(2), 0, Math.PI * 2); ctx.fill();
          continue;
        }
        if (p.spark) {   // a bolt: a short lightning stroke behind the head, a white core in a coloured glow
          const [x0, y0] = linkPoint(p.l, s, e, Math.max(0, p.t - 0.09)), g = focusSet ? 0.5 : 1;
          ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); bolt(x0, y0, x, y, p.seed, sw(3.2), 5);
          ctx.lineWidth = sw(6); ctx.strokeStyle = rgba(s.kind === 'syn' ? lobeColor(pageById[s.page]) : lobeColor(s), 0.3 * a * g); ctx.stroke();
          ctx.lineWidth = sw(1.5); ctx.strokeStyle = rgba('#ffffff', 0.95 * a * g); ctx.stroke();
          ctx.fillStyle = rgba('#ffffff', 0.95 * a * g); ctx.beginPath(); ctx.arc(x, y, sw(1.9), 0, Math.PI * 2); ctx.fill(); ctx.restore();
          continue;
        }
        ctx.fillStyle = rgba(col, 0.9 * a * (focusSet ? 0.5 : 1)); ctx.beginPath(); ctx.arc(x, y, sw(2.2), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba(col, 0.25 * a); ctx.beginPath(); ctx.arc(x, y, sw(6), 0, Math.PI * 2); ctx.fill();
      }
    }

    // sources (sparks)
    if (synVis > 0.02 && explodeF > 0.05) {
      const v = synVis * explodeF;
      activeNodes.forEach(n => {
        if (n.kind !== 'src' || !inView(n.x, n.y)) return;
        const related = !focusSet || focusSet.has(n);
        const r = nodeR(n) * (0.6 + 0.4 * explodeF);
        ctx.fillStyle = rgba(n.kindOf === 'github' ? '#c7d2ea' : '#dbe4ff', (related ? 0.9 : 0.15) * v);
        ctx.beginPath(); ctx.moveTo(n.x, n.y - r * 1.4); ctx.lineTo(n.x + r, n.y); ctx.lineTo(n.x, n.y + r * 1.4); ctx.lineTo(n.x - r, n.y); ctx.closePath(); ctx.fill();
        if (srcLabelVis * labelOf(n) > 0.02 && related) {
          ctx.font = `500 ${sw(10)}px 'Satoshi', sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillStyle = rgba('#a7b2cc', 0.9 * srcLabelVis * v * labelOf(n));
          ctx.fillText(n.label, n.x + r + sw(4), n.y);
        }
      });
    }

    // synapses
    if (synVis > 0.02 && explodeF > 0.05) {
      const v = synVis;
      activeNodes.forEach(n => {
        if (n.kind !== 'syn' || !inView(n.x, n.y)) return;
        const da = depthA(n); if (da < 0.03) return;
        const related = !focusSet || focusSet.has(n);
        const r = nodeR(n) * (0.5 + 0.5 * explodeF) * da;
        const col = lobeColor(n);
        const isPulse = n === pulseSyn, lock = sealed(n);
        if (lock) {   // a sealed rung: a hollow ring with a dark core, the fact still folded inside
          ctx.strokeStyle = rgba(col, (related ? 0.9 : 0.15) * v * da); ctx.lineWidth = sw(1.1);
          ctx.beginPath(); ctx.arc(n.x, n.y, r * (isPulse ? 1.9 : 1.15), 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = rgba(col, (related ? 0.35 : 0.08) * v * da); ctx.beginPath(); ctx.arc(n.x, n.y, r * 0.45, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = rgba(col, (related ? 0.95 : 0.15) * v * da);
          ctx.beginPath(); ctx.arc(n.x, n.y, r * (isPulse ? 1.9 : 1), 0, Math.PI * 2); ctx.fill();
        }
        if (unfolding && unfolding.n === n) {   // the seal breaking: one ring runs outward over ~0.9 s
          const age = (now - unfolding.t0) / 900;
          if (age < 1) { ctx.strokeStyle = rgba('#ffffff', 0.85 * (1 - age)); ctx.lineWidth = sw(1.6); ctx.beginPath(); ctx.arc(n.x, n.y, r + sw(3 + 26 * age), 0, Math.PI * 2); ctx.stroke(); }
          else unfolding = null;
        }
        if (related && n.links.length) { ctx.strokeStyle = rgba('#ffffff', 0.7 * v); ctx.lineWidth = sw(0.8); ctx.beginPath(); ctx.arc(n.x, n.y, r + sw(1.6), 0, Math.PI * 2); ctx.stroke(); }
        if (isPulse) { ctx.strokeStyle = rgba('#ffffff', 0.9); ctx.lineWidth = sw(1.5); ctx.beginPath(); ctx.arc(n.x, n.y, r + sw(5), 0, Math.PI * 2); ctx.stroke(); }
        // maps are dense, so synapse labels show only for the focused neuron, where the rest is dimmed; on a ladder they hang at an angle
        const lv = (mapped() ? (focusSet && related ? synLabelVisFocus : 0) : focusSet && related ? Math.max(synLabelVisFocus, synLabelVisAll) : synLabelVisAll) * labelOf(n);
        if (lv > 0.02 && related) {
          const p = pageById[n.page];
          let ang = Math.atan2(n.y - p.y, n.x - p.x), flip = Math.cos(ang) < 0;
          const onLadder = genome() || tree();
          if (onLadder) { flip = ladderSide(p) < 0; ang = flip ? -1.0 : 1.0; }
          else if (radial()) { ang += 0.9; flip = Math.cos(ang) < 0; }   // table layout: hang off the radial ladder at a slant, kept upright   // down-right for a right-hand ladder, down-left for a left-hand one
          ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(flip && !onLadder ? ang + Math.PI : ang);
          ctx.font = `500 ${sw(10.5)}px 'Satoshi', sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = flip ? 'right' : 'left';
          ctx.fillStyle = rgba('#e9eefb', 0.92 * lv * v * explodeF);
          const lead = leadOf(n), label = lead.length > 36 ? lead.slice(0, 34) + '…' : lead;
          ctx.fillText(label, flip ? -(r + sw(5)) : r + sw(5), 0);
          ctx.restore();
        }
      });
    }

    // neurons (pages)
    activeNodes.forEach(n => {
      if (n.kind !== 'page' || !inView(n.x, n.y)) return;
      const da = depthA(n); if (da < 0.03) return;
      const related = !focusSet || focusSet.has(n);
      const col = lobeColor(n);
      const r = nodeR(n);
      const a = (related ? 1 : dim) * da;
      // halo
      ctx.fillStyle = rgba(col, 0.10 * a); ctx.beginPath(); ctx.arc(n.x, n.y, r * 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(col, 0.22 * a); ctx.beginPath(); ctx.arc(n.x, n.y, r * 1.6, 0, Math.PI * 2); ctx.fill();
      // body
      ctx.fillStyle = rgba(col, 0.95 * a); ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.55 * a); ctx.beginPath(); ctx.arc(n.x - r * 0.25, n.y - r * 0.25, r * 0.32, 0, Math.PI * 2); ctx.fill();
      // shared neuron: a thin dashed white ring marks ids that also exist in another brain of the network
      if (N && isShared(n)) { ctx.strokeStyle = rgba('#ffffff', 0.45 * a); ctx.lineWidth = sw(0.9); ctx.setLineDash([sw(2.5), sw(2.5)]); ctx.beginPath(); ctx.arc(n.x, n.y, r + sw(3.5), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      // folded sub-neurons: small satellites hugging the body until the depth level unfolds them
      if (n.children.length && depthF < 0.97) {
        const m = n.children.length, rr = r + sw(10);
        ctx.fillStyle = rgba(col, 0.9 * a * (1 - depthF));
        for (let i = 0; i < m; i++) { const ang = n.spin + Math.PI / 2 + (i / m) * Math.PI * 2; ctx.beginPath(); ctx.arc(n.x + Math.cos(ang) * rr, n.y + Math.sin(ang) * rr, sw(2.2), 0, Math.PI * 2); ctx.fill(); }
      }
      // collapsed synapse ring: hints how many synapses are packed inside
      if (explodeF < 0.95 && n.nSyn) {
        ctx.strokeStyle = rgba(col, 0.5 * a * (1 - explodeF)); ctx.lineWidth = sw(1);
        ctx.setLineDash([sw(1.5), sw(Math.max(2, 40 / n.nSyn))]);
        ctx.beginPath(); ctx.arc(n.x, n.y, r + sw(5), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      if (n === selected) { ctx.strokeStyle = rgba('#ffffff', 0.9); ctx.lineWidth = sw(1.6); ctx.beginPath(); ctx.arc(n.x, n.y, r + sw(9), 0, Math.PI * 2); ctx.stroke(); }
      else if (n === hover) { ctx.strokeStyle = rgba('#ffffff', 0.6); ctx.lineWidth = sw(1.2); ctx.beginPath(); ctx.arc(n.x, n.y, r + sw(7), 0, Math.PI * 2); ctx.stroke(); }
      // marquee-selected neurons wear an accent ring; pinned (hand-placed) neurons a faint solid one
      if (multi.has(n) && n !== selected) { ctx.strokeStyle = rgba('#ff8a3d', 0.9); ctx.lineWidth = sw(1.4); ctx.beginPath(); ctx.arc(n.x, n.y, r + sw(8), 0, Math.PI * 2); ctx.stroke(); }
      if (n.pinned) { ctx.strokeStyle = rgba('#ffffff', 0.22 * a); ctx.lineWidth = sw(0.8); ctx.beginPath(); ctx.arc(n.x, n.y, r + sw(12), 0, Math.PI * 2); ctx.stroke(); }
      // label
      const important = isSelf(n) || n.deg >= 18 || n.r > 12.5;
      // karyocyte layout: neurons sit shoulder to shoulder in their territory, so names wait for a closer zoom than in the open neural layout
      const lvBase = cell() ? clamp01((k - 1.0) / 0.45) : labelVis, lvImp = cell() ? clamp01((k - 0.7) / 0.3) : clamp01((k - 0.45) / 0.25);
      const lv = (isChild(n) ? childLabelVis : isSelf(n) ? 1 : important ? Math.max(lvBase, lvImp) : lvBase) * labelOf(n);
      if (lv > 0.02 && (related || lv > 0.6)) {
captionPaint.push(() => {ctx.shadowColor="#06080f";ctx.shadowBlur=4;
        const fs = isSelf(n) ? 15 : isChild(n) ? 10.5 : 12;
        ctx.font = `${isSelf(n) ? 600 : 500} ${sw(fs)}px 'Satoshi', sans-serif`;
        // ladder layouts: labels sit beside the band like gene annotations (on the ladder's side) and lift above the synapse ladder
        if (radial() && n.gux !== undefined && !((coil() || horizon()) && n.gflat)) {
          // table layout: labels read along the radius like place cards. Outward for a plain chair (radial labels diverge there, so neighbours
          // stay apart), inward beside the ladder for a chair once its sub-neurons are standing behind it (outward like a plain chair until then, so a long label never crosses the table), outward beside its own ladder for a sub-neuron.
          const kidsOn = !isChild(n) && n.children.some(pageOn) && depthF > 0.5, dir = kidsOn ? -1 : 1, ux = n.gux * dir, uy = n.guy * dir;
          const lift = kidsOn || isChild(n) ? explodeF * (n.nSyn ? r * 0.6 + sw(8) : 0) : 0;
          const ang = Math.atan2(uy, ux), flip = Math.cos(ang) < 0, px = n.x + ux * (r + sw(6)) - uy * lift, py = n.y + uy * (r + sw(6)) + ux * lift;
          ctx.save(); ctx.translate(px, py); ctx.rotate(flip ? ang + Math.PI : ang); ctx.textAlign = flip ? 'right' : 'left'; ctx.textBaseline = 'middle';
          ctx.fillStyle = rgba('#000000', 0.55 * lv * a); ctx.fillText(n.title, sw(0.8), sw(0.8));
          ctx.fillStyle = rgba(related ? '#f1f4ff' : '#b6bfd8', (related ? 0.95 : 0.74) * lv); ctx.fillText(n.title, 0, 0);   // radial labels are the table's main read, so they sit brighter than the free layout's
          ctx.restore(); ctx.shadowBlur = 0; return;   // the blur was set before save(), so restore() keeps it
        }
        const beside = (genome() || tree()) && !(isSelf(n) && !brainsIn && !isChild(n)), side = beside ? ladderSide(n) : 0;
        const lx = beside ? n.x + side * (r + sw(6)) : n.x, ly = beside ? n.y - explodeF * (n.nSyn ? r * 0.6 + sw(8) : 0) : n.y + r + sw(5);
        ctx.textAlign = beside ? (side > 0 ? 'left' : 'right') : 'center'; ctx.textBaseline = beside ? 'middle' : 'top';
        ctx.fillStyle = rgba('#000000', 0.55 * lv * a); ctx.fillText(n.title, lx + sw(0.8), ly + sw(0.8));
        ctx.fillStyle = rgba(related ? '#f1f4ff' : '#9aa5c2', (related ? 0.95 : 0.5) * lv);
        ctx.fillText(n.title, lx, ly);

ctx.shadowBlur=0;});
}
    });

    // marquee rectangle (screen space)
    captionPaint.forEach(paint => paint());
    if (marquee) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1), w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
      ctx.fillStyle = 'rgba(255,138,61,0.08)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(255,138,61,0.8)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.setLineDash([]);
    }
    requestAnimationFrame(draw);
  }

  function focusNeighborhood(n) {
    const s = new Set([n]);
    if (n.kind === 'page') {
      n.children.forEach(c => s.add(c)); if (n.parent) s.add(n.parent);
      n.neighbors.forEach(x => s.add(x.n));
      n.synNodes.forEach(x => { s.add(x); x.links.forEach(id => pageById[id] && s.add(pageById[id])); });
      n.srcNodes.forEach(x => s.add(x));
      syns.forEach(x => { if (x.links.includes(n.id)) { s.add(x); s.add(pageById[x.page]); } });
    } else if (n.kind === 'syn') {
      s.add(pageById[n.page]); n.links.forEach(id => pageById[id] && s.add(pageById[id]));
    } else { n.pageNodes.forEach(p => s.add(p)); }
    return s;
  }

  // ---------- interaction ----------
  function pick(sx, sy) {
    const [x, y] = toWorld(sx, sy);
    const synOk = explodeF > 0.6 && (forceExplode || k >= 1.25);
    let best = null, bd = Infinity;
    for (const n of activeNodes) {
      if (n.kind !== 'page' && !synOk) continue;
      if (isChild(n) && depthF < 0.5) continue;
      if (n.kind === 'syn' && isChild(pageById[n.page]) && depthF < 0.5) continue;
      const r = (n.kind === 'page' ? n.r / Math.pow(k, 0.45) : 4 / k) + 6 / k;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < r && d < bd) { bd = d; best = n; }
    }
    return best;
  }
  const tip = document.getElementById('tip');
  let downAt = null, downBtn = 0, downShift = false, pressed = null;
  let touch = null; const fingers = new Set();   // the touch gesture in progress and its active fingers
  canvas.addEventListener('contextmenu', e => e.preventDefault());   // the right button moves neurons / pans, so no menu
  window.addEventListener('keydown', e => { if (e.code === 'Space' && !e.target.closest('input')) { spaceDown = true; canvas.classList.add('space'); } });
  window.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; canvas.classList.remove('space'); } });
  canvas.addEventListener('pointerdown', e => {
    // mbTouchTap: d3-zoom owns pan and pinch; a one-finger tap (under 10 px and 350 ms) selects the neuron under the finger, or clears on empty canvas
    if (e.pointerType === 'touch') { fingers.add(e.pointerId); if (touch || fingers.size > 1) { if (touch) touch.multi = true; } else touch = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), multi: false, moved: false }; tip.hidden = true; return; }
    downAt = [e.clientX, e.clientY]; downBtn = e.button; downShift = e.shiftKey; pressed = pick(e.clientX, e.clientY);
    const onNeuron = pressed?.kind === 'page';
    // mouse3 (middle or right button) on a neuron picks it up; in Select mode the left button does too
    if (onNeuron && (e.button === 1 || e.button === 2 || (e.button === 0 && mode === 'select' && !spaceDown))) {
      const group = multi.has(pressed) ? [...multi] : [pressed];
      drag = { nodes: group.map(n => ({ n, x: n.x, y: n.y })), sx: e.clientX, sy: e.clientY, moved: false, ldx: 0, ldy: 0 };
      if (mapped()) { const gs = new Set(), loose = []; group.forEach(n => { const g = grpOf(n); g ? gs.add(g) : loose.push(isChild(n) ? n.parent : n); }); drag.groups = [...gs]; drag.loose = [...new Set(loose)]; }
      canvas.setPointerCapture(e.pointerId); canvas.classList.add('moving'); tip.hidden = true;
    } else if (!onNeuron && e.button === 0 && mode === 'select' && !spaceDown) {
      marquee = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    } else canvas.classList.add('grabbing');
  });
  canvas.addEventListener('pointercancel', e => { if (e.pointerType === 'touch') { fingers.delete(e.pointerId); if (touch) touch.multi = true; if (!fingers.size) touch = null; } });
  canvas.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch') {
      fingers.delete(e.pointerId); const t = touch; if (!t) return;
      if (fingers.size) { t.multi = true; return; }   // another finger is still down: a pinch, not a tap
      touch = null;
      if (t.multi || t.moved || t.id !== e.pointerId || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10 || performance.now() - t.t > 350) return;
      const n = pick(e.clientX, e.clientY);
      if (n) { if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) { /* vibration is optional */ } } clickNeuron(n, false); }
      else { multi.clear(); clearSelection(); updateHint(); }
      return;
    }
    canvas.classList.remove('grabbing'); canvas.classList.remove('moving');
    const small = downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5;
    if (drag) {
      if (drag.moved) { drag.groups ? dropGroups(drag) : drag.nodes.forEach(({ n }) => { n.pinned = true; n.fx = n.x; n.fy = n.y; }); sim.alpha(Math.max(sim.alpha(), 0.2)).restart(); updateHint(); }
      else if (downBtn === 0) clickNeuron(pressed, downShift);
      else if (!multi.has(pressed)) { multi.clear(); multi.add(pressed); updateHint(); }   // a plain mouse3 click just picks the neuron for moving
      drag = null;
    } else if (marquee) {
      if (!small) finishMarquee(downShift); else { if (!downShift) { multi.clear(); clearSelection(); } updateHint(); }
      marquee = null;
    } else if (small && downBtn === 0) { const n = pick(e.clientX, e.clientY); n ? clickNeuron(n, downShift) : (multi.clear(), clearSelection(), updateHint()); }
    downAt = null; pressed = null;
  });
  function clickNeuron(n, shift) {
    if (n.kind === 'page' && shift) { multi.has(n) ? multi.delete(n) : multi.add(n); updateHint(); return; }
    if (n.kind === 'page' && !multi.has(n)) multi.clear();
    select(n); updateHint();
  }
  function finishMarquee(shift) {
    const x0 = Math.min(marquee.x0, marquee.x1), x1 = Math.max(marquee.x0, marquee.x1), y0 = Math.min(marquee.y0, marquee.y1), y1 = Math.max(marquee.y0, marquee.y1);
    if (!shift) multi.clear();
    for (const n of activeNodes) {
      if (n.kind !== 'page' || (isChild(n) && depthF < 0.5)) continue;
      const [sx, sy] = toScreen(n.x, n.y);
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) multi.add(n);
    }
    if (multi.size === 1) select([...multi][0], { noZoom: true });
    else if (multi.size > 1 && selected && !multi.has(selected)) clearSelection();
    updateHint();
  }
  function releaseAll() {
    pages.forEach(n => { if (n.pinned) { n.pinned = false; if (n !== selected) { n.fx = null; n.fy = null; } } });
    if (mapped() && mapMoved()) resetMap(); else sim.alpha(0.5).restart();
    updateHint();
  }
  function setMode(m) { mode = m; canvas.classList.toggle('select', m === 'select'); document.querySelectorAll('.tool-mode').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); updateHint(); }
  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') { if (touch && touch.id === e.pointerId && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > 10) touch.moved = true; return; }   // a pan cancels the tap; d3-zoom moves the view
    if (drag) {
      const dx = (e.clientX - drag.sx) / k, dy = (e.clientY - drag.sy) / k;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) >= 3) drag.moved = true;
      if (!drag.moved) return;
      if (drag.groups) { const ddx = dx - drag.ldx, ddy = dy - drag.ldy; drag.ldx = dx; drag.ldy = dy; moveGroups(drag.groups, drag.loose, ddx, ddy); }
      else drag.nodes.forEach(({ n, x, y }) => { n.fx = n.x = x + dx; n.fy = n.y = y + dy; n.vx = n.vy = 0; });
      if (sim.alpha() < 0.12) sim.alpha(0.12).restart();   // let synapses, sources and sub-neurons follow their neuron
      return;
    }
    if (marquee) { marquee.x1 = e.clientX; marquee.y1 = e.clientY; return; }
    if (downAt) return;
    mouseW = toWorld(e.clientX, e.clientY);
    const n = pick(e.clientX, e.clientY);
    if (n !== hover) {
      hover = n; canvas.classList.toggle('pointer', !!n);
      if (n) { tip.hidden = false; tip.innerHTML = tipHtml(n); if (n.kind === 'page') n.neighbors.slice(0, 4).forEach(x => spawnPulse(x.l, true)); }
      else tip.hidden = true;
    }
    if (n) { tip.style.left = Math.min(e.clientX, W - 300) + 'px'; tip.style.top = Math.min(e.clientY, H - 90) + 'px'; }
  });
  canvas.addEventListener('pointerleave', () => { hover = null; mouseW = null; tip.hidden = true; });
  function tipHtml(n) {
    if (n.kind === 'page') return `<span class="k">${isChild(n) ? `sub-neuron of ${esc(n.parent.title)}` : typeName(n) + ' · ' + esc(lobeById[n.lobe].name)}</span><b>${esc(n.title)}</b>${n.nSyn} synapses · ${n.neighbors.length} connections${n.children.length ? ` · ${n.children.length} sub-neurons` : ''}`;
    if (n.kind === 'syn') return sealed(n) ? `<span class="k">sealed synapse of ${esc(pageById[n.page].title)}</span><b>${esc(n.puzzle.q)}</b>solve to unfold · click to answer`
      : `<span class="k">synapse of ${esc(pageById[n.page].title)}</span><b>${esc(n.lead)}</b>${esc(n.text.slice(0, 140))}${n.text.length > 140 ? '…' : ''}`;
    return `<span class="k">${srcKind(n)}</span><b>${esc(n.label)}</b>cited by ${n.pageNodes.length} neuron${n.pageNodes.length > 1 ? 's' : ''}`;
  }
  const srcKind = n => ({ session: 'Perplexity session', github: D.demo ? 'Code host (demo)' : 'GitHub', web: 'Web source', gmail: 'Gmail (metadata)', calendar: 'Google Calendar', spotify: 'Spotify', plaid: 'Bank data (names only)', memory: 'Memory note', wiki: 'Brain page' }[n.kindOf] || 'Source');
  const typeName = n => esc({ project: 'project', entity: 'person / thing', person: 'person', place: 'place', habit: 'habit', event: 'event', account: 'account', trip: 'trip', preference: 'preference', day: D.dayName || 'dream log', audit: 'audit' }[n.type] || n.type || '');
  const pw = (n, w) => w + (n === 1 ? '' : 's');
  const plural = (n, w) => `${n} ${pw(n, w)}`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const panel = document.getElementById('panel'), panelBody = document.getElementById('panel-body');
  document.getElementById('panel-close').addEventListener('click', clearSelection);
  window.addEventListener('keydown', e => {
    if (e.target.closest('input') || e.ctrlKey || e.metaKey || e.altKey) return;   // browser chords (Ctrl+F, Cmd+K) are not shortcuts
    if (e.key === 'Escape') { clearSelection(); hideResults(); multi.clear(); marquee = null; updateHint(); }
    else if (e.key === 'v' || e.key === 'V') setMode('select');
    else if (e.key === 'h' || e.key === 'H') setMode('pan');
    else if (e.key === 'r' || e.key === 'R') releaseAll();
    else if (e.key === 'l' || e.key === 'L') setLabels(!labelsOn);
    else if (e.key === 'g' || e.key === 'G') toggleLayout('genome');
    else if (e.key === 'k' || e.key === 'K') toggleLayout('cell');
    else if (e.key === 'f' || e.key === 'F') toggleLayout('tree');
    else if (e.key === 't' || e.key === 'T') toggleLayout('table');
    else if (e.key === 'e' || e.key === 'E') toggleLayout('horizon');
    else if (e.key === 'z' || e.key === 'Z') toggleLayout('coil');   // C belongs to the NNCCG Charts drawer
    else if (e.key === 'o' || e.key === 'O') toggleLayout('orbit');   // Ctrl/Cmd+O (open a layout file) is handled with the chords
  });

  function select(n, opts = {}) {
    if (selected && selected.kind === 'page' && !selected.pinned) { selected.fx = null; selected.fy = null; }
    selected = n; pulseSyn = null;
    try { window.dispatchEvent(new CustomEvent('mbn:select', { detail: { id: n.id, kind: n.kind, by: opts.by || 'visitor', origin: n.origin || null } })); } catch (e) { /* an add-on threw inside its listener: never the renderer's problem */ }   // add-ons (the Quantum Entangler) listen for visitor selections here; deep links, restores and API calls say who they are
    if (n.kind === 'page' && !isChild(n) && !mapped()) { n.fx = n.x; n.fy = n.y; }   // sub-neurons stay free so they can reach their ring slot; in a map the locus holds it
    if (n.kind === 'page') {
      const kk = isChild(n) ? 3.6 : n.nSyn > 14 ? 2.6 : 3.2;
      if (!opts.noZoom) {
        const folded = isChild(n) && depthF < 0.97;
        zoomTo(folded ? n.parent : n, Math.max(k, kk));          // a folded sub-neuron has no ring slot yet, so head for its parent first
        if (folded) setTimeout(() => { if (selected === n) zoomTo(n, Math.max(k, kk), 700); }, 900);   // then settle on the child once it has unfolded
      }
      n.neighbors.forEach(x => spawnPulse(x.l, true));
    } else if (n.kind === 'syn') {
      pulseSyn = n;
      if (!opts.noZoom) {
        zoomTo(n, Math.max(k, 3.4));
        // a synapse of a folded sub-neuron moves as its page unfolds, so recenter once it has settled
        if (isChild(pageById[n.page]) && depthF < 0.97) setTimeout(() => { if (selected === n) zoomTo(n, Math.max(k, 3.4), 700); }, 900);
      }
    }
    else if (!opts.noZoom) zoomTo(n, Math.max(k, 3));
    renderPanel(n); panel.hidden = false;
    if (n.kind === 'page' && history.replaceState) { try {
      const rest = location.hash.replace(/^#/, '').split('&').filter(x => x && !/^(n|layout)=/.test(x));
      rest.push('n=' + encodeURIComponent(n.id));
      if (layout !== pageLayout) rest.push('layout=' + layout);
      history.replaceState(null, '', '#' + rest.join('&'));
    } catch (_) { /* Opaque preview: selection still works. */ } }
  }
  function clearSelection() { if (selected && selected.kind === 'page' && !selected.pinned) { selected.fx = null; selected.fy = null; } selected = null; pulseSyn = null; panel.hidden = true; }

  function renderPanel(n) {
    const col = lobeColor(n);
    let h = '';
    if (n.kind === 'page') {
      h += `<div class="kind"><span class="sw" style="background:${col};color:${col}"></span>${typeName(n)} · ${esc(lobeById[n.lobe].name)}</div>`;
      h += `<h2>${esc(n.title)}</h2><p class="desc">${esc(n.desc || n.intro)}</p>`;
      const nLock = n.synNodes.filter(sealed).length;
      h += `<div class="meta">${n.updated ? `<span>updated ${n.updated}</span>` : ''}<span>${n.nSyn} synapses</span>${nLock ? `<span class="sealed-n">${nLock} sealed</span>` : ''}<span>${n.neighbors.length} connections</span><span>${n.srcNodes.length} sources</span></div>`;
      const ob = otherBrains(n.id);
      if (brainsIn && n.brain && N && !ob.length) { const b = N.brains.find(x => x.id === n.brain); if (b) h += `<h3>Brain</h3><ul><li class="nb net"><a href="${esc(b.href)}#n=${encodeURIComponent(n.orig || n.id)}"><span class="sw" style="background:${esc(b.color)}"></span><span class="t">Open in the ${esc(b.title)} brain<span class="note">this neuron belongs to ${esc(b.title)} → open</span></span></a></li></ul>`; }
      if (ob.length) h += `<h3>Shared across the network</h3><ul>` + ob.map(b => `<li class="nb net"><a href="${esc(b.href)}#n=${encodeURIComponent(n.id)}"><span class="sw" style="background:${esc(b.color)}"></span><span class="t">Same neuron in ${esc(b.title)}<span class="note">${b.synapses} synapses · ${b.connections} connections there → open</span></span></a></li>`).join('') + `</ul>`;
      if (n.parent) h += `<h3>Part of</h3><ul><li class="nb" data-id="${esc(n.parent.id)}"><span class="sw" style="background:${lobeColor(n.parent)}"></span><span class="t">${esc(n.parent.title)}<span class="note">parent neuron</span></span></li></ul>`;
      if (n.children.length) h += `<h3>Sub-neurons <span>${n.children.length}</span></h3><ul>` + n.children.map(c => `<li class="nb" data-id="${esc(c.id)}"><span class="sw" style="background:${lobeColor(c)}"></span><span class="t">${esc(c.title)}<span class="note">${esc(c.desc || '')}</span></span><span class="w">${c.nSyn}</span></li>`).join('') + `</ul>`;
      if (n.neighbors.length) {
        h += `<h3>Connected neurons</h3><ul>`;
        [...n.neighbors].sort((a, b) => b.l.w - a.l.w).forEach(({ n: m, l }) => {
          const note = l.notes && l.notes.length ? l.notes[0] : l.kinds.includes('see-also') ? 'see also' : 'mentioned in a synapse';
          h += `<li class="nb" data-id="${esc(m.id)}"><span class="sw" style="background:${lobeColor(m)}"></span><span class="t">${esc(m.title)}<span class="note">${esc(note)}</span></span><span class="w">×${l.w}</span></li>`;
        });
        h += `</ul>`;
      }
      if (n.synNodes.length) {
        const bySection = d3.group(n.synNodes, s => s.section);
        h += `<h3>Synapses <span>${n.nSyn}</span></h3>`;
        bySection.forEach((list, sec) => {
          if (bySection.size > 1) h += `<div class="kind" style="margin:8px 0 4px 10px">${esc(sec)}</div>`;
          h += `<ul>` + list.map(s => sealed(s)
            ? `<li class="syn sealed" data-id="${esc(s.id)}"><div class="lead">${esc(s.puzzle.q)}</div><div class="txt">Sealed · solve to unfold</div></li>`
            : `<li class="syn" data-id="${esc(s.id)}"><div class="lead">${esc(s.lead)}</div><div class="txt">${esc(s.text)}</div>${s.links.length ? `<div class="lk">→ ${s.links.map(id => esc(pageById[id]?.title || id)).join(' · ')}</div>` : ''}</li>`).join('') + `</ul>`;
        });
      }
      const incoming = syns.filter(s => s.links.includes(n.id));
      if (incoming.length) {
        h += `<h3>Synapses pointing here <span>${incoming.length}</span></h3><ul>` + incoming.map(s => `<li class="syn${sealed(s) ? ' sealed' : ''}" data-id="${esc(s.id)}"><div class="lead">${esc(pageById[s.page].title)} › ${esc(leadOf(s))}</div><div class="txt">${esc(textOf(s).slice(0, 180))}${textOf(s).length > 180 ? '…' : ''}</div></li>`).join('') + `</ul>`;
      }
      if (n.srcNodes.length) {
        h += `<h3>Sources <span>${n.srcNodes.length}</span></h3><ul>` + n.srcNodes.map(s => `<li class="src"><span class="sk">${esc(srcKindShort(s))}</span>${esc(s.label)}</li>`).join('') + `</ul>`;
      }
    } else if (n.kind === 'syn') {
      const p = pageById[n.page];
      h += `<div class="kind"><span class="sw" style="background:${col};color:${col}"></span>${sealed(n) ? 'sealed synapse' : 'synapse'} · ${esc(n.section)}</div>`;
      if (sealed(n)) {
        // the puzzle stands where the fact will: prompt, an answer box, a hint on request; a wrong answer only shakes the box
        h += `<h2>${esc(n.puzzle.q)}</h2><p class="desc">Solve to unfold this synapse. It stays unfolded for the rest of this session.</p>`;
        h += `<form class="puzzle" autocomplete="off"><input type="text" name="a" placeholder="Your answer" aria-label="Your answer" autocapitalize="off" spellcheck="false"><button type="submit">Solve</button></form>`;
        h += `<div class="puzzle-row">${n.puzzle.hint ? `<button type="button" class="hint-btn">Show a hint</button><span class="puzzle-hint" hidden>${esc(n.puzzle.hint)}</span>` : ''}<span class="verdict" aria-live="polite"></span></div>`;
      } else {
        h += `<h2>${esc(n.lead)}</h2><p class="desc">${esc(n.text)}</p>`;
        if (n.puzzle) h += `<div class="meta"><span class="unfolded">unfolded · solved this session</span></div>`;
      }
      h += `<h3>Belongs to</h3><ul><li class="nb" data-id="${esc(p.id)}"><span class="sw" style="background:${col}"></span><span class="t">${esc(p.title)}</span></li></ul>`;
      if (n.links.length) h += `<h3>Fires toward</h3><ul>` + n.links.map(id => pageById[id] ? `<li class="nb" data-id="${esc(id)}"><span class="sw" style="background:${lobeColor(pageById[id])}"></span><span class="t">${esc(pageById[id].title)}</span></li>` : '').join('') + `</ul>`;
      if (n.cites.length) h += `<h3>Sources</h3><ul>` + n.cites.map(u => srcById[u] ? `<li class="src"><span class="sk">${esc(srcKindShort(srcById[u]))}</span>${esc(srcById[u].label)}</li>` : '').join('') + `</ul>`;
    } else {
      h += `<div class="kind">${esc(srcKindShort(n))}</div><h2>${esc(n.label)}</h2>`;
      h += `<p class="desc">${esc(n.id)}</p>`;
      h += `<h3>Cited by</h3><ul>` + n.pageNodes.map(p => `<li class="nb" data-id="${esc(p.id)}"><span class="sw" style="background:${lobeColor(p)}"></span><span class="t">${esc(p.title)}</span></li>`).join('') + `</ul>`;
    }
    panelBody.innerHTML = h;
    panelBody.querySelectorAll('.nb').forEach(el => el.addEventListener('click', () => { const m = pageById[el.dataset.id]; if (m) { ensureVisible(m); select(m); } }));
    const form = panelBody.querySelector('form.puzzle');
    if (form && n.kind === 'syn') {
      const input = form.querySelector('input'), verdict = panelBody.querySelector('.verdict');
      form.addEventListener('submit', e => {
        e.preventDefault();
        if (solve(n, input.value)) return;   // solve() re-renders the panel with the fact
        verdict.textContent = 'Not yet.'; form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); input.select();
      });
      const hb = panelBody.querySelector('.hint-btn');
      if (hb) hb.addEventListener('click', () => { panelBody.querySelector('.puzzle-hint').hidden = false; hb.hidden = true; });
      setTimeout(() => input.focus(), 50);
    }
    panelBody.querySelectorAll('.syn').forEach(el => el.addEventListener('click', () => {
      const s = synById[el.dataset.id]; if (!s) return;
      if (sealed(s)) { ensureVisible(s); select(s); return; }   // a sealed synapse opens its puzzle instead of just zooming
      panelBody.querySelectorAll('.syn').forEach(x => x.classList.remove('active')); el.classList.add('active');
      ensureVisible(s); pulseSyn = s; zoomTo(s, Math.max(k, 3.4), 800);
      // same folded-child recentering as select(): the synapse moves while its sub-neuron unfolds
      if (isChild(pageById[s.page]) && depthF < 0.97) setTimeout(() => { if (pulseSyn === s) zoomTo(s, Math.max(k, 3.4), 700); }, 900);
    }));
    panel.scrollTop = 0;
  }
  const srcKindShort = s => ({ session: 'session', github: D.demo ? 'code' : 'github', web: 'web', gmail: 'gmail', calendar: 'calendar', spotify: 'spotify', plaid: 'bank', memory: 'memory', wiki: 'brain', mindblown: 'brain', entangler: 'entangler' }[s.kindOf] || 'source');
  function ensureLobe(id) { if (!lobeOn[id]) { lobeOn[id] = true; renderLobeList(); rebuild(false); refreshHome(); } }
  // a sub-neuron needs its own lobe and its parent's lobe on before it can be selected
  function ensureVisible(n) { if (n.kind === 'page') { if (n.parent) ensureLobe(n.parent.lobe); ensureLobe(n.lobe); } else if (n.kind === 'syn') ensureVisible(pageById[n.page]); }

  // ---------- lobe list ----------
  const lobeList = document.getElementById('lobe-list');
  let lobeFitTimer = 0;
  const lobesAside = document.getElementById('lobes');
  document.querySelector('.lobes-head').addEventListener('click', () => lobesAside.classList.toggle('open'));
  function renderLobeList() {
    lobeList.innerHTML = lobes.map(l => {
      const ps = pages.filter(p => p.lobe === l.id && !isChild(p));
      return `<button class="lobe ${lobeOn[l.id] ? '' : 'off'}" data-id="${l.id}" aria-pressed="${lobeOn[l.id]}" style="color:${lobeOn[l.id] ? 'var(--text)' : ''}"><span class="sw" style="background:${l.color};color:${l.color}"></span><span>${esc(l.name)}</span><span class="n">${ps.length}</span></button>`;
    }).join('');
    lobeList.querySelectorAll('.lobe').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.id; lobeOn[id] = !lobeOn[id];
      if (selected && !visible(selected)) clearSelection();
      renderLobeList(); rebuild(false); updateStats();
      // a map re-centres its loci and the pages then move toward them: fit once they have moved (as setLayout and the G toggle do), not to
      // the old positions. Home and the zoom floor always refresh; a selection made during the wait keeps its camera, and settleToHome() already leaves a camera the visitor moved alone.
      clearTimeout(lobeFitTimer);
      if (!mapped()) { refreshHome(); settleToHome(); }
      else { const sel = selected; lobeFitTimer = setTimeout(() => { if (refreshHome() && selected === sel) settleToHome(); }, 350); }
    }));
    window.dispatchEvent(new CustomEvent('mindblown:lobes'));   // overlays (NNCCG charts) follow lobe visibility
  }
  document.getElementById('explode-all').addEventListener('change', e => { forceExplode = e.target.checked; updateLevel(); });
  document.getElementById('cocite').addEventListener('change', e => { showCocite = e.target.checked; rebuild(false); });

  // ---------- zoom controls / level ----------
  // the buttons pass their click as the zoom's sourceEvent so a press that lands past Home settles back like a gesture does
  document.getElementById('z-in').addEventListener('click', e => d3.select(canvas).transition().duration(350).call(zoom.scaleBy, 1.6, null, e));
  document.getElementById('z-out').addEventListener('click', e => d3.select(canvas).transition().duration(350).call(zoom.scaleBy, 1 / 1.6, null, e));
  document.getElementById('z-fit').addEventListener('click', () => { clearSelection(); fitAll(); });
  // ---------- side rail ----------
  // The right-hand column groups every shortcut by job so it stays short as functions grow: Tools (select, pan, release), View (labels,
  // layouts), File (saved layouts, screenshot) and Zoom. Layouts and saved layouts open flyouts beside the rail instead of adding a button per
  // entry. Injected so every brain page gets it without markup changes; the markup's #zoom-ctl is adopted as the last group.
  const svg = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    neural: svg('<circle cx="12" cy="12" r="2.4"/><circle cx="5" cy="7" r="1.6"/><circle cx="19" cy="6" r="1.6"/><circle cx="18.5" cy="17.5" r="1.6"/><circle cx="6" cy="18" r="1.6"/><path d="M9.9 10.8 6.3 8M14 10.6 17.7 7.1M13.8 13.6l3.4 2.8M10.1 13.5 7.2 16.8"/>'),
    genome: svg('<path d="M7 3.5c-1.6 0-2.5 1-2.5 2.5v3.6c0 1 .7 1.6 1.4 2.1-.7.5-1.4 1.1-1.4 2.1V18c0 1.5.9 2.5 2.5 2.5s2.5-1 2.5-2.5v-4.2c0-1-.7-1.6-1.4-2.1.7-.5 1.4-1.1 1.4-2.1V6c0-1.5-.9-2.5-2.5-2.5z"/><path d="M17 3.5c-1.6 0-2.5 1-2.5 2.5v5.2c0 1 .7 1.6 1.4 2.1-.7.5-1.4 1.1-1.4 2.1V18c0 1.5.9 2.5 2.5 2.5s2.5-1 2.5-2.5v-2.6c0-1-.7-1.6-1.4-2.1.7-.5 1.4-1.1 1.4-2.1V6c0-1.5-.9-2.5-2.5-2.5z"/><path d="M4.5 7.5h5M4.5 16h5M14.5 8.5h5M14.5 17h5"/>'),
    cell: svg('<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><path d="M12 7v5M12 12l4.3 2.5M12 12l-4.3 2.5"/>'),
    tree: svg('<circle cx="5" cy="12" r="2.2"/><circle cx="19" cy="5.5" r="2.2"/><circle cx="19" cy="12" r="2.2"/><circle cx="19" cy="18.5" r="2.2"/><path d="M7.2 12h4.8M12 12V5.5h4.8M12 12h4.8M12 12v6.5h4.8"/>'),
    coil: svg('<ellipse cx="12" cy="15" rx="7" ry="2.6"/><path d="M12 17.6v3M8.5 20.6h7M12 12.4l-2.2-3.4 1.6-1.2L9.6 4.2M12 12.4l2.4-3 -1.2-1.4L15.4 4M12 12.4V7.5l1-1.6"/>'),
    horizon: svg('<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="4.6" opacity="0.6"/><path d="M4 12a8 8 0 0 1 8-8"/><path d="M20 12a8 8 0 0 1-8 8"/><path d="M2.5 12a9.5 9.5 0 0 0 5.2 8.5" opacity="0.5"/><path d="M21.5 12a9.5 9.5 0 0 0-5.2-8.5" opacity="0.5"/>'),
    table: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4" opacity="0.45"/><path d="M12 3.5v2.2M20.5 12h-2.2M12 20.5v-2.2M3.5 12h2.2M18 6l-1.6 1.6M18 18l-1.6-1.6M6 18l1.6-1.6M6 6l1.6 1.6"/>'),
    orbit: svg('<circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="5.2" opacity="0.7"/><circle cx="12" cy="12" r="9.2" opacity="0.45"/><circle cx="12" cy="6.8" r="1.3" fill="currentColor"/><circle cx="16.5" cy="15" r="1.3" fill="currentColor"/><circle cx="4.1" cy="8.4" r="1.3" fill="currentColor"/><circle cx="19.5" cy="7.6" r="1.3" fill="currentColor"/><circle cx="9.4" cy="20.8" r="1.3" fill="currentColor"/>'),
    labels: svg('<path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/>'),
    save: svg('<path d="M5 3.5h11l3.5 3.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M7.5 3.5v5h8v-5"/><rect x="7" y="13" width="10" height="7.5" rx="1"/>'),
    shot: svg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>'),
    open: svg('<path d="M3.5 7.5V5.5A1.5 1.5 0 0 1 5 4h4l2 2.5h7.5A1.5 1.5 0 0 1 20 8v1.5"/><path d="M3.5 7.5h17l-1.6 10.2a1.5 1.5 0 0 1-1.5 1.3H6.6a1.5 1.5 0 0 1-1.5-1.3z"/>'),
    down: svg('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/>'),
  };
  const rail = document.createElement('div'); rail.id = 'rail'; rail.className = 'rail';
  const railGroup = (id, label, html) => { const g = document.createElement('div'); g.id = id; g.className = 'zoom-ctl rail-group'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', label); g.innerHTML = html; rail.appendChild(g); return g; };
  railGroup('tools', 'Tools', `<button class="tool-mode on" data-mode="select" title="Select & move (V): drag a box to select neurons, drag neurons to move them; mouse3 or Space pans" aria-label="Select and move tool">⬚</button>
    <button class="tool-mode" data-mode="pan" title="Pan (H): drag to pan the view" aria-label="Pan tool">✋</button>
    <button id="release-pins" title="Release hand-placed neurons (R)" aria-label="Release hand-placed neurons">⟲</button>`);
  railGroup('view-tools', 'View', `<button id="labels-toggle" title="Labels on/off (L): when off, only the neuron or lobe under the cursor keeps its label" aria-label="Toggle labels" aria-pressed="true">${ICON.labels}</button>
    <button id="layout-menu" title="Layouts: neural, genome (G), karyocyte (K), family tree (F), table (T), coil (Z) or orbit (O)" aria-label="Choose a layout" aria-haspopup="menu" aria-expanded="false">${ICON.neural}</button>`);
  railGroup('file-tools', 'File', `<button id="save-layout" title="Saved layouts (Ctrl+S): keep this arrangement in the browser, download it as a file or open one" aria-label="Saved layouts" aria-haspopup="dialog" aria-expanded="false">${ICON.save}</button>
    <button id="shot" title="Screenshot (S): save the current view as a PNG" aria-label="Save a screenshot">${ICON.shot}</button>`);
  const zoomCtl = document.getElementById('zoom-ctl'); zoomCtl.classList.add('rail-group'); zoomCtl.before(rail); rail.appendChild(zoomCtl);
  // Brains: actions that place a brain on the canvas (Modifier Brain, Origin Brain …) live in their own group at the top of the rail, not in the
  // Lobes panel. Add-on scripts call MINDBLOWN_RAIL.brainButton({ id, label, title, icon }) and get the button back; the group appears with its first button.
  // the rail is static on desktop: an open details panel sits to its left, adjacent and never over it. left() is the rail's left edge
  // (every rail control plus the Drive, Entangler and Randonaut stacked above it); --rail-clear is read by .panel in style.css
  function railLeft() {
    let l = rail.getBoundingClientRect().left;
    ['mb-drive', 'mb-entangler', 'mb-rando-dock'].forEach(id => { const e = document.getElementById(id); if (!e || e.hidden || e.classList.contains('mb-hidden') || !e.getClientRects().length) return; const q = e.getBoundingClientRect(); if (q.width && q.left > window.innerWidth / 2) l = Math.min(l, q.left); });
    return Math.round(l);
  }
  // where an overlay beside the rail (a flyout, the Randonaut settings) must end: left of the rail and, on desktop, left of an open details
  // panel too, so neither covers the neuron being read
  function overlayLeft() {
    let l = railLeft(); const d = document.getElementById('panel');
    if (d && !d.hidden && window.innerWidth > 900 && d.getClientRects().length) { const q = d.getBoundingClientRect(); if (q.width && q.left > window.innerWidth / 3) l = Math.min(l, Math.round(q.left)); }
    return l;
  }
  function railClear() { const v = Math.max(20, window.innerWidth - railLeft() + 10) + 'px'; if (document.documentElement.style.getPropertyValue('--rail-clear') !== v) document.documentElement.style.setProperty('--rail-clear', v); }
  window.addEventListener('resize', railClear); setInterval(() => { railClear(); placeFly(); }, 300); requestAnimationFrame(railClear);   // placeFly: a details panel that opens under an open flyout moves it aside
  window.MINDBLOWN_RAIL = {
    svg, rail, left: railLeft, overlayLeft,
    brainButton({ id, label, title, icon }) {
      let g = document.getElementById('brain-tools');
      if (!g) { g = document.createElement('div'); g.id = 'brain-tools'; g.className = 'zoom-ctl rail-group'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'Brains'); rail.prepend(g); }
      const b = document.createElement('button'); b.type = 'button'; b.id = id; b.title = title || label; b.setAttribute('aria-label', label); if (icon) b.innerHTML = icon; else b.textContent = label;   // icon: authored SVG only; a label is text
      g.appendChild(b); return b;
    },
    // a view tool from an add-on (NNCCG Charts) joins an existing rail group, e.g. 'view-tools'; same contract as brainButton
    toolButton({ group, id, label, title, icon }) {
      const g = document.getElementById(group); if (!g || !rail.contains(g)) return null;
      const b = document.createElement('button'); b.type = 'button'; b.id = id; b.title = title || label; b.setAttribute('aria-label', label); if (icon) b.innerHTML = icon; else b.textContent = label;
      g.appendChild(b); return b;
    },
    closeFlyout: () => hideFly(),   // an add-on panel opening beside the rail closes the rail's own flyout first
  };
  rail.querySelectorAll('.tool-mode').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.getElementById('release-pins').addEventListener('click', releaseAll);
  // flyouts: one open at a time, beside the rail and level with the button that owns it; Esc, a click outside or the button again closes it
  const stage = document.getElementById('stage');
  let openFly = null;
  function flyout(id, label, role) { const f = document.createElement('div'); f.id = id; f.className = 'flyout'; f.hidden = true; f.setAttribute('role', role); f.setAttribute('aria-label', label); stage.appendChild(f); return f; }
  function showFly(f, btn) {
    document.dispatchEvent(new CustomEvent('mindblown:flyout'));   // add-on panels beside the rail (Modifier Brain) step aside
    if (openFly && openFly.f !== f) hideFly();
    f.hidden = false; openFly = { f, btn }; btn.setAttribute('aria-expanded', 'true'); btn.classList.add('open');
    placeFly();
  }
  function placeFly() {
    if (!openFly) return; const { f, btn } = openFly;
    const r = btn.getBoundingClientRect(), right = (window.innerWidth - overlayLeft() + 10) + 'px';
    if (f.style.right !== right) f.style.right = right;
    f.style.top = Math.max(72, Math.min(r.top - 6, window.innerHeight - f.offsetHeight - 12)) + 'px';
  }
  function hideFly() { if (!openFly) return; if (openFly.f.contains(document.activeElement)) openFly.btn.focus();   // focus leaves with the flyout, so the single-key shortcuts work again
    openFly.f.hidden = true; openFly.btn.setAttribute('aria-expanded', 'false'); openFly.btn.classList.remove('open'); openFly = null; }
  const toggleFly = (f, btn) => (openFly && openFly.f === f ? hideFly() : showFly(f, btn));
  document.addEventListener('pointerdown', e => { if (openFly && !openFly.f.contains(e.target) && !openFly.btn.contains(e.target)) hideFly(); }, true);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && openFly) { hideFly(); } });
  window.addEventListener('resize', () => { if (openFly) showFly(openFly.f, openFly.btn); });
  // layouts flyout: every layout as a row (icon, name, what it shows, key); the rail button wears the current layout's icon
  const LAYOUT_ROWS = [
    ['neural', 'neural-toggle', 'Neural', 'force-directed: lobes, neurons and synapses find their own places', ''],
    ['genome', 'layout-toggle', 'Genome', 'a karyogram: lobes or brains as chromosomes, neurons as bands', 'G'],
    ['cell', 'cell-toggle', 'Karyocyte', 'one cell: lobes as territories in the nucleus, the hub as nucleolus', 'K'],
    ['tree', 'tree-toggle', 'Family tree', 'the hub as ancestor, each lobe a branch, neurons the generations', 'F'],
    ['table', 'table-toggle', 'Table', 'a round table with no head: lobes as seats, neurons as chairs', 'T'],
    ['coil', 'coil-toggle', 'Coil', 'a Tesla coil in discharge: the hub in the toroid, lobes as streamers, neurons as kinks', 'Z'],
    ['orbit', 'orbit-toggle', 'Orbit', 'the hub at the centre, neurons on concentric rings, chains of connections as spokes', 'O'],
    ['horizon', 'horizon-toggle', 'Horizon', 'a black hole face-on: the hub in the event horizon, lobes as arcs of the accretion disk, neurons as knots', 'E'],
  ];
  const layFly = flyout('layout-flyout', 'Layouts', 'menu');
  layFly.innerHTML = `<div class="fly-head">Layouts</div>` + LAYOUT_ROWS.map(([l, id, name, what, key]) => `<button class="fly-row lay" id="${id}" data-layout="${l}" role="menuitemradio" aria-checked="false" aria-pressed="false">${ICON[l]}<span class="fly-text"><b>${name}</b><small>${what}</small></span>${key ? `<kbd>${key}</kbd>` : ''}</button>`).join('');
  const layoutMenuBtn = document.getElementById('layout-menu');
  layoutMenuBtn.addEventListener('click', () => toggleFly(layFly, layoutMenuBtn));
  // labels toggle: a tool button and a switch in the lobes panel drive the same state
  const switches = document.querySelector('#lobes .switches');
  if (switches) {
    [['layout-horizon', 'Horizon layout'], ['layout-orbit', 'Orbit layout'], ['layout-coil', 'Coil layout'], ['layout-table', 'Table layout'], ['layout-tree', 'Family tree layout'], ['layout-cell', 'Karyocyte layout'], ['layout-genome', 'Genome layout']].forEach(([id, name]) => { const g = document.createElement('label'); g.className = 'switch'; g.innerHTML = `<input type="checkbox" id="${id}"><span>${name}</span>`; switches.prepend(g); });
    const l = document.createElement('label'); l.className = 'switch'; l.innerHTML = '<input type="checkbox" id="labels" checked><span>Labels</span>'; switches.prepend(l);
  }
  // layout switch: a tool button, a switch in the lobes panel and a key drive the same state per map; the hash carries it so a link can open a map
  const LAYOUT_UI = {
    genome: { btn: 'layout-toggle', sw: 'layout-genome', key: 'G', flash: 'genome layout · chromosomes are lobes, bands are neurons, the hub sits at the centromere', noun: 'chromosomes', one: 'chromosome', unit: 'band', hint: 'genome layout · each bar is a lobe, each band a neuron' },
    cell: { btn: 'cell-toggle', sw: 'layout-cell', key: 'K', flash: 'karyocyte layout · the brain is one cell: lobes are territories in the nucleus, the hub its nucleolus', noun: 'cells', one: 'cell', unit: 'neuron', hint: 'karyocyte layout · the nucleus holds the lobes as territories, the hub is the nucleolus' },
    tree: { btn: 'tree-toggle', sw: 'layout-tree', key: 'F', flash: 'family tree layout · the hub is the ancestor, each lobe a branch, neurons and sub-neurons the generations', noun: 'branches', one: 'branch', unit: 'neuron', hint: 'family tree layout · the hub is the ancestor, each plate a lobe, each row a neuron' },
    table: { btn: 'table-toggle', sw: 'layout-table', key: 'T', flash: 'table layout · a round table with no head · seats are lobes, chairs are neurons, synapses lie on the table', noun: 'seats', one: 'seat', unit: 'chair', hint: 'table layout · each seat is a lobe, each chair a neuron, nobody sits at the head' },
    coil: { btn: 'coil-toggle', sw: 'layout-coil', key: 'Z', flash: 'coil layout · a Tesla coil in discharge · the hub stands in the toroid, every lobe is a streamer, every neuron a kink of the bolt', noun: 'streamers', one: 'streamer', unit: 'kink', hint: 'coil layout · the hub stands in the toroid, each streamer is a lobe, each kink a neuron' },
    orbit: { btn: 'orbit-toggle', sw: 'layout-orbit', key: 'O', flash: 'orbit layout · the hub at the centre, neurons on concentric rings, connections running outward like spokes', noun: 'rings', one: 'ring', unit: 'neuron', hint: 'orbit layout · the hub sits at the centre and each ring is a stage outward' },
    horizon: { btn: 'horizon-toggle', sw: 'layout-horizon', key: 'E', flash: 'horizon layout · a black hole face-on · the hub stands in the event horizon, every lobe is an arc of the accretion disk, every neuron a knot of infalling matter', noun: 'arcs', one: 'arc', unit: 'knot', hint: 'horizon layout · the hub stands in the event horizon, each arc is a lobe, each knot a neuron' },
  };
  // the rail button, the flyout rows and the lobes-panel switches all show the same layout
  function syncLayoutUI() {
    Object.entries(LAYOUT_UI).forEach(([id, u]) => { const on = layout === id, b = document.getElementById(u.btn); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } const c = document.getElementById(u.sw); if (c) c.checked = on; });
    const nb = document.getElementById('neural-toggle'); if (nb) { nb.classList.toggle('on', !mapped()); nb.setAttribute('aria-pressed', String(!mapped())); }
    layFly.querySelectorAll('.lay').forEach(b => b.setAttribute('aria-checked', b.getAttribute('aria-pressed')));
    layoutMenuBtn.innerHTML = ICON[layout]; layoutMenuBtn.classList.toggle('on', mapped()); layoutMenuBtn.title = `Layouts: ${mapped() ? LAYOUT_UI[layout].one.replace(/^\w/, c => c.toUpperCase()) + ' map' : 'neural'} now · G, K, F, T, Z, O or E jump to a map`;
  }
  let layoutFitTimer;
  function setLayout(l, opts = {}) {
    if (!LAYOUTS.includes(l)) return;
    const changed = l !== layout; layout = l;
    syncLayoutUI();
    if (!changed) return;
    clearTimeout(layoutFitTimer);
    // hand-placed pins would fight the loci, so both directions start from free neurons; the selected neuron keeps its pin in the neural layout
    pages.forEach(n => { n.pinned = false; n.fx = null; n.fy = null; });
    if (mapped()) relayout(false); else if (selected && selected.kind === 'page' && !isChild(selected)) { selected.fx = selected.x; selected.fy = selected.y; }
    refreshForces(); rebuild(false); sim.alpha(0.9).restart();
    if (history.replaceState) { const h = location.hash.replace(/[#&]layout=\w+\b/g, '').replace(/^&/, '#'); try { history.replaceState(null, '', (layout !== pageLayout ? (h.length > 1 ? h + '&' : '#') + 'layout=' + layout : h) || location.pathname + location.search); } catch (_) { /* Opaque preview: layout still works. */ } }   // the hash carries the layout only when it differs from the page default, so neural survives a reload on a map-default page
    if (!opts.silent) {
      flash(mapped() ? LAYOUT_UI[layout].flash : 'neural layout');
      if (!opts.noFit) {
        clearSelection();
        // Retire the old selection now. Never close a new search/detail
        // selection made during the layout's settling window.
        layoutFitTimer = setTimeout(() => { if (!selected) fitAll(1100); }, 350);
      }
    }
    updateHint();
  }
  // switching a map off returns to the page's own default layout (MINDBLOWN_OPTIONS.layout); switching the default itself off goes to neural
  function offLayout(l) { return l === pageLayout ? 'neural' : pageLayout; }   // hoisted: updateHint can run before this line
  const toggleLayout = l => setLayout(layout === l ? offLayout(l) : l);
  layFly.querySelectorAll('.lay').forEach(b => b.addEventListener('click', () => { setLayout(b.dataset.layout); hideFly(); }));
  Object.entries(LAYOUT_UI).forEach(([id, u]) => document.getElementById(u.sw)?.addEventListener('change', e => setLayout(e.target.checked ? id : offLayout(id))));
  if (mapped()) setLayout(layout, { silent: true }); else syncLayoutUI();   // initial state from MINDBLOWN_OPTIONS or the hash, without the toast
  function setLabels(on, quiet) {
    labelsOn = on;
    const b = document.getElementById('labels-toggle'); b.classList.toggle('off', !on); b.setAttribute('aria-pressed', String(on));
    const c = document.getElementById('labels'); if (c) c.checked = on;
    if (!quiet) flash(on ? 'labels on' : 'labels off · hover a neuron or lobe to read it');
  }
  if (!labelsOn) { const b = document.getElementById('labels-toggle'); b.classList.add('off'); b.setAttribute('aria-pressed', 'false'); const c = document.getElementById('labels'); if (c) c.checked = false; }   // initial state from MINDBLOWN_OPTIONS, without the toast
  document.getElementById('labels-toggle').addEventListener('click', () => setLabels(!labelsOn));
  document.getElementById('labels')?.addEventListener('change', e => setLabels(e.target.checked));
  // ---------- files: the user chooses where a download goes when the browser allows it ----------
  // Chromium offers showSaveFilePicker (a real Save As dialog, so the user picks the folder and name); elsewhere, and inside sandboxed
  // previews where the picker is refused, a plain download goes to the browser's download folder. Returns the saved name, or null when
  // the user cancelled.
  const canPick = () => window.isSecureContext && window.self === window.top;
  async function saveBlob(blob, name, desc, mime, ext) {
    if (canPick() && typeof window.showSaveFilePicker === 'function') {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime]: [ext] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close(); return h.name || name;
      } catch (e) { if (e && e.name === 'AbortError') return null; }   // any other refusal (policy, origin): fall back to a plain download
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); return name;
  }
  async function pickFile(desc, mime, ext) {
    if (canPick() && typeof window.showOpenFilePicker === 'function') {
      try { const [h] = await window.showOpenFilePicker({ multiple: false, types: [{ description: desc, accept: { [mime]: [ext] } }] }); return h ? await h.getFile() : null; }
      catch (e) { if (e && e.name === 'AbortError') return null; }
    }
    return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = `${ext},${mime}`; i.addEventListener('change', () => res(i.files && i.files[0] || null)); i.addEventListener('cancel', () => res(null)); i.click(); });
  }
  const fileStamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brain';
  const brainTitle = () => (document.querySelector('.brand .title') || {}).textContent || D.title || 'MindBlown';
  // screenshot: the canvas on the page background, with a small caption; saved as PNG
  function screenshot() {
    const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
    const o = out.getContext('2d');
    const g = o.createRadialGradient(out.width / 2, out.height * 0.45, 0, out.width / 2, out.height * 0.45, Math.max(out.width, out.height) * 0.7);
    g.addColorStop(0, '#0e1322'); g.addColorStop(1, '#06080f'); o.fillStyle = g; o.fillRect(0, 0, out.width, out.height);
    o.drawImage(canvas, 0, 0);
    const title = brainTitle();
    o.setTransform(dpr, 0, 0, dpr, 0, 0); o.textBaseline = 'alphabetic'; o.textAlign = 'left';
    o.font = `500 ${12}px 'Satoshi', sans-serif`; o.fillStyle = 'rgba(167,178,204,0.85)';
    o.fillText(`${title} · ${levelText.textContent} · ${new Date().toISOString().slice(0, 10)}`, 16, H - 14);
    const name = `${slug(title)}-${fileStamp()}.png`;
    out.toBlob(blob => {
      if (!blob) { flash('screenshot failed'); return; }
      saveBlob(blob, name, 'PNG image', 'image/png', '.png').then(saved => flash(saved ? `saved ${saved}` : 'screenshot cancelled'));
    }, 'image/png');
  }
  document.getElementById('shot').addEventListener('click', screenshot);
  window.addEventListener('keydown', e => { if ((e.key === 's' || e.key === 'S') && !e.target.closest('input') && !e.metaKey && !e.ctrlKey) screenshot(); });

  // ---------- saved layouts ----------
  // A layout is the arrangement the user made of this brain: the layout mode, every neuron's place (and which are pinned), hand-moved
  // map groups, the lobes that are on, labels / explode / shared-source switches, the tool mode, the camera, the open neuron and any Modifier Brain scenario. Layouts
  // are kept in this browser (localStorage, per brain) and can be downloaded as `.mindblown-layout.json` or opened from such a file.
  // Nothing leaves the browser. A file names its brain so one saved from another brain is refused rather than scrambling this one.
  const LAYOUT_FORMAT = 'mindblown-layout/1';
  const layoutStoreKey = 'mindblown.layouts.' + (D.title || 'brain') + '|' + location.pathname;
  const isLayout = s => !!s && typeof s === 'object' && s.format === LAYOUT_FORMAT && typeof s.name === 'string' && LAYOUTS.includes(s.layout) && s.positions && typeof s.positions === 'object';
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
  const pair = v => (Array.isArray(v) && v.length === 2 ? [num(v[0]), num(v[1])] : null);
  const ownPage = id => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(pageById, id) && pageById[id].kind === 'page' ? pageById[id] : null);   // file ids like __proto__ never reach a page lookup
  const point = v => (Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0], v[1]] : null);   // positions must be real numbers; offsets fall back to 0 via pair()
  function readLayouts() { try { const ls = window.localStorage; const v = JSON.parse(ls.getItem(layoutStoreKey) || '[]'); return Array.isArray(v) ? v.filter(isLayout) : []; } catch { return []; } }
  function writeLayouts(list) { try { const ls = window.localStorage; ls.setItem(layoutStoreKey, JSON.stringify(list)); return true; } catch { return false; } }
  function captureLayout(name) {
    const positions = {}; pages.forEach(p => { positions[p.id] = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]; });
    const groups = {}; groupsNow().forEach(g => { if (g.ox || g.oy) groups[g.id] = [g.ox, g.oy]; });
    const loose = {}; pages.forEach(p => { if (p.gox || p.goy) loose[p.id] = [p.gox, p.goy]; });
    return {
      format: LAYOUT_FORMAT, name, savedAt: new Date().toISOString(),
      brain: { title: D.title || brainTitle(), path: location.pathname, center: D.center || null, built: D.built || null, neurons: pages.length },
      layout, view: { k, cx: (W / 2 - tx) / k, cy: (H / 2 - ty) / k },   // the camera as a world point and scale, so it survives a different window size
      lobes: { ...lobeOn }, labels: labelsOn, explode: forceExplode, cocite: showCocite, mode,
      positions, pins: pages.filter(p => p.pinned).map(p => p.id), groups, loose,
      selected: selected && selected.kind === 'page' ? selected.id : null,
      ...(window.MINDBLOWN_MODIFIERS ? { modifiers: window.MINDBLOWN_MODIFIERS.snapshot() } : {}),   // the Modifier Brain scenario, when this page has one
    };
  }
  function applyLayout(s) {
    if (!isLayout(s)) { flash('that is not a MindBlown layout'); return false; }
    // the same brain means the same title and centre; a layout without them (hand-made) falls back on the position overlap alone
    const sb = s.brain && typeof s.brain === 'object' ? s.brain : {};
    if ((sb.title && sb.title !== (D.title || brainTitle())) || (sb.center && D.center && sb.center !== D.center)) { flash(`that layout belongs to another brain${sb.title ? ` (${sb.title})` : ''}`); return false; }
    const known = pages.filter(p => point(s.positions[p.id])).length;   // an older build of this brain still has most of its neurons
    if (known < Math.max(1, pages.length * 0.5)) { flash(`that layout belongs to another brain${s.brain && s.brain.title ? ` (${s.brain.title})` : ''}`); return false; }
    // the scenario goes first: if it cannot be restored (a cycle, a malformed snapshot) nothing changes; older layouts have no scenario and leave the current one alone
    if (Object.prototype.hasOwnProperty.call(s, 'modifiers') && window.MINDBLOWN_MODIFIERS && !window.MINDBLOWN_MODIFIERS.restore(s.modifiers)) { flash('that layout’s Modifier scenario could not be restored · nothing changed'); return false; }
    clearSelection(); multi.clear(); marquee = null;
    if (s.lobes && typeof s.lobes === 'object') lobes.forEach(l => { if (typeof s.lobes[l.id] === 'boolean') lobeOn[l.id] = s.lobes[l.id]; });
    renderLobeList();
    if (typeof s.labels === 'boolean') setLabels(s.labels, true);
    forceExplode = !!s.explode; document.getElementById('explode-all').checked = forceExplode;
    showCocite = !!s.cocite; document.getElementById('cocite').checked = showCocite;
    if (s.mode === 'pan' || s.mode === 'select') setMode(s.mode);
    setLayout(s.layout, { silent: true, noFit: true });   // releases every pin and lays the map out fresh; the saved places go on top
    pages.forEach(p => { p.pinned = false; p.fx = null; p.fy = null; const q = point(s.positions[p.id]); if (q) { p.x = q[0]; p.y = q[1]; p.vx = p.vy = 0; } });
    syns.forEach(n => { const p = pageById[n.page]; n.x = p.x + (Math.random() - 0.5) * 4; n.y = p.y + (Math.random() - 0.5) * 4; n.vx = n.vy = 0; });
    srcs.forEach(n => { const p = n.pageNodes[0]; n.x = p.x + (Math.random() - 0.5) * 4; n.y = p.y + (Math.random() - 0.5) * 4; n.vx = n.vy = 0; });
    if (mapped()) {
      groupsNow().forEach(g => { const o = s.groups && pair(s.groups[g.id]); g.ox = o ? o[0] : 0; g.oy = o ? o[1] : 0; });
      pages.forEach(p => { const o = s.loose && pair(s.loose[p.id]); p.gox = o ? o[0] : 0; p.goy = o ? o[1] : 0; });
      relayout(false);
    } else (Array.isArray(s.pins) ? s.pins : []).forEach(id => { const p = ownPage(id); if (p && !isChild(p)) { p.pinned = true; p.fx = p.x; p.fy = p.y; } });
    refreshForces(); rebuild(false); sim.alpha(mapped() ? 0.5 : 0.12);   // the free layout was an equilibrium when saved, so a gentle restart keeps it
    refreshHome();
    const savedK = num(s.view && s.view.k, 0);
    if (savedK > 0) {
      const kk = Math.min(K_MAX, Math.max(kMin, savedK));
      // the saved centre point stays at the screen centre; a view saved below the live floor is raised to it and run through the soft bounds, since zoom.transform skips them
      let t = d3.zoomIdentity.translate(W / 2 - num(s.view.cx) * kk, H / 2 - num(s.view.cy) * kk).scale(kk);
      if (kk !== savedK) t = zoom.constrain()(t, [[0, 0], [W, H]], null);
      atHome = false; d3.select(canvas).transition().duration(700).ease(d3.easeCubicInOut).call(zoom.transform, t);
    }
    const sel = ownPage(s.selected); if (sel && visible(sel)) select(sel, { noZoom: true, by: 'restore' });
    updateLevel(); updateHint(); updateStats();
    return true;
  }
  const whenText = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const layoutName = l => { const r = LAYOUT_ROWS.find(x => x[0] === l); return r ? r[2] : l; };
  const saveFly = flyout('layouts-flyout', 'Saved layouts', 'dialog');
  saveFly.innerHTML = `<div class="fly-head">Saved layouts <span class="n" id="layouts-count"></span></div>
    <form class="fly-save" id="layout-save-form"><input id="layout-name" type="text" maxlength="60" autocomplete="off" placeholder="Name this arrangement" aria-label="Layout name"><button type="submit" class="fly-btn primary" title="Keep this arrangement in this browser (Ctrl+S)">Save</button></form>
    <ul class="fly-list" id="layouts-list"></ul>
    <div class="fly-foot"><button type="button" class="fly-btn" id="layout-open">${ICON.open}<span>Open file…</span></button><button type="button" class="fly-btn" id="layout-download" title="Download the current arrangement as a file (Ctrl+Shift+S)">${ICON.down}<span>Download current</span></button></div>
    <div class="fly-note">Kept in this browser only · a file keeps it anywhere</div>`;
  const saveBtn = document.getElementById('save-layout'), nameInput = document.getElementById('layout-name'), layoutsList = document.getElementById('layouts-list');
  function renderLayouts() {
    const list = readLayouts();
    document.getElementById('layouts-count').textContent = list.length ? String(list.length) : '';
    layoutsList.innerHTML = list.length ? list.map((s, i) => `<li><button type="button" class="fly-row apply" data-i="${i}" title="Apply this layout">${ICON[s.layout] || ICON.neural}<span class="fly-text"><b>${esc(s.name)}</b><small>${esc(layoutName(s.layout))} layout · ${esc(whenText(s.savedAt))}</small></span></button><button type="button" class="fly-mini" data-dl="${i}" title="Download as a file" aria-label="Download ${esc(s.name)}">${ICON.down}</button><button type="button" class="fly-mini" data-del="${i}" title="Delete" aria-label="Delete ${esc(s.name)}">×</button></li>`).join('')
      : '<li class="fly-empty">Nothing saved for this brain yet. Arrange it, name it and press Save.</li>';
    nameInput.placeholder = `Layout ${list.length + 1}`;
  }
  const layoutFile = s => new Blob([JSON.stringify(s, null, 1)], { type: 'application/json' });
  const layoutFileName = s => `${slug(brainTitle())}-${slug(s.name)}.mindblown-layout.json`;
  function saveLayout(name) {
    const list = readLayouts(), s = captureLayout((name || '').trim() || `Layout ${list.length + 1}`);
    const at = list.findIndex(x => x.name === s.name); if (at >= 0) list[at] = s; else list.push(s);   // the same name replaces, so a working layout can be re-saved
    if (!writeLayouts(list)) { flash('this browser refused to store the layout · download it instead'); return null; }
    renderLayouts(); nameInput.value = ''; flash(`saved layout “${s.name}” in this browser${at >= 0 ? ' (replaced)' : ''}`); return s;
  }
  async function downloadLayout(s) { const saved = await saveBlob(layoutFile(s), layoutFileName(s), 'MindBlown layout', 'application/json', '.json'); flash(saved ? `saved ${saved}` : 'download cancelled'); }
  async function openLayoutFile() {
    const f = await pickFile('MindBlown layout', 'application/json', '.json'); if (!f) return;
    let s = null; try { s = JSON.parse(await f.text()); } catch { flash('could not read that file as a layout'); return; }
    if (!applyLayout(s)) return;
    const list = readLayouts(); let kept = true;
    if (!list.some(x => x.name === s.name && x.savedAt === s.savedAt)) { list.push(s); kept = writeLayouts(list); }   // an opened file joins the browser's list so it is one click away next time
    renderLayouts(); flash(kept ? `opened layout “${s.name}”` : `opened layout “${s.name}” · this browser refused to keep it, so open the file again next time`);
  }
  saveBtn.addEventListener('click', () => { renderLayouts(); toggleFly(saveFly, saveBtn); if (!saveFly.hidden) nameInput.focus(); });
  document.getElementById('layout-save-form').addEventListener('submit', e => { e.preventDefault(); saveLayout(nameInput.value); });
  document.getElementById('layout-open').addEventListener('click', openLayoutFile);
  document.getElementById('layout-download').addEventListener('click', () => downloadLayout(captureLayout((nameInput.value || '').trim() || `Layout ${fileStamp()}`)));
  layoutsList.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const list = readLayouts();
    if (b.dataset.i !== undefined) { const s = list[+b.dataset.i]; if (s && applyLayout(s)) { hideFly(); flash(`layout “${s.name}”`); } }
    else if (b.dataset.dl !== undefined) { const s = list[+b.dataset.dl]; if (s) downloadLayout(s); }
    else if (b.dataset.del !== undefined) { const s = list[+b.dataset.del]; list.splice(+b.dataset.del, 1); writeLayouts(list); renderLayouts(); if (s) flash(`deleted “${s.name}”`); }
  });
  // Ctrl/Cmd+S opens the saved layouts (a second press, or Enter, saves); Ctrl/Cmd+Shift+S downloads the current arrangement; Ctrl/Cmd+O opens a file
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); if (e.shiftKey) downloadLayout(captureLayout(`Layout ${fileStamp()}`)); else if (openFly && openFly.f === saveFly) saveLayout(nameInput.value); else { renderLayouts(); showFly(saveFly, saveBtn); nameInput.focus(); } }
    else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); openLayoutFile(); }
  });
  renderLayouts();
  // a short message in the level pill's hint slot
  let flashT = 0;
  function flash(msg) { hint.textContent = msg; clearTimeout(flashT); flashT = setTimeout(() => updateHint(), 2200); }

  canvas.classList.add('select');
  const levelText = document.getElementById('level-text'), levelDot = document.querySelector('#level .dot'), hint = document.getElementById('hint');
  function updateLevel() {
    const lvl = forceExplode || k >= 1.5 ? 'Synapses' : hasSubs && k >= 0.85 ? 'Sub-neurons' : k >= 0.6 ? 'Neurons' : 'Lobes';
    levelText.textContent = lvl + ` · ${k.toFixed(1)}×`;
    const c = lvl === 'Synapses' ? '#ffffff' : lvl === 'Sub-neurons' ? '#fbbf24' : lvl === 'Neurons' ? '#ff8a3d' : '#4fd1c5';
    levelDot.style.background = c; levelDot.style.boxShadow = `0 0 12px ${c}`;
    updateHint(lvl);
  }
  function updateHint(lvl) {
    lvl = lvl || (forceExplode || k >= 1.5 ? 'Synapses' : hasSubs && k >= 0.85 ? 'Sub-neurons' : k >= 0.6 ? 'Neurons' : 'Lobes');
    const pinned = pages.filter(n => n.pinned).length;
    if (multi.size > 1) { hint.textContent = `${multi.size} neurons selected · drag one to move them all · Shift+click adds · Esc clears${pinned ? ' · R releases pins' : ''}`; return; }
    if (pinned && lvl === 'Lobes') { hint.textContent = `${plural(pinned, 'neuron')} placed by hand · R releases them`; return; }
    const u = mapped() ? LAYOUT_UI[layout] : null;
    if (u && mapMoved() && lvl === 'Lobes') { hint.textContent = `${u.noun} moved by hand · drag a ${u.unit} to move its whole ${u.one} · R resets the map`; return; }
    if (lvl === 'Lobes') { hint.textContent = u ? `${u.hint} · drag a ${u.unit} to move its ${u.one} · ${u.key} returns to the ${LAYOUT_NAME[offLayout(layout)]} layout` : mode === 'select' ? 'scroll to zoom · drag to select · mouse3 or Space to pan · drag a neuron to move it · G, K, F, T, Z, O or E for the genome, karyocyte, family tree, table, coil, orbit or horizon layout' : 'scroll to zoom · drag to pan · click a neuron · V for select mode · G, K, F, T, Z, O or E for the genome, karyocyte, family tree, table, coil, orbit or horizon layout'; return; }
    hint.textContent = lvl === 'Lobes' ? 'scroll to zoom · drag to pan · click a neuron' : lvl === 'Neurons' ? (hasSubs ? 'keep zooming: sub-neurons unfold at 0.85×, synapses at 1.5×' : 'keep zooming: synapses explode at 1.5×') : lvl === 'Sub-neurons' ? 'small satellites are sub-neurons · zoom past 1.5× to explode synapses' : 'dots are synapses · diamonds are sources · dashed lines fire across neurons';
  }
  function updateStats() {
    const vp = pages.filter(visible);
    const subs = vp.filter(isChild).length;
    document.getElementById('stats').innerHTML = `<b>${vp.length - subs}</b> ${pw(vp.length - subs, 'neuron')}${subs ? ` · <b>${subs}</b> ${pw(subs, 'sub-neuron')}` : ''} · <b>${d3.sum(vp, p => p.nSyn)}</b> ${pw(d3.sum(vp, p => p.nSyn), 'synapse')}${(() => { const m = syns.filter(s => sealed(s) && pageOn(pageById[s.page])).length; return m ? ` · <b>${m}</b> sealed` : ''; })()}<br><b>${activeLinks.filter(l => l.kind === 'pp').length}</b> ${pw(activeLinks.filter(l => l.kind === 'pp').length, 'connection')} · <b>${srcs.filter(visible).length}</b> ${pw(srcs.filter(visible).length, 'source')}`;
  }

  // ---------- search ----------
  const q = document.getElementById('q'), results = document.getElementById('results');
  let resultItems = [], activeIdx = -1;
  function hideResults() { results.hidden = true; activeIdx = -1; }
  q.addEventListener('input', () => {
    const term = q.value.trim().toLowerCase();
    if (term.length < 2) { hideResults(); return; }
    const hits = [];
    pages.forEach(p => { const t = p.title.toLowerCase(); if (t.includes(term)) hits.push({ n: p, score: (t === term ? 0 : t.startsWith(term) ? 1 : 2) + t.length / 1000 }); else if ((p.desc || '').toLowerCase().includes(term)) hits.push({ n: p, score: 5 }); });
    syns.forEach(s => {
      if (sealed(s)) { if (s.puzzle.q.toLowerCase().includes(term)) hits.push({ n: s, score: 6 }); return; }   // a sealed fact cannot be found by its contents
      const l = s.lead.toLowerCase(); if (l.includes(term)) hits.push({ n: s, score: 3 }); else if (s.text.toLowerCase().includes(term)) hits.push({ n: s, score: 6 });
    });
    hits.sort((a, b) => a.score - b.score);
    resultItems = hits.slice(0, 9).map(h => h.n);
    results.innerHTML = resultItems.length ? resultItems.map(n => n.kind === 'page'
      ? `<li role="option"><span class="sw" style="background:${lobeColor(n)}"></span><span><span class="rt">${esc(n.title)}</span><span class="rs">${isChild(n) ? 'sub-neuron of ' + esc(n.parent.title) : typeName(n) + ' · ' + esc(lobeById[n.lobe].name)} · ${n.nSyn} synapses</span></span></li>`
      : `<li role="option"><span class="sw" style="background:${lobeColor(n)};opacity:.6"></span><span><span class="rt">${esc(leadOf(n))}</span><span class="rs">synapse of ${esc(pageById[n.page].title)}</span></span></li>`).join('')
      : `<li><span class="empty">Nothing fires for “${esc(q.value)}”</span></li>`;
    results.hidden = false; activeIdx = -1;
    results.querySelectorAll('li[role=option]').forEach((li, i) => li.addEventListener('click', () => choose(i)));
  });
  q.addEventListener('keydown', e => {
    if (results.hidden) return;
    if (e.key === 'ArrowDown') { activeIdx = Math.min(activeIdx + 1, resultItems.length - 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { activeIdx = Math.max(activeIdx - 1, 0); mark(); e.preventDefault(); }
    else if (e.key === 'Enter') { choose(Math.max(activeIdx, 0)); }
  });
  function mark() { results.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === activeIdx)); }
  function choose(i) { const n = resultItems[i]; if (!n) return; ensureVisible(n); hideResults(); q.blur(); select(n); }
  document.addEventListener('click', e => { if (!e.target.closest('.search')) hideResults(); });

  // ---------- boot ----------
  renderLobeList();
  rebuild(true);
  updateStats();
  // initial transform: Home, entered from 60 % of it scaled about Home's own centre, so the brain grows in place instead of sliding in from the data origin
  (() => {
    if (!refreshHome()) return;
    const F = freeRect();
    d3.select(canvas).call(zoom.transform, d3.zoomIdentity.translate(F.cx, F.cy).scale(0.6).translate(-F.cx, -F.cy).translate(home.tx, home.ty).scale(home.kk));
    goHome(1600, d3.easeCubicOut);
    // once the forces cool, a camera nobody has touched (still at Home, no press on the canvas, no selection) refits silently if the brain drifted from the box it was fitted to
    let pressed = false; canvas.addEventListener('pointerdown', e => { if (e.isTrusted) pressed = true; }, { capture: true, passive: true });
    sim.on('end.home', () => { const g = refreshHome(); if (!g || (!atHome && !homing) || pressed || selected) return; if (homing || Math.hypot(g.tx - tx, g.ty - ty) > 0.5 || Math.abs(g.kk / k - 1) > 1e-6) fitAll(500); });
  })();
  updateLevel();
  requestAnimationFrame(draw);
  document.fonts?.ready.then(() => document.getElementById('loading').classList.add('done'));
  setTimeout(() => document.getElementById('loading').classList.add('done'), 1500);
  // deep link from another brain or a shared URL: #n=<page id>
  const openHash = () => { const m = /[#&]n=([^&]+)/.exec(location.hash); if (!m) return; const n = pageById[decodeURIComponent(m[1])]; if (n) { ensureVisible(n); select(n, { by: 'hash' }); } };
  // The initial restore waits for the layout to settle. If the visitor has already acted by then (a click, a tap or a key: a selection,
  // a closed panel, a layout switch, a zoom), their choice wins: restoring late would reopen a panel they had just closed or recentre their view.
  const bootHash = location.hash, ACTS = ['pointerdown', 'keydown', 'wheel'], bootRestore = { at: performance.now(), fired: false };
  let bootActed = false;
  const acted = e => { if (e.isTrusted) bootActed = true; };
  ACTS.forEach(t => window.addEventListener(t, acted, { capture: true, passive: true }));
  setTimeout(() => { bootRestore.fired = true; ACTS.forEach(t => window.removeEventListener(t, acted, { capture: true })); if (!bootActed && location.hash === bootHash && !selected) openHash(); }, 1700);
  window.addEventListener('hashchange', openHash);
  // read-only hooks for the QA scripts in tools/ (screen position of a neuron, current marquee selection)
  window.MINDBLOWN_RENDERER = Object.freeze({
    nodes: () => pages.map(n => ({id:n.id, title:n.title})),
    screenOf: id => { const n = pageById[id]; return n && pageOn(n) && (!isChild(n) || depthF >= 0.03) ? toScreen(n.x,n.y) : null; },
    toWorld: (x,y) => toWorld(x,y), toScreen: (x,y) => toScreen(x,y),
    focus: (id, opts) => { const n=pageById[id]; if(n) {ensureVisible(n);select(n, { by: (opts && opts.by) || 'api' });} },
    selected: () => selected?.kind === 'page' ? selected.id : null,
    engine: 'canonical',
    camera: () => ({ k, tx, ty, kMin, kMax: K_MAX, home: home && { ...home }, atHome, homing, free: freeRect(), fittedFree: free && { ...free }, bounds: bbox && { ...bbox } }),   // read-only fitted geometry and camera state for QA
    lobes: () => lobes.map(l => ({ id: l.id, name: l.name, color: l.color, on: !!lobeOn[l.id] }))   // read-only lobe state for overlays (NNCCG)
  });
  // BEGIN MB RANDONAUT ADAPTER
  // Read-only snapshot plus existing navigation; no dataset or learning-policy mutation.
  window.MINDBLOWN_RANDONAUT_ADAPTER = {
    snapshot: () => ({
      key: location.pathname + '|' + (D.brain || D.title || 'brain'), modelToken: D,
      title: D.title || 'MindBlown', selected: selected && selected.kind === 'page' ? selected.id : null,
      learningAvailable: false,
      nodes: pages.filter(pageOn).map(n => ({
        id: n.id, title: n.title, root: !n.parent,
        center: isSelf(n) || n.isCenter,
        degree: n.neighbors.filter(x => pageOn(x.n)).length
      }))
    }),
    navigate: id => {
      const n = pageById[id];
      if (!n || !pageOn(n) || n.parent || isSelf(n) || n.isCenter) return false;
      select(n, { by: 'randonaut' });   // select() zooms in (at least 2.6×); 'randonaut', not 'visitor', so the Entangler doesn't count it as a click
      return selected && selected.id === id;
    }
  };
  window.dispatchEvent(new Event('mindblown:randonaut-ready'));
  // END MB RANDONAUT ADAPTER
  window.MINDBLOWN_QA = { screenOf: id => { const n = pageById[id]; return n ? toScreen(n.x, n.y) : null; }, selection: () => [...multi].map(n => n.id), pinned: () => pages.filter(n => n.pinned).map(n => n.id), mode: () => mode, labels: () => labelsOn, layout: () => layout, setLayout: l => setLayout(l, { noFit: true }), chromosomes: () => chromos.filter(c => c.on).map(c => ({ id: c.id, x: c.x, top: c.top, bot: c.bot, loci: c.loci.map(p => p.id), hub: c.hubOn ? c.hubOn.id : null })), groups: () => groupsNow().filter(g => g.on).map(g => ({ id: g.id, loci: g.loci.map(p => p.id), hub: g.hubOn ? g.hubOn.id : null, ox: g.ox || 0, oy: g.oy || 0 })), cells: () => cells.filter(c => c.on).map(c => ({ id: c.id, cx: c.cx, cy: c.cy, Rn: c.Rn, Rc: c.Rc })), seats: () => seats.filter(c => c.on).map(c => ({ id: c.id, a0: c.a0, a1: c.a1, loci: c.loci.map(p => p.id) })), tableR: () => tableR, bootRestore: () => ({ ...bootRestore }), rings: () => orbits.filter(g => g.on).map(g => ({ id: g.id, ring: g.ring, R: g.R, loci: g.loci.map(p => p.id) })), streamers: () => streamers.filter(c => c.on).map(c => ({ id: c.id, name: c.name, on: c.on, n: c.loci.length, hub: c.hubOn ? c.hubOn.id : null, root: c.root, fork: c.fork, chains: c.chains.map(x => x.pts.length - 1), ox: c.ox || 0, oy: c.oy || 0 })), coilR: () => coilR, sparks: () => pulses.filter(p => p.spark).length, orbits: () => hzArcs.filter(o => o.on).map(o => ({ id: o.id, name: o.name, ring: o.ring, R: o.R, a0: o.a0, a1: o.a1, n: o.loci.length, hub: o.hubOn ? o.hubOn.id : null, loci: o.loci.map(p => p.id), ox: o.ox || 0, oy: o.oy || 0 })), horizonR: () => horizonR, horizonRings: () => horizonRings.map(r => ({ R: r.R, arcs: r.groups.length })), radiation: () => pulses.filter(p => p.radiate).length, trees: () => trees.filter(t => t.on).map(t => ({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h })), sealed: () => syns.filter(sealed).map(s => s.id), solve: (id, text) => !!synById[id] && solve(synById[id], text), screenshot, captureLayout, applyLayout, layouts: readLayouts, saveLayout, flyout: () => (openFly ? openFly.f.id : null) };
})();

/* BEGIN MB RANDONAUT MODULE */
/* MindBlown shared Randonaut controller v1.
 * Embedded by install-randonaut.cjs so existing app.js-only packaging keeps working.
 * Graph analogies, not geographic calculations or an official Randonautica client.
 * Layout (v2): the launcher is a round owl button in the right rail, directly below the Quantum Entangler (the Entangler and the
 * Don't Panic Drive stack above the highest .zoom-ctl, so they sit above it). The rail is static: the button never steps aside, and
 * its card opens to the left of the rail, never over it. Pages without a rail keep a fixed corner button.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.MBRandonautSampling = api;
    // The unified engine mounts after its composition promise resolves.
    if (root.MINDBLOWN_RANDONAUT_ADAPTER) api.mount(root);
    else root.addEventListener('mindblown:randonaut-ready', () => api.mount(root), { once: true });
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const descriptions = {
    blindspot: 'Equal chance among eligible, visible neurons.',
    attractor: 'More base connections to visible neurons means a higher chance.',
    void: 'Fewer base connections to visible neurons means a higher chance.',
    power: 'Connection counts farther from the eligible group’s average have a higher chance.'
  };
  function weights(degrees, mode) {
    if (!Object.prototype.hasOwnProperty.call(descriptions, mode)) throw new Error('Unknown exploration mode');
    const ds = degrees.map(d => Number.isFinite(d) ? Math.max(0, d) : 0);
    const mean = ds.reduce((a, b) => a + b, 0) / (ds.length || 1);
    return ds.map(d => mode === 'attractor' ? d + 1 : mode === 'void' ? 1 / (d + 1) : mode === 'power' ? Math.abs(d - mean) + 1 : 1);
  }
  function choose(nodes, mode, random) {
    if (!nodes.length) return null;
    const ws = weights(nodes.map(n => n.degree), mode), r = random();
    if (!(r >= 0 && r < 1)) throw new Error('Random value outside [0,1)');
    let t = r * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < nodes.length; i++) { t -= ws[i]; if (t < 0) return nodes[i]; }
    return nodes[nodes.length - 1];
  }
  function candidates(snap, previous) {
    const base = snap.nodes.filter(n => n.root && !n.center && n.id !== snap.selected);
    const fresh = base.filter(n => n.id !== previous);
    return fresh.length ? fresh : base;
  }
  function mount(w) {
    const doc = w.document;
    if (!w.MINDBLOWN_RANDONAUT_ADAPTER || doc.getElementById('mb-rando-dock') || doc.getElementById('rando-toggle')) return;
    const stage = doc.getElementById('stage') || doc.body;
    const style = doc.createElement('style');
    style.id = 'mb-rando-style';
    style.textContent = `
      #mb-rando-dock,#mb-rando-panel{--mb-accent:#e5cd8e;color:#dfe5f2;font-family:var(--font-body,'Satoshi',sans-serif);box-sizing:border-box}
      #mb-rando-dock{position:fixed;left:248px;bottom:22px;z-index:7;width:44px;height:44px;padding:0;display:grid;place-content:center;border-radius:50%;border:1px solid rgba(229,205,142,.35);background:rgba(10,14,20,.78);color:#aebbd1;cursor:pointer;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 6px 18px rgba(0,0,0,.35);-webkit-tap-highlight-color:transparent;touch-action:manipulation}
      #mb-rando-dock.mb-shell{bottom:54px;left:calc(var(--rail-w,232px) + 16px)}
      #mb-rando-dock.mb-in-rail{position:absolute;right:auto;bottom:auto;flex-direction:initial;gap:0}
      #mb-rando-dock svg{display:block;width:28px;height:28px}
      #mb-rando-dock:hover,#mb-rando-dock:focus-visible,#mb-rando-dock[aria-expanded=true]{color:#e6ebf5;border-color:rgba(229,205,142,.6)}
      #mb-rando-dock.mb-on{color:var(--mb-accent);border-color:rgba(229,205,142,.8);box-shadow:0 0 0 1px rgba(229,205,142,.25),0 0 18px rgba(229,205,142,.4),0 6px 18px rgba(0,0,0,.35)}
      #mb-rando-dock .mb-rando-n{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--mb-accent);color:#0b0e14;font:700 10px/16px 'Satoshi',system-ui,sans-serif;text-align:center}
      #mb-rando-dock .mb-rando-n:empty{display:none}
      #mb-rando-dock[hidden]{display:none}
      #mb-rando-toggle{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;margin:0 0 4px;padding:0 12px;background:#17202e;border:1px solid #354052;border-radius:8px;color:inherit;font:inherit;font-size:12px;cursor:pointer}
      #mb-rando-toggle strong{font-size:10px;letter-spacing:.06em;font-weight:600;color:#aebbd1}
      #mb-rando-toggle[aria-checked=true] strong{color:var(--mb-accent)}
      .mb-rando-track{width:28px;height:17px;padding:2px;border:1px solid #65718a;border-radius:12px;background:#202939;box-sizing:border-box}
      .mb-rando-track i{display:block;width:11px;height:11px;border-radius:50%;background:#a7b2cc;transition:transform .15s}
      [aria-checked=true] .mb-rando-track{background:#625533;border-color:var(--mb-accent)}
      [aria-checked=true] .mb-rando-track i{transform:translateX(11px);background:var(--mb-accent)}
      #mb-rando-panel{position:fixed;left:248px;bottom:80px;z-index:56;width:344px;max-height:calc(100dvh - 160px);overflow:auto;overscroll-behavior:contain;padding:18px;background:#0e1521;border:1px solid #354052;border-radius:14px;box-shadow:0 12px 42px #0008;scrollbar-width:thin}
      #mb-rando-panel.mb-shell{bottom:110px;left:calc(var(--rail-w,232px) + 16px)}
      #mb-rando-panel[hidden]{display:none}
      #mb-rando-panel header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}
      #mb-rando-panel h2{font-family:var(--font-display,'Satoshi',sans-serif);font-size:21px;line-height:1.2;margin:4px 0}
      #mb-rando-panel .mb-eyebrow{font-size:9px;letter-spacing:.15em;color:var(--mb-accent)}
      #mb-rando-close{min-width:36px;min-height:36px;border:1px solid #354052;border-radius:8px;background:#17202e;color:#dfe5f2;font-size:20px;cursor:pointer}
      #mb-rando-panel label{display:block;font-size:12px;margin:12px 0 6px}
      #mb-rando-panel p{font-size:12px;line-height:1.55;color:#aebbd1;margin:6px 0 12px}
      #mb-rando-panel .mb-small{font-size:11px}
      #mb-rando-panel input,#mb-rando-panel select{box-sizing:border-box;width:100%;min-height:44px;padding:10px;color:#dfe5f2;background:#17202e;border:1px solid #354052;border-radius:8px;font:inherit;font-size:12px}
      #mb-rando-generate{width:100%;min-height:44px;margin-top:6px;padding:10px;border:1px solid var(--mb-accent);border-radius:8px;background:var(--mb-accent);color:#111724;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
      #mb-rando-generate:disabled{background:#263040;color:#aebbd1;border-color:#354052;cursor:default}
      #mb-rando-status{color:var(--mb-accent)!important;min-height:36px}
      #mb-rando-panel details{border-top:1px solid #354052;padding-top:12px;margin-top:12px}
      #mb-rando-panel summary{font-size:12px;cursor:pointer;min-height:30px}
      #mb-rando-journal{padding-left:22px;font-size:12px;line-height:1.55;overflow-wrap:anywhere}
      #mb-rando-journal li{padding:5px 0}
      #mb-rando-journal small{display:block;color:#aebbd1}
      #mb-rando-dock :focus-visible,#mb-rando-panel :focus-visible{outline:2px solid var(--mb-accent);outline-offset:3px}
      @media(max-width:900px){
        #mb-rando-dock:not(.mb-in-rail),#mb-rando-dock.mb-shell:not(.mb-in-rail){left:var(--mb-rando-left,204px);bottom:auto;top:var(--mb-rando-top,144px)}
        #mb-rando-panel,#mb-rando-panel.mb-shell{left:12px;right:12px;width:auto;bottom:auto;top:calc(var(--mb-rando-top,144px) + 54px);max-height:calc(100dvh - var(--mb-rando-top,144px) - 66px)}
      }
      @media(prefers-reduced-motion:reduce){.mb-rando-track i{transition:none}}
    `;
    doc.head.append(style);
    // An original owl mark (not the Randonautica trademark logo): swap OWL for licensed artwork if permission is obtained.
    const OWL = '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.2 5.6 10 8.7M20.8 5.6 18 8.7"/><path d="M7.2 5.6C5.7 8.6 5 11.8 5 14.6 5 20.2 9 24 14 24s9-3.8 9-9.4c0-2.8-.7-6-2.2-9"/><circle cx="10.4" cy="13" r="3.3"/><circle cx="17.6" cy="13" r="3.3"/><circle cx="10.4" cy="13" r="1.15" fill="currentColor" stroke="none"/><circle cx="17.6" cy="13" r="1.15" fill="currentColor" stroke="none"/><path d="M12.9 16.6h2.2L14 18.6z" fill="currentColor" stroke-width="1"/><path d="M10.6 21c1.1.7 2.2 1 3.4 1s2.3-.3 3.4-1" opacity=".55"/></svg>';
    const dock = doc.createElement('button'); dock.id = 'mb-rando-dock'; dock.type = 'button';
    dock.setAttribute('aria-expanded', 'false'); dock.setAttribute('aria-controls', 'mb-rando-panel');
    dock.innerHTML = OWL + '<span class="mb-rando-n" aria-hidden="true"></span>';
    const panel = doc.createElement('section'); panel.id = 'mb-rando-panel'; panel.hidden = true; panel.setAttribute('aria-labelledby', 'mb-rando-title');
    // Only hardcoded markup goes through innerHTML. User/dataset text uses textContent.
    panel.innerHTML = `<header><div><span class="mb-eyebrow">EXPLORATION MODULE</span><h2 id="mb-rando-title">Follow the unexpected.</h2></div><button id="mb-rando-close" type="button" aria-label="Close Randonaut settings">×</button></header>
      <button id="mb-rando-toggle" type="button" role="switch" aria-checked="false" aria-label="Randonaut mode"><span class="mb-rando-track" aria-hidden="true"><i></i></span><span>Randonaut <strong id="mb-rando-state">OFF</strong></span></button>
      <p id="mb-rando-brain"></p><p>Explore this Brain’s knowledge, not geographic destinations. Browser randomness, not quantum entropy.</p>
      <label for="mb-rando-mode">Destination style</label><select id="mb-rando-mode"><option value="blindspot">Blind Spot · any eligible neuron</option><option value="attractor">Attractor · connected hubs</option><option value="void">Void · quieter corners</option><option value="power">Power · connection extremes</option></select>
      <p id="mb-rando-method" class="mb-small"></p>
      <label for="mb-rando-intention">Intention · optional reflection</label><input id="mb-rando-intention" maxlength="140" autocomplete="off" placeholder="What would you like to notice?">
      <p class="mb-small">Intention does not change the selection. This text and your journal stay in this tab’s memory and clear when the Brain changes or reloads.</p>
      <button id="mb-rando-generate" type="button" disabled>Turn Randonaut ON to explore</button>
      <p id="mb-rando-status" role="status" aria-live="polite">OFF. Ordinary navigation remains available.</p>
      <details><summary>Session journal <span id="mb-rando-count">0</span></summary><p class="mb-small">Latest 20 arrivals. No new storage, location requests or analytics.</p><ol id="mb-rando-journal"></ol></details>
      <details><summary>How this mode works</summary><p>These are graph analogies, not the official app’s geographic anomaly calculations. Base connections to visible neurons set the sampling weights, independent of learned weights and pruning.</p><p id="mb-rando-learning"></p><p>No facts, evidence ratings or source files are changed. No autonomous research is running. Independent module, not affiliated with Randonautica.</p></details>`;
    if (w.MBCatalog) { dock.classList.add('mb-shell'); panel.classList.add('mb-shell'); }
    doc.body.append(dock); stage.append(panel);   // the button shares the Entangler's page coordinates; the card is fixed
    const $ = id => doc.getElementById('mb-rando-' + id);
    let enabled = false, pending = null, token = 0, previous = null, count = 0, entries = [];
    let activeAdapter = w.MINDBLOWN_RANDONAUT_ADAPTER, snapshot = activeAdapter.snapshot();
    let key = snapshot.key, modelToken = snapshot.modelToken;
    const random = () => w.crypto?.getRandomValues ? w.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 : Math.random();
    const desk = () => !w.matchMedia('(max-width:900px)').matches;
    const shown = el => !!el && el.offsetParent !== null && el.getBoundingClientRect().height > 0;
    // the rail column this button sits on top of: the Brains group when it is stacked in the column, else Tools, else Zoom
    function anchor() {
      const bt = doc.getElementById('brain-tools');
      if (shown(bt) && !bt.classList.contains('rail-beside')) return bt;
      for (const id of ['tools', 'zoom-ctl']) { const e = doc.getElementById(id); if (shown(e)) return e; }
      return null;
    }
    function placeDock() {
      const a = anchor(), size = 44;
      if (!a) { dock.classList.remove('zoom-ctl', 'mb-in-rail'); dock.style.left = dock.style.top = ''; dock.hidden = false; return; }
      const r = a.getBoundingClientRect();
      // a .zoom-ctl, so the Entangler (and the Drive above it) stack on top of this button: Drive, Entangler, Randonaut, Brains, Tools, Zoom
      dock.classList.add('zoom-ctl', 'mb-in-rail');
      dock.style.left = Math.round(r.left + r.width / 2 - size / 2 + w.scrollX) + 'px';
      dock.style.top = Math.round(r.top - 10 - size + w.scrollY) + 'px';
      // no room on the rail (a short landscape phone, or a bottom sheet lifting the rail into the header): use the fixed corner place
      // instead, so the launcher always stays reachable
      const t = r.top - 10 - size, l = r.left + r.width / 2 - size / 2;
      const hit = [...doc.querySelectorAll('#top > *, .search, .brand, nav.brains')].some(e => { if (e.offsetParent === null) return false; const q = e.getBoundingClientRect(); return q.width > 0 && q.left < l + size + 4 && q.right > l - 4 && q.top < t + size + 4 && q.bottom > t - 4; });
      if (t < 4 || (!desk() && hit)) { dock.classList.remove('zoom-ctl', 'mb-in-rail'); dock.style.left = dock.style.top = ''; }
      dock.hidden = false;
    }
    function placeCard() {
      if (panel.hidden || !desk() || !dock.classList.contains('mb-in-rail')) { panel.style.left = panel.style.right = panel.style.top = panel.style.bottom = ''; return; }
      const W = w.innerWidth, H = w.innerHeight, b = dock.getBoundingClientRect();
      const R = w.MINDBLOWN_RAIL, edge = R && typeof R.overlayLeft === 'function' ? R.overlayLeft() : R && typeof R.left === 'function' ? R.left() : b.left;
      const left = Math.min(edge, b.left);   // beside the rail and clear of an open details panel
      panel.style.left = 'auto'; panel.style.bottom = 'auto';
      panel.style.right = Math.round(W - left + 10) + 'px';   // adjacent to the rail, never over it
      panel.style.top = Math.round(Math.max(72, Math.min(b.top - 6, H - panel.offsetHeight - 12))) + 'px';
    }
    function place() {
      const top = doc.getElementById('top');
      const y = Math.max(8, Math.min((top?.getBoundingClientRect().bottom || 124) + 10, w.innerHeight - 120));
      doc.documentElement.style.setProperty('--mb-rando-top', y + 'px');
      // Keep the fallback beside the Lobes footprint, including its collapsed
      // header. Below the search box at x=12 overlaps Lobes on short phones.
      const lobes = doc.getElementById('lobes')?.getBoundingClientRect();
      const x = lobes ? lobes.right + 12 : 12;
      doc.documentElement.style.setProperty('--mb-rando-left', Math.max(12, Math.min(x, w.innerWidth - 56)) + 'px');
      placeDock(); placeCard();
    }
    w.addEventListener('resize', place);
    if (w.ResizeObserver && doc.getElementById('top')) new w.ResizeObserver(place).observe(doc.getElementById('top'));
    w.setInterval(place, 300);   // the rail settles after the Brains group, Entangler and Drive arrive
    place();
    function cancel() { ++token; if (pending !== null) w.clearTimeout(pending); pending = null; }
    function reset() {
      cancel(); enabled = false; previous = null; entries = []; count = 0;
      $('journal').replaceChildren(); $('count').textContent = '0'; $('intention').value = ''; panel.hidden = true;
      dock.setAttribute('aria-expanded', 'false');
      $('status').textContent = 'OFF. New Brain session; ordinary navigation remains available.';
      sync();
    }
    function current() {
      const adapter = w.MINDBLOWN_RANDONAUT_ADAPTER, next = adapter.snapshot();
      if (adapter !== activeAdapter || next.key !== key || next.modelToken !== modelToken) {
        activeAdapter = adapter; key = next.key; modelToken = next.modelToken; snapshot = next; reset();
      } else snapshot = next;
      return snapshot;
    }
    function sync() {
      $('toggle').setAttribute('aria-checked', String(enabled)); $('state').textContent = enabled ? 'ON' : 'OFF';
      dock.classList.toggle('mb-on', enabled); dock.querySelector('.mb-rando-n').textContent = count ? String(count) : '';
      dock.setAttribute('aria-label', 'Randonaut exploration: ' + (enabled ? 'ON' : 'OFF') + (count ? ', ' + count + ' journey' + (count === 1 ? '' : 's') : '') + '. Opens settings.');
      dock.title = 'Randonaut — ' + (enabled ? 'ON' : 'OFF');
      $('generate').disabled = !enabled || pending !== null;
      $('generate').textContent = !enabled ? 'Turn Randonaut ON to explore' : pending !== null ? 'Finding a destination…' : 'Generate a knowledge journey';
      $('method').textContent = descriptions[$('mode').value];
      $('brain').textContent = 'Current Brain: ' + (snapshot.title || 'Untitled');
      $('learning').textContent = snapshot.learningAvailable ? 'The existing Learning switch stays separate. Normal routes may strengthen connections when learning is ON; this is not evidence that a fact is true.' : 'This renderer navigates visually; it does not learn navigation weights. The module does not add a hidden learning system.';
    }
    function open(value, focus = true) {
      current(); panel.hidden = !value; dock.setAttribute('aria-expanded', String(value)); place();
      if (focus) (value ? $('toggle') : dock).focus();
    }
    $('toggle').addEventListener('click', () => {
      current(); enabled = !enabled;
      if (enabled) $('status').textContent = 'ON. Generate when ready. Nothing runs in the background.';
      else { cancel(); $('status').textContent = 'OFF. Pending journeys stopped. Ordinary navigation remains available.'; }
      sync();
    });
    dock.addEventListener('click', () => open(panel.hidden));
    $('close').addEventListener('click', () => open(false));
    dock.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });
    panel.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); open(false); }
    });
    $('mode').addEventListener('change', () => { current(); cancel(); sync(); $('status').textContent = enabled ? 'Style changed. Generate when ready.' : 'OFF. Turn the mode on when ready.'; });
    $('generate').addEventListener('click', () => {
      const snap = current();
      if (!enabled || pending !== null) return;
      const pool = candidates(snap, previous);
      if (!pool.length) { $('status').textContent = 'No other eligible neurons. Show another lobe or clear the current selection.'; return; }
      const styleName = $('mode').value, thought = $('intention').value.trim().slice(0, 140);
      const destination = choose(pool, styleName, random), run = ++token, runKey = key, runModel = modelToken;
      pending = w.setTimeout(() => {
        pending = null;
        const now = current();
        if (!enabled || token !== run || key !== runKey || modelToken !== runModel) { sync(); return; }
        if (now.selected !== snap.selected) { $('status').textContent = 'You opened another neuron, so this journey was cancelled. Generate again when ready.'; sync(); return; }
        if (!candidates(now, null).some(n => n.id === destination.id)) {
          $('status').textContent = 'The visible selection changed. Generate again using this Brain’s visible neurons.'; sync(); return;
        }
        try {
          if (!activeAdapter.navigate(destination.id)) throw new Error('Destination unavailable');
          previous = destination.id; count++;
          entries.unshift({ id: destination.id, title: destination.title, mode: styleName, intention: thought, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
          entries = entries.slice(0, 20); $('count').textContent = String(count); $('journal').replaceChildren();
          for (const item of entries) {
            const li = doc.createElement('li'), name = doc.createElement('span'), detail = doc.createElement('small');
            name.textContent = item.title; detail.textContent = item.time + ' · ' + item.mode + (item.intention ? ' · Intention: ' + item.intention : '');
            li.append(name, detail); $('journal').append(li);
          }
          $('status').textContent = 'Arrived at “' + destination.title + '”. Read its facts in the details panel.';
          open(false, false);   // the card steps away so the neuron's details panel (left of the rail) is readable; the rail button stays lit
        } catch (e) {
          console.error('Randonaut journey failed', e);
          $('status').textContent = 'The journey could not finish. Normal navigation is still available.';
        }
        sync();
      }, w.matchMedia('(prefers-reduced-motion:reduce)').matches ? 0 : 220);
      $('status').textContent = 'Sampling visible knowledge…'; sync();
    });
    w.addEventListener('pagehide', reset);
    w.addEventListener('pageshow', e => { if (e.persisted) reset(); });
    w.MB_RANDONAUT = Object.freeze({
      get enabled() { return enabled; }, get pending() { return pending !== null; },
      get count() { return count; }, get brainKey() { return key; },
      get journal() { return entries.map(e => ({ ...e })); }
    });
    sync();
  }
  return { descriptions, weights, choose, candidates, mount };
});

/* END MB RANDONAUT MODULE */
