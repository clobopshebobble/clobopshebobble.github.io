// level.js — turns a Crayon Physics Deluxe level XML (version 1.7.0) into a plain JS object.
// Format notes live in docs/DELUXE-REFERENCE.md §2. Coordinate facts recovered from the data:
//   * world units are Box2D metres, 32 px per unit, +y DOWN (screen-like), gravity pulls +y
//   * the screen origin of the world is pixel (512, 584) on the 1024x768 canvas
//   * body/background drawings are in screen PIXELS; a body drawing's pivot is either the
//     DrawData <CenterPoint> (px) or the Gfx <CenterPoint> normalised over the drawing's bbox
//   * a body is static when every shape has Density 0
//   * the ball is the circle body named "da_ball"; the star is the <Collectable> (radius 1)
import { parseXML, child, children, text, num, attrNum } from './xml.js';

export const PX_PER_UNIT = 32;
export const ORIGIN_X = 512;
export const ORIGIN_Y = 584;
export const SCREEN_W = 1024;
export const SCREEN_H = 768;

export const toScreen = (x, y) => [ORIGIN_X + x * PX_PER_UNIT, ORIGIN_Y + y * PX_PER_UNIT];
export const toWorld = (px, py) => [(px - ORIGIN_X) / PX_PER_UNIT, (py - ORIGIN_Y) / PX_PER_UNIT];

function parseColor(el) {
  if (!el) return 'rgb(55,68,223)';
  const r = attrNum(el, 'r', 0), g = attrNum(el, 'g', 0), b = attrNum(el, 'b', 0);
  return `rgb(${r},${g},${b})`;
}

function parsePoints(str) {
  const out = [];
  for (const pair of str.split(';')) {
    const c = pair.indexOf(',');
    if (c < 0) continue;
    const x = parseFloat(pair.slice(0, c)), y = parseFloat(pair.slice(c + 1));
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

// <DrawingData> / <BackgroundDrawingData> → { moveBy, strokes: [{ color, points, pivot? }] }
export function parseDrawingCollection(container) {
  const moveEl = child(container, 'MoveBy');
  const moveBy = { x: attrNum(moveEl, 'x', 0), y: attrNum(moveEl, 'y', 0) };
  const strokes = [];
  for (const dd of children(container, 'DrawData')) {
    const inner = child(child(dd, 'Points'), 'DrawData');
    const points = parsePoints(text(inner));
    if (points.length < 1) continue;
    const cp = child(dd, 'CenterPoint');
    const pivot = cp && (attrNum(cp, 'x') !== 0 || attrNum(cp, 'y') !== 0)
      ? { x: attrNum(cp, 'x'), y: attrNum(cp, 'y') } : null;
    strokes.push({ color: parseColor(child(dd, 'Color')), points, pivot });
  }
  return { moveBy, strokes };
}

function parseShape(sh) {
  const lp = child(sh, 'LocalPosition');
  const base = {
    type: sh.attrs.shape_type === '0' ? 'circle' : 'poly',
    lx: attrNum(lp, 'x', 0), ly: attrNum(lp, 'y', 0),
    lrot: num(sh, 'LocalRotation', 0),
    friction: num(sh, 'Friction', 0.3),
    restitution: num(sh, 'Restitution', 0.15),
    density: num(sh, 'Density', 1),
  };
  if (base.type === 'circle') return { ...base, r: num(sh, 'Radius', 0.5) };
  const verts = children(child(sh, 'Vertices'), 'Vertex').map((v) => [attrNum(v, 'x'), attrNum(v, 'y')]);
  return { ...base, verts };
}

function parseBody(b) {
  const pos = child(b, 'Position');
  const shapes = children(child(b, 'Shapes'), 'Shape').map(parseShape);
  const gfxEl = child(b, 'Gfx');
  const cp = child(gfxEl, 'CenterPoint');
  const gfx = gfxEl ? {
    type: gfxEl.attrs.type || '',
    centerNorm: { x: attrNum(cp, 'x', 0.5), y: attrNum(cp, 'y', 0.5) },
    initialRotation: num(gfxEl, 'InitialRotation', 0),
    file: text(child(gfxEl, 'GfxFilename')),
    drawing: child(gfxEl, 'DrawingData') ? parseDrawingCollection(child(gfxEl, 'DrawingData')) : null,
    onCollision: parseCollisionListener(child(gfxEl, 'CollisionListener')),
  } : null;
  return {
    x: attrNum(pos, 'x', 0), y: attrNum(pos, 'y', 0),
    angle: num(b, 'Rotation', 0),
    angularDamping: attrNum(b, 'angularDamping', 0),
    linearDamping: attrNum(b, 'linearDamping', 0),
    shapes,
    name: text(child(gfxEl, 'GameSpecificData')),
    gfx,
    isStatic: shapes.length > 0 && shapes.every((s) => s.density === 0),
  };
}

// <CollisionListener type="scripted"><OnCollision time_out=…><ExecuteScript>Game::…</ExecuteScript>
// → { timeOut (s), minImpact, calls: [{ fn, args, delay? }] }. The Apple Tree uses it in the demo;
// rockets (data/editor/rocket_object.xml) use it with SetTimeOut("Game::…", ms) for the explosion.
// min_impact may be the symbol rocketImpactThreshold (= 5, default_gameplayoptions.xml).
const ROCKET_IMPACT_THRESHOLD = 5;
function parseCollisionListener(el) {
  const on = child(el, 'OnCollision');
  if (!on) return null;
  let script = text(child(on, 'ExecuteScript')).replace(/\/\/.*$/gm, '');
  const calls = [];
  const re = /Game::(\w+)\s*\(([^)]*)\)/g;
  const delayed = /SetTimeOut\s*\(\s*"([^"]*)"\s*,\s*(\d+)\s*\)/g;
  let m;
  while ((m = delayed.exec(script))) { const d = parseInt(m[2], 10) / 1000; let c; re.lastIndex = 0; while ((c = re.exec(m[1]))) calls.push({ fn: c[1], args: c[2].split(',').map((a) => a.trim()).filter(Boolean), delay: d }); }
  script = script.replace(delayed, '');
  re.lastIndex = 0;
  while ((m = re.exec(script))) calls.push({ fn: m[1], args: m[2].split(',').map((a) => a.trim()).filter(Boolean) });
  const mi = on.attrs.min_impact;
  const minImpact = mi === 'rocketImpactThreshold' ? ROCKET_IMPACT_THRESHOLD : attrNum(on, 'min_impact', 0);
  return { timeOut: attrNum(on, 'time_out', 0) / 1000, minImpact, calls, rocket: calls.some((c) => c.fn === 'PhysicsAddConstantForce') };
}

