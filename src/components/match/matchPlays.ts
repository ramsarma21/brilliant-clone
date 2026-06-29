// MATCH PLAYS — the scripted, behind-view "soccer moments" that connect the drills.
//
// Each Play is a short keyframed timeline on the shared third-person pitch (see
// lib/pitch3d). The match orchestrator (MatchGame) triggers a play to bridge two
// drills — e.g. a teammate slips the ball into your feet, you skin your marker, the
// opponent surges forward, a cross is whipped in — so the whole match reads as one
// continuous game played from behind YOUR player, with NO text captions.
//
// Plays are authored with world-metre keyframes per actor + the ball. Actors are
// ROLES ('you' / 'mate' / 'foe' / 'foe2'); the renderer maps each role to a kit
// (your equipped player, your team colour, the opponent colour) at draw time.
//
// World convention (matches the drills): the camera sits behind YOUR player looking
// up-pitch toward +z. Larger z = farther away (up the pitch); the goal you attack is
// at large +z. When you DEFEND, opponents run toward the camera (z shrinks).

import { clamp, easeInOut, lerp, type V3 } from '../../lib/pitch3d'
import { DRILL_ENTRY, type DrillId } from './matchDrill'

export type Role = 'you' | 'mate' | 'foe' | 'foe2'
export type Facing = 'back' | 'front'

export type ActorKey = {
  t: number
  x: number
  z: number
  running?: boolean
  face?: Facing
  /** When set, the near foot glues to the ball with this lean [-1..1] (a touch/kick pose). */
  touch?: number
}

export type Actor = {
  role: Role
  num?: number
  /** Default facing when a key doesn't override it. */
  face?: Facing
  keys: ActorKey[]
}

export type BallKey = { t: number; x: number; y: number; z: number }

export type Play = {
  id: string
  ms: number
  /** Camera lateral pan (world metres) over normalised time + current ball. */
  camera?: (t: number, ball: V3) => number
  /** Goal-frame depth (world z) to draw, or null for none. */
  goal?: (t: number) => number | null
  /** Pitch markings to paint on the turf. */
  marks?: { halfwayZ?: number; boxZ?: number; centerSpotZ?: number }
  actors: Actor[]
  ball: BallKey[]
}

export type ResolvedActor = {
  role: Role
  num?: number
  x: number
  z: number
  running: boolean
  face: Facing
  touch?: number
}

export type Scene = {
  actors: ResolvedActor[]
  ball: V3
  camX: number
  goalZ: number | null
  marks?: Play['marks']
}

// ---- sampling -------------------------------------------------------------

function segIndex(ts: number[], t: number): number {
  for (let i = 0; i < ts.length - 1; i++) if (t <= ts[i + 1]) return i
  return Math.max(0, ts.length - 2)
}

function sampleActor(a: Actor, t: number): ResolvedActor {
  const keys = a.keys
  if (keys.length === 1) {
    const k = keys[0]
    return { role: a.role, num: a.num, x: k.x, z: k.z, running: !!k.running, face: k.face ?? a.face ?? 'back', touch: k.touch }
  }
  const i = segIndex(keys.map((k) => k.t), t)
  const k0 = keys[i]
  const k1 = keys[i + 1]
  const span = Math.max(1e-4, k1.t - k0.t)
  const local = clamp((t - k0.t) / span, 0, 1)
  const e = easeInOut(local)
  // smooth height/position; booleans + facing + touch hold from the segment start
  return {
    role: a.role,
    num: a.num,
    x: lerp(k0.x, k1.x, e),
    z: lerp(k0.z, k1.z, e),
    running: !!(local < 0.96 ? (k0.running ?? k1.running) : k1.running),
    face: k0.face ?? a.face ?? 'back',
    touch: k0.touch,
  }
}

// Ball: ease x/z within a segment, and round the vertical arc with smoothstep so lofted
// passes/crosses look like real flighted balls rather than triangles.
function smooth(u: number) { return u * u * (3 - 2 * u) }

function sampleBall(keys: BallKey[], t: number): V3 {
  if (keys.length === 1) return { x: keys[0].x, y: keys[0].y, z: keys[0].z }
  const i = segIndex(keys.map((k) => k.t), t)
  const k0 = keys[i]
  const k1 = keys[i + 1]
  const span = Math.max(1e-4, k1.t - k0.t)
  const local = clamp((t - k0.t) / span, 0, 1)
  const e = easeInOut(local)
  return {
    x: lerp(k0.x, k1.x, e),
    y: Math.max(0, lerp(k0.y, k1.y, smooth(local))),
    z: lerp(k0.z, k1.z, e),
  }
}

