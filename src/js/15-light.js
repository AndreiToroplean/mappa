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
const THROW = 0.085, THROW_MIN = 1.5, THROW_MAX = 26;
/* Blur grows with the throw, because a real penumbra widens with distance from
   the surface. Slower than the offset, or a long shadow turns into fog. */
const HAZE = 0.55, HAZE_MIN = 2;

/* Sunlight: one direction for everything, and one length. 34 degrees below the
   horizontal, going down and to the right, which is a window high on the left
   wall. Short and hard — this is the whole of the day theme's shadow. */
const SUN = { dx: Math.cos(0.593), dy: Math.sin(0.593), len: 3.5, haze: 5 };

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

    let dx, dy, blur;
    if (sun) {
      dx = SUN.dx * SUN.len;
      dy = SUN.dy * SUN.len;
      blur = SUN.haze;
    } else {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const vx = cx - lx, vy = cy - ly;
      const d = Math.hypot(vx, vy) || 1;
      const len = Math.min(THROW_MAX, Math.max(THROW_MIN, d * THROW));
      dx = vx / d * len;
      dy = vy / d * len;
      blur = HAZE_MIN + len * HAZE;
      // How far out of the light it is, for the ones that also darken with it.
      node.style.setProperty('--away', (d / reach).toFixed(3));
    }
    node.style.setProperty('--castx', dx.toFixed(1) + 'px');
    node.style.setProperty('--casty', dy.toFixed(1) + 'px');
    node.style.setProperty('--castblur', blur.toFixed(1) + 'px');
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
requestAnimationFrame(relight);
