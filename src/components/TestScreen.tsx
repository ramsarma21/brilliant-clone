import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlayer } from '../state/PlayerState'
import { useApp } from '../state/AppState'
import {
  fetchBank,
  nextPracticeQuestion,
  pointsForScore,
  selectTestQuestions,
  seededRng,
  TEST_PASS_70,
  TEST_PASS_90,
} from '../lib/questionBank'
import { clearTestSession, loadTestSession, saveTestSession } from '../lib/storage'
import { SKILLS, SKILLS_BY_ID } from '../lib/skills'
import { UNITS } from '../content/lessons'
import { QuestionDiagram } from './QuestionDiagram'
import { Calculator } from './sims/Calculator'
import { explainWrongAnswer } from '../lib/ai/explainClient'
import { PointsWheel } from './PointsWheel'
import { POINTS_WHEEL_SAFE } from '../lib/pointsWheel'
import { AUTO_PASS_COST } from '../state/PlayerState'
import type { BankQuestion, UnitId, TestAttempt } from '../types'

const LETTERS = ['A', 'B', 'C', 'D', 'E']

// Coins paid for the once-a-day "practice this concept" bonus in the test-history review.
const PRACTICE_BONUS_COINS = 5

// The real physics unit name for a unit id (Kinematics, Motion Graphs, …) — shown
// in the test breakdown instead of the soccer-skill alias (Shooting, Passing, …).
const UNIT_NAME: Record<string, string> = Object.fromEntries(UNITS.map((u) => [u.id, u.name]))
const unitLabel = (id: string): string => UNIT_NAME[id] ?? SKILLS_BY_ID[id as UnitId]?.name ?? id

type Phase = 'loading' | 'intro' | 'quiz' | 'results' | 'review' | 'done'

