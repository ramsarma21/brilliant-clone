import type { Squad } from '../../types'
import type { Attributes, Ball, Player, Role, Tactics, TeamId, World } from '../types'
import { FIELD, MATCH } from '../config'
import { clamp, dist2, makeRng, type Vec2 } from '../math'
import { teamOverall } from '../../lib/squad'
import { archetypeFor, attrsForRole, attrsFromGk, attrsFromSkills, massFor, opponentStrength } from '../ratings'

// 7-a-side: GK + 7 outfield in a 2-3-2. Base positions are for a team attacking +z
// (own goal at -z); a team attacking -z mirrors z. The star FWD (num 10) is YOU.
type Slot = { role: Role; base: Vec2; num: number; star?: boolean }
const FORMATION: Slot[] = [
  { role: 'GK', base: { x: 0, z: -30 }, num: 1 },
  { role: 'DEF', base: { x: -8, z: -20 }, num: 2 },
  { role: 'DEF', base: { x: 8, z: -20 }, num: 5 },
  { role: 'MID', base: { x: -13, z: -8 }, num: 7 },
  { role: 'MID', base: { x: 0, z: -9 }, num: 6 },
  { role: 'MID', base: { x: 13, z: -8 }, num: 8 },
  { role: 'FWD', base: { x: -7, z: 7 }, num: 9 },
  { role: 'FWD', base: { x: 7, z: 7 }, num: 10, star: true },
]

/** Mirror a base formation position into world space for a team attacking `dir`. */
function worldHome(base: Vec2, dir: 1 | -1): Vec2 {
  return { x: base.x, z: base.z * dir }
}

/** Per-player attributes for YOUR squad member at formation slot `i` (or null for the synth opponent). */
function youAttrsForSlot(squad: Squad, i: number): Attributes {
  const p = squad[i]
  if (!p) return attrsForRole(50, FORMATION[i].role)
  return p.role === 'GK' ? attrsFromGk(p.gk) : attrsFromSkills(p.stats)
}

/**
 * A "minnow" attribute block — genuinely terrible across the board (single digits to
 * low-teens), bypassing the normal 20 floor. Used for the underdog INTRO opponent so a
 * brand-new player is practically guaranteed to win: this side can't dribble, pass, shoot
 * or (for the keeper) save with any competence.
 */
function minnowAttrs(role: Role, rng: () => number): Attributes {
  const low = () => Math.round(2 + rng() * 5) // 2..7 — genuinely hopeless
  return {
    pace: low(),
    shooting: low(),
    passing: low(),
    dribbling: low(),
    defending: low(),
    heading: low(),
    // Even the keeper is hapless (rock-bottom reach → can't save anything).
    gk: role === 'GK' ? Math.round(2 + rng() * 4) : low(),
    // Just enough stamina to amble around so the match still plays out.
    stamina: Math.round(22 + rng() * 10),
  }
}

function buildTeam(
  team: TeamId,
  dir: 1 | -1,
  squad: Squad | null,
  oppOverall: number,
  rng: () => number,
  minnow = false,
): Player[] {
  // YOUR club: every player has his OWN rated attribute block (FIFA-Ultimate-Team style).
  // The opponent is synthesised by role around their team overall (or as a hapless minnow).
  return FORMATION.map((slot, i) => {
    const attrs: Attributes = squad
      ? youAttrsForSlot(squad, i)
      : minnow
        ? minnowAttrs(slot.role, rng)
        : attrsForRole(oppOverall, slot.role, Math.round((rng() - 0.5) * 8))
    const home = worldHome(slot.base, dir)
    const arch = archetypeFor(attrs)
    // Minnows are slow as mud: gut their acceleration and top-end so they trail every duel.
    const accel = minnow ? arch.accel * 0.45 : arch.accel
    const topMult = minnow ? 0.5 : arch.topMult
    return {
      id: `${team}-${i}`,
      team,
      role: slot.role,
      isGK: slot.role === 'GK',
      num: slot.num,
      attrs,
      pos: { ...home },
      vel: { x: 0, z: 0 },
      facing: dir === 1 ? 0 : Math.PI,
      homePos: home,
      accel,
      topMult,
      archetype: arch.archetype,
      mass: massFor(attrs),
      runPhase: rng() * Math.PI * 2,
      lunge: 0,
      stamina: 1,
      recover: 0,
      stagger: 0,
      sprinting: false,
      protect: 0,
      settle: 0,
      trapT: 0,
      headT: 0,
      scoopT: 0,
      throwInT: 0,
      juke: 0,
      dive: 0,
      faceLock: null,
      jockey: 0,
      shield: 0,
      slideT: 0,
      pressT: 0,
      skillT: 0,
      skillKind: 0,
      reactTimer: 0,
      actCd: 0,
      runTimer: 0,
      runCd: rng() * 2,
      throwT: 0,
    }
  })
}

