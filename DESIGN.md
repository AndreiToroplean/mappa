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

## Clues

Three rungs, requested not given, in a fixed order: arrow, capital, grouping.
Each rung says whether it can be offered yet — the arrow needs a wrong guess to
point away from, so before the first miss the button skips it. A new miss
re-opens that rung, since pointing from a different mistake is new information,
and it is paid for like any other clue. The ladder resets each turn; the tally
does not reset until the run does.

The arrow starts where the centre-to-centre line crosses the border of the region
that was hit, from the composed border index. A fixed offset from the centre was
the first attempt and is wrong in both directions: still inside a large region,
adrift from a small one.

Its three distance bands are three *shapes*, not three widths. Width alone was
tried and was useless — an arrow is never seen beside another one, so there is
nothing to compare a thickness against.

Ranking adds misses and clues into one figure, then time. Ranking misses first
would make clues nearly free; adding them keeps "least help, then quickest"
explainable in a sentence, and both numbers are displayed so a row is still
readable. Practice buckets entries on the pair, so one clue and one miss is a
different achievement from two misses.

Grouping outlines come from different places by necessity. The US dissolves them
from TopoJSON arcs, which is exact because neighbours share arc indices and an
interior arc is used twice. France cannot: each département was simplified on its
own, so a shared border is two slightly different polylines and no edge matching
cancels them. France therefore uses the régions' own geometry, projected with the
mainland's transform. Checked by alignment against members — exact for the US,
0.6 units for Île-de-France.

The five overseas départements are each their own région, so the grouping clue
reveals the answer there. Kept anyway: one rule for every region beats an
exception nobody can predict.

## Pausing

The clock is derived from `t0` rather than accumulated, so resuming only has to
push `t0` forward by the length of the pause — no drift, nothing to reconcile.

The map is hidden while paused. That is the feature, not a nicety: a stopped
clock over a visible map is free thinking time, which would make Trial times and
Practice scores incomparable. `guess()` also refuses while paused, since the tap
targets are still there under a hidden map.

Leaving a pause in either direction has to clear the paused class explicitly, or
the map stays invisible behind whatever screen comes next.

## Arrow bands

By relationship, not raw distance. "You are touching it" is a different and more
useful statement than "you are close", so the thin chevron means a shared border,
measured border-to-border — the distance between centres says nothing about it,
since Paris and Essonne are further apart than Paris and Hauts-de-Seine and all
three touch. `borderDist2`'s ceiling makes that test cheap enough to run per
border point.

The middling band is anything within half the mainland's drawn span, taken from
the layout so it cannot fall out of step. Beyond that, the solid head.

The rung is unavailable when the two regions sit on different panels. An arrow
between the mainland and an inset would point across a gap that does not exist.

## Inset packing

Bottom-left packing against a skyline, at whichever of five candidate widths
gives the tightest bounding box.

Both simpler rules were tried and both were visibly wrong. A single shelf made
the block as deep as Guyane, the tallest, and left the four small insets floating
in a band of empty space beside it. Packing at full width then minimised depth,
which laid those four in one long row and left the space beside Guyane empty —
minimal depth is not the same as tidy. Scoring candidates on bounding area
instead lets the small ones stack next to Guyane, which is how an atlas sets
them, and took a phone from 82% to 90% ink coverage.

Five insets, five candidate widths: cheap enough to just try them all.

## Inset scale

Insets are drawn at the mainland's scale — equal kilometres per composed unit —
then magnified only as far as they must be to stay hittable, capped at 3x.

Filling equal cells was the first attempt and was wrong twice over: five insets
of wildly different real size came out identical, and together they took half a
phone screen for five départements out of 101.

Albers USA is the precedent. Measured against known areas it draws Alaska at
0.33 and Hawaii at 0.77 of true scale, so the convention is a *bounded*
departure from truth rather than a free one. Here the departure runs the other
way — magnifying the small ones — and is capped. Guyane, genuinely 39% of
France's span, still reads as much the largest; Mayotte is boosted the full 3x
and is still the smallest.

Panels therefore carry a `km` figure, measured from the original coordinates,
because normalising each panel to a common local span throws real size away and
the layout needs it back.

Insets are shelf-packed at their own sizes rather than placed in a grid, and the
mainland's scale is found by binary search, since the insets' sizes depend on it.

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

## Water: parked on branch `water-wip`

Two attempts shipped and both were wrong, so visible water is off master. The
work is preserved on `water-wip` (`git log water-wip`), which has both.

What failed, so it is not tried a third time the same way:

- **Filled ocean polygons.** Natural Earth's outlines are too coarse next to the
  overseas départements, leaving visible facets; the per-panel clip boxes cut
  hard rectangles at panel edges; and Hawaii's water covered Mexico.
- **A halo along coastal borders**, found by stepping outward along each border
  segment's normal. Better in principle — nothing to line up, nothing to clip —
  and it worked on the US, but it was not verified on France before shipping and
  is not right there.

What is worth keeping from it, and why it stayed:

`src/build-coast.py` holds the projection recovery. us-atlas ships coordinates
already run through d3's albersUsa, so anything new that has to align with the US
map needs that transform back. The script fits each of the three sub-projections
against the stored geometry and asserts the residual — the lower 48 land at 2.8
units on a 1000-unit map. Fitting on bounding boxes rather than vertices is
load-bearing: the sources have different vertex counts, and pairing by index
threw it out by 13 units. France needs no fit, since we own that projection and
recompute its transform exactly.

