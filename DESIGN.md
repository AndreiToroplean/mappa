# Design notes

Why this project is the way it is — the reasoning that is not recoverable from
reading the code, and the mistakes that produced it. `ARCHITECTURE.md` covers what the
thing is and how to build it; this file covers why.

Written and kept up to date across the sessions that built it. If you change a
decision recorded here, change the note too.

## Picking this up in a new session

The repo does not live on the machine that writes it. Each session starts from
`fifty.bundle`, which Andrei keeps: `git clone fifty.bundle fifty`, then
`git remote remove origin` since that origin is the bundle file. The container's
filesystem does not survive between sessions; the bundle is the only continuity.

```
python3 src/make.py     # -> dist/fifty.html, the whole game in one file
python3 check.py        # the regression harness; must be green before a commit
python3 render.py app fr 780 390    # rasterise, to see what the code drew
```

Andrei does not read the code. Say what changed and why it changed, not what the
diff looks like — and flag the judgement calls, because they are the part he can
actually check.

Working habits that have earned their place:

- One commit per point of instruction, committed as you go without being asked.
- Do not regenerate `fifty.bundle` unless asked. Do hand over `dist/fifty.html`
  every time, so it can be tried on a phone.
- `check.py` is not decoration. Three real bugs were caught by writing the test
  before believing the code: the panel test that was in a comment and not in the
  code, the harness's private copy of `addEntry` that had drifted from the real
  one, and a test that derived its expectations from the data it was checking.
  Name expectations rather than deriving them.
- Before adding a field to the build, check whether the number is already implied
  by the geometry. It usually is; see the `span` that was added and reverted.
- `render.py` before trusting any argument about layout.

Regenerating the source data needs downloads that are not in the repo — see the
docstrings at the top of `build-us.py`, `build-fr.py` and `build-clues.py`. Both
builds reproduce the committed files byte for byte, which is worth verifying
before changing either.

The roadmap, such as it is, is *Ideas not built* at the end of this file.

## Structure

`src/` is split for editing; `make.py` inlines it all back into one file, so
the shipped artifact is unchanged — single file, no external references.

