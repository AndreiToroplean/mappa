# Things worth refactoring

A running list of places where the code's shape is fighting the work, written
down as they are noticed rather than when there is time to fix them.

**Why a file.** The moment you find out a piece of code is the wrong shape is
while you are halfway through changing it — and that is exactly the moment you
cannot stop and fix it, because you are in the middle of something else. Left
unwritten, the observation goes with the session. So it goes here instead, and a
refactoring round starts by reading this rather than by trying to remember.

**What belongs here.** Not everything imperfect. Something earns a line when it
has already cost real time, and preferably more than once — a change that took
four steps because the code made you take four, a bug that could only happen
because two things had to be kept in step by hand, a place where the obvious
edit is the wrong one. The entry should say what it cost, not just what it is,
because that is what decides whether it is worth the risk of moving later.

**What to do with it.** Add a line when something bites. Update the line if it
bites again, since twice is the argument for fixing it. Delete the entry in the
same commit that fixes it. If an entry has sat here for a long time and never
cost anything more, that is evidence it was not worth doing, and deleting it is
a fine outcome too.

---

## Shadows have no lighting layer, and cannot get one cheaply

Two shadows falling on the same spot add up, so a throw landing inside the
window's own shadow darkens ground that was already dark. The right fix is what
a renderer does: build one layer holding all the light and all the shadow,
combine within it so darkness unions rather than sums, and multiply it onto the
scene once.

An attempt to get the same effect without the layer — evaluating the window
function at each element's position and scaling its throw by the sun there —
was reverted. It is the right physics asked in the wrong place: a shadow belongs
to a surface, and one question per element gives an answer that is wrong for
anything wider than a glazing bar, which is most buttons and every card.
Sampling several points per element papers over it and does not fix it.

Doing it properly means a fixed layer above the scene with `mix-blend-mode:
multiply`, holding the window pattern, and one absolutely-positioned proxy per
lit control blending `darken` against it — which means 15-light.js writes
elements rather than properties. That is a real piece of work and it is not
obviously worth it: the doubling is only visible where a throw crosses a bar,
which on most screens is a handful of pixels. Written down so the next person
does not rediscover the cheap version and its ceiling.

## Nothing structural stops a control being lit but see-through

Fixed for now, and worth watching. Every throw is drawn on a layer behind the
thing that casts it, so a control with no ground of its own shows whatever is
beneath it — which is how one button's shadow ended up printed across two
others. Six separate rules had `background:transparent`, and each was found by
a different bug report before `check.py` was taught to look for all of them at
once.

The check makes it a build failure rather than a discovery, which is most of
the value. What would make it impossible rather than caught is a lit control
having a ground by construction — one rule that gives every one of them a
surface, with the variants overriding the colour rather than each stating a
whole background from scratch. Six near-identical background stacks is the
smell; it is a small refactor and only waiting for a quiet moment.

## render.py keeps its own copy of the header and footer heights

It draws the board's chrome from its own numbers so it can work without a
browser, which is the whole reason it is useful. But two of those numbers are
the header and footer heights, and the stylesheet has them too — so padding the
bars meant editing both, twice in one session, and forgetting the second would
have left render.py quietly rasterising a layout the game no longer has.

Quietly is the problem. Nothing fails; the pictures just stop being of the
game, which is exactly what that tool exists to prevent. Either the heights
come out of the stylesheet at run time, or check.py reads both and compares
them. The second is a few lines and would have caught it.

## A card rebinds its descendants' colours

`.card` sets `--text`, `--muted`, `--line` and `--amber` to ink-on-paper values,
and those inherit to everything inside it. That is genuinely elegant for the
common case: adding an element to a card needs no new colour rule at all.

It is wrong for the things inside a card that are *not* paper. It has caused
the same bug three times, in different places, and every time the symptom was
invisible content rather than wrong-looking content:

- The overflow menu took `--panel`, the dark surface, while inheriting the
  card's ink — near-black text on a near-black ground, so the menu looked empty.
- The header icons stand on near black and their pressed and hover states read
  the card's ink, so pressing one made the icon vanish into its own button.
- The mode buttons hovered to `--text` and the selected one to `--onaccent`.
  Unselected is the sunk near-black button, so that was 1.05:1; and
  `--onaccent` happens to be near-black at night and near-white by day, so the
  selected one was fine in one theme and 1.03:1 in the other. Both invisible
  until a pointer lands on them, and a touchscreen never lands.

`check.py` now holds the three button hover inks to 4.5:1 against the ground the
control actually stands on, in both palettes, which stops this recurring
silently but does not fix the shape that causes it.

Three times is the argument. The likely shape is to stop rebinding and name the
two grounds instead — something like `--on-paper` and `--on-dark`, chosen by what a
control is standing on rather than by what its container reads like, which is
the rule the fixes ended up stating in comments anyway. The cost is that it
touches a lot of rules, and the reason it has not been done is that it wants a
round of its own rather than being tacked onto a feature.

## `--rise` and `--lift` inherit, and heights are not inheritable

They are custom properties, so a card declaring `--rise: 1.7` hands that height
to every button inside it, and each one silently casts a shadow sized for the
sheet it is sitting on. This was found by an audit, not by looking — the
shadows were plausible, just wrong.

The current fix is that every button restates its own height on the base rule.
That works but it is a convention, not a mechanism: a new lit thing that forgets
to declare one inherits whatever its container had. `@property { inherits:
false }` would make it structural instead. Worth doing when browser support is
not a question; it is a two-line change if it is taken.

## Both palettes are two parallel lists

`:root` and `:root[data-theme="light"]` have to answer the same names, and a
new value means editing both. Landing a declaration in the wrong block happened
three or four times in one session. `check.py` catches every one immediately, so
the cost is minutes rather than bugs — which is why this is a note rather than a
plan.

Partly addressed already: values that are the same in any light (the typefaces,
the procedural textures) are declared once now, and the check knows the
difference between those and a theme value. What is left is genuinely per-theme
and probably has to be stated twice.
