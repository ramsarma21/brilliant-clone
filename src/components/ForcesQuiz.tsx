import { useState } from 'react'
import { Calculator } from './sims/Calculator'

// Final quiz for the Forces unit (dribbling). Same shape as the kinematics quiz
// (start tab, 8 question tabs, results tab) and reuses the kin-*/quiz-* styles,
// with small force/acceleration diagrams instead of trajectory animations.

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

// ---- tiny force diagram stage: the ball with a foot-force arrow (and the
// acceleration it produces). `fLen` (0..1) scales the push so "more force" reads. ----
function KickStage({ fLen = 0.6, fLabel, aLabel, mLabel, note }: { fLen?: number; fLabel?: string; aLabel?: string; mLabel?: string; note?: string }) {
  const VW = 300, VH = 200
  const cy = 120, ballX = 150, r = 22
  const arrowLen = 40 + fLen * 80
  return (
    <div className="kin-stage kin-stage--tool">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="kin-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="fq-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="#ff5b6e" />
          </marker>
          <marker id="fq-arrow-a" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="#ffd166" />
          </marker>
        </defs>
        <line x1="16" y1={cy + r + 6} x2={VW - 16} y2={cy + r + 6} stroke="rgba(255,255,255,0.25)" />
        {/* ball */}
        <circle cx={ballX} cy={cy} r={r} fill="#f1f4f8" stroke="#b9c2cc" strokeWidth="2" />
        <circle cx={ballX - 6} cy={cy - 6} r={4} fill="#1b1f2a" />
        <circle cx={ballX + 7} cy={cy + 4} r={3} fill="#1b1f2a" />
        {mLabel && <text x={ballX} y={cy + r + 22} fill="rgba(255,255,255,0.8)" fontSize="11" textAnchor="middle" fontWeight="700">{mLabel}</text>}
        {/* force arrow into the ball from the left */}
        <line x1={ballX - r - arrowLen} y1={cy} x2={ballX - r - 4} y2={cy} stroke="#ff5b6e" strokeWidth="6" strokeLinecap="round" markerEnd="url(#fq-arrow)" />
        {fLabel && <text x={ballX - r - arrowLen / 2} y={cy - 12} fill="#ff5b6e" fontSize="13" textAnchor="middle" fontWeight="800">{fLabel}</text>}
        {/* acceleration arrow out of the ball to the right */}
        {aLabel && (
          <>
            <line x1={ballX + r + 4} y1={cy} x2={ballX + r + 56} y2={cy} stroke="#ffd166" strokeWidth="5" strokeLinecap="round" markerEnd="url(#fq-arrow-a)" strokeDasharray="6 4" />
            <text x={ballX + r + 30} y={cy - 12} fill="#ffd166" fontSize="13" textAnchor="middle" fontWeight="800">{aLabel}</text>
          </>
        )}
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
    prompt: 'Newton\u2019s second law relates the net force on the ball to its acceleration. It says…',
    options: [
      { id: 'a', label: 'F_net = m·a' },
      { id: 'b', label: 'F_net = m ⁄ a' },
      { id: 'c', label: 'F_net = a ⁄ m' },
      { id: 'd', label: 'F_net = m + a' },
    ],
    correct: 'a',
    explain: 'The net force equals mass times acceleration: F_net = m·a. The acceleration always points in the direction of the net force.',
    stage: <KickStage fLabel="F" aLabel="a" mLabel="m" note="F_net = m·a" />,
  },
  {
    tag: 'Question 2',
    prompt: <>A through-pass drives a net force of <b>F = 86 N</b> into the <b>0.43 kg</b> ball. Its acceleration is? <span className="quiz-given">(a = F ⁄ m)</span></>,
    options: [
      { id: 'a', label: '200 m/s²' },
      { id: 'b', label: '86 m/s²' },
      { id: 'c', label: '37 m/s²' },
      { id: 'd', label: '20 m/s²' },
    ],
    correct: 'a',
    explain: 'Rearrange F = m·a: a = F ⁄ m = 86 ⁄ 0.43 = 200 m/s².',
    formulas: ['a = F ⁄ m', 'a = 86 ⁄ 0.43'],
    stage: <KickStage fLen={0.9} fLabel="86 N" aLabel="a = ?" mLabel="0.43 kg" />,
  },
  {
    tag: 'Question 3',
    prompt: <>An in-and-out touch accelerates the <b>0.43 kg</b> ball at <b>a = 150 m/s²</b>. The net force is? <span className="quiz-given">(F = m·a)</span></>,
    options: [
      { id: 'a', label: '64.5 N' },
      { id: 'b', label: '150 N' },
      { id: 'c', label: '349 N' },
      { id: 'd', label: '6.45 N' },
    ],
    correct: 'a',
    explain: 'F = m·a = 0.43 × 150 = 64.5 N. Multiply the fixed mass by the acceleration.',
    formulas: ['F = m·a', 'F = 0.43·150'],
    stage: <KickStage fLen={0.85} fLabel="F = ?" aLabel="150 m/s²" mLabel="0.43 kg" />,
  },
  {
    tag: 'Question 4',
    prompt: 'You kick the ball and your foot pushes it forward with 40 N. By Newton\u2019s third law, at that same instant the ball…',
    options: [
      { id: 'a', label: 'Pushes back on your foot with 40 N' },
      { id: 'b', label: 'Pushes back on your foot with less than 40 N because it is light' },
      { id: 'c', label: 'Pushes forward on your foot with 40 N' },
      { id: 'd', label: 'Exerts no force on your foot at all' },
    ],
    correct: 'a',
    explain: 'Third-law pairs are equal in size and opposite in direction, and they act on DIFFERENT objects: the foot pushes the ball forward, the ball pushes the foot back, both 40 N.',
    stage: <KickStage fLen={0.7} fLabel="foot 40 N" aLabel="ball 40 N" note="equal & opposite" />,
  },
  {
    tag: 'Question 5',
    prompt: 'A ball rolls across smooth, level turf at a constant velocity (ignore friction). The net force on it is…',
    options: [
      { id: 'a', label: 'Zero — the forces are balanced' },
      { id: 'b', label: 'A steady forward force keeping it moving' },
      { id: 'c', label: 'A force that grows as it travels' },
      { id: 'd', label: 'Equal to its weight, pointing forward' },
    ],
    correct: 'a',
    explain: 'Constant velocity means zero acceleration, so F_net = m·a = 0. A moving object needs NO net force to keep moving — that is Newton\u2019s first law.',
    stage: <KickStage fLen={0.3} fLabel="balanced" note="constant v ⇒ F_net = 0" />,
  },
  {
    tag: 'Question 6',
    prompt: 'Two players strike the same ball at once: one pushes it right with 30 N, the other pushes it left with 18 N. The ball…',
    options: [
      { id: 'a', label: 'Accelerates to the right (net 12 N right)' },
      { id: 'b', label: 'Accelerates to the left (net 12 N left)' },
      { id: 'c', label: 'Stays still — the forces cancel' },
      { id: 'd', label: 'Accelerates with the full 48 N' },
    ],
    correct: 'a',
    explain: 'Add the forces as a free body: 30 N right − 18 N left = 12 N net to the right, so the acceleration points right.',
    stage: <KickStage fLen={0.6} fLabel="net 12 N →" aLabel="a →" />,
  },
  {
    tag: 'Question 7',
    prompt: 'You push the SAME 0.43 kg ball three ways — A: 10 N, B: 20 N, C: 30 N. Rank the accelerations from largest to smallest.',
    options: [
      { id: 'a', label: 'C > B > A' },
      { id: 'b', label: 'A > B > C' },
      { id: 'c', label: 'A = B = C' },
      { id: 'd', label: 'B > C > A' },
    ],
    correct: 'a',
    explain: 'With mass fixed, a = F ⁄ m is directly proportional to force, so the biggest force (C, 30 N) gives the biggest acceleration: C > B > A.',
    stage: <KickStage fLen={0.95} fLabel="bigger F" aLabel="bigger a" note="a ∝ F" />,
  },
  {
    tag: 'Question 8',
    prompt: 'You carry the same soccer ball from Earth to the Moon, where gravity is weaker. The ball\u2019s MASS…',
    options: [
      { id: 'a', label: 'Stays 0.43 kg, but its weight is less' },
      { id: 'b', label: 'Becomes smaller, like its weight' },
      { id: 'c', label: 'Becomes larger to balance gravity' },
      { id: 'd', label: 'Drops to zero in low gravity' },
    ],
    correct: 'a',
    explain: 'Mass is the amount of matter and never changes: m = 0.43 kg everywhere. Weight is the gravitational force mg, so it shrinks on the Moon where g is smaller.',
    stage: <KickStage fLen={0.4} mLabel="m = 0.43 kg" note="mass ≠ weight" />,
  },
]

