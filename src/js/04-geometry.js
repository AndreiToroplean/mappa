let CAN_HIT = false;   // set by buildMap(), which has the paths to ask

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

const SNAP_UNITS = 40;   // reach in map units — see DESIGN.md for why not px

// boundary points, parsed once out of the same path data the map draws from
/* Region name -> boundary points, in the composed flat space. Written by
   compose(), which is the only thing that knows how panels were placed. */
let borders = {};

function selectable(name) {
  return !!name && !!shapes[name] && status(name) === 'open';
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
    for (let i = 0; i < REGION_NAMES.length; i++) {
      const nm = REGION_NAMES[i];
      if (shapes[nm].isPointInFill(u)) return nm;
    }
    return null;
  }
  const el = document.elementFromPoint(clientX, clientY);  // lens ignores pointers
  return (el && el.dataset && el.dataset.name) || null;
}

/* Squared distance from a point to a region's border, stopping early once it
   cannot beat `ceiling`. Squared throughout: the only thing done with these is
   compare them, and a square root per segment across ~9000 points is waste.

   This is the primitive the rest of the file is built from, and the one the
   roadmap keeps asking for — the snap threshold is a ceiling on it, resolving
   a position is a minimum over it, and blind mode's continuous error score is
   this same measure aimed at one named region. */
function borderDist2(name, u, ceiling) {
  const rs = borders[name];
  let best = ceiling === undefined ? Infinity : ceiling;
  for (let r = 0; r < rs.length; r++) {
    const a = rs[r], len = a.length;
    for (let i = 0; i + 3 < len; i += 2) {
      const d = segDist2(u.x, u.y, a[i], a[i + 1], a[i + 2], a[i + 3]);
      if (d < best) best = d;
    }
  }
  return best;
}

/* Distance in map units from a point to a region: zero anywhere inside it,
   otherwise the distance to the nearest point on its border. Unused by the
   game as it stands — it is the shape blind mode's error score needs, kept
   here next to the primitive it belongs with rather than reinvented later. */
function distanceTo(name, u) {
  if (CAN_HIT && shapes[name].isPointInFill(u)) return 0;
  return Math.sqrt(borderDist2(name, u));
}

function nearestSelectable(u) {
  let best = null, bestD = SNAP_UNITS * SNAP_UNITS;   // seeded at the cap
  for (let s = 0; s < REGION_NAMES.length; s++) {
    const nm = REGION_NAMES[s];
    if (!selectable(nm)) continue;
    const d = borderDist2(nm, u, bestD);
    if (d < bestD) { bestD = d; best = nm; }
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

