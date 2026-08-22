// leaderboard: one best time per regions-found tally, many entries at a full set

const PROBE = 'fifty:probe';
const PREF_GEO = 'fifty:geo';
const PREF_MODE = 'fifty:mode';
const PREF_SCORING = 'fifty:scoring';

/* Every geography-and-mode combination keeps its own board. Mixing them would
   be meaningless — a practice run cannot fail, and a departement is not a
   state — and merging would bury one under another.

   The two US keys are the ones written before geographies existed, so they are
   kept verbatim rather than renamed into the scheme. Boards saved by earlier
   versions survive; the cost is this exception — and the reason counting stays
   the unsuffixed spelling, since suffixing it would orphan every board anyone
   has. */
const LEGACY_US = { trial: 'fifty:board2', practice: 'fifty:practice1' };
const boardKey = () => SCORING.id !== 'count'
  ? `fifty:${GEO.id}:${MODE.id}:${SCORING.id}`
  : (GEO.id === 'us' ? LEGACY_US[MODE.id] : `fifty:${GEO.id}:${MODE.id}`);
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
  if (!MODE.capped) return board;                   // nothing to infer
  return board.map(r => (typeof r.e === 'number' || r.f === TOTAL)
    ? r : Object.assign({}, r, { e: budget() }));
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
  : (MODE.capped ? budget() - 1 : Infinity);
const cluesOf = r => typeof r.c === 'number' ? r.c : 0;

/* How many regions the run put on the map. Under distance that is every region
   it was asked, right or wrong, and it is what a Trial has to show for itself:
   a run there ends when the purse does, so the achievement is how far the purse
   got you. Practice is asked every region by definition, so it is TOTAL there
   and drops out of the ranking on its own.

   Entries written before the board recorded it fall back to what is known: a
   run revealed at least as many as it found. That under-ranks them rather than
   inventing a number, and the row says so by showing no tally. */
const revealedOf = r => typeof r.v === 'number' ? r.v
  : (MODE.capped ? r.f : TOTAL);
const tallyOf = r => SCORING.id === 'drift' ? revealedOf(r) : r.f;

/* What a run has left of the purse. Negative is a real result in Practice,
   which cannot end early and so can spend past the hundred it started with. */
const pointsOf = r => purse() - errorsOf(r);
const signed = p => (p < 0 ? '\u2212' + Math.abs(p) : String(p));

/* The one definition of "better": more found first, then fewer errors, then
   quicker. It serves both modes unchanged — every practice run is a completed
   set, so the first term is always a tie there and the ordering falls through
   to misses, then time, which is exactly what practice wants. */
/* Misses and clues are both help, so they add: "least help, then quickest" is
   one sentence, and both numbers are shown so a row can still be read. Ranking
   misses ahead of clues instead would make clues nearly free, which defeats
   counting them. Trial has no clues, so there the sum is just the misses. */
/* Under distance scoring they cannot be added: one miss can cost 90 and a clue
   costs 1, so the sum is the distance with rounding noise on top. Clues become
   the tie-break there instead, which keeps them costly enough to think about
   without pretending a clue and half a continent are the same currency. */
const helpOf = r => SCORING.id === 'drift'
  ? errorsOf(r) : errorsOf(r) + cluesOf(r);

/* Distance used to drop the first term entirely, on the grounds that every run
   was asked every region and the tally was the same fact told coarsely. That is
   still true of Practice, and no longer true of Trial: a distance Trial ends
   when the purse runs out, so the regions it revealed are the whole story and
   the points are near enough a constant. tallyOf() reads the right one of the
   two, and in Practice it is TOTAL for every entry and ties out of the way. */
const better = (a, c) => tallyOf(c) - tallyOf(a)
  || helpOf(a) - helpOf(c)
  || (SCORING.id === 'drift' ? cluesOf(a) - cluesOf(c) : 0) || a.t - c.t;
const rankBoard = b => b.sort(better);

const addEntry = (board, entry) => (SCORING.insert || MODE.insert)(board, entry);

/* Both cards show the same board, so they are always painted together. Three
   call sites used to render one or both with slightly different arguments. */
function showBoards(board, mine) {
  renderBoard(el.introBoard, board, mine);
  renderBoard(el.boardList, board, mine);
  showNote();
}

/* One name for each unit. Counting says misses. Distance says points, and says
   what is left rather than what was spent — a run holds a hundred and a miss
   takes from it — abbreviated to "pts" wherever a row has to stay on one line.

   A bare count with a symbol read as "1x", which means nothing unless you
   already know the column is errors. Spell it out instead, and let a clean run
   say so — zero is the whole point of the ranking, so it should read as an
   achievement rather than as the number below one. */
function missWords(e) {
  if (typeof e !== 'number') return '—';
  return e === 0 ? 'Perfect' : `${e} miss${e === 1 ? '' : 'es'}`;
}

const ptWords = p => `${signed(p)} pt${Math.abs(p) === 1 ? '' : 's'}`;

/* Classic rows lead with how far you got and carry the misses alongside.
   Every practice run is a completed set, so leading with "All fifty" on every
   row would say nothing — misses become the headline instead. */
