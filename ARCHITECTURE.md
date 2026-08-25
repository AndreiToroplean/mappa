# Architecture

Orientation, not reference. The code carries the detail and is commented for it;
this file exists so a newcomer knows which file to open and which ideas are
structural rather than incidental. `README.md` is the public description,
`DESIGN.md` is how to work on it.

Earlier revisions of this file went into much more depth. That text is in
`git log ARCHITECTURE.md` if a decision ever needs archaeology.

A geography drill. You are named a region, you tap it on the map. Built as one
self-contained HTML file — no CDN, no network calls, no runtime dependencies.
`dist/mappa.html` works offline.

## Build

```
python3 src/make.py     # -> dist/mappa.html
python3 check.py        # regression harness, no browser needed
python3 render.py app eu 390 780 dark    # rasterise, to see what the code drew
```

`make.py` inlines the CSS, concatenates the JS in filename order and injects the
region data. The `src/build-*.py` scripts regenerate geometry from source data
and need downloads that are not in the repo — see each script's docstring. Their
output is committed, so `make.py` alone rebuilds the game.

## Source layout

```
src/index.html        markup, with __CSS__ / __JS__ placeholders
src/style.css         all styling; both palettes live here and nowhere else
src/js/00-crash.js    shows a thrown error on screen; loads first, deliberately
src/js/01-data.js     the geographies, MODES, SCORINGS, board ranking
src/js/02-map.js      SVG construction, paint layers, STATUS, the score ramp
src/js/03-run.js      run lifecycle: queue, spending cap, clock, guess()
src/js/04-geometry.js screen->map coords, border distance, resolving a position
src/js/05-lens.js     the press-and-hold magnifier
src/js/06-board.js    storage, preferences, leaderboard, end of run
src/js/07-celebrate.js  confetti, the miss arrow
src/js/08-clues.js    the clue ladder
src/js/09..14         pause, fullscreen, review, theme, export/import, startup
src/geo.py            shared build geometry: projection, polylabel, emit
src/build-{us,fr,eu}.py   one per geography
src/build-clues.py    capitals and groupings for all three
src/make.py           assembles dist/mappa.html
check.py              the regression harness
render.py             rasterises a geography as the game shows it
```

Numeric prefixes are the load order, and nothing else enforces it. The rule is
one direction only: later modules may use earlier ones.

## Geographies

| geography | regions | source | abbreviations |
|---|---|---|---|
| United States | 50 states | us-atlas (Albers USA) | postal codes |
| France | 101 départements | france-geojson (Lambert-93) | département numbers |
| Europe | 44 countries | world-atlas (ETRS89-LCC) | ISO 3166-1 alpha-2 |

Adding one is a build script, an entry in `GEOS`, an `<option>`, and a line in
`make.py`. Everything downstream — four new board keys, the link parameter, the
export — follows from `GEOS` being enumerated rather than listed.

Membership decisions are pushed into the source data wherever possible. Europe's
forty-four are "an independent country that mledoze/countries files under region
Europe", which excludes Turkey and the Caucasus for free; the exceptions and the
reasoning are commented in `build-eu.py`, which is the right place for them.

## The five structural ideas

Everything else is local to its file. These are the ones that will bite someone
who does not know about them.

**Panels, placed at run time.** A geography is a set of panels in their own local
coordinates — a mainland, plus one per piece sitting apart from it. The build
does not place anything; `chooseLayout` scores candidate arrangements against the
shape of the screen and `compose` bakes the winner into one flat space, rewriting
the path data. So nothing downstream knows panels exist. A panel may instead be
`fix`ed, placed relative to panel 0, which is what keeps Alaska and Hawaii where
Albers USA put them. Panels matter beyond layout: the game asks whether two
regions share one before drawing an arrow between them, because a line across a
gap the map invented would be a lie. Europe has one panel — a continent is
continuous.

**One status per region, changed in one place.** `STATUS` in `02-map.js` maps a
status to its map class, paint layer, label kind and magnifier class;
`setStatus()` is the only thing allowed to apply it. Before this, "found" was a
DOM class and "missed" a JS Set, and the transition was hand-written at five call
sites.

**SVG paints in document order**, so resolved regions physically move between
layers rather than changing z-index:

```
base < found < missed < answer < marks < labels < grouping < arrow < drift
```

The magnifier stacks its own copy the same way, for the same reason.

**One resolver, shared by taps and the magnifier**, so the two can never
disagree about what a position means. Containment wins outright; otherwise the
nearest *selectable* region within 40 map units, measured to its border rather
than its centre. Map units, not pixels — the rule should be geographic at any
screen size. `borderDist2` is the primitive underneath it and underneath distance
scoring.

**Marks.** A country can be real, named, and still too small to aim at. Below an
inscribed radius of 3.5 local units the build replaces the outline with a circle
of that radius and flags the region `dot`; six of Europe's forty-four qualify.
The mark *is* the geometry, ordinary path data, so hit testing, the magnifier and
the score ramp treat it like any other region — unlike the invisible tap circles
it replaces, which widened a shape without moving it so that what you could see
and what you could press disagreed. Two rules follow from a mark being drawn
*over* the map: it keeps its own layer whatever its status, and `stateUnder` asks
the marks first (a point inside San Marino is inside Italy too).

## Axes and storage

Three independent axes — geography, mode, scoring — and every combination keeps
its own board under its own key. They are not comparable, and merging them would
bury one under another. `keyFor()` takes its axes as arguments so the export can
walk every key the game could have written; `check.py` holds the enumeration
against it.

Storage is `localStorage` and nothing else, synchronous. **The keys and the ids
are frozen**: the `fifty:` prefix, the two legacy US spellings, and the ids
`trial`/`practice`/`count`/`drift` are what real saved boards are filed under.
Only labels are the game's vocabulary, which is why Test is spelled `trial`.

## Themes

Two palettes, both in `src/style.css`, `:root` and `:root[data-theme="light"]`.
Nothing outside that block names a colour. Names are by role, not by appearance.
`check.py` holds the two palettes to declaring the same set of names and every
`var()` to naming one that exists — an undefined custom property is not a
fallback, it invalidates the declaration, and the magnifier lost its borders that
way for a release.

The theme is read twice: a script in `<head>` reads the same key before the body
renders, so a light-theme player never sees a frame of the dark one.

## Licence

The code has no licence yet; the map and clue data are third-party and keep their
own terms. See `ATTRIBUTION.md`, and do not remove `data/LICENSE-*`.