export type CreateOpts = {
  squad: Squad
  matchday: number
  opponentName: string
  youAttackDir: 1 | -1
  seed?: number
  /** Override real seconds per half (intro match is a quick 1-minute game). */
  halfSeconds?: number
  /** Force the opponent's team overall (intro match pits you vs a trivially weak side). */
  opponentOverall?: number
  /** Build the opponent as a hapless "minnow" (single-digit attrs) for the underdog intro. */
  opponentMinnow?: boolean
  /** Rig the result: the opponent cannot score and you always finish ahead (intro match). */
  guaranteedWin?: boolean
}

export function createWorld(opts: CreateOpts): World {
  const rng = makeRng(opts.seed ?? Math.floor(Math.random() * 2 ** 31))
  const yourOverall = teamOverall(opts.squad)
  const oppOverall = opts.opponentOverall ?? opponentStrength(yourOverall, opts.matchday, opts.opponentName)
  const youDir = opts.youAttackDir
  const oppDir = (youDir === 1 ? -1 : 1) as 1 | -1

  const you = buildTeam('you', youDir, opts.squad, oppOverall, rng)
  const opp = buildTeam('opp', oppDir, null, oppOverall, rng, opts.opponentMinnow)

  const ball: Ball = {
    pos: { x: 0, y: 0.22, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    spin: { x: 0, y: 0, z: 0 },
    owner: null,
    lastTouch: null,
    lastTeam: null,
    takeCooldown: 0,
    goalboundResolved: false,
    prev: { x: 0, y: 0.22, z: 0 },
  }

  const world: World = {
    players: [...you, ...opp],
    ball,
    controlledId: (you.find((p) => slotOf(p).star) ?? you.find((p) => p.role === 'FWD'))!.id,
    scoreYou: 0,
    scoreOpp: 0,
    clockMs: 0,
    displayMin: 0,
    halfSeconds: opts.halfSeconds ?? MATCH.HALF_SECONDS,
    guaranteedWin: opts.guaranteedWin ?? false,
    half: 1,
    phase: 'kickoff',
    youAttackDir: youDir,
    freeze: 0,
    restart: null,
    message: 'Kick-off',
    justScored: null,
    shotCharge: 0,
    passCharge: 0,
    manualSwitch: 0,
    prevBallOwner: null,
    kickPulse: 0,
    camShake: 0,
    pendingShot: null,
    humanMove: { x: 0, z: 0 },
    tactics: { lineHeight: 0.5, press: 0.5, mentality: 0 },
    kickoffLock: null,
    kickoffKickerId: null,
    pendingRestart: null,
    scorerId: null,
    events: [],
    rng,
  }

  // You take the opening kick-off.
  resetForKickoff(world, 'you')
  return world
}

/** Direction the given team attacks. */
export function attackDirOf(world: World, team: TeamId): 1 | -1 {
  return team === 'you' ? world.youAttackDir : ((world.youAttackDir === 1 ? -1 : 1) as 1 | -1)
}

const BALANCED_TACTICS: Tactics = { lineHeight: 0.5, press: 0.5, mentality: 0 }

/** The active tactical identity for a team: YOUR sliders for your team, balanced for the opponent. */
export function tacticsFor(world: World, team: TeamId): Tactics {
  return team === 'you' ? world.tactics : BALANCED_TACTICS
}

/** Place everyone in their own half and give the kicking team the ball at the centre spot. */
export function resetForKickoff(world: World, kicking: TeamId): void {
  for (const p of world.players) {
    const dir = attackDirOf(world, p.team)
    const home = worldHome(slotOf(p).base, dir)
    p.homePos = home
    // pull both teams into their own half for the restart
    let z = home.z
    if (z * dir > -0.8 && p.role !== 'GK') z = -0.8 * dir // keep out of the opponent half
    p.pos = { x: home.x, z }
    p.vel = { x: 0, z: 0 }
    p.facing = dir === 1 ? 0 : Math.PI
    p.lunge = 0
    clearVerbs(p)
  }
  world.pendingShot = null
  // the kicking team's star (or a forward) stands over the ball at the centre spot
  const kickerDir = attackDirOf(world, kicking)
  const striker = world.players.find((p) => p.team === kicking && slotOf(p).star)
    ?? world.players.find((p) => p.team === kicking && p.role === 'FWD')!
  striker.pos = { x: 0, z: -0.6 * kickerDir }
  world.ball.pos = { x: 0, y: 0.22, z: 0 }
  world.ball.vel = { x: 0, y: 0, z: 0 }
  world.ball.owner = striker.id
  world.ball.lastTouch = striker.id
  world.ball.lastTeam = kicking
  world.ball.takeCooldown = 0
  if (kicking === 'you') world.controlledId = striker.id
  // a proper kick-off: the kicking side must play it (a pass back) before crossing halfway, and the
  // opponents hold in their own half until then — no dribbling straight from the spot to goal.
  world.kickoffLock = kicking
  world.kickoffKickerId = striker.id
  world.phase = 'kickoff'
  world.freeze = 1.1
  world.restart = null
}

function slotOf(p: Player): Slot {
  const idx = Number(p.id.split('-')[1])
  return FORMATION[idx]
}

/** Clear the transient manual-defending / skill-verb state (used on every restart). */
function clearVerbs(p: Player): void {
  p.recover = 0
  p.stagger = 0
  p.protect = 0
  p.settle = 0
  p.trapT = 0
  p.headT = 0
  p.scoopT = 0
  p.throwInT = 0
  p.juke = 0
  p.dive = 0
  p.faceLock = null
  p.jockey = 0
  p.shield = 0
  p.slideT = 0
  p.pressT = 0
  p.skillT = 0
  p.skillKind = 0
  p.throwT = 0
}

/** Place a restart (goal kick / corner / throw-in) and freeze briefly. */
export function setupRestart(
  world: World,
  kind: 'goalkick' | 'corner' | 'throwin',
  team: TeamId,
  at: Vec2,
): void {
  // reset everyone toward formation shape, lightly biased to the restart spot
  for (const p of world.players) {
    const dir = attackDirOf(world, p.team)
    const home = worldHome(slotOf(p).base, dir)
    p.homePos = home
    p.pos = { x: clamp(home.x, -FIELD.HALF_W + 1, FIELD.HALF_W - 1), z: clamp(home.z, -FIELD.HALF_L + 1, FIELD.HALF_L - 1) }
    p.vel = { x: 0, z: 0 }
    p.lunge = 0
    clearVerbs(p)
  }
  world.pendingShot = null
  world.kickoffLock = null
  world.kickoffKickerId = null
  // the team taking it gets a player onto the ball
  let taker: Player
  if (kind === 'goalkick') {
    taker = world.players.find((p) => p.team === team && p.isGK)!
    const dir = attackDirOf(world, team)
    taker.pos = { x: 0, z: (-FIELD.HALF_L + 4) * dir }
    world.ball.pos = { x: taker.pos.x, y: 0.22, z: taker.pos.z + 0.6 * dir }
  } else {
    taker = nearestOf(world, team, at)
    taker.pos = { x: at.x, z: at.z }
    world.ball.pos = { x: at.x, y: 0.22, z: at.z }
  }
  world.ball.vel = { x: 0, y: 0, z: 0 }
  world.ball.owner = taker.id
  world.ball.lastTouch = taker.id
  world.ball.lastTeam = team
  world.ball.takeCooldown = 0

  if (kind === 'corner') {
    // an AI team-mate takes the corner (auto-delivered at freeze-end). Crowd the box with
    // attackers and, for your corners, hand you control of one to attack the cross.
    crowdBoxForCorner(world, team, taker, at)
    if (team === 'you') {
      const target = boxAttacker(world, team, taker, at)
      if (target) world.controlledId = target.id
      world.manualSwitch = 2.5 // stay on your box attacker as the cross comes in
    }
  } else if (kind === 'goalkick') {
    // keeper takes it (auto-clears at freeze-end); you control the nearest outfielder to chase
    if (team === 'you') world.controlledId = nearestOf(world, 'you', { x: world.ball.pos.x, z: world.ball.pos.z }).id
  } else if (team === 'you') {
    // throw-in: you take it and play it in with the pass button
    world.controlledId = taker.id
  }

  world.phase = 'restart'
  world.freeze = 0.7
  world.restart = { kind, team, at }
}

/**
 * Crowd the box for a corner — BOTH teams. The attacking side floods the six-yard +
 * penalty area with runners (central players take the central spots); the defending
 * side drops in to mark goal-side of the danger and guards both posts, with the keeper
 * on his line. This makes a corner a real aerial scramble: only a well-flighted cross
 * (kicker's PASSING) onto a strong runner (his HEADING) beats the crowd consistently.
 */
function crowdBoxForCorner(world: World, attTeam: TeamId, taker: Player, at: Vec2): void {
  const lineSign = (Math.sign(at.z) || 1) as 1 | -1
  const goalZ = lineSign * (FIELD.HALF_L - 0.5)
  const gx = FIELD.GOAL_HALF_W
  const defTeam: TeamId = attTeam === 'you' ? 'opp' : 'you'

  const place = (p: Player, spot: Vec2) => {
    p.pos = { x: clamp(spot.x, -FIELD.HALF_W + 1, FIELD.HALF_W - 1), z: spot.z }
    p.homePos = { ...p.pos }
    p.vel = { x: 0, z: 0 }
  }

  // Attacking runners crowd the area (central runs first).
  const attSpots: Vec2[] = [
    { x: 0, z: goalZ - lineSign * 4.5 }, // penalty spot
    { x: -(gx + 0.5), z: goalZ - lineSign * 1.5 }, // near post
    { x: gx + 0.5, z: goalZ - lineSign * 2.5 }, // far post
    { x: 0, z: goalZ - lineSign * 2.2 }, // six-yard centre
    { x: -4.5, z: goalZ - lineSign * 8 }, // edge of box (cut-back)
    { x: 4.5, z: goalZ - lineSign * 7 }, // second top-of-box runner
  ]
  world.players
    .filter((p) => p.team === attTeam && !p.isGK && p.id !== taker.id)
    .sort((a, b) => Math.abs(a.homePos.x) - Math.abs(b.homePos.x))
    .forEach((p, i) => { if (i < attSpots.length) place(p, attSpots[i]) })

  // Defenders drop goal-side to mark; keeper guards the middle of his line.
  const defGK = world.players.find((p) => p.team === defTeam && p.isGK)
  if (defGK) place(defGK, { x: 0, z: goalZ - lineSign * 0.6 })
  const defSpots: Vec2[] = [
    { x: -(gx - 0.2), z: goalZ - lineSign * 0.7 }, // near-post guard
    { x: gx - 0.2, z: goalZ - lineSign * 0.7 }, // far-post guard
    { x: 0, z: goalZ - lineSign * 4.5 }, // mark the penalty spot
    { x: -2.5, z: goalZ - lineSign * 3 }, // zonal six-yard
    { x: 2.5, z: goalZ - lineSign * 3 }, // zonal six-yard
    { x: 0, z: goalZ - lineSign * 9 }, // sweep the edge / second balls
  ]
  world.players
    .filter((p) => p.team === defTeam && !p.isGK)
    .sort((a, b) => Math.abs(a.homePos.x) - Math.abs(b.homePos.x))
    .forEach((p, i) => { if (i < defSpots.length) place(p, defSpots[i]) })
}

/** The attacker best placed to attack a corner (closest to the penalty spot). */
function boxAttacker(world: World, team: TeamId, taker: Player, at: Vec2): Player | null {
  const lineSign = (Math.sign(at.z) || 1) as 1 | -1
  const target: Vec2 = { x: 0, z: lineSign * (FIELD.HALF_L - 0.5) - lineSign * 5 }
  let best: Player | null = null
  let bd = Infinity
  for (const p of world.players) {
    if (p.team !== team || p.isGK || p.id === taker.id) continue
    const d = dist2(p.pos, target)
    if (d < bd) { bd = d; best = p }
  }
  return best
}

function nearestOf(world: World, team: TeamId, at: Vec2): Player {
  let best: Player | null = null
  let bd = Infinity
  for (const p of world.players) {
    if (p.team !== team || p.isGK) continue
    const d = (p.pos.x - at.x) ** 2 + (p.pos.z - at.z) ** 2
    if (d < bd) { bd = d; best = p }
  }
  return best ?? world.players.find((p) => p.team === team)!
}

export { FORMATION, slotOf, worldHome }
