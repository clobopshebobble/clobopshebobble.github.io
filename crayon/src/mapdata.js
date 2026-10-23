// mapdata.js — the overworld as data: islands (crayon drawings in one big pixel space), level
// markers, their connection graph, sea routes, star locks, and the progress/reachability rules.
// Pure functions only (no DOM), so the Node tests cover them. Sources: data/map/*.xml.
import { parseXML, child, children, text, attrNum } from './xml.js';
import { parseDrawingCollection, strokesBBox } from './level.js';

export const MAP_FILES = {
  islands: 'data/map/island_data.xml',
  levels: 'data/map/map_data.xml',
  routes: 'data/map/sea_routes.xml',
  drawing: (id) => `data/map/island0${id}_drawing.xml`,
};
export const MARKER = { w: 110, h: 91 };          // map_select_* sprite size
export const LEVEL_TYPE = { LEVEL: 0, DOCK: 1, SEA: 3 };

export function parseIslands(xml) {
  return children(parseXML(xml), 'IslandEntry').map((e) => {
    const g = child(e, 'GfxPosition');
    return { id: attrNum(e, 'island_id'), starsNeeded: attrNum(e, 'star_amount'), gfx: { x: attrNum(g, 'x'), y: attrNum(g, 'y') }, strokes: [], bbox: null, name: `Island ${attrNum(e, 'island_id')}` };
  });
}

export function parseMapLevels(xml) {
  const root = parseXML(xml);
  const levels = children(root, 'LevelEntry').map((e) => {
    const g = child(e, 'GfxPosition');
    return { id: attrNum(e, 'id'), island: attrNum(e, 'island_id'), type: attrNum(e, 'type'), file: text(child(e, 'LevelFilename')), x: attrNum(g, 'x'), y: attrNum(g, 'y') };
  });
  const connections = children(root, 'Connection').map((c) => [attrNum(c, 'id_first'), attrNum(c, 'id_second')]);
  return { levels, connections };
}

// sea_routes.xml → Map "a-b" → points (world px), stored in both directions
export function parseRoutes(xml) {
  const routes = new Map();
  for (const r of children(parseXML(xml), 'SeaRoute')) {
    const a = attrNum(r, 'island1'), b = attrNum(r, 'island2');
    if (a > 8 || b > 8) continue;                      // 22→2 etc. are editor leftovers
    const dd = child(r, 'DrawData');
    const pts = parseDrawingCollection({ children: [dd], attrs: {}, name: 'x', text: '' }).strokes[0]?.points || [];
    if (!pts.length) continue;
    routes.set(`${a}-${b}`, pts);
    routes.set(`${b}-${a}`, pts.slice().reverse());
  }
  return routes;
}

export function parseIslandDrawing(xml) {
  const col = parseDrawingCollection(parseXML(xml));
  return col.strokes;
}

