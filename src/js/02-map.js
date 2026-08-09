const svg = document.getElementById('map');
const NS = 'http://www.w3.org/2000/svg';
const nodes = {};
const REGION_NAMES = STATES.map(s => s.n);

// SVG paints in document order, so resolved states must physically move up the
// stack or neighbours drawn later will clip their outlines.
const layer = () => svg.appendChild(document.createElementNS(NS, 'g'));
const L_BASE = layer(), L_FOUND = layer(), L_MISS = layer(),
      L_ANSWER = layer(), L_LABEL = layer(), L_HIT = layer();

// draw states
STATES.forEach(s => {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', s.d);
  p.setAttribute('class', 'state');
  p.dataset.name = s.n;
  L_BASE.appendChild(p);
  nodes[s.n] = p;
});
// every state gets one reusable label node, hidden until it's needed
const labels = {};
STATES.forEach(s => {
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('class', 'label');
  t.setAttribute('x', s.l[0]); t.setAttribute('y', s.l[1] + 4);
  t.textContent = ABBR[s.n];
  t.style.display = 'none';
  L_LABEL.appendChild(t);
  labels[s.n] = t;
});

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
  open:   { cls: 'state',        layer: null,     label: null },
  found:  { cls: 'state found',  layer: 'FOUND',  label: 'found' },
  missed: { cls: 'state miss',   layer: 'MISS',   label: 'wrong' },
  answer: { cls: 'state reveal', layer: 'ANSWER', label: 'answer' },
};
const LAYERS = { FOUND: L_FOUND, MISS: L_MISS, ANSWER: L_ANSWER };

const statusOf = {};   // region name -> key of STATUS

function setStatus(name, key) {
  const spec = STATUS[key];
  statusOf[name] = key;
  nodes[name].setAttribute('class', spec.cls);
  (spec.layer ? LAYERS[spec.layer] : L_BASE).appendChild(nodes[name]);
  setLabel(name, spec.label);
}

const status = name => statusOf[name] || 'open';
// Any state whose widest inscribed circle is under ~12px is hard to hit with a
// thumb, so it gets an invisible tap target at its pole of inaccessibility.
// Tightest states go last so they sit on top of their roomier neighbours.
STATES.filter(s => s.r < 12).sort((a, b) => b.r - a.r).forEach(s => {
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('class', 'hit');
  c.setAttribute('cx', s.l[0]); c.setAttribute('cy', s.l[1]);
  c.setAttribute('r', Math.max(10, s.r));
  c.dataset.name = s.n;
  L_HIT.appendChild(c);
});

