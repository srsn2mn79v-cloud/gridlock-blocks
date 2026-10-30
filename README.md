# Gridlock Blocks — game project

This is the real Vite + Three.js project version of the game, built from the same
road/parcel/prop/gameplay schema the Gridlock City Editor exports. It's organized into
modules instead of one HTML file, so it's the base to keep building on.

## Running it

```
npm install
npm run dev
```

Opens at `http://localhost:5173`. Drive with WASD or arrow keys — Space or Down/S
brakes (Down/S brakes first and only reverses once you're nearly stopped, like a real
car) — **L** toggles headlights (which actually light up the road ahead), **O**/**P**
toggle the left/right turn signal indicators (pressing one turns the other off, like a
real indicator stalk).

`npm run build` produces a production build in `dist/` (this was already verified to
build cleanly before this was sent to you).

`npm run build:html` produces a single self-contained `dist-singlefile/index.html` —
all the JS (Three.js included) and CSS inlined into one file, no other files alongside
it, no network access needed to run. Double-click it to play; no dev server required.
Use the regular `npm run build` / `dist/` for actually hosting it somewhere, since that
output can be cached and updated per-file — the single-file build is for "just give me
one file I can run or hand to someone."

## Loading your own city

Right now it boots with a built-in example (`src/cityData.js`) laid out as a
progressive test strip rather than a "real" little city: a plain buildings-only
stretch, then a park, then a plaza plus props, then bends of increasing sharpness, then
a highway with a ramp/bridge/ramp/tunnel/ramp. Each stretch adds exactly one new thing,
so if something looks or drives oddly, it's easy to tell which feature caused it rather
than untangling a dense city all at once. See the comment at the top of the file for
the exact layout. Drive straight ahead from spawn — it's already facing the right way.

The demo city now also has a real 4-way **signaled intersection** partway down the
first local street (node `n3`), with a short dead-end side street in each direction —
drive up to it and it behaves like a real light: stop on red/yellow, go on green, and
the same signal data governs both the AI traffic and the pedestrians crossing there.

To use what you actually built in the editor:

1. In the Gridlock City Editor, click **Export / Import** and **Copy JSON**.
2. Open `src/cityData.js`.
3. Replace the object assigned to `sampleCity` with your pasted JSON (keep the
   `export const sampleCity = ... ;` wrapper around it).
4. Save — Vite hot-reloads automatically if `npm run dev` is still running.

## What's implemented

- **Roads** (`src/generators/roads.js`) — straight segments between nodes, with
  elevation read per node (so bridges and tunnels just work from the data), bridge
  piers, and a simple enclosed tunnel shell.
- **Turns** — any node where exactly two road edges meet at an angle gets
  auto-smoothed into a short eased, banked curve instead of a sharp corner. How wide
  the easing is and how much it banks is driven by each road type's assumed design
  speed (local/avenue/highway), using the same simplified math as the editor
  (documented in both files' comments — it borrows the real `e+f = V²/(127R)`
  superelevation relation, but isn't an exact regulatory spec).
- **Parcels** (`src/generators/parcels.js`) — buildings extrude to their stored
  height; park/plaza/water render as flat colored lots.
- **Props** (`src/generators/props.js`) — simple primitive meshes for tree/light/
  bench/sign/trafficlight, positioned and rotated from the data. Street lights are a
  proper lamp — tapered pole, an arm reaching out over the road, a downward lamp head —
  with a real `THREE.PointLight` that actually lights up the street at night, not just
  an emissive bulb that looks lit from close up. Traffic lights are a pole with a
  3-lens head; which lens is lit is driven every frame from the real signal data (see
  Signals below), not baked into the mesh.
- **Lane markings** (`src/generators/roads.js`) — a dashed center line plus solid edge
  lines along every local/avenue road (highways are left plain — "fast road" already
  reads as one lane each way without clutter), built from the same centerline points
  the road ribbon itself uses, including through smoothed corners.
- **Traffic signals** (`src/signals.js`, `cityData.js`'s `signals` array) — one signal
  per approach edge at an intersection, matched back to the road graph by edge id (the
  same shape the city editor exports), with phase as a pure function of
  `(signal, timestampMs)` — no ticked state to desync, so pedestrians, AI traffic, and
  the visual traffic-light prop all independently ask "what phase is this at time T"
  and always agree.
- **AI traffic** (`src/traffic.js`) — a handful of cars drive the same road graph,
  easing to a stop for a red/yellow light and slowing for whatever's physically ahead of
  them (another traffic car or the player). Positioned with a straight lerp between
  node endpoints rather than the full curve/bank math the player's car and road meshes
  share — a visible simplification on this city's few bends, traded for a much simpler
  and cheaper AI. Each car contributes a plain circular collider that's kept in sync
  with its position every frame, so the player's car bumps into one like any other
  solid obstacle (see Collision below) — no special-case code needed in collision.js.
- **Gameplay** (`src/generators/gameplay.js`) — checkpoint rings and a spawn point,
  with checkpoint-hit detection and a simple HUD in `src/main.js`.
- **Car** (`src/car.js`) — the same arcade handling model from the original Gridlock
  Blocks prototype, now also pitching (nose up/down on slopes) and rolling (leaning
  into banked corners) via `THREE.Euler` order `'YXZ'` so pitch/roll apply in the car's
  own frame after yaw. Each of the four wheels samples its own ground height every
  frame (matching the visual wheel positions exactly), and pitch/roll are derived from
  the differences between them — not a single center sample plus a formula, so the body
  actually tracks whatever surface each corner of the car is over. Height itself is set
  directly from that sample (not eased) — only pitch/roll are eased, for the reason
  explained in "Bugs fixed this round" below. The car also has working lights: brake
  lights (triggered by Space), turn-signal blinkers (O/P), and headlights (L) that are
  real `THREE.SpotLight`s and actually illuminate the road ahead, not just a bright
  texture.
- **Terrain following + banking** (`src/terrain.js`, `src/roadMath.js`) — height
  (including the real banked height at a given lateral offset, not just the
  centerline) is read off the road graph. The curve/bank math lives in `roadMath.js`
  and is shared with `roads.js`'s mesh builder, so a wheel's sampled height always
  matches what the road mesh is actually doing at that point.
- **Collision** (`src/collision.js`, `src/physicsConfig.js`) — buildings (tested
  against their real footprint polygon, not a bounding circle) and blocking props
  (tree/light/bench/sign) stop the car; `physicsConfig.js` is a per-type lookup table
  of collision radius, whether it blocks, and how it breaks, so new prop/parcel types
  just need a line added there.
- **Destructible objects** (`src/effects.js`) — a destructible prop hit above
  `destroySpeedThreshold` either knocks over in place or pops into a handful of flying
  debris chunks, depending on its config. No physics engine — just enough motion to
  sell the hit.
- **Sidewalks** (`src/sidewalks.js`) — a raised curb strip (visually `CURB_HEIGHT`
  above the road) alongside each local/avenue road edge, trimmed back from
  intersections. Straight ribbons only — they stop short at corners rather than
  mitering, which leaves a small visible gap there (cosmetic only).
- **Pedestrians** (`src/pedestrians.js`, `src/signals.js`) — walk a graph built from the
  sidewalks: along a sidewalk, or across a specific road at an intersection corner via a
  direct "crossing" link. Crossing is gated by that approach's traffic signal if the
  city has signal data (same pure phase-from-time function the city editor's Signal
  tool is built around, in `signals.js`); with no signal data they pause briefly
  ("look both ways") before stepping out. They occasionally detour to a nearby bus stop
  prop and stand there for 5-15s — a placeholder hook for an actual bus/transit system
  later, nothing rides up yet. When the car passes close, they sidestep off their
  current path and ease back onto it once it's clear — free-roaming within a radius,
  not constrained to the sidewalk line itself, while still always returning to it.
  **Hitting one is not possible**, by two independent guarantees: (1) crossing links are
  trimmed back from the roadway edge and gate on the signal/look-both-ways logic above,
  so under normal play they're rarely *in* the car's path at the moment it passes; but
  the real guarantee is (2) pedestrians are simply never added to `collisionWorld` in
  `main.js` — there is no function anywhere that compares the car's position to a
  pedestrian's, so even a mistimed crossing can't register a hit. If you ever add
  traffic AI or more pedestrian behaviors, keep it that way: pedestrians stay cosmetic
  with respect to collision, always.

## Bugs fixed this round (the round before this one)

Three real bugs, not just new features:

- **Phantom curves at straight junctions** (`src/roadMath.js`'s `computeCurve`, and the
  identical `computeCurveInfo` in the city editor). The deflection-angle formula was
  computing the *supplement* of the real steering angle — 180° for a perfectly straight
  pass-through, shrinking toward 0° for a sharp hairpin — and comparing that to a
  "skip if under 3°" threshold. That's backwards: it meant every straight multi-segment
  road (like a highway built from two collinear edges) got treated as a sharp curve
  needing a bank, generating an extra, overlapping ribbon mesh exactly at the joint.
  That's almost certainly what you were seeing as flickering (two ribbons occupying
  close to the same space — classic z-fighting) and as a "sudden stop" (the car's
  height/bank sampling flipping between the phantom curve's geometry and the straight
  segment's as it crossed the joint). Fixed in both files; the demo city's whole highway
  spur (7 straight-through nodes in a row) is a direct regression test for this.
- **Z-fighting between roads and the ground plane.** Flat ground-level roads were drawn
  at exactly the same height (y=0) as the ground plane beneath them — two coincident
  flat surfaces, which is the other classic cause of that flickering interference
  pattern. Roads now draw a few centimeters above nominal height (`ROAD_LIFT` in
  `roads.js`); props got a similar small lift at their base for the same reason.
- **Buildings used an inflated collision shape.** A circle drawn through a rectangle's
  four corners extends well past the rectangle's actual edges (up to ~41% past the
  midpoint of each side) — for a building near a road, that circle could reach out onto
  the road or sidewalk as an invisible wall, which reads exactly like "a sudden full
  stop out of nowhere." Buildings now collide against their real footprint polygon.

The orange plane you saw was the highway/bridge color (orange = highway, same as any
highway surface road) sitting right at a phantom-curve joint — fixing that bug is most
of why it should both look and behave right now. I also added railings along bridge
decks so they're visually distinct from an ordinary elevated road, since "it doesn't
look like a bridge" was fair even setting the bug aside.

## Latest round: lane bugs, collision feel, pedestrian signals, light aiming, reflectors

- **AI traffic driving down the middle, and not colliding with each other — both the
  same root cause.** `traffic.js` computes its own `heading` with the ordinary
  `atan2(dz,dx)` math-angle convention (same as roads.js/sidewalks.js), but the
  lane-offset and "what's ahead of me" code had been written using car.js's *different*
  convention (`forward = (sin h, cos h)`, used only for the player's own car) — two
  files, same variable name, different angle origins. That silently put the lane
  offset on an inconsistent side depending on heading, and pointed the "is anything
  ahead of me" cone in the wrong direction entirely, so cars never reliably detected
  each other. Both are fixed, and a pairwise circle-separation pass is now also run
  between every AI car every frame as a hard backstop, independent of the
  following-distance logic — see traffic.js's header comment for the convention
  mismatch specifically, since it's an easy one to reintroduce.
- **Collision now has an actual feel, not one flat "everything loses 80% of its
  speed" rule** (`collision.js`, `physicsConfig.js`). Every impact is scored by how
  head-on it was (1.0 = drove straight into it, 0.0 = grazing almost parallel to the
  surface) using only the car's existing speed+heading — there's no separate velocity
  vector to work with. **Buildings/trees/other traffic** "bounce": speed loss scales
  with how head-on the hit was, so rubbing along a wall barely costs you anything
  anymore, while T-boning one still hurts. **Lamp posts, sign posts, traffic-light
  poles, benches** "redirect" instead: they barely slow you down but steer you around
  them, proportional to the same head-on-ness score. A lamp post that actually breaks
  (fast enough, see `destroySpeedThreshold`) still gets its extra flat 30% cut on top.
- **Pedestrians no longer dodge off the sidewalk.** Their cosmetic "step away from a
  passing car" nudge could push them up to 2.2 units sideways — more than the
  sidewalk's own half-width — so a dodge could visibly put them on the road or in the
  building line. Capped to a much smaller, shorter-range nudge that reads as "stepped
  back a bit" instead.
- **Pedestrians now have their own signal**, not the vehicle one. Each traffic-light
  pole got a second, smaller box lower on the mast with just two lenses in the
  walk/don't-walk vocabulary (white/red) — a distinct fixture, not a reused vehicle
  light — even though it's driven from the same underlying signal timing (which is
  how real signal controllers work too: one timing plan, separate pedestrian and
  vehicle heads).
- **Street lights are now aimed, not omnidirectional**, and read as old-school sodium
  lamps. Each lamp head got a real `THREE.SpotLight` pointed along the arm's own
  direction (so it follows the prop's `rotation` properly — the demo city's two
  roadside lamps had actually been rotated backwards, pointing away from the road;
  fixed in `cityData.js`), in a warm amber-orange sodium-vapor color instead of a
  neutral yellow-white. `lightMesh()` also now takes a `{ twin: true }` option for a
  median-style fixture with a head reaching each way — one bulb per side of the road —
  demoed on a pole placed right on the local road's centerline.
- **Traffic lights now cast a little colored glow** onto the intersection at night via
  a small `PointLight` that changes color with the active phase, instead of only being
  visible lit up close.
- **Driving into water slows down and falls instead of instantly stopping.** The car
  now keeps drifting on its last heading while water drag bleeds off its speed, and
  the nose dips before it rolls over and sinks, rather than freezing in place the
  frame it touches the water. Respawn is also delayed longer now (4.5s instead of 1.8s).
- **Road reflectors** (raised reflective pavement markers, the small studs real
  US/AU roads use) now run along every lane marking: yellow on the line between
  opposing directions of travel (the center line on a two-way road, the median on a
  divided highway), white on everything that separates lanes going the same direction
  or marks a shoulder. I left out blue ones — on real US/AU roads those specifically
  mark a fire hydrant's location at the curb, not a lane boundary, and this city
  doesn't have a hydrant prop yet to anchor them to. Say the word if you want hydrants
  added and I'll give them their blue curb reflectors too.

## This round: lights, lanes, steering feel, and water

- **Street lamps and headlights now actually light things up.** The scene's ambient
  (hemisphere) + sun light were bright enough on their own that a small point/spot
  light added basically nothing next to them — the dark sky/fog color always implied
  night, but the lighting levels didn't match it. The sun is now dim moonlight and the
  ambient is cut way down to match, and the lamp/headlight intensities are raised
  enough to be clearly visible pools of light against that darker backdrop.
- **Down/S now brakes you before it reverses**, same as a real car: holding it while
  moving forward decelerates (and lights the brake lights) rather than instantly
  yanking you into reverse; it only actually drives backward once you're nearly
  stopped. Space still brakes directly at any time.
- **Steering now eases in** rather than snapping straight to full lock the instant you
  tap a direction — like turning an actual steering wheel, which takes a beat to wind
  up (and a beat to straighten back out). Combined with the corner-radius/banking math
  the roads already use, this is what makes a turn read as an arc instead of a pivot.
  (No need to go look up real-world curve-radius tables — the road geometry already
  uses a simplified version of the real `e+f = V²/127R` superelevation relation; what
  was missing was purely on the car's steering input side, not the road math.)
- **AI traffic now drives in its lane** (offset a quarter of the road's width to the
  right of centerline, same side a US right-hand-traffic driver would use) instead of
  straight down the middle of the road.
- **Every road type has lane markings now**, not just local/avenue. Highways get a
  proper divided-highway treatment: a solid double median down the centerline, a
  dashed lane divider splitting each direction's half, and solid shoulder lines —
  instead of nothing.
- **Driving into water now actually sinks you.** The car's position is checked every
  frame against the real water parcel footprints (the same polygon test buildings use
  for collision); drive onto one and the car keels over and sinks, "Sleep with the
  fishes" shows on screen, and you respawn at the start a couple seconds later.

## Two more bugs fixed the round before this one

- **The car sank into the road climbing a hill.** `car.js` eased the car's height
  toward the sampled ground height every frame — meant to smooth out a sudden curb or
  corner — but on a steep ramp (this city's bridge ramp climbs 14 units over 70, a
  20% grade) the *target* height rises faster than that easing can catch up, so the
  car's actual height trailed below the rising road surface the whole way up, reading
  as sinking through it. Height is now set directly from the per-wheel sample every
  frame, no easing; pitch/roll are still eased (a lag there just reads as suspension
  travel, which looks fine and still smooths a sudden bump).
- **Curves were still made of planes that clipped or gapped.** This was a second, later
  bug than the phantom-curve one above: the smoothed corner ribbon at a bend used a
  single width for the whole curve — picked by just grabbing whichever of the two
  joining edges happened to be found first — instead of the width the actual road has
  on each side. Anywhere a bend also changed road width (a local road widening toward a
  highway, say), the curve ribbon was uniformly too narrow or too wide for one of its
  straight neighbors, stepping visibly at the seam. The curve ribbon's width now tapers
  from one edge's width to the other's across the bend, matching both straight
  neighbors exactly at the point where they meet it (`roads.js`'s corner-building loop);
  `terrain.js`'s matching corner sampler was adjusted too, so a wheel near that same
  seam can't fall just outside too-narrow a search radius and silently sample the flat
  ground plane instead.

## What "not rendered yet" means for the new prop/parcel types

The city editor (the 2D top-down tool) already knows about all 16 new prop types and
the 2 new parcel types — it has colors, labels, and icons for all of them in its own
view. What's missing is on this side: `src/generators/props.js` only has mesh-building
functions for the original 4 prop types (tree/light/bench/sign), and
`src/generators/parcels.js` only recognizes building/park/plaza/water. A prop or parcel
of a type neither file recognizes just doesn't get a mesh built for it at all right now
— it's not that I haven't decided what a bus stop should look like, it's that nobody's
written `busStopMesh()` yet. That's a separate, mechanical pass (one small builder
function per new type) whenever you want it — say the word and I'll add them.

## Latest round: real spiral curves, vertical curves, reflector fix, more lights

- **Reflectors glowed all the time, day or night, lit or not.** The emissive material
  from the previous round made them bright no matter what — the opposite of how a real
  reflector works (it's dark until something actually shines on it). Switched to a
  plain, non-emissive, low-roughness/slightly-metallic material instead, so they only
  pick up a bright highlight when a headlight or streetlamp spotlight actually sweeps
  across them, and sit dark the rest of the time (`roads.js`'s `reflectorMats`).
- **A few more streetlights along the road.** Added several more `light` props down
  the first straight stretch and at the flat bend apex, alternating sides, so there's
  usually a pool of light nearby instead of three lonely posts for the whole route
  (`cityData.js`).
- **Horizontal curves are now real spiral-arc-spiral (clothoid) alignments**, not a
  single quadratic Bezier with a generic symmetric bank hump. Every bend is now built
  from three pieces, same as an actual highway corner:
  1. **Entrance spiral** — curvature ramps linearly from 0 (straight) up to 1/R, while
     superelevation (bank angle) ramps from flat up to the full bank over the same
     stretch, so the tilt builds in gradually instead of snapping on.
  2. **Circular arc** — constant radius R, full bank held, steering-wheel-angle
     equivalent constant.
  3. **Exit spiral** — the mirror image of the entrance spiral, unwinding curvature and
     bank back down to zero.
  A clothoid's defining property (curvature linear in arc length) makes heading an
  *exact* closed-form function of distance along the curve — no approximation needed
  there. Position has no elementary closed form (the same math as the Fresnel integral),
  so it's accumulated with the trapezoidal rule over many samples instead of the
  textbook's truncated power-series approximation. The usual spiral-curve "shift"
  parameters (k, p) and tangent-length formula `T = (R+p)·tan(Δ/2) + k` are derived from
  that same numeric integration (of the entry spiral alone) rather than a textbook
  series, so the placement of the curve and the samples actually drawn can't drift
  apart. If the computed curve doesn't fit in the straight run available before the next
  intersection, the whole thing (radius, spiral length, bank) scales down uniformly to
  fit — curvature only depends on *ratios* of (R, Ls), so this scaling needs no
  re-integration. All of this lives in `roadMath.js`'s `buildHorizontalCurve`, shared by
  `roads.js` (the ribbon mesh) and `terrain.js` (the ground sampler), same as before.
- **Vertical curves (hills and dips) are now real parabolas, not a flat linear
  interpolation.** Any 2-edge road node where the incoming and outgoing grades differ
  gets a standard symmetric parabolic vertical curve — `elevation(d) = nodeElevation +
  A·Lvc/8 + d·(g1+g2)/2 + (A/(2·Lvc))·d²` for distance `d` from the node, where `A` is
  the grade change — smoothing the grade break the way a real road profile does,
  including the correct "middle ordinate" offset (the curve passes a little below a sag
  or above a crest relative to where the two straight grades would otherwise have met).
  This is independent of horizontal curvature — a straight road can crest or dip, and a
  bend can sit on constant grade — so it's computed separately (`computeVerticalCurve`,
  `elevationAlongEdge`, `curveElevationAt` in `roadMath.js`) and applied to both the
  straight-edge ribbons (now sampled as a short polyline instead of just two endpoints,
  so the mesh can actually bend through the parabola) and the horizontal-curve samples,
  plus `terrain.js`'s ground sampler for both.
- Verified with a standalone numeric test (not shipped, just used to check the math)
  confirming the curve's start/end land exactly on the correct tangent lines, the total
  heading change matches the intended deflection angle, bank ramps correctly from 0 at
  the spiral start to full at the arc and back to 0 at the end, and the vertical-curve
  elevation matches the expected middle-ordinate offset — then drove the whole route
  (intersection, both bends, the highway, bridge, and tunnel) and checked every mesh in
  the scene for non-finite vertices: zero, across 3300+ meshes.

## Latest round: right-hand traffic fix, brighter reflectors, darker nights, one-way streets

- **AI traffic was actually driving on the left.** Checked this empirically rather than
  just re-deriving the lane-offset formula on paper (the paper derivation kept saying it
  was already correct, which was the trap) — froze the chase camera with a same-
  direction car ahead and an oncoming car approaching, and the same-direction car
  rendered on screen-*left*, oncoming on screen-*right*. That's left-hand traffic.
  Flipped the sign in `traffic.js`'s `laneOffsetOf` and re-checked the same way: same-
  direction traffic now sits on the right, oncoming on the left.
- **Reflectors still barely read as reflecting.** A plain non-emissive specular material
  only catches a highlight for an instant, at one specific angle, as the chase camera
  passes — nothing like a real retroreflector, which bounces light straight back toward
  the headlight (and so toward the driver's eyes) from almost any angle it's lit from.
  Rather than fight that with material tuning, each reflector stud now gets its own
  small emissive value, driven directly: a fixed, precomputed glow for studs near a
  streetlamp (lamps don't move, so this is computed once at startup, not every frame),
  and a brighter, dynamic boost for whichever studs are actually inside the player's
  headlight cone this frame (`main.js`'s `updateReflectors`, fed by a `reflectors` list
  `roads.js` now collects as it builds the lane markings).
- **Night was still too bright.** Dropped the ambient hemisphere/moonlight further
  (`main.js`) and widened + brightened the headlight spotlights themselves (`car.js`) —
  the road should go properly dark outside a light source's actual reach now, instead of
  being dimly visible everywhere.
- **Lane lines and reflectors looked wrong on slopes.** Every line/dash/reflector box
  was rotated only around its vertical axis and placed at a lerped height — correct on
  flat ground, but on a grade (most visible on the 20%-grade bridge ramps) the box's
  flat underside no longer matched the tilted road surface, so it read as floating above
  the road at one end and sinking into it at the other. They're now oriented with a real
  3D basis (`roads.js`'s `orientAlongGrade`): forward tilts to follow the actual rise/
  fall of the segment, "right" stays horizontal (a line doesn't roll side-to-side on a
  grade, only pitches along it).
- **Pedestrians barely reacted to the car any more.** The sidewalk-width cap from a
  previous round (meant to stop them wandering into a building) ended up capping the
  dodge itself down to almost nothing. A real "jump clear of an oncoming car" doesn't
  stop at the curb, so the cap is gone — the dodge can now carry them off the sidewalk —
  and both the trigger range and the push distance are much bigger than before.
- **A proper one-way street, with AI and the player both accountable to it.** Added a
  small one-way couplet (`cityData.js`): two ordinary two-way connectors off the main
  road with a real one-way street between them (`oneWay: true` on that edge, meaning
  legal travel is `from`->`to` only), wrapping a new building block — genuinely more
  city, not just more props scattered on the old layout. A new `oneway` sign prop
  (`props.js`) marks both ends: one at the legal entrance, one at the far end facing
  back down the street so a wrong-way entrant sees an arrow pointing away from them.
  `traffic.js` won't route AI cars onto a one-way edge from its wrong end, ever (checked
  by forcing 400 update ticks and confirming the `to`->`from` direction never appears).
  The player isn't hard-blocked (you can still physically steer onto it backwards), but
  driving it the wrong way is now *detected* — `main.js` flags it, shows a "WRONG WAY"
  banner, and counts it as an offence (`window.__game.offences.wrongWay`), the first
  piece of what a later ticketing/scoring system could use.
- Verified with Playwright throughout: zero runtime errors, zero non-finite vertices
  across 3700+ meshes, the one-way edge never driven backwards by AI across hundreds of
  simulated ticks, and the wrong-way banner both triggering and clearing correctly.

## Known gaps (next things to build, not bugs)

- **Tunnels are a simple box shell**, not a true cut into the terrain — fine for now,
  but a real terrain mesh with a boolean-cut portal would look better eventually.
- **AI traffic cars don't follow the curve/bank math** the player's car and the road
  meshes share — they lerp straight between node endpoints, which is only visibly
  different from the real road shape on this city's handful of bends. Giving them the
  same cornering math as the player would be the natural next step if that starts
  looking wrong once there are more curves for them to drive around.
- **AI traffic only avoids what's directly ahead of it** (a simple distance+angle
  check, no real lane concept) — it'll queue behind a stopped car or the player, but two
  traffic cars on crossing approaches at the intersection aren't prevented from both
  being in the box at once except by the signal timing itself (which does keep them from
  both having green, but doesn't model "clear the intersection before the next phase").
- **Pedestrians can't climb stairs or reach a different elevation than the sidewalk
  they're on.** Sidewalks inherit their road's elevation, so they do slope up a bridge
  ramp along with the road — but there's no data concept yet for a pedestrian-only
  vertical connector (a staircase up to a raised plaza, say) that isn't just a road
  elbow. That would need a new kind of link in the waypoint graph (two waypoints at
  different elevations, connected directly, maybe with a short animation) — worth
  doing once you have a city layout that actually needs it.
- **Bus stop waiting has no bus yet** — pedestrians pause there, but nothing ever
  arrives to pick them up. It's there so the behavior exists before the vehicle does.
- **New prop/parcel types from the editor (gas station, diner, speed sign, stop sign,
  etc.) aren't rendered or collidable here yet** — see above. This project's generators
  still only know the original 4 prop types and 4 parcel types.

## Latest round: multi-lane AI, crosswalks, clean intersections, smoother one-way street

- **AI traffic now turns instead of snapping to the new heading.** Switching edges at a
  node used to set the mesh's rotation directly, so the visible heading jumped in the
  same frame the car reached the node. It now eases toward the target heading at a fixed
  turn rate (`traffic.js`'s `car.visualHeading`, with proper shortest-path angle
  wrapping), so corners actually look like turns.
- **AI traffic cars have wheels now**, spinning in proportion to speed (the spin axis is
  baked into the wheel geometry itself rather than applied as an extra mesh rotation, so
  it can't fight the body's own Y rotation).
- **A real multi-lane system**, driven by a new per-edge `lanes` field in `cityData.js`
  (lanes-per-direction on a two-way edge; total lane count on a `oneWay` edge):
  - `roads.js`'s lane markings are now lane-count- and one-way-aware instead of always
    drawing the old fixed "one lane each way" pattern: a one-way edge gets no yellow
    center line at all (there's no opposing direction to divide from) plus evenly-spaced
    white dividers across its full width; a multi-lane two-way edge keeps the yellow
    centerline but adds white dividers splitting each direction's own lanes.
  - AI traffic picks a sensible lane for the edge it's about to drive, one edge ahead of
    time (`traffic.js`'s `chooseLaneIndex`, using a one-step lookahead via a new
    `car.nextEdge`): left turn coming up → leftmost lane, right turn → rightmost lane,
    continuing straight → one of the middle lane(s) (randomized between the two most
    central lanes when there's no single exact middle, so straight traffic spreads
    across more than one lane instead of piling into the same one).
  - Added **Grand Avenue** to the demo city: three blocks of a 4-lane (2 each way) through
    road lined with buildings and two ordinary cross streets, specifically to give this
    system enough road to show lane choice on — watch an AI car merge toward the curb
    lane before a right turn, or the centerline lane before a left.
- **Lane markings no longer run through intersections.** Any node with 3+ connected
  edges now gets a "paint clearance" zone (`roads.js`'s `buildRoads`): markings stop
  short of it on every approach, while the pavement ribbon itself still runs the full,
  untrimmed distance (a real intersection has continuous pavement, just no lane paint
  inside the box). This applies across the whole city, not just the new test road — the
  existing signaled 4-way intersection looks noticeably cleaner now too.
- **Crosswalks**, drawn as zebra stripes (`roads.js`'s `addCrosswalk`) at that same
  clearance line on every approach to a true intersection — stripes run parallel to the
  direction of travel, matching a real crossing, and the placement lines up with where
  `pedestrians.js` already routes a crossing through its waypoint graph.
- **Fixed the one-way street clipping into a building.** The inner block's building
  footprint used to run right up against the road edge (and the one-way edge got a hair
  wider when it picked up its 2-lane treatment); the footprint is pulled back in
  `cityData.js` for a clean gap now.
- **The one-way street's 90° corners are wider and smoother.** The horizontal-curve
  corner trim (`roadMath.js`'s `buildHorizontalCurve`) used to be capped by a fixed
  per-road-type constant regardless of the road's actual width, so even a 9-unit-wide
  street got the same tight ~4-unit corner as the narrowest street in the city. The trim
  target now scales with the road's own width, giving a visibly wider, more realistic
  turning radius on anything wider than the original single-lane streets.
- **Fixed the one-way sign's confusing arrow direction.** A sideways arrow only makes
  sense on a sign mounted at a right angle to the street it's describing (telling cross-
  traffic which way a *different* one-way street runs); mounted facing oncoming traffic
  head-on, like this one, that read as ambiguous. The arrow (`generators/props.js`'s
  `onewaySignMesh`) now points straight up the sign's own face, reading unambiguously as
  "the road continues this way" regardless of which way the sign prop itself is rotated.

## Latest round: pedestrians off the street, optional sidewalks, mobile controls

- **Pedestrians were waiting in the road — two real causes.**
  1. Sidewalks ended a fixed 3 units from each node, which is *inside* any cross street
     wider than 6 (every street here, and Grand Avenue by a lot), so the spot where
     someone stands waiting for a signal was on the cross street's pavement. Sidewalk ends
     now stop at the crossing street's pavement edge plus a margin
     (`roadMath.js`'s `intersectionClearance`), and at smoothed bends where the straight
     ribbon hands over to the corner ribbon.
  2. A pedestrian shoved off the curb by the player's car, then told to wait for a light,
     skipped the position update entirely and froze wherever they'd landed. Waiting now
     only stops them advancing; they still ease back onto their path.
  Verified by sampling every pedestrian for 40s headless: no one waiting on pavement, and
  no one on a road except while actually crossing.
- **Crosswalks now sit where pedestrians cross.** Last round's README claimed this, but the
  painted crosswalk (at the edge's own width) and the walkable crossing (fixed 3 units)
  didn't line up. Both now use the same `intersectionClearance`, and lane paint resumes a
  stop-line gap beyond it.
- **Pedestrians can walk around corners.** Sidewalk ends from different streets meeting at
  the same node are now linked, so they roam the whole network instead of shuttling up and
  down one street.
- **Sidewalks are a per-edge option, not a new road type.** `sidewalks: false` on an edge in
  `cityData.js` leaves it bare (no sidewalk, no crosswalk, no pedestrians); default is on
  for everything except highways, `sidewalks: true` forces them onto a highway. A new road
  *type* would have meant duplicating every per-type table (speed, color, curve radius,
  vertical curve, spiral length) for what is really just a yes/no.
- **Touch controls** (`input.js`): on touch devices the HTML build shows on-screen steer
  left/right (bottom-left), GAS and BRAKE/reverse (bottom-right), and indicator and
  headlight toggles (top-right). Each is its own multi-touch button, so you can steer and
  hold the gas at once. Desktop never sees them.

## Latest round: lights, signals, tunnel, bigger city, highway ring

- **Reflectors** light only inside the real headlight cone (position, direction and angle of the beams, not the car centre); AI headlights light them too, over a shorter range.
- **Ground glow** under brake lights, indicators, AI tail/head lights and traffic-signal lenses (cheap additive decals/halos, no extra real lights). Streetlamps use a small fixed pool of real spotlights near the car.
- **Bridges**: side rails and posts follow every sample of the deck curve; piers under the deck.
- **Tunnel**: taller (7.2), and the camera drops low and close when you're underground so the roof never sits between camera and car.
- **Traffic signals**: big backplated heads on corner poles with halos, facing the right approach; 1.5 s all-red between phases. AI cars now obey them (red = stop at the line, yellow = go only if they can reach the line before red). A 20-minute simulated run shows no red-light running.
- **Corner banking** is highway-only; city streets are flat.
- **City**: more blocks (west, east, north/south extensions), plus the yellow highway is now a closed ring around the whole city (bridge on the north side, tunnel on the south-west), joined to town by three connectors.
- Road ribbons are lifted per type (local < avenue < highway) so overlapping surfaces at junctions don't flicker.

## Follow-up: cone lights, level roads, pedestrians

- Tail/brake light spill on the ground is now a cone fanning out behind the car (narrow at the lamp, wide and fading at the far end) instead of a circle.
- All road banking is gone: every road is level, which fixes the tilted curves dipping through the ground and the warped lane paint on them.
- Pedestrians cross at a brisk jog and only step off the curb if enough red is left to finish the crossing; otherwise they wait for the next one.

## Round: stop signs, speed limits, double yellow, tunnel cuts

- **Stop signs / right of way** (`junctionRules.js`): at any 3+ road junction without a signal, equal-rank roads get an all-way stop; otherwise only the lower-ranked roads stop (highway > avenue > local), so the big road flows through. Signs + painted stop lines are generated from that, and AI cars stop, wait, and go only when the junction is clear (minor roads also yield to approaching traffic on the big road).
- **Speed limits**: posted 40 (local), 60 (avenue), 100 (highway) km/h on signs along every road; the HUD shows units/s x 6.2 as km/h, and AI cruises just under the limit. Override per edge with `speedLimit`.
- **Double yellow** centre line on every two-way road (highway median too).
- **Tail lights** throw two separate streaks (one per lamp) on the road.
- **Traffic lights** spill coloured light onto the approach lane (red/yellow/green).
- **Tunnel**: ramps are now open cuts with retaining walls, and the tunnel ends have concrete portals, so the highway ring visibly connects instead of vanishing under the ground.

## Road map

- Tune cars (engine, tyres, suspension)
- Upgrade shops, NFSU-style (visual and performance parts)
- Different race types
- Unlockable regions
- Earn money
- Step out of the car and walk around
- Buy a home you can walk around in, with a garage; more garage spaces cost more (TDU-style)

## Round: lighting realism + day/night

- Rear lights: no more streaks. A faint red wash on the road right behind the car (stronger when braking) plus a bloom at each lamp.
- Traffic lights no longer light the road (real signals don't); the lit lens and its halo are the signal.
- Street lamps are ~55% taller with wider, softer light and a larger pool on the road.
- **Day/night toggle**: the button at top-right or the N key. Eases over ~1.5 s: sky, fog, ambient, sun, lamps, ground light pools and reflectors all follow one value. Headlights switch on at night and off by day (L still overrides).

## Round: settings menu, weather, minimap, tunnel lights, crashes

- **Menu** (gear button or Esc): traffic and pedestrian density, time of day (slider + Morning/Day/Evening/Night presets), fog, rain, snow, and a car picker with a spinning 3D preview (six bodies in `carModels.js`). Pauses the game but keeps rendering so changes show live. Settings persist in localStorage.
- **Time of day** is keyframed (`environment.js`): dawn, morning, day, golden evening, dusk, night; sun swings across the sky. The N key / sun-moon button still sweeps between day and night.
- **Rain**: streaks around the camera, darker sky, wet glossy roads that dry slowly. **Snow**: flakes, and an accumulation that whitens ground, roofs and (less) roads over ~45 s of snowfall and melts after. Neither falls inside the tunnel.
- **Minimap**: bottom-left, north-up street map (white streets, orange highways, green parks, blue water), player arrow, checkpoint dots.
- **Tunnel**: ceiling lights over each driving direction with real spotlights and floor pools (always on).
- **AI crashes**: an AI car you hit stops for ~12 s with its hazard lights flashing (honk once audio exists).
- **Fixes**: two buildings that clipped the rounded highway corners were resized; dashed lane lines no longer turn into solid lines on curves (dash phase now carries across short segments).

## Latest round

- **Stop sign** is now an upright octagon (flat edge on top).
- **Indicators** swapped to the correct sides (lenses and ground glow).
- **Signs** (stop / speed limit) are real colliders now: they topple at ~11 km/h and you keep ~88% of your speed.
- **Falling** follows your travel direction (`destruction.js`); lamps go dark for good when knocked down (spotlight, glow, lens, and the road studs they lit).
- **Traffic lights** break into pieces (mast top, arm, signal head, ped box; the stump stays).
- **Debris stays**: thin things (poles, signs, arms) are driven over (5–10% speed cost, once per object); compact heavy things (signal heads, ped boxes, benches) are pushed ahead of the car.
- **AI**: junction turns now follow a smooth arc (`tryStartConn`), heading/lane offset are continuous along paths, speed drops for bends, lane changes ease in/out.
- **AI vs player**: look-ahead scales with speed, heading-aware (oncoming / crossing cars don't block), cars swerve round a parked player or crashed car when there's room, and any AI that touches you stops with hazards on.
- **Intersection gridlock**: cars won't enter a box whose exit is clogged, and a deadlock breaker lets a truly stuck queue slip through for a few seconds (not at red lights). 60-car, 20-minute sim: longest stand-still 16 s (was 585 s).
- **Snow** now shows as white dots that appear and fade on the road (shader, no extra geometry). Rain/snow/fog intensity gusts randomly (fog +/-25% around the set value). Rain and snow are mutually exclusive.
- **Density caps** raised to 60 cars / 120 pedestrians (AI headlights only light road studs within 70 units).
- **Minimap**: view window can no longer run off the drawn map (the highway ring sat right at the old edge, where browsers handle out-of-bounds `drawImage` differently).

## Latest round (crashes, vehicle classes, graphics)
- **Crashes**: momentum exchange between cars. Speed lost/gained depends on mass ratio and closing speed; the other car is shoved along the impact direction, spins on side hits, and for hard hits hops, tumbles and becomes a wreck that is cleared once you are far away.
- **Player cars** each have their own top speed, acceleration and mass. Heavier cars lose more speed hitting objects (poles, signs, buildings).
- **AI traffic** now includes taxis, vans, trucks and buses (own speed, acceleration, braking, mass, multi-circle collision bodies).
- **Snow**: no dots in tunnels; dots last longer so snow builds up more.
- **Debris**: falling poles and flying pieces now collide with the car body; traffic lights no longer leave a stump.
- **Graphics tab** (menu): ambient occlusion (off/low/high), texture quality (low/medium/high), bloom, tone mapping. Defaults are lighter on touch devices. Also: environment reflections, procedural asphalt/ground/facade detail, baked-style AO gradients and contact shadows, new car models.

## Round after that (fixes)
- Windows: lit/dark state is now per window (was flipping mid-window). Roads are dark asphalt, sidewalks lighter, less reflective.
- Anything you hit (even a light tap) stops and flashes hazards. Car collision body is now nose/middle/tail circles, and AI vehicles have circles matching their real length, so no more clipping into them.
- Speed: cars now actually reach their listed top speed (drag was capping them). Frame-time clamp raised and physics substepped, so low FPS no longer means slow motion. FPS counter + Resolution (50/75/100%) in the Graphics tab.
- Phone: installable PWA (manifest, icons, offline cache). Host `dist/` on any static HTTPS host (GitHub Pages, Netlify), open it on the phone, "Add to Home Screen" for a fullscreen app.

## Touch controls / view distance
- Phone: slide-to-steer strip (further from centre = sharper turn) and a gas slider (slide up = more throttle). Indicator/light buttons moved below the menu buttons.
- Graphics tab: View distance (Short/Medium/Long) scales fog and cuts the camera far plane; Medium is the phone default.
- STOP sign is bigger with larger lettering.

## Round: grip, taxi job, ramps
- **Grip**: rain/snow lower tyre grip (HUD shows 💧 wet / ❄ icy). Turn rate is capped by grip/speed (understeer), braking and acceleration weaken, and the car's real velocity lags its heading so it slides on after turns and crashes (car.js `grip`, `vx/vz`, `absorb`).
- **Snow on props**: up-facing surfaces of trees, poles, benches etc. whiten as snow accumulates (surfaceShaders.js `installSnowCap`).
- **Highway ramps**: slip roads (edges `r1`-`r4`, `ramp: true`) at the east and west connectors; no stop signs on merges; AI avoids near-U-turn choices. US-style overhead exit gantries (signs.js `addGantries`).
- **Taxi job** (menu toggle 🚕): taxi.js. Pickup/drop-off beams + map pins, route arrow at top centre, turn-by-turn text, fares by distance/time, cash saved in localStorage.
- **Buses and trucks** only drive avenues/highways (too long for 9 m side streets).
- **Pedestrians**: new human models (pedestrians.js).

## Checks (run when asked)
`node tools/check.mjs signs | lamps | buildings | traffic [cars] [minutes] | all` - signs and lamp posts must sit beside (not on) roads and outside buildings; `buildings` fails if any building footprint covers a road; traffic sim must have no stuck cars. Exit code 1 on failure. Add new checks to `CHECKS` in tools/check.mjs.

## Round: polish
- Bloom/shine toned down (reflector studs back to small dots), progressive touch steering (first half of the slide is gentle), weaker brakes, taxi job only active with the Taxi car, merge lanes on both on-ramps, cleaner paint at slip-road junctions, gantries only on straight highway, sign posts nudged off roads.

## Round: ratings, snow detail, bigger city
- **Taxi ratings & profile**: taxi.js detects red lights (crossing a signal's stop line on red), stop signs (crossing without slowing below ~10 km/h) and crashes during a ride. Each infraction cuts the fare; a clean fast ride earns a speed bonus and sometimes a random tip. 1-5 star rating per fare (infractions and being slower than the time limit lower it). Click the cash/rating widget for the profile (fares, rating, total earnings, best ride, infractions). Average (last 20 fares) below 3 stars = much longer wait for the next passenger.
- **Snow**: sign faces get plastered snow (surfaceShaders.js `plaster`), signs/lamp heads/signal housings get white lids (`snowCap`), lamp poles/arms and signal poles fade white at the top to the paint colour lower down (`grad`, heights baked by `bakeSnowHeights`).
- **Exit signs**: 1 MILE, 1/2 MILE, then the exit; found by walking back along the highway, never on a curve. The two advance signs also carry a left-hand NEXT EXITS panel (`exit.next` in cityData.js).
- **City**: road under the bridge and over the tunnel, tree-lined boulevard with planted median, town square (fountain, gazebo, food stands, benches, bushes), more park trees. New props: oak, bush, fountain, gazebo, foodstand.

## Round: Chicago, shops, apartments, on foot
- **The map**: the city is now a generated Chicago (src/chicago/): Lake Michigan, the river (blue) with its branches, an interstate (dark green on your map) running down the west side, 6-lane main roads, 4-lane secondary streets and 2-lane side streets, Grant Park and other parks, Navy Pier, a stadium, landmark towers. Flat except the bridges (over the river and where streets cross the interstate). `chicago/map.js` holds the map data (coordinates, rivers, parks, districts), `gen_network.js` builds the road lines and interchanges, `network.js` turns lines into the road graph (junctions, bridges, pruning), `chicago.js` makes buildings, signals, props, shops and apartments.
- **Exits with merge lanes**: every exit has a deceleration lane, every on-ramp a merge lane. The outside lane gets exits too: the cross street continues over the interstate on a bridge and meets the outside slip roads. Exit gantries (1 MILE, 1/2 MILE, exit) follow.
- **Buildings**: districts with their own look (downtown towers with setbacks and spires, brick mid-rise, gabled low-rise, warehouses with tanks, Chinatown pagodas), merged into a few meshes per area.
- **Parked cars** line the kerbs (instanced), and **buses** have proper windscreens and visible wheels.
- **On foot**: **E** steps out (when nearly stopped) and back in (within ~4 m of the car). Arrow keys/WASD walk (left/right turn), Shift runs, buildings, props and water block you.
- **Yellow arrows** mark apartment doors (green once owned); the shop arrows use the shop's colour. Walk (or drive slowly) up to one and press **E**.
- **Apartments**: buy with cash (taxi fares, checkpoints +$25, you start with $300). Studio $800 (1 garage space), flat $2,500 (2), loft $6,000 (4), penthouse $15,000 (8). Garage spaces limit how many cars you can buy; the two starter cars (hatch, taxi) park free. Owned apartments let you swap your active car and sleep until morning.
- **Shops** hide in alleys between buildings, marked on the street by a tall glowing lamp in the shop's colour (like NFSU) and on the minimap (D P R T B):
  - turquoise **Dealership** (2 in town): sport $9.5k, muscle $14k, pickup $6.5k, van $5k - preview each car before buying.
  - blue **Performance**: engine, turbo, tyres, brakes, 3 stages each.
  - red **Paint & decals**: 13 paints, racing stripe / twin stripes / side stripes (hug the real car surface) in 6 colours.
  - yellow **Tuning**: neon underglow, xenon headlights, nitro tank in the trunk (hold Shift), digital speedo and pro cluster HUD.
  - green **Body kit**: front/rear bumpers, side skirts, 4 spoilers, fender flares.
  Entering a shop brings your car into the bay and orbits it while you shop. Everything is saved per car (localStorage `gridlock.world`).
- **Checks**: lamp/sign checks now ignore kerbside parked cars; signal poles that land in a road or building get nudged or dropped; gantries skip spots that would stand in a building.

## Round: arcade handling, suspension, bigger map, scale
- **Map is 2x** (`S = 2.5` in chicago/map.js): triangular junctions are now 45 degree diagonals, a clean-up pass removes sliver junctions (network.js), landmarks are trimmed back so no building covers a road (new `buildings` check, which found 7 landmark towers sitting on roads).
- **Arcade handling** (car.js): ~25% higher top speeds, quicker turn-in that relaxes with speed, strong grip. Hold **Space while steering** above ~40 km/h for a handbrake slide. **Grass is slippery** (about half grip, drags speed) and so are rain/snow as before.
- **Suspension**: the body rides on springs over four wheel contact points. Braking dips the nose, power squats it, corners lean it, **kerbs (0.1 u = 12.5 cm, raised pavements 3.5 m wide) and bumps jolt it** and the wheels visibly push in / droop. Driving off a bridge or ramp is now a real **fall** (gravity, nose follows the flight path, landing soaks into the springs and costs a little speed); water still sinks you.
- **Bridge wobble fixed**: `heightAt` (terrain.js) used to pick the nearest road sample point's height, so ramps and corners were stair-stepped; it now projects onto the road ribbon exactly as roads.js draws it, and prefers the top surface where a ramp rises out of a street.
- **M** (or tap/click the minimap) opens the **whole-city map** with you, shops, apartments, checkpoints. Esc now opens the menu.
- **Shops**: your car sits nose-out and you see its front and right side; **drag (mouse or finger) to turn it round** - yaw only, it can't be tipped over; it keeps coasting a little like a turntable. The shop beacon is a lamp with a spotlight beam shining straight down.
- **$100,000** starting purse (once per save), so you can browse the apartments and shops.
- **On foot**: slower and smoother (turn eases in, ~95 deg/s; walk 2.4 u/s, run 5.2), camera swings round behind you gently.
- **Proportions locked to 1 u = 1.25 m**: man 1.8 m (1.44 u), woman 1.65 m, children 1.2-1.4 m; player cars 4.5 x 1.9 m, sedan/taxi 4.5 x 1.9, van 6.1 x 2.1, truck 9.8 x 2.6, bus 13 x 2.6; stop sign face ~0.9 m with its bottom edge 2 m up, speed-limit sign 0.6 x 0.75 m, lamp posts ~8 m, signal masts ~7 m; local road 11 m, 4-lane 20 m, 6-lane 30 m.
- **Doors and windows**: apartments have a 0.9 m door in a frame with a step, canopy and lamp; shops a 1.9 m glass double door under an awning in the shop's colour (generators/doors.js). Windows are on a real grid (3.5 m storeys, 3 m bays) with a shopfront band on the ground floor.

## Round: reverse lights, performance shop
- **Reverse lights**: white lenses, halos and a white wash behind the car while you reverse.
- **Performance shop** now shows Speed / Acceleration / Handling / Braking / Grip bars (hover or tap a part to preview the change in green/red) and the car's weight. Parts: engine, turbo, gearbox, tyres, suspension, brakes, lightweight materials (-4% weight/stage), remove seats (-80 kg), remove speed limiter (+8% top speed). Weight feeds acceleration, braking and handling (`perfStats` in world.js, `handlingMul`/`baseMass` in car.js). Shop drag-to-spin now works from anywhere on screen outside the panel.

## Round: freeways, garages & flats, races
- **Feel**: reverse lights dimmer; braking is gentler and more progressive (no more wall-stop). Traffic cap 40 -> 220 cars and 100 -> 450 pedestrians (recycled around you), a busy city.
- **Shops**: you drive *into* a shop (its door/bay) to open the menu - no button. **Leave** puts the car 15 u out in the alley, nose to the street, clear of the camera. Shop floodlights are angled toward the street. Shops only **sell** cars now; switching cars happens in your garage (the settings menu still switches for testing).
- **Freeway**: 3 lanes per direction, two separate one-way carriageways with a median (gap for bridge pillars). Gantries sit only above their own carriageway; the opposite direction gets "next two exits" boards. Interchange bridges stand on a single median pillar, never in a lane; underpasses have solid retaining walls where the ramp meets the ground, so you cannot be popped onto a deck (terrain.js ignores decks above the car).
- **Checks** (`node tools/check.mjs signs|lamps|buildings|traffic|markings|bridges|solid|water|all`): road markings do not clash (intersections, on/off ramps), bridge pillars never stand in a lane, every pillar/prop that should block does, no road turns into water.
- **Apartments by price**: Micro studio $9k (floor 2, 1 parking) -> Studio $19k -> One-bed $42k -> Two-bed $86k -> Loft $165k -> Penthouse $390k (floor 18, 6 parking). More rooms, more space, higher floor. Every flat has bed, dining, kitchen, bathroom with toilet + shower; the windows are on the building front and look out over the real city.
- **Buying** puts a blue **garage gate** (minimap "P") on the building. Drive at it: the roller door rises, you fade into a two-lane ramp that dips underground and a hall with exactly as many bays as the apartment has parking spaces. Drive back up the ramp to leave. Walk up to the gate (E) to go in on foot.
- **In the garage**: your other cars are parked in their bays. Step out anywhere (E) and the game remembers exactly where and how it is parked (`save.fleet`); stand next to another car and press **E** to hop in - the car you leave stays where you left it. The yellow **elevator arrow** takes you up to the flat (first-person), the green arrow goes out to the street, the blue one is the bed (sleep until morning). New cars you buy wait in a free bay.
- **Real estate agents**: four offices (north / south / east / west, teal doors, minimap "RE"). They list every flat in their region with price (+10% over the door price), surface, floor, rooms and parking spaces. Villas (own garage) are planned.
- **Map fix**: the river/road overlap that turned a road blue (and drowned you) is gone, and the white plane overlapping the road start was removed.
- **Races** (replace the old checkpoints): markers on the map and street icons - **Drag** (straight line, fastest to the line), **Drift** (slide for points: longer, faster, wider angle = more), **Circuit** (a lap of the city through checkpoints) and **Sprint** (a unique A to B path, no laps). Top 3 win $5,000 / $3,000 / $1,500. Pro races on a track are planned.
- **Race guidance**: a yellow strip on the road leads you to the next checkpoint, the HUD says "Turn left/right in N m" (or "Straight on"), a tall beacon marks the checkpoint, and the minimap shows the next checkpoint (yellow ▶) and the one after (white 2).
- **Races**: driving through a race icon no longer starts it - press **E** (or click the prompt) near the ring. **Backspace** quits a race and it stays quit.
- **Shops use a cart**: pick parts/paints/cars, the cart total updates, the car shows a live preview, then press **Purchase** (it reads *Insufficient funds* and is disabled when you cannot afford the cart). Leave drops the unpaid cart. Staged parts (engine 1-3...) charge the earlier stages you skip.
- **Highway lanes**: traffic keeps to the right lane, moves over for its exit within 200 m, and faster cars pass in the left lanes, stay there a few seconds, then merge back right (`node tools/check.mjs traffic` reports the lane shares).

## Sound, weather, classes (batch 6)
- **Sound** (`src/audio.js`, all synthesised, on by default; Settings → Sound / Volume): engines by revs and type (hatch/i4 buzz, sport, V8 muscle, diesel van/pickup, heavy bus), AI engines with doppler, car-passing whoosh and wind at speed, tyre roll (tarmac loud, grass different, snow, wet hiss), skid squeal / gravel, indicator ticks, rain (muffled indoors), bus/truck air brakes at standstill, and AI honks - diverse pitch/length/pattern, heavier for vans/buses/trucks - when you hit a car or stand in its way.
- **Covered areas** (`src/covered.js`): garages, flats (pocket worlds) and tunnels are covered - no rain/snow drawn there, rain sound muffled. `node tools/check.mjs covered` verifies it.
- **Tyre marks** (`src/skidmarks.js`): dark streaks when sliding on tarmac, soft tracks through settled snow; fade over ~26 s.
- **Weather look**: wet roads are only damp (less shine), with mirror-like puddles in low spots; snow builds up faster and covers the road more.
- **Parked cars** (`src/parked.js`) wake up when you get close and become real physical cars: shove them, spin them, crash them.
- **Classes** (`src/classes.js`): F..A (G reserved for classics). Start hatchback = F, 120 km/h, 0-100 in 10 s, weak brakes/handling. Van, taxi, bus = F; pickup, muscle, sport = E. Fitting every upgrade lifts a car one class (shown in the performance shop). Races now have a class (F/E): rivals run at their class pace, E pays 1.8x, and a car of a faster class than the race can't enter. New drivable **City bus** (7.2 m shuttle) and the **Van** are in the dealer.

## Batch 7 - HUD, on-foot sticks, public transport, wardrobe, stores, lighting, garage

- **Race markers**: the entry zone is ~20 m across; the gate poles are gone (only a banner high above the road). Race starts keep clear of apartment doors, garage gates, shops, stores, agents, the bus depot and cab stands, and overlapping minimap markers are spread apart.
- **Cars**: acceleration +25 % for every car (0-100: hatch 7.6 s, sport 4.7 s). The engine voice is softer and less digital, with revs that follow a fake gearbox. A dash HUD shows speed, gear and a rev bar (green -> orange -> red).
- **On foot**: two thumb sticks (left = move, right = camera by default; Settings -> "Swap sticks" flips them). Gamepads work the same way.
- **Public transport** (`src/transit.js`, `src/transitScene.js`): 3 bus lines run as loops over the avenues, with stops (pole, shelter, bench). Real AI buses follow them, pull up at the kerb, wait 5-8 s and move on. A bus depot sits beside an avenue; 14 painted cab stands are spread around town. Stop on a TAXI bay for a moment to start (or end) a taxi shift in any car. Taxi and bus are no longer purchasable cars.
- **Interiors**: lamps (ceiling, floor, table), real shadows from one lamp per flat, window daylight patches that follow the sun.
- **Sleep**: use the bed, drag the clock hands, sleep until that hour.
- **Wardrobe and clothes shops** (`src/wardrobe.js`): five clothes shops you enter like an apartment. A fitting mirror shows your character on a stage you can spin; what you buy goes to the wardrobe and you keep wearing what you came in with. Same for cars: you keep driving yours and the new one goes to the garage.
- **Garage**: pillars every 3 bays, more bays, NPC cars in some, free non-owned bays marked "no parking"; leave a car there for 1 minute and you get a $5,000 fine (the car stays).
- Checks: `node tools/check.mjs traffic` now also verifies bus lines, stops served, depot and cab stands.

## Batch 8 - graphics pass, depot

- **Sky** (`src/sky.js`): gradient that follows the time of day, sun disc and glare, drifting clouds (heavier and greyer in rain/snow), stars and a moon, haze in fog.
- **Sun fix**: the sun position was NaN (a Color was used as a Vector3), so the sun light never really worked. It does now, with shadows (soft PCF, 1024/2048/4096).
- **Wet roads** mirror the sky, the sun glare and, at night, smears of lit windows and neon.
- **Cinematic FX** (`graphics.js`, toggle in Settings): sun light shafts between buildings, speed-dependent field of view and radial blur, chromatic aberration, vignette, warm/cool grade, film grain, impact shake.
- **Night windows**: warm, cool-white, flickering TV-blue and orange windows.
- **Particles** (`src/puffs.js`): tyre smoke while sliding, sparks on hard hits.
- **Quality presets** (Low/Medium/High/Ultra) and a shadow detail setting in Settings -> Graphics.
- **Bus depot**: fenced yard, hall with roller doors, flood lights and a colour-coded fleet. 3-5 buses per line now.

## Batch: grip, grass, reverse, city life (2026-10-23)
- Hit cars slide less (more friction + damping on knocked cars, lower bounce).
- Grass now costs ~20% of top speed; screen shake only fires on the frame of an impact; bigger, whiter tyre smoke.
- Low-speed turning circle is ~5.3 u (about 6.6 m) minimum radius, like a normal car.
- Braking: hold brake/back until you stop; reverse only starts after you release and press again.
- Rain reflections are soft warm-white streaks instead of coloured smears.
- Traffic: spatial grid, LOD (full / box / hidden) and lazily-grown pool, cap 800. Pedestrians: cap 2000, lazy growth, merged single-mesh LOD beyond 70 u, hidden beyond 230 u, no animation when far.
- Pedestrians only cross where roads.js paints a crosswalk (same test as the paint).
- Roads: cracks, oil/tyre stains, tar repair strips and patched squares (Textures medium+).
- Street lamps ~1.7x as many (about every 35-70 m per side); instanced park path lights that glow at night.
- iPhone: installable PWA (host `dist/` over https, Add to Home Screen).

## Batch: signals, spray (2026-10-26)
- Traffic lights: green 7 s, yellow 2 s, and 4 s of all-red between one direction ending and the other starting (was 1.5 s).
- Spray: water thrown from the wheels when driving through the rain puddles (same noise as the road shader's puddles), and powder kicked up on snow-covered roads. Not shown under cover.

## Batch: drift circuits, bodykits, night look, save (2026-10-26)
- **Drift events** now run on three closed circuits outside the city (`src/driftTrack.js`): Block Loop (rectangle), Serpent (S-bends), Delta (triangle). The three drift gates in the city teleport you to the grid; finishing or quitting (Backspace / Quit) puts you back at the gate. Tyre walls (collide only while a track is in use), kerbs, floodlights.
- **Drift handling** (`car.driftAssist`, only on the circuits): a hard turn at speed on the gas breaks traction by itself (about 25 degrees of slide, was 7), and the handbrake slides further. Phones get a HANDBRAKE button (left, above the steering wheel).
- **Save**: progress already saved to localStorage (money, cars, mods, race results, flats). Settings -> Save adds a downloadable backup file, loading a backup and a start-over button; the game also asks the browser to keep the data.
- **Body kits** rebuilt (`src/bodykit.js`): splitter, sport and aggressive front chins with intakes and canards, ground-effect skirts, bolt-on and wide-body arches, vented / scooped / carbon hoods, diffusers with twin pipes, lip, ducktail, GT wing and tall race wing on stands.
- **Night look**: cool violet shadows, warm highlights, more contrast and saturation, stronger bloom; neon signs on tall buildings (instanced, 12 words), spawn point moved next to apartment garages, puddle spray smaller and greyer.
- **Performance**: far lamps / signal heads / signs are hidden beyond ~55% of the view distance (about 100 fewer draw calls at the spawn); neon signs and path lights are instanced; defaults on phones are already gentler (no AO, 75% resolution, medium textures).

## Batch: weather, radio, sirens, garages in the city (2026-10-27)
- **Dynamic weather** (`src/weather.js`): the game clock runs (24 h = 60 real minutes, toggle "Clock running") and the weather follows it: clear / cloudy / fog / rain / snow with a temperature (snow only near or below freezing). A pill top-right shows icon, degrees, kind and the clock. Settings: "Dynamic weather", plus the manual rain/snow/fog toggles (which switch dynamic weather off).
- **Snowploughs** (`serviceVehicles.js`, `plowfx.js`): six ploughs go out while it snows. Each clears a strip of snow off the road (road-shader clear mask, it refills while snowing), throws spray to the right of the blade and salt out the back.
- **Police, ambulances, fire engines**: models, sirens (police wail/yelp, ambulance hee-haw, fire sweep with Doppler), flashing light bars. They run 20-45 s with the siren on, then drive normally. A hospital, three police stations and two fire stations are on the map (✚ / PD / FD pins) with the vehicles parked at them.
- **Audio** (`audio.js`): crowd and traffic ambience scaled with how busy the street is, birds by day, rain on a hall reverb, tunnel and garage acoustics (no street ambience in the garage; tunnels keep traffic hum, wind and tyres), no gear-shift noise in reverse, surface-dependent tyre squeal (tarmac / wet / snow / grass).
- **Radio** (`src/radio.js`, key R, Shift+R backwards): two built-in synthesised stations (Neon Drive, Low Key) with a DJ who reads the time, weather, temperature and the forecast for the rest of today and tomorrow (browser speech synthesis, so the voice depends on the device). Your own songs: put mp3/ogg/m4a files in `public/radio/<station>/` (optional `station.json` for the name/DJ); `npm run build` writes `radio/stations.json`. The radio keeps playing in garages (with echo) and in shops.
- **Traffic**: signal split 8.5 s green / 2.5 s yellow / 2 s clear (same 13 s half cycle); cars no longer enter a junction without room to leave and left turns yield.
- **Pedestrians**: individual pace, lateral offset, pauses, 72 looks. They only react to a car that is on the pavement: look, brace, then jump clear (or relax if it never comes).
- **Taxi**: "Off duty" button; no new fares while off.
- **Garage in the city**: the underground garage is now built under the building in the real world. Drive through the door and down the ramp - nothing fades or teleports, the camera follows you down. (Apartments now need a 26 u wide, 24 u deep front, so some may have moved.) The lift has doors, a floor display and a call panel.
- **Flats**: desk (stats, cars, races, progress), sleep advances the weather clock, plants, curtains, wall art, bookshelf, and a terrace with a glass door in the dearer flats.
- **Shops** show your car in a lit showroom (walls in the shop's colour, name board, kit-specific props); the item list keeps its scroll position.
- **Districts**: Neon Strip (many neon signs), Downtown (CBD, tallest towers), Industrial, Chinatown and others; the name pops up as you enter and the city map draws them. All shops are pinned on the map.
- **Neon signs** stick out from the walls 3-5 m up. Front bumpers no longer cover the headlights.

## Batch 2026-10-27 (b)
- **Traffic**: lane choice spreads cars across lanes, a deadlock breaker for stuck cars, no more loops; highways have guard rails and trees.
- **Street lights** run along every street at a regular spacing. Gas stations (8) with fuel, tow and premium gas; tank upgrade at the garage.
- **Races**: pre-race menu (route on the map, length, lap record, opponents, laps, traffic/weather/time/pedestrian tuning, Start with a short loading screen). Traffic is cleared 300 m around the start and kept low. Circuits are one continuous loop; the start line is the finish line. Drag uses manual shifting with a big rpm dial. Drift circuits are smaller and tighter with bonus lines.
- **Cameras**: chase / bumper / top / interior with tunable distance and height. Interior with working gauges, wheel, indicators and lights.
- **Map zoom**, harbour (first guess), reset car (U), run toggle (G), compact mobile buttons, hail-a-cab, car purchase parks the old car, desk lists cars per house.
- **Clothing**: more detailed character (neck, ears, face, hair, hands, split limbs) and garment models (collars, hoods, pockets, lapels, ties, cuffs, belts, laces, soles); catalogue grew to 19 shirts, 12 pants, 11 hats, 8 glasses, 8 shoes.

## Batch 2026-10-27 (c): Chicago map + the Studio
- **New road layout, traced from your Chicago map image** (`tools/ref-map.png`). `tools/trace_roads.py` + `tools/build_mapdata.py` read the colours (tan avenues, maroon streets, dark-green highway, blue water, green parks, pink landmarks) and write `src/chicago/mapdata.js/.json`; `tools/dedupe_streets.py` removes streets traced twice. Lake, rivers, piers (Navy Pier, Filtration Plant, Adler, Meigs), parks, landmarks, districts, shops, stations, gas stations and the harbour slips all come from that data. 1 map px = 2.5 world units.
- **Studio** (`studio.html`, also reachable from the settings menu): four tabs, saved to this browser (`localStorage` key `gridlock-custom-v1`) and read by the game at start-up. Export / Import moves it between devices; "Reset all" goes back to the original game.
  - **Map**: every layer (streets with class, highway, lake, rivers, parks, piers, landmarks, stadium, districts, highway exits, shops, hospital/police/fire, gas, harbour slips) is draggable on top of your map image (opacity slider). Double-click a line to add a point, right-click a point to delete, "+ New" to draw new things, Ctrl+Z undoes. "Rebuild roads" runs the real road builder and overlays the result (and its warnings).
  - **Races**: drop checkpoints anywhere. The route is the shortest road path between consecutive checkpoints (Dijkstra, `src/routeTool.js`); each checkpoint is joined to the nearest road by a straight connector, so a checkpoint off the road makes the race cross grass (drawn dashed orange). Circuit (closed loop, laps) or Sprint (A to B). Shift+click the route inserts a checkpoint; drag to move; right-click deletes. Custom races join the generated ones in the race menu.
  - **Cars**: side-profile editor (body outline, glass, extra boxes such as roof / wing / bed) with a live 3-D preview, plus colour, class, top speed, acceleration, mass, braking, handling and dealership price per car. The six player cars are now data (`CAR_SPECS` in `vehicleModels.js`).
  - **Upgrades**: every price and effect in the performance, tuning, paint and body-kit shops (`UPGRADE_DEFAULTS` in `src/customData.js`), the dealership prices, and a calculator that shows what a build does to a car.
- `npm run build:html` now also makes `dist-singlefile-studio/studio.html` (the Studio as one file).
- Fixes needed by the new layout: lamps/signs far from any road are dropped, props inside buildings or water are dropped, the circuit generator is more tolerant, bus lines may use local streets.
- Not covered: the old `city-editor.html` (different data format) is obsolete.

### Fix (same day): black roads
- The thin black lines on the map are roads (small streets, causeways to the piers, highway exit ramps), not park paths. `tools/add_black_roads.py` traces them and adds them after `build_mapdata.py`; ramps next to the highway are left to the interchange code. Highway exits are now the three on the map: top-left diamond (Wrigley), west clover, bottom lens (McCormick); the stray exit at Old Town is gone.
- Roads to Navy Pier, the Filtration Plant, Adler Planetarium and Meigs Field are back (on thin causeway decks, which the water check now treats as dry).
- Bus lines may use some local streets (at most 55 % of a line) and tolerate sharper turns.

### Fix (same day): road sanity pass
- `tools/clean_map.py` (run after add_black_roads + dedupe, before build_interchanges): straightens wiggly streets, closes gaps between a dead end and the street it points at (up to ~40 m anywhere, ~100 m when collinear, further across rivers), and drops isolated pieces shorter than ~140 m. The network builder now also prunes dead-end stubs under 90 units.
- `tools/build_interchanges.py` traces the three interchanges (clover, Wrigley diamond, McCormick lens) from the black lines of the map as real arcs; `gen_network.js` builds the slip roads from those arcs (exit/entry decided by which side of the interstate and which side of the cross street they sit), with a short blend onto the carriageway. Streets that only traced a ramp are removed.
- Order of the tools: build_mapdata, add_black_roads, dedupe_streets, clean_map, build_interchanges.

### Fix (same day): black roads, smooth ramps, 4th lane
- `tools/add_black_more.py`: second pass over the black lines (only what no street covers yet; landmark outlines, bank lines and lettering are skipped). Tool order is now: build_mapdata, add_black_roads, add_black_more, dedupe_streets, clean_map, build_interchanges.
- Slip roads (gen_network.js): leave the carriageway tapering into a 4th lane (23 u from the median, 3 lanes stay between exit and entry), run alongside for up to 80 u, then a Hermite curve joins the traced arc tangent-continuously. Near the interstate's ends they get less room.
- traffic.js: `car.hwJoin` - no lane changes for the first 80 u (100 m) after joining the interstate from a ramp.

## Latest additions

- **Sprint/circuit/drag no longer freeze the game.** Race rivals threw an error on every frame once the race began (`px is not defined` in `traffic.js`), which stopped the whole update loop; the loading screen also stayed up if `begin()` failed. Both fixed, and `node tools/check.mjs rivals` runs the rivals on every planned route (the races check also confirms every start is clear and drivable).
- **Drift:** hitting a tyre wall (or any fixed object) hard cancels the combo in progress (banked points are kept); the circuit car is looser (a bigger slide angle, which keeps paying up to ~70 degrees).
- **Race menu map** shows the whole city (north up, lake and rivers, route on top).

- **True speeds.** The HUD's km/h used 6.2 per world unit/s but 1 u = 1.25 m, so it showed ~38 % more than the car covered. `src/units.js` now holds `KMH_PER_U = 4.5` and every speed and acceleration (cars, traffic and its limits, rivals, class reference speeds, reverse, stat bars, taxi time limit) was multiplied by 6.2/4.5, so a car shows the same km/h as before but really covers that ground.
- **Drift circuits** are half the length and width (a quarter of the area; lap 280-360 m, 18 u wide) and the extra-points band next to each wall is twice as wide.

- **Road map rebuilt from the clean map image.** The street layer (`streets` in `src/chicago/mapdata.json`) was re-traced from the clean map (tan avenues, maroon streets, black roads): 349 traced pieces, merged into 143 long, straight streets (gentle curves only where the map has them). Roads hidden behind map labels (Art Institute, Sears Tower, Dearborn Station, Field Museum, Wrigley Field, John Hancock Center, McCormick Place) are connected. `tools/apply_new_map.py <chains.json>` applies it (set `RIVERS_JSON` to the output of `node tools/export_rivers.mjs <file>` so roads are tested against the game's own water): it keeps roads out of the water except real bridge crossings, joins dead ends over dry land and adds a Shedd Aquarium deck.
- **Interchanges use standard layouts.** Wrigley (north-west) and McCormick (south-west) are *diamonds* with straight slip roads; the west one is a *partial cloverleaf*. Slip-road lanes no longer run over a river.
- Lamps keep clear of junction corners.
- **Gas price towers**: ground-standing LED boards (~4 m), regular/diesel/premium rows, face the street.
- **Front wheels** steer with the real cornering angle (bicycle model, eased).
- **Flats**: `node tools/check_flats.mjs` walks every flat layout (flood fill, walker radius 0.32) and fails if a room, bed, wardrobe, desk, lift or exit cannot be reached. Sofa/TV slide clear of doors; dressers sit against walls.
- **Walking**: shoes swing with the legs; look stick is 30 % slower; cars brake for a walker and shove them if they still hit (`traffic.walkerHit` -> `world.shoveFoot`).
- **Garages**: an owned apartment's ramp is cut into the ground plane (`setGarageHoles`) and always drawn, so the car never sinks under the street.
- **Shop car parks**: `shop.bays` (chicago.js) + painted lines (`shopBays.js`), about half of the bays hold a parked car.
- **Tyre snow**: small flakes thrown sideways in a low arc (puffs.js).

### Road rules (latest)
- Road classes: highway 3 lanes/carriageway (3.6 m + 3 m shoulders, 120 km/h), express road (orange, 3 lanes, 120), main arterial (yellow, 3 lanes, 70), residential (1 lane, 50). Limits in `src/chicago/network.js` `CLASSES`.
- Only the interstate curves; every other road is a straight point-to-point line. No dead ends, meeting points >= 100 m apart (`tools/regraph.py`, checked by `node tools/check.mjs rules`).
- Bridge approaches are sized from each class's max grade (6 % / 15 %). Interstate bend radius >= ~690 m, banked by tan(theta) = v^2/(r g).
- District edges are snapped to gaps between roads (`tools/snap_districts.py`).

### Phase 1 additions
- Loading bar with stage names (`src/loading.js`; main.js awaits `tick()` between build stages).
- Six new original cars: Family wagon, Trail SUV, Rally hatch, Roadster, Supercar, Hypercar (`carModels.js`, `vehicleModels.js`; fictional, no real badges).
- Ghost laps + local top-10 leaderboard per race (`src/ghostLaps.js`, stored in localStorage `gridlock-ghosts-v1`).

## Checks (node tools/check.mjs all)
rivals, sidewalks, gas, races, drift, covered, signs, lamps, buildings, traffic, markings, bridges, solid, water, rules (road-class/meeting-point/grade rules), driveways (gas-station entrances free + kerb dipped), smooth (road elevation continuity), mesh (drawn road surface matches driving surface).
`node tools/brake_audit.mjs [cars] [minutes]` lists where AI cars brake hard and why (car.cause). AI rule: no stop/turn-slowdown at highway/ramp merges; stop/yield only where junctionRules says.

## Latest round: checks, drawbridge, overhead signals

- **New checks** (`node tools/check.mjs <name>`): `pavement` (no sidewalk over a road; roads win and pavement is cut),
  `connected` (every road that should join does, including height, so ramps no longer dangle at the river bridge),
  `mesh` (road surface continuity). `traffic` now also flags AI circling and parked-car overlaps.
- **AI circling fixed**: neighbouring corner fillets used to overlap; `roadMath` now caps each corner's reach so they never do.
- **Shops**: menus fill the screen, you must press E to enter, and closing fades instead of panning the camera.
- **Launch physics**: hit objects fly away in the hit direction, lighter ones further (`mass` in `physicsConfig`).
- **Parked cars** sit half on the road (local streets are 8.4 wide) and are included in the solid-collision checks.
- **Drawbridge** (`src/drawbridge.js`) on the north river: opens every 5 minutes for 60 s, flashing lights, a bell that rings
  from 10 s before it moves until it is moving, barrier gates, and AI traffic stops for it. Debug: `window.__game.drawbridge.skipTo(t)`.
- **Overhead traffic lights**: wide approaches get a mast arm with one head over every lane; in the inner city some
  junctions use a suspended cable between two poles instead. More big junctions are signalised (153 poles now).

## River bridges
Three arterial crossings of the river are now bridged (`gen_network.js`, "river bridges" block): arterials that already
spanned the river but were too short for ramps borrow road from both banks, and pairs of arterials that stopped opposite
each other are joined. `RB_ALLOW` lists the crossings that pass every check; the other four candidates each left a
dead-end side street, so they are off. Try one with `RB=0,2,5,1 node tools/check.mjs rules`.

## Town life, slice 1 (street furniture)
Fire hydrants, mailboxes and café sets (table + chairs, busy districts only) line the streets (`chicago.js`, "street furniture").
A hit hydrant pops off and sprays water for ~12 s (`src/spray.js`); mailboxes and café sets are light and get launched.
Still to come in this phase: storefronts, parks with seating, food stands, gyms.
