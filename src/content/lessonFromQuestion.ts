import type { BankQuestion, UnitId } from '../types'
import type { LessonModel, MiniLessonDef } from './miniLessons'
import { MINI_LESSONS } from './miniLessons'

const pretty = (tag: string) => tag.replace(/-/g, ' ')

type ModelSpec = {
  title: string
  formula: string
  build: (g: Record<string, number>) => LessonModel
}

/** Interactive slider models keyed by bank conceptTag — lesson always matches its question. */
const CONCEPT_MODELS: Record<string, ModelSpec> = {
  'average-speed': {
    title: 'Speed = distance ÷ time',
    formula: 'v = d / t',
    build: (g) => ({
      inputLabel: 'Distance', inputUnit: 'm', min: 0, max: 60, step: 2, default: g.d ?? 20,
      constLabel: `over t = ${g.t ?? 4} s`, outputLabel: 'Average speed', outputUnit: 'm/s',
      compute: (d) => d / (g.t ?? 4), relation: `v = d / t   (t = ${g.t ?? 4} s)`, decimals: 1,
    }),
  },
  'velocity-from-rest': {
    title: 'Speeding up from rest: v = a · t',
    formula: 'v = u + a t',
    build: (g) => ({
      inputLabel: 'Acceleration', inputUnit: 'm/s²', min: 0, max: 15, step: 0.5, default: g.a ?? 4,
      constLabel: `from rest, t = ${g.t ?? 3} s`, outputLabel: 'Final speed', outputUnit: 'm/s',
      compute: (a) => a * (g.t ?? 3), relation: `v = a · t   (u = 0, t = ${g.t ?? 3} s)`, decimals: 1,
    }),
  },
  'acceleration-definition': {
    title: 'Acceleration = change in speed ÷ time',
    formula: 'a = Δv / Δt',
    build: (g) => ({
      inputLabel: 'Speed change (Δv)', inputUnit: 'm/s', min: 0, max: 30, step: 1, default: g.dv ?? g['Δv'] ?? 10,
      constLabel: `over Δt = ${g.dt ?? g.t ?? 2} s`, outputLabel: 'Acceleration', outputUnit: 'm/s²',
      compute: (dv) => dv / (g.dt ?? g.t ?? 2), relation: `a = Δv / Δt   (Δt = ${g.dt ?? g.t ?? 2} s)`, decimals: 1,
    }),
  },
  'graph-slope-as-velocity': {
    title: 'Velocity is the slope of a position–time graph',
    formula: 'v = Δx / Δt',
    build: (g) => ({
      inputLabel: 'Rise (Δx)', inputUnit: 'm', min: 0, max: 60, step: 2, default: g.dx ?? g.d ?? 20,
      constLabel: `over Δt = ${g.dt ?? g.t ?? 5} s`, outputLabel: 'Velocity (slope)', outputUnit: 'm/s',
      compute: (dx) => dx / (g.dt ?? g.t ?? 5), relation: `v = Δx / Δt   (Δt = ${g.dt ?? g.t ?? 5} s)`, decimals: 1,
    }),
  },
  'force-net-force': {
    title: 'Force = mass × acceleration',
    formula: 'F = m · a',
    build: (g) => ({
      inputLabel: 'Acceleration', inputUnit: 'm/s²', min: 0, max: 30, step: 1, default: g.a ?? 10,
      constLabel: `m = ${g.m ?? 0.43} kg`, outputLabel: 'Net force', outputUnit: 'N',
      compute: (a) => (g.m ?? 0.43) * a, relation: `F = m · a   (m = ${g.m ?? 0.43} kg)`, decimals: 2,
    }),
  },
  'force-acceleration': {
    title: 'Acceleration = force ÷ mass',
    formula: 'a = F / m',
    build: (g) => ({
      inputLabel: 'Net force', inputUnit: 'N', min: 0, max: 50, step: 1, default: g.F ?? g.f ?? 10,
      constLabel: `m = ${g.m ?? 0.43} kg`, outputLabel: 'Acceleration', outputUnit: 'm/s²',
      compute: (F) => F / (g.m ?? 0.43), relation: `a = F / m   (m = ${g.m ?? 0.43} kg)`, decimals: 2,
    }),
  },
  'force-mass': {
    title: 'Mass = force ÷ acceleration',
    formula: 'm = F / a',
    build: (g) => ({
      inputLabel: 'Net force', inputUnit: 'N', min: 0, max: 100, step: 1, default: g.F ?? g.f ?? 10,
      constLabel: `a = ${g.a ?? 2} m/s²`, outputLabel: 'Mass', outputUnit: 'kg',
      compute: (F) => F / (g.a ?? 2), relation: `m = F / a   (a = ${g.a ?? 2} m/s²)`, decimals: 2,
    }),
  },
  weight: {
    title: 'Weight = mass × gravity',
    formula: 'W = m · g',
    build: (g) => ({
      inputLabel: 'Mass', inputUnit: 'kg', min: 0, max: 5, step: 0.01, default: g.m ?? 1,
      constLabel: `g = ${g.g ?? 10} m/s²`, outputLabel: 'Weight', outputUnit: 'N',
      compute: (m) => m * (g.g ?? 10), relation: `W = m · g   (g = ${g.g ?? 10})`, decimals: 2,
    }),
  },
  'net-force': {
    title: 'Net force = sum of forces',
    formula: 'F_net = ΣF',
    build: (g) => ({
      inputLabel: 'Applied force', inputUnit: 'N', min: 0, max: 50, step: 1, default: g.F ?? 20,
      constLabel: g.f ? `friction f = ${g.f} N` : undefined,
      outputLabel: 'Net force', outputUnit: 'N',
      compute: (F) => F - (g.f ?? 0), relation: 'F_net = F − f', decimals: 1,
    }),
  },
  'net-force-accel': {
    title: 'Acceleration from net force',
    formula: 'a = F_net / m',
    build: (g) => ({
      inputLabel: 'Net force', inputUnit: 'N', min: 0, max: 50, step: 1, default: g.F ?? g.Fnet ?? 10,
      constLabel: `m = ${g.m ?? 0.43} kg`, outputLabel: 'Acceleration', outputUnit: 'm/s²',
      compute: (F) => F / (g.m ?? 0.43), relation: `a = F_net / m   (m = ${g.m ?? 0.43} kg)`, decimals: 2,
    }),
  },
  friction: {
    title: 'Friction = μ · normal force',
    formula: 'f = μ N',
    build: (g) => ({
      inputLabel: 'Normal force', inputUnit: 'N', min: 0, max: 100, step: 1,
      default: g.N ?? (g.m ?? 1) * (g.g ?? 10),
      constLabel: `μ = ${g.mu ?? g.μ ?? 0.3}`, outputLabel: 'Friction', outputUnit: 'N',
      compute: (N) => (g.mu ?? g.μ ?? 0.3) * N, relation: `f = μ N   (μ = ${g.mu ?? g.μ ?? 0.3})`, decimals: 1,
    }),
  },
  'gravitational-pe': {
    title: 'Gravitational PE = m · g · h',
    formula: 'PE = m g h',
    build: (g) => ({
      inputLabel: 'Height', inputUnit: 'm', min: 0, max: 10, step: 0.1, default: g.h ?? 2,
      constLabel: `m = ${g.m ?? 0.43} kg, g = ${g.g ?? 10}`, outputLabel: 'Potential energy', outputUnit: 'J',
      compute: (h) => (g.m ?? 0.43) * (g.g ?? 10) * h, relation: `PE = m g h   (m = ${g.m ?? 0.43} kg)`, decimals: 1,
    }),
  },
  'kinetic-energy': {
    title: 'Kinetic energy = ½ · m · v²',
    formula: 'KE = ½ m v²',
    build: (g) => ({
      inputLabel: 'Speed', inputUnit: 'm/s', min: 0, max: 25, step: 1, default: g.v ?? 10,
      constLabel: `m = ${g.m ?? 0.43} kg`, outputLabel: 'Kinetic energy', outputUnit: 'J',
      compute: (v) => 0.5 * (g.m ?? 0.43) * v * v, relation: `KE = ½ m v²   (m = ${g.m ?? 0.43} kg)`, decimals: 1,
    }),
  },
  'energy-conservation': {
    title: 'Falling speed: v = √(2gh)',
    formula: 'v = √(2gh)',
    build: (g) => ({
      inputLabel: 'Drop height', inputUnit: 'm', min: 0, max: 8, step: 0.1, default: g.h ?? 1.8,
      constLabel: `g = ${g.g ?? 10} m/s²`, outputLabel: 'Speed at bottom', outputUnit: 'm/s',
      compute: (h) => Math.sqrt(2 * (g.g ?? 10) * h), relation: `v = √(2gh)   (g = ${g.g ?? 10})`, decimals: 1,
    }),
  },
  work: {
    title: 'Work = force × distance',
    formula: 'W = F d',
    build: (g) => ({
      inputLabel: 'Distance', inputUnit: 'm', min: 0, max: 20, step: 0.5, default: g.d ?? 5,
      constLabel: `F = ${g.F ?? g.f ?? 10} N`, outputLabel: 'Work done', outputUnit: 'J',
      compute: (d) => (g.F ?? g.f ?? 10) * d, relation: `W = F d   (F = ${g.F ?? g.f ?? 10} N)`, decimals: 1,
    }),
  },
  power: {
    title: 'Power = work ÷ time',
    formula: 'P = W / t',
    build: (g) => ({
      inputLabel: 'Work done', inputUnit: 'J', min: 0, max: 500, step: 5, default: g.W ?? g.w ?? 100,
      constLabel: `over t = ${g.t ?? 4} s`, outputLabel: 'Power', outputUnit: 'W',
      compute: (W) => W / (g.t ?? 4), relation: `P = W / t   (t = ${g.t ?? 4} s)`, decimals: 1,
    }),
  },
  'momentum-collisions': {
    title: 'Momentum = mass × velocity',
    formula: 'p = m · v',
    build: (g) => ({
      inputLabel: 'Velocity', inputUnit: 'm/s', min: 0, max: 25, step: 1, default: g.v ?? 10,
      constLabel: `m = ${g.m ?? g.m1 ?? 0.43} kg`, outputLabel: 'Momentum', outputUnit: 'kg·m/s',
      compute: (v) => (g.m ?? g.m1 ?? 0.43) * v, relation: `p = m · v   (m = ${g.m ?? g.m1 ?? 0.43} kg)`, decimals: 2,
    }),
  },
  impulse: {
    title: 'Impulse = force × time = Δp',
    formula: 'J = F Δt',
    build: (g) => ({
      inputLabel: 'Force', inputUnit: 'N', min: 0, max: 200, step: 5, default: g.F ?? g.f ?? 50,
      constLabel: `over Δt = ${g.dt ?? g.t ?? 0.1} s`, outputLabel: 'Impulse', outputUnit: 'N·s',
      compute: (F) => F * (g.dt ?? g.t ?? 0.1), relation: `J = F Δt   (Δt = ${g.dt ?? g.t ?? 0.1} s)`, decimals: 2,
    }),
  },
  'projectile-components': {
    title: 'Velocity components: v_x and v_y',
    formula: 'v_x = v cosθ,  v_y = v sinθ',
    build: (g) => ({
      inputLabel: 'Launch speed', inputUnit: 'm/s', min: 0, max: 30, step: 1, default: g.v ?? 20,
      constLabel: `θ = ${g.theta ?? g.θ ?? 45}°`, outputLabel: 'Vertical component v_y', outputUnit: 'm/s',
      compute: (v) => v * Math.sin(((g.theta ?? g.θ ?? 45) * Math.PI) / 180),
      relation: `v_y = v sinθ   (θ = ${g.theta ?? g.θ ?? 45}°)`, decimals: 1,
    }),
  },
  'max-height': {
    title: 'Max height: H = v_y² / (2g)',
    formula: 'H = v_y² / (2g)',
    build: (g) => ({
      inputLabel: 'Vertical speed v_y', inputUnit: 'm/s', min: 0, max: 25, step: 0.5, default: g.vy ?? g.v_y ?? 10,
      constLabel: `g = ${g.g ?? 10} m/s²`, outputLabel: 'Max height', outputUnit: 'm',
      compute: (vy) => (vy * vy) / (2 * (g.g ?? 10)), relation: `H = v_y² / (2g)   (g = ${g.g ?? 10})`, decimals: 1,
    }),
  },
  'displacement-accel': {
    title: 'Distance from rest: s = ½ a t²',
    formula: 's = ½ a t²',
    build: (g) => ({
      inputLabel: 'Acceleration', inputUnit: 'm/s²', min: 0, max: 12, step: 0.5, default: g.a ?? 4,
      constLabel: `from rest, t = ${g.t ?? 3} s`, outputLabel: 'Distance', outputUnit: 'm',
      compute: (a) => 0.5 * a * (g.t ?? 3) ** 2, relation: `s = ½ a t²   (t = ${g.t ?? 3} s)`, decimals: 1,
    }),
  },
  'area-under-vt': {
    title: 'Displacement = area under v–t graph',
    formula: 'Δx = v t',
    build: (g) => ({
      inputLabel: 'Velocity', inputUnit: 'm/s', min: 0, max: 20, step: 1, default: g.v ?? 6,
      constLabel: `over t = ${g.t ?? 5} s`, outputLabel: 'Displacement', outputUnit: 'm',
      compute: (v) => v * (g.t ?? 5), relation: `Δx = v t   (t = ${g.t ?? 5} s)`, decimals: 1,
    }),
  },
}

