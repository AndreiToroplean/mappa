"""Geometry shared by every geography's build script.

Nothing in here knows about a particular country: it takes rings of projected
coordinates and produces the shape the game loads — path data, a label anchor,
and the inscribed radius at that anchor.
"""
import json, math, heapq, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def lambert_conic(lon, lat, lat1, lat2, lat0, lon0):
    """Lambert conformal conic, the projection a mid-latitude country is drawn in.

    Conformal, so shapes stay recognisable — which matters more here than in most
    maps, since recognising shapes is the whole game. The two standard parallels
    bracket the latitudes covered; between them the scale error is small enough
    that relative sizes still read true.

    y is negated: screen coordinates grow downwards.
    """
    r = math.radians
    lat1, lat2, lat0, lon0 = r(lat1), r(lat2), r(lat0), r(lon0)
    n = (math.log(math.cos(lat1) / math.cos(lat2))
         / math.log(math.tan(math.pi / 4 + lat2 / 2) / math.tan(math.pi / 4 + lat1 / 2)))
    F = math.cos(lat1) * math.tan(math.pi / 4 + lat1 / 2) ** n / n
    rho = F / math.tan(math.pi / 4 + r(lat) / 2) ** n
    rho0 = F / math.tan(math.pi / 4 + lat0 / 2) ** n
    theta = n * (r(lon) - lon0)
    return (rho * math.sin(theta), -(rho0 - rho * math.cos(theta)))


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


def region(name, polys, panel=0, min_area=1.2, tol=0.45, places=1):
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
        'p': panel,
        'd': path_data(parts, places),
        'l': [round(best_pt[0], 1), round(best_pt[1], 1)],
        'r': round(best_r, 1),
    }


def bounds(polys):
    xs = [x for poly in polys for ring in poly for x, y in ring]
    ys = [y for poly in polys for ring in poly for x, y in ring]
    return min(xs), min(ys), max(xs), max(ys)


PANEL_SPAN = 1000.0


def span_km(lonlat_polys):
    """Roughly how many km across a panel really is, longest side.

    Panels are normalised to the same local span, which throws real size away.
    The layout needs it back to draw them at a consistent scale, so it is
    measured here from the original coordinates.
    """
    xs = [x for poly in lonlat_polys for ring in poly for x, y in ring]
    ys = [y for poly in lonlat_polys for ring in poly for x, y in ring]
    mid = math.radians((min(ys) + max(ys)) / 2)
    return max((max(xs) - min(xs)) * 111.32 * math.cos(mid),
               (max(ys) - min(ys)) * 111.32)


def normalise(polys, span=PANEL_SPAN):
    """Move a panel's geometry to its own origin and scale its longest side to
    span, returning the transformed polygons and the panel size.

    Panels are stored in local coordinates because the layout is decided at run
    time, from the shape of the screen — the build no longer knows where a panel
    will sit or how big it will be. Normalising means one simplification
    tolerance is meaningful for every panel regardless of its real-world size.
    """
    x0, y0, x1, y1 = bounds(polys)
    s = span / max(x1 - x0, y1 - y0)
    out = [[[((x - x0) * s, (y - y0) * s) for x, y in ring] for ring in poly]
           for poly in polys]
    return out, (x1 - x0) * s, (y1 - y0) * s


def pin(polys, host_origin=(0.0, 0.0)):
    """Move a panel to its own origin without rescaling it, for a *fixed* panel.

    A fixed panel is one whose place in the frame was decided by a cartographer
    rather than by the layout engine: Alaska and Hawaii sit where Albers USA puts
    them, and that arrangement is worth keeping. It is still a separate panel,
    because the game asks which panel two regions are on to decide whether a line
    between them means anything on the ground.

    So the geometry is shifted to a local origin like any other panel, but *not*
    scaled: the returned `fix` maps it back into the host panel's coordinates as
    p * s + (x, y), with s == 1. Keeping the scale at 1 is deliberate — the same
    simplification tolerance then means the same thing as it did when this
    geometry was part of the host, so splitting a panel out cannot move a single
    point of it.
    """
    x0, y0, x1, y1 = bounds(polys)
    # Shift by a whole tenth, the grid the coordinates are rounded to. An
    # arbitrary offset would round twice — once into the host's space and again
    # into the panel's — and move points by up to a tenth of a unit. On the grid,
    # subtracting the offset and adding it back is exact, so a region's composed
    # geometry is bit-for-bit what it was before the panel was split out.
    dx = math.floor(x0 * 10) / 10
    dy = math.floor(y0 * 10) / 10
    out = [[[(x - dx, y - dy) for x, y in ring] for ring in poly]
           for poly in polys]
    return out, {'w': round(x1 - dx, 1), 'h': round(y1 - dy, 1),
                 'fix': {'x': round(dx - host_origin[0], 1),
                         'y': round(dy - host_origin[1], 1), 's': 1}}


def emit(path, panels, regions, abbr, groups=None, meta=None):
    """Write a geography: panels in local coordinates, and the regions in them.

    No view box and no placement — see normalise(). The game composes these
    into one flat coordinate space once it knows the shape of the screen.

    A panel carrying `fix` is placed relative to panel 0 instead of being laid
    out; see pin(). Only laid-out panels need `km`, which is what the layout
    scales them against.
    """
    regions.sort(key=lambda r: r['n'])
    assert set(abbr) == {r['n'] for r in regions}, 'abbreviations do not match'
    for i, panel in enumerate(panels):
        assert any(r['p'] == i for r in regions), f'panel {i} has no regions'
        if i and not panel.get('fix'):
            assert panel.get('km'), f'panel {i} is laid out and needs km'
    assert not panels[0].get('fix'), 'panel 0 is the host and cannot be fixed'
    out = {'panels': panels, 'abbr': abbr, 'regions': regions}
    if groups:
        out['groups'] = groups
    if meta:
        out['meta'] = meta
    p = ROOT / 'data' / path
    p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps(out, separators=(',', ':')))
    pts = sum(r['d'].count(',') for r in regions)
    print(f'wrote {p} ({p.stat().st_size:,} bytes, {len(regions)} regions, '
          f'{len(panels)} panel(s), {pts:,} points)')
    for i, panel in enumerate(panels):
        n = sum(1 for r in regions if r['p'] == i)
        how = ('fixed at %.0f,%.0f' % (panel['fix']['x'], panel['fix']['y'])
               if panel.get('fix') else 'laid out')
        print(f"    panel {i} {panel['id']:<12} {panel['w']:.0f}x{panel['h']:.0f} "
              f"local units, {n} region(s), {how}")
