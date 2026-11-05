"""What the Kingfischer brains share: the list of brains and a small Brain helper that writes a MindBlown data file.

The Brain class is the one from mindblown-chess (mb_shared.py), unchanged apart from having no shared-id registry.
The brains link to each other through shared neuron ids: a page built with the same id in two brains is one neuron
seen from both sides, and `write_network()` tells the renderer where its other copies live (window.MINDBLOWN_NETWORK).
"""
import json, os, collections, datetime

TODAY = datetime.date.today().isoformat()
HERE = os.path.dirname(os.path.abspath(__file__))
SYN_ONLY = ()
REGISTRY = {}

BRAINS = [
    {'id': 'king', 'title': 'King Brain', 'short': 'King', 'color': '#ff8a3d', 'href': 'king.html', 'data': 'king-data.js',
     'blurb': 'the last output gate: how the council votes, the safety veto, the three modes and the three bots that use it.'},
    {'id': 'leela', 'title': 'Leela', 'short': 'Leela', 'color': '#7bbcf4', 'href': 'leela.html', 'data': 'leela-data.js',
     'blurb': 'Leela Chess Zero: a neural network with policy, value and moves-left heads, guided by Monte Carlo tree search.'},
    {'id': 'maia', 'title': 'Maia', 'short': 'Maia', 'color': '#7bf48a', 'href': 'maia.html', 'data': 'maia-data.js',
     'blurb': 'Maia: nine Leela-format networks trained to predict the move a human at 1100–1900 would play.'},
    {'id': 'stockfish', 'title': 'Stockfish', 'short': 'Stockfish', 'color': '#fde68a', 'href': 'stockfish.html', 'data': 'stockfish-data.js',
     'blurb': 'Stockfish (unofficial): how it plays, how Fishtest checks every change, what its results show, and its seat as the referee.'},
]
BRAIN_BY_ID = {b['id']: b for b in BRAINS}


