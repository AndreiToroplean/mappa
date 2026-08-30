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
const SUN = { dx: Math.cos(0.593), dy: Math.sin(0.593), len: 9 };

/* The window, from src/textures.py — the same table the stylesheet paints its
   bars from, so a shadow softened for standing in a bar is standing in the bar
   the eye can see. */
const WINDOW = __WINDOW__;

/* How much direct sun reaches a point, from 0 in the deepest bar to 1 in open
   light. Projects the point onto the gradient's own axis and asks the same
   question the gradient answers, then multiplies by how far the light has got
   across the room.

   This is the whole of the idea. Shadow laid over shadow is not twice the
   shadow — a bar has already taken the direct light away, and a button standing
   in one has no direct light left to block. Rather than painting the throws and
   the bars onto a buffer and combining them with a max, which is what a
   renderer would do, the throw is simply scaled by the light there is to
   block. Same answer, no buffer, and it costs one dot product. */
/* Where a point sits along a gradient's own axis, 0 to 1, using the convention
   CSS uses: zero degrees points up and the angle turns clockwise. */
function along(deg, x, y, w, h) {
  const a = (deg - 90) * Math.PI / 180;
  const ux = Math.cos(a), uy = Math.sin(a);
  const axis = Math.abs(w * ux) + Math.abs(h * uy);
  return 0.5 + ((x - w / 2) * ux + (y - h / 2) * uy) / (axis || 1);
}

function sunAt(x, y, w, h) {
  /* Two questions, multiplied. Is the frame in the way here, and how far into
     the room has the light got by the time it arrives?

     The second is linear, not radial. The sun is far enough away that its rays
     are parallel — there is no point on the screen for them to spread from, and
     nothing to measure a distance to. What dims them is depth into the room,
     which runs the one way for every ray, along the same direction the shadows
     are thrown. Falling off from a point is the lamp's business, and the lamp
     does it in the other branch of relight(), because a lamp really is a point.

     Either way the idea is the same: a shadow is only as dark as the light it
     takes away, so a button at the far end of the desk throws a fainter one
     than the same button under the window — not because it is any less of an
     obstacle, but because there is less to obstruct. */
  let open = 1;
  const p = along(WINDOW.angle, x, y, w, h);
  for (const [from, to, dark] of WINDOW.bars) {
    const e = WINDOW.edge;
    const inside = Math.min(smooth(p, from - e, from + e),
                            1 - smooth(p, to - e, to + e));
    open -= (dark / WINDOW.deepest) * Math.max(0, inside);
  }
  const depth = along(WINDOW.sun, x, y, w, h);
  const reach = 1 - (1 - WINDOW.fade.floor) * smooth(depth, 0, WINDOW.fade.to);
  return Math.max(0, Math.min(1, open)) * reach;
}

function smooth(v, a, b) {
  const k = Math.max(0, Math.min(1, (v - a) / ((b - a) || 1e-6)));
  return k * k * (3 - 2 * k);
}

/* What a button does to the light that is not the sun. The sky, the walls and
   the paper itself bounce light into every gap, and less of it reaches the
   ground right up against an object than reaches open paper a few inches away.
   That is the dark seam under everything, it has no direction because the light
   it is blocking has none, and it is there whether or not a button is standing
   in sunlight — which is what you see in the bars, where there is nothing else
   left to see. */
const AMBIENT = [
  [0.00, 0.00, 0.20],
  [0.35, 0.55, 0.14],
  [0.70, 1.10, 0.08],
  [1.00, 1.80, 0.04],
];
const AMBIENT_LEN = 3.2;

/* The smear as a box-shadow list. The colour is a triplet from the palette, so
   the ink stays a theme's business and only the alpha is decided here. */
function smear(dx, dy, len, steps, lift, scale) {
  /* A floating thing's shadow starts away from it and is soft everywhere, so
     the whole smear slides along the throw and picks up a floor under its blur.
     A resting one is unchanged: lift of zero leaves every term alone. */
  return steps.map(([at, haze, alpha]) => {
    const along = lift + at * (1 - lift);
    const blur = len * (haze + lift * 0.8);
    return `${(dx * along).toFixed(1)}px ${(dy * along).toFixed(1)}px `
      + `${blur.toFixed(1)}px rgba(var(--castrgb), ${(alpha * scale).toFixed(3)})`;
  }).join(', ');
}

/* The seam, which has no direction and so needs none of the throw's geometry. */
function occlusion(rise) {
  return AMBIENT.map(([at, haze, alpha]) =>
    `0 ${(AMBIENT_LEN * rise * at).toFixed(1)}px `
    + `${(AMBIENT_LEN * rise * haze + 0.6).toFixed(1)}px `
    + `rgba(var(--castrgb), ${alpha})`).join(', ');
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
    let dx, dy, len, steps, direct;
    if (sun) {
      len = SUN.len * rise;
      dx = SUN.dx * len;
      dy = SUN.dy * len;
      steps = SUN_SMEAR;
      /* Scaled by the sun there is at this spot. In open light the throw is
         full strength; standing in the shadow of a glazing bar it all but
         disappears, because the bar has already taken the light it would have
         been blocking. The floor is not zero — a room in daylight has no black
         corner, and something always gets through. */
      direct = 0.06 + 0.94 * sunAt(r.left + r.width / 2, r.top + r.height / 2,
                                   w, h);
    } else {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const vx = cx - lx, vy = cy - ly;
      const d = Math.hypot(vx, vy) || 1;
      const out = Math.min(1, d / reach);
      len = Math.max(THROW_MIN, THROW_MAX * rise * Math.pow(out, THROW_CURVE));
      dx = vx / d * len;
      dy = vy / d * len;
      steps = SMEAR;
      /* The same idea under a lamp, with the falloff standing in for the bars:
         a shadow thrown across the dim end of the desk has less light to take
         away, so there is less of it to see. */
      /* The same second question under a lamp, and the falloff is the answer:
         a shadow at the dim end of the desk has less light to take away. */
      direct = 1 - 0.62 * out;
      // How far out of the light it is, for the ones that also darken with it.
      node.style.setProperty('--away', out.toFixed(3));
    }
    /* Two shadows, always. The seam a thing makes by sitting on something is
       there whatever the weather; the throw is what the direct light is doing,
       and only that part answers to the sun. */
    node.style.setProperty('--cast',
      occlusion(rise) + ', ' + smear(dx, dy, len, steps, lift, direct));
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
  /* The class goes on whatever happens. Everything is hidden until it does, so
     a fault anywhere in the measuring would leave the game invisible rather
     than merely unlit — which is exactly what one stale argument in here did.
     Unlit and playable beats correct and blank. */
  try {
    relight();
  } catch (e) {
    reportCrash(e);
  }
  document.documentElement.classList.add('lit');
}

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(reveal);
  setTimeout(reveal, 200);
} else {
  reveal();
}
