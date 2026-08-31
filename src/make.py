#!/usr/bin/env python3
"""Assemble the sources into one self-contained playable file.

The output stays a single HTML file with no external references, which is the
whole point of the project. The split exists for editing, not for shipping:
the CSS, the JS modules and the region data are inlined here, in order.
"""
import base64, json, os, pathlib, subprocess

import textures

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'


# One file per geography, each self-contained: view box, abbreviations, regions.
GEOS = ('us', 'fr', 'eu')
data = {g: (ROOT / 'data' / f'{g}.json').read_text() for g in GEOS}
for g, raw in data.items():
    d = json.loads(raw)
    assert set(d['abbr']) == {r['n'] for r in d['regions']}, f'{g}: names do not match'
    print(f"  {g}: {len(d['regions'])} regions, {len(raw):,} bytes")

# JS modules are concatenated in filename order; the numeric prefixes are the
# load order, and nothing else enforces it.
modules = sorted((SRC / 'js').glob('*.js'))
assert modules, 'no JS modules found'
js = ''.join(m.read_text() for m in modules)

def version():
    """What to stamp on the menu, so a phone can be identified at a glance.

    `git describe` distinguishes the two published channels for free and without
    anything to keep in step: on a tagged commit it is exactly the tag, so stable
    reads v1.0.0, and anywhere after one it gains a commit count and a hash, so
    beta reads v1.0.0-3-g7de86d4. FIFTY_VERSION overrides it for a build made
    outside a checkout.
    """
    if os.environ.get('FIFTY_VERSION'):
        return os.environ['FIFTY_VERSION']
    try:
        out = subprocess.run(['git', 'describe', '--tags', '--always', '--dirty'],
                             cwd=ROOT, capture_output=True, text=True, timeout=10)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return 'unreleased'      # a tarball, or no git available


html = (SRC / 'index.html').read_text()
for token in ('__CSS__', '__JS__', '__VERSION__'):
    assert token in html, f'missing placeholder {token}'
for g in GEOS:
    assert f'__{g.upper()}__' in js, f'missing placeholder __{g.upper()}__'
    assert f'__CLUES_{g.upper()}__' in js, f'missing placeholder __CLUES_{g.upper()}__'


ver = version()


def faces():
    """The @font-face block, with the type inlined.

    A self-contained file cannot link a font, so each face is base64'd into a
    data URI, which costs a third again on top of the woff2. The files are cut
    down to the game's own alphabet by src/build-fonts.py; see its docstring and
    data/fonts/LICENSE-* for what they are and what may be done with them.

    Generated here rather than written into style.css because base64 in the
    stylesheet would make it unreadable and undiffable, and because the src line
    is the one part of a face that depends on how the game is being shipped.
    """
    cuts = [
        # file, family, weight, style
        ('cinzel-400',    'Mappa Cinzel',   400, 'normal'),
        ('cinzel-600',    'Mappa Cinzel',   600, 'normal'),
        ('garamond-400',  'Mappa Garamond', 400, 'normal'),
        ('garamond-600',  'Mappa Garamond', 600, 'normal'),
        ('garamond-400i', 'Mappa Garamond', 400, 'italic'),
        ('pinyon-400',    'Mappa Pinyon',   400, 'normal'),
    ]
    out, total = [], 0
    for stem, family, weight, style in cuts:
        raw = (ROOT / 'data' / 'fonts' / f'{stem}.woff2').read_bytes()
        total += len(raw)
        b64 = base64.b64encode(raw).decode('ascii')
        out.append(
            f"@font-face{{font-family:'{family}';font-style:{style};"
            f"font-weight:{weight};font-display:block;"
            f"src:url(data:font/woff2;base64,{b64}) format('woff2')}}")
    print(f'  type: {len(cuts)} faces, {total:,} bytes before encoding')
    return '\n'.join(out)


html = html.replace('__VERSION__', ver)
css = (SRC / 'style.css').read_text()
for token in ('__FONTS__', '__TEXTURES__', '__MARKS_DARK__', '__MARKS_LIGHT__',
              '__RAYS__', '__RAYSFADE__'):
    assert token in css, f'missing placeholder {token} in style.css'
css = css.replace('__FONTS__', faces())
css = css.replace('__TEXTURES__', textures.shared())
css = css.replace('__MARKS_DARK__', textures.marks('dark'))
css = css.replace('__MARKS_LIGHT__', textures.marks('light'))
# The window, painted by the stylesheet and evaluated by 15-light.js. One table
# in src/textures.py feeds both, because a shadow softened for standing in a bar
# has to be standing in the bar the eye can see.
css = css.replace('__RAYS__', textures.rays_css())
css = css.replace('__RAYSFADE__', textures.raysfade_css())
# The window is described once and emitted twice: as the gradient painted here,
# and as the table 15-light.js evaluates at a point. See src/textures.py.
css = css.replace('__RAYS__', textures.rays_css())
css = css.replace('__RAYSFADE__', textures.raysfade_css())
html = html.replace('__CSS__', css).replace('__JS__', js)
clues = {g: (ROOT / 'data' / f'clues-{g}.json').read_text() for g in GEOS}
for g in GEOS:
    html = html.replace(f'__CLUES_{g.upper()}__', clues[g])
    html = html.replace(f'__{g.upper()}__', data[g])

out = ROOT / 'dist' / 'mappa.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html)
print(f'wrote {out} ({len(html):,} bytes, {len(GEOS)} geographies, '
      f'{len(modules)} modules, version {ver})')
