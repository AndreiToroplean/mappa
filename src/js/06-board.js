// leaderboard: one best time per regions-found tally, many entries at a full set

const PROBE = 'fifty:probe';
const PREF_GEO = 'fifty:geo';
const PREF_MODE = 'fifty:mode';
const PREF_SCORING = 'fifty:scoring';
const PREF_THEME = 'fifty:theme';   // also read by the boot script in <head>

/* Every geography-and-mode combination keeps its own board. Mixing them would
   be meaningless — a practice run cannot fail, and a departement is not a
   state — and merging would bury one under another.

   The two US keys are the ones written before geographies existed, so they are
   kept verbatim rather than renamed into the scheme. Boards saved by earlier
   versions survive; the cost is this exception — and the reason counting stays
   the unsuffixed spelling, since suffixing it would orphan every board anyone
   has. */
const LEGACY_US = { trial: 'fifty:board2', practice: 'fifty:practice1' };
/* Taking the axes as arguments rather than reading the live ones, so the export
   can walk every key the game could ever have written without a second copy of
   the scheme — legacy spellings and all. */
const keyFor = (geo, mode, scoring) => scoring !== 'count'
  ? `fifty:${geo}:${mode}:${scoring}`
  : (geo === 'us' ? LEGACY_US[mode] : `fifty:${geo}:${mode}`);
const boardKey = () => keyFor(GEO.id, MODE.id, SCORING.id);

const PREF_KEYS = [PREF_GEO, PREF_MODE, PREF_SCORING, PREF_THEME];

/* What each preference is: the values it may take, and the one in force. Asked
   by everything that takes a preference from outside the game or hands one
   back out — an imported file, a link read, a link written — so there is one
   answer rather than one per door.

   Functions rather than values because THEMES and themeNow() are declared in
   module 12 and this is module 06; nothing calls them until the whole file has
   loaded. */
const PREFS = {
  [PREF_GEO]:     { values: () => GEOS,     now: () => GEO && GEO.id },
  [PREF_MODE]:    { values: () => MODES,    now: () => MODE.id },
  [PREF_SCORING]: { values: () => SCORINGS, now: () => SCORING.id },
  [PREF_THEME]:   { values: () => THEMES,   now: () => themeNow() },
};

/* hasOwnProperty rather than `table[value]`, because `constructor` is a
   property of every object in JavaScript: a plain lookup says yes to
   `MODES['constructor']` and would hand the game the Object constructor as a
   mode. Nothing normal sends that, which is exactly why it would be found
   late. */
function prefLegal(key, value) {
  const pref = PREFS[key];
  return !!pref && typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(pref.values(), value);
}

