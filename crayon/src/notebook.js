// notebook.js — the "Messy Notebook" look: a kid's school notebook come alive. Nothing here loads an
// image or a sound file; every mark is drawn by code with a deterministic wobble (seeded per thing,
// so a level looks the same every time). Terrain is drawn FROM THE PHYSICS FIXTURES, never from art
// data, so what you see is exactly what the ball hits (the wobble is ±1.5 px of decoration on top).
//
// Same interface as render.js's createRenderer: { render(game, level, ui), ctx } plus the synth
// sound effects the theme uses instead of the demo's .wav files.
import { PX_PER_UNIT, toScreen, SCREEN_W, SCREEN_H } from './level.js';
import { BALL_RADIUS } from './world.js';

// the school-supplies palette (docs/MESSY-NOTEBOOK-BRIEF.md §8)
export const NB = {
  paper: '#F7F4E9', grid: '#C9DDEA', ink: '#253352', cobalt: '#2864F0', pink: '#F35C9B', yellow: '#FFD447',
  grass: '#65B85A', brown: '#A9784B', coral: '#F16B5B', pencil: '#7D8290', margin: '#F3A9C2',
};
// the forge's crayon colours (what a level's strokes are coloured) → which material to draw
const FORGE = {
  blue: [55, 68, 223], orange: [221, 107, 23], green: [102, 162, 26], grass: [99, 163, 70], brown: [146, 94, 44],
  gray: [118, 112, 108], purple: [128, 64, 170], red: [222, 64, 56], sky: [70, 140, 230], yellow: [238, 196, 40],
  teal: [40, 160, 150], ink: [50, 50, 60], hint: [220, 100, 30],
};
const MATERIAL = {
  grass: { fill: '#65B85A', shade: '#4B9143', outline: '#2F6B34', kind: 'grass' },
  green: { fill: '#65B85A', shade: '#4B9143', outline: '#2F6B34', kind: 'grass' },
  brown: { fill: '#D8B071', shade: '#A9784B', outline: NB.ink, kind: 'wood' },
  gray: { fill: '#CDD0D5', shade: '#8B9099', outline: NB.ink, kind: 'stone' },
  blue: { fill: '#8FB7F2', shade: '#4A7CF0', outline: NB.ink, kind: 'marker' },
  sky: { fill: '#8FB7F2', shade: '#4A7CF0', outline: NB.ink, kind: 'marker' },
  orange: { fill: '#F7A64A', shade: '#D9822B', outline: NB.ink, kind: 'marker' },
  red: { fill: NB.coral, shade: '#C94B3C', outline: NB.ink, kind: 'marker' },
  yellow: { fill: NB.yellow, shade: '#E0A800', outline: NB.ink, kind: 'marker' },
  purple: { fill: '#B48AE6', shade: '#8A5BC4', outline: NB.ink, kind: 'marker' },
  teal: { fill: '#6ED1C5', shade: '#3FA99C', outline: NB.ink, kind: 'marker' },
  ink: { fill: '#B9BEC9', shade: '#7D8290', outline: NB.ink, kind: 'pencil' },
};
const NOTES = ['this should work... probably', 'gravity is rude.', 'do NOT erase', 'physics homework (the fun kind)', 'note to self: draw BIGGER',
  '(this is fine)', 'mom said no rockets inside', 'ball goes that way →', 'idea: more bells', 'I meant to do that'];

export const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const rng = (seed) => { let s = seed || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rgbOf = (c) => { const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(c || ''); return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0]; };
function forgeName(color) {
  const [r, g, b] = rgbOf(color); let best = 'ink', bd = Infinity;
  for (const [n, [cr, cg, cb]] of Object.entries(FORGE)) { const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
}

// resample a path every `step` px and push it ±amp along its normal with smooth, seeded noise:
// the hand that drew it was not quite steady. Closed paths get the same treatment all the way round.
export function wobble(pts, rnd, amp = 1.3, closed = false, step = 7) {
  const f1 = 0.07 + rnd() * 0.05, f2 = 0.19 + rnd() * 0.09, p1 = rnd() * 6.28, p2 = rnd() * 6.28;
  const src = closed ? [...pts, pts[0]] : pts; const out = []; let s = 0;
  for (let i = 1; i < src.length; i++) {
    const [ax, ay] = src[i - 1], [bx, by] = src[i]; const d = Math.hypot(bx - ax, by - ay); if (d < 0.01) continue;
    const nx = -(by - ay) / d, ny = (bx - ax) / d, n = Math.max(1, Math.round(d / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n, sk = s + d * t, o = amp * (0.6 * Math.sin(sk * f1 + p1) + 0.4 * Math.sin(sk * f2 + p2));
      out.push([ax + (bx - ax) * t + nx * o, ay + (by - ay) * t + ny * o]);
    }
    s += d;
  }
  return out;
}
export function trace(g, pts, close = false) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (close) g.closePath(); }
export function line(g, pts, color, width, alpha = 1, close = false) {
  g.save(); g.strokeStyle = color; g.lineWidth = width; g.globalAlpha = alpha; g.lineCap = 'round'; g.lineJoin = 'round'; trace(g, pts, close); g.stroke(); g.restore();
}
// ballpoint outline: a firm line plus a thinner, slightly offset second pass (the pen went round twice)
export function inkOutline(g, pts, rnd, color = NB.ink, width = 2.4, closed = true) {
  line(g, wobble(pts, rnd, 1.2, closed), color, width, 0.95, closed);
  line(g, wobble(pts, rnd, 1.6, closed), color, width * 0.45, 0.45, closed);
}
// marker fill: solid-ish colour with streaks of uneven coverage (the marker was running a bit dry)
export function markerFill(g, pts, color, rnd, alpha = 0.88) {
  g.save(); trace(g, pts, true); g.clip();
  g.globalAlpha = alpha; g.fillStyle = color; g.fill();
  const bb = bbox(pts); g.globalAlpha = 0.1; g.strokeStyle = '#fff'; g.lineWidth = 6; g.lineCap = 'round';
  for (let x = bb.minX - bb.h; x < bb.maxX + 20; x += 11 + rnd() * 7) { g.beginPath(); g.moveTo(x, bb.minY - 4); g.lineTo(x + bb.h * 0.35, bb.maxY + 4); g.stroke(); }
  g.restore();
}
// coloured-pencil hatching inside a shape
export function hatch(g, pts, color, rnd, spacing = 8, angle = -0.7, alpha = 0.35, width = 1.4) {
  g.save(); trace(g, pts, true); g.clip(); g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
  const bb = bbox(pts), R = Math.hypot(bb.w, bb.h), cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
  for (let o = -R; o <= R; o += spacing + rnd() * spacing * 0.5) {
    const j = (rnd() - 0.5) * 3, x0 = cx + nx * o - dx * R + j, y0 = cy + ny * o - dy * R, x1 = cx + nx * o + dx * R + j, y1 = cy + ny * o + dy * R;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  g.restore();
}
export function bbox(pts) { let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; for (const [x, y] of pts) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; } return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }; }
export function inside(pts, x, y) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
// edges of a polygon whose outward side faces up (where grass grows)
export function upEdges(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d < 6) continue;
    let nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (inside(pts, mx + nx * 2, my + ny * 2)) { nx = -nx; ny = -ny; }
    if (ny < -0.55) out.push([a, b]);
  }
  return out;
}
// What to draw a body as, from its forge name and the colour it was drawn in. Pure, so
// tools/forge/notebook-records.mjs can list every decision for an outside read (Jev).
export function materialOf({ name = '', isRocket = false, isStatic = false, strokes = [] }) {
  if (isRocket) return { fill: '#E6E2D6', shade: '#A9A49A', outline: NB.ink, kind: 'rocket', colour: 'gray' };   // a paper tube; the coral nose, fins and stripe come from decorate()
  if (/^brick|tower|castle|chimney/.test(name)) return { fill: '#E0A48C', shade: '#B9705A', outline: NB.ink, kind: 'brick' };
  if (/^wheel|tyre|tire/.test(name)) return { fill: '#4A4F5C', shade: '#2b2f3a', outline: NB.ink, kind: 'wheel' };
  const counts = {};
  for (const s of strokes || []) { const n = forgeName(s.color); counts[n] = (counts[n] || 0) + s.points.length; }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || (isStatic ? 'grass' : 'brown');
  // what a thing is CALLED wins over the colour it was crayoned in (a Jev read of all 366 bodies, 2026-10-23):
  // levers and carts read as wood, rocks and pillars as stone, a creature's neck is not a lawn
  if (/rock|boulder|pillar|curb|wall|grave|stone|cliff|anvil|weight|cave|ceiling|roof|floor_/.test(name)) return { ...MATERIAL.gray, colour: top };
  if (/seesaw|see_saw|\barm\b|^arm|plank|cart|lever|beam|balance|ruler|basket|crate|pole|post|peg|log|stump|raft|board|seat|bench|fulcrum/.test(name)) return { ...MATERIAL.brown, colour: top };
  if (/neck|head|body|jaw|hair|crown|tail|leg|ear|eye|nose|smile|horn|mane|belly|face|snout|fin|wing|moon|sun|cloud|star/.test(name)) return { ...(MATERIAL[top] || MATERIAL.blue), kind: 'marker', colour: top };
  return { ...(MATERIAL[top] || MATERIAL.ink), colour: top };
}
// Bodies that are a THING, not just terrain, get a little illustration on top of their material
// (a Jev read of the 366 bodies, 2026-10-23: rockets, suns, moons, boats, the unicorn, the dinosaur,
// Mr. Newton…). Pure: which drawing, from the name and the colour it was crayoned in. The drawing is
// decoration inside the body's bake — the fixtures underneath are untouched, so collision can't change.
export function decorOf(name = '', colour = '', isRocket = false) {
  if (isRocket) return 'rocket';
  if (/^sun$/.test(name)) return 'sun';
  if (/^moon$/.test(name)) return 'moon';
  if (/^cloud/.test(name)) return 'cloud';
  if (/^(boat|ship_b|hull)$/.test(name)) return 'boat';
  if (/^wheel/.test(name)) return 'wheel';
  if (/^eye/.test(name)) return 'eye';
  if (/^nose$/.test(name)) return 'nose';
  if (/^mr_t$/.test(name)) return 'mr_t';
  if (/^crown$/.test(name)) return 'crown';
  if (/^apple$/.test(name)) return 'apple';
  if (/^head$/.test(name)) return colour === 'green' ? 'dino_head' : colour === 'purple' ? 'unicorn_head' : 'face';
  if (/^neck$/.test(name)) return colour === 'green' ? 'scales' : colour === 'purple' ? 'mane' : '';
  return '';
}
export function star5(g, x, y, r, rot = 0) { g.beginPath(); for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.45 : r, a = rot - Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); }
// a small ink face: dot eyes and a mouth, centred at x,y and sized to r
export function face(g, x, y, r, { mood = 'smile', lashes = false } = {}) {
  g.save(); g.strokeStyle = NB.ink; g.fillStyle = NB.ink; g.lineWidth = Math.max(1.4, r * 0.08); g.lineCap = 'round';
  for (const s of [-1, 1]) {
    const ex = x + s * r * 0.36, ey = y - r * 0.18;
    if (mood === 'sleepy') { g.beginPath(); g.arc(ex, ey, r * 0.14, 0.2, 2.94); g.stroke(); }
    else { g.beginPath(); g.arc(ex, ey, r * 0.09, 0, 6.3); g.fill(); }
    if (lashes) for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(ex + k * r * 0.1, ey - r * 0.14); g.lineTo(ex + k * r * 0.16, ey - r * 0.3); g.stroke(); }
  }
  g.beginPath();
  if (mood === 'grin') { g.arc(x, y + r * 0.12, r * 0.42, 0.25, 2.9); g.stroke(); g.beginPath(); g.moveTo(x - r * 0.33, y + r * 0.3); g.lineTo(x + r * 0.33, y + r * 0.3); g.stroke(); }
  else if (mood === 'o') { g.ellipse(x, y + r * 0.32, r * 0.12, r * 0.16, 0, 0, 6.3); g.stroke(); }
  else if (mood === 'sleepy') { g.arc(x, y + r * 0.22, r * 0.2, 0.4, 2.74); g.stroke(); }
  else { g.arc(x, y + r * 0.1, r * 0.4, 0.35, 2.8); g.stroke(); }
  g.restore();
}

