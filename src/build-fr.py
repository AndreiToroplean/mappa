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
from geo import ROOT, region, emit, normalise

# Panels are stored in local coordinates, each normalised to a 1000-unit span,
# so tolerance is per panel: what matters is the error once drawn. The mainland
# is drawn at roughly 600-1100 composed units across, an inset at 150-250, so
# the same on-screen error allows a much coarser tolerance for the insets.
# Both work out to about two composed units, a pixel or so on a phone —
# coordinates are written as integers for the same reason.
TOL_MAIN = 3.5
TOL_INSET = 9.0

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

def lonlat_centre(feature):
    pts = [p for poly in rings_of(feature, lambda a, b: (a, b))
           for ring in poly for p in ring]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2

# --------------------------------------------------------------------- build
path = ROOT / 'package-fr' / 'departements-avec-outre-mer.geojson'
feats = json.load(open(path))['features']
by_code = {f['properties']['code']: f for f in feats}
assert len(by_code) == 101, f'expected 101 departements, got {len(by_code)}'

OVERSEAS = ['971', '972', '973', '974', '976']
mainland = [c for c in by_code if c not in OVERSEAS]
assert len(mainland) == 96

panels, regions = [], []

# --- panel 0: the mainland, one projection so relative sizes are true ------
proj = {c: rings_of(by_code[c], lambert_conic) for c in mainland}
flat = [poly for c in mainland for poly in proj[c]]
placed, pw, ph = normalise(flat)
panels.append({'id': 'mainland', 'w': round(pw, 1), 'h': round(ph, 1)})
i = 0
for c in mainland:
    n = len(proj[c])
    regions.append(region(by_code[c]['properties']['nom'], placed[i:i + n],
                          panel=0, tol=TOL_MAIN, places=0))
    i += n

# --- one panel per overseas departement -----------------------------------
# Each gets its own panel rather than a reserved slot in a fixed frame, so the
# layout can put them wherever the screen has room. Each is normalised on its
# own, which is what makes them not to scale relative to the mainland: at true
# scale Mayotte would be a couple of units across and Guyane larger than any
# metropolitan departement.
for c in OVERSEAS:
    f = by_code[c]
    lon0, lat0 = lonlat_centre(f)
    polys = rings_of(f, lambda a, b: local_plane(a, b, lon0, lat0))
    placed, pw, ph = normalise(polys)
    panels.append({'id': c, 'w': round(pw, 1), 'h': round(ph, 1)})
    regions.append(region(f['properties']['nom'], placed,
                          panel=len(panels) - 1, min_area=0.05,
                          tol=TOL_INSET, places=0))

ABBR = {by_code[c]['properties']['nom']: c for c in by_code}

emit('fr.json', panels, regions, ABBR,
     meta={'source': 'france-geojson (gregoiredavid), from IGN/Etalab open data'})
