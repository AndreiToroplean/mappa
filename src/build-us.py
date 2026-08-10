#!/usr/bin/env python3
"""Build data/us.json from the us-atlas TopoJSON.

Needs package/states-albers-10m.json:
    npm pack us-atlas@3 && tar xzf us-atlas-3.0.1.tgz
"""
import json
from geo import ROOT, region, emit

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

regions = []
for g in d['objects']['states']['geometries']:
    name = g['properties']['name']
    if name == 'District of Columbia':
        continue
    polys = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]
    regions.append(region(name, [[ring_pts(r) for r in poly] for poly in polys]))

# Albers USA is already laid out with Alaska and Hawaii in their insets, so the
# view box is just the frame that has always been used.
emit('us.json', '-60 10 1020 600', regions, ABBR,
     meta={'source': 'us-atlas v3.0.1 (ISC), US Census Bureau boundaries'})
