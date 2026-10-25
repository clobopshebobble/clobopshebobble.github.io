// main.js — load the demo's data, run two screens: the overworld map (map.js) and the Box2D level
// player (world.js + render.js). Assets live in deluxe/assets/data (gitignored, personal copy of
// the free demo; see tools/fetch-deluxe-demo.sh). If they are missing we say so.
import { parseLevel, parseLevelList, toWorld, SCREEN_W, SCREEN_H } from './level.js';
import { createGame, STEP } from './world.js';
import { createRenderer, WIN_BANNER } from './render.js';
import { createNotebookRenderer, createNotebookSfx, TOOLBAR_ICONS, HUD_BUTTONS } from './notebook.js';
import { createTapGate } from './taps.js';
import { createNotebookMapArt } from './notebookmap.js';
import { assembleMap, assembleOwnMap, MAP_FILES, LEVEL_TYPE } from './mapdata.js';
import { createMapScreen, loadProgress } from './map.js';

const ASSETS = 'assets/';
// ?theme=notebook — the Messy Notebook look (notebook.js): our own generated art and sounds, only our
// own levels (deluxe/levels/index.json), nothing fetched from the demo's assets at all.
const THEME = new URLSearchParams(location.search).get('theme') === 'notebook' || document.documentElement.dataset.theme === 'notebook' ? 'notebook' : 'deluxe';   // the public build sets <html data-theme>
const PALETTE = ['rgb(55,68,223)', 'rgb(221,107,23)', 'rgb(102,162,26)']; // data/gfx/game_colors.xml
const MIN_STROKE_PX = 6;
const BACK_TO_MAP_DELAY = 2000;      // waitBeforeLoadingNextLevel
const INTRO_MS = 2000;               // drawingAnimationDuration: the level art draws itself in
const AFTER_MARK_DELAY = 700;        // after ticking "awesome", linger this long before the map
const LONG_PRESS_MS = 450;           // touch: hold = erase (or roll the ball left); the phone has no right button
const LONG_PRESS_SLOP = 10;          // px of movement that turns a hold back into a stroke
const TOUCH_BANNER_MAX = 8000;       // touch: the win banner waits for a tap, at most this long

const planck = globalThis.planck;
const earcut = globalThis.earcut;

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
canvas.width = SCREEN_W; canvas.height = SCREEN_H;

const state = {
  mode: 'map',                        // 'map' | 'play'
  levels: [], byFile: new Map(), index: 0, level: null, game: null,
  live: null, drawing: false, pointerId: null, color: 0,
  won: false, wonAt: 0, debug: false, muted: false, message: '', messageUntil: 0,
  acc: 0, last: performance.now(),
  mapScreen: null, progress: null,
  run: null,                          // this attempt: { kicked, pinned, underBall } → Elegant Solution
  stars: null,                        // the star record shown on the win banner
  introAt: 0, introMs: INTRO_MS,      // level intro: art draws in, physics waits (click skips)
  pointer: null,                      // last pointer px in play mode (hovering the banner holds it)
  touch: false,                       // a finger, not a mouse: toolbar, long-press, tap-to-dismiss
  eraser: false, erasing: false,      // touch eraser mode (toolbar 🧽): strokes erase instead of draw
  rope: false,                        // rope mode (R / toolbar 🪢): the next strokes are ropes
  wonTap: false,                      // touch: the banner was tapped away
  frozen: new URLSearchParams(location.search).get('freeze') === '1',   // tests: physics waits until __crayon.frozen = false
};
let press = null;                     // pending long-press { px, py, id, timer }
let pressFired = false;               // the hold happened: the lift-off must not count as a tap
let mapTap = null;                    // touch on the map: { px, py, dragging } — select on lift-off, pan on move
let ballTap = false;                  // touch on the ball: roll right on lift-off unless it became a hold
try { state.touch = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).get('touch') === '1'; } catch { /* ignore */ }
if (state.touch) document.body.classList.add('touch');
const introFrac = (now = performance.now()) => (state.introMs <= 0 ? 1 : Math.min(1, (now - state.introAt) / state.introMs));
const inRect = (p, r) => !!p && p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
function noteTouch(e) { if (e.pointerType === 'touch' && !state.touch) { state.touch = true; document.body.classList.add('touch'); } }

