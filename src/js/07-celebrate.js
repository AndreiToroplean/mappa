
/* ---- winning should feel like winning ----------------------------------
   Finishing all fifty used to look almost identical to running out of lives:
   the map stopped responding and a card slid up. The run is the whole point,
   so it gets a moment of its own before the leaderboard arrives.

   Everything here is decoration. If the canvas is unavailable, or the reader
   has asked for reduced motion, it is skipped and the game carries on — the
   pause before the overlay shortens to match, so nobody waits on an animation
   that is not playing. */

const canvas = $('confetti');
const fanfare = $('fanfare');
const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
const still = matchMedia('(prefers-reduced-motion: reduce)');

const CONFETTI_MS = 2200;
const PIECES = 150;
const GRAVITY = 0.0013;       // px per ms squared
/* Read from the palette rather than listed here, since paper confetti has to
   be dark to show on a light ground and bright to show on a dark one — and the
   palette is where that decision already lives. Read at spawn time, not once,
   so a run finished after a theme change throws the right colours. */
const confetti = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--confetti')
    .split(',').map(s => s.trim()).filter(Boolean);

/* Two cannons, fired from the bottom corners inwards and up, which reads as
   celebratory in a way that a downward drift from the top does not. */
function spawn(w, h) {
  const bits = [];
  const colours = confetti();
  const tilt = 0.26 + 0.36 * Math.min(1, w / 1200);
  for (let i = 0; i < PIECES; i++) {
    const left = i % 2 === 0;
    const spread = (Math.random() - 0.5) * 0.8;
    const speed = 0.9 + Math.random();
    /* Tilt off vertical, wider on wider screens. A fixed 30-degree cannon
       looks right on a laptop but fires straight out of the sides of a phone,
       emptying the screen in under a second. Negative vy is upward, since y
       grows down the screen. */
    const angle = -Math.PI / 2 + (left ? tilt : -tilt) + spread;
    bits.push({
      x: left ? -10 : w + 10,
      y: h + 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.012,
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 7,
      color: colours[i % colours.length],
      drift: (Math.random() - 0.5) * 0.0006,
      // a second wave, so the burst sustains instead of emptying the screen
      // in under a second on a narrow phone
      delay: i < PIECES / 2 ? 0 : 280 + Math.random() * 280,
    });
  }
  return bits;
}

function confetti() {
  if (!ctx) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas.hidden = false;

  const bits = spawn(w, h);
  let last = performance.now();
  const started = last;

  const frame = now => {
    const dt = Math.min(now - last, 34);   // a backgrounded tab must not warp
    last = now;
    const age = now - started;
    ctx.clearRect(0, 0, w, h);

    // fade the whole burst out rather than letting pieces vanish mid-air
    ctx.globalAlpha = age > CONFETTI_MS - 500
      ? Math.max(0, (CONFETTI_MS - age) / 500) : 1;

    for (const b of bits) {
      if (age < b.delay) continue;
      b.vy += GRAVITY * dt;
      b.vx += b.drift * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += b.vrot * dt;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }

    if (age < CONFETTI_MS) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, w, h); canvas.hidden = true; }
  };
  requestAnimationFrame(frame);
}

/* How long finish() should hold the map before the overlay. The celebration
   owns this number so the two can never disagree about it. */
/* Confetti is for Trial, where finishing is an achievement that could have gone
   the other way. In Practice nothing can end a run early, so every run ends this
   way and a celebration for it congratulates you on having kept tapping — which
   is the sort of praise that makes the real thing worth less. Practice still
   gets the banner, because a run should visibly end; it just gets told plainly
   that it is over.

   The reduced-motion path already did exactly this, and for a related reason. */
function celebrate(title) {
  if (still.matches || !MODE.capped) {
    fanfare.firstElementChild.textContent = title;
    fanfare.hidden = false;
    setTimeout(() => { fanfare.hidden = true; }, 900);
    return 1200;
  }
  document.body.classList.add('won');
  fanfare.firstElementChild.textContent = title;
  fanfare.hidden = false;
  confetti();
  setTimeout(() => { fanfare.hidden = true; }, 1900);
  setTimeout(() => { document.body.classList.remove('won'); }, 1600);
  return 2500;
}


