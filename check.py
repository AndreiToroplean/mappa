#!/usr/bin/env python3
"""Regression harness: runs the pure logic against independent references."""
import json, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent
JS = ROOT / 'src' / 'js'
S = json.loads((ROOT / 'data' / 'states.json').read_text())

# ---------------------------------------------------------------- reference
rings = {s['n']: [[tuple(map(float, q.split(','))) for q in part.rstrip('Z').split('L')]
                  for part in s['d'].split('M') if part] for s in S}

def seg_d2(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx or dy:
        t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
        if t > 1: ax, ay = bx, by
        elif t > 0: ax, ay = ax + dx * t, ay + dy * t
    dx, dy = px - ax, py - ay
    return dx * dx + dy * dy

def contains(x, y):
    for nm, rs in rings.items():
        c = False
        for r in rs:
            n = len(r)
            for i in range(n):
                ax, ay = r[i]; bx, by = r[(i + 1) % n]
                if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                    c = not c
        if c: return nm
    return None

def nearest_sel(x, y, dead, cap=40.0):
    best, bd = None, cap * cap
    for nm, rs in rings.items():
        if nm in dead: continue
        for r in rs:
            for i in range(len(r) - 1):
                d = seg_d2(x, y, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1])
                if d < bd: bd, best = d, nm
    return best

def ref_resolve(x, y, dead, snap):
    u = contains(x, y)
    if u:
        return u if u not in dead else (nearest_sel(x, y, dead) if snap else None)
    return nearest_sel(x, y, dead)

import random
random.seed(7)
names = [s['n'] for s in S]
cases = []
for _ in range(120):
    x = round(random.uniform(-60, 960), 1); y = round(random.uniform(10, 610), 1)
    dead = set(random.sample(names, random.choice([0, 0, 3, 10, 25])))
    snap = random.choice([True, False])
    cases.append((x, y, sorted(dead), snap, ref_resolve(x, y, dead, snap)))

# ------------------------------------------------------------------ harness
geo = (JS / '04-geometry.js').read_text()
blk = geo[geo.index('const SNAP_UNITS'):]
blk = blk.replace(blk[blk.index('function stateUnder'):blk.index('function nearestSelectable')],
                  'function stateUnder(u){ return polyHit(u.x, u.y); }\n\n')
blk = blk.replace(blk[blk.index('function selectable'):blk.index('function segDist2')],
                  'function selectable(name){ return !!name && !DEAD.has(name); }\n\n')
blk = blk.replace("""function resolve(clientX, clientY, snapFromDead) {
  const u = userPoint(clientX, clientY);
  if (!u) return null;
  const under = stateUnder(u, clientX, clientY);""",
"""function resolve(x, y, snapFromDead) {
  const u = {x: x, y: y};
  const under = stateUnder(u);""")

lens = (JS / '05-lens.js').read_text()
settle = lens[lens.index('function settle()'):lens.index('\nfunction closeLens')]

pathlib.Path('/tmp/fifty-check.js').write_text(
    "const STATES = " + json.dumps(S) + ";\n"
    "const CASES = " + json.dumps(cases) + ";\n"
    "let DEAD = new Set();\nconst GUARD_MS = 180, DWELL_MS = 120;\nlet trail = [], NOW = 0;\n"
    """
function polyHit(x, y){
  for (const s of STATES){
    let c = false;
    for (const part of s.d.split('M')){
      if(!part) continue;
      const r = part.replace(/Z$/,'').split('L').map(q => q.split(',').map(Number));
      for (let i = 0; i < r.length; i++){
        const [ax,ay] = r[i], [bx,by] = r[(i+1) % r.length];
        if ((ay > y) !== (by > y) && x < (bx-ax)*(y-ay)/(by-ay)+ax) c = !c;
      }
    }
    if (c) return s.n;
  }
  return null;
}
""" + blk + '\n'
    + ('function settle(){' + settle.split('{', 1)[1]).replace('const now = Date.now();', 'const now = NOW;')
    + """
let fail = 0;
for (const [x, y, dead, snap, want] of CASES){
  DEAD = new Set(dead);
  const got = resolve(x, y, snap);
  if (got !== want){ fail++; if (fail <= 3) console.log('  resolve mismatch at ('+x+','+y+') snap='+snap+' js='+got+' ref='+want); }
}
console.log('  resolve: ' + (CASES.length - fail) + '/' + CASES.length + ' match the independent reference');

const S_CASES = [
  ['twitch on lift discarded',   [['Rhode Island',0,600],['Connecticut',600,660]], 660, 'Rhode Island'],
  ['deliberate final choice',    [['Rhode Island',0,300],['Connecticut',300,700]], 700, 'Connecticut'],
  ['drag-through ignored',       [['New York',0,80],['Vermont',80,140],['New Hampshire',140,900]], 900, 'New Hampshire'],
  ['no dwell -> state at cutoff',[['Maine',0,60],['Vermont',60,120],['New York',120,160]], 200, 'Maine'],
  ['lift over water cancels',    [['Delaware',0,500],[null,500,900]], 900, null],
  ['water twitch discarded',     [['Delaware',0,700],[null,700,760]], 760, 'Delaware'],
  ['instant lift',               [['Texas',0,90]], 90, 'Texas'],
];
let sfail = 0;
for (const [label, segs, now, want] of S_CASES){
  trail = segs.map(s => ({name: s[0], t0: s[1], t1: s[2]}));
  NOW = now;
  const got = settle();
  if (got !== want){ sfail++; console.log('  settle FAIL ' + label + ' -> ' + got + ' (want ' + want + ')'); }
}
console.log('  settle:  ' + (S_CASES.length - sfail) + '/' + S_CASES.length + ' pass');
process.exitCode = (fail || sfail) ? 1 : 0;
""")

r = subprocess.run(['node', '/tmp/fifty-check.js'], capture_output=True, text=True)
print(r.stdout.rstrip() or r.stderr)
sys.exit(r.returncode)
