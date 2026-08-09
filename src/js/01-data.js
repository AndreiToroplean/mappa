/* The region set. Keys are single letters purely to keep the injected payload
   small; they are expanded once, here, so nothing downstream has to know them.

     n -> name    d -> SVG path data
     l -> label anchor (pole of inaccessibility)   r -> inscribed radius there

   Everything below this line talks about regions, not states, so a second
   geography drops in without touching the game. */
const REGIONS = __DATA__.map(r => ({
  name: r.n, d: r.d, anchor: r.l, radius: r.r,
}));
const ABBR = __ABBR__;

const REGION_NAMES = REGIONS.map(r => r.name);
const TOTAL = REGIONS.length;

/* Vocabulary belongs to the region set, not to the game rules — swapping in a
   different geography changes these, swapping mode does not. */
const RULES = {
  noun: 'state',          // what the prompt calls one region
  collective: 'fifty',    // used in the end-of-run copy
};

/* ---- modes ---------------------------------------------------------------
   Mode and geography are independent axes, so a mode says nothing about which
   regions are in play, only what counts as a run and what counts as a good
   one.

   Each mode owns its own board, under its own storage key. They are not
   comparable — a practice run cannot fail, so ranking it against runs that
   could would be meaningless — and mixing them in one list would quietly
   bury every ranked run under a wall of completed practice ones. */
const MODES = {
  ranked: {
    id: 'ranked',
    label: 'Ranked',
    lives: 3,
    // unchanged from when this mode was the only one — existing boards survive
    key: 'fifty:board2',
    counter: 'Lives',       // what the header's third column is counting
    rule: 'Three misses ends the run. Your time is the score.',
    hint: 'Click the state named above, or press and hold to zoom. '
        + 'Three misses ends the run.',
    empty: 'No runs yet. Every run posts a time for however many states you reach.',

    /* Sub-full runs keep one entry per tally, so a best 31 replaces a previous
       31 without competing with a 12. Full runs are the exception: up to five
       coexist, ranked against each other. */
    insert(board, entry) {
      if (entry.f === 0) return { board, kept: false };
      if (entry.f === TOTAL) {
        board.push(entry);
        const full = board.filter(r => r.f === TOTAL).sort(better).slice(0, 5);
        return { board: full.concat(board.filter(r => r.f < TOTAL)),
                 kept: full.includes(entry) };
      }
      return replaceBy(board, entry, r => r.f === entry.f);
    },
  },

  practice: {
    id: 'practice',
    label: 'Practice',
    lives: Infinity,
    key: 'fifty:practice1',
    counter: 'Misses',
    rule: 'No limit on misses. Fewest misses wins, then quickest.',
    hint: 'Click the state named above, or press and hold to zoom. '
        + 'Misses are counted, not fatal.',
    empty: 'No runs yet. Every run here finishes, so the score is how few '
         + 'misses it took.',

    /* Nothing can end a practice run early, so every entry is a completed set
       and the only axis left is misses. One entry per miss count: a cleaner
       run is a different achievement, a quicker one at the same count simply
       replaces it. */
    insert(board, entry) {
      return replaceBy(board, entry, r => r.e === entry.e);
    },
  },
};

let MODE = MODES.ranked;

/* Shared by both policies: keep one entry per bucket, replacing only on an
   improvement. */
function replaceBy(board, entry, match) {
  const prev = board.find(match);
  if (!prev) { board.push(entry); return { board, kept: true }; }
  if (better(entry, prev) < 0) {
    board[board.indexOf(prev)] = entry;
    return { board, kept: true };
  }
  return { board, kept: false };
}
