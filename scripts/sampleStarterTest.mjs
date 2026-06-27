// Reproduces src/lib/questionBank.ts starter-test selection against the bundled
// bank JSON, so we can preview the unique 20-question starter test for an account.
//
//   node scripts/sampleStarterTest.mjs <username>
//
// The first test for any account is "starter" → all difficulty-1, 4 per unit,
// interleaved in an order seeded from the username (attempt #0).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BANK = join(__dirname, '..', 'src', 'content', 'bank')

// The five OFFERED units, in SKILL_IDS order (impulse/goalie is not offered).
const SKILL_IDS = ['kinematics', 'motion-graphs', 'forces', 'energy', 'momentum']
const PER_UNIT = 4

function load(unit) {
  return JSON.parse(readFileSync(join(BANK, `${unit}.json`), 'utf8'))
}

function hashSeed(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function seededRng(seed) {
  let a = hashSeed(seed)
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle(items, rng) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function selectStarter(bank, rng) {
  const out = []
  for (const unitId of SKILL_IDS) {
    const diff1 = bank.filter((q) => q.unitId === unitId && q.difficulty === 1)
    out.push(...shuffle(diff1, rng).slice(0, PER_UNIT))
  }
  return shuffle(out, rng)
}

const username = process.argv[2]
if (!username) {
  console.error('Usage: node scripts/sampleStarterTest.mjs <username>')
  process.exit(1)
}

const bank = SKILL_IDS.flatMap(load)
const seed = `${username}:0`
const test = selectStarter(bank, seededRng(seed))

console.log(`\nStarter test for account "${username}"  (seed: ${seed})`)
console.log(`${test.length} questions · all difficulty 1 · order unique to this account\n`)
const LETTERS = { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' }
test.forEach((q, i) => {
  const n = String(i + 1).padStart(2, ' ')
  const unit = q.unitId.padEnd(13)
  const ans = LETTERS[q.correctChoiceId] ?? q.correctChoiceId
  const prompt = q.prompt.length > 64 ? q.prompt.slice(0, 61) + '…' : q.prompt
  console.log(`${n}. [${unit}] ${q.id.padEnd(8)} (ans ${ans})  ${prompt}`)
})

const byUnit = {}
for (const q of test) byUnit[q.unitId] = (byUnit[q.unitId] ?? 0) + 1
console.log('\nper-unit:', byUnit, '\n')
