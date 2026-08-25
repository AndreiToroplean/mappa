const $ = id => document.getElementById(id);
const svg = $('map');
const NS = 'http://www.w3.org/2000/svg';
let shapes = {};     // region name -> its <path>
let labels = {};     // region name -> its abbreviation <text>

// SVG paints in document order, so resolved states must physically move up the
// stack or neighbours drawn later will clip their outlines.
const layer = () => svg.appendChild(document.createElementNS(NS, 'g'));
/* L_DOT sits above every layer a region can be moved into. A mark is small
   enough to be covered by the shape it sits inside — Vatican City by Italy,
   Liechtenstein by Switzerland — and a region that gets found moves *up* the
   stack, so without its own layer a mark would vanish at the moment its
   neighbour was solved, which is exactly when it is being looked for. */
const L_BASE = layer(), L_FOUND = layer(), L_MISS = layer(),
      L_ANSWER = layer(), L_DOT = layer(), L_LABEL = layer(), L_GROUP = layer(),
      L_NUDGE = layer(), L_DRIFT = layer();

/* Composed label anchors, kept because the nudge arrow needs to point from one
   region to another and the anchor is the most sensible "middle" we have — it
   is the pole of inaccessibility, so it is inside even for awkward shapes. */
let anchorAt = {};
let panelOf = {};    // region name -> which panel it is drawn on

function setLabel(name, kind) {
  const t = labels[name];
  if (kind === null) { t.style.display = 'none'; return; }
  t.setAttribute('class', 'label' + (kind === 'found' ? '' : ' ' + kind));
  t.style.display = '';
  L_LABEL.appendChild(t);   // newest label wins any overlap
}

/* The single source of truth for what has happened to each region, and the
   only place allowed to change it.

   Status used to live in two places at once — "found" as a DOM class, "missed"
   as a JS Set — and the three-part transition (paint class, paint layer, label)
   was written out by hand at five call sites, two of them via setAttribute and
   two via classList. That is how a region ends up carrying two statuses at
   once. Everything now goes through here, and status() is what anything else
   asks. */
const STATUS = {
  //        paint class      layer     label
  //        map class        layer     label       magnifier class
  open:   { cls: 'state',        layer: null,     label: null,     lens: '' },
  found:  { cls: 'state found',  layer: 'FOUND',  label: 'found',  lens: 'found' },
  missed: { cls: 'state miss',   layer: 'MISS',   label: 'wrong',  lens: 'miss' },
  answer: { cls: 'state reveal', layer: 'ANSWER', label: 'answer', lens: '' },
  /* Distance scoring's single resting state. Every region ends up here, right or
     wrong, and what separates them is the colour rather than the status — see
     paintScore(). There is no "found" and no "missed" to distinguish, because
     every region is attempted exactly once and the answer is always shown. */
  scored: { cls: 'state scored', layer: 'FOUND', label: 'scored', lens: 'found' },
};

/* Green at nothing, amber halfway, red at a full width. The fills stay dark
   enough for the map to read as a map, and the strokes carry the signal — a
   glance over a finished board shows where the knowledge runs out, which is the
   thing this scoring exists to say.

   The ramp is not walked linearly. A tap just outside the border scores 1 or 2,
   and on a straight ramp that is indistinguishable from a tap inside it — which
   loses the one distinction the scoring most wants to make, since landing inside
   is the whole game. So anything above zero starts a tenth of the way along:
   the remaining goodness (100 - points) is scaled by 0.9 before it is mapped,
   and only an exact zero keeps the full green.

   The gap is at the *green* end deliberately. Two bad answers being hard to tell
   apart costs nothing; a bad answer looking like a right one costs the reading
   of the whole map. */
const NEAR_GAP = 0.9;

function effective(pts) {
  if (pts <= 0) return 0;                       // inside the region: perfect
  return 100 - (100 - Math.min(100, pts)) * NEAR_GAP;
}
/* The stops live in the palette, not here, so that colour has one home and a
   theme is a block of CSS rather than a block of CSS *and* an array of triples.
   Read once and re-read when the theme changes; mix() needs numbers, and
   getComputedStyle per region per frame would not be free. */
