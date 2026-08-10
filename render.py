#!/usr/bin/env python3
"""Render a geography as the game would show it, so layout can be looked at.

Not part of the build. This exists because every earlier layout decision here
was made by measuring numbers and hoping, and some of them were wrong in ways a
glance would have caught immediately.

    python3 render.py fr 390 780      # a phone, portrait
    python3 render.py fr 1440 900     # a laptop
    python3 render.py us 390 780

It reproduces what the map area actually gets: the viewport minus the header and
footer, then the view box fitted inside that with preserveAspectRatio meet,
which is where the wasted space shows up.
"""
import json, pathlib, sys
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent
INK = (10, 14, 23)
LAND = (38, 52, 74)
EDGE = (10, 14, 23)
PANEL = (17, 24, 35)
LINE = (31, 42, 58)
FRAME = (255, 194, 75)


def rings(d):
    out = []
    for part in d.split('M'):
        if not part:
            continue
        out.append([tuple(map(float, q.split(',')))
                    for q in part.rstrip('Z').split('L')])
    return out


def render(geo, vw, vh, scale=2, show_frame=True):
    data = json.loads((ROOT / 'data' / f'{geo}.json').read_text())
    vx, vy, bw, bh = map(float, data['viewBox'].split())

    # the chrome the real page has, from style.css
    header = 94 if vw <= 600 else 76
    footer = 52 if vw <= 600 else 48
    pad = 10
    area_w, area_h = vw - pad * 2, vh - header - footer - pad * 2

    s = min(area_w / bw, area_h / bh)                     # meet
    ox = pad + (area_w - bw * s) / 2 - vx * s
    oy = header + pad + (area_h - bh * s) / 2 - vy * s

    img = Image.new('RGB', (vw * scale, vh * scale), INK)
    dr = ImageDraw.Draw(img)
    dr.rectangle([0, 0, vw * scale, header * scale], fill=PANEL)
    dr.rectangle([0, (vh - footer) * scale, vw * scale, vh * scale], fill=PANEL)
    dr.line([0, header * scale, vw * scale, header * scale], fill=LINE, width=scale)
    dr.line([0, (vh - footer) * scale, vw * scale, (vh - footer) * scale],
            fill=LINE, width=scale)

    if show_frame:      # the view box itself, to make wasted space visible
        dr.rectangle([ox * scale, oy * scale,
                      (ox + bw * s) * scale, (oy + bh * s) * scale],
                     outline=(60, 48, 24), width=scale)

    for r in data['regions']:
        for ring in rings(r['d']):
            pts = [((x * s + ox) * scale, (y * s + oy) * scale) for x, y in ring]
            if len(pts) >= 3:
                dr.polygon(pts, fill=LAND, outline=EDGE)

    used = [(x * s + ox, y * s + oy) for r in data['regions']
            for ring in rings(r['d']) for x, y in ring]
    ux0 = min(p[0] for p in used); ux1 = max(p[0] for p in used)
    uy0 = min(p[1] for p in used); uy1 = max(p[1] for p in used)
    fill = ((ux1 - ux0) * (uy1 - uy0)) / (area_w * area_h)
    out = ROOT / f'/tmp/render-{geo}-{vw}x{vh}.png'
    img.save(out)
    print(f'{out}')
    print(f'  map area {area_w:.0f}x{area_h:.0f}px   view box {bw:.0f}x{bh:.0f} '
          f'at {s:.3f} px/unit')
    print(f'  ink bounding box covers {fill*100:.0f}% of the available map area')
    return out


if __name__ == '__main__':
    geo = sys.argv[1] if len(sys.argv) > 1 else 'fr'
    vw = int(sys.argv[2]) if len(sys.argv) > 2 else 390
    vh = int(sys.argv[3]) if len(sys.argv) > 3 else 780
    render(geo, vw, vh)
