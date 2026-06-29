import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlayer } from '../state/PlayerState'
import { useApp } from '../state/AppState'
import { fetchBank } from '../lib/questionBank'
import { conceptAbility, targetDifficulty, weakestConcepts } from '../lib/proficiency'
import { lessonFromQuestion } from '../content/lessonFromQuestion'
import { QuestionDiagram } from './QuestionDiagram'
import { Calculator } from './sims/Calculator'
import { MiniLesson } from './MiniLesson'
import { CoinBurst } from './ui/CoinBurst'
import { sfxCoin, sfxCash, sfxSoftFail, sfxStreakUp, sfxTick } from '../game/sfx'
import type { BankQuestion, UnitId } from '../types'

// ============================================================================
// THE LEARNING FARM — interactive lesson → problem on EXACTLY that idea.
//
// Flow per topic:
//   1. Pick a question from the generated skills-assessment bank.
//   2. Build the interactive lesson FROM that question (same formula, same numbers).
//   3. Learner answers; miss → re-teach (re-framed) → same question again.
//
// Session: 4 distinct units, difficulty ramps, optional spaced-rep REVIEW.
// Miss a review (already mastered) → no match this session.
// ============================================================================

const LETTERS = ['A', 'B', 'C', 'D', 'E']
const TOPIC_COUNT = 4

type Phase = 'intro' | 'loading' | 'lesson' | 'question' | 'reteach' | 'reward' | 'bust'
type Topic = { question: BankQuestion; review: boolean; openEnded: boolean }

const pretty = (tag: string) => tag.replace(/-/g, ' ')
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

