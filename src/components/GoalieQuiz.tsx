import { useState } from 'react'
import { Calculator } from './sims/Calculator'

// Final quiz for the Impulse unit (goalkeeping). Same shape as the other unit
// quizzes (start tab, 8 question tabs, results tab) and reuses the kin-*/quiz-*
// styles, with a small save diagram (glove punching a ball) instead of
// trajectory animations.

type Props = {
  accent: string
  onPrev: () => void
  canPrev: boolean
  onNext: () => void
  lessonId: string
  stepId: string
  onRecord: (args: {
    lessonId: string
    stepId: string
    answer: unknown
    isCorrect: boolean
    feedback: string
    isMasteryCheck: boolean
    conceptTags?: string[]
  }) => void
}

// ---- tiny save diagram: a keeper glove applying a force to the incoming ball.
// J = F·Δt = Δp. `fLen` (0..1) scales the force arrow so "more force" reads. ----
function SaveStage({ fLen = 0.6, jLabel, fLabel, tLabel, vLabel, note }: { fLen?: number; jLabel?: string; fLabel?: string; tLabel?: string; vLabel?: string; note?: string }) {
  const VW = 300, VH = 200
  const cy = 104, ballX = 196, gloveX = 96
  const arrowLen = 40 + fLen * 78
  return (
    <div className="kin-stage kin-stage--tool">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="kin-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="gq-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="#f59e0b" />
          </marker>
          <marker id="gq-arrow-v" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="#ffd166" />
          </marker>
        </defs>
        <line x1="16" y1={cy + 60} x2={VW - 16} y2={cy + 60} stroke="rgba(255,255,255,0.25)" />
        {/* incoming ball */}
        <circle cx={ballX} cy={cy} r={13} fill="#f1f4f8" stroke="#b9c2cc" strokeWidth="2" />
        <path d={`M${ballX - 5} ${cy - 6} l6 4 -3 7 -6 -2 z`} fill="#1b2230" opacity="0.55" />
        {/* incoming velocity tick from the right */}
        {vLabel && (
          <>
            <line x1={ballX + 64} y1={cy - 26} x2={ballX + 18} y2={cy - 26} stroke="#ffd166" strokeWidth="4" strokeLinecap="round" markerEnd="url(#gq-arrow-v)" strokeDasharray="6 4" />
            <text x={ballX + 40} y={cy - 34} fill="#ffd166" fontSize="12" textAnchor="middle" fontWeight="800">{vLabel}</text>
          </>
        )}
        {/* keeper glove */}
        <g stroke="#c3cad6" strokeWidth="2">
          <rect x={gloveX - 22} y={cy - 16} width={26} height={32} rx={10} fill="#f4f6fa" />
          <rect x={gloveX - 26} y={cy + 12} width={20} height={10} rx={4} fill="#f59e0b" />
        </g>
        {/* force arrow from glove into the ball */}
        <line x1={gloveX + 8} y1={cy} x2={gloveX + 8 + arrowLen} y2={cy} stroke="#f59e0b" strokeWidth="6" strokeLinecap="round" markerEnd="url(#gq-arrow)" />
        {fLabel && <text x={gloveX + 8 + arrowLen / 2} y={cy - 12} fill="#fbbf24" fontSize="13" textAnchor="middle" fontWeight="800">{fLabel}</text>}
        {tLabel && <text x={gloveX + 8 + arrowLen / 2} y={cy + 20} fill="rgba(255,255,255,0.8)" fontSize="11" textAnchor="middle" fontWeight="700">{tLabel}</text>}
        {jLabel && <text x={VW / 2} y={cy + 48} fill="#fcd34d" fontSize="13" textAnchor="middle" fontWeight="800">{jLabel}</text>}
        {note && <text x={VW / 2} y={VH - 10} fill="rgba(255,255,255,0.75)" fontSize="10" textAnchor="middle">{note}</text>}
      </svg>
    </div>
  )
}

type Q = {
  tag: string
  prompt: React.ReactNode
  options: { id: string; label: string }[]
  correct: string
  explain: string
  formulas?: string[]
  calculator?: boolean
  stage: React.ReactNode
}

