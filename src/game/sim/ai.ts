import type { Player, TeamId, World } from '../types'
import { BALL, DEFEND, FIELD, GK, RUN, SECOND_MAN, SHOT, TACTICS } from '../config'
import { add, clamp, dist, dist2, lerp, norm, scale, sub, type Vec2 } from '../math'
import { q } from '../ratings'
import { attackDirOf, tacticsFor } from './world'
import { attackingGoal, crossingSpot, doCross, doPass, doShot, doThrough, getById, gkThrow, ownGoal } from './actions'
import { arriveScale, topSpeedP } from './kin'

const teammates = (w: World, team: TeamId): Player[] => w.players.filter((p) => p.team === team)
const opponents = (w: World, team: TeamId): Player[] => w.players.filter((p) => p.team !== team)

function nearest(list: Player[], at: Vec2, exclude?: string): Player | null {
  let best: Player | null = null
  let bd = Infinity
  for (const p of list) {
    if (p.id === exclude) continue
    const d = dist2(p.pos, at)
    if (d < bd) { bd = d; best = p }
  }
  return best
}

/** Rank of player p among its team by distance to `at` (0 = closest). GKs excluded. */
function proximityRank(w: World, team: TeamId, at: Vec2, p: Player): number {
  const sorted = teammates(w, team)
    .filter((x) => !x.isGK)
    .sort((a, b) => dist2(a.pos, at) - dist2(b.pos, at))
  return sorted.findIndex((x) => x.id === p.id)
}

const ballGround = (w: World): Vec2 => ({ x: w.ball.pos.x, z: w.ball.pos.z })

/**
 * Where a loose ball can next be played. A lofted ball (cross/lofted pass) is projected forward
 * to where it drops to a headable/shootable height, so runners attack the landing spot; a ball
 * on the deck is led a touch so the chaser meets the roll rather than its current position.
 */
function contestPoint(w: World): Vec2 {
  const b = w.ball
  if (b.pos.y <= 1.3) return { x: b.pos.x + b.vel.x * 0.25, z: b.pos.z + b.vel.z * 0.25 }
  let x = b.pos.x, y = b.pos.y, z = b.pos.z
  let vx = b.vel.x, vy = b.vel.y, vz = b.vel.z
  const dt = 1 / 30
  for (let i = 0; i < 75; i++) { // up to ~2.5s of flight
    vy -= BALL.GRAVITY * dt
    const drag = Math.max(0, 1 - BALL.AIR_DRAG * dt)
    vx *= drag; vz *= drag
    x += vx * dt; y += vy * dt; z += vz * dt
    if (y <= BALL.R) { y = BALL.R; break }
    if (y <= 1.9 && vy < 0) break // reachable for a header on the way down
  }
  return { x, z }
}

function keepInField(v: Vec2): Vec2 {
  return {
    x: clamp(v.x, -FIELD.HALF_W + FIELD.WALL_PAD, FIELD.HALF_W - FIELD.WALL_PAD),
    z: clamp(v.z, -FIELD.HALF_L + 0.3, FIELD.HALF_L - 0.3),
  }
}

// Desired velocity helper: steer toward a target with arrive slowdown.
function seek(p: Player, target: Vec2, sprint: boolean, slowR = 2): Vec2 {
  const to = sub(keepInField(target), p.pos)
  const d = Math.hypot(to.x, to.z)
  if (d < 0.05) return { x: 0, z: 0 }
  const speed = topSpeedP(p, sprint) * arriveScale(d, slowR)
  return scale(norm(to), speed)
}

/**
 * Per-player AI. Returns the desired velocity for movement. May trigger kicks for the
 * (AI) ball carrier. The human-controlled player is handled by the controller, not here.
 */
export function aiVelocity(world: World, p: Player, dt: number): Vec2 {
  const b = world.ball
  const ownerTeam: TeamId | null = b.owner ? getById(world, b.owner)!.team : null
  p.reactTimer -= dt

  // ---- Goalkeeper ----
  if (p.isGK) return gkVelocity(world, p, ownerTeam)

  // ---- Ball is loose / in flight ----
  // Attack where the ball is GOING, not where it is — so a cross or pass lofted into the middle
  // is met by a runner who heads/shoots it, instead of everyone holding shape and drifting off it.
  if (!ownerTeam) {
    const aim = contestPoint(world)
    const rank = proximityRank(world, p.team, aim, p)
    if (rank <= 0) return seek(p, aim, true, 1.0) // closest attacks it hard (header / shot / collect)
    if (rank === 1) return seek(p, aim, true, 2.5) // second man supports
    return holdShape(world, p) // others keep shape
  }

  // ---- Our team has it (attack, off the ball) ----
  if (ownerTeam === p.team) {
    if (b.owner === p.id) return carry(world, p) // AI carrier
    return supportRun(world, p, dt)
  }

  // ---- They have it (defend) ----
  return defend(world, p)
}

