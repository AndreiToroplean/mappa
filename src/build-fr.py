#!/usr/bin/env python3
"""Build data/fr.json from france-geojson.

Needs package-fr/departements-avec-outre-mer.geojson:
    curl -o package-fr/departements-avec-outre-mer.geojson \\
      https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-avec-outre-mer.geojson

The full-resolution file is used rather than the repo's simplified one, because
the simplified file covers only the 96 metropolitan departements — the overseas
five are full-resolution only. Simplification happens here instead, which also
keeps the tolerance under our control.
"""
import json, math
from geo import ROOT, region, emit, area

# Everything is laid out inside the same frame the US map uses, so every
# distance constant in the game — snap reach, tap-target threshold, magnifier
# zoom — means the same thing in both geographies without being re-tuned.
VIEW_W, VIEW_H = 1020, 600

# The mainland sits right of centre; the empty band on the left is where the
# overseas insets go. Values are the box the mainland is fitted into.
MAIN = (300, 24, 984, 576)          # x0, y0, x1, y1

# The source is full resolution — 180,000 points for the mainland, twenty times
# the entire US map — so it needs real reduction. Tolerance bounds how far the
# outline may stray, in view units, and 2 units is about 1.3 screen pixels on a
# phone. Coordinates are written as integers for the same reason: no point
# storing precision the tolerance has already thrown away.
MAIN_TOL = 2.0
OS_TOL = 0.6

# ---------------------------------------------------------------- projection
# Lambert-93: the official French projection. Conformal conic, so shapes stay
# recognisable, which matters when the whole game is recognising shapes.
LAMBERT = dict(lat1=44.0, lat2=49.0, lat0=46.5, lon0=3.0)

def lambert_conic(lon, lat, p=LAMBERT):
    r = math.radians
    lat1, lat2, lat0, lon0 = r(p['lat1']), r(p['lat2']), r(p['lat0']), r(p['lon0'])
    n = (math.log(math.cos(lat1) / math.cos(lat2))
         / math.log(math.tan(math.pi / 4 + lat2 / 2) / math.tan(math.pi / 4 + lat1 / 2)))
    F = math.cos(lat1) * math.tan(math.pi / 4 + lat1 / 2) ** n / n
    rho = F / math.tan(math.pi / 4 + r(lat) / 2) ** n
    rho0 = F / math.tan(math.pi / 4 + lat0 / 2) ** n
    theta = n * (r(lon) - lon0)
    # y is negated: screen coordinates grow downwards
    return (rho * math.sin(theta), -(rho0 - rho * math.cos(theta)))

def local_plane(lon, lat, lon0, lat0):
    """A flat projection around one point. The overseas departements are small
    enough that anything fancier would be indistinguishable."""
    return ((lon - lon0) * math.cos(math.radians(lat0)), -(lat - lat0))

# ------------------------------------------------------------------ geometry
def rings_of(feature, project):
    geom = feature['geometry']
    polys = (geom['coordinates'] if geom['type'] == 'MultiPolygon'
             else [geom['coordinates']])
    return [[[project(x, y) for x, y in ring] for ring in poly] for poly in polys]

def bbox(polys):
    xs = [x for poly in polys for ring in poly for x, y in ring]
    ys = [y for poly in polys for ring in poly for x, y in ring]
    return min(xs), min(ys), max(xs), max(ys)

def fit(polys, box, pad=0.0):
    """Scale and translate polygons to sit inside box, preserving aspect."""
    x0, y0, x1, y1 = box
    x0 += pad; y0 += pad; x1 -= pad; y1 -= pad
    bx0, by0, bx1, by1 = bbox(polys)
    s = min((x1 - x0) / (bx1 - bx0), (y1 - y0) / (by1 - by0))
    ox = x0 + ((x1 - x0) - (bx1 - bx0) * s) / 2 - bx0 * s
    oy = y0 + ((y1 - y0) - (by1 - by0) * s) / 2 - by0 * s
    return [[[(x * s + ox, y * s + oy) for x, y in ring] for ring in poly]
            for poly in polys], s

def transform(polys, s, ox, oy):
    return [[[(x * s + ox, y * s + oy) for x, y in ring] for ring in poly]
            for poly in polys]

# --------------------------------------------------------------------- build
path = ROOT / 'package-fr' / 'departements-avec-outre-mer.geojson'
feats = json.load(open(path))['features']
by_code = {f['properties']['code']: f for f in feats}
assert len(by_code) == 101, f'expected 101 departements, got {len(by_code)}'

OVERSEAS = ['971', '972', '973', '974', '976']
mainland = [c for c in by_code if c not in OVERSEAS]
assert len(mainland) == 96

# --- mainland: one projection, one fit, so relative sizes are true ---------
projected = {c: rings_of(by_code[c], lambert_conic) for c in mainland}
everything = [poly for c in mainland for poly in projected[c]]
_, scale = fit(everything, MAIN)
bx0, by0, bx1, by1 = bbox(everything)
x0, y0, x1, y1 = MAIN
ox = x0 + ((x1 - x0) - (bx1 - bx0) * scale) / 2 - bx0 * scale
oy = y0 + ((y1 - y0) - (by1 - by0) * scale) / 2 - by0 * scale

regions = []
placed = []
for code in mainland:
    polys = transform(projected[code], scale, ox, oy)
    placed.extend(polys)
    regions.append(region(by_code[code]['properties']['nom'], polys,
                          min_area=1.2, tol=MAIN_TOL, places=0))

# --- overseas: insets down the left margin --------------------------------
# Each is fitted to its own slot rather than drawn to the mainland's scale.
# At true scale Mayotte would be under two units across and unhittable, while
# Guyane is larger than any metropolitan departement; insets are conventionally
# not to scale, and the game is about recognising which is which.
SLOT_H = VIEW_H / len(OVERSEAS)
for i, code in enumerate(OVERSEAS):
    f = by_code[code]
    polys = rings_of(f, lambert_conic)   # placeholder, replaced below
    lon0, lat0 = None, None
    xs = [x for poly in rings_of(f, lambda a, b: (a, b))
          for ring in poly for x, y in ring]
    ys = [y for poly in rings_of(f, lambda a, b: (a, b))
          for ring in poly for x, y in ring]
    lon0, lat0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    polys = rings_of(f, lambda a, b: local_plane(a, b, lon0, lat0))
    slot = (28, i * SLOT_H + 10, 28 + 150, (i + 1) * SLOT_H - 10)
    polys, _ = fit(polys, slot, pad=6)
    placed.extend(polys)
    regions.append(region(f['properties']['nom'], polys,
                          min_area=0.05, tol=OS_TOL, places=0))

# ------------------------------------------------------------------- checks
mx0, my0, mx1, my1 = bbox([p for p in placed])
assert -1 <= mx0 and mx1 <= VIEW_W + 1, f'x out of frame: {mx0}..{mx1}'
assert -1 <= my0 and my1 <= VIEW_H + 1, f'y out of frame: {my0}..{my1}'

ABBR = {by_code[c]['properties']['nom']: c for c in by_code}

emit('fr.json', f'0 0 {VIEW_W} {VIEW_H}', regions, ABBR,
     meta={'source': 'france-geojson (gregoiredavid), from IGN/Etalab open data'})
