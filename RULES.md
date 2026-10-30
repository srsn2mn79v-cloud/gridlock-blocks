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
