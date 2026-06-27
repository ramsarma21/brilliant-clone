import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlayer } from '../state/PlayerState'
import { useApp } from '../state/AppState'
import {
  fetchBank,
  nextPracticeQuestion,
  pointsForScore,
  selectTestQuestions,
  seededRng,
  TEST_TOTAL,
  TEST_PASS_70,
  TEST_PASS_90,
  POINTS_FOR_70,
  POINTS_FOR_90,
} from '../lib/questionBank'
import { clearTestSession, loadTestSession, saveTestSession } from '../lib/storage'
import { SKILLS, SKILLS_BY_ID, MAX_RATING } from '../lib/skills'
import { QuestionDiagram } from './QuestionDiagram'
import { explainWrongAnswer } from '../lib/ai/explainClient'
import type { BankQuestion, SkillId, TestAttempt } from '../types'

const LETTERS = ['A', 'B', 'C', 'D', 'E']

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
  const { profile, overall, unitProficiency, testHistory, recordAttempt, recordTestResult, spendPoint } = usePlayer()
  const { profile: authProfile } = useApp()
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
      const picked = selectTestQuestions(bank, unitProficiency, {
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
    // unitProficiency is read once at start of a test on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist the session on every meaningful change so a refresh resumes here.
  // (Skipped until the build/restore above has populated state.)
  useEffect(() => {
    if (!restored.current || phase === 'loading' || questions.length === 0) return
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
    questions.forEach((q, i) => {
      recordAttempt({
        conceptTag: q.conceptTag,
        unitId: q.unitId,
        isCorrect: answers[i] === q.correctChoiceId,
        timeMs: Math.round(timeSpent.current[i] ?? 0),
        source: 'test',
      })
    })
    const { attemptId: id } = recordTestResult({
      score: result.score,
      total: result.total,
      perUnit: result.perUnit,
      questions,
      answers,
      reviewComplete: true,
    })
    recorded.current = true
    setAttemptId(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

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

  // Grade locally and move to the results screen. Nothing is written to the
  // permanent record yet — that happens only at 'done'.
  function submit() {
    commitTime()
    const perUnit: Record<string, { correct: number; total: number; timeSum: number }> = {}
    let score = 0
    questions.forEach((q, i) => {
      const isCorrect = answers[i] === q.correctChoiceId
      if (isCorrect) score++
      const timeMs = Math.round(timeSpent.current[i] ?? 0)
      const bucket = (perUnit[q.unitId] ??= { correct: 0, total: 0, timeSum: 0 })
      bucket.total++
      bucket.timeSum += timeMs
      if (isCorrect) bucket.correct++
    })
    const perUnitOut: TestResult['perUnit'] = {}
    for (const [unit, b] of Object.entries(perUnit)) {
      perUnitOut[unit] = { correct: b.correct, total: b.total, avgTimeMs: Math.round(b.timeSum / b.total) }
    }
    setResult({ score, total: questions.length, pointsAwarded: pointsForScore(score, questions.length), perUnit: perUnitOut })
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
        <div className="card qtest">
          <button
            className="btn btn--ghost btn--sm qtest__exit"
            onClick={() => {
              clearTestSession(username)
              onExit()
            }}
          >
            ← Back
          </button>
          <span className="eyebrow">Skills assessment</span>
          <h1 className="qtest__h1">The Quantum League</h1>
          <p className="qtest__lede">
            {TEST_TOTAL} AP Physics 1–style questions — four from each of the five units. Answer them all,
            then submit to see your score. Do well and you earn skill points to upgrade your player.
          </p>

          <div className="qtest__statgrid">
            <div className="qtest__stat"><span>Overall</span><strong>{overall}</strong></div>
            <div className="qtest__stat"><span>Skill points</span><strong>{profile.skillPoints}</strong></div>
            <div className="qtest__stat"><span>Coins</span><strong>{profile.coins}</strong></div>
          </div>

          <div className="qtest__rules">
            <div className="qtest__rule"><span className="qtest__rule-pct">≥ 70%</span><span>+{POINTS_FOR_70} skill points</span></div>
            <div className="qtest__rule"><span className="qtest__rule-pct">≥ 90%</span><span>+{POINTS_FOR_90} skill points</span></div>
          </div>
          <p className="qtest__note">
            An equation sheet is given on each question, just like the real exam. You can change answers until you submit.
          </p>

          <div className="qtest__foot qtest__foot--end">
            <button className="btn btn--primary" onClick={startTest}>Start the test →</button>
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
        spendPoint={spendPoint}
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
  const unitName = SKILLS_BY_ID[q.unitId]?.name ?? q.unitId
  const isLast = current === questions.length - 1

  return (
    <div className="qtest-wrap">
      <div className="card qtest">
        <div className="qtest__top">
          <div>
            <span className="eyebrow">{unitName}</span>
            <strong className="qtest__qn">Question {current + 1} <span className="muted">/ {questions.length}</span></strong>
          </div>
          <span className="chip qtest__clock">⏱ {fmtTime(elapsed)}</span>
        </div>

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

  const headline =
    tier === '90' ? 'Elite — top marks!' : tier === '70' ? 'Passed!' : 'Keep training'

  const unitRows = useMemo(
    () =>
      SKILLS.map((s) => {
        const u = result.perUnit[s.id] ?? { correct: 0, total: 0, avgTimeMs: 0 }
        return { id: s.id, name: s.name, ...u }
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

        {result.pointsAwarded > 0 ? (
          <div className="qtest__reward">You'll earn <strong>+{result.pointsAwarded} skill points</strong> once you finish the review.</div>
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
  spendPoint,
  onExit,
}: {
  result: TestResult
  profile: ReturnType<typeof usePlayer>['profile']
  spendPoint: ReturnType<typeof usePlayer>['spendPoint']
  onExit: () => void
}) {
  const pct = Math.round((result.score / result.total) * 100)
  return (
    <div className="qtest-wrap">
      <div className="card qtest">
        <span className="eyebrow">Assessment complete</span>
        <h1 className="qtest__h1">Nice work!</h1>
        <p className="qtest__lede">Final score <strong>{result.score} / {result.total}</strong> ({pct}%).</p>

        {result.pointsAwarded > 0 ? (
          <div className="qtest__reward">🎉 You earned <strong>+{result.pointsAwarded} skill points</strong>.</div>
        ) : (
          <div className="qtest__reward qtest__reward--miss">No skill points this time — score 70%+ to earn them.</div>
        )}

        {profile.skillPoints > 0 && (
          <>
            <h3 className="qtest__sub">Spend skill points <span className="chip qtest__pts">{profile.skillPoints} left</span></h3>
            <p className="qtest__note">Higher ratings mean fewer questions interrupt you in the match (99 = free play).</p>
            <div className="qtest__alloc">
              {SKILLS.map((s) => {
                const rating = profile.skills[s.id]
                const maxed = rating >= MAX_RATING
                return (
                  <div key={s.id} className="qtest__alloc-row">
                    <span className="qtest__alloc-name">{s.name}</span>
                    <span className="qtest__alloc-val">{rating}{maxed ? ' (max)' : ''}</span>
                    <button
                      className="btn btn--primary btn--sm"
                      disabled={maxed || profile.skillPoints <= 0}
                      onClick={() => spendPoint(s.id as SkillId, 1)}
                    >
                      +1
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div className="qtest__foot qtest__foot--end">
          <button className="btn btn--primary" onClick={onExit}>Back to dashboard →</button>
        </div>
      </div>
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
}: {
  questions: BankQuestion[]
  answers: (string | null)[]
  /** History view: show a "Practice this concept" loop on each missed question. */
  enablePractice?: boolean
  onAwardCoins?: (n: number) => void
}) {
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
              <span className="muted">{SKILLS_BY_ID[q.unitId]?.name}</span>
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
            {!got && enablePractice && <HistoryPractice base={q} onAwardCoins={onAwardCoins} />}
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
  const questions = attempt.questions ?? []
  const answers = attempt.answers ?? []
  const pct = attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0
  const headline = attempt.passed90 ? 'Elite — top marks!' : attempt.passed70 ? 'Passed!' : 'Keep training'
  const [openReview, setOpenReview] = useState(true)

  const unitRows = SKILLS.map((s) => {
    const u = attempt.perUnit[s.id] ?? { correct: 0, total: 0, avgTimeMs: 0 }
    return { id: s.id, name: s.name, ...u }
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

        {attempt.pointsAwarded > 0 && (
          <div className="qtest__reward">This assessment earned <strong>+{attempt.pointsAwarded} skill points</strong>.</div>
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

        {questions.length > 0 ? (
          <>
            <button className="btn btn--ghost qtest__review-toggle" onClick={() => setOpenReview((o) => !o)}>
              {openReview ? 'Hide questions' : 'View all questions'} {openReview ? '▲' : '▼'}
            </button>
            {openReview && (
              <ReviewList questions={questions} answers={answers} enablePractice onAwardCoins={addCoins} />
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
        <span className="muted">{SKILLS_BY_ID[q.unitId]?.name}</span>
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
            <h3 className="qtest__sub">Now you try — same idea, fresh question</h3>
            <p className="qtest__note">Keep going until you get one right, then we move on.</p>
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
  base: { unitId: SkillId; conceptTag: string; difficulty: 1 | 2 | 3 | 4 | 5 }
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
        <div className="qtest__bonus">Solve this one for <strong>+{bonusCoins} 🪙</strong></div>
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
          <div className="qtest__reward">Correct! ✓{awarded ? `  ·  +${bonusCoins} 🪙 earned` : ''}</div>
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
}: {
  base: BankQuestion
  onAwardCoins?: (n: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [bonus] = useState(() => (Math.random() < 0.34 ? 5 : 0))
  const [claimed, setClaimed] = useState(false)

  if (!open) {
    return (
      <button className="btn btn--ghost btn--sm qtest__practice-open" onClick={() => setOpen(true)}>
        Practice this concept{bonus > 0 && !claimed ? ` · +${bonus} 🪙` : ''} →
      </button>
    )
  }
  return (
    <ConceptPractice
      base={{ unitId: base.unitId, conceptTag: base.conceptTag, difficulty: base.difficulty }}
      seedExclude={[base.id]}
      mode="endless"
      bonusCoins={bonus > 0 && !claimed ? bonus : 0}
      onAwardCoins={(n) => {
        onAwardCoins?.(n)
        setClaimed(true)
      }}
      onExit={() => setOpen(false)}
    />
  )
}
