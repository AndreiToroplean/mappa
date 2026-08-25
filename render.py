#!/usr/bin/env python3
"""Render a geography as the game would show it, so layout can be looked at.

Not part of the build. This exists because every earlier layout decision here
was made by measuring numbers and hoping, and some of them were wrong in ways a
glance would have caught immediately.

    python3 render.py map fr 390 780           # the map area only
    python3 render.py app fr 780 390           # the whole app, chrome included
    python3 render.py app fr 390 780 light     # ...on the other ground

It reproduces what the map area actually gets: the viewport minus the header and
footer, then the view box fitted inside that with preserveAspectRatio meet,
which is where the wasted space shows up.
"""
import math
import json, pathlib, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent

# Read out of the stylesheet rather than copied here. These had drifted into a
# third private palette once already, and the point of this tool is to show what
# the game shows.
CSS = (ROOT / 'src' / 'style.css').read_text()


def palette(theme='dark'):
    head = ':root{' if theme == 'dark' else ':root[data-theme="light"]{'
    i = CSS.index(head)
    block = CSS[i:CSS.index('\n  }', i)]
    out = {}
    for name, hexval in re.findall(r'(--[a-z0-9]+)\s*:\s*(#[0-9A-Fa-f]{6})\b', block):
        out[name] = tuple(int(hexval[k:k + 2], 16) for k in (1, 3, 5))
    if theme != 'dark':                       # a theme only states what it changes
        return {**palette('dark'), **out}
    return out


def use(theme):
    global INK, LAND, EDGE, PANEL, LINE, FRAME, MUTED, TEXT, AMBER
    c = palette(theme)
    # The map area is water, so that is the ground this tool draws on.
    INK, LAND, EDGE = c['--sea'], c['--land'], c['--edge']
    PANEL, LINE, FRAME = c['--panel'], c['--line'], c['--amber']
    MUTED, TEXT, AMBER = c['--muted'], c['--text'], c['--amber']


INK = LAND = EDGE = PANEL = LINE = FRAME = MUTED = TEXT = AMBER = None
use('dark')


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
    # Marks last, the way the game stacks them: a mark sits inside a neighbour
    # and would otherwise be painted over by it, which is what made Liechtenstein
    # and Andorra invisible in this rasteriser while being perfectly visible in
    # the game. A preview that quietly differs from the thing it previews is
    # worse than no preview.
    for r in sorted(data['regions'], key=lambda r: bool(r.get('dot'))):
        at = L['place'][r['p']]
        rings = []
        if r.get('dot'):
            # The game draws a <circle> here; this rasteriser has only polygons,
            # so it approximates one. Finely enough that the preview is honest
            # about size and position, which is all it is consulted for.
            cx = r['l'][0] * at['s'] + at['dx']
            cy = r['l'][1] * at['s'] + at['dy']
            rad = data['mark'] * at['s']
            rings.append([(cx + rad * math.cos(2 * math.pi * i / 64),
                           cy + rad * math.sin(2 * math.pi * i / 64))
                          for i in range(64)])
            regions.append({'n': r['n'], 'rings': rings})
            continue
        for part in r['d'].split('M'):
            if not part:
                continue
            rings.append([(float(a) * at['s'] + at['dx'], float(b) * at['s'] + at['dy'])
                          for a, b in (q.split(',') for q in part.rstrip('Z').split('L'))])
        regions.append({'n': r['n'], 'rings': rings})
    return L, regions


SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'


def font(path, size, scale):
    return ImageFont.truetype(path, int(size * scale))


def paint_map(dr, geo, box, scale, frame=False):
    """Draw the map into a box of CSS pixels: (x, y, w, h).

    The one place the map gets drawn, so the map-only view and the whole-app view
    can never disagree about what the game would actually show.
    """
    x, y, w, h = box
    L, regions = compose(geo, w / h)
    s = min(w / L['W'], h / L['H'])
    ox = x + (w - L['W'] * s) / 2
    oy = y + (h - L['H'] * s) / 2
    if frame:
        dr.rectangle([ox * scale, oy * scale,
                      (ox + L['W'] * s) * scale, (oy + L['H'] * s) * scale],
                     outline=(60, 48, 24), width=scale)
    ink = []
    for r in regions:
        for ring in r['rings']:
            pts = [((px * s + ox) * scale, (py * s + oy) * scale) for px, py in ring]
            ink.extend(pts)
            if len(pts) >= 3:
                dr.polygon(pts, fill=LAND, outline=EDGE)
    x0 = min(p[0] for p in ink) / scale; x1 = max(p[0] for p in ink) / scale
    y0 = min(p[1] for p in ink) / scale; y1 = max(p[1] for p in ink) / scale
    cover = ((x1 - x0) * (y1 - y0)) / (w * h)
    return L, cover