type TestResult = {
  score: number
  total: number
  pointsAwarded: number
  perUnit: Record<string, { correct: number; total: number; avgTimeMs: number }>
}

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function TestScreen({ onExit }: { onExit: () => void }) {
  const {
    profile,
    overall,
    proficiency,
    testHistory,
    recordAttempt,
    recordTestResult,
    adjustSkillPoints,
    autoPassAssessment,
  } = usePlayer()
  const { profile: authProfile, rollPointsWheel } = useApp()
  const username = authProfile.username

  const [phase, setPhase] = useState<Phase>('loading')
  const [questions, setQuestions] = useState<BankQuestion[]>([])
  const [answers, setAnswers] = useState<(string | null)[]>([])
  const [current, setCurrent] = useState(0)
  const [result, setResult] = useState<TestResult | null>(null)
  const [attemptId, setAttemptId] = useState<string | null>(null)

  // Gates so we hydrate from a saved session exactly once and never persist a
  // half-restored state, and never commit the finished attempt twice.
  const restored = useRef(false)
  const recorded = useRef(false)

  // Per-question time + a running clock for the intro/quiz.
  const timeSpent = useRef<number[]>([])
  const enterRef = useRef<number>(0)
  const [elapsed, setElapsed] = useState(0)
  const [showCalc, setShowCalc] = useState(false)

  // Restore an in-progress session (refresh-safe) or build a fresh 20-question
  // test (4 per offered unit), weighted by proficiency.
  useEffect(() => {
    let alive = true
    void (async () => {
      const saved = loadTestSession(username)
      if (saved) {
        if (!alive) return
        setQuestions(saved.questions)
        setAnswers(saved.answers)
        setCurrent(saved.current)
        setResult(saved.result)
        setAttemptId(saved.attemptId)
        recorded.current = saved.recorded
        timeSpent.current = Array(saved.questions.length).fill(0)
        restored.current = true
        // The intro is the only phase we don't resume into (a fresh "Start"
        // experience is fine) — everything else resumes where they were.
        setPhase(saved.phase === 'intro' ? 'intro' : saved.phase)
        return
      }
      const bank = await fetchBank()
      if (!alive) return
      // Seed the test from THIS account (+ attempt #) so the question order is
      // unique to the user but stable for a given attempt. The first-ever test is
      // the "starter" test: all difficulty-1 questions.
      const attemptNo = testHistory.length
      // Randomise the seed on every FRESH build so abandoning a test and coming
      // back gives a brand-new set of questions (abandoned attempts are never
      // recorded, so attemptNo alone wouldn't change). Resuming a refresh uses
      // the saved questions above, so that path stays stable.
      const seed = `${username || 'guest'}:${attemptNo}:${Date.now()}-${Math.floor(Math.random() * 1e9)}`
      const picked = selectTestQuestions(bank, proficiency, {
        rng: seededRng(seed),
        starter: attemptNo === 0,
      })
      setQuestions(picked)
      setAnswers(Array(picked.length).fill(null))
      timeSpent.current = Array(picked.length).fill(0)
      restored.current = true
      setPhase('intro')
    })()
    return () => {
      alive = false
    }
    // proficiency is read once at start of a test on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist the session on every meaningful change so a refresh resumes here.
  // (Skipped until the build/restore above has populated state.)
  useEffect(() => {
    if (!restored.current || phase === 'loading' || questions.length === 0) return
    // Reaching 'done' means the attempt is already committed to the record (DB). There's
    // nothing left to resume — and the points-wheel offer is a one-time, now-or-never choice.
    // So we DROP the session here: leaving by ANY means (in-app button, browser Back, editing
    // the URL) forfeits the spin and keeps the banked safe points, and the next time the
    // assessment is opened it starts completely fresh instead of reopening this screen.
    if (phase === 'done') {
      clearTestSession(username)
      return
    }
    saveTestSession({
      username,
      phase: phase as Exclude<Phase, 'loading'>,
      questions,
      answers,
      current,
      result,
      recorded: recorded.current,
      attemptId,
    })
  }, [phase, questions, answers, current, result, attemptId, username])

  // Live clock while taking the test.
  useEffect(() => {
    if (phase !== 'quiz') return
    const start = Date.now() - elapsed
    const id = window.setInterval(() => setElapsed(Date.now() - start), 1000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Commit the finished attempt to the permanent record exactly once, when the
  // learner reaches 'done' (a clean sheet, or after finishing the Skills review).
  // This is the ONLY place test history / skill points / proficiency are written,
  // so bailing out before here truly leaves no trace.
  useEffect(() => {
    if (phase !== 'done' || recorded.current || !result) return
    // Misses always feed proficiency / spaced repetition, pass or fail.
    questions.forEach((q, i) => {
      recordAttempt({
        conceptTag: q.conceptTag,
        unitId: q.unitId,
        isCorrect: answers[i] === q.correctChoiceId,
        timeMs: Math.round(timeSpent.current[i] ?? 0),
        source: 'test',
      })
    })
    // Only a PASS (≥70%) is committed to history + awards points + unlocks a matchday. A fail
    // is NOT recorded here — the learner must retake (or buy the auto-pass) from the DoneScreen.
    const passed = result.score / result.total >= TEST_PASS_70
    if (passed) {
      const { attemptId: id } = recordTestResult({
        score: result.score,
        total: result.total,
        perUnit: result.perUnit,
        questions,
        answers,
        reviewComplete: true,
      })
      setAttemptId(id)
    }
    recorded.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Rebuild a brand-new test in place (a retake after a failed exam). Abandoned/failed
  // attempts are never recorded, so this is a clean fresh start.
  const retake = useCallback(() => {
    clearTestSession(username)
    recorded.current = false
    setResult(null)
    setAttemptId(null)
    setCurrent(0)
    setAnswers([])
    setPhase('loading')
    void (async () => {
      const bank = await fetchBank()
      const attemptNo = testHistory.length
      const seed = `${username || 'guest'}:${attemptNo}:retake-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
      const picked = selectTestQuestions(bank, proficiency, {
        rng: seededRng(seed),
        starter: attemptNo === 0,
      })
      setQuestions(picked)
      setAnswers(Array(picked.length).fill(null))
      timeSpent.current = Array(picked.length).fill(0)
      enterRef.current = performance.now()
      setElapsed(0)
      setPhase('quiz')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, testHistory.length, proficiency])

  function commitTime() {
    if (enterRef.current === 0) return
    const now = performance.now()
    timeSpent.current[current] = (timeSpent.current[current] ?? 0) + (now - enterRef.current)
    enterRef.current = now
  }

  function startTest() {
    enterRef.current = performance.now()
    setElapsed(0)
    setPhase('quiz')
  }

  function goTo(idx: number) {
    commitTime()
    setCurrent(Math.max(0, Math.min(questions.length - 1, idx)))
  }

  function pick(choiceId: string) {
    setAnswers((prev) => {
      const next = [...prev]
      next[current] = choiceId
      return next
    })
  }

  // Grade an answers array into a TestResult (per-unit breakdown + points).
  function gradeAnswers(ans: (string | null)[]): TestResult {
    const perUnit: Record<string, { correct: number; total: number; timeSum: number }> = {}
    let score = 0
    questions.forEach((q, i) => {
      const isCorrect = ans[i] === q.correctChoiceId
      if (isCorrect) score++
      const timeMs = Math.round(timeSpent.current[i] ?? 0)
      const bucket = (perUnit[q.unitId] ??= { correct: 0, total: 0, timeSum: 0 })
      bucket.total++
      bucket.timeSum += timeMs
      if (isCorrect) bucket.correct++
    })
    const perUnitOut: TestResult['perUnit'] = {}
    for (const [unit, b] of Object.entries(perUnit)) {
      perUnitOut[unit] = { correct: b.correct, total: b.total, avgTimeMs: b.total ? Math.round(b.timeSum / b.total) : 0 }
    }
    return { score, total: questions.length, pointsAwarded: pointsForScore(score, questions.length), perUnit: perUnitOut }
  }

  // Grade locally and move to the results screen. Nothing is written to the
  // permanent record yet — that happens only at 'done'.
  function submit() {
    commitTime()
    setResult(gradeAnswers(answers))
    setPhase('results')
  }

  // Testing shortcut: fabricate answers that grade to ~`pct`, with the misses spread randomly
  // across questions, then jump to the post-submit results screen — so we can preview the full
  // results → review → done (or fail/retake) flow for any score on demand. Every question is
  // genuinely "answered": correct ones get the right choice, misses get a RANDOM wrong choice,
  // so the skills-review screen (your-pick highlight + "explain why I'm wrong") has real data.
  function simSubmit(pct: number) {
    const total = questions.length
    const want = Math.round(total * pct)
    const idxs = [...questions.keys()]
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[idxs[i], idxs[j]] = [idxs[j], idxs[i]]
    }
    const correct = new Set(idxs.slice(0, want))
    const fake = questions.map((q, i) => {
      if (correct.has(i)) return q.correctChoiceId
      const wrongChoices = q.choices.filter((c) => c.id !== q.correctChoiceId)
      if (wrongChoices.length === 0) return null
      return wrongChoices[Math.floor(Math.random() * wrongChoices.length)].id
    })
    setAnswers(fake)
    setResult(gradeAnswers(fake))
    setPhase('results')
  }

  const answeredCount = answers.filter((a) => a != null).length

  if (phase === 'loading') {
    return (
      <div className="qtest-wrap">
        <div className="card qtest qtest--center">
          <div className="qtest__spinner" aria-hidden />
          <p className="muted">Building your test…</p>
        </div>
      </div>
    )
  }

  if (phase === 'intro') {
    return (
      <div className="qtest-wrap">
        <div className="card qtest qtest--intro">
          <button
            className="btn btn--primary btn--sm qtest__exit"
            onClick={() => {
              clearTestSession(username)
              onExit()
            }}
          >
            ← Back
          </button>
          <span className="eyebrow">Skills assessment</span>
          <h1 className="qtest__h1">The Quantum League</h1>

          <div className="qtest__statgrid">
            <div className="qtest__stat"><span>Overall</span><strong>{overall}</strong></div>
            <div className="qtest__stat"><span>Skill points</span><strong>{profile.skillPoints}</strong></div>
            <div className="qtest__stat"><span>Coins</span><strong>{profile.coins}</strong></div>
          </div>

          <div className="qtest__hype">
            <span className="qtest__hype-icon" aria-hidden>🎡</span>
            <span>Earn points and get a chance to spin the wheel!</span>
          </div>

          <div className="qtest__introfoot">
            <div className="qtest__simdev">
              <span className="qtest__simdev-label">Testing — preview the end-of-test flow for a score:</span>
              <div className="qtest__simdev-btns">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => simSubmit(0.9)}>Sim 90%</button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => simSubmit(0.7)}>Sim 70%</button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => simSubmit(0.6)}>Sim 60%</button>
              </div>
            </div>
            <button className="btn btn--primary qtest__start-btn" onClick={startTest}>Start the test →</button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'results' && result) {
    const wrong = questions
      .map((qq, i) => ({ q: qq, your: answers[i] }))
      .filter(({ q: qq, your }) => your !== qq.correctChoiceId)
    return (
      <Results
        result={result}
        wrongCount={wrong.length}
        onStartReview={() => setPhase('review')}
        onDone={() => setPhase('done')}
      />
    )
  }

  if (phase === 'review' && result) {
    const wrong = questions
      .map((qq, i) => ({ q: qq, your: answers[i] }))
      .filter(({ q: qq, your }) => your !== qq.correctChoiceId)
    return <SkillsReview wrong={wrong} onFinish={() => setPhase('done')} />
  }

  if (phase === 'done' && result) {
    return (
      <DoneScreen
        result={result}
        profile={profile}
        adjustSkillPoints={adjustSkillPoints}
        rollPointsWheel={rollPointsWheel}
        onRetake={retake}
        onAutoPass={autoPassAssessment}
        onExit={() => {
          clearTestSession(username)
          onExit()
        }}
      />
    )
  }

  // ----- quiz phase -----
  const q = questions[current]
  const picked = answers[current]
  const isLast = current === questions.length - 1

  return (
    <div className="qtest-wrap">
      <div className="card qtest">
        <div className="qtest__top">
          <div>
            <strong className="qtest__qn">Question {current + 1} <span className="muted">/ {questions.length}</span></strong>
          </div>
          <div className="qtest__hud">
            <button type="button" className="soccer__calc-toggle qtest__calc-toggle" onClick={() => setShowCalc((v) => !v)}>
              🧮 {showCalc ? 'Hide' : 'Calc'}
            </button>
            <span className="chip qtest__clock">⏱ {fmtTime(elapsed)}</span>
          </div>
        </div>

        {showCalc && <Calculator floating onClose={() => setShowCalc(false)} />}

        <div className="qtest__progress"><span style={{ width: `${(answeredCount / questions.length) * 100}%` }} /></div>

        <p className="qtest__prompt">{q.prompt}</p>

        {q.diagram && (
          <div className="qtest__figure">
            <QuestionDiagram diagram={q.diagram} />
          </div>
        )}

        {q.formulas && q.formulas.length > 0 && (
          <div className="qtest__formulas">
            <span className="qtest__formulas-label">Given</span>
            {q.formulas.map((f) => <code key={f}>{f}</code>)}
          </div>
        )}

        <div className="quiz-opts">
          {q.choices.map((c, i) => (
            <button
              key={c.id}
              className={`quiz-opt ${picked === c.id ? 'is-sel' : ''}`}
              onClick={() => pick(c.id)}
            >
              <span className="qtest__key">{LETTERS[i]}</span>
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        <div className="qtest__jump">
          {questions.map((_, i) => (
            <button
              key={i}
              className={`qtest__jump-dot ${i === current ? 'is-current' : ''} ${answers[i] != null ? 'is-done' : ''}`}
              onClick={() => goTo(i)}
              aria-label={`Question ${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        <div className="qtest__foot">
          <button className="btn btn--ghost" onClick={() => goTo(current - 1)} disabled={current === 0}>Back</button>
          <span className="qtest__count">{answeredCount}/{questions.length} answered</span>
          {isLast ? (
            <button className="btn btn--primary" onClick={submit}>
              {answeredCount < questions.length ? `Submit (${questions.length - answeredCount} blank)` : 'Submit test →'}
            </button>
          ) : (
            <button className="btn btn--primary" onClick={() => goTo(current + 1)}>Next</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Score recap immediately after submitting. Points/allocation are NOT here —
// they're awarded on the 'done' screen after the (mandatory) Skills review, so
// abandoning at this point leaves no trace.
function Results({
  result,
  wrongCount,
  onStartReview,
  onDone,
}: {
  result: TestResult
  wrongCount: number
  onStartReview: () => void
  onDone: () => void
}) {
  const pct = Math.round((result.score / result.total) * 100)
  const tier = pct >= TEST_PASS_90 * 100 ? '90' : pct >= TEST_PASS_70 * 100 ? '70' : 'fail'

  // Rotate through a few hype lines for an ace so it never feels canned. No em dashes.
  const headline = useMemo(() => {
    if (tier === '90') {
      const aces = ["You're on fire", 'Absolutely clinical', 'Top of the table']
      return aces[Math.floor(Math.random() * aces.length)]
    }
    return tier === '70' ? 'Passed!' : 'Keep training'
  }, [tier])

  const unitRows = useMemo(
    () =>
      SKILLS.map((s) => {
        const u = result.perUnit[s.id] ?? { correct: 0, total: 0, avgTimeMs: 0 }
        return { id: s.id, name: unitLabel(s.id), ...u }
      }),
    [result],
  )

  return (
    <div className="qtest-wrap">
      <div className="card qtest">
        <span className="eyebrow">Results</span>
        <h1 className="qtest__h1">{headline}</h1>
        <p className="qtest__lede">You scored <strong>{result.score} / {result.total}</strong> ({pct}%).</p>

        <div className="quiz-scorebar"><span className="quiz-scorebar__fill" style={{ width: `${pct}%` }} /></div>

        {tier === 'fail' ? (
          <div className="qtest__reward qtest__reward--fail">
            <strong>You didn't pass this assessment.</strong>
            <span>You need 70% to clear it. Work through every miss below, then retake the exam — your matchday stays locked until you pass.</span>
          </div>
        ) : result.pointsAwarded > 0 ? (
          <p className="qtest__unlock">Unlock your skill points after finishing the review.</p>
        ) : (
          <div className="qtest__reward qtest__reward--miss">Score 70% or higher to earn skill points. Review the misses and run it back.</div>
        )}

        <h3 className="qtest__sub">By unit</h3>
        <div className="qtest__units">
          {unitRows.map((r) => {
            const upct = r.total ? Math.round((r.correct / r.total) * 100) : 0
            return (
              <div key={r.id} className="qtest__unit">
                <span className="qtest__unit-name">{r.name}</span>
                <span className="qtest__unit-bar"><span style={{ width: `${upct}%` }} /></span>
                <span className="qtest__unit-score">{r.correct}/{r.total}</span>
              </div>
            )
          })}
        </div>

        {wrongCount > 0 ? (
          <div className="qtest__reviewcta">
            <h3 className="qtest__sub">Skills review</h3>
            <p className="qtest__note">
              You missed <strong>{wrongCount}</strong> question{wrongCount === 1 ? '' : 's'}. Work through a
              guided review of each one — break down why, then solve a fresh version — to finish this assessment.
            </p>
            <div className="qtest__foot qtest__foot--end">
              <button className="btn btn--primary" onClick={onStartReview}>Start skills review →</button>
            </div>
          </div>
        ) : (
          <div className="qtest__foot qtest__foot--end">
            <button className="btn btn--primary" onClick={onDone}>Continue →</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Final screen: the attempt is committed (by the parent, on entering 'done'),
// points are now live, and the learner spends them before returning to the
// dashboard. Reaching here is what marks the assessment complete.
function DoneScreen({
  result,
  profile,
  adjustSkillPoints,
  rollPointsWheel,
  onRetake,
  onAutoPass,
  onExit,
}: {
  result: TestResult
  profile: ReturnType<typeof usePlayer>['profile']
  adjustSkillPoints: ReturnType<typeof usePlayer>['adjustSkillPoints']
  rollPointsWheel: ReturnType<typeof useApp>['rollPointsWheel']
  onRetake: () => void
  onAutoPass: () => boolean
  onExit: () => void
}) {
  const pct = Math.round((result.score / result.total) * 100)
  const passed = pct >= TEST_PASS_70 * 100

  // A 90%+ ace earns the right to GAMBLE the safe +5 on the points wheel (1–10).
  // Hooks must run unconditionally (before any early return), so declare them up here.
  const aced = pct >= TEST_PASS_90 * 100 && result.pointsAwarded >= POINTS_WHEEL_SAFE
  // 'offer' → show the choice; 'kept' → took the safe points; 'spun' → gambled (final award).
  const [choice, setChoice] = useState<'offer' | 'kept' | { spun: number }>(aced ? 'offer' : 'kept')
  const [wheelOpen, setWheelOpen] = useState(false)
  const finalAward = typeof choice === 'object' ? choice.spun : result.pointsAwarded

  // ----- FAILED exam: reviewed the misses, but it isn't passed. Retake, leave it for now, or
  // (expensively) buy your way through. Nothing was recorded, so the matchday stays locked.
  if (!passed) {
    const canAfford = profile.coins >= AUTO_PASS_COST
    return (
      <div className="qtest-wrap">
        <div className="card qtest">
          <span className="eyebrow eyebrow--fail">Assessment failed</span>
          <h1 className="qtest__h1">Review done — now pass it</h1>
          <p className="qtest__lede">
            You scored <strong>{result.score} / {result.total}</strong> ({pct}%). You've reviewed every miss, but you
            need <strong>70%</strong> to clear this assessment. It stays open until you pass — your matchday is still locked.
          </p>

          <div className="retake-opts">
            <button type="button" className="btn btn--primary retake-opts__main" onClick={onRetake}>
              Retake assessment →
            </button>
            <button type="button" className="btn btn--ghost" onClick={onExit}>
              Back to dashboard
            </button>
          </div>

          <div className="retake-skip">
            <div className="retake-skip__head">
              <strong>In a hurry?</strong>
              <span>Skip the retake and auto-pass this exam. No skill points — and it's pricey.</span>
            </div>
            <button
              type="button"
              className="btn btn--gold retake-skip__btn"
              disabled={!canAfford}
              onClick={() => { if (onAutoPass()) onExit() }}
              title={canAfford ? 'Spend coins to auto-pass' : `You need ${AUTO_PASS_COST} coins`}
            >
              Auto-pass · {AUTO_PASS_COST}
              <span className="coin-icon" aria-hidden />
            </button>
            {!canAfford && (
              <p className="retake-skip__warn">You have {profile.coins} — not enough to buy a pass.</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="qtest-wrap">
      <div className="card qtest">
        <span className="eyebrow">Assessment complete</span>
        <h1 className="qtest__h1">Nice work!</h1>
        <p className="qtest__lede">Final score <strong>{result.score} / {result.total}</strong> ({pct}%).</p>

        {choice === 'offer' ? (
          <div className="gamble-offer">
            <div className="gamble-offer__opts">
              <button type="button" className="gamble-opt gamble-opt--safe" onClick={() => setChoice('kept')}>
                <span className="gamble-opt__big">+{POINTS_WHEEL_SAFE}</span>
                <span className="gamble-opt__cap">Skill points · take it</span>
              </button>
              <button type="button" className="gamble-opt gamble-opt--risk" onClick={() => setWheelOpen(true)}>
                <span className="gamble-opt__big">1–10</span>
                <span className="gamble-opt__cap">Skill points · spin now</span>
              </button>
            </div>
            <div className="gamble-offer__foot">
              <button type="button" className="btn btn--ghost btn--sm gamble-offer__leave" onClick={onExit}>
                Back to dashboard · keep +{POINTS_WHEEL_SAFE}
              </button>
            </div>
          </div>
        ) : finalAward > 0 ? (
          <div className="qtest__reward">🎉 You earned <strong>+{finalAward} skill points</strong>.</div>
        ) : (
          <div className="qtest__reward qtest__reward--miss">No skill points this time — score 70%+ to earn them.</div>
        )}

        {choice !== 'offer' && profile.skillPoints > 0 && (
          <>
            <h3 className="qtest__sub">Skill points earned <span className="chip qtest__pts">{profile.skillPoints} to spend</span></h3>
            <p className="qtest__note">
              Open <strong>Manage squad</strong> on your club card to spend these on any of your 8 players —
              build the team however you want. Higher ratings mean fewer questions interrupt that player in a match.
            </p>
          </>
        )}

        {choice !== 'offer' && (
          <div className="qtest__foot qtest__foot--end">
            <button className="btn btn--primary" onClick={onExit}>Back to dashboard →</button>
          </div>
        )}
      </div>

      {wheelOpen && (
        <PointsWheel
          getResult={rollPointsWheel}
          onCollect={(value) => {
            // recordTestResult already banked the safe +5; settle up to the gambled total.
            adjustSkillPoints(value - POINTS_WHEEL_SAFE)
            setChoice({ spun: value })
          }}
          onClose={() => setWheelOpen(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared, read-only list of every question with the correct answer + the
// learner's pick highlighted (used by both the live results and the replay).
function ReviewList({
  questions,
  answers,
  enablePractice = false,
  onAwardCoins,
  bonusAvailable = false,
  onClaimBonus,
}: {
  questions: BankQuestion[]
  answers: (string | null)[]
  /** History view: show a "Practice this concept" loop on each missed question. */
  enablePractice?: boolean
  onAwardCoins?: (n: number) => void
  /** True when today's once-a-day practice coin bonus is still up for grabs. */
  bonusAvailable?: boolean
  onClaimBonus?: () => void
}) {
  // The daily bonus is offered on the FIRST missed question only, so it shows up once.
  const firstMissIdx = questions.findIndex((q, i) => (answers[i] ?? null) !== q.correctChoiceId)
  return (
    <div className="qtest__review">
      {questions.map((q, i) => {
        const your = answers[i] ?? null
        const correct = q.correctChoiceId
        const got = your === correct
        return (
          <div key={q.id} className={`qtest__rev ${got ? 'is-good' : 'is-bad'}`}>
            <div className="qtest__rev-head">
              <span className="qtest__rev-n">{got ? '✓' : '✕'} Q{i + 1}</span>
              <span className="qtest__rev-unit">{unitLabel(q.unitId)}</span>
            </div>
            <p className="qtest__rev-prompt">{q.prompt}</p>
            {q.diagram && <div className="qtest__figure qtest__figure--sm"><QuestionDiagram diagram={q.diagram} /></div>}
            {q.formulas && q.formulas.length > 0 && (
              <div className="qtest__formulas qtest__formulas--sm">
                <span className="qtest__formulas-label">Given</span>
                {q.formulas.map((f) => <code key={f}>{f}</code>)}
              </div>
            )}
            <ul className="qtest__rev-choices">
              {q.choices.map((c, ci) => {
                const isCorrect = c.id === correct
                const isYours = c.id === your
                return (
                  <li key={c.id} className={`${isCorrect ? 'is-correct' : ''} ${isYours && !isCorrect ? 'is-wrong' : ''}`}>
                    <span className="qtest__key qtest__key--sm">{LETTERS[ci]}</span>
                    <span>{c.label}</span>
                    {isCorrect && <span className="qtest__rev-tag">correct</span>}
                    {isYours && !isCorrect && <span className="qtest__rev-tag">your answer</span>}
                  </li>
                )
              })}
            </ul>
            {q.explanation && <p className="qtest__rev-why">{q.explanation}</p>}
            {!got && enablePractice && (
              <HistoryPractice
                base={q}
                onAwardCoins={onAwardCoins}
                bonusAvailable={bonusAvailable && i === firstMissIdx}
                onClaimBonus={onClaimBonus}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Re-open a past attempt in the same results view it had right after taking it.
// Read-only: shows the score, per-unit breakdown, and every question with the
// correct answer + the learner's original pick. No new skill points are awarded.
export function AttemptReview({ attempt, onExit }: { attempt: TestAttempt; onExit: () => void }) {
  const { addCoins } = usePlayer()
  const { practiceBonusAvailable, claimPracticeBonus } = useApp()
  const questions = attempt.questions ?? []
  const answers = attempt.answers ?? []
  const pct = attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0
  const headline = attempt.passed90 ? 'Elite — top marks!' : attempt.passed70 ? 'Passed!' : 'Keep training'
  const [openReview, setOpenReview] = useState(true)

  const unitRows = SKILLS.map((s) => {
    const u = attempt.perUnit[s.id] ?? { correct: 0, total: 0, avgTimeMs: 0 }
    return { id: s.id, name: unitLabel(s.id), ...u }
  })

  const takenLabel = (() => {
    const d = new Date(attempt.takenAt)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
  })()

  return (
    <div className="qtest-wrap">
      <div className="card qtest">
        <button className="btn btn--ghost btn--sm qtest__exit" onClick={onExit}>✕ Close</button>
        <span className="eyebrow">Past assessment{takenLabel ? ` · ${takenLabel}` : ''}</span>
        <h1 className="qtest__h1">{headline}</h1>
        <p className="qtest__lede">You scored <strong>{attempt.score} / {attempt.total}</strong> ({pct}%).</p>

        <div className="quiz-scorebar"><span className="quiz-scorebar__fill" style={{ width: `${pct}%` }} /></div>

        <h3 className="qtest__sub">By unit</h3>
        <div className="qtest__units">
          {unitRows.map((r) => {
            const upct = r.total ? Math.round((r.correct / r.total) * 100) : 0
            return (
              <div key={r.id} className="qtest__unit">
                <span className="qtest__unit-name">{r.name}</span>
                <span className="qtest__unit-bar"><span style={{ width: `${upct}%` }} /></span>
                <span className="qtest__unit-score">{r.correct}/{r.total}</span>
              </div>
            )
          })}
        </div>

        {questions.length > 0 ? (
          <>
            <button className="btn btn--ghost qtest__review-toggle" onClick={() => setOpenReview((o) => !o)}>
              {openReview ? 'Hide questions' : 'View all questions'} {openReview ? '▲' : '▼'}
            </button>
            {openReview && (
              <ReviewList
                questions={questions}
                answers={answers}
                enablePractice
                onAwardCoins={addCoins}
                bonusAvailable={practiceBonusAvailable}
                onClaimBonus={claimPracticeBonus}
              />
            )}
          </>
        ) : (
          <p className="qtest__note">The individual questions weren't saved for this older attempt.</p>
        )}

        <div className="qtest__foot qtest__foot--end">
          <button className="btn btn--primary" onClick={onExit}>Done</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One missed question rendered read-only (prompt, diagram, your wrong pick and
// the correct answer highlighted) — shown at the top of each review step.
function ReviewSingle({ q, your }: { q: BankQuestion; your: string | null }) {
  return (
    <div className="qtest__rev is-bad qtest__rev--solo">
      <div className="qtest__rev-head">
        <span className="qtest__rev-n">✕ You missed this</span>
        <span className="qtest__rev-unit">{unitLabel(q.unitId)}</span>
      </div>
      <p className="qtest__rev-prompt">{q.prompt}</p>
      {q.diagram && <div className="qtest__figure qtest__figure--sm"><QuestionDiagram diagram={q.diagram} /></div>}
      {q.formulas && q.formulas.length > 0 && (
        <div className="qtest__formulas qtest__formulas--sm">
          <span className="qtest__formulas-label">Given</span>
          {q.formulas.map((f) => <code key={f}>{f}</code>)}
        </div>
      )}
      <ul className="qtest__rev-choices">
        {q.choices.map((c, ci) => {
          const isCorrect = c.id === q.correctChoiceId
          const isYours = c.id === your
          return (
            <li key={c.id} className={`${isCorrect ? 'is-correct' : ''} ${isYours && !isCorrect ? 'is-wrong' : ''}`}>
              <span className="qtest__key qtest__key--sm">{LETTERS[ci]}</span>
              <span>{c.label}</span>
              {isCorrect && <span className="qtest__rev-tag">correct</span>}
              {isYours && !isCorrect && <span className="qtest__rev-tag">your answer</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Guided remediation after a test: for EACH missed question the learner must
// (1) read an AI breakdown of why their answer was wrong (can't continue until
// they request it), then (2) solve a freshly generated question on the SAME
// concept — getting new ones until they answer one correctly — before moving on.
// Only when every miss is cleared does the assessment count as complete.
function SkillsReview({
  wrong,
  onFinish,
}: {
  wrong: { q: BankQuestion; your: string | null }[]
  onFinish: () => void
}) {
  const [idx, setIdx] = useState(0)
  const [stage, setStage] = useState<'explain' | 'practice'>('explain')
  const [explainText, setExplainText] = useState('')
  const [explainStatus, setExplainStatus] = useState<'idle' | 'loading' | 'done'>('idle')

  const item = wrong[idx]
  const total = wrong.length

  useEffect(() => {
    setStage('explain')
    setExplainStatus('idle')
    setExplainText('')
  }, [idx])

  const runExplain = useCallback(async () => {
    if (!item) return
    setExplainStatus('loading')
    const ai = await explainWrongAnswer({
      unitId: item.q.unitId,
      conceptTag: item.q.conceptTag,
      difficulty: item.q.difficulty,
      prompt: item.q.prompt,
      choices: item.q.choices,
      correctChoiceId: item.q.correctChoiceId,
      yourChoiceId: item.your,
      correctValue: item.q.correctValue,
      given: item.q.given,
      formulas: item.q.formulas,
      staticExplanation: item.q.explanation,
    })
    setExplainText(
      ai ??
        item.q.explanation ??
        'Re-derive the answer one step at a time from the given quantities and the equation sheet — your pick skips or misuses one of those steps.',
    )
    setExplainStatus('done')
  }, [item])

  const advance = useCallback(() => {
    if (idx + 1 >= total) onFinish()
    else setIdx((i) => i + 1)
  }, [idx, total, onFinish])

  if (!item) return null

  return (
    <div className="qtest-wrap">
      <div className="card qtest">
        <span className="eyebrow">Skills review · {idx + 1} of {total}</span>
        <h1 className="qtest__h1">Fix what you missed</h1>
        <div className="qtest__progress"><span style={{ width: `${(idx / total) * 100}%` }} /></div>

        {stage === 'explain' ? (
          <>
            <ReviewSingle q={item.q} your={item.your} />
            {explainStatus !== 'done' ? (
              <div className="qtest__explain qtest__explain--gate">
                <button className="btn btn--primary" onClick={runExplain} disabled={explainStatus === 'loading'}>
                  {explainStatus === 'loading' ? 'Breaking it down…' : "Explain why I'm wrong ✦"}
                </button>
                <p className="qtest__note">Read the breakdown to unlock the practice question.</p>
              </div>
            ) : (
              <>
                <div className="qtest__breakdown">
                  <strong>Why your answer misses</strong>
                  <p>{explainText}</p>
                </div>
                <div className="qtest__foot qtest__foot--end">
                  <button className="btn btn--primary" onClick={() => setStage('practice')}>Got it — let me try one →</button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <ConceptPractice
              base={{ unitId: item.q.unitId, conceptTag: item.q.conceptTag, difficulty: item.q.difficulty }}
              seedExclude={[item.q.id]}
              mode="gate"
              onSolved={advance}
              solvedLabel={idx + 1 >= total ? 'Finish review →' : 'Next missed question →'}
            />
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generates same-concept practice questions on demand (live AI first, bank
// fallback) and grades them. Two modes:
//   gate    — Skills review: answer ONE correctly to call onSolved().
//   endless — test history: loop until onExit(), with an optional one-time
//             +coins bonus paid on the first correct answer.
function ConceptPractice({
  base,
  seedExclude,
  mode,
  onSolved,
  onExit,
  onAwardCoins,
  bonusCoins = 0,
  solvedLabel = 'Continue →',
}: {
  base: { unitId: UnitId; conceptTag: string; difficulty: 1 | 2 | 3 | 4 | 5 }
  seedExclude: string[]
  mode: 'gate' | 'endless'
  onSolved?: () => void
  onExit?: () => void
  onAwardCoins?: (n: number) => void
  bonusCoins?: number
  solvedLabel?: string
}) {
  const [q, setQ] = useState<BankQuestion | null>(null)
  const [loading, setLoading] = useState(true)
  const [pick, setPick] = useState<string | null>(null)
  const [graded, setGraded] = useState(false)
  const [solved, setSolved] = useState(false)
  const [awarded, setAwarded] = useState(false)
  const bankRef = useRef<BankQuestion[]>([])
  const seen = useRef<Set<string>>(new Set(seedExclude))

  const serve = useCallback(async () => {
    setLoading(true)
    setPick(null)
    setGraded(false)
    setSolved(false)
    const next = await nextPracticeQuestion(bankRef.current, base, seen.current)
    if (next) seen.current.add(next.id)
    setQ(next)
    setLoading(false)
  }, [base])

  useEffect(() => {
    let alive = true
    void (async () => {
      const b = await fetchBank()
      if (!alive) return
      bankRef.current = b
      await serve()
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grade = () => {
    if (pick == null || !q || graded) return
    const correct = pick === q.correctChoiceId
    setGraded(true)
    setSolved(correct)
    if (correct && bonusCoins > 0 && !awarded && onAwardCoins) {
      onAwardCoins(bonusCoins)
      setAwarded(true)
    }
  }

  if (loading) {
    return (
      <div className="qtest__practice qtest__practice--load">
        <div className="qtest__spinner" aria-hidden />
        <p className="muted">Generating a fresh question…</p>
      </div>
    )
  }
  if (!q) {
    return <p className="qtest__note">No more practice questions are available for this concept right now.</p>
  }

  return (
    <div className="qtest__practice">
      {bonusCoins > 0 && !awarded && (
        <div className="qtest__bonus">Solve this one for <strong>+{bonusCoins} <span className="coin-icon coin-icon--sm" aria-hidden /></strong></div>
      )}
      <p className="qtest__prompt">{q.prompt}</p>
      {q.diagram && <div className="qtest__figure"><QuestionDiagram diagram={q.diagram} /></div>}
      {q.formulas && q.formulas.length > 0 && (
        <div className="qtest__formulas">
          <span className="qtest__formulas-label">Given</span>
          {q.formulas.map((f) => <code key={f}>{f}</code>)}
        </div>
      )}
      <div className="quiz-opts">
        {q.choices.map((c, ci) => {
          const isCorrect = c.id === q.correctChoiceId
          const isPick = c.id === pick
          const cls = graded
            ? isCorrect
              ? 'is-correct'
              : isPick
                ? 'is-wrong'
                : ''
            : isPick
              ? 'is-sel'
              : ''
          return (
            <button key={c.id} className={`quiz-opt ${cls}`} disabled={graded} onClick={() => setPick(c.id)}>
              <span className="qtest__key">{LETTERS[ci]}</span>
              <span>{c.label}</span>
            </button>
          )
        })}
      </div>

      {!graded ? (
        <div className="qtest__foot qtest__foot--end">
          {mode === 'endless' && onExit && <button className="btn btn--ghost" onClick={onExit}>Exit practice</button>}
          <button className="btn btn--primary" onClick={grade} disabled={pick == null}>Check answer</button>
        </div>
      ) : solved ? (
        <>
          <div className="qtest__reward">Correct! ✓{awarded && (<>  ·  +{bonusCoins} <span className="coin-icon coin-icon--sm" aria-hidden /> earned</>)}</div>
          {q.explanation && <p className="qtest__rev-why">{q.explanation}</p>}
          <div className="qtest__foot qtest__foot--end">
            {mode === 'gate' ? (
              <button className="btn btn--primary" onClick={onSolved}>{solvedLabel}</button>
            ) : (
              <>
                {onExit && <button className="btn btn--ghost" onClick={onExit}>Done practising</button>}
                <button className="btn btn--primary" onClick={serve}>Another one →</button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="qtest__reward qtest__reward--miss">Not quite — the correct answer is highlighted above.</div>
          {q.explanation && <p className="qtest__rev-why">{q.explanation}</p>}
          <div className="qtest__foot qtest__foot--end">
            {mode === 'endless' && onExit && <button className="btn btn--ghost" onClick={onExit}>Exit practice</button>}
            <button className="btn btn--primary" onClick={serve}>Try another →</button>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Test-history Practice toggle: on a missed question, opens an endless same-
// concept practice loop. ~1 in 3 missed questions advertises a +5 coin bonus
// for practising it (paid once, on the first correct answer).
function HistoryPractice({
  base,
  onAwardCoins,
  bonusAvailable = false,
  onClaimBonus,
}: {
  base: BankQuestion
  onAwardCoins?: (n: number) => void
  /** When true, this practice loop pays a one-per-day coin bonus on the first correct answer. */
  bonusAvailable?: boolean
  onClaimBonus?: () => void
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        className={
          bonusAvailable
            ? 'qtest__practice-open qtest__practice-open--bonus'
            : 'btn btn--ghost btn--sm qtest__practice-open'
        }
        onClick={() => setOpen(true)}
      >
        <span>Practice this concept</span>
        {bonusAvailable && (
          <span className="qtest__practice-bonus">
            +{PRACTICE_BONUS_COINS}
            <span className="coin-icon coin-icon--sm" aria-hidden />
          </span>
        )}
      </button>
    )
  }
  return (
    <ConceptPractice
      base={{ unitId: base.unitId, conceptTag: base.conceptTag, difficulty: base.difficulty }}
      seedExclude={[base.id]}
      mode="endless"
      bonusCoins={bonusAvailable ? PRACTICE_BONUS_COINS : 0}
      onAwardCoins={(n) => {
        onAwardCoins?.(n)
        // Stamp today's date so the bonus can't be claimed again until tomorrow.
        onClaimBonus?.()
      }}
      onExit={() => setOpen(false)}
    />
  )
}
