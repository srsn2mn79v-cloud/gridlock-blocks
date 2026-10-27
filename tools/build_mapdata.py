# Builds src/chicago/mapdata.json from the reference map (tools/ref-map.png): traced roads + hand-placed features.
# Coordinates in the JSON are "map px" = reference-image px * SCALE (the game turns map px into world units with T() in map.js).
# usage: python3 tools/build_mapdata.py        (needs opencv, scikit-image, numpy)
import json, math, subprocess, sys, os, numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__))
SC = 2.3
RAW = '/tmp/roads_raw.json'
subprocess.check_call([sys.executable, os.path.join(HERE, 'trace_roads.py'), os.path.join(HERE, 'ref-map.png'), RAW])
raw = json.load(open(RAW))
im = cv2.imread(os.path.join(HERE, 'ref-map.png'))
P = lambda pts: [[round(x * SC, 1), round(y * SC, 1)] for x, y in pts]

def plen(p): return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))
def dseg(p, a, b):
    ax, ay = a; bx, by = b; dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L))
    q = (ax + dx * t, ay + dy * t); return math.dist(p, q), q

# ---- 1. roads: tan = avenues, maroon = streets ------------------------------------------------------------------
hsv0 = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
olive = cv2.dilate(((hsv0[..., 0] >= 24) & (hsv0[..., 0] <= 38) & (hsv0[..., 1] > 90) & (hsv0[..., 2] > 70) & (hsv0[..., 2] < 175)).astype(np.uint8), np.ones((5, 5), np.uint8))
def in_olive(pts):
    n = 0
    for x, y in pts:
        if olive[min(max(int(y), 0), olive.shape[0] - 1), min(max(int(x), 0), olive.shape[1] - 1)]: n += 1
    return n / len(pts)
roads = []
for e in raw['tan']:
    if plen(e['pts']) < 8: continue
    pts = e['pts']; dense = [[pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t / 4, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t / 4] for i in range(len(pts) - 1) for t in range(4)]
    if plen(pts) < 60 and in_olive(dense) > 0.45: continue                                         # the squiggles inside the olive blocks
    roads.append({'cls': 'four', 'pts': [list(p) for p in e['pts']]})
for e in raw['mar']:
    if plen(e['pts']) < 6: continue
    roads.append({'cls': 'two', 'pts': [list(p) for p in e['pts']]})
# manual fixes (reference px): [cls, points]
ADD = []
REMOVE_BOXES = [(390, 410, 440, 512), (352, 148, 480, 176), (368, 117, 420, 138), (262, 460, 300, 500), (405, 380, 440, 400), (160, 40, 200, 75)]      # (x0,y0,x1,y1): roads whose midpoint lies inside are dropped
def mid(p): a = plen(p) / 2; acc = 0
def midpt(p):
    h = plen(p) / 2; acc = 0
    for i in range(len(p) - 1):
        l = math.dist(p[i], p[i + 1])
        if acc + l >= h: t = (h - acc) / (l or 1); return [p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t]
        acc += l
    return p[0]
roads = [r for r in roads if not any(b[0] <= midpt(r['pts'])[0] <= b[2] and b[1] <= midpt(r['pts'])[1] <= b[3] for b in REMOVE_BOXES)]
for c, pts in ADD: roads.append({'cls': c, 'pts': pts})

