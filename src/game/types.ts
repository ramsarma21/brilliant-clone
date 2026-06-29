import type { Vec2, Vec3 } from './math'

export type TeamId = 'you' | 'opp'
export type Role = 'GK' | 'DEF' | 'MID' | 'FWD'

// FIFA-style attributes (0-99) derived from the player's trained physics skills
// (you) or a team-strength (opponent). Every move's quality/speed reads from these.
export type Attributes = {
  pace: number
  shooting: number
  passing: number
  dribbling: number
  defending: number
  heading: number
  gk: number
  /** Conditioning: scales how fast match stamina drains while sprinting and refills at rest. */
  stamina: number
}

// Acceleration archetype (AcceleRATE-style). Set once at build from pace vs agility.
export type Archetype = 'explosive' | 'lengthy' | 'controlled'

export type Player = {
  id: string
  team: TeamId
  role: Role
  isGK: boolean
  num: number
  attrs: Attributes
  pos: Vec2
  vel: Vec2
  facing: number // heading in radians (0 = +z)
  homePos: Vec2 // formation anchor (in attack-normalised space; mirrored per side)
  // physical model
  accel: number // m/s^2 ground acceleration (per-player; AcceleRATE archetype)
  topMult: number // top-speed multiplier (lengthy players are quicker flat-out)
  archetype: Archetype
  mass: number // strength proxy for shoulder-to-shoulder duels (≈0.8..1.3)
  // animation/feel state
  runPhase: number
  lunge: number // 0..1 tackle/dive lunge animation
  stamina: number // 0..1; drains while sprinting, refills while not
  recover: number // s of post-tackle/beaten slowdown remaining
  stagger: number // s of a brief barge/stumble slowdown (lighter than recover)
  sprinting: boolean // set each step by the movement resolver
  protect: number // s of dribble-move steal-immunity + burst remaining
  settle: number // s of just-gained-possession dispossession-immunity (no burst) — kills ping-pong
  trapT: number // s remaining on a chest-trap / first-touch control animation
  headT: number // s remaining on a header animation
  scoopT: number // s remaining on a GK scoop-the-ball-up gather animation
  throwInT: number // s remaining on an outfield throw-in delivery (overhead throw motion)
  juke: number // -1..1 lateral lean for the dribble-move animation
  dive: number // -1..1 GK dive lean (signed by dive direction)
  // manual-defending / skill verbs
  faceLock: number | null // if set, facing eases toward this heading instead of velocity
  jockey: number // s remaining flagged as jockeying (controlled defensive shuffle)
  shield: number // s remaining flagged as shielding the ball (back-to-defender)
  slideT: number // s remaining on a committed slide tackle (scripted slide)
  pressT: number // s an AI team-mate is conducted into an aggressive second-man press
  skillT: number // s remaining on a skill-move animation
  skillKind: number // 0 none · 1 step-over · 2 ball-roll · 3 drag-back · 4 roulette
  // AI scratch
  reactTimer: number
  actCd: number // s cooldown shared by dribble moves / contact-contest rolls
  runTimer: number // s remaining on an off-ball attacking run (>0 = running in behind)
  runCd: number // s until this player may trigger another off-ball run
  throwT: number // s remaining on a GK throw/distribution animation
}

export type Ball = {
  pos: Vec3
  vel: Vec3
  spin: Vec3 // angular velocity (rad/s-ish). Drives a real Magnus curve in flight.
  owner: string | null // player id currently dribbling, or null when loose/in flight
  lastTouch: string | null
  lastTeam: TeamId | null
  takeCooldown: number // s remaining before a kick can be re-owned
  goalboundResolved: boolean // a goal-bound shot's save has already been adjudicated (one roll per kick)
  prev: Vec3 // position at the start of this frame, for swept goal-line detection
}

// A shot can be deferred by a brief wind-up so a second tap (timed finishing) can land,
// and so power shots feel weightier. Cancelled if the striker loses the ball.
export type PendingShot = {
  id: string // striker player id
  charge: number // 0..1 power
  aimX: number // -1..1 lateral aim at release
  finesse: boolean
  power: boolean
  chip: boolean
  volley: boolean
  t: number // s of wind-up remaining before contact
  timedArmed: boolean // a second tap was registered → eligible for the timing bonus
  timed: boolean // resolved: the second tap landed inside the green window
}

// Team tactical identity — set by the player via in-match sliders, read live by the AI.
export type Tactics = {
  lineHeight: number // 0 = drop deep, 0.5 = standard, 1 = high line (whole block pushes up)
  press: number // 0 = contain / sit off, 1 = aggressive press (close down sooner, tighter)
  mentality: number // -1 = defensive, 0 = balanced, +1 = attacking (shape forward + more runs + width)
}

