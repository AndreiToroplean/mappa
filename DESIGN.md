# Design notes

Why this project is the way it is — the reasoning that is not recoverable from
reading the code, and the mistakes that produced it. `README.md` covers what the
thing is and how to build it; this file covers why.

Written and kept up to date across the sessions that built it. If you change a
decision recorded here, change the note too.

## Structure

`src/` is split for editing; `make.py` inlines it all back into one file, so
the shipped artifact is unchanged — single file, no external references.

```
01-data.js    the region set; expands the short payload keys, holds RULES
02-map.js     SVG construction, paint layers, labels, tap targets, STATUS
03-run.js     run lifecycle: queue, lives, clock, guess()
04-geometry.js  screen->map coords, distance, resolving a position
05-lens.js    the press-and-hold magnifier
06-board.js   storage, leaderboard, end of run
```

Numeric prefixes are the load order and nothing else enforces it. The rule is
one direction only: later modules may use earlier ones.

**One status per region, changed in one place.** `STATUS` maps a status to its
map class, paint layer, label kind and magnifier class; `setStatus()` is the
only thing allowed to apply it, and `statusOf` is the truth. Before this,
"found" was a DOM class and "missed" a JS `Set`, so `selectable()` consulted
both, and the transition was hand-written at five call sites — two via
`setAttribute`, two via `classList`, which is how a region ends up carrying
`state found miss`.

**`borderDist2` is the geometric primitive.** Squared distance from a point to
a region's border, with an early-out ceiling. The snap threshold is a ceiling
on it, resolving a position is a minimum over it, and blind mode's error score
is `distanceTo()` — the same measure aimed at one named region, zero inside.
`distanceTo` is deliberately unused today; it is there so the roadmap does not
reinvent it.

**Totals are derived.** `TOTAL` from the region set, lives and wording from
`RULES`. Fifty was hardcoded in eight places and three lives in two, which is
what blocked both a practice mode and a second geography.

**`check.py`** runs the pure logic against independent Python implementations:
`resolve()` over 120 randomised points and dead-sets, `settle()` over its seven
lift scenarios, `distanceTo()` over 45 points. It needs no browser. Anything
moved out of the DOM becomes testable this way, which is a reason to keep
moving things out of the DOM.

## Decisions, and why

**Pre-projected map data.** `states-albers-10m.json` rather than
`states-10m.json` — it's already in Albers USA with Alaska and Hawaii in their
conventional insets. Using the unprojected version would mean implementing d3's
composite `albersUsa` projection (conic equal-area, plus separate transforms and
clip extents for AK and HI) at build time. Not worth it.

**Pole of inaccessibility for labels.** Bounding-box centres put Michigan's
label in Lake Michigan, Louisiana's in the Gulf, and Alaska's and Hawaii's in
open ocean, because regions aren't convex. `src/geo.py` reimplements Mapbox's
polylabel: cover the polygon in square cells, score each by signed distance to
the nearest edge, subdivide the most promising, prune any whose upper bound
can't beat the current best. Runs per landmass for multi-part states; roomiest
wins, which keeps Michigan's label in the lower peninsula.

**Tap targets derived, not hardcoded.** polylabel also returns the inscribed
radius. Any state under 12px gets an invisible circular tap target at the same
point. This replaced a hand-written list of seven "small" states and immediately
caught two omissions: Hawaii, and Maryland — which is large but never more than
8px thick. Current set: CT DE HI MD MA NH NJ RI VT.

**Six SVG paint layers.** SVG has no `z-index`; it paints in document order.
States physically move between `<g>` layers as their status changes:

```
base  <  found  <  missed  <  answer  <  labels  <  hit targets
```

Without this, an unsolved neighbour drawn later clips the outline of a state
you've already solved. Consequence: hit targets sit above everything, so the
click handler must explicitly ignore clicks on already-found states — otherwise
tapping a small state you'd already got would silently cost a life.

**Pinned layout.** Header and footer have fixed heights, stat columns have
reserved widths, the prompt ellipsises rather than wraps, and the body doesn't
scroll. Previously a long state name could wrap the header to two rows and a long
ticker message could wrap the footer, either of which resized the map mid-run.

**Stacked header on phones.** The name was being ellipsised on Android: a
360px row cannot fit "North Carolina" plus lives, found and time. Shrinking the
type further would have made the prompt the smallest thing on screen, so under
600px the header becomes two rows instead — name on its own full-width line,
stats beneath. Fixed 94px, so the pinning guarantee holds. Measured worst case
is ~196px of name in ~372px of usable width.