/* ---- naming the mistake -------------------------------------------------
   A wrong guess used to be reported only in the ticker, at 11px along the
   bottom edge. Nobody reads that mid-run, and someone brute-forcing their way
   through an unfamiliar map reads it least of all — which wastes the one moment
   they are most likely to remember something, having just been surprised.

   So the name of whatever they hit goes up big, in red, over the middle of the
   map. It is decoration: pointer-events:none, and it never delays a turn. */
const flashBox = $('flash');
let flashTimer = null;

/* Two things put a name up now: a miss, in red, and a review tap, in amber —
   naming a region once the run is over is help rather than a verdict, and amber
   is the colour of help everywhere else in the game. Same animation either way;
   only the colour differs, because only the reason does. */
function flashName(name, help) {
  if (!flashBox) return;
  const span = flashBox.firstElementChild;
  clearTimeout(flashTimer);
  flashBox.classList.toggle('help', !!help);
  // restart the animation from the top, in case this is a second miss in a row
  flashBox.hidden = true;
  span.style.animation = 'none';
  void span.offsetWidth;
  span.style.animation = '';
  /* Only ever the name, in every mode. The cost went here for a while and it
     made the same event report itself twice in two places at once; the ticker
     has room to say it properly and this does not. */
  span.textContent = name;
  flashBox.hidden = false;
  flashTimer = setTimeout(() => { flashBox.hidden = true; }, MISS_MS);
}

const flashMiss = name => flashName(name, false);

function clearFlash() {
  clearTimeout(flashTimer);
  if (flashBox) flashBox.hidden = true;
}


/* ---- pointing the way ---------------------------------------------------
   Practice exists to be learned from, and a wrong guess on an unfamiliar map
   teaches nothing on its own: 100 départements minus one is still 100. After a
   miss, a short arrow appears beside the region that was hit, aimed at the one
   that was wanted.

   Its length is fixed on purpose. A proportional arrow would give the distance
   away exactly, which turns the map into a solved equation rather than
   something to recognise. Thickness carries a coarse sense of distance instead
   — near, middling, far — which is enough to tell "next door" from "other end
   of the country" without handing over the answer. */
const NUDGE_LEN = 14;      // composed units, always the same
const NUDGE_GAP = 2;       // clear of the border it starts from

/* Three styles rather than three stroke widths. Width alone was the first
   attempt and was useless: these are never seen side by side, so the eye has
   nothing to compare a thickness against. A shape is identifiable on its own. */
const TOUCHING = 4;        // composed units; borders this close are shared

/* Styles by relationship rather than by raw distance. The thin chevron means
   "you are touching it", which is a different and more useful statement than
   "you are close"; the middling one covers anything within half the country;
   the solid head means the far half. Half the country is measured from the
   mainland's own drawn span, so it follows the layout instead of being a
   constant that quietly stops matching. */
const NUDGE_STYLES = {
  touching: { width: 1.2, head: 'v', size: 3.6 },
  near: { width: 3.0, head: 'v', size: 5.4 },
  far: { width: 8, head: 'solid' },
};

/* Are these two regions neighbours? Measured border to border, because the
   distance between their centres says nothing about it — Paris and Essonne are
   further apart than Paris and Hauts-de-Seine, and all three touch. */
function touching(a, b) {
  const ra = borders[a], rb = borders[b];
  if (!ra || !rb) return false;
  const limit = TOUCHING * TOUCHING;
  for (const ring of ra) {
    for (let i = 0; i < ring.length; i += 2) {
      if (borderDist2(b, { x: ring[i], y: ring[i + 1] }, limit) < limit) return true;
    }
  }
  return false;
}

/* An arrow across a gap that does not exist on the ground would be a lie: the
   mainland and an inset are not one map, and neither are two insets. The same
   rule governs the distance arrow, so it is named once. */
const sameLandmass = (a, b) => panelOf[a] === panelOf[b];

