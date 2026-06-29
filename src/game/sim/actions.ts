import type { Player, TeamId, World } from '../types'
import { BALL, CROSS, FIELD, GK, PASS, SHOT, THROUGH, VOLLEY } from '../config'
import { add, clamp, dist, headingOf, norm, scale, sub, type Vec2, type Vec3 } from '../math'
import { curve, q } from '../ratings'
import { attackDirOf } from './world'

export const getById = (world: World, id: string | null): Player | null =>
  id ? world.players.find((p) => p.id === id) ?? null : null

/** Centre of the goal the given team attacks. */
export function attackingGoal(world: World, team: TeamId): Vec2 {
  return { x: 0, z: attackDirOf(world, team) * FIELD.HALF_L }
}
/** Centre of the goal the given team defends. */
export function ownGoal(world: World, team: TeamId): Vec2 {
  return { x: 0, z: -attackDirOf(world, team) * FIELD.HALF_L }
}

const ZERO_SPIN: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * Low-level kick: launches the ball and releases possession with a brief take-cooldown.
 * `spin` is the ball's angular velocity (drives the Magnus curve in flight); when omitted a
 * small seeded side-spin wobble is applied so even "straight" kicks aren't laser-perfect.
 */
export function kick(world: World, p: Player, vx: number, vz: number, vy: number, spin?: Vec3): void {
  const b = world.ball
  b.owner = null
  b.lastTouch = p.id
  b.lastTeam = p.team
  b.takeCooldown = BALL.TAKE_COOLDOWN
  b.goalboundResolved = false // fresh kick → the keeper gets one save adjudication on it
  b.vel = { x: vx, y: vy, z: vz }
  b.pos.y = Math.max(b.pos.y, BALL.R)
  b.spin = spin ? { ...spin } : { x: 0, y: (world.rng() - 0.5) * 2 * BALL.SPIN_WOBBLE, z: 0 }
  world.kickPulse++
  p.lunge = Math.max(p.lunge, 0.6)
  p.facing = headingOf({ x: vx, z: vz })
}

/** Rotate a unit direction by a small random spray (radians). */
function spray(dir: Vec2, rad: number, rng: () => number): Vec2 {
  const a = (rng() - 0.5) * 2 * rad
  const c = Math.cos(a), s = Math.sin(a)
  return { x: dir.x * c - dir.z * s, z: dir.x * s + dir.z * c }
}

/**
 * Ground pass aimed accurately at a target point (a team-mate, optionally led). Passes go
 * where you point them — only a small rating-scaled wobble — and carry enough weight to
 * actually reach the receiver, so they complete unless someone is genuinely in the lane.
 */
export function doPass(world: World, p: Player, target: Vec2, lead: Vec2 = { x: 0, z: 0 }): void {
  const aim = add(target, scale(lead, PASS.LEAD))
  const d = dist(p.pos, aim)
  const accuracy = q(p.attrs.passing)
  // tight direction: a great passer is laser, a poor one only wobbles a couple of degrees
  const dir = spray(norm(sub(aim, p.pos)), (1 - accuracy) * 0.07, world.rng)
  // weight it to arrive: enough to span the gap without rolling miles past
  const speed = clamp(PASS.SPEED_NEAR + d * 0.7, PASS.SPEED_NEAR, PASS.SPEED_FAR) * (0.95 + accuracy * 0.1)
  kick(world, p, dir.x * speed, dir.z * speed, 0)
}

/**
 * Pass with a held-charge loft. charge 0 = crisp ground pass; higher = a chip/cross.
 * Weight + accuracy scale with passing. A lofted pass carries a little back-spin so it sits up.
 */
export function doLobPass(world: World, p: Player, target: Vec2, charge: number): void {
  const acc = q(p.attrs.passing)
  const dir = spray(norm(sub(target, p.pos)), (1 - acc) * 0.14, world.rng)
  const d = clamp(dist(p.pos, target), 3, 38)
  // Loft RATIO grows with the hold: a light hold = a low driven chip, a full hold = a high, floated
  // ball. We then pick the horizontal speed so the parabola actually LANDS on the target — so the
  // pass drops onto the receiver (who cushions it on his chest) instead of sailing past him.
  const r = 0.4 + charge * 0.55 // vy / vh
  let vh = Math.sqrt((d * BALL.GRAVITY) / (2 * r)) * (0.94 + acc * 0.1)
  vh = clamp(vh, 6, PASS.CROSS_SPEED + 5)
  const vy = vh * r
  const dirN = attackDirOf(world, p.team)
  // a little back-spin so the floated ball sits up and is easy to control on the drop
  kick(world, p, dir.x * vh, dir.z * vh, vy, { x: -SHOT.CHIP_SPIN * 0.5 * dirN, y: 0, z: 0 })
}

