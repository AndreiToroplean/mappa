#!/usr/bin/env python3
"""Assemble the sources into one self-contained playable file.

The output stays a single HTML file with no external references, which is the
whole point of the project. The split exists for editing, not for shipping:
the CSS, the JS modules and the region data are inlined here, in order.
"""
import json, os, pathlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'


# One file per geography, each self-contained: view box, abbreviations, regions.
GEOS = ('us', 'fr')
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
html = html.replace('__VERSION__', ver)
html = html.replace('__CSS__', (SRC / 'style.css').read_text()).replace('__JS__', js)
clues = {g: (ROOT / 'data' / f'clues-{g}.json').read_text() for g in GEOS}
for g in GEOS:
    html = html.replace(f'__CLUES_{g.upper()}__', clues[g])
    html = html.replace(f'__{g.upper()}__', data[g])

out = ROOT / 'dist' / 'mappa.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html)
print(f'wrote {out} ({len(html):,} bytes, {len(GEOS)} geographies, '
      f'{len(modules)} modules, version {ver})')
