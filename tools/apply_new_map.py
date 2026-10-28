# Replaces the street layer with the chains traced from the clean map image (scratchpad new_img5.json) and straightens the diamond interchanges.
import json, math, sys, os, collections
P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'chicago')
src = sys.argv[1]
md = json.load(open(os.path.join(P, 'mapdata.json')))
ch = json.load(open(src))['chains']
print(collections.Counter((c['cls'], c.get('acls')) for c in ch))
cv = lambda x, y: [round((x + 6.67) / 1.4574 * 2.3, 1), round((y + 8.17) / 1.4574 * 2.3, 1)]
def dseg(p, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]; L = dx*dx+dy*dy; t = 0 if not L else max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L))
    return math.dist(p, (a[0]+dx*t, a[1]+dy*t))
dp = lambda p, pl: min(dseg(p, pl[i], pl[i+1]) for i in range(len(pl)-1))
def smp(pl, st=3.0):
    o = []
    for i in range(len(pl)-1):
        a, b = pl[i], pl[i+1]; n = max(1, int(math.dist(a, b)/st)); o += [(a[0]+(b[0]-a[0])*k/n, a[1]+(b[1]-a[1])*k/n) for k in range(n)]
    return o + [pl[-1]]
# diamonds -> straight slip roads
for ix in md['interchanges']:
    if ix['label'] in ('Wrigley', 'McCormick'):
        ix['ramps'] = [[r[0], [round((r[0][0]+r[-1][0])/2, 1), round((r[0][1]+r[-1][1])/2, 1)], r[-1]] for r in ix['ramps']]
        ix['template'] = 'diamond'
    else: ix['template'] = 'partial cloverleaf'
hw = md['highway']; avoid = [hw] + [r for ix in md['interchanges'] for r in ix['ramps']] + [ix['pts'] for ix in md['interchanges']]
import numpy as np, cv2
# the Shedd Aquarium peninsula and its stem stand on the lake like the other piers: a deck around the traced outline
md['decks'] = [d for d in md['decks'] if d['name'] != 'Shedd Aquarium']
if True:
    sp = [cv(x, y) for c in ch for x, y in c['pts']]; sp = [q for q in sp if 790 < q[0] < 895 and 810 < q[1] < 880]
    hull = cv2.convexHull(np.array(sp, np.float32)).reshape(-1, 2); cx, cy = hull.mean(0)
    hull = [[round(float(x + (x - cx) / (math.hypot(x - cx, y - cy) or 1) * 9), 1), round(float(y + (y - cy) / (math.hypot(x - cx, y - cy) or 1) * 9), 1)] for x, y in hull]
    md['decks'].append({'name': 'Shedd Aquarium', 'color': 13222576, 'pts': hull}); print('shedd deck', len(hull))
RIV = json.load(open(os.environ.get('RIVERS_JSON'))) if os.environ.get('RIVERS_JSON') else md['rivers']
lake = np.array(md['lake'], np.float32).reshape(-1, 1, 2); decks = [np.array(d['pts'], np.float32).reshape(-1, 1, 2) for d in md['decks']]
def river_d(p):
    best = None
    for r in RIV:
        d = dp(p, r['pts']); sd = d - r['half']
        if best is None or sd < best[0]: best = (sd, r, d)
    return best
def nearest_on(p, pl):
    b = None
    for i in range(len(pl)-1):
        a, c = pl[i], pl[i+1]; dx, dy = c[0]-a[0], c[1]-a[1]; L = dx*dx+dy*dy; t = 0 if not L else max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L)); q = (a[0]+dx*t, a[1]+dy*t); d = math.dist(p, q)
        if not b or d < b[0]: b = (d, q)
    return b[1]
