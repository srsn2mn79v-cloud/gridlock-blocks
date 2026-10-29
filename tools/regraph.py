#!/usr/bin/env python3
"""Re-draws the non-highway street layer so it follows the city rules (all in map px; 1 px = 2.5 u = 3.125 m):
  1. planar: roads that cross or touch are split into a real graph (every crossing is a junction);
  2. every road between two meeting points is a straight line; only bends of the map survive as corner points;
  3. meeting points (junctions and corners) are at least 100 m (32 px) apart: closer ones are united into one point;
  4. no dead ends (cul-de-sacs): a free end is joined by a straight line to the nearest road, or the dangling piece is removed;
  5. road classes: 'two' = residential, 'four' = main arterial, 'six' = express road (a higher class wins where roads overlap).
Run:  RIVERS_JSON=<splined rivers> python3 tools/regraph.py [--min 32] [--connect 55]
Piers/causeways (tag 'pier') are left as they are."""
import json, math, os, sys, collections
import numpy as np, cv2
P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'chicago')
MIN_D = float(sys.argv[sys.argv.index('--min') + 1]) if '--min' in sys.argv else 32.0
CONNECT = float(sys.argv[sys.argv.index('--connect') + 1]) if '--connect' in sys.argv else 55.0
md = json.load(open(os.path.join(P, 'mapdata.json')))
RIV = json.load(open(os.environ['RIVERS_JSON'])) if os.environ.get('RIVERS_JSON') else md['rivers']
RANK = {'two': 1, 'four': 2, 'six': 3}; NAME = {1: 'two', 2: 'four', 3: 'six'}
lake = np.array(md['lake'], np.float32).reshape(-1, 1, 2)
decks = [np.array(d['pts'], np.float32).reshape(-1, 1, 2) for d in md['decks']]

def dseg(p, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]; L = dx*dx+dy*dy; t = 0 if not L else max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L))
    q = (a[0]+dx*t, a[1]+dy*t); return math.dist(p, q), q, t
def river_sd(p):
    best = 1e9
    for r in RIV:
        pl = r['pts']; d = min(dseg(p, pl[i], pl[i+1])[0] for i in range(len(pl)-1)); best = min(best, d - r['half'])
    return best
def on_deck(p): return any(cv2.pointPolygonTest(d, (float(p[0]), float(p[1])), False) >= 0 for d in decks)
def lake_wet(p): return cv2.pointPolygonTest(lake, (float(p[0]), float(p[1])), False) > 0 and not on_deck(p)
def wet(p): return (river_sd(p) < 0.5 or cv2.pointPolygonTest(lake, (float(p[0]), float(p[1])), False) > 0) and not on_deck(p)
def seg_wet_frac(a, b):
    n = max(2, int(math.dist(a, b) / 3)); return sum(wet((a[0]+(b[0]-a[0])*k/n, a[1]+(b[1]-a[1])*k/n)) for k in range(n+1)) / (n+1)
def inter(a, b, c, d):
    r = (b[0]-a[0], b[1]-a[1]); s = (d[0]-c[0], d[1]-c[1]); den = r[0]*s[1]-r[1]*s[0]
    if abs(den) < 1e-9: return None
    t = ((c[0]-a[0])*s[1]-(c[1]-a[1])*s[0]) / den; u = ((c[0]-a[0])*r[1]-(c[1]-a[1])*r[0]) / den
    return (t, u) if 0 < t < 1 and 0 < u < 1 else None

class G:
    def __init__(s): s.pos = {}; s.edges = {}; s.n = 0          # edges: frozenset({a,b}) -> rank
    def node(s, p, tol=1.0):
        for k, q in s.pos.items():
            if abs(q[0]-p[0]) < tol and abs(q[1]-p[1]) < tol: return k
        s.pos[s.n] = (float(p[0]), float(p[1])); s.n += 1; return s.n - 1
    def add(s, a, b, r):
        if a == b: return
        k = frozenset((a, b)); s.edges[k] = max(r, s.edges.get(k, 0))
    def adj(s):
        A = collections.defaultdict(set)
        for k in s.edges: a, b = tuple(k); A[a].add(b); A[b].add(a)
        return A

