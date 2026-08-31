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
- **Keep it under about five seconds.** It was forty-three. None of that was the
  checking: the hit-test stub re-parsed every region's path string on every call,
  and `chooseLayout` was run in its own node process twenty-seven times. If it
  creeps again, look for a subprocess inside a loop and for work repeated per
  call that could be done once — not for cases worth deleting.

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

## Rules that were learned the hard way

- **What a control stands on decides its colours, not what its container reads
  like.** Three separate controls have taken a card's ink for a hover state and
  vanished into the near-black metal they were sitting on. `check.py` guards the
  three button hovers now; `REFACTOR.md` has the shape of the real fix.
- **The display face ships as one cut and no rule names a weight for it.**
  Cinzel is a single 600 instance declared across `400..700`. Asking for a
  weight gets a synthesised smear of something already heavy.
- **The middle of the map belongs to one element.** `#splash` takes the wrongly
  tapped name, the region to find, or both. As two boxes they had two lifetimes
  and two animations, which read as a blink, and the gap between them was
  nobody's decision.
- **The menu and the pause card are one construction:** a card on a dimming
  layer, with the whole live board underneath — map, header, footer. Hiding the
  map behind either of them was tried and reversed. A paused run that shows no
  run reads as a different screen rather than the same one held still, and that
  is worth more than denying someone free thinking time.

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
  first by the magnifier alone, then by marks — a drawn circle rather than a
  target bolted beside a shape.
- **Marks as polygon rings.** Correct and ugly: a 24-gon two pixels across is a
  visibly lopsided blob. They are `<circle>` elements now. The lesson generalises
  — reach for the SVG primitive when there is one, and keep the polygon only
  where the maths wants one.
- **`mledoze/countries`** for European names, capitals and groupings. Good data,
  but ODbL: share-alike, reaching `data/clues-eu.json` and the built file that
  embeds it, which is a poor thing to bake in under a project with no code licence
  yet. Everything it supplied is in Natural Earth's own attributes, public domain,
  and the geometry already came from there. Lesson: check the licence of a data
  source before building on it, not after.
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

## The light

`src/js/15-light.js` is the only thing that decides where a shadow goes. It
measures every lit control and writes `--cast`, a list of stacked shadows
stepped along the throw; the stylesheet spends that without knowing how it was
arrived at. Two knobs live in CSS because they are design decisions rather than
lighting ones: `--rise` is how tall a thing stands (full for a card's own
action, half for the quiet ones) and `--lift` is whether it rests on the paper
at all or floats above it.

Custom properties inherit, which bites here: a card declaring `--rise` hands it
to every button inside it. Anything that stands on its own has to say so.

## Textures

`src/textures.py` generates the paper, foxing, swell, crests and brass marks;
`src/make.py` drops them into `style.css` at `__TEXTURES__`, `__MARKS_DARK__`
and `__MARKS_LIGHT__`. Do not write a data URI into the stylesheet by hand — the
encoder there refuses the two ways it has silently gone wrong before (a `%23`
double-encoding to `%2523`, and an unquoted XML attribute killing the file).

## Looking at it

`node shot.js <scene>` screenshots the real thing in Chrome; `node shot.js all`
does every scene. `--light`, `--geo=`, `--w=`, `--h=` are the flags. This is the
only tool that can see fonts, filters, shadows or blend modes — `render.py`
answers where the layout put things and knows none of the stylesheet.

## REFACTOR.md

A running list of places where the code's shape is fighting the work. Read it at
the start of a refactoring round; add to it whenever something costs real time
during any other kind of round, which is the only moment anybody ever notices.
Delete an entry in the commit that fixes it.
