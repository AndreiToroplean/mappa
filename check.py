#!/usr/bin/env python3
"""Regression harness: the pure logic, against independent implementations.

Runs without a browser. Every geography is checked separately, because the
geometry code is shared but the data is not.
"""
import json, math, pathlib, random, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent
JS = ROOT / 'src' / 'js'
GEOS = ('us', 'fr')
fails = 0

geo_src = (JS / '04-geometry.js').read_text()
lens_src = (JS / '05-lens.js').read_text()
data_src = (JS / '01-data.js').read_text()
board_src = (JS / '06-board.js').read_text()


def seg_d2(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx or dy:
        t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
        if t > 1: ax, ay = bx, by
        elif t > 0: ax, ay = ax + dx * t, ay + dy * t
    dx, dy = px - ax, py - ay
    return dx * dx + dy * dy


class Ref:
    """Independent reference implementation, with bbox prefilters for speed."""

    def __init__(self, regions):
        self.rings = {}
        self.bbox = {}
        for r in regions:
            rs = [[tuple(map(float, q.split(','))) for q in part.rstrip('Z').split('L')]
                  for part in r['d'].split('M') if part]
            self.rings[r['n']] = rs
            xs = [p[0] for ring in rs for p in ring]
            ys = [p[1] for ring in rs for p in ring]
            self.bbox[r['n']] = (min(xs), min(ys), max(xs), max(ys))

    def contains(self, x, y):
        for nm, rs in self.rings.items():
            b = self.bbox[nm]
            if not (b[0] <= x <= b[2] and b[1] <= y <= b[3]):
                continue
            c = False
            for ring in rs:
                n = len(ring)
                for i in range(n):
                    ax, ay = ring[i]; bx, by = ring[(i + 1) % n]
                    if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                        c = not c
            if c:
                return nm
        return None

    def border_d2(self, nm, x, y):
        return min(seg_d2(x, y, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1])
                   for r in self.rings[nm] for i in range(len(r) - 1))

    def nearest(self, x, y, dead, cap):
        best, bd = None, cap * cap
        for nm in self.rings:
            if nm in dead:
                continue
            b = self.bbox[nm]
            gap = (max(b[0] - x, 0, x - b[2]) ** 2 + max(b[1] - y, 0, y - b[3]) ** 2)
            if gap > bd:
                continue
            d = self.border_d2(nm, x, y)
            if d < bd:
                bd, best = d, nm
        return best

    def resolve(self, x, y, dead, cap):
        u = self.contains(x, y)
        if u and u not in dead:
            return u
        return self.nearest(x, y, dead, cap)

    def distance(self, x, y, nm):
        return 0.0 if self.contains(x, y) == nm else math.sqrt(self.border_d2(nm, x, y))


