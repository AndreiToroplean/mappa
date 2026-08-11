# Fifty

A US states drill. You're named a state, you click it on the map. Three misses
ends the run; your time is the score.

Built as a single self-contained HTML file — no CDN, no network calls, no
dependencies at runtime. Open `dist/fifty.html` in any browser and it works,
including offline.

## Geographies

Two, chosen from a dropdown on both cards and remembered between visits:

| geography | regions | source | abbreviations |
|---|---|---|---|
| United States | 50 states | us-atlas (Albers USA) | postal codes |
| France | 101 départements | france-geojson (Lambert-93) | département numbers |

## Layout

The build does not place anything. Each geography is a set of **panels** in
their own local coordinates — a mainland, plus one inset per piece that sits
apart from it — and the arrangement is chosen at run time from the shape of the
space available.

A geography may also bake its insets in and ship a single panel, which is what
the US does: Albers USA already composites Alaska and Hawaii where they belong,
and that arrangement is worth keeping.

`chooseLayout` scores a handful of candidate arrangements — the inset block
below the mainland or beside it, in every rows-by-columns shape — and takes the
one giving the mainland the largest scale, then grows the insets into whatever
space is left. `compose` bakes the winner into one flat coordinate space and
rewrites the path data.

That last part matters: composing back to a flat space means nothing downstream
knows panels exist. Hit testing, `borders`, distances and the snap threshold are
the same code they were when the build did the placing.

France's five overseas départements each get their own panel, normalised on
their own, which is what makes them not to scale relative to the mainland: at
true scale Mayotte would be a couple of units across and Guyane larger than any
metropolitan département. Insets are conventionally not to scale, and the game
is about recognising which is which.

The composed frame always matches the container's aspect, with the shorter side
fixed at 600 units. Fitting a fixed frame into a differently-shaped container
was wasting about three fifths of a phone's height.

## Layout

```
src/index.html      markup, with __CSS__ / __JS__ placeholders
src/style.css       all styling
src/js/01-data.js   geographies (injected as __US__ / __FR__), modes, scoring
src/js/02-map.js    building the SVG, paint layers, labels, tap targets
src/js/03-run.js    run lifecycle: queue, lives, clock, guesses
src/js/04-geometry.js  screen->map coordinates, distance, resolving a position
src/js/05-lens.js   the press-and-hold magnifier
src/js/06-board.js  storage, leaderboard, end of run
DESIGN.md           why it is the way it is, and the mistakes behind that
check.py            regression harness for the pure logic (no browser needed)
render.py           rasterises a geography as the game shows it, for eyeballing
src/geo.py          shared build geometry: simplify, polylabel, emit
src/build-us.py     US states from us-atlas TopoJSON
src/build-fr.py     French départements from france-geojson, with overseas insets
src/make.py         assembles everything into dist/fifty.html
data/us.json        generated: view box, abbreviations, regions
data/fr.json        generated: same shape, 101 régions
dist/fifty.html     generated (gitignored): the playable file
```

The split is for editing only. `make.py` inlines the CSS, concatenates the JS
modules in filename order, and injects the data, so the shipped artifact is
still one file with no external references.

Rebuild:

```
python3 src/build-us.py   # needs package/states-albers-10m.json
python3 src/build-fr.py   # needs package-fr/departements-avec-outre-mer.geojson
python3 src/make.py
```

Both data files are committed, so `make.py` alone rebuilds the game.

The `build-*` scripts are only needed to regenerate geometry from source data.
`data/us.json` and `data/fr.json` are committed, so `make.py` alone rebuilds the
game.

## Map data