// 'deadball' = the brief pause showing the ball where it went out, before the restart is positioned.
export type Phase = 'kickoff' | 'play' | 'goal' | 'restart' | 'deadball' | 'halftime' | 'fulltime'

export type RestartKind = 'kickoff' | 'goalkick' | 'corner' | 'throwin' | 'none'

// How a goal was scored — drives the in-match challenge evaluation (header goals, long-range, etc.).
export type GoalKind = 'header' | 'volley' | 'foot'

/**
 * One recorded in-match event (a goal). Appended to `world.events` as it happens
 * and surfaced in the {@link MatchSummary} so the matchday challenge can be judged.
 */
export type MatchEvent = {
  team: TeamId
  /** Index of the scorer among YOUR team (= squad slot), or null for opponent / own goals. */
  scorerSlot: number | null
  kind: GoalKind
  /** Whether the strike was taken from outside the penalty area. */
  fromOutsideBox: boolean
}

/** The final result handed to `onFinish` so the dashboard can settle coins + judge the challenge. */
export type MatchSummary = {
  scoreYou: number
  scoreOpp: number
  events: MatchEvent[]
}

export type World = {
  players: Player[]
  ball: Ball
  controlledId: string // which of YOUR players you're driving
  scoreYou: number
  scoreOpp: number
  clockMs: number // elapsed real ms in the current half-driven game clock
  displayMin: number // 0..90 shown minute
  halfSeconds: number // real seconds per half (configurable; intro match is shorter)
  guaranteedWin: boolean // rigged intro: opponent can't score and you finish ahead
  half: 1 | 2
  phase: Phase
  // +1 means YOUR team attacks toward +z; flips at halftime. The camera always
  // orients so you attack "up the screen".
  youAttackDir: 1 | -1
  freeze: number // s remaining of a non-interactive freeze (kickoff/goal/restart)
  restart: { kind: RestartKind; team: TeamId; at: Vec2 } | null
  message: string | null
  // transient flags consumed by the renderer/HUD
  justScored: TeamId | null
  shotCharge: number // 0..1 current shoot-button charge for the HUD power meter
  passCharge: number // 0..1 current pass-button hold (loft amount)
  manualSwitch: number // s remaining where auto player-switching is suppressed
  prevBallOwner: string | null // ball owner last step (to detect possession changes)
  kickPulse: number // increments on every kick/header (drives a kick SFX)
  camShake: number // 0..1 transient camera punch (power shots / blocks)
  pendingShot: PendingShot | null // a shot mid wind-up (timed finishing / power shots)
  humanMove: Vec2 // the human stick direction this step (for directional first touch)
  tactics: Tactics // YOUR team's tactical identity (live-editable sliders)
  // Kick-off restriction: while set, the kicking team must pass before it can advance over halfway,
  // and the opponents must stay in their own half — a proper kick-off (no solo run from the spot).
  kickoffLock: TeamId | null
  kickoffKickerId: string | null // the player who took the kick-off (lock clears once he plays it)
  // a restart held back during the 'deadball' processing beat (set up once the pause elapses)
  pendingRestart: { kind: RestartKind; team: TeamId; at: Vec2 } | null
  scorerId: string | null // who scored the latest goal (drives the celebration run)
  events: MatchEvent[] // append-only log of goals this match (for the matchday challenge)
  rng: () => number
}

export type Input = {
  move: Vec2 // normalised desired move direction in WORLD space
  aimX: number // -1..1 lateral aim (screen left/right) for shot placement
  sprint: boolean // hold ↑ while moving
  // Space = pass; HOLD it to loft the pass / cross (charge via held + fire on release)
  passHeld: boolean
  passReleased: boolean
  // R = block / standing tackle (defend)
  skill: boolean
  // Q = shoot (charged, attack) / second-man press (hold, defend)
  shootHeld: boolean
  shootReleased: boolean
  shootPressed: boolean // keydown edge — arms the timed-finishing second tap
  clearPressed: boolean // Q keydown edge (keeper punt)
  // ←/→ dribble cut (attack) / switch player toward that side (defend)
  switchLeft: boolean
  switchRight: boolean
  // L2/LT modifier (hold): jockey (defend) · strafe (carry) · finesse (shoot)
  jockey: boolean
  // E = through ball (defence-splitting, leads the runner)
  through: boolean
  // F = cross into the box (carry) / slide tackle (defend)
  cross: boolean
  slide: boolean
  // skill-move flicks (carry)
  stepover: boolean
  ballRoll: boolean
  roulette: boolean
  dragback: boolean
}