/** Lofted through ball / chip into space ahead of a run. */
export function doThrough(world: World, p: Player, target: Vec2): void {
  const accuracy = q(p.attrs.passing)
  const dir = spray(norm(sub(target, p.pos)), (1 - accuracy) * 0.18, world.rng)
  const speed = PASS.THROUGH_SPEED * (0.9 + accuracy * 0.18)
  kick(world, p, dir.x * speed, dir.z * speed, speed * 0.16)
}

/**
 * Human through ball (E): find a team-mate making a run in behind and slide it into the
 * channel ahead of him, led generously. Unlike the safe `pickPassTarget`, this scores space
 * into the channel and run velocity so it deliberately splits the defence.
 */
export function doThroughSeek(world: World, p: Player): void {
  const dir = attackDirOf(world, p.team)
  const goal = attackingGoal(world, p.team)
  let best: Player | null = null
  let bestScore = -Infinity
  for (const m of world.players) {
    if (m.team !== p.team || m.isGK || m.id === p.id) continue
    const ahead = (m.pos.z - p.pos.z) * dir
    if (ahead < -1) continue // must be level/ahead of the carrier
    const d = dist(m.pos, p.pos)
    if (d < 3 || d > 40) continue
    const spaceToGoal = (goal.z - m.pos.z) * dir // room to run into
    const runUpfield = m.vel.z * dir // is he actually making the run?
    let open = 99
    for (const o of world.players) if (o.team !== p.team) open = Math.min(open, dist(o.pos, m.pos))
    const score = spaceToGoal * 1.4 + runUpfield * 1.0 + Math.min(open, 8) * 0.8 - d * 0.1
    if (score > bestScore) { bestScore = score; best = m }
  }
  if (!best) {
    // nobody on the move → chip it into the space ahead of where the carrier is facing
    const face = { x: Math.sin(p.facing), z: Math.cos(p.facing) }
    doThrough(world, p, add(p.pos, scale(face, 14)))
    return
  }
  // lead the runner heavily: his position + his velocity over THROUGH.LEAD, pushed further upfield
  const lead = add(best.pos, scale(best.vel, THROUGH.LEAD))
  const target: Vec2 = { x: lead.x, z: clamp(lead.z + THROUGH.PUSH * dir, -(FIELD.HALF_L - 2), FIELD.HALF_L - 2) }
  const acc = q(p.attrs.passing)
  const ddir = spray(norm(sub(target, p.pos)), (1 - acc) * 0.14, world.rng)
  const d = dist(p.pos, target)
  const speed = clamp(THROUGH.SPEED_MIN + d * 0.3, THROUGH.SPEED_MIN, THROUGH.SPEED_MAX) * (0.92 + acc * 0.16)
  kick(world, p, ddir.x * speed, ddir.z * speed, speed * 0.12)
}

/**
 * True if the player is in a wide, advanced area where a pass should really be a CROSS into
 * the box. Used to auto-detect crosses and to trigger team-mates crashing the box.
 */
export function crossingSpot(world: World, p: Player): boolean {
  const dir = attackDirOf(world, p.team)
  const goal = attackingGoal(world, p.team)
  const advanced = (goal.z - p.pos.z) * dir < FIELD.BOX_DEPTH + 9 // near the byline / attacking third
  const wide = Math.abs(p.pos.x) > FIELD.BOX_HALF_W - 0.5 // out in the wide channel
  return advanced && wide
}

/**
 * Whip a high cross into the box, picking out the best team-mate attacking it (leads his run
 * toward the front/far post). The cross carries side-spin so it bends in toward goal.
 */
