// stroke.js — pure geometry for turning a drawn polyline (world units) into physics pieces.
// No engine here, so it is unit-testable and shared with the Node tests.

export const LINE_HALF_THICK = 0.15;   // half-thickness of a drawn LINE body, units (≈ 10 px stroke)
export const SIMPLIFY_TOL = 0.06;      // RDP tolerance, units (≈ 2 px)
export const CLOSE_DIST = 0.9;         // start–end distance that counts as a closed shape
export const PIN_MAX_SIZE = 1.1;       // a closed scribble smaller than this (units) is a PIN attempt
export const MIN_AREA = 0.15;          // closed shapes below this area fall back to a line body
export const MIN_TRI_AREA = 0.004;     // drop sliver triangles Box2D can't take

export function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

export function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

// Ramer–Douglas–Peucker
export function simplify(pts, tol = SIMPLIFY_TOL) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) { const d = segDist(pts[i], pts[a], pts[b]); if (d > maxD) { maxD = d; idx = i; } }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Decide what a finished stroke is. Returns { kind: 'pin' | 'closed' | 'open', pts, bb }
export function classify(rawPts) {
  const pts = simplify(rawPts);
  const bb = bbox(pts);
  const total = pathLength(rawPts);
  const closedByDistance = pts.length >= 4 && dist(pts[0], pts[pts.length - 1]) < Math.max(CLOSE_DIST, 0.25 * Math.max(bb.w, bb.h));
  if (closedByDistance && Math.max(bb.w, bb.h) < PIN_MAX_SIZE && total > 0.6) return { kind: 'pin', pts, bb };
  if (closedByDistance && Math.abs(polygonArea(pts)) >= MIN_AREA) return { kind: 'closed', pts, bb };
  return { kind: 'open', pts, bb };
}

export function pathLength(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]); return l; }

// Open stroke → list of oriented boxes {cx, cy, hx, hy, angle}
export function lineBoxes(pts, halfThick = LINE_HALF_THICK) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-4) continue;
    out.push({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hx: len / 2 + halfThick * 0.5, hy: halfThick, angle: Math.atan2(y1 - y0, x1 - x0) });
  }
  if (out.length === 0 && pts.length) out.push({ cx: pts[0][0], cy: pts[0][1], hx: halfThick, hy: halfThick, angle: 0 });
  return out;
}

// Closed stroke → triangles (each a convex Box2D polygon). `earcut` is injected (CDN global or npm).
export function triangulate(poly, earcut) {
  const ring = poly.length > 1 && dist(poly[0], poly[poly.length - 1]) < 1e-6 ? poly.slice(0, -1) : poly;
  const flat = [];
  for (const [x, y] of ring) flat.push(x, y);
  const idx = earcut(flat);
  const tris = [];
  for (let i = 0; i < idx.length; i += 3) {
    const t = [ring[idx[i]], ring[idx[i + 1]], ring[idx[i + 2]]];
    if (Math.abs(polygonArea(t)) >= MIN_TRI_AREA) tris.push(t);
  }
  return tris;
}

// Centre of a closed stroke (area-weighted; falls back to bbox centre)
export function centroid(pts) {
  const a = polygonArea(pts);
  if (Math.abs(a) < 1e-6) { const b = bbox(pts); return [b.cx, b.cy]; }
  let cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n], f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}