Also worth remembering: Natural Earth's ocean is one polygon covering the globe
with continents punched out as holes, so a rasteriser that fills each ring
independently makes everywhere water. Land is the honest primitive.

## Looking at the app

`render.py` has two views and one map painter shared between them, so they can
never disagree about what the game would draw:

    python3 render.py map fr 390 780     # the map area alone
    python3 render.py app fr 780 390     # chrome, text, buttons, real map

The app view exists because layout arguments that sound obvious in prose keep
turning out wrong — a sidebar that reads well can still leave a button on the far
side of the screen from the thumb, and a map can be a letterbox inside a
letterbox without anyone noticing from the numbers. The landscape layout below
was designed against that view before any CSS was written.

## Landscape

A phone on its side has the wrong shape for a stacked header, footer and map: the
map was using 54% of its area. The chrome moves into a 240px sidebar, laid out
with a grid whose header and footer both occupy the left column while the map
spans the right. Map coverage goes to 98%.

The pause and clue buttons leave the sidebar for the right edge, because in
landscape the sidebar is the far side of the screen from both thumbs — exactly
where an action button should not be. They are positioned over a third grid
column that holds nothing: floating them over the map itself hid the
départements underneath, and an empty column is the transparent sidebar that
keeps the map clear of them.

The column is the width of the buttons and no more, and both are flush to the
same right edge so their borders line up. The clue button is a fixed width for
that reason too: its label runs from Clue to Another clue to No more clues, and
the edge must not shuffle when it does.

## One pipe for everything on the map

`compose()` ends by calling `redrawHints()`. Composed coordinates are baked into
path data, so anything drawn from them and left on screen has to be rebuilt when
the layout changes — a grouping outline or an arrow revealed in portrait pointed
at thin air after a rotation, because the map moved and they did not.

The fix is structural rather than a patch per hint: the hints remember *what*
they are showing, never their coordinates, and `compose()` is the single place
that turns what-is-showing into where-it-goes. Anything new drawn in composed
coordinates and persisting across a layout change belongs in `redrawHints()`, or
it will survive a resize in the wrong place.

Checked by composing for portrait, drawing an arrow, recomposing for landscape,
and asserting the tail moved and still sits beside the region it starts from.

## Full screen

The address bar and status bar cost real map, and CSS cannot touch them. The
Fullscreen API is the only lever and fires only from a user gesture, so it is a
button in the menu, with the preference remembered — starting a run then
re-enters full screen on the tap that starts it, which is also a gesture and so
also allowed. Android Chrome supports it; iPhone Safari does not, and the button
hides itself rather than sitting there doing nothing.

The menu is a two-column grid in landscape, the board beside the rest rather than
below it. As one column it ran off both ends of the screen. It scrolls if it
still does not fit, with the scrollbar hidden — a visible one was a complaint the
last time this was tried.

Portrait is untouched.

## The menu says one thing

The menu used to explain three: what you do, that press-and-hold opens a
magnifier, and what ended a run. The last of those had gone stale — it still said
your time was the score, which stopped being true when errors and then clues
entered the ranking — and stale instructions are worse than none, because they
are read as authoritative.

The other two were not needed either. Both are already taught in the ticker at the
top of the first run, by `MODE.hint()`, where they arrive at the moment they are
useful rather than in a paragraph nobody reads twice. So the menu keeps one
sentence and drops the rest.

The space matters, not just the tidiness: in landscape the menu is fighting for
room, and four lines of prose was the cheapest thing on the card to give up.

`MODE.rule` is gone with it rather than left unused.

The tagline under the title is a fixed *A geography drill* for the same reason it
is short: it used to be per-geography copy, so choosing France resized the line
that sits directly above the switcher you had just used. A tagline that names the
geography is also redundant with the switcher two lines below it saying the same
thing. `GEO.sub` is deleted, not orphaned.

## The menu is sized by the window, not by its contents

Every switch on the menu changed the size of the menu. The rules paragraph is a
line longer in Practice than in Trial; `département` wraps where `state` does
not; the board grows from a one-line note to six rows over a few sessions. All of
it fed back into the card's height, so choosing a mode moved Start out from under
the thumb that was reaching for it.

The card's height is now `min(660px, 100%)` in portrait and the window less its
padding in landscape. 660 is a little above the tallest the contents get once the
explanation is one line, so a roomy screen shows no scrollbar; the cap keeps the
card from becoming a full-height slab on a tall monitor.

The board is the only child allowed to flex, which is the point rather than a
detail: it means there is exactly one place where variation can go, so nothing
above it can move no matter what changes below. When it runs out of room it
scrolls, with the scrollbar hidden, matching what the landscape card already did.

Deliberately not done: reserving a fixed height for each varying piece — a
min-height on the rules, another on the board. That pins the same things, but
every one of those numbers is a guess about how text wraps at a width you do not
control, and it has to be re-guessed whenever the copy changes. A window-derived
height needs no such guess.

The end-of-run card carries the same switchers and the same board, and gets the
same treatment from the same rules — they are keyed on a `menu` class rather than
on either card's id. That is not only for consistency: it is the same card in two
states, and sharing one height means going menu -> run -> end card and back moves
nothing on screen but the words. The pause and confirm cards are not menus and
keep their content-sized height, which is right for a card holding two buttons.

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
