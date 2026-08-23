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
const FINGER   = 40;    // px of clearance between the block and the fingertip

const lensBox = $('lens'), lensMap = $('lensMap'), lensCap = $('lensCap');

// one throwaway path per state, built once; only the classes change per open
let lensPaths = {};

/* The disc paints in document order exactly as the map does, and had the bug
   the map's layers were added to fix: a neighbour drawn later paints over the
   shared border, so the amber outline of the aimed region came out with pieces
   missing wherever a region later in the list touched it. Same fix, same
   order — a resolved state moves up the stack, and the aimed one moves above
   all of them, since it is the one thing the disc exists to show.

   The tiers are the lens classes STATUS hands out, written down rather than
   collected from it: a new status whose lens class is not on this list would
   otherwise be seated nowhere at all. check.py holds the two together. */
const LENS_TIERS = ['', 'found', 'miss'];
let lensLayers = {};

function buildLens() {
  while (lensMap.firstChild) lensMap.removeChild(lensMap.firstChild);
  lensLayers = {};
  LENS_TIERS.concat('aim').forEach(t => {
    lensLayers[t] = lensMap.appendChild(document.createElementNS(NS, 'g'));
  });
  lensPaths = {};
  REGIONS.forEach(r => {
    const p = document.createElementNS(NS, 'path');   // compose() sets the path
    lensLayers[''].appendChild(p);
    lensPaths[r.name] = p;
  });
}

// back to the layer its status earns it, whatever it was borrowing
function seat(name) {
  if (!lensPaths[name]) return;
  const tier = lensLayers[STATUS[status(name)].lens] || lensLayers[''];
  tier.appendChild(lensPaths[name]);
}

let holdTimer = null, lensOn = false, swallowClick = false;
let downX = 0, downY = 0, aim = null, trail = [], moveRaf = 0, lastPt = null;
/* The block's size, measured once when it opens rather than every frame: a
   layout read per pointermove is a forced reflow, and the size cannot change
   while it is open. */
let boxW = DISC_R * 2, boxH = DISC_R * 2;

function openLens(x, y) {
  lensOn = true;
  // the STATUS table decides how a status looks in the disc too, so the disc
  // and the map can never drift apart — and where it sits, for the same reason
  for (const nm in lensPaths) {
    lensPaths[nm].setAttribute('class', STATUS[status(nm)].lens);
    seat(nm);
  }
  trail = [];
  aim = undefined;          // force the first update to register a segment
  lensBox.hidden = false;
  /* Which caption this open is going to carry, before anything is measured: it
     decides the block's size, and the size decides where the block goes. */
  lensCap.classList.toggle('facts', reviewing);
  boxW = lensBox.offsetWidth || DISC_R * 2;
  boxH = lensBox.offsetHeight || DISC_R * 2;
  moveLens(x, y);
}

/* Where the block goes, given where the finger is.

   The disc and its caption are placed together. Placing the disc alone and
   letting the caption hang off the bottom was fine while the caption was one
   short line of instruction — 40px of clearance covered it — but in review it
   carries the facts, wraps to three lines, and landed square under the finger
   it was supposed to clear.

   Above the finger by preference, below when the top edge is too near, and
   beside it when the window is too short for either — which is a landscape
   phone, where 184px of disc plus its clearance is most of the height. */
function placeLens(x, y) {
  const vw = innerWidth, vh = innerHeight;
  const above = y - FINGER - boxH, below = y + FINGER;
  let left = x - boxW / 2, top;

  if (above >= 8) top = above;
  else if (below + boxH <= vh - 8) top = below;
  else {
    top = y - boxH / 2;
    left = x < vw / 2 ? x + FINGER : x - FINGER - boxW;
  }
  const fit = (v, span, limit) => Math.min(Math.max(v, 8), Math.max(8, limit - span - 8));
  lensBox.style.left = fit(left, boxW, vw) + 'px';
  lensBox.style.top = fit(top, boxH, vh) + 'px';
}

function moveLens(x, y) {
  const m = svg.getScreenCTM(), u = userPoint(x, y);
  if (!m || !u) return;
  const half = DISC_R / (Math.abs(m.a) * ZOOM);   // user units shown each side
  lensMap.setAttribute('viewBox',
    (u.x - half) + ' ' + (u.y - half) + ' ' + (half * 2) + ' ' + (half * 2));

  // float the block clear of the finger, on whichever side has the room
  placeLens(x, y);

  const name = resolve(x, y);   // exactly what a release would pick
  if (name !== aim) {
    const now = Date.now();
    if (trail.length) trail[trail.length - 1].t1 = now;
    if (aim && lensPaths[aim]) {
      lensPaths[aim].classList.remove('aim');
      seat(aim);                  // it was on top; put it back where it belongs
    }
    aim = name;
    if (name) {
      lensPaths[name].classList.add('aim');
      lensLayers.aim.appendChild(lensPaths[name]);   // nothing paints over it
    }
    trail.push({ name: name, t0: now, t1: now, u: u });
    /* Deliberately never the state's name during a run. Naming what you are
       hovering would answer the only question the game asks. The amber fill
       already says *which shape* is aimed, which is all the magnifier needs to
       promise.

       In review there is nothing left to give away, and the caption has no
       instruction worth carrying — a lift there costs nothing. So it holds the
       facts instead, the same line the ticker shows, and the magnifier becomes
       a way to read the map by dragging over it. */
    if (reviewing) {
      if (name) lensCap.innerHTML = factsHTML(name);
      else lensCap.textContent = `no ${GEO.noun} here`;
    } else {
      lensCap.textContent = name ? 'lift to pick' : 'lift to cancel';
    }
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
  if (aim && lensPaths[aim]) { lensPaths[aim].classList.remove('aim'); seat(aim); }
  lensOn = false;
  lensBox.hidden = true;
  aim = null;
  trail = [];
  if (pick && pick.name) choose(pick.name, pick.u);
  return true;
}

/* One name for "the player picked this region", because the map is live in two
   different states and both the tap path and the magnifier path have to reach
   the right one. In a run a pick is an answer; in review it is a question. */
function choose(name, at) {
  if (reviewing) inspect(name);
  else guess(name, at);
}

svg.addEventListener('pointerdown', e => {
  swallowClick = false;
  if (!running && !reviewing) return;
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
  const at = userPoint(e.clientX, e.clientY);
  choose(resolve(e.clientX, e.clientY), at);
});

