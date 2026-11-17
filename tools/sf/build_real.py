# San Francisco, laid out from the real city (the two map screenshots the player supplied: major roads + terrain) instead of the old stylised map.
# Everything here is written in "screenshot px" (sx, sy: the 487 x 482 Google Maps screenshot, north up) and scaled by K into map px.
# The Golden Gate strait is drawn wider than life so the bridge is a proper drive, and the land carries on south of the screenshot to SFO.
#   usage: python3 tools/sf/build_real.py        -> src/sf/mapdata_sf.js
# Layout method: the arterials are drawn by hand; the districts between them are zones that get a street grid, each grid line clipped to
# its zone and pushed a little past the zone edge so it properly crosses the arterial there (the network builder prunes the tiny stubs).
import json, math, os

K = 2.6
HERE = os.path.dirname(os.path.abspath(__file__))
P = lambda pts: [[round(x * K, 1), round(y * K, 1)] for x, y in pts]

# ---------------------------------------------------------------- water: one outline round the peninsula (ocean, the strait, the bay)
MARIN_COAST = [(26, -150), (45, -112), (80, -97), (112, -90), (140, -88), (165, -100), (190, -114), (215, -110), (232, -128)]
EAST_COAST = [(482, 700), (478, 572), (462, 545), (440, 520), (440, 470), (432, 440), (445, 415), (462, 385), (466, 360), (448, 340), (426, 333), (414, 305), (415, 275),
              (417, 250), (414, 222), (403, 204), (396, 176), (393, 166), (387, 156), (373, 134), (356, 109), (331, 95), (300, 98), (280, 106), (255, 114), (215, 118), (192, 121), (162, 116), (150, 108)]
NORTH_WEST = [(125, 134), (100, 156), (75, 168), (50, 174), (43, 190), (43, 300), (41, 400), (40, 520), (40, 700)]
WATER = [(-80, 700), (-80, -300), (20, -300)] + MARIN_COAST + [(240, -300), (570, -300), (570, 700)] + EAST_COAST + NORTH_WEST
LAKE_MERCED = [(66, 408), (98, 402), (110, 425), (100, 448), (74, 446)]

def pip(x, y, poly):
    o = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: o = not o
    return o

# ---------------------------------------------------------------- streets
streets = []
def road(cls, pts, name=None):
    s = {'cls': cls, 'pts': P(pts)}
    if name: s['name'] = name
    streets.append(s)

# Market Street and its frame: M(t) runs from the Ferry Building south-west
MD = (-0.697, 0.717); MP = (0.717, 0.697); M0 = (388, 168)
M = lambda t, o=0: (M0[0] + MD[0] * t + MP[0] * o, M0[1] + MD[1] * t + MP[1] * o)
MKT_END = M(98)                                             # Market / Van Ness

