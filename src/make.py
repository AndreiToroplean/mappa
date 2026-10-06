#!/usr/bin/env python3
"""Assemble the sources into one self-contained playable file.

The output stays a single HTML file with no external references, which is the
whole point of the project. The split exists for editing, not for shipping:
the CSS, the JS modules and the region data are inlined here, in order.
"""
import base64, json, os, pathlib, subprocess, urllib.parse

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
for token in ('__CSS__', '__JS__', '__VERSION__', '__FAVICON__'):
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
        # One Cinzel, declared across the range rather than at the weight it
        # was cut at. There is nothing else for a request to match, and a face
        # declared at 600 alone would have the browser synthesise anything that
        # asked for less — which is a smear of an already-heavy face.
        ('cinzel-600',    'Mappa Cinzel',   '400 700', 'normal'),
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
# The tab icon, inlined so the lone file has one too. Percent-encoded whole,
# which leaves nothing that could end the attribute it sits in.
html = html.replace('__FAVICON__', 'data:image/svg+xml,'
                    + urllib.parse.quote(textures.icon(), safe='/:=?'))
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


# ---- the installable site ------------------------------------------------
# mappa.html stays whole and plays from a file on its own. Installing it on a
# phone's home screen is a different thing that needs a few files beside it,
# because a browser will only take a manifest as a URL of its own. The
# manifest says what the icon and the name are and that it opens full screen.
# dist/web is exactly what is published to one channel, page renamed to
# index.html.
#
# Deliberately no service worker. The icon is a shortcut to the live site, so
# an installed copy is always the current release; the price is that it needs a
# connection to open, which was judged not worth a worker to avoid.
#
# MAPPA_CHANNEL is set by the publish workflow. Beta gets its own name so that
# both can sit on one home screen and be told apart.
beta = os.environ.get('MAPPA_CHANNEL') == 'beta'
manifest = {
    'name': 'Mappa Beta' if beta else 'Mappa — The World from Memory',
    'short_name': 'Mappa β' if beta else 'Mappa',
    'description': "You're named a place, you tap it on the map.",
    # Relative, so the same files work at the root and under /beta/, and each
    # channel installs as its own app: an app's identity defaults to start_url.
    'start_url': './',
    'scope': './',
    # Fullscreen hides the status bar as well as the browser on Android. iOS
    # does not do fullscreen and falls back to standalone, which still has no
    # browser bar — the same as the game's own full screen button, permanently.
    'display': 'fullscreen',
    'background_color': '#151007',     # --base, so the splash is the page
    'theme_color': '#1E1810',          # --panel, as the page's theme-color
    'icons': [
        {'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png', 'purpose': 'any'},
        {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any'},
        {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
    ],
}
web = ROOT / 'dist' / 'web'
web.mkdir(exist_ok=True)
(web / 'index.html').write_text(html)
(web / 'manifest.webmanifest').write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
for icon in ('icon-192.png', 'icon-512.png', 'apple-touch-icon.png'):
    (web / icon).write_bytes((ROOT / 'data' / 'icons' / icon).read_bytes())
print(f'wrote {web}/ ({"beta" if beta else "stable"} manifest, 3 icons)')
