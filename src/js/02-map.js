const $ = id => document.getElementById(id);
const svg = $('map');
const NS = 'http://www.w3.org/2000/svg';
let shapes = {};     // region name -> its <path>
let labels = {};     // region name -> its abbreviation <text>

// SVG paints in document order, so resolved states must physically move up the
// stack or neighbours drawn later will clip their outlines.
const layer = () => svg.appendChild(document.createElementNS(NS, 'g'));
const L_BASE = layer(), L_FOUND = layer(), L_MISS = layer(),
      L_ANSWER = layer(), L_LABEL = layer(), L_HIT = layer();

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

/* ---- building the map ----------------------------------------------------
   Runs at startup and again whenever the geography changes, so it has to clear
   what it built last time rather than assume an empty stage. Each geography
   brings its own view box; everything else about the map is the same shape of
   work regardless of which regions are in play. */
function buildMap() {
  [L_BASE, L_FOUND, L_MISS, L_ANSWER, L_LABEL, L_HIT]
    .forEach(g => { while (g.firstChild) g.removeChild(g.firstChild); });
  shapes = {}; labels = {}; statusOf = {};
  svg.setAttribute('viewBox', GEO.viewBox);

  // one path per region
  REGIONS.forEach(r => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', r.d);
    p.setAttribute('class', 'state');
    p.dataset.name = r.name;
    L_BASE.appendChild(p);
    shapes[r.name] = p;
  });

  // every state gets one reusable label node, hidden until it's needed
  REGIONS.forEach(r => {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', 'label');
    t.setAttribute('x', r.anchor[0]); t.setAttribute('y', r.anchor[1] + 4);
    t.textContent = ABBR[r.name];
    t.style.display = 'none';
    L_LABEL.appendChild(t);
    labels[r.name] = t;
  });

  // Any state whose widest inscribed circle is under ~12px is hard to hit with a
  // thumb, so it gets an invisible tap target at its pole of inaccessibility.
  // Tightest states go last so they sit on top of their roomier neighbours.
  REGIONS.filter(r => r.radius < 12).sort((a, b) => b.radius - a.radius).forEach(r => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', 'hit');
    c.setAttribute('cx', r.anchor[0]); c.setAttribute('cy', r.anchor[1]);
    c.setAttribute('r', Math.max(10, r.radius));
    c.dataset.name = r.name;
    L_HIT.appendChild(c);
  });

  // whether this browser can hit-test a path's fill; needs a real path to ask
  CAN_HIT = typeof shapes[REGION_NAMES[0]].isPointInFill === 'function';
}