function canNudge(from, to) {
  return !!(anchorAt[from] && anchorAt[to] && sameLandmass(from, to));
}

function bandFor(from, to, far) {
  if (touching(from, to)) return NUDGE_STYLES.touching;
  const main = GEO.panels[0], at = layoutNow && layoutNow.place[0];
  const across = at ? Math.max(main.w, main.h) * at.s : 600;
  return far < across / 2 ? NUDGE_STYLES.near : NUDGE_STYLES.far;
}

/* Where the line from a to b leaves the region around a. Walking the region's
   own border is the only way to get this right: a fixed offset from the centre
   either starts inside a large region or floats away from a small one. */
function exitPoint(name, a, b) {
  const rings = borders[name];
  if (!rings) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  let best = Infinity;
  for (const r of rings) {
    for (let i = 0; i + 3 < r.length; i += 2) {
      const ex = r[i + 2] - r[i], ey = r[i + 3] - r[i + 1];
      const den = dx * ey - dy * ex;
      if (!den) continue;
      const s = ((r[i] - a.x) * ey - (r[i + 1] - a.y) * ex) / den;
      const u = ((r[i] - a.x) * dy - (r[i + 1] - a.y) * dx) / den;
      if (s > 0.001 && s < best && u >= 0 && u <= 1) best = s;
    }
  }
  if (!isFinite(best)) return null;
  return { x: a.x + dx * best, y: a.y + dy * best };
}

/* What is currently on screen, so it can be drawn again after the layout
   changes. Composed coordinates are baked into the path data, so an arrow drawn
   in portrait pointed at thin air once the map was recomposed for landscape. */
let shownArrow = null;

function nudge(fromName, toName) {
  if (!L_NUDGE || !canNudge(fromName, toName)) return;
  clearNudge();
  shownArrow = { from: fromName, to: toName };
  const a = anchorAt[fromName], b = anchorAt[toName];
  if (!a || !b) return;
  const dx = b.x - a.x, dy = b.y - a.y;
  const far = Math.sqrt(dx * dx + dy * dy);
  if (far < 1) return;
  const ux = dx / far, uy = dy / far;
  const band = bandFor(fromName, toName, far);

  // on the axis between the two centres, starting at the border it leaves
  const edge = exitPoint(fromName, a, b) || { x: a.x + ux * 9, y: a.y + uy * 9 };
  const x0 = edge.x + ux * NUDGE_GAP, y0 = edge.y + uy * NUDGE_GAP;
  const x1 = x0 + ux * NUDGE_LEN, y1 = y0 + uy * NUDGE_LEN;
  const px = -uy, py = ux;
  const at = (t, s) => (x1 + ux * t + px * s).toFixed(1) + ',' +
                       (y1 + uy * t + py * s).toFixed(1);

  const shaft = document.createElementNS(NS, 'path');
  shaft.setAttribute('class', 'nudge');
  shaft.setAttribute('stroke-width', band.width);
  shaft.setAttribute('d', `M${x0.toFixed(1)},${y0.toFixed(1)}L${x1.toFixed(1)},${y1.toFixed(1)}`);
  L_NUDGE.appendChild(shaft);

  if (band.head === 'solid') {
    const head = document.createElementNS(NS, 'path');
    head.setAttribute('class', 'nudgehead');
    head.setAttribute('d', `M${at(10, 0)}L${at(0, 6.4)}L${at(0, -6.4)}Z`);
    L_NUDGE.appendChild(head);
  } else {
    const v = document.createElementNS(NS, 'path');
    v.setAttribute('class', 'nudge');
    v.setAttribute('stroke-width', band.width);
    v.setAttribute('d', `M${at(-band.size, band.size)}L${at(0, 0)}L${at(-band.size, -band.size)}`);
    L_NUDGE.appendChild(v);
  }
}

function clearNudge() {
  shownArrow = null;
  if (L_NUDGE) while (L_NUDGE.firstChild) L_NUDGE.removeChild(L_NUDGE.firstChild);
}

/* How long everything a miss has to say stays on screen: the flashed name, the
   outline of what was hit, and the arrow to what was wanted. One number, because
   they are one report — it read as a bug when half of it stayed behind. */
