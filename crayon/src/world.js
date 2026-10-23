// world.js — Box2D (planck.js) world built from a parsed Deluxe level, plus the three player
// verbs: draw (stroke → rigid body / pin), erase, kick the ball. `planck` and `earcut` are
// injected so the browser (CDN globals) and the Node tests (npm) run the exact same code.
//
// Tunables come from the demo's data/dev/default_gameplayoptions.xml (docs/DELUXE-REFERENCE.md §1).
import { classify, triangulate, lineBoxes, pointInPolygon, centroid, bbox } from './stroke.js';

export const GRAVITY = 10;                 // Box2D default; the demo's data never overrides it
export const STEP = 1 / 60;
export const KICK_IMPULSE = 500 / 60;      // ballClickForceLinear 500, applied for one 60 Hz step
export const KICK_SPIN = 4.95 / 60;        // ballClickForceAngular
export const KICK_COOLDOWN_MS = 2500;      // ballClickTimeout
export const BALL_RADIUS = 0.75;           // crayonBallRadius
export const DRAWN = { density: 1, friction: 0.3, restitution: 0.15 }; // physicsDefault*
export const PIN_RADIUS = 0.35;            // userPinInGameRadius
export const OUT_OF_WORLD = 40;            // beyond ±40 units the ball is gone (world is 50×50)
export const LIFT_STEP = 0.05;             // drawing under the ball lifts it in 5 cm nudges…
export const LIFT_MAX = 4;                 // …up to 4 units; anything thicker is left to the solver
// Ropes (default_gameplayoptions.xml: ropeExtents 1×0.2, ropeDensity 0.5, ropeFriction 0.9,
// ropeOverlap 0.2): a chain of 1-long, 0.2-thick pieces hinged where they overlap.
export const ROPE = { seg: 1.0, thick: 0.2, overlap: 0.2, density: 0.5, friction: 0.9 };
// Rockets (data/editor/rocket_object.xml): a hit ≥ rocketImpactThreshold lights it; a constant
// force along its nose for 5 s; then it explodes (radius 5) and is gone.
export const ROCKET = { burn: 5, explodeRadius: 5, explodeImpulse: 10 };

