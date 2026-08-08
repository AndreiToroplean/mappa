#!/usr/bin/env python3
"""Decode the us-atlas TopoJSON into SVG paths, one per state.

Also records a centre point and an overall extent per state, used to place
abbreviation labels and to size tap targets for the small ones.
"""
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent

d = json.load(open(ROOT / 'package' / 'states-albers-10m.json'))
sc, tr = d['transform']['scale'], d['transform']['translate']

# arcs are delta-encoded against a quantised grid
arcs = []
for arc in d['arcs']:
    x = y = 0
    pts = []
    for dx, dy in arc:
        x += dx; y += dy
        pts.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
    arcs.append(pts)

def ring_pts(idxs):
    """Stitch arcs into a ring. A negative index means traverse in reverse."""
    out = []
    for i in idxs:
        a = arcs[~i][::-1] if i < 0 else arcs[i]
        out.extend(a[1:] if out else a)
    return out

def simplify(pts, tol=0.45):
    if len(pts) < 4:
        return pts
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

def path(geom):
    polys = geom['arcs'] if geom['type'] == 'MultiPolygon' else [geom['arcs']]
    dstr = []
    for poly in polys:
        rings = [ring_pts(r) for r in poly]
        if area(rings[0]) < 1.2:   # drop specks smaller than ~1.2 sq px
            continue
        for r in rings:
            r = simplify(r)
            dstr.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in r) + 'Z')
    return ''.join(dstr)

states = []
for g in d['objects']['states']['geometries']:
    name = g['properties']['name']
    if name == 'District of Columbia':
        continue
    dstr = path(g)
    pts = [tuple(map(float, p.split(','))) for p in
           re.findall(r'-?[\d.]+,-?[\d.]+', dstr)]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    states.append({
        'n': name,
        'd': dstr,
        'c': [round((minx+maxx)/2, 1), round((miny+maxy)/2, 1)],
        's': round(max(maxx-minx, maxy-miny), 1),
    })

states.sort(key=lambda s: s['n'])
out = ROOT / 'data' / 'states.json'
out.parent.mkdir(exist_ok=True)
json.dump(states, open(out, 'w'), separators=(',', ':'))
print(f'{len(states)} states -> {out}')
