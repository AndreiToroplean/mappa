// leaderboard: one best time per regions-found tally, many entries at a full set

const PROBE = 'fifty:probe';
const PREF_GEO = 'fifty:geo';
const PREF_MODE = 'fifty:mode';

/* Every geography-and-mode combination keeps its own board. Mixing them would
   be meaningless — a practice run cannot fail, and a departement is not a
   state — and merging would bury one under another.

   The two US keys are the ones written before geographies existed, so they are
   kept verbatim rather than renamed into the scheme. Boards saved by earlier
   versions survive; the cost is this exception. */
const LEGACY_US = { trial: 'fifty:board2', practice: 'fifty:practice1' };
const boardKey = () => GEO.id === 'us' ? LEGACY_US[MODE.id]
                                       : `fifty:${GEO.id}:${MODE.id}`;
const mem = {};   // last resort backend

/* Three backends, tried in order, because the file gets run two very different
   ways. Inside the artifact runtime `window.storage` exists and is scoped per
   artifact instance — scores persist across refreshes but not across a rebuild,
   since a new build is a new instance. Downloaded and opened straight from
   Chrome there is no `window.storage` at all, and that case used to fall
   silently into a memory array that died on every refresh. localStorage covers
   it properly. Memory is the last resort (private mode, storage disabled), and
   it is now *reported* rather than hidden — a leaderboard that quietly forgets
   is worse than one that says it will. */
let store = 'memory';

function localOK() {
  try {
    window.localStorage.setItem(PROBE, '1');
    window.localStorage.removeItem(PROBE);
    return true;
  } catch (e) { return false; }
}

const parse = s => { try { return JSON.parse(s) || []; } catch (e) { return []; } };

/* Boards written before runs counted errors. A run that did not finish ended
   by running out of lives, so its count is known exactly. A completed run's is
   not recoverable, and is left blank rather than invented. */
function normalise(board) {
  if (!Number.isFinite(MODE.lives)) return board;   // nothing to infer
  return board.map(r => (typeof r.e === 'number' || r.f === TOTAL)
    ? r : Object.assign({}, r, { e: MODE.lives }));
}

/* One key-value layer over the three backends. Boards and the saved geography
   both go through it, so the backend logic exists once. */
async function kvGet(key) {
  if (window.storage && window.storage.get) {
    try {
      const r = await window.storage.get(key);
      store = 'artifact';
      return r ? r.value : null;
    } catch (e) {
      // An unset key throws here, which is not the same as a broken backend.
      // Settle it with a write: if that lands, the backend is fine and empty.
      try { await window.storage.set(key, ''); store = 'artifact'; return null; }
      catch (e2) {}
    }
  }
  if (localOK()) {
    store = 'local';
    return window.localStorage.getItem(key);
  }
  store = 'memory';
  return key in mem ? mem[key] : null;
}

async function kvSet(key, value) {
  mem[key] = value;
  if (store === 'artifact') {
    try { await window.storage.set(key, value); return; }
    catch (e) { store = localOK() ? 'local' : 'memory'; }
  }
  if (store === 'local') {
    try { window.localStorage.setItem(key, value); return; }
    catch (e) { store = 'memory'; }          // quota, or permission revoked
  }
}

const loadBoard = async () => normalise(parse(await kvGet(boardKey())));
const saveBoard = b => kvSet(boardKey(), JSON.stringify(b));

const STORE_NOTE = {
  artifact: 'Saved to this copy of the game. A new build starts a fresh board.',
  local:    'Saved in this browser.',
  memory:   "This session only \u2014 these scores won't survive a refresh.",
};
function showNote() {
  document.querySelectorAll('.storenote').forEach(el => {
    el.textContent = STORE_NOTE[store];
    el.classList.toggle('warn', store === 'memory');
  });
}

/* A completed run whose error count predates this feature is ranked as the
   worst a completed run could be — a full run cannot have spent all its lives,
   so the ceiling is one short of them. It can then never outrank a run we know
   was cleaner. Displayed as blank, not as that number. */
const errorsOf = r => typeof r.e === 'number' ? r.e
  : (Number.isFinite(MODE.lives) ? MODE.lives - 1 : Infinity);
const cluesOf = r => typeof r.c === 'number' ? r.c : 0;

/* The one definition of "better": more found first, then fewer errors, then
   quicker. It serves both modes unchanged — every practice run is a completed
   set, so the first term is always a tie there and the ordering falls through
   to misses, then time, which is exactly what practice wants. */
/* Misses and clues are both help, so they add: "least help, then quickest" is
   one sentence, and both numbers are shown so a row can still be read. Ranking
   misses ahead of clues instead would make clues nearly free, which defeats
   counting them. Trial has no clues, so there the sum is just the misses. */