export function createGame(planck, earcut, level) {
  const { World, Vec2, Circle, Polygon, Box, RevoluteJoint, AABB, testOverlap } = planck;
  const world = new World({ gravity: new Vec2(0, GRAVITY) });
  const ground = world.createBody({ type: 'static' });
  const records = [];                     // { body, kind: 'level' | 'drawn' | 'rope', spec?, local?, color? }
  const pins = [];                        // { x, y, kind: 'wall' | 'user' | 'drawn', joints: [] }
  const impacts = [];                     // normal impulses from post-solve, drained by the caller
  const effects = [];                     // { kind: 'explosion', x, y, t } for the renderer
  const meta = new Map();                 // body → record
  let ball = null;
  let lastKick = -Infinity;
  let ropeCount = 0;
  const noCollide = [];            // [[bodyA, bodyB]] pairs whose contacts are disabled (pre-solve)

  const v = (x, y) => new Vec2(x, y);

  // ---- level bodies -------------------------------------------------------------------------
  for (const spec of level.bodies) {
    const body = world.createBody({
      type: spec.isStatic ? 'static' : 'dynamic',
      position: v(spec.x, spec.y), angle: spec.angle,
      linearDamping: spec.linearDamping, angularDamping: spec.angularDamping,
    });
    for (const sh of spec.shapes) {
      const fd = { density: sh.density, friction: sh.friction, restitution: sh.restitution };
      if (sh.type === 'circle') { body.createFixture(new Circle(v(sh.lx, sh.ly), sh.r), fd); continue; }
      const c = Math.cos(sh.lrot), s = Math.sin(sh.lrot);
      const verts = sh.verts.map(([x, y]) => v(sh.lx + x * c - y * s, sh.ly + x * s + y * c));
      if (verts.length >= 3 && Math.abs(polyArea(verts)) > 1e-6) body.createFixture(new Polygon(verts), fd);
    }
    const rec = { body, kind: 'level', spec, isBall: spec.name === 'da_ball', isRocket: !!spec.gfx?.onCollision?.rocket };
    records.push(rec); meta.set(body, rec);
    if (rec.isBall) ball = body;
  }

  // ---- level pins ---------------------------------------------------------------------------
  // ---- wall pins -----------------------------------------------------------------------------
  // A wall pin is a hinge to the background. The level files only store a position, and 25 of the
  // demo's pins sit inside two bodies at once (an apple inside the tree crown, a beam through its
  // post, a lever's cup resting in its launch tray, chain links meeting end to end). Rule, chosen so
  // every demo level behaves as designed:
  //   * the containing body whose centre is nearest the pin is hinged to the background;
  //   * every other body under the same pin is hinged to that one (apples to the crown, the crown
  //     to its trunk, chain links, the Catapult post the arm passes through). Jointed bodies don't
  //     collide in Box2D, which is what keeps overlapping parts from shoving each other;
  //   * except a free rotator that has its own private pivot elsewhere (the Real Catapult arm,
  //     which must rest on its launch tray, not weld to it): it is left alone.
  const pinBodies = level.wallPins.map((p) => bodiesAt(p.x, p.y).filter((b) => b !== ball && !b.isStatic()).sort((a, b) => dist2(a.getPosition(), p) - dist2(b.getPosition(), p)));
  const ownPins = new Map();                      // body → number of pins it is nearest to
  const sharedOwn = new Map();                    // body → number of those pins shared with another body
  pinBodies.forEach((bodies) => { if (!bodies.length) return; ownPins.set(bodies[0], (ownPins.get(bodies[0]) || 0) + 1); if (bodies.length > 1) sharedOwn.set(bodies[0], (sharedOwn.get(bodies[0]) || 0) + 1); });
  level.wallPins.forEach((p, i) => {
    const bodies = pinBodies[i];
    const joints = [];
    if (bodies.length) {
      const n = bodies[0];
      joints.push(world.createJoint(new RevoluteJoint({}, ground, n, v(p.x, p.y))));
      for (const o of bodies.slice(1)) {
        const g = ownPins.get(o) || 0;
        if (g === 1 && !(sharedOwn.get(o) || 0)) continue;      // a free rotator with its own private pivot (Real Catapult arm): leave it
        joints.push(world.createJoint(new RevoluteJoint({}, n, o, v(p.x, p.y))));   // hinge it to the pinned body: jointed bodies don't collide
      }
    }
    pins.push({ x: p.x, y: p.y, kind: 'wall', gfx: p.gfx, joints, boundTo: bodies[0] || null });
  });
  for (const p of level.userPins) {                       // pre-placed user pin = body ↔ body hinge
    const bodies = bodiesAt(p.x, p.y).filter((b) => b !== ball);
    const joints = [];
    if (bodies.length >= 2) for (let i = 1; i < bodies.length; i++) joints.push(world.createJoint(new RevoluteJoint({}, bodies[0], bodies[i], v(p.x, p.y))));
    else if (bodies.length === 1) joints.push(world.createJoint(new RevoluteJoint({}, ground, bodies[0], v(p.x, p.y))));
    pins.push({ x: p.x, y: p.y, kind: 'user', gfx: p.gfx, joints });
  }

  // Level scripts. The demo's one <CollisionListener> (Apple Tree) runs, when the tree is hit:
  //   PhysicsSetCollisionBetween(da_apple, da_tree, 0) · PhysicsRemoveAllJoints(da_apple) ·
  //   PhysicsRenameObject(da_apple, unknown)
  // so one apple at a time stops colliding with the crown, loses its pins and falls out. Joints
  // can't change mid-step, so hits are queued and the script runs after world.step().
  // Rockets use the same listener: PhysicsAddConstantForce(name, 250, …) lights the engine and a
  // SetTimeOut'd PhysicsExplodeObject(name, 5, 1500) ends it 5 s later.
  const scriptQueue = [];                 // [{ oc, rec }]
  const delayedCalls = [];                // [{ due, fn, args, rec }]
  let time = 0;
  const byName = (name) => records.find((r) => r.kind === 'level' && r.spec.name === name);
  world.on('post-solve', (contact, impulse) => {
    let m = 0;
    for (const n of impulse.normalImpulses) if (n > m) m = n;
    if (m > 0.3) { const wm = contact.getWorldManifold(null); const pt = wm?.points?.[0]; impacts.push({ m, x: pt ? pt.x : 0, y: pt ? pt.y : 0 }); }   // where, for the renderer's scribble clouds
    const ba = contact.getFixtureA().getBody(), bb = contact.getFixtureB().getBody();
    for (const [b, other] of [[ba, bb], [bb, ba]]) {
      const rec = meta.get(b);
      const oc = rec?.spec?.gfx?.onCollision;
      if (!oc || m < oc.minImpact) continue;
      const o = meta.get(other);
      if (!o) continue;
      // Apple Tree: only something the player drew counts — level bodies resting against each other
      // (the apples hang inside the crown) and the ball, which spawns overlapping the crown, must not
      // fire it. A rocket lights from any moving thing: the ball, a drawn block, another body.
      if (oc.rocket ? other.isStatic() : o.kind !== 'drawn') continue;
      if (time - (rec.lastScript ?? -Infinity) < oc.timeOut) continue;
      rec.lastScript = time;
      if (!scriptQueue.some((q) => q.oc === oc)) scriptQueue.push({ oc, rec });
    }
  });
  world.on('pre-solve', (contact) => {
    if (!noCollide.length) return;
    const a = contact.getFixtureA().getBody(), b = contact.getFixtureB().getBody();
    for (const [x, y] of noCollide) if ((x === a && y === b) || (x === b && y === a)) { contact.setEnabled(false); return; }
  });
  function runScripts() {
    while (scriptQueue.length) {
      const { oc, rec } = scriptQueue.shift();
      for (const call of oc.calls) {
        if (call.delay) delayedCalls.push({ due: time + call.delay, fn: call.fn, args: call.args, rec });
        else runCall(call.fn, call.args, rec);
      }
    }
    for (let i = delayedCalls.length - 1; i >= 0; i--) if (delayedCalls[i].due <= time) { const c = delayedCalls.splice(i, 1)[0]; runCall(c.fn, c.args, c.rec); }
  }
  function runCall(fn, args, self) {
    if (fn === 'PhysicsSetCollisionBetween') {
      const a = byName(args[0]), b = byName(args[1]);
      if (a && b && args[2] === '0') noCollide.push([a.body, b.body]);
    } else if (fn === 'PhysicsRemoveAllJoints') {
      const r = byName(args[0]);
      if (!r) return;
      for (let je = r.body.getJointList(); je; je = je.next) safeDestroyJoint(je.joint);
      for (const p of pins) p.joints = p.joints.filter((j) => j.getBodyA() !== r.body && j.getBodyB() !== r.body);
      for (let i = pins.length - 1; i >= 0; i--) if (pins[i].kind !== 'drawn' && pins[i].joints.length === 0 && pins[i].boundTo === r.body) pins.splice(i, 1);
      r.body.setAwake(true);
    } else if (fn === 'PhysicsRenameObject') {
      const r = byName(args[0]);
      if (r) r.spec = { ...r.spec, name: args[1] };
    } else if (fn === 'PhysicsAddConstantForce') {              // (name, force, …): thrust along the nose (+x) until the explosion
      const r = byName(args[0]) || self;
      if (r && !r.lit) { r.lit = time; r.thrust = parseFloat(args[1]) || 250; r.body.setAwake(true); }
    } else if (fn === 'PhysicsExplodeObject') {                 // (name, radius, force): shove the neighbours, remove the rocket
      const r = byName(args[0]) || self;
      if (!r || !records.includes(r)) return;
      const p = r.body.getPosition(), radius = parseFloat(args[1]) || ROCKET.explodeRadius;
      for (const o of records) {
        if (o === r || o.body.isStatic()) continue;
        const q = o.body.getWorldCenter(), dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
        if (d > radius || d < 1e-6) continue;
        const k = ROCKET.explodeImpulse * (1 - d / radius);
        o.body.setAwake(true); o.body.applyLinearImpulse(v(dx / d * k, dy / d * k), q, true);
      }
      effects.push({ kind: 'explosion', x: p.x, y: p.y, t: time });
      destroyRecord(r);
    }
  }
  // rockets: thrust each step while lit; a rocket that flies out of the world is simply gone
  function updateRockets() {
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (!r.lit) continue;
      const p = r.body.getPosition();
      if (Math.abs(p.x) > OUT_OF_WORLD || Math.abs(p.y) > OUT_OF_WORLD) { destroyRecord(r); continue; }
      if (time - r.lit > ROCKET.burn) continue;
      const a = r.body.getAngle();
      r.body.setAwake(true);
      r.body.applyForceToCenter(v(Math.cos(a) * r.thrust, Math.sin(a) * r.thrust), true);
    }
  }


  // ---- queries ------------------------------------------------------------------------------
  // Bodies whose fixtures contain the point, or (pad > 0) any point on a circle of radius pad
  // around it: a pin has a real radius in Deluxe, so touching counts, not just exact containment.
  function bodiesAt(x, y, pad = 0.02) {
    const found = [];
    const probes = [v(x, y)];
    if (pad > 0.05) for (let i = 0; i < 8; i++) probes.push(v(x + pad * Math.cos((i / 8) * Math.PI * 2), y + pad * Math.sin((i / 8) * Math.PI * 2)));
    world.queryAABB(new AABB(v(x - pad, y - pad), v(x + pad, y + pad)), (fx) => {
      const b = fx.getBody();
      if (b === ground || fx.isSensor() || found.includes(b)) return true;
      if (probes.some((pt) => fx.testPoint(pt))) found.push(b);
      return true;
    });
    return found;
  }
  const bodyInside = (poly) => records.some((r) => { const p = r.body.getPosition(); return pointInPolygon([p.x, p.y], poly); });

  // ---- the three verbs ----------------------------------------------------------------------
  // pts: [[x, y]] world units. Returns { kind: 'pin' | 'closed' | 'ring' | 'open', record? }
  function addStroke(rawPts, color) {
    if (rawPts.length < 2) return null;
    const cls = classify(rawPts);
    if (cls.kind === 'pin') {
      const [cx, cy] = centroid(cls.pts);
      const bodies = bodiesAt(cx, cy, PIN_RADIUS).filter((b) => b !== ball && b !== ground);
      // Two or more things under the pin: hinge them together. One moving thing: pin it to the
      // background, like a pre-placed user pin on a single body (an axle on the wall). Only a
      // static thing, or nothing: it is just a small drawn blob.
      if (bodies.length >= 2 || (bodies.length === 1 && !bodies[0].isStatic())) {
        const joints = [];
        if (bodies.length === 1) joints.push(world.createJoint(new RevoluteJoint({}, ground, bodies[0], v(cx, cy))));
        for (let i = 1; i < bodies.length; i++) joints.push(world.createJoint(new RevoluteJoint({}, bodies[0], bodies[i], v(cx, cy))));
        for (const b of bodies) b.setAwake(true);
        const pin = { x: cx, y: cy, kind: 'drawn', joints, bodies };
        pins.push(pin);
        return { kind: 'pin', pin };
      }
    }
    const bb = bbox(cls.pts);
    const origin = [bb.cx, bb.cy];
    const body = world.createBody({ type: 'dynamic', position: v(origin[0], origin[1]), bullet: false });
    const local = (p) => [p[0] - origin[0], p[1] - origin[1]];
    let kind = 'open';
    let fixtures = 0;
    if (cls.kind !== 'open') {
      const closed = cls.pts.slice();
      if (bodyInside(closed) || bodiesAt(bb.cx, bb.cy).length) {
        kind = 'ring';                       // physicsDoHollowObjectsIfSomethingIsInside
        closed.push(closed[0]);
        for (const bx of lineBoxes(closed.map(local))) { body.createFixture(new Box(bx.hx, bx.hy, v(bx.cx, bx.cy), bx.angle), DRAWN); fixtures++; }
      } else {
        kind = 'closed';
        for (const tri of triangulate(closed.map(local), earcut)) { body.createFixture(new Polygon(tri.map(([x, y]) => v(x, y))), DRAWN); fixtures++; }
        if (!fixtures) { kind = 'ring'; closed.push(closed[0]); for (const bx of lineBoxes(closed.map(local))) { body.createFixture(new Box(bx.hx, bx.hy, v(bx.cx, bx.cy), bx.angle), DRAWN); fixtures++; } }
      }
    } else {
      for (const bx of lineBoxes(cls.pts.map(local))) { body.createFixture(new Box(bx.hx, bx.hy, v(bx.cx, bx.cy), bx.angle), DRAWN); fixtures++; }
    }
    if (!fixtures) { world.destroyBody(body); return null; }
    const rec = { body, kind: 'drawn', shape: kind, color, local: rawPts.map(local), simplified: cls.pts.map(local) };
    records.push(rec); meta.set(body, rec);
    // Drawing under the ball (changelog r53): a stroke that lands on the ball lifts the ball onto it
    // instead of spawning inside it. A ring drawn around the ball is left alone — the ball belongs
    // inside. `underBall` is reported either way: it costs the Elegant Solution star.
    const underBall = overlapsBall(body);
    const lifted = underBall && kind !== 'ring' ? liftBallOff(body) : 0;
    return { kind, record: rec, underBall, lifted };
  }

  function overlapsBall(body) {
    if (!ball) return false;
    const bf = ball.getFixtureList();
    for (let f = body.getFixtureList(); f; f = f.getNext()) {
      if (testOverlap(bf.getShape(), 0, f.getShape(), 0, ball.getTransform(), body.getTransform())) return true;
    }
    return false;
  }
  // Nudge the ball straight up until it no longer overlaps `body`; returns how far it moved (0 = gave up).
  function liftBallOff(body) {
    const p0 = ball.getPosition(), x = p0.x, y = p0.y;
    for (let dy = LIFT_STEP; dy <= LIFT_MAX + 1e-9; dy += LIFT_STEP) {
      ball.setPosition(v(x, y - dy));
      if (!overlapsBall(body)) { ball.setAwake(true); return dy; }
    }
    ball.setPosition(v(x, y));
    return 0;
  }

  // ---- ropes -------------------------------------------------------------------------------
  // A polyline (world units) becomes a chain of ROPE.seg-long pieces hinged where they overlap,
  // in one collision group so the rope never snags on itself. Each end hooks onto whatever is
  // there (a level body, a drawn body, a static wall → the background); a free end just dangles.
  function addRope(rawPts, opts = {}) {
    const pts = resample(rawPts, ROPE.seg - ROPE.overlap);
    if (pts.length < 2) return null;
    const id = ++ropeCount, group = -(10 + id);
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0) + ROPE.overlap, ang = Math.atan2(y1 - y0, x1 - x0);
      const body = world.createBody({ type: 'dynamic', position: v((x0 + x1) / 2, (y0 + y1) / 2), angle: ang, linearDamping: 0.05, angularDamping: 0.05 });
      // level ropes may be lighter/slicker than drawn ones (a wire over a pulley; drawn rope stays rope)
      body.createFixture(new Box(len / 2, ROPE.thick / 2), { density: opts.density ?? ROPE.density, friction: opts.friction ?? ROPE.friction, restitution: 0.05, filterGroupIndex: group });
      segs.push(body);
    }
    const joints = [];
    for (let i = 1; i < segs.length; i++) joints.push(world.createJoint(new RevoluteJoint({}, segs[i - 1], segs[i], v(pts[i][0], pts[i][1]))));
    const hook = (seg, pt) => {
      const bodies = bodiesAt(pt[0], pt[1], 0.3).filter((b) => b !== ball && !segs.includes(b));
      if (bodies.length) joints.push(world.createJoint(new RevoluteJoint({}, bodies[0].isStatic() ? ground : bodies[0], seg, v(pt[0], pt[1]))));
    };
    if (opts.hookEnds !== false) { hook(segs[0], pts[0]); hook(segs[segs.length - 1], pts[pts.length - 1]); }
    const rec = { kind: 'rope', id, body: segs[0], segs, joints, pts, color: opts.color || 'rope', fixed: !!opts.fixed };
    records.push(rec);
    for (const s of segs) meta.set(s, rec);
    return { kind: 'rope', record: rec };
  }
  for (const r of level.ropes || []) addRope(r.pts || [[r.x0, r.y0], [r.x1, r.y1]], { fixed: true, density: r.density, friction: r.friction });   // part of the level: not erasable
  function resample(pts, step) {
    const out = [pts[0]];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d === 0) continue;
      let s = step - carry;
      while (s <= d) { out.push([x0 + (x1 - x0) * s / d, y0 + (y1 - y0) * s / d]); s += step; }
      carry = d - (s - step);
    }
    const last = pts[pts.length - 1], tail = out[out.length - 1];
    if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.35) out.push(last);
    return out;
  }

  function eraseAt(x, y) {
    for (let i = pins.length - 1; i >= 0; i--) {         // drawn pins first: they sit on top
      const p = pins[i];
      if (p.kind === 'drawn' && Math.hypot(p.x - x, p.y - y) < PIN_RADIUS * 1.5) { destroyPin(i); return 'pin'; }
    }
    const bodies = bodiesAt(x, y, 0.1);
    for (const b of bodies) {
      const rec = meta.get(b);
      if (rec && (rec.kind === 'drawn' || (rec.kind === 'rope' && !rec.fixed))) { destroyRecord(rec); return rec.kind === 'rope' ? 'rope' : 'body'; }
    }
    return null;
  }

  function destroyPin(i) {
    const p = pins[i];
    for (const j of p.joints) safeDestroyJoint(j);
    pins.splice(i, 1);
  }
  function safeDestroyJoint(j) { try { world.destroyJoint(j); } catch { /* already gone with its body */ } }
  function destroyRecord(rec) {
    const bodies = rec.kind === 'rope' ? rec.segs : [rec.body];
    // drop pins that referenced these bodies (their joints die with the body)
    for (let i = pins.length - 1; i >= 0; i--) {
      const p = pins[i];
      const dead = p.joints.filter((j) => bodies.includes(j.getBodyA()) || bodies.includes(j.getBodyB()));
      if (!dead.length) continue;
      p.joints = p.joints.filter((j) => !dead.includes(j));
      if (p.kind === 'drawn' && p.joints.length === 0) pins.splice(i, 1);
    }
    for (const b of bodies) { world.destroyBody(b); meta.delete(b); }
    const i = records.indexOf(rec); if (i >= 0) records.splice(i, 1);
  }

  function kick(dir, nowMs) {
    if (!ball || nowMs - lastKick < KICK_COOLDOWN_MS) return false;
    lastKick = nowMs;
    ball.setAwake(true);
    ball.applyLinearImpulse(v(dir * KICK_IMPULSE, 0), ball.getWorldCenter(), true);
    ball.applyAngularImpulse(dir * KICK_SPIN * 10, true);
    return true;
  }
  const canKick = (nowMs) => nowMs - lastKick >= KICK_COOLDOWN_MS;

  function isBallAt(x, y, slack = 0.35) {
    if (!ball) return false;
    const p = ball.getPosition();
    return Math.hypot(p.x - x, p.y - y) <= BALL_RADIUS + slack;
  }

  // one fixed step; returns 'won' | 'out' | null
  function step() {
    updateRockets();
    world.step(STEP, 12, 5);                 // more iterations than Box2D's 8/3: rope chains stay taut under a load
    time += STEP;
    runScripts();
    if (!ball) return null;
    const p = ball.getPosition();
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > OUT_OF_WORLD || Math.abs(p.y) > OUT_OF_WORLD) return 'out';
    if (level.star && Math.hypot(p.x - level.star.x, p.y - level.star.y) < level.star.r + BALL_RADIUS * 0.6) return 'won';
    return null;
  }

  return { world, ground, ball, records, pins, impacts, effects, level, addStroke, addRope, eraseAt, kick, canKick, isBallAt, bodiesAt, step, get time() { return time; } };
}

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function polyArea(vs) {
  let a = 0;
  for (let i = 0; i < vs.length; i++) { const p = vs[i], q = vs[(i + 1) % vs.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}
