#!/usr/bin/env node
/* Screenshot dist/mappa.html in a real browser, so design work can be looked at.
 *
 * Not part of the build, and a sibling of render.py rather than a replacement:
 * render.py answers "where did the layout put things", using its own geometry
 * and none of the stylesheet, and stays useful because it needs no browser.
 * This answers "what does it actually look like", which is a question only a
 * browser can be asked — textures, filters, fonts, shadows and blend modes are
 * exactly the things render.py cannot see.
 *
 *   node shot.js menu                 # the start card, dark, on a phone
 *   node shot.js map --geo=fr         # mid-run
 *   node shot.js menu --light --w=430 --h=932
 *   node shot.js all                  # every scene, into shots/
 *
 * Drives Chrome over the DevTools protocol rather than passing --screenshot,
 * because headless ignores --window-size for the viewport itself: it reports
 * 500x693 whatever is asked for, and silently rasterises the wrong layout.
 * Emulation.setDeviceMetricsOverride is the setting that is actually obeyed.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/opt/google/chrome/chrome';
const ROOT = __dirname;
const OUT = path.join(ROOT, 'shots');

const args = process.argv.slice(2);
const scene = args.find(a => !a.startsWith('-')) || 'menu';
const flag = (n, d) => {
  const hit = args.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const has = n => args.includes(`--${n}`);

const W = +flag('w', 390), H = +flag('h', 780);
const SCALE = +flag('scale', 2);
const THEME = has('light') ? 'light' : 'dark';
const GEO = flag('geo', 'fr');

/* Every scene is a query string plus a script run once the page is up. Kept as
 * data so `all` is a loop rather than five near-copies. The link parameters are
 * a published surface and do the setup work no script has to repeat. */
/* Steps by name, not by reference: a scene is a list of snippets to run in
 * order, and naming them keeps the table readable without the snippets having
 * to live in it. */
const SCENES = {
  menu:  { q: '', act: [] },
  board: { q: '', act: ['FAKE_BOARD'] },
  pop:   { q: '', act: ['FAKE_BOARD', 'OPEN_MENU'] },
  maps:  { q: '', act: ['FAKE_BOARD', 'OPEN_MAPS'] },
  map:   { q: '', act: ['START'] },
  cover: { q: '', act: ['COVER'] },
  found: { q: '', act: ['START', 'PLAY_A_FEW'] },
  drift: { q: '&scoring=drift', act: ['START', 'PLAY_A_FEW'] },
  // every state the map can draw at once: found, missed, revealed, scored, and
  // the splash a miss throws up in the middle of the screen.
  states:{ q: '', act: ['START', 'EVERY_STATE'] },
  ramp:  { q: '&scoring=drift', act: ['START', 'RAMP'] },
  end:   { q: '&scoring=drift', act: ['START', 'PLAY_ALL'] },
};

/* Written as source text because it is evaluated in the page, not here. */
const SRC = {
  FAKE_BOARD: `
    const key = keyFor(GEO.id, MODE.id, SCORING.id);
    // the shape saveBoard writes: found, revealed, spend, clues, ms, when
    const rows = [[62,20,683400],[78,0,659400],[82,0,222200],
                  [87,0,695500],[94,14,546800],[120,13,430800]];
    kvSet(key, JSON.stringify(rows.map(([e,c,t]) =>
      ({ f: TOTAL, v: TOTAL, e: e, c: c, t: t, d: Date.now() }))));
    showBoards(loadBoard(), null);`,
  OPEN_MAPS: `
    el.geoBtn.click();`,
  OPEN_MENU: `
    el.dataBtn.click();
    document.querySelector('#intro .themebtn').classList.add('on');`,
  COVER: `
    el.startBtn.click();`,
  START: `
    el.startBtn.click();
    // skip the three-second countdown rather than waiting it out
    el.countdown.hidden = true;
    running = true; document.body.classList.add('playing');
    t0 = Date.now() - 84200; tick(); next();`,
  PLAY_A_FEW: `
    for (let i = 0; i < Math.min(9, REGION_NAMES.length - 2); i++) guess(current);
    // and one wrong, so a miss is on screen too
    const other = REGION_NAMES.find(n => n !== current && status(n) === 'open');
    if (other) guess(other, anchorAt[other]);`,
  EVERY_STATE: `
    const open = () => REGION_NAMES.filter(n => status(n) === 'open');
    for (let i = 0; i < 8; i++) guess(current);            // found
    // a wrong tap reveals the answer in amber, flashes the shape it hit in red
    // and throws the name into the middle — three of the states in one action
    for (let i = 0; i < 3; i++) {
      const other = open().find(n => n !== current);
      if (other) guess(other, anchorAt[other]);
    }`,
  RAMP: `
    // one guess at each distance, so the whole green-to-red ramp is on screen
    const open = () => REGION_NAMES.filter(n => status(n) === 'open');
    for (let i = 0; i < 14; i++) {
      const pool = open().filter(n => n !== current);
      if (!pool.length) break;
      guess(pool[Math.floor(pool.length * (i / 14))], anchorAt[current]);
    }`,
  PLAY_ALL: `
    let n = 0;
    while (running && n++ < REGION_NAMES.length + 4) {
      const other = REGION_NAMES.find(m => m !== current && status(m) === 'open');
      guess(n % 4 ? current : (other || current), anchorAt[other || current]);
    }`,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const port = 9222 + (process.pid % 500);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--hide-scrollbars', '--force-color-profile=srgb',
    `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  for (let i = 0; i < 60 && !ws; i++) {
    await sleep(100);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) ws = page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
  }
  if (!ws) { chrome.kill(); throw new Error('chrome never answered'); }

  const sock = new WebSocket(ws);
  await new Promise(r => sock.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  sock.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
    sock.send(JSON.stringify({ id: n, method, params }));
  });

  const want = scene === 'all' ? Object.keys(SCENES) : [scene];
  if (!want.every(s => SCENES[s])) throw new Error('scenes: ' + Object.keys(SCENES).join(', '));

  await send('Page.enable');
  for (const s of want) {
    const { q, act } = SCENES[s];
    const url = `file://${ROOT}/dist/mappa.html?map=${GEO}&theme=${THEME}${q}`;
    // The setting headless actually obeys; --window-size is not it.
    await send('Emulation.setDeviceMetricsOverride',
      { width: W, height: H, deviceScaleFactor: SCALE, mobile: true });
    await send('Page.navigate', { url });
    await sleep(900);
    for (const step of act) {
      if (!SRC[step]) throw new Error('no such step: ' + step);
      const r = await send('Runtime.evaluate',
        { expression: `(() => { ${SRC[step]} })()`, awaitPromise: true });
      // A step that threw would otherwise leave a screenshot of the wrong scene
      // and nothing to say so, which is how a styling bug gets invented.
      if (r.exceptionDetails) {
        throw new Error(`${s}/${step}: ` + (r.exceptionDetails.exception
          ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
      }
      await sleep(350);
    }
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, `${s}-${GEO}-${THEME}-${W}x${H}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(path.relative(ROOT, file));
  }
  sock.close();
  chrome.kill();
}

main().catch(e => { console.error(e.message); process.exit(1); });
