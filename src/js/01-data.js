/* ---- geographies ---------------------------------------------------------
   A geography is a set of regions plus the words used to talk about them.
   Each build script emits one as a set of panels in local coordinates: a
   mainland, plus an inset per piece that sits apart from it. Where those go is
   decided at run time from the shape of the screen, then composed into one flat
   coordinate space — see chooseLayout() and compose(). A geography may bake its
   insets into the mainland panel instead, which is what the US does, since
   Albers USA already composites Alaska and Hawaii where they belong.

   Region payload keys are single letters purely to keep the injected data
   small, and are expanded once, in useGeo(), so nothing downstream knows them:

     n -> name    d -> SVG path data, in its panel's local units
     l -> label anchor (pole of inaccessibility)   r -> inscribed radius there
     p -> which panel it belongs to
*/
const GEOS = {
  us: Object.assign({
    id: 'us',
    label: 'United States — states',
    noun: 'state',
    all: 'All fifty',
  }, __US__, { clues: __CLUES_US__ }),

  fr: Object.assign({
    id: 'fr',
    label: 'France — départements',
    noun: 'département',
    all: 'All 101',
  }, __FR__, { clues: __CLUES_FR__ }),
};

const DEFAULT_GEO = 'us';

/* Live geography, and the values derived from it. These are reassigned rather
   than rebound per module, so every module sees the switch. */
let GEO, REGIONS, REGION_NAMES, TOTAL, ABBR;

function useGeo(id) {
  GEO = GEOS[id] || GEOS[DEFAULT_GEO];
  REGIONS = GEO.regions.map(r => ({
    name: r.n, d: r.d, anchor: r.l, radius: r.r, panel: r.p,
  }));
  REGION_NAMES = REGIONS.map(r => r.name);
  TOTAL = REGIONS.length;
  ABBR = GEO.abbr;
}

/* ---- modes ---------------------------------------------------------------
   Mode and geography are independent axes: a mode says what counts as a run
   and what counts as a good one, never which regions are in play. Every
   combination gets its own board — see boardKey().
*/
const MODES = {
  trial: {
    id: 'trial',
    label: 'Trial',
    lives: 3,
    counter: 'Lives',       // what the header's third column is counting
    hint: () => `Click the ${GEO.noun} named above, or press and hold to zoom. `
              + 'Three misses ends the run.',
    empty: 'No runs yet. Every run posts a time for however far you get.',

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
    counter: 'Misses',
    clues: true,          // the clue ladder, arrow included
    hint: () => `Click the ${GEO.noun} named above, or press and hold to zoom. `
              + 'Misses are counted, not fatal.',
    empty: 'No runs yet. Every run here finishes, so the score is how little '
         + 'help it took.',

    /* Nothing can end a practice run early, so every entry is a completed set
       and the only axis left is misses. One entry per miss count: a cleaner
       run is a different achievement, a quicker one at the same count simply
       replaces it. */
    insert(board, entry) {
      // bucketed on misses and clues together, matching how they are ranked
      return replaceBy(board, entry,
        r => errorsOf(r) === errorsOf(entry) && cluesOf(r) === cluesOf(entry));
    },
  },
};

let MODE = MODES.trial;

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
