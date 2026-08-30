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
    """A compass rose: four long cardinal points, four short ordinals, a ring.

    Drawn rather than typed, for the same reason the star is — no font has to
    have it, and it is identical in both themes and at any size.
    """
    return ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40' "
        "width='40' height='40'>"
        f"<g fill='{colour}'>"
        "<path d='M20 1 22.2 17.8 20 20 17.8 17.8Z'/>"
        "<path d='M20 39 17.8 22.2 20 20 22.2 22.2Z'/>"
        "<path d='M1 20 17.8 17.8 20 20 17.8 22.2Z'/>"
        "<path d='M39 20 22.2 22.2 20 20 22.2 17.8Z'/></g>"
        f"<g fill='{faint}'>"
        "<path d='M31.6 8.4 23 17 20 20 22.1 14.9Z'/>"
        "<path d='M8.4 31.6 17 23 20 20 17.9 25.1Z'/>"
        "<path d='M31.6 31.6 23 23 20 20 25.1 22.1Z'/>"
        "<path d='M8.4 8.4 17 17 20 20 14.9 17.9Z'/></g>"
        f"<circle cx='20' cy='20' r='3.2' fill='none' stroke='{colour}'"
        " stroke-width='1.3'/></svg>")


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
