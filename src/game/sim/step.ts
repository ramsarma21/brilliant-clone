import type { Input, PendingShot, Player, RestartKind, TeamId, World } from '../types'
import {
  BALL, BARGE, CONTEST, DRIBBLE, FIELD, GK, JOCKEY, MATCH, PASS, PLAYER, SECOND_MAN,
  SHIELD, SHOT, SKILL, SLIDE, STAMINA, TACKLE, TOUCH, VOLLEY,
} from '../config'
import {
  add, angleDelta, clamp, cross3, dirFromHeading, dist, dist2, headingOf, len, lerp, limit,
  moveToward, norm, rot2, scale, sub, type Vec2,
} from '../math'
import { q } from '../ratings'
import { topSpeed, topSpeedP } from './kin'
import { aiVelocity } from './ai'
import {
  attackingGoal, crossingSpot, doClear, doCross, doLobPass, doPass, doShot, doThroughSeek,
  doThrowIn, getById, gkClear, gkThrow, tryTackle,
} from './actions'
import { attackDirOf, resetForKickoff, setupRestart } from './world'

/** Per-player stamina drain (/s while sprinting), scaled by the STAMINA game-skill. */
function staminaDrain(p: Player): number {
  const t = clamp(p.attrs.stamina / 99, 0, 1)
  return STAMINA.DRAIN * lerp(STAMINA.DRAIN_MAX_MULT, STAMINA.DRAIN_MIN_MULT, t)
}
/** Per-player stamina refill (/s while not sprinting), scaled by the STAMINA game-skill. */
function staminaRegen(p: Player): number {
  const t = clamp(p.attrs.stamina / 99, 0, 1)
  return STAMINA.REGEN * lerp(STAMINA.REGEN_MIN_MULT, STAMINA.REGEN_MAX_MULT, t)
}

/** Top-speed multiplier from stamina, post-tackle recovery, barge-stagger, and dribble burst. */
function speedMult(p: Player): number {
  const stam = lerp(STAMINA.MIN_SPEED_MULT, 1, clamp(p.stamina, 0, 1))
  const rec = p.recover > 0 ? 0.45 : 1
  const stag = p.stagger > 0 ? BARGE.STAGGER_MULT : 1
  const boost = p.protect > 0 ? 1 + DRIBBLE.boost : 1
  return stam * rec * stag * boost
}

/** Advance the world by one fixed timestep `dt`. */
export function stepWorld(world: World, input: Input, dt: number): void {
  if (world.phase === 'fulltime') return

  world.humanMove = input.move
  resolveControl(world, input)
  const frozen = world.freeze > 0

  // human + AI desired velocities, plus human actions when live
  const controlled = getById(world, world.controlledId)
  for (const p of world.players) {
    p.faceLock = null // re-asserted each step by jockey/strafe/shield intent below
    // committed slide tackle: scripted slide, decelerating along its launch direction
    if (!frozen && p.slideT > 0) {
      const sp = Math.max(0, len(p.vel) - SLIDE.FRICTION * dt)
      p.vel = scale(norm(p.vel), sp)
      integratePos(p, dt)
      // a slide that reaches the carrier can still win it
      const carrier = getById(world, world.ball.owner)
      if (carrier && carrier.team !== p.team && p.actCd <= 0 && dist(p.pos, carrier.pos) < BALL.CONTROL_R + TACKLE.SLIDE.reach) {
        p.actCd = 0.2
        tryTackle(world, p, carrier, TACKLE.SLIDE)
      }
      p.stamina = clamp(p.stamina + staminaRegen(p) * dt, 0, 1)
      continue
    }

    let desired: Vec2
    let sprinting = false
    const mult = speedMult(p)
    if (!frozen && p.id === world.controlledId) {
      const isCarrier = world.ball.owner === p.id
      const wantSprint = input.sprint && len(input.move) > 0.1 && !input.jockey
      sprinting = wantSprint && p.stamina > STAMINA.SPRINT_FLOOR && p.recover <= 0
      let cap = 1
      // ---- manual-defending / on-ball modifiers (the L2/LT "jockey" key = Shift) ----
      if (input.jockey) {
        if (isCarrier) {
          // STRAFE dribble: face goal, move laterally with close control; SHIELD if a defender
          // is tight (geometry then puts the ball on the far side of the body).
          const def = nearestOpp(world, p.team, p.pos)
          if (def && dist(def.pos, p.pos) < SHIELD.RANGE) {
            p.shield = 0.12
            p.faceLock = headingOf(norm(sub(p.pos, def.pos))) // back to the defender
          } else {
            p.faceLock = headingOf(sub(attackingGoal(world, p.team), p.pos))
          }
          cap = JOCKEY.STRAFE_MULT
        } else {
          // JOCKEY: controlled containing shuffle, square up to the ball
          p.jockey = 0.12
          p.faceLock = headingOf(sub({ x: world.ball.pos.x, z: world.ball.pos.z }, p.pos))
          cap = JOCKEY.SPEED_MULT
        }
      }
      const base = topSpeedP(p, sprinting)
      desired = scale(input.move, base * mult * cap)
    } else if (!frozen) {
      desired = aiVelocity(world, p, dt)
      const jog = topSpeed(p.attrs.pace, false)
      const sprintTop = topSpeedP(p, true)
      sprinting = len(desired) > jog + (sprintTop - jog) * 0.55 && p.stamina > STAMINA.SPRINT_FLOOR && p.recover <= 0
      desired = limit(desired, sprintTop * mult)
    } else if (world.phase === 'goal') {
      // GOAL! the scoring side breaks into a celebration run; the conceding side trudges back
      desired = celebrate(world, p)
      sprinting = len(desired) > 4
    } else {
      desired = scale(norm(sub(p.homePos, p.pos)), Math.min(2, dist(p.homePos, p.pos)))
      if (dist(p.homePos, p.pos) < 0.3) desired = { x: 0, z: 0 }
    }
    p.sprinting = sprinting
    const maxV = topSpeedP(p, true) * mult
    stepPlayerMove(p, desired, dt, maxV)
    if (sprinting) p.stamina = clamp(p.stamina - staminaDrain(p) * dt, 0, 1)
    else p.stamina = clamp(p.stamina + staminaRegen(p) * dt, 0, 1)
  }

  if (!frozen && controlled) humanActions(world, controlled, input, dt)
  if (!frozen) stepPendingShot(world, dt)
  if (!frozen) contestPossession(world, dt)

  separate(world)
  if (!frozen) physicalDuels(world)
  enforceKickoff(world)
  for (const p of world.players) updatePlayerAnim(world, p, dt)

  stepBall(world, dt)
  if (!frozen) goalkeeping(world, dt)

  if (!frozen) {
    detectGoal(world)
    if (world.phase === 'play') detectOutOfPlay(world)
  }

  stepClockAndPhase(world, dt)
}

// ---------------------------------------------------------------------------
// Control / player switching
function resolveControl(world: World, input: Input): void {
  const owner = getById(world, world.ball.owner)
  const youOutfield = world.players.filter((p) => p.team === 'you' && !p.isGK)
  const bg = { x: world.ball.pos.x, z: world.ball.pos.z }
  const nearestToBall = (): Player => {
    let best = youOutfield[0]
    let bd = Infinity
    for (const p of youOutfield) {
      const d = dist2(p.pos, bg)
      if (d < bd) { bd = d; best = p }
    }
    return best
  }

  // OFFENSE: your team has the ball → you control the carrier (no switching).
  if (owner && owner.team === 'you') {
    world.controlledId = owner.id
    world.prevBallOwner = world.ball.owner
    return
  }

  // DEFENSE: ←/→ = switch to the team-mate toward that screen side (fixes "auto-switch grabbed
  // the wrong man" — point at who you want). Space = switch to the man nearest the ball.
  if (input.switchLeft || input.switchRight) {
    const picked = switchToward(world, youOutfield, input.switchRight ? 1 : -1)
    if (picked) {
      world.controlledId = picked.id
      world.manualSwitch = 1.5
      world.prevBallOwner = world.ball.owner
      return
    }
  }
  if (input.passReleased) {
    world.controlledId = nearestToBall().id
    world.manualSwitch = 1.5
    world.prevBallOwner = world.ball.owner
    return
  }

  const controlled = getById(world, world.controlledId)
  const valid = controlled && controlled.team === 'you' && !controlled.isGK
  const possessionChanged = world.ball.owner !== world.prevBallOwner
  if (!valid || (possessionChanged && world.manualSwitch <= 0)) {
    world.controlledId = nearestToBall().id
  }
  world.prevBallOwner = world.ball.owner
}

