#!/usr/bin/env python3
"""Build the clue data: a capital and a grouping for every region.

Downloaded rather than typed. These are exactly the facts a learner would take
away, so a wrong prefecture for Ariege does not merely look sloppy, it teaches
something false — worse than having no clue feature at all.

Sources (fetch into package-clues/):
  @etalab/decoupage-administratif   npm pack @etalab/decoupage-administratif
      departements.json  region code and chefLieu per departement
      communes.json      chefLieu code -> commune name
      regions.json       region names
  france-geojson                    regions-version-simplifiee.geojson
  usa-states (npm)                  src/usa-states.ts, state capitals
  cphalpert/census-regions          census.csv, US census divisions
  mledoze/countries                 package-eu/mledoze-countries.json, capitals
                                    and subregions — see build-eu.py
"""
import json, re
from geo import ROOT

SRC = ROOT / 'package-clues'


def french():
    deps = {d['code']: d for d in json.loads((SRC / 'departements.json').read_text())}
    regs = {r['code']: r for r in json.loads((SRC / 'regions.json').read_text())}
    communes = {c['code']: c for c in json.loads((SRC / 'communes.json').read_text())}

    ours = json.loads((ROOT / 'data' / 'fr.json').read_text())
    code_of = ours['abbr']                      # name -> departement code

    out = {}
    for name, code in code_of.items():
        d = deps.get(code)
        assert d, f'no source record for departement {code}'
        seat = communes.get(d.get('chefLieu'))
        region = regs.get(d.get('region'))
        assert seat, f'{code}: chefLieu {d.get("chefLieu")} not in communes'
        assert region, f'{code}: region {d.get("region")} not in regions'
        out[name] = {'capital': seat['nom'], 'group': region['nom']}
    return out


def american():
    ts = (SRC / 'usa-states.ts').read_text()
    # records look like: name: "X", ... capital: "Y",
    pairs = re.findall(r'name:\s*"([^"]+)"(?:(?!name:).)*?capital:\s*"([^"]+)"',
                       ts, re.S)
    caps = dict(pairs)
    import csv
    div = {r['State']: r['Division']
           for r in csv.DictReader(open(SRC / 'census.csv'))}
    ours = json.loads((ROOT / 'data' / 'us.json').read_text())
    out = {}
    for name in ours['abbr']:
        assert name in caps, f'no capital found for {name}'
        assert name in div, f'no census division for {name}'
        out[name] = {'capital': caps[name], 'group': div[name]}
    return out


def european():
    """Capitals and groupings out of the same file the map was drawn from.

    build-eu.py decides who is in the map from this metadata, so the clue table
    cannot disagree with the region set — there is nothing here to keep in step.

    The grouping is mledoze's subregion rather than the UN's four. The UN puts
    fifteen of these forty in one Southern Europe, from Portugal to Serbia, which
    is barely a clue; six named groups of three to ten each narrow the map about
    as far as a US census division does, and Central and Southeast Europe are
    what people actually say.
    """
    meta = json.loads((ROOT / 'package-eu' / 'mledoze-countries.json').read_text())
    by_name = {c['name']['common']: c for c in meta}
    ours = json.loads((ROOT / 'data' / 'eu.json').read_text())

    out = {}
    for name in ours['abbr']:
        c = by_name.get(name)
        assert c, f'no source record for {name}'
        caps = c.get('capital') or []
        assert len(caps) == 1, f'{name}: {len(caps)} capitals, expected one'
        assert c.get('subregion'), f'{name}: no subregion'
        out[name] = {'capital': caps[0], 'group': c['subregion']}
    return out


for geo, build in (('fr', french), ('us', american), ('eu', european)):
    table = build()
    ours = json.loads((ROOT / 'data' / f'{geo}.json').read_text())
    assert set(table) == set(ours['abbr']), f'{geo}: clue table does not cover the map'
    missing = [k for k, v in table.items() if not v.get('capital')]
    assert not missing, f'{geo}: no capital for {missing[:3]}'
    p = ROOT / 'data' / f'clues-{geo}.json'
    p.write_text(json.dumps(table, separators=(',', ':'), ensure_ascii=False))
    # Every grouping named has to have geometry to outline, or the clue rung
    # offers a name and draws nothing.
    have = set(json.loads((ROOT / 'data' / f'{geo}.json').read_text())
               .get('groups', {}))
    named = {v['group'] for v in table.values() if v.get('group')}
    assert named <= have, f'{geo}: no outline for {sorted(named - have)}'
    groups = named
    print(f'wrote {p.name}: {len(table)} regions, '
          f'{len(groups) if groups else "no"} grouping(s)')
    for k in list(table)[:3]:
        print(f'    {k}: {table[k]}')
