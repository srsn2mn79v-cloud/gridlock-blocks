# Traces the three highway interchanges (clover, diamond, lens) from the thin black curves of the reference map.
# Each interchange = a street across the highway + ramp curves (each runs from the highway to that street).
# Run after build_mapdata.py / add_black_roads.py:   python3 tools/build_interchanges.py
import sys, os, json, math, numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.argv = ['x', os.path.join(HERE, 'ref-map.png'), '/tmp/_unused.json']
exec(open(os.path.join(HERE, 'trace_roads.py')).read().split("out = {'tan'")[0])      # skel_graph, to_poly, im
P = os.path.join(HERE, '..', 'src', 'chicago'); SCALE = 2.3
md = json.load(open(os.path.join(P, 'mapdata.json')))
SC = 6
big = cv2.resize(im, None, fx=SC, fy=SC, interpolation=cv2.INTER_CUBIC); hv = cv2.cvtColor(big, cv2.COLOR_BGR2HSV)
Hh, Ss, Vv = [hv[..., i].astype(int) for i in range(3)]
dark = ((Vv < 110) & (Ss < 190) & ~(((Hh >= 155) | (Hh <= 6)) & (Ss > 90))).astype(np.uint8)
hw = [(x / SCALE, y / SCALE) for x, y in md['highway']]
band = np.zeros(dark.shape, np.uint8)
cv2.polylines(band, [np.array([[x * SC, y * SC] for x, y in hw], np.int32)], False, 1, int(11 * SC))     # the highway itself (and its outline)
dark &= (1 - band)
def dseg(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L = dx * dx + dy * dy; t = 0 if not L else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
    q = (a[0] + dx * t, a[1] + dy * t); return math.dist(p, q), q
def d_hw(p): return min(dseg(p, hw[i], hw[i + 1])[0] for i in range(len(hw) - 1))
def smooth(pts, n=40, step=1.0):
    a = np.array(pts, float); L = np.r_[0, np.cumsum(np.hypot(*np.diff(a, axis=0).T))]
    k = max(3, int(L[-1] / step)); t = np.linspace(0, L[-1], k); r = np.c_[np.interp(t, L, a[:, 0]), np.interp(t, L, a[:, 1])]
    s = 2.2; w = np.exp(-0.5 * (np.arange(-6, 7) / s) ** 2); w /= w.sum()
    pad = np.r_[np.repeat(r[:1], 6, 0), r, np.repeat(r[-1:], 6, 0)]
    sm = np.c_[np.convolve(pad[:, 0], w, 'valid'), np.convolve(pad[:, 1], w, 'valid')]
    sm[0], sm[-1] = r[0], r[-1]
    return cv2.approxPolyDP(sm.astype(np.float32).reshape(-1, 1, 2), 0.35, False).reshape(-1, 2).tolist()
BOXES = {'Wrigley': (85, 80, 165, 165), 'Clover': (0, 295, 95, 415), 'McCormick': (165, 470, 240, 535)}
out = []
for label, (x0, y0, x1, y1) in BOXES.items():
    m = np.zeros_like(dark); m[y0 * SC:y1 * SC, x0 * SC:x1 * SC] = dark[y0 * SC:y1 * SC, x0 * SC:x1 * SC]
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    cen, edges = skel_graph(m, 30)
    es = []
    for ci, cj, path in edges:
        if len(path) < 30: continue
        pts = to_poly(path, cen[ci] if ci >= 0 else None, cen[cj] if cj >= 0 else None, 1.0)
        es.append(pts)
    # arcs = edges with exactly one end close to the highway
    arcs, rest = [], []
    for pts in es:
        n0, n1 = d_hw(pts[0]) < 10, d_hw(pts[-1]) < 10
        chord = math.dist(pts[0], pts[-1]); length = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        dev = max(dseg(q, pts[0], pts[-1])[0] for q in pts); 
        if n0 != n1 and dev < 0.5: rest.append(pts)        # a straight piece = half of the street that crosses the highway
        elif n0 != n1: arcs.append(pts if n0 else pts[::-1])        # a curve with one end on the highway = a ramp (highway end first)
        elif not n0 and not n1: rest.append(pts)
    arcs = [a for a in arcs if sum(math.dist(a[i], a[i+1]) for i in range(len(a)-1)) > 14]
    ends = [a[-1] for a in arcs]
    # cluster the street-side ends (within 6 px)
    cl = []
    for p in ends:
        for c in cl:
            if math.dist(c[0], p) < 6: c.append(p); break
        else: cl.append([p])
    cents = [np.mean(c, axis=0).tolist() for c in cl]
    print(label, 'arcs', len(arcs), 'rest', len(rest), 'clusters', [[round(v, 1) for v in c] for c in cents])
    if len(cents) == 3 or len(cents) == 2:
        pass
    if len(cl) >= 2:
        # drop 'arcs' that are really half of the street: their highway end lies on the line through the two junctions
        far = sorted(cents, key=lambda c: -math.dist(c, (494.5 / SCALE, 701.5 / SCALE)))
        La, Lb = far[0], far[-1]
        dl = lambda p: abs((Lb[0]-La[0])*(La[1]-p[1]) - (La[0]-p[0])*(Lb[1]-La[1])) / math.dist(La, Lb)
        arcs = [a for a in arcs if dl(a[0]) > 3]
        cl = []
        for a in arcs:
            p = a[-1]
            for c in cl:
                if math.dist(c[0], p) < 6: c.append(p); break
            else: cl.append([p])
        cents = [np.mean(c, axis=0).tolist() for c in cl]
        print(label, 'after street filter', len(arcs))
    if len(cents) != 2: print('  WARNING: expected 2 junctions'); 
    city_c = (494.5 / SCALE, 701.5 / SCALE)
    cents.sort(key=lambda c: -math.dist(c, city_c))               # outer first
    A, B = cents[0], cents[-1]
    ramps = []
    for a in arcs:
        c = min(cents, key=lambda c: math.dist(c, a[-1])); a = a[:-1] + [c]
        ramps.append([[round(x * SCALE, 1), round(y * SCALE, 1)] for x, y in smooth(a)])
    d = np.array(B) - np.array(A); d /= np.linalg.norm(d)
    # the street carries on past B to the street it joins in the city
    street = [A, B]
    best = None
    for s in md['streets']:
        pl = [(x / SCALE, y / SCALE) for x, y in s['pts']]
        for i in range(len(pl) - 1):
            dd, q = dseg(B, pl[i], pl[i + 1])
            v = np.array(q) - np.array(B)
            if 2 < dd < 40 and (np.linalg.norm(v) == 0 or np.dot(v, d) / np.linalg.norm(v) > 0.85):
                if not best or dd < best[0]: best = (dd, q)
    far = [p for r in rest for p in (r[0], r[-1]) if np.dot(np.array(p) - np.array(B), d) > 2 and math.dist(p, B) < 90]
    if far: street.append(max(far, key=lambda p: math.dist(p, B)))
    elif best: street.append(list(best[1]))
    out.append({'cls': 'four', 'label': label, 'pts': [[round(x * SCALE, 1), round(y * SCALE, 1)] for x, y in street], 'ramps': ramps})
    print('  street', [[round(v, 1) for v in p] for p in street])
md['interchanges'] = out
# streets that just trace one of the ramps (left over from the black-line pass) are dropped
def _d(p, pl): return min(dseg(p, pl[i], pl[i + 1])[0] for i in range(len(pl) - 1))
def _smp(pl, st=3.0):
    o = []
    for i in range(len(pl) - 1):
        a, b = pl[i], pl[i + 1]; n = max(1, int(math.dist(a, b) / st)); o += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n)]
    return o + [pl[-1]]
allr = [r for ix in out for r in ix['ramps']]
keep = []
for st in md['streets']:
    sm = _smp(st['pts'])
    near = sum(min(_d(q, r) for r in allr) < 9 for q in sm) / len(sm)
    if near > 0.5: print('  dropping a street that traces a ramp, length', round(sum(math.dist(st['pts'][i], st['pts'][i+1]) for i in range(len(st['pts'])-1))))
    else: keep.append(st)
md['streets'] = keep
# the black streets that were the ramps themselves (added by add_black_roads.py near the highway) are replaced
json.dump(md, open(os.path.join(P, 'mapdata.json'), 'w'))
open(os.path.join(P, 'mapdata.js'), 'w').write('// generated by tools/build_mapdata.py + add_black_roads.py + build_interchanges.py (same content as mapdata.json) - edit the map in the studio, or re-run the tools\nexport default ' + json.dumps(md) + ';\n')
