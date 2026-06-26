import { useState } from 'react'
import { Calculator } from './sims/Calculator'

// A final quiz for the Kinematics unit. It plays AFTER the simulation: a start
// tab, 8 animated question tabs, and a
// results tab. Styling reuses the `kin-*` animated stages so it matches the intro.

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

// ---- animated stages (reuse kin-* keyframes) ----
function GravStage() {
  return (
    <div className="kin-stage kin-stage--vert">
      <div className="kin-gravity">g ↓</div>
      <div className="kin-ball kin-ball--lob">⚽</div>
      <div className="kin-ball-shadow kin-ball-shadow--vert" />
      <div className="kin-grass" />
    </div>
  )
}
function HorizStage({ clock }: { clock?: boolean }) {
  return (
    <div className="kin-stage kin-stage--horiz">
      <div className="kin-grass" />
      {clock && <div className="quiz-clock">⏱️</div>}
      <div className="kin-track">
        {!clock && <><span className="kin-ghost" style={{ left: '18%' }} /><span className="kin-ghost" style={{ left: '42%' }} /><span className="kin-ghost" style={{ left: '66%' }} /></>}
        <span className="kin-ball kin-ball--slide">⚽</span>
      </div>
    </div>
  )
}
function SplitStage({ only }: { only?: 'x' | 'y' }) {
  return (
    <div className="kin-stage kin-stage--split">
      <div className="kin-split">
        <span className="kin-ball kin-ball--static">⚽</span>
        {only !== 'y' && <div className="kin-arrow kin-arrow--x"><span className="kin-arrow__label">vₓ</span></div>}
        {only !== 'x' && <div className="kin-arrow kin-arrow--y"><span className="kin-arrow__label">{only === 'y' ? 'h' : 'v_y'}</span></div>}
        {!only && <div className="kin-arrow kin-arrow--v"><span className="kin-arrow__label">v</span></div>}
      </div>
    </div>
  )
}
function CompareStage() {
  return (
    <div className="kin-stage kin-stage--arc">
      <svg className="kin-arc-svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet">
        <line x1="16" y1="172" x2="304" y2="172" stroke="rgba(255,255,255,0.25)" />
        <path className="kin-arc-path" d="M 24 170 Q 165 118 300 152" fill="none" stroke="#ffd166" strokeWidth="4" strokeLinecap="round" />
        <path className="kin-arc-path" d="M 24 170 Q 165 8 300 152" fill="none" stroke="#7ef0a0" strokeWidth="4" strokeLinecap="round" style={{ animationDelay: '0.3s' }} />
        <text x="250" y="146" fill="#ffd166" fontSize="11" fontWeight="700">flat</text>
        <text x="150" y="40" fill="#7ef0a0" fontSize="11" fontWeight="700">looping</text>
      </svg>
    </div>
  )
}
function ApexStage() {
  return (
    <div className="kin-stage kin-stage--vert">
      <div className="quiz-apex">v_y = 0</div>
      <div className="kin-ball kin-ball--lob">⚽</div>
      <div className="kin-ball-shadow kin-ball-shadow--vert" />
      <div className="kin-grass" />
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
    prompt: 'Once the ball is in the air (ignore air resistance), its acceleration is…',
    options: [
      { id: 'a', label: '10 m/s² straight down' },
      { id: 'b', label: 'Zero — nothing pushes it anymore' },
      { id: 'c', label: 'Forward, toward the goal' },
      { id: 'd', label: 'Downward only on the way down' },
    ],
    correct: 'a',
    explain: 'Gravity is the only force in flight, so the acceleration is a constant 10 m/s² downward the whole time — going up, at the top, and coming down.',
    stage: <GravStage />,
  },
  {
    tag: 'Question 2',
    prompt: <>You strike at <b>v = 20 m/s</b> and <b>θ = 60°</b>. The horizontal launch speed vₓ = v·cosθ is? <span className="quiz-given">(cos60° = 0.5)</span></>,
    options: [
      { id: 'a', label: '10 m/s' },
      { id: 'b', label: '17.4 m/s' },
      { id: 'c', label: '20 m/s' },
      { id: 'd', label: '5 m/s' },
    ],
    correct: 'a',
    explain: 'vₓ = v·cosθ = 20 × 0.5 = 10 m/s. The horizontal piece always uses cosine.',
    formulas: ['vₓ = v·cosθ', 'vₓ = 20·0.5'],
    stage: <SplitStage only="x" />,
  },
  {
    tag: 'Question 3',
    prompt: 'From the same height, one ball is kicked horizontally off a wall while another is just dropped. Which one lands first?',
    options: [
      { id: 'a', label: 'They land at the same time' },
      { id: 'b', label: 'The kicked ball — it has more speed' },
      { id: 'c', label: 'The dropped ball — it goes straight down' },
      { id: 'd', label: 'Whichever ball is heavier' },
    ],
    correct: 'a',
    explain: 'Horizontal and vertical motion are independent. Both balls start with zero vertical velocity and fall under the same g, so they hit the ground together — the sideways kick only changes where it lands, not when.',
    stage: <SplitStage />,
  },
  {
    tag: 'Question 4',
    prompt: 'At the very top of its arc, the ball’s acceleration is…',
    options: [
      { id: 'a', label: '10 m/s², still pointing down' },
      { id: 'b', label: 'Zero' },
      { id: 'c', label: 'Upward, then flips downward' },
      { id: 'd', label: 'Equal to vₓ' },
    ],
    correct: 'a',
    explain: 'Only the vertical velocity is zero at the apex — gravity never switches off, so the acceleration stays 10 m/s² downward for the entire flight.',
    stage: <ApexStage />,
  },
  {
    tag: 'Question 5',
    prompt: 'While the ball is still rising it slows down even though it is moving upward. So its velocity and acceleration must be…',
    options: [
      { id: 'a', label: 'Opposite in direction' },
      { id: 'b', label: 'Both pointing up' },
      { id: 'c', label: 'Both pointing down' },
      { id: 'd', label: 'Both zero' },
    ],
    correct: 'a',
    explain: 'On the way up velocity points up while gravity’s acceleration points down. When velocity and acceleration are opposite, the object slows — exactly what happens as the ball climbs.',
    stage: <GravStage />,
  },
  {
    tag: 'Question 6',
    prompt: 'Two free kicks leave with the SAME speed, one at a flat angle and one steep. Compared with the steep kick, the flatter kick…',
    options: [
      { id: 'a', label: 'Stays lower and reaches the goal sooner' },
      { id: 'b', label: 'Climbs higher and hangs in the air longer' },
      { id: 'c', label: 'Has a larger vertical speed v_y' },
      { id: 'd', label: 'Has zero horizontal speed' },
    ],
    correct: 'a',
    explain: 'A flat angle puts more of the fixed speed into vₓ and less into v_y, so the ball travels fast and low and arrives quickly — it trades height for pace.',
    stage: <CompareStage />,
  },
  {
    tag: 'Question 7',
    prompt: 'A lob is struck and lands back at the same height it left. Compared with its launch speed, its landing speed is…',
    options: [
      { id: 'a', label: 'The same magnitude' },
      { id: 'b', label: 'Larger' },
      { id: 'c', label: 'Smaller' },
      { id: 'd', label: 'Zero' },
    ],
    correct: 'a',
    explain: 'A trajectory is symmetric: the ball loses speed on the way up and regains the exact same amount coming down, so it returns to that height with the same speed (now aimed downward).',
    stage: <CompareStage />,
  },
  {
    tag: 'Question 8',
    prompt: <>A lob leaves the grass with <b>v_y = 15 m/s</b> upward and lands at the same height. Its total hang time t = 2·v_y ⁄ g is? <span className="quiz-given">(g = 10)</span></>,
    options: [
      { id: 'a', label: '3 s' },
      { id: 'b', label: '1.5 s' },
      { id: 'c', label: '6 s' },
      { id: 'd', label: '15 s' },
    ],
    correct: 'a',
    explain: 't = 2·v_y ⁄ g = (2 × 15) ⁄ 10 = 3 s — 1.5 s up and 1.5 s back down.',
    formulas: ['t = 2·v_y ⁄ g', 't = (2·15)⁄10'],
    stage: <HorizStage clock />,
  },
]