/** Directional switch: pick your outfielder furthest toward the requested screen side. */
function switchToward(world: World, youOutfield: Player[], side: 1 | -1): Player | null {
  const cur = getById(world, world.controlledId)
  const dir = world.youAttackDir
  // screen-right increases as (-dir * x). Choose candidates on the requested side of the
  // current player, then prefer the one nearest the ball (most useful to defend with).
  const curScreen = cur ? -dir * cur.pos.x : 0
  const bg = { x: world.ball.pos.x, z: world.ball.pos.z }
  let best: Player | null = null
  let bestScore = Infinity
  for (const p of youOutfield) {
    if (p.id === world.controlledId) continue
    const screen = -dir * p.pos.x
    const onSide = side === 1 ? screen > curScreen + 0.5 : screen < curScreen - 0.5
    if (!onSide) continue
    const score = dist2(p.pos, bg)
    if (score < bestScore) { bestScore = score; best = p }
  }
  return best
}

// ---------------------------------------------------------------------------
// Movement integration
function integratePos(p: Player, dt: number): void {
  p.pos = add(p.pos, scale(p.vel, dt))
  if (p.isGK) {
    // Keep the keeper in (around) his own penalty area — a small slack lets him sweep/come for a
    // cross at the edge, but he can no longer wander upfield (fixes the GK-leaves-the-box glitch).
    const side = Math.sign(p.homePos.z) || -1 // which goal-end is his (homePos.z is mirrored per team)
    const lineZ = side * FIELD.HALF_L
    const slack = 2.0
    const zBack = lineZ + side * 0.3 // a touch behind his own line
    const zFront = lineZ - side * (FIELD.BOX_DEPTH + slack) // out to the edge of the box (+slack)
    p.pos.x = clamp(p.pos.x, -(FIELD.BOX_HALF_W + slack), FIELD.BOX_HALF_W + slack)
    p.pos.z = clamp(p.pos.z, Math.min(zBack, zFront), Math.max(zBack, zFront))
    return
  }
  p.pos.x = clamp(p.pos.x, -FIELD.HALF_W + 0.3, FIELD.HALF_W - 0.3)
  p.pos.z = clamp(p.pos.z, -FIELD.HALF_L - 0.4, FIELD.HALF_L + 0.4)
}

/**
 * Goal celebration movement. The scorer wheels away to the nearest corner, his team-mates sprint
 * over to mob him, and the conceding side trudges back toward their positions. (The dancing/jumping
 * poses themselves are in the renderer, keyed off the 'goal' phase.)
 */
function celebrate(world: World, p: Player): Vec2 {
  const scoredTeam = world.justScored
  const scorer = getById(world, world.scorerId)
  if (!scoredTeam) return { x: 0, z: 0 }
  if (p.team !== scoredTeam) {
    const to = sub(p.homePos, p.pos)
    return scale(norm(to), Math.min(1.6, len(to))) // dejected walk back to shape
  }
  if (scorer && p.id === scorer.id) {
    const dir = attackDirOf(world, p.team)
    const corner: Vec2 = { x: Math.sign(p.pos.x || 1) * (FIELD.HALF_W - 3), z: dir * (FIELD.HALF_L - 5) }
    const to = sub(corner, p.pos)
    return len(to) < 2 ? { x: 0, z: 0 } : scale(norm(to), 7) // wheel away, then dance in the corner
  }
  // team-mates mob the scorer
  const focus = scorer ?? p
  const to = sub(focus.pos, p.pos)
  return len(to) < 2.4 ? { x: 0, z: 0 } : scale(norm(to), 6.5)
}

/**
 * Kick-off rule. Until the kicking side actually plays the ball (a pass), it can't carry over the
 * halfway line and the opponents must hold in their own half — so you take a real kick-off (knock it
 * back to a team-mate) instead of sprinting from the centre spot straight at goal.
 */
function enforceKickoff(world: World): void {
  const kicking = world.kickoffLock
  if (!kicking) return
  // the moment the kicker plays it (ball is loose or owned by someone else) → open play up
  if (world.ball.owner !== world.kickoffKickerId) {
    world.kickoffLock = null
    world.kickoffKickerId = null
    return
  }
  const kickDir = attackDirOf(world, kicking)
  for (const p of world.players) {
    if (p.isGK) continue
    if (p.id === world.kickoffKickerId) {
      // the kicker can't cross into the opponent half while still holding it
      if (p.pos.z * kickDir > 0) { p.pos.z = 0; if (p.vel.z * kickDir > 0) p.vel.z = 0 }
    } else if (p.team !== kicking) {
      // opponents stay in their own half (out of the kicking team's half) until the ball is played
      if (p.pos.z * kickDir < 0) { p.pos.z = 0; if (p.vel.z * kickDir < 0) p.vel.z = 0 }
    }
  }
  // keep the held ball with the (clamped) kicker
  const kicker = getById(world, world.kickoffKickerId)
  if (kicker && world.ball.owner === kicker.id) { world.ball.pos.x = kicker.pos.x; world.ball.pos.z = kicker.pos.z }
}

function stepPlayerMove(p: Player, desired: Vec2, dt: number, maxV: number): void {
  const dv = sub(desired, p.vel)
  const dvLen = len(dv)
  const maxDv = p.accel * dt // per-player acceleration (AcceleRATE archetype)
  if (dvLen > maxDv) p.vel = add(p.vel, scale(scale(dv, 1 / dvLen), maxDv))
  else p.vel = desired
  const sp = len(p.vel)
  if (sp > maxV) p.vel = scale(p.vel, maxV / sp)
  integratePos(p, dt)
}

function separate(world: World): void {
  const r = PLAYER.RADIUS * 2.4
  const r2 = r * r
  const owner = world.ball.owner
  for (let i = 0; i < world.players.length; i++) {
    for (let j = i + 1; j < world.players.length; j++) {
      const a = world.players[i], b = world.players[j]
      const d2 = dist2(a.pos, b.pos)
      if (d2 < r2 && d2 > 1e-5) {
        const d = Math.sqrt(d2)
        const overlap = r - d
        const nx = (a.pos.x - b.pos.x) / d, nz = (a.pos.z - b.pos.z) / d
        let wa = 0.5, wb = 0.5
        if (a.id === owner) { wa = 0; wb = 1 } else if (b.id === owner) { wa = 1; wb = 0 }
        a.pos.x += nx * overlap * wa; a.pos.z += nz * overlap * wa
        b.pos.x -= nx * overlap * wb; b.pos.z -= nz * overlap * wb
      }
    }
  }
}

/**
 * Physical duels / shoulder barge. When two players collide while closing fast, the one with
 * more momentum (mass × speed) shrugs the other off; the loser gets a brief stagger. This makes
 * shielding meaningful and produces the shoulder-to-shoulder foot races FC players love.
 */
function physicalDuels(world: World): void {
  const r = PLAYER.RADIUS * 2.4
  for (let i = 0; i < world.players.length; i++) {
    for (let j = i + 1; j < world.players.length; j++) {
      const a = world.players[i], b = world.players[j]
      if (a.team === b.team) continue // only contest opponents
      const d = dist(a.pos, b.pos)
      if (d > r || d < 1e-4) continue
      const nx = (b.pos.x - a.pos.x) / d, nz = (b.pos.z - a.pos.z) / d
      // closing speed along the contact normal
      const closing = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz
      if (closing < BARGE.REL_SPEED) continue
      const carrier = world.ball.owner
      // a shielding carrier defends his body; otherwise raw momentum decides
      const ma = a.mass * (1 + len(a.vel) * 0.1) * (a.shield > 0 && a.id === carrier ? 1.4 : 1)
      const mb = b.mass * (1 + len(b.vel) * 0.1) * (b.shield > 0 && b.id === carrier ? 1.4 : 1)
      let loser: Player | null = null
      if (ma > mb * BARGE.MARGIN) loser = b
      else if (mb > ma * BARGE.MARGIN) loser = a
      if (!loser || loser.stagger > 0) continue
      loser.stagger = BARGE.STAGGER
      loser.vel = scale(loser.vel, 0.5)
    }
  }
}