function boardKeys() {
  const keys = [];
  for (const g in GEOS) for (const m in MODES) for (const s in SCORINGS) {
    keys.push(keyFor(g, m, s));
  }
  return keys;
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

/* localStorage, and nothing else.

   There were three backends tried in order: `window.storage` for the artifact
   runtime, localStorage for a downloaded file, and a plain object as a last
   resort. Two of them have gone. The game is published as a page, so nothing
   reaches the artifact runtime any more; and the memory object was a fallback
   that quietly disagreed with the note under the board about what "saved"
   meant — it kept a leaderboard alive for exactly as long as the tab.

   What is left is *synchronous*, which is worth more than it sounds. Every read
   and write in the game used to return a promise, so eight functions that do no
   waiting were async, and the boot sequence had to await three reads before it
   could draw a menu. All of that is gone with the backends.

   The one thing that can still go wrong is a browser that refuses to store at
   all — private mode with site data blocked, or a full quota. That is reported
   rather than worked around: a leaderboard that quietly forgets is worse than
   one that says up front that it will. */
let saves = (() => {
  try {
    window.localStorage.setItem(PROBE, '1');
    window.localStorage.removeItem(PROBE);
    return true;
  } catch (e) { return false; }
})();

function kvGet(key) {
  try { return window.localStorage.getItem(key); }
  catch (e) { saves = false; return null; }
}

/* Permission can be withdrawn and a quota can fill mid-session, so a write that
   fails says so on the spot rather than waiting for the next page load. */
function kvSet(key, value) {
  try { window.localStorage.setItem(key, value); }
  catch (e) { saves = false; showNote(); }
}

const loadBoard = () => normalise(parse(kvGet(boardKey())));
const saveBoard = b => kvSet(boardKey(), JSON.stringify(b));

const STORE_NOTE = {
  yes: 'Saved in this browser.',
  no: "Not saved \u2014 this browser will not let the game store anything.",
};
function showNote() {
  document.querySelectorAll('.storenote').forEach(el => {
    el.textContent = saves ? STORE_NOTE.yes : STORE_NOTE.no;
    el.classList.toggle('warn', !saves);
  });
}

/* The line under the board already exists to say something true about where the
   scores live, which makes it the right place to say what just happened to
   them. It goes back to saying the usual thing on its own. */
let noteTimer = null;
function flashNote(msg, bad) {
  clearTimeout(noteTimer);
  document.querySelectorAll('.storenote').forEach(el => {
    el.textContent = msg;
    el.classList.toggle('warn', !!bad);
  });
  noteTimer = setTimeout(showNote, 7000);
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
        /* The same two words a counting trial uses, in the same two columns.
           Complete is about the map — every region revealed — and Perfect is
           about the score, so the best run either scoring can post reads
           "Complete · Perfect" and the boards can be read against each other.
           "All fifty" was here before, and only ever fitted one board. */
        tally: typeof r.v === 'number' || full
          ? (full ? 'Complete' : `${v} of ${TOTAL}`) : '—',
        /* What it had left, when it had any. A run that reached the bottom of
           the purse is described by that rather than by a zero: nothing was
           left, and the number stopped being the point the moment it ran out. */
        errs: `<span class="errs${known && p === purse() ? ' perfect' : ''}">`
            + `${!known ? '—' : p === purse() ? 'Perfect'
                          : p > 0 ? ptWords(p) : 'Ran out'}</span>`,
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
    // row on a phone, and the total is the more useful half anyway.
    // Complete rather than Perfect for a full set, because a counting run can
    // be one and not the other — the column beside it says "2 misses".
    tally: r.f === TOTAL ? 'Complete' : `${r.f} of ${TOTAL}`,
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

function finish(won, lastClick) {
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

  /* Capped runs store the spend clamped to what there was to spend. A trial
     that overshot on its last miss is not a worse run than one that landed
     exactly on zero — both ran out — and leaving the overshoot in would rank
     them apart on a number neither player could feel. */
  const e = MODE.capped ? Math.min(spent(), purse()) : spent();
  const entry = { f: found, v: revealed, e: e, c: cluesUsed, t: ms,
                  d: Date.now() };
  const res = addEntry(loadBoard(), entry);
  if (res.kept) saveBoard(res.board);
  showBoards(res.board, res.kept ? entry.d : null);

  const remaining = Math.max(0, pause - (Date.now() - endedAt));
  setTimeout(() => { overlay.hidden = false; }, remaining);
}

/* Clearing matters more than it looks: every downloaded copy of the game
   shares one localStorage bucket, because Chrome treats all file:// pages as a
   single origin. Renaming or moving the file does not give you a fresh board,
   so this is the only way to get one. */
function clearBoard() {
  saveBoard([]);
  showBoards([], null);
}

const confirmBox = el.confirm;
document.querySelectorAll('.clearBtn').forEach(b =>
  b.addEventListener('click', () => { confirmBox.hidden = false; }));
el.clearNo.addEventListener('click',
  () => { confirmBox.hidden = true; });
el.clearYes.addEventListener('click', () => {
  clearBoard();
  confirmBox.hidden = true;
});
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !confirmBox.hidden) confirmBox.hidden = true;
});

/* Switching mode swaps the board and the selected button, and is available from
   both cards so a run can be followed by a different kind of run without a
   reload. */
function setMode(id) {
  if (!GEO || !MODES[id]) return;    // a tap can land before startup finishes
  MODE = MODES[id];
  kvSet(PREF_MODE, id);
  afterSwitch();
}