def geometry_harness(regions, cases, dist_cases, anchor_cases, cap):
    blk = geo_src[geo_src.index('const SNAP_UNITS'):]
    blk = blk.replace(
        blk[blk.index('function stateUnder'):blk.index('function borderDist2')],
        'function stateUnder(u){ return polyHit(u.x, u.y); }\n\n')
    blk = blk.replace(
        blk[blk.index('function selectable'):blk.index('function segDist2')],
        'function selectable(name){ return !!name && !DEAD.has(name); }\n\n')
    blk = blk.replace("""function resolve(clientX, clientY) {
  const u = userPoint(clientX, clientY);
  if (!u) return null;
  const under = stateUnder(u, clientX, clientY);""",
"""function resolve(x, y) {
  const u = {x: x, y: y};
  const under = stateUnder(u);""")
    return (
        "const REGIONS = " + json.dumps([{'name': r['n'], 'd': r['d']} for r in regions]) + ";\n"
        "const REGION_NAMES = REGIONS.map(r => r.name);\n"
        "let DEAD = new Set();\n"
        "const shapes = new Proxy({}, { get: (_, n) => ({ isPointInFill: u => polyHit(u.x, u.y) === n }) });\n"
        "const CASES = " + json.dumps(cases) + ";\n"
        "const DIST = " + json.dumps(dist_cases) + ";\n"
        "const ANCHORS = " + json.dumps(anchor_cases) + ";\n"
        """
function polyHit(x, y){
  for (const s of REGIONS){
    let c = false;
    for (const part of s.d.split('M')){
      if(!part) continue;
      const r = part.replace(/Z$/,'').split('L').map(q => q.split(',').map(Number));
      for (let i = 0; i < r.length; i++){
        const [ax,ay] = r[i], [bx,by] = r[(i+1) % r.length];
        if ((ay > y) !== (by > y) && x < (bx-ax)*(y-ay)/(by-ay)+ax) c = !c;
      }
    }
    if (c) return s.name;
  }
  return null;
}
""" + blk + """
// borders are filled by compose() in the real thing; here the regions arrive
// already composed, so index them directly
borders = {};
for (const r of REGIONS) {
  borders[r.name] = r.d.split('M').filter(Boolean).map(ring => {
    const pairs = ring.replace(/Z$/, '').split('L');
    const a = new Float64Array(pairs.length * 2);
    for (let i = 0; i < pairs.length; i++) {
      const c = pairs[i].split(',');
      a[i*2] = +c[0]; a[i*2+1] = +c[1];
    }
    return a;
  });
}
CAN_HIT = true;
let fail = 0;
for (const [x, y, dead, want] of CASES){
  DEAD = new Set(dead);
  const got = resolve(x, y);
  if (got !== want){ fail++; if (fail <= 3) console.log('    resolve mismatch ('+x+','+y+') js='+got+' ref='+want); }
}
console.log('    resolve:    ' + (CASES.length - fail) + '/' + CASES.length + ' match the reference');
let dfail = 0;
DEAD = new Set();
for (const [x, y, nm, want] of DIST){
  if (Math.abs(distanceTo(nm, {x:x, y:y}) - want) > 1e-6) dfail++;
}
console.log('    distanceTo: ' + (DIST.length - dfail) + '/' + DIST.length + ' match the reference');
let afail = 0;
for (const [x, y, nm] of ANCHORS){
  if (resolve(x, y) !== nm) { afail++; if (afail <= 3) console.log('    anchor of ' + nm + ' resolves to ' + resolve(x, y)); }
}
console.log('    label anchors resolve to their own region: ' + (ANCHORS.length - afail) + '/' + ANCHORS.length);

/* The behaviour this replaced: a tap inside a solved region used to select
   nothing. Standing at each region's own anchor with only that region marked
   solved, a neighbour should now come back. */
let snapped = 0, stuck = 0;
for (const [x, y, nm] of ANCHORS){
  DEAD = new Set([nm]);
  const got = resolve(x, y);
  if (got === nm) stuck++;
  else if (got) snapped++;
}
DEAD = new Set();
console.log('    tapping a solved region snaps to a neighbour: ' + snapped + '/' + ANCHORS.length
  + (stuck ? '  (' + stuck + ' returned the solved region!)' : ''));
if (stuck) process.exitCode = 1;
process.exitCode = (fail || dfail || afail) ? 1 : 0;
""")


SNAP = int(geo_src.split('const SNAP_UNITS =')[1].split(';')[0])
map_src = (JS / '02-map.js').read_text()
LAYOUT = map_src[map_src.index('const SHORT ='):map_src.index('/* ---- composing')]


def layout_for(panels, aspect):
    """Run the game's own layout code. Not reimplemented here on purpose: a
    second copy would be a second thing to keep in step."""
    s = (LAYOUT + '\nconsole.log(JSON.stringify(chooseLayout('
         + repr(aspect) + ', ' + json.dumps(panels) + ')));')
    pathlib.Path('/tmp/fifty-layout.js').write_text(s)
    r = subprocess.run(['node', '/tmp/fifty-layout.js'], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr)
    return json.loads(r.stdout)


def composed(d, aspect):
    """Apply a layout to the stored panels, giving the flat space the game
    actually hit-tests in."""
    L = layout_for(d['panels'], aspect)
    out = []
    for r in d['regions']:
        at = L['place'][r['p']]
        parts = []
        for part in r['d'].split('M'):
            if not part:
                continue
            pts = [(float(a) * at['s'] + at['dx'], float(b) * at['s'] + at['dy'])
                   for a, b in (q.split(',') for q in part.rstrip('Z').split('L'))]
            parts.append('M' + 'L'.join(f'{x:.3f},{y:.3f}' for x, y in pts) + 'Z')
        out.append({'n': r['n'], 'd': ''.join(parts), 'p': r['p'],
                    'l': [r['l'][0] * at['s'] + at['dx'], r['l'][1] * at['s'] + at['dy']]})
    return L, out


