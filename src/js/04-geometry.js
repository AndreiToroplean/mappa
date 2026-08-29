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

// Geometry hit test rather than elementFromPoint: taps and the lens should
// resolve the same true shape under the pointer.
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

/* How far outside the region being asked for a tap may land and still count as
   being on it. In screen pixels, and the contrast with SNAP_UNITS is the whole
   point: reaching from open water to the nearest coast is a question about the
   map, so it is asked in map units and means the same thing at any size, while
   this forgives a thumb landing a millimetre off the edge, which is a fact
   about fingers and glass. The same slip has to be forgiven on a phone and on a
   desktop, where the very same region is drawn twice as wide.

   Six is about a millimetre and a half. For scale, on a portrait phone the
   median region of every geography is around 27px across, and the snap that
   already runs from open water reaches roughly 22px. */
const GRACE_PX = 6;

/* GRACE_PX in composed units. Written by compose(), which is the only thing
   that knows how the view box was fitted to the window — the same arrangement
   as `borders` below, and for the same reason. */
let grace = 0;

// boundary points, parsed once out of the same path data the map draws from
/* Region name -> boundary points, in the composed flat space. Written by
   compose(), which is the only thing that knows how panels were placed. */
let borders = {};

/* Reviewing inverts the rule rather than bending it. During a run a region is
   worth resolving to only while picking it would still do something; in review
   picking it asks a question instead of answering one, and the regions worth
   asking about are precisely the resolved ones. So everything is selectable
   there, and the resolver, the snap and the magnifier need no other change. */