**Press-and-hold magnifier.** Enlarged tap targets made the small states
*reachable* but not *aimable* — the thumb covers the target and a tap commits
instantly, so the first feedback is a lost life. Hold 250ms to open a 4x disc
offset from the finger, drag to aim, lift to select; the aimed state is
highlighted and named in the disc, so the choice is visible before it is
committed. Lifting over water cancels for free. Tapping is untouched.

Three things here are not obvious:

- The magnifier shows shape and status, never names or abbreviations. Naming
  the state under the crosshair answers the only question the game asks, which
  makes the feature a cheat sheet. The amber fill alone says *which shape* is
  aimed, which is the entire promise the disc needs to keep; the caption says
  "lift to pick" / "lift to cancel" and nothing more. The label layer is never
  cloned into the disc for the same reason.
- Aiming uses `isPointInFill` against the real paths, not `elementFromPoint`.
  The tap circles are up to 10px wide and would answer for their neighbours,
  which is exactly the ambiguity the magnifier exists to remove.
- The disc is `pointer-events:none` and sits above the map, so it can float
  over the finger without ever intercepting what it points at.
- Lift-off resolution discards the last 180ms, because a thumb drifts as it
  leaves the glass. The pick is the most recent state rested on for >=120ms
  before that window, else the state under the finger at the cutoff. Segment
  timings are tracked in `trail`; `settle()` walks them backwards.

`touch-action` moved from `manipulation` to `none` on the map: a drag gesture
needs the browser to keep its hands off the touch stream entirely.

**Android touch.** `-webkit-tap-highlight-color: transparent` kills the grey
rectangle Chrome paints over the tapped element's bounding box. Also
`-webkit-touch-callout`, `user-select: none`, and `touch-action: manipulation`
to drop the 300ms double-tap-zoom delay.

**Abbreviations, not full names.** Tried full names first; eight states are too
narrow to hold one, so it could never be consistent. Two letters fit inside all
fifty. Colour carries the meaning — teal found, red miss, amber answer — and the
footer ticker gives the full name on every click.

**One resolver for taps and the magnifier.** Both go through `resolve()`.
Two independent code paths had already drifted into a real bug (below), so
there is deliberately only one.

Only *selectable* states can be resolved to: not already found, not already
missed this turn. Both are no-ops in `guess()`, so resolving to one means a
deliberate action quietly does nothing.

Containment wins outright; otherwise nearest selectable border within 40 map
units. Measured to the border, not the label anchor — anchors would hand a
Delmarva near miss to Virginia.

The cap is in map units, not screen pixels, and that was not the first attempt.
Screen pixels are the natural unit for thumb error, but a phone compresses the
map so hard that 28 screen px is ~76 map units: that version snapped central
Canada onto Minnesota and the deep Gulf onto Florida. Map units keep the rule
geographic at every scale.

`snapFromDead` is the single asymmetry. Inside an unselectable state the
magnifier snaps to a neighbour and the tap does not, because the magnifier
shows the result before committing and a tap cannot. Water snaps either way.

**The bug this replaced.** The magnifier highlighted whatever the crosshair
contained, including solved states, while `settle()` discarded the trailing
180ms as lift-twitch. Rest on Georgia for 200ms, slide onto already-found
Florida for 100ms, lift: Florida is highlighted, Florida's segment falls
inside the guard window and is dropped, and Georgia is selected. Highlighting
only the resolved selectable target means the trail can no longer contain a
state that cannot be picked.

Note the invariant is "what a release picks", not "whatever is lit at the
instant of release" — the guard window still discards a final sub-120ms
segment, which is the whole point of it.

`resolve()` is checked against an independent Python implementation over 120
randomised points and dead-sets; cost is ~0.1ms and only when not inside a
selectable state.

**Errors, not lives, are what gets counted.** `errors` is the counter and
`livesLeft()` derives from it. Tracking lives directly would leave practice
mode — unlimited lives, ranked on errors — with nothing to count.

Errors rank ahead of time in `better()`. Boards written before this exist, so
`normalise()` fills in what is recoverable: a run that did not finish ended by
running out of lives, so its count is exactly `RULES.lives`. A completed run's
count is not recoverable and is left blank rather than invented — displayed as
a dash, and ranked by `errorsOf()` as the worst a completed run could be, one
short of the lives, so it can never outrank a run known to be cleaner.

**Geography is the second axis.** `GEOS` holds a region set plus the words for
talking about it; `useGeo()` derives `REGIONS`, `TOTAL` and `ABBR` from it. The
choice is remembered across visits, the mode is not — Trial is the default
reading of "play the game".

