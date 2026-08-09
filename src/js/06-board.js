// leaderboard: one best time per regions-found tally, many entries at a full set
const ALL = 'All ' + RULES.collective;
const PROBE = 'fifty:probe';
let memBoard = [];

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

const parse = s => { try { return normalise(JSON.parse(s) || []); } catch (e) { return []; } };

/* Boards written before runs counted errors. A run that did not finish ended
   by running out of lives, so its count is known exactly. A completed run's is
   not recoverable, and is left blank rather than invented. */
function normalise(board) {
  if (!Number.isFinite(MODE.lives)) return board;   // nothing to infer
  return board.map(r => (typeof r.e === 'number' || r.f === TOTAL)
    ? r : Object.assign({}, r, { e: MODE.lives }));
}

async function loadBoard() {
  if (window.storage && window.storage.get) {
    try {
      const r = await window.storage.get(MODE.key);
      store = 'artifact';
      return r ? parse(r.value) : [];
    } catch (e) {
      // An unset key throws here, which is not the same as a broken backend.
      // Settle it with a write: if that lands, the backend is fine and empty.
      try { await window.storage.set(MODE.key, '[]'); store = 'artifact'; return []; }
      catch (e2) {}
    }
  }
  if (localOK()) {
    store = 'local';
    return parse(window.localStorage.getItem(MODE.key));
  }
  store = 'memory';
  return normalise(memBoard);
}

async function saveBoard(b) {
  memBoard = b;
  const json = JSON.stringify(b);
  if (store === 'artifact') {
    try { await window.storage.set(MODE.key, json); return; }
    catch (e) { store = localOK() ? 'local' : 'memory'; }
  }
  if (store === 'local') {
    try { window.localStorage.setItem(MODE.key, json); return; }
    catch (e) { store = 'memory'; }          // quota, or permission revoked
  }
}

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

/* The one definition of "better": more found first, then fewer errors, then
   quicker. It serves both modes unchanged — every practice run is a completed
   set, so the first term is always a tie there and the ordering falls through
   to misses, then time, which is exactly what practice wants. */
const better = (a, c) => c.f - a.f || errorsOf(a) - errorsOf(c) || a.t - c.t;
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
    return { tier: r.e === 0 ? 'full' : 'partial', tally: words, errs: '' };
  }
  const cls = typeof r.e !== 'number' ? ' unknown' : r.e === 0 ? ' perfect' : '';
  return {
    tier: r.f === TOTAL ? 'full' : 'partial',
    tally: r.f === TOTAL ? ALL : r.f + ' ' + RULES.noun + 's',
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
  closeLens(false);
  cancelAnimationFrame(raf);
  const ms = Date.now() - t0;

  const endedAt = Date.now();
  let pause;
  if (won) {
    ticker.innerHTML = `<span class="ok">Correct</span> — <b>${lastClick}</b>. That's ${ALL.toLowerCase()}.`;
    // say it in the header too, so a win reads as a win the instant it lands
    el.bar.classList.add('won');
    el.promptLabel.textContent = 'Complete';
    el.target.textContent = ALL;
    el.target.classList.add('won');
    clock.classList.add('won');
    pause = celebrate(errors === 0 ? 'Perfect run' : ALL);
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
    : errors === 0 ? 'Perfect run.' : ALL + '.';
  el.ovSub.textContent =
    won ? `Complete in ${fmt(ms)} · ${errors} ${errors === 1 ? 'miss' : 'misses'}`
        : `${found} of ${TOTAL} found · ${fmt(ms)}`;

  const entry = { f: found, e: errors, t: ms, d: Date.now() };
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

/* Switching mode swaps the rules copy and the board, and is available from
   both cards so a run can be followed by a different kind of run without a
   reload. */
async function setMode(id) {
  MODE = MODES[id];
  document.querySelectorAll('.modeBtn').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === id));
  document.querySelectorAll('.modeRule').forEach(n => { n.textContent = MODE.rule; });
  document.querySelectorAll('.clearLabel').forEach(n => { n.textContent = MODE.label; });
  showBoards(await loadBoard(), null);
}

document.querySelectorAll('.modeBtn').forEach(b =>
  b.addEventListener('click', () => setMode(b.dataset.mode)));

el.again.addEventListener('click', beginRun);
el.startBtn.addEventListener('click', beginRun);

// show any existing best runs on the intro screen
setMode(MODE.id);