/* The scoring axis switches exactly like the mode axis, and for the same
   reason: both change which board is being looked at and nothing else. */
function setScoring(id) {
  if (!GEO || !SCORINGS[id]) return;
  SCORING = SCORINGS[id];
  kvSet(PREF_SCORING, id);
  afterSwitch();
}

function afterSwitch() {
  refreshCopy();
  /* drawCounter(), not resetRun(): resetRun() ends by hiding the intro card,
     which is right when a geography change invalidates a half-played map and
     wrong here — tapping a switch on the menu made the game appear to start.
     Nothing about the board needs resetting, only the header column, which is
     counting a different thing now. */
  drawCounter();
  try { showBoards(loadBoard(), null); }
  catch (e) { reportCrash('board: ' + e.message); }
}

/* Everything on the two cards that depends on which geography or mode is live.
   Kept in one place because these strings drifted out of step otherwise. */
/* What a map is: how many places are in it, and what you are asked to do with
   them. Built rather than written down per geography, so a new map needs a noun
   and nothing else. */
const mapNote = () =>
  `${TOTAL} ${GEO.plural}. You'll be named one \u2014 tap it on the map.`;

/* Said once, at the bottom of the screen, then gone.

   These lines used to sit permanently under each row of buttons, which spent
   four lines of card height forever on a question that is asked once and then
   never again. The card is the one part of the game short of room, so the
   answer moved to the moment it is wanted: the tap that raises the question. */
let tipTimer = null;

/* px of clear ground between the tip and the button it must not cover, and px
   the tip is held inside the card's edge on either side. */
const TIP_GAP = 12;
const TIP_INSET = 16;
const TIP_REST = 26;      // where it sits when there is no button to clear

/* The tip used to be parked TIP_REST off the bottom of the window, which on the
   menu is exactly where Start is. It was tappable through — the tip is not in
   hit testing — but a button you cannot see is a button you do not press, and
   the tap that raises a tip is nearly always the tap before Start.

   So it is measured against the card instead: it rests above the card's own
   action, and is no wider than the card minus an inset, which is what makes it
   read as part of that card rather than as a band across the window. Measured
   when it is shown rather than written into the stylesheet, because how tall
   the card is — and so where its button lands — depends on the geography, the
   board and the window. */
function placeTip() {
  const card = document.querySelector('.overlay:not([hidden]) .card');
  if (!card) return;
  const box = card.getBoundingClientRect();
  /* The card's own action: Start, Play Again, Resume. Direct children only, so
     the icon buttons in the header and the quiet pair inside a .btnrow are not
     mistaken for it. */
  const btn = card.querySelector(':scope > button:not(.ghost)');
  const top = btn ? btn.getBoundingClientRect().top : Infinity;
  el.tip.style.setProperty('--tipwide',
    Math.max(0, Math.round(box.width - TIP_INSET * 2)) + 'px');
  /* Never lower than it used to sit: if the button has scrolled off the bottom
     of the window there is nothing down there left to cover. */
  el.tip.style.setProperty('--tipbottom',
    Math.max(TIP_REST, Math.round(innerHeight - top + TIP_GAP)) + 'px');
}

function showTip(text) {
  if (!el.tip || !text) return;
  const span = el.tip.firstElementChild;
  clearTimeout(tipTimer);
  el.tip.hidden = true;
  span.textContent = text;
  placeTip();
  // restart the animation rather than letting a second tap ride the first
  void el.tip.offsetWidth;
  el.tip.hidden = false;
  tipTimer = setTimeout(hideTip, 3800);
}

/* Gone now rather than at the end of its own timer. What it is explaining is a
   choice about the run that is starting, so the moment the run starts it is
   answering a question nobody is still asking — and it would otherwise ride
   over the countdown. */
function hideTip() {
  clearTimeout(tipTimer);
  if (el.tip) el.tip.hidden = true;
}