function updatePlayerAnim(world: World, p: Player, dt: number): void {
  const sp = len(p.vel)
  p.runPhase += sp * dt * 2.6
  p.lunge = moveToward(p.lunge, 0, dt * 2.4)
  p.recover = Math.max(0, p.recover - dt)
  p.stagger = Math.max(0, p.stagger - dt)
  p.actCd = Math.max(0, p.actCd - dt)
  p.protect = Math.max(0, p.protect - dt)
  p.settle = Math.max(0, p.settle - dt)
  p.trapT = Math.max(0, p.trapT - dt)
  p.headT = Math.max(0, p.headT - dt)
  p.scoopT = Math.max(0, p.scoopT - dt)
  p.throwInT = Math.max(0, p.throwInT - dt)
  p.runTimer = Math.max(0, p.runTimer - dt)
  p.runCd = Math.max(0, p.runCd - dt)
  p.throwT = Math.max(0, p.throwT - dt)
  p.jockey = Math.max(0, p.jockey - dt)
  p.shield = Math.max(0, p.shield - dt)
  p.pressT = Math.max(0, p.pressT - dt)
  p.skillT = Math.max(0, p.skillT - dt)
  if (p.skillT <= 0) p.skillKind = 0
  p.juke = moveToward(p.juke, 0, dt * 2.2)
  p.dive = moveToward(p.dive, 0, dt * 1.6)
  // committed slide → impose the recovery the instant the slide ends
  const wasSliding = p.slideT > 0
  p.slideT = Math.max(0, p.slideT - dt)
  if (wasSliding && p.slideT <= 0) p.recover = Math.max(p.recover, TACKLE.SLIDE.recover)

  // facing: an explicit faceLock (jockey / strafe / shield) overrides the velocity-follow,
  // which is what unlocks jockeying, shielding and strafe-dribbling.
  let targetFacing: number
  if (p.faceLock != null) {
    targetFacing = p.faceLock
  } else if (p.isGK && world.ball.owner === p.id) {
    const dir = attackDirOf(world, p.team)
    targetFacing = dir === 1 ? 0 : Math.PI
  } else if (sp > 0.4) {
    targetFacing = headingOf(p.vel)
  } else {
    targetFacing = p.facing
    const toBall = sub({ x: world.ball.pos.x, z: world.ball.pos.z }, p.pos)
    if (len(toBall) > 0.2) targetFacing = headingOf(toBall)
  }
  // momentum: turning is sluggish at a full sprint — but jockeying stays nimble so you can
  // mirror an attacker's cuts.
  const nimble = p.faceLock != null || p.jockey > 0
  const turnRate = PLAYER.TURN_RATE * (p.sprinting && !nimble ? 0.5 : 1)
  p.facing += angleDelta(p.facing, targetFacing) * Math.min(1, dt * turnRate)
}

// ---------------------------------------------------------------------------
// Human on-ball / off-ball actions
function humanActions(world: World, p: Player, input: Input, dt: number): void {
  const haveBall = world.ball.owner === p.id

  // a shot is mid wind-up → a second Q tap near contact = a timed finish; block other actions
  if (world.pendingShot && world.pendingShot.id === p.id) {
    if (input.shootPressed && world.pendingShot.t <= SHOT.TIMED_WINDOW) world.pendingShot.timed = true
    return
  }

  // KEEPER with the ball: Space = throw to a team-mate, Q = punt.
  if (haveBall && p.isGK) {
    world.shotCharge = 0
    world.passCharge = 0
    if (input.passReleased) {
      // distribute to the BEST open team-mate up the pitch (keeper handling drives accuracy).
      // Holding a direction only nudges the choice that way; it never overrides a better ball.
      const aim = len(world.humanMove) > 0.3 ? norm(world.humanMove) : null
      gkThrow(world, p, aim)
      world.manualSwitch = 0.4
      return
    }
    if (input.shootReleased || input.clearPressed) { gkClear(world, p); world.manualSwitch = 0.4; return }
    return
  }

  if (haveBall) {
    // ---- ATTACK ----
    // F = cross / ball into the box. Picks out the best runner attacking the area and whips it in
    // (bends toward the goal). Works from anywhere — no need to be on the byline.
    if (input.cross) { doCross(world, p); world.shotCharge = 0; world.passCharge = 0; world.manualSwitch = 0.4; return }
    // E = through ball (defence-splitting, seeks a runner and leads him).
    if (input.through) { doThroughSeek(world, p); world.shotCharge = 0; world.passCharge = 0; world.manualSwitch = 0.4; return }
    // Q = shoot (charge → release). Shift = finesse; full charge = power shot.
    if (input.shootHeld) world.shotCharge = clamp(world.shotCharge + dt / SHOT.CHARGE_TIME, 0, 1)
    if (input.shootReleased) {
      const charge = Math.max(0.2, world.shotCharge)
      const finesse = input.jockey || charge <= SHOT.FINESSE_CHARGE
      const power = !finesse && charge >= SHOT.POWER_CHARGE
      armShot(world, p, charge, input.aimX, { finesse, power })
      world.shotCharge = 0; world.passCharge = 0; world.manualSwitch = 0.4
      return
    }
    // Space = pass (hold to loft / cross).
    if (input.passHeld) world.passCharge = clamp(world.passCharge + dt / PASS.CHARGE_TIME, 0, 1)
    if (input.passReleased) { doContextPass(world, p, world.passCharge); world.passCharge = 0; return }
    // skill moves
    if (input.stepover) { skillMove(world, p, 1, input.aimX >= 0 ? 1 : -1); return }
    if (input.ballRoll) { skillMove(world, p, 2, input.aimX >= 0 ? 1 : -1); return }
    if (input.roulette) { skillMove(world, p, 4, 1); return }
    if (input.dragback) { skillMove(world, p, 3, 1); return }
    // ←/→ = knock-and-go dribble cut (read the defender — the side you pick matters)
    if (input.switchLeft) { dribbleMove(world, p, -1) }
    else if (input.switchRight) { dribbleMove(world, p, 1) }
  } else {
    // ---- DEFENSE ----
    world.shotCharge = 0; world.passCharge = 0
    // hold Q = second-man press: conduct the nearest team-mate to charge the carrier.
    if (input.shootHeld) conductSecondManPress(world, p)
    if (p.recover > 0 || p.slideT > 0) return
    if (input.slide) { startSlide(world, p); return } // F = committed slide tackle
    if (input.skill) { defensiveMove(world, p, TACKLE.STEAL, false) } // R = standing tackle
  }
}

/** Arm a shot with a brief wind-up (enables timed finishing + power-shot weight). */
function armShot(
  world: World,
  p: Player,
  charge: number,
  aimX: number,
  opts: { finesse?: boolean; power?: boolean; chip?: boolean; volley?: boolean },
): void {
  const t = opts.power ? SHOT.WINDUP_POWER : SHOT.WINDUP
  const shot: PendingShot = {
    id: p.id, charge, aimX,
    finesse: !!opts.finesse, power: !!opts.power, chip: !!opts.chip, volley: !!opts.volley,
    t, timedArmed: true, timed: false,
  }
  world.pendingShot = shot
  p.faceLock = headingOf(sub(attackingGoal(world, p.team), p.pos))
}