function say(html) { overlay.innerHTML = html; overlay.style.display = html ? 'grid' : 'none'; }
function flash(msg, ms = 1800) { state.message = msg; state.messageUntil = performance.now() + ms; }

async function fetchText(path) { const r = await fetch(ASSETS + path); if (!r.ok) throw new Error(`${r.status} ${path}`); return r.text(); }
function loadImage(path) {
  return new Promise((res) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => res(null); img.src = ASSETS + path; });
}

// ---- audio ----------------------------------------------------------------------------------------
// Sound effects go through Web Audio: one AudioContext, unlocked by the first tap, then any number of
// hits can play at any time. (iPhone Safari blocks <audio> elements that were not themselves started
// by a tap, which silenced the hit sounds.) Falls back to <audio> where there is no AudioContext.
const SFX = ['hit_002.wav', 'hit_003.wav', 'hit_004.wav', 'hit_005.wav', 'hit_006.wav', 'hit_007.wav', 'star_pick.wav', 'menu_click.wav'];
const sfx = { ctx: null, buffers: new Map(), els: new Map(), synth: null };
const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
if (AC && THEME === 'notebook') { sfx.ctx = new AC(); sfx.synth = createNotebookSfx(sfx.ctx); }   // sounds are synthesised, no files
else if (AC) {
  sfx.ctx = new AC();
  for (const name of SFX) fetch(`${ASSETS}data/sfx/${name}`).then((r) => r.arrayBuffer()).then((b) => sfx.ctx.decodeAudioData(b)).then((buf) => sfx.buffers.set(name, buf)).catch(() => { /* missing: silent */ });
} else {
  for (const name of SFX) { const a = new Audio(`${ASSETS}data/sfx/${name}`); a.preload = 'auto'; sfx.els.set(name, a); }
}
function unlockAudio() { if (sfx.ctx && sfx.ctx.state === 'suspended') sfx.ctx.resume().catch(() => {}); }
const tapGate = createTapGate();                 // one tap per fresh knock; a rattling stuck ball stays quiet (deluxe/src/taps.js)
function play(name, vol = 1) {
  if (state.muted) return;
  if (sfx.synth) { sfx.synth.play(name, vol); return; }
  if (sfx.ctx) {
    const buf = sfx.buffers.get(name);
    if (!buf || sfx.ctx.state !== 'running') return;
    const src = sfx.ctx.createBufferSource(); const gain = sfx.ctx.createGain();
    src.buffer = buf; gain.gain.value = vol; src.connect(gain).connect(sfx.ctx.destination); src.start();
    return;
  }
  const a = sfx.els.get(name); if (!a) return;
  const c = a.cloneNode(); c.volume = vol; c.play().catch(() => {});
}
// Music: the demo's playlist (autoexec.txt) — crayon07, _ghost's Lullaby (CC BY-NC, personal play
// is non-commercial), crayon_dreams — on by default, starts on the first tap because browsers
// require a gesture. B toggles it (remembered), M mutes everything. One <audio> element is reused
// for every track: once a tap has started it, iPhone Safari lets it move on to the next song.
// The demo ships OGG Vorbis; iPhone Safari cannot play it, so tools/fetch-deluxe-demo.sh also writes
// AAC copies (.m4a) and we pick whichever this browser can decode.
const PLAYLIST = ['crayon07', '_ghost_-_lullaby', 'crayon_dreams'];
const MUSIC_EXT = (() => { try { return new Audio().canPlayType('audio/ogg; codecs=vorbis') ? '.ogg' : '.m4a'; } catch { return '.ogg'; } })();
const music = { el: null, playing: false, idx: 0, enabled: true, ext: MUSIC_EXT };
try { music.enabled = localStorage.getItem('crayon-deluxe-music') !== 'off'; } catch { /* ignore */ }
function startMusic() {
  unlockAudio();
  if (!music.enabled || music.playing || state.muted) return;
  if (sfx.synth) { if (sfx.synth.startMusic()) music.playing = true; return; }   // the notebook's own music-box tune, synthesised
  if (!music.el) {
    music.el = new Audio(); music.el.volume = 0.45; music.el.preload = 'auto';
    music.el.addEventListener('ended', () => { music.playing = false; music.idx++; startMusic(); });
  }
  const src = `${ASSETS}data/sfx/${PLAYLIST[music.idx % PLAYLIST.length]}${music.ext}`;
  if (!music.el.src.endsWith(src)) music.el.src = src;
  music.el.play().then(() => { music.playing = true; }).catch(() => { /* no gesture yet; retried on the next tap */ });
}
function stopMusic() { if (sfx.synth) { sfx.synth.stopMusic(); music.playing = false; return; } if (music.el && music.playing) { music.el.pause(); music.playing = false; } }
function toggleMusic() {
  music.enabled = !music.enabled;
  try { localStorage.setItem('crayon-deluxe-music', music.enabled ? 'on' : 'off'); } catch { /* ignore */ }
  if (music.enabled) { startMusic(); flash('music on'); } else { stopMusic(); flash('music off'); }
}
function toggleMute() { state.muted = !state.muted; if (state.muted) stopMusic(); else startMusic(); flash(state.muted ? 'muted' : 'sound on'); syncToolbar(); }
window.addEventListener('pointerdown', startMusic, { capture: true });
window.addEventListener('keydown', startMusic, { capture: true });

