#!/usr/bin/env python3
"""Assemble the sources into one self-contained playable file.

The output stays a single HTML file with no external references, which is the
whole point of the project. The split exists for editing, not for shipping:
the CSS, the JS modules and the region data are inlined here, in order.
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'

ABBR = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN',
    'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE',
    'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
    'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
    'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR',
    'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA',
    'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
}

states = json.loads((ROOT / 'data' / 'states.json').read_text())
assert set(ABBR) == {s['n'] for s in states}, 'state names do not match'

# JS modules are concatenated in filename order; the numeric prefixes are the
# load order, and nothing else enforces it.
modules = sorted((SRC / 'js').glob('*.js'))
assert modules, 'no JS modules found'
js = ''.join(m.read_text() for m in modules)

html = (SRC / 'index.html').read_text()
for token in ('__CSS__', '__JS__', '__DATA__', '__ABBR__'):
    assert token in html or token in js, f'missing placeholder {token}'

html = (html
        .replace('__CSS__', (SRC / 'style.css').read_text())
        .replace('__JS__', js)
        .replace('__DATA__', json.dumps(states, separators=(',', ':')))
        .replace('__ABBR__', json.dumps(ABBR, separators=(',', ':'))))

out = ROOT / 'dist' / 'fifty.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html)
print(f'wrote {out} ({len(html):,} bytes, {len(states)} states, '
      f'{len(modules)} modules)')
