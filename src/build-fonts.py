#!/usr/bin/env python3
"""Cut the three type families down to what the game can display, into data/fonts.

The game is one HTML file with no network calls, so a font has to be embedded,
and an embedded font is paid for on every load by everyone. Google's originals
carry Cyrillic, Greek, Vietnamese and a full Latin Extended — thousands of
glyphs for a game whose entire vocabulary is place names in Latin script. So
they are subset here, once, and the result is committed like the map data.

Needs the upstream files, which are not in the repo:

    mkdir -p /tmp/fontsrc && cd /tmp/fontsrc
    B=https://raw.githubusercontent.com/google/fonts/main/ofl
    curl -LO $B/ebgaramond/EBGaramond%5Bwght%5D.ttf
    curl -LO $B/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf
    curl -LO $B/cinzel/Cinzel%5Bwght%5D.ttf
    curl -LO $B/pinyonscript/PinyonScript-Regular.ttf
    pip install fonttools brotli
    python3 src/build-fonts.py /tmp/fontsrc

All three are SIL OFL 1.1, which permits subsetting and embedding and asks for
the licence to travel with the font. It does; see data/fonts/LICENSE-*, which
ATTRIBUTION.md points at and which must not be removed. OFL also forbids selling
the font on its own and requires that a modified copy not use the reserved name
— neither of which a subset embedded in a game comes near, but the renamed
family is spelled out below anyway so nobody has to wonder.

The first two are variable fonts. A weight is pinned rather than shipping the
axis, because two static cuts are smaller than one variable face carrying every
weight between them, and the design asks for exactly two.
"""
import pathlib
import shutil
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'fonts'

# What to keep. Ranges rather than the exact characters the data happens to use
# today: a subset cut to the current three maps would go wrong the first time a
# geography arrives with a letter nobody thought about, and the failure mode is
# a place name rendered in a fallback face, which is subtle enough to ship.
#
# Latin-1 and Extended-A cover western and central Europe; Extended-B is there
# for Romanian's comma-below s and t, which are the two letters already in the
# data that Extended-A does not have. The punctuation is the typography the
# stylesheet and the copy actually use: en and em dashes, real quotes, the
# ellipsis, the minus sign the score is written with, and the bullet.
RANGES = [
    (0x0020, 0x007E),      # basic latin
    (0x00A0, 0x00FF),      # latin-1 supplement
    (0x0100, 0x017F),      # latin extended-A
    (0x0218, 0x021B),      # s and t with comma below, for Romanian
    (0x2010, 0x2015),      # hyphens and dashes
    (0x2018, 0x201E),      # quotes
    (0x2020, 0x2022),      # dagger, bullet
    (0x2026, 0x2026),      # ellipsis
    (0x2039, 0x203A),      # single angle quotes
    (0x2044, 0x2044),      # fraction slash
    (0x2212, 0x2212),      # minus, which is not a hyphen
    (0x20AC, 0x20AC),      # euro
]

# family, source file, [(weight, output name)], and the OpenType features to
# keep. Everything not named here is dropped: a subsetter left to itself keeps
# every feature the face has, and EB Garamond has a great many that this game
# will never ask for.
#
# kern and liga are wanted everywhere. onum/lnum/tnum are EB Garamond's figure
# sets: its default figures are old-style, which is right in a sentence and
# wrong in a column of times that has to line up, so both sets have to survive
# for font-variant-numeric to have anything to switch to.
FEATURES = 'kern,liga,clig,ccmp,mark,mkmk,locl,onum,lnum,tnum'

# Small capitals are not in that list on purpose. EB Garamond has a real set and
# it is lovely, and it is also two hundred extra glyphs in every weight for an
# effect this design gets from Cinzel, which is a capitals face already.

# Latin-1 is as far as a family needs to reach if it only ever sets the game's
# own words. Cinzel sets headings, which are English plus one accent in "FIND
# THIS DÉPARTEMENT"; Pinyon sets one line and nothing else, ever. Only Garamond
# has to be ready for a place name, so only Garamond pays for the full ranges.
HEADINGS = [r for r in RANGES if r[0] < 0x0100 or r[0] >= 0x2000]
# Letters and the few marks a line of English can contain. A script face carries
# heavy outlines — Pinyon's punctuation and figures cost more than they would in
# a text face, and this one is never asked to set a number. check.py holds the
# tagline to what is kept here, so falling outside it is a failure and not a
# line that quietly renders in the wrong face.
ONE_LINE = [(0x0041, 0x005A), (0x0061, 0x007A), (0x0020, 0x0020),
            (0x0027, 0x0027), (0x002C, 0x002E), (0x2019, 0x2019)]

