/* Where the light is, and what that does to a shadow.
   ------------------------------------------------------------------------
   The stylesheet can say a shadow is offset down and to the left. It cannot
   say "away from the lamp", because that answer depends on where the thing
   *is*, and CSS has no way to ask. So this does: it measures every lit control
   and writes the offset onto it, and the stylesheet spends it without knowing
   how it was arrived at.

   Two skies, and they are genuinely different physics rather than two sets of
   numbers.

   Night is a lamp on the desk, a point source just off the top right corner.
   A point source throws shadows that *radiate*: every one points along the
   line from the lamp through the object, so they fan out, and they lengthen
   with distance because the light arrives at a shallower angle the further out
   you go. The Start button at the bottom of the card is a long way from the
   lamp and its shadow is long and soft; the icon buttons in the top corner are
   nearly under it and barely cast at all.

   Day is sunlight through a window on the left, which is a source far enough
   away that its rays are parallel. Parallel light gives every shadow the same
   direction and the same length whatever it is standing on, and a much crisper
   edge, because the penumbra comes from the source's angular size and the sun's
   is small. So the day theme is not the night theme lightened: it is short,
   hard, identical shadows going one way.

   Everything here is one-way — it reads geometry and writes four custom
   properties. Nothing else in the game reads them, and if this module never
   ran, every lit thing would fall back to the flat shadow named in the CSS. */

/* Which things stand off the surface. A list rather than a class in the markup,
   because whether something casts a shadow is a fact about the design and not
   about what the element is for — and because the markup should not have to be
   edited to relight the room.

   The quiet pair inside a .btnrow and the board's clear button were missing
   from this, so the pause card had a shadow under Resume and nothing under the
   two buttons beside it. A list is easy to leave a hole in; check.py now counts
   what it catches against every button in the markup. */
const LIT = [
  '.card', '.pop', '.tip span', '.card button', '.headbtn',
  '.geoSel', '.iconbtn', '.cluebtn', '.backbtn', '.pausebtn', '.lens .disc',
].join(',');

/* The lamp, in fractions of the viewport. Just outside the top right corner:
   inside it, controls in that corner would sit on the wrong side of the light
   and throw their shadows back towards the middle, which reads as a second
   lamp somewhere off screen. */
const LAMP = { x: 0.94, y: -0.10 };

/* How far a shadow is thrown, as a fraction of the distance to the lamp, and
   the range it is allowed to land in. The cap is what keeps a long shadow from
   becoming a smear the length of the card: past a point the eye stops reading
   it as depth. */
/* How high a thing stands off what it is sitting on, and whether it is sitting
   on it at all. Both are read off the element, so the stylesheet decides which
   things are tall and this decides what that means.

   --rise scales the length and the blur together, because both come from the
   same fact: a taller object intercepts the light further from the surface, so
   its shadow reaches further and its penumbra has more room to open. The
   design uses two heights — a full one for whatever a card is really asking
   you to press, and a half for the quieter buttons beside it.

   --lift is different in kind. A button rests on the paper, so its shadow is
   pinned to it and starts sharp at the contact edge. A popover is *over* the
   paper with nothing touching, so its shadow is displaced bodily and has no
   sharp edge anywhere — it is all penumbra. --lift is how far along the throw
   the shadow begins, so 0 is resting and anything above it is floating. */
const RISE_DEFAULT = 1, LIFT_DEFAULT = 0;

/* How long the longest shadow in the room is, and how fast one grows on the way
   out to it. The curve is the part that matters: linear in distance made the
   corner icons and the Start button look nearly alike, because a card is not
   that tall next to the distance to the lamp. Raising it to a power puts most
   of the change at the far end, which is also what actually happens — a light
   this close to the surface drops its angle quickly. */
const THROW_MAX = 30, THROW_MIN = 1.2, THROW_CURVE = 1.8;

/* A shadow is not a copy of the button moved sideways. It is attached where the
   two touch, sharp at that edge, and softens as it goes — the penumbra widens
   with distance because the source has a size, and only at the contact point is
   none of it hidden. One box-shadow cannot say that: one offset, one blur, so
   it draws a detached, uniformly soft copy, which is what made every button
   look like it was floating over the paper.

   So the throw is built from several shadows stepped along its direction. Each
   row is: how far along, how much of the length to blur by, and how dark.

   The two skies want different *shapes* here, not two sizes of one shape.

   A lamp in a dark room throws a shadow that stays dark for its whole length
   and then stops. It is the only light there is, so anywhere the button blocks
   it is nearly black right out to the end: what changes along the throw is how
   soft the edge is, not how dark the middle is. So night holds its alpha almost
   flat and cuts off, and keeps its blur tight. The first pass had the alpha
   decaying fastest at the far end, which made a shadow that evaporated instead
   of ending.

   Sunlight is different because of everything that is not the sun. The sky and
   the room bounce light back into the shadow, and more of it the further from
   the object you get, so day starts just as dark where the two touch and lifts
   as it goes, ending by fading rather than stopping. It is also much shorter
   and far crisper — a small source at a great distance is what a hard edge
   is. */
const SMEAR = [
  [0.00, 0.00, 0.46],
  [0.20, 0.05, 0.44],
  [0.45, 0.12, 0.40],
  [0.70, 0.20, 0.36],
  [0.88, 0.28, 0.30],
  [1.00, 0.34, 0.24],
];
/* Six stops, matching SMEAR, and that is a requirement rather than a
   coincidence: box-shadow only animates between two lists of the same length,
   so an uneven pair would make the theme snap while everything around it
   faded. check.py holds the two to the same length. */
