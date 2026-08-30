#!/usr/bin/env python3
"""The procedural textures, as SVG anyone can read.

None of these is an image. Paper, foxing, sea swell, wave crests and the two
brass marks are SVG filters and paths, which is why they tile seamlessly, cost a
few hundred bytes each and belong to nobody.

They used to live in style.css as data URIs — eighteen lines of a thousand
percent-encoded characters, unreadable and undiffable, and changing one meant
writing a throwaway script with its own encoder. That went wrong twice, both
times silently:

  * A '%23' written into the SVG source and then percent-encoded came out as
    '%2523', which is the literal text "%23" in the URL. An invalid colour draws
    nothing, or black. The wave crests were invisible for three rounds and the
    divider star was black instead of brass, and neither said a word.

  * SVG is XML, so `fill=none` without quotes is a parse error and the whole
    file fails. Again silently: the element simply does not draw.

So there is one encoder here, it takes raw colours and quotes its own
attributes, and it refuses to emit anything that shows either symptom. A build
that would have produced a broken texture now stops instead.
"""
import re
import urllib.parse


def uri(svg):
    """An SVG as a data URI safe to drop anywhere in CSS.

    Left unquoted, with everything percent-encoded — including the quotes inside
    it — so there is no character left that could end an attribute, a string, or
    the url() itself.
    """
    assert '%' not in svg, (
        'percent signs go in raw and are encoded here exactly once; a "%23" '
        'written into the source becomes "%2523", which is not a colour')
    for attr in re.findall(r'\s([a-zA-Z-]+)=([^\s>]+)', svg):
        assert attr[1][0] == "'", (
            f'{attr[0]}={attr[1]} is unquoted, and SVG is XML: one unquoted '
            f'attribute fails the whole file, and it fails it silently')
    out = 'url(data:image/svg+xml,%s)' % urllib.parse.quote(svg, safe='/:=?')
    assert '%25' not in out, 'double-encoded: ' + out[:120]
    return out


def svg(w, h, body, extra=''):
    return (f"<svg xmlns='http://www.w3.org/2000/svg' width='{w}' height='{h}'"
            f"{extra}>{body}</svg>")


def turbulence(fid, freq, octaves, seed, matrix='', transfer=''):
    """One patch of fractal noise. stitchTiles is what makes it tile."""
    return (f"<filter id='{fid}'>"
            f"<feTurbulence type='fractalNoise' baseFrequency='{freq}'"
            f" numOctaves='{octaves}' seed='{seed}' stitchTiles='stitch'/>"
            f"{matrix or chr(60) + 'feColorMatrix type=' + chr(39) + 'saturate'
                          + chr(39) + ' values=' + chr(39) + '0' + chr(39) + '/>'}"
            f"{transfer}</filter>")


def _fade(slope, intercept):
    return (f"<feComponentTransfer><feFuncA type='linear' slope='{slope}'"
            f" intercept='{intercept}'/></feComponentTransfer>")


# ---- paper ---------------------------------------------------------------
# Two scales of the same noise: a coarse mottle and a fine vertical fibre, which
# is what a sheet of rag paper is under a lamp.
PARCHMENT = svg(420, 420,
    turbulence('m', '.016', 5, 7, transfer=_fade('.6', '-.06'))
    + turbulence('f', '.85 .05', 2, 3)
    + "<rect width='420' height='420' filter='url(#m)' opacity='.30'/>"
    + "<rect width='420' height='420' filter='url(#f)' opacity='.07'/>")

# The sparse warm blooms an old sheet picks up, at a frequency low enough to
# read as staining rather than as grain.
FOXING = svg(600, 600,
    turbulence('s', '.006', 3, 19,
        matrix="<feColorMatrix type='matrix' values='0 0 0 0 .40  0 0 0 0 .27"
               "  0 0 0 0 .12  0 0 0 -1.5 .70'/>")
    + "<rect width='600' height='600' filter='url(#s)' opacity='.42'/>")

# ---- water ---------------------------------------------------------------
# The long roll of the sea, stretched along one axis the way a swell is.
SWELL = svg(700, 700,
    turbulence('w', '.0032 .0075', 4, 11, transfer=_fade('.75', '-.30'))
    + "<rect width='700' height='700' filter='url(#w)' opacity='.42'/>")


def crests(w, h, paths, colour, opacity, width):
    """Wave crests, drawn as the lit face of a ridge rather than whole waves.

    A light grazing the water picks out the near side of each crest and leaves
    the trough dark, so what the eye sees from above is a field of bright
    dashes. None of the paths shares a row or a column with another: the first
    version tiled on a grid you could see.
    """
    marks = ''.join(f"<path d='{d}'/>" for d in paths)
    return svg(w, h,
        f"<g fill='none' stroke='{colour}' stroke-opacity='{opacity}'"
        f" stroke-width='{width}' stroke-linecap='round'>{marks}</g>")


