import { useState } from 'react'
import { Calculator } from './sims/Calculator'

// Final quiz for the Energy unit (headers). Same shape as the kinematics quiz
// (start tab, 8 question tabs, results tab) and reuses the kin-*/quiz-* styles,
// with small leap/height diagrams instead of trajectory animations.

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

// ---- tiny leap stage: a player springs off the turf at take-off speed v and
// rises to height h to meet the ball. `hFrac` (0..1) scales how high. ----
function LeapStage({ hFrac = 0.6, vLabel, hLabel, energy, note }: { hFrac?: number; vLabel?: string; hLabel?: string; energy?: boolean; note?: string }) {
  const VW = 300, VH = 200
  const groundY = 170, topY = groundY - (30 + hFrac * 110)
  const px = 120
  return (
    <div className="kin-stage kin-stage--tool">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="kin-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="eq-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="#34e07f" />
          </marker>
        </defs>
        <line x1="16" y1={groundY} x2={VW - 16} y2={groundY} stroke="rgba(255,255,255,0.25)" />
        {/* height bracket */}
        <line x1={px - 60} y1={groundY} x2={px - 60} y2={topY} stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeDasharray="4 4" />
        {hLabel && <text x={px - 66} y={(groundY + topY) / 2} fill="rgba(255,255,255,0.85)" fontSize="13" textAnchor="end" fontWeight="800">{hLabel}</text>}
        {/* take-off velocity arrow */}
        <line x1={px} y1={groundY - 6} x2={px} y2={groundY - 52} stroke="#34e07f" strokeWidth="6" strokeLinecap="round" markerEnd="url(#eq-arrow)" />
        {vLabel && <text x={px + 10} y={groundY - 40} fill="#34e07f" fontSize="13" textAnchor="start" fontWeight="800">{vLabel}</text>}
        {/* player head at the apex of the leap */}
        <circle cx={px} cy={topY} r={12} fill="#f1c9a5" stroke="#caa078" strokeWidth="2" />
        {/* the ball just above the head */}
        <circle cx={px} cy={topY - 22} r={11} fill="#f1f4f8" stroke="#b9c2cc" strokeWidth="2" />
        <circle cx={px - 3} cy={topY - 24} r={2.4} fill="#1b1f2a" />
        {energy && (
          <>
            <text x={px + 70} y={groundY - 8} fill="#34e07f" fontSize="12" textAnchor="middle" fontWeight="800">½mv²</text>
            <text x={px + 70} y={topY + 26} fill="#ffd166" fontSize="12" textAnchor="middle" fontWeight="800">mgh</text>
            <text x={px + 70} y={(groundY + topY) / 2 + 6} fill="rgba(255,255,255,0.7)" fontSize="14" textAnchor="middle">→</text>
          </>
        )}
        {note && <text x={VW / 2} y={VH - 8} fill="rgba(255,255,255,0.75)" fontSize="10" textAnchor="middle">{note}</text>}
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
    prompt: 'The kinetic energy of the moving ball is given by…',
    options: [
      { id: 'a', label: 'KE = ½mv²' },
      { id: 'b', label: 'KE = mgh' },
      { id: 'c', label: 'KE = mv' },
      { id: 'd', label: 'KE = ½mv' },
    ],
    correct: 'a',
    explain: 'Kinetic energy is KE = ½mv² — it grows with the square of the speed. (mgh is gravitational potential energy.)',
    stage: <LeapStage hFrac={0.5} vLabel="v" energy note="KE = ½mv²" />,
  },
  {
    tag: 'Question 2',
    prompt: <>You head the <b>0.43 kg</b> ball away at <b>v = 10 m/s</b>. Its kinetic energy is? <span className="quiz-given">(KE = ½mv²)</span></>,
    options: [
      { id: 'a', label: '21.5 J' },
      { id: 'b', label: '43 J' },
      { id: 'c', label: '4.3 J' },
      { id: 'd', label: '2.15 J' },
    ],
    correct: 'a',
    explain: 'KE = ½·m·v² = ½·0.43·10² = ½·0.43·100 = 21.5 J.',
    formulas: ['KE = ½mv²', 'KE = ½·0.43·10²'],
    stage: <LeapStage hFrac={0.55} vLabel="10 m/s" energy note="KE = ?" />,
  },
  {
    tag: 'Question 3',
    prompt: <>A near-post flick needs you up to <b>h = 0.8 m</b>. From mgh = ½mv², the take-off speed is? <span className="quiz-given">(v = √(2gh), g = 10)</span></>,
    options: [
      { id: 'a', label: '4 m/s' },
      { id: 'b', label: '16 m/s' },
      { id: 'c', label: '8 m/s' },
      { id: 'd', label: '1.3 m/s' },
    ],
    correct: 'a',
    explain: 'Set mgh = ½mv²; mass cancels, so v = √(2gh) = √(2·10·0.8) = √16 = 4 m/s.',
    formulas: ['v = √(2gh)', 'v = √(2·10·0.8)'],
    stage: <LeapStage hFrac={0.4} vLabel="v = ?" hLabel="0.8 m" />,
  },
  {
    tag: 'Question 4',
    prompt: 'If you head the ball away twice as fast, its kinetic energy becomes…',
    options: [
      { id: 'a', label: '4 times as large' },
      { id: 'b', label: '2 times as large' },
      { id: 'c', label: 'Unchanged' },
      { id: 'd', label: '8 times as large' },
    ],
    correct: 'a',
    explain: 'KE = ½mv² depends on v², so doubling the speed multiplies the kinetic energy by 2² = 4.',
    stage: <LeapStage hFrac={0.7} vLabel="2v" energy note="KE ∝ v²" />,
  },
  {
    tag: 'Question 5',
    prompt: 'Two players spring off the turf at the SAME take-off speed but have different body mass. Who rises higher?',
    options: [
      { id: 'a', label: 'They reach the same height' },
      { id: 'b', label: 'The heavier player' },
      { id: 'c', label: 'The lighter player' },
      { id: 'd', label: 'Neither one leaves the ground' },
    ],
    correct: 'a',
    explain: 'Mass cancels in mgh = ½mv², leaving h = v²⁄2g. Height depends only on take-off speed, so same v means same h.',
    stage: <LeapStage hFrac={0.6} energy note="same v ⇒ same h" />,
  },
  {
    tag: 'Question 6',
    prompt: 'You head the ball straight up. At the very top of its flight, the ball\u2019s energy is…',
    options: [
      { id: 'a', label: 'All gravitational potential energy; kinetic energy is zero' },
      { id: 'b', label: 'All kinetic energy; potential energy is zero' },
      { id: 'c', label: 'Split half kinetic, half potential' },
      { id: 'd', label: 'Completely gone' },
    ],
    correct: 'a',
    explain: 'At the highest point the ball is momentarily at rest, so KE = 0 and all the mechanical energy has converted to potential energy mgh. Energy is conserved, not lost.',
    stage: <LeapStage hFrac={0.85} hLabel="top" energy note="KE → PE" />,
  },
  {
    tag: 'Question 7',
    prompt: 'You apply the same steady force to the ball, but push it through TWICE the distance. The work you do…',
    options: [
      { id: 'a', label: 'Doubles' },
      { id: 'b', label: 'Stays the same' },
      { id: 'c', label: 'Is cut in half' },
      { id: 'd', label: 'Becomes four times larger' },
    ],
    correct: 'a',
    explain: 'Work done by a constant force is W = F·d. With F fixed, doubling the distance doubles the work — and by the work-energy theorem, the ball gains twice the kinetic energy.',
    stage: <LeapStage hFrac={0.5} hLabel="2d" note="W = F·d" />,
  },
  {
    tag: 'Question 8',
    prompt: 'Two players lift identical balls to the same height, doing the same work — but player A finishes faster. Player A delivers…',
    options: [
      { id: 'a', label: 'More power' },
      { id: 'b', label: 'Less power' },
      { id: 'c', label: 'The same power' },
      { id: 'd', label: 'More total energy' },
    ],
    correct: 'a',
    explain: 'Power is the rate of doing work, P = W ⁄ t. Same work in less time means greater power, even though the total energy transferred is identical.',
    stage: <LeapStage hFrac={0.65} vLabel="faster" hLabel="same h" note="P = W ⁄ t" />,
  },
]

export function EnergyQuiz({ accent, onPrev, canPrev, onNext, lessonId, stepId, onRecord }: Props) {
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
      conceptTags: ['energy-conservation'],
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
                <span className="kin-bubble kin-bubble--a">mgh = ½mv²</span>
                <span className="kin-bubble kin-bubble--b">v = √(2gh)</span>
                <span className="kin-bubble kin-bubble--c">h = v² ⁄ 2g</span>
              </div>
              <div className="quiz-trophy">🏆</div>
              <div className="kin-grass" />
            </div>
          </div>
          <div className="kin__main">
            <span className="kin__tag">Final quiz</span>
            <h2 className="kin__title">Test your header energy</h2>
            <p className="kin__body">Eight quick questions on the energy conservation behind winning a header. Pick an answer and you will see why it works. You need <b>6 out of 8</b> to pass this mastery check.</p>
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
            <p className="kin__body">{pct}% correct. {passed ? 'Quiz passed. This counts as the final energy mastery check.' : 'You need 6 out of 8 to pass. Review the misses, then retry the quiz.'}</p>
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