const helpOf = r => errorsOf(r) + cluesOf(r);
const better = (a, c) => c.f - a.f || helpOf(a) - helpOf(c) || a.t - c.t;
const rankBoard = b => b.sort(better);

const addEntry = (board, entry) => MODE.insert(board, entry);

/* Both cards show the same board, so they are always painted together. Three
   call sites used to render one or both with slightly different arguments. */
function showBoards(board, mine) {
  renderBoard(el.introBoard, board, mine);
  renderBoard(el.boardList, board, mine);
  showNote();
}

/* A bare count with a symbol read as "1x", which means nothing unless you
   already know the column is errors. Spell it out instead, and let a clean run
   say so — zero is the whole point of the ranking, so it should read as an
   achievement rather than as the number below one. */
function missWords(e) {
  if (typeof e !== 'number') return '—';
  if (e === 0) return 'Perfect';
  return `${e} miss${e === 1 ? '' : 'es'}`;
}

/* Classic rows lead with how far you got and carry the misses alongside.
   Every practice run is a completed set, so leading with "All fifty" on every
   row would say nothing — misses become the headline instead. */
function rowParts(r) {
  const words = missWords(r.e);
  if (MODE.id === 'practice') {
    const c = cluesOf(r);
    return {
      tier: r.e === 0 && c === 0 ? 'full' : 'partial',
      tally: words,
      errs: `<span class="errs${c ? '' : ' perfect'}">${c} clue${c === 1 ? '' : 's'}</span>`,
    };
  }
  const cls = typeof r.e !== 'number' ? ' unknown' : r.e === 0 ? ' perfect' : '';
  return {
    tier: r.f === TOTAL ? 'full' : 'partial',
    // "31 of 101" rather than "31 départements": the noun does not fit the
    // row on a phone, and the total is the more useful half anyway
    tally: r.f === TOTAL ? GEO.all : `${r.f} of ${TOTAL}`,
    errs: `<span class="errs${cls}">${words}</span>`,
  };
}

function renderBoard(target, board, mine) {
  const rows = rankBoard(board.slice()).slice(0, 6);
  target.innerHTML = rows.length
    ? rows.map((r, i) => {
        const p = rowParts(r);
        const you = mine && r.d === mine ? ' you' : '';
        return `<div class="row ${p.tier}${you}">
            <span class="rank">${String(i + 1).padStart(2, '0')}</span>
            <span class="tally">${p.tally}</span>
            ${p.errs}
            <span class="time">${fmt(r.t)}</span>
          </div>`;
      }).join('')
    : `<div class="empty">${MODE.empty}</div>`;
}

async function finish(won, lastClick) {
  running = false;
  document.body.classList.remove('playing');
  closeLens(false);
  cancelAnimationFrame(raf);
  const ms = Date.now() - t0;

  const endedAt = Date.now();
  let pause;
  if (won) {
    ticker.innerHTML = `<span class="ok">Correct</span> — <b>${lastClick}</b>. That's ${GEO.all.toLowerCase()}.`;
    // say it in the header too, so a win reads as a win the instant it lands
    el.bar.classList.add('won');
    el.promptLabel.textContent = 'Complete';
    el.target.textContent = GEO.all;
    el.target.classList.add('won');
    clock.classList.add('won');
    pause = celebrate(errors === 0 ? 'Perfect run' : GEO.all);
  } else {
    el.bar.classList.add('lost');
    el.promptLabel.textContent = 'Run over';
    el.target.textContent = 'Out of lives';
    el.target.classList.add('lost');
    clock.classList.add('lost');
    setStatus(current, 'answer');
    ticker.innerHTML = `<span class="no">Miss</span> — that was <b>${lastClick}</b>. ` +
                       `Out of lives; you were looking for <b>${current}</b>.`;
    pause = 2600;   // time to read the miss and see the real answer
  }

  el.ovTitle.textContent = !won ? 'Out of lives.'
    : errors === 0 ? 'Perfect run.' : GEO.all + '.';
  el.ovSub.textContent =
    won ? `Complete in ${fmt(ms)} · ${errors} ${errors === 1 ? 'miss' : 'misses'}`
        : `${found} of ${TOTAL} found · ${fmt(ms)}`;

  const entry = { f: found, e: errors, c: cluesUsed, t: ms, d: Date.now() };
  const res = addEntry(await loadBoard(), entry);
  if (res.kept) await saveBoard(res.board);
  showBoards(res.board, res.kept ? entry.d : null);

  const remaining = Math.max(0, pause - (Date.now() - endedAt));
  setTimeout(() => { overlay.hidden = false; }, remaining);
}