# ---------------------------------------------------------------- a brain being built
class Brain:
    """Collects pages, synapses, sources and links and writes <name>-data.js in the MindBlown format."""

    def __init__(self, bid, title, subtitle, lobes, hub):
        self.b = BRAIN_BY_ID[bid]; self.title = title; self.subtitle = subtitle
        self.lobes = lobes; self.hub = hub
        self.pages = []; self.ids = set(); self.sources = {}; self.see = collections.defaultdict(list)
        self.rings = {}

    def src(self, url, label, kind='web'):
        self.sources.setdefault(url, {'label': label, 'kind': kind}); return url

    def page(self, pid, title, ptype, lobe, desc, syns, see=(), parent=None, ring=None, created=None, updated=None, section='Synapses'):
        # created / updated: None keeps the dates from the last build while the page is unchanged (see write())
        if pid in self.ids: raise ValueError(f'duplicate id {pid}')
        P = {'id': pid, 'title': title, 'type': ptype, 'lobe': lobe, 'desc': desc, 'intro': desc, 'created': created, 'updated': updated,
             'synapses': [], 'sources': [], 'sections': []}
        if parent: P['parent'] = parent
        if ring is not None: P['ring'] = ring
        for i, s in enumerate(syns, 1):
            lead, text, cites = s[0], s[1], list(s[2]); links = list(s[3]) if len(s) > 3 else []; sec = s[4] if len(s) > 4 else section
            if not cites: raise ValueError(f'uncited synapse on {pid}: {lead}')
            for c in cites:
                if c not in self.sources: raise KeyError(f'unregistered source {c} on {pid}')
            P['synapses'].append({'id': f'{pid}#{i}', 'page': pid, 'lead': lead, 'text': text, 'section': sec, 'links': links, 'cites': cites})
            for c in cites:
                if c not in P['sources']: P['sources'].append(c)
            if sec not in P['sections']: P['sections'].append(sec)
        self.see[pid].extend(see); self.pages.append(P); self.ids.add(pid); return pid

    def shared(self, pid, syns, see=(), parent=None, ring=None, section=None):
        if pid not in REGISTRY: raise KeyError(f'{pid} is not in mb_shared.REGISTRY')
        title, ptype, lobe, desc, created = REGISTRY[pid]
        return self.page(pid, title, ptype, lobe, desc, syns, see=see, parent=parent, ring=ring, created=created, section=section or f'On {self.title}')

    def _keep_dates(self, path):
        """Pages without explicit dates keep `created` from the previous build, and `updated` too unless their text changed."""
        prev = {}
        if os.path.exists(path):
            raw = open(path, encoding='utf-8').read().strip()
            try: prev = {p['id']: p for p in json.loads(raw[raw.index('=') + 1:].rstrip(';'))['pages']}
            except (ValueError, KeyError): prev = {}
        def body(p): return json.dumps([p['title'], p['desc'], [(s['lead'], s['text'], s['cites'], s['links']) for s in p['synapses']]])
        for p in self.pages:
            old = prev.get(p['id'])
            if p['created'] is None: p['created'] = old['created'] if old else TODAY
            if p['updated'] is None: p['updated'] = old['updated'] if old and body(old) == body(p) else TODAY

    def write(self, out=None, link_types=False):
        """Resolve links (see-also + synapse mentions), check every target exists in this brain, write the file.
        `out` is a directory (default: this one). Dates are always kept from the committed file here, so a build into
        another directory (as the tests do) gives the same output as a build in place."""
        ids = self.ids
        self._keep_dates(os.path.join(HERE, self.b['data']))
        out = os.path.join(out or HERE, self.b['data'])
        for p in self.pages:
            bad = [t for t in self.see[p['id']] if t not in ids] + [t for s in p['synapses'] for t in s['links'] if t not in ids]
            if bad: raise KeyError(f'unknown link target(s) {bad} on {p["id"]}')
        links = {}

        def addlink(a, b, kind, note=None):
            if a == b or a not in ids or b not in ids: return
            k = tuple(sorted((a, b))); L = links.setdefault(k, {'s': k[0], 't': k[1], 'w': 0, 'kinds': [], 'notes': []})
            L['w'] += 1
            if kind not in L['kinds']: L['kinds'].append(kind)
            if note and note not in L['notes'] and len(L['notes']) < 3: L['notes'].append(note)
        synapses = []
        for p in self.pages:
            for t in self.see[p['id']]: addlink(p['id'], t, 'see-also')
            for s in p['synapses']:
                for t in s['links']:
                    # SYN_ONLY prefixes stay synapse-level threads (kept from mindblown-chess). It is empty here: the King
                    # brain is small, so mentions of its rule pages (gate/...) are meant to become page links as well.
                    if t.startswith(SYN_ONLY) and not link_types: continue
                    addlink(p['id'], t, 'mention', s['lead'])
                synapses.append(s)
        synLinks = [{'s': s['id'], 't': t} for s in synapses for t in s['links']]
        pages_by_src = collections.defaultdict(list)
        for p in self.pages:
            for u in p['sources']: pages_by_src[u].append(p['id'])
        co = collections.Counter()
        for ps in pages_by_src.values():
            if len(ps) > 12: continue   # the dataset-wide sources cite nearly everything; co-citation through them is noise
            for i in range(len(ps)):
                for j in range(i + 1, len(ps)): co[tuple(sorted((ps[i], ps[j])))] += 1
        cocite = [{'s': a, 't': b, 'w': w} for (a, b), w in sorted(co.items())]
        sources = [{'id': u, 'label': m['label'], 'kind': m['kind'], 'pages': pages_by_src[u]} for u, m in self.sources.items() if pages_by_src.get(u)]
        dangling = [p['id'] for p in self.pages if p.get('parent') and p['parent'] not in ids]
        if dangling: raise KeyError(f'dangling parent on {dangling}')
        lobes = []
        for l in self.lobes:
            L = {'id': l['id'], 'name': l['name'], 'color': l['color'], 'hidden': l.get('hidden', False)}
            if 'ring' in l: L['ring'] = l['ring']
            lobes.append(L)
        data = {'lobes': lobes, 'center': self.hub, 'brain': self.b['id'], 'title': self.title, 'subtitle': self.subtitle, 'pages': self.pages,
                'synapses': synapses, 'sources': sources, 'links': list(links.values()), 'synLinks': synLinks, 'cocite': cocite, 'built': TODAY}
        if self.rings: data['rings'] = self.rings
        with open(out, 'w', encoding='utf-8') as f: f.write('window.MINDBLOWN = ' + json.dumps(data, ensure_ascii=False) + ';\n')
        subs = sum(1 for p in self.pages if p.get('parent'))
        print(f"{self.b['id']}: pages={len(self.pages)} (sub={subs}) synapses={len(synapses)} sources={len(sources)} links={len(links)}",
              dict(collections.Counter(p['lobe'] for p in self.pages if not p.get('parent'))))
        return data


