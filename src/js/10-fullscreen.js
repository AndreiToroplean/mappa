
/* ---- full screen ---------------------------------------------------------
   The address bar and status bar cost real map on a phone, and there is no way
   to hide them from CSS: the Fullscreen API is the only lever, and it will only
   fire from a user gesture. So it is a button, and the preference is remembered
   so that starting a run can re-enter full screen on the tap that starts it —
   also a gesture, which is what makes that legal.

   Android Chrome supports this. iOS Safari does not on iPhone, so the button
   hides itself rather than sitting there doing nothing. For a permanent fix on
   either, "Add to Home screen" runs the page without browser chrome at all. */
const root = document.documentElement;
const canFull = !!(root.requestFullscreen || root.webkitRequestFullscreen);
let wantFull = false;

function isFull() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function enterFull() {
  try {
    await (root.requestFullscreen ? root.requestFullscreen()
                                  : root.webkitRequestFullscreen());
  } catch (e) { /* refused: nothing to do but carry on windowed */ }
}

async function exitFull() {
  try {
    if (isFull()) await (document.exitFullscreen ? document.exitFullscreen()
                                                : document.webkitExitFullscreen());
  } catch (e) {}
}

function drawFsButton() {
  if (!el.fsBtn) return;
  el.fsBtn.hidden = !canFull;
  el.fsBtn.textContent = isFull() ? 'Leave full screen' : 'Full screen';
}

if (el.fsBtn && canFull) {
  el.fsBtn.addEventListener('click', async () => {
    if (isFull()) { wantFull = false; await exitFull(); }
    else { wantFull = true; await enterFull(); }
    await kvSet(PREF_FULL, wantFull ? '1' : '');
    drawFsButton();
  });
}
addEventListener('fullscreenchange', drawFsButton);
addEventListener('webkitfullscreenchange', drawFsButton);

// starting a run is a gesture, so it is a chance to honour the preference
if (el.startBtn && canFull) {
  el.startBtn.addEventListener('click', () => { if (wantFull && !isFull()) enterFull(); });
}
