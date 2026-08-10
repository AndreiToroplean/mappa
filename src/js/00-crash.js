/* ---- telling you when something broke -----------------------------------
   A thrown error during startup used to be completely silent: the menu still
   drew, because it is static markup, but nothing was wired up, so every button
   did nothing at all. That is indistinguishable from "the buttons don't work",
   which is a terrible thing to have to debug from a screenshot — especially on
   a browser that cannot be reproduced here.

   This loads first so it catches errors thrown by everything after it. */
function reportCrash(what) {
  try {
    const box = document.getElementById('crash');
    if (!box) return;
    box.textContent = String(what).slice(0, 400);
    box.hidden = false;
  } catch (e) { /* nothing left to try */ }
}

addEventListener('error', e => reportCrash(
  (e.message || 'error') + '  [' + (e.filename || '?').split('/').pop() +
  ':' + (e.lineno || '?') + ']'));

addEventListener('unhandledrejection', e => reportCrash(
  'unhandled promise: ' + ((e.reason && (e.reason.message || e.reason)) || 'unknown')));