WAVES = crests(83, 61, [
    'M4 8q3.5-2.8 7 0', 'M31 5q4-3.2 8 0', 'M58 11q3-2.4 6 0',
    'M17 21q4.5-3.6 9 0', 'M46 25q3.5-2.8 7 0', 'M70 30q4-3.2 8 0',
    'M7 34q4-3.2 8 0', 'M33 41q3-2.4 6 0', 'M60 45q4.5-3.6 9 0',
    'M21 52q3.5-2.8 7 0', 'M48 56q4-3.2 8 0', 'M74 14q3-2.4 6 0',
], '#DCECFF', '.34', '1.05')

CRESTS = crests(263, 179, [
    'M11 23q11-8 22 0t22 0', 'M132 12q13-9 26 0t26 0',
    'M62 57q12-8.5 24 0t24 0', 'M186 71q11-8 22 0t22 0',
    'M6 96q13-9 26 0t26 0', 'M118 108q12-8.5 24 0t24 0',
    'M210 128q11-8 22 0t22 0', 'M40 141q13-9 26 0t26 0',
    'M150 158q12-8.5 24 0t24 0', 'M88 168q11-8 22 0t22 0',
], '#CFE4FF', '.19', '1.7')


# ---- brass ---------------------------------------------------------------
def star(colour):
    """The four-pointed mark sitting on a divider rule."""
    return svg(18, 14,
        f"<path fill='{colour}' d='M9 0.6 10.6 5.4 15.4 7 10.6 8.6 9 13.4"
        " 7.4 8.6 2.6 7 7.4 5.4Z'/>")


def rose(colour, faint):
    """A pocket compass: a cased rose, not a bare star.

    The star alone read as a sparkle. What makes an instrument look like an
    instrument is the case around it, so this has a bezel with a hairline ruled
    inside it, and a suspension knob at the top and its mirror at the bottom —
    mirrored because the same drawing is used on both sides of Start and an
    asymmetric one would point two different ways.

    Drawn rather than borrowed. There are freely licensed compass roses about,
    but every one of them is a file to attribute, a licence to carry, and a
    shape somebody else chose the weight of; this is nine primitives and it
    inherits the brass it is drawn in.

    Square, 48 by 48, with the case at r=17 and the knobs standing in the
    margin that leaves — so the whole thing still fits a square background-size
    and stays centred whatever it is scaled to.
    """
    return svg(48, 48,
        # the two knobs, top and bottom, each a stem and a ring
        f"<g fill='{colour}'>"
        "<rect x='22.4' y='2.6' width='3.2' height='5' rx='1.1'/>"
        "<rect x='22.4' y='40.4' width='3.2' height='5' rx='1.1'/>"
        "<circle cx='24' cy='2.6' r='2.2'/>"
        "<circle cx='24' cy='45.4' r='2.2'/></g>"
        # the case, and a hairline ruled inside it
        f"<circle cx='24' cy='24' r='17' fill='none' stroke='{colour}'"
        " stroke-width='2'/>"
        f"<circle cx='24' cy='24' r='13.4' fill='none' stroke='{faint}'"
        " stroke-width='1'/>"
        # the four cardinal points, long
        f"<g fill='{colour}'>"
        "<path d='M24 8.4 26 22 24 24 22 22Z'/>"
        "<path d='M24 39.6 22 26 24 24 26 26Z'/>"
        "<path d='M8.4 24 22 22 24 24 22 26Z'/>"
        "<path d='M39.6 24 26 26 24 24 26 22Z'/></g>"
        # and the four ordinals, short
        f"<g fill='{faint}'>"
        "<path d='M33 15 25.7 22.3 24 24 25.7 19.7Z'/>"
        "<path d='M15 33 22.3 25.7 24 24 22.3 28.3Z'/>"
        "<path d='M33 33 25.7 25.7 24 24 28.3 25.7Z'/>"
        "<path d='M15 15 22.3 22.3 24 24 19.7 22.3Z'/></g>"
        # the pivot
        f"<circle cx='24' cy='24' r='2' fill='none' stroke='{colour}'"
        " stroke-width='1.2'/>")


# The textures that are the same in any light. Paper is paper whether a lamp or
# a window is on it, so these are declared once rather than once per theme —
# which is also two fewer places for them to drift apart.
SHARED = {
    'parchment': PARCHMENT,
    'foxing': FOXING,
    'swell': SWELL,
    'waves': WAVES,
    'crests': CRESTS,
}

# And the ones that are a colour, so they belong to a theme.
MARKS = {
    'dark': {
        'star': star('#8A6D2E'),
        'starpale': star('#F3E2B4'),
        'rose': rose('#FBEDC6', 'rgba(251,237,198,.5)'),
    },
    'light': {
        'star': star('#9A7E42'),
        'starpale': star('#FFF3D2'),
        'rose': rose('#FFF4D6', 'rgba(255,244,214,.5)'),
    },
}


def block(names):
    return '\n'.join(f'    --{k}: {uri(v)};' for k, v in names.items())


def shared():
    return block(SHARED)


def marks(theme):
    return block(MARKS[theme])