// ---------------------------------------------------------------------------
function gkVelocity(world: World, gk: Player, ownerTeam: TeamId | null): Vec2 {
  const dir = attackDirOf(world, gk.team)
  const line = -dir * (FIELD.HALF_L - 1.2) // own goal line z
  const b = world.ball

  // GK has gathered the ball. The opponent keeper distributes on his own after a beat;
  // YOUR keeper waits for you (you control him and throw/punt manually — see humanActions).
  if (b.owner === gk.id) {
    if (gk.team !== 'you' && gk.reactTimer <= 0) gkThrow(world, gk)
    return { x: 0, z: 0 }
  }

  // come off the line to gather a handleable loose ball in the box
  if (!b.owner) {
    const dBall = dist(gk.pos, { x: b.pos.x, z: b.pos.z })
    const intoBox = (b.pos.z - line) * dir < FIELD.BOX_DEPTH && Math.abs(b.pos.x) < FIELD.BOX_HALF_W
    const slow = Math.hypot(b.vel.x, b.vel.z) < GK.CLAIM_SPEED
    if (intoBox && slow && dBall < GK.COME_FOR_IT) {
      return seek(gk, { x: b.pos.x, z: b.pos.z }, true, 1.0)
    }
  }

  const carrier = getById(world, b.owner)
  const threat = ownerTeam !== null && ownerTeam !== gk.team
  const mouth = FIELD.GOAL_HALF_W + 1.4
  // shuffle across to where a goal-bound ball will actually cross the line (set up the dive)
  let targetX = clamp(b.pos.x * 0.7, -mouth, mouth)
  const incoming = !b.owner && Math.sign(b.vel.z) === Math.sign(-dir) && Math.abs(b.vel.z) > 1
  if (incoming) {
    const t = (line - b.pos.z) / b.vel.z
    if (t > 0 && t < 1.6) {
      // shuffle hard toward where it will cross — he commits to the save but still can't teleport,
      // so genuine corners beat him while central/reachable shots are covered.
      const cross = b.pos.x + b.vel.x * t
      targetX = clamp(b.pos.x * 0.12 + cross * 0.85, -mouth, mouth)
    }
  }

  // Pre-shift: a high-gk keeper reads the shooter's body/aim while he winds up and leans early
  // toward the likely placement side — so a perfect corner is rewarded but no longer automatic.
  const ps = world.pendingShot
  if (ps) {
    const shooter = getById(world, ps.id)
    if (shooter && shooter.team !== gk.team && dist(shooter.pos, { x: 0, z: line }) < GK.PRESHIFT_RANGE) {
      const sdir = attackDirOf(world, shooter.team)
      const placeX = clamp(ps.aimX * -sdir * FIELD.GOAL_HALF_W, -mouth, mouth)
      targetX += clamp(placeX - targetX, -GK.PRESHIFT_GAIN, GK.PRESHIFT_GAIN) * q(gk.attrs.gk)
      targetX = clamp(targetX, -mouth, mouth)
    }
  }

  // Rush to contain: a clear opponent runner bearing down with no defender goal-side →
  // come off the line and narrow the angle (but don't fully commit to the dive yet).
  if (carrier && threat) {
    const dGoal = dist(carrier.pos, { x: 0, z: line })
    const goalSideDefender = teammates(world, gk.team).some(
      (m) => !m.isGK && (m.pos.z - carrier.pos.z) * dir < -0.5 && dist(m.pos, carrier.pos) < 4,
    )
    if (dGoal < DEFEND.RUSH_DIST && !goalSideDefender && Math.abs(carrier.pos.x) < FIELD.BOX_HALF_W) {
      // sit a few metres off the line on the line between ball and goal centre
      const toBall = norm(sub(carrier.pos, { x: 0, z: line }))
      const out = clamp(DEFEND.RUSH_DIST - dGoal, 2, 5)
      const target: Vec2 = { x: clamp(carrier.pos.x * 0.6, -mouth, mouth), z: line + toBall.z * out }
      return seek(gk, target, true, 1.0)
    }
  }

  // edge off the line to narrow the angle when an opponent is carrying into the box
  const ballInBox = Math.abs(b.pos.x) < FIELD.BOX_HALF_W + 1 && (b.pos.z - line) * dir < FIELD.BOX_DEPTH
  const advance = threat && ballInBox && !!b.owner ? clamp((FIELD.BOX_DEPTH - Math.abs(b.pos.z - line)) * 0.18, 0, 3.0) : 0
  const target: Vec2 = { x: targetX, z: line + advance * dir }
  return seek(gk, target, true, 1.0)
}

