// game state
let queue, current, errors, found, t0, raf, running;

/* Errors are the thing that is counted; the cap is a rule about them. Tracking
   what is left directly would leave practice mode — no cap at all — with
   nothing to count.

   Under distance scoring `errors` is a fraction rather than a whole number, so
   it is kept unrounded all the way to the end and rounded only where it is
   shown or stored. Rounding each miss as it lands would let a run of tiny ones
   cost nothing at all. */
const spendLeft = () => budget() - errors;
const spent = () => Math.round(errors);
const busted = () => MODE.capped && errors >= budget() - 1e-9;
/* Every element the game touches, looked up once. These were a mix of cached
   consts and repeated getElementById calls scattered through the code. */
const el = {};
['bar', 'promptLabel', 'target', 'lives', 'counterLabel', 'missCount', 'clue',
 'pause', 'paused', 'resumeBtn', 'restartBtn', 'quitBtn',
 'progress', 'clock', 'ticker',
 'countdown', 'countNum', 'intro', 'introBoard', 'overlay', 'ovTitle', 'ovSub',
 'boardList', 'confirm', 'again', 'startBtn', 'clearNo', 'clearYes',
].forEach(id => { el[id] = $(id); });

const clock = el.clock, ticker = el.ticker, overlay = el.overlay;

const fmt = ms => {
  const s = ms / 1000;
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
    + '.' + Math.floor((s * 10) % 10);
};

/* One header column, three readings. Three lives are pips, because three of
   anything reads faster as objects than as a number. Anything else is a number:
   misses taken, or distance spent — and in a capped run the cap is shown beside
   it, since a budget nobody can see is not a budget. */
function drawCounter() {
  const pips = SCORING.pips && MODE.capped;
  document.body.classList.toggle('numeric', !pips);
  el.counterLabel.textContent = SCORING.id === 'drift' ? 'Off by'
    : MODE.capped ? 'Lives' : 'Misses';

  if (!pips) {
    el.missCount.textContent = MODE.capped ? `${spent()}/${budget()}` : spent();
    el.missCount.classList.toggle('bad', errors > 0);
    return;
  }
  el.lives.innerHTML = Array.from({ length: budget() }, (_, i) =>
    `<div class="pip${i < spendLeft() ? '' : ' gone'}"></div>`).join('');
  if (busted()) document.querySelector('.pip').classList.add('lastgone');
}

function resetRun() {
  queue = REGION_NAMES.slice();
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  errors = 0; found = 0; running = false; revealing = false;
  clearDrift();
  document.body.classList.toggle('practice', MODE.id === 'practice');
  REGION_NAMES.forEach(name => setStatus(name, 'open'));
  drawCounter();
  clearFlash();
  clearNudge();
  resetClues(true);
  document.body.classList.remove('won');
  el.bar.classList.remove('lost', 'won');
  el.target.classList.remove('lost', 'won');
  clock.classList.remove('lost', 'won');
  el.promptLabel.textContent = 'Find this ' + GEO.noun;
  el.progress.textContent = '0/' + TOTAL;
  el.target.textContent = 'Get ready';
  clock.textContent = '0:00.0';
  /* The one thing the menu no longer says, delivered where it is about to be
     useful. Not adapted to the mode: what the mode does to a miss is already on
     the header, in the column that counts lives or misses by name. */
  ticker.textContent = `Click the ${GEO.noun} named above, `
    + 'or press and hold to zoom.';
  overlay.hidden = true;
  el.intro.hidden = true;
}

/* What to call a finished run. Counting only ever completes by finding
   everything, so this was the geography's own word for it. Distance completes
   whether or not you were right, so a run can reach the end having found half —
   and calling that "All fifty" would be a lie the scoreboard then repeats. */
const tally = () => (found === TOTAL ? GEO.all : `${found} of ${TOTAL}`);

