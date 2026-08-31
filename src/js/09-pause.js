
/* ---- pausing --------------------------------------------------------------
   The clock stops. The map stays up: the pause card is the same construction as
   the menu — a card on a dimming layer with the whole board underneath it — and
   a paused run that shows you no run is a different screen rather than the same
   one held still.

   The clock is derived from t0 rather than accumulated, so resuming only has to
   push t0 forward by however long the pause lasted.

   A count can be paused too, which is worth saying because it is the one case
   where resuming does not resume. Wanting to stop before the first prompt is a
   real thing to want — you pressed Start and then the phone rang — but being
   counted at a second time is not what anyone is asking for, so the rest of the
   count is dropped and the run simply begins. */
let paused = false;
let pausedAt = 0;

function pauseRun() {
  const counting = document.body.classList.contains('counting');
  if ((!running && !counting) || paused) return;
  paused = true;
  /* Hold the count where it is. countFinish stays set, which is also how
     resumeRun() knows this was a pause during a count rather than during play. */
  if (counting) clearTimeout(countTimer);
  pausedAt = Date.now();
  cancelAnimationFrame(raf);
  clearSplash();
  document.body.classList.add('paused');
  el.paused.hidden = false;
}

function resumeRun() {
  if (!paused) return;
  paused = false;
  document.body.classList.remove('paused');
  el.paused.hidden = true;
  /* Paused before the run had started: there is no clock to give time back to
     and no count worth finishing. Start it. */
  if (countFinish) return countFinish();
  t0 += Date.now() - pausedAt;      // give back exactly the time that was owed
  /* Coming back from a pause, the region being asked for is the one thing you
     have certainly lost track of — it was named before the interruption and
     the middle of the map has been empty since. Say it again. */
  splash({ find: current });
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
  /* A count in flight would otherwise fire into the menu and start a run
     nobody asked for. */
  cancelCount();
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