function holdShape(world: World, p: Player): Vec2 {
  return seek(p, shapeAnchor(world, p), false, 2.5)
}

/** Formation anchor shifted by where the ball is on the pitch (compress/expand as a unit). */
function shapeAnchor(world: World, p: Player): Vec2 {
  const dir = attackDirOf(world, p.team)
  const t = tacticsFor(world, p.team)
  const bz = world.ball.pos.z
  // slide the whole block toward the ball's third (world-space, toward the ball)
  const slide = clamp(bz * 0.35, -8, 8)
  // TACTICS: line height + mentality push the block up/down the pitch (in the attacking direction);
  // attacking mentality also stretches the wide players a touch wider.
  const linePush = (t.lineHeight - 0.5) * TACTICS.LINE_RANGE + t.mentality * TACTICS.MENTALITY_PUSH
  const wingSign = p.homePos.x >= 0 ? 1 : -1
  const widthAdj = p.role === 'MID' || p.role === 'FWD' ? wingSign * t.mentality * TACTICS.MENTALITY_WIDTH * FIELD.HALF_W : 0
  return {
    x: p.homePos.x + clamp(world.ball.pos.x * 0.25, -4, 4) + widthAdj,
    z: p.homePos.z + slide + linePush * dir,
  }
}

/**
 * Off-ball attacking movement. Forwards make timed runs in behind (giving the carrier a
 * through-ball/lob target), wingers hold width, and the deepest man stays as an outlet —
 * so the attack always has shape and options rather than everyone bunching on the ball.
 */
function supportRun(world: World, p: Player, dt: number): Vec2 {
  const dir = attackDirOf(world, p.team)
  const goal = attackingGoal(world, p.team)
  const carrier = getById(world, world.ball.owner)
  const bx = world.ball.pos.x
  const bz = world.ball.pos.z
  void dt // run timers tick down in updatePlayerAnim

  const wingSign = p.homePos.x >= 0 ? 1 : -1
  const isDeepest = p.role === 'DEF'

  // A team-mate is in a crossing position → CRASH THE BOX. Spread to near post / penalty spot /
  // far post so the cross has runners to find (and someone to head it in).
  if (carrier && carrier.id !== p.id && !isDeepest && crossingSpot(world, carrier)) {
    const crosserSign = (Math.sign(carrier.pos.x) || 1) as 1 | -1
    let spotX: number
    if (p.role === 'FWD') spotX = -crosserSign * 1.5 // lead striker attacks the far/central area
    else if (wingSign !== crosserSign) spotX = -crosserSign * 4.5 // back-post run from the far side
    else spotX = crosserSign * 2 // near-post run
    const spotZ = clamp(goal.z - 4.5 * dir, -(FIELD.HALF_L - 2), FIELD.HALF_L - 2)
    const spot: Vec2 = { x: clamp(spotX, -FIELD.BOX_HALF_W, FIELD.BOX_HALF_W), z: spotZ }
    return seek(p, spot, true, 2) // sprint in to attack the cross
  }

  // Decide whether to trigger an in-behind run (forwards/attacking mids, when there's room ahead).
  if (!isDeepest && p.runTimer <= 0 && p.runCd <= 0) {
    const aheadOfCarrier = carrier ? (p.pos.z - carrier.pos.z) * dir > -2 : true
    const roomAhead = (goal.z - p.pos.z) * dir > 8
    // TACTICS: an attacking mentality triggers more in-behind runs; defensive holds the line.
    const runBonus = tacticsFor(world, p.team).mentality * TACTICS.RUN_CHANCE
    const runChance = clamp((p.role === 'FWD' ? 0.7 : 0.4) + runBonus, 0.05, 0.95)
    if (aheadOfCarrier && roomAhead && world.rng() < runChance) {
      p.runTimer = RUN.DURATION
      p.runCd = RUN.TRIGGER_MIN + world.rng() * (RUN.TRIGGER_MAX - RUN.TRIGGER_MIN)
    } else {
      p.runCd = 0.5 + world.rng()
    }
  }

  let target: Vec2
  if (p.runTimer > 0) {
    // sprint in behind the line, angled into the channel, staying just short of the goal line
    const laneX = clamp(bx + wingSign * 5, -FIELD.HALF_W + 2, FIELD.HALF_W - 2)
    const z = clamp((carrier ? carrier.pos.z : bz) + RUN.BEHIND * dir, -(FIELD.HALF_L - 3), FIELD.HALF_L - 3)
    target = { x: laneX, z }
  } else if (p.role === 'FWD') {
    // hold a high line centrally, ready to receive
    target = { x: clamp(p.homePos.x * 0.6 + bx * 0.2, -FIELD.HALF_W + 3, FIELD.HALF_W - 3), z: goal.z - 9 * dir }
  } else if (p.role === 'MID') {
    // offer a square/under outlet to the side of the carrier
    target = { x: clamp(bx + wingSign * RUN.WIDTH * FIELD.HALF_W, -FIELD.HALF_W + 2, FIELD.HALF_W - 2), z: bz + 1 * dir }
  } else {
    // deepest player holds behind the ball as the safe outlet
    target = { x: p.homePos.x, z: clamp(bz - 7 * dir, -(FIELD.HALF_L - 2), FIELD.HALF_L - 2) }
  }

  // peel off a tight marker to get open
  const marker = nearest(opponents(world, p.team), p.pos)
  if (marker && dist(marker.pos, p.pos) < 2.6) {
    target = add(target, scale(norm(sub(p.pos, marker.pos)), 2.5))
  }
  return seek(p, target, p.runTimer > 0 || dist(p.pos, target) > 4, 2.5)
}