# ---- 2. the lake shore: Lake Shore Drive is the tan ring (six lanes) ------------------------------------------------
water = ((im[..., 0].astype(int) > im[..., 2].astype(int) + 25) & (im[..., 0] >= im[..., 1] - 5)).astype(np.uint8)
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV); Hh, Ss, Vv = [hsv[..., i].astype(int) for i in range(3)]
water = ((im[..., 0].astype(int) > im[..., 2].astype(int) + 25) & (im[..., 0].astype(int) >= im[..., 1].astype(int) - 5) & (Ss > 40) & (Hh >= 85) & (Hh <= 115) & (Vv > 90)).astype(np.uint8)
water = cv2.morphologyEx(water, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
h, w = water.shape
shore = []
for y in range(0, h):
    x0 = 335 if 172 <= y <= 218 else 175
    xs = np.nonzero(water[y, x0:])[0]
    shore.append(x0 + xs[0] if len(xs) else None)
for y in range(1, h):
    if shore[y] is None: shore[y] = shore[y - 1]
for y in range(h - 2, -1, -1):
    if shore[y] is None: shore[y] = shore[y + 1]
from scipy.ndimage import median_filter
shore = [int(v) for v in median_filter(np.array(shore), size=33, mode='nearest')]     # piers and peninsulas become decks, the lake polygon stays smooth
ys = [y for y in range(h) if shore[y] is not None]
sx = np.array([shore[y] for y in ys], float) + 2.5; sx = np.convolve(np.pad(sx, 4, mode='edge'), np.ones(9) / 9, mode='valid')
sh_pts = np.array([[sx[i], ys[i]] for i in range(len(ys))], np.float32).reshape(-1, 1, 2)
sh_pts = cv2.approxPolyDP(sh_pts, 1.1, False).reshape(-1, 2).tolist()
# the big rectangle around the open lake
lake = sh_pts + [[sh_pts[-1][0], 700], [900, 700], [900, -400], [sh_pts[0][0], -400]]
RING = lambda p: sum(1 for q in sh_pts if math.dist(p, q) < 12) > 0
for r in roads:
    if r['cls'] == 'four' and plen(r['pts']) > 40:
        m = midpt(r['pts'])
        if min(math.dist(m, q) for q in sh_pts) < 11: r['cls'] = 'six'
# ---- 2b. a street that carries straight on across a crossing street (the colour masks break it there) is one street ------------------
def unit0(a, b):
    d = math.dist(a, b) or 1; return ((b[0] - a[0]) / d, (b[1] - a[1]) / d)
def gap_merge(maxgap):
    done = 0
    while True:
        best = None
        for i, a in enumerate(roads):
            for ea in (0, -1):
                pa = a['pts'][ea]; da = unit0(a['pts'][1], a['pts'][0]) if ea == 0 else unit0(a['pts'][-2], a['pts'][-1])
                for j, b in enumerate(roads):
                    if j <= i or a['cls'] != b['cls']: continue
                    for eb in (0, -1):
                        pb = b['pts'][eb]; g = math.dist(pa, pb)
                        if g > maxgap or g < 0.01: continue
                        db = unit0(b['pts'][1], b['pts'][0]) if eb == 0 else unit0(b['pts'][-2], b['pts'][-1])
                        v = unit0(pa, pb)
                        if da[0] * v[0] + da[1] * v[1] < 0.93 or db[0] * -v[0] + db[1] * -v[1] < 0.93: continue
                        if da[0] * db[0] + da[1] * db[1] > -0.9: continue
                        if best is None or g < best[0]: best = (g, a, ea, b, eb)
        if not best: break
        g, a, ea, b, eb = best
        pa = a['pts'] if ea == -1 else a['pts'][::-1]; pb = b['pts'] if eb == 0 else b['pts'][::-1]
        a['pts'] = pa + pb; b['dead'] = True; roads[:] = [r for r in roads if not r.get('dead')]; done += 1
    return done
print('gap merges', gap_merge(14.0))
# ---- 3. snap loose road ends onto the road they nearly touch --------------------------------------------------------
SNAP = 6.5
for it in range(2):
    for r in roads:
        for ei in (0, -1):
            e = r['pts'][ei]; best = None
            for o in roads:
                if o is r: continue
                for j in range(len(o['pts']) - 1):
                    d, q = dseg(e, o['pts'][j], o['pts'][j + 1])
                    if d < SNAP and (best is None or d < best[0]): best = (d, o, j, q)
            if best and best[0] > 0.01:
                d, o, j, q = best
                r['pts'][ei] = [q[0], q[1]]
                # make the junction a vertex of the other road too
                a, b = o['pts'][j], o['pts'][j + 1]
                if math.dist(q, a) > 0.6 and math.dist(q, b) > 0.6: o['pts'].insert(j + 1, [q[0], q[1]])
        # drop degenerate
roads = [r for r in roads if plen(r['pts']) > 4]

def unit(a, b):
    d = math.dist(a, b) or 1; return ((b[0] - a[0]) / d, (b[1] - a[1]) / d)
# heal gaps: a road end that still floats extends to the nearest other road within a longer reach
def loose_ends():
    res = []
    for i, r in enumerate(roads):
        for ei in (0, -1):
            e = r['pts'][ei]; ok = False
            for j, o in enumerate(roads):
                if j == i: continue
                for k in range(len(o['pts']) - 1):
                    if dseg(e, o['pts'][k], o['pts'][k + 1])[0] < 1.0: ok = True; break
                if ok: break
            if not ok: res.append((r, ei))
    return res
for reach in (9.0, 13.0):
    for r, ei in loose_ends():
        e = r['pts'][ei]; best = None
        for o in roads:
            if o is r: continue
            for j in range(len(o['pts']) - 1):
                d, q = dseg(e, o['pts'][j], o['pts'][j + 1])
                if d < reach and (best is None or d < best[0]): best = (d, o, j, q)
        if best:
            d, o, j, q = best; r['pts'][ei] = [q[0], q[1]]
            a, b = o['pts'][j], o['pts'][j + 1]
            if math.dist(q, a) > 0.6 and math.dist(q, b) > 0.6: o['pts'].insert(j + 1, [q[0], q[1]])
# streets that cross a river vanish under the blue in the colour masks: join facing road ends across water
def water_frac(a, b):
    n = max(2, int(math.dist(a, b)))
    return sum(1 for i in range(n + 1) if water[min(max(int(a[1] + (b[1] - a[1]) * i / n), 0), water.shape[0] - 1), min(max(int(a[0] + (b[0] - a[0]) * i / n), 0), water.shape[1] - 1)]) / (n + 1)
def out_dir(r, ei):
    p = r['pts']; return unit(p[1], p[0]) if ei == 0 else unit(p[-2], p[-1])
joined = 0
for r, ei in loose_ends():
    e = r['pts'][ei]; d = out_dir(r, ei); hit = None
    for t in range(6, 56):
        for ang in (0, -0.12, 0.12, -0.25, 0.25):
            c, sn = math.cos(ang), math.sin(ang); dd = (d[0] * c - d[1] * sn, d[0] * sn + d[1] * c)
            q = (e[0] + dd[0] * t, e[1] + dd[1] * t)
            for o in roads:
                if o is r: continue
                for j in range(len(o['pts']) - 1):
                    dist_, qq = dseg(q, o['pts'][j], o['pts'][j + 1])
                    if dist_ < 2.5 and water_frac(e, qq) > 0.3 and (hit is None or t < hit[0]): hit = (t, o, j, qq)
        if hit: break
    if hit:
        t, o, j, qq = hit; a, b = o['pts'][j], o['pts'][j + 1]
        if math.dist(qq, a) > 0.6 and math.dist(qq, b) > 0.6: o['pts'].insert(j + 1, [qq[0], qq[1]])
        roads.append({'cls': r['cls'], 'pts': [list(e), [qq[0], qq[1]]]}); joined += 1
print('joined across water:', joined)
print('loose ends left', len(loose_ends()))
# chain the pieces into long streets: at a junction, two roads of the same class that carry on in a line are one street
# (bridges and the network builder work on whole streets, not on the pieces between two junctions)
def chain_once():
    ends = {}
    for r in roads:
        for ei in (0, -1):
            ends.setdefault((round(r['pts'][ei][0], 1), round(r['pts'][ei][1], 1)), []).append((r, ei))
    cands = []
    for key, lst in ends.items():
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                (a, ea), (b, eb) = lst[i], lst[j]
                if a is b or a['cls'] != b['cls']: continue
                pa = a['pts'] if ea == 0 else a['pts'][::-1]; pb = b['pts'] if eb == 0 else b['pts'][::-1]
                da = unit(pa[0], pa[1]); db = unit(pb[0], pb[1])
                dot = da[0] * db[0] + da[1] * db[1]          # -1 = straight on
                if dot < -0.72: cands.append((dot, a, ea, b, eb))
    cands.sort(key=lambda c: c[0])
    used = set(); merged = 0
    for dot, a, ea, b, eb in cands:
        if id(a) in used or id(b) in used: continue
        pa = a['pts'] if ea == -1 else a['pts'][::-1]; pb = b['pts'] if eb == 0 else b['pts'][::-1]
        a['pts'] = pa + pb[1:]; used.add(id(a)); used.add(id(b)); b['dead'] = True; merged += 1
    roads[:] = [r for r in roads if not r.get('dead')]
    return merged
while chain_once(): pass
print('after chaining', len(roads), 'streets')
# ---- 4. highway (dark green), joined to the ends of the shore drive ---------------------------------------------------
HW = [[150, 68], [94, 151], [70, 191], [61, 214], [54, 257], [49, 313], [50, 403], [54, 423], [63, 438], [74, 445], [98, 450], [123, 461], [157, 479], [186, 499], [218, 518], [238, 527], [266, 537]]

# rivers: the water that is not lake -> skeleton -> three branches (north, main, trunk) with their half-widths
from skimage.morphology import skeletonize
from skimage.graph import route_through_array
lakemask = np.zeros(water.shape, np.uint8); cv2.fillPoly(lakemask, [np.array(lake, np.int32)], 1)
rv = (water & ~lakemask).astype(np.uint8); rv[:, 356:] = 0
n_, lab_, st_, _ = cv2.connectedComponentsWithStats(rv); rv2 = np.zeros_like(rv)
for i in range(1, n_):
    if st_[i, 4] > 600: rv2[lab_ == i] = 1
rv2 = cv2.morphologyEx(rv2, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
dist_ = cv2.distanceTransform(rv2, cv2.DIST_L2, 5)
sk = skeletonize(rv2 > 0)
cost = np.where(sk, 1.0, 1e4)
def trace_river(a, b):
    path, _ = route_through_array(cost, (a[1], a[0]), (b[1], b[0]), fully_connected=True)
    ap = cv2.approxPolyDP(np.array([[x, y] for y, x in path], np.float32).reshape(-1, 1, 2), 2.0, False).reshape(-1, 2)
    hw = float(np.median([dist_[y, x] for y, x in path])) ; return ap.tolist(), hw
def nearest_sk(p):
    ys_, xs_ = np.nonzero(sk); i = np.argmin((xs_ - p[0]) ** 2 + (ys_ - p[1]) ** 2); return [int(xs_[i]), int(ys_[i])]
JUNC = nearest_sk([122, 215])
RIVERS = []
for rid, end in (('north', [0, 128]), ('main', [350, 190]), ('trunk', [20, 501])):
    pts, hw = trace_river(nearest_sk(end), JUNC) if rid != 'main' else trace_river(JUNC, nearest_sk(end))
    if rid == 'trunk': pts, hw = trace_river(JUNC, nearest_sk(end))
    if rid == 'north': pts = pts   # runs from the map edge to the junction
    RIVERS.append({'id': rid, 'half': hw + 0.5, 'pts': pts})
# push the open ends out past the image edge / into the lake
RIVERS[0]['pts'].insert(0, [RIVERS[0]['pts'][0][0] - 40, RIVERS[0]['pts'][0][1] - 30])
RIVERS[1]['pts'].append([RIVERS[1]['pts'][-1][0] + 12, RIVERS[1]['pts'][-1][1]])
RIVERS[2]['pts'].append([RIVERS[2]['pts'][-1][0] - 50, RIVERS[2]['pts'][-1][1] + 8])
parks_raw = json.load(open('/tmp/claude-0/-home-claude/c8dde71d-e3f7-56ec-bf2b-8d3fccfb4cee/scratchpad/m/parks.json')) if os.path.exists('/tmp/claude-0/-home-claude/c8dde71d-e3f7-56ec-bf2b-8d3fccfb4cee/scratchpad/m/parks.json') else []
PARK_PICK = {1: 'Wrigley Green', 2: 'Hancock Green', 3: 'Lakeshore Strip', 5: 'Pier Gardens', 8: 'Lakefront Park', 10: 'Lakefront South', 11: 'Riverwalk Park', 13: 'Daley Green', 14: 'Art Institute Garden', 15: 'Riverwalk South', 16: 'Grant Park North', 17: 'Grant Park Strip', 19: 'Grant Park', 21: 'Shedd Green', 22: 'Dearborn Park West', 23: 'Dearborn Park East', 24: 'Museum Campus', 25: 'Archer Green'}
parks = [{'name': PARK_PICK[i], 'pts': P(parks_raw[i]['pts'])} for i in PARK_PICK if i < len(parks_raw)]
LANDMARKS = [
    ['Wrigley Field', 170, 42, 196, 72, 18], ['John Hancock Center', 283, 88, 303, 109, 150], ['Wrigley Building', 252, 164, 274, 178, 70],
    ['Water Filtration Plant', 373, 120, 418, 135, 16, 1], ['Navy Pier Hall', 369, 155, 386, 169, 10, 1], ['Navy Pier Pavilion', 387, 155, 410, 169, 12, 1],
    ['Navy Pier Rotunda', 412, 156, 424, 169, 14, 1], ['Navy Pier Ballroom', 426, 155, 476, 169, 14, 1],
    ['Art Institute', 313, 259, 324, 275, 24], ['Willis Tower', 143, 298, 170, 319, 210], ['Field Museum', 323, 385, 339, 402, 26],
    ['Shedd Aquarium', 362, 362, 384, 380, 16, 1], ['Meigs Field Terminal', 397, 418, 433, 505, 22, 1],
    ['McCormick North', 271, 462, 298, 476, 24], ['McCormick East', 291, 478, 314, 507, 24], ['McCormick West', 264, 480, 288, 496, 24]]
octa = lambda cx, cy, r: [[cx + r * math.cos(i * math.pi / 4 + math.pi / 8), cy + r * math.sin(i * math.pi / 4 + math.pi / 8)] for i in range(8)]
DECKS = [
    {'name': 'Navy Pier', 'color': 0xc9c2b0, 'pts': [[350, 152], [470, 152], [476, 156], [479, 162], [476, 168], [470, 172], [350, 172]]},
    {'name': 'Filtration Plant', 'color': 0x8d8a84, 'pts': [[372, 119], [419, 119], [419, 136], [372, 136]]},
    {'name': 'Plant causeway', 'color': 0x8d8a84, 'pts': [[343, 121], [373, 125], [373, 128], [343, 124]]},
    {'name': 'Adler causeway', 'color': 0xc9c2b0, 'pts': [[384, 388], [419, 388], [419, 395], [384, 395]]},
    {'name': 'Adler Planetarium', 'color': 0xc9c2b0, 'pts': octa(427, 391, 11)},
    {'name': 'Meigs causeway', 'color': 0x8d8a84, 'pts': [[402, 394], [406, 394], [406, 418], [402, 418]]},
    {'name': 'Meigs Field', 'color': 0x8d8a84, 'pts': [[394, 415], [437, 415], [437, 509], [394, 509]]}]
STADIUM = {'cx': 334, 'cy': 442, 'rx': 13, 'ry': 32}
DISTRICTS = [
    {'name': 'Downtown', 'poly': [[140, 255], [300, 255], [300, 372], [140, 372]], 'h': [70, 190], 'style': 'tower', 'blurb': 'Central business district: the tallest towers', 'color': '#5aa9ff'},
    {'name': 'Neon Strip', 'poly': [[250, 190], [345, 190], [345, 258], [250, 258]], 'h': [18, 60], 'style': 'mid', 'blurb': 'Bars, clubs and signs on every wall', 'color': '#ff2fd6'},
    {'name': 'River North', 'poly': [[150, 150], [345, 150], [345, 205], [150, 205]], 'h': [38, 110], 'style': 'tower'},
    {'name': 'Gold Coast', 'poly': [[190, 70], [345, 70], [345, 150], [190, 150]], 'h': [22, 60], 'style': 'mid'},
    {'name': 'Old Town', 'poly': [[140, 40], [260, 40], [260, 160], [140, 160]], 'h': [10, 24], 'style': 'low'},
    {'name': 'Industrial', 'poly': [[40, 190], [135, 190], [135, 440], [40, 440]], 'h': [8, 18], 'style': 'warehouse', 'blurb': 'Warehouses, depots and workshops', 'color': '#c9a24b'},
    {'name': 'Chinatown', 'poly': [[140, 372], [330, 372], [330, 540], [140, 540]], 'h': [9, 22], 'style': 'china', 'blurb': 'Lanterns, noodle bars and neon', 'color': '#ff4b3a'},
    {'name': 'Loop Edge', 'poly': [[100, 150], [350, 150], [350, 380], [100, 380]], 'h': [28, 80], 'style': 'mid'}]
SHOPS = [{'kind': 'dealer', 'at': [240, 178], 'r': 40}, {'kind': 'dealer', 'at': [185, 335], 'r': 40}, {'kind': 'perf', 'at': [100, 345], 'r': 32},
         {'kind': 'paint', 'at': [215, 110], 'r': 40}, {'kind': 'tuning', 'at': [215, 430], 'r': 40}, {'kind': 'body', 'at': [100, 250], 'r': 32}]
STATIONS = [{'kind': 'hospital', 'at': [150, 262], 'r': 50}, {'kind': 'police', 'at': [212, 350], 'r': 44}, {'kind': 'police', 'at': [105, 410], 'r': 44}, {'kind': 'police', 'at': [250, 130], 'r': 44},
            {'kind': 'fire', 'at': [190, 395], 'r': 44}, {'kind': 'fire', 'at': [240, 235], 'r': 44}]
GAS = [[215, 120], [215, 240], [100, 300], [190, 430], [235, 470], [200, 175], [295, 330], [300, 200]]
IX = [{'cls': 'six', 'label': 'Old Town', 'pts': [[20, 290], [92, 290]]}, {'cls': 'six', 'label': 'Downtown', 'pts': [[20, 357], [92, 357]]}]
HARBOUR = {'promenade': [[350, 172], [354, 172], [354, 200], [350, 200]], 'fingers': 8}
out = {
    'rivers': [{'id': r['id'], 'half': round(r['half'] * SC, 1), 'pts': P(r['pts'])} for r in RIVERS],
    'parks': parks,
    'landmarks': [[l[0]] + [round(v * SC, 1) for v in l[1:5]] + l[5:] for l in LANDMARKS],
    'decks': [{'name': d['name'], 'color': d['color'], 'pts': P(d['pts'])} for d in DECKS],
    'stadium': {k: round(v * SC, 1) for k, v in STADIUM.items()},
    'districts': [{**d, 'poly': P(d['poly'])} for d in DISTRICTS],
    'shops': [{'kind': s['kind'], 'at': P([s['at']])[0], 'r': round(s['r'] * SC)} for s in SHOPS],
    'stations': [{'kind': s['kind'], 'at': P([s['at']])[0], 'r': round(s['r'] * SC)} for s in STATIONS],
    'gas': P(GAS),
    'harbour': {'slips': P([[x, 177] for x in range(372, 472, 14)] + [[x, 383] for x in range(396, 420, 8)])},
    'interchanges': [{'cls': i['cls'], 'label': i['label'], 'pts': P(i['pts'])} for i in IX],
    'version': 1, 'scale': SC, 'image': {'w': im.shape[1], 'h': im.shape[0]},
    'origin': [round(215 * SC, 1), round(305 * SC, 1)],
    'highway': P(HW),
    'streets': [{'cls': r['cls'], 'pts': P(r['pts'])} for r in roads],
    'lake': P(lake),
}
json.dump(out, open(os.path.join(HERE, '..', 'src', 'chicago', 'mapdata.json'), 'w'))
open(os.path.join(HERE, '..', 'src', 'chicago', 'mapdata.js'), 'w').write('// generated by tools/build_mapdata.py (same content as mapdata.json) - edit the map in the studio, or re-run the tool\nexport default ' + json.dumps(out) + ';\n')
print(len(roads), 'roads', len(lake), 'lake pts')