export function ForcesQuiz({ accent, onPrev, canPrev, onNext, lessonId, stepId, onRecord }: Props) {
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
      conceptTags: ['force-net-force'],
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
                <span className="kin-bubble kin-bubble--a">F = m·a</span>
                <span className="kin-bubble kin-bubble--b">a = F ⁄ m</span>
                <span className="kin-bubble kin-bubble--c">m = 0.43 kg</span>
              </div>
              <div className="quiz-trophy">🏆</div>
              <div className="kin-grass" />
            </div>
          </div>
          <div className="kin__main">
            <span className="kin__tag">Final quiz</span>
            <h2 className="kin__title">Test your dribbling forces</h2>
            <p className="kin__body">Eight quick questions on Newton’s second law behind every move. Pick an answer and you will see why it works. You need <b>6 out of 8</b> to pass this mastery check.</p>
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
              <div className="quiz-trophy quiz-trophy--big">{score >= 6 ? '🏆' : '⚽'}</div>
              <div className="kin-whistle">{cheer}</div>
              <div className="kin-grass" />
            </div>
          </div>
          <div className="kin__main">
            <span className="kin__tag">Results</span>
            <h2 className="kin__title">You scored {score} / {QUESTIONS.length}</h2>
            <p className="kin__body">{pct}% correct. {passed ? 'Quiz passed. This counts as the final forces mastery check.' : 'You need 6 out of 8 to pass. Review the misses, then retry the quiz.'}</p>
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
