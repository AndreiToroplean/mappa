
/* ---- full screen ---------------------------------------------------------
   The address bar and status bar cost real map on a phone, and there is no way
   to hide them from CSS: the Fullscreen API is the only lever, and it will only
   fire from a user gesture. So it is a button — an icon on the title line of the
   menu and of the pause card — and it is never entered on the player's behalf.

   Android Chrome supports this. iOS Safari does not on iPhone, so the button
   hides itself rather than sitting there doing nothing. For a permanent fix on
   either, "Add to Home screen" runs the page without browser chrome at all. */
const root = document.documentElement;
const canFull = !!(root.requestFullscreen || root.webkitRequestFullscreen);

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
  document.querySelectorAll('.fsbtn').forEach(b => {
    b.hidden = !canFull;
    b.classList.toggle('on', isFull());
    b.title = isFull() ? 'Leave full screen' : 'Full screen';
  });
}

/* Never entered on the player's behalf. Starting a run is a gesture and could
   legally trigger it, but taking over the whole screen is not something to do
   to someone who only pressed Play. */
document.querySelectorAll('.fsbtn').forEach(b => b.addEventListener('click', async () => {
  if (isFull()) await exitFull();
  else await enterFull();
  drawFsButton();
}));
addEventListener('fullscreenchange', drawFsButton);
addEventListener('webkitfullscreenchange', drawFsButton);
