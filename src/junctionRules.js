// Right-of-way at junctions with no traffic light. Roads have a rank (highway > avenue >
// local); at a junction of 3+ roads the approaches that must STOP are:
//   - every approach, if all the roads meeting there are the same rank (all-way stop);
//   - otherwise only the lower-ranked approaches (the big road flows straight through).
// Signalled junctions are skipped entirely. Shared by the AI (traffic.js), the painted stop
// lines (roads.js) and the stop-sign props (signs.js) so all three always agree.
import { buildEdgesByNode } from './roadMath.js';

export const roadRank = e => (e.type === 'highway' ? 3 : e.type === 'avenue' ? 2 : 1);

export const stopKey = (nodeId, edgeId) => nodeId + '|' + edgeId;

// Returns { stops: Set of "nodeId|edgeId", allWay: Set of nodeIds }.
export function computeStopApproaches(city) {
  const byNode = buildEdgesByNode(city.roadEdges);
  const signalled = new Set((city.signals || []).map(s => s.nodeId));
  const stops = new Set(), allWay = new Set();
  Object.keys(byNode).forEach(nodeId => {
    const edges = byNode[nodeId];
    if (edges.length < 3 || signalled.has(nodeId)) return;
    const ranks = edges.map(roadRank);
    const max = Math.max(...ranks), min = Math.min(...ranks);
    if (max === min) allWay.add(nodeId);
    edges.forEach(e => {
      // a one-way road that points away from the node has no approach into it
      if (e.oneWay && e.from === nodeId) return;
      // slip roads merge into the highway without a stop sign
      if (e.ramp && edges.some(o => o.type === 'highway')) return;
      if (max === min || roadRank(e) < max) stops.add(stopKey(nodeId, e.id));
    });
  });
  return { stops, allWay };
}

// Posted limits in km/h (the HUD shows speed * 6.2 as km/h).
export const SPEED_LIMITS = { local: 40, avenue: 60, highway: 100 };
export const speedLimitFor = e => e.speedLimit || SPEED_LIMITS[e.type] || 40;