if __name__ == '__main__':
    total = sum(len(uri(v)) for v in SHARED.values())
    total += sum(len(uri(v)) for m in MARKS.values() for v in m.values())
    print(f'{len(SHARED)} shared textures, {len(MARKS["dark"])} marks per theme, '
          f'{total:,} bytes encoded')


# ---- the window ----------------------------------------------------------
# Where the sunlight is, described once and emitted three ways: the light the
# panes let through, the shadow the frame casts, and a table 15-light.js reads
# to ask how much sun reaches a given button.
#
# They have to agree or the scene contradicts itself — a shadow softened for
# standing in a bar has to be standing in a bar the eye can see. Keeping copies
# in step by hand is exactly what goes wrong quietly, so there are no copies.
WINDOW = {
    'angle': 48,
    'ink': '84,62,32',
    'lit': '255,250,232',
    # Two panes and the frame between them, at the scale a window a few feet
    # from a desk throws: a pane over the top two thirds of the sheet, the
    # glazing bar across it, the second pane behind that, and a sliver of the
    # frame's far edge in the bottom left corner.
    #
    # A bar is (start, end, how dark it paints). How much light it *blocks* is
    # not in that number and must not be read out of it: a frame is opaque, so
    # every bar stops all of the direct light, and one painting lighter than
    # another only means the light it was interrupting was weaker there. Taking
    # the paint alpha for an occlusion fraction is what left a button standing
    # in the second bar still throwing a shadow — the bar paints at .17 against
    # a deepest of .20, so it was credited with blocking 85% of a light it was
    # in fact blocking all of.
    'bars': [(0.240, 0.305, .17), (0.945, 1.000, .20)],
    # Half a percent of the axis: as hard as a gradient gets. A frame a few feet
    # from the paper has a penumbra of a millimetre, and blurring it is the one
    # thing that makes this read as haze rather than as sunlight.
    'edge': 0.006,
    # The direction the light travels, in CSS degrees. One number, and it aims
    # both the shadows every object throws and the fade below — they are the
    # same fact about where the sun is and must not be able to disagree.
    'sun': 124,
    # And the light gives out across the room: a window lights the near part of
    # a desk well and the far part less. Along the direction of travel, because
    # the sun is far enough away that its rays are parallel — there is no point
    # source here to fall off radially from, which is the lamp's business and
    # not the window's. 'to' is a fraction of the axis, and it stops short of
    # nothing, because a room in daylight has no black corner.
    'fade': {'to': .74, 'floor': .22},
    # How much brighter a pane is than the paper under it. Drawing only the bars
    # said the sheet is uniformly bright and occasionally dirty, which is the
    # wrong way round: the window's business is the light, and the frame is what
    # interrupts it.
    'pane': .17,
}


def _gradient(runs, colour):
    """runs is a list of (start, end, alpha) along the axis."""
    e, clear, out = WINDOW['edge'], f"rgba({colour},0)", []
    at = lambda f: f'{max(0, min(1, f)) * 100:.4g}%'
    for a, b, alpha in runs:
        ink = f'rgba({colour},{alpha})'
        out += [f'{ink} 0%'] if a <= 0 else [f'{clear} {at(a)}', f'{ink} {at(a + e)}']
        out += [f'{ink} 100%'] if b >= 1 else [f'{ink} {at(b)}', f'{clear} {at(b + e)}']
    return f"linear-gradient({WINDOW['angle']}deg,\n      " + ',\n      '.join(out) + ')'


def _panes():
    """The gaps between the bars: everywhere the light actually gets through."""
    out, edge = [], 0.0
    for a, b, _ in WINDOW['bars']:
        if a > edge:
            out.append((edge, a, WINDOW['pane']))
        edge = b
    if edge < 1:
        out.append((edge, 1.0, WINDOW['pane']))
    return out


def rays_css():
    """The light the panes let through, and over it the frame's own shadow."""
    return (_gradient(_panes(), WINDOW['lit']) + ',\n      '
            + _gradient(WINDOW['bars'], WINDOW['ink']))


def raysfade_css():
    """How far into the room the window's light gets.

    Linear, along the direction the light travels. Parallel rays do not fall off
    from a point; what dims them is distance into the room, and that runs the
    one way for every ray.
    """
    f = WINDOW['fade']
    return (f"linear-gradient({WINDOW['sun']}deg,"
            f" rgba(0,0,0,1) 0%, rgba(0,0,0,.6) {f['to'] * 45:.4g}%,"
            f" rgba(0,0,0,{f['floor']}) {f['to'] * 100:.4g}%)")


def window_js():
    """The same window, as something 15-light.js can evaluate at a point."""
    f = WINDOW['fade']
    # Only where each bar is. What it does to the light is not a variable:
    # a frame is opaque and stops all of it.
    spans = ','.join(f'[{a},{b}]' for a, b, _ in WINDOW['bars'])
    return (f"{{angle:{WINDOW['angle']},bars:[{spans}],edge:{WINDOW['edge']},"
            f"sun:{WINDOW['sun']},"
            f"fade:{{to:{f['to']},floor:{f['floor']}}}}}")
