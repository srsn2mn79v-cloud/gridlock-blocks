# Builds src/sf/mapdata_sf.js from the San Francisco reference map (tools/sf/ref.png) and the traced roads (tools/sf/trace.py).
# usage: python3 tools/sf/trace.py && python3 tools/sf/build_map.py
import json, math, numpy as np, cv2
SC = 2.3
im = cv2.imread('tools/sf/ref.png'); H, W = im.shape[:2]
b, g, r = [im[..., i].astype(int) for i in range(3)]
P = lambda pts: [[round(x * SC, 1), round(y * SC, 1)] for x, y in pts]
E = json.load(open('/tmp/sf_roads.json'))

# ---------------- roads: traced edges, dangling ends joined to the nearest road, a few hand-drawn additions ----------------
def plen(p): return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))
def dseg(p, a, bb):
    dx, dy = bb[0] - a[0], bb[1] - a[1]; L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); q = (a[0] + dx * t, a[1] + dy * t)
    return math.dist(p, q), q
roads = [{'cls': 'four' if e['w'] >= 3.4 else 'two', 'pts': e['pts'], 'w': e['w']} for e in E if plen(e['pts']) >= 5]
# the Golden Gate Bridge and the Presidio's roads (the thin white lines the tracer misses)
GG = [[143.4, 272], [143.4, 150], [143.4, 52]]
OVAL = [[143.4, 52], [148, 40], [150, 26], [143.4, 10], [137, 26], [139, 40], [143.4, 52]]
ADD = [('four', [[143.4, 272], [141, 300], [135, 330], [132, 350], [131, 372]], 'Presidio Parkway'),
       ('two', [[143.4, 272], [128, 277], [112, 287], [104, 305], [108, 325], [122, 345], [133, 362]], 'Presidio Loop'),
       ('four', GG, 'Golden Gate Bridge'), ('two', OVAL, 'Marin Loop')]
# join dangling ends: an end within 10 px of another road is extended onto it
def ends(rd): return [(0, rd['pts'][0]), (len(rd['pts']) - 1, rd['pts'][-1])]
for ri, rd in enumerate(roads):
    for idx, pt in ends(rd):
        best = None
        for rj, o in enumerate(roads):
            if rj == ri: continue
            for k in range(len(o['pts']) - 1):
                d, q = dseg(pt, o['pts'][k], o['pts'][k + 1])
                if d < 10 and (best is None or d < best[0]): best = (d, q)
        near_own = min(math.dist(pt, p) for p in rd['pts'][(1 if idx == 0 else 0):][:0] or [(1e9, 1e9)])
        if best and best[0] > 0.6:
            if idx == 0: rd['pts'].insert(0, [round(best[1][0], 2), round(best[1][1], 2)])
            else: rd['pts'].append([round(best[1][0], 2), round(best[1][1], 2)])
out_roads = []
for rd in roads: out_roads.append({'cls': rd['cls'], 'pts': P(rd['pts'])})
for cls, pts, name in ADD: out_roads.append({'cls': cls, 'pts': P(pts), 'name': name})