// ---- touch toolbar (index.html #toolbar; shown via body.touch) ----------------------------------
const tb = Object.fromEntries(['map', 'reset', 'eraser', 'rope', 'awesome', 'sea', 'sound'].map((k) => [k, document.getElementById(`tb-${k}`)]));
function syncToolbar() {
  document.body.dataset.mode = state.mode === 'map' ? 'map' : state.won ? 'won' : 'play';
  if (tb.eraser) tb.eraser.setAttribute('aria-pressed', String(state.eraser));
  if (tb.rope) tb.rope.setAttribute('aria-pressed', String(state.rope));
  if (tb.sound) { if (THEME === 'notebook') tb.sound.innerHTML = state.muted ? TOOLBAR_ICONS.muted : TOOLBAR_ICONS.sound; else tb.sound.textContent = state.muted ? '🔇' : '🔊'; }
  if (tb.awesome) tb.awesome.setAttribute('aria-pressed', String(!!state.stars?.awesome));
}
function setEraser(on) { state.eraser = on; state.erasing = false; if (on) state.rope = false; flash(on ? 'eraser: rub out what you drew' : 'crayon'); syncToolbar(); }
function setRope(on) { state.rope = on; if (on) state.eraser = false; flash(on ? 'rope: draw from one thing to another' : 'crayon'); syncToolbar(); }
tb.map?.addEventListener('click', () => { if (state.mode === 'play') backToMap(); });
tb.reset?.addEventListener('click', () => { if (state.mode === 'play') { setEraser(false); setRope(false); reset(); } });
tb.eraser?.addEventListener('click', () => setEraser(!state.eraser));
tb.rope?.addEventListener('click', () => setRope(!state.rope));
tb.awesome?.addEventListener('click', () => toggleAwesome());
tb.sea?.addEventListener('click', () => { if (state.mode === 'map') state.mapScreen?.key('Escape'); });
tb.sound?.addEventListener('click', () => toggleMute());

