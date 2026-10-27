# Second pass over the BLACK lines of the reference map: every black line that is a road (separates two blocks, or cuts across a pier) and is
# not yet in mapdata.json is added as a small street. Outlines of piers / landmarks (water on one side) are not roads. Run after add_black_roads.py;
# afterwards run dedupe_streets, clean_map and build_interchanges.   python3 tools/add_black_more.py [--dry]
import sys, os, json, math, numpy as np, cv2
DRY = '--dry' in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__)); sys.argv = ['x', os.path.join(HERE, 'ref-map.png'), '/tmp/_unused.json']
src = open(os.path.join(HERE, 'trace_roads.py')).read(); exec(src[:src.index("out = {'tan'")])
SCALE = 2.3; P = os.path.join(HERE, '..', 'src', 'chicago')
md = json.load(open(os.path.join(P, 'mapdata.json')))
big = cv2.resize(im, None, fx=SC, fy=SC, interpolation=cv2.INTER_CUBIC); hv = cv2.cvtColor(big, cv2.COLOR_BGR2HSV)
Hh, Ss, Vv = [hv[..., i].astype(int) for i in range(3)]
maroon = ((Hh >= 155) | (Hh <= 6)) & (Ss > 90)
dark = (Vv < 110) & (Ss < 190) & ~maroon
water = ((Hh >= 85) & (Hh <= 115) & (Ss > 40) & (Vv > 90)).astype(np.uint8)
water = cv2.morphologyEx(water, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
line = dark.astype(np.uint8) & (cv2.erode(water, np.ones((3, 3), np.uint8)) == 0)
line = cv2.morphologyEx(line, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
cov = np.zeros_like(line)
for s_ in md['streets']:
    cv2.polylines(cov, [(np.array(s_['pts']) / SCALE * SC).astype(np.int32)], False, 1, 1)
cv2.polylines(cov, [(np.array(md['highway']) / SCALE * SC).astype(np.int32)], False, 1, 1)
line = line & (cv2.dilate(cov, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) == 0)       # only what no street covers yet (2.5 ref px)
cen, edges = skel_graph(line, 20)
existing = [[(x / SCALE, y / SCALE) for x, y in s['pts']] for s in md['streets']] + [[(x / SCALE, y / SCALE) for x, y in md['highway']]]
def dseg(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L = dx * dx + dy * dy; t = 0 if not L else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
    q = (a[0] + dx * t, a[1] + dy * t); return math.dist(p, q), q
def nearest(p, pls=None):
    best = (1e9, None)
    for pl in (pls or existing):
        for i in range(len(pl) - 1):
            d, q = dseg(p, pl[i], pl[i + 1])
            if d < best[0]: best = (d, q)
    return best
def plen(p): return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))
hw = [(x / SCALE, y / SCALE) for x, y in md['highway']]
def wat(x, y):
    X, Y = int(x * SC), int(y * SC)
    return 0 <= Y < water.shape[0] and 0 <= X < water.shape[1] and water[Y, X] > 0
LM = [(l[1] / SCALE, l[2] / SCALE, l[3] / SCALE, l[4] / SCALE) for l in md['landmarks'] if len(l) < 7 or not l[6]]
def on_lm_outline(p):
    for x0, y0, x1, y1 in LM:
        if x0 - 3 <= p[0] <= x1 + 3 and y0 - 3 <= p[1] <= y1 + 3 and min(abs(p[0] - x0), abs(p[0] - x1), abs(p[1] - y0), abs(p[1] - y1)) < 2.5: return True
    return False
new = []; rej = []
for ci, cj, path in edges:
    if ci == cj or len(path) < 18: rej.append(('short/loop', path)); continue
    pts = to_poly(path, cen[ci] if ci >= 0 else None, cen[cj] if cj >= 0 else None, 1.6)
    L = plen(pts)
    if L < 6 or ((cj < 0 or ci < 0) and L < 12): rej.append(('len%d' % L, pts)); continue
    dense = [[pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t / 4, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t / 4] for i in range(len(pts) - 1) for t in range(4)]
    if np.mean([on_lm_outline(p) for p in dense]) > 0.5: rej.append(('lm', pts)); continue
    if np.mean([min(dseg(q, hw[i], hw[i + 1])[0] for i in range(len(hw) - 1)) < 38 for q in dense]) > 0.7: rej.append(('hw', pts)); continue   # interchange arcs
    # water on one side = the outline of a pier or landmark
    side = 0; n = 0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]; l = math.dist(a, b) or 1; nx, ny = -(b[1] - a[1]) / l, (b[0] - a[0]) / l
        for t in (0.25, 0.75):
            mx, my = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            side += wat(mx + nx * 3, my + ny * 3) or wat(mx - nx * 3, my - ny * 3); n += 1
    if n and side / n > 0.35: rej.append(('water', pts)); continue
    if np.mean([wat(q[0], q[1]) for q in dense]) > 0.1: rej.append(('bank', pts)); continue                                   # a bank line, not a road
    linked = 0
    for end in (0, -1):
        d, q = nearest(pts[end])
        if d < 6: pts.insert(0, list(q)) if end == 0 else pts.append(list(q)); linked += 1
    if linked == 0 or (L < 10 and linked < 2): rej.append(('float', pts)); continue                                              # lettering and specks float free
    new.append(pts)
print('new black roads', len(new), 'total length', round(sum(plen(p) for p in new)))
if DRY:
    out = cv2.resize(im, None, fx=3, fy=3)
    for pl in existing: cv2.polylines(out, [np.array(pl) .__mul__(3).astype(np.int32)], False, (255, 255, 255), 1)
    for pl in new: cv2.polylines(out, [(np.array(pl) * 3).astype(np.int32)], False, (255, 0, 255), 2)
    cols = {'lm': (0, 165, 255), 'hw': (0, 0, 255), 'water': (255, 0, 0), 'bank': (255, 255, 0), 'float': (0, 255, 0)}
    for why, pl in rej:
        c = cols.get(why, (200, 200, 200)); cv2.polylines(out, [(np.array(pl) * 3).astype(np.int32)], False, c, 2)
    cv2.imwrite('/tmp/claude-0/-home-claude/c8dde71d-e3f7-56ec-bf2b-8d3fccfb4cee/scratchpad/black_more.png', out); sys.exit()
for pts in new: md['streets'].append({'cls': 'two', 'pts': [[round(x * SCALE, 1), round(y * SCALE, 1)] for x, y in pts]})
json.dump(md, open(os.path.join(P, 'mapdata.json'), 'w'))
open(os.path.join(P, 'mapdata.js'), 'w').write('// generated by tools/build_mapdata.py + add_black_roads.py (same content as mapdata.json) - edit the map in the studio, or re-run the tools\nexport default ' + json.dumps(md) + ';\n')
