# Adds the thin BLACK roads of the reference map (small streets, highway exit ramps, causeways) to src/chicago/mapdata.json,
# which build_mapdata.py (tan + maroon only) does not see. Run after build_mapdata.py:  python3 tools/add_black_roads.py
import sys, os, json, math, numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.argv = ['x', os.path.join(HERE, 'ref-map.png'), '/tmp/_unused.json']
src = open(os.path.join(HERE, 'trace_roads.py')).read(); exec(src[:src.index("out = {'tan'")])      # skel_graph, to_poly, masks
SCALE = 2.3; P = os.path.join(HERE, '..', 'src', 'chicago')
md = json.load(open(os.path.join(P, 'mapdata.json')))
big = cv2.resize(im, None, fx=SC, fy=SC, interpolation=cv2.INTER_CUBIC); hv = cv2.cvtColor(big, cv2.COLOR_BGR2HSV)
Hh, Ss, Vv = [hv[..., i].astype(int) for i in range(3)]
dark = (Vv < 110) & (Ss < 190) & ~(((Hh >= 155) | (Hh <= 6)) & (Ss > 90))
fills = ((cv2.resize(tan.astype(np.uint8), None, fx=SC, fy=SC, interpolation=cv2.INTER_NEAREST) > 0) | (cv2.resize(mar.astype(np.uint8), None, fx=SC, fy=SC, interpolation=cv2.INTER_NEAREST) > 0) | (cv2.resize(grn.astype(np.uint8), None, fx=SC, fy=SC, interpolation=cv2.INTER_NEAREST) > 0)).astype(np.uint8)
water = ((Hh >= 85) & (Hh <= 115) & (Ss > 40) & (Vv > 90)).astype(np.uint8)
water = cv2.morphologyEx(water, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
near_fill = cv2.dilate(fills, np.ones((9, 9), np.uint8)); near_water = cv2.dilate(water, np.ones((11, 11), np.uint8))
line = (dark & (near_fill == 0) & (near_water == 0)).astype(np.uint8)
line = cv2.morphologyEx(line, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
cen, edges = skel_graph(line, 30)
existing = [[(x / SCALE, y / SCALE) for x, y in s['pts']] for s in md['streets']] + [[(x / SCALE, y / SCALE) for x, y in md['highway']]]
def dseg(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L = dx * dx + dy * dy; t = 0 if not L else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
    q = (a[0] + dx * t, a[1] + dy * t); return math.dist(p, q), q
def nearest(p):
    best = (1e9, None)
    for pl in existing:
        for i in range(len(pl) - 1):
            d, q = dseg(p, pl[i], pl[i + 1])
            if d < best[0]: best = (d, q)
    return best
def plen(p): return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))
# boxes (ref px) where outlines belong to piers / landmarks on the water, not to streets
SKIP = [(367, 148, 480, 175), (368, 115, 422, 140), (394, 414, 438, 506), (415, 378, 442, 402), (355, 345, 400, 385)]
def mid(p):
    h = plen(p) / 2; acc = 0
    for i in range(len(p) - 1):
        l = math.dist(p[i], p[i + 1])
        if acc + l >= h: t = (h - acc) / (l or 1); return [p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t]
        acc += l
    return p[0]
new = []
for ci, cj, path in edges:
    if cj < 0 or len(path) < 30 or ci == cj: continue
    pts = to_poly(path, cen[ci], cen[cj], 2.2)
    if plen(pts) < 9: continue
    m = mid(pts)
    if any(b[0] <= m[0] <= b[2] and b[1] <= m[1] <= b[3] for b in SKIP): continue
    # the road fill hides the first pixels at each end: join the ends to the nearest street
    for end in (0, -1):
        d, q = nearest(pts[end])
        if d < 5.5: pts.insert(0, list(q)) if end == 0 else pts.append(list(q))
    # samples mostly on top of an existing street -> duplicate
    dense = [[pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t / 4, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t / 4] for i in range(len(pts) - 1) for t in range(4)]
    if np.mean([nearest(p)[0] < 2.2 for p in dense]) > 0.5: continue
    hw = [(x / SCALE, y / SCALE) for x, y in md['highway']]
    def dhw(q): return min(dseg(q, hw[i], hw[i + 1])[0] for i in range(len(hw) - 1))
    if np.mean([dhw(q) < 38 for q in dense]) > 0.7: continue          # the exit ramps next to the highway are built by the interchange code
    new.append(pts)
print('black roads found', len(new))
by_hand = [   # causeways and exits the colours cannot give (reference px)
    ([[337, 125], [372, 128], [395, 130]], 'two'),             # Water Filtration Plant causeway
    ([[347, 160], [420, 161], [470, 161]], 'two'),             # Navy Pier
    ([[360, 391], [395, 391], [428, 391]], 'two'),             # Adler Planetarium
    ([[362, 484], [398, 484], [412, 484]], 'two'),             # Meigs Field
]
def strip(pts, w=6):      # a thin deck under a causeway so the road is not 'in the lake'
    top = [[x, y - w] for x, y in pts]; bot = [[x, y + w] for x, y in reversed(pts)]
    return [[round(x * SCALE, 1), round(y * SCALE, 1)] for x, y in top + bot]
md['decks'] = [d for d in md['decks'] if not d['name'].startswith('Causeway')]
for k, (pts, c) in enumerate(by_hand): md['decks'].append({'name': 'Causeway ' + str(k + 1), 'color': 13222576, 'pts': strip(pts)})
for pts, c in by_hand: md['streets'].append({'cls': c, 'pts': [[round(x * SCALE, 1), round(y * SCALE, 1)] for x, y in pts]})
for pts in new: md['streets'].append({'cls': 'two', 'pts': [[round(x * SCALE, 1), round(y * SCALE, 1)] for x, y in pts]})
# highway exits: the west clover (street at reference y 355) stays; the top diamond and the bottom lens are new; the stray one at y 290 goes
md['interchanges'] = [x for x in md['interchanges'] if abs(x['pts'][0][1] / SCALE - 290) > 20]
md['interchanges'] += [
    {'cls': 'four', 'label': 'Wrigley', 'pts': [[round(92 * SCALE, 1), round(111 * SCALE, 1)], [round(150 * SCALE, 1), round(147 * SCALE, 1)]]},
    {'cls': 'four', 'label': 'McCormick', 'pts': [[round(178 * SCALE, 1), round(518 * SCALE, 1)], [round(199 * SCALE, 1), round(487 * SCALE, 1)]]}]
json.dump(md, open(os.path.join(P, 'mapdata.json'), 'w'))
open(os.path.join(P, 'mapdata.js'), 'w').write('// generated by tools/build_mapdata.py + add_black_roads.py (same content as mapdata.json) - edit the map in the studio, or re-run the tools\nexport default ' + json.dumps(md) + ';\n')