export function doCross(world: World, p: Player): void {
  const goal = attackingGoal(world, p.team)
  const dir = attackDirOf(world, p.team)
  const acc = q(p.attrs.passing)
  // find the best attacker in/arriving at the box, preferring central & far-post runs
  let best: Player | null = null
  let bestScore = -Infinity
  for (const m of world.players) {
    if (m.team !== p.team || m.isGK || m.id === p.id) continue
    const toGoalLine = (goal.z - m.pos.z) * dir
    if (toGoalLine > FIELD.BOX_DEPTH + 4 || toGoalLine < -1) continue // must be in/around the box
    if (Math.abs(m.pos.x) > FIELD.BOX_HALF_W + 1.5) continue
    const open = (() => { let o = 99; for (const d of world.players) if (d.team !== p.team && !d.isGK) o = Math.min(o, dist(d.pos, m.pos)); return Math.min(o, 6) })()
    const central = 3 - Math.abs(m.pos.x) * 0.4
    const score = open * 1.2 + central - toGoalLine * 0.1
    if (score > bestScore) { bestScore = score; best = m }
  }

  // Aim point: LEAD the chosen runner by the cross's own flight time so the ball meets his run
  // (estimate the flight from a first solve, then lead by it — an early/whipped-cross feel).
  let target: Vec2
  if (best) {
    const d0 = Math.max(6, dist(p.pos, best.pos))
    const vh0 = Math.sqrt((d0 * BALL.GRAVITY) / (2 * CROSS.LOFT))
    const flight = (2 * CROSS.LOFT * vh0) / BALL.GRAVITY
    target = add(best.pos, scale(best.vel, flight * CROSS.LEAD))
  } else {
    target = { x: -Math.sign(p.pos.x || 1) * 2.5, z: goal.z - 4 * dir } // far-post default
  }

  // WEIGHT + ACCURACY both scale with passing. A poor crosser under/over-hits the weight and sprays
  // the direction; a great one flights it to land pinpoint on the runner. We solve the horizontal
  // pace so the parabola RANGES exactly to the (lead) target, then apply the rating-scaled errors.
  const weightErr = 1 + (world.rng() - 0.5) * 2 * (1 - acc) * CROSS.WEIGHT_ERR
  const d = clamp(dist(p.pos, target), 6, 46) * weightErr
  let vh = Math.sqrt((d * BALL.GRAVITY) / (2 * CROSS.LOFT))
  vh = clamp(vh, CROSS.SPEED_MIN, CROSS.SPEED_MAX)
  const vy = vh * CROSS.LOFT
  const ddir = spray(norm(sub(target, p.pos)), (1 - acc) * CROSS.SPRAY_MAX, world.rng)
  // in-swinging side-spin that bends the cross toward goal — sharper for a better crosser
  const bend = Math.sign(-(p.pos.x || 1))
  const spinY = SHOT.CROSS_SPIN * bend * dir * (0.7 + acc * 0.5)
  kick(world, p, ddir.x * vh, ddir.z * vh, vy, { x: 0, y: spinY, z: 0 })
}

export type ShotOpts = { finesse?: boolean; power?: boolean; chip?: boolean; volley?: boolean; timed?: boolean }

/**
 * Shoot toward the attacking goal. `power` 0..1 is the charged power; `aimBias` (-1..1)
 * lets the human steer placement left/right via facing. Shot TYPE (finesse / driven / power /
 * chip / volley) is set in `opts` and decides the SPIN — the curve/dip/float is real Magnus,
 * not an aim fudge. Accuracy/power scale with shooting.
 */
