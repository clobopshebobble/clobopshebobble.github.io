// The tap gate: which impacts get a pencil tap. Pure, so the Node tests can rattle it.
//
// The world reports a normal impulse from every contact on every step. A ball that is STUCK (wedged in
// a crack, pinned under a plank) keeps producing fresh impulses above the tap threshold, so the naive
// rule "tap when m > 1.2, at most every 70 ms" tapped forever (Bre, 2026-10-25). Two rules fix it,
// the first borrowed from the renderer's scribble clouds:
//   1. a SPOT that is still being hit stays silent until it has rested for HIT_SPOT_REST;
//   2. a long run of quick taps anywhere fades to a murmur (never silent: cascades stay audible).
export const TAP_MIN = 1.2;          // impulse below this is a resting contact, not a knock
export const TAP_EVERY = 70;         // ms between taps
export const HIT_SPOT_REST = 600;    // ms a spot must be quiet before it may tap again
export const TAP_RUN_GAP = 450;      // a gap longer than this ends a run of taps
export const TAP_RUN_FREE = 6;       // taps in a run before the fade begins
export const TAP_RUN_FLOOR = 0.2;    // the murmur

export function createTapGate() {
  const spots = new Map();           // cell → last impact time (0.5-unit cells, like the clouds)
  let lastTap = -1e9, run = 0;
  return {
    /** impacts: [{ m, x, y }] from one step; now: ms. Returns { m, vol } for the tap to play, or null. */
    pick(impacts, now) {
      let best = null;
      for (const i of impacts) {
        if (i.m <= TAP_MIN) continue;
        const cell = `${Math.round(i.x * 2)},${Math.round(i.y * 2)}`, last = spots.get(cell) ?? -1e9;
        spots.set(cell, now);
        if (now - last < HIT_SPOT_REST) continue;
        if (!best || i.m > best.m) best = i;
      }
      if (spots.size > 400) spots.clear();
      if (!best || now - lastTap <= TAP_EVERY) return null;
      run = now - lastTap > TAP_RUN_GAP ? 1 : run + 1; lastTap = now;
      const fatigue = Math.max(TAP_RUN_FLOOR, 1 - Math.max(0, run - TAP_RUN_FREE) / 8);
      return { m: best.m, vol: Math.min(1, best.m / 12) * fatigue };
    },
  };
}
