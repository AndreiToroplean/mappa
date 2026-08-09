// leaderboard: one best time per regions-found tally, many entries at a full set
const ALL = 'All ' + RULES.collective;
const KEY = 'fifty:board2';
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
    window.localStorage.setItem(KEY + ':probe', '1');
    window.localStorage.removeItem(KEY + ':probe');
    return true;
  } catch (e) { return false; }
}

const parse = s => { try { return JSON.parse(s) || []; } catch (e) { return []; } };

async function loadBoard() {
  if (window.storage && window.storage.get) {
    try {
      const r = await window.storage.get(KEY);
      store = 'artifact';
      return r ? parse(r.value) : [];
    } catch (e) {
      // An unset key throws here, which is not the same as a broken backend.
      // Settle it with a write: if that lands, the backend is fine and empty.
      try { await window.storage.set(KEY, '[]'); store = 'artifact'; return []; }
      catch (e2) {}
    }
  }
  if (localOK()) {
    store = 'local';
    return parse(window.localStorage.getItem(KEY));
  }
  store = 'memory';
  return memBoard;
}

async function saveBoard(b) {
  memBoard = b;
  const json = JSON.stringify(b);
  if (store === 'artifact') {
    try { await window.storage.set(KEY, json); return; }
    catch (e) { store = localOK() ? 'local' : 'memory'; }
  }
  if (store === 'local') {
    try { window.localStorage.setItem(KEY, json); return; }
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

/* The one definition of "better": more found first, then quicker. Ranking and
   insertion used to encode this separately, which is two places to change when
   a mode ranks on something else. */
const better = (a, c) => c.f - a.f || a.t - c.t;
const rankBoard = b => b.sort(better);

function addEntry(board, entry) {
  if (entry.f === 0) return { board, kept: false };
  if (entry.f === TOTAL) {
    board.push(entry);
    const full = board.filter(r => r.f === TOTAL).sort(better).slice(0, 5);
    board = full.concat(board.filter(r => r.f < TOTAL));
    return { board, kept: full.includes(entry) };
  }
  const prev = board.find(r => r.f === entry.f);
  if (!prev) { board.push(entry); return { board, kept: true }; }
  if (entry.t < prev.t) {
    board[board.indexOf(prev)] = entry;
    return { board, kept: true };
  }
  return { board, kept: false };
}

/* Both cards show the same board, so they are always painted together. Three
   call sites used to render one or both with slightly different arguments. */
function showBoards(board, mine) {
  renderBoard(el.introBoard, board, mine);
  renderBoard(el.boardList, board, mine);
  showNote();
}

function renderBoard(target, board, mine) {
  const rows = rankBoard(board.slice()).slice(0, 6);
  target.innerHTML = rows.length
    ? rows.map((r, i) => {
        const tier = r.f === TOTAL ? 'full' : 'partial';
        const you = mine && r.d === mine ? ' you' : '';
        return `<div class="row ${tier}${you}">
            <span class="rank">${String(i + 1).padStart(2, '0')}</span>
            <span class="tally">${r.f === TOTAL ? ALL : r.f + ' ' + RULES.noun + 's'}</span>
            <span class="time">${fmt(r.t)}</span>
          </div>`;
      }).join('')
    : '<div class="empty">No runs yet. Every run posts a time for however many states you reach.</div>';
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
    pause = 1200;   // let the last state fill in and the map read as complete
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

  el.ovTitle.textContent = won ? ALL + '.' : 'Out of lives.';
  el.ovSub.textContent =
    won ? `Complete in ${fmt(ms)}` : `${found} of ${TOTAL} found · ${fmt(ms)}`;

  const entry = { f: found, t: ms, d: Date.now() };
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

el.again.addEventListener('click', beginRun);
el.startBtn.addEventListener('click', beginRun);

// show any existing best runs on the intro screen
loadBoard().then(b => showBoards(b, null));