export function KinematicsQuiz({ accent, onPrev, canPrev, onNext, lessonId, stepId, onRecord }: Props) {
  // tab 0 = start, tabs 1..8 = questions, tab 9 = results
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
      conceptTags: ['projectile-final-quiz'],
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

  // ---- start tab ----
  if (tab === 0) {
    return (
      <div className="card step kin kin--full" style={style}>
        <div className="kin__grid">
          <div className="kin__visual">
            <div className="kin-stage kin-stage--intro">
              <div className="kin-bubbles">
                <span className="kin-bubble kin-bubble--a">vₓ = v·cosθ</span>
                <span className="kin-bubble kin-bubble--b">v_y = v·sinθ</span>
                <span className="kin-bubble kin-bubble--c">h = v_y²⁄2g</span>
              </div>
              <div className="quiz-trophy">🏆</div>
              <div className="kin-grass" />
            </div>
          </div>
          <div className="kin__main">
            <span className="kin__tag">Final quiz</span>
            <h2 className="kin__title">Test your penalty physics</h2>
            <p className="kin__body">Eight quick questions on everything you just played through. Pick an answer and you will see why it works. You need <b>6 out of 8</b> to pass this mastery check.</p>
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

  // ---- results tab ----
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
            <p className="kin__body">{pct}% correct. {passed ? 'Quiz passed. This counts as the final kinematics mastery check.' : 'You need 6 out of 8 to pass. Review the misses, then retry the quiz.'}</p>
            <div className="quiz-scorebar"><span className="quiz-scorebar__fill" style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
        <Foot tab={tab} count={QUESTIONS.length} onBack={back} onNext={next} canBack nextLabel={passed ? 'Finish →' : 'Retry quiz →'} />
      </div>
    )
  }

  // ---- question tabs ----
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