function parsePoint(el, defR) {
  const p = child(el, 'Position');
  return { x: attrNum(p, 'x', 0), y: attrNum(p, 'y', 0), r: num(el, 'Radius', defR), gfx: el.attrs.gfx_file || '' };
}

export function parseLevel(xmlText) {
  const root = parseXML(xmlText);
  if (!root || root.name !== 'Level') throw new Error('not a Crayon Physics level');
  const bg = child(root, 'Background');
  const bgFile = text(child(bg, 'BackgroundFile'));
  const level = {
    version: root.attrs.version || '',
    background: {
      file: bgFile,
      image: bgFile ? bgFile.replace(/\.xml$/, '.jpg') : '',
      drawing: child(bg, 'BackgroundDrawingData') ? parseDrawingCollection(child(bg, 'BackgroundDrawingData')) : { moveBy: { x: 0, y: 0 }, strokes: [] },
    },
    collectables: children(child(root, 'Collectables'), 'Collectable').map((c) => parsePoint(c, 1)),
    wallPins: children(child(root, 'WallPins'), 'WallPin').map((c) => parsePoint(c, 0.25)),
    userPins: children(child(root, 'UserPins'), 'UserPin').map((c) => parsePoint(c, 0.35)),
    bodies: children(child(child(root, 'World'), 'Bodies'), 'Body').map(parseBody),
    // level-placed ropes (our forge's form of <RopeBodies>; the demo levels have none): a chain
    // hung between two points, attached at each end to whatever is there
    ropes: children(child(root, 'RopeBodies'), 'Rope').map((r) => {
      const a = child(r, 'Position'), b = child(r, 'EndPosition');
      const via = children(r, 'Via').map((p) => [attrNum(p, 'x', 0), attrNum(p, 'y', 0)]);   // optional waypoints: the rope is laid along them
      const pts = [[attrNum(a, 'x', 0), attrNum(a, 'y', 0)], ...via, [attrNum(b, 'x', 0), attrNum(b, 'y', 0)]];
      const density = r.attrs.density, friction = r.attrs.friction;   // optional: lighter / slicker than drawn rope
      return { x0: pts[0][0], y0: pts[0][1], x1: pts[pts.length - 1][0], y1: pts[pts.length - 1][1], pts, density: density == null ? undefined : +density, friction: friction == null ? undefined : +friction };
    }),
  };
  level.ball = level.bodies.find((b) => b.name === 'da_ball') || null;
  level.star = level.collectables[0] || null;
  return level;
}

// data/level_list.xml → [{ name, file }] in play order (skips the empty placeholder row)
export function parseLevelList(xmlText) {
  const root = parseXML(xmlText);
  return children(root, 'Level')
    .filter((l) => l.attrs.filename)
    .sort((a, b) => attrNum(a, 'position') - attrNum(b, 'position'))
    .map((l) => ({ name: l.attrs.level_name || l.attrs.filename, file: l.attrs.filename }));
}

// Pixel pivot of a body drawing: explicit DrawData CenterPoint wins, else normalised Gfx centre.
export function drawingPivot(gfx) {
  const strokes = gfx?.drawing?.strokes || [];
  const explicit = strokes.find((s) => s.pivot);
  if (explicit) return { x: explicit.pivot.x, y: explicit.pivot.y };
  const bb = strokesBBox(strokes);
  if (!bb) return { x: 0, y: 0 };
  return { x: bb.minX + gfx.centerNorm.x * (bb.maxX - bb.minX), y: bb.minY + gfx.centerNorm.y * (bb.maxY - bb.minY) };
}

export function strokesBBox(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const [x, y] of s.points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