/**
 * Defending — jockey/contain. The presser stays goal-side at a standoff (rather than
 * diving through the carrier), keeping shape; covering players mark goal-side of the next
 * threat and cut the lane. Winning the ball is the contact-contest's job, not a lunge.
 */
function defend(world: World, p: Player): Vec2 {
  const carrier = getById(world, world.ball.owner)
  if (!carrier) return holdShape(world, p)
  const own = ownGoal(world, p.team)
  // Conducted second-man press: the human is holding the press button and chose THIS team-mate
  // to charge the carrier. Close all the way down to contact (the contest does the rest).
  if (p.pressT > 0 && p.id !== world.controlledId) {
    return scale(seek(p, carrier.pos, true, 1.0), SECOND_MAN.CLOSE_PACE)
  }
  const isPresser = proximityRank(world, p.team, carrier.pos, p) === 0 && p.id !== world.controlledId
  if (isPresser) {
    const t = tacticsFor(world, p.team)
    const goalSide = norm(sub(own, carrier.pos))
    // TACTICS: a higher press tightens the containing standoff and jumps out to close the gap sooner;
    // a low press sits off and holds shape (contain rather than hunt).
    const standoff = Math.max(0.8, DEFEND.JOCKEY_STANDOFF - (t.press - 0.5) * 2 * TACTICS.PRESS_STANDOFF)
    const gapThresh = lerp(TACTICS.PRESS_GAP_HI, TACTICS.PRESS_GAP_LO, t.press)
    const target = add(carrier.pos, scale(goalSide, standoff))
    const gap = dist(p.pos, target)
    const v = seek(p, target, gap > gapThresh, 1.2)
    return gap > gapThresh ? scale(v, DEFEND.CHASE_PACE) : v
  }
  // cover: mark the most dangerous other attacker, goal-side, cutting the passing lane
  const attackers = opponents(world, p.team).filter((a) => !a.isGK && a.id !== carrier.id)
  const mark = attackers.sort((a, c) => dist2(a.pos, own) - dist2(c.pos, own))[Math.min(attackers.length - 1, Math.max(0, proximityRank(world, p.team, carrier.pos, p) - 1))]
  if (!mark) return holdShape(world, p)
  const goalSide = norm(sub(own, mark.pos))
  const target = add(mark.pos, scale(goalSide, DEFEND.COVER_GOALSIDE))
  return seek(p, target, dist(p.pos, target) > 4, 2.2)
}

