
/* ---- theme ---------------------------------------------------------------
   Two grounds for the same plate: paper by lamplight and paper in daylight.
   The palettes are in style.css and nothing here knows a colour; this only
   decides which of the two blocks applies, remembers it, and puts back the one
   thing a variable cannot reach.

   Saved like every other preference, through kvGet/kvSet and inside PREF_KEYS,
   so it travels with an export. An export is how you move a phone's data to a
   laptop, and which theme you play in is part of how you play — leaving it
   behind would mean arriving somewhere with your leaderboard and none of your
   settings. Nothing in the UI says so, because nothing needs to: everything is
   exported.

   The one thing it still does differently is being read twice. The boot script
   in <head> reads the same key straight out of localStorage before the body
   renders, because a theme applied by module 12 is a theme applied one frame
   too late and a light-theme player would see a flash of the dark one on every
   load. check.py holds the two spellings of the key together. */
const THEMES = { dark: 1, light: 1 };

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
  if (!THEMES[name]) return;
  document.documentElement.dataset.theme = name;
  kvSet(PREF_THEME, name);
  drawThemeButton();
  paintChrome();
  /* Scored regions wear their colour inline, so the new palette does not reach
     them. Everything else on the map is a variable and repaints itself. */
  repaintScores();
}

document.querySelectorAll('.themebtn').forEach(b =>
  b.addEventListener('click', () => setTheme(otherTheme())));

drawThemeButton();
paintChrome();