def planarize(g):
    """split every edge at crossings and at nodes lying on it"""
    changed = True; rounds = 0
    while changed and rounds < 6:
        changed = False; rounds += 1
        items = list(g.edges.items()); cuts = collections.defaultdict(list)
        pts = {k: g.pos[k] for k in g.pos}
        for i in range(len(items)):
            (ka, ra) = items[i]; a, b = tuple(ka); A, B = pts[a], pts[b]
            for j in range(i+1, len(items)):
                (kc, rc) = items[j]; c, d = tuple(kc)
                if {a, b} & {c, d}: continue
                C, D = pts[c], pts[d]
                if max(A[0], B[0]) < min(C[0], D[0]) - 1.5 or max(C[0], D[0]) < min(A[0], B[0]) - 1.5 or max(A[1], B[1]) < min(C[1], D[1]) - 1.5 or max(C[1], D[1]) < min(A[1], B[1]) - 1.5: continue
                r = inter(A, B, C, D)
                if r: x = (A[0]+(B[0]-A[0])*r[0], A[1]+(B[1]-A[1])*r[0]); cuts[ka].append(x); cuts[kc].append(x)
            # a node lying on this edge (T junctions)
        for k, r in items:
            a, b = tuple(k)
            for m, p in pts.items():
                if m in (a, b): continue
                d, q, t = dseg(p, pts[a], pts[b])
                if d < 1.6 and 0.01 < t < 0.99: cuts[k].append(p)
        if not cuts: break
        for k, xs in cuts.items():
            a, b = tuple(k); r = g.edges.pop(k); A = g.pos[a]
            xs = sorted(xs, key=lambda x: math.dist(A, x)); chain = [a]
            for x in xs:
                m = g.node(x, 0.8)
                if m != chain[-1]: chain.append(m)
            if chain[-1] != b: chain.append(b)
            for u, v in zip(chain, chain[1:]): g.add(u, v, r)
            changed = True
    return g

def turn(g, A, n):
    nb = list(A[n])
    if len(nb) != 2: return 180
    p = g.pos[n]; u = (g.pos[nb[0]][0]-p[0], g.pos[nb[0]][1]-p[1]); v = (g.pos[nb[1]][0]-p[0], g.pos[nb[1]][1]-p[1])
    c = (u[0]*v[0]+u[1]*v[1]) / ((math.hypot(*u)*math.hypot(*v)) or 1)
    return math.degrees(math.acos(max(-1, min(1, c))))        # 180 = straight on

def meeting(g, A):
    return {n for n in A if len(A[n]) >= 3 or (len(A[n]) == 2 and turn(g, A, n) < 155)}

def unite(g):
    """meeting points closer than MIN_D become one point (the closest pairs first)"""
    merged = 0
    while True:
        A = g.adj(); M = sorted(meeting(g, A))
        best = None
        for i, a in enumerate(M):
            for b in M[i+1:]:
                d = math.dist(g.pos[a], g.pos[b])
                if d < MIN_D and (not best or d < best[0]):
                    if seg_wet_frac(g.pos[a], g.pos[b]) > 0.3: continue      # never collapse a river crossing
                    best = (d, a, b)
        if not best: break
        _, a, b = best
        wa, wb = len(A[a]), len(A[b]); pa, pb = g.pos[a], g.pos[b]
        g.pos[a] = ((pa[0]*wa+pb[0]*wb)/(wa+wb), (pa[1]*wa+pb[1]*wb)/(wa+wb))
        for k in list(g.edges):
            if b in k:
                r = g.edges.pop(k); o = [x for x in k if x != b][0]
                if o != a: g.add(a, o, r)
        del g.pos[b]; merged += 1
    return merged

def clear_path(g, p, q, ignore):
    for k in g.edges:
        a, b = tuple(k)
        if a in ignore or b in ignore: continue
        if inter(p, q, g.pos[a], g.pos[b]): return False
    return True

