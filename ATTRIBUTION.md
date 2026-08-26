# Attribution

The code has no licence yet — see the note at the end. This file is about the
data, which is third-party and has terms of its own regardless.

The map and clue data in data/ stay under their own terms and require
attribution:

  data/us.json          derived from us-atlas (ISC, Mike Bostock), itself from
                        US Census Bureau boundary files (public domain).
                        See data/LICENSE-us-atlas.

  data/fr.json          derived from france-geojson, from IGN/Etalab open data
                        under the Licence Ouverte. Attribution to IGN and Etalab
                        required. See data/LICENSE-france-geojson.

  data/eu.json          geometry derived from world-atlas (ISC, Mike Bostock),
                        itself from Natural Earth 1:50m; names, ISO codes and
                        groupings from Natural Earth admin-0 countries.
                        See data/LICENSE-world-atlas and
                        data/LICENSE-natural-earth.

  data/clues-fr.json    chef-lieux and régions from @etalab/decoupage-
                        administratif (INSEE/Etalab, Licence Ouverte);
                        région outlines from france-geojson.

  data/clues-us.json    state capitals from usa-states (MIT); census divisions
                        from cphalpert/census-regions, which states no licence —
                        the classification itself is US Census Bureau work and
                        so public domain. See data/LICENSE-clues.

  data/clues-eu.json    European capitals from Natural Earth populated places,
                        groupings from Natural Earth admin-0 countries.
                        Public domain; no conditions. See
                        data/LICENSE-natural-earth.

All of the above permit redistribution, including commercially, so long as
attribution is kept. Removing data/LICENSE-* would break that.

## No code licence yet

Deliberate, not an oversight. With no licence file the code is under default
copyright: it is public to read and GitHub's terms let people fork it on the
platform, but nobody has permission to reuse it elsewhere. If that should change,
adding a LICENSE file is the whole of the change — the data terms above are
already compatible with a permissive one.