export function doShot(world: World, p: Player, power: number, aimBias = 0, opts: ShotOpts = {}): void {
  const goal = attackingGoal(world, p.team)
  const dir = attackDirOf(world, p.team)
  const sh = q(p.attrs.shooting)
  const chip = !!opts.chip
  const powerShot = !!opts.power && !chip
  const finesse = !chip && !powerShot && (!!opts.finesse || power <= SHOT.FINESSE_CHARGE)
  const driven = !chip && !finesse // normal / driven / power all strike with top-spin
  const d = dist(p.pos, goal)
  const inBox = (goal.z - p.pos.z) * dir < FIELD.BOX_DEPTH && Math.abs(p.pos.x) < FIELD.BOX_HALF_W

  // game-state context: closest opponent (pressure) and whether we're off balance (full sprint)
  let pressure = 99
  for (const o of world.players) if (o.team !== p.team && !o.isGK) pressure = Math.min(pressure, dist(o.pos, p.pos))
  const offBalance = Math.hypot(p.vel.x, p.vel.z) > 6.8 // only a genuine full sprint, not a jog

  // placement across the mouth. aimBias is SCREEN-space (+1 = the player's right via D);
  // screen-right resolves to world x of sign -dir, so convert before aiming. (Finesse no longer
  // fudges the aim toward the far post — the side-spin below does the bending.)
  const aimX = clamp(aimBias * -dir * (FIELD.GOAL_HALF_W - 0.25), -(FIELD.GOAL_HALF_W - 0.15), FIELD.GOAL_HALF_W - 0.15)
  const target: Vec2 = { x: aimX, z: goal.z }

  // ── ACCURACY (rating-driven) ─────────────────────────────────────────────
  let noise = (1 - sh) * 0.14 + clamp(d / 55, 0, 0.1)
  noise += power * 0.06 * (1 - sh * 0.6) // hard shots are harder to keep down — top shooters cope
  if (inBox) noise -= SHOT.BOX_ACC
  if (pressure < 2.2) noise += SHOT.PRESSURE_SPRAY * (1 - sh * 0.5)
  if (offBalance) noise += SHOT.MOVING_SPRAY
  if (opts.volley) noise += VOLLEY.SHOT_SPRAY
  if (finesse) noise *= 0.7
  if (powerShot) noise += SHOT.POWER_SPRAY
  if (opts.timed) noise *= SHOT.TIMED_ACC
  noise = Math.max(0.01, noise)
  const flat = norm(spray(sub(target, p.pos), noise, world.rng))

  // ── PACE (power × rating) ────────────────────────────────────────────────
  let vh = curve(p.attrs.shooting, SHOT.MIN_POWER, SHOT.MAX_POWER) * (0.5 + 0.62 * power)
  if (finesse) vh *= SHOT.FINESSE_SPEED
  if (chip) vh *= SHOT.CHIP_PACE
  if (powerShot) vh *= SHOT.POWER_PACE
  if (opts.timed) vh *= SHOT.TIMED_PACE
  if (inBox && !chip) vh *= 1.05
  vh = Math.min(vh, BALL.MAX_SPEED)

  // ── HEIGHT (power vs the distance it needs) ──────────────────────────────
  const idealPower = clamp(SHOT.IDEAL_NEAR + d * SHOT.IDEAL_PER_M, 0.2, 1)
  const over = Math.max(0, power - idealPower) * (1 - sh * 0.4)
  let lift = SHOT.LIFT_BASE + power * SHOT.LIFT_GAIN + over * SHOT.OVERHIT
  if (finesse) lift = SHOT.LIFT_BASE * 0.8 // finesse stays low and placed
  if (chip) lift = SHOT.CHIP_LIFT // chip floats up and over the keeper
  if (offBalance) lift += 0.05
  const vy = vh * lift

  // ── SPIN (the real curve) ────────────────────────────────────────────────
  // finesse → side-spin toward the far post; driven/power → top-spin (DIPS); chip → back-spin
  // (FLOATS). Signs are chosen so, with travel mostly along z, Magnus bends the right way.
  let spin: Vec3
  if (finesse) {
    const farSign = p.pos.x >= 0 ? -1 : 1
    spin = { x: 0, y: SHOT.FINESSE_SPIN * farSign * dir, z: 0 }
  } else if (chip) {
    spin = { x: -SHOT.CHIP_SPIN * dir, y: (world.rng() - 0.5) * 2, z: 0 }
  } else if (driven) {
    const top = powerShot ? SHOT.DRIVEN_SPIN * 1.25 : SHOT.DRIVEN_SPIN
    spin = { x: top * dir, y: (world.rng() - 0.5) * 3, z: 0 }
  } else {
    spin = ZERO_SPIN
  }

  kick(world, p, flat.x * vh, flat.z * vh, vy, spin)
  if (powerShot) world.camShake = Math.min(1, world.camShake + 0.7)
}

/** Goalkeeper punt — a big, high clearance that truly launches it long downfield. */
export function gkClear(world: World, gk: Player): void {
  const dir = attackDirOf(world, gk.team)
  const tx = (world.rng() - 0.5) * 9
  const v: Vec2 = norm({ x: tx, z: 26 * dir })
  const speed = 23
  kick(world, gk, v.x * speed, v.z * speed, speed * 0.5)
  gk.throwT = 0.45
}

/**
 * Goalkeeper distribution: roll/throw the ball out to the BEST open team-mate up the
 * pitch (the keeper's "best pass" rule — openness + forward progress, never his weak
 * outfield passing). Accuracy scales with keeper handling (`gk`), NOT passing, so a
 * keeper distributes cleanly instead of spraying it. `preferDir`, when supplied (the
 * human's left-stick), only nudges the CHOICE toward where you're pointing as a
 * tiebreak. Falls back to a punt if nobody sensible is in range.
 */
