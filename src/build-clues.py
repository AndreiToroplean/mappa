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
  Natural Earth admin-0 countries   package-eu/ne_50m_admin_0_countries.geojson,
                                    European groupings — see build-eu.py
  Natural Earth populated places    package-eu/ne_50m_populated_places.geojson,
                                    European capitals
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
    """Capitals and groupings out of the same source the map was drawn from.

    build-eu.py decides who is in the map from these same attributes, so the clue
    table cannot disagree with the region set about who exists.

    The grouping is Natural Earth's SUBREGION, which is the UN's four: Northern,
    Southern, Eastern and Western Europe. Sixteen of the forty-four land in
    Southern Europe, from Portugal to Serbia, so that rung narrows the map less
    than a US census division does. It is the scheme that is actually agreed on,
    though, and it costs nothing to keep current — the alternative is forty-four
    assignments that are somebody's opinion, maintained by hand.

    Capitals come from the populated places layer, filtered to the ones it marks
    as a country's capital — 'Admin-0 capital', which is not the same class as
    'Admin-0 region capital', or Bosnia and Herzegovina would have two.

    Joined on ADM0_A3 rather than on any name. The two Natural Earth layers do not
    agree about names: the countries layer calls it 'Bosnia and Herz.' and the
    places layer 'Bosnia and Herzegovina'. The code is the same in both.

    NAME_EN for the city, the same field the countries are named from. NAME is the
    endonym, which would have put København on an English map while leaving
    Reykjavík and Chișinău correctly accented — one field, not a list of fixes.
    """
    NE = ROOT / 'package-eu'
    meta = json.loads((NE / 'ne_50m_admin_0_countries.geojson').read_text())
    places = json.loads((NE / 'ne_50m_populated_places.geojson').read_text())
    ours = json.loads((ROOT / 'data' / 'eu.json').read_text())

    # See REGROUP in build-eu.py, which has to make the same call for the
    # outlines. check.py asserts the two agree.
    REGROUP = {'Cyprus': 'Southern Europe'}

    by_display = {p['properties']['NAME_EN']: p['properties']
                  for p in meta['features']}

    caps = {}
    for f in places['features']:
        q = f['properties']
        if q.get('FEATURECLA') == 'Admin-0 capital':
            caps.setdefault(q.get('ADM0_A3'), []).append(q['NAME_EN'])

    out = {}
    for name in ours['abbr']:
        c = by_display.get(name)
        assert c, f'no source record for {name}'
        seats = caps.get(c['ADM0_A3']) or []
        assert len(seats) == 1, f'{name}: {len(seats)} capitals, expected one'
        group = REGROUP.get(name, c['SUBREGION'])
        assert group, f'{name}: no grouping'
        out[name] = {'capital': seats[0], 'group': group}
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
    # Equality, not containment: an outline nobody names is as wrong as a name
    # with no outline, and for Europe the two scripts each decide Cyprus's
    # grouping separately, so this is what catches them disagreeing.
    assert named == have, (f'{geo}: groupings named {sorted(named - have)} have no '
                           f'outline, outlines {sorted(have - named)} go unnamed')
    groups = named
    print(f'wrote {p.name}: {len(table)} regions, '
          f'{len(groups) if groups else "no"} grouping(s)')
    for k in list(table)[:3]:
        print(f'    {k}: {table[k]}')