/** Tick a winding-up shot; fire it at contact (or cancel if the striker lost the ball). */
function stepPendingShot(world: World, dt: number): void {
  const ps = world.pendingShot
  if (!ps) return
  const striker = getById(world, ps.id)
  if (!striker || world.ball.owner !== striker.id) { world.pendingShot = null; return }
  ps.t -= dt
  if (ps.t > 0) return
  world.pendingShot = null
  doShot(world, striker, ps.charge, ps.aimX, {
    finesse: ps.finesse, power: ps.power, chip: ps.chip, volley: ps.volley, timed: ps.timed,
  })
  world.shotCharge = 0
}

/** Hold-Q second-man press: send the nearest covering team-mate to hound the carrier. */
function conductSecondManPress(world: World, controlled: Player): void {
  const carrier = getById(world, world.ball.owner)
  if (!carrier || carrier.team === 'you') return
  let best: Player | null = null
  let bd = Infinity
  for (const m of world.players) {
    if (m.team !== 'you' || m.isGK || m.id === controlled.id) continue
    const d = dist2(m.pos, carrier.pos)
    if (d < bd) { bd = d; best = m }
  }
  if (best) best.pressT = SECOND_MAN.DURATION
}

/** Begin a committed slide tackle: a scripted slide along the defender's facing. */
function startSlide(world: World, p: Player): void {
  const toBall = sub({ x: world.ball.pos.x, z: world.ball.pos.z }, p.pos)
  if (len(toBall) > 0.2) p.facing = headingOf(toBall)
  const f = dirFromHeading(p.facing)
  p.vel = scale(f, SLIDE.SPEED)
  p.slideT = SLIDE.DURATION
  p.lunge = Math.max(p.lunge, 1)
  // immediate attempt if already in range (the slide's long reach is the reward)
  const carrier = getById(world, world.ball.owner)
  if (carrier && carrier.team !== p.team) {
    p.actCd = 0.2
    tryTackle(world, p, carrier, TACKLE.SLIDE)
  }
}

/**
 * Skill move. 1 = step-over (feint), 2 = ball roll (lateral shift), 3 = drag-back (reverse out
 * of pressure), 4 = roulette (360 protect-spin). Each routes through the protect/burst system,
 * so a good move buys a beat and steal-immunity. `side` is the screen-relative direction.
 */
function skillMove(world: World, p: Player, kind: number, side: 1 | -1): void {
  if (p.actCd > 0) return
  p.actCd = SKILL.COOLDOWN
  p.skillKind = kind
  const dir = attackDirOf(world, p.team)
  const b = world.ball
  if (kind === 1) {
    // step-over: a feint — no ball movement, shifts the read and buys immunity
    p.skillT = 0.4
    p.juke = side
    p.protect = Math.max(p.protect, SKILL.STEPOVER_PROTECT)
  } else if (kind === 2) {
    // ball roll: quick lateral shift of the ball/body under the sole (screen-relative → world)
    p.skillT = 0.4
    p.juke = side
    const worldSide = -dir * side // screen-right maps to world x of sign -dir
    b.pos.x = clamp(b.pos.x + worldSide * SKILL.BALLROLL_SHIFT, -FIELD.HALF_W + 0.3, FIELD.HALF_W - 0.3)
    p.protect = Math.max(p.protect, SKILL.BALLROLL_PROTECT)
  } else if (kind === 3) {
    // drag-back: pull the ball back and turn out of pressure
    p.skillT = 0.45
    const back = scale(dirFromHeading(p.facing), -SKILL.DRAGBACK_BACK)
    b.pos.x += back.x; b.pos.z += back.z
    p.facing += Math.PI
    p.protect = Math.max(p.protect, SKILL.DRAGBACK_PROTECT)
  } else {
    // roulette: spin on the spot — the strongest escape, but it slows you afterward
    p.skillT = 0.6
    p.protect = Math.max(p.protect, SKILL.ROULETTE_PROTECT)
    p.recover = Math.max(p.recover, SKILL.ROULETTE_SLOW)
  }
  // a skill move leaves the nearest tight defender briefly for dead
  const def = nearestOpp(world, p.team, p.pos)
  if (def && dist(def.pos, p.pos) < 2.6) def.recover = Math.max(def.recover, DRIBBLE.beatRecover * 0.7)
}

/** Directional dribble cut (←/→). Reading the defender's side is the skill. */
function dribbleMove(world: World, p: Player, side: 1 | -1): void {
  if (p.actCd > 0) return
  p.actCd = DRIBBLE.cooldown
  const dir = attackDirOf(world, p.team)
  const def = nearestOpp(world, p.team, p.pos)
  const close = def ? dist(def.pos, p.pos) : 99
  const dfn = close < 4 ? q(def!.attrs.defending) : 0
  const skill = q(p.attrs.dribbling)
  let prob = DRIBBLE.base + (skill - dfn) * DRIBBLE.ratingSwing
  if (def && close < 4) {
    const defSide = Math.sign(-(def.pos.x - p.pos.x) * dir)
    if (defSide !== 0) {
      if (side !== defSide) prob += DRIBBLE.AWAY_BONUS
      else prob -= DRIBBLE.INTO_PENALTY
    }
    if (close < 1.6) prob -= DRIBBLE.JAMMED
  }
  prob = clamp(prob, 0.05, 0.95)
  p.juke = side
  p.lunge = Math.max(p.lunge, 0.5)
  if (world.rng() < prob) {
    p.protect = DRIBBLE.protect
    if (def && close < 4) def.recover = Math.max(def.recover, DRIBBLE.beatRecover)
  } else {
    p.protect = 0.05
  }
}

/** Pass with hold-charge: tap = ground pass, hold = lofted pass, full hold = cross. */
function doContextPass(world: World, p: Player, charge: number): void {
  if (crossingSpot(world, p) && boxRunnerExists(world, p)) { doCross(world, p); return }
  const target = pickPassTarget(world, p)
  if (!target) {
    const face = dirFromHeading(p.facing)
    doLobPass(world, p, add(p.pos, scale(face, 12)), charge)
    return
  }
  if (charge < 0.28) { doPass(world, p, target.pos, target.vel); return }
  if (charge > 0.72 && Math.abs(p.pos.x) > FIELD.HALF_W - 7) { doCross(world, p); return }
  doLobPass(world, p, add(target.pos, scale(target.vel, PASS.LEAD)), charge)
}

function boxRunnerExists(world: World, p: Player): boolean {
  const dir = attackDirOf(world, p.team)
  const goal = attackingGoal(world, p.team)
  for (const m of world.players) {
    if (m.team !== p.team || m.isGK || m.id === p.id) continue
    const toGoalLine = (goal.z - m.pos.z) * dir
    if (toGoalLine < FIELD.BOX_DEPTH + 6 && toGoalLine > -1 && Math.abs(m.pos.x) < FIELD.BOX_HALF_W + 2) return true
  }
  return false
}

/** Execute a tackle archetype: face the ball, lunge, attempt to win it, optionally clear. */
function defensiveMove(
  world: World,
  p: Player,
  t: { reach: number; lunge: number; bonus: number; recover: number; nudge: number },
  clearAfter: boolean,
): void {
  const toBall = sub({ x: world.ball.pos.x, z: world.ball.pos.z }, p.pos)
  if (len(toBall) > 0.2) p.facing = headingOf(toBall)
  const lungeDir = dirFromHeading(p.facing)
  p.pos = add(p.pos, scale(lungeDir, t.nudge))
  p.lunge = Math.max(p.lunge, t.lunge + 0.4)
  p.recover = Math.max(p.recover, t.recover)
  const carrier = getById(world, world.ball.owner)
  let won = false
  if (carrier && carrier.team !== p.team) {
    won = tryTackle(world, p, carrier, t)
  } else if (!carrier && dist(p.pos, { x: world.ball.pos.x, z: world.ball.pos.z }) < BALL.CONTROL_R + t.reach && world.ball.pos.y < 1.0) {
    world.ball.owner = p.id
    world.ball.lastTouch = p.id
    world.ball.lastTeam = p.team
    world.ball.vel = { x: 0, y: 0, z: 0 }
    won = true
  }
  if (won && clearAfter) doClear(world, p)
}

