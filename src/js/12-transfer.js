/* ---- taking your data with you -------------------------------------------
   Everything the game knows about a player is eight boards and three
   preferences, and all of it lives in one browser's storage — which is a
   fragile place to keep a year of runs. Chrome treats every file:// page as one
   origin, so a downloaded copy shares a bucket with every other downloaded
   copy; the artifact runtime scopes storage to a build, so a rebuild starts
   empty; and clearing site data takes the lot. None of that is fixable from
   inside the page. What is fixable is being able to get the data out and put it
   back.

   JSON, and readable JSON at that: indented, with the storage keys spelled out
   as they really are. Someone should be able to open the file and see what the
   game has been keeping about them, which is half the point of offering it.

   The keys are the real ones rather than a prettier scheme invented for the
   file. They are ugly in two places — `fifty:board2` and `fifty:practice1`, the
   spellings from before geographies existed — but a file that says what the
   storage says cannot misroute on the way back in, and inventing a second
   naming scheme would mean two of them to keep in step.
*/
const DATA_FORMAT = 1;

/* An export is only worth having if it survives the trip, so the import treats
   the file as something a stranger wrote: every key checked against the ones
   the game actually uses, every value checked for the shape the board code
   assumes, and every row rebuilt field by field rather than trusted whole.
   A hand-edited file with a typo should be refused, not half-loaded. */
const ROW_FIELDS = ['f', 'v', 'e', 'c', 't', 'd'];

function buildVersion() {
  const v = document.querySelector('.ver');
  return v ? v.textContent.trim() : '';
}

async function readKey(key) {
  try { return await kvGet(key); } catch (e) { return null; }
}

async function collectData() {
  const data = {
    fifty: DATA_FORMAT,
    exported: new Date().toISOString(),
    build: buildVersion(),
    prefs: {},
    boards: {},
  };
  for (const k of PREF_KEYS) {
    const v = await readKey(k);
    if (v) data.prefs[k] = v;
  }
  // Empty boards are left out rather than written as []. An import replaces
  // what the file mentions, so an empty one would quietly wipe a board that
  // only exists on the other device.
  for (const k of boardKeys()) {
    const rows = parse(await readKey(k));
    if (rows.length) data.boards[k] = rows;
  }
  return data;
}

function saveFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

async function exportData() {
  try {
    const data = await collectData();
    const runs = Object.keys(data.boards)
      .reduce((n, k) => n + data.boards[k].length, 0);
    saveFile(`fifty-data-${stamp()}.json`, JSON.stringify(data, null, 2));
    flashNote(`Exported ${runs} run${runs === 1 ? '' : 's'} from `
            + `${Object.keys(data.boards).length} board`
            + `${Object.keys(data.boards).length === 1 ? '' : 's'}.`);
  } catch (e) {
    flashNote('Could not export: ' + e.message, true);
  }
}

/* ---- reading one back ---------------------------------------------------- */

/* Returns the cleaned data, or throws with a sentence worth showing. Nothing is
   written until all of it has passed, so a bad file leaves the boards alone.
   Parsing lives here too: "that file is not JSON" is a better thing to read
   than whatever the browser calls a stray comma. */