GG_PLAZA = (152, 152)
# NOTE on spacing: the road rules want junctions at least 80 u (12.3 screenshot px) apart, and ordinary streets may not cross the freeway
# (only an interchange street bridges it), so every line below is placed with that in mind.
road('four', [GG_PLAZA, (149, 60), (141, -95), (141, -150)], 'Golden Gate Bridge')
road('two', [(141, -150), (147, -166), (149, -184), (141, -204), (133, -184), (135, -166), (141, -150)], 'Marin Loop')
road('four', [GG_PLAZA, (170, 140), (195, 131), (215, 130)], 'Presidio Parkway')
road('four', [(215, 130), (351.3, 130)], 'Lombard Street')
road('four', [GG_PLAZA, (156, 162), (161, 176), (162, 190), (158, 228), (156, 252), (156, 352), (156, 385), (160, 420), (172, 455), (182, 500)], 'Park Presidio')
road('four', [(50, 190), (50, 400), (62, 440), (88, 472), (100, 500)], 'Great Highway')
road('four', [(100, 500), (182, 500), (245, 500), (320, 500), (372, 500)], 'Geneva Avenue')
road('four', [(50, 205), (215, 205), (305, 201), (331.8, 199.8)], 'Geary Boulevard')
road('four', [(50, 228), (306.3, 228)], 'Fulton Street')
road('four', [(50, 252), (212, 252), (226, 248), (243, 244.5), (278, 244.5)], 'Lincoln Way')
road('two', [(50, 190), (215, 188), (240, 179), (305, 176), (351.3, 174)], 'California Street')
road('two', [(215, 152), (370.3, 152)], 'Broadway')
road('four', [(95, 252), (95, 385)], 'Sunset Boulevard')
road('four', [(50, 385), (156, 385)], 'Sloat Boulevard')
road('two', [(196, 252), (196, 345)], 'Seventh Avenue')
road('two', [(156, 352), (50, 352)], 'Vicente Street')
road('two', [(215, 130), (215, 253.5)], 'Lyon Street')
road('four', [(305, 101), (305, 250.5)], 'Van Ness Avenue')
road('four', [M(-3), MKT_END, (265, 278), (240, 300), (215, 330), (196, 345), (175, 352), (156, 352)], 'Market Street')
road('four', [(255, 130), (255, 244.5), (261, 262), (265, 278), (268, 300), (268, 331.3)], 'Divisadero Street')
road('two', [(278, 130), (278, 244.5)], 'Fillmore Street')
road('two', [(232, 130), (232, 248.5)], 'Presidio Avenue')
EMB = [(215, 130), (235, 122), (255, 120), (280, 112), (300, 104), (330, 101), (352, 114), (368, 138), (382, 160), (390, 176), (396, 200), (399, 226), (402, 250), (404, 268)]
THIRD = [(404, 268), (404, 300), (410, 330), (420, 360), (421.6, 392), (420.5, 430)]
road('four', EMB, 'The Embarcadero')
road('four', THIRD, 'Third Street')
MISSION_S = [M(112, 16), (321, 268), (320, 300), (319, 330), (318, 345), (305, 380), (291, 405), (262, 455), (245, 500)]
road('two', [(277, 268), (404, 268)], '16th Street')
road('two', [(268, 300), (349.3, 300)], '24th Street')
road('four', [(348, 268), (348, 330)], 'Potrero Avenue')
road('four', [(319, 330), (348, 330)], 'Cesar Chavez Street')
road('two', [(215, 330), (319, 330)], 'Clipper Street')
road('two', [(389.5, 268), (389.5, 330), (410, 330)], 'Pennsylvania Avenue')
road('two', [(50, 330), (197.3, 330)], 'Taraval Street')
road('two', [(294, 268), (294, 360)], 'Dolores Street')
road('two', [(240, 300), (240, 414.5)], "O'Shaughnessy Boulevard")
road('two', [(240, 360), (294, 360)], '30th Street')
road('two', [(169, 450), (200, 450), (266.5, 450)], 'Ocean Avenue')
road('two', [(215, 450), (215, 500)], 'Junipero Serra Boulevard')
road('two', [(320, 405), (320, 500)], 'San Jose Avenue')
road('four', [(291, 405), (320, 405), (372, 405)], 'Silver Avenue')
road('two', [(372, 405), (372, 500)], 'Bayshore Boulevard')
road('two', [(256, 465), (373.3, 468)], 'Geneva Cutoff')
road('two', [(345, 466), (345, 501.3)], 'Mansell Street')
road('two', [(420, 360), (445, 356), (458, 375), (446, 418), (420.5, 430)], 'Hunters Point Loop')

# ---- US 101: the city's freeway, from 16th Street down the east side and on to the airport. Interstate 280 crosses it at the Alemany
# interchange and runs out south-west; (a second interchange does not fit: slip roads need a long clear run).
HIGHWAY = [(376, 268), (373, 285), (370, 305), (369, 330), (373, 345), (385, 372), (397, 405), (402, 440), (404, 470), (406, 500), (410, 545), (420, 580), (426, 600)]
def diamond(label, cx, cy, hdx, hdy, west_hook, cls='four', j=17, r=27):
    # (cx, cy) on the freeway, (hdx, hdy) its direction there (southbound); the street crosses east-west; the city centre is to the west
    outer, inner = (cx + j, cy), (cx - j, cy)
    up, dn = (cx - hdx * r, cy - hdy * r), (cx + hdx * r, cy + hdy * r)
    mid = lambda a, b: ((a[0] + b[0]) / 2 + (b[0] - cx) * 0.25, (a[1] + b[1]) / 2)
    ramps = [[up, mid(up, outer), outer], [dn, mid(dn, outer), outer], [up, mid(up, inner), inner], [dn, mid(dn, inner), inner]]
    return {'cls': cls, 'label': label, 'pts': P([outer, inner, west_hook]), 'ramps': [P(q) for q in ramps], 'template': 'diamond'}
