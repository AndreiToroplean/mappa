const svg = document.getElementById('map');
const NS = 'http://www.w3.org/2000/svg';
const nodes = {};

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