const shuffled = <T,>(items: T[]): T[] => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const QUESTIONS: Q[] = [
  {
    tag: 'Question 1',
    prompt: 'The impulse–momentum theorem says the impulse on the ball equals its…',
    options: [
      { id: 'a', label: 'Change in momentum, J = Δp' },
      { id: 'b', label: 'Kinetic energy, ½mv²' },
      { id: 'c', label: 'Power delivered, F·v' },
      { id: 'd', label: 'Acceleration, Δv ⁄ Δt' },
    ],
    correct: 'a',
    explain: 'The impulse–momentum theorem: J = Δp. The impulse you apply to the ball equals its change in momentum.',
    stage: <SaveStage jLabel="J = Δp" note="impulse = Δ momentum" />,
  },
  {
    tag: 'Question 2',
    prompt: 'Impulse is measured in…',
    options: [
      { id: 'a', label: 'N·s (the same as kg·m/s)' },
      { id: 'b', label: 'J (joules)' },
      { id: 'c', label: 'N (newtons)' },
      { id: 'd', label: 'm/s' },
    ],
    correct: 'a',
    explain: 'From J = F·Δt the units are newton-seconds, N·s. Since J = Δp = m·Δv, that is identical to kg·m/s.',
    stage: <SaveStage fLen={0.5} jLabel="N·s = kg·m/s" />,
  },
  {
    tag: 'Question 3',
    prompt: <>A shot (ball <b>m = 0.43 kg</b>) flies in at <b>v = 20 m/s</b>. What impulse holds it dead? <span className="quiz-given">(J = m·v)</span></>,
    options: [
      { id: 'a', label: '8.6 N·s' },
      { id: 'b', label: '20.4 N·s' },
      { id: 'c', label: '46.5 N·s' },
      { id: 'd', label: '86 N·s' },
    ],
    correct: 'a',
    explain: 'J = Δp = m·v = 0.43 × 20 = 8.6 N·s. The impulse equals the momentum you remove.',
    formulas: ['J = m·v', 'J = 0.43·20'],
    stage: <SaveStage fLen={0.7} jLabel="J = ?" vLabel="20 m/s" />,
  },
  {
    tag: 'Question 4',
    prompt: 'You catch a shot but “give” with soft hands, doubling the contact time Δt. For the SAME impulse, the force on your hands is…',
    options: [
      { id: 'a', label: 'Halved' },
      { id: 'b', label: 'Doubled' },
      { id: 'c', label: 'Unchanged' },
      { id: 'd', label: 'Quadrupled' },
    ],
    correct: 'a',
    explain: 'The impulse J = F·Δt is fixed by the shot\u2019s momentum. Doubling Δt halves F — exactly why keepers cushion the ball.',
    stage: <SaveStage fLen={0.35} fLabel="small F" tLabel="long Δt" jLabel="same J" />,
  },
  {
    tag: 'Question 5',
    prompt: 'Two saves deliver the SAME impulse. Save A is a big force for a short time; Save B is a small force for a long time. Which changes the ball’s momentum more?',
    options: [
      { id: 'a', label: 'The same — equal impulse, equal Δp' },
      { id: 'b', label: 'Save A — the bigger force wins' },
      { id: 'c', label: 'Save B — the longer time wins' },
      { id: 'd', label: 'Neither — momentum cannot change' },
    ],
    correct: 'a',
    explain: 'J = F·Δt = Δp. Equal impulses produce equal momentum changes, whether from big-force/short-time or small-force/long-time.',
    stage: <SaveStage fLen={0.6} jLabel="equal J" note="F·Δt equal" />,
  },
  {
    tag: 'Question 6',
    prompt: 'On a force-versus-time graph of the save, the impulse delivered to the ball equals the…',
    options: [
      { id: 'a', label: 'Area under the force–time curve' },
      { id: 'b', label: 'Slope of the curve' },
      { id: 'c', label: 'Highest point (peak force)' },
      { id: 'd', label: 'Length of the time axis' },
    ],
    correct: 'a',
    explain: 'Impulse is force accumulated over time — the area under the force–time graph (which is just F·Δt for a constant force).',
    stage: <SaveStage fLen={0.7} fLabel="F" tLabel="Δt" jLabel="J = area" />,
  },
  {
    tag: 'Question 7',
    prompt: 'A striker hits an identical 0.43 kg ball at DOUBLE the speed. The impulse you need to stop it is…',
    options: [
      { id: 'a', label: 'Doubled' },
      { id: 'b', label: 'The same' },
      { id: 'c', label: 'Halved' },
      { id: 'd', label: 'Quadrupled' },
    ],
    correct: 'a',
    explain: 'J = m·v with m fixed, so impulse is proportional to speed: twice the speed means twice the momentum to remove.',
    stage: <SaveStage fLen={0.95} jLabel="2J" vLabel="2v" note="double v ⇒ double impulse" />,
  },
  {
    tag: 'Question 8',
    prompt: <>A <b>0.43 kg</b> shot at <b>v = 20 m/s</b> is parried to rest in <b>Δt = 0.1 s</b>. The force on your gloves is? <span className="quiz-given">(F = m·v ⁄ Δt)</span></>,
    options: [
      { id: 'a', label: '86 N' },
      { id: 'b', label: '8.6 N' },
      { id: 'c', label: '860 N' },
      { id: 'd', label: '43 N' },
    ],
    correct: 'a',
    explain: 'First the impulse J = m·v = 0.43 × 20 = 8.6 N·s, then F = J ⁄ Δt = 8.6 ⁄ 0.1 = 86 N.',
    formulas: ['F = m·v ⁄ Δt', 'F = 0.43·20 ⁄ 0.1'],
    stage: <SaveStage fLen={0.75} fLabel="F = ?" tLabel="0.1 s" vLabel="20 m/s" />,
  },
]