# ------------------------------------------------- layout invariants
# The first version of arrange() mixed up rows and columns for side placement,
# sized the inset block against the wrong axis and pushed it off the frame. That
# is invisible in numbers unless something checks for it.
print('layout invariants')
bad = 0
for geo in GEOS:
    d = json.loads((ROOT / 'data' / f'{geo}.json').read_text())
    for aspect in (0.35, 0.5, 0.603, 0.8, 1.0, 1.3, 1.878, 3.1, 5.0):
        L, regs = composed(d, aspect)
        xs = []; ys = []
        for r in regs:
            for part in r['d'].split('M'):
                if not part:
                    continue
                for q in part.rstrip('Z').split('L'):
                    a, b = q.split(',')
                    xs.append(float(a)); ys.append(float(b))
        if min(xs) < -0.5 or max(xs) > L['W'] + 0.5 or min(ys) < -0.5 or max(ys) > L['H'] + 0.5:
            bad += 1
            print(f'  FAIL {geo} aspect {aspect}: ink {min(xs):.0f}..{max(xs):.0f} x '
                  f'{min(ys):.0f}..{max(ys):.0f} outside frame {L["W"]:.0f}x{L["H"]:.0f}')
        # panel boxes, for overlap
        per = {}
        for r in regs:
            for part in r['d'].split('M'):
                if not part:
                    continue
                for q in part.rstrip('Z').split('L'):
                    a, b = map(float, q.split(','))
                    bb = per.setdefault(r['p'], [a, b, a, b])
                    bb[0] = min(bb[0], a); bb[1] = min(bb[1], b)
                    bb[2] = max(bb[2], a); bb[3] = max(bb[3], b)
        # Fixed panels are exempt: they sit inside panel 0's box on purpose, in
        # space the projection reserved for them, so their ink boxes overlap the
        # mainland's while the ink itself does not. The invariant that matters
        # for them is checked separately below.
        keys = sorted(k for k in per if not d['panels'][k].get('fix'))
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                x0, y0, x1, y1 = per[keys[i]]; a0, b0, a1, b1 = per[keys[j]]
                if not (x1 <= a0 or a1 <= x0 or y1 <= b0 or b1 <= y0):
                    bad += 1
                    print(f'  FAIL {geo} aspect {aspect}: panels {keys[i]} and {keys[j]} overlap')

        # A fixed panel must land exactly where panel 0's transform puts it —
        # that is the whole promise of `fix`, and the thing that would break if
        # the packer ever started seeing these panels.
        m = L['place'][0]
        for k, panel in enumerate(d['panels']):
            if not panel.get('fix'):
                continue
            f = panel['fix']
            want = (m['s'] * f['s'], m['dx'] + f['x'] * m['s'], m['dy'] + f['y'] * m['s'])
            got = L['place'][k]
            if max(abs(want[0] - got['s']), abs(want[1] - got['dx']),
                   abs(want[2] - got['dy'])) > 1e-9:
                bad += 1
                print(f'  FAIL {geo} aspect {aspect}: fixed panel {k} placed at '
                      f'{got} not {want}')
print(f'  {"FAILED" if bad else "all panels inside the frame and non-overlapping, "
      f"{len(GEOS) * 9} layouts"}')
fails += 1 if bad else 0

random.seed(7)