export function assembleMap({ islandsXml, levelsXml, routesXml, drawings, levelNames = new Map() }) {
  const islands = parseIslands(islandsXml);
  for (const isl of islands) {
    isl.strokes = drawings[isl.id] ? parseIslandDrawing(drawings[isl.id]) : [];
    isl.bbox = strokesBBox(isl.strokes);
  }
  const { levels, connections } = parseMapLevels(levelsXml);
  for (const l of levels) l.name = levelNames.get(l.file) || (l.file ? l.file.replace(/^.*\//, '').replace(/\.xml$/, '') : '');
  return linkMap({ islands, levels, connections, routes: parseRoutes(routesXml) });
}
// our own overworld (deluxe/levels/map.json, written by tools/forge/map.mjs): islands carry sand/grass
// blobs and doodles instead of crayon strokes, routes are listed once per pair
export function assembleOwnMap(json) {
  const islands = json.islands.map((i) => ({ ...i, strokes: [] }));
  const levels = json.levels.map((l) => ({ ...l }));
  const routes = new Map();
  for (const r of json.routes || []) { routes.set(`${r.a}-${r.b}`, r.points); routes.set(`${r.b}-${r.a}`, r.points.slice().reverse()); }
  return linkMap({ islands, levels, connections: (json.connections || []).map((c) => c.slice()), routes });
}
function linkMap({ islands, levels, connections, routes }) {
  const world = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const isl of islands) if (isl.bbox) { world.minX = Math.min(world.minX, isl.bbox.minX); world.minY = Math.min(world.minY, isl.bbox.minY); world.maxX = Math.max(world.maxX, isl.bbox.maxX); world.maxY = Math.max(world.maxY, isl.bbox.maxY); }
  const byId = new Map(levels.map((l) => [l.id, l]));
  const neighbours = new Map();
  for (const [a, b] of connections) { (neighbours.get(a) || neighbours.set(a, []).get(a)).push(b); (neighbours.get(b) || neighbours.set(b, []).get(b)).push(a); }
  return { islands, levels, connections, routes, world, byId, neighbours };
}

// ---- progress ---------------------------------------------------------------------------------
// solved[file] = that level's star count (1–3); marks[file] = which extra stars it earned
// (docs/DELUXE-REFERENCE.md §4): `elegant` — solved with no ball click, no drawn pin and nothing
// drawn under the ball; `awesome` — the player's own mark. hints[] = map tutorial pages dismissed.
export function emptyProgress() { return { solved: {}, marks: {}, hints: {}, current: null, island: 1 }; }
export function starsOf(progress) { return Object.values(progress.solved).reduce((a, n) => a + n, 0); }
export function marksOf(progress, file) { return (progress.marks && progress.marks[file]) || {}; }
export function starCount(progress, file) {
  if (!progress.solved[file]) return 0;
  const m = marksOf(progress, file);
  return 1 + (m.elegant ? 1 : 0) + (m.awesome ? 1 : 0);
}
// record a win; returns the level's star record { stars, elegant, awesome, newElegant }
export function solveLevel(progress, file, { elegant = false } = {}) {
  progress.marks ||= {};
  const m = progress.marks[file] || (progress.marks[file] = {});
  const newElegant = elegant && !m.elegant;
  if (elegant) m.elegant = true;
  progress.solved[file] = Math.max(1, progress.solved[file] || 0);
  progress.solved[file] = starCount(progress, file);
  return { stars: progress.solved[file], elegant: !!m.elegant, awesome: !!m.awesome, newElegant };
}
// flip the player's own "awesome" mark on a solved level; returns the new state or null if unsolved
export function toggleAwesome(progress, file) {
  if (!progress.solved[file]) return null;
  progress.marks ||= {};
  const m = progress.marks[file] || (progress.marks[file] = {});
  m.awesome = !m.awesome;
  progress.solved[file] = starCount(progress, file);
  return { stars: progress.solved[file], elegant: !!m.elegant, awesome: m.awesome };
}
export function islandUnlocked(map, progress, islandId) {
  const isl = map.islands.find((i) => i.id === islandId);
  return !!isl && starsOf(progress) >= isl.starsNeeded;
}
export function islandOf(map, levelFile) { return map.levels.find((l) => l.file === levelFile)?.island ?? null; }

// A level marker is reachable when its island is unlocked and it is the island's starting level,
// already solved, or connected to a solved level / the island's dock.
export function reachable(map, progress, level) {
  if (level.type !== LEVEL_TYPE.LEVEL) return false;
  if (!islandUnlocked(map, progress, level.island)) return false;
  if (progress.solved[level.file]) return true;
  const start = map.levels.filter((l) => l.island === level.island && l.type === LEVEL_TYPE.LEVEL).sort((a, b) => a.id - b.id)[0];
  if (start && start.id === level.id) return true;
  for (const n of map.neighbours.get(level.id) || []) {
    const other = map.byId.get(n);
    if (!other) continue;
    if (other.type === LEVEL_TYPE.DOCK) return true;
    if (other.type === LEVEL_TYPE.LEVEL && progress.solved[other.file]) return true;
  }
  return false;
}

export function dockOf(map, islandId) {
  return map.levels.find((l) => l.island === islandId && l.type === LEVEL_TYPE.DOCK) || null;
}

// marker centre in world px (GfxPosition is the sprite's top-left corner)
export const markerCentre = (l) => [l.x + MARKER.w / 2, l.y + MARKER.h / 2];

export function routeBetween(map, a, b) {
  const r = map.routes.get(`${a}-${b}`);
  if (r) return r;
  // no direct route: chain the island-to-island legs in between (our map only draws the chain)
  const ids = map.islands.map((i) => i.id).sort((x, y) => x - y), ia = ids.indexOf(a), ib = ids.indexOf(b);
  if (ia >= 0 && ib >= 0) {
    const step = ib > ia ? 1 : -1, pts = [];
    for (let i = ia; i !== ib; i += step) { const leg = map.routes.get(`${ids[i]}-${ids[i + step]}`); if (!leg) { pts.length = 0; break; } pts.push(...(pts.length ? leg.slice(1) : leg)); }
    if (pts.length) return pts;
  }
  const A = map.islands.find((i) => i.id === a)?.bbox, B = map.islands.find((i) => i.id === b)?.bbox;
  if (!A || !B) return [];
  return [[(A.minX + A.maxX) / 2, (A.minY + A.maxY) / 2], [(B.minX + B.maxX) / 2, (B.minY + B.maxY) / 2]];
}

export function pathLength(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; }
export function pointAlong(pts, dist) {
  if (!pts.length) return [0, 0, 0];
  let d = dist;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d <= seg) { const t = seg ? d / seg : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t, Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])]; }
    d -= seg;
  }
  const n = pts.length - 1;
  return [pts[n][0], pts[n][1], n ? Math.atan2(pts[n][1] - pts[n - 1][1], pts[n][0] - pts[n - 1][0]) : 0];
}