export function GoalieQuiz({ accent, onPrev, canPrev, onNext, lessonId, stepId, onRecord }: Props) {
  const [tab, setTab] = useState(0)
  const [picked, setPicked] = useState<(string | null)[]>(Array(QUESTIONS.length).fill(null))
  const [optionOrders, setOptionOrders] = useState(() => QUESTIONS.map((q) => shuffled(q.options)))
  const [showCalc, setShowCalc] = useState(false)
  const [recordedKey, setRecordedKey] = useState('')
  const last = QUESTIONS.length + 1

  const score = picked.filter((p, i) => p === QUESTIONS[i].correct).length
  const passed = score >= 6

  const back = () => { if (tab === 0) onPrev(); else setTab((t) => t - 1) }
  const retry = () => {
    setPicked(Array(QUESTIONS.length).fill(null))
    setOptionOrders(QUESTIONS.map((q) => shuffled(q.options)))
    setRecordedKey('')
    setShowCalc(false)
    setTab(0)
  }
  const recordQuizAttempt = () => {
    const key = picked.join('|')
    if (recordedKey === key) return
    setRecordedKey(key)
    onRecord({
      lessonId,
      stepId,
      answer: { score, total: QUESTIONS.length, choices: picked },
      isCorrect: passed,
      feedback: passed ? `Passed the quiz with ${score}/8.` : `Quiz score ${score}/8. Passing requires 6/8.`,
      isMasteryCheck: true,
      conceptTags: ['impulse-momentum'],
    })
  }
  const next = () => {
    if (tab === QUESTIONS.length) {
      recordQuizAttempt()
      setTab((t) => t + 1)
      return
    }
    if (tab >= last) {
      if (passed) onNext()
      else retry()
      return
    }
    setShowCalc(false)
    setTab((t) => t + 1)
  }

  const pick = (qi: number, id: string) => {
    setPicked((prev) => { if (prev[qi] != null) return prev; const c = [...prev]; c[qi] = id; return c })
  }

  const style = { '--unit-accent': accent } as React.CSSProperties

  if (tab === 0) {
    return (
      <div className="card step kin kin--full" style={style}>
        <div className="kin__grid">
          <div className="kin__visual">
            <div className="kin-stage kin-stage--intro">
              <div className="kin-bubbles">
                <span className="kin-bubble kin-bubble--a">J = Δp</span>
                <span className="kin-bubble kin-bubble--b">J = F·Δt</span>
                <span className="kin-bubble kin-bubble--c">N·s</span>
              </div>
              <div className="quiz-trophy">🏆</div>
              <div className="kin-grass" />
            </div>
          </div>
          <div className="kin__main">
            <span className="kin__tag">Final quiz</span>
            <h2 className="kin__title">Test your goalkeeping</h2>
            <p className="kin__body">Eight quick questions on the impulse J = Δp = F·Δt behind every save. Pick an answer and you will see why it works. You need <b>6 out of 8</b> to pass this mastery check.</p>
            <div className="kin__formulas">
              <div className="kin__formula"><span className="kin__formula-label">questions</span><code className="kin__formula-expr">8 total</code></div>
              <div className="kin__formula"><span className="kin__formula-label">format</span><code className="kin__formula-expr">multiple choice</code></div>
            </div>
          </div>
        </div>
        <Foot tab={tab} count={QUESTIONS.length} onBack={back} onNext={next} canBack={canPrev} nextLabel="Start quiz →" />
      </div>
    )
  }

  if (tab > QUESTIONS.length) {
    const pct = Math.round((score / QUESTIONS.length) * 100)
    const cheer = score === QUESTIONS.length ? 'Perfect score!' : passed ? 'Great work!' : 'Try again'
    return (
      <div className="card step kin kin--full" style={style}>
        <div className="kin__grid">
          <div className="kin__visual">
            <div className="kin-stage kin-stage--recap">
              <div className="quiz-trophy quiz-trophy--big">{score >= 6 ? '🏆' : '🧤'}</div>
              <div className="kin-whistle">{cheer}</div>
              <div className="kin-grass" />
            </div>
          </div>
          <div className="kin__main">
            <span className="kin__tag">Results</span>
            <h2 className="kin__title">You scored {score} / {QUESTIONS.length}</h2>
            <p className="kin__body">{pct}% correct. {passed ? 'Quiz passed. This counts as the final impulse mastery check.' : 'You need 6 out of 8 to pass. Review the misses, then retry the quiz.'}</p>
            <div className="quiz-scorebar"><span className="quiz-scorebar__fill" style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
        <Foot tab={tab} count={QUESTIONS.length} onBack={back} onNext={next} canBack nextLabel={passed ? 'Finish →' : 'Retry quiz →'} />
      </div>
    )
  }

  const qi = tab - 1
  const q = QUESTIONS[qi]
  const answered = picked[qi] != null
  const wasCorrect = picked[qi] === q.correct
  return (
    <div className="card step kin kin--full" style={style}>
      <div className="kin__grid" key={qi}>
        <div className="kin__visual">{q.stage}</div>
        <div className="kin__main">
          <span className="kin__tag">{q.tag}</span>
          <h2 className="kin__title kin__title--q">{q.prompt}</h2>
          <div className="quiz-tools">
            {q.formulas && (
              <div className="kin__formulas quiz-formulas">
                {q.formulas.map((f) => (
                  <div className="kin__formula" key={f}>
                    <span className="kin__formula-label">formula</span>
                    <code className="kin__formula-expr">{f}</code>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowCalc((open) => !open)}>
              🧮 {showCalc ? 'Hide calculator' : 'Calculator'}
            </button>
          </div>
          <div className="quiz-opts">
            {optionOrders[qi].map((o) => {
              const isPicked = picked[qi] === o.id
              const isAnswer = o.id === q.correct
              const cls = !answered ? '' : isAnswer ? 'is-correct' : isPicked ? 'is-wrong' : 'is-dim'
              return (
                <button key={o.id} className={`quiz-opt ${cls}`} disabled={answered} onClick={() => pick(qi, o.id)}>
                  <span className="quiz-opt__dot" />
                  <span>{o.label}</span>
                  {answered && isAnswer && <span className="quiz-opt__mark">✓</span>}
                  {answered && isPicked && !isAnswer && <span className="quiz-opt__mark">✕</span>}
                </button>
              )
            })}
          </div>
          {answered && (
            <div className={`quiz-explain ${wasCorrect ? 'is-good' : 'is-bad'}`}>
              <b>{wasCorrect ? 'Correct! ' : 'Not quite. '}</b>{q.explain}
            </div>
          )}
          {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
        </div>
      </div>
      <Foot tab={tab} count={QUESTIONS.length} onBack={back} onNext={next} canBack nextLabel={qi === QUESTIONS.length - 1 ? 'See results →' : 'Next'} />
    </div>
  )
}

function Foot({ tab, count, onBack, onNext, canBack, nextLabel }: {
  tab: number; count: number; onBack: () => void; onNext: () => void; canBack: boolean; nextLabel: string
}) {
  return (
    <div className="kin__foot">
      <div className="kin__dots">
        {Array.from({ length: count + 2 }).map((_, k) => (
          <span key={k} className={`kin__dot ${k === tab ? 'is-current' : ''} ${k < tab ? 'is-done' : ''}`} />
        ))}
      </div>
      <div className="kin__nav">
        <button className="btn btn--ghost" onClick={onBack} disabled={tab === 0 && !canBack}>Back</button>
        <button className="btn btn--primary" onClick={onNext}>{nextLabel}</button>
      </div>
    </div>
  )
}