IXS = [diamond('Alemany', 392.3, 392, 0.34, 0.94, (352, 388), cls='six', r=24)]
road('six', [(352, 388), (300, 392), (262, 402), (228, 420), (200, 450), (186, 480), (182, 500)], 'Interstate 280')
road('four', [(409.3, 392), (421.6, 392)], 'Evans Avenue')

# ---- SFO: new land south of the county line; the freeway ends at the terminal loop
RWY = [(462, 585), (462, 690)]
road('four', [(426, 600), (433.5, 600), (433.5, 680), (419, 680), (419, 600), (426, 600)], 'Terminal Loop')

# ---------------------------------------------------------------- parks (no buildings; the grid skips them)
PARKS = [
    ('Golden Gate Park', [(51, 229.5), (211, 229.5), (211, 250.5), (51, 250.5)]),
    ('The Presidio', [(112, 150), (126, 136), (150, 112), (192, 123), (213, 121), (213, 186), (120, 188), (104, 166)]),
    ('Lincoln Park', [(52, 178), (98, 160), (102, 186), (52, 188)]),
    ('Twin Peaks', [(244, 282), (264, 284), (265, 298), (246, 298)]),
    ('Mount Davidson', [(214, 340), (236, 338), (238, 358), (216, 360)]),
    ('McLaren Park', [(326, 418), (364, 418), (364, 452), (326, 452)]),
    ('Alamo Square', [(259, 211), (274, 211), (274, 224), (259, 224)]),
    ('Lake Merced Park', [(58, 398), (110, 394), (122, 428), (106, 458), (66, 456)]),
    ('Marin Headlands', [(22, -298), (238, -298), (232, -128), (215, -110), (190, -114), (165, -100), (140, -88), (112, -90), (80, -97), (45, -112), (26, -150)]),
    ('Bayfront Park', [(440, 505), (470, 560), (455, 572), (438, 540)]),
]

# ---------------------------------------------------------------- zone grids
def clip(a, b, poly, holes=()):
    # the pieces of segment a-b inside poly (and outside the holes)
    ts = [0.0, 1.0]
    for pl in (poly,) + tuple(holes):
        for i in range(len(pl)):
            c, d = pl[i], pl[i - 1]
            den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0])
            if abs(den) < 1e-9: continue
            t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den
            u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den
            if 0 < t < 1 and 0 <= u <= 1: ts.append(t)
    ts.sort(); out = []
    for t0, t1 in zip(ts, ts[1:]):
        if t1 - t0 < 1e-6: continue
        m = (t0 + t1) / 2; x, y = a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m
        if pip(x, y, poly) and not any(pip(x, y, h) for h in holes) and not pip(x, y, WATER):
            out.append(((a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0), (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)))
    return out
HOLES = tuple(p for _, p in PARKS) + (LAKE_MERCED,)
def line(a, b, zone, cls='two', name=None, ext=1.3, min_len=9):
    for p, q in clip(a, b, zone, HOLES):
        L = math.dist(p, q)
        if L < min_len: continue
        ux, uy = (q[0] - p[0]) / L, (q[1] - p[1]) / L
        road(cls, [(p[0] - ux * ext, p[1] - uy * ext), (q[0] + ux * ext, q[1] + uy * ext)], name)
def grid(zone, xs=(), ys=(), cls='two'):
    x0 = min(p[0] for p in zone) - 5; x1 = max(p[0] for p in zone) + 5; y0 = min(p[1] for p in zone) - 5; y1 = max(p[1] for p in zone) + 5
    for x in xs: line((x, y0), (x, y1), zone, cls)
    for y in ys: line((x0, y), (x1, y), zone, cls)