function selectable(name) {
  return !!name && !!shapes[name] && (reviewing || status(name) === 'open');
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
/* Marks are asked first, and there are only ever a handful of them.

   This is the rule that makes a mark inside its neighbour reachable at all.
   Vatican City is drawn over Rome and San Marino over Emilia-Romagna, so a
   point inside either is inside Italy's fill too — and the plain scan below
   returns whichever comes first alphabetically, which is Italy. Asking the
   marks first makes hit testing agree with paint order, which is the same rule
   the layers follow: what is drawn on top is what you hit. Anything else and
   the game would show you a mark you could not press. */
/* Whether a point counts as inside a mark — the only place that decides it.

   Measured rather than asked of the element, because what you press is wider
   than what is drawn and wider again under the magnifier, so isPointInFill on
   the drawn circle would be the wrong question. A circle is the one shape where
   the test is exact anyway. */
function inMark(name, u) {
  const c = anchorAt[name];
  if (!c) return false;
  const r = markRadius() * layoutNow.place[panelOf[name]].s;
  const dx = u.x - c.x, dy = u.y - c.y;
  return dx * dx + dy * dy <= r * r;
}

function stateUnder(u, clientX, clientY) {
  if (CAN_HIT) {
    for (let i = 0; i < DOTS.length; i++) {
      if (inMark(DOTS[i], u)) return DOTS[i];
    }
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
  /* Marks answer for themselves. Asking the drawn circle would score a tap that
     resolved *to* this mark as a small miss, because the reach is wider than the
     circle — the two have to be the same question or a correct pick costs
     points. */
  if (isDot(name)) return inMark(name, u) ? 0 : Math.sqrt(borderDist2(name, u));
  if (CAN_HIT && shapes[name].isPointInFill(u)) return 0;
  return Math.sqrt(borderDist2(name, u));
}

/* What a miss cost, and how far it really was.

   The score is the distance as a percentage of the panel's true diameter — the
   farthest two points of it can be — so a full-width miss is 100 and nothing can
   be worse. See measurePanels() for why the bounding box would not do.

   Kilometres come from the other yardstick, which needs no measuring:
   normalise() scaled the panel so its longest side is PANEL_SPAN local units,
   and `km` is that same side in real kilometres, so the ratio converts.

   The composed scale divides out, which is the point: the score cannot depend
   on the size or shape of the window.

   Two regions on different panels have no distance worth measuring — the gap
   between them is a decision the map made, not a fact about the world. That
   costs FAR, a flat charge, and reports no kilometres because there is no
   honest number to report. */
function driftFrom(target, missed, at) {
  const p = panelOf[target];
  if (p !== panelOf[missed]) return { cost: FAR, km: null };

  const place = layoutNow && layoutNow.place[p];
  if (!place || !place.s || !at) return { cost: FAR, km: null };

  // composed units back into the panel's own
  const local = distanceTo(target, at) / place.s;
  const km = GEO.panels[p].km;
  /* Divided by the panel's true diameter, so 100 is the farthest two points of
     it can be and no miss can score past the end of the colour scale. The clamp
     is for the one case the geometry does not cover: an ocean tap snaps to a
     region from up to SNAP_UNITS outside the ink, so the point measured from can
     sit marginally beyond the hull. */
  const wide = panelDiam[p];
  return {
    cost: wide ? Math.min(100, 100 * local / wide) : FAR,
    km: km ? local * km / PANEL_SPAN : null,
  };
}

/* Where on the target the arrow should land: the nearest point of it to the
   tap, which is the point the distance was measured to. Inside the region there
   is nothing to point at, and the caller does not draw an arrow at all. */
function nearestPointOn(name, u) {
  let best = null, bestD = Infinity;
  for (const ring of borders[name]) {
    for (let i = 0; i < ring.length; i += 2) {
      const ax = ring[i], ay = ring[i + 1];
      const j = (i + 2) % ring.length;
      const bx = ring[j], by = ring[j + 1];
      let dx = bx - ax, dy = by - ay, px = ax, py = ay;
      if (dx || dy) {
        const t = ((u.x - ax) * dx + (u.y - ay) * dy) / (dx * dx + dy * dy);
        if (t > 1) { px = bx; py = by; }
        else if (t > 0) { px = ax + dx * t; py = ay + dy * t; }
      }
      const d = (u.x - px) * (u.x - px) + (u.y - py) * (u.y - py);
      if (d < bestD) { bestD = d; best = { x: px, y: py }; }
    }
  }
  return best;
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
/* The region being asked for, when the tap landed close enough to count as on
   it. Nothing else is ever forgiven this way: it returns the answer or nobody.

   Why a distance and not a fatter shape. Growing a polygon by pushing its edges
   outward is the obvious move and it is the wrong one — at a reflex corner the
   offset edges cross, and across a spur narrower than the offset they fold
   through each other, so an outward offset can and does cut pieces off the
   shape it was asked to grow. The set of points within `grace` of a region has
   no such failure mode: it is that region swept by a disc, so it contains the
   original for any grace >= 0, opens no gaps, and rounds every corner off
   instead of losing it. And borderDist2 already computes that distance, for the
   snap and for distance scoring, so the whole of it is a threshold on a number
   the game was working out anyway.

   One direction only, which is the property to hold on to: this can turn a miss
   into a hit and can never do the reverse, because it is only ever asked about
   `current` and only ever answers with it. Nothing that used to resolve
   correctly stops doing so, and no region becomes harder to reach.

   Not while the magnifier is open. The disc's one promise is that the shape
   lit in amber is the shape a release will pick, and the magnifier is already
   this problem's better answer — the miss is visible before the finger lifts,
   and correctable. Forgiving a slip there would move the pick off the shape the
   player is watching, for a slip they are not making. markRadius() reads the
   same flag in the opposite direction, and for the matching reason: a mark's
   bias is safe to widen precisely because the disc puts it on screen. */
function forgiven(u) {
  if (!running || reviewing || magnifying || !grace) return null;
  if (!selectable(current)) return null;
  return distanceTo(current, u) <= grace ? current : null;
}

function resolve(clientX, clientY) {
  const u = userPoint(clientX, clientY);
  if (!u) return null;
  // Asked before containment: beating the region the tap actually landed in is
  // the entire job.
  const near = forgiven(u);
  if (near) return near;
  const under = stateUnder(u, clientX, clientY);
  if (under && selectable(under)) return under;
  return nearestSelectable(u);
}