function pickPassTarget(world: World, p: Player): Player | null {
  const dir = attackDirOf(world, p.team)
  // INTENT: for the human, the left stick (move direction) picks the recipient — pass to whoever
  // you're pointing at, FC-style. Fall back to body facing when the stick is neutral or for the AI.
  const human = p.id === world.controlledId
  const aim = human && len(world.humanMove) > 0.3 ? norm(world.humanMove) : dirFromHeading(p.facing)
  const mates = world.players.filter((m) => m.team === p.team && m.id !== p.id && !m.isGK)
  let best: Player | null = null
  let bestScore = -Infinity
  let nearest: Player | null = null
  let nearestD = Infinity
  for (const m of mates) {
    const to = sub(m.pos, p.pos)
    const d = len(to)
    if (d < 2 || d > 42) continue
    if (d < nearestD) { nearestD = d; nearest = m }
    const align = (to.x * aim.x + to.z * aim.z) / d // cosine of angle to the intended direction
    const forward = (m.pos.z - p.pos.z) * dir
    const marker = nearestOpp(world, p.team, m.pos)
    const open = marker ? Math.min(dist(marker.pos, m.pos), 8) : 8
    const blocked = opponentInLane(world, p, m.pos, PASS.LANE_R)
    // BEST PASS leads: a team-mate in space, advancing play, with a clear lane is preferred. Your
    // stick direction is only a TIEBREAKER — it nudges toward who you're pointing at when two
    // options are close in quality, rather than overriding an obviously better ball.
    let score = open * 1.3 + forward * 0.35 - d * 0.05 + align * 2.5
    if (blocked) score -= 8
    if (align < -0.45) score -= 3 // still don't fire at someone clearly behind your aim
    if (score > bestScore) { bestScore = score; best = m }
  }
  return best ?? nearest
}

function opponentInLane(world: World, passer: Player, target: Vec2, r: number): boolean {
  const ax = passer.pos.x, az = passer.pos.z
  const bx = target.x, bz = target.z
  const dx = bx - ax, dz = bz - az
  const segLen2 = dx * dx + dz * dz || 1
  for (const o of world.players) {
    if (o.team === passer.team || o.isGK) continue
    const t = ((o.pos.x - ax) * dx + (o.pos.z - az) * dz) / segLen2
    if (t < 0.08 || t > 0.98) continue
    const px = ax + dx * t, pz = az + dz * t
    if (Math.hypot(o.pos.x - px, o.pos.z - pz) < r) return true
  }
  return false
}

function nearestOpp(world: World, team: TeamId, at: Vec2): Player | null {
  let best: Player | null = null
  let bd = Infinity
  for (const o of world.players) {
    if (o.team === team || o.isGK) continue
    const d = dist2(o.pos, at)
    if (d < bd) { bd = d; best = o }
  }
  return best
}

/**
 * Contact contest — symmetric both ways. A shielding carrier (back to the defender, ball on
 * the far side) is much harder to dispossess, scaled by his strength vs the defender's.
 */
function contestPossession(world: World, dt: number): void {
  const carrier = getById(world, world.ball.owner)
  if (!carrier || carrier.isGK) return
  if (carrier.protect > 0 || carrier.settle > 0) return
  const carDir = attackDirOf(world, carrier.team)
  for (const d of world.players) {
    if (d.team === carrier.team || d.isGK || d.recover > 0) continue
    if (dist(d.pos, carrier.pos) > BALL.CONTROL_R + CONTEST.range) continue
    d.actCd -= dt
    if (d.actCd > 0) continue
    d.actCd = CONTEST.interval
    let prob = CONTEST.base + (q(d.attrs.defending) - q(carrier.attrs.dribbling)) * CONTEST.ratingSwing
    if (len(carrier.vel) > topSpeed(carrier.attrs.pace, false)) prob += CONTEST.sprintInto
    // POSITIONING GATE: a clean steal needs the defender goal-side of the carrier OR planted in his
    // travel lane. A poke from behind / a bad angle rarely wins it — possession is earned by position,
    // not a contact coin-flip (so traffic stops feeling pinbally).
    const toD = sub(d.pos, carrier.pos)
    const goalSide = toD.z * carDir > -CONTEST.GOAL_SIDE_EPS
    const cvLen = len(carrier.vel)
    const inLane = cvLen > 0.6 && (carrier.vel.x * toD.x + carrier.vel.z * toD.z) / (cvLen * (len(toD) || 1)) > CONTEST.LANE_DOT
    if (!goalSide && !inLane) prob *= CONTEST.POOR_POS_MULT
    if (carrier.shield > 0) {
      // shielding: resist the steal, more so for a stronger carrier
      prob *= SHIELD.CONTEST_RESIST * clamp(d.mass / carrier.mass, 0.6, 1.2)
    }
    prob = clamp(prob, 0.04, 0.92)
    if (world.rng() < prob) {
      world.ball.owner = d.id
      world.ball.lastTouch = d.id
      world.ball.lastTeam = d.team
      world.ball.takeCooldown = 0.1
      world.ball.vel = { x: 0, y: 0, z: 0 }
      world.ball.pos = { x: d.pos.x, y: BALL.R, z: d.pos.z }
      carrier.recover = Math.max(carrier.recover, 0.55)
      carrier.protect = 0
      carrier.settle = 0
      d.lunge = Math.max(d.lunge, 0.5)
      d.settle = Math.max(d.settle, TOUCH.SETTLE)
      return
    }
  }
}

/**
 * Goalkeeping. Predicts where a goal-bound ball crosses the line and dives. Saves now come in
 * variety: catch, parry wide, save-with-the-feet (low/near), tip over the bar (high → corner),
 * smother at feet (1v1), and the occasional spill into danger (a GK error).
 */
function goalkeeping(world: World, _dt: number): void {
  const b = world.ball
  if (b.owner) return
  for (const gk of world.players) {
    if (!gk.isGK) continue
    const dir = attackDirOf(world, gk.team)
    const line = -dir * (FIELD.HALF_L - 0.5)

    const flat = Math.hypot(b.vel.x, b.vel.z)
    const dToBall = dist(gk.pos, { x: b.pos.x, z: b.pos.z })
    const stillInPlay = Math.abs(b.pos.z) < FIELD.HALF_L - 0.05

    // smother at feet on a 1v1: an opponent is bearing down on a slowish ball at the keeper's feet
    if (stillInPlay && b.takeCooldown <= 0 && b.pos.y < GK.FEET_H && dToBall < GK.SMOTHER_R && flat < GK.CLAIM_SPEED + 4) {
      const striker = nearestOpp(world, gk.team, gk.pos)
      if (striker && dist(striker.pos, { x: b.pos.x, z: b.pos.z }) < 2.2) {
        claim(world, gk); gk.lunge = Math.max(gk.lunge, 0.8); continue
      }
    }
    // gather a handleable loose ball in the area
    if (stillInPlay && b.takeCooldown <= 0 && b.pos.y < 1.9 && dToBall < GK.CLAIM_R && flat < GK.CLAIM_SPEED) {
      claim(world, gk); gk.lunge = Math.max(gk.lunge, 0.5); continue
    }

    const toLine = line - b.pos.z
    if (Math.sign(b.vel.z) !== Math.sign(-dir) || Math.abs(b.vel.z) < 1) continue
    const t = toLine / b.vel.z
    if (t <= 0 || t > 1.5) continue
    const crossX = b.pos.x + b.vel.x * t
    const crossY = b.pos.y + b.vel.y * t - 0.5 * BALL.GRAVITY * t * t
    if (Math.abs(crossX) > FIELD.GOAL_HALF_W + 1.4 || crossY > FIELD.GOAL_H + 0.5) continue
    const near = Math.abs(b.pos.z - line)
    if (near > 2.4 && t > 0.28) continue
    const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z)
    const reach = GK.baseReach + q(gk.attrs.gk) * GK.reachGain
    const dx = Math.abs(crossX - gk.pos.x)
    gk.dive = clamp((crossX - gk.pos.x) / 2.0, -1, 1)
    gk.lunge = Math.max(gk.lunge, 1)
    gk.recover = Math.max(gk.recover, 0.4)

    if (b.goalboundResolved || crossY > FIELD.GOAL_H + 0.15) continue
    b.goalboundResolved = true
    if (dx > reach) continue // physically can't reach it → in

    const stretch = dx / reach
    const cornerX = Math.min(1, Math.abs(crossX) / FIELD.GOAL_HALF_W)
    const high = clamp(crossY / FIELD.GOAL_H, 0, 1)
    let saveProb =
      0.6 + q(gk.attrs.gk) * 0.45 - stretch * 0.3 - cornerX * 0.2 - high * 0.18 - clamp((speed - 16) / 50, 0, 0.18)
    saveProb = clamp(saveProb, 0.05, 0.96)
    if (world.rng() >= saveProb) continue // beaten

    // ---- save made: choose the TYPE by where/how hard it was ----
    const error = world.rng() < GK.ERROR_CHANCE // occasional spill into danger
    if (crossY >= GK.TIP_H) {
      // tip it over the bar → out for a corner
      b.owner = null
      b.lastTouch = gk.id
      b.lastTeam = gk.team
      b.takeCooldown = 0.3
      b.vel = { x: (gk.pos.x >= 0 ? -1 : 1) * 2, y: 8, z: -dir * 3 }
      b.spin = { x: 0, y: 0, z: 0 }
      world.kickPulse++
    } else if (!error && speed < GK.catchSpeed && crossY < 1.7) {
      // clean catch (or a low save-with-the-feet that he gathers)
      claim(world, gk)
    } else {
      // parry: wide and away normally; on an error, spilled back into danger
      b.owner = null
      b.lastTouch = gk.id
      b.lastTeam = gk.team
      b.takeCooldown = 0.3
      const side = gk.pos.x >= 0 ? -1 : 1
      if (error) b.vel = { x: side * 4, y: 2, z: dir * 3 } // spilled in front of goal — danger!
      else b.vel = { x: side * GK.parrySpeed, y: 3.5, z: dir * 7 }
      b.spin = { x: 0, y: 0, z: 0 }
      world.kickPulse++
    }
  }
}