# ---------------------------------------------------------------- importing a published brain
def load_published(B, path, ids=None, lobes=None, types=None, relobe=None, reparent=None, ring=None, drop=()):
    """Re-create the pages of a published MindBlown data file (JSON) in brain B, so they go through the same checks
    and get the same link resolution as pages written here. `ids`, `lobes` and `types` rename on the way in (the hub
    id and the AI Hub's shared concepts differ between sites); `relobe` moves single pages (by new id) to another lobe;
    `reparent` makes them sub-neurons of another page; `ring` sets a page's ring; `drop` skips pages. Dates come from the file."""
    ids = dict(ids or {}); lobes = dict(lobes or {}); types = dict(types or {}); relobe = dict(relobe or {}); reparent = dict(reparent or {}); ring = dict(ring or {})
    with open(path, encoding='utf-8') as f: d = json.load(f)
    syn = {s['id']: s for s in d['synapses']}
    for src in d['sources']: B.src(src['id'], src['label'], src.get('kind', 'web'))
    rid = lambda i: ids.get(i, i)
    for p in d['pages']:
        if p['id'] in drop: continue
        syns = []
        for sid in p['synapses']:
            s = syn[sid]
            syns.append((s['lead'], s['text'], list(s['cites']), [rid(t) for t in s.get('links', []) if t not in drop], s.get('section', 'Synapses')))
        pid = rid(p['id'])
        B.page(pid, p['title'], types.get(p['type'], p['type']), relobe.get(pid, lobes.get(p['lobe'], p['lobe'])), p['desc'], syns,
               parent=reparent.get(pid, rid(p['parent']) if p.get('parent') else None), ring=ring.get(pid, p.get('ring')), created=p.get('created'), updated=p.get('updated'))


def write_network(datas, out=None):
    """`out` is a directory (default: this one)."""
    """The network layer for the renderer: which brains exist and, for every page id built in more than one brain, how
    big each copy is. Every shared id must carry the same title everywhere, or the two copies are not one neuron."""
    out = os.path.join(out or HERE, 'network-data.js')
    where = collections.defaultdict(dict)
    for bid, d in datas.items():
        touch = collections.Counter()
        for l in d['links']: touch[l['s']] += 1; touch[l['t']] += 1
        for p in d['pages']: where[p['id']][bid] = {'title': p['title'], 'synapses': len(p['synapses']), 'connections': touch[p['id']]}
    shared = {}
    for pid, copies in where.items():
        if len(copies) < 2: continue
        titles = {c['title'] for c in copies.values()}
        if len(titles) > 1: raise ValueError(f'shared neuron {pid} has different titles: {sorted(titles)}')
        shared[pid] = {bid: {'synapses': c['synapses'], 'connections': c['connections']} for bid, c in copies.items()}
    net = {'brains': [{'id': b['id'], 'title': b['title'], 'href': b['href'], 'color': b['color']} for b in BRAINS], 'shared': shared}
    with open(out, 'w', encoding='utf-8') as f: f.write('window.MINDBLOWN_NETWORK = ' + json.dumps(net, ensure_ascii=False) + ';\n')
    print('network: shared neurons', {k: sorted(v) for k, v in shared.items()})
    return net


SHARED_LOBE = {'id': 'shared', 'name': 'Shared across the council', 'color': '#f0abfc', 'hidden': False}


