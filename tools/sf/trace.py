# Traces the San Francisco reference map (tools/sf/ref.png): white roads -> skeleton -> graph -> polylines with a width estimate.
# usage: python3 tools/sf/trace.py   -> /tmp/sf_roads.json (reference-image pixels)
import json, sys, numpy as np, cv2
from skimage.morphology import skeletonize
im = cv2.imread('tools/sf/ref.png'); b, g, r = [im[..., i].astype(int) for i in range(3)]
p = np.clip((np.minimum(g, b).astype(float) - 214) / (238 - 214), 0, 1) * (r > 200)
road = p.astype(np.float32)
road[10:95, 235:492] = 0                        # the legend box and the compass
SC = 4
up = cv2.resize(road, None, fx=SC, fy=SC, interpolation=cv2.INTER_CUBIC)
up = (up > 0.45).astype(np.uint8)
up = cv2.morphologyEx(up, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
up = cv2.morphologyEx(up, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
dt = cv2.distanceTransform(up, cv2.DIST_L2, 5)
sk = skeletonize(up > 0).astype(np.uint8)
pts = set(zip(*np.nonzero(sk)))
nb = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
def nbrs(p): return [(p[0]+dy, p[1]+dx) for dy, dx in nb if (p[0]+dy, p[1]+dx) in pts]
deg = {p: len(nbrs(p)) for p in pts}
nodes = {p for p in pts if deg[p] != 2}
lab = {}; clusters = []
for p in nodes:
    if p in lab: continue
    st = [p]; lab[p] = len(clusters); c = [p]
    while st:
        q = st.pop()
        for n in nbrs(q):
            if n in nodes and n not in lab: lab[n] = len(clusters); st.append(n); c.append(n)
    clusters.append(c)
cen = [tuple(np.mean(c, axis=0)) for c in clusters]
seen = set(); edges = []
for ci, c in enumerate(clusters):
    for p in c:
        for n in nbrs(p):
            if n in nodes or (p, n) in seen: continue
            path = [p, n]; seen.add((p, n)); prev, cur = p, n
            while cur not in nodes:
                nx = [x for x in nbrs(cur) if x != prev]
                if not nx: break
                prev, cur = cur, nx[0]; path.append(cur)
                if len(path) > 40000: break
            seen.add((path[-1], path[-2]))
            edges.append((ci, lab.get(path[-1], -1), path))
out = []
for ci, cj, path in edges:
    if len(path) < 14: continue
    pl = [cen[ci]] + [tuple(p) for p in path[1:-1]] + ([cen[cj]] if cj >= 0 else [path[-1]])
    a = np.array([[p[1], p[0]] for p in pl], np.float32).reshape(-1, 1, 2)
    ap = cv2.approxPolyDP(a, 2.6, False).reshape(-1, 2)
    w = float(np.mean([dt[int(p[0]), int(p[1])] for p in path[::3]])) * 2 / SC
    out.append({'pts': [[round(float(x) / SC, 2), round(float(y) / SC, 2)] for x, y in ap], 'w': round(w, 2), 'closed': cj >= 0})
json.dump(out, open('/tmp/sf_roads.json', 'w'))
ws = sorted(e['w'] for e in out); print(len(out), 'edges; width percentiles', [ws[int(len(ws) * q)] for q in (0.1, 0.25, 0.5, 0.75, 0.9, 0.97)])