/* Clearing matters more than it looks: every downloaded copy of the game
   shares one localStorage bucket, because Chrome treats all file:// pages as a
   single origin. Renaming or moving the file does not give you a fresh board,
   so this is the only way to get one. */
async function clearBoard() {
  await saveBoard([]);      // whichever backend is live already knows how
  showBoards([], null);
}

const confirmBox = el.confirm;
document.querySelectorAll('.clearBtn').forEach(b =>
  b.addEventListener('click', () => { confirmBox.hidden = false; }));
el.clearNo.addEventListener('click',
  () => { confirmBox.hidden = true; });
el.clearYes.addEventListener('click', async () => {
  await clearBoard();
  confirmBox.hidden = true;
});
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !confirmBox.hidden) confirmBox.hidden = true;
});

/* Switching mode swaps the board and the selected button, and is available from
   both cards so a run can be followed by a different kind of run without a
   reload. */
async function setMode(id) {
  if (!GEO || !MODES[id]) return;    // a tap can land before startup finishes
  MODE = MODES[id];
  await kvSet(PREF_MODE, id);
  refreshCopy();
  try { showBoards(await loadBoard(), null); }
  catch (e) { reportCrash('board: ' + e.message); }
}

/* Everything on the two cards that depends on which geography or mode is live.
   Kept in one place because these strings drifted out of step otherwise. */
function refreshCopy() {
  // The selected mode is part of the copy: it used to be set only by setMode(),
  // so on a fresh load no button looked selected at all.
  document.querySelectorAll('.modeBtn').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === MODE.id));
  document.querySelectorAll('.clearLabel').forEach(n => {
    n.textContent = `${GEO.label.split(' — ')[0]} · ${MODE.label}`;
  });
  document.querySelectorAll('.geoSub').forEach(n => { n.textContent = GEO.sub; });
  document.querySelectorAll('.geoNoun').forEach(n => { n.textContent = GEO.noun; });
  document.querySelectorAll('.geoSel').forEach(s => { s.value = GEO.id; });
  /* "Alpes-de-Haute-Provence" is 23 characters against "North Carolina"'s 14,
     and the prompt must never ellipsise — that was the first bug reported on a
     phone. Longer names get a smaller prompt rather than a truncated one. */
  const longest = Math.max(...REGION_NAMES.map(n => n.length));
  document.body.classList.toggle('longnames', longest > 16);
}

/* A geography change rebuilds every structure derived from the region set: the
   drawn map, the border index used for hit-testing, and the magnifier's copy of
   the shapes. Anything derived from REGIONS has to be listed here. */
function loadGeography(id) {
  useGeo(id);
  buildMap();
  buildLens();
  compose();      // places the panels and fills in every path
}

/* A resize or rotation changes which arrangement is best, so the layout is
   recomputed. Statuses survive: compose() only rewrites geometry, and the
   classes live on the nodes it is rewriting. */
let composeTimer = null;
addEventListener('resize', () => {
  clearTimeout(composeTimer);
  composeTimer = setTimeout(() => { if (GEO) compose(); }, 120);
});

async function setGeo(id) {
  if (!GEO || !GEOS[id] || id === GEO.id) return;
  loadGeography(id);
  await kvSet(PREF_GEO, id);
  refreshCopy();
  resetRun();                       // repaint the header for the new totals
  el.intro.hidden = false;          // a half-played map must not linger
  overlay.hidden = true;
  showBoards(await loadBoard(), null);
}

document.querySelectorAll('.modeBtn').forEach(b =>
  b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('.geoSel').forEach(s =>
  s.addEventListener('change', () => setGeo(s.value)));

el.again.addEventListener('click', beginRun);
el.startBtn.addEventListener('click', beginRun);

// show any existing best runs on the intro screen
/* Startup. The geography is remembered between visits; the mode is not, since
   Trial is the default reading of "play the game". */
(async () => {
  // The geography is built first and separately from anything that can fail:
  // if reading the saved preference throws, the game should still start, just
  // without remembering the choice.
  let savedGeo = null, savedMode = null;
  try {
    savedGeo = await kvGet(PREF_GEO);
    savedMode = await kvGet(PREF_MODE);
  } catch (e) { reportCrash('storage: ' + e.message); }
  // Both choices are remembered. Trial is the default reading of "play".
  MODE = MODES[savedMode] || MODES.trial;
  drawFsButton();
  loadGeography(GEOS[savedGeo] ? savedGeo : DEFAULT_GEO);
  refreshCopy();
  resetRun();
  el.intro.hidden = false;
  try { showBoards(await loadBoard(), null); } catch (e) { reportCrash('board: ' + e.message); }
})();