// ---- level flow ---------------------------------------------------------------------------------
function loadLevel(i) {
  state.index = (i + state.levels.length) % state.levels.length;
  state.level = state.levels[state.index].level;
  state.game = createGame(planck, earcut, state.level);
  state.won = false; state.live = null; state.drawing = false; state.stars = null;
  state.run = { kicked: false, pinned: false, underBall: false };
  state.introAt = performance.now(); state.acc = 0;
  state.wonTap = false; state.erasing = false;
  state.mode = 'play';
  syncToolbar();
  const bg = state.level.background.image;
  if (THEME !== 'notebook' && bg && !assets.images.has(bg)) loadImage(bg).then((img) => img && assets.images.set(bg, img));
}
function playFile(file) {
  const i = state.levels.findIndex((l) => l.file === file);
  if (i < 0) { flash(THEME === 'notebook' ? 'that page is missing' : 'that level is not in the demo'); return; }
  if (state.mapScreen) { state.progress.current = file; }
  loadLevel(i);
}
function reset() { loadLevel(state.index); play('menu_click.wav', 0.5); }
function backToMap() {
  state.mode = 'map';
  state.live = null; state.drawing = false; state.won = false; state.stars = null; state.eraser = false; state.rope = false;
  if (state.mapScreen) state.mapScreen.show(state.levels[state.index].file);
  syncToolbar();
}
// the player's own "awesome" mark on the level just won (banner checkbox or the A key)
function toggleAwesome() {
  if (!state.won || !state.mapScreen) return;
  const r = state.mapScreen.toggleAwesome(state.levels[state.index].file);
  if (!r) return;
  state.stars = { ...state.stars, ...r };
  play(r.awesome ? 'star_pick.wav' : 'menu_click.wav', 0.6);
  state.wonAt = Math.max(state.wonAt, performance.now() - BACK_TO_MAP_DELAY + AFTER_MARK_DELAY);
  syncToolbar();
}

// ---- touch: long-press = the missing right button ------------------------------------------------
function armPress(e, px, py) {
  clearPress(); pressFired = false;
  press = { px, py, id: e.pointerId, timer: setTimeout(() => { press = null; pressFired = true; longPress(px, py); }, LONG_PRESS_MS) };
}
function clearPress() { if (press) { clearTimeout(press.timer); press = null; } }
function kickBall(dir) {
  if (state.game.kick(dir, performance.now())) { state.run.kicked = true; play('menu_click.wav', 0.3); } else flash('ball is catching its breath');
}
function longPress(px, py) {
  if (state.mode === 'map') { state.mapScreen?.longPress(px, py); return; }
  if (!state.game || state.won) return;
  if (state.drawing) {                                        // the stroke that was starting is a hold instead
    state.drawing = false; state.live = null;
    try { canvas.releasePointerCapture(state.pointerId); } catch { /* ignore */ }
  }
  const [wx, wy] = toWorld(px, py);
  if (state.game.isBallAt(wx, wy)) { kickBall(-1); return; }
  if (state.game.eraseAt(wx, wy)) { play('menu_click.wav', 0.4); flash('erased'); }
}

