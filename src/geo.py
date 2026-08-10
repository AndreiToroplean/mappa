"""Geometry shared by every geography's build script.

Nothing in here knows about a particular country: it takes rings of projected
coordinates and produces the shape the game loads — path data, a label anchor,
and the inscribed radius at that anchor.
"""
import json, math, heapq, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


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


def path_data(rings, places=1):
    """One SVG path string for a set of rings."""
    fmt = '{:.' + str(places) + 'f}'
    return ''.join(
        'M' + 'L'.join(fmt.format(x) + ',' + fmt.format(y) for x, y in r) + 'Z'
        for r in rings)


def region(name, polys, min_area=1.2, tol=0.45, places=1):
    """Build one region from its polygons (each a list of rings).

    tol bounds how far the simplified outline may stray from the original, in
    view units, since each dropped point was within tol of the one kept before
    it. places is the coordinate precision written out; there is no sense in
    writing more precision than tol preserves.

    Islands smaller than min_area are dropped as specks. The label goes in
    whichever landmass has the roomiest interior, which is what keeps a
    label out of the water for places made of several pieces.
    """
    parts, best_pt, best_r = [], None, -1
    for rings in polys:
        if area(rings[0]) < min_area:
            continue
        rings = [simplify(r, tol) for r in rings]
        parts.extend(rings)
        pt, rad = polylabel(rings)
        if rad > best_r:
            best_pt, best_r = pt, rad
    if best_pt is None:      # every piece was a speck; keep the largest anyway
        rings = [simplify(r, tol) for r in max(polys, key=lambda p: area(p[0]))]
        parts.extend(rings)
        best_pt, best_r = polylabel(rings)
    return {
        'n': name,
        'd': path_data(parts, places),
        'l': [round(best_pt[0], 1), round(best_pt[1], 1)],
        'r': round(best_r, 1),
    }


def emit(path, view_box, regions, abbr, meta=None):
    """Write a geography file: everything the game needs, and nothing else."""
    regions.sort(key=lambda r: r['n'])
    assert set(abbr) == {r['n'] for r in regions}, 'abbreviations do not match'
    out = {'viewBox': view_box, 'abbr': abbr, 'regions': regions}
    if meta:
        out['meta'] = meta
    p = ROOT / 'data' / path
    p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps(out, separators=(',', ':')))
    print(f'wrote {p} ({p.stat().st_size:,} bytes, {len(regions)} regions)')
    tight = sorted(regions, key=lambda r: r['r'])[:10]
    print('  tightest interiors (these get enlarged tap targets):')
    for r in tight:
        print(f"    {r['n'][:24]:<24} r={r['r']:>5}")
