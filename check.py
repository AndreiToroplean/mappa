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

    def resolve(self, x, y, dead, snap, cap):
        u = self.contains(x, y)
        if u:
            return u if u not in dead else (self.nearest(x, y, dead, cap) if snap else None)
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
    blk = blk.replace("""function resolve(clientX, clientY, snapFromDead) {
  const u = userPoint(clientX, clientY);
  if (!u) return null;
  const under = stateUnder(u, clientX, clientY);""",
"""function resolve(x, y, snapFromDead) {
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
for (const [x, y, dead, snap, want] of CASES){
  DEAD = new Set(dead);
  const got = resolve(x, y, snap);
  if (got !== want){ fail++; if (fail <= 3) console.log('    resolve mismatch ('+x+','+y+') snap='+snap+' js='+got+' ref='+want); }
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
  if (resolve(x, y, false) !== nm) { afail++; if (afail <= 3) console.log('    anchor of ' + nm + ' resolves to ' + resolve(x, y, false)); }
}
console.log('    label anchors resolve to their own region: ' + (ANCHORS.length - afail) + '/' + ANCHORS.length);
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
        boxes = []
        for i in range(len(d['panels'])):
            px = [x for r, x in zip(regs, xs) if False]
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
        keys = sorted(per)
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                x0, y0, x1, y1 = per[keys[i]]; a0, b0, a1, b1 = per[keys[j]]
                if not (x1 <= a0 or a1 <= x0 or y1 <= b0 or b1 <= y0):
                    bad += 1
                    print(f'  FAIL {geo} aspect {aspect}: panels {keys[i]} and {keys[j]} overlap')
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
        snap = random.choice([True, False])
        cases.append((x, y, sorted(dead), snap, ref.resolve(x, y, dead, snap, SNAP)))

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

# --------------------------------------------------- modes and board keying
pathlib.Path('/tmp/fifty-modes.js').write_text(
    "let TOTAL = 50;\nlet GEO = {id:'us', all:'All fifty', noun:'state'};\n"
    + data_src[data_src.index('const MODES = {'):]
    + board_src[board_src.index('const LEGACY_US'):board_src.index('/* One key-value layer')]
    + board_src[board_src.index('const errorsOf'):board_src.index('const addEntry')] + """
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
eq('practice: lives unbounded', Number.isFinite(MODES.practice.lives), false);

MODE = MODES.trial;
let cb = [];
[[50,2,100],[50,0,500],[31,3,200],[50,1,300],[31,3,150],[0,3,9]].forEach(([f,e,t],i) => {
  cb = addEntry(cb, {f:f,e:e,t:t*1000,d:i}).board; });
eq('trial: one entry per partial tally', cb.filter(r=>r.f===31).map(r=>r.t/1000), [150]);
eq('trial: full runs by misses then time', rankBoard(cb.slice()).filter(r=>r.f===50).map(r=>r.e), [0,1,2]);
eq('trial: zero-region run does not post', cb.some(r=>r.f===0), false);

// every geography and mode gets its own board, and the US keys are the old ones
const keys = [];
for (const g of ['us','fr']) for (const m of ['trial','practice']) {
  GEO = {id:g}; MODE = MODES[m]; keys.push(boardKey());
}
eq('board keys', keys, ['fifty:board2','fifty:practice1','fifty:fr:trial','fifty:fr:practice']);
eq('board keys are all distinct', new Set(keys).size, 4);
console.log('modes:   ' + (fail ? fail + ' FAILED' : '10/10 pass'));
process.exitCode = fail ? 1 : 0;
""")
r = subprocess.run(['node', '/tmp/fifty-modes.js'], capture_output=True, text=True)
print(r.stdout.rstrip() or r.stderr)
fails += r.returncode

sys.exit(1 if fails else 0)
