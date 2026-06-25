import { useState } from 'react'
import { Calculator } from './sims/Calculator'

// Final quiz for the Motion Graphs unit. Same shape as the kinematics quiz
// (start tab, 8 question tabs, results tab) and reuses the kin-*/quiz-* styles,
// with small position-time graph stages instead of trajectory animations.

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

// ---- tiny position–time graph stage ----
type Line = { x0: number; v: number; color: string; dash?: boolean }
function GraphStage({ lines, band, note }: { lines: Line[]; band?: [number, number]; note?: string }) {
  const VW = 300, VH = 200, P = 30, TM = 5, PM = 30
  const gx = (t: number) => P + (t / TM) * (VW - 2 * P)
  const gy = (p: number) => P + (VH - 2 * P) - (Math.min(Math.max(p, 0), PM) / PM) * (VH - 2 * P)
  return (
    <div className="kin-stage kin-stage--tool">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="kin-svg" preserveAspectRatio="xMidYMid meet">
        {band && (
          <rect x={P} y={gy(band[1])} width={VW - 2 * P} height={gy(band[0]) - gy(band[1])} fill="rgba(54,224,127,0.18)" />
        )}
        <line x1={P} y1={P} x2={P} y2={VH - P} stroke="rgba(255,255,255,0.3)" />
        <line x1={P} y1={VH - P} x2={VW - P} y2={VH - P} stroke="rgba(255,255,255,0.3)" />
        <text x={P - 6} y={P + 2} fill="rgba(255,255,255,0.7)" fontSize="9" textAnchor="end">pos</text>
        <text x={VW - P} y={VH - P + 14} fill="rgba(255,255,255,0.7)" fontSize="9" textAnchor="end">time</text>
        {lines.map((l, i) => (
          <line
            key={i}
            x1={gx(0)} y1={gy(l.x0)} x2={gx(TM)} y2={gy(l.x0 + l.v * TM)}
            stroke={l.color} strokeWidth="4" strokeLinecap="round"
            strokeDasharray={l.dash ? '5 4' : undefined}
          />
        ))}
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

const QUESTIONS: Q[] = [
  {
    tag: 'Question 1',
    prompt: 'On a position–time graph, what does the slope of the line tell you?',
    options: [
      { id: 'a', label: 'The velocity' },
      { id: 'b', label: 'The acceleration' },
      { id: 'c', label: 'The total distance' },
      { id: 'd', label: 'The starting position' },
    ],
    correct: 'a',
    explain: 'Slope = change in position ÷ change in time, which is exactly velocity.',
    stage: <GraphStage lines={[{ x0: 0, v: 5, color: '#7ef0a0' }]} note="slope = velocity" />,
  },
  {
    tag: 'Question 2',
    prompt: 'Two runners are drawn on the same graph. The steeper line belongs to…',
    options: [
      { id: 'a', label: 'The faster runner' },
      { id: 'b', label: 'The slower runner' },
      { id: 'c', label: 'The one who started ahead' },
      { id: 'd', label: 'A stationary runner' },
    ],
    correct: 'a',
    explain: 'Steeper slope means more distance per second: the faster runner.',
    stage: <GraphStage lines={[{ x0: 0, v: 5.5, color: '#7ef0a0' }, { x0: 0, v: 2, color: '#ffd166' }]} />,
  },
  {
    tag: 'Question 3',
    prompt: 'A line on a position–time graph is perfectly horizontal (flat). The object is…',
    options: [
      { id: 'a', label: 'Standing still' },
      { id: 'b', label: 'Moving at constant speed' },
      { id: 'c', label: 'Speeding up' },
      { id: 'd', label: 'Moving backward' },
    ],
    correct: 'a',
    explain: 'A flat line means position is not changing, so the velocity (slope) is zero: standing still.',
    stage: <GraphStage lines={[{ x0: 16, v: 0, color: '#06b6d4' }]} note="flat = stopped" />,
  },
  {
    tag: 'Question 4',
    prompt: <>A teammate goes from <b>4 m</b> to <b>22 m</b> in <b>6 s</b>. His average velocity is? <span className="quiz-given">(v = Δx ⁄ Δt)</span></>,
    options: [
      { id: 'a', label: '3 m/s' },
      { id: 'b', label: '18 m/s' },
      { id: 'c', label: '6 m/s' },
      { id: 'd', label: '4.3 m/s' },
    ],
    correct: 'a',
    explain: 'v = (22 − 4) ⁄ 6 = 18 ⁄ 6 = 3 m/s.',
    formulas: ['v = Δx⁄Δt', 'v = (22−4)⁄6'],
    calculator: true,
    stage: <GraphStage lines={[{ x0: 4, v: 3, color: '#7ef0a0' }]} />,
  },
  {
    tag: 'Question 5',
    prompt: 'Two lines that begin at different heights but never touch describe a pass that…',
    options: [
      { id: 'a', label: 'Never connects' },
      { id: 'b', label: 'Connects where they start' },
      { id: 'c', label: 'Connects at the end' },
      { id: 'd', label: 'Always connects' },
    ],
    correct: 'a',
    explain: 'A pass connects only where the ball line crosses the runner line. Parallel-ish lines that never meet = no connection.',
    stage: <GraphStage lines={[{ x0: 0, v: 3, color: '#ff6ec7' }, { x0: 10, v: 3, color: '#ffd166' }]} note="never cross" />,
  },
  {
    tag: 'Question 6',
    prompt: <>A runner starts <b>8 m</b> ahead and runs at <b>4 m/s</b>. Where is he after <b>3 s</b>? <span className="quiz-given">(x = x₀ + v·t)</span></>,
    options: [
      { id: 'a', label: '20 m' },
      { id: 'b', label: '12 m' },
      { id: 'c', label: '32 m' },
      { id: 'd', label: '14 m' },
    ],
    correct: 'a',
    explain: 'x = x₀ + v·t = 8 + 4×3 = 8 + 12 = 20 m.',
    formulas: ['x = x₀ + v·t', 'x = 8 + 4·3'],
    calculator: true,
    stage: <GraphStage lines={[{ x0: 8, v: 4, color: '#ffd166' }]} />,
  },
  {
    tag: 'Question 7',
    prompt: 'To lead a runner so the pass meets him further up the pitch (more space), you should…',
    options: [
      { id: 'a', label: 'Pass with less pace (gentler slope)' },
      { id: 'b', label: 'Pass with more pace (steeper slope)' },
      { id: 'c', label: 'Pass at his exact speed' },
      { id: 'd', label: 'Pass backward' },
    ],
    correct: 'a',
    explain: 'A gentler pass line crosses the runner line later and further along, so the ball meets him deeper in space. Too much pace and you meet him early, at his feet.',
    stage: <GraphStage lines={[{ x0: 8, v: 4, color: '#ffd166' }, { x0: 0, v: 7, color: '#ff6ec7' }]} band={[20, 26]} />,
  },
  {
    tag: 'Question 8',
    prompt: <>Your pass line is <b>x = 9·t</b> and the runner is <b>x = 6 + 3·t</b>. At what time do they meet? <span className="quiz-given">(set them equal)</span></>,
    options: [
      { id: 'a', label: '1 s' },
      { id: 'b', label: '2 s' },
      { id: 'c', label: '0.5 s' },
      { id: 'd', label: '3 s' },
    ],
    correct: 'a',
    explain: '9t = 6 + 3t → 6t = 6 → t = 1 s. (They meet at x = 9 m.)',
    formulas: ['9·t = 6 + 3·t', '6·t = 6'],
    calculator: true,
    stage: <GraphStage lines={[{ x0: 0, v: 9, color: '#ff6ec7' }, { x0: 6, v: 3, color: '#ffd166' }]} />,
  },
]

export function MotionGraphsQuiz({ accent, onPrev, canPrev, onNext, lessonId, stepId, onRecord }: Props) {
  const [tab, setTab] = useState(0)
  const [picked, setPicked] = useState<(string | null)[]>(Array(QUESTIONS.length).fill(null))
  const [showCalc, setShowCalc] = useState(false)
  const [recordedKey, setRecordedKey] = useState('')
  const last = QUESTIONS.length + 1

  const score = picked.filter((p, i) => p === QUESTIONS[i].correct).length
  const passed = score >= 6

  const back = () => { if (tab === 0) onPrev(); else setTab((t) => t - 1) }
  const retry = () => {
    setPicked(Array(QUESTIONS.length).fill(null))
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
      conceptTags: ['graph-final-quiz'],
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
                <span className="kin-bubble kin-bubble--a">slope = velocity</span>
                <span className="kin-bubble kin-bubble--b">x = x₀ + v·t</span>
                <span className="kin-bubble kin-bubble--c">lead the run</span>
              </div>
              <div className="quiz-trophy">🏆</div>
              <div className="kin-grass" />
            </div>
          </div>
          <div className="kin__main">
            <span className="kin__tag">Final quiz</span>
            <h2 className="kin__title">Test your motion graphs</h2>
            <p className="kin__body">Eight quick questions on slope, velocity, and leading a runner. Pick an answer and you will see why it works. You need <b>6 out of 8</b> to pass this mastery check.</p>
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
              <div className="quiz-trophy quiz-trophy--big">{score >= 6 ? '🏆' : '📈'}</div>
              <div className="kin-whistle">{cheer}</div>
              <div className="kin-grass" />
            </div>
          </div>
          <div className="kin__main">
            <span className="kin__tag">Results</span>
            <h2 className="kin__title">You scored {score} / {QUESTIONS.length}</h2>
            <p className="kin__body">{pct}% correct. {passed ? 'Quiz passed. This counts as the final motion graphs mastery check.' : 'You need 6 out of 8 to pass. Review the misses, then retry the quiz.'}</p>
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
          {(q.formulas || q.calculator) && (
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
              {q.calculator && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowCalc((open) => !open)}>
                  🧮 {showCalc ? 'Hide calculator' : 'Calculator'}
                </button>
              )}
            </div>
          )}
          <div className="quiz-opts">
            {q.options.map((o) => {
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
          {showCalc && q.calculator && <Calculator onClose={() => setShowCalc(false)} />}
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
