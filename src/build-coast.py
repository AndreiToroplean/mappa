#!/usr/bin/env python3
"""Find which stretches of border have water on the other side.

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
from PIL import Image, ImageDraw
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


def fit(a, b):
    """Least squares for b = s*a + t on one axis."""
    n = len(a); ma = sum(a) / n; mb = sum(b) / n
    s = sum((x - ma) * (y - mb) for x, y in zip(a, b)) / sum((x - ma) ** 2 for x in a)
    return s, mb - s * ma


def biggest_ring(d):
    best = []
    for part in d.split('M'):
        if not part:
            continue
        r = [tuple(map(float, s.split(','))) for s in part.rstrip('Z').split('L')]
        if len(r) > len(best):
            best = r
    return best


def box_of(rings, pad):
    xs = [p[0] for r in rings for p in r]; ys = [p[1] for r in rings for p in r]
    return min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad


# --------------------------------------------------------------------- masks
# Point-in-polygon against a 1.4MB ocean multipolygon, for every border segment
# of 101 régions, is far too slow done honestly. Rasterising both land and water
# once per panel turns every one of those tests into an array lookup.
RES = 1400


class Mask:
    def __init__(self, rings, box, res=RES):
        x0, y0, x1, y1 = box
        self.x0, self.y0 = x0, y0
        self.k = res / max(x1 - x0, y1 - y0)
        w = max(2, int((x1 - x0) * self.k)); hh = max(2, int((y1 - y0) * self.k))
        self.w, self.h = w, hh
        img = Image.new('1', (w, hh), 0)
        dr = ImageDraw.Draw(img)
        for ring in rings:
            pts = [((x - x0) * self.k, (y - y0) * self.k) for x, y in ring]
            if len(pts) >= 3:
                dr.polygon(pts, fill=1)
        self.px = img.load()

    def at(self, x, y):
        i = int((x - self.x0) * self.k); j = int((y - self.y0) * self.k)
        if i < 0 or j < 0 or i >= self.w or j >= self.h:
            return False
        return bool(self.px[i, j])


def world_land_rings(project, place):
    """Continents, not ocean.

    Natural Earth's ocean is one polygon covering the globe with the continents
    punched out as holes, and a rasteriser that fills each ring independently
    turns that into "everywhere is water" — which marked the Canadian border as
    coastline. Land is the honest primitive here: simple polygons, no holes to
    respect, and water is whatever is left over once the lakes are cut back in.
    """
    out = []
    for f in json.loads((SRC / 'ne_50m_land.geojson').read_text())['features']:
        for ring in rings_of(f):
            pts = [project(x, y) for x, y in ring]
            if any(q is None for q in pts):
                continue
            out.append([place(q) for q in pts])
    return out


def lake_rings(project, place):
    out = []
    for f in json.loads((SRC / 'ne_50m_lakes.geojson').read_text())['features']:
        for ring in rings_of(f):
            pts = [project(x, y) for x, y in ring]
            if any(q is None for q in pts):
                continue
            out.append([place(q) for q in pts])
    return out


class WaterMask:
    """Not-land, with the lakes added back."""

    def __init__(self, project, place, box):
        self.land = Mask(world_land_rings(project, place), box)
        self.lakes = Mask(lake_rings(project, place), box)

    def at(self, x, y):
        return self.lakes.at(x, y) or not self.land.at(x, y)


def ring_of(d):
    for part in d.split('M'):
        if not part:
            continue
        yield [tuple(map(float, s.split(','))) for s in part.rstrip('Z').split('L')]


def inside(ring, x, y):
    c = False
    n = len(ring)
    for i in range(n):
        ax, ay = ring[i]; bx, by = ring[(i + 1) % n]
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            c = not c
    return c


# How far out along a segment's normal to look. Generous on purpose: following
# the normal means anything found is genuinely across *this* border, so the low
# resolution of the ocean data around small islands stops mattering. The first
# thing hit decides — sibling land means an interior border, water means a coast,
# neither means a foreign land border, which is left unmarked.
STEPS = (2.5, 5, 9, 14, 21, 30, 42)


def coastline(regions, land, water):
    """Every stretch of border with water on the outside, as open polylines."""
    parts = []
    for r in regions:
        for ring in ring_of(r['d']):
            if len(ring) < 3:
                continue
            # which normal points out of this ring: decide once, from any segment
            ax, ay = ring[0]; bx, by = ring[1]
            mx, my = (ax + bx) / 2, (ay + by) / 2
            ex, ey = bx - ax, by - ay
            L = math.hypot(ex, ey) or 1
            nx, ny = -ey / L, ex / L
            hand = -1 if inside(ring, mx + nx * 0.4, my + ny * 0.4) else 1

            run = []
            for i in range(len(ring)):
                ax, ay = ring[i]; bx, by = ring[(i + 1) % len(ring)]
                ex, ey = bx - ax, by - ay
                L = math.hypot(ex, ey)
                if L < 1e-9:
                    continue
                nx, ny = -ey / L * hand, ex / L * hand
                mx, my = (ax + bx) / 2, (ay + by) / 2
                wet = False
                for t in STEPS:
                    px, py = mx + nx * t, my + ny * t
                    if land.at(px, py):
                        break
                    if water.at(px, py):
                        wet = True
                        break
                if wet:
                    if not run:
                        run = [(ax, ay)]
                    run.append((bx, by))
                elif run:
                    parts.append(run)
                    run = []
            if run:
                parts.append(run)
    return ''.join('M' + 'L'.join(f'{x:.0f},{y:.0f}' for x, y in p) for p in parts
                   if len(p) > 1)


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
        place = lambda q, a=(sx, tx, sy, ty): (a[0] * q[0] + a[1], a[2] * q[1] + a[3])
        proj = lambda x, y, l=lon0, pp=parallels: albers(x, y, l, *pp)
        regions = [atlas[nm] for nm in names] if len(names) > 1 else [atlas[names[0]]]
        if len(names) > 1:      # the lower 48 are every state but these two
            regions = [r for n, r in atlas.items() if n not in ('Alaska', 'Hawaii')]
        box = box_of([biggest_ring(r['d']) for r in regions], 90)
        land = Mask([r for reg in regions for r in ring_of(reg['d'])], box)
        water = WaterMask(proj, place, box)
        out.append({'p': 0, 'd': coastline(regions, land, water)})
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
    regions = [r for r in fr['regions'] if r['p'] == 0]
    box = box_of([biggest_ring(r['d']) for r in regions], 90)
    place = lambda q: (s * q[0] + ox, s * q[1] + oy)
    out.append({'p': 0, 'd': coastline(
        regions,
        Mask([r for reg in regions for r in ring_of(reg['d'])], box),
        WaterMask(lambert, place, box))})

    for i, code in enumerate(OVERSEAS):
        f = by_code[code]
        pts = [q for r in rings_of(f) for q in r]
        lon0 = (min(q[0] for q in pts) + max(q[0] for q in pts)) / 2
        lat0 = (min(q[1] for q in pts) + max(q[1] for q in pts)) / 2
        proj = lambda x, y, a=lon0, b=lat0: local_plane(x, y, a, b)
        s2, ox2, oy2 = normalise_from([[proj(x, y) for x, y in r] for r in rings_of(f)])
        regions = [r for r in fr['regions'] if r['p'] == i + 1]
        box = box_of([biggest_ring(r['d']) for r in regions], 140)
        out.append({'p': i + 1, 'd': coastline(
            regions,
            Mask([r for reg in regions for r in ring_of(reg['d'])], box),
            WaterMask(proj, lambda q, a=(s2, ox2, oy2):
                      (a[0] * q[0] + a[1], a[0] * q[1] + a[2]), box))})
    return out


for geo, build in (('us', build_us), ('fr', build_fr)):
    print(f'  {geo}:')
    parts = build()
    p = ROOT / 'data' / f'coast-{geo}.json'
    p.write_text(json.dumps(parts, separators=(',', ':')))
    pts = sum(x['d'].count(',') for x in parts)
    print(f'  wrote {p.name}: {len(parts)} piece(s), {pts:,} points, '
          f'{p.stat().st_size:,} bytes')
