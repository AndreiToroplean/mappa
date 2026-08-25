#!/usr/bin/env python3
"""Build data/eu.json from the world-atlas TopoJSON.

Needs package-eu/countries-50m.json and package-eu/mledoze-countries.json:
    npm pack world-atlas@2 && mkdir -p package-eu \\
      && tar xzf world-atlas-2.0.2.tgz -C package-eu --strip-components=1
    curl -o package-eu/mledoze-countries.json \\
      https://raw.githubusercontent.com/mledoze/countries/master/countries.json

50m rather than 110m: 110m drops every microstate and reduces the Greek and
Croatian islands to nothing. 10m is five times the size for detail no phone can
draw at this scale.

Who is in the map is decided by the metadata, not by hand — see MEMBERSHIP
below. Every fact a player reads (the name, the capital, the grouping) comes out
of mledoze/countries, joined to the geometry on the ISO 3166-1 numeric code.
"""
import json
from collections import Counter
from geo import (ROOT, region, emit, normalise, bounds, simplify, span_km,
                 lambert_conic)

# The panel is normalised to a 1000-unit span for ~4,000km of Europe, so one
# unit is about 4km — four times as coarse as France's. The tolerance follows:
# what matters is the error once drawn, and this is drawn at the same size.
TOL = 1.2

# ---------------------------------------------------------------- projection
# ETRS89-LCC (EPSG:3034), the projection the EU's own statistical maps use.
# Standard parallels at 35 and 65 bracket Crete and the North Cape, so scale
# error across the continent stays small and relative sizes read true.
EUROPE = dict(lat1=35.0, lat2=65.0, lat0=52.0, lon0=10.0)


def project(lon, lat):
    return lambert_conic(lon, lat, **EUROPE)


# ------------------------------------------------------------- what is Europe
# MEMBERSHIP: an independent country that mledoze/countries places in the region
# Europe. That is a sourced rule rather than a list somebody typed, and it does
# the transcontinental work for free — Turkey, Georgia, Armenia, Azerbaijan and
# Kazakhstan are all filed under Asia there and drop out without an exception.
#
# Two exceptions, both about drawing rather than about geography:
EXCLUDE = {
    # Russia is in Europe by that rule and is left out anyway. Two thirds of a
    # Europe map would be Russia, or its border would have to be cut at a
    # convention (the Urals) that this map has no way to explain. Cutting a
    # country in half to make it fit is a worse lie than leaving it off the
    # sheet, and the frame then ends just past Ukraine and Finland, which reads
    # as a cropped map rather than as a hole.
    'Russia',
    # Four countries too small to aim at. At this scale Vatican City is a fifth
    # of a unit across and Monaco a third — a hundredth of a phone pixel, and a
    # twenty-fifth of one under the magnifier, which is the only answer this
    # game has for a small region. San Marino and Liechtenstein are enclaved
    # inside a neighbour, so a tap near them is *contained* in Italy or in
    # Switzerland and containment wins outright: they could never be found.
    # Andorra and Malta stay, at about the size Paris is on the French map.
    'Vatican City', 'Monaco', 'San Marino', 'Liechtenstein',
}

# Land inside this window is Europe; land outside it belongs to a European
# country but not to the continent. Applied per polygon, by its centre, so
# nothing is ever cut in half: Réunion, Guadeloupe, the Canaries, Madeira, the
# Azores, the Dutch Caribbean and Svalbard all drop out whole, while Corsica,
# Crete, Cyprus and the Canary-sized Greek islands stay. Jan Mayen falls inside
# it and is Norwegian, so it stays, as a speck in the Norwegian Sea.
#
# The point of a continent is that it is continuous. A player looking for France
# taps the mainland, so the overseas départements would be four insets nobody
# needs — and the same will be true of every continent after this one.
WINDOW = dict(lon=(-26.0, 42.0), lat=(34.0, 73.0))

# ---------------------------------------------------------------------- input
topo = json.load(open(ROOT / 'package-eu' / 'countries-50m.json'))
meta = json.load(open(ROOT / 'package-eu' / 'mledoze-countries.json'))