/** Keeper gathers the ball and scoops it up off the turf into his hands (see the GK branch of stepBall). */
function claim(world: World, gk: Player): void {
  const b = world.ball
  b.owner = gk.id
  b.lastTouch = gk.id
  b.lastTeam = gk.team
  b.vel = { x: 0, y: 0, z: 0 }
  b.spin = { x: 0, y: 0, z: 0 }
  // leave the ball roughly where it was gathered (low) so the scoop animation draws it up — no teleport
  b.pos.y = Math.max(BALL.R, Math.min(b.pos.y, 0.9))
  b.takeCooldown = 0.2
  gk.scoopT = GK.SCOOP_TIME
  gk.reactTimer = GK.HOLD_TIME + GK.SCOOP_TIME // don't distribute mid-scoop
  gk.lunge = Math.max(gk.lunge, 0.4)
}

// ---------------------------------------------------------------------------
// Ball
function stepBall(world: World, dt: number): void {
  const b = world.ball
  b.takeCooldown = Math.max(0, b.takeCooldown - dt)
  b.prev = { x: b.pos.x, y: b.pos.y, z: b.pos.z }

  const owner = getById(world, b.owner)
  if (owner) {
    if (owner.isGK) {
      const f = dirFromHeading(owner.facing)
      const handX = owner.pos.x + f.x * 0.32
      const handZ = owner.pos.z + f.z * 0.32
      if (owner.scoopT > 0) {
        // scoop: draw the ball in toward the keeper and lift it off the turf into the hands
        const env = clamp(1 - owner.scoopT / GK.SCOOP_TIME, 0, 1)
        const k = Math.min(1, dt * 12)
        b.pos.x += (handX - b.pos.x) * k
        b.pos.z += (handZ - b.pos.z) * k
        b.pos.y = lerp(BALL.R, 1.3, env)
      } else {
        b.pos.x = handX
        b.pos.z = handZ
        b.pos.y = 1.3
      }
      b.vel = { x: 0, y: 0, z: 0 }
      return
    }
    // throw-in: the taker holds the ball above his head until it's released
    if (world.phase === 'restart' && world.restart?.kind === 'throwin') {
      b.pos.x = owner.pos.x
      b.pos.z = owner.pos.z
      b.pos.y = 2.25
      b.vel = { x: 0, y: 0, z: 0 }
      return
    }
    const tightness = 0.7 + 0.3 * q(owner.attrs.dribbling)
    const sprintLoose = len(owner.vel) > topSpeed(owner.attrs.pace, false) + 0.5 ? 1.18 : 1
    const ahead = BALL.DRIBBLE_AHEAD * sprintLoose * (2 - tightness)
    const f = dirFromHeading(owner.facing)
    const targetX = owner.pos.x + f.x * ahead
    const targetZ = owner.pos.z + f.z * ahead
    b.pos.x += (targetX - b.pos.x) * Math.min(1, dt * 14)
    b.pos.z += (targetZ - b.pos.z) * Math.min(1, dt * 14)
    b.pos.y = BALL.R
    b.vel = { x: owner.vel.x, y: 0, z: owner.vel.z }
    return
  }

  // ---- free ball: integrate physics ----
  b.vel.y -= BALL.GRAVITY * dt
  const drag = Math.max(0, 1 - BALL.AIR_DRAG * dt)
  b.vel.x *= drag; b.vel.z *= drag
  // Magnus: a real curve. Lateral/vertical accel ≈ MAGNUS · (spin × velocity). Side-spin bends
  // the flight, top-spin makes a driven shot DIP, back-spin makes a chip FLOAT.
  if (b.pos.y > BALL.R + 0.02) {
    const m = cross3(b.spin, b.vel)
    b.vel.x += BALL.MAGNUS * m.x * dt
    b.vel.y += BALL.MAGNUS * m.y * dt
    b.vel.z += BALL.MAGNUS * m.z * dt
  }
  const decay = Math.max(0, 1 - BALL.SPIN_DECAY * dt)
  b.spin.x *= decay; b.spin.y *= decay; b.spin.z *= decay

  b.pos.x += b.vel.x * dt
  b.pos.y += b.vel.y * dt
  b.pos.z += b.vel.z * dt

  if (b.pos.y <= BALL.R) {
    b.pos.y = BALL.R
    if (b.vel.y < -0.4) b.vel.y = -b.vel.y * BALL.BOUNCE
    else b.vel.y = 0
    const horiz = Math.hypot(b.vel.x, b.vel.z)
    if (horiz > 0) {
      const dec = BALL.GROUND_FRICTION * dt
      const nh = Math.max(0, horiz - dec)
      b.vel.x *= nh / horiz; b.vel.z *= nh / horiz
    }
    // spin scrubs off fast once it's rolling on the turf
    b.spin.x *= 0.6; b.spin.z *= 0.6
  }
  const sp = Math.hypot(b.vel.x, b.vel.y, b.vel.z)
  if (sp > BALL.MAX_SPEED) { const s = BALL.MAX_SPEED / sp; b.vel.x *= s; b.vel.y *= s; b.vel.z *= s }

  if (!world.freeze) blockByBodies(world)
  tryCollect(world)
}

/**
 * Defenders block shots/passes with their bodies. Sweep the ball's prev→pos segment against
 * each non-owner outfielder; a low, fast ball that hits a body deflects (with scatter + damping),
 * a slow one is intercepted. Lofted balls (above BLOCK_HEIGHT) sail over. This makes positioning
 * matter and finally makes the AI's lane-avoidance honest.
 */