const STOPS = [0, 50, 100];
let SCALE = [];

/* Says so rather than producing '#NaNNaNNaN', which paints as black and looks
   like a rendering bug rather than a missing variable. */
function rgb(hex) {
  const h = (hex || '').trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const v = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  if (v.some(isNaN)) { reportCrash('palette: cannot read "' + hex + '"'); return [128, 128, 128]; }
  return v;
}

function readScale() {
  const css = getComputedStyle(document.documentElement);
  SCALE = STOPS.map(at => ({
    at,
    fill: rgb(css.getPropertyValue(`--s${at}fill`)),
    line: rgb(css.getPropertyValue(`--s${at}line`)),
  }));
}
readScale();

function mix(a, b, t) {
  return '#' + [0, 1, 2].map(i =>
    Math.round(a[i] + (b[i] - a[i]) * t).toString(16).padStart(2, '0')).join('');
}

function scoreColour(pts) {
  const p = Math.max(0, Math.min(100, effective(pts)));
  const hi = p <= SCALE[1].at ? 1 : 2, lo = hi - 1;
  const t = (p - SCALE[lo].at) / (SCALE[hi].at - SCALE[lo].at);
  return { fill: mix(SCALE[lo].fill, SCALE[hi].fill, t),
           line: mix(SCALE[lo].line, SCALE[hi].line, t) };
}

/* The colour is set inline and also published as a pair of custom properties.
   The answer flash has to *end* on it — see .answerflash — and an animation is
   the only thing that outranks an inline style, so the keyframes read the
   colour back off the element rather than being told it. */
/* What each scored region cost, kept so the board can be painted again in
   another palette. A scored colour is inline, and inline is the one thing a
   theme's variables cannot reach. */
let scoredPts = {};

function paintScore(name, pts) {
  setStatus(name, 'scored');
  scoredPts[name] = pts;
  const c = scoreColour(pts);
  wear(shapes[name], c);
  if (lensPaths[name]) wear(lensPaths[name], c);
}

/* Re-read the ramp and put every scored region back on it. */
function repaintScores() {
  readScale();
  for (const name in scoredPts) {
    if (shapes[name]) paintScore(name, scoredPts[name]);
  }
}

function wear(node, c) {
  node.style.fill = c.fill;
  node.style.stroke = c.line;
  node.style.setProperty('--scorefill', c.fill);
  node.style.setProperty('--scoreline', c.line);
}
const LAYERS = { FOUND: L_FOUND, MISS: L_MISS, ANSWER: L_ANSWER };

const isDot = name => DOTS.indexOf(name) >= 0;

let statusOf = {};     // region name -> key of STATUS

function strip(node) {
  node.style.fill = '';
  node.style.stroke = '';
  node.style.removeProperty('--scorefill');
  node.style.removeProperty('--scoreline');
}

function setStatus(name, key) {
  const spec = STATUS[key];
  statusOf[name] = key;
  if (key !== 'scored') {          // only paintScore() sets these
    delete scoredPts[name];
    strip(shapes[name]);
    if (lensPaths[name]) strip(lensPaths[name]);
  }
  shapes[name].setAttribute('class', spec.cls);
  /* A mark keeps its own layer whatever happens to it: the status decides how it
     looks, never where it sits. */
  (isDot(name) ? L_DOT : spec.layer ? LAYERS[spec.layer] : L_BASE)
    .appendChild(shapes[name]);
  setLabel(name, spec.label);
}

const status = name => statusOf[name] || 'open';

/* ---- layout -------------------------------------------------------------
   The build no longer decides where anything goes. A geography arrives as
   panels in their own local coordinates — a mainland, and an inset per piece
   that sits apart from it — and the arrangement is chosen here, from the shape
   of the space actually available.

   This is why: a single baked frame cannot fit both a portrait phone and a
   landscape desktop. A 1.7:1 frame in a 0.6:1 map area wasted about three
   fifths of the height, and France additionally carried a wide empty gap
   between its insets and the mainland because the gap was baked in.

   Everything below is pure arithmetic on panel sizes, so it can be tested
   without a browser.                                                        */