const SUN_SMEAR = [
  [0.00, 0.00, 0.55],
  [0.28, 0.02, 0.44],
  [0.52, 0.05, 0.31],
  [0.72, 0.08, 0.20],
  [0.88, 0.11, 0.11],
  [1.00, 0.15, 0.05],
];

/* Sunlight: one direction for everything, and one length. 34 degrees below the
   horizontal, going down and to the right, which is a window high on the left
   wall. Short and hard — this is the whole of the day theme's shadow. */
const SUN = { dx: Math.cos(0.593), dy: Math.sin(0.593), len: 4.5 };

/* The smear as a box-shadow list. The colour is a triplet from the palette, so
   the ink stays a theme's business and only the alpha is decided here. */
function smear(dx, dy, len, steps, lift) {
  /* A floating thing's shadow starts away from it and is soft everywhere, so
     the whole smear slides along the throw and picks up a floor under its blur.
     A resting one is unchanged: lift of zero leaves every term alone. */
  return steps.map(([at, haze, alpha]) => {
    const along = lift + at * (1 - lift);
    const blur = len * (haze + lift * 0.8);
    return `${(dx * along).toFixed(1)}px ${(dy * along).toFixed(1)}px `
      + `${blur.toFixed(1)}px rgba(var(--castrgb), ${alpha})`;
  }).join(', ');
}

function relight() {
  const sun = document.documentElement.dataset.theme === 'light';
  const w = innerWidth, h = innerHeight;
  const lx = LAMP.x * w, ly = LAMP.y * h;
  // The far corner from the lamp, which is what a throw is measured against so
  // the longest shadow in the room is the same length whatever the screen is.
  const reach = Math.hypot(lx - 0, ly - h) || 1;

  /* Measure everything first, then write everything. Reading a rect straight
     after writing a style makes the browser redo layout to answer, once per
     element — which is most of why the shadows used to arrive a frame late. */
  const seen = [];
  document.querySelectorAll(LIT).forEach(node => {
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return;      // hidden; it is measured when shown
    const cs = getComputedStyle(node);
    seen.push([node, r,
      parseFloat(cs.getPropertyValue('--rise')) || RISE_DEFAULT,
      parseFloat(cs.getPropertyValue('--lift')) || LIFT_DEFAULT]);
  });

  seen.forEach(([node, r, rise, lift]) => {
    let dx, dy, len, steps;
    if (sun) {
      len = SUN.len * rise;
      dx = SUN.dx * len;
      dy = SUN.dy * len;
      steps = SUN_SMEAR;
    } else {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const vx = cx - lx, vy = cy - ly;
      const d = Math.hypot(vx, vy) || 1;
      const out = Math.min(1, d / reach);
      len = Math.max(THROW_MIN, THROW_MAX * rise * Math.pow(out, THROW_CURVE));
      dx = vx / d * len;
      dy = vy / d * len;
      steps = SMEAR;
      // How far out of the light it is, for the ones that also darken with it.
      node.style.setProperty('--away', out.toFixed(3));
    }
    node.style.setProperty('--cast', smear(dx, dy, len, steps, lift));
  });
}

/* When to measure. A shadow depends on where a thing is, so anything that moves
   something has to be followed by a measurement — and, crucially, by one that
   lands in the same frame as the move.

   A MutationObserver's callback runs as a microtask, before the browser paints.
   Measuring there, synchronously, means the new shadows go down in the same
   paint as whatever changed. The old code queued the work on a timer instead,
   so the card appeared, the browser painted it, and the shadows arrived one
   frame later — which is what made opening the menu, and switching themes, look
   like two separate events.

   That only works if the observers stay narrow. Watching `class` across the
   whole subtree meant every region changing state during a run woke this up,
   which is why it had to be debounced in the first place. So: `hidden` through
   the subtree, because that is how an overlay opens; `class` on the body alone,
   because that is where the run's own state lives; and the theme on <html>,
   which is not inside the body at all. Nothing on the map fires any of them.

   Resize is the exception and stays debounced. It arrives in bursts of dozens
   during a drag, none of which anyone sees, and the last one is the only one
   that matters. */
let lightTimer = null;
function relightSoon() {
  clearTimeout(lightTimer);
  lightTimer = setTimeout(relight, 16);
}

addEventListener('resize', relightSoon);
new MutationObserver(relight).observe(document.body,
  { attributes: true, subtree: true, attributeFilter: ['hidden'] });
new MutationObserver(relight).observe(document.body,
  { attributes: true, attributeFilter: ['class'] });
new MutationObserver(relight).observe(document.documentElement,
  { attributes: true, attributeFilter: ['data-theme'] });

/* Light the room once, when there is something real to measure, and only then
   let it be painted.

   The type is the reason this waits. The faces are inlined but still decoded
   asynchronously, so measuring before they are ready measures buttons set in
   the fallback face — and every one of them changes width when the real faces
   arrive, which is a second relight and a visibly different second frame.

   The timeout is not a nicety. Everything is gated behind this class, so a
   fonts promise that never settles would leave the game invisible for good;
   after a fifth of a second it is better to show it in the fallback face and
   relight when the real one turns up. */
function reveal() {
  relight();
  document.documentElement.classList.add('lit');
}

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(reveal);
  setTimeout(reveal, 200);
} else {
  reveal();
}