def shift_hue(hexcol, deg):
    """Rotate a #rrggbb colour's hue by `deg` degrees, keeping lightness and saturation."""
    import colorsys
    r, g, b = (int(hexcol[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, sat = colorsys.rgb_to_hls(r, g, b)
    r, g, b = colorsys.hls_to_rgb((h + deg / 360) % 1, l, sat)
    return '#%02x%02x%02x' % (round(r * 255), round(g * 255), round(b * 255))


def write_network_brain(datas, out=None):
    """One-screen network brain (network-brain-data.js): every brain merged into a single MindBlown data set, built the
    same way as mindblown-gta's build_network.py. Brain-specific ids become "<brain>:<id>" so the brains stay distinct; a
    page id built in more than one brain keeps its bare id and is ONE node in the "shared" lobe that every copy's synapses
    and links attach to. Each brain keeps its own hub lobe (self: true); the renderer lays the hubs out on a circle with
    the shared lobe in the middle. Facts, citations and links are unchanged, only re-addressed."""
    out = os.path.join(out or HERE, 'network-brain-data.js')
    count = collections.Counter(p['id'] for d in datas.values() for p in d['pages'])
    shared = {pid for pid, n in count.items() if n > 1}
    built = max(d['built'] for d in datas.values())
    m = {'lobes': [dict(SHARED_LOBE)], 'pages': [], 'synapses': [], 'sources': [], 'links': [], 'synLinks': [], 'cocite': [],
         'brains': [], 'centers': [], 'brain': 'network', 'title': 'Kingfischer network',
         'subtitle': 'The King Brain, Stockfish, Leela and Maia on one screen \u00b7 shared neurons in the middle', 'built': built}
    page_ix, link_ix, co_ix = {}, {}, {}
    for bi, b in enumerate(BRAINS):
        d, bid = datas[b['id']], b['id']
        mp = lambda pid: pid if pid in shared else f'{bid}:{pid}'
        for l in d['lobes']:
            me = l['id'] == 'self'
            name = b['short'] if me else f"{b['short']} \u00b7 {l['name']}"
            color = l['color'] if (me or bi == 0) else shift_hue(l['color'], 40 * bi)   # brains reuse one palette; keep them apart here
            m['lobes'].append({**l, 'id': f'{bid}:{l["id"]}', 'brain': bid, 'self': me, 'name': name, 'color': color})
        m['brains'].append({'id': bid, 'title': b['title'], 'short': b['short'], 'color': b['color'], 'href': b['href'], 'self': f'{bid}:self', 'center': mp(d['center'])})
        m['centers'].append(mp(d['center']))
        rs = lambda sy: {**sy, 'id': f'{bid}:{sy["id"]}', 'page': mp(sy['page']), 'links': [mp(x) for x in sy['links']], 'cites': [f'{bid}:{x}' for x in sy['cites']]}
        for p in d['pages']:
            pid = mp(p['id'])
            q = {**p, 'id': pid, 'lobe': 'shared' if pid in shared else f'{bid}:{p["lobe"]}',
                 'synapses': [rs(x) for x in p['synapses']], 'sources': [f'{bid}:{x}' for x in p['sources']]}
            if p.get('parent'): q['parent'] = mp(p['parent'])
            if pid in page_ix:   # the shared neuron already exists from an earlier brain: pool the evidence
                e = m['pages'][page_ix[pid]]
                e['synapses'] += q['synapses']; e['sources'] += q['sources']; e['brains'].append(bid)
                e['updated'] = max(e.get('updated') or '', q.get('updated') or '')
            else:
                if pid in shared: q['brains'] = [bid]
                else: q['brain'] = bid
                q['orig'] = p['id']; page_ix[pid] = len(m['pages']); m['pages'].append(q)
        for sy in d['synapses']: m['synapses'].append(rs(sy))
        for src in d['sources']:
            m['sources'].append({**src, 'id': f'{bid}:{src["id"]}', 'pages': [mp(x) for x in src['pages']]})
        for l in d['links']:
            key = tuple(sorted((mp(l['s']), mp(l['t']))))
            if key in link_ix:
                e = m['links'][link_ix[key]]; e['w'] += l['w']; e['kinds'] = sorted(set(e['kinds']) | set(l['kinds']))
                e['notes'] = (e['notes'] + [n for n in l['notes'] if n not in e['notes']])[:3]
            else: link_ix[key] = len(m['links']); m['links'].append({**l, 's': key[0], 't': key[1]})
        for l in d['synLinks']: m['synLinks'].append({'s': f'{bid}:{l["s"]}', 't': mp(l['t'])})
        for l in d['cocite']:
            key = tuple(sorted((mp(l['s']), mp(l['t']))))
            if key in co_ix: m['cocite'][co_ix[key]]['w'] += l['w']
            else: co_ix[key] = len(m['cocite']); m['cocite'].append({'s': key[0], 't': key[1], 'w': l['w']})
    ids, syn_ids, src_ids = {p['id'] for p in m['pages']}, {s['id'] for s in m['synapses']}, {s['id'] for s in m['sources']}
    lobe_ids = {l['id'] for l in m['lobes']}
    dup = [k for k, n in collections.Counter([*(p['id'] for p in m['pages']), *(l['id'] for l in m['lobes'])]).items() if n > 1] \
        + [k for k, n in collections.Counter(s['id'] for s in m['synapses']).items() if n > 1]
    bad = [l for l in m['links'] if l['s'] not in ids or l['t'] not in ids] + [p['id'] for p in m['pages'] if p.get('parent') and p['parent'] not in ids] \
        + [x['id'] for p in m['pages'] for x in p['synapses'] if x['id'] not in syn_ids] + [l for l in m['synLinks'] if l['s'] not in syn_ids or l['t'] not in ids] \
        + [x for s in m['synapses'] for x in s['cites'] if x not in src_ids] + [s['id'] for s in m['synapses'] if s['page'] not in ids] \
        + [p['id'] for p in m['pages'] if p['lobe'] not in lobe_ids] + [x for p in m['pages'] for x in p['sources'] if x not in src_ids] \
        + [x for s in m['sources'] for x in s['pages'] if x not in ids] + [l for l in m['cocite'] if l['s'] not in ids or l['t'] not in ids] \
        + [b['id'] for b in m['brains'] if b['center'] not in ids or b['self'] not in lobe_ids] + [c for c in m['centers'] if c not in ids] \
        + [f'duplicate {k}' for k in dup]
    if bad: raise KeyError(f'dangling references in the network brain: {bad[:5]}')
    with open(out, 'w', encoding='utf-8') as f: f.write('window.MINDBLOWN = ' + json.dumps(m, ensure_ascii=False) + ';\n')
    print(f"network brain: pages={len(m['pages'])} synapses={len(m['synapses'])} sources={len(m['sources'])} links={len(m['links'])} lobes={len(m['lobes'])} shared={sorted(shared)}")
    return m