// ---- input ----------------------------------------------------------------------------------------
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * SCREEN_W, ((e.clientY - r.top) / r.height) * SCREEN_H];
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  noteTouch(e);
  const [px, py] = canvasPoint(e);
  const finger = state.touch || e.pointerType === 'touch';
  if (state.mode === 'map') {
    // a finger selects on lift-off (so a hold can mean "mark awesome" and a move can mean "pan"); a mouse selects at once
    if (finger && e.button === 0) { mapTap = { px, py, dragging: false }; armPress(e, px, py); return; }
    state.mapScreen?.pointerDown(px, py, e.button); return;
  }
  if (!state.game) return;
  state.pointer = [px, py];
  if (THEME === 'notebook' && !state.touch && e.button === 0) {                 // the page's own restart / sound scraps
    if (inRect([px, py], HUD_BUTTONS.reset)) { setEraser(false); setRope(false); reset(); return; }
    if (inRect([px, py], HUD_BUTTONS.sound)) { toggleMute(); return; }
  }
  if (state.won) {
    if (e.button === 0 && inRect([px, py], WIN_BANNER.awesome)) toggleAwesome();
    else if (!inRect([px, py], WIN_BANNER)) state.wonTap = true;           // touch: a tap elsewhere closes the banner
    return;
  }
  const now = performance.now();
  if (introFrac(now) < 1) { state.introAt = now - state.introMs; return; }   // a click skips the draw-in
  const [wx, wy] = toWorld(px, py);
  if (e.button === 2) {                                           // right button: kick left / erase
    if (state.game.isBallAt(wx, wy)) { kickBall(-1); return; }
    if (state.game.eraseAt(wx, wy)) play('menu_click.wav', 0.4);
    return;
  }
  if (e.button !== 0) return;
  if (state.eraser) {                                             // touch eraser mode: rub things out
    state.erasing = true; state.pointerId = e.pointerId; canvas.setPointerCapture(e.pointerId);
    if (state.game.eraseAt(wx, wy)) play('menu_click.wav', 0.4);
    return;
  }
  if (state.game.isBallAt(wx, wy)) {                              // click the ball: roll right. A finger: on lift-off, unless it held (→ left)
    if (finger) { ballTap = true; armPress(e, px, py); } else kickBall(1);
    return;
  }
  state.drawing = true; state.pointerId = e.pointerId;
  state.live = { color: PALETTE[state.color % PALETTE.length], rope: state.rope, points: [[px, py]], world: [[wx, wy]] };
  canvas.setPointerCapture(e.pointerId);
  if (finger) armPress(e, px, py);
});
canvas.addEventListener('pointermove', (e) => {
  const [px, py] = canvasPoint(e);
  if (press && Math.hypot(px - press.px, py - press.py) > LONG_PRESS_SLOP) {
    clearPress();
    if (mapTap && !mapTap.dragging) { mapTap.dragging = true; state.mapScreen?.pointerDown(mapTap.px, mapTap.py, 0, true); }
  }
  if (state.mode === 'map') { state.mapScreen?.pointerMove(px, py); return; }
  state.pointer = [px, py];
  if (state.erasing && e.pointerId === state.pointerId) { const [wx, wy] = toWorld(px, py); if (state.game?.eraseAt(wx, wy)) play('menu_click.wav', 0.3); return; }
  if (!state.drawing || e.pointerId !== state.pointerId) return;
  const last = state.live.points[state.live.points.length - 1];
  if (Math.hypot(px - last[0], py - last[1]) < 2) return;
  state.live.points.push([px, py]); state.live.world.push(toWorld(px, py));
});
canvas.addEventListener('pointerleave', () => { if (state.mode === 'map') state.mapScreen?.leave(); else state.pointer = null; });
function finishStroke(e) {
  const held = pressFired; clearPress(); pressFired = false;
  if (state.mode === 'map') {
    if (mapTap) { const t = mapTap; mapTap = null; if (!t.dragging && !held) state.mapScreen?.pointerDown(t.px, t.py, 0); }
    if (state.mode === 'map') { state.mapScreen?.pointerUp(); if (e.pointerType === 'touch') state.mapScreen?.leave(); }
    return;
  }
  if (ballTap) { ballTap = false; if (!held && state.game && !state.won) kickBall(1); return; }
  if (state.erasing) { state.erasing = false; return; }
  if (e.pointerType === 'touch') state.pointer = null;            // a finger lifts off: nothing is "hovering"
  if (!state.drawing || e.pointerId !== state.pointerId) return;
  state.drawing = false;
  const live = state.live; state.live = null;
  if (!live || live.points.length < 2) return;
  const bb = live.points.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
  if (Math.max(bb[2] - bb[0], bb[3] - bb[1]) < MIN_STROKE_PX) return;        // a click, not a stroke
  if (live.rope) { if (state.game.addRope(live.world)) play('menu_click.wav', 0.25); return; }
  const r = state.game.addStroke(live.world, live.color);
  if (!r) return;
  if (r.kind === 'pin') { flash('pinned'); state.run.pinned = true; } else state.color++;
  if (r.underBall) state.run.underBall = true;
  play('menu_click.wav', 0.25);
}
canvas.addEventListener('pointerup', finishStroke);
canvas.addEventListener('pointercancel', finishStroke);

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (state.mode === 'map') {
    if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
    if (e.key === 'b' || e.key === 'B') { toggleMusic(); return; }
    if (state.mapScreen?.key(e.key)) e.preventDefault();
    return;
  }
  switch (e.key) {
    case ' ': e.preventDefault(); reset(); break;
    case 'Escape': backToMap(); break;
    case 'ArrowRight': case 'n': case 'N': loadLevel(state.index + 1); break;
    case 'ArrowLeft': case 'p': case 'P': loadLevel(state.index - 1); break;
    case 'd': case 'D': state.debug = !state.debug; break;
    case 'm': case 'M': toggleMute(); break;
    case 'b': case 'B': toggleMusic(); break;
    case 'a': case 'A': toggleAwesome(); break;
    case 'r': case 'R': setRope(!state.rope); break;
    default: return;
  }
});

