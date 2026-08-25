# Working notes

How to pick this project up, the handful of decisions that are traps, and the
dead ends worth not repeating. `ARCHITECTURE.md` is what the thing is.

This file used to be seventy-five thousand characters of reasoning behind every
decision. Almost all of it was recoverable from the code it described, and
keeping it current was costing more than it returned. It is in
`git log DESIGN.md` if a decision ever needs archaeology. The bar for adding
anything here now: **would a competent newcomer get this wrong without being
told?** If the answer is no, the code comment is enough.

## Picking this up in a new session

The repo does not live on the machine that writes it, and the container's
filesystem does not survive between sessions. Each session starts from
`mappa.bundle`, which Andrei keeps:

```
git clone mappa.bundle mappa && cd mappa && git remote remove origin
npm install jsdom          # re-run every session; node_modules is gitignored
```

Andrei does not read the code. Say what changed and why, not what the diff looks
like — and **flag the judgement calls**, because those are the part he can
actually check.

- One commit per point of instruction, committed as you go without being asked.
- Hand over `dist/mappa.html` every time, so it can be tried on a phone. Do not
  regenerate `mappa.bundle` unless asked; when asked, write it and hand it over
  without cloning it back to prove it works.
- Andrei does the looking. Render or screenshot when *you* need to see something
  to make a decision, not to demonstrate finished work.
- `check.py` must be green before every commit.

## check.py is the gate, not decoration

It runs the pure logic against independent implementations, in Python and in
node, with no browser. Extend it whenever a new invariant appears. Every one of
these was a real bug that a test caught only because the test was written before
the code was believed:

- **Name expectations; do not derive them from the data being checked.** A test
  that reads the answer out of the file agrees with whatever the file says. This
  is why `MARKS`, `APART`, `ENDS` and the board keys are written out by hand.
- **Do not stub the thing under test.** The harness replaced `stateUnder` with a
  first-match scan, which hid the whole of the rule that makes marks reachable.
- **Do not leave an assertion to luck.** The drift scale's far end was asserted
  from whichever of sixty random pairs happened to be extreme; Europe's draw
  came in at 49.9 against a threshold of 50.
- Also caught this way: a panel test that was in a comment and not in the code,
  a private copy of `addEntry` that had drifted from the real one, and a panel
  box measured before its marks were substituted.

Two build-time habits in the same spirit. Before adding a field to the emitted
data, check whether the number is already implied by the geometry — it usually
is; a `span` field was added and reverted. And run `render.py` before trusting
any argument about layout: visual rendering has caught bugs invisible to numeric
metrics, and a preview that differs from the game is worse than none.

## Things that are frozen

- **Storage keys and axis ids.** See *Axes and storage* in `ARCHITECTURE.md`.
  Renaming any of them orphans real saved boards.
- **The link's four parameter names**, which are a published surface.
- Both `data/us.json` and `data/fr.json` reproduce byte for byte from their
  build scripts. Verify that still holds before changing anything shared.

## Dead ends

- **Visible water**, twice. Filled ocean polygons: Natural Earth's outlines are
  too coarse beside the overseas départements, per-panel clip boxes cut hard
  rectangles, and Hawaii's water covered Mexico. A halo stepped outward along
  coastal border normals: better in principle, worked on the US, wrong on
  France. Both are on branch `water-wip`. Settled instead by giving up on being
  right — the map area is painted `--sea` and every region drawn on top, so
  everything that is not a region is water. There is a great deal of Canada in
  it and nobody reads it as a claim. Note for anyone tempted again: Natural
  Earth's ocean is one globe-covering polygon with continents punched out as
  holes, so a rasteriser that fills rings independently makes everywhere water.
  Land is the honest primitive.
- **Invisible tap circles** over small regions. They widened a shape without
  moving it, so what you could see and what you could press disagreed. Replaced
  first by the magnifier alone, then by marks, which are geometry rather than a
  target bolted beside geometry.
- **A hand-drawn lon/lat window** deciding which islands are in Europe. Every
  bound was a number somebody chose, and it was wrong about the Azores, whose
  eastern islands sit inside a box drawn wide enough to admit Iceland. Replaced
  by a cost against the frame, which has no bounds to choose.
- `src/build-coast.py` stays on master unused: it holds the recovered `albersUsa`
  transform, which anything aligning to the US map will need.

## Debugging a browser you cannot open

`00-crash.js` loads first and shows any thrown error in a selectable band at the
bottom of the screen. Before it existed a startup error was silent — the menu
still drew, because it is static markup, but nothing was wired up, which is
indistinguishable from "the buttons don't work".

Safari is the one that breaks: `isPointInFill` needs a real `SVGPoint` and throws
on a plain object, which Chrome accepts, so every tap on the map failed on iPhone
while nothing failed here. When something works here and not on a phone, suspect
WebKit strictness first.

For flows that only exist in the DOM — the end card, the import card, the
magnifier — a throwaway jsdom script that loads `dist/mappa.html` and drives the
real handlers is the only way to check them. Those probes are scratch, not
committed; `check.py` stays browser-free on purpose.

## Not built

The next continents, following Europe's pattern.

Blind mode — no borders drawn, landmasses only — is what `distanceTo()` was kept
for. Distance scoring built most of it; what is left is the rendering option. One
quirk to settle first: on the last region of a distance run every other region
has been consumed, so a tap anywhere resolves to the answer.

Never started: region mode (drill one area), reverse mode (pick a name from four
options), per-region timing, a lives-remaining tiebreak, name entry so a board
works for more than one player.
