
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
(() => {
  // The geography is built separately from anything that can fail: if reading a
  // saved preference throws, the game should still start, just without
  // remembering the choice.
  let savedGeo = null, savedMode = null, savedScoring = null;
  try {
    savedGeo = kvGet(PREF_GEO);
    savedMode = kvGet(PREF_MODE);
    savedScoring = kvGet(PREF_SCORING);
  } catch (e) { reportCrash('storage: ' + e.message); }
  // Every choice is remembered. Trial and counting are the default reading of
  // "play the game".
  MODE = MODES[savedMode] || MODES.trial;
  SCORING = SCORINGS[savedScoring] || SCORINGS.count;
  drawFsButton();
  loadGeography(GEOS[savedGeo] ? savedGeo : DEFAULT_GEO);
  refreshCopy();
  resetRun();
  el.intro.hidden = false;
  try { showBoards(loadBoard(), null); } catch (e) { reportCrash('board: ' + e.message); }
})();