// ---- the touch toolbar's icons, doodled (index.html #toolbar gets these instead of emoji in the theme) ----
const ICON = (body, extra = '') => `<svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="#253352" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
export const TOOLBAR_ICONS = {
  map: ICON('<path d="M5 8.5 L12.5 5.5 L20 8.5 L27.5 5.5 L27 24.5 L19.5 27.5 L12 24.5 L5 27.5 Z"/><path d="M12.5 5.5 V24.5 M20 8.5 V27.5"/><path d="M8 13 L10.5 16 M10.5 13 L8 16" stroke="#F16B5B"/>'),
  reset: ICON('<path d="M24.5 11.5 A9.5 9.5 0 1 0 26.5 19"/><path d="M22 6.5 L25.5 11.8 L19.5 12.8"/>'),
  eraser: ICON('<path d="M8 20.5 L18 8.5 L26 14.5 L16 26.5 Z" fill="#F35C9B"/><path d="M13 14.5 L21 20.5"/><path d="M6 28 H26" stroke="#7D8290" stroke-dasharray="2 3"/>'),
  rope: ICON('<path d="M5 20 C9 11 13 11 16 17.5 S23 25 27.5 14" stroke="#A9784B" stroke-width="3.2"/><path d="M5 20 C9 11 13 11 16 17.5 S23 25 27.5 14" stroke="#6E4A24" stroke-width="1.2" stroke-dasharray="2 3"/>'),
  awesome: ICON('<path d="M16 4.5 L19.4 12.2 L27.5 13 L21.4 18.6 L23.2 27 L16 22.8 L8.8 27 L10.6 18.6 L4.5 13 L12.6 12.2 Z" fill="#FFD447" stroke="#C8961E"/>'),
  sea: ICON('<path d="M5.5 20 H26.5 L22.5 27 H9.5 Z" fill="#FFFDF4"/><path d="M16 20 V6"/><path d="M16.5 7.5 L25 19 H16.5 Z" fill="#FFFDF4"/><path d="M16 6 L21 8 L16 10 Z" fill="#F16B5B" stroke="none"/><path d="M8 23.5 H24" stroke="#2864F0" stroke-width="2.6"/>'),
  sound: ICON('<path d="M5.5 13 H10.5 L17 8 V24 L10.5 19 H5.5 Z" fill="#FFFDF4"/><path d="M21 12.5 Q24 16 21 19.5"/><path d="M24.5 9.5 Q29 16 24.5 22.5"/>'),
  muted: ICON('<path d="M5.5 13 H10.5 L17 8 V24 L10.5 19 H5.5 Z" fill="#FFFDF4"/><path d="M21 12 L28 20 M28 12 L21 20" stroke="#F16B5B" stroke-width="2.6"/>'),
};
// the two buttons a mouse player gets on the page itself (touch has the toolbar): restart, sound
export const HUD_BUTTONS = { reset: { x: 100, y: 702, w: 46, h: 46 }, sound: { x: 154, y: 702, w: 46, h: 46 } };

export function createNotebookRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const bakes = new WeakMap();           // record → { canvas, ox, oy }
  let paper = null, levelKey = null, doodles = null, strokesBake = null;
  const FONT = '"Patrick Hand", "Chalkboard SE", "Comic Sans MS", cursive';
  const NOTE = '"Caveat", "Patrick Hand", "Chalkboard SE", cursive';

  // ---- the page ---------------------------------------------------------------------------------
  function makePaper() {
    const c = document.createElement('canvas'); c.width = SCREEN_W; c.height = SCREEN_H; const g = c.getContext('2d'); const rnd = rng(42);
    g.fillStyle = NB.paper; g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    g.globalAlpha = 0.06; g.fillStyle = '#6b5a3a';                                     // paper grain
    for (let i = 0; i < 2600; i++) g.fillRect(rnd() * SCREEN_W, rnd() * SCREEN_H, 1 + rnd() * 1.5, 1);
    g.globalAlpha = 0.05; g.fillStyle = '#fff';                                        // a crease that caught the light
    g.beginPath(); g.moveTo(0, 300 + rnd() * 80); g.lineTo(SCREEN_W, 330 + rnd() * 80); g.lineTo(SCREEN_W, 350 + rnd() * 60); g.lineTo(0, 320 + rnd() * 60); g.fill();
    g.globalAlpha = 0.75; g.strokeStyle = NB.grid; g.lineWidth = 1;                     // the graph grid
    for (let x = 0.5; x < SCREEN_W; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, SCREEN_H); g.stroke(); }
    for (let y = 0.5; y < SCREEN_H; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(SCREEN_W, y); g.stroke(); }
    g.globalAlpha = 0.85; line(g, wobble([[84, 0], [84, SCREEN_H]], rnd, 0.8), NB.margin, 2);  // the pink margin line
    g.globalAlpha = 1;
    for (const y of [128, 384, 640]) {                                                 // punched holes
      g.fillStyle = '#E6E1D3'; g.beginPath(); g.arc(42, y, 10, 0, 6.3); g.fill();
      g.strokeStyle = 'rgba(80,70,50,.25)'; g.lineWidth = 1.5; g.beginPath(); g.arc(42, y, 10, 0, 6.3); g.stroke();
    }
    return c;
  }

  // ---- what to draw a body as: from its forge colour and name ------------------------------------
  const materialFor = (rec) => materialOf({ name: rec.spec.name, isRocket: rec.isRocket, isStatic: rec.spec.isStatic, strokes: rec.spec.gfx?.drawing?.strokes });
  // every fixture of a body in body-local px: [{ kind:'poly', pts } | { kind:'circle', x, y, r }]
  function shapesOf(body) {
    const out = [];
    for (let f = body.getFixtureList(); f; f = f.getNext()) {
      const sh = f.getShape();
      if (sh.getType() === 'circle') out.push({ kind: 'circle', x: sh.m_p.x * PX_PER_UNIT, y: sh.m_p.y * PX_PER_UNIT, r: sh.m_radius * PX_PER_UNIT });
      else if (sh.m_vertices) out.push({ kind: 'poly', pts: sh.m_vertices.map((v) => [v.x * PX_PER_UNIT, v.y * PX_PER_UNIT]) });
    }
    return out;
  }
  function drawShape(g, s, mat, rnd) {
    if (s.kind === 'circle') {
      const n = 28, pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * 6.2832; pts.push([s.x + Math.cos(a) * s.r, s.y + Math.sin(a) * s.r]); }
      if (mat.kind === 'wheel') {
        markerFill(g, pts, mat.fill, rnd, 0.92); inkOutline(g, pts, rnd, mat.outline, 2.6);
        g.save(); g.strokeStyle = '#D9DCE3'; g.lineWidth = 2; g.globalAlpha = 0.8;
        for (let k = 0; k < 3; k++) { const a = k * 2.094; g.beginPath(); g.moveTo(s.x - Math.cos(a) * s.r * 0.75, s.y - Math.sin(a) * s.r * 0.75); g.lineTo(s.x + Math.cos(a) * s.r * 0.75, s.y + Math.sin(a) * s.r * 0.75); g.stroke(); }
        g.fillStyle = '#D9DCE3'; g.beginPath(); g.arc(s.x, s.y, s.r * 0.22, 0, 6.3); g.fill(); g.restore();
        return;
      }
      markerFill(g, pts, mat.fill, rnd); hatch(g, pts, mat.shade, rnd, 6, 0.9, 0.3); inkOutline(g, pts, rnd, mat.outline, 2.2);
      return;
    }
    const pts = s.pts; const bb = bbox(pts);
    switch (mat.kind) {
      case 'grass': {
        markerFill(g, pts, mat.fill, rnd, 0.9); hatch(g, pts, mat.shade, rnd, 10, -0.6, 0.18);
        inkOutline(g, pts, rnd, mat.outline, 2.4);
        g.save(); g.strokeStyle = mat.shade; g.lineWidth = 2; g.lineCap = 'round'; g.globalAlpha = 0.95;
        for (const [a, b] of upEdges(pts)) {                                           // tufts along the top
          const d = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d;
          for (let t = 6 + rnd() * 8; t < d - 4; t += 9 + rnd() * 9) {
            const x = a[0] + ux * t, y = a[1] + uy * t, h = 5 + rnd() * 6, lean = (rnd() - 0.5) * 6;
            g.beginPath(); g.moveTo(x - 3, y + 1); g.lineTo(x + lean, y - h); g.moveTo(x + 3, y + 1); g.lineTo(x + lean + 2, y - h * 0.7); g.stroke();
            if (rnd() < 0.08) { g.save(); g.fillStyle = NB.pink; g.beginPath(); g.arc(x + lean, y - h - 2, 2.6, 0, 6.3); g.fill(); g.fillStyle = NB.yellow; g.beginPath(); g.arc(x + lean, y - h - 2, 1.1, 0, 6.3); g.fill(); g.restore(); }
          }
        }
        g.restore(); break;
      }
      case 'wood': {
        markerFill(g, pts, mat.fill, rnd, 0.9);
        const along = bb.w >= bb.h ? 0 : Math.PI / 2;
        hatch(g, pts, mat.shade, rnd, 7, along, 0.45, 1.6);                              // the grain
        inkOutline(g, pts, rnd, mat.outline, 2.4);
        if (bb.w * bb.h > 1400) {                                                       // nails
          g.save(); g.strokeStyle = NB.ink; g.fillStyle = '#9DA3AE'; g.lineWidth = 1.2;
          for (const t of [0.22, 0.78]) {
            const x = bb.minX + bb.w * (along ? 0.5 : t), y = bb.minY + bb.h * (along ? t : 0.5);
            if (!inside(pts, x, y)) continue;
            g.beginPath(); g.arc(x, y, 3, 0, 6.3); g.fill(); g.stroke(); g.beginPath(); g.moveTo(x - 2, y); g.lineTo(x + 2, y); g.stroke();
          }
          g.restore();
        }
        break;
      }
      case 'stone': markerFill(g, pts, mat.fill, rnd, 0.85); hatch(g, pts, mat.shade, rnd, 7, 0.8, 0.4); hatch(g, pts, mat.shade, rnd, 9, -0.6, 0.2); inkOutline(g, pts, rnd, mat.outline, 2.2); break;
      case 'brick': {
        markerFill(g, pts, mat.fill, rnd, 0.9); hatch(g, pts, mat.shade, rnd, 9, 0.2, 0.25); inkOutline(g, pts, rnd, mat.outline, 2.2);
        g.save(); g.strokeStyle = mat.shade; g.lineWidth = 1.5; g.globalAlpha = 0.7; trace(g, pts, true); g.clip();
        g.beginPath(); g.moveTo(bb.minX, bb.minY + bb.h / 2); g.lineTo(bb.maxX, bb.minY + bb.h / 2 + 1); g.stroke(); g.restore(); break;
      }
      case 'rocket': markerFill(g, pts, mat.fill, rnd, 0.92); hatch(g, pts, mat.shade, rnd, 7, 1.2, 0.25); inkOutline(g, pts, rnd, mat.outline, 2.4); break;
      case 'pencil': markerFill(g, pts, mat.fill, rnd, 0.5); hatch(g, pts, mat.shade, rnd, 5, 0.7, 0.5, 1.2); inkOutline(g, pts, rnd, mat.outline, 2); break;
      default: markerFill(g, pts, mat.fill, rnd, 0.9); hatch(g, pts, mat.shade, rnd, 9, 0.9, 0.22); inkOutline(g, pts, rnd, mat.outline, 2.4);
    }
  }
  // ---- the illustrations: what a named body gets drawn ON TOP of its material (decorOf) -----------------
  function decorate(g, kind, name, shapes, rnd, mat) {
    const circles = shapes.filter((s) => s.kind === 'circle').sort((a, b) => b.r - a.r), polys = shapes.filter((s) => s.kind === 'poly');
    const c = circles[0]; const big = polys.map((p) => ({ p, b: bbox(p.pts) })).sort((a, b) => b.b.w * b.b.h - a.b.w * a.b.h)[0];
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    switch (kind) {
      case 'rocket': {                                                                  // a paper tube with a coral nose, fins and a porthole; +x is the nose
        const nose = polys.find((p) => p.pts.length === 3); if (nose) { markerFill(g, nose.pts, NB.coral, rnd, 0.95); inkOutline(g, nose.pts, rnd, NB.ink, 2.4); }
        if (!big) break; const b = big.b, fh = b.h * 0.55;
        for (const s of [-1, 1]) { const fin = [[b.minX + 2, s * b.h / 2], [b.minX + b.w * 0.22, s * b.h / 2], [b.minX + b.w * 0.1, s * (b.h / 2 + fh)], [b.minX - b.w * 0.06, s * (b.h / 2 + fh)]]; markerFill(g, fin, NB.coral, rnd, 0.95); inkOutline(g, fin, rnd, NB.ink, 2.2); }
        const sx = b.maxX - b.w * 0.2; markerFill(g, [[sx, b.minY + 1.5], [sx + 7, b.minY + 1.5], [sx + 7, b.maxY - 1.5], [sx, b.maxY - 1.5]], NB.coral, rnd, 0.85);
        const wx = b.minX + b.w * 0.58, wy = (b.minY + b.maxY) / 2, wr = b.h * 0.3;
        g.fillStyle = '#9CC4F5'; g.strokeStyle = NB.ink; g.lineWidth = 2; g.beginPath(); g.arc(wx, wy, wr, 0, 6.3); g.fill(); g.stroke();
        g.strokeStyle = '#fff'; g.globalAlpha = 0.8; g.lineWidth = 1.6; g.beginPath(); g.arc(wx, wy, wr * 0.6, 3.5, 5.0); g.stroke(); g.globalAlpha = 1;
        g.fillStyle = NB.ink; for (const t of [0.16, 0.32, 0.46]) for (const y of [b.minY + 4, b.maxY - 4]) { g.beginPath(); g.arc(b.minX + b.w * t, y, 1.4, 0, 6.3); g.fill(); }
        break;
      }
      case 'sun': {
        if (!c) break;
        if (polys.length < 3) {                                                          // rays, unless the forge made them fixtures already
          g.strokeStyle = '#F2A33A'; g.lineWidth = 3; g.globalAlpha = 0.9;
          for (let k = 0; k < 12; k++) { const a = k * 0.5236 + rnd() * 0.12, r0 = c.r * 1.12, r1 = c.r * (1.32 + rnd() * 0.18); g.beginPath(); g.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0); g.lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1); g.stroke(); }
          g.globalAlpha = 1;
        }
        face(g, c.x, c.y, c.r, { mood: 'smile' });
        g.fillStyle = NB.pink; g.globalAlpha = 0.45; for (const s of [-1, 1]) { g.beginPath(); g.arc(c.x + s * c.r * 0.5, c.y + c.r * 0.12, c.r * 0.12, 0, 6.3); g.fill(); }
        break;
      }
      case 'moon': {
        if (!c) break;
        g.save(); g.beginPath(); g.arc(c.x, c.y, c.r - 1, 0, 6.3); g.clip(); g.fillStyle = '#E0A800'; g.globalAlpha = 0.28; g.beginPath(); g.arc(c.x - c.r * 0.45, c.y + c.r * 0.2, c.r * 0.95, 0, 6.3); g.fill(); g.restore();   // the dark side
        g.strokeStyle = '#C8961E'; g.lineWidth = 1.6; g.globalAlpha = 0.7;
        for (const [dx, dy, rr] of [[-0.45, -0.35, 0.14], [-0.2, 0.45, 0.1], [-0.6, 0.25, 0.08]]) { g.beginPath(); g.ellipse(c.x + dx * c.r, c.y + dy * c.r, rr * c.r, rr * c.r * 0.75, 0.3, 0, 6.3); g.stroke(); }   // craters
        g.globalAlpha = 1; face(g, c.x + c.r * 0.25, c.y, c.r * 0.8, { mood: 'sleepy' });
        g.fillStyle = NB.pencil; g.font = `${Math.max(12, c.r * 0.3) | 0}px ${NOTE}`; g.globalAlpha = 0.7; g.fillText('z', c.x + c.r * 0.8, c.y - c.r * 0.75); g.fillText('z', c.x + c.r * 1.0, c.y - c.r * 0.95);
        break;
      }
      case 'cloud': {                                                                   // puffs along the top, so the slab reads as a cloud
        if (!big) break; const b = big.b, n = Math.max(2, Math.round(b.w / 30)), step = b.w / n;
        for (let k = 0; k < n; k++) {
          const x = b.minX + step * (k + 0.5) + (rnd() - 0.5) * 4, r = step * 0.55 + rnd() * 3;
          g.fillStyle = mat.fill; g.globalAlpha = 1; g.beginPath(); g.arc(x, b.minY + 1, r, Math.PI, 0); g.lineTo(x + r, b.minY + 2); g.lineTo(x - r, b.minY + 2); g.closePath(); g.fill();
          g.strokeStyle = mat.outline; g.lineWidth = 2.2; g.globalAlpha = 0.95; g.beginPath(); g.arc(x, b.minY + 1, r, Math.PI + 0.1, -0.1); g.stroke();
        }
        g.strokeStyle = '#fff'; g.lineWidth = 3; g.globalAlpha = 0.35; g.beginPath(); g.moveTo(b.minX + 10, b.minY + b.h * 0.35); g.lineTo(b.maxX - 14, b.minY + b.h * 0.3); g.stroke();
        break;
      }
      case 'boat': {
        if (!big) break; const b = big.b;
        for (const t of [0.35, 0.68]) { const y = b.minY + b.h * t; line(g, wobble([[b.minX + 4, y], [b.maxX - 4, y]], rnd, 0.8), NB.ink, 1.4, 0.45); }   // planks
        const n = Math.max(1, Math.round(b.w / 60));
        for (let k = 0; k < n; k++) { const x = b.minX + (b.w / (n + 1)) * (k + 1), y = b.minY + b.h * 0.5, r = Math.min(7, b.h * 0.2); g.fillStyle = '#9CC4F5'; g.strokeStyle = NB.ink; g.lineWidth = 1.8; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); g.stroke(); }   // portholes
        if (name === 'ship_b') {                                                         // the pirate's skull, scribbled on the hull
          const x = (b.minX + b.maxX) / 2, y = b.minY + b.h * 0.42, r = Math.min(12, b.h * 0.22);
          g.fillStyle = '#FFFDF4'; g.strokeStyle = NB.ink; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); g.stroke();
          g.fillStyle = NB.ink; g.beginPath(); g.arc(x - r * 0.35, y - r * 0.1, r * 0.2, 0, 6.3); g.arc(x + r * 0.35, y - r * 0.1, r * 0.2, 0, 6.3); g.fill();
          g.lineWidth = 2.4; g.beginPath(); g.moveTo(x - r * 1.3, y + r * 0.9); g.lineTo(x + r * 1.3, y + r * 1.9); g.moveTo(x + r * 1.3, y + r * 0.9); g.lineTo(x - r * 1.3, y + r * 1.9); g.stroke();
        }
        break;
      }
      case 'wheel': {                                                                   // tread marks round the tyre
        if (!c) break; g.strokeStyle = '#D9DCE3'; g.lineWidth = 2; g.globalAlpha = 0.65;
        for (let k = 0; k < 14; k++) { const a = k * 0.4488 + 0.2; g.beginPath(); g.moveTo(c.x + Math.cos(a) * c.r * 0.8, c.y + Math.sin(a) * c.r * 0.8); g.lineTo(c.x + Math.cos(a) * c.r * 0.93, c.y + Math.sin(a) * c.r * 0.93); g.stroke(); }
        break;
      }
      case 'eye': {
        if (!c) break;
        g.fillStyle = '#FFFDF4'; g.beginPath(); g.arc(c.x, c.y, c.r * 0.9, 0, 6.3); g.fill();
        g.fillStyle = '#4A7CF0'; g.beginPath(); g.arc(c.x + c.r * 0.08, c.y + c.r * 0.05, c.r * 0.5, 0, 6.3); g.fill();
        g.fillStyle = NB.ink; g.beginPath(); g.arc(c.x + c.r * 0.12, c.y + c.r * 0.08, c.r * 0.26, 0, 6.3); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(c.x - c.r * 0.15, c.y - c.r * 0.22, c.r * 0.12, 0, 6.3); g.fill();
        break;
      }
      case 'nose': {
        if (!big) break; const b = big.b; g.strokeStyle = NB.ink; g.lineWidth = 1.8;
        for (const s of [-1, 1]) { g.beginPath(); g.arc((b.minX + b.maxX) / 2 + s * b.w * 0.22, b.maxY - b.h * 0.18, b.w * 0.09, 0.3, 2.84); g.stroke(); }
        break;
      }
      case 'mr_t': {                                                                    // the mohawk and the gold chain
        if (!c) break; face(g, c.x, c.y, c.r, { mood: 'grin' });
        g.fillStyle = NB.ink; g.strokeStyle = NB.ink; g.lineWidth = 1.5;
        for (let k = -2; k <= 2; k++) { const x = c.x + k * c.r * 0.26; g.beginPath(); g.moveTo(x - c.r * 0.14, c.y - c.r * 0.9); g.lineTo(x, c.y - c.r * 1.55 - (2 - Math.abs(k)) * 3); g.lineTo(x + c.r * 0.14, c.y - c.r * 0.9); g.closePath(); g.fill(); }
        g.strokeStyle = '#E0A800'; g.lineWidth = 2.5; g.beginPath(); g.arc(c.x, c.y + c.r * 0.95, c.r * 0.55, 0.3, 2.84); g.stroke();
        break;
      }
      case 'crown': {                                                                   // a leafy tree top with a couple of apples still on it
        if (!c) break; g.strokeStyle = mat.shade; g.lineWidth = 2; g.globalAlpha = 0.85;
        for (let k = 0; k < 14; k++) { const a = k * 0.4488, x = c.x + Math.cos(a) * c.r * 0.86, y = c.y + Math.sin(a) * c.r * 0.86; g.beginPath(); g.arc(x, y, c.r * 0.16, a + 2.2, a + 7.2); g.stroke(); }
        g.globalAlpha = 1; for (const [dx, dy] of [[-0.35, -0.2], [0.3, 0.1], [0, 0.45]]) { g.fillStyle = NB.coral; g.strokeStyle = NB.ink; g.lineWidth = 1.4; g.beginPath(); g.arc(c.x + dx * c.r, c.y + dy * c.r, Math.max(3, c.r * 0.09), 0, 6.3); g.fill(); g.stroke(); }
        break;
      }
      case 'apple': {
        if (!c) break; g.strokeStyle = '#6E4A24'; g.lineWidth = 2; g.beginPath(); g.moveTo(c.x, c.y - c.r * 0.8); g.lineTo(c.x + c.r * 0.15, c.y - c.r * 1.4); g.stroke();
        g.fillStyle = NB.grass; g.beginPath(); g.ellipse(c.x + c.r * 0.5, c.y - c.r * 1.2, c.r * 0.4, c.r * 0.22, 0.5, 0, 6.3); g.fill();
        g.fillStyle = '#fff'; g.globalAlpha = 0.6; g.beginPath(); g.arc(c.x - c.r * 0.35, c.y - c.r * 0.3, c.r * 0.18, 0, 6.3); g.fill();
        break;
      }
      case 'dino_head': {                                                               // one big eye and a row of teeth along the jaw
        if (!big) break; const b = big.b, ex = b.minX + b.w * 0.5, ey = b.minY + b.h * 0.32, er = Math.min(b.h * 0.2, 11);
        g.fillStyle = '#FFFDF4'; g.strokeStyle = NB.ink; g.lineWidth = 1.8; g.beginPath(); g.arc(ex, ey, er, 0, 6.3); g.fill(); g.stroke(); g.fillStyle = NB.ink; g.beginPath(); g.arc(ex + er * 0.2, ey, er * 0.45, 0, 6.3); g.fill();
        g.fillStyle = '#FFFDF4'; g.strokeStyle = NB.ink; g.lineWidth = 1.5; g.beginPath(); const y0 = b.maxY - 2, th = Math.min(9, b.h * 0.22);
        for (let x = b.minX + 6; x < b.maxX - 6; x += th) { g.moveTo(x, y0); g.lineTo(x + th / 2, y0 - th); g.lineTo(x + th, y0); } g.fill(); g.stroke();
        for (const dx of [0.25, 0.75]) { g.fillStyle = mat.shade; g.beginPath(); g.arc(b.minX + b.w * dx, b.minY + b.h * 0.62, 2.2, 0, 6.3); g.fill(); }   // nostrils
        break;
      }
      case 'unicorn_head': {
        if (!c) break; face(g, c.x, c.y, c.r, { mood: 'smile', lashes: true });
        g.fillStyle = NB.pink; g.globalAlpha = 0.45; g.beginPath(); g.arc(c.x + c.r * 0.55, c.y + c.r * 0.2, c.r * 0.14, 0, 6.3); g.fill(); g.globalAlpha = 1;
        g.fillStyle = mat.fill; g.strokeStyle = NB.ink; g.lineWidth = 1.8; g.beginPath(); g.moveTo(c.x - c.r * 0.75, c.y - c.r * 0.6); g.lineTo(c.x - c.r * 0.6, c.y - c.r * 1.25); g.lineTo(c.x - c.r * 0.25, c.y - c.r * 0.92); g.closePath(); g.fill(); g.stroke();   // an ear
        break;
      }
      case 'face': {
        if (!c) break; face(g, c.x, c.y, c.r, { mood: mat.colour === 'ink' ? 'o' : 'smile' });
        if (mat.colour === 'ink') {                                                      // Mr. Newton's wig
          g.strokeStyle = NB.ink; g.lineWidth = 1.8; g.globalAlpha = 0.8;
          for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {                        // pencil curls down each side, a spiral each
            const a = -1.1 + s * (0.55 + k * 0.5), x = c.x + Math.cos(a) * c.r * 1.05, y = c.y + Math.sin(a) * c.r * 1.05, R = c.r * 0.2;
            g.beginPath(); for (let t = 0; t < 7; t += 0.25) g.lineTo(x + Math.cos(t * 1.9 + a) * R * (t / 7), y + Math.sin(t * 1.9 + a) * R * (t / 7)); g.stroke();
          }
        }
        break;
      }
      case 'scales': {                                                                  // bumps along the top of the neck
        g.strokeStyle = mat.shade; g.lineWidth = 2; g.globalAlpha = 0.9;
        for (const p of polys) for (const [a, b2] of upEdges(p.pts)) { const d = Math.hypot(b2[0] - a[0], b2[1] - a[1]), ux = (b2[0] - a[0]) / d, uy = (b2[1] - a[1]) / d; for (let t = 8; t < d - 6; t += 11) { const x = a[0] + ux * t, y = a[1] + uy * t; g.beginPath(); g.moveTo(x - 4, y + 1); g.lineTo(x, y - 6); g.lineTo(x + 4, y + 1); g.stroke(); } }
        break;
      }
      case 'mane': {                                                                    // pink hair down one side
        if (!big) break; const b = big.b;
        for (let k = 0; k < 4; k++) { const y = b.minY + 6 + k * (b.h - 12) / 3; line(g, wobble([[b.minX + 2, y], [b.minX - 7, y + 8], [b.minX + 1, y + 14]], rnd, 0.8), NB.pink, 2.2, 0.9); }
        break;
      }
      default: break;
    }
    g.restore();
  }
  // bake a level body's fixtures (local px) once; drawn each frame with the body's transform
  function bakeBody(rec) {
    let b = bakes.get(rec); if (b) return b;
    const shapes = shapesOf(rec.body); if (!shapes.length) { b = { canvas: null }; bakes.set(rec, b); return b; }
    const all = []; for (const s of shapes) { if (s.kind === 'poly') all.push(...s.pts); else all.push([s.x - s.r, s.y - s.r], [s.x + s.r, s.y + s.r]); }
    const mat = materialFor(rec), deco = decorOf(rec.spec.name, mat.colour, rec.isRocket);
    const bb = bbox(all), M = deco ? 32 : 16;                                            // an illustration may poke out of its body a little
    const c = document.createElement('canvas'); c.width = Math.ceil(bb.w) + 2 * M; c.height = Math.ceil(bb.h) + 2 * M;
    const g = c.getContext('2d'); g.translate(M - bb.minX, M - bb.minY);
    const rnd = rng(hash(rec.spec.name || 'body') + shapes.length);
    for (const s of shapes) drawShape(g, s, mat, rnd);
    if (deco) decorate(g, deco, rec.spec.name || '', shapes, rnd, mat);
    b = { canvas: c, ox: bb.minX - M, oy: bb.minY - M }; bakes.set(rec, b); return b;
  }
  // a player's stroke: cobalt marker, a pale highlight down the middle, ink pooling at sharp turns
  function markerStroke(g, pts, rnd, { width = 10, color = NB.cobalt, alpha = 0.92 } = {}) {
    if (pts.length < 2) { g.save(); g.fillStyle = color; g.globalAlpha = alpha; g.beginPath(); g.arc(pts[0][0], pts[0][1], width / 2, 0, 6.3); g.fill(); g.restore(); return; }
    const w = wobble(pts, rnd, 0.9, false, 5);
    line(g, w, color, width, alpha); line(g, w, '#fff', width * 0.28, 0.18);
    g.save(); g.fillStyle = color; g.globalAlpha = 0.5;
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
      const a1 = Math.atan2(by - ay, bx - ax), a2 = Math.atan2(cy - by, cx - bx); let d = Math.abs(a2 - a1); if (d > Math.PI) d = 6.2832 - d;
      if (d > 0.8) { g.beginPath(); g.arc(bx, by, width * 0.62, 0, 6.3); g.fill(); }
    }
    g.restore();
  }
  function bakeDrawn(rec) {
    let b = bakes.get(rec); if (b) return b;
    const pts = rec.local.map(([x, y]) => [x * PX_PER_UNIT, y * PX_PER_UNIT]); const bb = bbox(pts), M = 14;
    const c = document.createElement('canvas'); c.width = Math.ceil(bb.w) + 2 * M; c.height = Math.ceil(bb.h) + 2 * M;
    const g = c.getContext('2d'); g.translate(M - bb.minX, M - bb.minY);
    const rnd = rng(hash(`drawn${rec.id || pts.length}`) + Math.round(bb.w));
    const closed = rec.shape === 'closed' || rec.shape === 'ring';
    if (rec.shape === 'closed' && pts.length > 3) hatch(g, pts, NB.cobalt, rnd, 9, -0.8, 0.14, 1.6);   // a scribbled fill inside solid shapes
    markerStroke(g, closed ? [...pts, pts[0]] : pts, rnd);
    b = { canvas: c, ox: bb.minX - M, oy: bb.minY - M }; bakes.set(rec, b); return b;
  }

  // ---- the scene's own doodles: the level's hint art, coloured pencil now ----------------------------
  function bakeStrokes(strokes) {
    if (strokesBake && strokesBake.src === strokes) return strokesBake;
    const c = document.createElement('canvas'); c.width = SCREEN_W; c.height = SCREEN_H; const g = c.getContext('2d'); const rnd = rng(hash('decor') + strokes.length);
    for (const s of strokes) {
      const n = forgeName(s.color), hint = n === 'hint';
      const color = hint ? NB.coral : n === 'yellow' ? '#F2C14E' : n === 'orange' ? '#F7A64A' : n === 'sky' || n === 'blue' ? '#8DB8EE' : n === 'grass' || n === 'green' ? '#7FBF6A' : n === 'ink' ? NB.pencil : (MATERIAL[n]?.fill || NB.pencil);
      line(g, wobble(s.points, rnd, 1.1, false, 6), color, hint ? 5 : 3.5, hint ? 0.95 : 0.6);
    }
    strokesBake = { src: strokes, canvas: c }; return strokesBake;
  }
  // free corners of this page get a margin doodle and one pencilled note (seeded by the level)
  function placeDoodles(game, level, name) {
    const rnd = rng(hash(name)); const busy = [];
    for (const rec of game.records) if (rec.kind === 'level') { const b = bakeBody(rec); if (!b.canvas) continue; const p = rec.body.getPosition(); const [sx, sy] = toScreen(p.x, p.y); busy.push({ x: sx + b.ox - 24, y: sy + b.oy - 24, w: b.canvas.width + 48, h: b.canvas.height + 48 }); }
    for (const s of level.background.drawing.strokes) { const bb = bbox(s.points); busy.push({ x: bb.minX - 20, y: bb.minY - 20, w: bb.w + 40, h: bb.h + 40 }); }
    for (const p of [level.ball, level.star]) if (p) { const [sx, sy] = toScreen(p.x, p.y); busy.push({ x: sx - 90, y: sy - 90, w: 180, h: 180 }); }
    busy.push({ x: 0, y: 0, w: 420, h: 80 });                                            // the sticky note
    const free = (x, y, w, h) => !busy.some((b) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y);
    const spots = []; for (let y = 40; y < 560; y += 70) for (let x = 100; x < 900; x += 120) if (free(x, y, 130, 64)) spots.push([x, y]);
    const picks = []; const kinds = ['bird', 'flower', 'nope', 'face'];
    while (picks.length < 2 && spots.length) { const i = (rnd() * spots.length) | 0; const [x, y] = spots.splice(i, 1)[0]; const kind = kinds.splice((rnd() * kinds.length) | 0, 1)[0]; picks.push({ kind, x, y, r: rnd() }); busy.push({ x: x - 40, y: y - 40, w: 210, h: 140 }); }
    let note = null; if (spots.length) { const [x, y] = spots[(rnd() * spots.length) | 0]; note = { x, y, text: NOTES[(rnd() * NOTES.length) | 0], rot: (rnd() - 0.5) * 0.12 }; }
    return { picks, note };
  }
  function drawDoodle(g, d) {
    const rnd = rng(hash(d.kind) + Math.round(d.x)); g.save(); g.globalAlpha = 0.55; g.strokeStyle = NB.pencil; g.lineWidth = 1.8; g.lineCap = 'round';
    const x = d.x + 40, y = d.y + 30;
    if (d.kind === 'bird') {
      line(g, wobble([[x - 14, y], [x - 6, y - 8], [x, y - 2], [x + 6, y - 8], [x + 14, y]], rnd, 0.6), NB.pencil, 1.8, 0.6);
      g.setLineDash([3, 6]); g.beginPath(); g.moveTo(x + 18, y - 4); g.quadraticCurveTo(x + 50, y - 30, x + 95, y - 14); g.stroke();
    } else if (d.kind === 'flower') {
      for (let k = 0; k < 6; k++) { const a = k * 1.047; g.beginPath(); g.ellipse(x + Math.cos(a) * 7, y + Math.sin(a) * 7, 6, 3.5, a, 0, 6.3); g.stroke(); }
      g.fillStyle = NB.yellow; g.globalAlpha = 0.7; g.beginPath(); g.arc(x, y, 3.5, 0, 6.3); g.fill(); g.globalAlpha = 0.55;
      line(g, wobble([[x, y + 8], [x - 2, y + 30]], rnd, 0.8), '#7FBF6A', 2, 0.6);
    } else if (d.kind === 'nope') {
      inkOutline(g, [[x - 18, y - 12], [x + 22, y - 14], [x + 20, y + 12], [x - 16, y + 10]], rnd, NB.pencil, 1.6);
      g.beginPath(); g.moveTo(x - 10, y - 4); g.lineTo(x + 12, y + 2); g.moveTo(x + 2, y - 12); g.lineTo(x + 4, y + 12); g.stroke();
      line(g, wobble([[x - 26, y - 20], [x + 32, y + 18]], rnd, 0.5), NB.coral, 2.2, 0.7); line(g, wobble([[x + 30, y - 20], [x - 24, y + 18]], rnd, 0.5), NB.coral, 2.2, 0.7);
      g.font = `15px ${NOTE}`; g.fillStyle = NB.pencil; g.fillText('nope', x + 28, y + 30);
    } else {
      g.beginPath(); g.arc(x, y, 13, 0, 6.3); g.stroke(); g.fillStyle = NB.pencil; g.beginPath(); g.arc(x - 5, y - 4, 1.6, 0, 6.3); g.arc(x + 5, y - 4, 1.6, 0, 6.3); g.fill();
      g.beginPath(); g.arc(x, y + 1, 7, 0.3, 2.8); g.stroke();
    }
    g.restore();
  }

  // ---- the creature (the ball) ----------------------------------------------------------------------
  let dizzyUntil = 0, lastBlink = 0, creatureBake = null, bellBake = null, scrapBake = null;
  const stickyBakes = new Map();
  function creature(game, level, ui) {
    const b = game.ball; if (!b) return;
    const p = b.getPosition(), v = b.getLinearVelocity(), [x, y] = toScreen(p.x, p.y), R = BALL_RADIUS * PX_PER_UNIT, t = ui.now, speed = Math.hypot(v.x, v.y);
    for (const i of ui.impacts || []) if (i.m > 3.5 && Math.hypot(i.x - p.x, i.y - p.y) < 1.4) dizzyUntil = t + 700;
    const near = level.star ? Math.hypot(level.star.x - p.x, level.star.y - p.y) : 99, closing = level.star && (v.x * (level.star.x - p.x) + v.y * (level.star.y - p.y)) > 0;
    const hotRocket = game.records.some((r) => r.isRocket && r.lit != null && game.time - r.lit < 5 && Math.hypot(r.body.getPosition().x - p.x, r.body.getPosition().y - p.y) < 3.2);
    const mood = ui.won ? 'happy' : t < dizzyUntil ? 'dizzy' : v.y > 7 ? 'surprised' : hotRocket ? 'worried' : speed > 4 && closing && near < 9 ? 'excited' : 'idle';
    const rnd = rng(hash('ball') + 3);
    ctx.save();
    if (speed > 5) {                                                                     // wiggly motion lines behind it
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(v.y, v.x) + Math.PI); ctx.strokeStyle = NB.ink; ctx.globalAlpha = 0.35; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let k = -1; k <= 1; k++) { const L = 18 + Math.min(30, speed * 2.2) + ((t / 60 + k) % 3) * 4; ctx.beginPath(); ctx.moveTo(R + 6, k * 9); ctx.quadraticCurveTo(R + 6 + L * 0.5, k * 9 + (k ? 3 : -3), R + 6 + L, k * 9); ctx.stroke(); }
      ctx.restore();
    }
    // body: blue marker, pencil shading that rolls with it, ballpoint outline — baked once, rotated per frame
    if (!creatureBake) {
      const S = Math.ceil(R * 2 + 16), c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); g.translate(S / 2, S / 2);
      const circ = []; for (let i = 0; i < 26; i++) { const a = (i / 26) * 6.2832; circ.push([Math.cos(a) * R, Math.sin(a) * R]); }
      markerFill(g, circ, '#4A7CF0', rnd, 0.92);
      g.save(); g.beginPath(); g.arc(0, 0, R - 1, 0, 6.3); g.clip(); hatch(g, circ.map(([a, c2]) => [a + R * 0.5, c2 + R * 0.55]), '#2C5BD1', rnd, 5, 0.9, 0.45, 1.5); g.restore();
      inkOutline(g, circ, rnd, NB.ink, 2.6);
      creatureBake = c;
    }
    ctx.save(); ctx.translate(x, y); ctx.rotate(b.getAngle()); ctx.drawImage(creatureBake, -creatureBake.width / 2, -creatureBake.height / 2); ctx.restore();
    // face stays upright (googly eyes have their own ideas about rotation)
    ctx.translate(x, y);
    const look = clamp(v.x * 0.3, -2.6, 2.6), lookY = clamp(v.y * 0.3, -2.6, 2.6);
    const blink = t - lastBlink > 3200 + (hash(String(Math.floor(t / 3200))) % 1800) ? ((lastBlink = t), true) : t - lastBlink < 110;
    for (const [ex, ey, er] of [[-8.5, -6, 7], [8, -7, 6]]) {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = NB.ink; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(ex, ey, er, 0, 6.3); ctx.fill(); ctx.stroke();
      if (mood === 'dizzy') { ctx.beginPath(); for (let a = 0; a < 9; a += 0.3) ctx.lineTo(ex + Math.cos(a + t / 90) * a * 0.42, ey + Math.sin(a + t / 90) * a * 0.42); ctx.stroke(); }
      else if (blink && mood !== 'surprised') { ctx.beginPath(); ctx.moveTo(ex - er + 1, ey); ctx.lineTo(ex + er - 1, ey); ctx.stroke(); }
      else { const pr = mood === 'surprised' ? er * 0.32 : mood === 'excited' ? er * 0.58 : er * 0.48; ctx.fillStyle = NB.ink; ctx.beginPath(); ctx.arc(ex + look, ey + lookY, pr, 0, 6.3); ctx.fill(); }
    }
    if (mood === 'excited' || mood === 'happy') { ctx.strokeStyle = NB.ink; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-14, -15); ctx.lineTo(-6, -17); ctx.moveTo(6, -17); ctx.lineTo(14, -14); ctx.stroke(); }
    if (mood === 'worried') { ctx.strokeStyle = NB.ink; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-14, -17); ctx.lineTo(-5, -14); ctx.moveTo(5, -14); ctx.lineTo(14, -17); ctx.stroke(); ctx.fillStyle = '#8DB8EE'; ctx.beginPath(); ctx.ellipse(17, -10 + ((t / 8) % 14), 2.6, 4, 0, 0, 6.3); ctx.fill(); }
    ctx.strokeStyle = NB.ink; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath();
    if (mood === 'happy') { ctx.arc(0, 4, 9, 0.2, 2.94); ctx.stroke(); ctx.fillStyle = NB.pink; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.arc(-14, 3, 3.5, 0, 6.3); ctx.arc(14, 3, 3.5, 0, 6.3); ctx.fill(); ctx.globalAlpha = 1; }
    else if (mood === 'surprised') { ctx.ellipse(0, 7, 4, 5.5, 0, 0, 6.3); ctx.stroke(); }
    else if (mood === 'excited') { ctx.arc(0, 4, 8, 0.1, 3.04); ctx.stroke(); ctx.fillStyle = NB.ink; ctx.fill(); }
    else if (mood === 'dizzy' || mood === 'worried') { ctx.moveTo(-8, 8); ctx.quadraticCurveTo(-4, 4, 0, 8); ctx.quadraticCurveTo(4, 12, 8, 8); ctx.stroke(); }
    else { ctx.arc(0, 3, 7, 0.4, 2.74); ctx.stroke(); }
    if (speed < 0.6 && !ui.won) {                                                        // standing still: out come the little legs
      ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-8, R - 3); ctx.lineTo(-10, R + 7); ctx.lineTo(-16, R + 8); ctx.moveTo(8, R - 3); ctx.lineTo(10, R + 7); ctx.lineTo(16, R + 8); ctx.stroke();
    }
    ctx.restore();
  }

  // ---- the bell (the goal) ----------------------------------------------------------------------------
  function bell(level, ui) {
    if (!level.star) return;
    const [x, y] = toScreen(level.star.x, level.star.y), t = ui.now, rnd = rng(hash('bell'));
    const swing = ui.won ? Math.sin((t - ui.wonAt) / 110) * 0.3 * Math.exp(-(t - ui.wonAt) / 1800) : Math.sin(t / 900) * 0.04;
    if (!bellBake) {                                                                      // the bell itself, drawn once
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.translate(32, 30);
      const body = [[-3, -16], [3, -16], [5, -12], [8, -4], [12, 4], [16, 10], [19, 15], [-19, 15], [-16, 10], [-12, 4], [-8, -4], [-5, -12]];
      markerFill(g, body, NB.yellow, rnd, 0.95); hatch(g, body.map(([a, b]) => [a + 6, b]), '#E59A1F', rnd, 5, 1.1, 0.4, 1.6); inkOutline(g, body, rnd, NB.ink, 2.4);
      g.fillStyle = NB.ink; g.beginPath(); g.arc(0, 19, 4.5, 0, 6.3); g.fill();                                            // clapper
      g.strokeStyle = NB.ink; g.lineWidth = 2; g.beginPath(); g.arc(0, -19, 4, 0, 6.3); g.stroke();                      // the loop on top
      bellBake = c;
    }
    ctx.save(); ctx.translate(x, y - 22); ctx.rotate(swing); ctx.drawImage(bellBake, -32, -30); ctx.restore();
    ctx.save(); ctx.translate(x, y - 22); ctx.strokeStyle = ui.won ? NB.pink : '#E59A1F'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.globalAlpha = 0.85;
    for (let k = 0; k < 3; k++) { const a = -1.9 + k * 0.5 + Math.sin(t / 700 + k) * 0.08, r0 = 24 + Math.sin(t / 300 + k * 2) * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * (r0 + 9), Math.sin(a) * (r0 + 9)); ctx.stroke(); }
    if (ui.won) { ctx.globalAlpha = 0.6; for (const s of [1, -1]) { ctx.beginPath(); ctx.arc(0, 2, 30, s > 0 ? -0.6 : 2.5, s > 0 ? 0.6 : 3.8); ctx.stroke(); } }
    ctx.restore();
  }
  function screw(x, y, wall) {
    const r = wall ? 10 : 8; ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#C8CBD0'; ctx.strokeStyle = NB.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-r * 0.6, 0); ctx.lineTo(r * 0.6, 0); ctx.moveTo(0, -r * 0.6); ctx.lineTo(0, r * 0.6); ctx.stroke();
    if (wall) { ctx.fillStyle = NB.ink; for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.arc(dx * r * 1.25, dy * r * 1.25, 1.6, 0, 6.3); ctx.fill(); } }
    ctx.restore();
  }

  // ---- effects: scribble clouds, star bursts, flames, confetti ----------------------------------------
  const clouds = [], recentHits = new Map();   // cell → time: a resting contact pushes every step; only a fresh knock gets a cloud
  function effects(game, ui) {
    const t = ui.now;
    for (const i of ui.impacts || []) {
      if (i.m < 2.5) continue;
      const cell = `${Math.round(i.x * 2)},${Math.round(i.y * 2)}`, last = recentHits.get(cell) || -1e9;
      recentHits.set(cell, t);
      if (t - last < 700 || clouds.length > 8) continue;
      clouds.push({ x: i.x, y: i.y, m: i.m, t, seed: (t | 0) + clouds.length });
    }
    if (recentHits.size > 400) recentHits.clear();
    for (let k = clouds.length - 1; k >= 0; k--) {
      const c = clouds[k], age = (t - c.t) / 380; if (age > 1) { clouds.splice(k, 1); continue; }
      const [x, y] = toScreen(c.x, c.y), rnd = rng(c.seed), n = 3 + Math.min(4, c.m | 0), R = 8 + Math.min(26, c.m * 3) * (0.5 + age);
      ctx.save(); ctx.globalAlpha = 0.6 * (1 - age); ctx.strokeStyle = NB.ink; ctx.lineWidth = 1.8;
      for (let j = 0; j < n; j++) { const a = rnd() * 6.28, d = R * (0.4 + rnd() * 0.6); ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, 5 + rnd() * 5, 3 + rnd() * 3, rnd() * 3, 0, 6.3); ctx.stroke(); }
      ctx.restore();
    }
    for (let i = game.effects.length - 1; i >= 0; i--) {                                 // explosions: a doodled burst
      const e = game.effects[i], age = game.time - e.t; if (age > 0.6) { game.effects.splice(i, 1); continue; }
      const [x, y] = toScreen(e.x, e.y), f = age / 0.6, R = 20 + f * 150, rnd = rng(hash('boom') + i);
      ctx.save(); ctx.globalAlpha = 1 - f; ctx.lineCap = 'round';
      for (let k = 0; k < 9; k++) { const a = rnd() * 6.28, L = R * (0.6 + rnd() * 0.5); ctx.strokeStyle = k % 3 ? NB.coral : NB.yellow; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * R * 0.3, y + Math.sin(a) * R * 0.3); ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); ctx.stroke(); }
      for (let k = 0; k < 3; k++) { const a = rnd() * 6.28, d = R * 0.8; ctx.fillStyle = NB.yellow; ctx.strokeStyle = NB.ink; ctx.lineWidth = 1.5; star5(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, 7 + rnd() * 5, rnd()); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
    for (const rec of game.records) {                                                    // lit rockets: scribbled flame
      if (!rec.isRocket || rec.lit == null || game.time - rec.lit >= 5) continue;
      const p = rec.body.getPosition(), [sx, sy] = toScreen(p.x, p.y), rnd = rng((t / 40) | 0);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(rec.body.getAngle()); ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const L = 26 + rnd() * 30, pts = [[-1.9 * PX_PER_UNIT, 0]]; for (let s = 1; s <= 5; s++) pts.push([-1.9 * PX_PER_UNIT - (L * s) / 5, (rnd() - 0.5) * 16 * (s / 5)]);
        line(ctx, pts, k === 2 ? NB.yellow : NB.coral, 4 - k, 0.9);
      }
      ctx.restore();
    }
  }
  function confetti(ui) {
    const age = (ui.now - ui.wonAt) / 1000; if (age > 3) return; const rnd = rng(hash('confetti'));
    const colors = [NB.cobalt, NB.pink, NB.yellow, NB.grass, NB.coral];
    ctx.save();
    for (let i = 0; i < 46; i++) {
      const x0 = rnd() * SCREEN_W, vx = (rnd() - 0.5) * 60, delay = rnd() * 0.6, sz = 5 + rnd() * 6, spin = rnd() * 6, color = colors[i % colors.length];
      const a = age - delay; if (a < 0) continue;
      const x = x0 + vx * a + Math.sin(a * 5 + i) * 12, y = -10 + a * a * 110 + a * 60;
      if (y > SCREEN_H) continue;
      ctx.save(); ctx.translate(x, y); ctx.rotate(spin + a * 4); ctx.globalAlpha = clamp(1.4 - a * 0.4, 0, 1); ctx.fillStyle = color; ctx.fillRect(-sz / 2, -sz / 4, sz, sz / 2); ctx.restore();
    }
    ctx.restore();
  }

  // ---- HUD: a sticky note for the title, pencilled help, a taped scrap when you win -------------------
  // a sticky note with its shadow and tape, baked once per text (shadows are the slowest thing a canvas draws)
  function sticky(x, y, w, h, rot, text, font, color = NB.ink) {
    const key = `${text}|${font}|${w}|${h}`;
    let c = stickyBakes.get(key);
    if (!c) {
      const M = 24; c = document.createElement('canvas'); c.width = Math.ceil(w) + 2 * M; c.height = Math.ceil(h) + 2 * M;
      const g = c.getContext('2d'); g.translate(M + w / 2, M + h / 2); g.rotate(rot);
      g.shadowColor = 'rgba(60,50,30,.25)'; g.shadowBlur = 6; g.shadowOffsetY = 3;
      g.fillStyle = NB.yellow; g.fillRect(-w / 2, -h / 2, w, h); g.shadowColor = 'transparent';
      g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(-w / 2, h / 2 - 9, w, 9);
      g.fillStyle = 'rgba(255,255,255,.55)'; g.save(); g.rotate(-0.35); g.fillRect(-w / 2 - 6, -h / 2 - 14, 46, 14); g.restore();   // tape
      g.fillStyle = color; g.font = font; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(text, -w / 2 + 16, 2);
      if (stickyBakes.size > 8) stickyBakes.clear();
      stickyBakes.set(key, c);
    }
    ctx.drawImage(c, x - 24, y - 24);
  }
  function hud(_level, ui) {
    ctx.save();
    ctx.font = `27px ${FONT}`; const title = ui.name || ''; const tw = ctx.measureText(title).width;
    if (!ui.won) sticky(14, 12, tw + 34, 54, -0.03, title, `27px ${FONT}`);    // the win scrap takes the top of the page
    ctx.font = `17px ${NOTE}`; ctx.fillStyle = NB.pencil; ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.globalAlpha = 0.9;
    ctx.fillText(`page ${ui.index + 1} of ${ui.count}`, 18, 72);
    ctx.textAlign = 'right';
    const help = ui.rope ? (ui.touch ? 'rope: draw from one thing to another · the rope button again for the pen' : 'rope: draw from one thing to another · R for the pen')
      : ui.touch ? (ui.eraser ? 'eraser: rub out what you drew · the eraser button again for the pen' : 'draw · tap the ball to roll it · hold to erase (hold the ball: roll left)')
        : 'draw · right-click erases · click the ball to roll it · R rope · space resets · ←/→ pages';
    const helpText = `${ui.muted ? 'muted · ' : ''}${help}`, hw = ctx.measureText(helpText).width;   // on a strip of masking tape, so it reads over grass too
    ctx.save(); ctx.translate(SCREEN_W - 16 - hw / 2 - 8, SCREEN_H - 22); ctx.rotate(-0.004); ctx.fillStyle = 'rgba(255,253,244,.82)'; ctx.fillRect(-hw / 2 - 12, -14, hw + 24, 28); ctx.restore();
    ctx.fillStyle = NB.ink; ctx.globalAlpha = 0.75; ctx.fillText(helpText, SCREEN_W - 16, SCREEN_H - 30);
    if (doodles?.note) { const n = doodles.note; ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(n.rot); ctx.textAlign = 'left'; ctx.font = `19px ${NOTE}`; ctx.fillStyle = NB.pencil; ctx.globalAlpha = 0.7; ctx.fillText(n.text, 0, 0); ctx.restore(); }
    if (ui.message) { ctx.textAlign = 'center'; ctx.font = `22px ${NOTE}`; ctx.fillStyle = NB.ink; ctx.globalAlpha = 0.85; ctx.fillText(ui.message, SCREEN_W / 2, SCREEN_H - 72); }
    ctx.restore();
    if (!ui.touch) hudButtons(ui);
    if (ui.won) { winScrap(ui); confetti(ui); }
  }
  // restart and sound as little paper scraps with a doodle on each (mouse players; a phone has the toolbar)
  function hudButtons(ui) {
    for (const [k, b] of Object.entries(HUD_BUTTONS)) {
      const hot = ui.pointer && ui.pointer[0] >= b.x && ui.pointer[0] <= b.x + b.w && ui.pointer[1] >= b.y && ui.pointer[1] <= b.y + b.h;
      ctx.save(); ctx.translate(b.x + b.w / 2, b.y + b.h / 2 + (hot ? -2 : 0)); ctx.rotate(k === 'reset' ? -0.04 : 0.03);
      ctx.shadowColor = 'rgba(60,50,30,.22)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2; ctx.fillStyle = hot ? '#FFFDF4' : 'rgba(255,253,244,.9)'; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.shadowColor = 'transparent';
      ctx.strokeStyle = NB.ink; ctx.lineWidth = 1.8; ctx.globalAlpha = 0.9; ctx.strokeRect(-b.w / 2 + 0.5, -b.h / 2 + 0.5, b.w - 1, b.h - 1);
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.save(); ctx.rotate(-0.3); ctx.fillRect(-14, -b.h / 2 - 8, 28, 10); ctx.restore();   // tape
      ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 1;
      if (k === 'reset') { ctx.beginPath(); ctx.arc(0, 1, 11, -0.9, 4.2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(3, -14); ctx.lineTo(8, -8); ctx.lineTo(1, -6); ctx.stroke(); }
      else {
        ctx.fillStyle = '#FFFDF4'; ctx.beginPath(); ctx.moveTo(-13, -5); ctx.lineTo(-7, -5); ctx.lineTo(1, -12); ctx.lineTo(1, 12); ctx.lineTo(-7, 5); ctx.lineTo(-13, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
        if (ui.muted) { ctx.strokeStyle = NB.coral; ctx.beginPath(); ctx.moveTo(5, -5); ctx.lineTo(14, 5); ctx.moveTo(14, -5); ctx.lineTo(5, 5); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(6, -4); ctx.quadraticCurveTo(10, 0, 6, 4); ctx.stroke(); ctx.beginPath(); ctx.moveTo(10, -8); ctx.quadraticCurveTo(16, 0, 10, 8); ctx.stroke(); }
      }
      ctx.restore();
    }
  }
  function winScrap(ui) {
    const B = WIN_SCRAP, st = ui.stars || {}, t = Math.min(1, (ui.now - ui.wonAt) / 350), rnd = rng(hash('scrap'));
    if (!scrapBake) {                                                                      // the torn, lined, taped scrap: drawn once
      const M = 24, c = document.createElement('canvas'); c.width = B.w + 2 * M; c.height = B.h + 2 * M; const g = c.getContext('2d'); g.translate(M, M);
      g.shadowColor = 'rgba(60,50,30,.3)'; g.shadowBlur = 10; g.shadowOffsetY = 4;
      const edge = wobble([[0, 0], [B.w, 0], [B.w, B.h], [0, B.h]], rnd, 2.2, true, 9);
      g.fillStyle = '#FFFDF4'; trace(g, edge, true); g.fill(); g.shadowColor = 'transparent';
      g.strokeStyle = NB.grid; g.lineWidth = 1; for (let y = 28; y < B.h; y += 24) { g.beginPath(); g.moveTo(8, y); g.lineTo(B.w - 8, y); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,.6)'; for (const [x, r] of [[-8, -0.5], [B.w - 40, 0.5]]) { g.save(); g.translate(x + 24, 0); g.rotate(r); g.fillRect(-24, -8, 48, 16); g.restore(); }
      scrapBake = c;
    }
    ctx.save(); ctx.translate(0, -(1 - t) * (B.y + B.h)); ctx.translate(B.x + B.w / 2, B.y + B.h / 2); ctx.rotate(0.015); ctx.translate(-B.w / 2, -B.h / 2);
    ctx.drawImage(scrapBake, -24, -24);
    ctx.fillStyle = NB.cobalt; ctx.font = `bold 34px ${FONT}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillText(st.stars >= 3 ? 'All three stars!!' : st.newElegant ? 'Elegant!!' : 'Solved!!', 150, 52);
    const starAt = (x, y, on) => { ctx.fillStyle = on ? NB.yellow : 'rgba(0,0,0,0)'; ctx.strokeStyle = on ? '#C8961E' : NB.pencil; ctx.lineWidth = 2; star5(ctx, x, y, 15, 0.1); if (on) ctx.fill(); ctx.stroke(); };
    starAt(50, 50, true); starAt(90, 58, !!st.elegant); starAt(130, 50, !!st.awesome);
    ctx.font = `20px ${FONT}`; ctx.fillStyle = NB.ink;
    ctx.fillText('solved', 150, 84); ctx.fillStyle = st.elegant ? NB.ink : NB.pencil; ctx.fillText(st.elegant ? 'elegant (no pushing, nothing under you)' : 'elegant — not this time', 230, 84);
    const box = B.awesome; ctx.strokeStyle = NB.ink; ctx.lineWidth = 2; ctx.strokeRect(box.x - B.x + 3, box.y - B.y + 3, 22, 22);
    if (st.awesome) { ctx.strokeStyle = NB.cobalt; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(box.x - B.x + 7, box.y - B.y + 14); ctx.lineTo(box.x - B.x + 13, box.y - B.y + 21); ctx.lineTo(box.x - B.x + 23, box.y - B.y + 5); ctx.stroke(); }
    ctx.fillStyle = NB.ink; ctx.fillText(st.awesome ? 'that was awesome' : 'that was awesome  (A)', box.x - B.x + 36, box.y - B.y + 21);
    ctx.restore();
  }

  // ---- a frame --------------------------------------------------------------------------------------------
  function render(game, level, ui) {
    const key = ui.name + '|' + level.file;
    if (!paper) paper = makePaper();
    if (levelKey !== key) { levelKey = key; doodles = placeDoodles(game, level, ui.name || 'page'); strokesBake = null; clouds.length = 0; dizzyUntil = 0; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(paper, 0, 0);
    const intro = ui.intro ?? 1;
    for (const d of doodles.picks) drawDoodle(ctx, d);
    const bg = level.background.drawing.strokes;
    if (bg.length) { const b = bakeStrokes(bg); ctx.save(); ctx.globalAlpha = clamp(intro * 1.6, 0, 1); ctx.drawImage(b.canvas, 0, 0); ctx.restore(); }
    // bodies draw themselves in during the intro, left to right, a little staggered
    const levelRecs = game.records.filter((r) => r.kind === 'level' && !r.isBall);
    levelRecs.forEach((rec, i) => {
      const b = bakeBody(rec); if (!b.canvas) return;
      const f = clamp(intro * 1.5 - (i / Math.max(1, levelRecs.length)) * 0.5, 0, 1); if (f <= 0) return;
      const p = rec.body.getPosition(), [sx, sy] = toScreen(p.x, p.y);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(rec.body.getAngle());
      const w = Math.max(1, Math.round(b.canvas.width * f)); ctx.drawImage(b.canvas, 0, 0, w, b.canvas.height, b.ox, b.oy, w, b.canvas.height);
      ctx.restore();
    });
    for (const rec of game.records) {
      if (rec.kind === 'rope') {
        ctx.save(); ctx.lineCap = 'round';
        rec.segs.forEach((seg) => {
          const q = seg.getPosition(), [x, y] = toScreen(q.x, q.y), f = seg.getFixtureList(), half = (f ? f.getShape().m_vertices[1].x : 0.5) * PX_PER_UNIT;
          ctx.save(); ctx.translate(x, y); ctx.rotate(seg.getAngle());
          ctx.strokeStyle = NB.brown; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-half, 0); ctx.lineTo(half, 0); ctx.stroke();
          ctx.strokeStyle = '#6E4A24'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let s = -half + 3; s < half; s += 6) { ctx.moveTo(s, -2.5); ctx.lineTo(s + 3, 2.5); } ctx.stroke();
          ctx.restore();
        });
        ctx.restore();
      } else if (rec.kind === 'drawn' || (rec.kind !== 'level' && rec.local)) {
        const b = bakeDrawn(rec); if (!b.canvas) continue;
        const p = rec.body.getPosition(), [sx, sy] = toScreen(p.x, p.y);
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(rec.body.getAngle()); ctx.drawImage(b.canvas, b.ox, b.oy); ctx.restore();
      }
    }
    effects(game, ui);
    if (ui.live && ui.live.points.length) {
      if (ui.live.rope) { ctx.save(); ctx.strokeStyle = NB.brown; ctx.lineWidth = 5; ctx.setLineDash([16, 9]); ctx.lineCap = 'round'; trace(ctx, ui.live.points); ctx.stroke(); ctx.restore(); }
      else markerStroke(ctx, ui.live.points, rng(7));
    }
    bell(level, ui);
    creature(game, level, ui);
    for (const pin of game.pins) {                                                       // a pin rides with the body it is in
      const j = pin.joints?.[0]; let px = pin.x, py = pin.y;
      if (j) { const a = j.getBodyA().isStatic() ? j.getAnchorB() : j.getAnchorA(); px = a.x; py = a.y; }
      const [x, y] = toScreen(px, py); screw(x, y, pin.kind === 'wall');
    }
    if (ui.debug) wireframe(game);
    hud(level, ui);
  }
  function wireframe(game) {
    ctx.save(); ctx.lineWidth = 1.5;
    for (let b = game.world.getBodyList(); b; b = b.getNext()) {
      ctx.strokeStyle = b.isStatic() ? 'rgba(200,0,0,.8)' : 'rgba(0,120,255,.9)';
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        const sh = f.getShape();
        if (sh.getType() === 'circle') { const c = b.getWorldPoint(sh.m_p); const [x, y] = toScreen(c.x, c.y); ctx.beginPath(); ctx.arc(x, y, sh.m_radius * PX_PER_UNIT, 0, 6.3); ctx.stroke(); }
        else if (sh.m_vertices) { ctx.beginPath(); sh.m_vertices.forEach((lv, i) => { const w = b.getWorldPoint(lv); const [x, y] = toScreen(w.x, w.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.stroke(); }
      }
    }
    ctx.restore();
  }
  return { render, ctx, bake: () => ({ canvas: null }), reveal: () => ({ canvas: null, complete: true }), stampPath: () => {} };
}
// screen-space geometry of the win scrap, shared with main.js for hit-testing (same box as the demo's banner)
export const WIN_SCRAP = { x: 251, y: 30, w: 521, h: 171, awesome: { x: 251 + 158, y: 30 + 118, w: 340, h: 30 } };

// ---- sounds, drawn too: pencil taps, a click, and the bell ---------------------------------------------
export function createNotebookSfx(actx) {
  let noiseBuf = null;
  function noise() {
    if (noiseBuf) return noiseBuf;
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.25, actx.sampleRate); const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function tap(vol, tone) {
    const src = actx.createBufferSource(); src.buffer = noise();
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = tone; bp.Q.value = 1.2;
    const g = actx.createGain(); const t = actx.currentTime; g.gain.setValueAtTime(vol * 0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(bp).connect(g).connect(actx.destination); src.start(t); src.stop(t + 0.1);
  }
  function ding(vol) {
    const t = actx.currentTime;
    for (const [f, a, dur] of [[1046, 0.5, 1.1], [1568, 0.25, 0.8], [2093, 0.12, 0.5], [523, 0.2, 0.9]]) {
      const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * a, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  function click(vol) {
    const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.value = 660; const g = actx.createGain(); const t = actx.currentTime;
    g.gain.setValueAtTime(vol * 0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.06);
  }
  // the music: a little music-box tune, 32 steps of a pentatonic doodle over two slow bass notes,
  // scheduled a bar ahead (Web Audio's clock, not setTimeout's) so it never stutters. Ours, no file.
  const TUNE = [0, 4, 7, 9, 7, 4, 0, -1, 2, 4, 7, 11, 9, 7, 4, -1, 0, 4, 9, 7, 4, 2, 0, -1, -3, 0, 4, 2, 0, -3, -5, -1];   // -1 = rest (semitones from C5)
  const BASS = [-24, -24, -20, -17];
  const STEP = 0.21, LOOP = TUNE.length * STEP;
  let musicOn = false, nextBar = 0, timer = null, musicGain = null;
  function note(semi, at, dur, vol, type = 'sine') {
    const o = actx.createOscillator(); o.type = type; o.frequency.value = 523.25 * Math.pow(2, semi / 12);
    const g = actx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(musicGain); o.start(at); o.stop(at + dur + 0.05);
  }
  function scheduleBar(at) {
    TUNE.forEach((semi, i) => { if (semi < 0) return; note(semi, at + i * STEP, 0.5, 0.11, 'triangle'); note(semi + 12, at + i * STEP, 0.25, 0.03); });
    BASS.forEach((semi, i) => note(semi, at + i * (LOOP / 4), LOOP / 4, 0.08, 'sine'));
  }
  function pump() {
    if (!musicOn) return;
    while (nextBar < actx.currentTime + LOOP) { scheduleBar(nextBar); nextBar += LOOP; }
    timer = setTimeout(pump, (LOOP * 1000) / 2);
  }
  return {
    play(name, vol = 1) {
      if (actx.state !== 'running') return;
      if (name.startsWith('hit')) tap(vol, 500 + (parseInt(name.replace(/\D/g, ''), 10) % 6) * 260);
      else if (name === 'star_pick.wav') ding(vol);
      else click(vol);
    },
    startMusic() {
      if (musicOn || actx.state !== 'running') return false;
      if (!musicGain) { musicGain = actx.createGain(); musicGain.gain.value = 0.5; musicGain.connect(actx.destination); }
      musicOn = true; nextBar = actx.currentTime + 0.05; pump(); return true;
    },
    stopMusic() { musicOn = false; if (timer) { clearTimeout(timer); timer = null; } if (musicGain) { musicGain.gain.setTargetAtTime(0.0001, actx.currentTime, 0.15); setTimeout(() => { if (!musicOn && musicGain) musicGain.gain.setValueAtTime(0.5, actx.currentTime); }, 600); } },
    get musicOn() { return musicOn; },
  };
}
