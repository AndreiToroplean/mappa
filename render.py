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
import json, pathlib, subprocess, sys
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent
INK = (10, 14, 23)
LAND = (38, 52, 74)
EDGE = (10, 14, 23)
PANEL = (17, 24, 35)
LINE = (31, 42, 58)
FRAME = (255, 194, 75)


LAYOUT_JS = None


def compose(geo, aspect):
    """Compose a geography for an aspect ratio, using the game's own layout code.

    Shelling out to node keeps one implementation of the layout: a Python copy
    would be a second thing to keep in step, and the whole point of this file is
    to check what the real thing does.
    """
    global LAYOUT_JS
    if LAYOUT_JS is None:
        src = (ROOT / 'src' / 'js' / '02-map.js').read_text()
        LAYOUT_JS = src[src.index('const SHORT ='):src.index('/* ---- composing')]
    data = json.loads((ROOT / 'data' / f'{geo}.json').read_text())
    script = (LAYOUT_JS + "\nconst d = " + json.dumps(data) + ";\n"
              "console.log(JSON.stringify(chooseLayout(" + repr(aspect) + ", d.panels)));")
    out = pathlib.Path('/tmp/layout-probe.js')
    out.write_text(script)
    res = subprocess.run(['node', str(out)], capture_output=True, text=True)
    if res.returncode:
        raise SystemExit(res.stderr)
    L = json.loads(res.stdout)
    regions = []
    for r in data['regions']:
        at = L['place'][r['p']]
        rings = []
        for part in r['d'].split('M'):
            if not part:
                continue
            rings.append([(float(a) * at['s'] + at['dx'], float(b) * at['s'] + at['dy'])
                          for a, b in (q.split(',') for q in part.rstrip('Z').split('L'))])
        regions.append({'n': r['n'], 'rings': rings})
    return L, regions


def render(geo, vw, vh, scale=2):
    header = 94 if vw <= 600 else 76
    footer = 52 if vw <= 600 else 48
    pad = 10
    area_w, area_h = vw - pad * 2, vh - header - footer - pad * 2

    L, regions = compose(geo, area_w / area_h)
    s = min(area_w / L['W'], area_h / L['H'])
    ox = pad + (area_w - L['W'] * s) / 2
    oy = header + pad + (area_h - L['H'] * s) / 2

    img = Image.new('RGB', (vw * scale, vh * scale), INK)
    dr = ImageDraw.Draw(img)
    dr.rectangle([0, 0, vw * scale, header * scale], fill=PANEL)
    dr.rectangle([0, (vh - footer) * scale, vw * scale, vh * scale], fill=PANEL)
    dr.line([0, header * scale, vw * scale, header * scale], fill=LINE, width=scale)
    dr.line([0, (vh - footer) * scale, vw * scale, (vh - footer) * scale],
            fill=LINE, width=scale)
    dr.rectangle([ox * scale, oy * scale,
                  (ox + L['W'] * s) * scale, (oy + L['H'] * s) * scale],
                 outline=(60, 48, 24), width=scale)

    ink = []
    for r in regions:
        for ring in r['rings']:
            pts = [((x * s + ox) * scale, (y * s + oy) * scale) for x, y in ring]
            ink.extend(pts)
            if len(pts) >= 3:
                dr.polygon(pts, fill=LAND, outline=EDGE)

    x0 = min(p[0] for p in ink) / scale; x1 = max(p[0] for p in ink) / scale
    y0 = min(p[1] for p in ink) / scale; y1 = max(p[1] for p in ink) / scale
    out = pathlib.Path(f'/tmp/render-{geo}-{vw}x{vh}.png')
    img.save(out)
    print(f'{out}')
    print(f'  map area {area_w:.0f}x{area_h:.0f}px  frame {L["W"]:.0f}x{L["H"]:.0f} units'
          f'  insets {L.get("side", "none")}')
    print(f'  ink covers {((x1-x0)*(y1-y0))/(area_w*area_h)*100:.0f}% of the map area')
    return out


if __name__ == '__main__':
    geo = sys.argv[1] if len(sys.argv) > 1 else 'fr'
    vw = int(sys.argv[2]) if len(sys.argv) > 2 else 390
    vh = int(sys.argv[3]) if len(sys.argv) > 3 else 780
    render(geo, vw, vh)