export function samplePlay(play: Play, t01: number): Scene {
  const t = clamp(t01, 0, 1)
  const ball = sampleBall(play.ball, t)
  const camX = play.camera ? play.camera(t, ball) : clamp(ball.x * 0.4, -3.2, 3.2)
  const goalZ = play.goal ? play.goal(t) : null
  return {
    actors: play.actors.map((a) => sampleActor(a, t)),
    ball,
    camX,
    goalZ,
    marks: play.marks,
  }
}

// ===========================================================================
// THE PLAY LIBRARY
// ===========================================================================
// Each match-state transition maps to one of these keys.
export type PlayId =
  | 'kickoff'
  | 'feedYou'
  | 'beatMarker'
  | 'throughOnGoal'
  | 'crossIn'
  | 'oppAttack'
  | 'turnover'
  | 'winTackle'
  | 'keeperScramble'
  | 'counter'
  | 'goalYou'
  | 'goalOpp'

const BALL_GROUND = 0.13

// follow YOUR player smoothly: pan a fraction of the ball's lateral position
const followBall = (_t: number, ball: V3) => clamp(ball.x * 0.42, -3, 3)

export const PLAYS: Record<PlayId, Play> = {
  // KICK-OFF — two of your players at the centre spot; tap it square and roll forward.
  kickoff: {
    id: 'kickoff',
    ms: 1900,
    marks: { halfwayZ: 9, centerSpotZ: 9 },
    camera: (_t, b) => clamp(b.x * 0.3, -2, 2),
    actors: [
      { role: 'you', face: 'back', keys: [
        { t: 0, x: -0.6, z: 8.6, running: false },
        { t: 0.35, x: -0.6, z: 8.6, touch: 0.4 },
        { t: 1, x: -1.2, z: 7.8, running: true },
      ] },
      { role: 'mate', face: 'back', num: 8, keys: [
        { t: 0, x: 1.0, z: 9.4, running: false },
        { t: 0.5, x: 1.4, z: 9.0, running: true },
        { t: 1, x: 2.2, z: 8.2, running: true },
      ] },
    ],
    ball: [
      { t: 0, x: -0.45, y: BALL_GROUND, z: 8.9 },
      { t: 0.35, x: -0.2, y: BALL_GROUND, z: 9.0 },
      { t: 1, x: 1.2, y: BALL_GROUND, z: 8.9 },
    ],
  },

  // TEAMMATE FEEDS YOU — a mate up ahead slides it into your feet; you receive, set to go.
  feedYou: {
    id: 'feedYou',
    ms: 1650,
    camera: followBall,
    actors: [
      { role: 'mate', face: 'back', num: 6, keys: [
        { t: 0, x: 2.4, z: 9.5, running: true, touch: -0.4 },
        { t: 0.4, x: 2.6, z: 9.8, running: true },
        { t: 1, x: 2.8, z: 10.2, running: false },
      ] },
      { role: 'you', face: 'back', keys: [
        { t: 0, x: -0.9, z: 1.0, running: true },
        { t: 0.7, x: -0.9, z: 0.6, running: true },
        { t: 0.85, x: -0.9, z: 0.4, touch: 0.25 },
        { t: 1, x: -0.9, z: 0.3, touch: 0.15 },
      ] },
      { role: 'foe', face: 'front', num: 4, keys: [
        { t: 0, x: 0.6, z: 8.4, running: true },
        { t: 1, x: 0.2, z: 7.2, running: true },
      ] },
    ],
    ball: [
      { t: 0, x: 2.2, y: BALL_GROUND, z: 9.2 },
      { t: 0.85, x: -0.7, y: BALL_GROUND, z: 0.7 },
      { t: 1, x: -0.85, y: BALL_GROUND, z: 0.5 },
    ],
  },

  // BEAT YOUR MARKER — you knock it past the defender and burst beyond him.
  beatMarker: {
    id: 'beatMarker',
    ms: 1650,
    camera: followBall,
    actors: [
      { role: 'you', face: 'back', keys: [
        { t: 0, x: -0.7, z: 0.5, running: true, touch: 0.5 },
        { t: 0.35, x: -0.2, z: 1.2, running: true },
        { t: 0.7, x: 0.7, z: 2.6, running: true },
        { t: 1, x: 1.1, z: 3.6, running: true, touch: 0.2 },
      ] },
      { role: 'foe', face: 'front', num: 4, keys: [
        { t: 0, x: 0.2, z: 3.0, running: true },
        { t: 0.45, x: -0.3, z: 2.4, running: true },
        { t: 1, x: -1.1, z: 1.6, running: true },
      ] },
    ],
    ball: [
      { t: 0, x: -0.3, y: BALL_GROUND, z: 0.9 },
      { t: 0.4, x: 0.7, y: BALL_GROUND, z: 2.4 },
      { t: 0.7, x: 1.2, y: BALL_GROUND, z: 3.2 },
      { t: 1, x: 1.3, y: BALL_GROUND, z: 4.0 },
    ],
  },

  // THROUGH ON GOAL — defenders cleared, you drive at the keeper's goal up-pitch.
  throughOnGoal: {
    id: 'throughOnGoal',
    ms: 1700,
    goal: () => 17,
    marks: { boxZ: 13 },
    camera: followBall,
    actors: [
      { role: 'you', face: 'back', keys: [
        { t: 0, x: -0.6, z: 2.6, running: true, touch: 0.4 },
        { t: 0.5, x: -0.3, z: 4.2, running: true },
        { t: 1, x: 0.0, z: 6.0, running: true, touch: 0.3 },
      ] },
      { role: 'foe', face: 'front', num: 5, keys: [
        { t: 0, x: 1.6, z: 5.0, running: true },
        { t: 1, x: 2.2, z: 4.2, running: true },
      ] },
    ],
    ball: [
      { t: 0, x: -0.2, y: BALL_GROUND, z: 3.1 },
      { t: 0.5, x: 0.1, y: BALL_GROUND, z: 4.9 },
      { t: 1, x: 0.4, y: BALL_GROUND, z: 6.8 },
    ],
  },

  // CROSS WHIPPED IN — a lofted ball arcs from the wing into the box; you arrive to meet it.
  crossIn: {
    id: 'crossIn',
    ms: 1750,
    goal: () => 16,
    marks: { boxZ: 12 },
    camera: (t) => lerp(3.2, 0.4, easeInOut(t)),
    actors: [
      { role: 'mate', face: 'front', num: 7, keys: [
        { t: 0, x: 7.0, z: 10.5, running: true, touch: -0.5 },
        { t: 0.3, x: 7.4, z: 10.8, running: false },
        { t: 1, x: 7.6, z: 11.0, running: false },
      ] },
      { role: 'you', face: 'back', keys: [
        { t: 0, x: -1.6, z: 6.5, running: true },
        { t: 0.6, x: -0.4, z: 8.0, running: true },
        { t: 1, x: 0.4, z: 9.0, running: true, touch: 0.2 },
      ] },
      { role: 'foe', face: 'front', num: 5, keys: [
        { t: 0, x: 1.6, z: 9.6, running: true },
        { t: 1, x: 0.9, z: 9.2, running: true },
      ] },
    ],
    ball: [
      { t: 0, x: 6.6, y: 0.4, z: 10.4 },
      { t: 0.5, x: 3.0, y: 3.4, z: 9.8 },
      { t: 1, x: 0.6, y: 1.6, z: 9.1 },
    ],
  },

  // OPPONENT ATTACK — they break forward at you; step in to win it back (→ defend).
  oppAttack: {
    id: 'oppAttack',
    ms: 1650,
    camera: (_t, b) => clamp(b.x * 0.3, -2.4, 2.4),
    actors: [
      { role: 'foe', face: 'front', num: 9, keys: [
        { t: 0, x: 0.8, z: 13.5, running: true, touch: -0.3 },
        { t: 0.5, x: 0.5, z: 9.5, running: true },
        { t: 1, x: 0.2, z: 6.5, running: true, touch: -0.2 },
      ] },
      { role: 'foe2', face: 'front', num: 11, keys: [
        { t: 0, x: 4.2, z: 14.5, running: true },
        { t: 1, x: 3.4, z: 9.0, running: true },
      ] },
      { role: 'you', face: 'back', keys: [
        { t: 0, x: -0.8, z: 1.4, running: true },
        { t: 0.5, x: -0.5, z: 2.4, running: true },
        { t: 1, x: -0.2, z: 3.4, running: true },
      ] },
    ],
    ball: [
      { t: 0, x: 0.6, y: BALL_GROUND, z: 13.0 },
      { t: 0.5, x: 0.4, y: BALL_GROUND, z: 9.0 },
      { t: 1, x: 0.2, y: BALL_GROUND, z: 6.0 },
    ],
  },

  // TURNOVER — you lose it; the ball is nicked away and they break the other way (→ defend).
  turnover: {
    id: 'turnover',
    ms: 1450,
    camera: (_t, b) => clamp(b.x * 0.3, -2.4, 2.4),
    actors: [
      { role: 'you', face: 'back', keys: [
        { t: 0, x: -0.4, z: 2.6, running: true, touch: 0.3 },
        { t: 0.4, x: -0.6, z: 2.4, running: false },
        { t: 1, x: -0.9, z: 2.0, running: true },
      ] },
      { role: 'foe', face: 'front', num: 8, keys: [
        { t: 0, x: 0.8, z: 4.6, running: true },
        { t: 0.4, x: 0.2, z: 3.0, running: true, touch: -0.3 },
        { t: 1, x: 0.0, z: 6.0, running: true },
      ] },
    ],
    ball: [
      { t: 0, x: 0.0, y: BALL_GROUND, z: 3.0 },
      { t: 0.4, x: 0.1, y: BALL_GROUND, z: 3.2 },
      { t: 1, x: 0.1, y: BALL_GROUND, z: 5.6 },
    ],
  },

  // WIN THE TACKLE — you win it clean and surge forward (→ dribble).
  winTackle: {
    id: 'winTackle',
    ms: 1600,
    camera: followBall,
    actors: [
      { role: 'foe', face: 'front', num: 8, keys: [
        { t: 0, x: 0.4, z: 4.0, running: true, touch: -0.3 },
        { t: 0.4, x: 0.2, z: 2.6, running: true },
        { t: 1, x: 0.0, z: 1.4, running: false },
      ] },
      { role: 'you', face: 'back', keys: [
        { t: 0, x: -0.6, z: 1.6, running: true },
        { t: 0.35, x: -0.3, z: 2.4, running: true, touch: 0.5 },
        { t: 0.7, x: -0.5, z: 2.0, running: true, touch: 0.3 },
        { t: 1, x: -0.8, z: 3.2, running: true, touch: 0.2 },
      ] },
    ],
    ball: [
      { t: 0, x: 0.3, y: BALL_GROUND, z: 3.0 },
      { t: 0.4, x: -0.1, y: BALL_GROUND, z: 2.4 },
      { t: 1, x: -0.7, y: BALL_GROUND, z: 3.6 },
    ],
  },

  // HE'S IN BEHIND — an opponent is clean through, bearing down on your goal (→ goalie save).
  keeperScramble: {
    id: 'keeperScramble',
    ms: 1650,
    camera: (_t, b) => clamp(b.x * 0.25, -2, 2),
    actors: [
      { role: 'foe', face: 'front', num: 9, keys: [
        { t: 0, x: 1.0, z: 17.0, running: true, touch: -0.3 },
        { t: 0.6, x: 1.6, z: 13.6, running: true },
        { t: 1, x: 2.2, z: 11.5, running: true, touch: -0.4 },
      ] },
      { role: 'you', face: 'front', keys: [
        { t: 0, x: -0.7, z: 0.8, running: true },
        { t: 0.5, x: -0.3, z: 1.2, running: true },
        { t: 1, x: 0.0, z: 1.7, running: true },
      ] },
    ],
    ball: [
      { t: 0, x: 0.8, y: BALL_GROUND, z: 16.4 },
      { t: 0.6, x: 1.2, y: BALL_GROUND, z: 13.1 },
      { t: 1, x: 1.7, y: BALL_GROUND, z: 11.0 },
    ],
  },

  // COUNTER — huge save gathered, you launch it forward and break (→ dribble).
  counter: {
    id: 'counter',
    ms: 1650,
    camera: followBall,
    actors: [
      { role: 'you', face: 'back', keys: [
        { t: 0, x: -0.4, z: 0.8, running: false, touch: 0.2 },
        { t: 0.35, x: -0.6, z: 1.0, touch: 0.5 },
        { t: 0.7, x: -0.8, z: 1.8, running: true },
        { t: 1, x: -0.9, z: 2.8, running: true },
      ] },
      { role: 'mate', face: 'back', num: 10, keys: [
        { t: 0, x: 3.0, z: 9.0, running: true },
        { t: 1, x: 3.6, z: 12.0, running: true },
      ] },
    ],
    ball: [
      { t: 0, x: -0.2, y: BALL_GROUND, z: 1.1 },
      { t: 0.35, x: 0.0, y: 0.5, z: 1.6 },
      { t: 0.7, x: 1.4, y: 2.2, z: 6.0 },
      { t: 1, x: 2.8, y: 0.6, z: 10.0 },
    ],
  },

  // GOAL (you) — you wheel away celebrating toward the camera.
  goalYou: {
    id: 'goalYou',
    ms: 2300,
    goal: () => 16,
    camera: (_t, b) => clamp(b.x * 0.3, -2, 2),
    actors: [
      { role: 'you', face: 'front', keys: [
        { t: 0, x: 0.0, z: 8.0, running: true },
        { t: 0.5, x: -1.0, z: 4.5, running: true },
        { t: 1, x: -1.6, z: 1.6, running: true },
      ] },
      { role: 'mate', face: 'front', num: 10, keys: [
        { t: 0, x: 3.0, z: 11.0, running: true },
        { t: 1, x: 1.2, z: 3.6, running: true },
      ] },
    ],
    ball: [
      { t: 0, x: 0.0, y: 0.4, z: 15.6 },
      { t: 1, x: 0.2, y: BALL_GROUND, z: 15.9 },
    ],
  },

  // GOAL (opponent) — they conceded: opponent wheels away, your player trudges.
  goalOpp: {
    id: 'goalOpp',
    ms: 2300,
    camera: (_t, b) => clamp(b.x * 0.3, -2, 2),
    actors: [
      { role: 'foe', face: 'front', num: 9, keys: [
        { t: 0, x: 0.0, z: 8.0, running: true },
        { t: 1, x: 1.6, z: 2.0, running: true },
      ] },
      { role: 'you', face: 'back', keys: [
        { t: 0, x: -2.0, z: 4.0, running: false },
        { t: 1, x: -2.4, z: 5.0, running: true },
      ] },
    ],
    ball: [
      { t: 0, x: -0.2, y: 0.3, z: 15.6 },
      { t: 1, x: 0.0, y: BALL_GROUND, z: 15.9 },
    ],
  },
}

