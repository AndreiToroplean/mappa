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
/* Sub-full runs keep one entry per tally, so a best 31 replaces a previous 31
   without competing with a 12. Full runs are the exception: up to five coexist,
   ranked against each other.

   What counts as the tally depends on the scoring — regions found under
   counting, regions revealed under distance — so it is asked for rather than
   read off the entry. See tallyOf(). */
function byTally(board, entry) {
  const t = tallyOf(entry);
  if (t === 0) return { board, kept: false };
  if (t === TOTAL) {
    board.push(entry);
    const full = board.filter(r => tallyOf(r) === TOTAL).sort(better).slice(0, 5);
    return { board: full.concat(board.filter(r => tallyOf(r) < TOTAL)),
             kept: full.includes(entry) };
  }
  return replaceBy(board, entry, r => tallyOf(r) === t);
}

const MODES = {
  trial: {
    id: 'trial',
    label: 'Trial',
    capped: true,           // a run can end early; SCORING says at what

    insert: byTally,
  },

  practice: {
    id: 'practice',
    label: 'Practice',
    capped: false,
    clues: true,          // the clue ladder, arrow included

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

/* ---- scoring -------------------------------------------------------------
   A third axis, independent of the other two. Mode says whether a run can end
   early; scoring says what a wrong tap costs.

   Counting is the original game and asks whether you knew it. Measuring asks
   something else — how close were you — and under it a tap on the next
   département and a tap in the Atlantic stop being the same answer. That is a
   real difference in what the drill teaches, which is why it is an axis rather
   than a third mode: either question is worth asking of either kind of run.

   The unit is deliberately not kilometres. France would then be scored on a
   scale a fifth of the width of the US, and a run in one would say nothing
   about a run in the other. 100 is the longest distance across the geography's
   mainland instead, so full width means full width everywhere. Landing on a
   different landmass costs FAR — there is no honest distance to measure across
   a gap the map invented, and it should cost more than the worst real miss.

   Always shown whole. Tenths of a percent of a continent are not something
   anyone can feel, and a decimal point would suggest a precision the
   simplified borders do not have.  */
/* A flat charge for the wrong landmass — the wrong inset, or the mainland when
   an inset was wanted. There is no honest distance to measure across a gap the
   map invented, so it is priced rather than measured, at one full width.

   Note that a real miss is not capped at it and can cost more: 100 is the
   *width* of the geography and its diagonal is longer, about 109 in the US and
   137 in France. Getting the wrong landmass is a category error and should cost
   what a long miss costs, not what the worst conceivable one does. */
const FAR = 100;
const PANEL_SPAN = 1000;   // what normalise() scales a panel's longest side to

const SCORINGS = {
  count: {
    id: 'count',
    label: 'Misses',
    budget: 3,            // what a Trial run may spend
    pips: true,           // three lives read better as pips than as a number
    retry: true,          // a wrong tap leaves the region on the table
  },

  drift: {
    id: 'drift',
    label: 'Distance',
    budget: 100,          // the purse: one full width of the geography
    pips: false,
    /* Trial ends the moment the purse runs out, so what a run has to show for
       itself is how far it got before that: one entry per revealed count,
       exactly as counting keeps one per tally, with the full sets ranked among
       themselves. Practice cannot end early and always reaches the last region,
       so there the tally is constant and the score is the only axis — one entry
       per score, the way counting-practice keeps one per miss count. */
    insert: (board, entry) => MODE.capped ? byTally(board, entry)
      : replaceBy(board, entry,
          r => errorsOf(r) === errorsOf(entry) && cluesOf(r) === cluesOf(entry)),
    /* One tap per region. Guessing again after a miss is how you *narrow* an
       answer, and narrowing is exactly what this scoring is trying to price: a
       second guess three regions closer would post a better distance than the
       first, and the number would then describe the search rather than the
       knowledge. So the answer is shown, the distance to it is drawn, and the
       next region is named. */
    retry: false,
  },
};

let SCORING = SCORINGS.count;

/* What a Trial run may spend before it ends, and Infinity in Practice. Errors
   are the thing counted; the cap is a rule about them, and it now depends on
   both axes: three misses, or one full map. */
const budget = () => (MODE.capped ? SCORING.budget : Infinity);

/* What a run starts holding, which is the same number without the mode's rule
   on top. Distance is shown as a countdown from it — a run begins with a
   hundred points and a miss takes some — so Practice needs it too, even though
   Practice may spend straight past zero and finish owing. */
const purse = () => SCORING.budget;

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
