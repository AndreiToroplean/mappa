const CAN_HIT = typeof Object.values(nodes)[0].isPointInFill === 'function';

function userPoint(x, y) {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const inv = m.inverse();
  return { x: inv.a * x + inv.c * y + inv.e, y: inv.b * x + inv.d * y + inv.f };
}

// Geometry hit test rather than elementFromPoint: inside the disc we want the
// true shape under the crosshair, never one of the oversized tap circles.
/* ---- resolving a pointer position to a state --------------------------
   One resolver, shared by taps and the magnifier, so the two can never
   disagree about what a position means.

   A state counts as *selectable* only if picking it would actually do
   something. Already-found states, and states already missed this turn, are
   no-ops inside guess(); resolving to one means a deliberate action quietly
   does nothing. They are excluded here instead, so what gets resolved is
   always something worth resolving to.

   Containment wins outright — being inside a selectable state is distance
   zero. Otherwise the nearest selectable state within SNAP_UNITS wins,
   measured to the closest point on its border rather than to its label
   anchor or centroid: a position just off the Delmarva coast should give
   Maryland, which is metres away, not Virginia, whose centre is nearer. */

const SNAP_UNITS = 40;   // reach in map units — see CONTEXT.md for why not px

// boundary points, parsed once out of the same path data the map draws from
const outline = {};
STATES.forEach(s => {
  outline[s.n] = s.d.split('M').filter(Boolean).map(ring => {
    const pairs = ring.replace(/Z$/, '').split('L');
    const a = new Float64Array(pairs.length * 2);
    for (let i = 0; i < pairs.length; i++) {
      const c = pairs[i].split(',');
      a[i * 2] = +c[0];
      a[i * 2 + 1] = +c[1];
    }
    return a;
  });
});

function selectable(name) {
  return !!name && !!nodes[name] && status(name) === 'open';
}

function segDist2(px, py, ax, ay, bx, by) {
  let dx = bx - ax, dy = by - ay;
  if (dx || dy) {
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    if (t > 1) { ax = bx; ay = by; }
    else if (t > 0) { ax += dx * t; ay += dy * t; }
  }
  dx = px - ax; dy = py - ay;
  return dx * dx + dy * dy;
}

// which state's fill contains this point, selectable or not
function stateUnder(u, clientX, clientY) {
  if (CAN_HIT) {
    for (let i = 0; i < STATES.length; i++) {
      const nm = STATES[i].n;
      if (nodes[nm].isPointInFill(u)) return nm;
    }
    return null;
  }
  const el = document.elementFromPoint(clientX, clientY);  // lens ignores pointers
  return (el && el.dataset && el.dataset.name) || null;
}

function nearestSelectable(u) {
  let best = null, bestD = SNAP_UNITS * SNAP_UNITS;   // seeded at the cap
  for (let s = 0; s < STATES.length; s++) {
    const nm = STATES[s].n;
    if (!selectable(nm)) continue;
    const rs = outline[nm];
    for (let r = 0; r < rs.length; r++) {
      const a = rs[r], len = a.length;
      for (let i = 0; i + 3 < len; i += 2) {
        const d = segDist2(u.x, u.y, a[i], a[i + 1], a[i + 2], a[i + 3]);
        if (d < bestD) { bestD = d; best = nm; }
      }
    }
  }
  return best;
}

/* snapFromDead decides what happens *inside* an unselectable state. The
   magnifier passes true: it draws the result under the crosshair before
   anything is committed, so sliding over a solved state and being offered its
   neighbour is visible and can be corrected. A tap passes false, because it
   has no preview — silently turning a tap on a state you already solved into
   a life lost on the state next door would be indefensible. Open water snaps
   either way. */
function resolve(clientX, clientY, snapFromDead) {
  const u = userPoint(clientX, clientY);
  if (!u) return null;
  const under = stateUnder(u, clientX, clientY);
  if (under) return selectable(under) ? under : (snapFromDead ? nearestSelectable(u) : null);
  return nearestSelectable(u);
}

