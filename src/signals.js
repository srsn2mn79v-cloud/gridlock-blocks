// Traffic-signal phase logic. Phase is a pure function of (signal, timeMs) — no ticked
// simulation state to keep in sync — mirroring how the Gridlock City Editor's Signal
// tool models them, so this same function is what future vehicle AI or an
// infringement/cop system would also call. Pedestrians below are the first consumer.
export function phaseAt(signal, nowMs) {
  const cycle = signal.greenMs + signal.yellowMs + signal.redMs;
  if (cycle <= 0) return 'green';
  const t = ((nowMs + (signal.offsetMs || 0)) % cycle + cycle) % cycle;
  if (t < signal.greenMs) return 'green';
  if (t < signal.greenMs + signal.yellowMs) return 'yellow';
  return 'red';
}

// Whether it's safe to start crossing the road this signal governs: cars approaching
// this intersection along this approach are not flowing (not green). Yellow counts as
// "not clear" — cars are still legally in the intersection, so pedestrians wait it out.
export function isApproachClear(signal, nowMs) {
  return phaseAt(signal, nowMs) === 'red';
}

// Finds the signal (if any) for traffic entering `nodeId` along the road from
// `towardNodeId`. The Gridlock City Editor exports a signal as { nodeId, edgeId, ... }
// (one signal head per approach edge, matched back to the road graph by edge id on
// reload); hand-authored city data can use that same shape, or the more readable
// { nodeId, approachFrom, approachTo } shape directly — both are accepted here so a
// real editor export and a hand-written test city work the same way.
const _sigCache = new WeakMap();
export function findSignalForApproach(cityData, nodeId, towardNodeId) {
  let m = _sigCache.get(cityData); if (!m) { m = new Map(); _sigCache.set(cityData, m); }
  const key = nodeId + '|' + towardNodeId;
  if (m.has(key)) return m.get(key);
  const edge = (cityData.roadEdges || []).find(e =>
    (e.from === nodeId && e.to === towardNodeId) || (e.from === towardNodeId && e.to === nodeId)
  );
  const r = (cityData.signals || []).find(s => {
    if (s.nodeId !== nodeId) return false;
    if (edge && s.edgeId && s.edgeId === edge.id) return true;
    return (s.approachFrom === nodeId && s.approachTo === towardNodeId) ||
           (s.approachFrom === towardNodeId && s.approachTo === nodeId);
  }) || null;
  m.set(key, r);
  return r;
}

// Milliseconds of red left on this approach (0 if not red). Pedestrians use it to decide
// whether they can actually finish crossing before cars are released.
export function redRemainingMs(signal, nowMs) {
  const cycle = signal.greenMs + signal.yellowMs + signal.redMs;
  if (cycle <= 0) return 0;
  const t = ((nowMs + (signal.offsetMs || 0)) % cycle + cycle) % cycle;
  return t < signal.greenMs + signal.yellowMs ? 0 : cycle - t;
}