# Richmond: the avenues between the park and California Street
grid([(50, 186), (215, 186), (215, 228), (50, 228)], xs=(70, 92, 114, 136, 184, 200))
# Sunset: the long avenue grid south of the park
grid([(50, 252), (196, 252), (196, 330), (156, 330), (156, 385), (50, 385)], xs=(72, 115, 135, 176), ys=(270, 290, 310))
grid([(50, 352), (156, 352), (156, 385), (50, 385)], ys=(368.5,))
# Downtown, Chinatown, North Beach: north of Market, east of Van Ness (the E-W streets are the arterials)
DT = [(305, 101)] + [p for p in EMB if 300 <= p[0] <= 392 and p[1] <= 178] + [M(0), MKT_END, (305, 249), (305, 201)]
grid(DT, xs=(330.5, 350, 369))
# SoMa: the grid turned 45 degrees, parallel to Market. Mission Street is the first parallel and bends south at the Mission.
SOMA = [M(0), (390, 176), (396, 200), (399, 226), (402, 250), (404, 268), (321, 268), M(112, 16), M(112, 0)]
ms = clip(M(-20, 16), M(112, 16), SOMA, HOLES)[0]
road('four', [(ms[0][0] + 0.9, ms[0][1] - 0.93), M(60, 16)] + MISSION_S, 'Mission Street')
line(M(-20, 32), M(130, 32), SOMA, 'four'); line(M(-20, 52), M(130, 52), SOMA)
road('two', [M(41, -1.3), M(41, 33.3)]); road('two', [M(68.5, -1.3), M(68.5, 53.3)])
# the Mission flat between Mission Street and Potrero Avenue
grid([(321, 268), (348, 268), (348, 330), (319, 330), (320, 300)], ys=(284, 315))

