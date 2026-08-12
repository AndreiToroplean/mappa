# Architecture

How Fifty is put together and how to build it. `README.md` is the short public
description; `DESIGN.md` is why the decisions below were made.

A geography drill. You're named a region, you click it on the map. In Trial three
misses ends the run; in Practice nothing does. Runs are ranked by regions found,
then by how little help they took, then by time.

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

An inset may be **fixed** instead of laid out, which is what the US does. Albers
USA already composites Alaska and Hawaii where they belong, and that arrangement
is worth keeping — so those two panels carry a `fix` giving their place in the
mainland's own units, ride whatever transform the mainland gets, and are invisible
to the packer. Their space is reserved by the mainland panel's box being the whole
composited frame, so fitting the mainland fits them too.

They are separate panels rather than part of the mainland because the game asks
which panel two regions are on before drawing a line between them.

`chooseLayout` scores a handful of candidate arrangements — the inset block
below the mainland or beside it, in every rows-by-columns shape — and takes the
one giving the mainland the largest scale, then grows the insets into whatever
space is left. `compose` bakes the winner into one flat coordinate space and
rewrites the path data.

That last part matters: composing back to a flat space means nothing downstream
knows panels exist. Hit testing, `borders`, distances and the snap threshold are
the same code they were when the build did the placing.

France's five overseas départements are laid out rather than fixed, and each gets
its own panel, drawn at the
mainland's scale and then magnified only as far as they must be to stay
hittable, capped at 3x. Albers USA does the same thing in reverse — measured
against known areas it draws Alaska at 0.33 and Hawaii at 0.77 of true scale —
so relative sizes still mean something without the small islands vanishing.

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

The main menu is pinned the same way, for the same reason. Its height comes from
the window — `min(660px, 100%)`, or the full height less the padding in
landscape — rather than from its contents, which change size whenever you touch
the mode or geography switcher. The leaderboard is the only part that flexes, so
it absorbs all of the variation and scrolls if the window is too short. The
end-of-run card is the same card in another state and shares the rule, so moving
between the two moves nothing but the words.

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

## Water

Not in the game. Two attempts are parked on branch `water-wip`; see DESIGN.md for
what failed. `src/build-coast.py` stays on master because it holds the recovered
albersUsa transform, which anything aligning to the US map will need.

## Clues

Practice offers a clue ladder, always on request and never automatic. Three
rungs, in a fixed order:

1. **The arrow** — only once there is a wrong guess to point away from. Before
   the first miss the button skips this and offers the grouping instead. A fresh
   miss re-opens it, aimed from the new mistake.
2. **The grouping** — the French *région* or US census division, outlined on the
   map in amber with its name.
3. **The capital** — the *chef-lieu* or state capital, named in the ticker. Last
   because it is the weakest: a name you either know or do not, which narrows
   nothing on the map by itself.

The arrow sits on the line between the two regions' centres and starts at the
border of the one you hit, found by intersecting that line with the region's own
outline. A fixed offset from the centre would start inside a large region and
float away from a small one.

Amber is the colour of help throughout: the revealed answer, the miss arrow and
the grouping outline all use it.

Clues are counted for the run and shown on the Practice board. Misses and clues
add into one help figure, then time — ranking misses ahead of clues would make
clues nearly free, which defeats counting them. Both numbers stay visible so a
row can still be read.

The arrow is a fixed length, so it never gives the distance away. Three styles
carry the relationship instead: a thin chevron when the two regions actually
share a border, a heavier one within half the country, a thick solid head beyond
that. Half the country comes from the mainland's own drawn span, so it follows
the layout rather than being a constant that stops matching.

The rung is skipped entirely when the two regions are not on the same landmass —
one on the mainland and one in an inset, or two different insets — since an arrow
across a gap that does not exist on the ground would be a lie.

## Full screen

An icon on the title line of the menu and of the pause card, since the
Fullscreen API only fires from a user gesture. It is never entered on your
behalf. Android Chrome supports this; iPhone Safari does not, and the button
hides itself there. For a permanent answer on either, Chrome's "Add to
Home screen" runs the page with no browser chrome at all.

## Pausing

A pause button sits at the top right of the header during a run — the corner a
thumb reaches without regripping. It stops the clock and hides
the map, which is the point: a stopped clock over a visible map is unlimited
thinking time, and would quietly make every leaderboard entry meaningless. From
there you can resume, restart, or go back to the main menu. Escape toggles it.

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

## Version stamp

`make.py` stamps `git describe --tags --always --dirty` into the menu's tagline
row. That distinguishes the two published channels without anything to keep in
step by hand: on a tagged commit it is the tag exactly, so stable reads `v1.0.0`,
and anywhere past one it gains a count and a hash, so beta reads
`v1.0.0-3-g7de86d4`.

`FIFTY_VERSION` overrides it, for building outside a checkout. With neither, it is
`unreleased`. CI checks out with `fetch-depth: 0`, because a shallow clone has no
tags and would stamp a bare hash without failing.

## Licence

The code has no licence yet; see `ATTRIBUTION.md`. Map and clue data are
third-party and keep their own terms — us-atlas under ISC, the French geometry and
clue facts under the Licence Ouverte with attribution to IGN and Etalab.
`ATTRIBUTION.md` summarises which file came from where; `data/LICENSE-*` are the
originals.