const MISS_MS = 1600;

/* ---- the distance a miss cost ------------------------------------------
   Drawn only under distance scoring, and unlike the clue arrow it is allowed to
   give everything away: the turn is already over. It runs the whole way from
   where the finger landed to the nearest point of the answer, which is the
   distance that was actually charged, and carries both numbers on it — the
   score, and what that score is in kilometres.

   Red, against the answer's amber. The answer is the thing to look at; this is
   what it cost not to. It carries no label: the numbers read better under the
   flashed name, where the eye already is.

   Not redrawn on a resize, unlike the clue hints: it is on screen for two
   seconds and it is anchored to a tap, not to a region, so there is nothing to
   recompose it from. clearDrift() on recompose is the honest answer. */
function drawDrift(from, target, tapped) {
  if (!L_DRIFT || !from) return;
  // Same rule as the clue arrow: a line across a gap the map invented would
  // describe a distance nobody travelled.
  if (!sameLandmass(tapped, target)) return;
  clearDrift();
  const to = nearestPointOn(target, from);
  if (!to) return;
  const dx = to.x - from.x, dy = to.y - from.y;
  const far = Math.sqrt(dx * dx + dy * dy);
  if (far < 2) return;              // landed on the answer's edge; nothing to draw
  const ux = dx / far, uy = dy / far;

  const line = document.createElementNS(NS, 'path');
  line.setAttribute('class', 'drift');
  line.setAttribute('d', `M${from.x.toFixed(1)},${from.y.toFixed(1)}`
                       + `L${to.x.toFixed(1)},${to.y.toFixed(1)}`);
  L_DRIFT.appendChild(line);

  // a dot where the finger actually was, so the line has a visible origin
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('class', 'driftdot');
  dot.setAttribute('cx', from.x.toFixed(1));
  dot.setAttribute('cy', from.y.toFixed(1));
  dot.setAttribute('r', 3.5);
  L_DRIFT.appendChild(dot);

  const px = -uy, py = ux;
  const at = (t, sd) => (to.x + ux * t + px * sd).toFixed(1) + ',' +
                        (to.y + uy * t + py * sd).toFixed(1);
  const head = document.createElementNS(NS, 'path');
  head.setAttribute('class', 'drifthead');
  head.setAttribute('d', `M${at(0, 0)}L${at(-11, 6.2)}L${at(-11, -6.2)}Z`);
  L_DRIFT.appendChild(head);
}

function clearDrift() {
  if (L_DRIFT) while (L_DRIFT.firstChild) L_DRIFT.removeChild(L_DRIFT.firstChild);
}

/* The wrongly tapped region, outlined for as long as the rest of the report
   lasts. Outline and not fill: a filled shape is what every other mode uses to
   mean a state the region is *in*, and this one is in no state at all — it stays
   open, and may be the region just named. */
/* Review marks a region the same way and for a related reason — there, the
   question is which shape answered the tap, since a tap in the sea resolves to
   the coast beside it. A distance miss uses a third: the answer, flooded amber
   before it settles into the colour it cost.

   One clock for all of them. Several can be alive at once — a distance miss
   outlines what was hit and floods what was wanted in the same instant — and
   they are one report, so they should leave together the way they arrived. */
const MARKS = '.wrongflash,.pickflash,.answerflash';
let missTimer = null;

function markRegion(name, cls) {
  clearTimeout(missTimer);
  if (shapes[name]) shapes[name].classList.add(cls);
  missTimer = setTimeout(clearMissMarks, MISS_MS);
}

const markMiss = name => markRegion(name, 'wrongflash');
const markPick = name => markRegion(name, 'pickflash');
const markAnswer = name => markRegion(name, 'answerflash');

function clearMissMarks() {
  clearTimeout(missTimer);
  // a repaint may have moved a marked shape between layers; find them by class
  document.querySelectorAll(MARKS).forEach(n =>
    n.classList.remove('wrongflash', 'pickflash', 'answerflash'));
  clearDrift();
}
