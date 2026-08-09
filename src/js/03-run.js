// game state
let queue, current, lives, found, t0, raf, running;
/* Every element the game touches, looked up once. These were a mix of cached
   consts and repeated getElementById calls scattered through the code. */
const el = {};
['bar', 'promptLabel', 'target', 'lives', 'progress', 'clock', 'ticker',
 'countdown', 'countNum', 'intro', 'introBoard', 'overlay', 'ovTitle', 'ovSub',
 'boardList', 'confirm', 'again', 'startBtn', 'clearNo', 'clearYes',
].forEach(id => { el[id] = $(id); });

const clock = el.clock, ticker = el.ticker, overlay = el.overlay;

const fmt = ms => {
  const s = ms / 1000;
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
    + '.' + Math.floor((s * 10) % 10);
};

function drawLives() {
  el.lives.innerHTML =
    [0,1,2].map(i => `<div class="pip${i < lives ? '' : ' gone'}"></div>`).join('');
  if (lives === 0) document.querySelector('.pip').classList.add('lastgone');
}

function resetRun() {
  queue = REGION_NAMES.slice();
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  lives = 3; found = 0; running = false;
  REGION_NAMES.forEach(name => setStatus(name, 'open'));
  drawLives();
  el.bar.classList.remove('lost');
  el.target.classList.remove('lost');
  clock.classList.remove('lost');
  el.promptLabel.textContent = 'Find this state';
  el.progress.textContent = '0/50';
  el.target.textContent = 'Get ready';
  clock.textContent = '0:00.0';
  ticker.textContent = 'Click the state named above, or press and hold to zoom. Three misses ends the run.';
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
}

function guess(name) {
  if (!running || !selectable(name)) return;

  if (name === current) {
    setStatus(name, 'found');
    // the turn is over: clear this turn's misses, they count again next time
    REGION_NAMES.forEach(m => { if (status(m) === 'missed') setStatus(m, 'open'); });
    found++;
    el.progress.textContent = found + '/50';
    ticker.innerHTML = `<span class="ok">Correct</span> — <b>${name}</b>`;
    if (queue.length === 0) return finish(true, name);
    next();
  } else {
    setStatus(name, 'missed');
    lives--;
    drawLives();
    ticker.innerHTML = `<span class="no">Miss</span> — that was <b>${name}</b>`;
    if (lives === 0) finish(false, name);
  }
}

