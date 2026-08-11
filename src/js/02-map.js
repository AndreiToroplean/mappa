const $ = id => document.getElementById(id);
const svg = $('map');
const NS = 'http://www.w3.org/2000/svg';
let shapes = {};     // region name -> its <path>
let labels = {};     // region name -> its abbreviation <text>

// SVG paints in document order, so resolved states must physically move up the
// stack or neighbours drawn later will clip their outlines.
const layer = () => svg.appendChild(document.createElementNS(NS, 'g'));
const L_BASE = layer(), L_FOUND = layer(), L_MISS = layer(),
      L_ANSWER = layer(), L_GROUP = layer(), L_LABEL = layer(),
      L_NUDGE = layer(), L_HIT = layer();

/* Composed label anchors, kept because the nudge arrow needs to point from one
   region to another and the anchor is the most sensible "middle" we have — it
   is the pole of inaccessibility, so it is inside even for awkward shapes. */
let anchorAt = {};

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
};
const LAYERS = { FOUND: L_FOUND, MISS: L_MISS, ANSWER: L_ANSWER };

let statusOf = {};     // region name -> key of STATUS

function setStatus(name, key) {
  const spec = STATUS[key];
  statusOf[name] = key;
  shapes[name].setAttribute('class', spec.cls);
  (spec.layer ? LAYERS[spec.layer] : L_BASE).appendChild(shapes[name]);
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
const MIN_CELL = 62;    // an inset must stay big enough to hit
const CELL_CAP = 0.30;  // ...and no larger than this much of the mainland

/* One arrangement: the mainland at scale s, and inset cells of side t laid out
   in a rows-by-cols block either below the mainland or to its left. */
function arrange(W, H, main, count, side, rows) {
  const cols = Math.ceil(count / rows);
  const below = side === 'below';
  const along = below ? W : H;              // the axis the block spreads along
  const across = below ? H : W;             // the axis it eats into
  const mainAlong = below ? main.w : main.h;
  const mainAcross = below ? main.h : main.w;
  // How many cells deep the block is on each axis. Getting these the wrong way
  // round sizes the block against the wrong dimension and it overflows the
  // frame — which is exactly what the first version of this did.
  const deep = below ? rows : cols;
  const wide = below ? cols : rows;

  // The mainland wants the largest scale that fits; the block then takes what
  // is left over, which is what stops a wide screen from leaving a bare strip.
  const sAlong = along / mainAlong;
  let s = Math.min(sAlong, (across - GAP - MIN_CELL * deep) / mainAcross);
  if (s <= 0) return null;
  const cap = CELL_CAP * Math.min(main.w, main.h) * s;
  let t = Math.min((across - GAP - mainAcross * s) / deep, along / wide, cap);
  if (t < MIN_CELL) {
    // no room to grow: hold the minimum cell and let the mainland shrink
    t = MIN_CELL;
    s = Math.min(sAlong, (across - GAP - t * deep) / mainAcross);
    if (s <= 0) return null;
  }
  return { side, rows, cols, s, t, score: s * 1e4 + t };
}

function chooseLayout(aspect, panels) {
  const W = aspect >= 1 ? SHORT * aspect : SHORT;
  const H = aspect >= 1 ? SHORT : SHORT / aspect;
  const main = panels[0], insets = panels.slice(1);

  if (!insets.length) {
    const s = Math.min(W / main.w, H / main.h);
    return { W, H, place: [{ s, dx: (W - main.w * s) / 2, dy: (H - main.h * s) / 2 }] };
  }

  let best = null;
  for (const side of ['below', 'left']) {
    for (let rows = 1; rows <= insets.length; rows++) {
      const cand = arrange(W, H, main, insets.length, side, rows);
      if (cand && (!best || cand.score > best.score)) best = cand;
    }
  }

  const { side, rows, cols, s, t } = best;
  const mw = main.w * s, mh = main.h * s;
  const place = [];

  if (side === 'below') {
    const blockH = rows * t, total = mh + GAP + blockH;
    const top = (H - total) / 2;
    place.push({ s, dx: (W - mw) / 2, dy: top });
    cellsBelow(place, insets, cols, rows, t, W, top + mh + GAP);
  } else {
    const blockW = cols * t, total = blockW + GAP + mw;
    const left = (W - total) / 2;
    place.push({ s, dx: left + blockW + GAP, dy: (H - mh) / 2 });
    cellsLeft(place, insets, cols, rows, t, H, left);
  }
  return { W, H, place, side };
}

// Cells are filled row by row, and a short final row is centred rather than
// left hanging off one end.
function cellsBelow(place, insets, cols, rows, t, W, y0) {
  insets.forEach((p, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    const inRow = Math.min(cols, insets.length - row * cols);
    const x0 = (W - inRow * t) / 2 + col * t;
    place.push(fitCell(p, x0, y0 + row * t, t));
  });
}

function cellsLeft(place, insets, cols, rows, t, H, x0) {
  const used = Math.ceil(insets.length / cols);
  insets.forEach((p, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    const y0 = (H - used * t) / 2 + row * t;
    place.push(fitCell(p, x0 + col * t, y0, t));
  });
}

function fitCell(panel, x, y, t) {
  const s = Math.min(t / panel.w, t / panel.h) * 0.88;   // breathing room
  return { s, dx: x + (t - panel.w * s) / 2, dy: y + (t - panel.h * s) / 2 };
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
  [L_BASE, L_FOUND, L_MISS, L_ANSWER, L_GROUP, L_LABEL, L_NUDGE, L_HIT]
    .forEach(g => { while (g.firstChild) g.removeChild(g.firstChild); });
  shapes = {}; labels = {}; statusOf = {}; localRings = {}; anchorAt = {};

  REGIONS.forEach(r => {
    localRings[r.name] = parseRings(r.d);

    const p = document.createElementNS(NS, 'path');
    p.setAttribute('class', 'state');
    p.dataset.name = r.name;
    L_BASE.appendChild(p);
    shapes[r.name] = p;

    // one reusable label node per region, hidden until it is needed
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', 'label');
    t.textContent = ABBR[r.name];
    t.style.display = 'none';
    L_LABEL.appendChild(t);
    labels[r.name] = t;
  });

  // whether this browser can hit-test a path's fill; needs a real path to ask
  CAN_HIT = typeof shapes[REGION_NAMES[0]].isPointInFill === 'function';
}

function compose() {
  const box = svg.getBoundingClientRect();
  const aspect = (box.width && box.height) ? box.width / box.height : 1.6;
  const L = chooseLayout(aspect, GEO.panels);
  layoutNow = L;
  svg.setAttribute('viewBox', `0 0 ${L.W.toFixed(1)} ${L.H.toFixed(1)}`);

  while (L_HIT.firstChild) L_HIT.removeChild(L_HIT.firstChild);
  const small = [];

  REGIONS.forEach(r => {
    const at = L.place[r.panel];
    const rings = composeRings(localRings[r.name], at.s, at.dx, at.dy);
    borders[r.name] = rings;
    shapes[r.name].setAttribute('d', pathFrom(rings));

    const lx = r.anchor[0] * at.s + at.dx, ly = r.anchor[1] * at.s + at.dy;
    labels[r.name].setAttribute('x', lx);
    labels[r.name].setAttribute('y', ly + 4);
    anchorAt[r.name] = { x: lx, y: ly };
    if (lensPaths[r.name]) lensPaths[r.name].setAttribute('d', shapes[r.name].getAttribute('d'));

    const rad = r.radius * at.s;
    if (rad < 12) small.push({ name: r.name, x: lx, y: ly, r: rad });
  });

  // Anything whose widest inscribed circle is under ~12 units is hard to hit
  // with a thumb, so it gets an invisible tap target at its label anchor.
  // Tightest go last, so they sit on top of their roomier neighbours.
  small.sort((a, b) => b.r - a.r).forEach(t => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', 'hit');
    c.setAttribute('cx', t.x); c.setAttribute('cy', t.y);
    c.setAttribute('r', Math.max(10, t.r));
    c.dataset.name = t.name;
    L_HIT.appendChild(c);
  });
}
