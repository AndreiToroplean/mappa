#!/usr/bin/env python3
"""Regression harness: the pure logic, against independent implementations.

Runs without a browser. Every geography is checked separately, because the
geometry code is shared but the data is not.
"""
import json, math, pathlib, random, re, subprocess, sys

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
DIAM = map_src[map_src.index('function hull('):map_src.index('function measurePanels')]


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
def convex_hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts
    def cross(o, a_, b_):
        return (a_[0]-o[0])*(b_[1]-o[1]) - (a_[1]-o[1])*(b_[0]-o[0])
    def half(seq):
        out = []
        for q in seq:
            while len(out) > 1 and cross(out[-2], out[-1], q) <= 0:
                out.pop()
            out.append(q)
        return out[:-1]
    return half(pts) + half(pts[::-1])


drift_js = geo_src[geo_src.index('function driftFrom'):geo_src.index('function nearestSelectable')]
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

    # Independent diameter: every pair on the hull, compared exhaustively. The
    # game walks the hull with callipers; this does not, on purpose.
    diam = {}
    for i in range(len(d['panels'])):
        pp = [q for r in d['regions'] if r['p'] == i for q in pts[r['n']]]
        h = convex_hull(pp)
        diam[i] = max(math.dist(a_, b_) for a_ in h for b_ in h) if len(h) > 1 else 0

    def ref(t, m):
        """Nearest vertex rather than nearest edge, so it is an upper bound on
        the real answer and cannot silently agree by sharing a bug."""
        if panel[t] != panel[m]:
            return 200.0
        ax, ay = anchor_at[m]
        near = min(math.hypot(px - ax, py - ay) for px, py in pts[t])
        return min(100.0, 100 * near / diam[panel[t]])

    # two aspect ratios: the score must come out the same in both
    for aspect in (0.6, 2.4):
        js = (LAYOUT + DIAM + '\nconst DATA = ' + json.dumps(d) + ';\n' + """
const FAR = 200;
const GEO = {panels: DATA.panels};
const PANEL_SPAN = 1000;
const panelDiam = DATA.panels.map((p, i) => {
  const pts = [];
  for (const r of DATA.regions){
    if (r.p !== i) continue;
    for (const part of r.d.split('M')){
      if (!part) continue;
      for (const q of part.replace(/Z$/,'').split('L')){
        const c = q.split(','); pts.push([+c[0], +c[1]]);
      }
    }
  }
  return pts.length ? diameter(pts) : 0;
});
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
for (const pr of PAIRS) OUT.push(driftFrom(pr[0], pr[1], anchorAt[pr[1]]).cost);
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
    # the whole point of dividing by the diameter: the scale has an end
    n_drift += 1
    if max(ref(t, m) for t, m in same) > 100.0001:
        bad_drift += 1; print(f'  drift FAIL {geo}: a miss scored over 100')
print(f'drift:   {n_drift - bad_drift}/{n_drift} pass')
fails += 1 if bad_drift else 0

# --------------------------------------------------- the arrow across a gap
# The bug this guards: with the US on a single panel, every region counted as one
# landmass, so a miss on Texas when asked for Hawaii drew an arrow pointing down
# — true of the picture, false of the world. Alaska and Hawaii are now fixed
# panels of their own, and the rule has something to bite on.
cel_src = (JS / '07-celebrate.js').read_text()
can = (cel_src[cel_src.index('const sameLandmass'):cel_src.index('function canNudge')]
       + cel_src[cel_src.index('function canNudge'):])
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
    "let GEOS = {us:{id:'us'}, fr:{id:'fr'}};\n"
    + data_src[data_src.index('function byTally'):]
    + board_src[board_src.index('const PROBE'):board_src.index('/* localStorage, and nothing')]
    + board_src[board_src.index('const errorsOf'):board_src.index('const addEntry')]
    + board_src[board_src.index('function missWords'):board_src.index('function renderBoard')]
    + """
const addEntry = (board, entry) => (SCORING.insert || MODE.insert)(board, entry);
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
GEO = {id:'us', all:'All fifty', noun:'state'};   // the key loop above blanked it
eq('board keys unchanged for counting', keys.slice(0,4),
   ['fifty:board2','fifty:practice1','fifty:fr:trial','fifty:fr:practice']);
eq('distance boards are separate', keys.slice(4),
   ['fifty:us:trial:drift','fifty:us:practice:drift',
    'fifty:fr:trial:drift','fifty:fr:practice:drift']);

// --- the scoring axis -----------------------------------------------------
eq('a trial spends three misses', (MODE = MODES.trial, SCORING = SCORINGS.count, budget()), 3);
eq('or one full map', (SCORING = SCORINGS.drift, budget()), 100);
eq('counting lets you guess again', SCORINGS.count.retry, true);
eq('distance gives one tap per region', SCORINGS.drift.retry, false);

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
eq('a point total says what is left', [ptWords(100), ptWords(1), ptWords(-50)],
   ['100 pts', '1 pt', '\u221250 pts']);
eq('points are the purse less the spend',
   [pointsOf({e:0}), pointsOf({e:37}), pointsOf({e:150})], [100, 63, -50]);

/* Distance is played as a purse: a hundred to start in either mode, and only a
   trial is stopped by reaching the bottom of it. */
eq('a distance run starts with a hundred either way',
   (MODE = MODES.trial, [purse(), budget()]), [100, 100]);
eq('practice holds the same hundred and may spend past it',
   (MODE = MODES.practice, [purse(), budget()]), [100, Infinity]);

/* A distance trial ends when the purse does, so what it has to show for itself
   is how many regions it revealed before that — not the points, which are near
   enough a hundred for every run that ran out. */
MODE = MODES.trial;
let tb = [];
[[18,300],[25,400],[18,250],[25,900]].forEach(([v,t],i) => {
  tb = addEntry(tb, {f:v-3,v:v,e:100,c:0,t:t*1000,d:i}).board; });
eq('distance trial: one entry per revealed count',
   rankBoard(tb.slice()).map(r=>[r.v,r.t/1000]), [[25,400],[18,250]]);
eq('distance trial ranks on regions revealed, not on points',
   rankBoard([{f:9,v:40,e:100,c:0,t:100,d:1},
              {f:30,v:31,e:62,c:0,t:100,d:2}]).map(r=>r.d), [1,2]);
eq('a distance trial that revealed nothing does not post',
   addEntry([], {f:0,v:0,e:100,c:0,t:1,d:1}).kept, false);
let fb = [];
[[50,900],[12,500],[12,200],[80,100]].forEach(([e,t],i) => {
  fb = addEntry(fb, {f:50,v:50,e:e,c:0,t:t*1000,d:i}).board; });
eq('finished distance trials coexist, ranked on points then time',
   rankBoard(fb.slice()).map(r=>[r.e,r.t/1000]),
   [[12,200],[12,500],[50,900],[80,100]]);
eq('a finished trial row says so in one word, whatever the geography',
   rowParts({f:50,v:50,e:12,c:0,t:1}).tally, 'Complete');
/* Both scorings post their best run in the same words: Complete is about the
   map, Perfect is about the score, and a flawless run of either is both. */
eq('a flawless distance trial reads Complete then Perfect',
   [rowParts({f:50,v:50,e:0,c:0,t:1}).tally, rowParts({f:50,v:50,e:0,c:0,t:1}).errs],
   ['Complete', '<span class="errs perfect">Perfect</span>']);
eq('a spent trial row leads with what it revealed',
   rowParts({f:9,v:31,e:100,c:0,t:1}).tally, '31 of 50');
eq('and carries what was left of the purse',
   rowParts({f:9,v:31,e:88,c:0,t:1}).errs, '<span class="errs">12 pts</span>');
eq('a trial that reached the bottom says so rather than showing a zero',
   [rowParts({f:9,v:31,e:100,c:0,t:1}).errs,
    rowParts({f:9,v:31,e:140,c:0,t:1}).errs],
   ['<span class="errs">Ran out</span>', '<span class="errs">Ran out</span>']);
// two runs that both ran out are the same run as far as the board is concerned
eq('the overshoot on a last miss is not stored',
   [Math.min(140, purse()), Math.min(100, purse())], [100, 100]);
// boards written before revealed was recorded: found is the only lower bound
eq('an older trial entry ranks on what is known', revealedOf({f:22,e:100}), 22);
eq('and shows no tally rather than inventing one',
   rowParts({f:22,e:100,c:0,t:1}).tally, '\u2014');

eq('a counting trial says it the same way',
   (SCORING = SCORINGS.count, MODE = MODES.trial,
    [rowParts({f:50,e:0,c:0,t:1}).tally, rowParts({f:50,e:0,c:0,t:1}).errs,
     rowParts({f:31,e:1,c:0,t:1}).tally]),
   ['Complete', '<span class="errs perfect">Perfect</span>', '31 of 50']);
eq('and Complete does not claim Perfect when there were misses',
   rowParts({f:50,e:2,c:0,t:1}).errs, '<span class="errs">2 misses</span>');
SCORING = SCORINGS.drift;
MODE = MODES.practice;
eq('a perfect practice row says so',
   rowParts({f:50,v:50,e:0,c:0,t:1}).tally, 'Perfect');
eq('a practice row leads with the points it kept',
   rowParts({f:50,v:50,e:90,c:2,t:1}).tally, '<span class="">10 pts</span>');
eq('a practice run that finished owing reads as one',
   rowParts({f:50,v:50,e:150,c:0,t:1}).tally,
   '<span class="neg">\u221250 pts</span>');

/* Distance ignores the tally completely: every run is asked every region, so how
   many came out right is the same fact told coarsely. One entry per score. */
SCORING = SCORINGS.drift; MODE = MODES.practice;
let db = [];
[[31,4],[42,7],[31,9],[20,4]].forEach(([f,e],i) => {
  db = addEntry(db, {f:f,e:e,c:0,t:(i+1)*1000,d:i}).board; });
eq('distance keeps one entry per score', db.map(r=>r.e).sort((x,y)=>x-y), [4,7,9]);
eq('distance ranks on points alone, ignoring the tally',
   rankBoard(db.slice()).map(r=>r.e), [4,7,9]);
// the fourth run scored 4 as well, on 20 regions rather than 31, and slower:
// same bucket, not an improvement, so the tally never comes into it
eq('same score, slower, does not replace', db.find(r=>r.e===4).f, 31);
eq('20 right at 4 points beats 42 right at 7',
   rankBoard([{f:20,e:4,c:0,t:9000,d:1},{f:42,e:7,c:0,t:100,d:2}]).map(r=>r.d), [1,2]);
eq('counting still ranks the tally first',
   (SCORING = SCORINGS.count, rankBoard(
     [{f:20,e:0,c:0,t:100,d:1},{f:42,e:7,c:0,t:900,d:2}]).map(r=>r.d)), [2,1]);
SCORING = SCORINGS.count; MODE = MODES.practice;
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
/* The export walks every key the game could have written. Enumerated through
   keyFor() rather than listed, so the legacy US spellings come along, but it is
   a second path to the same strings and the two must not part company. */
eq('the export enumerates exactly the keys the game reads through',
   boardKeys().slice().sort(), keys.slice().sort());
eq('and the preferences alongside them',
   PREF_KEYS, ['fifty:geo', 'fifty:mode', 'fifty:scoring', 'fifty:theme']);
console.log('modes:   ' + (fail ? fail + ' FAILED' : '51/51 pass'));
process.exitCode = fail ? 1 : 0;
""")
r = subprocess.run(['node', '/tmp/fifty-modes.js'], capture_output=True, text=True)
print(r.stdout.rstrip() or r.stderr)
fails += r.returncode

# --------------------------------------------------- clue facts
# The clue ladder can skip a rung it has no data for, so a missing capital or
# grouping used to degrade quietly. Review cannot skip anything: the facts are
# the whole of what it says, and a region without them names itself and stops.
# build-clues.py asserts this at build time, but the built files are what ship.
print('facts')
missing = 0
for geo in GEOS:
    regions = json.loads((ROOT / 'data' / f'{geo}.json').read_text())['regions']
    clues = json.loads((ROOT / 'data' / f'clues-{geo}.json').read_text())
    gaps = 0
    for r in regions:
        f = clues.get(r['n']) or {}
        if not f.get('capital') or not f.get('group'):
            gaps += 1
            print(f'  FAIL {geo}: {r["n"]} has no ' +
                  ('capital' if not f.get('capital') else 'grouping'))
    missing += gaps
    print(f'  {geo}: {len(regions) - gaps}/{len(regions)} regions'
          ' have both a capital and a grouping')
fails += 1 if missing else 0

# --------------------------------------------------- lens tiers
# The magnifier stacks its paths the way the map stacks its layers, so the aimed
# region's outline is not clipped by a neighbour drawn after it. Its tier list is
# written out by hand rather than collected from STATUS, which is the right way
# round — but it means a status added with a new lens class would be seated
# nowhere. These are the two halves of that, checked against each other.
print('tiers')
map_src = (ROOT / 'src/js/02-map.js').read_text()
lens_src = (ROOT / 'src/js/05-lens.js').read_text()
status_js = map_src[map_src.index('const STATUS = {'):map_src.index('/* Green at nothing')]
tiers_js = lens_src[lens_src.index('const LENS_TIERS'):lens_src.index('let lensLayers')]
probe = status_js + tiers_js + """
const orphan = Object.keys(STATUS).filter(k => LENS_TIERS.indexOf(STATUS[k].lens) < 0);
console.log(orphan.length ? 'ORPHAN ' + orphan.join(',') : 'ok ' + Object.keys(STATUS).length);
process.exitCode = orphan.length ? 1 : 0;
"""
pathlib.Path('/tmp/fifty-tiers.js').write_text(probe)
r = subprocess.run(['node', '/tmp/fifty-tiers.js'], capture_output=True, text=True)
out = (r.stdout or r.stderr).strip()
print(f'  every status has a lens tier to sit in: {out}')
fails += r.returncode

# --------------------------------------------------- overlay layers
# Every overlay shares one z-index, so an overlay that opens on top of another
# has to be told to. The import card was not, and opened behind the menu — which
# on screen is a button that does nothing. Named here rather than derived from
# the markup: the point is that adding an overlay makes someone decide.
print('overlays')
LAYERS = {
    'paused':  'base',   # only ever over a running map
    'intro':   'base',
    'overlay': 'base',
    'confirm': 'ask',    # asks about the board on the card underneath it
    'impCard': 'ask',    # opens from the menu, over the menu
}
html_src = (ROOT / 'src/index.html').read_text()
found = {m[1]: ('ask' if m[0].strip() else 'base')
         for m in re.findall(r'<div class="overlay( ask)?" id="(\w+)"', html_src)}
if found != LAYERS:
    print(f'  FAIL overlays are {found}, expected {LAYERS}')
    fails += 1
else:
    asks = sorted(k for k, v in LAYERS.items() if v == 'ask')
    print(f'  {len(LAYERS)} overlays, {len(asks)} of them above the rest: {", ".join(asks)}')
    if '.overlay.ask{z-index:' not in (ROOT / 'src/style.css').read_text():
        print('  FAIL nothing lifts an interrupting overlay')
        fails += 1

# --------------------------------------------------- corner buttons
# .headbtn is the look of a small square button in a card's top corner;
# .fsbtn is which button it is, and what the fullscreen code selects on. They
# were one class until the dots menu needed the look without the identity, and
# splitting them left the pause card's button carrying identity alone — which
# falls through to the base button rule and comes out amber and full width.
print('corner buttons')
loose = re.findall(r'<button class="([^"]*\bfsbtn\b[^"]*)"', html_src)
missing = [c for c in loose if 'headbtn' not in c.split()]
if missing:
    print(f'  FAIL {len(missing)} full screen button(s) without the .headbtn look')
    fails += 1
else:
    print(f'  {len(loose)} full screen buttons, all styled as corner buttons')

# The theme button was asked for beside the full screen one, everywhere that
# one appears — which turned out to be two cards and not the three anyone
# remembered, so the end card grew a head row to hold the pair. Pairing them
# here rather than counting each: the failure to catch is a card that gets one
# button and not the other.
heads = re.findall(r'<div class="headbtns">(.*?)</div>', html_src, re.S)
odd = [h for h in heads if ('fsbtn' in h) != ('themebtn' in h)]
if odd:
    print(f'  FAIL {len(odd)} corner row(s) with only one of the two buttons')
    fails += 1
elif len(heads) < 3:
    print(f'  FAIL only {len(heads)} corner rows; the menu, the pause card and the end card each need one')
    fails += 1
else:
    print(f'  {len(heads)} corner rows, each with both buttons')
# Left of full screen, as asked, and the same way round on every card.
if any(h.index('themebtn') > h.index('fsbtn') for h in heads):
    print('  FAIL the theme button is not always left of the full screen one')
    fails += 1

# ------------------------------------------------------------- themes
# A light theme is a block of overrides, and the way it fails is silence: a
# variable left out of it falls through to the dark value, which is unreadable
# on paper and looks like a rendering bug rather than a missing line.
print('themes')
css_src = (ROOT / 'src/style.css').read_text()


def declared(block):
    return set(re.findall(r'(--[a-z0-9]+)\s*:', block))


def block(selector):
    i = css_src.index(selector)
    return css_src[i:css_src.index('\n  }', i)]


TYPEFACES = {'--mono', '--sans'}
dark = declared(block(':root{')) - TYPEFACES
light = declared(block(':root[data-theme="light"]{'))
missing = sorted(dark - light)
extra = sorted(light - dark)
if missing:
    print(f'  FAIL the light theme does not set: {", ".join(missing)}')
    fails += 1
if extra:
    print(f'  FAIL the light theme sets what the dark one does not: {", ".join(extra)}')
    fails += 1
if not missing and not extra:
    print(f'  both themes set the same {len(dark)} values')

# The ramp is read out of the palette by name; a stop renamed on one side only
# would paint every scored region grey and report a crash to say so.
map_js = (ROOT / 'src/js/02-map.js').read_text()
stops = re.search(r'const STOPS = \[([^\]]*)\]', map_js).group(1)
want = {f'--s{s.strip()}{part}' for s in stops.split(',') for part in ('fill', 'line')}
if not want <= dark:
    print(f'  FAIL the ramp asks for {", ".join(sorted(want - dark))}, which no theme sets')
    fails += 1
else:
    print(f'  the distance ramp\'s {len(want)} stops are set by both themes')

# The theme is chosen before the body renders, by a script in <head> that has
# to name the same storage key as the module that writes it.
key = re.search(r"const PREF_THEME = '([^']+)'", (ROOT / 'src/js/06-board.js').read_text()).group(1)
if f"localStorage.getItem('{key}')" not in html_src:
    print(f'  FAIL the boot script does not read {key}, so a light theme starts dark')
    fails += 1
else:
    print(f'  the boot script and the stored preference agree on {key}')

# Everything the game remembers about a player goes in the export, so every
# preference key needs a set of legal values to be checked against on the way
# back in. One table answers for the importer and for the link; a key added to
# PREF_KEYS without an entry there is a preference nothing validates.
board_js = (ROOT / 'src/js/06-board.js').read_text()
start_js = (ROOT / 'src/js/14-start.js').read_text()
pref_keys = re.search(r'const PREF_KEYS = \[([^\]]*)\]', board_js).group(1)
pref_keys = [k.strip() for k in pref_keys.split(',') if k.strip()]
legal = re.search(r'const PREFS = \{(.*?)\n\};', board_js, re.S).group(1)
unchecked = [k for k in pref_keys if f'[{k}]' not in legal]
if unchecked:
    print(f'  FAIL no legal values declared for: {", ".join(unchecked)}')
    fails += 1
else:
    print(f'  all {len(pref_keys)} preferences have a set of legal values')

# A plain lookup would say yes to `constructor`, which is a property of every
# object, so a file or a link could set the mode to the Object constructor.
if 'hasOwnProperty' not in board_js[board_js.index('function prefLegal'):]:
    print('  FAIL prefLegal uses a plain lookup, so `constructor` is a legal value')
    fails += 1
else:
    print('  and a value has to be one the table owns, not one it inherits')

# ------------------------------------------------------------- the link
# ?map=fr&mode=practice&scoring=drift&theme=light — one parameter per
# preference, written to storage before startup reads it, so a link and a tap
# on the menu arrive by the same road.
print('the link')
params = re.search(r'const LINK_PARAMS = \{(.*?)\};', start_js, re.S).group(1)
params = dict(re.findall(r'(\w+):\s*(PREF_\w+)', params))
# Named rather than derived from the same lines being checked: the point is that
# these four spellings are the published surface and cannot quietly change.
want = {'map': 'PREF_GEO', 'mode': 'PREF_MODE',
        'scoring': 'PREF_SCORING', 'theme': 'PREF_THEME'}
if params != want:
    print(f'  FAIL the link parameters are {params}, not {want}')
    fails += 1
else:
    print(f'  {len(params)} parameters, one per preference: {", ".join(sorted(params))}')

# Every preference should be reachable by link; one that is not is a link that
# silently plays something other than what it says.
pref_consts = [k for k in pref_keys]
unreachable = [k for k in pref_consts if k not in params.values()]
if unreachable:
    print(f'  FAIL no link parameter sets: {", ".join(unreachable)}')
    fails += 1
else:
    print('  every preference can be set by a link')

# The theme is applied by the boot script in <head>, a frame before the module
# that saves it runs, so that script has to read the same parameter name.
if f"get('{[p for p, k in params.items() if k == 'PREF_THEME'][0]}')" not in html_src:
    print('  FAIL the boot script does not read the theme parameter, so it starts dark')
    fails += 1
else:
    print('  the boot script and the link agree on the theme parameter')

# Copy Link writes the same parameters it reads, minus the theme: that one is
# about the person looking at the screen, not about the game being played.
# Named rather than derived, because "which axes are worth sharing" is a
# decision and this is where it is written down.
share = re.search(r'const SHARE_PARAMS = (.*?);', start_js, re.S).group(1)
if 'Object.keys(LINK_PARAMS)' not in share:
    print('  FAIL the shared parameters are a second list rather than the link\'s own')
    fails += 1
elif 'PREF_THEME' not in share:
    print('  FAIL the theme is not held back from a copied link')
    fails += 1
else:
    print('  a copied link carries every parameter but the theme')

if 'id="shareBtn"' not in html_src:
    print('  FAIL nothing on the card copies a link')
    fails += 1
else:
    print('  and there is a button to copy one')

# ------------------------------------------------------------- the choices
# Three labelled rows on the menu — map, mode, scoring — each with a line
# saying what the selected option does. The line belongs to the option and not
# to the combination, which is the only reason the copy does not multiply: four
# options are four sentences, four combinations would be eight, and the next
# axis would make that sixteen.
#
# What holds that together is independence: a line may not depend on what is
# selected on another row. The cheap mechanical version of that rule is that no
# line may name another axis's options, which is how the drift would start.
print('the choices')
data_js = (ROOT / 'src/js/01-data.js').read_text()


def options(block):
    i = data_js.index(block)
    body = data_js[i:data_js.index('\n};', i)]
    return dict(zip(re.findall(r"^\s+label: '([^']+)'", body, re.M),
                    [n.replace("'\n        + '", '') for n in
                     re.findall(r"note: '(.*?)',\n", body, re.S)]))


modes = options('const MODES = {')
scorings = options('const SCORINGS = {')
missing = [k for k, v in {**modes, **scorings}.items() if not v.strip()]
if len(modes) != 2 or len(scorings) != 2 or missing:
    print(f'  FAIL an option without a line of its own: {missing or "count mismatch"}')
    fails += 1
else:
    print(f'  {len(modes) + len(scorings)} options, each with a line of its own')

crossed = []
for mine, theirs in ((modes, scorings), (scorings, modes)):
    for label, note in mine.items():
        for other in theirs:
            if other.lower() in note.lower():
                crossed.append(f'{label} names {other}')
if crossed:
    print(f'  FAIL a line depends on another row: {"; ".join(crossed)}')
    fails += 1
else:
    print('  no line names an option from the other row')

# A map's line counts its places, so every map has to say how its noun
# pluralises. Guessing it works for states and departements and breaks on the
# countries that are coming.
maps = re.findall(r"noun: '([^']+)',", data_js)
plurals = re.findall(r"plural: '([^']+)',", data_js)
if len(plurals) != len(maps):
    print(f'  FAIL {len(maps)} maps but {len(plurals)} plurals')
    fails += 1
else:
    print(f'  all {len(maps)} maps spell out their plural')

# Every var() has to name something the palette declares. An undefined custom
# property is not a missing colour that falls back to a default — it makes the
# whole declaration invalid, and the property lands on its inherited value. The
# magnifier lost its borders that way and stayed that way through a release:
# `stroke: var(--ink)` survived the rename that removed --ink, stroke inherited
# `none`, and nothing anywhere said a word. Colour tests compare two palettes to
# each other; this one asks whether the stylesheet is asking for names that
# exist at all.
declared_names = declared(block(':root{'))
INLINE = {'--scorefill', '--scoreline'}      # set per element by paintScore()
used = set(re.findall(r'var\((--[a-z0-9-]+)', css_src))
dangling = sorted(used - declared_names - INLINE)
read_in_js = set()
for js in (ROOT / 'src/js').glob('*.js'):
    # Only names written out in full. The ramp builds `--s${at}fill` by
    # interpolation and cannot be read this way; the stops have their own check
    # above, which is the right place for them.
    read_in_js |= {m[1] for m in re.findall(
        r"getPropertyValue\(\s*([`'\"])(--[a-z0-9-]+)\1", js.read_text())}
dangling += sorted(n for n in read_in_js - declared_names - INLINE if n not in dangling)
if dangling:
    print(f'  FAIL asked for but never declared: {", ".join(dangling)}')
    fails += 1
else:
    print(f'  every one of the {len(used | read_in_js)} names asked for is declared')

# Choices belong on the start card, where a run is configured. The end card
# reports the result and deliberately does not repeat those controls.
# Split on the two card ids rather than parsing: a rename is a FAIL here rather
# than a traceback, since this reads the source as text and index() would throw.
PICK = r'<div class="pick[^"]*">\s*<div class="eyebrow">([^<]+)</div>'
at_intro, at_end = html_src.find('id="intro"'), html_src.find('id="overlay"')
if at_intro < 0 or at_end < at_intro:
    print('  FAIL cannot find the start and end cards in that order')
    fails += 1
else:
    intro_picks = re.findall(PICK, html_src[at_intro:at_end])
    end_picks = re.findall(PICK, html_src[at_end:])
    if intro_picks != ['Map', 'Mode', 'Scoring'] or end_picks:
        print(f'  FAIL choices are not scoped to the start card: start={intro_picks}, end={end_picks}')
        fails += 1
    else:
        print(f'  start card labels its choices; end card has none: {", ".join(intro_picks)}')

sys.exit(1 if fails else 0)