const SHORT = 600;      // composed units across the narrower side, always
const GAP = 16;         // between the mainland and the inset block
const PAD = 8;          // between insets
const MIN_SPAN = 76;    // an inset must stay big enough to hit
const MAX_BOOST = 3;    // ...and may be magnified no more than this

/* Insets are drawn at the mainland's scale, then magnified only as far as they
   must be to stay usable.

   Filling equal cells was the first attempt and it was wrong: five insets of
   wildly different size came out identical, and together they took half a phone
   screen for five départements out of 101. Albers USA is the precedent worth
   following here — measured against known areas it draws Alaska at 0.33 and
   Hawaii at 0.77 of true scale, so the convention is a *bounded* departure from
   truth, not a free one. Here the departure runs the other way, magnifying the
   small ones, and is capped at MAX_BOOST. Guyane stays visibly the largest,
   Mayotte stays hittable, and their relative sizes still mean something. */
function insetScales(sMain, main, insets) {
  return insets.map(p => {
    const trueScale = sMain * (p.km / main.km);   // equal km per composed unit
    const natural = Math.max(p.w, p.h) * trueScale;
    const boost = Math.min(MAX_BOOST, Math.max(1, MIN_SPAN / Math.max(natural, 0.01)));
    return trueScale * boost;
  });
}

/* Bottom-left packing against a skyline.

   Shelves were the first attempt and they wasted the room they were meant to
   save: five insets in one shelf made the shelf as deep as Guyane, the tallest,
   and the four small ones then floated in a band of empty space beside it. A
   skyline lets them stack two-deep next to Guyane instead, which is how an atlas
   would set them.

   `along` is the axis the block spreads on, `depth` the one it grows into, so
   the same packer serves a strip below the mainland and a column beside it. */
function packInsets(sizes, limit, below) {
  const along = s => below ? s.w : s.h;
  const depth = s => below ? s.h : s.w;

  // tallest first: the big pieces set the shape, the small ones fill in
  const order = sizes.map((s, i) => i).sort((a, b) => depth(sizes[b]) - depth(sizes[a]));
  const sky = [{ from: 0, to: limit, at: 0 }];   // free surface, in `along` steps
  const at = [];

  for (const i of order) {
    const w = along(sizes[i]) + PAD, d = depth(sizes[i]) + PAD;
    let best = null;
    for (let k = 0; k < sky.length; k++) {
      const start = sky[k].from;
      if (start + w > limit + 0.01) continue;
      // the surface height across the whole footprint, not just at its start
      let top = 0, covered = 0;
      for (let j = k; j < sky.length && covered < w - 0.01; j++) {
        top = Math.max(top, sky[j].at);
        covered = sky[j].to - start;
      }
      if (covered < w - 0.01) continue;
      if (!best || top < best.top - 0.01 || (top < best.top + 0.01 && start < best.start))
        best = { top, start };
    }
    if (!best) best = { top: Math.max(...sky.map(s => s.at)), start: 0 };
    at[i] = { along: best.start, depth: best.top };
    raise(sky, best.start, best.start + w, best.top + d, limit);
  }
  const total = Math.max(...at.map((a, i) => a.depth + depth(sizes[i])));
  const used = Math.max(...at.map((a, i) => a.along + along(sizes[i])));
  return { at, total, used };
}

/* Lift the free surface over [from, to) to `to_`, splitting spans as needed. */
function raise(sky, from, to, to_, limit) {
  const out = [];
  for (const s of sky) {
    if (s.to <= from || s.from >= to) { out.push(s); continue; }
    if (s.from < from) out.push({ from: s.from, to: from, at: s.at });
    if (s.to > to) out.push({ from: to, to: s.to, at: s.at });
  }
  out.push({ from, to: Math.min(to, limit), at: to_ });
  out.sort((a, b) => a.from - b.from);
  sky.length = 0;
  sky.push(...out);
}