sc, tr = topo['transform']['scale'], topo['transform']['translate']
arcs = []
for arc in topo['arcs']:
    x = y = 0
    pts = []
    for dx, dy in arc:
        x += dx
        y += dy
        pts.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
    arcs.append(pts)


def ring_pts(idxs):
    """Stitch a ring out of arcs; a negative index means traverse in reverse."""
    out = []
    for i in idxs:
        a = arcs[~i][::-1] if i < 0 else arcs[i]
        out.extend(a[1:] if out else a)
    return out


ours = [c for c in meta
        if c['region'] == 'Europe' and c['independent']
        and c['name']['common'] not in EXCLUDE]
by_code = {c['ccn3']: c for c in ours}
assert len(by_code) == len(ours), 'two countries share a numeric code'

# ------------------------------------------------------------------- geometry
def in_window(ring):
    """Is this polygon's centre inside the continent? Whole polygons only."""
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    lon = (min(xs) + max(xs)) / 2
    lat = (min(ys) + max(ys)) / 2
    return (WINDOW['lon'][0] <= lon <= WINDOW['lon'][1]
            and WINDOW['lat'][0] <= lat <= WINDOW['lat'][1])


lonlat, order, geoms = {}, [], {}
for g in topo['objects']['countries']['geometries']:
    c = by_code.get(g.get('id'))
    if not c:
        continue
    name = c['name']['common']
    raw = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]
    kept = [poly for poly in raw if in_window(ring_pts(poly[0]))]
    assert kept, f'{name} has no land inside the continent'
    lonlat[name] = [[ring_pts(r) for r in poly] for poly in kept]
    geoms[name] = kept
    order.append(name)

missing = sorted(set(c['name']['common'] for c in ours) - set(order))
assert not missing, f'no geometry for {missing}'
order.sort()

# One projection over the whole continent, so relative sizes are true.
proj = {n: [[[project(x, y) for x, y in ring] for ring in poly]
            for poly in lonlat[n]] for n in order}
flat = [poly for n in order for poly in proj[n]]
placed, pw, ph = normalise(flat)

panels = [{'id': 'mainland', 'w': round(pw, 1), 'h': round(ph, 1),
           'km': round(span_km([p for n in order for p in lonlat[n]]))}]

regions, i = [], 0
for n in order:
    k = len(proj[n])
    regions.append(region(n, placed[i:i + k], panel=0, tol=TOL, places=0))
    i += k

# --------------------------------------------- grouping outlines, dissolved
# Same trick as the US: neighbours share arc indices in a TopoJSON topology, so
# the outline of a set of countries is every arc the set uses an odd number of
# times. An arc between two members is used twice and drops out; one on the edge
# of the group, or on the coast, is used once and stays. No geometry is compared,
# which is what makes it exact.
bx0, by0, bx1, by1 = bounds(flat)
gscale = 1000.0 / max(bx1 - bx0, by1 - by0)

arc_use = {}
for n in order:
    idxs = [i for poly in geoms[n] for ring in poly for i in ring]
    grp = by_code[[c['ccn3'] for c in ours if c['name']['common'] == n][0]]['subregion']
    arc_use.setdefault(grp, Counter()).update(i if i >= 0 else ~i for i in idxs)

groups = {}
for gname, uses in arc_use.items():
    parts = []
    for a in (a for a, k in uses.items() if k % 2 == 1):
        pts = simplify([((x - bx0) * gscale, (y - by0) * gscale)
                        for x, y in (project(*p) for p in arcs[a])], TOL)
        if len(pts) > 1:
            parts.append('M' + 'L'.join(f'{x:.0f},{y:.0f}' for x, y in pts))
    groups[gname] = {'p': 0, 'd': ''.join(parts)}

# ISO 3166-1 alpha-2, which is what a country's abbreviation is.
ABBR = {c['name']['common']: c['cca2'] for c in ours}

emit('eu.json', panels, regions, ABBR, groups=groups,
     meta={'source': 'world-atlas v2.0.2 (ISC), from Natural Earth 1:50m; '
                     'names, capitals and groupings from mledoze/countries'})
