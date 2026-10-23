// map.js — the overworld screen: the whole crayon world zoomed out (sea view), click an island,
// the boat sails there along the dashed route, the camera zooms in, click a level pedestal to play.
// Progress (solved levels → stars → island locks) lives in localStorage.
//
// Everything visible goes through an `art` object so the same screen draws either the demo's map
// sprites (createSpriteArt, the default) or the Messy Notebook's doodles (notebookmap.js); the
// navigation, hit-testing and progress rules are shared.
import { SCREEN_W, SCREEN_H } from './level.js';
import { LEVEL_TYPE, MARKER, markerCentre, reachable, islandUnlocked, starsOf, marksOf, solveLevel, toggleAwesome as toggleAwesomeMark, emptyProgress, dockOf, routeBetween, pathLength, pointAlong } from './mapdata.js';

const ROUTE_SPACING = 20;         // crayon_brush_dashed.xml: same stamps, Spacing 20
const ZOOM_MS = 750;
const BOAT_SPEED = 900;           // world px / s
const EDGE = 110, EDGE_SPEED = 14; // MouseMoveCamera: MoveBuffer ~110 px, MaxSpeed ~10–13
const STORAGE_KEY = 'crayon-deluxe-progress';
// data/tutorials/map_hints.xml: a caption on first opening the map, and a two-page one after the
// last level of island 1 (level_10) that walks the player to the boat and then to a new island.
const DEMO_HINT_FILES = { first: 'data/levels/tutorial_draw_a_box.xml', boat: 'data/levels/level_10.xml' };
const HINTS = {
  selectLevel: 'SELECT A LEVEL TO PLAY',                 // LOL_SELECT_A_LEVEL
  clickBoat: 'THE BOAT WILL TAKE YOU TO NEW ISLANDS',     // LOL_THE_BOAT_WILL
  selectIsland: 'SELECT ISLAND TO EXPLORE',               // LOL_SELECT_ISLAND_TO
};

export function loadProgress(key = STORAGE_KEY) {
  try {
    const p = JSON.parse(localStorage.getItem(key) || 'null');
    if (p && p.solved) { p.marks ||= {}; p.hints ||= {}; return p; }
  } catch { /* private mode etc. */ }
  return emptyProgress();
}
export function saveProgress(p, key = STORAGE_KEY) { try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* ignore */ } }