function blockByBodies(world: World): void {
  const b = world.ball
  if (b.takeCooldown > 0) return
  if (b.pos.y > BALL.BLOCK_HEIGHT && b.prev.y > BALL.BLOCK_HEIGHT) return
  const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z)
  if (speed < 4) return // a gently rolling ball is handled by tryCollect, not a "block"
  const ax = b.prev.x, az = b.prev.z
  const dx = b.pos.x - ax, dz = b.pos.z - az
  const segLen2 = dx * dx + dz * dz
  if (segLen2 < 1e-6) return
  const rad = PLAYER.RADIUS + BALL.R
  let hit: Player | null = null
  let hitT = Infinity
  for (const p of world.players) {
    if (p.id === b.lastTouch) continue // the striker isn't blocked by himself
    // a teammate of the last toucher can still deflect (own bodies in the way), but skip the GK
    // here — the dedicated goalkeeping() dive handles him.
    if (p.isGK) continue
    const t = clamp(((p.pos.x - ax) * dx + (p.pos.z - az) * dz) / segLen2, 0, 1)
    const px = ax + dx * t, pz = az + dz * t
    // height of the ball at that point along the segment
    const py = b.prev.y + (b.pos.y - b.prev.y) * t
    if (py > BALL.BLOCK_HEIGHT) continue
    if (Math.hypot(p.pos.x - px, p.pos.z - pz) < rad && t < hitT) { hit = p; hitT = t }
  }
  if (!hit) return
  // place the ball at the contact point
  b.pos.x = ax + dx * hitT
  b.pos.z = az + dz * hitT
  if (speed >= BALL.BLOCK_FAST) {
    // deflect: reflect roughly back off the blocker with scatter + pace loss
    const away = norm(sub({ x: b.pos.x, z: b.pos.z }, hit.pos))
    const a = (world.rng() - 0.5) * 2 * BALL.BLOCK_SCATTER
    const dir = rot2(away, a)
    const ns = speed * BALL.BLOCK_DAMP
    b.vel = { x: dir.x * ns, y: Math.max(1.5, b.vel.y * 0.4 + 1.5), z: dir.z * ns }
    b.spin = { x: 0, y: (world.rng() - 0.5) * 4, z: 0 }
    b.owner = null
    b.lastTouch = hit.id
    b.lastTeam = hit.team
    b.takeCooldown = 0.12
    hit.lunge = Math.max(hit.lunge, 0.6)
    world.kickPulse++
    world.camShake = Math.min(1, world.camShake + 0.25)
  } else {
    // slow enough to be brought under control → interception
    settleOnto(world, hit, 0.2)
  }
}

/** First eligible player within control range collects a loose ball; mid-air → header/volley. */
function tryCollect(world: World): void {
  const b = world.ball
  if (world.freeze > 0) return // no collecting during kick-off / restart / dead-ball / celebration
  if (b.takeCooldown > 0) return
  if (Math.abs(b.pos.z) >= FIELD.HALF_L) return
  let best: Player | null = null
  let bd = Infinity
  for (const p of world.players) {
    const d = dist2(p.pos, { x: b.pos.x, z: b.pos.z })
    if (d < bd) { bd = d; best = p }
  }
  if (!best) return
  const d = Math.sqrt(bd)
  const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z)
  if (best.isGK && speed > BALL.SHOT_SPEED_THRESHOLD) return
  // aerial header / volley clear
  if (b.pos.y > 1.4 && b.pos.y < 2.6 && d < 1.1 && !best.isGK) {
    headBall(world, best)
    return
  }
  // foot volley: a ball arriving at shin/knee height WITH pace, in an attacking spot → spectacular
  if (b.pos.y >= VOLLEY.MIN_H && b.pos.y <= VOLLEY.MAX_H && d < BALL.CONTROL_R && !best.isGK && speed >= VOLLEY.MIN_SPEED) {
    const dir = attackDirOf(world, best.team)
    const goal = attackingGoal(world, best.team)
    const inShootingRange = (goal.z - best.pos.z) * dir < FIELD.BOX_DEPTH + 4 && Math.abs(best.pos.x) < FIELD.BOX_HALF_W + 2
    if (inShootingRange) {
      best.headT = 0.4 // reuse the leap pose for the volley swing
      doShot(world, best, 0.7, 0, { volley: true })
      return
    }
  }
  // chest-height ball (e.g. a floated pass dropping in): cushion it down with a chest trap, then
  // the player has it at his feet to dribble away.
  if (b.pos.y >= TOUCH.CHEST_MIN && b.pos.y <= 1.5 && d < BALL.CONTROL_R && !best.isGK) {
    settleOnto(world, best, 0.55)
    best.trapT = 0.55
    return
  }
  if (b.pos.y < TOUCH.CHEST_MIN && d < BALL.CONTROL_R) {
    if (!best.isGK && speed > 5) {
      let press2 = Infinity
      for (const o of world.players) if (o.team !== best.team && !o.isGK) press2 = Math.min(press2, dist2(o.pos, best.pos))
      if (press2 < TOUCH.PRESSURE_R * TOUCH.PRESSURE_R) {
        const heavy = clamp(TOUCH.HEAVY_BASE - q(best.attrs.dribbling) * TOUCH.HEAVY_SWING + speed * 0.008, 0.02, 0.45)
        if (world.rng() < heavy) {
          const away = norm({ x: b.vel.x, z: b.vel.z })
          b.owner = null
          b.lastTouch = best.id
          b.lastTeam = best.team
          b.takeCooldown = 0.18
          b.vel = { x: away.x * TOUCH.HEAVY_PUSH, y: 0, z: away.z * TOUCH.HEAVY_PUSH }
          best.lunge = Math.max(best.lunge, 0.3)
          return
        }
      }
    }
    // directional first touch: if the human pushes a direction as he receives, knock the ball
    // into that space and take it into stride (the skilful version of the heavy touch above).
    const human = best.id === world.controlledId && best.team === 'you'
    if (human && !best.isGK && len(world.humanMove) > 0.3) {
      settleOnto(world, best, 0)
      best.facing = headingOf(world.humanMove)
      best.settle = Math.min(best.settle, 0.12) // shorter settle so you can stride away
      best.protect = Math.max(best.protect, 0.18)
      return
    }
    settleOnto(world, best, speed > 6 ? 0.3 : 0)
    if (best.isGK) best.reactTimer = GK.HOLD_TIME
  }
}

function settleOnto(world: World, p: Player, trap: number): void {
  const b = world.ball
  b.owner = p.id
  b.lastTouch = p.id
  b.lastTeam = p.team
  b.vel = { x: 0, y: 0, z: 0 }
  b.spin = { x: 0, y: 0, z: 0 }
  b.pos.y = BALL.R
  if (!p.isGK) p.settle = Math.max(p.settle, TOUCH.SETTLE)
  if (trap > 0) p.trapT = Math.max(p.trapT, trap)
}

function headBall(world: World, p: Player): void {
  const b = world.ball
  const dir = attackDirOf(world, p.team)
  const goal = attackingGoal(world, p.team)
  const head = q(p.attrs.heading)
  const toGoalLine = (goal.z - p.pos.z) * dir
  const attackingHeader = toGoalLine < FIELD.BOX_DEPTH && toGoalLine > -1 && Math.abs(p.pos.x) < FIELD.BOX_HALF_W + 1
  b.owner = null
  b.lastTouch = p.id
  b.lastTeam = p.team
  b.takeCooldown = BALL.TAKE_COOLDOWN
  b.spin = { x: 0, y: 0, z: 0 }
  if (attackingHeader) {
    const corner: Vec2 = { x: (p.pos.x >= 0 ? -1 : 1) * (FIELD.GOAL_HALF_W - 0.4), z: goal.z }
    const ar = (world.rng() - 0.5) * 2 * (1 - head) * 0.14
    const raw = norm(sub(corner, p.pos))
    const ca = Math.cos(ar), sa = Math.sin(ar)
    const aim = { x: raw.x * ca - raw.z * sa, z: raw.x * sa + raw.z * ca }
    const power = 12 + head * 9
    b.vel = { x: aim.x * power, y: -0.5 - head * 1.5, z: aim.z * power }
  } else {
    const aim = norm(sub(goal, p.pos))
    const power = 8 + head * 10
    b.vel = { x: aim.x * power, y: 4 + 0.04 * power, z: aim.z * power }
  }
  world.kickPulse++
  p.lunge = Math.max(p.lunge, 0.7)
  p.headT = 0.55
}

