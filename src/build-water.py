#!/usr/bin/env python3
"""Build the water layer: ocean and lakes, in each panel's local coordinates.

Drawn under everything as one flat colour, which is what makes this tractable:
overlapping water is still water, so each sub-projection can be clipped to its
own box without any of them having to agree about where they meet. Land is drawn
on top, and foreign land is simply absent from the ocean polygon, so it stays
background rather than sea.

The US map is not projected by us — us-atlas ships coordinates already run
through d3's albersUsa. Rather than trust a reimplementation, each of its three
sub-projections is *fitted* against the stored geometry here and the residual
asserted, so a wrong projection fails the build instead of shipping a misaligned
ocean.

Needs package-water/ne_50m_{ocean,lakes,admin_1_states_provinces_lakes}.geojson
from https://github.com/nvkelso/natural-earth-vector.
"""
import json, math
from geo import ROOT, simplify

SRC = ROOT / 'package-water'
TOL = 2.0          # local units; the water outline needs no more than the land


def albers(lon, lat, lon0, p1, p2):
    r = math.radians; P1, P2 = r(p1), r(p2)
    n = (math.sin(P1) + math.sin(P2)) / 2
    C = math.cos(P1) ** 2 + 2 * n * math.sin(P1)
    q = C - 2 * n * math.sin(r(lat))
    if q < 0: return None
    rho = math.sqrt(q) / n
    th = n * r(lon - lon0)
    return rho * math.sin(th), rho * math.cos(th)


def lambert(lon, lat, lat1=44.0, lat2=49.0, lat0=46.5, lon0=3.0):
    r = math.radians
    L1, L2, L0 = r(lat1), r(lat2), r(lat0)
    n = (math.log(math.cos(L1) / math.cos(L2))
         / math.log(math.tan(math.pi / 4 + L2 / 2) / math.tan(math.pi / 4 + L1 / 2)))
    F = math.cos(L1) * math.tan(math.pi / 4 + L1 / 2) ** n / n
    rho = F / math.tan(math.pi / 4 + r(lat) / 2) ** n
    rho0 = F / math.tan(math.pi / 4 + L0 / 2) ** n
    th = n * (r(lon) - r(lon0))
    return rho * math.sin(th), -(rho0 - rho * math.cos(th))