function validate(text) {
  let raw;
  try { raw = JSON.parse(text); }
  catch (e) { throw new Error('that file is not JSON'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('that is not a Fifty export');
  }
  if (raw.fifty !== DATA_FORMAT) {
    throw new Error(raw.fifty > DATA_FORMAT
      ? 'that file was written by a newer version'
      : 'that is not a Fifty export');
  }

  const prefs = {};
  const known = { [PREF_GEO]: GEOS, [PREF_MODE]: MODES, [PREF_SCORING]: SCORINGS };
  for (const k of PREF_KEYS) {
    const v = raw.prefs && raw.prefs[k];
    if (typeof v === 'string' && known[k][v]) prefs[k] = v;
  }

  const boards = {};
  const allowed = boardKeys();
  let runs = 0;
  for (const k in (raw.boards || {})) {
    if (allowed.indexOf(k) < 0) throw new Error('unknown board "' + k + '"');
    const rows = raw.boards[k];
    if (!Array.isArray(rows)) throw new Error('board "' + k + '" is not a list');
    boards[k] = rows.map(r => {
      if (!r || typeof r !== 'object') throw new Error('a run in "' + k + '" is not a run');
      // f, t and d are the three the board code reads without checking
      for (const f of ['f', 't', 'd']) {
        if (typeof r[f] !== 'number' || !isFinite(r[f])) {
          throw new Error('a run in "' + k + '" is missing its ' + f);
        }
      }
      const out = {};
      // rebuilt field by field: anything else in the file is not carried over
      for (const f of ROW_FIELDS) if (typeof r[f] === 'number') out[f] = r[f];
      return out;
    });
    runs += boards[k].length;
  }
  return { prefs: prefs, boards: boards, runs: runs, exported: raw.exported };
}

async function applyData(clean) {
  for (const k in clean.boards) await kvSet(k, JSON.stringify(clean.boards[k]));
  for (const k in clean.prefs) await kvSet(k, clean.prefs[k]);

  /* The live state has to follow the file, or the menu would go on showing the
     board of whatever was selected before while claiming the data changed. The
     ordinary switchers do it, and they save the preference again on the way
     through, which is what was just written anyway. */
  if (clean.prefs[PREF_MODE]) await setMode(clean.prefs[PREF_MODE]);
  if (clean.prefs[PREF_SCORING]) await setScoring(clean.prefs[PREF_SCORING]);
  if (clean.prefs[PREF_GEO]) await setGeo(clean.prefs[PREF_GEO]);
  showBoards(await loadBoard(), null);
}

/* ---- the import card -----------------------------------------------------
   Everything about an import now happens on one card with a line on it that is
   always saying something. The first version put the file straight into a
   confirmation and reported its failures in the storage note under the board —
   which meant that when a phone's picker handed back nothing at all, there was
   no card, no message, and no way to tell a silent failure from a slow one.

   A picker can come back empty for reasons the page never sees: the chooser
   cancelled, the file provider refused, or Android discarded the page while it
   was in the background and reloaded it behind the picker. None of those throw.
   So the rule here is that every path through this card ends in a sentence.

   And the file is only one way in. The box takes the text of an export pasted
   straight into it, which asks nothing of the browser but a clipboard — no
   chooser, no file provider, no permission, nothing to background the page for.
   A file that is chosen lands in the same box, so what arrived is visible
   before it is imported, and there is one path through the rest of this. */
let pending = null;      // the validated file, waiting on the button

function note(msg, kind) {
  if (!el.impNote) return;
  el.impNote.textContent = msg;
  el.impNote.className = 'impnote' + (kind ? ' ' + kind : '');
}

function offer(clean) {
  pending = clean;
  const n = Object.keys(clean.boards).length;
  const when = clean.exported ? String(clean.exported).slice(0, 10) : 'an unknown date';
  note(`${clean.runs} run${clean.runs === 1 ? '' : 's'} across `
     + `${n} board${n === 1 ? '' : 's'} · saved ${when}`, 'ok');
  el.impGo.disabled = false;
}

function reject(msg) {
  pending = null;
  el.impGo.disabled = true;
  note(msg, 'warn');
}

function accept(text, from) {
  let clean;
  try { clean = validate(text); }
  catch (e) { return reject((from ? from + ': ' : '') + e.message); }
  if (!clean.runs && !Object.keys(clean.prefs).length) {
    return reject((from ? from + ' has' : 'That has') + ' nothing in it.');
  }
  offer(clean);
}

/* Held in a variable rather than left to the local scope: a FileReader with no
   reference to it can be collected before the read finishes on some Android
   builds, and a collected reader fires neither onload nor onerror. */
let reader = null;

function landed(text, from) {
  if (el.impText) el.impText.value = text;
  accept(text, from);
}

function readFile(file) {
  note(`Reading ${file.name}…`);
  // Blob.text() is a promise and cannot be collected out from under us; the
  // FileReader is the fallback for browsers old enough not to have it.
  if (file.text) {
    file.text().then(t => landed(t, file.name),
                     e => reject('Could not read that file: ' + e.message));
    return;
  }
  reader = new FileReader();
  reader.onerror = () => reject('Could not read that file.');
  reader.onload = () => landed(String(reader.result), file.name);
  reader.readAsText(file);
}

function openImport() {
  pending = null;
  el.impGo.disabled = true;
  if (el.impText) el.impText.value = '';
  note('Choose a file, or paste one in, to see what is in it.');
  el.impCard.hidden = false;
}

function closeImport() {
  pending = null;
  el.impCard.hidden = true;
}

if (el.exportBtn) el.exportBtn.addEventListener('click', exportData);
if (el.importBtn) el.importBtn.addEventListener('click', openImport);
if (el.impCancel) el.impCancel.addEventListener('click', closeImport);

if (el.impPick) el.impPick.addEventListener('click', () => {
  try {
    el.importFile.value = '';   // or choosing the same file twice fires nothing
    el.importFile.click();
  } catch (e) { reject('This browser would not open a file chooser.'); }
});

if (el.importFile) el.importFile.addEventListener('change', () => {
  try {
    const f = el.importFile.files && el.importFile.files[0];
    if (!f) return reject('The chooser came back without a file.');
    readFile(f);
  } catch (e) { reject('Could not read that file: ' + e.message); }
});

/* Typed or pasted, the box is read as it changes. Cheap — an export is a few
   kilobytes — and it means the summary appears the moment the paste lands
   rather than after another tap. */
if (el.impText) ['input', 'change'].forEach(ev =>
  el.impText.addEventListener(ev, () => {
    const text = el.impText.value.trim();
    if (!text) return reject('Nothing pasted yet.');
    accept(text);
  }));

if (el.impGo) el.impGo.addEventListener('click', async () => {
  const clean = pending;
  if (!clean) return;
  el.impGo.disabled = true;
  note('Importing…');
  try {
    await applyData(clean);
    closeImport();
    flashNote(`Imported ${clean.runs} run${clean.runs === 1 ? '' : 's'}.`);
  } catch (e) {
    reject('Could not import: ' + e.message);
  }
});

addEventListener('keydown', e => {
  if (e.key === 'Escape' && el.impCard && !el.impCard.hidden) closeImport();
});