# ---------------------------------------------------------------- districts, landmarks, services
D = lambda name, x0, y0, x1, y1, h, style, blurb, color: {'name': name, 'poly': P([(x0, y0), (x1, y0), (x1, y1), (x0, y1)]), 'h': h, 'style': style, 'blurb': blurb, 'color': color}
DISTRICTS = [
    D('Financial District', 345, 150, 400, 200, [50, 190], 'tower', 'Glass towers above the Bay', '#5aa9ff'),
    D('Chinatown', 325, 150, 345, 200, [10, 26], 'china', 'Lanterns, markets and steep little streets', '#ff8a5b'),
    D('North Beach', 305, 90, 400, 150, [10, 24], 'china', 'Little Italy, cafes and Coit Tower', '#ffb38a'),
    D('Union Square', 305, 200, 345, 240, [30, 90], 'tower', 'Shops, hotels and cable cars', '#7aa2ff'),
    D('Nob Hill', 305, 150, 325, 200, [18, 60], 'mid', 'Grand hotels at the top of the hill', '#c7b8ff'),
    D('Marina', 215, 100, 305, 152, [8, 16], 'low', 'Pastel houses by the bay', '#ffb3c1'),
    D('Pacific Heights', 215, 152, 305, 205, [10, 22], 'low', 'Mansions with a view', '#e6c8ff'),
    D('Western Addition', 215, 205, 305, 252, [9, 20], 'low', 'Painted ladies and jazz clubs', '#d28bff'),
    D('Civic Center', 305, 201, 330, 240, [14, 48], 'mid', 'City Hall and the opera', '#f4c542'),
    D('SoMa', 322, 180, 410, 268, [12, 70], 'warehouse', 'Warehouses, lofts and the ballpark', '#c9a24b'),
    D('The Mission', 290, 262, 346, 345, [9, 20], 'low', 'Murals, taquerias and palm trees', '#ff9d5c'),
    D('Potrero Hill', 346, 268, 415, 345, [8, 20], 'warehouse', 'Sunny hill above the docks', '#d9b26a'),
    D('Castro & Noe Valley', 215, 252, 290, 345, [8, 16], 'low', 'Victorians under Twin Peaks', '#b8e0a8'),
    D('Presidio', 100, 100, 215, 190, [6, 14], 'low', 'Old army post and woodland', '#4caf50'),
    D('Richmond', 40, 174, 215, 229, [7, 14], 'low', 'Long quiet avenues to the ocean', '#a3d9a5'),
    D('Golden Gate Park', 40, 229, 215, 252, [6, 12], 'low', 'Three miles of meadows and museums', '#58b368'),
    D('Sunset', 40, 252, 215, 400, [7, 13], 'low', 'Fog, surf and endless avenues', '#9fd3c7'),
    D('Lake Merced', 40, 400, 182, 520, [7, 16], 'low', 'The lake, the zoo and the university', '#8fc9b0'),
    D('Excelsior', 182, 345, 346, 520, [7, 15], 'low', 'Rows of houses over the hills', '#c5d86d'),
    D('Bayview', 346, 345, 480, 520, [8, 22], 'warehouse', 'Shipyards and the old ballpark point', '#b9a58a'),
    D('SFO', 400, 520, 500, 720, [8, 26], 'warehouse', 'San Francisco International', '#9aa7b5'),
    D('Marin', 0, -320, 260, -80, [6, 12], 'low', 'Headlands across the bridge', '#7ccf6a'),
]
B = lambda name, cx, cy, w, d, h: [name, round((cx - w / 2) * K, 1), round((cy - d / 2) * K, 1), round((cx + w / 2) * K, 1), round((cy + d / 2) * K, 1), h, 1]
LANDMARKS = [
    B('Transamerica Pyramid', 358, 160, 6, 6, 210), B('Salesforce Tower', 377, 186, 7, 7, 260), B('Coit Tower', 354, 124, 3.5, 3.5, 55),
    B('City Hall', 314, 221, 9, 7, 36), B('Ferry Building', 386, 160.5, 3, 9, 30), B('555 California', 352, 177, 7, 5, 180),
    B('Palace of Fine Arts', 222, 126, 5, 2.2, 18), B('Sutro Tower', 228, 286, 3, 3, 150),
]
SPOT = lambda kind, x, y, r=90: {'kind': kind, 'at': [round(x * K, 1), round(y * K, 1)], 'r': r}
md = {
    'version': 2, 'scale': 2.3, 'image': {'w': 487, 'h': 482}, 'origin': [round(305 * K, 1), round(232 * K, 1)], 'city': 'sf',
    'lake': P(WATER), 'lakes': [P(WATER), P(LAKE_MERCED)], 'rivers': [], 'highway': P(HIGHWAY), 'interchanges': IXS, 'streets': streets,
    'parks': [{'name': n, 'pts': P(p)} for n, p in PARKS], 'landmarks': LANDMARKS,
    'decks': [{'name': 'Alcatraz', 'color': 7311194, 'pts': P([(318, 26), (328, 22), (342, 26), (346, 34), (336, 40), (322, 38)])}],
    'structs': [{'line': 'Golden Gate Bridge', 'from': 300, 'to': -330, 'h': 16}],
    'airport': {'name': 'SFO', 'dest': 'chicago', 'at': [round(433.5 * K, 1), round(640 * K, 1)], 'rwy': P(RWY), 'width': 30, 'y': 0.17, 'apronSide': 1, 'num0': '19', 'num1': '01'},
    'metro': [
        {'name': 'Muni Market Line', 'color': 10181046, 'stations': [{'name': n, 'at': [round(x * K, 1), round(y * K, 1)]} for n, x, y in
            [('Embarcadero', 384, 172), ('Montgomery', 367, 190), ('Powell', 351, 206), ('Civic Center', 333, 225), ('Van Ness', 319, 238), ('Church', 290, 259), ('Castro', 267, 277)]]},
        {'name': 'Muni T Third', 'color': 12819411, 'stations': [{'name': n, 'at': [round(x * K, 1), round(y * K, 1)]} for n, x, y in
            [('Chinatown', 345, 165), ('Union Square', 345, 194), ('4th & King', 399, 238), ('Dogpatch', 404, 290), ('Bayview', 420, 362), ('Sunnydale', 424, 470)]]}],
    'stadium': {'cx': round(409.5 * K, 1), 'cy': round(238 * K, 1), 'rx': 6, 'ry': 6},
    'districts': DISTRICTS,
    'shops': [SPOT('dealer', 300, 150), SPOT('dealer', 340, 290), SPOT('perf', 120, 300, 70), SPOT('paint', 240, 140), SPOT('tuning', 395, 310), SPOT('body', 110, 210, 70)],
    'stations': [SPOT('hospital', 350, 300, 115), SPOT('police', 335, 180, 100), SPOT('police', 130, 270, 100), SPOT('police', 300, 420, 100), SPOT('fire', 290, 190, 100), SPOT('fire', 380, 430, 100)],
    'gas': [[round(x * K, 1), round(y * K, 1)] for x, y in [(290, 132), (160, 208), (100, 254), (150, 384), (300, 242), (345, 332), (410, 400), (250, 498)]],
    'harbour': {'slips': []},
}
out = os.path.join(HERE, '..', '..', 'src', 'sf', 'mapdata_sf.js')
open(out, 'w').write('// San Francisco, laid out from the real city by tools/sf/build_real.py (map px = Google-Maps screenshot px x 2.6).\nexport default ' + json.dumps(md) + ';\n')
print('streets', len(streets), 'written', os.path.normpath(out))
