// game state
let queue, current, errors, found, t0, raf, running;

/* Errors are the thing that is counted; lives are a rule about them. Tracking
   lives directly would leave practice mode — unlimited lives, ranked on errors
   — with nothing to count. */
const livesLeft = () => MODE.lives - errors;
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

/* The same header column either way: lives left when they are countable,
   misses taken when they are not. */
function drawCounter() {
  el.counterLabel.textContent = MODE.counter;
  if (!Number.isFinite(MODE.lives)) {
    el.missCount.textContent = errors;
    el.missCount.classList.toggle('bad', errors > 0);
    return;
  }
  el.lives.innerHTML = Array.from({ length: MODE.lives }, (_, i) =>
    `<div class="pip${i < livesLeft() ? '' : ' gone'}"></div>`).join('');
  if (livesLeft() === 0) document.querySelector('.pip').classList.add('lastgone');
}

function resetRun() {
  queue = REGION_NAMES.slice();
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  errors = 0; found = 0; running = false;
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
  ticker.textContent = MODE.hint();
  overlay.hidden = true;
  el.intro.hidden = true;
}

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

function guess(name) {
  if (!running || paused || !selectable(name)) return;

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
  } else {
    setStatus(name, 'missed');
    flashMiss(name);
    if (MODE.clues) missed(name);   // opens the arrow rung; drawn only on request
    errors++;
    drawCounter();
    ticker.innerHTML = `<span class="no">Miss</span> — that was <b>${name}</b>`;
    if (livesLeft() === 0) finish(false, name);
  }
}

