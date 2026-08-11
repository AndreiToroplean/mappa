
/* ---- pausing --------------------------------------------------------------
   The clock stops and the map is hidden. Hiding it is the whole point: a
   stopped clock over a visible map is just unlimited thinking time, which would
   quietly make every leaderboard entry meaningless.

   The clock is derived from t0 rather than accumulated, so resuming only has to
   push t0 forward by however long the pause lasted. */
let paused = false;
let pausedAt = 0;

function pauseRun() {
  if (!running || paused) return;
  paused = true;
  pausedAt = Date.now();
  cancelAnimationFrame(raf);
  clearFlash();
  document.body.classList.add('paused');
  el.paused.hidden = false;
}

function resumeRun() {
  if (!paused) return;
  t0 += Date.now() - pausedAt;      // give back exactly the time that was owed
  paused = false;
  document.body.classList.remove('paused');
  el.paused.hidden = true;
  tick();
}

/* Leaving a paused run in either direction has to undo the paused state itself,
   or the map stays hidden behind the next screen. */
function leavePause() {
  paused = false;
  document.body.classList.remove('paused');
  el.paused.hidden = true;
}

function quitToMenu() {
  leavePause();
  running = false;
  cancelAnimationFrame(raf);
  document.body.classList.remove('playing');
  resetRun();
  el.intro.hidden = false;
}

if (el.pause) el.pause.addEventListener('click', pauseRun);
if (el.resumeBtn) el.resumeBtn.addEventListener('click', resumeRun);
if (el.restartBtn) el.restartBtn.addEventListener('click', () => { leavePause(); beginRun(); });
if (el.quitBtn) el.quitBtn.addEventListener('click', quitToMenu);
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (paused) resumeRun();
  else if (running) pauseRun();
});
