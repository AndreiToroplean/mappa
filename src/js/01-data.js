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

/* Rules that vary by mode. One object today; a second mode adds a second. */
const RULES = {
  lives: 3,
  noun: 'state',          // what the prompt calls one region
  collective: 'fifty',    // used in the end-of-run copy
};