# ---------------- water: tiles of the cyan mask, padded out past the image edges (the south edge stays land) ----------------
water = ((r < 140) & (g > 185) & (b > 185)).astype(np.uint8)
water[H - 12:, :] = 0                       # the dark strip along the bottom edge
water[18:88, 238:362] = 1; water[15:95, 400:485] = 1      # the legend box and the compass sit on water
island = [[316, 164], [326, 160], [345, 163], [352, 171], [340, 178], [322, 177]]     # a small island (a green deck over the water)
cv2.fillPoly(water, [np.array(island, np.int32)], 1)
water = cv2.morphologyEx(water, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
PAD = 140
big = np.zeros((H + PAD, W + 2 * PAD), np.uint8)                   # padded on top, left and right
big[PAD:, PAD:PAD + W] = water
big[:PAD, :] = 1; big[:, :PAD] = 1; big[:, PAD + W:] = 1
for yy in range(PAD, H + PAD):                                    # extend each row's edge pixel outwards
    if water[yy - PAD, 0]: big[yy, :PAD] = 1
    else: big[yy, :PAD] = 0
    if water[yy - PAD, W - 1]: big[yy, PAD + W:] = 1
    else: big[yy, PAD + W:] = 0
lakes = []
T = 56
for ty in range(0, big.shape[0], T):
    for tx in range(0, big.shape[1], T):
        tile = np.zeros((T + 2, T + 2), np.uint8); sub = big[ty:ty + T, tx:tx + T]; tile[1:1 + sub.shape[0], 1:1 + sub.shape[1]] = sub
        if tile.sum() < 6: continue
        if sub.sum() == T * T:
            xs = [tx, tx + T, tx + T, tx]; ys = [ty, ty, ty + T, ty + T]
            lakes.append([[x - PAD, y - PAD] for x, y in zip(xs, ys)]); continue
        cs, _ = cv2.findContours(tile, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        for c in cs:
            if cv2.contourArea(c) < 8: continue
            a = cv2.approxPolyDP(c, 1.2, True).reshape(-1, 2)
            if len(a) < 3: continue
            lakes.append([[float(x - 1 + tx - PAD), float(y - 1 + ty - PAD)] for x, y in a])
print('water polygons', len(lakes))

# ---------------- parks and landmarks ----------------
park = ((g > 200) & (r < 215) & (b < 170) & (g > r + 15)).astype(np.uint8); park[10:95, 235:492] = 0
lm = ((r > 180) & (g < 150) & (b > 110) & (b < 190) & (r > g + 60)).astype(np.uint8); lm[10:95, 235:492] = 0
parks = []
cs, _ = cv2.findContours(park, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
for c in cs:
    A = cv2.contourArea(c)
    if A < 14: continue
    M = cv2.moments(c); cx, cy = M['m10'] / M['m00'], M['m01'] / M['m00']
    if cy < 145 and cx < 235: continue                       # the Marin hills are bare ground, not a park
    a = cv2.approxPolyDP(c, 1.3, True).reshape(-1, 2).astype(float)
    if len(a) < 3: continue
    name = 'Golden Gate Park' if A > 1500 and cy > 400 else 'Presidio' if A > 1500 else 'Park %d' % (len(parks) + 1)
    parks.append({'name': name, 'pts': P(a.tolist())})
LM_NAMES = ['Palace of Fine Arts', 'Coit Tower', 'Transamerica Pyramid', 'Ferry Building', 'City Hall', 'Moscone Center', 'Oracle Park', 'Salesforce Tower', 'Ghirardelli Hall', 'Union Square Hotel', 'Embarcadero Plaza', 'Mission Library']
HEIGHTS = {'Salesforce Tower': 190, 'Transamerica Pyramid': 160, 'Coit Tower': 60, 'City Hall': 45, 'Moscone Center': 28, 'Oracle Park': 24, 'Ferry Building': 34}
lms = []
cs, _ = cv2.findContours(lm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
rects = []
for c in cs:
    if cv2.contourArea(c) < 18: continue
    x, y, w, h = cv2.boundingRect(c); rects.append((x, y, x + w, y + h))
rects.sort(key=lambda q: -(q[2] - q[0]) * (q[3] - q[1]))
for i, (x0, y0, x1, y1) in enumerate(rects[:12]):
    nm = LM_NAMES[i % len(LM_NAMES)]
    lms.append([nm, round(x0 * SC, 1), round(y0 * SC, 1), round(x1 * SC, 1), round(y1 * SC, 1), HEIGHTS.get(nm, 30)])

def rect(n, x0, y0, x1, y1, h, style, blurb='', color='#9aa7b8'):
    return {'name': n, 'poly': [[x0 * SC, y0 * SC], [x1 * SC, y0 * SC], [x1 * SC, y1 * SC], [x0 * SC, y1 * SC]], 'h': h, 'style': style, 'blurb': blurb, 'color': color}
districts = [
    rect('Marin', 0, 0, 492, 250, [6, 12], 'low', 'Headlands and quiet streets across the bridge', '#7ccf6a'),
    rect('Presidio', 80, 250, 180, 372, [6, 14], 'low', 'Old army post and woodland', '#4caf50'),
    rect('Marina', 150, 270, 232, 345, [8, 16], 'low', 'Pastel houses by the bay', '#ffb3c1'),
    rect('North Beach', 232, 270, 340, 345, [10, 26], 'china', 'Little Italy, cafes and lanterns', '#ff8a5b'),
    rect('Embarcadero', 270, 345, 345, 410, [50, 170], 'tower', 'Waterfront towers', '#5aa9ff'),
    rect('Downtown', 205, 345, 280, 420, [45, 150], 'tower', 'Financial district', '#7aa2ff'),
    rect('Richmond', 70, 372, 150, 470, [7, 14], 'low', 'Long quiet avenues', '#a3d9a5'),
    rect('Haight', 150, 372, 215, 470, [8, 18], 'low', 'Painted ladies and record shops', '#d28bff'),
    rect('Civic Center', 215, 420, 300, 500, [14, 48], 'mid', 'City Hall and the plaza', '#f4c542'),
    rect('SoMa', 232, 430, 440, 610, [10, 40], 'warehouse', 'Warehouses, lofts and the ballpark', '#c9a24b'),
    rect('Sunset', 40, 470, 215, 660, [6, 12], 'low', 'Fog belt streets', '#9fc5e8'),
    rect('Bayview', 215, 500, 440, 665, [6, 14], 'low', 'Industrial south', '#b0b0b0'),
]
# shops, services and fuel on side streets (the game finds an alley near each spot)
def at(x, y, r=90): return {'at': [round(x * SC, 1), round(y * SC, 1)], 'r': r}
shops = [dict(kind='dealer', **at(225, 385)), dict(kind='dealer', **at(300, 500)), dict(kind='perf', **at(140, 430, 70)), dict(kind='paint', **at(185, 320)), dict(kind='tuning', **at(330, 560)), dict(kind='body', **at(110, 405, 70))]
stations = [dict(kind='hospital', **at(200, 455, 115)), dict(kind='police', **at(255, 395, 100)), dict(kind='police', **at(150, 440, 100)), dict(kind='police', **at(330, 530, 100)), dict(kind='fire', **at(235, 345, 100)), dict(kind='fire', **at(190, 490, 100))]
gas = [[x * SC, y * SC] for x, y in [(240, 330), (200, 420), (140, 380), (170, 500), (300, 470), (360, 560), (260, 440), (120, 450)]]
gas = [[round(x, 1), round(y, 1)] for x, y in gas]
data = {
    'version': 1, 'scale': SC, 'image': {'w': W, 'h': H}, 'origin': [round(210 * SC, 1), round(440 * SC, 1)],
    'city': 'sf', 'lake': P(lakes[0]), 'lakes': [P(l) for l in lakes], 'rivers': [], 'highway': [], 'interchanges': [],
    'streets': out_roads, 'parks': parks, 'landmarks': lms, 'decks': [{'name': 'Alcatraz', 'color': 0x6f8f5a, 'pts': P(island)}],
    'stadium': {'cx': 330 * SC, 'cy': 575 * SC, 'rx': 6, 'ry': 6}, 'districts': districts, 'shops': shops, 'stations': stations, 'gas': gas, 'harbour': {'slips': []},
}
open('src/sf/mapdata_sf.js', 'w').write('// San Francisco, traced from tools/sf/ref.png by tools/sf/build_map.py (map px = reference px x 2.3).\nexport default ' + json.dumps(data) + ';\n')
print('roads', len(out_roads), 'parks', len(parks), 'landmarks', len(lms))
