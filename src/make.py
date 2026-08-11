#!/usr/bin/env python3
"""Assemble the sources into one self-contained playable file.

The output stays a single HTML file with no external references, which is the
whole point of the project. The split exists for editing, not for shipping:
the CSS, the JS modules and the region data are inlined here, in order.
"""
import json, pathlib

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

html = (SRC / 'index.html').read_text()
for token in ('__CSS__', '__JS__'):
    assert token in html, f'missing placeholder {token}'
for g in GEOS:
    assert f'__{g.upper()}__' in js, f'missing placeholder __{g.upper()}__'
    assert f'__CLUES_{g.upper()}__' in js, f'missing placeholder __CLUES_{g.upper()}__'
    assert f'__WATER_{g.upper()}__' in js, f'missing placeholder __WATER_{g.upper()}__'

html = html.replace('__CSS__', (SRC / 'style.css').read_text()).replace('__JS__', js)
clues = {g: (ROOT / 'data' / f'clues-{g}.json').read_text() for g in GEOS}
water = {g: (ROOT / 'data' / f'water-{g}.json').read_text() for g in GEOS}
for g in GEOS:
    html = html.replace(f'__CLUES_{g.upper()}__', clues[g])
    html = html.replace(f'__WATER_{g.upper()}__', water[g])
    html = html.replace(f'__{g.upper()}__', data[g])

out = ROOT / 'dist' / 'fifty.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html)
print(f'wrote {out} ({len(html):,} bytes, {len(GEOS)} geographies, '
      f'{len(modules)} modules)')
