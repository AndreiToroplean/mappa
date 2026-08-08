import json, math, heapq

d = json.load(open(__import__('pathlib').Path(__file__).resolve().parent.parent / 'package' / 'states-albers-10m.json'))
sc, tr = d['transform']['scale'], d['transform']['translate']

arcs = []
for arc in d['arcs']:
    x = y = 0; pts = []
    for dx, dy in arc:
        x += dx; y += dy
        pts.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
    arcs.append(pts)

def ring_pts(idxs):
    out = []
    for i in idxs:
        a = arcs[~i][::-1] if i < 0 else arcs[i]
        out.extend(a[1:] if out else a)
    return out

def simplify(pts, tol=0.45):
    if len(pts) < 4: return pts
    out = [pts[0]]
    for p in pts[1:-1]:
        if abs(p[0]-out[-1][0]) + abs(p[1]-out[-1][1]) >= tol:
            out.append(p)
    out.append(pts[-1])
    return out if len(out) >= 4 else pts

def area(pts):
    s = 0
    for i in range(len(pts)-1):
        s += pts[i][0]*pts[i+1][1] - pts[i+1][0]*pts[i][1]
    return abs(s)/2

# ---- polylabel (Mapbox algorithm): pole of inaccessibility ----
def seg_d2(px, py, ax, ay, bx, by):
    dx, dy = bx-ax, by-ay
    if dx or dy:
        t = ((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy)
        if t > 1: ax, ay = bx, by
        elif t > 0: ax, ay = ax+dx*t, ay+dy*t
    dx, dy = px-ax, py-ay
    return dx*dx + dy*dy

def signed_dist(x, y, rings):
    """Distance to the nearest edge; negative when the point is outside."""
    inside = False; best = float('inf')
    for ring in rings:
        n = len(ring)
        for i in range(n):
            ax, ay = ring[i]; bx, by = ring[(i+1) % n]
            if (ay > y) != (by > y) and x < (bx-ax)*(y-ay)/(by-ay)+ax:
                inside = not inside
            best = min(best, seg_d2(x, y, ax, ay, bx, by))
    return math.sqrt(best) * (1 if inside else -1)

SQRT2 = math.sqrt(2)

def polylabel(rings, precision=0.4):
    xs = [p[0] for p in rings[0]]; ys = [p[1] for p in rings[0]]
    minx, miny, maxx, maxy = min(xs), min(ys), max(xs), max(ys)
    w, h = maxx-minx, maxy-miny
    cell = min(w, h)
    if cell == 0: return (minx, miny), 0.0
    half = cell / 2

    def make(x, y, hh):
        dd = signed_dist(x, y, rings)
        return (-(dd + hh*SQRT2), x, y, hh, dd)   # heap key = negative upper bound

    q = []
    y = miny
    while y < maxy:
        x = minx
        while x < maxx:
            heapq.heappush(q, make(x+half, y+half, half))
            x += cell
        y += cell

    # seed with the bbox centre so there is always a baseline
    best = make(minx+w/2, miny+h/2, 0)
    while q:
        bound, x, y, hh, dd = heapq.heappop(q)
        if dd > best[4]:
            best = (bound, x, y, hh, dd)
        if -bound - best[4] <= precision:
            continue
        hh /= 2
        for ox, oy in ((-hh, -hh), (hh, -hh), (-hh, hh), (hh, hh)):
            heapq.heappush(q, make(x+ox, y+oy, hh))
    return (best[1], best[2]), best[4]

states = []
for g in d['objects']['states']['geometries']:
    name = g['properties']['name']
    if name == 'District of Columbia':
        continue
    polys = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]

    dstr = []
    best_pt, best_r = None, -1
    for poly in polys:
        rings = [ring_pts(r) for r in poly]
        if area(rings[0]) < 1.2:      # skip specks
            continue
        rings = [simplify(r) for r in rings]
        for r in rings:
            dstr.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in r) + 'Z')
        # label goes in whichever landmass has the roomiest interior
        pt, rad = polylabel(rings)
        if rad > best_r:
            best_pt, best_r = pt, rad

    states.append({
        'n': name,
        'd': ''.join(dstr),
        'l': [round(best_pt[0], 1), round(best_pt[1], 1)],
        'r': round(best_r, 1),
    })

states.sort(key=lambda s: s['n'])
json.dump(states, open(__import__('pathlib').Path(__file__).resolve().parent.parent / 'data' / 'states.json', 'w'), separators=(',', ':'))

print(f'{len(states)} states')
print('\ntightest interiors (these need enlarged tap targets):')
for s in sorted(states, key=lambda s: s['r'])[:12]:
    print(f"  {s['n']:<16} r={s['r']:>5}  at {s['l']}")