def render(geo, vw, vh, scale=2):
    """Map only: the view used when the question is about the map itself."""
    header = 94 if vw <= 600 else 76
    footer = 52 if vw <= 600 else 48
    pad = 10
    box = (pad, header + pad, vw - pad * 2, vh - header - footer - pad * 2)
    img = Image.new('RGB', (vw * scale, vh * scale), INK)
    dr = ImageDraw.Draw(img)
    dr.rectangle([0, 0, vw * scale, header * scale], fill=PANEL)
    dr.rectangle([0, (vh - footer) * scale, vw * scale, vh * scale], fill=PANEL)
    L, cover = paint_map(dr, geo, box, scale, frame=True)
    out = pathlib.Path(f'/tmp/render-{geo}-{vw}x{vh}.png')
    img.save(out)
    print(f'{out}')
    panels = json.loads((ROOT / 'data' / f'{geo}.json').read_text())['panels']
    pinned = sum(1 for p in panels if p.get('fix'))
    print(f'  map area {box[2]:.0f}x{box[3]:.0f}px  frame {L["W"]:.0f}x{L["H"]:.0f} units'
          f'  insets {L.get("side", "none")}'
          + (f', {pinned} fixed' if pinned else ''))
    print(f'  ink covers {cover*100:.0f}% of the map area')
    return out


def app(geo, vw, vh, scale=2, practice=True):
    """The whole app: chrome, text, buttons, and the real map inside it.

    Layout arguments are settled here rather than in the head, because a sidebar
    that looks obvious in prose can still leave a button unreachable or a map
    squeezed into a letterbox.
    """
    landscape = vw / vh > 1.3
    img = Image.new('RGB', (vw * scale, vh * scale), INK)
    dr = ImageDraw.Draw(img)
    f_eyebrow = font(MONO, 10, scale)
    f_name = font(SANS, 25 if not landscape else 21, scale)
    f_val = font(MONO, 17, scale)
    f_tick = font(MONO, 11, scale)
    f_btn = font(SANS, 12, scale)

    def txt(x, y, s, f, fill=TEXT):
        dr.text((x * scale, y * scale), s, font=f, fill=fill)

    def pill(x, y, w, h, label, colour=AMBER):
        dr.rounded_rectangle([x * scale, y * scale, (x + w) * scale, (y + h) * scale],
                             radius=8 * scale, outline=colour, width=max(1, scale))
        bb = dr.textbbox((0, 0), label, font=f_btn)
        dr.text(((x + (w - bb[2] / scale) / 2) * scale,
                 (y + (h - bb[3] / scale) / 2) * scale), label, font=f_btn, fill=colour)

    if landscape:
        side = min(240, int(vw * 0.30))
        dr.rectangle([0, 0, side * scale, vh * scale], fill=PANEL)
        dr.line([side * scale, 0, side * scale, vh * scale], fill=LINE, width=scale)
        txt(14, 12, 'FIND THIS DÉPARTEMENT', f_eyebrow, MUTED)
        txt(14, 28, 'Tarn', f_name)
        y = 74
        for label, val in (('MISSES', '3'), ('FOUND', '17/101'), ('TIME', '1:05.9')):
            txt(14, y, label, f_eyebrow, MUTED)
            txt(14, y + 15, val, f_val)
            y += 44
        txt(14, vh - 58, 'Miss — that was', f_tick, MUTED)
        txt(14, vh - 44, 'Aveyron', f_tick, AMBER)
        rail = 92
        box = (side + 8, 8, vw - side - rail - 8, vh - 16)
        _, cover = paint_map(dr, geo, box, scale)
        dr.line([(vw - rail) * scale, 0, (vw - rail) * scale, vh * scale],
                fill=LINE, width=scale)
        pill(vw - 48, 12, 38, 38, 'II', MUTED)       # both flush right
        if practice:
            pill(vw - 82, vh - 50, 72, 36, 'Clue')
    else:
        header, footer = 94, 52
        dr.rectangle([0, 0, vw * scale, header * scale], fill=PANEL)
        dr.rectangle([0, (vh - footer) * scale, vw * scale, vh * scale], fill=PANEL)
        txt(14, 12, 'FIND THIS DÉPARTEMENT', f_eyebrow, MUTED)
        txt(14, 28, 'Tarn', f_name)
        x = 14
        for label, val in (('MISSES', '3'), ('FOUND', '17/101'), ('TIME', '1:05.9')):
            txt(x, 62, label, f_eyebrow, MUTED)
            txt(x, 74, val, f_val)
            x += (vw - 90) / 3
        pill(vw - 52, 10, 38, 38, 'II', MUTED)
        txt(14, vh - 42, 'Click the département named above.', f_tick, MUTED)
        if practice:
            pill(vw - 96, vh - 44, 82, 36, 'Clue')
        box = (10, header + 10, vw - 20, vh - header - footer - 20)
        _, cover = paint_map(dr, geo, box, scale)

    out = pathlib.Path(f'/tmp/app-{geo}-{vw}x{vh}.png')
    img.save(out)
    print(f'{out}   {"landscape" if landscape else "portrait"}'
          f'   map covers {cover*100:.0f}% of its area')
    return out


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'map'
    geo = sys.argv[2] if len(sys.argv) > 2 else 'fr'
    vw = int(sys.argv[3]) if len(sys.argv) > 3 else 390
    vh = int(sys.argv[4]) if len(sys.argv) > 4 else 780
    use(sys.argv[5] if len(sys.argv) > 5 else 'dark')
    (app if mode == 'app' else render)(geo, vw, vh)
