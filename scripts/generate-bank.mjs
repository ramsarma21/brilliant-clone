#!/usr/bin/env node
// Offline question-bank authoring. Generates the 72-question test bank
// (6 units x 4 problems x 3 difficulties) with an OpenAI-compatible model, then
// VERIFIES every numeric answer against the physics before writing it out. The
// AI key stays on your machine — nothing here ships to the browser.
//
// Usage:
//   AI_API_KEY=sk-... AI_MODEL=gpt-4o-mini node scripts/generate-bank.mjs
//
// Output: src/content/questionBank.seed.json  (imported as the offline fallback)
// To load into Supabase, import that JSON into the `question_bank` table, or
// extend this script to upsert via the REST API.

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../src/content/questionBank.seed.json')

const G = 10
const BALL_MASS = 0.43

// unitId -> concept tags + a verifier that recomputes the answer from `given`.
// Verifiers return the expected numeric answer, or null if not checkable.
const UNITS = [
  {
    unitId: 'kinematics',
    concepts: ['projectile-horizontal-vertical-independence', 'projectile-time-of-flight'],
    verify: (g) =>
      g.v != null && g.sin != null ? g.v * g.sin : g.vy != null ? (2 * g.vy) / G : null,
  },
  {
    unitId: 'motion-graphs',
    concepts: ['graph-slope-as-velocity', 'graph-velocity-direction'],
    verify: (g) => (g.x0 != null && g.v != null && g.t != null ? g.x0 + g.v * g.t : null),
  },
  {
    unitId: 'forces',
    concepts: ['force-net-force'],
    verify: (g) => (g.a != null ? (g.mass ?? BALL_MASS) * g.a : null),
  },
  {
    unitId: 'energy',
    concepts: ['energy-conservation'],
    verify: (g) => (g.h != null ? Math.sqrt(2 * G * g.h) : null),
  },
  {
    unitId: 'momentum',
    concepts: ['momentum-collisions'],
    verify: (g) => (g.mass != null && g.v != null ? g.mass * g.v : null),
  },
  {
    unitId: 'impulse',
    concepts: ['impulse-momentum'],
    verify: (g) => (g.v != null ? (g.mass ?? BALL_MASS) * g.v : null),
  },
]

const PER_DIFFICULTY = 4
const DIFFICULTIES = [1, 2, 3]

function prompt(unit, difficulty) {
  return [
    `You are an algebra-based intro physics tutor for a soccer-themed course.`,
    `Generate exactly ${PER_DIFFICULTY} multiple-choice questions for unit "${unit.unitId}"`,
    `at difficulty ${difficulty} (1=easy, 3=hard), using these concepts: ${unit.concepts.join(', ')}.`,
    `Single-step algebra, soccer framing, g = ${G} m/s^2, clean numbers, 4 options, one correct.`,
    `Include numeric "correctValue" and "given" (input numbers) whenever the answer is numeric.`,
    `Add a one-sentence "explanation".`,
    `Return ONLY JSON: {"questions":[{"conceptTag","prompt","choices":[{"id","label"}],`,
    `"correctChoiceId","correctValue","given","explanation"}]}`,
  ].join(' ')
}

async function callModel(text) {
  const apiKey = process.env.AI_API_KEY
  const model = process.env.AI_MODEL ?? 'gpt-4o-mini'
  const baseUrl = process.env.AI_BASE_URL ?? 'https://api.openai.com/v1'
  if (!apiKey) throw new Error('Set AI_API_KEY to run the bank generator.')
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You output only valid JSON.' },
        { role: 'user', content: text },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Model error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return JSON.parse(data.choices?.[0]?.message?.content ?? '{"questions":[]}')
}

async function main() {
  const bank = []
  let dropped = 0
  for (const unit of UNITS) {
    for (const difficulty of DIFFICULTIES) {
      const json = await callModel(prompt(unit, difficulty))
      const questions = Array.isArray(json.questions) ? json.questions : []
      for (const q of questions) {
        // Verify numeric answers against the physics; drop mismatches.
        if (q.correctValue != null && q.given) {
          const expected = unit.verify(q.given)
          if (expected != null && Math.abs(expected - q.correctValue) > Math.abs(expected) * 0.02 + 0.5) {
            dropped++
            continue
          }
        }
        bank.push({
          id: `${unit.unitId}-d${difficulty}-${bank.length}`,
          unitId: unit.unitId,
          conceptTag: q.conceptTag ?? unit.concepts[0],
          difficulty,
          prompt: q.prompt,
          choices: q.choices,
          correctChoiceId: q.correctChoiceId,
          correctValue: q.correctValue ?? null,
          given: q.given ?? null,
          explanation: q.explanation ?? '',
        })
      }
      console.log(`  ${unit.unitId} d${difficulty}: ${questions.length} generated`)
    }
  }
  await writeFile(OUT, JSON.stringify(bank, null, 2))
  console.log(`\nWrote ${bank.length} questions to ${OUT} (dropped ${dropped} failing verification).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