function rowParts(r) {
  const words = missWords(r.e);

  if (SCORING.id === 'drift') {
    const p = pointsOf(r), known = typeof r.e === 'number';
    /* A distance Trial is ranked on how far the purse got, so that is the
       headline and the points left ride alongside — which for a run that ran
       out is nothing much, and for one that finished is the whole story. */
    if (MODE.capped) {
      const v = revealedOf(r), full = v === TOTAL;
      return {
        tier: full ? 'full' : 'partial',
        tally: typeof r.v === 'number' || full
          ? (full ? GEO.all : `${v} of ${TOTAL}`) : '—',
        errs: `<span class="errs${known && p === purse() ? ' perfect' : ''}">`
            + `${known ? ptWords(p) : '—'}</span>`,
      };
    }
    /* Practice reveals everything by definition, so the points are the run.
       They can go under: a hundred is a perfect run, ten is a good one, and
       minus five hundred is a story of its own — worth reading as a loss rather
       than as a small number. */
    const c = cluesOf(r);
    return {
      tier: p === purse() ? 'full' : 'partial',
      tally: p === purse() ? 'Perfect'
        : `<span class="${p < 0 ? 'neg' : ''}">${ptWords(p)}</span>`,
      errs: MODE.clues
        ? `<span class="errs${c ? '' : ' perfect'}">${c} clue${c === 1 ? '' : 's'}</span>`
        : '<span class="errs"></span>',
    };
  }

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
    : '<div class="empty">No runs yet.</div>';
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
    el.target.textContent = SCORING.id === 'drift' ? 'Finished' : tally();
    el.target.classList.add('won');
    clock.classList.add('won');
    pause = celebrate(spent() === 0 ? 'Perfect run'
                    : (!MODE.capped || SCORING.id === 'drift') ? 'Finished'
                    : tally());
  } else {
    el.bar.classList.add('lost');
    el.promptLabel.textContent = 'Run over';
    el.target.textContent = SCORING.id === 'drift' ? 'Out of points' : 'Out of lives';
    el.target.classList.add('lost');
    clock.classList.add('lost');
    setStatus(current, 'answer');
    ticker.innerHTML = `<span class="no">Miss</span> — that was <b>${lastClick}</b>. ` +
      (SCORING.id === 'drift' ? 'Out of points; ' : 'Out of lives; ') +
      `you were looking for <b>${current}</b>.`;
    pause = 2600;   // time to read the miss and see the real answer
  }

  el.ovTitle.textContent = !won
      ? (SCORING.id === 'drift' ? 'Out of points.' : 'Out of lives.')
    : spent() === 0 ? 'Perfect run.'
    : SCORING.id === 'drift' ? 'Finished.' : tally() + '.';
  /* A distance run that ran out is described by how far it got — that is the
     number its board ranks on. One that finished is described by what it has
     left, which is the number its board ranks on instead. */
  el.ovSub.textContent = !won
      ? (SCORING.id === 'drift'
          ? `${revealed} of ${TOTAL} revealed · ${fmt(ms)}`
          : `${found} of ${TOTAL} found · ${fmt(ms)}`)
    : SCORING.id === 'drift'
      ? `${ptWords(points())}${MODE.capped ? ' left' : ''} · ${fmt(ms)}`
      : `Complete in ${fmt(ms)} · ${missWords(spent()).toLowerCase()}`;

  const entry = { f: found, v: revealed, e: spent(), c: cluesUsed, t: ms,
                  d: Date.now() };
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
  await afterSwitch();
}

/* The scoring axis switches exactly like the mode axis, and for the same
   reason: both change which board is being looked at and nothing else. */
async function setScoring(id) {
  if (!GEO || !SCORINGS[id]) return;
  SCORING = SCORINGS[id];
  await kvSet(PREF_SCORING, id);
  await afterSwitch();
}

async function afterSwitch() {
  refreshCopy();
  /* drawCounter(), not resetRun(): resetRun() ends by hiding the intro card,
     which is right when a geography change invalidates a half-played map and
     wrong here — tapping a switch on the menu made the game appear to start.
     Nothing about the board needs resetting, only the header column, which is
     counting a different thing now. */
  drawCounter();
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
  document.querySelectorAll('.scoreBtn').forEach(b =>
    b.classList.toggle('on', b.dataset.score === SCORING.id));
  document.querySelectorAll('.clearLabel').forEach(n => {
    n.textContent = `${GEO.label.split(' — ')[0]} · ${MODE.label} · ${SCORING.label}`;
  });
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
document.querySelectorAll('.scoreBtn').forEach(b =>
  b.addEventListener('click', () => setScoring(b.dataset.score)));
document.querySelectorAll('.geoSel').forEach(s =>
  s.addEventListener('change', () => setGeo(s.value)));

el.again.addEventListener('click', beginRun);
el.startBtn.addEventListener('click', beginRun);
/* Play again repeats the run you just had; this is the way out of it, for
   changing geography and coming back to a fresh Start rather than dropping
   straight into another countdown. It is the pause card's exit reused, which
   already resets the run and puts the intro up — the end card and the pause
   card are leaving the same thing. */
if (el.menuBtn) el.menuBtn.addEventListener('click', quitToMenu);

// show any existing best runs on the intro screen
/* Startup. The geography is remembered between visits; the mode is not, since
   Trial is the default reading of "play the game". */
(async () => {
  // The geography is built first and separately from anything that can fail:
  // if reading the saved preference throws, the game should still start, just
  // without remembering the choice.
  let savedGeo = null, savedMode = null, savedScoring = null;
  try {
    savedGeo = await kvGet(PREF_GEO);
    savedMode = await kvGet(PREF_MODE);
    savedScoring = await kvGet(PREF_SCORING);
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
  try { showBoards(await loadBoard(), null); } catch (e) { reportCrash('board: ' + e.message); }
})();
