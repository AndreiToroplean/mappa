
/* ---- theme ---------------------------------------------------------------
   Two grounds for the same plate: paper by lamplight and paper in daylight.
   The palettes are in style.css and nothing here knows a colour; this only
   decides which of the two blocks applies, remembers it, and puts back the one
   thing a variable cannot reach.

   Stored in localStorage directly rather than through kvGet/kvSet, which is the
   only preference that does not go through them, for two reasons. It has to be
   readable *synchronously* — the boot script in <head> reads it before the body
   renders, and the kv layer is async by the time it has worked out which
   backend it has. And it is not the player's data: an export carries boards and
   how you like to play, and importing a friend's file should not repaint your
   screen. So it stays out of the transfer entirely, and out of PREF_KEYS.

   That means the theme does not survive where localStorage does not exist. The
   cost of getting it wrong is one tap, so it is not worth a fallback that
   would put the value in two places. */
const THEME_KEY = 'fifty:theme';   // also in the boot script in <head>

const themeNow = () =>
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
const otherTheme = () => themeNow() === 'dark' ? 'light' : 'dark';

/* The phone's own chrome, which is the one surface the stylesheet cannot paint
   and the one most obviously wrong when it disagrees. Read off --base rather
   than named here, so the palette stays the only place a colour is written. */
function paintChrome() {
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) {
    m = document.createElement('meta');
    m.name = 'theme-color';
    document.head.appendChild(m);
  }
  m.content = getComputedStyle(document.documentElement)
    .getPropertyValue('--base').trim();
}

function drawThemeButton() {
  const next = otherTheme();
  const label = next === 'light' ? 'Light theme' : 'Dark theme';
  document.querySelectorAll('.themebtn').forEach(b => {
    b.title = label;
    b.setAttribute('aria-label', label);
  });
}

function setTheme(name) {
  document.documentElement.dataset.theme = name;
  drawThemeButton();
  paintChrome();
  /* Scored regions wear their colour inline, so the new palette does not reach
     them. Everything else on the map is a variable and repaints itself. */
  repaintScores();
}

document.querySelectorAll('.themebtn').forEach(b => b.addEventListener('click', () => {
  const next = otherTheme();
  setTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* nothing to do */ }
}));

drawThemeButton();
paintChrome();