function tryScale(s, W, H, main, insets, below) {
  const along = below ? W : H;
  const across = below ? H : W;
  if (main.w * s > W || main.h * s > H) return null;
  const scales = insetScales(s, main, insets);
  const sizes = insets.map((p, i) => ({ w: p.w * scales[i], h: p.h * scales[i] }));
  const mainAcross = below ? main.h * s : main.w * s;
  const room = across - mainAcross - GAP;

  /* Packing at full width minimises depth, which is not the same as looking
     tidy: it lays the four small insets in one long row and leaves the space
     beside Guyane empty. Trying several widths and keeping the tightest bounding
     box instead lets them stack two-deep next to it, which is how an atlas sets
     them. Five items, five candidates — cheap enough to just try. */
  const widest = Math.max(...sizes.map(z => (below ? z.w : z.h))) + PAD;
  let packed = null;
  for (const f of [0.3, 0.45, 0.6, 0.8, 1]) {
    const limit = Math.max(widest, along * f);
    const cand = packInsets(sizes, limit, below);
    if (cand.total > room) continue;
    cand.waste = cand.used * cand.total;
    if (!packed || cand.waste < packed.waste * 0.995) packed = cand;
  }
  if (!packed) return null;
  return { s, scales, sizes, packed, below };
}

/* A panel carrying `fix` is not laid out. Its place is given relative to panel
   0, in panel 0's own units, so it rides whatever transform the mainland gets
   and the arrangement a cartographer chose survives every screen shape.

   Alaska and Hawaii are the case this exists for. Albers USA composites them
   into the frame at positions worth keeping, so they are pinned rather than
   packed — but they are still panels, and that is the point: the game asks which
   panel two regions are on before drawing a line between them, and on one panel
   it would point from Texas to Hawaii, a direction true of the picture and false
   of the world.

   Fixed panels are therefore invisible to the packer, and their space is
   reserved the only way it can be: panel 0's box is the whole composited frame,
   so fitting the mainland fits them too. */
const isFixed = p => !!p.fix;

function placeFixed(place, panels) {
  const m = place[0];
  panels.forEach((p, i) => {
    if (!isFixed(p)) return;
    place[i] = { s: m.s * p.fix.s, dx: m.dx + p.fix.x * m.s,
                 dy: m.dy + p.fix.y * m.s };
  });
  return place;
}

function chooseLayout(aspect, panels) {
  const W = aspect >= 1 ? SHORT * aspect : SHORT;
  const H = aspect >= 1 ? SHORT : SHORT / aspect;
  const main = panels[0];
  // indices are kept, because `place` is indexed by panel
  const loose = panels.map((p, i) => i).filter(i => i && !isFixed(panels[i]));
  const insets = loose.map(i => panels[i]);

  if (!insets.length) {
    const s = Math.min(W / main.w, H / main.h);
    const place = [{ s, dx: (W - main.w * s) / 2, dy: (H - main.h * s) / 2 }];
    return { W, H, place: placeFixed(place, panels) };
  }

  // Largest mainland scale that still leaves room for the insets. Their size
  // depends on it, so it is searched for rather than solved.
  let best = null;
  for (const below of [true, false]) {
    let lo = 0.02, hi = Math.min(W / main.w, H / main.h), found = null;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      const cand = tryScale(mid, W, H, main, insets, below);
      if (cand) { found = cand; lo = mid; } else { hi = mid; }
    }
    if (found && (!best || found.s > best.s)) best = found;
  }
  if (!best) {
    const place = panels.map(() => ({ s: 0.1, dx: 0, dy: 0 }));
    return { W, H, place: placeFixed(place, panels) };
  }

  const { s, scales, sizes, packed, below } = best;
  const mw = main.w * s, mh = main.h * s;
  const place = [];
  const total = (below ? mh : mw) + GAP + packed.total;
  const start = ((below ? H : W) - total) / 2;
  // centre the packed block on the axis it spreads along
  const slack = ((below ? W : H) - packed.used) / 2;

  if (below) {
    place.push({ s, dx: (W - mw) / 2, dy: start });
    const y0 = start + mh + GAP;
    loose.forEach((pi, i) => {
      place[pi] = { s: scales[i], dx: slack + packed.at[i].along,
                    dy: y0 + packed.at[i].depth };
    });
  } else {
    place.push({ s, dx: start + packed.total + GAP, dy: (H - mh) / 2 });
    loose.forEach((pi, i) => {
      place[pi] = { s: scales[i], dx: start + packed.at[i].depth,
                    dy: slack + packed.at[i].along };
    });
  }
  return { W, H, place: placeFixed(place, panels), side: below ? 'below' : 'left' };
}