**Layout is chosen at run time, then baked flat.** The build emits panels in
local coordinates and places nothing. `chooseLayout()` scores candidate
arrangements and `compose()` bakes the winner into one flat coordinate space,
rewriting path data.

Baking flat is the important half. The alternative — a transform per panel —
would have meant hit testing in several coordinate systems at once, per-panel
inverse matrices, and distances that are not comparable between panels because
the scales differ. Composing to a flat space instead means *nothing downstream
knows panels exist*: `resolve`, `borders`, `distanceTo` and `SNAP_UNITS` are
untouched. The cost is re-emitting about 16,000 points on a layout change, a few
milliseconds, only when the geography or the window changes.

The frame now matches the container's aspect with the shorter side fixed at 600
units, so the map fills the space instead of being letterboxed. A fixed 1.7:1
frame in a 0.6:1 map area was wasting three fifths of a phone's height — see
`render.py`, which is how that was finally noticed.

`compose()` also rebuilds the tap targets, since whether a region is too small
to hit depends on the scale it ended up at. Statuses survive a recompose because
only geometry is rewritten and the classes live on the nodes being rewritten.

Anything new derived from `REGIONS` belongs in `buildMap`/`compose`, or it will
silently keep the previous geography's data.

`CAN_HIT` moved from a load-time `const` to a value `buildMap()` assigns,
because asking whether a path can be hit-tested needs a path to exist.

**France specifics.** Lambert-93, the official French projection — conformal, so
shapes stay recognisable, which is the entire game. The source is full
resolution (180,000 points for the mainland, twenty times the whole US map)
because the repository's simplified file omits the overseas départements, so
simplification happens in our build at a 2-unit tolerance with integer
coordinates. Tolerance bounds the error, so 2 units is about 1.3 screen pixels
on a phone.

The five overseas départements are each their own panel, normalised on their
own, so they are not to scale relative to the mainland — deliberately: at the
mainland's scale Mayotte would be a couple of units across. Tolerance is per
panel, because what matters is error once drawn, and an inset is drawn at a
fifth of the mainland's scale.

`arrange()` had rows and columns the wrong way round for side placement in its
first version, sized the inset block against the wrong axis, and pushed it off
the frame — Guadeloupe and Corsica were sliced off on a laptop. Invisible in the
numbers; obvious in a render. `check.py` now asserts every panel lands inside
the frame and none overlap, across nine aspect ratios per geography.

Two things the French names broke, both caught by measuring rather than by
looking: "Alpes-de-Haute-Provence" is 23 characters against "North Carolina"'s
14 and left 10px of slack on a 360px phone, so a `longnames` class drops the
prompt a size — it must never ellipsise, which was the first bug ever reported
here. And "31 départements" overflowed a leaderboard row, so the partial tally
became "31 of 101", which is more useful anyway.

**Modes are a data structure, not a branch.** `MODES` holds lives, storage
key, copy and a board-insertion policy; `MODE` points at the live one. What
did *not* need to change is telling: `better()` serves both unchanged, because
every practice run is a completed set, so its first term always ties and the
ordering falls through to misses, then time — which is exactly what practice
wants. `RULES` stayed behind as geography vocabulary, which is the right seam:
mode and geography vary independently.

Practice keeps one entry per miss count, classic keeps one per tally plus five
full runs, and `replaceBy()` is the shared half. Boards live under separate
keys: a practice run cannot fail, so ranking it against runs that could is
meaningless, and merging them would bury every classic run under completed
practice ones.

`Infinity` lives is load-bearing in one place — the counter would try to build
an infinite array of pips, so `drawCounter()` branches on whether lives are
finite, which is exactly the same question as whether to show pips or a number.

The header keeps the column in both modes rather than hiding it in practice:
same three stats, same widths, no reflow when switching. Trial spends pips,
practice counts misses upward, and the eyebrow says which.

The mode was called Classic while it was the only one, which described its
history rather than the game. `Trial` carries the sense of a test with
something at stake, and pairs against Practice the way a rehearsal pairs
against the real thing. The storage key was deliberately *not* renamed with
it, so boards saved before this survive.

**Winning looks like winning.** A completed run used to be nearly
indistinguishable from a failed one: the map stopped responding and a card slid
up. Now the header turns green and says Complete, confetti fires from both
bottom corners in two waves, and a banner reads "Perfect run" or "All fifty".

`celebrate()` returns the pause `finish()` should hold, so the timing lives
with the animation rather than being a second number to keep in sync. All of it
is decoration: no canvas, or reduced motion requested, and it is skipped with
the pause shortened to match, so nobody waits on an animation that is not
playing.

