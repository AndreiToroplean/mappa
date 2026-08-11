
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
const CONFETTI_COLORS = ['#4FCBA4', '#FFC24B', '#E9EEF6', '#5AA6FF', '#FF8FA8'];

/* Two cannons, fired from the bottom corners inwards and up, which reads as
   celebratory in a way that a downward drift from the top does not. */
function spawn(w, h) {
  const bits = [];
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
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
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
function celebrate(title) {
  if (still.matches) {
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

function flashMiss(name) {
  if (!flashBox) return;
  const span = flashBox.firstElementChild;
  clearTimeout(flashTimer);
  // restart the animation from the top, in case this is a second miss in a row
  flashBox.hidden = true;
  span.style.animation = 'none';
  void span.offsetWidth;
  span.style.animation = '';
  span.textContent = name;
  flashBox.hidden = false;
  flashTimer = setTimeout(() => { flashBox.hidden = true; }, 1150);
}

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
const NUDGE_START = 11;    // clear of the region's own label
const NUDGE_LEN = 14;      // composed units, always the same

/* Three styles rather than three stroke widths. Width alone was the first
   attempt and was useless: at this size the eye cannot compare two thicknesses
   that are not side by side, so the bands were invisible. A chevron, a double
   chevron and a solid head are told apart instantly and in isolation, which is
   the only way they are ever seen. */
const NUDGE_BANDS = [
  { limit: 130, width: 1.8, head: 'v' },        // next door
  { limit: 330, width: 3.4, head: 'vv' },       // some way off
  { limit: Infinity, width: 6.4, head: 'solid' },  // other end of the map
];

function nudge(fromName, toName) {
  if (!L_NUDGE) return;
  clearNudge();
  const a = anchorAt[fromName], b = anchorAt[toName];
  if (!a || !b) return;
  const dx = b.x - a.x, dy = b.y - a.y;
  const far = Math.sqrt(dx * dx + dy * dy);
  if (far < 1) return;
  const ux = dx / far, uy = dy / far;
  const band = NUDGE_BANDS.find(z => far < z.limit) || NUDGE_BANDS[2];

  const x0 = a.x + ux * NUDGE_START, y0 = a.y + uy * NUDGE_START;
  const x1 = x0 + ux * NUDGE_LEN, y1 = y0 + uy * NUDGE_LEN;
  const px = -uy, py = ux;                        // perpendicular
  const at = (t, s) => [(x1 + ux * t + px * s).toFixed(1),
                        (y1 + uy * t + py * s).toFixed(1)];

  const shaft = document.createElementNS(NS, 'path');
  shaft.setAttribute('class', 'nudge');
  shaft.setAttribute('stroke-width', band.width);
  shaft.setAttribute('d', `M${x0.toFixed(1)},${y0.toFixed(1)}L${x1.toFixed(1)},${y1.toFixed(1)}`);
  L_NUDGE.appendChild(shaft);

  if (band.head === 'solid') {
    const hl = 9, hw = 5.6;
    const head = document.createElementNS(NS, 'path');
    head.setAttribute('class', 'nudgehead');
    head.setAttribute('d', `M${at(hl, 0)}L${at(0, hw)}L${at(0, -hw)}Z`);
    L_NUDGE.appendChild(head);
  } else {
    const back = band.head === 'vv' ? [0, -5.5] : [0];
    for (const off of back) {
      const v = document.createElementNS(NS, 'path');
      v.setAttribute('class', 'nudge');
      v.setAttribute('stroke-width', band.width);
      v.setAttribute('d', `M${at(off - 4.5, 4.5)}L${at(off, 0)}L${at(off - 4.5, -4.5)}`);
      L_NUDGE.appendChild(v);
    }
  }
}

function clearNudge() {
  if (L_NUDGE) while (L_NUDGE.firstChild) L_NUDGE.removeChild(L_NUDGE.firstChild);
}
