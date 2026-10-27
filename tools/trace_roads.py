# Traces the road network out of the reference map image (tools/ref-map.png): colour masks -> skeleton -> graph -> simplified polylines.
# usage: python3 tools/trace_roads.py ref.png out.json    (coordinates are in reference-image pixels)
import sys, json, numpy as np, cv2
from skimage.morphology import skeletonize
src, dst = sys.argv[1], sys.argv[2]
im = cv2.imread(src); hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
H, S, V = [hsv[..., i].astype(int) for i in range(3)]
b, g, r = [im[..., i].astype(int) for i in range(3)]
tan = (g >= 138) & (r > g) & (g > b + 25) & (S > 70) & (H >= 12) & (H <= 26)
mar = ((H >= 155) | (H <= 4)) & (S > 95) & (V < 165) & (V > 38)
grn = (g > r + 8) & (g > b + 8) & (V < 150) & (S > 60)
SC = 3   # work at 3x for a smoother skeleton
def up(m): return cv2.resize(m.astype(np.uint8), None, fx=SC, fy=SC, interpolation=cv2.INTER_NEAREST)
def clean_blobs(m, k):
    o = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    return m & ~cv2.dilate(o, np.ones((3, 3), np.uint8))
def close(m, k): return cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
T = clean_blobs(close(up(tan), 5), 13); M = clean_blobs(close(up(mar), 5), 11); G = clean_blobs(close(up(grn), 5), 25)
def skel_graph(mask, minlen):
    sk = skeletonize(mask > 0).astype(np.uint8)
    h, w = sk.shape
    nb = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
    pts = set(zip(*np.nonzero(sk)))
    def nbrs(p): return [(p[0]+dy, p[1]+dx) for dy, dx in nb if (p[0]+dy, p[1]+dx) in pts]
    deg = {p: len(nbrs(p)) for p in pts}
    nodes = {p for p in pts if deg[p] != 2}
    # cluster node pixels
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
                    nx = [x for x in nbrs(cur) if x != prev and x not in nodes or (x in nodes and x != prev)]
                    if not nx: break
                    prev, cur = cur, nx[0]; path.append(cur)
                    if len(path) > 20000: break
                seen.add((path[-1], path[-2]))
                cj = lab.get(path[-1], -1)
                edges.append((ci, cj, path))
    return cen, edges
def to_poly(path, ca, cb, eps):
    pts = [ca] + [tuple(p) for p in path[1:-1]] + [cb] if ca is not None and cb is not None else [tuple(p) for p in path]
    a = np.array([[p[1], p[0]] for p in pts], np.float32).reshape(-1, 1, 2)
    ap = cv2.approxPolyDP(a, eps, False).reshape(-1, 2)
    return [[float(x) / SC, float(y) / SC] for x, y in ap]
out = {'tan': [], 'mar': [], 'grn': []}
for key, mask, minlen, eps in (('tan', T, 24, 3.2), ('mar', M, 18, 3.0), ('grn', G, 60, 4.0)):
    cen, edges = skel_graph(mask, minlen)
    for ci, cj, path in edges:
        if len(path) < minlen: continue
        if cj < 0: continue
        out[key].append({'a': ci, 'b': cj, 'pts': to_poly(path, cen[ci], cen[cj], eps)})
    out[key + '_nodes'] = [[c[1] / SC, c[0] / SC] for c in cen]
# --- the union of avenues and streets: one skeleton, so crossings are real junctions; each edge is classed by how much tan it covers
U = ((T > 0) | (M > 0)).astype(np.uint8)
U = cv2.morphologyEx(U, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
Tm = cv2.dilate((T > 0).astype(np.uint8), np.ones((5, 5), np.uint8))
cen, edges = skel_graph(U, 12)
par = list(range(len(cen)))
def find(x):
    while par[x] != x: par[x] = par[par[x]]; x = par[x]
    return x
good = [(ci, cj, path) for ci, cj, path in edges if cj >= 0 and len(path) >= 10]
for ci, cj, path in good: par[find(ci)] = find(cj)
size = {}
for ci, cj, path in good: size[find(ci)] = size.get(find(ci), 0) + len(path)
out['roads'] = []
for ci, cj, path in good:
    tanfrac = float(np.mean([Tm[y, x] for y, x in path]))
    out['roads'].append({'a': ci, 'b': cj, 'pts': to_poly(path, cen[ci], cen[cj], 3.0), 'tan': round(tanfrac, 2), 'comp': find(ci), 'compLen': size[find(ci)] / SC})
json.dump(out, open(dst, 'w'))
print({k: len(v) for k, v in out.items()})
