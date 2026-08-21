/* ---- press-and-hold magnifier -------------------------------------------
   Enlarged tap targets make the small states reachable but not *aimable*: a
   thumb covers the target, and a tap is committed the instant it lands, so
   the first feedback you get is a lost life. Holding opens a zoomed disc
   offset from the finger. Drag to move the crosshair, and the state under it
   lights up and is named — so what a release will select is always visible
   before the release happens. Lift over open water to cancel.             */
const HOLD_MS  = 250;   // press this long, without sliding, to open the disc
const ZOOM     = 4;     // magnification inside the disc
const DISC_R   = 92;    // disc radius in CSS px — must match .lens .disc
const GUARD_MS = 180;   // trailing window discarded: the twitch on lift-off
const DWELL_MS = 120;   // rest this long on a state for it to read as intent
const SLOP     = 10;    // px of drift still counted as holding still

const lensBox = $('lens'), lensMap = $('lensMap'), lensCap = $('lensCap');

// one throwaway path per state, built once; only the classes change per open
let lensPaths = {};

function buildLens() {
  while (lensMap.firstChild) lensMap.removeChild(lensMap.firstChild);
  lensPaths = {};
  REGIONS.forEach(r => {
    const p = document.createElementNS(NS, 'path');   // compose() sets the path
    lensMap.appendChild(p);
    lensPaths[r.name] = p;
  });
}

let holdTimer = null, lensOn = false, swallowClick = false;
let downX = 0, downY = 0, aim = null, trail = [], moveRaf = 0, lastPt = null;

function openLens(x, y) {
  lensOn = true;
  // the STATUS table decides how a status looks in the disc too, so the disc
  // and the map can never drift apart
  for (const nm in lensPaths) lensPaths[nm].setAttribute('class', STATUS[status(nm)].lens);
  trail = [];
  aim = undefined;          // force the first update to register a segment
  lensBox.hidden = false;
  moveLens(x, y);
}

function moveLens(x, y) {
  const m = svg.getScreenCTM(), u = userPoint(x, y);
  if (!m || !u) return;
  const half = DISC_R / (Math.abs(m.a) * ZOOM);   // user units shown each side
  lensMap.setAttribute('viewBox',
    (u.x - half) + ' ' + (u.y - half) + ' ' + (half * 2) + ' ' + (half * 2));

  // float the disc clear of the finger, flipping below it near the top edge
  const vw = innerWidth, vh = innerHeight, D = DISC_R * 2;
  lensBox.style.left = Math.min(Math.max(x - DISC_R, 8), Math.max(8, vw - D - 8)) + 'px';
  let top = y - D - 40;
  if (top < 8) top = Math.min(y + 40, Math.max(8, vh - D - 46));
  lensBox.style.top = top + 'px';

  const name = resolve(x, y);   // exactly what a release would pick
  if (name !== aim) {
    const now = Date.now();
    if (trail.length) trail[trail.length - 1].t1 = now;
    if (aim && lensPaths[aim]) lensPaths[aim].classList.remove('aim');
    aim = name;
    if (name) lensPaths[name].classList.add('aim');
    trail.push({ name: name, t0: now, t1: now, u: u });
    // Deliberately never the state's name. Naming what you are hovering would
    // answer the only question the game asks. The amber fill already says
    // *which shape* is aimed, which is all the magnifier needs to promise.
    lensCap.textContent = name ? 'lift to pick' : 'lift to cancel';
    lensCap.classList.toggle('none', !name);
  }
}

/* What did they actually mean? Everything inside the last GUARD_MS is thrown
   away, because the finger almost always slides a little as it leaves the
   glass. Walking back from there, the first state rested on for DWELL_MS is
   the answer; if nothing was rested on, fall back to the last state touched
   before the guard window. */
/* settle() answers "which region", settled() answers it with the moment it was
   aimed at still attached — distance scoring needs to measure from where the
   finger was when it meant this region, not from where it happened to be at
   lift. Two names for one walk, rather than two walks. */
function settle() {
  const s = settled();
  return s ? s.name : null;
}

function settled() {
  const now = Date.now();
  if (trail.length) trail[trail.length - 1].t1 = now;
  const cutoff = now - GUARD_MS;
  let fallback;
  for (let i = trail.length - 1; i >= 0; i--) {
    const s = trail[i];
    if (s.t0 >= cutoff) continue;                       // wholly inside the guard
    if (Math.min(s.t1, cutoff) - s.t0 >= DWELL_MS) return s;
    if (fallback === undefined) fallback = s;
  }
  if (fallback !== undefined) return fallback;
  return trail.length ? trail[trail.length - 1] : null;
}

function closeLens(commit) {
  clearTimeout(holdTimer);
  holdTimer = null;
  if (!lensOn) return false;
  const pick = commit ? settled() : null;
  if (aim && lensPaths[aim]) lensPaths[aim].classList.remove('aim');
  lensOn = false;
  lensBox.hidden = true;
  aim = null;
  trail = [];
  if (pick && pick.name) guess(pick.name, pick.u);
  return true;
}

svg.addEventListener('pointerdown', e => {
  swallowClick = false;
  if (!running) return;
  downX = e.clientX;
  downY = e.clientY;
  try { svg.setPointerCapture(e.pointerId); } catch (err) {}
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => openLens(downX, downY), HOLD_MS);
});

svg.addEventListener('pointermove', e => {
  if (!lensOn) {
    // slid off the press point before the disc opened — that was a drag, not a hold
    if (holdTimer &&
        Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > SLOP) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    return;
  }
  lastPt = { x: e.clientX, y: e.clientY };     // one hit test per frame, no more
  if (moveRaf) return;
  moveRaf = requestAnimationFrame(() => {
    moveRaf = 0;
    if (lensOn && lastPt) moveLens(lastPt.x, lastPt.y);
  });
});

svg.addEventListener('pointerup', e => {
  if (closeLens(true)) swallowClick = true;   // don't also fire the plain tap
});
svg.addEventListener('pointercancel', () => { closeLens(false); });
svg.addEventListener('contextmenu', e => e.preventDefault());

svg.addEventListener('click', e => {
  if (swallowClick) return;          // this press was consumed by the magnifier
  // An enlarged hit circle still counts, but only for a state worth picking;
  // anything else goes through the shared resolver.
  const tapped = e.target.dataset && e.target.dataset.name;
  const at = userPoint(e.clientX, e.clientY);
  guess(selectable(tapped) ? tapped : resolve(e.clientX, e.clientY), at);
});