// ---- loop ------------------------------------------------------------------------------------------
const assets = { images: new Map(), brush: [] };
let renderer = null;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.2, (now - state.last) / 1000); state.last = now;
  if (state.mode === 'map') { state.mapScreen.update(dt, now); state.mapScreen.render(now); return; }
  if (!state.game) return;
  const intro = introFrac(now);
  if (intro < 1 || state.frozen) state.acc = 0; // the world holds still while the art draws in (or ?freeze=1: a test waits to start the clock)
  else state.acc += dt;
  while (state.acc >= STEP) {
    state.acc -= STEP;
    if (state.won) continue;
    const r = state.game.step();
    if (r === 'won') {
      state.won = true; state.wonAt = now; play('star_pick.wav');
      const file = state.levels[state.index].file;
      const elegant = !state.run.kicked && !state.run.pinned && !state.run.underBall;
      state.stars = state.mapScreen ? state.mapScreen.solved(file, { elegant }) : { stars: 1 + (elegant ? 1 : 0), elegant, newElegant: elegant, awesome: false };
      if (state.stars.newElegant) setTimeout(() => play('star_pick.wav', 0.7), 350);
      syncToolbar();
    } else if (r === 'out') { flash('the ball fell out of the world'); loadLevel(state.index); }
  }
  // back to the map after the pause — unless the pointer is resting on the banner (deciding on "awesome").
  // On touch there is no hover: the banner waits for a tap outside it (or TOUCH_BANNER_MAX).
  if (state.won) {
    const go = state.touch ? (state.wonTap || now - state.wonAt >= TOUCH_BANNER_MAX) : (now - state.wonAt >= BACK_TO_MAP_DELAY && !inRect(state.pointer, WIN_BANNER));
    if (go) { if (state.mapScreen) backToMap(); else loadLevel(state.index + 1); }
  }
  const imp = state.game.impacts, impacts = imp.length ? imp.slice() : null;
  if (imp.length) {
    const tap = tapGate.pick(imp, now); imp.length = 0;
    if (tap) play(`hit_00${2 + ((Math.random() * 6) | 0)}.wav`, tap.vol);
  }
  if (state.message && now > state.messageUntil) state.message = '';
  renderer.render(state.game, state.level, {
    now, live: state.live, won: state.won, wonAt: state.wonAt, stars: state.stars, intro, debug: state.debug, muted: state.muted, impacts,
    touch: state.touch, eraser: state.eraser, rope: state.rope, pointer: state.pointer,
    index: state.index, count: state.levels.length, name: state.levels[state.index].name, message: state.message,
  });
}