function unitFallback(unitId: UnitId): MiniLessonDef {
  return MINI_LESSONS[unitId] ?? MINI_LESSONS.kinematics
}

/** Build an interactive lesson tailored to the exact bank question that follows it. */
export function lessonFromQuestion(q: BankQuestion): MiniLessonDef {
  const given = q.given ?? {}
  const cv = q.correctValue
  const spec = CONCEPT_MODELS[q.conceptTag]
  const base = unitFallback(q.unitId)

  if (spec && cv != null) {
    const model = spec.build(given)
    const firstSentence = q.explanation.split(/[.!?]/)[0]?.trim()
    return {
      unitId: q.unitId,
      title: spec.title,
      formula: q.formulas?.[0] ?? spec.formula,
      model,
      variants: [
        {
          heading: pretty(q.conceptTag),
          body: `This problem uses ${q.formulas?.[0] ?? spec.formula}. Drag the slider and watch the output track the relationship — the question asks for ${cv}.`,
        },
        {
          heading: 'Slow it down',
          body: firstSentence ? `${firstSentence}.` : q.explanation,
        },
        ...base.variants.slice(1),
      ],
    }
  }

  return {
    ...base,
    unitId: q.unitId,
    formula: q.formulas?.[0] ?? base.formula,
    variants: [
      { heading: pretty(q.conceptTag), body: q.explanation },
      ...base.variants,
    ],
  }
}
