#!/usr/bin/env python3
"""Build data/us.json from the us-atlas TopoJSON.

Needs package/states-albers-10m.json:
    npm pack us-atlas@3 && tar xzf us-atlas-3.0.1.tgz
"""
import json
from geo import ROOT, region, emit, normalise, bounds, simplify

ABBR = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN',
    'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE',
    'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
    'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
    'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR',
    'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA',
    'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
}

d = json.load(open(ROOT / 'package' / 'states-albers-10m.json'))
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

# One panel. Albers USA already composites Alaska and Hawaii into the frame at
# fixed positions, and that arrangement is worth keeping — so the US has a
# mainland panel and no insets. A geography can do either: bake its insets into
# one panel, or hand them over and let the layout place them.
polys_by_name, order = {}, []
for g in d['objects']['states']['geometries']:
    name = g['properties']['name']
    if name == 'District of Columbia':
        continue
    raw = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]
    polys_by_name[name] = [[ring_pts(r) for r in poly] for poly in raw]
    order.append(name)

flat = [poly for name in order for poly in polys_by_name[name]]
placed, pw, ph = normalise(flat)
i = 0
regions = []
for name in order:
    n = len(polys_by_name[name])
    regions.append(region(name, placed[i:i + n], panel=0))
    i += n

# --- grouping outlines, dissolved exactly ---------------------------------
# TopoJSON neighbours share arc indices, so the outline of a set of states is
# every arc the set uses an odd number of times: an arc between two members is
# used twice and is interior, one on the edge is used once. No geometry needs
# comparing, which is what makes this exact — the same trick cannot work on the
# French data, where each region was simplified independently and a shared
# border became two slightly different polylines.
import csv
from collections import Counter

div = {}
for row in csv.DictReader(open(ROOT / 'package-clues' / 'census.csv')):
    div[row['State']] = row['Division']

arc_use = {}
for g in d['objects']['states']['geometries']:
    name = g['properties']['name']
    if name not in polys_by_name:
        continue
    raw = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]
    idxs = [i for poly in raw for ring in poly for i in ring]
    arc_use.setdefault(div[name], Counter()).update(abs(i) if i >= 0 else ~i
                                                    for i in idxs)

# the same normalising transform the regions went through
bx0, by0, bx1, by1 = bounds(flat)
scale = 1000.0 / max(bx1 - bx0, by1 - by0)

groups = {}
for gname, uses in arc_use.items():
    edge = [a for a, n in uses.items() if n % 2 == 1]
    parts = []
    for a in edge:
        pts = [((x - bx0) * scale, (y - by0) * scale) for x, y in arcs[a]]
        pts = simplify(pts, 0.45)
        if len(pts) > 1:
            parts.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in pts))
    groups[gname] = {'p': 0, 'd': ''.join(parts)}
assert len(groups) == 9, f'expected 9 census divisions, got {len(groups)}'

emit('us.json', [{'id': 'mainland', 'w': round(pw, 1), 'h': round(ph, 1),
                  'km': 4600}],
     regions, ABBR, groups=groups,
     meta={'source': 'us-atlas v3.0.1 (ISC), US Census Bureau boundaries'})
