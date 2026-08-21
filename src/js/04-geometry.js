let CAN_HIT = false;   // set by buildMap(), which has the paths to ask

/* Must return a real SVGPoint, not a plain {x, y}. WebKit's isPointInFill
   takes an SVGPoint and throws a TypeError on a dictionary, so every tap on
   the map failed on Safari while working fine in Chrome, which accepts either.
   createSVGPoint is ancient and available everywhere. */
const scratch = svg.createSVGPoint ? svg.createSVGPoint() : null;

function userPoint(x, y) {
  const m = svg.getScreenCTM();
  if (!m) return null;
  if (!scratch) return { x: x, y: y };      // no SVG point factory: last resort
  scratch.x = x;
  scratch.y = y;
  return scratch.matrixTransform(m.inverse());
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

/* What a miss cost, on the 0..100 scale where 100 is the full width of the
   geography. See SCORINGS.drift for why the unit is not kilometres.

   Measured from where the finger actually landed to the nearest point of the
   region that was asked for, so a tap on the border of the right answer costs
   almost nothing and one across the country costs almost everything. A tap that
   the ordinary resolver would have accepted never reaches here at all — it is a
   hit, and hits are free — which is what makes the two scorings agree about
   what counts as knowing it.

   Two regions on different panels have no distance worth measuring: the gap
   between them is a decision the map made, not a fact about the world. That
   costs FAR, more than the worst honest miss. */
function driftCost(target, missed, at) {
  const p = panelOf[target];
  if (p !== panelOf[missed]) return FAR;

  const place = layoutNow && layoutNow.place[p];
  const panel = GEO.panels[p];
  if (!place || !panel || !panel.span) return FAR;    // nothing to measure with

  // the yardstick, carried through the same transform as the ink
  const span = panel.span * place.s;
  // Falling back to the label anchor keeps this defined for a pick with no
  // point behind it; it is the region's own centre, so it reads as a miss from
  // where the region is.
  const u = at || anchorAt[missed];
  if (!u || !span) return FAR;
  return Math.min(FAR, 100 * distanceTo(target, u) / span);
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

/* Landing on something unselectable is treated exactly like landing on open
   water: look for the nearest region worth picking. There used to be a flag
   here so a tap inside a solved region selected nothing while the magnifier
   snapped out of it, on the grounds that a tap has no preview. In play that
   distinction was just an inconsistency — a tap two pixels inside a solved
   neighbour and a tap two pixels into the sea are the same mistake, and
   silently discarding one of them reads as the game ignoring you. */
function resolve(clientX, clientY) {
  const u = userPoint(clientX, clientY);
  if (!u) return null;
  const under = stateUnder(u, clientX, clientY);
  if (under && selectable(under)) return under;
  return nearestSelectable(u);
}