// the notebook theme: our levels only, our renderer, our own map (deluxe/levels/map.json, forged
// from the same island designs) drawn with notebookmap.js — the demo's assets are never asked for
const NOTEBOOK_PROGRESS = 'messy-notebook-progress';
async function bootNotebook() {
  say('<p>finding the notebook…</p>');
  document.title = document.documentElement.dataset.name || 'DoodleDood';   // the build writes data-name from GAME_NAME
  let list;
  try { list = await (await fetch('levels/index.json')).json(); } catch { say('<p>levels/index.json is missing — run <code>npm run forge</code>.</p>'); return; }
  const loaded = await Promise.all(list.map(async (e) => { try { const r = await fetch(`levels/${e.file}`); return r.ok ? { name: e.name, file: e.file, island: e.island, level: parseLevel(await r.text()), forged: true } : null; } catch { return null; } }));
  state.levels = loaded.filter((l) => l && l.level.ball);
  if (!state.levels.length) { say('<p>no levels found in deluxe/levels/.</p>'); return; }
  for (const l of state.levels) state.byFile.set(l.file, l);
  renderer = createNotebookRenderer(canvas);
  document.body.classList.add('notebook');
  for (const [k, el] of Object.entries(tb)) if (el && TOOLBAR_ICONS[k]) el.innerHTML = TOOLBAR_ICONS[k];   // doodled icons, not emoji
  try { await Promise.race([Promise.all([document.fonts.load('27px "Patrick Hand"'), document.fonts.load('19px "Caveat"')]), new Promise((r) => setTimeout(r, 1500))]); } catch { /* system handwriting then */ }
  try {
    const map = assembleOwnMap(await (await fetch('levels/map.json')).json());
    const pedestals = map.levels.filter((l) => l.type === LEVEL_TYPE.LEVEL);
    const firstIsland = map.islands[0]?.id, onFirst = pedestals.filter((l) => l.island === firstIsland);
    state.progress = loadProgress(NOTEBOOK_PROGRESS);
    state.mapScreen = createMapScreen({
      map, renderer, art: createNotebookMapArt(), progress: state.progress, playable: new Set(state.levels.map((l) => l.file)),
      onPlay: (lvl) => playFile(lvl.file), play, isTouch: () => state.touch, storageKey: NOTEBOOK_PROGRESS,
      hintFiles: { first: onFirst[0]?.file, boat: onFirst[onFirst.length - 1]?.file },
    });
    globalThis.__map = map;
  } catch (err) { console.warn('map unavailable (run npm run forge), falling back to the page list', err); }
  const q = new URLSearchParams(location.search);
  if (q.get('intro') === '0') state.introMs = 0;
  const want = q.get('level') || '';
  if (!state.mapScreen || q.has('level')) {
    let start = state.levels.findIndex((l) => l.file === want || l.file === `${want}.xml`);
    if (start < 0) start = Math.max(0, Math.min(state.levels.length - 1, parseInt(want, 10) || 0));
    loadLevel(start);
  } else {
    state.mode = 'map';
    if (q.has('island')) state.mapScreen.goToIsland(parseInt(q.get('island'), 10) || map.islands[0].id);
  }
  say(''); syncToolbar(); state.last = performance.now(); requestAnimationFrame(frame);
}

