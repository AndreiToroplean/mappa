
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
let clueStep = 0;      // how far up the ladder this turn has gone

function clueTable(name) {
  return (GEO.clues && GEO.clues[name]) || {};
}

function nextClue() {
  if (!running || !MODE.clues || clueStep >= 2) return;
  const info = clueTable(current);
  if (clueStep === 0 && info.capital) {
    clueStep = 1;
    cluesUsed++;
    ticker.innerHTML = `<span class="hint">Capital</span> — <b>${info.capital}</b>`;
  } else if (info.group) {
    clueStep = 2;
    cluesUsed++;
    showGroup(info.group);
  } else {
    clueStep = 2;      // nothing left to offer for this region
  }
  drawClueButton();
}

function drawClueButton() {
  if (!el.clue) return;
  const info = clueTable(current);
  const rungs = (info.capital ? 1 : 0) + (info.group ? 1 : 0);
  el.clue.disabled = !running || clueStep >= rungs;
  el.clue.textContent = clueStep >= rungs ? 'No more clues'
    : clueStep === 0 ? 'Clue' : 'Another clue';
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
  clueStep = 0;
  if (wholeRun) cluesUsed = 0;
  clearGroup();
  drawClueButton();
}
