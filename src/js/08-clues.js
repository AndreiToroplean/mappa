
/* ---- clues ---------------------------------------------------------------
   A beginner handed one of a hundred départements has no way in: every guess is
   a shot in the dark, and being wrong ninety-nine times teaches nothing. Clues
   bound the search without answering it.

   Always asked for, never given. Two rungs, in a fixed order — the capital
   first, since knowing Quimper is in Finistère is a fact worth carrying, then
   the grouping, which narrows the map to a handful of candidates. Consistency
   matters more than cleverness here: the same button always does the same next
   thing, so it can be relied on rather than gambled with.

   Every clue is counted and shown on the board, so a clean run stays worth
   more than an assisted one. */
let cluesUsed = 0;     // for the whole run
let given = new Set();  // which rungs this turn has already spent
let lastMiss = null;    // the most recent wrong guess, if any

function clueTable(name) {
  return (GEO.clues && GEO.clues[name]) || {};
}

/* The ladder, in fixed order. Each rung says whether it can be offered right
   now — the arrow only exists once there is a wrong guess to point away from,
   so before the first miss the button skips straight to the grouping. A miss
   makes the arrow available again, pointing from the new mistake, because that
   is new information and it is paid for like any other clue. */
function rungs() {
  const info = clueTable(current);
  return [
    { key: 'arrow', ok: !!(lastMiss && anchorAt[lastMiss]),
      show: () => nudge(lastMiss, current) },
    { key: 'group', ok: !!info.group, show: () => showGroup(info.group) },
    // Last, because it is the weakest: a name you either know or do not, which
    // narrows nothing on the map by itself.
    { key: 'capital', ok: !!info.capital,
      show: () => { ticker.innerHTML =
        `<span class="hint">Capital</span> — <b>${info.capital}</b>`; } },
  ];
}

const nextRung = () => rungs().find(r => r.ok && !given.has(r.key));

function nextClue() {
  if (!running || !MODE.clues) return;
  const rung = nextRung();
  if (!rung) return;
  rung.show();
  given.add(rung.key);
  cluesUsed++;
  drawClueButton();
}

function drawClueButton() {
  if (!el.clue) return;
  const rung = running ? nextRung() : null;
  el.clue.disabled = !rung;
  el.clue.textContent = !rung ? 'No more clues'
    : given.size === 0 ? 'Clue' : 'Another clue';
}

/* A wrong guess re-opens the arrow rung and takes down the old one, which was
   aimed from a different mistake. */
function missed(name) {
  lastMiss = name;
  given.delete('arrow');
  clearNudge();
  drawClueButton();
}

/* The grouping is drawn as its own outline, in the same amber the answer is
   revealed in — amber is the colour of help throughout. */
function showGroup(name) {
  clearGroup();
  const g = GEO.groups && GEO.groups[name];
  if (!g || !layoutNow) return;
  const at = layoutNow.place[g.p];
  if (!at) return;

  let d = '', xs = [], ys = [];
  for (const part of g.d.split('M')) {
    if (!part) continue;
    const closed = part.endsWith('Z');
    const pts = part.replace(/Z$/, '').split('L').map(q => {
      const c = q.split(',');
      const x = +c[0] * at.s + at.dx, y = +c[1] * at.s + at.dy;
      xs.push(x); ys.push(y);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    d += 'M' + pts.join('L') + (closed ? 'Z' : '');
  }
  if (!d) return;

  const outline = document.createElementNS(NS, 'path');
  outline.setAttribute('class', 'group');
  outline.setAttribute('d', d);
  L_GROUP.appendChild(outline);

  const t = document.createElementNS(NS, 'text');
  t.setAttribute('class', 'grouplabel');
  t.setAttribute('x', (Math.min(...xs) + Math.max(...xs)) / 2);
  t.setAttribute('y', Math.min(...ys) - 7);
  t.textContent = name;
  L_GROUP.appendChild(t);
}

function clearGroup() {
  if (L_GROUP) while (L_GROUP.firstChild) L_GROUP.removeChild(L_GROUP.firstChild);
}

/* A new turn starts the ladder over; the tally does not reset until the run
   does. */
function resetClues(wholeRun) {
  given = new Set();
  lastMiss = null;
  if (wholeRun) cluesUsed = 0;
  clearGroup();
  clearNudge();
  drawClueButton();
}

/* The button was rendered and relabelled from the start, but nothing was ever
   bound to it — so it took the tap, showed the browser's own press highlight,
   and did nothing. Exactly the shape of "the button doesn't work". */
if (el.clue) el.clue.addEventListener('click', nextClue);
