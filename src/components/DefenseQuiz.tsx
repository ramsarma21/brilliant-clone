import { useState } from 'react'
import { Calculator } from './sims/Calculator'

// Final quiz for the Momentum unit (defending). Same shape as the other unit
// quizzes (start tab, 8 question tabs, results tab) and reuses the kin-*/quiz-*
// styles, with a small momentum diagram instead of trajectory animations.

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

// ---- tiny momentum diagram: an attacker driving in with a momentum arrow
// p = m·v. `pLen` (0..1) scales the arrow so "more momentum" reads. ----
function ChargeStage({ pLen = 0.6, pLabel, vLabel, mLabel, note }: { pLen?: number; pLabel?: string; vLabel?: string; mLabel?: string; note?: string }) {
  const VW = 300, VH = 200
  const cy = 116, manX = 120
  const arrowLen = 46 + pLen * 86
  return (
    <div className="kin-stage kin-stage--tool">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="kin-svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="dq-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="#a855f7" />
          </marker>
          <marker id="dq-arrow-v" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="#ffd166" />
          </marker>
        </defs>
        <line x1="16" y1={cy + 40} x2={VW - 16} y2={cy + 40} stroke="rgba(255,255,255,0.25)" />
        {/* attacker figure */}
        <circle cx={manX} cy={cy - 26} r={10} fill="#fca5a5" stroke="#b91c1c" strokeWidth="2" />
        <rect x={manX - 9} y={cy - 16} width={18} height={30} rx={6} fill="#ef4444" />
        <line x1={manX - 5} y1={cy + 14} x2={manX - 9} y2={cy + 38} stroke="#ef4444" strokeWidth="5" strokeLinecap="round" />
        <line x1={manX + 5} y1={cy + 14} x2={manX + 11} y2={cy + 38} stroke="#ef4444" strokeWidth="5" strokeLinecap="round" />
        {mLabel && <text x={manX} y={cy - 42} fill="rgba(255,255,255,0.85)" fontSize="11" textAnchor="middle" fontWeight="700">{mLabel}</text>}
        {/* ball at his feet */}
        <circle cx={manX + 20} cy={cy + 34} r={6} fill="#f1f4f8" stroke="#b9c2cc" strokeWidth="1.5" />
        {/* momentum arrow driving right */}
        <line x1={manX + 18} y1={cy} x2={manX + 18 + arrowLen} y2={cy} stroke="#a855f7" strokeWidth="6" strokeLinecap="round" markerEnd="url(#dq-arrow)" />
        {pLabel && <text x={manX + 18 + arrowLen / 2} y={cy - 12} fill="#c084fc" fontSize="13" textAnchor="middle" fontWeight="800">{pLabel}</text>}
        {/* small velocity tick above */}
        {vLabel && (
          <>
            <line x1={manX + 18} y1={cy - 30} x2={manX + 18 + arrowLen * 0.7} y2={cy - 30} stroke="#ffd166" strokeWidth="4" strokeLinecap="round" markerEnd="url(#dq-arrow-v)" strokeDasharray="6 4" />
            <text x={manX + 18 + arrowLen * 0.35} y={cy - 38} fill="#ffd166" fontSize="12" textAnchor="middle" fontWeight="800">{vLabel}</text>
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
    prompt: 'Momentum measures how hard a moving attacker is to stop. It is defined as…',
    options: [
      { id: 'a', label: 'p = m·v' },
      { id: 'b', label: 'p = ½m·v²' },
      { id: 'c', label: 'p = m + v' },
      { id: 'd', label: 'p = m ⁄ v' },
    ],
    correct: 'a',
    explain: 'Momentum is mass times velocity: p = m·v. It is a vector — it points the same way the attacker is moving.',
    stage: <ChargeStage pLabel="p" vLabel="v" mLabel="m" note="p = m·v" />,
  },
  {
    tag: 'Question 2',
    prompt: <>A striker of mass <b>75 kg</b> drives at you at <b>v = 4 m/s</b>. His momentum is? <span className="quiz-given">(p = m·v)</span></>,
    options: [
      { id: 'a', label: '300 kg·m/s' },
      { id: 'b', label: '79 kg·m/s' },
      { id: 'c', label: '18.75 kg·m/s' },
      { id: 'd', label: '150 kg·m/s' },
    ],
    correct: 'a',
    explain: 'p = m·v = 75 × 4 = 300 kg·m/s. Just multiply his mass by his speed.',
    formulas: ['p = m·v', 'p = 75·4'],
    stage: <ChargeStage pLen={0.8} pLabel="p = ?" vLabel="4 m/s" mLabel="75 kg" />,
  },
  {
    tag: 'Question 3',
    prompt: 'Three attackers run at you — A: 90 kg at 3 m/s, B: 60 kg at 5 m/s, C: 80 kg at 3 m/s. Rank their momenta from greatest to least.',
    options: [
      { id: 'a', label: 'B > A > C' },
      { id: 'b', label: 'A > B > C' },
      { id: 'c', label: 'C > A > B' },
      { id: 'd', label: 'A > C > B' },
    ],
    correct: 'a',
    explain: 'p = m·v: A = 270, B = 300, C = 240 kg·m/s. So B (300) > A (270) > C (240). The fast, lighter B tops the heavier C.',
    stage: <ChargeStage pLen={0.7} pLabel="rank p" note="A 270, B 300, C 240" />,
  },
  {
    tag: 'Question 4',
    prompt: 'A 50 kg winger sprints at 8 m/s; a 100 kg defender jogs at 4 m/s. Compare their momenta.',
    options: [
      { id: 'a', label: 'Equal — both carry 400 kg·m/s' },
      { id: 'b', label: 'The 100 kg defender has more' },
      { id: 'c', label: 'The 50 kg winger has more' },
      { id: 'd', label: 'You cannot compare different masses' },
    ],
    correct: 'a',
    explain: 'p = m·v: 50×8 = 400 and 100×4 = 400 kg·m/s. A light, fast player can carry the same momentum as a heavy, slow one — speed offsets mass.',
    stage: <ChargeStage pLen={0.75} pLabel="400 kg·m/s" note="50×8 = 100×4 = 400" />,
  },
  {
    tag: 'Question 5',
    prompt: 'Same attacker, but he sprints in at TRIPLE his speed. His momentum p = m·v becomes…',
    options: [
      { id: 'a', label: 'Tripled' },
      { id: 'b', label: 'The same' },
      { id: 'c', label: 'One-third' },
      { id: 'd', label: 'Nine times bigger' },
    ],
    correct: 'a',
    explain: 'With m fixed, p = m·v is directly proportional to v: triple the speed means triple the momentum to stop.',
    stage: <ChargeStage pLen={0.95} pLabel="3p" vLabel="3v" note="triple v ⇒ triple p" />,
  },
  {
    tag: 'Question 6',
    prompt: 'An 80 kg attacker at 5 m/s crashes into a stationary 70 kg defender and they tangle up together. With no outside push, the total momentum just after is…',
    options: [
      { id: 'a', label: '400 kg·m/s — momentum is conserved' },
      { id: 'b', label: '0 — they cancel and stop' },
      { id: 'c', label: '750 kg·m/s — the masses add' },
      { id: 'd', label: '200 kg·m/s — it is halved' },
    ],
    correct: 'a',
    explain: 'No external force, so total momentum is conserved. Before: 80×5 + 70×0 = 400 kg·m/s. After they stick, the pair still carries 400 kg·m/s (just moving slower because the mass is bigger).',
    stage: <ChargeStage pLen={0.7} pLabel="400 kg·m/s" note="inelastic: they stick" />,
  },
  {
    tag: 'Question 7',
    prompt: 'During that tackle, compare the momentum the attacker LOSES with the momentum the defender GAINS.',
    options: [
      { id: 'a', label: 'Equal in size, opposite in direction' },
      { id: 'b', label: 'The attacker loses more than the defender gains' },
      { id: 'c', label: 'The defender gains more than the attacker loses' },
      { id: 'd', label: 'Neither one changes' },
    ],
    correct: 'a',
    explain: 'The collision forces are equal and opposite (Newton\u2019s 3rd law) acting for the same time, so the impulses match. Whatever momentum the attacker loses, the defender gains — total stays constant.',
    stage: <ChargeStage pLen={0.6} pLabel="Δp equal & opposite" note="total p conserved" />,
  },
  {
    tag: 'Question 8',
    prompt: <>A target man of mass <b>90 kg</b> shields it at <b>v = 3 m/s</b>. His momentum is? <span className="quiz-given">(p = m·v)</span></>,
    options: [
      { id: 'a', label: '270 kg·m/s' },
      { id: 'b', label: '93 kg·m/s' },
      { id: 'c', label: '30 kg·m/s' },
      { id: 'd', label: '810 kg·m/s' },
    ],
    correct: 'a',
    explain: 'p = m·v = 90 × 3 = 270 kg·m/s. Heavier than a winger but slower — momentum balances the two.',
    formulas: ['p = m·v', 'p = 90·3'],
    stage: <ChargeStage pLen={0.65} pLabel="p = ?" vLabel="3 m/s" mLabel="90 kg" />,
  },
]

export function DefenseQuiz({ accent, onPrev, canPrev, onNext, lessonId, stepId, onRecord }: Props) {
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
      conceptTags: ['momentum-collisions'],
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
                <span className="kin-bubble kin-bubble--a">p = m·v</span>
                <span className="kin-bubble kin-bubble--b">v = p ⁄ m</span>
                <span className="kin-bubble kin-bubble--c">kg·m/s</span>
              </div>
              <div className="quiz-trophy">🏆</div>
              <div className="kin-grass" />
            </div>
          </div>
          <div className="kin__main">
            <span className="kin__tag">Final quiz</span>
            <h2 className="kin__title">Test your defending</h2>
            <p className="kin__body">Eight quick questions on the momentum p = m·v behind every tackle. Pick an answer and you will see why it works. You need <b>6 out of 8</b> to pass this mastery check.</p>
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
              <div className="quiz-trophy quiz-trophy--big">{score >= 6 ? '🏆' : '🛡️'}</div>
              <div className="kin-whistle">{cheer}</div>
              <div className="kin-grass" />
            </div>
          </div>
          <div className="kin__main">
            <span className="kin__tag">Results</span>
            <h2 className="kin__title">You scored {score} / {QUESTIONS.length}</h2>
            <p className="kin__body">{pct}% correct. {passed ? 'Quiz passed. This counts as the final momentum mastery check.' : 'You need 6 out of 8 to pass. Review the misses, then retry the quiz.'}</p>
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
