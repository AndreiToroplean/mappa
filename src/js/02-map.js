const $ = id => document.getElementById(id);
const svg = $('map');
const NS = 'http://www.w3.org/2000/svg';
let shapes = {};     // region name -> its <path>
let labels = {};     // region name -> its abbreviation <text>

// SVG paints in document order, so resolved states must physically move up the
// stack or neighbours drawn later will clip their outlines.
const layer = () => svg.appendChild(document.createElementNS(NS, 'g'));
const L_BASE = layer(), L_FOUND = layer(), L_MISS = layer(),
      L_ANSWER = layer(), L_LABEL = layer(), L_GROUP = layer(),
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

/* Shelf packing, so an inset takes the room it needs and no more. `along` is
   the axis shelves run in; the block grows on the other one. */
function shelve(sizes, along, horizontal) {
  const shelves = [];
  let cur = null;
  for (let i = 0; i < sizes.length; i++) {
    const w = horizontal ? sizes[i].w : sizes[i].h;
    const d = horizontal ? sizes[i].h : sizes[i].w;
    if (!cur || cur.used + PAD + w > along) {
      cur = { items: [], used: 0, depth: 0 };
      shelves.push(cur);
    }
    cur.items.push({ i, at: cur.used + (cur.used ? PAD : 0) });
    cur.used += (cur.used ? PAD : 0) + w;
    cur.depth = Math.max(cur.depth, d);
  }
  return shelves;
}

function tryScale(s, W, H, main, insets, below) {
  const along = below ? W : H;
  const across = below ? H : W;
  if (main.w * s > W || main.h * s > H) return null;
  const scales = insetScales(s, main, insets);
  const sizes = insets.map((p, i) => ({ w: p.w * scales[i], h: p.h * scales[i] }));
  const shelves = shelve(sizes, along, below);
  const depth = shelves.reduce((t, sh) => t + sh.depth, 0) + PAD * (shelves.length - 1);
  const mainAcross = below ? main.h * s : main.w * s;
  if (mainAcross + GAP + depth > across) return null;
  return { s, scales, sizes, shelves, depth, below };
}

function chooseLayout(aspect, panels) {
  const W = aspect >= 1 ? SHORT * aspect : SHORT;
  const H = aspect >= 1 ? SHORT : SHORT / aspect;
  const main = panels[0], insets = panels.slice(1);

  if (!insets.length) {
    const s = Math.min(W / main.w, H / main.h);
    return { W, H, place: [{ s, dx: (W - main.w * s) / 2, dy: (H - main.h * s) / 2 }] };
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
  if (!best) return { W, H, place: panels.map(() => ({ s: 0.1, dx: 0, dy: 0 })) };

  const { s, scales, sizes, shelves, depth, below } = best;
  const mw = main.w * s, mh = main.h * s;
  const place = [];
  const total = (below ? mh : mw) + GAP + depth;
  const start = ((below ? H : W) - total) / 2;

  if (below) {
    place.push({ s, dx: (W - mw) / 2, dy: start });
    let y = start + mh + GAP;
    for (const sh of shelves) {
      const rowW = sh.items.reduce((t, it) => t + sizes[it.i].w, 0) + PAD * (sh.items.length - 1);
      const x0 = (W - rowW) / 2;
      for (const it of sh.items) {
        place[it.i + 1] = { s: scales[it.i], dx: x0 + it.at,
                            dy: y + (sh.depth - sizes[it.i].h) / 2 };
      }
      y += sh.depth + PAD;
    }
  } else {
    place.push({ s, dx: start + depth + GAP, dy: (H - mh) / 2 });
    let x = start;
    for (const sh of shelves) {
      const colH = sh.items.reduce((t, it) => t + sizes[it.i].h, 0) + PAD * (sh.items.length - 1);
      const y0 = (H - colH) / 2;
      for (const it of sh.items) {
        place[it.i + 1] = { s: scales[it.i], dx: x + (sh.depth - sizes[it.i].w) / 2,
                            dy: y0 + it.at };
      }
      x += sh.depth + PAD;
    }
  }
  return { W, H, place, side: below ? 'below' : 'left' };
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
  [L_BASE, L_FOUND, L_MISS, L_ANSWER, L_LABEL, L_GROUP, L_NUDGE, L_HIT]
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
