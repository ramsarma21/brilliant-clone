import type { UnitId, SkillQuestion } from '../../types'

// In-match "execute the move" questions. These mirror the existing sim solve
// style (random whole-ish values, single-step algebra) and are generated
// LOCALLY with the answer computed from the physics — the match never asks a
// model for these, and the answer is always deterministic.

const G = 10 // match copy uses g = 10 m/s^2 for clean mental math
const BALL_MASS = 0.43 // kg — constant ball, matches Forces/Impulse lessons
const CONTACT_DT = 0.1 // s — keeper contact time, matches Goalie lesson

const round = (v: number, dp = 2) => {
  const f = 10 ** dp
  return Math.round(v * f) / f
}
const randInt = (rng: () => number, lo: number, hi: number) =>
  lo + Math.floor(rng() * (hi - lo + 1))
const pick = <T,>(rng: () => number, items: T[]): T => items[Math.floor(rng() * items.length)]

const ANGLES = [
  { deg: 30, sin: 0.5 },
  { deg: 37, sin: 0.6 },
  { deg: 45, sin: 0.71 },
  { deg: 53, sin: 0.8 },
]

type Generator = (rng: () => number) => SkillQuestion

const generators: Record<UnitId, Generator> = {
  // Shooting: vertical launch component vy = v*sinθ.
  kinematics: (rng) => {
    const v = randInt(rng, 16, 34)
    const a = pick(rng, ANGLES)
    return {
      unitId: 'kinematics',
      conceptTag: 'projectile-horizontal-vertical-independence',
      prompt: `You strike the ball at ${v} m/s, ${a.deg}° above the ground. What is the upward part of the velocity, vy = v·sinθ? (sin ${a.deg}° = ${a.sin})`,
      unitLabel: 'm/s',
      answer: round(v * a.sin, 1),
      tolerance: 1,
      given: { v, angleDeg: a.deg, sin: a.sin },
    }
  },

  // Passing: lead a runner, x = x0 + v*t.
  'motion-graphs': (rng) => {
    const x0 = randInt(rng, 4, 12)
    const v = randInt(rng, 3, 8)
    const t = randInt(rng, 3, 6)
    return {
      unitId: 'motion-graphs',
      conceptTag: 'graph-slope-as-velocity',
      prompt: `A teammate starts ${x0} m ahead and runs a steady ${v} m/s. Using x = x₀ + v·t, where is he after ${t} s?`,
      unitLabel: 'm',
      answer: x0 + v * t,
      tolerance: 1,
      given: { x0, v, t },
    }
  },

  // Dribbling: Newton's 2nd law, F = m·a (constant ball mass).
  forces: (rng) => {
    const a = randInt(rng, 5, 40)
    return {
      unitId: 'forces',
      conceptTag: 'force-net-force',
      prompt: `Your boot accelerates the ${BALL_MASS} kg ball at ${a} m/s². What net force did you apply? (F = m·a)`,
      unitLabel: 'N',
      answer: round(BALL_MASS * a, 1),
      tolerance: 1,
      given: { mass: BALL_MASS, a },
    }
  },

  // Heading: energy conservation, v = sqrt(2gh).
  energy: (rng) => {
    const h = round(randInt(rng, 5, 32) / 10, 1) // 0.5 .. 3.2 m
    return {
      unitId: 'energy',
      conceptTag: 'energy-conservation',
      prompt: `You leap so your head reaches ${h} m at the top. Using v = √(2gh) with g = ${G}, how fast were you moving up at take-off?`,
      unitLabel: 'm/s',
      answer: round(Math.sqrt(2 * G * h), 1),
      tolerance: 0.5,
      given: { h, g: G },
    }
  },

  // Defending: momentum p = m·v (attacker mass varies).
  momentum: (rng) => {
    const m = randInt(rng, 60, 90)
    const v = randInt(rng, 4, 9)
    return {
      unitId: 'momentum',
      conceptTag: 'momentum-collisions',
      prompt: `An attacker of mass ${m} kg drives at ${v} m/s. What is his momentum p = m·v that you must stop?`,
      unitLabel: 'kg·m/s',
      answer: m * v,
      tolerance: 5,
      given: { mass: m, v },
    }
  },

  // Goalkeeping: impulse J = Δp = m·v (constant ball mass).
  impulse: (rng) => {
    const v = randInt(rng, 12, 30)
    return {
      unitId: 'impulse',
      conceptTag: 'impulse-momentum',
      prompt: `The shot arrives at ${v} m/s. To stop the ${BALL_MASS} kg ball, what impulse J = m·v must your hands deliver? (contact ≈ ${CONTACT_DT} s)`,
      unitLabel: 'kg·m/s',
      answer: round(BALL_MASS * v, 2),
      tolerance: 0.5,
      given: { mass: BALL_MASS, v, dt: CONTACT_DT },
    }
  },
}

export function generateSkillQuestion(
  unitId: UnitId,
  rng: () => number = Math.random,
): SkillQuestion {
  return generators[unitId](rng)
}

export function checkSkillAnswer(question: SkillQuestion, value: number): boolean {
  return Math.abs(value - question.answer) <= question.tolerance
}
