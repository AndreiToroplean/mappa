# CONTEXT

Notes for picking this project back up — the reasoning behind decisions that
aren't obvious from reading the code. Written at the end of the first build
session so a later session doesn't have to re-derive any of it.

## State of the project

Feature-complete and playable. No known bugs. Everything below has been built,
tested and verified.

## Rebuilding

```
python3 src/make.py          # data/states.json + template -> dist/fifty.html
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

**Android touch.** `-webkit-tap-highlight-color: transparent` kills the grey
rectangle Chrome paints over the tapped element's bounding box. Also
`-webkit-touch-callout`, `user-select: none`, and `touch-action: manipulation`
to drop the 300ms double-tap-zoom delay.

**Abbreviations, not full names.** Tried full names first; eight states are too
narrow to hold one, so it could never be consistent. Two letters fit inside all
fifty. Colour carries the meaning — teal found, red miss, amber answer — and the
footer ticker gives the full name on every click.

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
  Zero-state runs don't post. Stored via `window.storage`, in-memory fallback.

## If uploading to a Claude Project

Upload the text sources — `README.md`, `CONTEXT.md`, `src/template.html`,
`src/build.py`, `src/make.py`. Roughly 30KB.

Do **not** upload `data/states.json`. It's ~107KB of coordinates on a single
line, it tells a reader nothing, and it would consume context in every
conversation. It can be regenerated with `npm pack us-atlas@3` +
`python3 src/build.py`.

## Possible next steps

Not started, in rough order of appeal:

- Region mode: drill one area (New England, Mountain West) instead of all 50.
- Reverse mode: highlight a state, pick the name from four options.
- Per-state timing, to surface which states consistently cost you the most.
- Streak bonus, or a lives-remaining tiebreak in leaderboard ranking.
- Name entry on the leaderboard, so it works for more than one player.