def lake_wet(p): return cv2.pointPolygonTest(lake, (float(p[0]), float(p[1])), False) > 0 and not any(cv2.pointPolygonTest(d, (float(p[0]), float(p[1])), False) >= 0 for d in decks)
def deck_snap(q):
    if any(cv2.pointPolygonTest(d, (float(q[0]), float(q[1])), False) >= 0 for d in decks): return q
    for dk in md['decks']:
        ring = [tuple(x) for x in dk['pts']] + [tuple(dk['pts'][0])]; c = nearest_on(q, ring)
        if math.dist(q, c) < 9:
            for st in (3, 4.5, 6):                       # step from the boundary into the deck
                for ang in range(0, 360, 30):
                    t = (c[0] + st*math.cos(math.radians(ang)), c[1] + st*math.sin(math.radians(ang)))
                    if cv2.pointPolygonTest(np.array(dk['pts'], np.float32).reshape(-1, 1, 2), t, False) >= 0 and math.dist(t, q) < 12: return t
    return q
def transversal(s, i, j, w):
    if w[0] != 'r': return False
    a, b = s[max(0, i-3)], s[min(len(s)-1, j+2)]; v = (b[0]-a[0], b[1]-a[1]); m = s[(i+j)//2]
    r = w[1]['pts']; best = None
    for k in range(len(r)-1):
        d = dseg(m, r[k], r[k+1])
        if best is None or d < best[0]: best = (d, (r[k+1][0]-r[k][0], r[k+1][1]-r[k][1]))
    t = best[1]; cs = abs(v[0]*t[0]+v[1]*t[1]) / ((math.hypot(*v) * math.hypot(*t)) or 1)
    return cs < 0.93                                   # at least ~37 degrees across the river
def push(pts):
    s = [deck_snap(q) if lake_wet(q) else q for q in smp(pts, 3.0)]; wet = []
    for q in s:
        sd, r, d = river_d(q); wet.append(('r', r, q) if sd < 0.5 else ('l', None, q) if lake_wet(q) else None)
    out = []; i = 0
    while i < len(s):
        if wet[i] is None: out.append(s[i]); i += 1; continue
        j = i
        while j < len(s) and wet[j] is not None: j += 1
        run = j - i
        kind = wet[i][0]; lim = (2 * wet[i][1]['half'] + 26) / 3.0 if kind == 'r' else 4
        if run <= lim and i >= 12 and len(s) - j >= 12 and transversal(s, i, j, wet[i]): out += s[i:j]                       # a bridge crossing
        else:
            for k in range(i, j):                          # runs along the water: move to the bank
                q = s[k]
                if wet[k][0] == 'r':
                    sd, r, d = river_d(q); c = nearest_on(q, r['pts']); v = (q[0]-c[0], q[1]-c[1]); n = math.hypot(*v) or 1
                    out.append((c[0] + v[0]/n*(r['half']+6), c[1] + v[1]/n*(r['half']+6)))
                else:
                    ring = [tuple(x) for x in md['lake']] + [tuple(md['lake'][0])]; c = nearest_on(q, ring); v = (c[0]-q[0], c[1]-q[1]); n = math.hypot(*v) or 1
                    out.append((c[0] - v[0]/n*6, c[1] - v[1]/n*6))
        i = j
    a = cv2.approxPolyDP(np.array(out, np.float32).reshape(-1, 1, 2), 1.2, False).reshape(-1, 2)
    return [[round(float(x), 1), round(float(y), 1)] for x, y in a]
streets, drop = [], 0
def merge(chs):
    # chains meeting end to end (only those two) and carrying straight on are one street, so a bridge has room on both sides
    C = [{'cls': c['cls'], 'acls': c.get('acls'), 'pts': [cv(x, y) for x, y in c['pts']]} for c in chs]
    key = lambda q: (round(q[0] / 2), round(q[1] / 2))
    changed = True
    while changed:
        changed = False
        ends = collections.defaultdict(list)
        for i, c in enumerate(C):
            ends[key(c['pts'][0])].append((i, 0)); ends[key(c['pts'][-1])].append((i, 1))
        kind = lambda c: ('av', c['acls']) if c['cls'] == 'avenue' else ('two',)
        for k, v in ends.items():
            best = None
            for x in range(len(v)):
                for y in range(x + 1, len(v)):
                    (i, ei), (j, ej) = v[x], v[y]
                    if i == j or kind(C[i]) != kind(C[j]): continue
                    a = C[i]['pts'] if ei == 1 else C[i]['pts'][::-1]; b = C[j]['pts'] if ej == 0 else C[j]['pts'][::-1]
                    d1 = (a[-1][0]-a[-2][0], a[-1][1]-a[-2][1]); d2 = (b[1][0]-b[0][0], b[1][1]-b[0][1])
                    cs = (d1[0]*d2[0]+d1[1]*d2[1]) / ((math.hypot(*d1) * math.hypot(*d2)) or 1)
                    if cs > 0.9 and (not best or cs > best[0]): best = (cs, i, j, a, b)
            if best:
                _, i, j, a, b = best; C[i] = {'cls': C[i]['cls'], 'acls': C[i]['acls'], 'pts': a + b[1:]}; C.pop(j); changed = True; break
    return C
MERGED = merge(ch); print('merged chains', len(ch), '->', len(MERGED))
for c in MERGED:
    pts = c['pts']
    s = smp(pts); near = sum(min(dp(q, a) for a in avoid) < 20 for q in s) / len(s)
    if near > 0.5: drop += 1; continue
    if any(math.dist(q, (797, 338)) < 2 for q in pts) and any(math.dist(q, (844, 354)) < 2 for q in pts): pts = [[797, 352], [844, 354]]
    pts = push(pts)
    cls = {'four': 'four', 'six': 'six'}.get(c.get('acls')) if c['cls'] == 'avenue' else None
    streets.append({'cls': cls or ('four' if c['cls'] == 'avenue' else 'two'), 'pts': pts, **({'tag': 'black'} if c['cls'] == 'black' else {})})
# dead ends: a free end within 34 px of another street (over dry land) is joined to it; ends on piers stay
def wetp(q): return river_d(q)[0] < 0.5 or lake_wet(q)
def on_deck(q): return any(cv2.pointPolygonTest(d, (float(q[0]), float(q[1])), False) >= 0 for d in decks)
joined = 0
for si, st in enumerate(streets):
    for end in (0, -1):
        e = st['pts'][end]
        if on_deck(e): continue
        near = [(dp(e, o['pts']), nearest_on(e, o['pts'])) for oi, o in enumerate(streets) if oi != si]
        near = [x for x in near if x[0] < 2.5]
        if near:                                       # touching: land exactly on the other street so the junction is real
            q = min(near, key=lambda x: x[0])[1]
            if end == 0: st['pts'][0] = [round(q[0], 1), round(q[1], 1)]
            else: st['pts'][-1] = [round(q[0], 1), round(q[1], 1)]
            continue
        if any(dp(e, st['pts'][k:k+2]) < 0.01 and False for k in range(1)): pass
        best = None
        for oi, o in enumerate(streets):
            if oi == si: continue
            q = nearest_on(e, o['pts']); d = math.dist(e, q)
            if d < 34 and (not best or d < best[0]): best = (d, q)
        if not best: continue
        d, q = best
        if any(wetp((e[0] + (q[0]-e[0]) * t / 10, e[1] + (q[1]-e[1]) * t / 10)) for t in range(0, 11)): continue
        if end == 0: st['pts'].insert(0, [round(q[0], 1), round(q[1], 1)])
        else: st['pts'].append([round(q[0], 1), round(q[1], 1)])
        joined += 1
print('dead ends joined', joined)
print('streets', len(streets), 'dropped near highway/ramps', drop)
md['streets'] = streets
json.dump(md, open(os.path.join(P, 'mapdata.json'), 'w'))
open(os.path.join(P, 'mapdata.js'), 'w').write('// generated by tools/apply_new_map.py (same content as mapdata.json) - edit the map in the studio, or re-run the tool\nexport default ' + json.dumps(md) + ';\n')