// ===========================================================================
// HANDOFF ALIGNMENT
// ===========================================================================
// Which drill each transition hands into. The transition's FINAL frame is snapped to
// that drill's DrillEntry (position + ball + camera) so the swap to the playable drill is
// seamless — same world state on both sides of the cut.
export const PLAY_TO_DRILL: Partial<Record<PlayId, DrillId>> = {
  feedYou: 'dribble', winTackle: 'dribble', counter: 'dribble',
  beatMarker: 'pass',
  throughOnGoal: 'shoot',
  crossIn: 'header',
  oppAttack: 'defend', turnover: 'defend',
  keeperScramble: 'goalie',
}

const defaultCam = (_t: number, b: V3) => clamp(b.x * 0.42, -3.2, 3.2)

// Snap every drill-leading transition's terminal frame to its drill entry, and blend its
// camera into the entry pan over the last stretch, so the handoff lines up to the metre.
for (const [pid, did] of Object.entries(PLAY_TO_DRILL) as [PlayId, DrillId][]) {
  const play = PLAYS[pid]
  const e = DRILL_ENTRY[did]
  const bl = play.ball[play.ball.length - 1]
  bl.t = 1; bl.x = e.ball.x; bl.y = e.ball.y; bl.z = e.ball.z
  let foeSet = false
  for (const a of play.actors) {
    const k = a.keys[a.keys.length - 1]
    k.t = 1
    if (a.role === 'you') { k.x = e.you.x; k.z = e.you.z }
    else if (!foeSet && (a.role === 'foe' || a.role === 'foe2') && e.foe) {
      k.x = e.foe.x; k.z = e.foe.z; foeSet = true
    }
  }
  const orig = play.camera ?? defaultCam
  play.camera = (t, b) => {
    const c = orig(t, b)
    return t < 0.82 ? c : c + (e.camX - c) * easeInOut((t - 0.82) / 0.18)
  }
}
