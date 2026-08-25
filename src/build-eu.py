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
                 lambert_conic, ink_box, area)

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
}

# Below this inscribed radius a country is drawn as a mark rather than as its
# own outline — see region() in geo.py. Six countries fall under it: Vatican
# City, Monaco, San Marino, Liechtenstein, Malta and Andorra.
#
# Calibrated against the smallest region already shipping. Hauts-de-Seine, on
# the French map, has an inscribed radius of 3.0 local units, and the magnifier
# is documented as the whole answer for it; 3.5 clears that with a little margin
# and still lands under Luxembourg's 3.7, so every country with a shape worth
# drawing keeps it. At this scale the mark is about 15km across on the ground.
#
# Without it these six are not merely fiddly, they are unfindable. Vatican City
# and Monaco come out a sixth of a phone pixel across *under the magnifier*, and
# San Marino and Liechtenstein are enclaved, so a tap near them lands inside
# Italy or Switzerland — see stateUnder() for the rule that lets a mark inside a
# neighbour still win.
DOT = 3.5

# Every country keeps its largest landmass unconditionally — that is the country,
# and dropping it would drop the country. Every *other* piece has to earn the
# space it costs.
#
# What it costs is the frame. Panels are laid out and scaled by their bounding
# box, so an island outside the current box does not merely appear, it widens
# the box and shrinks everything already in it. The Azores are the case that
# forced this: nine islands totalling 2,300 km² were pushing the west edge out
# by a quarter of the map's width, so a fifth of the frame was empty Atlantic
# and continental Europe was drawn a fifth smaller than it needed to be.
#
# So each candidate is asked what it adds to the frame against what it is:
# accepted when the box grows by no more than MARGIN times the island's own
# area. Anything already inside the box costs nothing and is always kept, which
# is most of them — Crete, Sicily, Sardinia, Corsica, Gotland, the Balearics,
# the Danish and Greek islands. Only a piece that would extend the frame has to
# argue for itself.
#
# Largest first, so the answer does not depend on the order the file happens to
# list them in, and so a big island that has already widened the frame can make
# a smaller neighbour free.
#
# On this continent the decision is not close, and the value below is not tuned:
# every piece that is kept costs *nothing*, sitting inside the box the countries'
# own mainlands already define, and the cheapest thing rejected asks 77 times its
# area. Anything from about 1 to 70 gives the identical map. That is worth knowing
# before trusting the number on a continent where it does have to arbitrate.
#
# This replaces a hand-drawn lon/lat window. The window worked but every bound
# was a number somebody chose, and it was wrong about the Azores: the eastern
# islands sit inside a box drawn to admit Iceland. A ratio has no bounds to
# choose and will carry to the next continent unchanged.
MARGIN = 25.0

# Not a filter any more — a sanity check on the pieces that are kept
# unconditionally. If a country's main landmass ever falls outside this, either
# the source data has changed or the country does not belong on this map, and
# both should stop the build rather than quietly reshape it.
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
# Every piece of every country, projected once so relative sizes are true, and
# tagged with which country it belongs to.
pieces = []
order = []
for g in topo['objects']['countries']['geometries']:
    c = by_code.get(g.get('id'))
    if not c:
        continue
    name = c['name']['common']
    raw = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]
    for poly in raw:
        lls = [ring_pts(r) for r in poly]
        xy = [[project(x, y) for x, y in ring] for ring in lls]
        pieces.append({'of': name, 'arcs': poly, 'lonlat': lls, 'xy': xy,
                       'area': area(xy[0])})
    order.append(name)

missing = sorted(set(c['name']['common'] for c in ours) - set(order))
assert not missing, f'no geometry for {missing}'
order.sort()


def centre_lonlat(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def box_of(polys):
    xs = [x for poly in polys for ring in poly for x, y in ring]
    ys = [y for poly in polys for ring in poly for x, y in ring]
    return min(xs), min(ys), max(xs), max(ys)


def box_area(b):
    return (b[2] - b[0]) * (b[3] - b[1])


# The mainlands: one per country, the largest piece, kept whatever it costs.
main = {}
for pc in pieces:
    if pc['area'] > main.get(pc['of'], {'area': -1})['area']:
        main[pc['of']] = pc
assert len(main) == len(order), 'a country with no pieces'

for name, pc in main.items():
    lon, lat = centre_lonlat(pc['lonlat'][0])
    assert (WINDOW['lon'][0] <= lon <= WINDOW['lon'][1]
            and WINDOW['lat'][0] <= lat <= WINDOW['lat'][1]), \
        f'{name} has its main landmass at {lon:.1f},{lat:.1f}, outside Europe'

kept = list(main.values())
box = box_of([pc['xy'] for pc in kept])

rest = sorted((pc for pc in pieces if pc not in kept),
              key=lambda pc: (-pc['area'], pc['of']))
dropped = []
for pc in rest:
    grown = box_of([pc['xy'], [[(box[0], box[1]), (box[2], box[3])]]])
    cost = box_area(grown) - box_area(box)
    if cost <= MARGIN * pc['area']:
        kept.append(pc)
        box = grown
    else:
        dropped.append((pc['of'], cost / pc['area']))

print(f'    {len(kept)} landmasses kept, {len(dropped)} too costly for the frame')
for nm in sorted({d[0] for d in dropped}):
    n = sum(1 for d in dropped if d[0] == nm)
    worst = max(d[1] for d in dropped if d[0] == nm)
    print(f'      {nm}: {n} dropped, up to {worst:.0f}x their area in frame')

lonlat, geoms = {}, {}
for pc in kept:
    lonlat.setdefault(pc['of'], []).append(pc['lonlat'])
    geoms.setdefault(pc['of'], []).append(pc['arcs'])

proj = {n: [pc['xy'] for pc in kept if pc['of'] == n] for n in order}
flat = [poly for n in order for poly in proj[n]]
placed, _, _ = normalise(flat)

regions, i = [], 0
for n in order:
    k = len(proj[n])
    regions.append(region(n, placed[i:i + k], panel=0, tol=TOL, places=0,
                          dot=DOT))
    i += k

# Measured from the regions rather than from the projection they came out of:
# a mark reaches further than the country under it, and the layout packs by
# this box. See ink_box().
_, _, pw, ph = ink_box(regions)
panels = [{'id': 'mainland', 'w': round(pw, 1), 'h': round(ph, 1),
           'km': round(span_km([p for n in order for p in lonlat[n]]))}]

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

marks = sorted(r['n'] for r in regions if r.get('dot'))
print(f'    {len(marks)} drawn as marks: ' + ', '.join(marks))

emit('eu.json', panels, regions, ABBR, groups=groups,
     meta={'source': 'world-atlas v2.0.2 (ISC), from Natural Earth 1:50m; '
                     'names, capitals and groupings from mledoze/countries'})
