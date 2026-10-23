// notebookmap.js — the overworld in the Messy Notebook look: the `art` object map.js draws with when
// the theme is on. Islands are sand-and-grass blobs with a few trees, pedestals are little taped
// paper scraps with the page number, the boat is a folded paper boat, locks are padlock doodles.
// Nothing is loaded: every mark is drawn by code from deluxe/levels/map.json (tools/forge/map.mjs).
import { SCREEN_W, SCREEN_H } from './level.js';
import { NB, hash, rng, wobble, line, trace, inkOutline, markerFill, hatch, upEdges, star5 } from './notebook.js';
import { MARKER } from './mapdata.js';

const FONT = '"Patrick Hand", "Chalkboard SE", "Comic Sans MS", cursive';
const NOTE = '"Caveat", "Patrick Hand", "Chalkboard SE", cursive';
const SCRAP = { w: 78, h: 56 };                     // a pedestal's paper scrap, centred on the marker

export function createNotebookMapArt() {
  let grid = null;                                   // the graph-paper tile, as a pattern
  const islandBakes = new Map(), scrapBakes = new Map();
  let boatBake = null, lockBake = null;

  function paperTile(ctx) {
    if (grid) return grid;
    const c = document.createElement('canvas'); c.width = c.height = 240; const g = c.getContext('2d'); const rnd = rng(7);
    g.fillStyle = NB.paper; g.fillRect(0, 0, 240, 240);
    g.globalAlpha = 0.06; g.fillStyle = '#6b5a3a'; for (let i = 0; i < 160; i++) g.fillRect(rnd() * 240, rnd() * 240, 1 + rnd() * 1.5, 1);
    g.globalAlpha = 0.75; g.strokeStyle = NB.grid; g.lineWidth = 1;
    for (let v = 0.5; v < 240; v += 24) { g.beginPath(); g.moveTo(v, 0); g.lineTo(v, 240); g.stroke(); g.beginPath(); g.moveTo(0, v); g.lineTo(240, v); g.stroke(); }
    grid = ctx.createPattern(c, 'repeat'); return grid;
  }

  // ---- an island, baked once at island scale ---------------------------------------------------------
  function bakeIsland(isl) {
    let b = islandBakes.get(isl.id); if (b) return b;
    const M = 70, bb = isl.bbox, rnd = rng(hash(`island${isl.id}`));
    const c = document.createElement('canvas'); c.width = bb.maxX - bb.minX + 2 * M; c.height = bb.maxY - bb.minY + 2 * M;
    const g = c.getContext('2d'); g.translate(M - bb.minX, M - bb.minY);
    // little waves lapping round the sand
    g.save(); g.strokeStyle = '#8DB8EE'; g.lineWidth = 2.2; g.lineCap = 'round'; g.globalAlpha = 0.7;
    for (let k = 0; k < 14; k++) { const p = isl.sand[(rnd() * isl.sand.length) | 0], cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2, d = Math.hypot(p[0] - cx, p[1] - cy), ox = ((p[0] - cx) / d) * (30 + rnd() * 30), oy = ((p[1] - cy) / d) * (30 + rnd() * 30);
      const x = p[0] + ox, y = p[1] + oy; g.beginPath(); for (let i = 0; i <= 3; i++) { const t = i / 3; g.lineTo(x - 14 + 28 * t, y + Math.sin(t * 6.28) * 4); } g.stroke(); }
    g.restore();
    markerFill(g, isl.sand, '#F3E2B6', rnd, 0.92); hatch(g, isl.sand, '#D9B86E', rnd, 14, 0.8, 0.2, 1.4); inkOutline(g, isl.sand, rnd, NB.ink, 2.6);
    markerFill(g, isl.grass, NB.grass, rnd, 0.9); hatch(g, isl.grass, '#4B9143', rnd, 12, -0.6, 0.18); inkOutline(g, isl.grass, rnd, '#2F6B34', 2.2);
    g.save(); g.strokeStyle = '#4B9143'; g.lineWidth = 2; g.lineCap = 'round';
    for (const [a, b2] of upEdges(isl.grass)) { const d = Math.hypot(b2[0] - a[0], b2[1] - a[1]); for (let t = 4; t < d; t += 10 + rnd() * 8) { const x = a[0] + ((b2[0] - a[0]) / d) * t, y = a[1] + ((b2[1] - a[1]) / d) * t, h = 5 + rnd() * 6; g.beginPath(); g.moveTo(x - 2, y + 1); g.lineTo(x + (rnd() - 0.5) * 5, y - h); g.stroke(); } }
    g.restore();
    for (const d of isl.doodles || []) {
      if (d.kind === 'tree') {
        const s = d.s || 1, r = 26 * s;
        line(g, wobble([[d.x, d.y + 8], [d.x + 2, d.y + 34 * s]], rnd, 0.8), '#8A5A2B', 5 * s, 0.95);
        const crown = []; for (let i = 0; i < 18; i++) { const a = (i / 18) * 6.2832; crown.push([d.x + Math.cos(a) * r * (1 + 0.12 * Math.sin(a * 3)), d.y + Math.sin(a) * r * 0.9]); }
        markerFill(g, crown, '#7FBF6A', rnd, 0.92); hatch(g, crown, '#4B9143', rnd, 6, 0.9, 0.35); inkOutline(g, crown, rnd, '#2F6B34', 2);
      } else if (d.kind === 'hill') {
        const pts = []; for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push([d.x - d.w / 2 + d.w * t, d.y - Math.sin(t * Math.PI) * d.w * 0.28]); }
        line(g, wobble(pts, rnd, 1.2), NB.pencil, 2.2, 0.55);
        line(g, wobble([[d.x - d.w * 0.15, d.y - d.w * 0.2], [d.x - d.w * 0.05, d.y - d.w * 0.1]], rnd, 0.6), NB.pencil, 1.6, 0.4);
      }
    }
    b = { canvas: c, ox: bb.minX - M, oy: bb.minY - M }; islandBakes.set(isl.id, b); return b;
  }

  // ---- a pedestal: a taped scrap of paper with the page number -----------------------------------------
  function bakeScrap(n, kind) {                      // kind: 'open' | 'solved' | 'locked'
    const key = `${kind}|${n}`; let c = scrapBakes.get(key); if (c) return c;
    const M = 18, { w, h } = SCRAP; c = document.createElement('canvas'); c.width = w + 2 * M; c.height = h + 2 * M;
    const g = c.getContext('2d'); g.translate(M, M); const rnd = rng(hash(`scrap${n}`) + (kind === 'solved' ? 7 : 0));
    const edge = wobble([[0, 0], [w, 0], [w, h], [0, h]], rnd, 1.8, true, 9);
    if (kind === 'locked') { g.save(); g.setLineDash([4, 5]); g.strokeStyle = NB.pencil; g.lineWidth = 1.8; g.globalAlpha = 0.7; trace(g, edge, true); g.stroke(); g.restore(); }
    else {
      g.save(); g.shadowColor = 'rgba(60,50,30,.25)'; g.shadowBlur = 5; g.shadowOffsetY = 3; g.fillStyle = kind === 'solved' ? '#FFFDF4' : '#FBF8EE'; trace(g, edge, true); g.fill(); g.restore();
      g.strokeStyle = NB.grid; g.lineWidth = 1; for (let y = 18; y < h; y += 14) { g.beginPath(); g.moveTo(6, y); g.lineTo(w - 6, y); g.stroke(); }
      inkOutline(g, edge, rnd, kind === 'solved' ? NB.ink : NB.pencil, 1.8);
      g.fillStyle = 'rgba(255,255,255,.6)'; g.save(); g.translate(w / 2, -2); g.rotate(-0.06); g.fillRect(-20, -7, 40, 14); g.restore();   // the tape
    }
    g.fillStyle = kind === 'locked' ? NB.pencil : NB.ink; g.globalAlpha = kind === 'locked' ? 0.6 : 1;
    g.font = `${kind === 'solved' ? 22 : 26}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), w / 2, kind === 'solved' ? h / 2 - 9 : h / 2 + 2);
    scrapBakes.set(key, c); return c;
  }

  function bakeBoat() {
    if (boatBake) return boatBake;
    const c = document.createElement('canvas'); c.width = 130; c.height = 110; const g = c.getContext('2d'); g.translate(65, 80); const rnd = rng(hash('boat'));
    const hull = [[-50, -10], [50, -10], [34, 22], [-34, 22]];
    markerFill(g, hull, '#FFFDF4', rnd, 1); inkOutline(g, hull, rnd, NB.ink, 2.4);
    g.save(); trace(g, hull, true); g.clip(); g.fillStyle = NB.cobalt; g.globalAlpha = 0.85; g.fillRect(-60, 2, 120, 8); g.restore();
    line(g, wobble([[0, -10], [0, -66]], rnd, 0.6), NB.ink, 2.4);                                                   // mast
    const sail = [[2, -62], [2, -14], [40, -14]]; markerFill(g, sail, '#FFFDF4', rnd, 1); hatch(g, sail, NB.pencil, rnd, 7, 0.6, 0.2); inkOutline(g, sail, rnd, NB.ink, 2.2);
    const flag = [[0, -66], [16, -60], [0, -54]]; markerFill(g, flag, NB.coral, rnd, 0.95); inkOutline(g, flag, rnd, NB.ink, 1.6);
    boatBake = c; return c;
  }
  function bakeLock() {
    if (lockBake) return lockBake;
    const c = document.createElement('canvas'); c.width = 120; c.height = 130; const g = c.getContext('2d'); g.translate(60, 70); const rnd = rng(hash('lock'));
    g.strokeStyle = NB.ink; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.arc(0, -22, 20, Math.PI, 0); g.stroke();                 // shackle
    g.strokeStyle = '#B9BEC9'; g.lineWidth = 3; g.beginPath(); g.arc(0, -22, 20, Math.PI, 0); g.stroke();
    const body = [[-32, -22], [32, -22], [32, 30], [-32, 30]]; markerFill(g, body, '#CDD0D5', rnd, 0.95); hatch(g, body, '#8B9099', rnd, 7, 0.8, 0.35); inkOutline(g, body, rnd, NB.ink, 2.6);
    g.fillStyle = NB.ink; g.beginPath(); g.arc(0, -2, 6, 0, 6.3); g.fill(); g.fillRect(-2.5, -2, 5, 14);                                   // keyhole
    lockBake = c; return c;
  }

  return {
    font: FONT, text: NB.ink, textSoft: 'rgba(37,51,82,.7)', label: NB.ink, inset: 110,
    background(ctx, view) {
      ctx.fillStyle = paperTile(ctx);
      ctx.save(); ctx.translate(-((view.cx * view.scale) % 240), -((view.cy * view.scale) % 240)); ctx.fillRect(-240, -240, SCREEN_W + 480, SCREEN_H + 480); ctx.restore();
      ctx.save(); ctx.globalAlpha = 0.85; ctx.strokeStyle = NB.margin; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(84, 0); ctx.lineTo(85, SCREEN_H); ctx.stroke();   // the margin and holes stay on the page
      for (const y of [128, 384, 640]) { ctx.fillStyle = '#E6E1D3'; ctx.beginPath(); ctx.arc(42, y, 10, 0, 6.3); ctx.fill(); ctx.strokeStyle = 'rgba(80,70,50,.25)'; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.restore();
    },
    route(ctx, _key, pts, open, scale) {
      ctx.save(); ctx.strokeStyle = open ? NB.cobalt : NB.pencil; ctx.globalAlpha = open ? 0.6 : 0.25; ctx.lineCap = 'round';
      ctx.lineWidth = 3.5 / Math.pow(scale, 0.7); ctx.setLineDash([16, 12].map((v) => v / Math.pow(scale, 0.5)));
      trace(ctx, pts); ctx.stroke(); ctx.restore();
    },
    island(ctx, isl, { locked, hot, scale }) {
      const b = bakeIsland(isl);
      ctx.globalAlpha = locked ? 0.5 : 1; ctx.drawImage(b.canvas, b.ox, b.oy); ctx.globalAlpha = 1;
      if (hot) {
        ctx.save(); ctx.strokeStyle = NB.cobalt; ctx.globalAlpha = 0.6; ctx.lineWidth = 8 / scale; ctx.setLineDash([28 / scale, 16 / scale]);
        ctx.strokeRect(isl.bbox.minX - 30, isl.bbox.minY - 30, isl.bbox.maxX - isl.bbox.minX + 60, isl.bbox.maxY - isl.bbox.minY + 60); ctx.restore();
      }
    },
    path(ctx, strokes, lit) {
      ctx.save(); ctx.strokeStyle = NB.pencil; ctx.globalAlpha = lit ? 0.8 : 0.3; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.setLineDash([3, 9]);
      trace(ctx, strokes[0].points); ctx.stroke(); ctx.restore();
    },
    marker(ctx, l, { stars, can, hot, playable, now }) {
      const cx = l.x + MARKER.w / 2, cy = l.y + MARKER.h / 2, kind = stars ? 'solved' : can ? 'open' : 'locked';
      const c = bakeScrap(l.n ?? '', kind);
      ctx.save(); ctx.translate(cx, cy + (hot ? -4 : 0)); ctx.rotate((hot ? Math.sin(now / 160) * 0.03 : 0) + (((hash(l.file) % 9) - 4) / 100));
      if (!playable) ctx.globalAlpha = 0.4;
      ctx.drawImage(c, -c.width / 2, -c.height / 2);
      if (stars) {
        for (let k = 0; k < 3; k++) { const on = k < stars; ctx.fillStyle = NB.yellow; ctx.strokeStyle = on ? '#C8961E' : NB.pencil; ctx.lineWidth = 1.6; ctx.globalAlpha = on ? 1 : 0.35; star5(ctx, -22 + k * 22, 12, 9, 0.1 * k); if (on) ctx.fill(); ctx.stroke(); }
        ctx.globalAlpha = 1;
        if (stars >= 2) {                                                                 // a pencil flag on the corner: cobalt for two stars, coral for all three
          ctx.strokeStyle = NB.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(SCRAP.w / 2 - 6, -SCRAP.h / 2 + 2); ctx.lineTo(SCRAP.w / 2 - 6, -SCRAP.h / 2 - 34); ctx.stroke();
          ctx.fillStyle = stars >= 3 ? NB.coral : NB.cobalt; ctx.beginPath(); ctx.moveTo(SCRAP.w / 2 - 6, -SCRAP.h / 2 - 34); ctx.lineTo(SCRAP.w / 2 + 18, -SCRAP.h / 2 - 27); ctx.lineTo(SCRAP.w / 2 - 6, -SCRAP.h / 2 - 18); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
    },
    ball(ctx, cx, cy, now) {                                                              // the creature sits on its page, bobbing
      const R = 17, y = cy - SCRAP.h / 2 - R - 2 + Math.sin(now / 300) * 2;
      ctx.save(); ctx.translate(cx, y);
      ctx.fillStyle = '#4A7CF0'; ctx.strokeStyle = NB.ink; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.3); ctx.fill(); ctx.stroke();
      for (const [ex, ey, er] of [[-6.5, -4, 5], [6, -5, 4.5]]) { ctx.fillStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ex, ey, er, 0, 6.3); ctx.fill(); ctx.stroke(); ctx.fillStyle = NB.ink; ctx.beginPath(); ctx.arc(ex + 1, ey + 1, er * 0.45, 0, 6.3); ctx.fill(); }
      ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(0, 3, 6, 0.4, 2.74); ctx.stroke();
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-6, R - 2); ctx.lineTo(-7, R + 6); ctx.lineTo(-12, R + 7); ctx.moveTo(6, R - 2); ctx.lineTo(7, R + 6); ctx.lineTo(12, R + 7); ctx.stroke();
      ctx.restore();
    },
    lock(ctx, isl, cx, cy, scale) {
      const s = 1 / scale * 0.9, c = bakeLock();
      ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.drawImage(c, -60, -70);
      ctx.fillStyle = NB.ink; ctx.font = `bold 30px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${isl.starsNeeded}`, 8, 54);
      ctx.fillStyle = NB.yellow; ctx.strokeStyle = '#C8961E'; ctx.lineWidth = 1.5; star5(ctx, -20, 54, 11, 0); ctx.fill(); ctx.stroke();
      ctx.restore();
    },
    boat(ctx, boat, s, now) {
      const c = bakeBoat(), bob = Math.sin(now / 420) * 3;
      ctx.save(); ctx.translate(boat.x, boat.y + bob); ctx.scale(s, s); ctx.rotate(Math.sin(now / 900) * 0.04);
      if (Math.cos(boat.angle) < 0) ctx.scale(-1, 1);
      ctx.drawImage(c, -65, -80);
      ctx.restore();
    },
    boatBox() { return { x: -55, y: -75, w: 110, h: 100 }; },
    starIcon(ctx) { ctx.save(); ctx.fillStyle = NB.yellow; ctx.strokeStyle = '#C8961E'; ctx.lineWidth = 2; star5(ctx, 38, 32, 19, 0.05); ctx.fill(); ctx.stroke(); ctx.restore(); },
    islandTitle(ctx, isl, x, y, align) {                                                  // the name on a strip of masking tape
      ctx.save(); ctx.font = `26px ${FONT}`; const text = `${isl.name}`, w = ctx.measureText(text).width + 30, left = align === 'right' ? x - w : x - w / 2;
      ctx.translate(left + w / 2, y + 30); ctx.rotate(-0.012);
      ctx.fillStyle = 'rgba(255,253,244,.85)'; ctx.fillRect(-w / 2, -18, w, 36);
      ctx.fillStyle = NB.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 1);
      ctx.font = `15px ${NOTE}`; ctx.fillStyle = NB.pencil; ctx.textAlign = 'left'; ctx.fillText(`island ${isl.id}`, -w / 2 + 4, -27);
      ctx.restore();
    },
  };
}