FAMILIES = [
    # Display capitals, cut from the Trajan tradition. Used for the wordmark and
    # the small letterspaced labels, which is all it is good for: Cinzel's
    # lowercase are small capitals, so it can only ever set headings.
    # One cut, at 600. Everything this face sets is either a heading or a small
    # letterspaced label, and at 11px with .2em of tracking Cinzel at 400 was
    # thin enough that a label read as a rule with some words on it. There is no
    # 400 to fall back to and nothing wants one: a second cut would be 34KB to
    # ship two weights of a face that only ever says four words at a time.
    ('Mappa Cinzel', 'Cinzel[wght].ttf',
     [(600, 'cinzel-600')], HEADINGS),
    # The book face: everything that is read rather than glanced at.
    ('Mappa Garamond', 'EBGaramond[wght].ttf',
     [(400, 'garamond-400'), (600, 'garamond-600')], RANGES),
    ('Mappa Garamond', 'EBGaramond-Italic[wght].ttf',
     [(400, 'garamond-400i')], RANGES),
    # One line of the game is set in this and nothing else is, so it gets one
    # weight and the tightest subset of the three.
    ('Mappa Pinyon', 'PinyonScript-Regular.ttf', [(400, 'pinyon-400')], ONE_LINE),
]

LICENCES = [
    ('ebgaramond', 'LICENSE-EBGaramond.txt'),
    ('cinzel', 'LICENSE-Cinzel.txt'),
    ('pinyonscript', 'LICENSE-PinyonScript.txt'),
]


def unicodes(ranges):
    out = []
    for lo, hi in ranges:
        out.extend(range(lo, hi + 1))
    return out


def build(srcdir):
    src = pathlib.Path(srcdir)
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0

    for family, filename, cuts, ranges in FAMILIES:
        path = src / filename
        if not path.exists():
            sys.exit(f'missing {path} — see this script\'s docstring')
        for weight, stem in cuts:
            font = TTFont(path)
            if 'fvar' in font:
                # Pin the axis. keep_optional_axes off, so what comes out is a
                # static face and not a variable one with a single position.
                font = instancer.instantiateVariableFont(font, {'wght': weight})
            opts = subset.Options()
            opts.layout_features = FEATURES.split(',')
            opts.flavor = 'woff2'
            opts.desubroutinize = True
            opts.drop_tables += ['DSIG']
            opts.name_IDs = [1, 2, 3, 4, 6]     # family, style, unique, full, ps
            opts.name_legacy = False
            opts.notdef_outline = True
            opts.recalc_bounds = True
            sub = subset.Subsetter(options=opts)
            sub.populate(unicodes=unicodes(ranges))
            sub.subset(font)
            # OFL: a modified copy must not carry the reserved font name. These
            # are modified copies — instanced and subset — so they are renamed,
            # which also keeps them from colliding with a system install of the
            # real thing.
            rename(font, family)
            dest = OUT / f'{stem}.woff2'
            font.flavorData = None
            font.save(dest)
            total += dest.stat().st_size
            print(f'  {dest.name}: {dest.stat().st_size:,} bytes, '
                  f'{len(font.getGlyphOrder())} glyphs')

    for folder, name in LICENCES:
        got = src / folder / 'OFL.txt'
        if got.exists():
            shutil.copy(got, OUT / name)
        elif not (OUT / name).exists():
            print(f'  ! {name} not found in {src} and not already in data/fonts')

    print(f'  {total:,} bytes of type in total')


def rename(font, family):
    """Give the subset its own family name, as the OFL asks."""
    name = font['name']
    for rec in name.names:
        if rec.nameID in (1, 16):
            rec.string = family
        elif rec.nameID == 4:
            rec.string = family
        elif rec.nameID in (3, 6):
            rec.string = family.replace(' ', '')


if __name__ == '__main__':
    build(sys.argv[1] if len(sys.argv) > 1 else '/tmp/fontsrc')