function countdown(done) {
  const box = el.countdown, num = el.countNum;
  let n = 3;
  box.hidden = false;
  const show = () => {
    num.textContent = n;
    num.style.animation = 'none';
    void num.offsetWidth;
    num.style.animation = '';
    if (n-- > 1) setTimeout(show, 700);
    else setTimeout(() => { box.hidden = true; done(); }, 700);
  };
  show();
}

function beginRun() {
  resetRun();
  countdown(() => {
    running = true;
    document.body.classList.add('playing');
    t0 = Date.now();
    tick();
    next();
  });
}

function tick() {
  clock.textContent = fmt(Date.now() - t0);
  if (running) raf = requestAnimationFrame(tick);
}

function next() {
  current = queue.pop();
  el.target.innerHTML = current + '<span class="caret"></span>';
  resetClues(false);      // the ladder starts again for each region
}

/* `at` is where the tap actually landed, in composed units, and only distance
   scoring has any use for it. It is optional because not every pick has one. */
function guess(name, at) {
  if (!running || paused || revealing || !selectable(name)) return;

  if (name === current) {
    clearFlash();     // a red name left over from a miss would read as wrong
    clearNudge();
    resetClues(false);
    setStatus(name, 'found');
    // the turn is over: clear this turn's misses, they count again next time
    REGION_NAMES.forEach(m => { if (status(m) === 'missed') setStatus(m, 'open'); });
    found++;
    el.progress.textContent = found + '/' + TOTAL;
    ticker.innerHTML = `<span class="ok">Correct</span> — <b>${name}</b>`;
    if (queue.length === 0) return finish(true, name);
    next();
  } else if (SCORING.retry) {
    setStatus(name, 'missed');
    flashMiss(name);
    if (MODE.clues) missed(name);   // opens the arrow rung; drawn only on request
    errors += 1;
    drawCounter();
    ticker.innerHTML = `<span class="no">Miss</span> — that was <b>${name}</b>`;
    if (busted()) finish(false, name);
  } else {
    missByDistance(name, at);
  }
}

/* One tap per region, so a wrong one ends the turn instead of leaving it open.
   The answer is shown, the distance to it is drawn from where the finger
   actually landed, and then the next region is named — see SCORINGS.drift for
   why guessing again would spoil the number. */
const REVEAL_MS = 2100;   // long enough to read the arrow and find the answer
let revealing = false;

function missByDistance(name, at) {
  const target = current;
  const from = at || anchorAt[name];
  const { cost, km } = driftFrom(target, name, from);

  errors += cost;
  drawCounter();

  setStatus(name, 'missed');
  flashMiss(name);
  setStatus(target, 'answer');
  drawDrift(from, target, Math.round(cost), km);

  ticker.innerHTML = `<span class="no">Miss</span> — that was <b>${name}</b>. `
    + `It was <b>${target}</b>, <span class="no">off by ${Math.round(cost)}</span>`
    + (km === null ? ' — a different landmass.' : `, about ${fmtKm(km)}.`);

  if (busted()) return finish(false, name);

  /* The clock stops for the reveal. It is the game holding the screen, not the
     player thinking, and charging time for it would fine a miss twice. */
  revealing = true;
  const heldAt = Date.now();
  setTimeout(() => {
    revealing = false;
    if (!running) return;           // paused out, or the run ended meanwhile
    t0 += Date.now() - heldAt;
    clearDrift();
    /* The wrong region goes back on the table. It was never asked for, and
       leaving it red would mark the map with regions that are still to come —
       counting mode clears them at the end of a turn for the same reason, and
       here the turn ended immediately. The answer stays amber: that one really
       is done with. */
    REGION_NAMES.forEach(m => { if (status(m) === 'missed') setStatus(m, 'open'); });
    if (queue.length === 0) return finish(true, target);
    next();
  }, REVEAL_MS);
}

/* Rounded the way a person would say it: no false precision at 3,000km, no
   uselessly round zero under ten. */
function fmtKm(km) {
  if (km < 10) return km.toFixed(1) + ' km';
  return Math.round(km).toLocaleString() + ' km';
}