def rings_of(feature):
    g = feature['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    return [ring for poly in polys for ring in poly]


def clip(ring, box):
    """Sutherland-Hodgman against an axis-aligned box."""
    x0, y0, x1, y1 = box
    edges = ((lambda p: p[0] >= x0, lambda a, b: (x0, lerp(a, b, 0, x0))),
             (lambda p: p[0] <= x1, lambda a, b: (x1, lerp(a, b, 0, x1))),
             (lambda p: p[1] >= y0, lambda a, b: (lerp(a, b, 1, y0), y0)),
             (lambda p: p[1] <= y1, lambda a, b: (lerp(a, b, 1, y1), y1)))
    out = ring
    for inside, cut in edges:
        if not out: return []
        src, out = out, []
        for i, b in enumerate(src):
            a = src[i - 1]
            if inside(b):
                if not inside(a): out.append(cut(a, b))
                out.append(b)
            elif inside(a):
                out.append(cut(a, b))
    return out


def lerp(a, b, axis, at):
    other = 1 - axis
    if b[axis] == a[axis]: return a[other]
    t = (at - a[axis]) / (b[axis] - a[axis])
    return a[other] + (b[other] - a[other]) * t


def water_for(project, box, place):
    """Ocean and lakes, projected, clipped to box, then placed into panel units."""
    feats = [json.loads((SRC / 'ne_50m_ocean.geojson').read_text())['features'][0]]
    feats += json.loads((SRC / 'ne_50m_lakes.geojson').read_text())['features']
    parts = []
    for f in feats:
        for ring in rings_of(f):
            pts = [project(x, y) for x, y in ring]
            if any(p is None for p in pts): continue
            pts = clip([place(p) for p in pts], box)
            if len(pts) < 3: continue
            pts = simplify(pts, TOL)
            if len(pts) < 3: continue
            parts.append('M' + 'L'.join(f'{x:.0f},{y:.0f}' for x, y in pts) + 'Z')
    return ''.join(parts)


def fit(a, b):
    n = len(a); ma = sum(a) / n; mb = sum(b) / n
    s = sum((x - ma) * (y - mb) for x, y in zip(a, b)) / sum((x - ma) ** 2 for x in a)
    return s, mb - s * ma


def biggest_ring(d):
    best = []
    for part in d.split('M'):
        if not part: continue
        r = [tuple(map(float, s.split(','))) for s in part.rstrip('Z').split('L')]
        if len(r) > len(best): best = r
    return best


def box_of(rings, pad):
    xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
    return min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad


# ------------------------------------------------------------------- the US
def build_us():
    atlas = {r['n']: r for r in json.loads((ROOT / 'data' / 'us.json').read_text())['regions']}
    ne = json.loads((SRC / 'ne_50m_admin_1_states_provinces_lakes.geojson').read_text())
    raw = {f['properties']['name']: f for f in ne['features']
           if f['properties'].get('iso_a2') == 'US'}

    groups = [
        # states used to fit, projection parameters, longitude search range
        (('Texas', 'Maine', 'California', 'Florida', 'Montana', 'Georgia', 'Ohio',
          'Colorado', 'Washington', 'Louisiana', 'Minnesota', 'Arizona'),
         (29.5, 45.5), (-96, -96)),
        (('Alaska',), (55, 65), (-160, -148)),
        (('Hawaii',), (8, 18), (-164, -152)),
    ]
    out = []
    for names, parallels, (lo, hi) in groups:
        best = None
        steps = 1 if lo == hi else 49
        for k in range(steps):
            lon0 = lo + (hi - lo) * k / max(steps - 1, 1)
            A, B = [], []
            for nm in names:
                ring = max(rings_of(raw[nm]), key=len)
                pts = [albers(x, y, lon0, *parallels) for x, y in ring]
                if any(p is None for p in pts): break
                A.append(pts)
                B.append(biggest_ring(atlas[nm]['d']))
            if len(A) != len(names): continue
            # Fit on bounding box extremes, not on vertices: the two sources have
            # different vertex counts, so pairing them by index pairs unrelated
            # points and drags the regression badly out.
            ax, ay, bx, by = [], [], [], []
            for pa, pb in zip(A, B):
                b1 = box_of([pa], 0); b2 = box_of([pb], 0)
                ax += [b1[0], b1[2]]; bx += [b2[0], b2[2]]
                ay += [b1[1], b1[3]]; by += [b2[1], b2[3]]
            sx, tx = fit(ax, bx); sy, ty = fit(ay, by)
            # score on bounding boxes, which do not care about vertex alignment
            err = 0
            for pa, pb in zip(A, B):
                pa2 = [(sx * x + tx, sy * y + ty) for x, y in pa]
                b1 = box_of([pa2], 0); b2 = box_of([pb], 0)
                err = max(err, max(abs(b1[i] - b2[i]) for i in range(4)))
            if best is None or err < best[0]:
                best = (err, lon0, sx, tx, sy, ty)
        err, lon0, sx, tx, sy, ty = best
        print(f'    {names[0]:<10} lon0 {lon0:7.2f}  fit error {err:5.2f} units')
        assert err < 6, f'{names[0]}: projection fit off by {err:.1f} units'
        rings = [biggest_ring(atlas[nm]['d']) for nm in names]
        box = box_of(rings, 60)
        out.append({'p': 0, 'd': water_for(
            lambda x, y, l=lon0, pp=parallels: albers(x, y, l, *pp),
            box, lambda p, a=(sx, tx, sy, ty): (a[0] * p[0] + a[1], a[2] * p[1] + a[3]))})
    return out


# --------------------------------------------------------------- and France
# No fitting here: we own this projection, so the transform is recomputed exactly
# the way build-fr.py derived it. Fitting would be strictly worse than knowing.
def local_plane(lon, lat, lon0, lat0):
    return ((lon - lon0) * math.cos(math.radians(lat0)), -(lat - lat0))


def normalise_from(rings, span=1000.0):
    xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    s = span / max(x1 - x0, y1 - y0)
    return s, -x0 * s, -y0 * s


def build_fr():
    fr = json.loads((ROOT / 'data' / 'fr.json').read_text())
    feats = json.loads((ROOT / 'package-fr' /
                        'departements-avec-outre-mer.geojson').read_text())['features']
    by_code = {f['properties']['code']: f for f in feats}
    OVERSEAS = ['971', '972', '973', '974', '976']
    mainland = [c for c in by_code if c not in OVERSEAS]

    out = []
    # panel 0: the mainland
    rings = [[lambert(x, y) for x, y in r]
             for c in mainland for r in rings_of(by_code[c])]
    s, ox, oy = normalise_from(rings)
    p0 = fr['panels'][0]
    print(f'    mainland   scale {s:.4f}  offset ({ox:.1f}, {oy:.1f})')
    out.append({'p': 0, 'd': water_for(lambert, (0, 0, p0['w'], p0['h']),
                                       lambda p: (s * p[0] + ox, s * p[1] + oy))})

    # one panel per overseas départment, each with its own local projection
    for i, code in enumerate(OVERSEAS):
        f = by_code[code]
        pts = [p for r in rings_of(f) for p in r]
        lon0 = (min(p[0] for p in pts) + max(p[0] for p in pts)) / 2
        lat0 = (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2
        proj = lambda x, y, a=lon0, b=lat0: local_plane(x, y, a, b)
        rings = [[proj(x, y) for x, y in r] for r in rings_of(f)]
        s2, ox2, oy2 = normalise_from(rings)
        panel = fr['panels'][i + 1]
        out.append({'p': i + 1, 'd': water_for(
            proj, (0, 0, panel['w'], panel['h']),
            lambda p, a=(s2, ox2, oy2): (a[0] * p[0] + a[1], a[0] * p[1] + a[2]))})
    return out


for geo, build in (('us', build_us), ('fr', build_fr)):
    print(f'  {geo}:')
    parts = build()
    p = ROOT / 'data' / f'water-{geo}.json'
    p.write_text(json.dumps(parts, separators=(',', ':')))
    pts = sum(x['d'].count(',') for x in parts)
    print(f'  wrote {p.name}: {len(parts)} piece(s), {pts:,} points, '
          f'{p.stat().st_size:,} bytes')