The cannon tilt scales with viewport width. This was found by simulating the
trajectories rather than by looking — the first version had a sign error that
fired both cannons out of the screen, and the second emptied a phone in under a
second while looking fine on a laptop.

**Leaderboard reset.** Needed because Chrome treats every `file://` page as one
origin, so all downloaded copies share a single `localStorage` bucket; renaming
or moving the file does not give a fresh board. The button sits by the board
heading in both cards and routes through a confirm dialog, since it destroys
full-fifty runs that took real effort.

## Game rules as implemented

- Start screen, then a centred 3-2-1. The clock does not start until it clears.
- All 50 states in random order, 3 lives.
- A miss stays red and labelled until the correct state is clicked. Clicking an
  already-missed state again is free — no life lost, nothing logged.
- Getting it right clears all reds; those states are penalised again next turn.
- On the third miss the header switches to "Out of lives" immediately, then the
  board holds 2.6s (the answer lights amber) before the overlay. A win holds
  1.2s so the completed map is visible.
- Leaderboard: ranked by states found, then time. One entry per sub-50 tally
  (your best 31-state run replaces your previous 31-state run, never competes
  with your 12-state one). Up to five full runs coexist, ranked on time.
  Zero-state runs don't post.
- Errors are counted per run and rank ahead of time: cleaner beats quicker.
  Shown on the board in words — "Perfect", "1 miss", "2 misses" — because a
  bare count next to a symbol reads as nothing at all unless you already know
  what the column is.
  Only full runs really contend on it, since anything short of the full set
  ended by running out of lives and therefore has exactly that many errors.

## When it breaks on a browser you cannot open

`00-crash.js` loads first and shows any thrown error in a band at the bottom of
the screen, selectable so it can be quoted back. Before it existed, an error
during startup was completely silent: the menu still drew, because it is static
markup, but nothing was wired up, so every button did nothing at all. That is
indistinguishable from "the buttons don't work" — a terrible thing to debug from
a description, on a browser that cannot be run here.

Safari problems found by audit rather than by reproduction:

- `isPointInFill` takes an `SVGPoint` in WebKit and throws a `TypeError` on a
  plain `{x, y}` dictionary. Chrome accepts either, so every tap on the map
  failed on iPhone while nothing failed here. `userPoint()` now returns a real
  point from `createSVGPoint`.
- Startup no longer depends on storage succeeding: the geography is built before
  anything that can throw, so a storage failure costs the remembered preference
  and nothing else.
- `setMode` and `setGeo` bail out if `GEO` is not set yet, since a tap can land
  before the async startup has finished.
- `inset: 0` is spelled out as four sides as well, for iOS before 14.5.

Unresolved: the reported iPhone symptom was that selecting a mode in the menu
did nothing. None of the above is confirmed to be its cause — the SVGPoint bug
would break taps on the map, not buttons in the menu. The crash band exists so
the next report says what actually threw.

## Looking at the map

`render.py <geo> <width> <height>` rasterises a geography exactly as the game
would show it — viewport minus header and footer, view box fitted with `meet` —
and writes a PNG. It is not part of the build.

It exists because every layout decision here until now was made by measuring
numbers, and the numbers hid how bad the result was. "Ink covers 29% of the map
area" is a true sentence that does not convey a map sitting in a thin band with
three fifths of the screen empty. Look at the render before trusting a layout
argument.

The numbers it prints are worth keeping an eye on. France on a 390x780 phone
went from ink covering 29% of the map area to 91% when the layout moved to run
time; the US, which is a single wide panel, is unchanged at 35% on a phone and
91% on a laptop — a 1.7:1 map in a 0.6:1 area cannot do better without splitting
Alaska and Hawaii into their own panels, which is a deliberate no.

## Ideas not built

**Blind mode.** No borders drawn — landmasses only. Every click reveals the
target region, so no click can be wrong and there are no lives. Error is instead
continuous and accumulates: each click scores the distance from the click to the
nearest point of the region being asked for. Inside scores zero, near scores a
little, the far side of the map scores a lot. Ocean is not special-cased.

`distanceTo(region, point)` in `04-geometry.js` exists for exactly this and is
otherwise unused. It is the only speculative code in the repo; if blind mode is
abandoned, delete it.

Smaller ones, never started: region mode (drill one area rather than the whole
set), reverse mode (highlight a region, pick its name from four options),
per-region timing to surface which cost you the most, a lives-remaining tiebreak,
and name entry so a board works for more than one player.