// ---------------------------------------------------------------------------
// Rules
function detectGoal(world: World): void {
  const b = world.ball
  let lineZ = 0
  if (b.prev.z <= FIELD.HALF_L && b.pos.z >= FIELD.HALF_L) lineZ = FIELD.HALF_L
  else if (b.prev.z >= -FIELD.HALF_L && b.pos.z <= -FIELD.HALF_L) lineZ = -FIELD.HALF_L
  else return
  const dz = b.pos.z - b.prev.z
  if (Math.abs(dz) < 1e-6) return
  const tt = clamp((lineZ - b.prev.z) / dz, 0, 1)
  const cx = b.prev.x + (b.pos.x - b.prev.x) * tt
  const cy = b.prev.y + (b.pos.y - b.prev.y) * tt
  if (Math.abs(cx) > FIELD.GOAL_HALF_W || cy > FIELD.GOAL_H || cy < -0.3) return
  const scorer: TeamId = lineZ > 0
    ? (world.youAttackDir === 1 ? 'you' : 'opp')
    : (world.youAttackDir === -1 ? 'you' : 'opp')
  // Rigged intro: the opponent simply cannot score. Their "goal" becomes a save + goal kick to you.
  if (scorer === 'opp' && world.guaranteedWin) {
    world.ball.lastTeam = 'you'
    world.ball.lastTouch = null
    enterDeadball(world, 'goalkick', 'you', { x: 0, z: 0 }, 'Saved!')
    return
  }
  if (scorer === 'you') world.scoreYou++
  else world.scoreOpp++
  world.justScored = scorer
  // the last team-mate of the scoring side to touch it is the scorer → he leads the celebration
  world.scorerId = b.lastTeam === scorer ? b.lastTouch : null
  // Log the goal for the matchday challenge: who scored (your squad slot), how, and from where.
  {
    const sp = world.scorerId ? world.players.find((p) => p.id === world.scorerId) : undefined
    const kind: 'header' | 'volley' | 'foot' = sp && sp.headT > 0 ? 'header' : 'foot'
    // "outside the box" = the scorer was further than the penalty-area depth from the goal line he scored on.
    const outside = sp ? Math.abs(sp.pos.z - lineZ) > FIELD.BOX_DEPTH : false
    const scorerSlot =
      scorer === 'you' && sp
        ? world.players.filter((p) => p.team === 'you').findIndex((p) => p.id === sp.id)
        : null
    world.events.push({ team: scorer, scorerSlot, kind, fromOutsideBox: outside })
  }
  world.phase = 'goal'
  world.freeze = MATCH.GOAL_CELEBRATE
  world.message = scorer === 'you' ? 'GOAL!' : 'Conceded'
  world.shotCharge = 0
  world.pendingShot = null
  world.kickoffLock = null
  world.ball.owner = null
  world.ball.vel = { x: 0, y: 0, z: 0 }
  world.ball.spin = { x: 0, y: 0, z: 0 }
}

function detectOutOfPlay(world: World): void {
  const b = world.ball
  if (Math.abs(b.pos.x) > FIELD.HALF_W) {
    const team: TeamId = b.lastTeam === 'you' ? 'opp' : 'you'
    const at: Vec2 = { x: Math.sign(b.pos.x) * (FIELD.HALF_W - 0.4), z: clamp(b.pos.z, -FIELD.HALF_L + 2, FIELD.HALF_L - 2) }
    enterDeadball(world, 'throwin', team, at, 'Throw-in')
    return
  }
  if (Math.abs(b.pos.z) > FIELD.HALF_L) {
    const lineDir: 1 | -1 = b.pos.z > 0 ? 1 : -1
    const attackingThatLine: TeamId = world.youAttackDir === lineDir ? 'you' : 'opp'
    const last = b.lastTeam ?? attackingThatLine
    if (last === attackingThatLine) {
      const def: TeamId = attackingThatLine === 'you' ? 'opp' : 'you'
      enterDeadball(world, 'goalkick', def, { x: 0, z: 0 }, 'Goal kick')
    } else {
      const at: Vec2 = { x: Math.sign(b.pos.x || 1) * (FIELD.HALF_W - 1), z: lineDir * (FIELD.HALF_L - 0.5) }
      enterDeadball(world, 'corner', attackingThatLine, at, 'Corner')
    }
  }
}

/**
 * Hold the ball dead where it crossed the line for a beat (so the player registers it went out)
 * before the restart is positioned. Stops the ball just outside the line and freezes play briefly.
 */
function enterDeadball(world: World, kind: RestartKind, team: TeamId, at: Vec2, label: string): void {
  const b = world.ball
  b.owner = null
  b.vel = { x: 0, y: 0, z: 0 }
  b.spin = { x: 0, y: 0, z: 0 }
  // park it just over the line where it left the pitch (clamped so it stays on screen)
  b.pos.x = clamp(b.pos.x, -(FIELD.HALF_W + 1.5), FIELD.HALF_W + 1.5)
  b.pos.z = clamp(b.pos.z, -(FIELD.HALF_L + 1.5), FIELD.HALF_L + 1.5)
  b.pos.y = BALL.R
  world.pendingRestart = { kind, team, at }
  world.phase = 'deadball'
  world.freeze = MATCH.OUT_PAUSE
  world.message = label
  world.pendingShot = null
  world.kickoffLock = null
}

// ---------------------------------------------------------------------------
// Clock + phase machine
function stepClockAndPhase(world: World, dt: number): void {
  if (world.manualSwitch > 0) world.manualSwitch = Math.max(0, world.manualSwitch - dt)
  if (world.camShake > 0) world.camShake = Math.max(0, world.camShake - dt * 3.2)

  if (world.freeze > 0) {
    world.freeze -= dt
    if (world.freeze <= 0) {
      world.freeze = 0
      if (world.phase === 'goal') {
        const conceding: TeamId = world.justScored === 'you' ? 'opp' : 'you'
        world.justScored = null
        world.scorerId = null
        resetForKickoff(world, conceding)
        world.message = 'Kick-off'
      } else if (world.phase === 'deadball' && world.pendingRestart) {
        // the dead-ball pause elapsed → now position the restart (which freezes briefly itself)
        const r = world.pendingRestart
        world.pendingRestart = null
        const kind = r.kind === 'goalkick' || r.kind === 'corner' ? r.kind : 'throwin'
        setupRestart(world, kind, r.team, r.at)
      } else if (world.phase === 'kickoff' || world.phase === 'restart') {
        if (world.restart?.kind === 'goalkick') {
          const gk = getById(world, world.ball.owner)
          if (gk && gk.isGK && world.restart.team !== 'you') gkClear(world, gk)
        } else if (world.restart?.kind === 'corner') {
          const taker = getById(world, world.ball.owner)
          if (taker) doCross(world, taker)
        } else if (world.restart?.kind === 'throwin' && world.restart.team !== 'you') {
          const taker = getById(world, world.ball.owner)
          if (taker) doThrowIn(world, taker)
        }
        world.phase = 'play'
        world.message = null
        world.restart = null
      }
    }
    return
  }

  if (world.phase !== 'play') return
  world.clockMs += dt * 1000
  const halfMs = (world.halfSeconds || MATCH.HALF_SECONDS) * 1000
  const t = clamp(world.clockMs / halfMs, 0, 1)
  world.displayMin = Math.floor(t * 45) + (world.half === 2 ? 45 : 0)

  if (world.clockMs >= halfMs) {
    if (world.half === 1) {
      world.half = 2
      world.clockMs = 0
      world.youAttackDir = (world.youAttackDir === 1 ? -1 : 1) as 1 | -1
      resetForKickoff(world, 'opp')
      world.message = 'Second half'
    } else {
      // Rigged intro: never let the player walk away without the win.
      if (world.guaranteedWin && world.scoreYou <= world.scoreOpp) {
        world.scoreYou = world.scoreOpp + 1
      }
      world.phase = 'fulltime'
      world.message = 'Full time'
      world.ball.owner = null
      world.ball.vel = { x: 0, y: 0, z: 0 }
    }
  }
}
