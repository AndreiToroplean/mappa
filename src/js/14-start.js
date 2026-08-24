
/* ---- starting up ---------------------------------------------------------
   The last module, and it has to be: this reads across nearly everything else
   — the geography from 02, the run from 03, the boards from 06, the full screen
   button from 10 — and the rule for the whole file is that a module may only
   use ones loaded before it.

   It used to sit at the bottom of 06-board.js as an async IIFE, and that was
   only ever working by accident. Its first statement awaited a stored
   preference, which yielded, which let modules 07 to 13 finish loading before
   the rest of it ran — so `drawFsButton()`, four modules further down the file,
   happened to be defined by the time it was called. Taking the promise out of
   storage took that yield away with it, and the whole startup ran at module
   06's position instead, against a full screen button that did not exist yet.

   So it lives here, where the dependency is honest rather than accidental. */

/* ---- a link that says what to play ---------------------------------------
   ?map=fr&mode=practice&scoring=drift&theme=light

   Four optional parameters, one per preference, so a link can hand someone the
   exact game you meant them to play rather than the menu and an instruction.
   Any subset works; anything else in the query is left alone.

   The values are the ones storage uses, not the ones the buttons show. That is
   the export's rule, kept for the export's reason: a second, prettier
   vocabulary is a second thing to keep in step, and it rots the first time an
   axis gains an option. The cost is that Test is spelled `trial` here, which is
   the id its boards were saved under and cannot move.

   A parameter is treated as a choice the player just made. It is written to
   storage *before* anything reads it, so the rest of startup cannot tell a link
   from a tap on the menu, and nothing here has a second copy of what setMode()
   and friends do. It sticks, too: follow a practice link once and practice is
   what the game opens in tomorrow, which is what "as if they had chosen it"
   has to mean if it means anything.

   The theme is the exception, and for the reason it is always the exception —
   applying it here would be a frame too late and a light-theme link would flash
   dark. The boot script in <head> reads the same parameter before the body
   renders. check.py holds the two spellings together, as it already does for
   the storage key.

   Then the parameters are taken out of the address bar. Once saved they are
   preferences like any other, and one left in the URL would quietly win again
   on every reload — the link would keep overriding the person's own choices
   long after they had made them. */
const LINK_PARAMS = {
  map: PREF_GEO, mode: PREF_MODE, scoring: PREF_SCORING, theme: PREF_THEME,
};

function applyLink() {
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return; }

  let seen = false;
  for (const param in LINK_PARAMS) {
    const value = q.get(param);
    if (value === null) continue;
    // Consumed either way: a parameter the game cannot honour is still a
    // parameter, and leaving the bad one in the bar to be retried on every
    // reload helps nobody.
    seen = true;
    q.delete(param);
    if (prefLegal(LINK_PARAMS[param], value)) kvSet(LINK_PARAMS[param], value);
  }
  if (!seen) return;

  const rest = q.toString();
  try {
    history.replaceState(null, '',
      location.pathname + (rest ? '?' + rest : '') + location.hash);
  } catch (e) {
    /* A file:// page will not rewrite its own URL. Nothing downstream reads
       the query again, so the address bar is simply left as it was. */
  }
}

(() => {
  applyLink();
  // The geography is built separately from anything that can fail: if reading a
  // saved preference throws, the game should still start, just without
  // remembering the choice.
  let savedGeo = null, savedMode = null, savedScoring = null;
  try {
    savedGeo = kvGet(PREF_GEO);
    savedMode = kvGet(PREF_MODE);
    savedScoring = kvGet(PREF_SCORING);
  } catch (e) { reportCrash('storage: ' + e.message); }
  /* localStorage is the player's to edit, so what comes back out of it is
     checked the same way an imported file is. */
  if (!prefLegal(PREF_GEO, savedGeo)) savedGeo = null;
  if (!prefLegal(PREF_MODE, savedMode)) savedMode = null;
  if (!prefLegal(PREF_SCORING, savedScoring)) savedScoring = null;
  // Every choice is remembered. Trial and counting are the default reading of
  // "play the game".
  MODE = MODES[savedMode] || MODES.trial;
  SCORING = SCORINGS[savedScoring] || SCORINGS.count;
  drawFsButton();
  loadGeography(savedGeo || DEFAULT_GEO);
  refreshCopy();
  resetRun();
  el.intro.hidden = false;
  try { showBoards(loadBoard(), null); } catch (e) { reportCrash('board: ' + e.message); }
})();
