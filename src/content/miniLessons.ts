import type { UnitId } from '../types'

// ============================================================================
// MINI-LESSONS — short, INTERACTIVE concept teaches shown before each mastery
// topic (and again, re-framed, when a learner misses). Each unit has one
// manipulable model (drag a slider → a value updates live through the formula)
// plus several explanation VARIANTS written at different depths, so the same
// idea can be explained an easier or harder way depending on the difficulty of
// the topic and whether this is a first look or a remedial re-teach.
//
//   • Worked/!nteractive example before retrieval (Bjork; the generation effect).
//   • Multiple representations + re-explanation on a miss (Mayer; elaboration).
//   • Difficulty-matched framing (desirable difficulty; the 85% rule).
// ============================================================================

export type LessonModel = {
  /** The slider input. */
  inputLabel: string
  inputUnit: string
  min: number
  max: number
  step: number
  default: number
  /** Any constant held fixed in the relation (shown to the learner). */
  constLabel?: string
  /** The live output computed from the input. */
  outputLabel: string
  outputUnit: string
  compute: (x: number) => number
  /** The relation, rendered as the headline formula on the widget. */
  relation: string
  /** How to round the output for display. */
  decimals: number
}

export type LessonVariant = {
  heading: string
  body: string
}

export type MiniLessonDef = {
  unitId: UnitId
  title: string
  formula: string
  model: LessonModel
  /** Ordered easiest → hardest framing; reteach cycles to a different one. */
  variants: LessonVariant[]
}

const round = (x: number, d: number) => {
  const f = 10 ** d
  return Math.round(x * f) / f
}

export const MINI_LESSONS: Record<string, MiniLessonDef> = {
  kinematics: {
    unitId: 'kinematics',
    title: 'Speed = distance ÷ time',
    formula: 'v = d / t',
    model: {
      inputLabel: 'Distance run',
      inputUnit: 'm',
      min: 0, max: 40, step: 2, default: 20,
      constLabel: 'over t = 4 s',
      outputLabel: 'Average speed',
      outputUnit: 'm/s',
      compute: (d) => d / 4,
      relation: 'v = d / t   (t = 4 s)',
      decimals: 1,
    },
    variants: [
      { heading: 'The big idea', body: 'Speed just tells you how much ground you cover each second. Cover more distance in the same time and your speed goes up. Drag the distance and watch the speed track it.' },
      { heading: 'Why it scales', body: 'Average speed is total distance divided by total time. Hold the time fixed and speed is directly proportional to distance — double the run, double the speed.' },
      { heading: 'Push it further', body: 'v = d/t is the slope of a distance–time line. Steeper line = faster. Rearranged you can also find distance (d = v·t) or time (t = d/v) — same relationship, solved for a different unknown.' },
    ],
  },

  'motion-graphs': {
    unitId: 'motion-graphs',
    title: 'Velocity is the slope of a position–time graph',
    formula: 'v = Δx / Δt',
    model: {
      inputLabel: 'Rise (Δx)',
      inputUnit: 'm',
      min: 0, max: 50, step: 2, default: 20,
      constLabel: 'over Δt = 5 s',
      outputLabel: 'Velocity (slope)',
      outputUnit: 'm/s',
      compute: (dx) => dx / 5,
      relation: 'v = Δx / Δt   (Δt = 5 s)',
      decimals: 1,
    },
    variants: [
      { heading: 'Read the graph', body: 'On a position–time graph, how steep the line is IS the velocity. A flat line means not moving; a steep line means moving fast. Drag the rise and watch the slope steepen.' },
      { heading: 'Rise over run', body: 'Velocity = change in position ÷ change in time = rise / run. Bigger rise over the same run → steeper line → bigger velocity.' },
      { heading: 'Push it further', body: 'A curving position–time line means the slope is changing — that is acceleration. The instantaneous velocity at a point is the slope of the tangent there.' },
    ],
  },

  forces: {
    unitId: 'forces',
    title: 'Force = mass × acceleration',
    formula: 'F = m · a',
    model: {
      inputLabel: 'Acceleration',
      inputUnit: 'm/s²',
      min: 0, max: 30, step: 1, default: 10,
      constLabel: 'ball m = 0.43 kg',
      outputLabel: 'Net force',
      outputUnit: 'N',
      compute: (a) => 0.43 * a,
      relation: 'F = m · a   (m = 0.43 kg)',
      decimals: 2,
    },
    variants: [
      { heading: 'The big idea', body: 'To speed something up faster, you push harder. For a fixed mass, the force you need is proportional to the acceleration. Drag the acceleration and watch the force climb.' },
      { heading: "Newton's 2nd law", body: 'Net force equals mass times acceleration. The same push gives a light object more acceleration than a heavy one (a = F/m).' },
      { heading: 'Push it further', body: 'F = m·a is about the NET force — add up every push and pull first. Zero net force means zero acceleration (constant velocity), not necessarily zero motion.' },
    ],
  },

  energy: {
    unitId: 'energy',
    title: 'Falling speed from a height: v = √(2gh)',
    formula: 'v = √(2gh)',
    model: {
      inputLabel: 'Drop height',
      inputUnit: 'm',
      min: 0, max: 5, step: 0.25, default: 1.25,
      constLabel: 'g = 10 m/s²',
      outputLabel: 'Speed at the bottom',
      outputUnit: 'm/s',
      compute: (h) => Math.sqrt(2 * 10 * h),
      relation: 'v = √(2gh)   (g = 10)',
      decimals: 1,
    },
    variants: [
      { heading: 'The big idea', body: 'Height turns into speed. Drop from higher and you arrive faster — but not linearly: the speed grows with the square root of the height. Drag the height and watch it.' },
      { heading: 'Energy swap', body: 'Gravitational energy mgh converts into kinetic energy ½mv². Set them equal and the mass cancels: v = √(2gh). Height in, speed out.' },
      { heading: 'Push it further', body: 'Because v depends on √h, to DOUBLE the landing speed you need FOUR times the height. The mass never appears — a heavy and a light ball reach the same speed.' },
    ],
  },

  momentum: {
    unitId: 'momentum',
    title: 'Momentum = mass × velocity',
    formula: 'p = m · v',
    model: {
      inputLabel: 'Velocity',
      inputUnit: 'm/s',
      min: 0, max: 20, step: 1, default: 10,
      constLabel: 'ball m = 0.43 kg',
      outputLabel: 'Momentum',
      outputUnit: 'kg·m/s',
      compute: (v) => 0.43 * v,
      relation: 'p = m · v   (m = 0.43 kg)',
      decimals: 2,
    },
    variants: [
      { heading: 'The big idea', body: 'Momentum is how hard something is to stop — mass times velocity. Faster (or heavier) means more momentum. Drag the velocity and watch the momentum rise.' },
      { heading: 'Mass and speed', body: 'p = m·v. A heavier player at the same speed carries more momentum; so does a lighter one moving faster. Both matter, multiplied together.' },
      { heading: 'Push it further', body: 'In a collision, total momentum is conserved. To win the ball you need to overcome the attacker’s momentum p = m·v — which is exactly why a fast, heavy striker is hard to stop.' },
    ],
  },
}

/** Pick an explanation variant for a difficulty (1..5) and a re-teach offset. */
export function lessonVariantIndex(def: MiniLessonDef, difficulty: number, reteach: number): number {
  const band = difficulty <= 2 ? 0 : difficulty === 3 ? 1 : 2
  return (band + reteach) % def.variants.length
}

export function computeReadout(model: LessonModel, x: number): string {
  return round(model.compute(x), model.decimals).toString()
}
