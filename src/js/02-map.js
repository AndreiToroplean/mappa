const $ = id => document.getElementById(id);
const svg = $('map');
const NS = 'http://www.w3.org/2000/svg';
let shapes = {};     // region name -> its <path>
let labels = {};     // region name -> its abbreviation <text>

// SVG paints in document order, so resolved states must physically move up the
// stack or neighbours drawn later will clip their outlines.
const layer = () => svg.appendChild(document.createElementNS(NS, 'g'));
const L_WATER = layer(), L_BASE = layer(), L_FOUND = layer(), L_MISS = layer(),
      L_ANSWER = layer(), L_LABEL = layer(), L_GROUP = layer(),
      L_NUDGE = layer(), L_HIT = layer();

/* Composed label anchors, kept because the nudge arrow needs to point from one
   region to another and the anchor is the most sensible "middle" we have — it
   is the pole of inaccessibility, so it is inside even for awkward shapes. */
let anchorAt = {};
let panelOf = {};    // region name -> which panel it is drawn on
let waterRings = [], waterPaths = [];

/* Widest first, so the faint outer band sits beneath the brighter inner one.
   The dashed band is the wave hint — short dashes along the shore, most of each
   dash hidden by land, which is enough to read as movement without a texture. */
const WATER_BANDS = ['sea sea4', 'sea sea3', 'sea sea2', 'sea sea1', 'seawave'];

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
    insets.forEach((p, i) => {
      place[i + 1] = { s: scales[i], dx: slack + packed.at[i].along,
                       dy: y0 + packed.at[i].depth };
    });
  } else {
    place.push({ s, dx: start + packed.total + GAP, dy: (H - mh) / 2 });
    insets.forEach((p, i) => {
      place[i + 1] = { s: scales[i], dx: start + packed.at[i].depth,
                       dy: slack + packed.at[i].along };
    });
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
  [L_WATER, L_BASE, L_FOUND, L_MISS, L_ANSWER, L_LABEL, L_GROUP, L_NUDGE, L_HIT]
    .forEach(g => { while (g.firstChild) g.removeChild(g.firstChild); });
  shapes = {}; labels = {}; statusOf = {}; localRings = {}; anchorAt = {};
  panelOf = {};

  /* Coastal stretches of border, in panel-local units like everything else, so
     compose() places them with the identical transform and they cannot drift
     from the coast they trace.

     Each is stroked several times, wide to narrow, in a layer *under* the land.
     That is what makes it cheap: a stroke straddles the line it follows, and the
     land drawn on top hides the inland half, so what is left is a halo on the
     seaward side only. No clipping, no bounding box to respect, and the haloes
     of neighbouring panels may overlap freely — which is why nothing gets cut
     off at a panel edge any more. */
  waterRings = (GEO.coast || []).map(w => ({ panel: w.p, rings: parseRings(w.d) }));
  waterPaths = waterRings.map(() => WATER_BANDS.map(cls => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('class', cls);
    L_WATER.appendChild(p);
    return p;
  }));

  REGIONS.forEach(r => {
    localRings[r.name] = parseRings(r.d);
    panelOf[r.name] = r.panel;

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
  waterRings.forEach((w, i) => {
    const at = L.place[w.panel];
    // open polylines, so pathFrom's closing Z would join the two ends
    const d = at ? pathFrom(composeRings(w.rings, at.s, at.dx, at.dy)).replace(/Z/g, '') : '';
    waterPaths[i].forEach(p => p.setAttribute('d', d));
  });

  // Anything else drawn in composed coordinates has to be rebuilt with them.
  redrawHints();
}
