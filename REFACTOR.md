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

## A card rebinds its descendants' colours

`.card` sets `--text`, `--muted`, `--line` and `--amber` to ink-on-paper values,
and those inherit to everything inside it. That is genuinely elegant for the
common case: adding an element to a card needs no new colour rule at all.

It is wrong for the things inside a card that are *not* paper. It has caused
the same bug twice, in different places, and both times the symptom was
invisible content rather than wrong-looking content:

- The overflow menu took `--panel`, the dark surface, while inheriting the
  card's ink — near-black text on a near-black ground, so the menu looked empty.
- The header icons stand on near black and their pressed and hover states read
  the card's ink, so pressing one made the icon vanish into its own button.

Twice is the argument. The likely shape is to stop rebinding and name the two
grounds instead — something like `--on-paper` and `--on-dark`, chosen by what a
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