def deadends(g, protected):
    """join free ends by a straight line to the nearest road; remove what cannot be joined"""
    joined = removed = 0
    for rounds in range(40):
        A = g.adj(); ends = [n for n in A if len(A[n]) == 1 and n not in protected]
        if not ends: break
        acted = False
        for n in ends:
            if n not in g.pos or len(g.adj()[n]) != 1: continue
            p = g.pos[n]; nbr = list(g.adj()[n])[0]
            # the dangling run back to the previous junction (the junction itself stays)
            path = [n]; prev = None; cur = n
            while True:
                nb2 = [x for x in g.adj()[cur] if x != prev]
                if not nb2: break
                nxt = nb2[0]
                if len(g.adj()[nxt]) >= 3: break
                prev, cur = cur, nxt; path.append(cur)
                if len(g.adj()[cur]) == 1: break
            run = set(path)
            cands = []
            for k in g.edges:
                a, b = tuple(k)
                if a in run or b in run: continue
                d, q, t = dseg(p, g.pos[a], g.pos[b])
                if d < CONNECT: cands.append((d, q, a, b, t))
            cands.sort(key=lambda c: c[0]); done = False
            for d, q, a, b, t in cands[:6]:
                if any(lake_wet((p[0]+(q[0]-p[0])*k/12, p[1]+(q[1]-p[1])*k/12)) for k in range(13)): continue          # never through the lake
                wf = seg_wet_frac(p, q)
                if wf > 0.7 or (wf > 0 and (wet(q) or wet(p) or d < 20)): continue          # across a river is fine (a bridge), but not into it
                # not a sharp angle against its own road
                u = (g.pos[nbr][0]-p[0], g.pos[nbr][1]-p[1]); v = (q[0]-p[0], q[1]-p[1])
                c = (u[0]*v[0]+u[1]*v[1]) / ((math.hypot(*u)*math.hypot(*v)) or 1)
                if c > -0.2 and d > 3: continue                    # must carry on roughly forward (a straight continuation), not fold back
                if not clear_path(g, p, q, {a, b, n}): continue
                if t < 0.12: m = a
                elif t > 0.88: m = b
                else:
                    m = g.node(q, 0.5); r = g.edges.pop(frozenset((a, b))); g.add(a, m, r); g.add(m, b, r)
                g.add(n, m, max(1, g.edges.get(frozenset((n, nbr)), 1))); joined += 1; done = True; break
            if not done:
                last = path[-1]; ends2 = list(g.adj()[last])
                for u, v in zip(path, path[1:]): g.edges.pop(frozenset((u, v)), None)
                # the edge from the last path node to the junction
                for x in list(g.adj()[path[-1]]):
                    if x not in path and len(g.adj()[x]) >= 3 and frozenset((path[-1], x)) in g.edges: g.edges.pop(frozenset((path[-1], x)))
                removed += 1
            acted = True
        if not acted: break
        for n in [n for n in g.pos if not any(n in k for k in g.edges)]: del g.pos[n]
    return joined, removed

def main():
    streets = md['streets']; keep = [s for s in streets if s.get('tag') == 'pier']; work = [s for s in streets if s.get('tag') != 'pier']
    g = G(); tagB = set()
    for s in work:
        r = RANK.get(s['cls'], 1); pts = s['pts']
        for a, b in zip(pts, pts[1:]):
            if math.dist(a, b) < 0.5: continue
            na, nb = g.node(a, 1.2), g.node(b, 1.2); g.add(na, nb, r)
            if s.get('tag') == 'black' and r == 1: pass
    # piers keep their own roads; their land end must stay a real end
    protected = set()
    print('start: nodes', len(g.pos), 'edges', len(g.edges))
    for it in range(5):
        planarize(g); u = unite(g); planarize(g)
        j, r = deadends(g, protected); planarize(g)
        A = g.adj(); n = len(meeting(g, A))
        print(f'round {it}: united {u}, dead ends joined {j} removed {r}; nodes {len(g.pos)} edges {len(g.edges)} meeting points {n}')
        if not u and not j and not r: break
    # output: maximal chains (through straight-through nodes and corners of the same class)
    A = g.adj(); seen = set(); out = []
    def key(a, b): return frozenset((a, b))
    deg = {n: len(A[n]) for n in A}
    def straight(n): return deg[n] == 2 and turn(g, A, n) >= 168
    for k, r in sorted(g.edges.items(), key=lambda kv: -kv[1]):
        if k in seen: continue
        a, b = tuple(k)
        chain = [a, b]; seen.add(k)
        for end in (0, 1):
            while True:
                c = chain[-1] if end == 1 else chain[0]; prev = chain[-2] if end == 1 else chain[1]
                if not straight(c): break
                nx = [x for x in A[c] if x != prev]
                if not nx or key(c, nx[0]) in seen or g.edges[key(c, nx[0])] != r: break
                seen.add(key(c, nx[0]))
                if end == 1: chain.append(nx[0])
                else: chain.insert(0, nx[0])
        pl = np.array([g.pos[n] for n in chain], np.float32).reshape(-1, 1, 2)
        pl = cv2.approxPolyDP(pl, 4.0, False).reshape(-1, 2) if len(chain) > 2 else pl.reshape(-1, 2)      # slight wiggles become one straight line
        out.append({'cls': NAME[r], 'pts': [[round(float(x), 1), round(float(y), 1)] for x, y in pl]})
    md['streets'] = out + keep
    json.dump(md, open(os.path.join(P, 'mapdata.json'), 'w'))
    open(os.path.join(P, 'mapdata.js'), 'w').write('// generated by tools/apply_new_map.py + tools/regraph.py (same content as mapdata.json) - edit the map in the studio, or re-run the tools\nexport default ' + json.dumps(md) + ';\n')
    A = g.adj(); M = meeting(g, A); ds = [math.dist(g.pos[a], g.pos[b]) for a in M for b in M if a < b]
    print('streets', len(out), '+ piers', len(keep), '| closest meeting points', round(min(ds), 1) if ds else None, 'px', '| dead ends', sum(1 for n in A if len(A[n]) == 1))
main()