export function LearningFarm({ onExit, onRewardMatch }: { onExit: () => void; onRewardMatch?: () => void }) {
  const { proficiency, recordAttempt } = usePlayer()
  const { progress, setPerfectStreak, markFirstFarmDone, unlockMatch, markUnitDiffMastered } = useApp()

  const firstRun = !progress.firstFarmDone
  const streak = progress.perfectStreak ?? 0

  const [phase, setPhase] = useState<Phase>('intro')
  const [topics, setTopics] = useState<Topic[]>([])
  const [topicIdx, setTopicIdx] = useState(0)
  const [reteach, setReteach] = useState(0)
  const [cleared, setCleared] = useState(0)
  const [combo, setCombo] = useState(0)
  const [burst, setBurst] = useState(0)
  const [showCalc, setShowCalc] = useState(false)
  const settled = useRef(false)

  const bankRef = useRef<BankQuestion[]>([])
  const usedRef = useRef<Set<string>>(new Set())
  const oeShownRef = useRef(false)

  const pick = useCallback((unitId: UnitId, conceptTag: string | null, diff: number): BankQuestion | null => {
    const match = (q: BankQuestion) =>
      q.unitId === unitId && (!conceptTag || q.conceptTag === conceptTag)
    let pool = bankRef.current.filter((q) => match(q) && !usedRef.current.has(q.id))
    if (pool.length === 0) {
      bankRef.current.filter(match).forEach((q) => usedRef.current.delete(q.id))
      pool = bankRef.current.filter((q) => match(q) && !usedRef.current.has(q.id))
    }
    if (pool.length === 0) pool = bankRef.current.filter((q) => q.unitId === unitId)
    pool.sort((a, b) => Math.abs(a.difficulty - diff) - Math.abs(b.difficulty - diff))
    const q = pool[0] ?? null
    if (q) usedRef.current.add(q.id)
    return q
  }, [])

  const start = useCallback(() => {
    settled.current = false
    setTopicIdx(0); setReteach(0); setCleared(0); setCombo(0); setBurst(0)
    setPhase('loading')
    void (async () => {
      const bank = await fetchBank()
      bankRef.current = bank
      usedRef.current = new Set()
      oeShownRef.current = false

      const bankUnits = Array.from(new Set(bank.map((q) => q.unitId)))
      const weak = weakestConcepts(proficiency, 12)
      const weakUnits = Array.from(new Set(weak.map((c) => c.unitId))).filter((u) => bankUnits.includes(u))
      const shuffledRest = bankUnits
        .filter((u) => !weakUnits.includes(u))
        .sort(() => Math.random() - 0.5)
      const ordered = [...weakUnits, ...shuffledRest]

      const unitTarget = (u: UnitId) => {
        const cs = Object.values(proficiency).filter((c) => c.unitId === u)
        const ability = cs.length ? cs.reduce((s, c) => s + conceptAbility(c), 0) / cs.length : conceptAbility(undefined)
        return clamp(Math.round(targetDifficulty(ability)), 1, 5)
      }

      const built: Topic[] = []
      for (let i = 0; i < TOPIC_COUNT; i++) {
        const u = ordered[i % ordered.length] ?? bankUnits[0]
        const difficulty = clamp(unitTarget(u) + i, 1, 5)
        const q = pick(u, null, difficulty)
        if (!q) continue
        let oe = q.correctValue != null && ((!oeShownRef.current && i >= 1) || Math.random() < 0.25)
        if (oe) oeShownRef.current = true
        built.push({ question: q, review: false, openEnded: oe })
      }

      // Spaced repetition: re-serve a mastered unit+difficulty with a fresh question.
      const masteredKeys = Object.keys(progress.masteredUnitDiff ?? {}).filter(
        (k) => (progress.masteredUnitDiff ?? {})[k],
      )
      if (masteredKeys.length > 0 && built.length > 0) {
        const key = masteredKeys[Math.floor(Math.random() * masteredKeys.length)]
        const [u, d] = key.split(':')
        const rq = pick(u as UnitId, null, clamp(parseInt(d, 10) || 2, 1, 5))
        if (rq) {
          const at = 1 + Math.floor(Math.random() * built.length)
          built.splice(at, 0, { question: rq, review: true, openEnded: false })
        }
      }

      setTopics(built)
      setPhase('lesson')
    })()
  }, [proficiency, progress.masteredUnitDiff, pick])

  const finish = useCallback(() => {
    if (settled.current) return
    settled.current = true
    unlockMatch()
    setPerfectStreak(streak + 1)
    if (firstRun) markFirstFarmDone()
    sfxCash(); sfxStreakUp()
    setPhase('reward')
  }, [unlockMatch, setPerfectStreak, streak, firstRun, markFirstFarmDone])

  const record = useCallback((q: BankQuestion, isCorrect: boolean, timeMs: number, review: boolean) => {
    recordAttempt({ conceptTag: q.conceptTag, unitId: q.unitId, isCorrect, timeMs, source: review ? 'review' : 'lesson' })
  }, [recordAttempt])

  const onResolve = useCallback((ok: boolean) => {
    const topic = topics[topicIdx]
    if (!topic) return
    if (ok) {
      if (!topic.review) markUnitDiffMastered(topic.question.unitId, topic.question.difficulty)
      const nextCombo = combo + 1
      setCombo(nextCombo)
      if (nextCombo % 2 === 0 || Math.random() < 0.3) { setBurst((b) => b + 1); sfxCash() }
      if (nextCombo >= 2 && nextCombo % 2 === 0) sfxStreakUp()
      setCleared((c) => c + 1)
      if (topicIdx + 1 >= topics.length) { finish(); return }
      setTopicIdx((i) => i + 1); setReteach(0); setPhase('lesson')
    } else {
      setCombo(0)
      if (topic.review) setPhase('bust')
      else { setReteach((r) => r + 1); setPhase('reteach') }
    }
  }, [topics, topicIdx, combo, markUnitDiffMastered, finish])

  const total = topics.length || TOPIC_COUNT
  const topic = topics[topicIdx]

  if (phase === 'intro') {
    return (
      <div className="qtest-wrap">
        <div className="card qtest farm">
          <button className="btn btn--ghost btn--sm qtest__exit" onClick={onExit}>← Back</button>
          <span className="eyebrow">Training · earn your match</span>
          <h1 className="qtest__h1">{firstRun ? 'Your first training session' : 'Training session'}</h1>
          <div className="farm__streak">
            <div className="farm__streak-stat"><span>How it works</span><strong>📚 Learn → ⚽ Play</strong></div>
          </div>
          <p className="qtest__lede">
            A short interactive lesson, then a problem on exactly that idea. Get it right to move on; miss it and you'll re-learn it, then try again. Clear them all to unlock your match.
          </p>
          <div className="qtest__foot qtest__foot--end">
            <button className="btn btn--primary" onClick={() => { sfxTick(); start() }}>Start training →</button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'loading' || !topic) {
    if (phase !== 'loading') {
      return (
        <div className="qtest-wrap"><div className="card qtest qtest--center"><p className="muted">No questions available.</p>
          <button className="btn btn--primary" onClick={onExit}>Back</button></div></div>
      )
    }
    return (
      <div className="qtest-wrap">
        <div className="card qtest qtest--center">
          <div className="qtest__spinner" aria-hidden />
          <p className="muted">Building your session…</p>
        </div>
      </div>
    )
  }

  if ((phase === 'lesson' || phase === 'reteach') && !topic.review) {
    const lesson = lessonFromQuestion(topic.question)
    return (
      <MiniLesson
        key={`${topic.question.id}-${topicIdx}-${reteach}`}
        def={lesson}
        difficulty={topic.question.difficulty}
        reteach={phase === 'reteach' ? reteach : 0}
        onDone={() => setPhase('question')}
      />
    )
  }

  if (phase === 'question') {
    const q = topic.question
    const pct = Math.round((cleared / total) * 100)
    const hud = (
      <div className="lf-hud">
        <div className={`lf-momentum${pct >= 70 ? ' is-hot' : ''}`}>
          <div className="lf-momentum__pips">
            {Array.from({ length: total }).map((_, i) => (
              <span key={i} className={`lf-pip${i < cleared ? ' is-on' : ''}`} />
            ))}
          </div>
          <span className="lf-momentum__txt">{cleared}/{total} cleared · all of them unlock your match ⚽</span>
        </div>
        {combo >= 2 && <span className="lf-combo" data-heat={Math.min(4, combo)}>🔥 {combo} in a row</span>}
      </div>
    )
    const kicker = topic.review
      ? `Review · ${pretty(q.unitId)} — you've mastered this, don't slip`
      : `${pretty(q.conceptTag)} · ${topic.openEnded ? 'type your answer' : 'pick one'}`
    return (
      <QuestionCard
        key={`${q.id}-${topicIdx}-${reteach}`}
        hud={hud}
        kicker={kicker}
        review={topic.review}
        openEnded={topic.openEnded}
        question={q}
        burst={burst}
        showCalc={showCalc}
        onToggleCalc={() => setShowCalc((v) => !v)}
        record={(qq, ok, ms) => record(qq, ok, ms, topic.review)}
        onResolve={onResolve}
      />
    )
  }

  if (phase === 'bust') {
    return (
      <div className="qtest-wrap">
        <div className="card qtest farm-result farm-result--bust">
          <span className="eyebrow eyebrow--fail">Review failed</span>
          <h1 className="qtest__h1">No match this time</h1>
          <p className="qtest__lede">
            That was a concept you'd already mastered, and it slipped. Mastery has to stay earned, so there's no match this session. Run another training to win it back.
          </p>
          <div className="qtest__foot qtest__foot--end lf-actions">
            <button className="btn btn--ghost" onClick={onExit}>Back to dashboard</button>
            <button className="btn btn--primary" onClick={() => { sfxTick(); start() }}>Train again →</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="qtest-wrap">
      <div className="card qtest farm-result farm-result--win">
        <CoinBurst count={24} spread={260} />
        <span className="eyebrow">Session cleared · match unlocked</span>
        <h1 className="qtest__h1">⚽ You earned a match</h1>
        <p className="qtest__lede">
          You learned and proved every concept in the set. Your mastery streak is now <strong>{streak + 1}</strong>. Go play your reward.
        </p>
        <div className="qtest__foot qtest__foot--end lf-actions">
          <button className="btn btn--ghost" onClick={onExit}>Back to dashboard</button>
          {onRewardMatch
            ? <button className="btn btn--primary" onClick={() => { sfxTick(); onRewardMatch() }}>Play your match ⚽</button>
            : <button className="btn btn--primary" onClick={() => { setPhase('intro') }}>Another session →</button>}
        </div>
      </div>
    </div>
  )
}

function QuestionCard({
  hud, kicker, review, openEnded, question, burst, showCalc, onToggleCalc, record, onResolve,
}: {
  hud: React.ReactNode
  kicker: string
  review: boolean
  openEnded: boolean
  question: BankQuestion
  burst: number
  showCalc: boolean
  onToggleCalc: () => void
  record: (q: BankQuestion, ok: boolean, timeMs: number) => void
  onResolve: (correct: boolean) => void
}) {
  const [pick, setPick] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [locked, setLocked] = useState(false)
  const enter = useRef<number>(performance.now())
  useEffect(() => { enter.current = performance.now(); setPick(null); setTyped(''); setLocked(false) }, [question.id])

  const cv = question.correctValue
  const tol = cv != null ? Math.max(0.15, Math.abs(cv) * 0.03) : 0
  const numeric = parseFloat(typed)
  const isCorrect = openEnded
    ? cv != null && Number.isFinite(numeric) && Math.abs(numeric - cv) <= tol
    : pick === question.correctChoiceId
  const canCheck = openEnded ? typed.trim() !== '' && Number.isFinite(numeric) : pick != null

  const lock = () => {
    if (locked || !canCheck) return
    setLocked(true)
    record(question, isCorrect, Math.max(0, Math.round(performance.now() - enter.current)))
    if (isCorrect) sfxCoin(); else sfxSoftFail()
  }

  const wrongLabel = review ? '✗ That breaks the streak' : '✗ Not quite'
  const wrongTail = review ? ' No match this session — train again.' : ' Back to the lesson, then this problem again.'

  return (
    <div className="qtest-wrap">
      <div className={`card qtest farm-quiz${review ? ' farm-quiz--review' : ''}`}>
        {hud}
        {burst > 0 && <CoinBurst key={burst} count={14} spread={180} />}
        <div className="farm-quiz__top">
          <span className="eyebrow">{review ? '↻ ' : ''}{kicker}</span>
          <button type="button" className="soccer__calc-toggle qtest__calc-toggle" onClick={onToggleCalc}>🧮 {showCalc ? 'Hide' : 'Calc'}</button>
        </div>
        {showCalc && <Calculator floating onClose={onToggleCalc} />}

        <p className="qtest__prompt">{question.prompt}</p>
        {question.diagram && <div className="qtest__figure"><QuestionDiagram diagram={question.diagram} /></div>}
        {openEnded && question.formulas && question.formulas.length > 0 && (
          <div className="qtest__formulas"><span className="qtest__formulas-label">Use</span>{question.formulas.map((f) => <code key={f}>{f}</code>)}</div>
        )}

        {openEnded ? (
          <div className="lf-open">
            <input className="lf-open__input" type="number" inputMode="decimal" placeholder="Type your answer"
              value={typed} disabled={locked} onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !locked) lock() }} />
          </div>
        ) : (
          <div className="quiz-opts">
            {question.choices.map((c, i) => {
              const right = c.id === question.correctChoiceId
              const chosen = c.id === pick
              const cls = locked
                ? right ? 'quiz-opt is-correct' : chosen ? 'quiz-opt is-wrong' : 'quiz-opt'
                : `quiz-opt ${chosen ? 'is-sel' : ''}`
              return (
                <button key={c.id} className={cls} disabled={locked} onClick={() => { sfxTick(); setPick(c.id) }}>
                  <span className="qtest__key">{LETTERS[i]}</span><span>{c.label}</span>
                </button>
              )
            })}
          </div>
        )}

        {locked && (
          <div className={`lf-feedback ${isCorrect ? 'is-correct' : 'is-wrong'}`}>
            <strong>{isCorrect ? '✓ Right' : wrongLabel}</strong>
            <span>
              {!isCorrect && openEnded && cv != null ? `The answer was ${cv}. ` : ''}
              {question.explanation || (isCorrect ? 'Nicely reasoned.' : 'Here is the idea.')}
              {!isCorrect ? wrongTail : ''}
            </span>
          </div>
        )}

        <div className="qtest__foot qtest__foot--end">
          {!locked
            ? <button className="btn btn--primary" disabled={!canCheck} onClick={lock}>Check →</button>
            : <button className="btn btn--primary" onClick={() => onResolve(isCorrect)}>
                {isCorrect ? 'Continue →' : review ? 'See result →' : 'Re-learn it →'}
              </button>}
        </div>
      </div>
    </div>
  )
}

export default LearningFarm