```
01-data.js    the region set and its short keys; MODES, SCORINGS, ranking
02-map.js     SVG construction, paint layers, labels, tap targets, STATUS
03-run.js     run lifecycle: queue, spending cap, clock, guess()
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
on it, resolving a position is a minimum over it, and what distance scoring
charges for a miss is `distanceTo()` — the same measure aimed at one named
region, zero inside.

**Totals are derived.** `TOTAL` from the region set, the spending cap and the
wording from `MODE` and `SCORING`. Fifty was hardcoded in eight places and three lives in two, which is
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
running out of lives, so its count is exactly the cap. A completed run's
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
wants. Geography vocabulary stayed behind on `GEO`, which is the right seam:
the three axes vary independently.

Practice keeps one entry per miss count, Trial keeps one per tally plus five
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

## Scoring by distance

A third axis, independent of the other two. Mode says whether a run can end
early; scoring says what a wrong tap costs. Counting asks whether you knew it.
Measuring asks how close you were, and under it a tap on the neighbouring
département and a tap in the Atlantic stop being the same answer. A different
drill, not a different difficulty, which is why it is an axis and not a mode.

A hit is free either way. The cost is computed only for taps the ordinary
resolver rejected, so ocean-snapping and the enlarged hit circles still decide
what counts as knowing it and the two scorings agree about that exactly.

**One tap per region, and it interrupts nothing.** Guessing again is how you
*narrow* an answer, and narrowing is the thing this scoring prices: a second
guess three regions closer would post a better distance than the first, and the
number would describe the search rather than the knowledge. So a wrong tap ends
the turn — but the next region is named in the same breath. The first attempt
held the screen for two seconds with the clock stopped, which broke the rhythm
the drill is built on; counting mode had already settled that question. A miss is
reported, not dwelt on.

The report is the flashed name, the outline of what was hit, and an arrow to what
was wanted. All three share `MISS_MS`, because they are one statement about one
tap and it read as a bug when the arrow stayed behind. The flash says the name
and nothing else, as in every other mode: the cost lived under it for a version
and that was one event reporting itself twice at once. The footer has room to say
it properly — *~~Arkansas~~ Missouri · Off by 1,850 km (−43 pts)*.

**The wrongly tapped region keeps its status, and only its outline is marked.**
Marking it would take it out of play, and it may well be the region just named —
the one thing a player must be able to do straight after a wrong tap is tap the
same shape again and be right. Outline rather than fill, because a filled shape
means a state the region has *become*, and this one has become nothing.

**No arrow across a gap the map invented.** Same rule as the clue arrow, named
once as `sameLandmass()` and used by both.

### The scale

**100 is the panel's true diameter** — the farthest two points of it can be — so
a full-width miss is exactly 100 and nothing can be worse. Not kilometres:
France would be scored on a fifth of the width of the US and neither run would
say anything about the other.

The bounding box will not do for that. Its diagonal overstates a wide flat
country and its sides understate a diagonal one; France's ink spans 1000x931
local units and its diameter is neither 1000 nor 1366, but 1205. So
`measurePanels()` takes the convex hull and walks it with rotating callipers,
once per geography load. Nine thousand points reduce to a hull of a few dozen.
`check.py` computes the same number by brute force over every hull pair, so the
callipers are checked against something that cannot share their bug.

**No build data, and almost no new geometry.** The first attempt added a `span`
to every panel at build time and did not need to: `distanceTo()` already measured
a point to a region. The lesson generalises — before adding a field, check
whether the number is already implied by the geometry. Kilometres come from
`normalise()` having scaled each panel's longest side to `PANEL_SPAN`, with `km`
being that same side in real kilometres. Dividing the composed distance by the
panel's placed scale first is what keeps the score independent of the window.
`nearestPointOn()` is the only genuinely new geometry, and only because the arrow
has to be *drawn* to the point the distance was measured to.

**A different landmass costs a flat 100** and reports no kilometres, because
there is no honest number to report across a gap the map invented.

**Always whole,** but the running total is kept unrounded until it is shown or
stored — rounding each miss as it lands would let a run of small ones cost
nothing. **A run holds 100, one full map.** `MODE.lives` is gone: it conflated
"a run can end early" with "at what", now `MODE.capped` and `SCORING.budget`.

**One name for the unit.** Points, abbreviated to *pts* where a row must stay on
one line. It was *error points* for a version, and *EPs* in the rows.

### A purse, not a debt

Same arithmetic, opposite direction. A run starts holding a hundred points and a
miss takes some; the header counts down, and a Trial ends when there is nothing
left. That end condition is not new — spending a hundred and running out were
always the same moment — but watching something you hold disappear is a different
feeling from watching a debt climb, and the second one gave a good run nothing to
be proud of. A hundred at the end is now a score rather than the absence of one.

Practice holds the same hundred and is simply allowed to spend past it, so a run
there can finish owing five hundred. That is a real result and reads as one: red,
and told in full rather than clamped at zero.

The stored quantity is still the spend. Points are the purse minus it, computed
where they are shown, so every board saved under the old reading ranks and reads
correctly under the new one.

**What a distance board is about depends on the mode**, which it did not before.
Practice reaches the last region whatever happens, so the tally is constant and
the points are the run. A Trial is *stopped* by the purse, so the points are near
enough a hundred for every run that ran out and say nothing; how many regions the
purse got you through is the whole story. So a Trial ranks on regions revealed —
one entry per count, full sets coexisting and ranked on what they kept — exactly
the shape counting-Trial already had, with `byTally()` asking `tallyOf()` which
number it is looking at rather than reading `f` off the entry.

Runs saved before the board recorded a revealed count fall back to the regions
they found. That is a true lower bound rather than a guess, so it under-ranks
them instead of promoting them, and the row shows a dash rather than a number
nobody measured.

**The answer to a miss is flashed amber before it settles into its score
colour.** Late in a run most of the map is already coloured, and a region turning
one more shade of amber-to-red is easy to lose among the ones that did the same
thing three turns ago. So it is revealed the way every other mode reveals an
answer, and then becomes its score in front of you — which also puts the colour
scale in front of someone learning to read it.

Ending on the region's *own* colour is the awkward part: it differs per region
and is set inline, and a class cannot outrank an inline style. An animation can,
so `paintScore()` publishes the colour as a custom property and the keyframes
read it back off the element. The three temporary marks — the wrong region's
outline, the answer's flood, review's pick — now share one clock, since a miss
starts two of them in the same instant and they are one report.

### Fixed insets, and the arrow that lied

The US shipped as one panel, because Albers USA had already composited Alaska and
Hawaii into the frame and there was nothing left to place. That was true of the
picture and wrong as a model, and the clue arrow is where it showed: asked for
Hawaii, a miss on Texas drew an arrow pointing down, because on one panel every
region is the same landmass and `canNudge` had nothing to refuse. Down is where
Hawaii is on the page. It is not where Hawaii is.

The fix is not a special case in the arrow. It is to stop lying in the data: the
US now ships three panels, and Alaska and Hawaii are their own. What they are not
is *laid out* — the projection already chose their positions and those positions
are worth keeping — so a panel may now carry `fix`, a place in panel 0's own units.
Fixed panels ride the mainland's transform, so the arrangement survives every
screen shape, and the packer never sees them.

Their space needs no reserving because panel 0's box is the whole composited frame
rather than the lower 48's ink. That is what it already was, which is why splitting
the panels out changed nothing on screen.

Two details that make it exact rather than nearly exact:

`pin()` shifts geometry to its own origin but does **not** rescale it, unlike
`normalise()`. Rescaling would change what the simplification tolerance means, and
the panel would come out with different points than it had as part of its host. At
scale 1 the tolerance is unchanged.

The shift is rounded to a whole tenth, the grid the coordinates themselves are
stored on. An arbitrary offset would round twice — once into the host's space, once
into the panel's — and move points by up to a tenth of a unit. On the grid,
subtracting the offset and adding it back is exact. Verified: composed coordinates
are identical to the single-panel build at all nine test aspect ratios, to the last
bit.

The harness names the pairs it expects apart — Hawaii and Texas, Guyane and Nord —
rather than deriving them from the panels. Deriving them would make the test agree
with whatever the data says, which is exactly the thing that was wrong.

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

The other two were not needed either. Press-and-hold is taught in the ticker at
the top of the first run, where it arrives at the moment it is useful rather than
in a paragraph nobody reads twice. What ends a run is on the header all run long,
in the column that counts lives or misses by name. So the menu keeps one sentence
and drops the rest.

The space matters, not just the tidiness: in landscape the menu is fighting for
room, and four lines of prose was the cheapest thing on the card to give up.

`MODE.rule` is gone with it rather than left unused.

The same pass took the rest of the mode-adapted prose out of the game. The empty
leaderboard said *No runs yet* and then a sentence per mode explaining how that
mode scores; it now says only the part that answers the question the blank space
raises. The ticker's opening line dropped its per-mode tail for the same reason.
`MODE.empty` and `MODE.hint` are both deleted.

The rule this leaves: copy is adapted to the mode only where the mode changes what
the words *mean*, not where it changes what they could explain. The header's
Lives/Misses column qualifies — it is a live number and needs the right name. The
clear-board confirmation qualifies — it names which of the two boards is about to
be destroyed. A paragraph restating the scoring does not.

Kept deliberately: the storage note under each board. It reads as the same kind of
copy but is not — it varies by backend, not by mode, and it answers whether the
scores you are looking at will still be there tomorrow. A board that silently
forgets is worse than one that says up front that it will.

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

The card's height is now `min(720px, 100%)` in portrait and the window less its
padding in landscape. 720 is a little above the tallest the contents get, so a
roomy screen shows no scrollbar; the cap keeps the card from becoming a
full-height slab on a tall monitor. It was 660 before the scoring axis added a
second row of buttons — a number that has to be revisited when the card gains a
row, which is the honest cost of this approach.

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

## Reviewing the map after the run

The game never told you the answer. It told you *that* you were wrong — a red
outline, a name flashed for a second and a half, a colour on the shape — and then
named the next region, because a run that stops to teach is not a run. By the end
card the moment for asking has gone: the card covers the map at exactly the point
the map has the most to say, with every region resolved and, under distance
scoring, every one of them coloured by what it cost.

So the card gets out of the way on request. Review is not a mode and does not
change what happened; it hides the overlay and leaves the map alone. `finish()`
paints nothing new, which is why there is nothing to restore — the map behind the
card *is* the map at the end of the run, and giving it back is a matter of
`hidden = true`.

What changes is what a tap means. During a run a tap is an answer and costs
something; here it is a question and costs nothing, so the region names itself,
along with its grouping and its capital. Those are the clue ladder's facts, in
the ladder's order. Rationing them is the whole reason a clue is worth counting,
and there is no longer a run to protect.

Three choices worth recording:

**Amber, not green.** Green means correct, and reviewing a region you got wrong
in green would be a small lie every time it mattered most. Amber is already the
colour of help everywhere in this game — the revealed answer, the miss arrow, the
grouping outline — so review borrows the vocabulary rather than inventing one.

**Selectable inverts rather than gets bypassed.** During a run a region is worth
resolving to only while picking it would still do something, which is why solved
regions are excluded. In review the regions worth asking about are precisely the
resolved ones, so the same predicate takes a branch and everything downstream —
the 40-unit snap, the containment rule, the magnifier's aim — carries over
untouched. Adding a second resolver would have been the obvious move and would
have meant two things to keep in step, which is the mistake this codebase has
already made twice.

**The magnifier's caption changes what it carries.** Mid-run it deliberately
never names what is under the crosshair, because naming it would answer the only
question the game asks; it says *lift to pick* instead. In review there is
nothing left to give away and nothing to promise — a lift costs nothing — so the
caption holds the facts, and press-and-hold becomes a way to read the map by
dragging across it. Same line as the ticker, from the same function, so the two
cannot come to disagree.

The outline on the picked shape was not asked for and is not decoration: the
resolver snaps a tap in open water to the nearest coast, so the name that flashes
is not always the shape under the finger, and without the outline the two are
unattached. It is an animation rather than a class because a scored region
carries its colour as an inline style — a class cannot outrank that, an animation
can — and it deliberately does not use `forwards`, so ending hands the region its
own colour back at the moment the class is removed.

The one thing that is now load-bearing where it was not: the clue data. The
ladder can skip a rung it has no facts for, so a gap there degraded quietly.
Review has nothing else to say, so the same gap is a region that names itself and
stops. `check.py` checks the shipped data files for it, not just `build-clues.py`
at build time.

## Ideas not built

Blind mode — no borders drawn, landmasses only — was the idea on this list that
`distanceTo()` was kept for. Distance scoring built most of it: continuous error,
every region revealed, no click wrong. What is left of the original is only the
part about not drawing the borders, which is now a rendering option rather than a
mode.

Smaller ones, never started: region mode (drill one area rather than the whole
set), reverse mode (highlight a region, pick its name from four options),
per-region timing to surface which cost you the most, a lives-remaining tiebreak,
and name entry so a board works for more than one player.
