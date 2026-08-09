# CONTEXT

Notes for picking this project back up — the reasoning behind decisions that
aren't obvious from reading the code. Written at the end of the first build
session so a later session doesn't have to re-derive any of it.

## State of the project

Feature-complete and playable. No known bugs. Everything below has been built,
tested and verified.

## Rebuilding

```
python3 src/make.py          # src/* + data/states.json -> dist/fifty.html
```

`dist/` is generated and deliberately not committed.

To regenerate the geometry from scratch (only needed if the map data changes):

```
npm pack us-atlas@3 && tar xzf us-atlas-3.0.1.tgz    # creates package/
python3 src/build.py                                 # rewrites data/states.json
```

`package/` is gitignored. The build is fully reproducible from the network.

## Decisions, and why

**Pre-projected map data.** `states-albers-10m.json` rather than
`states-10m.json` — it's already in Albers USA with Alaska and Hawaii in their
conventional insets. Using the unprojected version would mean implementing d3's
composite `albersUsa` projection (conic equal-area, plus separate transforms and
clip extents for AK and HI) at build time. Not worth it.

**Pole of inaccessibility for labels.** Bounding-box centres put Michigan's
label in Lake Michigan, Louisiana's in the Gulf, and Alaska's and Hawaii's in
open ocean, because states aren't convex. `build.py` reimplements Mapbox's
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

`Infinity` lives is load-bearing in one place — `drawLives()` would try to
build an infinite array, so it returns early when lives are not finite, which
also happens to be exactly when the indicator should be hidden.

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

## If uploading to a Claude Project

Upload the text sources — `README.md`, `CONTEXT.md`, `src/index.html`,
`src/style.css`, `src/js/*.js`, `src/build.py`, `src/make.py`.

Do **not** upload `data/states.json`. It's ~107KB of coordinates on a single
line, it tells a reader nothing, and it would consume context in every
conversation. It can be regenerated with `npm pack us-atlas@3` +
`python3 src/build.py`.

**Leaderboard storage, three backends.** `window.storage` inside the artifact
runtime; `localStorage` when the file is downloaded and opened directly; memory
as the last resort. The original code only tried `window.storage` and fell
silently into a memory array otherwise, which meant a downloaded copy lost its
board on every refresh and gave no hint why. Note that `window.storage` is
scoped per artifact instance, so scores do *not* carry across a rebuild — that
is the runtime's boundary, not a bug, and the cards now say so rather than
leaving it to be discovered.

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

## Roadmap (recorded, not started)

Three directions, sketched by Andrei. Nothing here is committed to; they are
written down so refactoring leaves the right seams rather than to be built now.

**Practice mode.** Built. See below.

**Other geographies.** The same game over a different region set — countries of
Europe was the example. Implies the data format, the prompt wording and the
board keys all stop being US-specific. `build.py` is currently welded to
us-atlas.

**Blind mode.** No borders drawn — landmasses only. Every click reveals the
target region, so no click can be *wrong* and there are no lives. Instead error
is continuous and accumulates: each click scores the distance from the click to
the nearest point of the region that was being asked for. Inside it scores
zero; near it scores a little; the far side of the map scores a lot. Ocean is
not special-cased — same measure, no discount.

Worth noting the blind-mode metric is a function the code nearly has already:
`nearestSelectable()` computes distance to the closest point on a region's
border while searching for a minimum. Blind mode needs the same measure aimed
at one *named* region rather than minimised across all of them, plus zero when
the point is inside. A shared `distanceTo(region, point)` primitive serves the
resolver, the snap threshold and the blind-mode score at once.

Combinations are plausible: blind mode over Europe, practice over anything. So
mode and geography want to be independent axes, not a fixed list of modes.

## Possible next steps

Not started, in rough order of appeal:

- Region mode: drill one area (New England, Mountain West) instead of all 50.
- Reverse mode: highlight a state, pick the name from four options.
- Per-state timing, to surface which states consistently cost you the most.
- Streak bonus, or a lives-remaining tiebreak in leaderboard ranking.
- Name entry on the leaderboard, so it works for more than one player.