function refreshCopy() {
  // The selected mode is part of the copy: it used to be set only by setMode(),
  // so on a fresh load no button looked selected at all.
  document.querySelectorAll('.modeBtn').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === MODE.id));
  document.querySelectorAll('.scoreBtn').forEach(b =>
    b.classList.toggle('on', b.dataset.score === SCORING.id));
  /* The same sentence the tip shows, parked on the control for a pointer to
     find. A button's own line, not the selected one's: hovering Practice while
     Test is on should say what Practice would do. */
  document.querySelectorAll('.modeBtn').forEach(b => { b.title = MODES[b.dataset.mode].note; });
  document.querySelectorAll('.scoreBtn').forEach(b => { b.title = SCORINGS[b.dataset.score].note; });
  document.querySelectorAll('.geoSel').forEach(b => { b.title = mapNote(); });
  document.querySelectorAll('.geoMenu button').forEach(b => {
    b.title = GEOS[b.dataset.geo].note;
    b.classList.toggle('on', b.dataset.geo === GEO.id);
  });
  document.querySelectorAll('.clearLabel').forEach(n => {
    n.textContent = `${GEO.label.split(' — ')[0]} · ${MODE.label} · ${SCORING.label}`;
  });
  document.querySelectorAll('.geoName').forEach(n => { n.textContent = GEO.label; });
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

function setGeo(id) {
  if (!GEO || !GEOS[id] || id === GEO.id) return;
  loadGeography(id);
  kvSet(PREF_GEO, id);
  refreshCopy();
  resetRun();                       // repaint the header for the new totals
  el.intro.hidden = false;          // a half-played map must not linger
  overlay.hidden = true;
  showBoards(loadBoard(), null);
}

/* The tip is raised here rather than inside setMode() and friends, because
   those are also how an import applies a file — and an import that changed all
   three would stack three tips on top of each other to say what nobody asked. */
document.querySelectorAll('.modeBtn').forEach(b =>
  b.addEventListener('click', () => { setMode(b.dataset.mode); showTip(MODE.note); }));
document.querySelectorAll('.scoreBtn').forEach(b =>
  b.addEventListener('click', () => { setScoring(b.dataset.score); showTip(SCORING.note); }));
/* The map is chosen from a menu of the game's own making rather than from a
   <select>. A native one hands the whole list to the platform: on Android that
   is a full-screen sheet in the system's colours and the system's type, which
   is the one place the game stops looking like itself — and there is no styling
   it back, because the options are drawn by the OS.

   The same slip of paper the dots menu opens, so there is one idea of what a
   menu is here and one set of rules for how it behaves. */
function showGeoMenu(on) {
  if (!el.geoMenu) return;
  el.geoMenu.hidden = !on;
  el.geoBtn.classList.toggle('on', on);
  el.geoBtn.setAttribute('aria-expanded', String(!!on));
}

if (el.geoBtn) {
  el.geoBtn.addEventListener('click', () => showGeoMenu(el.geoMenu.hidden));
  document.querySelectorAll('.geoMenu button').forEach(b =>
    b.addEventListener('click', () => {
      showGeoMenu(false);
      setGeo(b.dataset.geo);
      showTip(mapNote());
    }));
  /* Anywhere else dismisses it, and does only that — the same rule the dots
     menu follows, and for the same reason: the nearest thing to tap when
     putting this away is Start, and a run beginning because you were closing a
     menu is worse than an extra tap. */
  document.addEventListener('click', e => {
    if (el.geoMenu.hidden) return;
    if (el.geoBtn.contains(e.target) || el.geoMenu.contains(e.target)) return;
    showGeoMenu(false);
    e.preventDefault();
    e.stopPropagation();
  }, true);
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el.geoMenu.hidden) showGeoMenu(false);
  });
}

const play = () => { hideTip(); beginRun(); };
el.again.addEventListener('click', play);
el.startBtn.addEventListener('click', play);
/* Play again repeats the run you just had; this is the way out of it, for
   changing geography and coming back to a fresh Start rather than dropping
   straight into another countdown. It is the pause card's exit reused, which
   already resets the run and puts the intro up — the end card and the pause
   card are leaving the same thing. */
if (el.menuBtn) el.menuBtn.addEventListener('click', quitToMenu);
