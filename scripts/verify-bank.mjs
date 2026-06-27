#!/usr/bin/env node
// Verifies the generated question bank: structural integrity for all 5 offered
// units (kinematics, motion-graphs, forces, energy, momentum), 100 questions
// each across difficulty levels 1-5. Numeric answers are computed by the
// generator, so here we confirm every question is well-formed and that the
// choice marked correct actually carries the computed `correctValue`. Run:
//
//   npm run bank:verify   (node scripts/verify-bank.mjs)
//
// Exits non-zero if any structural error is found.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BANK_DIR = resolve(__dirname, '../src/content/bank')
const UNITS = ['kinematics', 'motion-graphs', 'forces', 'energy', 'momentum']
const PER_UNIT = 100

const close = (a, b) => Math.abs(a - b) <= Math.abs(b) * 0.02 + 0.5

async function loadUnit(unit) {
  try {
    return JSON.parse(await readFile(resolve(BANK_DIR, `${unit}.json`), 'utf8'))
  } catch (e) {
    return { __error: String(e) }
  }
}

async function main() {
  const errors = []
  const warnings = []
  const ids = new Set()
  let total = 0

  for (const unit of UNITS) {
    const qs = await loadUnit(unit)
    if (qs.__error) { errors.push(`${unit}.json: cannot read (${qs.__error})`); continue }
    if (!Array.isArray(qs)) { errors.push(`${unit}.json: not an array`); continue }

    const byDiff = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    let withDiagram = 0
    for (const q of qs) {
      total++
      const where = `${unit}/${q.id ?? '??'}`
      if (!q.id) errors.push(`${where}: missing id`)
      else if (ids.has(q.id)) errors.push(`${where}: duplicate id`)
      else ids.add(q.id)
      if (q.unitId !== unit) errors.push(`${where}: unitId "${q.unitId}" != "${unit}"`)
      if (![1, 2, 3, 4, 5].includes(q.difficulty)) errors.push(`${where}: bad difficulty ${q.difficulty}`)
      else byDiff[q.difficulty]++
      if (!q.prompt) errors.push(`${where}: empty prompt`)
      if (q.diagram) withDiagram++

      if (!Array.isArray(q.choices) || q.choices.length !== 4) {
        errors.push(`${where}: must have exactly 4 choices`)
      } else {
        const labels = q.choices.map((c) => c.label)
        if (new Set(labels).size !== labels.length) errors.push(`${where}: duplicate choice labels`)
        if (!q.choices.some((c) => c.id === q.correctChoiceId))
          errors.push(`${where}: correctChoiceId "${q.correctChoiceId}" not among choices`)
        // The marked-correct choice must carry the computed answer value.
        if (q.correctValue != null) {
          const correct = q.choices.find((c) => c.id === q.correctChoiceId)
          const m = correct && String(correct.label).match(/-?\d+(\.\d+)?/)
          if (m && !close(parseFloat(m[0]), q.correctValue))
            errors.push(`${where}: correct label "${correct.label}" != correctValue ${q.correctValue}`)
        }
      }
      if (!q.explanation) warnings.push(`${where}: no explanation`)
    }

    const diffStr = `d1=${byDiff[1]} d2=${byDiff[2]} d3=${byDiff[3]} d4=${byDiff[4]} d5=${byDiff[5]}`
    for (const d of [1, 2, 3, 4, 5]) {
      if (byDiff[d] < 8) warnings.push(`${unit}: only ${byDiff[d]} at difficulty ${d} (want >= 8 for test selection)`)
    }
    if (qs.length !== PER_UNIT) errors.push(`${unit}: ${qs.length} questions (expected ${PER_UNIT}) [${diffStr}]`)
    else console.log(`  ${unit}: ${PER_UNIT} ✓  (${diffStr}, ${withDiagram} diagrams)`)
  }

  console.log(`\nTotal: ${total} questions`)
  if (warnings.length) {
    console.log(`\nWarnings (${warnings.length}):`)
    for (const w of warnings) console.log('  ! ' + w)
  }
  if (errors.length) {
    console.log(`\nERRORS (${errors.length}):`)
    for (const e of errors) console.log('  ✗ ' + e)
    process.exit(1)
  }
  console.log('\nAll checks passed.')
}

main().catch((e) => { console.error(e); process.exit(1) })
