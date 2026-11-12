# Gridlock Blocks: rules and checks

Run `node tools/check.mjs quick` (seconds), `sim` (minutes) or `all`. Single checks and groups `placement`, `roads` also work.

## Checks
- **placement**: signs, lamps/poles, driveways, buildings, pavement, sidewalks. Nothing on a road or in a building; pavement never over a road (road wins); no sidewalk stubs/islands.
- **roads**: markings, bridges, water, smooth, mesh, connected, rules. No paint clashes, no pillars in lanes, no road under water, gentle grades, drawn surface = driven surface, one network meeting at equal heights, lane/junction rules.
- **sim**: traffic (40 cars, 5 min: no stuck, circling, overlaps incl. parked), solid (every object solid), rivals, races.
- **gameplay**: gas, drift, covered.

## AI traffic
Follows lane paths; stops at stop signs, red/yellow lights, closed drawbridge; keeps a following gap; doesn't block a junction (box rule); yields by junction rules; respects one-way; avoids dead ends.

## Roads
Widths: highway 13.4, six-lane 18.4, four-lane 16.8, local 8.4, ramp 7.7. Corner curves capped so neighbours never overlap. Parked cars sit half on the road. Signals at junctions with 2+ wide roads (mast arm, one head per lane; suspended cable in the inner city).

## Rendering (draw calls)
Measured at the spawn point: about 610 draw calls / 1.3 M triangles per frame at night and 870 / 1.6 M by day (High preset). Keep it there:
- **Street furniture is batched** (`src/propBatch.js`): identical parts of lamps, signals, signs and small props are drawn as one streamed InstancedMesh. Each prop is still its own object in `propInstances` / `signs.instances`. Before code moves, hides or breaks a prop, call `unbatch(inst)` (main.js does this where props get destroyed).
- **Per-object materials** (a lens that lights up on its own, a lid that resizes) must set `material.userData.live = true`, or they are merged with their lookalikes.
- **Parked cars and neon signs are streamed** (`src/instanceStream.js`): one InstancedMesh per model and material, refilled each frame with what is in view. Hide a copy with `item.hidden = true`.
- **Street furniture is frozen**: its matrices are not recomputed each frame until `unbatch(inst)`.
- **Reflector studs** are split per 180 u map square so off-screen squares are skipped.
- New prop types: build them from shared materials and identical geometry (no per-prop random sizes baked into the geometry) so they batch; add the type to `BATCH_TYPES` in main.js.