[us-atlas](https://github.com/topojson/us-atlas) v3.0.1 (ISC licence), which
packages US Census Bureau cartographic boundary files as TopoJSON. Installed via
`npm pack us-atlas@3`, which drops a `package/` directory.

We use `states-albers-10m.json` — already projected in Albers USA, with Alaska
and Hawaii in their conventional insets, so no projection maths is needed at
build time. The build step:

1. Delta-decodes the quantised arcs into absolute coordinates.
2. Stitches arcs into rings (negative arc index means traverse in reverse).
3. Drops islands under 1.2 sq px and thins points closer than 0.45px.
4. Computes a label anchor per state (below).

DC and the territories are excluded; 50 states exactly.

## Label placement

Labels sit at each state's **pole of inaccessibility** — the interior point
furthest from any edge — not the centroid or bounding-box centre. This is
Mapbox's `polylabel` algorithm, reimplemented in `src/geo.py`: cover the polygon in
square cells, score each by signed distance to the nearest edge, and repeatedly
subdivide the most promising cell while pruning any whose upper bound can't beat
the current best.

This matters because states aren't convex. A bounding-box centre puts Michigan's
label in Lake Michigan, Louisiana's in the Gulf of Mexico, and Alaska's and
Hawaii's in open ocean. For multi-part states the algorithm runs per landmass and
the roomiest one wins, which is what keeps Michigan's label in the lower
peninsula.

The algorithm also returns the inscribed radius, which is reused: any state whose
widest inscribed circle is under 12px gets an invisible circular tap target at
the same point, because it can't reliably be hit with a thumb. That currently
covers CT, DE, HI, MD, MA, NH, NJ, RI and VT. Maryland qualifies despite its
size — it's long but never more than 8px thick.

## Rendering notes

SVG has no `z-index`; it paints in document order. Resolved states therefore
*move* between six `<g>` layers as their status changes:

```
base  <  found  <  missed  <  answer  <  labels  <  hit targets
```

Without this, a neighbouring unsolved state drawn later clips the outline of one
you've already solved. Hit targets stay topmost so clicks still land, which means
the handler has to explicitly ignore clicks on already-found states.

Layout is pinned: header and footer have fixed heights, stat columns have
reserved widths, and the prompt ellipsises rather than wraps. Any of these
flexing would resize the map mid-run.

Under 600px the header stacks into two rows — the state name on its own
full-width line, the three stats beneath it — because one 360px row could not
hold a long name and three stat columns at once, and the name was the thing
being truncated. The stacked header is a fixed 94px, so it is still pinned.

## Resolving a position to a state

Taps and the magnifier share one resolver, so the two can never disagree about
what a position means.

A state is *selectable* only if picking it would do something — already-found
states, and states already missed this turn, are no-ops in `guess()` and are
excluded. Resolving to one would mean a deliberate action silently doing
nothing, which is what used to make the magnifier feel broken.

Containment wins outright. Otherwise the nearest selectable state within 40 map
units wins, measured to the closest point on its border rather than to its
label anchor or centroid — a position just off the Delmarva coast should give
Maryland, which is metres away, not Virginia, whose centre is nearer. Past the
reach, nothing is selected.

The reach is in map units rather than screen pixels on purpose: a phone
compresses the map enough that a thumb's width spans ~76 map units, and an
earlier screen-pixel version snapped central Canada onto Minnesota. Map units
keep the rule geographic at any screen size.

The one asymmetry is what happens *inside* an unselectable state. The magnifier
snaps to a neighbour, because it draws the result under the crosshair before
anything is committed. A tap does not, because it has no preview, and turning a
tap on a solved state into a life lost on the state next door would be
indefensible. Open water snaps either way.

## Magnifier

Press and hold the map for 250ms to open a zoomed disc, drag to aim, lift to
select. The state a release would select is highlighted in the disc — which
is not always the one under the crosshair, since the crosshair may be over
water or over a state already solved. Lifting over open water
cancels without cost. Plain tapping still works and is unchanged.

Aiming hit-tests the real map with `isPointInFill`, not the disc and not
`elementFromPoint` — the disc must reflect true geometry, and the oversized tap
circles would otherwise answer for their neighbours. The disc is
`pointer-events:none` so it can float over the finger without intercepting it.

The release is deliberately not "whatever was under the finger at lift-off": a
thumb slides as it leaves the glass. The last 180ms are discarded, and the
selection is the most recent state rested on for at least 120ms before that
window. Failing that, it is the state under the finger at the cutoff moment.

## Winning

Completing the set switches the header to a win state, fires a two-wave
confetti burst from the bottom corners, and flashes a banner — "Perfect run" if
you never missed, otherwise "All fifty" — before the leaderboard appears.

The cannons tilt further off vertical on wider screens. A fixed angle that
looks right on a laptop fires straight out of the sides of a phone and empties
the screen in under a second.

`celebrate()` returns how long `finish()` should hold the map, so the pause and
the animation can never disagree. Under `prefers-reduced-motion` there is no
confetti and no animation, and the pause returns to what it was before.

## Modes

Mode and geography are independent axes: a mode says what counts as a run and
what counts as a good one, never which regions are in play.

**Trial** — three misses ends the run. Ordered by regions found, then misses,
then time.

**Practice** — no limit on misses. The header column that counts lives in
Trial counts misses here instead, so the layout holds steady between modes.
Every run finishes, so the only axis left is misses:
ranked by misses, then time, with one entry per miss count. Counts can exceed
three, and can exceed the region count, since the same region can be missed on
different turns.

Each mode keeps its own board under its own storage key. They are not
comparable — a practice run cannot fail — and merging them would bury every
Trial run under a wall of completed practice ones. Clearing a board clears
only the mode you are looking at.

The switcher appears on both the intro and the end-of-run card, so a run can be
followed by a different kind of run without a reload.

## Clues

Practice offers a clue ladder, always on request and never automatic. Two rungs,
in a fixed order:

1. **The capital** — the *chef-lieu* or state capital, named in the ticker.
2. **The grouping** — the French *région* or US census division, outlined on the
   map in amber with its name.

Amber is the colour of help throughout: the revealed answer, the miss arrow and
the grouping outline all use it.

Clues are counted for the run and shown on the Practice board. Misses and clues
add into one help figure, then time — ranking misses ahead of clues would make
clues nearly free, which defeats counting them. Both numbers stay visible so a
row can still be read.

A miss in Practice also draws a short arrow beside the region you hit, pointing
at the one you wanted. Fixed length, with thickness in three coarse bands, so it
gives a direction and a rough sense of distance without handing over the answer.

### Where the data comes from

| fact | source |
|---|---|
| French chef-lieu, région | `@etalab/decoupage-administratif` (INSEE/Etalab) |
| French région outlines | france-geojson (IGN/Etalab) |
| US state capitals | `usa-states` (npm) |
| US census divisions | cphalpert/census-regions |

Downloaded rather than typed: these are the facts a learner takes away, so a
wrong préfecture would teach something false. `src/build-clues.py` asserts every
region has a capital and a grouping, and that every grouping named has geometry.

Grouping outlines are built differently per geography, because the data differs.
For the US they are dissolved exactly from the TopoJSON arcs — neighbours share
arc indices, so an interior arc is used twice and drops out. That cannot work on
the French data, where each département was simplified independently and a shared
border became two slightly different polylines, so the régions are taken as their
own geometry and projected identically. Verified by alignment: New England's
outline matches its members exactly, Île-de-France within 0.6 units.

## Leaderboard

Three storage backends, tried in order:

| backend | when | survives refresh | survives rebuild |
|---|---|---|---|
| `window.storage` | inside the artifact runtime | yes | no — scoped per instance |
| `localStorage` | opened as a downloaded file | yes | yes |
| memory | storage blocked or unavailable | no | no |

The intro and game-over cards state which one is in use, and carry a reset
button (with a confirmation step) beside the board. A board that silently
forgets is worse than one that says up front that it will.

Ordered by states found first, then errors, then time — a slow 50 always beats
a fast 40, and a clean 50 beats a quicker one with misses. Errors are shown on
every row; entries saved before runs counted them show a dash.
Sub-50 runs keep one entry per tally, so your best 31-state run replaces your
previous 31-state run but never competes with your 12-state one. Full runs are
the exception: up to five coexist, ranked purely on time. Zero-state runs don't
post.

## Licence

Map data is us-atlas, ISC licence, derived from US Census Bureau public domain
boundary files. See `data/LICENSE-us-atlas`.
