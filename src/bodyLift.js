// How far a tipped-over car body must be lifted so no corner sinks into the ground. The body origin sits at the wheel
// base, so a car rolled onto its side would otherwise be half underground. Euler order YXZ (roll about z, then pitch about x).
export function bodyLift(pitch, roll, hw = 0.8, h = 1.45, hl = 1.9) {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch);
  let low = 0;
  for (const x of [-hw, hw]) for (const y of [0, h]) for (const z of [-hl, hl]) {
    const y1 = x * sr + y * cr;
    const y2 = y1 * cp - z * sp;
    if (y2 < low) low = y2;
  }
  return -low;
}