for geo in GEOS:
    d = json.loads((ROOT / 'data' / f'{geo}.json').read_text())
    L, regions = composed(d, 0.603)          # a portrait phone
    names = [r['n'] for r in regions]
    vx, vy, vw, vh = 0.0, 0.0, L['W'], L['H']
    print(f'{geo}: {len(regions)} regions, {len(d["panels"])} panel(s), '
          f'composed frame {vw:.0f}x{vh:.0f}')
    ref = Ref(regions)

    n_cases = 120 if geo == 'us' else 60
    cases = []
    for _ in range(n_cases):
        x = round(random.uniform(vx, vx + vw), 1)
        y = round(random.uniform(vy, vy + vh), 1)
        dead = set(random.sample(names, random.choice([0, 0, 3, 10, len(names) // 4])))
        cases.append((x, y, sorted(dead), ref.resolve(x, y, dead, SNAP)))

    dist_cases = []
    for _ in range(30):
        x = round(random.uniform(vx, vx + vw), 1)
        y = round(random.uniform(vy, vy + vh), 1)
        nm = random.choice(names)
        dist_cases.append((x, y, nm, round(ref.distance(x, y, nm), 6)))
    for r in regions[:6]:
        dist_cases.append((r['l'][0], r['l'][1], r['n'], 0.0))

    anchors = [(r['l'][0], r['l'][1], r['n']) for r in regions]

    p = pathlib.Path(f'/tmp/fifty-geom-{geo}.js')
    p.write_text(geometry_harness(regions, cases, dist_cases, anchors, SNAP))
    r = subprocess.run(['node', str(p)], capture_output=True, text=True)
    print(r.stdout.rstrip() or r.stderr)
    fails += r.returncode

# ------------------------------------------------------- lift-off resolution
settle = lens_src[lens_src.index('function settle()'):lens_src.index('\nfunction closeLens')]
pathlib.Path('/tmp/fifty-settle.js').write_text(
    "const GUARD_MS = 180, DWELL_MS = 120;\nlet trail = [], NOW = 0;\n"
    + ('function settle(){' + settle.split('{', 1)[1]).replace('const now = Date.now();', 'const now = NOW;')
    + """
const CASES = [
  ['twitch on lift discarded',   [['Rhode Island',0,600],['Connecticut',600,660]], 660, 'Rhode Island'],
  ['deliberate final choice',    [['Rhode Island',0,300],['Connecticut',300,700]], 700, 'Connecticut'],
  ['drag-through ignored',       [['New York',0,80],['Vermont',80,140],['New Hampshire',140,900]], 900, 'New Hampshire'],
  ['no dwell -> state at cutoff',[['Maine',0,60],['Vermont',60,120],['New York',120,160]], 200, 'Maine'],
  ['lift over water cancels',    [['Delaware',0,500],[null,500,900]], 900, null],
  ['water twitch discarded',     [['Delaware',0,700],[null,700,760]], 760, 'Delaware'],
  ['instant lift',               [['Texas',0,90]], 90, 'Texas'],
];
let fail = 0;
for (const [label, segs, now, want] of CASES){
  trail = segs.map(s => ({name: s[0], t0: s[1], t1: s[2]}));
  NOW = now;
  if (settle() !== want){ fail++; console.log('  settle FAIL ' + label); }
}
console.log('settle:  ' + (CASES.length - fail) + '/' + CASES.length + ' pass');
process.exitCode = fail ? 1 : 0;
""")
r = subprocess.run(['node', '/tmp/fifty-settle.js'], capture_output=True, text=True)
print(r.stdout.rstrip() or r.stderr)
fails += r.returncode

# --------------------------------------------------- distance scoring
# What a miss costs, on the 0..100 scale where 100 is the full width of the
# geography. Checked against a reference that never touches the layout: the
# score must not depend on the shape of the window, which is the one thing that
# could silently go wrong when a yardstick is carried through a transform.
drift_js = geo_src[geo_src.index('function driftCost'):geo_src.index('function nearestSelectable')]
bad_drift = n_drift = 0
for geo in GEOS:
    d = json.loads((ROOT / 'data' / f'{geo}.json').read_text())
    names = [r['n'] for r in d['regions']]
    rnd = random.Random(7)
    pairs = [(rnd.choice(names), rnd.choice(names)) for _ in range(60)]

    panel = {r['n']: r['p'] for r in d['regions']}
    pts = {r['n']: [tuple(map(float, q.split(',')))
                    for part in r['d'].split('M') if part
                    for q in part.rstrip('Z').split('L')] for r in d['regions']}
    anchor_at = {r['n']: tuple(r['l']) for r in d['regions']}

    def ref(t, m):
        """Nearest vertex rather than nearest edge, so it is an upper bound on
        the real answer and cannot silently agree by sharing a bug."""
        if panel[t] != panel[m]:
            return 200.0
        ax, ay = anchor_at[m]
        near = min(math.hypot(px - ax, py - ay) for px, py in pts[t])
        return min(200.0, 100 * near / d['panels'][panel[t]]['span'])

    # two aspect ratios: the score must come out the same in both
    for aspect in (0.6, 2.4):
        js = (LAYOUT + '\nconst DATA = ' + json.dumps(d) + ';\n' + """
const FAR = 200;
const GEO = {panels: DATA.panels};
const panelOf = {}, anchorAt = {}, rings = {};
const layoutNow = chooseLayout(ASPECT, DATA.panels);
for (const r of DATA.regions){
  panelOf[r.n] = r.p;
  const at = layoutNow.place[r.p];
  anchorAt[r.n] = {x: r.l[0]*at.s + at.dx, y: r.l[1]*at.s + at.dy};
  rings[r.n] = r.d.split('M').filter(Boolean).map(p =>
    p.replace(/Z$/,'').split('L').map(q => q.split(',').map(Number))
      .map(c => [c[0]*at.s + at.dx, c[1]*at.s + at.dy]));
}
const CAN_HIT = false;
function seg(px,py,ax,ay,bx,by){let dx=bx-ax,dy=by-ay;
  if(dx||dy){const t=((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy);
  if(t>1){ax=bx;ay=by;}else if(t>0){ax+=dx*t;ay+=dy*t;}}
  dx=px-ax;dy=py-ay;return dx*dx+dy*dy;}
function borderDist2(n,u){let b=Infinity;
  for(const ring of rings[n]) for(let i=0;i<ring.length;i++){
    const a=ring[i], c=ring[(i+1)%ring.length];
    b=Math.min(b, seg(u.x,u.y,a[0],a[1],c[0],c[1]));}
  return b;}
function distanceTo(n,u){return Math.sqrt(borderDist2(n,u));}
""".replace('ASPECT', repr(aspect)) + drift_js + """
const OUT = [];
for (const pr of PAIRS) OUT.push(driftCost(pr[0], pr[1], anchorAt[pr[1]]));
console.log(JSON.stringify(OUT));
""".replace('PAIRS', json.dumps(pairs)))
        pathlib.Path('/tmp/fifty-drift.js').write_text(js)
        r = subprocess.run(['node', '/tmp/fifty-drift.js'], capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(r.stderr)
        got = json.loads(r.stdout)
        if aspect == 0.6:
            first = got
        for g, (t, m) in zip(got, pairs):
            n_drift += 1
            if abs(g - ref(t, m)) > 0.5:
                bad_drift += 1
                print(f'  drift FAIL {geo} {m} -> {t}: {g:.2f} not {ref(t, m):.2f}')
        # Not exact equality: the same ratio computed through two different
        # transforms differs in the last bits of a double. A hundredth of a
        # point is far below what is ever displayed.
        drift_shift = max(abs(g - f) for g, f in zip(got, first))
        if drift_shift > 0.01:
            bad_drift += 1
            print(f'  drift FAIL {geo}: score moved {drift_shift:.4f} '
                  f'with the window shape')
        n_drift += 1

    # the scale has to mean something at both ends
    same = [(t, m) for t, m in pairs if panel[t] == panel[m]]
    n_drift += 2
    if not any(ref(t, m) < 20 for t, m in same):
        bad_drift += 1; print(f'  drift FAIL {geo}: nothing scores as near')
    if not any(ref(t, m) > 50 for t, m in same):
        bad_drift += 1; print(f'  drift FAIL {geo}: nothing scores as far')
print(f'drift:   {n_drift - bad_drift}/{n_drift} pass')
fails += 1 if bad_drift else 0

# --------------------------------------------------- the arrow across a gap
# The bug this guards: with the US on a single panel, every region counted as one
# landmass, so a miss on Texas when asked for Hawaii drew an arrow pointing down
# — true of the picture, false of the world. Alaska and Hawaii are now fixed
# panels of their own, and the rule has something to bite on.
cel_src = (JS / '07-celebrate.js').read_text()
can = cel_src[cel_src.index('function canNudge'):]
can = can[:can.index('\n}\n') + 3]

# Named rather than derived from the data: deriving the pairs would make the test
# agree with whatever the panels happen to say, which is exactly the thing that
# was wrong. These are geographic facts, and the data has to match them.
APART = {
    'us': [('Hawaii', 'Texas'), ('Alaska', 'Texas'), ('Alaska', 'Hawaii'),
           ('Hawaii', 'California'), ('Alaska', 'Washington')],
    'fr': [('Guadeloupe', 'Ain'), ('Guyane', 'Nord'), ('Mayotte', 'La Réunion'),
           ('Martinique', 'Guadeloupe'), ('La Réunion', 'Paris')],
}
TOGETHER = {
    'us': [('Texas', 'Oklahoma'), ('California', 'Maine')],
    'fr': [('Ain', 'Nord'), ('Paris', 'Corse-du-Sud')],
}

bad_apart = 0
for geo, pairs in APART.items():
    d = json.loads((ROOT / 'data' / f'{geo}.json').read_text())
    panel = {r['n']: r['p'] for r in d['regions']}
    for a_, b_ in pairs + TOGETHER[geo]:
        want_same = (a_, b_) in TOGETHER[geo]
        got_same = panel[a_] == panel[b_]
        if got_same != want_same:
            bad_apart += 1
            print(f'  panels FAIL {geo}: {a_} and {b_} '
                  + ('should share a panel' if want_same else 'share a panel'))
n_apart = sum(len(v) for v in APART.values()) + sum(len(v) for v in TOGETHER.values())
print(f'panels:  {n_apart - bad_apart}/{n_apart} pass')
fails += 1 if bad_apart else 0

CASES = []
for geo in GEOS:
    d = json.loads((ROOT / 'data' / f'{geo}.json').read_text())
    panel = {r['n']: r['p'] for r in d['regions']}
    by_panel = {}
    for n, p in panel.items():
        by_panel.setdefault(p, []).append(n)
    same = [tuple(sorted(names)[:2]) for names in by_panel.values()
            if len(names) > 1]
    across = []
    keys = sorted(by_panel)
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            across.append((sorted(by_panel[keys[i]])[0], sorted(by_panel[keys[j]])[0]))
    CASES.append((geo, panel, same, across))

pathlib.Path('/tmp/fifty-nudge.js').write_text(
    'let panelOf = {}, anchorAt = {};\n' + can + """
let fail = 0, n = 0;
for (const [geo, panel, same, across] of CASES){
  panelOf = panel;
  anchorAt = {};
  for (const k of Object.keys(panel)) anchorAt[k] = {x: 0, y: 0};
  for (const [a, b] of same){
    n++;
    if (canNudge(a, b) !== true){
      fail++; console.log(`  nudge FAIL ${geo}: ${a} -> ${b} same panel, refused`);
    }
  }
  for (const [a, b] of across){
    n++;
    if (canNudge(a, b) !== false){
      fail++; console.log(`  nudge FAIL ${geo}: ${a} -> ${b} across panels, allowed`);
    }
  }
  // and with no anchor yet, nothing can be pointed at
  anchorAt = {};
  n++;
  if (canNudge(same[0][0], same[0][1]) !== false){
    fail++; console.log(`  nudge FAIL ${geo}: pointed with no anchors`);
  }
}
console.log('nudge:   ' + (n - fail) + '/' + n + ' pass');
process.exitCode = fail ? 1 : 0;
""".replace('CASES', json.dumps(CASES)))
r = subprocess.run(['node', '/tmp/fifty-nudge.js'], capture_output=True, text=True)
print(r.stdout.rstrip() or r.stderr)
fails += r.returncode

# --------------------------------------------------- modes and board keying
pathlib.Path('/tmp/fifty-modes.js').write_text(
    "let TOTAL = 50;\nlet GEO = {id:'us', all:'All fifty', noun:'state'};\n"
    + data_src[data_src.index('const MODES = {'):]
    + board_src[board_src.index('const LEGACY_US'):board_src.index('/* One key-value layer')]
    + board_src[board_src.index('const errorsOf'):board_src.index('const addEntry')]
    + board_src[board_src.index('function missWords'):board_src.index('function rowParts')]
    + """
const addEntry = (board, entry) => MODE.insert(board, entry);
let fail = 0;
const eq = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log('  FAIL ' + l + '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };

MODE = MODES.practice;
let pb = [];
[[7,300],[3,400],[7,250],[0,900],[3,500],[12,100]].forEach(([e,t],i) => {
  pb = addEntry(pb, {f:50,e:e,t:t*1000,d:i}).board; });
eq('practice: one entry per miss count', rankBoard(pb.slice()).map(r=>[r.e,r.t/1000]),
   [[0,900],[3,400],[7,250],[12,100]]);
eq('practice: quicker replaces same count', pb.find(r=>r.e===7).t/1000, 250);
eq('practice: misses may exceed the region count', addEntry([], {f:50,e:73,t:1,d:1}).board[0].e, 73);
eq('practice: uncapped', MODES.practice.capped, false);
eq('practice: budget is infinite', budget(), Infinity);

MODE = MODES.trial;
let cb = [];
[[50,2,100],[50,0,500],[31,3,200],[50,1,300],[31,3,150],[0,3,9]].forEach(([f,e,t],i) => {
  cb = addEntry(cb, {f:f,e:e,t:t*1000,d:i}).board; });
eq('trial: one entry per partial tally', cb.filter(r=>r.f===31).map(r=>r.t/1000), [150]);
eq('trial: full runs by misses then time', rankBoard(cb.slice()).filter(r=>r.f===50).map(r=>r.e), [0,1,2]);
eq('trial: zero-region run does not post', cb.some(r=>r.f===0), false);

// every geography, mode and scoring gets its own board, and counting keeps the
// old keys so boards saved before this feature survive
const keys = [];
for (const sc of ['count','drift'])
  for (const g of ['us','fr']) for (const m of ['trial','practice']) {
    GEO = {id:g}; MODE = MODES[m]; SCORING = SCORINGS[sc]; keys.push(boardKey());
  }
SCORING = SCORINGS.count; MODE = MODES.trial;
eq('board keys unchanged for counting', keys.slice(0,4),
   ['fifty:board2','fifty:practice1','fifty:fr:trial','fifty:fr:practice']);
eq('distance boards are separate', keys.slice(4),
   ['fifty:us:trial:drift','fifty:us:practice:drift',
    'fifty:fr:trial:drift','fifty:fr:practice:drift']);

// --- the scoring axis -----------------------------------------------------
eq('a trial spends three misses', (MODE = MODES.trial, SCORING = SCORINGS.count, budget()), 3);
eq('or one full map', (SCORING = SCORINGS.drift, budget()), 100);
eq('a counted miss always costs one', SCORINGS.count.cost(), 1);

// Distance dominates clues rather than adding to them: one miss can cost 90 and
// a clue costs 1, so a sum would be the distance with noise on top.
SCORING = SCORINGS.drift; MODE = MODES.practice;
eq('distance outranks clues', rankBoard([
  {f:50,e:40,c:0,t:100,d:1}, {f:50,e:5,c:9,t:900,d:2},
]).map(r=>r.d), [2,1]);
eq('clues break a distance tie', rankBoard([
  {f:50,e:12,c:4,t:100,d:1}, {f:50,e:12,c:1,t:900,d:2},
]).map(r=>r.d), [2,1]);
eq('perfect reads as perfect', missWords(0), 'Perfect');
eq('and a miss reads as a distance', missWords(37), 'Off by 37');
SCORING = SCORINGS.count;
eq('counting still reads as misses', missWords(2), '2 misses');
SCORING = SCORINGS.count; MODE = MODES.practice;
// clues count as help alongside misses, and bucket with them
MODE = MODES.practice;
eq('clues rank with misses', rankBoard([
  {f:50,e:0,c:6,t:1000,d:1}, {f:50,e:2,c:0,t:9000,d:2}, {f:50,e:0,c:0,t:9999,d:3},
]).map(r=>r.d), [3,2,1]);
eq('same misses, fewer clues wins', rankBoard([
  {f:50,e:1,c:3,t:100,d:1}, {f:50,e:1,c:0,t:900,d:2},
]).map(r=>r.d), [2,1]);
let bb = addEntry([{f:50,e:1,c:1,t:900,d:1}], {f:50,e:1,c:1,t:400,d:2});
eq('same misses and clues replaces on time', [bb.kept, bb.board.length, bb.board[0].d], [true,1,2]);
bb = addEntry([{f:50,e:1,c:1,t:400,d:1}], {f:50,e:1,c:0,t:900,d:2});
eq('different clue count is its own entry', bb.board.length, 2);
eq('missing clue count reads as zero', cluesOf({f:50,e:1,t:1}), 0);
eq('board keys are all distinct', new Set(keys).size, 8);
console.log('modes:   ' + (fail ? fail + ' FAILED' : '25/25 pass'));
process.exitCode = fail ? 1 : 0;
""")
r = subprocess.run(['node', '/tmp/fifty-modes.js'], capture_output=True, text=True)
print(r.stdout.rstrip() or r.stderr)
fails += r.returncode

sys.exit(1 if fails else 0)