export function gkThrow(world: World, gk: Player, preferDir: Vec2 | null = null): void {
  const dir = attackDirOf(world, gk.team)
  const mates = world.players.filter((m) => m.team === gk.team && !m.isGK)
  let best: Player | null = null
  let bestScore = -Infinity
  for (const m of mates) {
    const d = dist(gk.pos, m.pos)
    if (d < 5 || d > GK.THROW_RANGE) continue
    // openness: distance to the nearest opponent
    let open = 99
    for (const o of world.players) if (o.team !== gk.team && !o.isGK) open = Math.min(open, dist(o.pos, m.pos))
    const forward = (m.pos.z - gk.pos.z) * dir
    // BEST PASS leads: an open team-mate, advancing play. Your aim is only a tiebreak.
    let score = open * 1.6 + forward * 0.5 - d * 0.12
    if (preferDir) {
      const to = norm(sub(m.pos, gk.pos))
      score += (to.x * preferDir.x + to.z * preferDir.z) * 3
    }
    if (score > bestScore) { bestScore = score; best = m }
  }
  if (!best) { gkClear(world, gk); return }
  const d = dist(gk.pos, best.pos)
  // keeper handling drives throw accuracy — a roll-out is crisp, not a wild outfield pass
  const acc = q(gk.attrs.gk)
  const aim = spray(norm(sub(best.pos, gk.pos)), (1 - acc) * 0.06, world.rng)
  const speed = clamp(GK.THROW_MIN + d * 0.4, GK.THROW_MIN, GK.THROW_MAX)
  gk.facing = headingOf(aim)
  kick(world, gk, aim.x * speed, aim.z * speed, speed * 0.1) // low, rolled-out throw
  gk.throwT = 0.5
}

/**
 * Throw-in: an overhead two-handed throw to the best open team-mate. It's a pass, so its accuracy
 * scales with the thrower's passing. Used for AI throw-ins (the human takes his own with Space).
 */
export function doThrowIn(world: World, p: Player): void {
  const dir = attackDirOf(world, p.team)
  let best: Player | null = null
  let bestScore = -Infinity
  for (const m of world.players) {
    if (m.team !== p.team || m.isGK || m.id === p.id) continue
    const d = dist(p.pos, m.pos)
    if (d < 3 || d > 22) continue
    let open = 99
    for (const o of world.players) if (o.team !== p.team && !o.isGK) open = Math.min(open, dist(o.pos, m.pos))
    const forward = (m.pos.z - p.pos.z) * dir
    const score = Math.min(open, 6) * 1.4 + forward * 0.4 - d * 0.12
    if (score > bestScore) { bestScore = score; best = m }
  }
  const target: Vec2 = best ? best.pos : add(p.pos, { x: 0, z: 8 * dir })
  const acc = q(p.attrs.passing)
  const aim = spray(norm(sub(target, p.pos)), (1 - acc) * 0.14, world.rng)
  const d = best ? dist(p.pos, best.pos) : 8
  const speed = clamp(8 + d * 0.5, 8, 16)
  p.facing = headingOf(aim)
  p.throwInT = 0.4
  kick(world, p, aim.x * speed, aim.z * speed, speed * 0.34) // a lofted overhead throw
}

export type TackleOpts = { reach: number; lunge: number; bonus: number; recover: number }

/**
 * Attempt a tackle. Returns true if the ball was won. Success scales the defender's
 * defending vs the carrier's dribbling, shifted by the move archetype's `bonus`.
 * The human-controlled carrier is given a little extra protection so keeping the ball
 * feels fair.
 */
export function tryTackle(world: World, defender: Player, carrier: Player, opts: TackleOpts): boolean {
  const d = dist(defender.pos, carrier.pos)
  defender.lunge = Math.max(defender.lunge, opts.lunge + 0.4)
  defender.recover = Math.max(defender.recover, opts.recover)
  if (d > BALL.CONTROL_R + opts.reach) return false
  const def = q(defender.attrs.defending)
  const dri = q(carrier.attrs.dribbling)
  let prob = 0.34 + (def - dri) * 0.5 + opts.bonus
  if (carrier.id === world.controlledId) prob *= 0.82 // ease up on the human carrier
  prob = clamp(prob, 0.05, 0.9)
  if (world.rng() < prob) {
    const b = world.ball
    // clean tackle → the defender wins possession; the carrier stumbles
    b.owner = defender.id
    b.lastTouch = defender.id
    b.lastTeam = defender.team
    b.takeCooldown = 0.1
    b.vel = { x: 0, y: 0, z: 0 }
    b.pos = { x: defender.pos.x, y: BALL.R, z: defender.pos.z }
    carrier.lunge = Math.max(carrier.lunge, 0.5)
    carrier.recover = Math.max(carrier.recover, 0.55)
    carrier.settle = 0
    defender.settle = Math.max(defender.settle, 0.4)
    return true
  }
  return false
}

/** Outfield clearance: hoof the ball upfield (used by the defensive "clear" action). */
export function doClear(world: World, p: Player): void {
  const goal = attackingGoal(world, p.team)
  const dir = norm(sub(goal, p.pos))
  const speed = 18
  kick(world, p, dir.x * speed, dir.z * speed, speed * 0.42)
}