/* ---- composing ----------------------------------------------------------
   The chosen layout is baked back into one flat coordinate space, exactly the
   space the game had when the build did the placing. Every hit test, distance
   and snap threshold downstream is therefore unchanged: nothing else in the
   codebase knows panels exist.

   The cost is re-emitting path data on each layout change — about 16,000 points
   for France, a few milliseconds, and only when the geography or the window
   changes.                                                                  */
let localRings = {};    // region name -> rings in its panel's local units
let layoutNow = null;

/* The ring the distance code measures against, for a region drawn as a circle.

   Everything geometric in the game speaks rings: borderDist2, nearestSelectable,
   nearestPointOn, the panel diameter. Rather than teach each of them about
   circles, the circle is handed to them as a fine polygon — and it is *derived
   from the same centre and radius the circle is drawn from*, every time the map
   composes, so the two cannot drift. That is the distinction from the invisible
   tap circles this replaces: those were an independent target sitting beside a
   shape, and independence was the bug.

   Forty-eight sides puts the polygon within a fiftieth of a percent of the true
   circle, which is far below anything a score or a snap can notice. */
const MARK_SIDES = 48;

function ringOfMark(at) {
  const out = [];
  for (let i = 0; i < MARK_SIDES; i++) {
    const a = 2 * Math.PI * i / MARK_SIDES;
    out.push(at[0] + GEO.mark * Math.cos(a), at[1] + GEO.mark * Math.sin(a));
  }
  out.push(out[0], out[1]);      // closed, the way parseRings leaves a ring
  return out;
}

function parseRings(d) {
  return d.split('M').filter(Boolean).map(ring => {
    const pairs = ring.replace(/Z$/, '').split('L');
    const a = new Float64Array(pairs.length * 2);
    for (let i = 0; i < pairs.length; i++) {
      const c = pairs[i].split(',');
      a[i * 2] = +c[0];
      a[i * 2 + 1] = +c[1];
    }
    return a;
  });
}

function composeRings(rings, s, dx, dy) {
  return rings.map(a => {
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i += 2) {
      out[i] = a[i] * s + dx;
      out[i + 1] = a[i + 1] * s + dy;
    }
    return out;
  });
}

function setCircle(node, cx, cy, r) {
  node.setAttribute('cx', cx.toFixed(1));
  node.setAttribute('cy', cy.toFixed(1));
  node.setAttribute('r', r.toFixed(1));
}

/* The disc holds a second element per region and has to be given the same
   geometry, whichever kind it is. */
function copyShape(from, to) {
  if (from.tagName === 'circle') {
    setCircle(to, +from.getAttribute('cx'), +from.getAttribute('cy'),
              +from.getAttribute('r'));
  } else {
    to.setAttribute('d', from.getAttribute('d'));
  }
}

function pathFrom(rings) {
  let d = '';
  for (const a of rings) {
    d += 'M';
    for (let i = 0; i < a.length; i += 2) {
      if (i) d += 'L';
      d += a[i].toFixed(1) + ',' + a[i + 1].toFixed(1);
    }
    d += 'Z';
  }
  return d;
}

/* ---- building the map ----------------------------------------------------
   buildMap creates the nodes for a geography; compose places them. They are
   separate because a window resize needs the second without the first. */
