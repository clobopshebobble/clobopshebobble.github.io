// render.js — draws the real Deluxe art: background JPG, crayon strokes stamped with the demo's
// 10×10 brush textures (crayon_brush.xml: 4 stamps, Repeat 4, AngleJitter 1.0), the animated
// ball and star sprite sheets, pin sprites, and (D key) the Box2D wireframe for alignment checks.
import { PX_PER_UNIT, toScreen, drawingPivot, strokesBBox, SCREEN_W, SCREEN_H } from './level.js';
import { BALL_RADIUS } from './world.js';

const BRUSH_REPEAT = 4;
const BRUSH_JITTER = 1.0;
const STAMP_SPACING = 2.5;      // px between stamps along a stroke (highDetailPixelPlot = 3)

export function createRenderer(canvas, assets) {
  const ctx = canvas.getContext('2d');
  const baked = new WeakMap();    // strokes array → { canvas, ox, oy }
  const tinted = new Map();       // color → [canvas×4]
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  function brushesFor(color) {
    let arr = tinted.get(color);
    if (arr) return arr;
    arr = assets.brush.map((img) => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
      return c;
    });
    tinted.set(color, arr);
    return arr;
  }

  // one crayon dab: BRUSH_REPEAT jittered stamps of random brush textures
  function put(g, br, half, x, y) {
    for (let k = 0; k < BRUSH_REPEAT; k++) {
      const b = br[(rnd() * br.length) | 0];
      g.save(); g.translate(x, y); g.rotate((rnd() - 0.5) * 2 * BRUSH_JITTER); g.drawImage(b, -half, -half); g.restore();
    }
  }
  // walk one segment placing a dab every `spacing` px. `st.carry` is the distance left to the next
  // dab, carried across calls so a stroke can be drawn in pieces (frame by frame) with no seam.
  function stampSegment(g, br, half, x0, y0, x1, y1, spacing, st) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d === 0) return;
    let s = st.carry;
    while (s <= d) { const t = s / d; put(g, br, half, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); s += spacing; }
    st.carry = s - d;
  }

  // stamp a whole polyline (px) onto g — used for the stroke being drawn right now
  function stampPath(g, points, color, alpha = 0.95, spacing = STAMP_SPACING) {
    const br = brushesFor(color);
    if (!br.length || points.length === 0) return;
    g.save(); g.globalAlpha = alpha;
    const half = br[0].width / 2;
    put(g, br, half, points[0][0], points[0][1]);
    const st = { carry: spacing };
    for (let i = 1; i < points.length; i++) stampSegment(g, br, half, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], spacing, st);
    g.restore();
  }

  // Bake a strokes array (px coords) into an offscreen canvas, progressively: `fraction` of the
  // total crayon length is on the canvas after the call, and later calls only add what is new.
  // That is how the level intro draws the art in over drawingAnimationDuration (2 s): every frame
  // asks for a slightly larger fraction. Once complete the entry is just a cached bake.
  function reveal(strokes, fraction = 1, spacing = STAMP_SPACING) {
    let e = baked.get(strokes);
    if (!e) {
      const bb = strokesBBox(strokes);
      if (!bb) { e = { canvas: null, ox: 0, oy: 0, complete: true }; baked.set(strokes, e); return e; }
      const M = 12;
      const c = document.createElement('canvas');
      c.width = Math.ceil(bb.maxX - bb.minX) + 2 * M; c.height = Math.ceil(bb.maxY - bb.minY) + 2 * M;
      const g = c.getContext('2d');
      g.translate(M - bb.minX, M - bb.minY);
      let total = 0;
      for (const s of strokes) for (let i = 1; i < s.points.length; i++) total += Math.hypot(s.points[i][0] - s.points[i - 1][0], s.points[i][1] - s.points[i - 1][1]);
      e = { canvas: c, g, ox: bb.minX - M, oy: bb.minY - M, total, done: 0, si: 0, pi: 0, pen: null, carry: 0, seed: 7, spacing, complete: false };
      baked.set(strokes, e);
    }
    if (e.complete) return e;
    const target = fraction >= 1 ? Infinity : fraction * e.total;
    const saved = seed; seed = e.seed;
    const g = e.g; g.save(); g.globalAlpha = 0.95;
    while (e.si < strokes.length && e.done < target) {
      const pts = strokes[e.si].points;
      const br = brushesFor(strokes[e.si].color); const half = br.length ? br[0].width / 2 : 0;
      if (e.pi === 0) {
        if (br.length) put(g, br, half, pts[0][0], pts[0][1]);
        e.pen = pts[0]; e.carry = e.spacing; e.pi = 1;
      }
      while (e.pi < pts.length && e.done < target) {
        const a = e.pen, b = pts[e.pi];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]), room = target - e.done;
        if (d <= room) { if (br.length) stampSegment(g, br, half, a[0], a[1], b[0], b[1], e.spacing, e); e.done += d; e.pen = b; e.pi++; }
        else { const t = room / d, m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; if (br.length) stampSegment(g, br, half, a[0], a[1], m[0], m[1], e.spacing, e); e.done = target; e.pen = m; }
      }
      if (e.pi >= pts.length) { e.si++; e.pi = 0; }
    }
    g.restore();
    e.seed = seed; seed = saved;
    if (e.si >= strokes.length) e.complete = true;
    return e;
  }
  const bake = (strokes, spacing = STAMP_SPACING) => reveal(strokes, 1, spacing);

  function sprite(img, sx, sy, sw, sh, x, y, angle = 0, scale = 1) {
    if (!img) return;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale);
    ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }

  function render(game, level, ui) {
    const t = ui.now;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
    const bgImg = assets.images.get(level.background.image);
    if (bgImg) ctx.drawImage(bgImg, 0, 0, SCREEN_W, SCREEN_H);
    else { ctx.fillStyle = '#f4ecd8'; ctx.fillRect(0, 0, SCREEN_W, SCREEN_H); }

    // background crayon art (static, screen px) — drawn in over the level intro (ui.intro 0→1)
    const intro = ui.intro ?? 1;
    const bgd = level.background.drawing;
    if (bgd.strokes.length) { const b = reveal(bgd.strokes, intro); if (b.canvas) ctx.drawImage(b.canvas, b.ox + bgd.moveBy.x, b.oy + bgd.moveBy.y); }

    // bodies
    for (const rec of game.records) {
      const body = rec.body;
      const p = body.getPosition();
      const [sx, sy] = toScreen(p.x, p.y);
      const a = body.getAngle();
      if (rec.kind === 'level') {
        if (rec.isBall || !rec.spec.gfx?.drawing?.strokes.length) continue;
        const b = reveal(rec.spec.gfx.drawing.strokes, intro);
        if (!b.canvas) continue;
        const piv = drawingPivot(rec.spec.gfx);
        const mv = rec.spec.gfx.drawing.moveBy;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(a - rec.spec.angle);
        ctx.drawImage(b.canvas, b.ox - piv.x + mv.x, b.oy - piv.y + mv.y);
        ctx.restore();
      } else if (rec.kind === 'rope') {
        // the demo's rope pieces (rope_piece_01…05.png, 43×9), one per chain link, along each segment
        rec.segs.forEach((seg, i) => {
          const q = seg.getPosition(); const [x, y] = toScreen(q.x, q.y);
          const img = assets.images.get(`data/gfx/rope_piece_0${1 + (i % 5)}.png`);
          const f = seg.getFixtureList(); const len = f ? f.getShape().m_vertices[1].x * 2 : 1;
          if (img) sprite(img, 0, 0, img.width, img.height, x, y, seg.getAngle(), (len * PX_PER_UNIT) / img.width);
          else { ctx.save(); ctx.strokeStyle = 'rgb(120,80,40)'; ctx.lineWidth = 5; ctx.translate(x, y); ctx.rotate(seg.getAngle()); ctx.beginPath(); ctx.moveTo(-len * 16, 0); ctx.lineTo(len * 16, 0); ctx.stroke(); ctx.restore(); }
        });
      } else {
        if (!rec.px) rec.px = [{ color: rec.color, points: rec.local.map(([x, y]) => [x * PX_PER_UNIT, y * PX_PER_UNIT]) }];
        const b = bake(rec.px);
        if (!b.canvas) continue;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(a); ctx.drawImage(b.canvas, b.ox, b.oy); ctx.restore();
      }
      if (rec.isRocket && rec.lit != null && game.time - rec.lit < 5) {       // the flame: fresh jittered crayon behind the tail every frame
        const tailX = -1.9 * PX_PER_UNIT;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(a);
        for (let k = 0; k < 3; k++) {
          const len = (18 + Math.random() * 26) + k * 6, spread = (Math.random() - 0.5) * 14;
          seed = (t * 7 + k * 131) | 0;
          stampPath(ctx, [[tailX, spread * 0.3], [tailX - len * 0.5, spread], [tailX - len, spread * 1.4]], k === 2 ? 'rgb(238,196,40)' : 'rgb(221,107,23)', 0.9);
        }
        ctx.restore();
      }
    }
    // explosion puffs (0.6 s): expanding crayon rings, drawn in the demo's smoke grey
    for (let i = game.effects.length - 1; i >= 0; i--) {
      const e = game.effects[i]; const age = game.time - e.t;
      if (age > 0.6) { game.effects.splice(i, 1); continue; }
      const [x, y] = toScreen(e.x, e.y); const R = 20 + age * 160;
      ctx.save(); ctx.globalAlpha = 1 - age / 0.6; ctx.strokeStyle = 'rgb(110,100,95)'; ctx.lineWidth = 6; ctx.setLineDash([9, 7]);
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgb(221,107,23)'; ctx.beginPath(); ctx.arc(x, y, R * 0.55, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // live stroke being drawn (screen px); a rope in progress is a dashed brown line
    if (ui.live && ui.live.points.length) {
      if (ui.live.rope) { ctx.save(); ctx.strokeStyle = 'rgb(120,80,40)'; ctx.lineWidth = 6; ctx.setLineDash([22, 10]); ctx.lineCap = 'round'; ctx.beginPath(); ui.live.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore(); }
      else { seed = 7; stampPath(ctx, ui.live.points, ui.live.color); }
    }

    // star (collectable_04.png: 6 frames of 66×63; row 0 idle, row 67 highlight)
    if (level.star) {
      const img = assets.images.get('data/gfx/collectable_04.png');
      const f = ((t / 100) | 0) % 6;
      const [x, y] = toScreen(level.star.x, level.star.y);
      const row = ui.won ? 67 : 0;
      sprite(img, f * 70, row, 66, 63, x, y, 0, ui.won ? 1 + 0.4 * Math.sin((t - ui.wonAt) / 120) : 1);
    }

    // ball (the_ball_animated_03.png: 5 frames of 56×56 every 120 ms)
    if (game.ball) {
      const img = assets.images.get('data/gfx/the_ball_animated_03.png');
      const f = ((t / 120) | 0) % 5;
      const p = game.ball.getPosition();
      const [x, y] = toScreen(p.x, p.y);
      sprite(img, f * 60, 0, 56, 56, x, y, game.ball.getAngle(), (BALL_RADIUS * 2 * PX_PER_UNIT) / 50);
    }

    // pins
    for (const pin of game.pins) {
      const [x, y] = toScreen(pin.x, pin.y);
      if (pin.kind === 'wall') {
        const name = (pin.gfx || 'data/gfx/pin_04.xml').replace(/\.xml$/, '.png');
        const img = assets.images.get(name) || assets.images.get('data/gfx/pin_04.png');
        if (img) sprite(img, 0, 0, img.width, img.height, x, y);
      } else {
        const img = assets.images.get('data/gfx/game_pin_01.png');
        sprite(img, 0, 0, 36, 36, x, y);
      }
    }

    if (ui.debug) wireframe(game);

    hud(level, ui);
  }

  function wireframe(game) {
    ctx.save(); ctx.lineWidth = 1.5;
    for (let b = game.world.getBodyList(); b; b = b.getNext()) {
      ctx.strokeStyle = b.isStatic() ? 'rgba(200,0,0,.8)' : b.isAwake() ? 'rgba(0,120,255,.9)' : 'rgba(0,160,0,.8)';
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        const sh = f.getShape();
        if (sh.getType() === 'circle') {
          const c = b.getWorldPoint(sh.m_p); const [x, y] = toScreen(c.x, c.y);
          ctx.beginPath(); ctx.arc(x, y, sh.m_radius * PX_PER_UNIT, 0, Math.PI * 2); ctx.stroke();
        } else if (sh.m_vertices) {
          ctx.beginPath();
          sh.m_vertices.forEach((lv, i) => { const w = b.getWorldPoint(lv); const [x, y] = toScreen(w.x, w.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
          ctx.closePath(); ctx.stroke();
        }
      }
    }
    for (const j of game.pins) { const [x, y] = toScreen(j.x, j.y); ctx.strokeStyle = 'magenta'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke(); }
    const [ox, oy] = toScreen(0, 0); ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.moveTo(ox - 10, oy); ctx.lineTo(ox + 10, oy); ctx.moveTo(ox, oy - 10); ctx.lineTo(ox, oy + 10); ctx.stroke();
    ctx.restore();
  }

  function hud(_level, ui) {
    ctx.save();
    ctx.font = '26px "Chalkboard SE", "Comic Sans MS", "Segoe Print", cursive';
    ctx.fillStyle = 'rgba(40,40,40,.85)';
    ctx.textBaseline = 'top';
    ctx.fillText(`${ui.index + 1}/${ui.count}  ${ui.name}`, 18, 12);
    ctx.font = '16px "Chalkboard SE", "Comic Sans MS", "Segoe Print", cursive';
    ctx.fillStyle = 'rgba(40,40,40,.65)';
    ctx.textAlign = 'right';
    const help = ui.rope
      ? (ui.touch ? 'rope on · draw from one thing to another · 🪢 again for the crayon' : 'rope on · draw from one thing to another · R for the crayon')
      : ui.touch
        ? (ui.eraser ? 'eraser on · rub over your crayon to remove it · 🧽 again for the crayon' : 'draw · tap the ball to roll it · hold to erase (hold the ball: roll left)')
        : 'draw · right-click erases · click ball rolls it · R rope · space resets · ←/→ levels · D wireframe · M mute';
    ctx.fillText(`${ui.muted ? 'muted · ' : ''}${help}`, SCREEN_W - 18, SCREEN_H - 30);
    if (ui.won) winBanner(ui);
    if (ui.message) { ctx.textAlign = 'center'; ctx.font = '22px "Chalkboard SE", "Comic Sans MS", cursive'; ctx.fillStyle = 'rgba(30,30,30,.8)'; ctx.fillText(ui.message, SCREEN_W / 2, SCREEN_H - 70); }
    ctx.restore();
  }

  // The "new star" panel (new_star_background.png) with the stars this solution earned and the
  // player's own "Mark solution as Awesome" checkbox (solutions_checkbox.png, 2 frames of 49×46).
  function winBanner(ui) {
    const B = WIN_BANNER, st = ui.stars || {};
    const bg = assets.images.get('data/gfx/ui/new_star_background.png');
    const t = Math.min(1, (ui.now - ui.wonAt) / 350);                       // slides down from the top
    ctx.save(); ctx.translate(0, -(1 - t) * (B.y + B.h));
    if (bg) ctx.drawImage(bg, B.x, B.y, B.w, B.h);
    else { ctx.fillStyle = 'rgba(244,236,216,.95)'; ctx.fillRect(B.x, B.y, B.w, B.h); }
    const font = '"Chalkboard SE", "Comic Sans MS", "Segoe Print", cursive';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgb(44,84,170)'; ctx.font = `bold 30px ${font}`;
    ctx.fillText(st.stars >= 3 ? 'All three stars!' : st.newElegant ? 'Elegant Solution!' : 'Solved!', B.x + 160, B.y + 54);
    ctx.font = `21px ${font}`;
    const line = (txt, on, y) => { ctx.fillStyle = on ? 'rgb(70,120,40)' : 'rgba(60,60,60,.55)'; ctx.fillText(`${on ? '★' : '☆'}  ${txt}`, B.x + 160, y); };
    line('Solved', true, B.y + 84);
    line(st.elegant ? 'Elegant Solution' : 'Elegant Solution — not this time', !!st.elegant, B.y + 109);
    const cb = assets.images.get('data/gfx/ui/solutions_checkbox.png');
    const box = B.awesome;
    if (cb) ctx.drawImage(cb, 0, st.awesome ? 46 : 0, 49, 46, box.x, box.y, 30, 28);
    else { ctx.strokeStyle = '#444'; ctx.lineWidth = 2; ctx.strokeRect(box.x + 3, box.y + 3, 22, 22); if (st.awesome) ctx.fillText('✓', box.x + 7, box.y + 22); }
    ctx.fillStyle = st.awesome ? 'rgb(70,120,40)' : 'rgb(60,60,60)';
    ctx.fillText(st.awesome ? '★  Marked as Awesome' : 'Mark solution as Awesome  (A)', box.x + 40, box.y + 22);
    ctx.restore();
  }

  return { render, bake, reveal, stampPath, ctx };
}

// screen-space geometry of the win banner, shared with main.js for hit-testing
export const WIN_BANNER = { x: 251, y: 30, w: 521, h: 171, awesome: { x: 251 + 158, y: 30 + 118, w: 340, h: 30 } };