// ---- the demo's look: its map sprites and crayon-stamped strokes ------------------------------------
export function createSpriteArt({ assets, renderer }) {
  const img = (name) => assets.images.get(name);
  let paper = null;
  const routeCache = new Map();
  return {
    font: '"Chalkboard SE", "Comic Sans MS", "Segoe Print", cursive',
    text: 'rgba(40,40,40,.85)', textSoft: 'rgba(30,30,30,.7)', label: 'rgba(30,30,30,.85)',
    background(ctx, view) {
      const paperImg = img('data/gfx/ui/paper_background.jpg');
      if (paperImg) {
        if (!paper) paper = ctx.createPattern(paperImg, 'repeat');
        ctx.fillStyle = paper;
        ctx.save(); ctx.translate((-view.cx * view.scale) % paperImg.width, (-view.cy * view.scale) % paperImg.height); ctx.fillRect(-paperImg.width, -paperImg.height, SCREEN_W + 2 * paperImg.width, SCREEN_H + 2 * paperImg.height); ctx.restore();
      } else { ctx.fillStyle = '#f4ecd8'; ctx.fillRect(0, 0, SCREEN_W, SCREEN_H); }
    },
    route(ctx, key, pts, open) {
      let s = routeCache.get(key); if (!s) { s = [{ color: 'rgb(64,76,254)', points: pts }]; routeCache.set(key, s); }
      const baked = renderer.bake(s, ROUTE_SPACING); if (!baked.canvas) return;
      ctx.globalAlpha = open ? 0.9 : 0.22; ctx.drawImage(baked.canvas, baked.ox, baked.oy); ctx.globalAlpha = 1;
    },
    island(ctx, isl, { locked, hot, scale }) {
      if (!isl.strokes.length) return;
      const b = renderer.bake(isl.strokes); if (!b.canvas) return;
      ctx.globalAlpha = locked ? 0.55 : 1; ctx.drawImage(b.canvas, b.ox, b.oy); ctx.globalAlpha = 1;
      if (hot) {
        ctx.save(); ctx.strokeStyle = 'rgba(40,120,200,.55)'; ctx.lineWidth = 10 / scale; ctx.setLineDash([30 / scale, 18 / scale]);
        ctx.strokeRect(isl.bbox.minX - 40, isl.bbox.minY - 40, isl.bbox.maxX - isl.bbox.minX + 80, isl.bbox.maxY - isl.bbox.minY + 80); ctx.restore();
      }
    },
    path(ctx, strokes, lit) {
      const baked = renderer.bake(strokes, 16); if (!baked.canvas) return;
      ctx.globalAlpha = lit ? 0.85 : 0.3; ctx.drawImage(baked.canvas, baked.ox, baked.oy); ctx.globalAlpha = 1;
    },
    marker(ctx, l, { stars, can, hot, playable, now }) {
      const sel = { empty: img('data/gfx/ui/map_select_empty.png'), filled: img('data/gfx/ui/map_select_filled.png'), locked: img('data/gfx/ui/map_select_unreachable.png') };
      const f = ((now / 120) | 0) % 4;
      if (stars && sel.filled) {
        ctx.drawImage(sel.filled, hot ? f * 110 : (((now / 160) | 0) % 4) * 110, hot ? 0 : 91, 110, 91, l.x, l.y, 110, 91);
        // extra stars fly a flag on the pedestal: blue for one extra (map_flag_small), orange for all three (map_flag_big)
        const flag = stars >= 3 ? img('data/gfx/ui/map_flag_big.png') : stars >= 2 ? img('data/gfx/ui/map_flag_small.png') : null;
        if (flag) ctx.drawImage(flag, l.x, l.y);
      }
      else if (can && sel.empty) ctx.drawImage(sel.empty, hot ? f * 110 : 0, 0, 110, 91, l.x, l.y, 110, 91);
      else if (sel.locked) { ctx.globalAlpha = playable ? 0.9 : 0.45; ctx.drawImage(sel.locked, l.x, l.y); ctx.globalAlpha = 1; }
    },
    ball(ctx, cx, cy, now) {
      const ballImg = img('data/gfx/the_ball_animated.png'); const bf = ((now / 120) | 0) % 5;
      if (ballImg) ctx.drawImage(ballImg, bf * 56, 0, 56, 55, cx - 28, cy - 68, 56, 55);
    },
    lock(ctx, isl, cx, cy, scale) {
      const lock = img('data/gfx/ui/map_star_lock.png'); const s = 1 / scale * 0.9;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
      if (lock) ctx.drawImage(lock, 0, 0, 138, 126, -69, -63, 138, 126);
      ctx.fillStyle = '#2b2b2b'; ctx.font = `bold 40px ${this.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(isl.starsNeeded), 0, 8);
      ctx.restore();
    },
    boat(ctx, boat, s, now) {
      const boatImg = img('data/gfx/ui/map_select_seastuff.png'); if (!boatImg) return;
      const bob = Math.sin(now / 420) * 3;
      ctx.save(); ctx.translate(boat.x, boat.y + bob); ctx.scale(s, s);
      if (Math.cos(boat.angle) < 0) ctx.scale(-1, 1);
      ctx.drawImage(boatImg, -60, -80);
      ctx.restore();
    },
    // the boat sprite's box relative to boat.x/y (it is drawn at −60, −80 at island scale)
    boatBox() { const bi = img('data/gfx/ui/map_select_seastuff.png'); return bi ? { x: -60, y: -80, w: bi.width, h: bi.height } : null; },
    starIcon(ctx) { const star = img('data/gfx/ui/small_display_star.png'); if (star) ctx.drawImage(star, 16, 10, 44, 42); },
    // the island's name: top-right of the screen on its own page, or centred above it when hovered at sea
    islandTitle(ctx, isl, x, y, align) {
      const t = img(`data/gfx/ui/island_text_${isl.id}.png`); if (!t) return;
      ctx.drawImage(t, align === 'right' ? x - t.width : x - t.width / 2, y);
    },
  };
}

export function createMapScreen({ map, assets, renderer, art = null, progress, playable, onPlay, play, isTouch = () => false, storageKey = STORAGE_KEY, hintFiles = DEMO_HINT_FILES }) {
  const ctx = renderer.ctx;
  art ||= createSpriteArt({ assets, renderer });
  const font = art.font;
  const save = () => saveProgress(progress, storageKey);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const seaFit = () => {
    const w = map.world, M = 180, left = art.inset || 0;                       // the notebook keeps its margin clear
    const scale = Math.min((SCREEN_W - left) / (w.maxX - w.minX + 2 * M), SCREEN_H / (w.maxY - w.minY + 2 * M));
    return { scale, cx: (w.minX + w.maxX) / 2 - left / 2 / scale, cy: (w.minY + w.maxY) / 2 };
  };
  const islandView = (isl) => ({ scale: 1, cx: (isl.bbox.minX + isl.bbox.maxX) / 2, cy: (isl.bbox.minY + isl.bbox.maxY) / 2 });

  const view = { ...seaFit() };
  let tween = null;                                   // { from, to, t0 }
  let mode = 'sea';                                   // 'sea' | 'island' | 'sailing'
  let islandId = progress.island || map.islands[0]?.id || 1;
  if (!map.islands.some((i) => i.id === islandId)) islandId = map.islands[0]?.id || 1;
  let hover = null;                                   // { kind: 'island' | 'level', ... }
  let pointer = null;                                 // last pointer px on canvas
  let drag = null;
  let message = '', messageUntil = 0;
  let hint = null;                                    // { id, text } — active tutorial caption
  const boat = { x: 0, y: 0, angle: 0, path: null, dist: 0, len: 0, onArrive: null };

  // ---- tutorial hints -----------------------------------------------------------------------------
  function refreshHints() {
    if (!progress.hints.selectLevel && !progress.solved[hintFiles.first]) { hint = { id: 'selectLevel', text: HINTS.selectLevel }; return; }
    if (progress.solved[hintFiles.boat] && !progress.hints.boat) { if (hint?.id !== 'selectIsland') hint = { id: 'clickBoat', text: HINTS.clickBoat }; return; }
    hint = null;
  }
  function hintEvent(ev) {                            // 'play' | 'sea' | 'island'
    if (!hint) return;
    if (ev === 'play' && hint.id === 'selectLevel') { progress.hints.selectLevel = true; hint = null; save(); }
    else if (ev === 'sea' && hint.id === 'clickBoat') hint = { id: 'selectIsland', text: HINTS.selectIsland };
    else if (ev === 'island' && hint.id === 'selectIsland') { progress.hints.boat = true; hint = null; save(); }
  }
  refreshHints();

  const dock = dockOf(map, islandId);
  if (dock) { boat.x = dock.x; boat.y = dock.y; }

  const toScreen = (x, y) => [(x - view.cx) * view.scale + SCREEN_W / 2, (y - view.cy) * view.scale + SCREEN_H / 2];
  const toWorld = (px, py) => [(px - SCREEN_W / 2) / view.scale + view.cx, (py - SCREEN_H / 2) / view.scale + view.cy];
  const flash = (m, ms = 2200) => { message = m; messageUntil = performance.now() + ms; };

  function startTween(to) { tween = { from: { ...view }, to, t0: performance.now() }; }
  function clampIsland() {
    const isl = map.islands.find((i) => i.id === islandId);
    if (!isl || mode !== 'island' || tween) return;
    const M = 160;
    const halfW = SCREEN_W / 2 / view.scale, halfH = SCREEN_H / 2 / view.scale;
    const minX = isl.bbox.minX - M + halfW, maxX = isl.bbox.maxX + M - halfW;
    const minY = isl.bbox.minY - M + halfH, maxY = isl.bbox.maxY + M - halfH;
    view.cx = minX > maxX ? (minX + maxX) / 2 : Math.max(minX, Math.min(maxX, view.cx));
    view.cy = minY > maxY ? (minY + maxY) / 2 : Math.max(minY, Math.min(maxY, view.cy));
  }

  // ---- navigation ---------------------------------------------------------------------------------
  function goToIsland(id) {
    const isl = map.islands.find((i) => i.id === id);
    if (!isl) return;
    if (!islandUnlocked(map, progress, id)) { flash(`you need ${isl.starsNeeded} stars to enter this island (you have ${starsOf(progress)})`); return; }
    hintEvent('island');
    if (id === islandId || mode === 'sailing') { zoomIn(id); return; }
    const path = routeBetween(map, islandId, id);
    const target = dockOf(map, id);
    const pts = path.length ? path.slice() : [[boat.x, boat.y]];
    if (target) pts.push([target.x, target.y]);
    boat.path = pts; boat.len = pathLength(pts); boat.dist = 0;
    mode = 'sailing';
    boat.onArrive = () => { islandId = id; progress.island = id; save(); zoomIn(id); };
  }
  function zoomIn(id) {
    const isl = map.islands.find((i) => i.id === id);
    islandId = id; progress.island = id; save();
    mode = 'island';
    startTween(islandView(isl));
  }
  function zoomOut() { mode = 'sea'; hover = null; startTween(seaFit()); hintEvent('sea'); }
  function skipSailing() {
    if (mode !== 'sailing' || !boat.path) return;
    const [x, y, a] = pointAlong(boat.path, boat.len); boat.x = x; boat.y = y; boat.angle = a;
    const cb = boat.onArrive; boat.path = null; boat.onArrive = null; cb && cb();
  }

  // ---- hit testing ----------------------------------------------------------------------------------
  function islandAt(px, py) {
    const [wx, wy] = toWorld(px, py);
    const pad = 80;
    return map.islands.find((i) => i.bbox && wx >= i.bbox.minX - pad && wx <= i.bbox.maxX + pad && wy >= i.bbox.minY - pad && wy <= i.bbox.maxY + pad) || null;
  }
  function levelAt(px, py) {
    const [wx, wy] = toWorld(px, py);
    let best = null, bd = 60;
    for (const l of map.levels) {
      if (l.type !== LEVEL_TYPE.LEVEL || l.island !== islandId) continue;
      const [cx, cy] = markerCentre(l);
      const d = Math.hypot(cx - wx, cy - wy);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }
  // the boat's box (drawn at island scale around boat.x/y); clicking it sails away
  function boatAt(px, py) {
    const bb = art.boatBox(); if (!bb) return false;
    const [wx, wy] = toWorld(px, py);
    return wx >= boat.x + bb.x && wx <= boat.x + bb.x + bb.w && wy >= boat.y + bb.y && wy <= boat.y + bb.y + bb.h;
  }

  // ---- input ------------------------------------------------------------------------------------------
  function pointerDown(px, py, button, dragOnly = false) {
    if (dragOnly) { if (mode === 'island' && !tween) drag = { px, py, cx: view.cx, cy: view.cy }; return; }   // a finger that moved: pan, never select
    if (button !== 0) { if (mode === 'island') zoomOut(); return; }
    if (mode === 'sailing') { skipSailing(); return; }
    if (tween) return;
    if (mode === 'sea') { const isl = islandAt(px, py); if (isl) { play('menu_click.wav', 0.5); goToIsland(isl.id); } return; }
    if (boatAt(px, py)) { play('menu_click.wav', 0.5); zoomOut(); return; }
    const lvl = levelAt(px, py);
    if (lvl) {
      if (!playable.has(lvl.file)) { flash('this level is only in the full game'); return; }
      if (!reachable(map, progress, lvl)) { flash('solve a neighbouring level first'); return; }
      play('menu_click.wav', 0.5);
      hintEvent('play');
      onPlay(lvl);
      return;
    }
    drag = { px, py, cx: view.cx, cy: view.cy };
  }
  function pointerMove(px, py) {
    pointer = [px, py];
    if (drag) { view.cx = drag.cx - (px - drag.px) / view.scale; view.cy = drag.cy - (py - drag.py) / view.scale; clampIsland(); return; }
    if (mode === 'sea') { const isl = islandAt(px, py); hover = isl ? { kind: 'island', island: isl } : null; }
    else if (mode === 'island') { if (boatAt(px, py)) hover = { kind: 'boat' }; else { const l = levelAt(px, py); hover = l ? { kind: 'level', level: l } : null; } }
    else hover = null;
  }
  function pointerUp() { drag = null; }
  // touch: holding a solved pedestal toggles its "awesome" mark (the A key on a keyboard)
  function longPress(px, py) {
    if (mode !== 'island') return false;
    const l = levelAt(px, py);
    if (!l) return false;
    const r = toggleAwesome(l.file);
    flash(r ? (r.awesome ? `${l.name}: marked awesome ★` : `${l.name}: awesome mark removed`) : 'solve it first, then mark it awesome');
    drag = null;
    return true;
  }
  function key(k) {
    if (k === 'Escape' || k === 'Backspace') { if (mode === 'island') zoomOut(); else if (mode === 'sailing') skipSailing(); return true; }
    if ((k === 'a' || k === 'A') && mode === 'island' && hover?.kind === 'level') {        // the "awesome" mark, from the map
      const r = toggleAwesome(hover.level.file);
      flash(r ? (r.awesome ? `${hover.level.name}: marked awesome ★` : `${hover.level.name}: awesome mark removed`) : 'solve it first, then mark it awesome');
      return true;
    }
    return false;
  }
  function leave() { pointer = null; hover = null; drag = null; }

  // ---- update ------------------------------------------------------------------------------------------
  function update(dt, now) {
    if (tween) {
      const t = Math.min(1, (now - tween.t0) / ZOOM_MS), e = ease(t);
      view.scale = tween.from.scale + (tween.to.scale - tween.from.scale) * e;
      view.cx = tween.from.cx + (tween.to.cx - tween.from.cx) * e;
      view.cy = tween.from.cy + (tween.to.cy - tween.from.cy) * e;
      if (t >= 1) tween = null;
    }
    if (mode === 'sailing' && boat.path) {
      boat.dist = Math.min(boat.len, boat.dist + BOAT_SPEED * dt);
      const [x, y, a] = pointAlong(boat.path, boat.dist); boat.x = x; boat.y = y; boat.angle = a;
      if (boat.dist >= boat.len) { const cb = boat.onArrive; boat.path = null; boat.onArrive = null; cb && cb(); }
    }
    if (mode === 'island' && !tween && !drag && pointer) {       // mouse-near-edge scrolling, like the original
      const [px, py] = pointer;
      let vx = 0, vy = 0;
      if (px < EDGE) vx = -(1 - px / EDGE); else if (px > SCREEN_W - EDGE) vx = 1 - (SCREEN_W - px) / EDGE;
      if (py < EDGE) vy = -(1 - py / EDGE); else if (py > SCREEN_H - EDGE) vy = 1 - (SCREEN_H - py) / EDGE;
      if (vx || vy) { view.cx += vx * EDGE_SPEED * dt * 60; view.cy += vy * EDGE_SPEED * dt * 60; clampIsland(); }
    }
    if (message && now > messageUntil) message = '';
  }

  // ---- render ------------------------------------------------------------------------------------------
  function render(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    art.background(ctx, view, now);

    ctx.save();
    ctx.translate(SCREEN_W / 2, SCREEN_H / 2); ctx.scale(view.scale, view.scale); ctx.translate(-view.cx, -view.cy);

    // sea routes (dashed crayon). Routes between unlocked islands are solid, the rest faint.
    for (const [key, pts] of map.routes) {
      const [a, b] = key.split('-').map(Number);
      if (a > b) continue;
      const open = islandUnlocked(map, progress, a) && islandUnlocked(map, progress, b);
      if (!open && mode === 'island') continue;
      art.route(ctx, key, pts, open, view.scale);
    }

    // islands
    for (const isl of map.islands) {
      const locked = !islandUnlocked(map, progress, isl.id);
      art.island(ctx, isl, { locked, hot: hover?.kind === 'island' && hover.island === isl && mode === 'sea', scale: view.scale, now });
    }

    // paths between connected level spots (dashed crayon, hand-wobbled), revealed per island
    for (const [a, b] of map.connections) {
      const A = map.byId.get(a), B = map.byId.get(b);
      if (!A || !B || A.island !== B.island || !islandUnlocked(map, progress, A.island)) continue;
      if (A.type === LEVEL_TYPE.SEA || B.type === LEVEL_TYPE.SEA) continue;
      const lit = [A, B].some((l) => l.type === LEVEL_TYPE.DOCK || progress.solved[l.file] || reachable(map, progress, l));
      art.path(ctx, pathStrokes(a, b, A, B), lit);
    }

    // level markers
    for (const l of map.levels) {
      if (l.type !== LEVEL_TYPE.LEVEL) continue;
      if (mode === 'sea' && !islandUnlocked(map, progress, l.island)) continue;
      art.marker(ctx, l, { stars: progress.solved[l.file] || 0, can: reachable(map, progress, l) && playable.has(l.file), hot: hover?.kind === 'level' && hover.level === l, playable: playable.has(l.file), now });
      if (progress.current === l.file) { const [cx, cy] = markerCentre(l); art.ball(ctx, cx, cy, now); }
    }

    // island locks (star count) in the sea view
    if (mode !== 'island') {
      for (const isl of map.islands) {
        if (!isl.bbox || islandUnlocked(map, progress, isl.id)) continue;
        art.lock(ctx, isl, (isl.bbox.minX + isl.bbox.maxX) / 2, (isl.bbox.minY + isl.bbox.maxY) / 2, view.scale);
      }
    }

    // boat
    art.boat(ctx, boat, mode === 'island' ? 1 : Math.min(1 / view.scale, 3.2), now);
    ctx.restore();

    // ---- HUD (screen space) ----
    art.starIcon(ctx, now);
    ctx.fillStyle = art.text; ctx.font = `28px ${font}`; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText(`${starsOf(progress)}`, 66, 14);
    if (mode === 'island') { const isl = map.islands.find((i) => i.id === islandId); if (isl) art.islandTitle(ctx, isl, SCREEN_W - 16, 10, 'right'); }
    if (hint) {                                      // tutorial caption (text_*.xml: centred, y≈700, pulsing)
      ctx.textAlign = 'center'; ctx.font = `bold 30px ${font}`; ctx.fillStyle = `rgba(40,40,40,${0.6 + 0.4 * (0.5 + 0.5 * Math.sin(now / 320))})`;
      ctx.fillText(hint.text, SCREEN_W / 2, SCREEN_H - 68);
    } else {
      ctx.font = `16px ${font}`; ctx.fillStyle = art.textSoft; ctx.textAlign = 'right';
      const help = isTouch()
        ? { sea: 'tap an island · the boat will take you there', island: 'tap a level · hold a solved one to mark it awesome · tap the boat for the sea', sailing: 'tap to skip the trip' }
        : { sea: 'click an island · the boat will take you there', island: 'click a level · A marks a solved one awesome · click the boat or Esc for the sea', sailing: 'click to skip the trip' };
      ctx.fillText(help[mode] || '', SCREEN_W - 18, SCREEN_H - 30);
    }
    if (hover?.kind === 'island' && mode === 'sea') {
      const [sx, sy] = toScreen((hover.island.bbox.minX + hover.island.bbox.maxX) / 2, hover.island.bbox.minY);
      art.islandTitle(ctx, hover.island, sx, sy - 70, 'center');
    }
    if (hover?.kind === 'level' && mode === 'island') {
      const [cx, cy] = markerCentre(hover.level);
      const [sx, sy] = toScreen(cx, cy);
      ctx.textAlign = 'center'; ctx.font = `22px ${font}`; ctx.fillStyle = art.label;
      ctx.fillText(playable.has(hover.level.file) ? hover.level.name : `${hover.level.name} (full game)`, sx, sy + 50);
      const n = progress.solved[hover.level.file] || 0;
      if (n) {
        const m = marksOf(progress, hover.level.file);
        ctx.font = `18px ${font}`; ctx.fillStyle = art.textSoft;
        ctx.fillText(`${'★'.repeat(n)}${'☆'.repeat(3 - n)}  ${['solved', m.elegant && 'elegant', m.awesome && 'awesome'].filter(Boolean).join(' · ')}`, sx, sy + 74);
      }
    }
    if (hover?.kind === 'boat' && mode === 'island') {
      const [sx, sy] = toScreen(boat.x, boat.y);
      ctx.textAlign = 'center'; ctx.font = `22px ${font}`; ctx.fillStyle = art.label;
      ctx.fillText('set sail', sx, sy + 24);
    }
    if (message) { ctx.textAlign = 'center'; ctx.font = `22px ${font}`; ctx.fillStyle = art.label; ctx.fillText(message, SCREEN_W / 2, SCREEN_H - (hint ? 108 : 70)); }
  }

  const pathCache = new Map();
  function pathStrokes(a, b, A, B) {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    let st = pathCache.get(key);
    if (st) return st;
    const [x0, y0] = markerCentre(A), [x1, y1] = markerCentre(B);
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.round(len / 12));
    const nx = -(y1 - y0) / (len || 1), ny = (x1 - x0) / (len || 1);
    const seedA = (a * 7919 + b * 104729) % 1000 / 1000;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, wob = Math.sin(t * Math.PI * (2 + seedA * 2) + seedA * 6) * 9 * Math.sin(t * Math.PI);
      pts.push([x0 + (x1 - x0) * t + nx * wob, y0 + (y1 - y0) * t + ny * wob + 22]);   // +22: start at the pedestal's base, not its star
    }
    st = [{ color: 'rgb(96,84,70)', points: pts, key }];
    pathCache.set(key, st);
    return st;
  }

  // called by main when a level was solved: record the stars, move the ball marker, show the island
  function solved(levelFile, { elegant = false } = {}) {
    const r = solveLevel(progress, levelFile, { elegant });
    progress.current = levelFile;
    const isl = map.levels.find((l) => l.file === levelFile)?.island;
    if (isl) { islandId = isl; progress.island = isl; }
    save();
    return r;
  }
  function toggleAwesome(levelFile) {
    const r = toggleAwesomeMark(progress, levelFile);
    if (r) save();
    return r;
  }
  function show(levelFile) {
    const l = map.levels.find((x) => x.file === levelFile);
    if (l) { progress.current = levelFile; islandId = l.island; progress.island = l.island; save(); }
    const isl = map.islands.find((i) => i.id === islandId);
    mode = 'island'; Object.assign(view, islandView(isl)); tween = null;
    if (l) centerOn(l);
    refreshHints();
  }
  // scroll the island view so a marker is on screen (clamped to the island)
  function centerOn(level) {
    if (mode !== 'island') return;
    view.cx = level.x + MARKER.w / 2; view.cy = level.y + MARKER.h / 2; tween = null; clampIsland();
  }
  const screenOf = (x, y) => toScreen(x, y);

  return { update, render, pointerDown, pointerMove, pointerUp, longPress, key, leave, solved, toggleAwesome, show, centerOn, screenOf, goToIsland, zoomOut, get mode() { return mode; }, get islandId() { return islandId; }, get view() { return view; }, get hint() { return hint; }, boat };
}