async function boot() {
  if (!planck || !earcut) { say('<p>planck.js / earcut did not load from the CDN. Check your connection and reload.</p>'); return; }
  if (THEME === 'notebook') return bootNotebook();
  say('<p>loading the real levels…</p>');
  let listXml;
  try { listXml = await fetchText('data/level_list.xml'); }
  catch {
    say('<p><b>Demo assets not found.</b></p><p>This player loads the real Crayon Physics Deluxe demo data from <code>deluxe/assets/data/</code>, which is not in the repo (personal use only).</p><p>Run <code>tools/fetch-deluxe-demo.sh</code> once, then reload.</p>');
    return;
  }
  const entries = parseLevelList(listXml);
  const loaded = await Promise.all(entries.map(async (e) => {
    // the demo's own file first; for the 60 pedestals the demo leaves empty, our level of the same
    // name from deluxe/levels/ (built by tools/forge, committed — ours, not Kloonigames')
    try { return { name: e.name, file: e.file, level: parseLevel(await fetchText(e.file)) }; } catch { /* not in the demo */ }
    try { const r = await fetch(`levels/${e.file.replace(/^.*\//, '')}`); if (!r.ok) return null; return { name: e.name, file: e.file, level: parseLevel(await r.text()), forged: true }; } catch { return null; }
  }));
  state.levels = loaded.filter((l) => l && l.level.ball);
  if (!state.levels.length) { say('<p>No playable levels found in the demo data.</p>'); return; }
  for (const l of state.levels) state.byFile.set(l.file, l);

  const imgs = ['data/gfx/the_ball_animated_03.png', 'data/gfx/the_ball_animated.png', 'data/gfx/collectable_04.png', 'data/gfx/game_pin_01.png',
    ...[1, 2, 3, 4, 5].map((n) => `data/gfx/pin_0${n}.png`), ...[3, 4, 5, 6].map((n) => `data/gfx/crayon_brush_0${n}.png`),
    'data/gfx/ui/paper_background.jpg', 'data/gfx/ui/map_select_empty.png', 'data/gfx/ui/map_select_filled.png', 'data/gfx/ui/map_select_unreachable.png',
    'data/gfx/ui/map_star_lock.png', 'data/gfx/ui/map_select_seastuff.png', 'data/gfx/ui/small_display_star.png',
    'data/gfx/ui/map_flag_small.png', 'data/gfx/ui/map_flag_big.png', 'data/gfx/ui/new_star_background.png', 'data/gfx/ui/solutions_checkbox.png',
    ...[1, 2, 3, 4, 5].map((n) => `data/gfx/rope_piece_0${n}.png`),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `data/gfx/ui/island_text_${n}.png`)];
  await Promise.all(imgs.map(async (p) => { const im = await loadImage(p); if (im) assets.images.set(p, im); }));
  assets.brush = [3, 4, 5, 6].map((n) => assets.images.get(`data/gfx/crayon_brush_0${n}.png`)).filter(Boolean);
  const bgs = [...new Set(state.levels.map((l) => l.level.background.image).filter(Boolean))];
  await Promise.all(bgs.map(async (p) => { const im = await loadImage(p); if (im) assets.images.set(p, im); }));

  renderer = createRenderer(canvas, assets);

  // the overworld
  say('<p>drawing the map…</p>');
  try {
    const [islandsXml, levelsXml, routesXml] = await Promise.all([fetchText(MAP_FILES.islands), fetchText(MAP_FILES.levels), fetchText(MAP_FILES.routes)]);
    const drawings = {};
    await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(async (id) => { try { drawings[id] = await fetchText(MAP_FILES.drawing(id)); } catch { /* island art missing */ } }));
    const map = assembleMap({ islandsXml, levelsXml, routesXml, drawings, levelNames: new Map(entries.map((e) => [e.file, e.name])) });
    state.progress = loadProgress();
    state.mapScreen = createMapScreen({ map, assets, renderer, progress: state.progress, playable: new Set(state.levels.map((l) => l.file)), onPlay: (lvl) => playFile(lvl.file), play, isTouch: () => state.touch });
    globalThis.__map = map;
  } catch (err) {
    console.warn('map unavailable, falling back to level list', err);
  }

  const q = new URLSearchParams(location.search);
  if (q.get('intro') === '0') state.introMs = 0;                 // tests: skip the 2 s draw-in
  if (!state.mapScreen || q.has('level')) {
    const start = Math.max(0, Math.min(state.levels.length - 1, parseInt(q.get('level') || '0', 10) || 0));
    loadLevel(start);
  } else {
    state.mode = 'map';
    if (q.has('island')) state.mapScreen.goToIsland(parseInt(q.get('island'), 10) || 1);
  }
  say('');
  syncToolbar();
  state.last = performance.now();
  requestAnimationFrame(frame);
}

globalThis.__crayon = state;   // for the headless interaction test (test/deluxe.browser.mjs)
state.introFrac = introFrac;
state.music = music;
boot();