// ---- AI ball carrier (opponent) ----
function carry(world: World, p: Player): Vec2 {
  const dir = attackDirOf(world, p.team)
  // KICK-OFF: knock it back to a team-mate rather than dribbling from the centre spot.
  if (world.kickoffLock === p.team && world.ball.owner === p.id) {
    const mate = backPassTarget(world, p)
    if (mate) { doPass(world, p, mate.pos, mate.vel); return { x: 0, z: 0 } }
  }
  const goal = attackingGoal(world, p.team)
  const dGoal = dist(p.pos, goal)
  const presser = nearest(opponents(world, p.team), p.pos)
  const pressure = presser ? dist(presser.pos, p.pos) : 99

  if (p.reactTimer <= 0) {
    p.reactTimer = 0.18 + world.rng() * 0.16
    // shoot if in range, at a sensible angle, and either with a sight of goal or a half-chance.
    // Kept willing (both teams) so chances actually happen — the weaker ratings/keeper keep it fair.
    const shootRange = 8 + q(p.attrs.shooting) * 8
    const angleOk = Math.abs(p.pos.x) < FIELD.BOX_HALF_W + 6 || dGoal < 11
    if (dGoal < shootRange && angleOk && (pressure > 1.7 || world.rng() < 0.34)) {
      // pick a power near what the distance needs (with a little spread) so the AI doesn't
      // sky everything over the bar from close range — it weights its shots like a player.
      const ideal = clamp(SHOT.IDEAL_NEAR + dGoal * SHOT.IDEAL_PER_M, 0.3, 0.95)
      doShot(world, p, clamp(ideal + (world.rng() - 0.4) * 0.18, 0.3, 1))
      return { x: 0, z: 0 }
    }
    // wide + advanced → whip a cross into the box (before passing it back out)
    if (crossingSpot(world, p)) {
      doCross(world, p)
      return { x: 0, z: 0 }
    }
    // under pressure: pass to the best forward option
    if (pressure < 2.6) {
      const mate = bestPassOption(world, p)
      if (mate) {
        const ahead = (mate.pos.z - p.pos.z) * dir > -2
        if (ahead && dist(mate.pos, p.pos) > 12) doThrough(world, p, add(mate.pos, scale(norm(mate.vel), 1.5)))
        else doPass(world, p, mate.pos, mate.vel)
        return { x: 0, z: 0 }
      }
    }
  }

  // otherwise dribble toward goal, steering away from the nearest defender
  let drive = norm(sub(goal, p.pos))
  if (presser && pressure < 4) {
    const away = norm(sub(p.pos, presser.pos))
    drive = norm(add(drive, scale(away, 0.9)))
  }
  return scale(drive, topSpeedP(p, pressure < 6))
}

/** Nearest team-mate level-with-or-behind the carrier (for a safe kick-off knock-back). */
function backPassTarget(world: World, p: Player): Player | null {
  const dir = attackDirOf(world, p.team)
  let best: Player | null = null
  let bd = Infinity
  for (const m of world.players) {
    if (m.team !== p.team || m.isGK || m.id === p.id) continue
    if ((m.pos.z - p.pos.z) * dir > 1) continue // must be level / behind the kicker
    const d = dist2(p.pos, m.pos)
    if (d < bd) { bd = d; best = m }
  }
  return best
}

function bestPassOption(world: World, p: Player): Player | null {
  const mates = teammates(world, p.team).filter((m) => m.id !== p.id && !m.isGK)
  let best: Player | null = null
  let bestScore = -Infinity
  const dir = attackDirOf(world, p.team)
  for (const m of mates) {
    const forward = (m.pos.z - p.pos.z) * dir
    const marker = nearest(opponents(world, p.team), m.pos)
    const open = marker ? dist(marker.pos, m.pos) : 10
    const d = dist(m.pos, p.pos)
    if (d < 3 || d > 30) continue
    const score = forward * 1.2 + open * 1.5 - d * 0.2
    if (score > bestScore) { bestScore = score; best = m }
  }
  return best
}

// Re-export tiny helpers used by the controller for the human team.
export { nearest, proximityRank, teammates, opponents, keepInField }
export const ballGroundPos = ballGround
export const seekVel = seek
export const distHelper = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z)
void BALL
