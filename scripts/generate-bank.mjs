// Generates the 5-unit question bank: 100 questions per unit, difficulty 1-5,
// AP Physics 1 style. Numeric answers are COMPUTED here so they are correct by
// construction; a portion carry programmatic diagrams; the top levels include
// hand-authored conceptual questions. The old goalie/impulse content is folded
// into the single `momentum` unit.
//
//   npm run bank:generate   (node scripts/generate-bank.mjs)
//
// Writes src/content/bank/{kinematics,motion-graphs,forces,energy,momentum}.json

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BANK = join(__dirname, '..', 'src', 'content', 'bank')
const LETTERS = ['a', 'b', 'c', 'd']
const PER_UNIT = 100

const round2 = (v) => Math.round(v * 100) / 100
function fnum(v) {
  const r = round2(v)
  return Number.isInteger(r) ? String(r) : String(r)
}
function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
function rng(seed) {
  let a = hash(seed)
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffleSeeded(arr, seed) {
  const r = rng(seed)
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
function uniqueThree(correct, cands) {
  const out = []
  for (const c of cands) {
    const v = round2(c)
    if (!Number.isFinite(v) || v === correct || out.includes(v) || v < 0) continue
    out.push(v)
    if (out.length === 3) break
  }
  let k = 1
  while (out.length < 3) {
    const v = round2(correct + k * Math.max(1, Math.abs(correct) * 0.2))
    if (v !== correct && !out.includes(v) && v >= 0) out.push(v)
    k++
    if (k > 60) break
  }
  while (out.length < 3) out.push(round2(Math.abs(correct) + out.length + 1))
  return out.slice(0, 3)
}

// ---- spec factories -------------------------------------------------------
function num(o) {
  return { kind: 'num', ...o }
}
function mc(o) {
  return { kind: 'mc', ...o }
}

function buildQuestion(spec, id) {
  if (spec.kind === 'mc') {
    const entries = spec.options.map((label, i) => ({ label, correct: i === spec.correctIndex }))
    const order = shuffleSeeded(entries, id)
    const choices = order.map((e, i) => ({ id: LETTERS[i], label: e.label }))
    const correctChoiceId = LETTERS[order.findIndex((e) => e.correct)]
    const q = {
      id,
      unitId: spec.unitId,
      conceptTag: spec.conceptTag,
      difficulty: spec.difficulty,
      prompt: spec.prompt,
      choices,
      correctChoiceId,
    }
    if (spec.formulas) q.formulas = spec.formulas
    if (spec.diagram) q.diagram = spec.diagram
    q.explanation = spec.explanation ?? ''
    return q
  }
  const correct = round2(spec.value)
  const ds = uniqueThree(correct, (spec.distractors ?? []).map(round2))
  const unit = spec.unit ? ` ${spec.unit}` : ''
  const entries = [
    { v: correct, correct: true },
    ...ds.map((v) => ({ v, correct: false })),
  ]
  const order = shuffleSeeded(entries, id)
  const choices = order.map((e, i) => ({ id: LETTERS[i], label: `${fnum(e.v)}${unit}` }))
  const correctChoiceId = LETTERS[order.findIndex((e) => e.correct)]
  const q = {
    id,
    unitId: spec.unitId,
    conceptTag: spec.conceptTag,
    difficulty: spec.difficulty,
    prompt: spec.prompt,
    choices,
    correctChoiceId,
    correctValue: correct,
  }
  if (spec.given) q.given = spec.given
  if (spec.formulas) q.formulas = spec.formulas
  if (spec.diagram) q.diagram = spec.diagram
  q.explanation = spec.explanation ?? ''
  return q
}

function assemble(prefix, unitId, specs) {
  const list = specs.slice(0, PER_UNIT)
  if (list.length < PER_UNIT) throw new Error(`${prefix}: only ${list.length} specs (<${PER_UNIT})`)
  for (const s of list) s.unitId = unitId
  const byDiff = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const s of list) byDiff[s.difficulty]++
  for (const d of [1, 2, 3, 4, 5]) {
    if (byDiff[d] < 8) console.warn(`WARN ${prefix} difficulty ${d}: only ${byDiff[d]}`)
  }
  return list.map((s, i) => buildQuestion(s, `${prefix}-${i + 1}`))
}

// ---- main (unit builders are function declarations, hoisted) --------------
function main() {
  const files = {
    'kinematics.json': assemble('kin', 'kinematics', buildKinematics()),
    'motion-graphs.json': assemble('mot', 'motion-graphs', buildMotion()),
    'forces.json': assemble('for', 'forces', buildForces()),
    'energy.json': assemble('ene', 'energy', buildEnergy()),
    'momentum.json': assemble('mom', 'momentum', buildMomentum()),
  }
  let total = 0
  for (const [file, qs] of Object.entries(files)) {
    writeFileSync(join(BANK, file), JSON.stringify(qs, null, 2) + '\n')
    const diag = qs.filter((q) => q.diagram).length
    console.log(`${file.padEnd(20)} ${qs.length} questions (${diag} with diagrams)`)
    total += qs.length
  }
  console.log(`TOTAL: ${total}`)
}

// === UNIT BUILDERS BELOW ===

function buildMomentum() {
  const P = { 1: [], 2: [], 3: [], 4: [], 5: [] }
  const coll = (m1, v1, m2, v2) => ({ kind: 'collision', params: { left: { m: m1, v: v1, label: `${m1} kg` }, right: { m: m2, v: v2, label: `${m2} kg` } }, caption: 'Collision' })
  const ft = (F, dt) => ({ kind: 'force-time', params: { yLabel: 'force (N)', xLabel: 'time (s)', xMax: dt, yMax: F, shade: true, lines: [{ points: [[0, F], [dt, F]], label: 'contact force' }] }, caption: 'Force vs time (impulse = area)' })

  // L1
  P[1].push(mc({ conceptTag: 'units', difficulty: 1,
    prompt: 'What are the units of momentum?',
    options: ['kg·m/s', 'kg·m/s²', 'N·m', 'm/s'], correctIndex: 0,
    explanation: 'Momentum p = mv has units kg·m/s (equivalently N·s).' }))
  P[1].push(mc({ conceptTag: 'momentum-formula', difficulty: 1,
    prompt: 'Which is the formula for momentum?',
    options: ['p = m v', 'p = ½ m v²', 'p = m g h', 'p = F / t'], correctIndex: 0,
    explanation: 'Momentum is mass times velocity, p = mv.' }))
  for (const [m, v] of [[0.43, 20], [2, 5], [1, 10], [5, 4], [3, 6], [0.43, 10], [2, 8], [4, 5], [0.43, 30], [1, 12]]) {
    P[1].push(num({ conceptTag: 'momentum-collisions', difficulty: 1,
      prompt: `A ${m} kg ball moves at ${v} m/s. What is its momentum?`,
      formulas: ['p = m v'], given: { m, v }, value: m * v, unit: 'kg·m/s',
      distractors: [m + v, 0.5 * m * v * v, v / m], explanation: `p = mv = ${m}×${v} = ${fnum(m * v)} kg·m/s.` }))
  }
  for (const [F, dt] of [[50, 0.1], [20, 0.2], [100, 0.1], [30, 0.5], [40, 0.1], [60, 0.2], [80, 0.1], [25, 0.2], [10, 0.5], [200, 0.1]]) {
    P[1].push(num({ conceptTag: 'impulse', difficulty: 1,
      prompt: `A foot applies ${F} N to the ball for ${dt} s. What impulse does it deliver?`,
      formulas: ['J = F Δt'], given: { F, dt }, value: F * dt, unit: 'N·s',
      distractors: [F / dt, F + dt, F], explanation: `J = FΔt = ${F}×${dt} = ${fnum(F * dt)} N·s.` }))
  }

  // L2 p=mv, J=FΔt
  for (const [m, v] of [[0.43, 25], [2, 8], [4, 6], [1.5, 10], [3, 7], [0.43, 15], [5, 6], [2.5, 8], [2, 12], [4, 9], [0.43, 30], [3, 10]]) {
    P[2].push(num({ conceptTag: 'momentum-collisions', difficulty: 2,
      prompt: `A ${m} kg ball is struck to ${v} m/s. What is its momentum?`,
      formulas: ['p = m v'], given: { m, v }, value: m * v, unit: 'kg·m/s',
      distractors: [m + v, m * v * 2, 0.5 * m * v], explanation: `p = mv = ${m}×${v} = ${fnum(m * v)} kg·m/s.` }))
  }
  for (const [F, dt] of [[80, 0.1], [120, 0.1], [50, 0.2], [200, 0.05], [90, 0.1], [60, 0.5], [150, 0.1], [40, 0.2], [100, 0.1], [70, 0.2]]) {
    P[2].push(num({ conceptTag: 'impulse', difficulty: 2,
      prompt: `A keeper's hands push the ball with ${F} N for ${dt} s. What is the impulse on the ball?`,
      formulas: ['J = F Δt'], given: { F, dt }, value: F * dt, unit: 'N·s',
      distractors: [F / dt, F * dt * 2, F + dt], diagram: ft(F, dt),
      explanation: `J = FΔt = ${F}×${dt} = ${fnum(F * dt)} N·s.` }))
  }

  // L3 Δp, F=Δp/Δt, impulse=Δp
  for (const [m, u, v] of [[0.43, 0, 20], [2, 3, 8], [1, 5, 15], [0.43, 10, 30], [3, 2, 6], [4, 1, 5], [2, 4, 10], [5, 2, 8]]) {
    const val = m * (v - u)
    P[3].push(num({ conceptTag: 'impulse', difficulty: 3,
      prompt: `A ${m} kg ball changes speed from ${u} m/s to ${v} m/s in the same direction. What is the change in momentum?`,
      formulas: ['Δp = m(v − u)'], given: { m, u, v }, value: val, unit: 'kg·m/s',
      distractors: [m * (v + u), m * v, v - u], explanation: `Δp = m(v − u) = ${m}×(${v} − ${u}) = ${fnum(val)} kg·m/s.` }))
  }
  for (const [m, v, dt] of [[0.43, 20, 0.1], [2, 6, 0.2], [1, 10, 0.5], [0.43, 30, 0.1], [3, 8, 0.4], [5, 4, 0.2]]) {
    const dp = m * v
    const val = dp / dt
    P[3].push(num({ conceptTag: 'impulse', difficulty: 3,
      prompt: `A ${m} kg ball is brought from ${v} m/s to rest in ${dt} s. What average force acted on it?`,
      formulas: ['F = Δp / Δt'], given: { m, v, dt }, value: val, unit: 'N',
      distractors: [dp * dt, m * v * v, m / dt], diagram: ft(round2(val), dt),
      explanation: `Δp = mv = ${fnum(dp)} kg·m/s, so F = Δp/Δt = ${fnum(dp)}/${dt} = ${fnum(val)} N.` }))
  }
  for (const [F, dt] of [[200, 0.1], [150, 0.2], [300, 0.1], [80, 0.5], [120, 0.25], [250, 0.1]]) {
    P[3].push(num({ conceptTag: 'impulse', difficulty: 3,
      prompt: `Using the area under the force-time graph, what impulse does a constant ${F} N delivered over ${dt} s provide?`,
      formulas: ['J = area = F Δt'], given: { F, dt }, value: F * dt, unit: 'N·s',
      distractors: [F / dt, 0.5 * F * dt, F], diagram: ft(F, dt),
      explanation: `Area of the rectangle = F × Δt = ${F}×${dt} = ${fnum(F * dt)} N·s.` }))
  }

  // L4 inelastic collisions + conservation
  for (const [m1, v1, m2] of [[2, 6, 1], [4, 5, 1], [3, 8, 1], [2, 9, 4], [1, 10, 1], [6, 4, 2], [2, 12, 2], [3, 6, 3]]) {
    const val = (m1 * v1) / (m1 + m2)
    P[4].push(num({ conceptTag: 'momentum-collisions', difficulty: 4,
      prompt: `A ${m1} kg ball moving at ${v1} m/s strikes a stationary ${m2} kg ball and they stick together. What is their common velocity afterward?`,
      formulas: ['m₁v₁ = (m₁+m₂)v\u2032'], given: { m1, v1, m2 }, value: val, unit: 'm/s',
      distractors: [v1, (m1 * v1) / m2, m1 * v1], diagram: coll(m1, v1, m2, 0),
      explanation: `Momentum conserved: v\u2032 = m₁v₁/(m₁+m₂) = ${m1}×${v1}/${m1 + m2} = ${fnum(val)} m/s.` }))
  }
  for (const [m1, v1, m2, v2] of [[2, 5, 3, 0], [1, 8, 1, -2], [4, 3, 2, 0], [2, 6, 2, -2], [5, 2, 5, 0], [3, 4, 1, 0]]) {
    const val = (m1 * v1 + m2 * v2) / (m1 + m2)
    P[4].push(num({ conceptTag: 'momentum-collisions', difficulty: 4,
      prompt: `A ${m1} kg ball at ${v1} m/s and a ${m2} kg ball at ${v2} m/s collide and move off together. Find their final velocity (rightward positive).`,
      formulas: ['m₁v₁ + m₂v₂ = (m₁+m₂)v\u2032'], given: { m1, v1, m2, v2 }, value: val, unit: 'm/s',
      distractors: [(m1 * v1 - m2 * v2) / (m1 + m2), v1 + v2, (m1 * v1 + m2 * v2)], diagram: coll(m1, v1, m2, v2),
      explanation: `v\u2032 = (m₁v₁ + m₂v₂)/(m₁+m₂) = (${m1 * v1} + ${m2 * v2})/${m1 + m2} = ${fnum(val)} m/s.` }))
  }
  for (const [J, dt] of [[20, 0.1], [30, 0.2], [15, 0.5], [40, 0.1], [12, 0.4], [50, 0.25]]) {
    P[4].push(num({ conceptTag: 'impulse', difficulty: 4,
      prompt: `An impulse of ${J} N·s is delivered to a ball over ${dt} s. What average force was applied?`,
      formulas: ['F = J / Δt'], given: { J, dt }, value: J / dt, unit: 'N',
      distractors: [J * dt, dt / J, J], diagram: ft(round2(J / dt), dt),
      explanation: `F = J/Δt = ${J}/${dt} = ${fnum(J / dt)} N.` }))
  }

  // L5 conceptual
  P[5].push(mc({ conceptTag: 'conservation-of-momentum', difficulty: 5,
    prompt: 'Two players collide in mid-air with no external horizontal forces. The total momentum of the pair afterward is:',
    options: ['The same as before the collision', 'Zero', 'Greater than before', 'Half of before'],
    correctIndex: 0, explanation: 'With no external force, total momentum is conserved — unchanged by the collision.' }))
  P[5].push(mc({ conceptTag: 'impulse-momentum-theorem', difficulty: 5,
    prompt: 'The impulse-momentum theorem says the impulse on an object equals its:',
    options: ['Change in momentum', 'Kinetic energy', 'Weight', 'Acceleration'],
    correctIndex: 0, explanation: 'J = FΔt = Δp — impulse equals the change in momentum.' }))
  P[5].push(mc({ conceptTag: 'follow-through', difficulty: 5,
    prompt: 'Why does following through on a kick (extending contact time) help?',
    options: ['Longer contact time delivers more impulse, so more momentum', 'It reduces the ball\u2019s mass', 'It lowers the force to zero', 'It removes friction'],
    correctIndex: 0, explanation: 'J = FΔt: keeping force on the ball for longer Δt delivers more impulse and final momentum.' }))
  P[5].push(mc({ conceptTag: 'cushioning', difficulty: 5,
    prompt: 'A keeper "gives" with the ball, catching it over a longer time. For the same change in momentum, this:',
    options: ['Reduces the force on the hands', 'Increases the force', 'Changes the impulse', 'Has no effect'],
    correctIndex: 0, explanation: 'Δp is fixed; F = Δp/Δt, so a larger Δt means a smaller force.' }))
  P[5].push(mc({ conceptTag: 'momentum-vector', difficulty: 5,
    prompt: 'Two identical balls have the same speed but move in opposite directions. Their momenta are:',
    options: ['Equal in magnitude, opposite in direction', 'Identical', 'Both zero', 'Unrelated'],
    correctIndex: 0, explanation: 'Momentum is a vector; same mass and speed but opposite directions give opposite-sign momenta.' }))
  P[5].push(mc({ conceptTag: 'impulse-units', difficulty: 5,
    prompt: 'Which is equivalent to one newton-second (N·s)?',
    options: ['1 kg·m/s', '1 J', '1 W', '1 kg·m/s²'],
    correctIndex: 0, explanation: 'N·s = (kg·m/s²)·s = kg·m/s, the units of momentum.' }))
  P[5].push(mc({ conceptTag: 'equal-opposite-impulse', difficulty: 5,
    prompt: 'During a collision between two balls, the impulse each exerts on the other is:',
    options: ['Equal in magnitude and opposite in direction', 'Larger for the heavier ball', 'Zero', 'In the same direction'],
    correctIndex: 0, explanation: 'By Newton\u2019s third law the forces (and so impulses) are equal and opposite.' }))
  P[5].push(mc({ conceptTag: 'elastic-vs-inelastic', difficulty: 5,
    prompt: 'In a perfectly inelastic collision, which quantity is definitely conserved?',
    options: ['Total momentum', 'Total kinetic energy', 'Both momentum and kinetic energy', 'Neither'],
    correctIndex: 0, explanation: 'Momentum is conserved in all collisions; kinetic energy is lost in inelastic ones.' }))
  for (const [m1, v1, m2] of [[2, 9, 1], [3, 8, 1], [4, 5, 1], [5, 6, 1], [2, 10, 2], [3, 9, 1], [4, 6, 2], [6, 5, 4]]) {
    const val = (m1 * v1) / (m1 + m2)
    P[5].push(num({ conceptTag: 'momentum-collisions', difficulty: 5,
      prompt: `A ${m1} kg attacker at ${v1} m/s tackles a stationary ${m2} kg ball-carrier and they move together. Find the common speed (conservation of momentum).`,
      formulas: ['m₁v₁ = (m₁+m₂)v\u2032'], given: { m1, v1, m2 }, value: val, unit: 'm/s',
      distractors: [v1, (m1 * v1) / m2, (m1 + m2) / (m1 * v1)], diagram: coll(m1, v1, m2, 0),
      explanation: `v\u2032 = m₁v₁/(m₁+m₂) = ${m1 * v1}/${m1 + m2} = ${fnum(val)} m/s.` }))
  }

  return [
    ...P[1].slice(0, 22), ...P[2].slice(0, 22), ...P[3].slice(0, 20),
    ...P[4].slice(0, 20), ...P[5].slice(0, 16),
  ]
}

function buildEnergy() {
  const g = 10
  const P = { 1: [], 2: [], 3: [], 4: [], 5: [] }
  const ramp = (deg) => ({ kind: 'ramp', params: { angleDeg: deg, blockLabel: 'ball', showForces: false }, caption: `Ball on a ${deg}° ramp` })

  // L1
  P[1].push(mc({ conceptTag: 'units', difficulty: 1,
    prompt: 'What is the SI unit of energy?',
    options: ['Joule (J)', 'Newton (N)', 'Watt (W)', 'm/s'], correctIndex: 0,
    explanation: 'Energy and work are measured in joules (J = N·m).' }))
  P[1].push(mc({ conceptTag: 'ke-formula', difficulty: 1,
    prompt: 'Which is the formula for kinetic energy?',
    options: ['KE = ½ m v²', 'KE = m g h', 'KE = m v', 'KE = F d'], correctIndex: 0,
    explanation: 'Kinetic energy is ½mv²; mgh is gravitational potential energy.' }))
  for (const [m, h] of [[2, 5], [1, 10], [5, 2], [3, 4], [10, 1], [4, 5], [6, 3], [2, 8], [8, 2], [5, 4]]) {
    P[1].push(num({ conceptTag: 'gravitational-pe', difficulty: 1,
      prompt: `A ${m} kg ball is held ${h} m above the pitch. What is its gravitational potential energy? (g = 10)`,
      formulas: ['PE = m g h'], given: { m, h, g }, value: m * g * h, unit: 'J',
      distractors: [m * h, m + g + h, m * g], explanation: `PE = mgh = ${m}×10×${h} = ${m * g * h} J.` }))
  }
  for (const [F, d] of [[20, 3], [50, 2], [10, 5], [30, 4], [25, 4], [40, 2], [15, 4], [60, 3], [35, 2], [45, 2]]) {
    P[1].push(num({ conceptTag: 'work', difficulty: 1,
      prompt: `A player pushes a ball with a constant ${F} N over ${d} m (same direction). How much work is done?`,
      formulas: ['W = F d'], given: { F, d }, value: F * d, unit: 'J',
      distractors: [F + d, F / d, F * d * 2], explanation: `W = Fd = ${F}×${d} = ${F * d} J.` }))
  }

  // L2 KE, PE
  for (const [m, v] of [[2, 10], [0.5, 4], [1, 6], [4, 5], [2, 6], [5, 2], [1, 10], [3, 4], [3, 6], [0.5, 10], [2, 5], [4, 4]]) {
    P[2].push(num({ conceptTag: 'kinetic-energy', difficulty: 2,
      prompt: `A ${m} kg ball moves at ${v} m/s. What is its kinetic energy?`,
      formulas: ['KE = ½ m v²'], given: { m, v }, value: 0.5 * m * v * v, unit: 'J',
      distractors: [m * v * v, 0.5 * m * v, m * v], explanation: `KE = ½mv² = 0.5×${m}×${v}² = ${fnum(0.5 * m * v * v)} J.` }))
  }
  for (const [m, h] of [[2, 8], [5, 6], [3, 10], [10, 4], [4, 7], [6, 5], [2, 12], [5, 8], [8, 5], [3, 6]]) {
    P[2].push(num({ conceptTag: 'gravitational-pe', difficulty: 2,
      prompt: `A ${m} kg ball is lifted to ${h} m. What is its gravitational PE? (g = 10)`,
      formulas: ['PE = m g h'], given: { m, h, g }, value: m * g * h, unit: 'J',
      distractors: [m * h, 0.5 * m * g * h, m + h], explanation: `PE = mgh = ${m}×10×${h} = ${m * g * h} J.` }))
  }

  // L3 conservation v=√(2gh), h=v²/2g, work
  for (const [h, v] of [[5, 10], [20, 20], [45, 30], [0.8, 4], [1.25, 5], [3.2, 8], [7.2, 12], [11.25, 15]]) {
    P[3].push(num({ conceptTag: 'energy-conservation', difficulty: 3,
      prompt: `A ball is dropped from rest at ${h} m. Using energy conservation, what is its speed just before it lands? (g = 10)`,
      formulas: ['mgh = ½mv²', 'v = √(2gh)'], given: { h, g }, value: v, unit: 'm/s',
      distractors: [2 * g * h, Math.sqrt(g * h), h * g], diagram: ramp(40),
      explanation: `v = √(2gh) = √(2×10×${h}) = √${2 * g * h} = ${v} m/s.` }))
  }
  for (const [v, h] of [[10, 5], [20, 20], [30, 45], [5, 1.25], [8, 3.2], [15, 11.25], [12, 7.2]]) {
    P[3].push(num({ conceptTag: 'energy-conservation', difficulty: 3,
      prompt: `A ball is launched straight up at ${v} m/s. Using energy conservation, what height does it reach? (g = 10)`,
      formulas: ['½mv² = mgh', 'h = v² / (2g)'], given: { v, g }, value: h, unit: 'm',
      distractors: [v * v / g, v / (2 * g), v], explanation: `h = v²/(2g) = ${v}²/20 = ${fnum(h)} m.` }))
  }
  for (const [F, d] of [[60, 3], [45, 4], [100, 2], [25, 6], [80, 5], [120, 2], [90, 3]]) {
    P[3].push(num({ conceptTag: 'work', difficulty: 3,
      prompt: `A constant force of ${F} N acts over ${d} m in its own direction. How much work is done on the ball?`,
      formulas: ['W = F d'], given: { F, d }, value: F * d, unit: 'J',
      distractors: [F + d, F / d, 0.5 * F * d], explanation: `W = Fd = ${F}×${d} = ${F * d} J.` }))
  }

  // L4 power, work-energy, conservation combos
  for (const [W, t] of [[100, 5], [200, 4], [60, 3], [150, 5], [80, 2], [120, 6], [300, 5], [90, 3]]) {
    P[4].push(num({ conceptTag: 'power', difficulty: 4,
      prompt: `A player does ${W} J of work in ${t} s. What is the average power output?`,
      formulas: ['P = W / t'], given: { W, t }, value: W / t, unit: 'W',
      distractors: [W * t, t / W, W - t], explanation: `P = W/t = ${W}/${t} = ${fnum(W / t)} W.` }))
  }
  for (const [m, v] of [[2, 10], [1, 6], [4, 5], [0.5, 8], [5, 4], [2, 8]]) {
    const ke = 0.5 * m * v * v
    P[4].push(num({ conceptTag: 'work-energy-theorem', difficulty: 4,
      prompt: `A ${m} kg ball starts at rest. How much work must be done to bring it to ${v} m/s?`,
      formulas: ['W = ΔKE = ½ m v²'], given: { m, v }, value: ke, unit: 'J',
      distractors: [m * v * v, 0.5 * m * v, m * v], explanation: `W = ΔKE = ½mv² = 0.5×${m}×${v}² = ${fnum(ke)} J.` }))
  }
  for (const [m, h] of [[2, 5], [1, 20], [4, 5], [0.5, 45], [2, 20], [5, 5]]) {
    const ke = m * g * h
    P[4].push(num({ conceptTag: 'energy-conservation', difficulty: 4,
      prompt: `A ${m} kg ball falls from rest through ${h} m. What is its kinetic energy just before landing? (g = 10)`,
      formulas: ['KE = PE_lost = m g h'], given: { m, h, g }, value: ke, unit: 'J',
      distractors: [0.5 * m * g * h, m * h, m * g], diagram: ramp(50),
      explanation: `All PE converts to KE: KE = mgh = ${m}×10×${h} = ${ke} J.` }))
  }

  // L5 conceptual
  P[5].push(mc({ conceptTag: 'energy-conservation', difficulty: 5,
    prompt: 'A ball is dropped from a height. Where is its kinetic energy the greatest?',
    options: ['Just before it hits the ground', 'At the moment of release', 'Halfway down', 'It is constant throughout'],
    correctIndex: 0, explanation: 'PE converts to KE as it falls, so KE is maximum (and PE minimum) right before impact.' }))
  P[5].push(mc({ conceptTag: 'ke-speed-squared', difficulty: 5,
    prompt: 'If a ball\u2019s speed doubles, its kinetic energy:',
    options: ['Quadruples', 'Doubles', 'Halves', 'Stays the same'],
    correctIndex: 0, explanation: 'KE ∝ v², so doubling the speed gives 2² = 4× the kinetic energy.' }))
  P[5].push(mc({ conceptTag: 'pe-max-location', difficulty: 5,
    prompt: 'For a ball tossed straight up, where is its gravitational PE greatest?',
    options: ['At the highest point', 'At launch', 'Halfway up', 'Just before landing'],
    correctIndex: 0, explanation: 'PE = mgh is largest where h is largest — the top of the flight.' }))
  P[5].push(mc({ conceptTag: 'mass-independence', difficulty: 5,
    prompt: 'A heavy ball and a light ball are dropped from the same height (no air resistance). Which is faster at the bottom?',
    options: ['They have the same speed', 'The heavy ball', 'The light ball', 'Cannot tell'],
    correctIndex: 0, explanation: 'v = √(2gh) is independent of mass, so both reach the same landing speed.' }))
  P[5].push(mc({ conceptTag: 'work-energy-theorem', difficulty: 5,
    prompt: 'The work-energy theorem states that the net work done on an object equals its:',
    options: ['Change in kinetic energy', 'Total potential energy', 'Momentum', 'Weight'],
    correctIndex: 0, explanation: 'W_net = ΔKE — net work changes the kinetic energy.' }))
  P[5].push(mc({ conceptTag: 'energy-transformation', difficulty: 5,
    prompt: 'As a ball rolls down a frictionless ramp, the energy transformation is:',
    options: ['Potential energy → kinetic energy', 'Kinetic → potential', 'Energy is destroyed', 'Heat → potential'],
    correctIndex: 0, explanation: 'Height (PE) is lost and speed (KE) is gained; total mechanical energy is conserved.' }))
  P[5].push(mc({ conceptTag: 'zero-work', difficulty: 5,
    prompt: 'You carry a ball horizontally at constant height and speed. How much work does your lifting force do against gravity?',
    options: ['Zero (no vertical displacement)', 'mgh', 'Equal to the ball\u2019s KE', 'Negative'],
    correctIndex: 0, explanation: 'Work against gravity needs vertical displacement; moving horizontally does none.' }))
  P[5].push(mc({ conceptTag: 'energy-units', difficulty: 5,
    prompt: 'Which combination of units also equals a joule?',
    options: ['kg·m²/s²', 'kg·m/s', 'N/s', 'kg·m/s²'],
    correctIndex: 0, explanation: 'J = N·m = (kg·m/s²)·m = kg·m²/s².' }))
  for (const [m, h] of [[2, 5], [1, 20], [4, 5], [0.5, 80], [2, 45], [3, 20], [1, 7.2], [5, 11.25]]) {
    const v = Math.sqrt(2 * g * h)
    P[5].push(num({ conceptTag: 'energy-conservation', difficulty: 5,
      prompt: `A ${m} kg ball is released from ${h} m. Using energy conservation, find its landing speed. (g = 10)`,
      formulas: ['mgh = ½mv²', 'v = √(2gh)'], given: { m, h, g }, value: v, unit: 'm/s',
      distractors: [2 * g * h, m * h, Math.sqrt(g * h)], explanation: `Mass cancels: v = √(2gh) = √(${2 * g * h}) = ${fnum(v)} m/s.` }))
  }

  return [
    ...P[1].slice(0, 22), ...P[2].slice(0, 22), ...P[3].slice(0, 20),
    ...P[4].slice(0, 20), ...P[5].slice(0, 16),
  ]
}

function buildForces() {
  const g = 10
  const P = { 1: [], 2: [], 3: [], 4: [], 5: [] }
  const fbd = (forces, label = 'ball') => ({ kind: 'free-body', params: { bodyLabel: label, forces }, caption: 'Free-body diagram' })
  const ramp = (deg) => ({ kind: 'ramp', params: { angleDeg: deg, blockLabel: 'ball', showForces: true }, caption: `Ramp at ${deg}°` })

  // L1
  P[1].push(mc({ conceptTag: 'units', difficulty: 1,
    prompt: 'What is the SI unit of force?',
    options: ['Newton (N)', 'Joule (J)', 'Watt (W)', 'Pascal (Pa)'], correctIndex: 0,
    explanation: '1 N = 1 kg·m/s², the SI unit of force.' }))
  P[1].push(mc({ conceptTag: 'newton-second-law', difficulty: 1,
    prompt: 'Which equation is Newton\u2019s second law?',
    options: ['F = m a', 'F = m / a', 'F = a / m', 'F = m + a'], correctIndex: 0,
    explanation: 'Net force equals mass times acceleration: F = ma.' }))
  for (const [m, a] of [[2, 3], [5, 2], [1, 10], [4, 5], [3, 4], [10, 2], [2, 5], [6, 3], [8, 2], [2, 4], [5, 3], [3, 6]]) {
    P[1].push(num({ conceptTag: 'force-net-force', difficulty: 1,
      prompt: `A ${m} kg ball is pushed with an acceleration of ${a} m/s². What net force acts on it?`,
      formulas: ['F = m a'], given: { m, a }, value: m * a, unit: 'N',
      distractors: [m + a, m / a, a / m], explanation: `F = ma = ${m}×${a} = ${m * a} N.` }))
  }
  for (const m of [1, 2, 5, 10, 3, 4, 6, 8, 7, 9]) {
    P[1].push(num({ conceptTag: 'weight', difficulty: 1,
      prompt: `What is the weight of a ${m} kg object near Earth's surface? (g = 10 m/s²)`,
      formulas: ['W = m g'], given: { m, g }, value: m * g, unit: 'N',
      distractors: [m, m / g, m + g], explanation: `W = mg = ${m}×10 = ${m * g} N.` }))
  }

  // L2
  for (const [m, a] of [[0.5, 8], [2, 6], [5, 4], [4, 3], [8, 5], [2.5, 4], [6, 5], [1.5, 6]]) {
    P[2].push(num({ conceptTag: 'force-net-force', difficulty: 2,
      prompt: `A ${m} kg ball accelerates at ${a} m/s². What net force is required?`,
      formulas: ['F = m a'], given: { m, a }, value: m * a, unit: 'N',
      distractors: [m + a, m / a, m * a * 2], explanation: `F = ma = ${m}×${a} = ${fnum(m * a)} N.` }))
  }
  for (const [F, m] of [[20, 4], [30, 5], [50, 10], [12, 3], [40, 8], [18, 6], [24, 4], [15, 5]]) {
    P[2].push(num({ conceptTag: 'force-acceleration', difficulty: 2,
      prompt: `A net force of ${F} N acts on a ${m} kg ball. What is its acceleration?`,
      formulas: ['a = F / m'], given: { F, m }, value: F / m, unit: 'm/s²',
      distractors: [F * m, m / F, F - m], explanation: `a = F/m = ${F}/${m} = ${fnum(F / m)} m/s².` }))
  }
  for (const [F, a] of [[20, 5], [30, 6], [40, 8], [12, 4], [50, 10], [24, 4]]) {
    P[2].push(num({ conceptTag: 'force-mass', difficulty: 2,
      prompt: `A net force of ${F} N gives an object an acceleration of ${a} m/s². What is its mass?`,
      formulas: ['m = F / a'], given: { F, a }, value: F / a, unit: 'kg',
      distractors: [F * a, a / F, F - a], explanation: `m = F/a = ${F}/${a} = ${fnum(F / a)} kg.` }))
  }

  // L3 net force (free-body) + friction
  for (const [f1, f2, m] of [[20, 5, 3], [30, 10, 4], [50, 20, 5], [18, 6, 2], [40, 10, 6], [25, 5, 4], [35, 15, 5], [28, 8, 4], [22, 2, 4], [44, 4, 8]]) {
    const net = f1 - f2
    P[3].push(num({ conceptTag: 'net-force', difficulty: 3,
      prompt: `A ${m} kg ball is pushed forward with ${f1} N while friction pushes back with ${f2} N. What is the net force?`,
      formulas: ['F_net = ΣF'], given: { f1, f2 }, value: net, unit: 'N',
      distractors: [f1 + f2, f1, net / m], diagram: fbd([{ dir: 'right', label: `${f1} N` }, { dir: 'left', label: `${f2} N` }]),
      explanation: `F_net = ${f1} − ${f2} = ${net} N (forward).` }))
  }
  for (const [mu, m] of [[0.5, 4], [0.2, 10], [0.1, 5], [0.5, 2], [0.4, 5], [0.2, 6]]) {
    const N = m * g
    const val = mu * N
    P[3].push(num({ conceptTag: 'friction', difficulty: 3,
      prompt: `A ${m} kg ball sits on turf with coefficient of friction μ = ${mu}. What is the maximum friction force? (g = 10)`,
      formulas: ['f = μ N', 'N = m g'], given: { mu, m, g }, value: val, unit: 'N',
      distractors: [mu * m, N, mu + N], explanation: `N = mg = ${N} N, so f = μN = ${mu}×${N} = ${fnum(val)} N.` }))
  }
  for (const [f1, f2, m] of [[30, 6, 3], [40, 10, 5], [24, 4, 4], [36, 6, 5], [20, 4, 4], [50, 10, 8]] ) {
    const a = (f1 - f2) / m
    P[3].push(num({ conceptTag: 'net-force-accel', difficulty: 3,
      prompt: `A ${m} kg ball feels ${f1} N forward and ${f2} N of friction. What is its acceleration?`,
      formulas: ['a = F_net / m'], given: { f1, f2, m }, value: a, unit: 'm/s²',
      distractors: [(f1 + f2) / m, f1 / m, f1 - f2], diagram: fbd([{ dir: 'right', label: `${f1} N` }, { dir: 'left', label: `${f2} N` }]),
      explanation: `F_net = ${f1 - f2} N, a = F_net/m = ${f1 - f2}/${m} = ${fnum(a)} m/s².` }))
  }

  // L4 incline component + net-force-accel multi + 2D
  for (const [m, deg, s] of [[2, 30, 0.5], [5, 37, 0.6], [4, 53, 0.8], [10, 30, 0.5], [5, 30, 0.5], [2, 53, 0.8]]) {
    const val = m * g * s
    P[4].push(num({ conceptTag: 'incline-force', difficulty: 4,
      prompt: `A ${m} kg ball rests on a ramp inclined at ${deg}°. What is the component of gravity along the ramp? (sin ${deg}° = ${s}, g = 10)`,
      formulas: ['F = m g sinθ'], given: { m, angleDeg: deg }, value: val, unit: 'N',
      distractors: [m * g, m * g * (1 - s), m * s], diagram: ramp(deg),
      explanation: `F_parallel = mg sinθ = ${m}×10×${s} = ${fnum(val)} N.` }))
  }
  for (const [F, f, m] of [[50, 20, 6], [40, 10, 5], [30, 6, 4], [60, 20, 8], [24, 4, 5], [35, 5, 6]]) {
    const a = (F - f) / m
    P[4].push(num({ conceptTag: 'net-force-accel', difficulty: 4,
      prompt: `A player pushes a ${m} kg ball-machine with ${F} N against ${f} N of friction. What is the acceleration?`,
      formulas: ['a = (F − f) / m'], given: { F, f, m }, value: a, unit: 'm/s²',
      distractors: [(F + f) / m, F / m, F - f], diagram: fbd([{ dir: 'right', label: `${F} N` }, { dir: 'left', label: `${f} N` }], 'machine'),
      explanation: `a = (F − f)/m = (${F} − ${f})/${m} = ${fnum(a)} m/s².` }))
  }
  for (const [fx, fy] of [[3, 4], [6, 8], [5, 12], [8, 6], [9, 12], [20, 21], [7, 24], [10, 24], [12, 16], [15, 20]]) {
    const val = Math.sqrt(fx * fx + fy * fy)
    P[4].push(num({ conceptTag: 'net-force-2d', difficulty: 4,
      prompt: `Two perpendicular forces, ${fx} N and ${fy} N, act on a ball. What is the magnitude of the net force?`,
      formulas: ['F_net = √(F_x² + F_y²)'], given: { fx, fy }, value: val, unit: 'N',
      distractors: [fx + fy, Math.abs(fy - fx), fx * fy], explanation: `F_net = √(${fx}² + ${fy}²) = √${fx * fx + fy * fy} = ${fnum(val)} N.` }))
  }

  // L5 conceptual
  P[5].push(mc({ conceptTag: 'newton-first-law', difficulty: 5,
    prompt: 'A ball rolls across frictionless turf at a constant velocity. What is the net force on it?',
    options: ['Zero', 'Equal to its weight', 'In the direction of motion', 'Increasing'],
    correctIndex: 0, explanation: 'Constant velocity means zero acceleration, so by F = ma the net force is zero.' }))
  P[5].push(mc({ conceptTag: 'newton-third-law', difficulty: 5,
    prompt: 'Your foot pushes on the ball with 50 N. What does Newton\u2019s third law say about the ball\u2019s force on your foot?',
    options: ['50 N in the opposite direction', '50 N in the same direction', 'Less, because the ball is light', 'Zero'],
    correctIndex: 0, explanation: 'Action-reaction pairs are equal in magnitude and opposite in direction.' }))
  P[5].push(mc({ conceptTag: 'inertia', difficulty: 5,
    prompt: 'Two balls feel the same net force. The heavier one will:',
    options: ['Accelerate less', 'Accelerate more', 'Accelerate the same', 'Not move'],
    correctIndex: 0, explanation: 'a = F/m: for the same F, larger mass gives smaller acceleration.' }))
  P[5].push(mc({ conceptTag: 'equilibrium', difficulty: 5,
    prompt: 'A ball is held still on a table. Which best describes the forces on it?',
    options: ['Weight down balanced by normal force up', 'Only gravity acts', 'Only the normal force acts', 'A net downward force'],
    correctIndex: 0, explanation: 'At rest the forces balance: the upward normal force equals the downward weight.' }))
  P[5].push(mc({ conceptTag: 'double-force', difficulty: 5,
    prompt: 'If you double the net force on a ball while keeping its mass the same, the acceleration:',
    options: ['Doubles', 'Halves', 'Stays the same', 'Quadruples'],
    correctIndex: 0, explanation: 'a = F/m is proportional to F, so doubling F doubles a.' }))
  P[5].push(mc({ conceptTag: 'mass-vs-weight', difficulty: 5,
    prompt: 'How do mass and weight differ?',
    options: ['Mass is the amount of matter (kg); weight is the gravitational force (N)', 'They are the same thing', 'Mass is measured in newtons', 'Weight never changes with location'],
    correctIndex: 0, explanation: 'Mass (kg) is intrinsic; weight = mg (N) depends on gravity.' }))
  P[5].push(mc({ conceptTag: 'friction-direction', difficulty: 5,
    prompt: 'Which way does kinetic friction act on a ball rolling to the right?',
    options: ['To the left (opposing motion)', 'To the right', 'Upward', 'Downward'],
    correctIndex: 0, explanation: 'Friction opposes relative motion, so it acts opposite the direction of travel.' }))
  P[5].push(mc({ conceptTag: 'normal-force', difficulty: 5,
    prompt: 'A ball sits on flat ground. The normal force on it equals:',
    options: ['Its weight, mg', 'Zero', 'Twice its weight', 'Its mass'],
    correctIndex: 0, explanation: 'On level ground with no vertical acceleration, normal force balances weight: N = mg.' }))
  P[5].push(mc({ conceptTag: 'balanced-forces', difficulty: 5,
    prompt: 'A ball moving at steady speed in a straight line has:',
    options: ['Balanced (net zero) forces', 'A net forward force', 'No forces at all', 'Increasing acceleration'],
    correctIndex: 0, explanation: 'Steady speed in a straight line = constant velocity = zero net force.' }))
  for (const [F, f, m] of [[100, 40, 6], [80, 30, 5], [120, 60, 10], [45, 15, 6], [60, 20, 8], [90, 30, 6], [140, 40, 10]]) {
    const a = (F - f) / m
    P[5].push(num({ conceptTag: 'net-force-accel', difficulty: 5,
      prompt: `A ${m} kg sled is pushed with ${F} N forward against ${f} N of friction. Find its acceleration, then state the net force direction.`,
      formulas: ['a = (F − f) / m'], given: { F, f, m }, value: a, unit: 'm/s²',
      distractors: [(F + f) / m, F / m, (F - f)], explanation: `a = (${F} − ${f})/${m} = ${fnum(a)} m/s² forward.` }))
  }

  return [
    ...P[1].slice(0, 22), ...P[2].slice(0, 22), ...P[3].slice(0, 20),
    ...P[4].slice(0, 20), ...P[5].slice(0, 16),
  ]
}

function buildMotion() {
  const P = { 1: [], 2: [], 3: [], 4: [], 5: [] }
  const xt = (pts, xMax, yMax) => ({ kind: 'position-time', params: { yLabel: 'position (m)', xMax, yMax, lines: [{ points: pts, label: 'runner' }] }, caption: 'Position vs time' })
  const vt = (pts, xMax, yMax, shade) => ({ kind: 'velocity-time', params: { yLabel: 'velocity (m/s)', xMax, yMax, shade, lines: [{ points: pts, label: 'velocity' }] }, caption: 'Velocity vs time' })

  // L1 conceptual
  P[1].push(mc({ conceptTag: 'graph-slope-as-velocity', difficulty: 1,
    prompt: 'On a position-time graph, what does the slope of the line represent?',
    options: ['Velocity', 'Acceleration', 'Distance', 'Time'], correctIndex: 0,
    explanation: 'Slope = rise/run = change in position over time = velocity.' }))
  P[1].push(mc({ conceptTag: 'area-under-vt', difficulty: 1,
    prompt: 'On a velocity-time graph, what does the area under the line represent?',
    options: ['Displacement', 'Acceleration', 'Speed', 'Force'], correctIndex: 0,
    explanation: 'Area = velocity × time = displacement.' }))
  P[1].push(mc({ conceptTag: 'flat-xt-at-rest', difficulty: 1,
    prompt: 'A position-time graph is a flat, horizontal line. What is the object doing?',
    options: ['Staying still', 'Moving at constant speed', 'Speeding up', 'Slowing down'], correctIndex: 0,
    explanation: 'Zero slope means position is not changing — the object is at rest.' }))
  P[1].push(mc({ conceptTag: 'slope-vt-as-accel', difficulty: 1,
    prompt: 'On a velocity-time graph, the slope of the line represents:',
    options: ['Acceleration', 'Displacement', 'Position', 'Speed'], correctIndex: 0,
    explanation: 'Slope of v-t = change in velocity over time = acceleration.' }))
  P[1].push(mc({ conceptTag: 'units', difficulty: 1,
    prompt: 'The slope of a position-time graph has units of:',
    options: ['m/s', 'm/s²', 'm', 's'], correctIndex: 0, explanation: 'Position (m) over time (s) gives m/s.' }))

  // L1 + L2 slope of x-t from origin (diagrams) — distribute across L1/L2
  const combos = []
  for (const t of [2, 3, 4, 5, 6, 10]) for (const x of [6, 10, 12, 18, 20, 24, 30, 36, 40, 60]) if (Number.isInteger(x / t)) combos.push([t, x])
  combos.forEach(([t, x], i) => {
    const target = i % 2 === 0 ? 1 : 2
    P[target].push(num({ conceptTag: 'graph-slope-as-velocity', difficulty: target,
      prompt: `A player's position-time graph is a straight line from (0 s, 0 m) to (${t} s, ${x} m). What is the player's velocity?`,
      formulas: ['v = Δx / Δt'], given: { dt: t, dx: x }, value: x / t, unit: 'm/s',
      distractors: [x * t, t / x, x - t], diagram: xt([[0, 0], [t, x]], t, x),
      explanation: `v = Δx/Δt = ${x}/${t} = ${fnum(x / t)} m/s.` }))
  })
  // L2 displacement between two points on x-t
  for (const [t1, x1, t2, x2] of [[1, 5, 4, 20], [0, 10, 3, 40], [1, 10, 5, 30], [2, 6, 6, 30], [0, 0, 4, 24], [1, 8, 3, 32], [2, 12, 5, 42], [0, 5, 4, 45], [1, 6, 6, 36], [2, 10, 7, 40]]) {
    P[2].push(num({ conceptTag: 'displacement-from-graph', difficulty: 2,
      prompt: `A runner's position-time graph passes through (${t1} s, ${x1} m) and (${t2} s, ${x2} m). What is the displacement between these times?`,
      formulas: ['Δx = x₂ − x₁'], given: { x1, x2 }, value: x2 - x1, unit: 'm',
      distractors: [x2 + x1, (x2 - x1) / (t2 - t1), x1], diagram: xt([[t1, x1], [t2, x2]], t2, x2),
      explanation: `Δx = x₂ − x₁ = ${x2} − ${x1} = ${x2 - x1} m.` }))
  }

  // L3 area under v-t (rectangle: constant velocity)
  for (const [v, t] of [[5, 4], [10, 3], [8, 5], [6, 6], [12, 4], [4, 10], [7, 4], [9, 5], [3, 8], [15, 2]]) {
    P[3].push(num({ conceptTag: 'area-under-vt', difficulty: 3,
      prompt: `A ball rolls at a constant ${v} m/s for ${t} s. Using the area under the velocity-time graph, what is its displacement?`,
      formulas: ['Δx = v t'], given: { v, t }, value: v * t, unit: 'm',
      distractors: [v + t, v / t, 0.5 * v * t], diagram: vt([[0, v], [t, v]], t, v, true),
      explanation: `Area of the rectangle = v × t = ${v}×${t} = ${v * t} m.` }))
  }
  // L3 area under v-t (triangle: from rest)
  for (const [v, t] of [[10, 4], [20, 5], [8, 6], [12, 4], [6, 5], [16, 4], [10, 6], [18, 4], [14, 5], [24, 5]]) {
    P[3].push(num({ conceptTag: 'area-under-vt', difficulty: 3,
      prompt: `Starting from rest, a player's velocity rises in a straight line to ${v} m/s over ${t} s. What is the displacement (area under the graph)?`,
      formulas: ['Δx = ½ v t'], given: { v, t }, value: 0.5 * v * t, unit: 'm',
      distractors: [v * t, v + t, 0.5 * v], diagram: vt([[0, 0], [t, v]], t, v, true),
      explanation: `Area of the triangle = ½ × base × height = ½ × ${t} × ${v} = ${fnum(0.5 * v * t)} m.` }))
  }

  // L4 slope of v-t = acceleration (diagram)
  for (const [v0, v1, t] of [[0, 20, 4], [5, 25, 5], [10, 30, 4], [0, 15, 3], [4, 24, 5], [10, 40, 6], [0, 24, 4], [6, 30, 6], [8, 28, 5], [10, 25, 5]]) {
    P[4].push(num({ conceptTag: 'slope-vt-as-accel', difficulty: 4,
      prompt: `A velocity-time graph rises in a straight line from ${v0} m/s to ${v1} m/s over ${t} s. What is the acceleration?`,
      formulas: ['a = Δv / Δt'], given: { v0, v1, t }, value: (v1 - v0) / t, unit: 'm/s²',
      distractors: [(v1 + v0) / t, (v1 - v0) * t, v1 / t], diagram: vt([[0, v0], [t, v1]], t, v1),
      explanation: `a = Δv/Δt = (${v1} − ${v0})/${t} = ${fnum((v1 - v0) / t)} m/s².` }))
  }
  // L4 average velocity over a there-and-partway trip
  for (const [d1, d2, t1, t2] of [[30, 10, 3, 2], [40, 20, 4, 4], [50, 10, 5, 5], [20, 40, 2, 6], [60, 30, 6, 3], [10, 50, 1, 5], [45, 15, 3, 3], [24, 36, 2, 4], [12, 48, 2, 6], [35, 25, 5, 5]]) {
    const val = (d1 + d2) / (t1 + t2)
    P[4].push(num({ conceptTag: 'average-velocity', difficulty: 4,
      prompt: `A midfielder runs ${d1} m in ${t1} s, then ${d2} m in ${t2} s (same direction). What is the average velocity for the whole run?`,
      formulas: ['v_avg = total Δx / total Δt'], given: { d1, d2, t1, t2 }, value: val, unit: 'm/s',
      distractors: [(d1 / t1 + d2 / t2) / 2, (d1 + d2) / Math.max(t1, t2), d1 / t1], explanation: `v_avg = (${d1}+${d2})/(${t1}+${t2}) = ${fnum(val)} m/s.` }))
  }

  // L5 conceptual
  P[5].push(mc({ conceptTag: 'curved-xt-accelerating', difficulty: 5,
    prompt: 'A position-time graph curves upward, getting steeper over time. What does this indicate?',
    options: ['The object is speeding up', 'Constant velocity', 'The object is at rest', 'The object moves backward'],
    correctIndex: 0, explanation: 'Increasing slope means increasing velocity — the object is accelerating (speeding up).' }))
  P[5].push(mc({ conceptTag: 'steeper-faster', difficulty: 5,
    prompt: 'Two players are plotted on the same position-time graph. Player A\u2019s line is steeper than Player B\u2019s. Which is moving faster?',
    options: ['Player A', 'Player B', 'They move at the same speed', 'Neither is moving'],
    correctIndex: 0, explanation: 'A steeper position-time slope means a greater velocity.' }))
  P[5].push(mc({ conceptTag: 'negative-slope', difficulty: 5,
    prompt: 'A defender\u2019s position-time line slopes downward (negative slope). What does that mean?',
    options: ['Moving back toward the starting point', 'Speeding up', 'At rest', 'Moving forward faster'],
    correctIndex: 0, explanation: 'A negative slope means position is decreasing — moving in the negative direction.' }))
  P[5].push(mc({ conceptTag: 'flat-vt-constant-velocity', difficulty: 5,
    prompt: 'A velocity-time graph is a horizontal line above zero. The object is:',
    options: ['Moving at constant velocity (zero acceleration)', 'At rest', 'Accelerating', 'Decelerating'],
    correctIndex: 0, explanation: 'A flat v-t line means velocity is unchanging: constant velocity, zero acceleration.' }))
  P[5].push(mc({ conceptTag: 'graph-matching', difficulty: 5,
    prompt: 'A ball is dropped and speeds up as it falls. Which graph matches its motion (downward positive)?',
    options: ['A v-t line with constant positive slope', 'A flat v-t line', 'A v-t line with negative slope', 'A horizontal x-t line'],
    correctIndex: 0, explanation: 'Constant acceleration gives a straight v-t line with constant (positive) slope.' }))
  P[5].push(mc({ conceptTag: 'area-vs-slope', difficulty: 5,
    prompt: 'To find how FAR an object traveled from a velocity-time graph, you should:',
    options: ['Find the area under the line', 'Find the slope of the line', 'Read the highest point', 'Read the time axis'],
    correctIndex: 0, explanation: 'Displacement is the area under a v-t graph; slope would give acceleration.' }))
  P[5].push(mc({ conceptTag: 'curved-vt', difficulty: 5,
    prompt: 'A velocity-time graph curves and gets steeper. What is true about the acceleration?',
    options: ['It is increasing', 'It is constant', 'It is zero', 'It is negative'],
    correctIndex: 0, explanation: 'Steepening v-t slope means the rate of velocity change (acceleration) is increasing.' }))
  P[5].push(mc({ conceptTag: 'displacement-vs-distance', difficulty: 5,
    prompt: 'A player runs 10 m forward then 10 m back to the start in a total of 5 s. The average VELOCITY is:',
    options: ['0 m/s', '4 m/s', '2 m/s', '20 m/s'],
    correctIndex: 0, explanation: 'Net displacement is 0 (back to start), so average velocity = 0, even though average speed is 4 m/s.' }))
  // L5 multi-segment numeric
  for (const [v1, t1, v2, t2] of [[10, 2, 4, 3], [8, 3, 12, 2], [6, 5, 10, 5], [20, 2, 5, 4], [12, 3, 6, 3], [4, 5, 16, 5], [15, 2, 5, 4], [9, 4, 3, 2]]) {
    const val = (v1 * t1 + v2 * t2) / (t1 + t2)
    P[5].push(num({ conceptTag: 'average-velocity', difficulty: 5,
      prompt: `From a velocity-time graph: a ball moves at ${v1} m/s for ${t1} s, then ${v2} m/s for ${t2} s. What is its average velocity over the whole interval?`,
      formulas: ['v_avg = total area / total time'], given: { v1, t1, v2, t2 }, value: val, unit: 'm/s',
      distractors: [(v1 + v2) / 2, (v1 * t1 + v2 * t2), v1], explanation: `total Δx = ${v1}×${t1} + ${v2}×${t2} = ${v1 * t1 + v2 * t2} m over ${t1 + t2} s ⇒ ${fnum(val)} m/s.` }))
  }

  return [
    ...P[1].slice(0, 22), ...P[2].slice(0, 22), ...P[3].slice(0, 20),
    ...P[4].slice(0, 20), ...P[5].slice(0, 16),
  ]
}

function buildKinematics() {
  const g = 10
  const proj = (deg, v) => ({
    kind: 'projectile',
    params: { angleDeg: deg, vLabel: `v = ${v} m/s` },
    caption: `Launch at ${deg}°`,
  })
  const P = { 1: [], 2: [], 3: [], 4: [], 5: [] }

  // L1 numeric freebies
  for (const [d, t] of [[20, 4], [40, 5], [60, 10], [100, 5], [40, 4], [60, 5]]) {
    P[1].push(num({ conceptTag: 'average-speed', difficulty: 1,
      prompt: `A winger covers ${d} m in ${t} s at a steady pace. What is the average speed?`,
      formulas: ['v = d / t'], given: { d, t }, value: d / t, unit: 'm/s',
      distractors: [d * t, t / d, d - t], explanation: `v = d/t = ${d}/${t} = ${fnum(d / t)} m/s.` }))
  }
  for (const [dv, dt] of [[20, 4], [30, 5], [40, 5], [10, 2], [60, 10], [50, 5]]) {
    P[1].push(num({ conceptTag: 'acceleration-definition', difficulty: 1,
      prompt: `A ball speeds up by ${dv} m/s over ${dt} s. What is its acceleration?`,
      formulas: ['a = Δv / Δt'], given: { dv, dt }, value: dv / dt, unit: 'm/s²',
      distractors: [dv * dt, dt / dv, dv], explanation: `a = Δv/Δt = ${dv}/${dt} = ${fnum(dv / dt)} m/s².` }))
  }
  for (const [a, t] of [[2, 3], [5, 4], [3, 5], [4, 4], [2, 5], [5, 2], [3, 3], [10, 2]]) {
    P[1].push(num({ conceptTag: 'velocity-from-rest', difficulty: 1,
      prompt: `Starting from rest, a ball accelerates at ${a} m/s² for ${t} s. What is its final speed?`,
      formulas: ['v = u + a t', 'u = 0'], given: { a, t }, value: a * t, unit: 'm/s',
      distractors: [a + t, a, 0.5 * a * t], explanation: `v = u + a t = 0 + ${a}×${t} = ${a * t} m/s.` }))
  }
  P[1].push(mc({ conceptTag: 'gravity-effect', difficulty: 1,
    prompt: 'A ball is in mid-air after a chip. Ignoring air resistance, what is its acceleration?',
    options: ['10 m/s² directed downward', '0, since nothing touches it', '10 m/s² toward the goal', 'It increases as the ball rises'],
    correctIndex: 0, formulas: ['g = 10 m/s²'], explanation: 'In free flight the only force is gravity, so a = g = 10 m/s² downward.' }))
  P[1].push(mc({ conceptTag: 'units', difficulty: 1,
    prompt: 'Which set of units is correct for acceleration?',
    options: ['m/s²', 'm/s', 'm', 'kg·m/s'], correctIndex: 0,
    explanation: 'Acceleration is change in velocity (m/s) per second, so m/s².' }))
  P[1].push(mc({ conceptTag: 'vector-scalar', difficulty: 1,
    prompt: 'Which of these is a vector quantity?',
    options: ['Velocity', 'Speed', 'Distance', 'Time'], correctIndex: 0,
    explanation: 'Velocity has both magnitude and direction; speed, distance and time are scalars.' }))

  // L2 vy = v sinθ (with projectile diagrams)
  for (const v of [10, 20, 30, 40]) for (const [deg, s, c] of [[30, 0.5, 0.87], [37, 0.6, 0.8], [53, 0.8, 0.6]]) {
    const val = v * s
    P[2].push(num({ conceptTag: 'projectile-components', difficulty: 2,
      prompt: `A free kick leaves the boot at v = ${v} m/s, ${deg}° above the pitch. What is the VERTICAL component of the launch velocity? (sin ${deg}° = ${s})`,
      formulas: ['v_y = v sinθ'], given: { v, angleDeg: deg }, value: val, unit: 'm/s',
      distractors: [v * c, v, val * 2], diagram: proj(deg, v),
      explanation: `v_y = v sinθ = ${v} × ${s} = ${fnum(val)} m/s.` }))
  }
  // L2 vx = v cosθ
  for (const v of [10, 20, 30]) for (const [deg, s, c] of [[37, 0.6, 0.8], [53, 0.8, 0.6], [60, 0.87, 0.5]]) {
    const val = v * c
    P[2].push(num({ conceptTag: 'projectile-components', difficulty: 2,
      prompt: `A shot leaves the foot at v = ${v} m/s, ${deg}° above the ground. What is the HORIZONTAL component of velocity? (cos ${deg}° = ${c})`,
      formulas: ['v_x = v cosθ'], given: { v, angleDeg: deg }, value: val, unit: 'm/s',
      distractors: [v * s, v, val / 2], explanation: `v_x = v cosθ = ${v} × ${c} = ${fnum(val)} m/s.` }))
  }
  for (const vy of [5, 10, 15, 20, 25, 30]) {
    P[2].push(num({ conceptTag: 'time-to-apex', difficulty: 2,
      prompt: `A ball is kicked straight up at ${vy} m/s. How long until it reaches the top of its arc? (g = 10 m/s²)`,
      formulas: ['t = v_y / g'], given: { vy, g }, value: vy / g, unit: 's',
      distractors: [(2 * vy) / g, vy / 5, vy], explanation: `At the top v_y = 0, so t = v_y/g = ${vy}/10 = ${fnum(vy / g)} s.` }))
  }

  // L3
  for (const vy of [10, 20, 30, 5, 15, 25]) {
    P[3].push(num({ conceptTag: 'max-height', difficulty: 3,
      prompt: `A ball leaves the ground with vertical velocity ${vy} m/s. What maximum height does it reach? (g = 10 m/s²)`,
      formulas: ['H = v_y² / (2g)'], given: { vy, g }, value: (vy * vy) / (2 * g), unit: 'm',
      distractors: [(vy * vy) / g, vy / (2 * g), vy * 2], explanation: `H = v_y²/(2g) = ${vy}²/20 = ${fnum((vy * vy) / 20)} m.` }))
  }
  for (const vy of [10, 20, 30, 5, 15, 25]) {
    P[3].push(num({ conceptTag: 'flight-time', difficulty: 3,
      prompt: `A ball is launched straight up at ${vy} m/s. How long is it in the air before landing back at launch height?`,
      formulas: ['T = 2v_y / g'], given: { vy, g }, value: (2 * vy) / g, unit: 's',
      distractors: [vy / g, vy / 5, (4 * vy) / g], explanation: `T = 2v_y/g = 2×${vy}/10 = ${fnum((2 * vy) / 10)} s.` }))
  }
  for (const [a, t] of [[2, 4], [4, 3], [10, 2], [2, 5], [4, 4], [10, 3]]) {
    P[3].push(num({ conceptTag: 'displacement-accel', difficulty: 3,
      prompt: `Starting from rest, a ball accelerates at ${a} m/s² for ${t} s. How far does it travel?`,
      formulas: ['s = ½ a t²', 'u = 0'], given: { a, t }, value: 0.5 * a * t * t, unit: 'm',
      distractors: [a * t * t, a * t, 0.5 * a * t], explanation: `s = ½at² = 0.5×${a}×${t}² = ${fnum(0.5 * a * t * t)} m.` }))
  }
  for (const [vx, t] of [[10, 3], [20, 2], [15, 4], [5, 3], [20, 3], [15, 2]]) {
    P[3].push(num({ conceptTag: 'horizontal-range', difficulty: 3,
      prompt: `During a flight the horizontal velocity is ${vx} m/s and the ball is airborne ${t} s. How far does it travel horizontally?`,
      formulas: ['x = v_x t'], given: { vx, t }, value: vx * t, unit: 'm',
      distractors: [vx + t, vx / t, vx], explanation: `x = v_x t = ${vx}×${t} = ${vx * t} m.` }))
  }

  // L4
  for (const [a, s, v] of [[5, 10, 10], [10, 5, 10], [2, 9, 6], [2, 16, 8], [8, 4, 8], [5, 90, 30]]) {
    P[4].push(num({ conceptTag: 'kinematics-vsquared', difficulty: 4,
      prompt: `Starting from rest, a ball accelerates at ${a} m/s² over ${s} m. What is its final speed?`,
      formulas: ['v² = u² + 2 a s', 'u = 0'], given: { a, s }, value: v, unit: 'm/s',
      distractors: [2 * a * s, v * 1.5, v - 2], explanation: `v = √(2as) = √(2×${a}×${s}) = √${2 * a * s} = ${v} m/s.` }))
  }
  for (const [v, deg, s2] of [[10, 45, 1], [20, 45, 1], [30, 45, 1], [20, 15, 0.5], [10, 15, 0.5], [40, 45, 1]]) {
    const val = (v * v * s2) / g
    P[4].push(num({ conceptTag: 'projectile-range', difficulty: 4,
      prompt: `A ball is struck at ${v} m/s, ${deg}° above the ground on level turf. How far away does it land? (sin ${2 * deg}° = ${s2}, g = 10)`,
      formulas: ['R = v² sin(2θ) / g'], given: { v, angleDeg: deg }, value: val, unit: 'm',
      distractors: [(v * v) / g, (v * s2) / g, val * 2], diagram: proj(deg, v),
      explanation: `R = v² sin(2θ)/g = ${v}²×${s2}/10 = ${fnum(val)} m.` }))
  }
  for (const [u, a, t] of [[10, 2, 4], [5, 4, 3], [0, 10, 3], [8, 2, 5], [10, 4, 2], [6, 4, 4]]) {
    const val = u * t + 0.5 * a * t * t
    P[4].push(num({ conceptTag: 'displacement-general', difficulty: 4,
      prompt: `A ball moving at ${u} m/s accelerates at ${a} m/s² for ${t} s. How far does it travel?`,
      formulas: ['s = u t + ½ a t²'], given: { u, a, t }, value: val, unit: 'm',
      distractors: [u * t, 0.5 * a * t * t, u * t + a * t * t], explanation: `s = ut + ½at² = ${u}×${t} + 0.5×${a}×${t}² = ${fnum(val)} m.` }))
  }
  for (const [h, vx] of [[5, 10], [20, 15], [45, 20], [20, 5], [80, 10]]) {
    const t = Math.sqrt((2 * h) / g)
    const val = vx * t
    P[4].push(num({ conceptTag: 'horizontal-launch', difficulty: 4,
      prompt: `A ball is kicked horizontally at ${vx} m/s off a ledge ${h} m high. How far from the base does it land? (g = 10)`,
      formulas: ['t = √(2h/g)', 'x = v_x t'], given: { h, vx }, value: val, unit: 'm',
      distractors: [vx, vx * h / g, val * 2], diagram: proj(0, vx),
      explanation: `t = √(2h/g) = √(${2 * h}/10) = ${fnum(t)} s, so x = v_x t = ${vx}×${fnum(t)} = ${fnum(val)} m.` }))
  }

  // L5 conceptual
  P[5].push(mc({ conceptTag: 'apex-velocity-accel', difficulty: 5,
    prompt: 'At the highest point of a ball\u2019s vertical flight, which statement is true?',
    options: ['Velocity is 0 but acceleration is 10 m/s² downward', 'Both velocity and acceleration are 0', 'Velocity is maximum, acceleration 0', 'Acceleration points upward'],
    correctIndex: 0, explanation: 'At the apex the ball is momentarily at rest (v = 0), but gravity still acts, so a = 10 m/s² down.' }))
  P[5].push(mc({ conceptTag: 'horizontal-vertical-independence', difficulty: 5,
    prompt: 'One ball is dropped and another is kicked horizontally from the same height at the same instant. Which lands first?',
    options: ['They land at the same time', 'The dropped ball', 'The kicked ball', 'Depends on the kick speed'],
    correctIndex: 0, explanation: 'Vertical motion is independent of horizontal motion; both have the same vertical drop and g, so equal fall times.' }))
  P[5].push(mc({ conceptTag: 'range-vs-angle', difficulty: 5,
    prompt: 'At a fixed launch speed, increasing the launch angle from 30° to 45° does what to the range on level ground?',
    options: ['Increases it (45° gives maximum range)', 'Decreases it', 'No change', 'Doubles it exactly'],
    correctIndex: 0, explanation: 'Range ∝ sin(2θ), which is largest at θ = 45°, so going 30°→45° increases range.' }))
  P[5].push(mc({ conceptTag: 'projectile-horizontal-velocity', difficulty: 5,
    prompt: 'Ignoring air resistance, what happens to the horizontal velocity of a ball during its flight?',
    options: ['It stays constant', 'It decreases to zero at the top', 'It increases steadily', 'It reverses direction'],
    correctIndex: 0, explanation: 'No horizontal force acts, so horizontal velocity is constant the whole flight.' }))
  P[5].push(mc({ conceptTag: 'symmetry-up-down', difficulty: 5,
    prompt: 'A ball thrown straight up returns to the launch height. How does its speed there compare to the launch speed?',
    options: ['Equal in magnitude', 'Smaller', 'Larger', 'Zero'],
    correctIndex: 0, explanation: 'With no air resistance the motion is symmetric: it returns with the same speed (opposite direction).' }))
  P[5].push(mc({ conceptTag: 'range-doubling-speed', difficulty: 5,
    prompt: 'If you double the launch speed at the same angle, the range on level ground becomes about:',
    options: ['4× as far', '2× as far', 'Half as far', 'Unchanged'],
    correctIndex: 0, explanation: 'Range ∝ v², so doubling v gives 2² = 4× the range.' }))
  P[5].push(mc({ conceptTag: 'free-fall-graph', difficulty: 5,
    prompt: 'For a ball in free fall (downward positive), which describes its velocity-time graph?',
    options: ['A straight line with constant positive slope of 10', 'A horizontal line', 'A curve that flattens out', 'A line with slope 0'],
    correctIndex: 0, explanation: 'Constant acceleration g means velocity rises linearly: slope = 10 m/s².' }))
  P[5].push(mc({ conceptTag: 'cliff-speed-independence', difficulty: 5,
    prompt: 'Two balls roll off the same ledge, one faster than the other. Which hits the ground first?',
    options: ['They land at the same time', 'The faster one', 'The slower one', 'Cannot tell'],
    correctIndex: 0, explanation: 'Time to fall depends only on the height and g, not horizontal speed — same fall time.' }))
  P[5].push(mc({ conceptTag: 'constant-acceleration', difficulty: 5,
    prompt: 'During the entire flight of a kicked ball (ignoring air resistance), the acceleration is:',
    options: ['Constant, 10 m/s² downward', 'Zero at the top', 'Largest at the top', 'Always toward the goal'],
    correctIndex: 0, explanation: 'Gravity is the only force in flight, so acceleration is a constant 10 m/s² down the whole time.' }))
  P[5].push(mc({ conceptTag: 'velocity-direction-apex', difficulty: 5,
    prompt: 'Just after a ball passes the peak of its arc, its vertical velocity is:',
    options: ['Downward and increasing in magnitude', 'Zero', 'Upward and decreasing', 'Constant'],
    correctIndex: 0, explanation: 'Past the apex gravity speeds the ball up downward, so v_y grows in the downward direction.' }))
  P[5].push(mc({ conceptTag: 'launch-angle-tradeoff', difficulty: 5,
    prompt: 'Compared with a 45° kick at the same speed, a steeper 60° kick gives:',
    options: ['Higher peak but shorter range', 'Greater range', 'The same trajectory', 'A flatter, longer shot'],
    correctIndex: 0, explanation: 'A steeper angle sends more velocity upward (higher) and less horizontally (shorter range than 45°).' }))
  for (const [u, a] of [[20, 5], [10, 2], [30, 10], [12, 4], [18, 9], [24, 8]]) {
    const val = (u * u) / (2 * a)
    P[5].push(num({ conceptTag: 'stopping-distance', difficulty: 5,
      prompt: `A ball rolling at ${u} m/s decelerates at ${a} m/s². How far does it travel before stopping?`,
      formulas: ['v² = u² + 2 a s', 'v = 0'], given: { u, a }, value: val, unit: 'm',
      distractors: [u / (2 * a), (u * u) / a, u * a], explanation: `0 = u² − 2as ⇒ s = u²/(2a) = ${u}²/(2×${a}) = ${fnum(val)} m.` }))
  }

  return [
    ...P[1].slice(0, 22), ...P[2].slice(0, 22), ...P[3].slice(0, 20),
    ...P[4].slice(0, 20), ...P[5].slice(0, 16),
  ]
}

main()
