/* ---- reviewing the finished map -----------------------------------------
   The end card arrives on top of the map at the moment the map is most worth
   looking at: every region resolved, the answers revealed, and under distance
   scoring every one of them coloured by what it cost. Review hides the card and
   hands that map back, unchanged — finish() paints nothing new, so there is
   nothing to restore — with one difference: every region now answers instead of
   asking. Tap one, or drag the magnifier over it, and it names itself along
   with its grouping and its capital.

   That is the same information the clue ladder rations during a run, and
   rationing it is what makes a clue cost something. The run is over here, so
   there is nothing left to protect and it is simply given.

   The point is the errors. A run tells you how many you got wrong and paints
   where; it never tells you what the right answer was called, and by the end
   card the moment for asking has passed. This is that moment, put back.
*/
let reviewing = false;

/* One line, in two places at once: the ticker along the bottom and the
   magnifier's caption, which in review has nothing else to say. Both read this,
   so they cannot come to disagree about what a region is.

   Unlabelled and separated by dots rather than spelled out as "grouping" and
   "capital". The order is the clue ladder's order, and a city name after a
   region name reads as a city without being told. */
function factsHTML(name) {
  const f = clueTable(name);
  return [`<b>${name}</b>`, f.group, f.capital].filter(Boolean).join(' · ');
}

/* What a tap means once the run is over. Same shape as a miss report — a name
   in the middle, an outline on the map, a line along the bottom — because it is
   the same act of reading, and the game should not have two vocabularies for
   it. Amber throughout, since none of this is a verdict any more. */
function inspect(name) {
  if (!reviewing || !name) return;
  clearMissMarks();          // the last tap's outline has had its moment
  flashName(name, true);
  markPick(name);
  ticker.innerHTML = factsHTML(name);
}

function enterReview() {
  reviewing = true;
  document.body.classList.add('reviewing');
  overlay.hidden = true;
  clearFlash();
  ticker.innerHTML = `Tap a ${GEO.noun} to name it, or press and hold to browse.`;
}

/* The card is not rebuilt on the way back: it is still sitting there with the
   run's score and board on it, exactly as it was left. Review only ever hid
   it. */
function leaveReview() {
  if (!reviewing) return;
  closeLens(false);
  reviewing = false;
  document.body.classList.remove('reviewing');
  clearMissMarks();
  clearFlash();
  overlay.hidden = false;
}

if (el.reviewBtn) el.reviewBtn.addEventListener('click', enterReview);
if (el.backBtn) el.backBtn.addEventListener('click', leaveReview);
// Escape closes what is open, which here is the map over the card.
addEventListener('keydown', e => {
  if (e.key === 'Escape' && reviewing) leaveReview();
});
