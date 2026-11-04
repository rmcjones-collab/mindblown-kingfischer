"""What the Kingfischer brains share: the list of brains and a small Brain helper that writes a MindBlown data file.

The Brain class is the one from mindblown-chess (mb_shared.py), unchanged apart from having no shared-id registry:
the three brains here (Leela, Maia, King) link to each other by page, not by shared neuron ids.
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

    def page(self, pid, title, ptype, lobe, desc, syns, see=(), parent=None, ring=None, created=TODAY, updated=TODAY, section='Synapses'):
        assert pid not in self.ids, f'duplicate id {pid}'
        P = {'id': pid, 'title': title, 'type': ptype, 'lobe': lobe, 'desc': desc, 'intro': desc, 'created': created, 'updated': updated,
             'synapses': [], 'sources': [], 'sections': []}
        if parent: P['parent'] = parent
        if ring is not None: P['ring'] = ring
        for i, s in enumerate(syns, 1):
            lead, text, cites = s[0], s[1], list(s[2]); links = list(s[3]) if len(s) > 3 else []; sec = s[4] if len(s) > 4 else section
            assert cites, f'uncited synapse on {pid}: {lead}'
            for c in cites: assert c in self.sources, f'unregistered source {c} on {pid}'
            P['synapses'].append({'id': f'{pid}#{i}', 'page': pid, 'lead': lead, 'text': text, 'section': sec, 'links': links, 'cites': cites})
            for c in cites:
                if c not in P['sources']: P['sources'].append(c)
            if sec not in P['sections']: P['sections'].append(sec)
        self.see[pid].extend(see); self.pages.append(P); self.ids.add(pid); return pid

    def shared(self, pid, syns, see=(), parent=None, ring=None, section=None):
        if pid not in REGISTRY: raise KeyError(f'{pid} is not in mb_shared.REGISTRY')
        title, ptype, lobe, desc, created = REGISTRY[pid]
        return self.page(pid, title, ptype, lobe, desc, syns, see=see, parent=parent, ring=ring, created=created, section=section or f'On {self.title}')

    def write(self, out=None, link_types=False):
        """Resolve links (see-also + synapse mentions), drop mentions of pages that are not in this brain, write the file."""
        ids = self.ids
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
                s['links'] = [t for t in s['links'] if t in ids]
                for t in s['links']:
                    # a mention of a rule or ply neuron is a synapse-level thread only, so it does not become a mega-hub
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
        assert all(p['parent'] in ids for p in self.pages if p.get('parent')), 'dangling parent'
        lobes = []
        for l in self.lobes:
            L = {'id': l['id'], 'name': l['name'], 'color': l['color'], 'hidden': l.get('hidden', False)}
            if 'ring' in l: L['ring'] = l['ring']
            lobes.append(L)
        data = {'lobes': lobes, 'center': self.hub, 'brain': self.b['id'], 'title': self.title, 'subtitle': self.subtitle, 'pages': self.pages,
                'synapses': synapses, 'sources': sources, 'links': list(links.values()), 'synLinks': synLinks, 'cocite': cocite, 'built': TODAY}
        if self.rings: data['rings'] = self.rings
        out = out or os.path.join(HERE, self.b['data'])
        with open(out, 'w', encoding='utf-8') as f: f.write('window.MINDBLOWN = ' + json.dumps(data, ensure_ascii=False) + ';\n')
        subs = sum(1 for p in self.pages if p.get('parent'))
        print(f"{self.b['id']}: pages={len(self.pages)} (sub={subs}) synapses={len(synapses)} sources={len(sources)} links={len(links)}",
              dict(collections.Counter(p['lobe'] for p in self.pages if not p.get('parent'))))
        return data