function buildMap() {
  [L_BASE, L_FOUND, L_MISS, L_ANSWER, L_DOT, L_LABEL, L_GROUP, L_NUDGE, L_DRIFT]
    .forEach(g => { while (g.firstChild) g.removeChild(g.firstChild); });
  shapes = {}; labels = {}; statusOf = {}; localRings = {}; anchorAt = {};
  scoredPts = {};
  panelOf = {};

  REGIONS.forEach(r => {
    localRings[r.name] = r.dot ? [ringOfMark(r.anchor)] : parseRings(r.d);
    panelOf[r.name] = r.panel;

    /* A marked country is a <circle>, not a path approximating one. A
       twenty-four-sided ring two pixels across renders as a visibly lopsided
       blob, and the browser can draw a true circle at any size for free. It
       also scales with the magnifier without being asked, since the disc zooms
       by viewBox — the mark grows exactly as much as the land around it. */
    const p = document.createElementNS(NS, r.dot ? 'circle' : 'path');
    p.setAttribute('class', 'state');
    p.dataset.name = r.name;
    (r.dot ? L_DOT : L_BASE).appendChild(p);
    shapes[r.name] = p;

    // one reusable label node per region, hidden until it is needed
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', 'label');
    t.textContent = ABBR[r.name];
    t.style.display = 'none';
    L_LABEL.appendChild(t);
    labels[r.name] = t;
  });

  measurePanels();       // the yardstick distance scoring divides by

  // whether this browser can hit-test a path's fill; needs a real path to ask
  CAN_HIT = typeof shapes[REGION_NAMES[0]].isPointInFill === 'function';
}

/* ---- how wide a panel really is ----------------------------------------
   Distance scoring divides by this, so the number it divides by has to be the
   largest distance that can exist between two points of the panel — otherwise a
   long miss scores over 100 and the colour scale runs off its own end.

   The bounding box is not that number. Its diagonal overstates a wide flat
   country and its sides understate a diagonal one; France's ink spans 1000x931
   local units but its true diameter is neither 1000 nor 1366.

   So: convex hull, then rotating callipers. The two farthest points of a set are
   always both on its hull, and on a convex polygon the farthest pair can be
   walked in one pass rather than compared pairwise. About 9,000 points for the
   US and 15,000 for France reduce to a hull of a few dozen, once per geography
   load. */
let panelDiam = [];

function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => {
    const out = [];
    for (const q of list) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], q) <= 0)
        out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return half(p).concat(half(p.reverse()));
}

function diameter(pts) {
  const h = hull(pts);
  const n = h.length;
  if (n < 2) return 0;
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  // callipers: for each edge, the farthest vertex only ever moves forward
  let best = 0, j = 1;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    while (d2(h[i], h[(j + 1) % n]) > d2(h[i], h[j]) ||
           d2(h[k], h[(j + 1) % n]) > d2(h[k], h[j])) {
      j = (j + 1) % n;
      if (j === i) break;
    }
    best = Math.max(best, d2(h[i], h[j]), d2(h[k], h[j]));
  }
  return Math.sqrt(best);
}

function measurePanels() {
  panelDiam = GEO.panels.map(() => 0);
  const byPanel = GEO.panels.map(() => []);
  REGIONS.forEach(r => {
    for (const a of localRings[r.name])
      for (let i = 0; i < a.length; i += 2) byPanel[r.panel].push([a[i], a[i + 1]]);
  });
  byPanel.forEach((pts, i) => { panelDiam[i] = diameter(pts); });
}

function compose() {
  const box = svg.getBoundingClientRect();
  const aspect = (box.width && box.height) ? box.width / box.height : 1.6;
  const L = chooseLayout(aspect, GEO.panels);
  layoutNow = L;
  svg.setAttribute('viewBox', `0 0 ${L.W.toFixed(1)} ${L.H.toFixed(1)}`);

  REGIONS.forEach(r => {
    const at = L.place[r.panel];
    const rings = composeRings(localRings[r.name], at.s, at.dx, at.dy);
    borders[r.name] = rings;

    const lx = r.anchor[0] * at.s + at.dx, ly = r.anchor[1] * at.s + at.dy;
    if (r.dot) {
      /* Placed rather than transformed, so the mark carries the panel's scale
         the same way every other region does and nothing has to remember it. */
      setCircle(shapes[r.name], lx, ly, GEO.mark * at.s);
    } else {
      shapes[r.name].setAttribute('d', pathFrom(rings));
    }

    labels[r.name].setAttribute('x', lx);
    labels[r.name].setAttribute('y', ly + 4);
    anchorAt[r.name] = { x: lx, y: ly };
    if (lensPaths[r.name]) copyShape(shapes[r.name], lensPaths[r.name]);
  });
  // Anything else drawn in composed coordinates has to be rebuilt with them.
  redrawHints();
}
