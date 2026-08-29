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
   edited to relight the room. */
const LIT = [
  '.card', '.pop', '.modes button', '.card > button', '.headbtn',
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
const SUN_SMEAR = [
  [0.00, 0.00, 0.44],
  [0.34, 0.03, 0.32],
  [0.64, 0.07, 0.19],
  [0.86, 0.11, 0.10],
  [1.00, 0.15, 0.04],
];

/* Sunlight: one direction for everything, and one length. 34 degrees below the
   horizontal, going down and to the right, which is a window high on the left
   wall. Short and hard — this is the whole of the day theme's shadow. */
const SUN = { dx: Math.cos(0.593), dy: Math.sin(0.593), len: 4.5 };

/* The smear as a box-shadow list. The colour is a triplet from the palette, so
   the ink stays a theme's business and only the alpha is decided here. */
function smear(dx, dy, len, steps) {
  return steps.map(([at, haze, alpha]) =>
    `${(dx * at).toFixed(1)}px ${(dy * at).toFixed(1)}px `
    + `${(len * haze).toFixed(1)}px rgba(var(--castrgb), ${alpha})`).join(', ');
}

function relight() {
  const sun = document.documentElement.dataset.theme === 'light';
  const w = innerWidth, h = innerHeight;
  const lx = LAMP.x * w, ly = LAMP.y * h;
  // The far corner from the lamp, which is what a throw is measured against so
  // the longest shadow in the room is the same length whatever the screen is.
  const reach = Math.hypot(lx - 0, ly - h) || 1;

  document.querySelectorAll(LIT).forEach(node => {
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return;      // hidden; it will be measured when shown

    let dx, dy, len, steps;
    if (sun) {
      len = SUN.len;
      dx = SUN.dx * len;
      dy = SUN.dy * len;
      steps = SUN_SMEAR;
    } else {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const vx = cx - lx, vy = cy - ly;
      const d = Math.hypot(vx, vy) || 1;
      const out = Math.min(1, d / reach);
      len = Math.max(THROW_MIN, THROW_MAX * Math.pow(out, THROW_CURVE));
      dx = vx / d * len;
      dy = vy / d * len;
      steps = SMEAR;
      // How far out of the light it is, for the ones that also darken with it.
      node.style.setProperty('--away', out.toFixed(3));
    }
    node.style.setProperty('--cast', smear(dx, dy, len, steps));
  });
}

/* When to measure. A shadow depends on where a thing is, so anything that moves
   something has to be followed by a measurement.

   The observer is the part worth explaining: overlays appear and disappear by
   the hidden attribute, and there is no event for that. Watching one attribute
   across the document is cheaper than it sounds — it fires when a card opens,
   which is a handful of times a run — and it means a card put on screen by any
   route at all is lit, including routes written later that nobody remembered to
   call this from. */
let lightTimer = null;
function relightSoon() {
  clearTimeout(lightTimer);
  lightTimer = setTimeout(relight, 16);
}

addEventListener('resize', relightSoon);
new MutationObserver(relightSoon).observe(document.body,
  { attributes: true, subtree: true, attributeFilter: ['hidden', 'class'] });
/* The theme is the other thing that changes every shadow in the room, and it is
   set on <html>, which is not inside document.body — so watching the body alone
   missed it completely and the shadows kept the old sky until the page was
   reloaded. A second observer rather than moving the first up to
   documentElement with subtree, which would fire on every class change in the
   game instead of on the four attributes that matter. */
new MutationObserver(relightSoon).observe(document.documentElement,
  { attributes: true, attributeFilter: ['data-theme'] });
requestAnimationFrame(relight);
