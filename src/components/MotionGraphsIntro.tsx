import { useMemo, useState } from 'react'

// Interactive intro to the Motion Graphs unit, themed around the soccer skill it
// powers: PASSING. The core idea — slope on a position-time graph is velocity —
// is taught by dragging lines and watching a runner, building to the "lead the
// runner" through-ball where two lines must cross in the right place.

type Props = {
  accent: string
  onPrev: () => void
  canPrev: boolean
  onNext: () => void
}

function Slider({ label, value, min, max, step = 1, suffix, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void
}) {
  return (
    <label className="kin-ctrl">
      <span className="kin-ctrl__row"><span>{label}</span><b>{value}{suffix}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

// --- Slide 0: welcome ---
function WelcomeStage() {
  return (
    <div className="kin-stage kin-stage--intro">
      <div className="kin-bubbles">
        <span className="kin-bubble kin-bubble--a">slope = velocity</span>
        <span className="kin-bubble kin-bubble--b">x = x₀ + v·t</span>
        <span className="kin-bubble kin-bubble--c">lead the run</span>
      </div>
      <div className="kin-ball kin-ball--bounce">📈</div>
      <div className="kin-grass" />
    </div>
  )
}

// graph helpers shared by the tool stages
const VW = 260, VH = 196, P = 30
const TM = 5, PM = 30
const gx = (t: number) => P + (t / TM) * (VW - 2 * P)
const gy = (p: number) => P + (VH - 2 * P) - (Math.min(p, PM) / PM) * (VH - 2 * P)

function Axes() {
  return (
    <>
      <line x1={P} y1={P} x2={P} y2={VH - P} stroke="rgba(255,255,255,0.3)" />
      <line x1={P} y1={VH - P} x2={VW - P} y2={VH - P} stroke="rgba(255,255,255,0.3)" />
      <text x={P - 6} y={P + 2} fill="rgba(255,255,255,0.7)" fontSize="9" textAnchor="end">pos</text>
      <text x={VW - P} y={VH - P + 14} fill="rgba(255,255,255,0.7)" fontSize="9" textAnchor="end">time</text>
    </>
  )
}

// --- Slide 1: slope = velocity ---
function SlopeStage() {
  const [v, setV] = useState(4)
  const end = Math.min(v * TM, PM)
  return (
    <div className="kin-stage kin-stage--tool">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="kin-svg">
        <Axes />
        <line x1={gx(0)} y1={gy(0)} x2={gx(TM)} y2={gy(end)} stroke="#7ef0a0" strokeWidth="4" strokeLinecap="round" />
        <circle cx={gx(2)} cy={gy(v * 2)} r="6" fill="#fff" stroke="#1a2a52" strokeWidth="1.5" />
      </svg>
      <div className="kin-tool">
        <Slider label="velocity (slope)" value={v} min={1} max={6} suffix=" m/s" onChange={setV} />
        <div className="kin-readouts">
          <span className="kin-readout" style={{ '--c': '#7ef0a0' } as React.CSSProperties}>steeper line = <b>faster</b></span>
          <span className="kin-readout" style={{ '--c': '#ffd166' } as React.CSSProperties}>after 3 s: x = v·t = <b>{(v * 3).toFixed(0)} m</b></span>
        </div>
      </div>
    </div>
  )
}

// --- Slide 2: a head start shifts the line up ---
function HeadStartStage() {
  const [x0, setX0] = useState(8)
  const v = 4
  return (
    <div className="kin-stage kin-stage--tool">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="kin-svg">
        <Axes />
        {/* from origin */}
        <line x1={gx(0)} y1={gy(0)} x2={gx(TM)} y2={gy(v * TM)} stroke="rgba(255,255,255,0.35)" strokeWidth="3" strokeDasharray="4 4" />
        {/* with head start */}
        <line x1={gx(0)} y1={gy(x0)} x2={gx(TM)} y2={gy(x0 + v * TM)} stroke="#06b6d4" strokeWidth="4" strokeLinecap="round" />
        <circle cx={gx(0)} cy={gy(x0)} r="5" fill="#06b6d4" />
      </svg>
      <div className="kin-tool">
        <Slider label="head start x₀" value={x0} min={0} max={16} suffix=" m" onChange={setX0} />
        <div className="kin-readouts">
          <span className="kin-readout" style={{ '--c': '#06b6d4' } as React.CSSProperties}>same speed, line starts higher</span>
          <span className="kin-readout" style={{ '--c': '#ffd166' } as React.CSSProperties}>x = x₀ + v·t = <b>{x0} + 4·t</b></span>
        </div>
      </div>
    </div>
  )
}

// --- Slide 3: lead the runner (two lines must cross in the space) ---
function LeadStage() {
  const [pass, setPass] = useState(8)
  const runnerStart = 8, runnerV = 4, target = 24, half = 2.2
  const { meetPos, verdict, good } = useMemo(() => {
    if (pass <= runnerV) return { meetPos: null as number | null, verdict: 'too soft — never catches the run', good: false }
    const t = runnerStart / (pass - runnerV)
    const pos = pass * t
    let verdict = 'connects in the space!'
    let good = true
    if (pos < target - half) { verdict = 'too firm — meets him early, no space'; good = false }
    else if (pos > target + half) { verdict = 'too soft — arrives behind the run'; good = false }
    return { meetPos: pos, verdict, good }
  }, [pass])

  const t = pass > runnerV ? runnerStart / (pass - runnerV) : TM
  return (
    <div className="kin-stage kin-stage--tool">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="kin-svg">
        <Axes />
        {/* target band */}
        <rect x={P} y={gy(target + half)} width={VW - 2 * P} height={gy(target - half) - gy(target + half)} fill="rgba(54,224,127,0.18)" />
        {/* runner */}
        <line x1={gx(0)} y1={gy(runnerStart)} x2={gx(TM)} y2={gy(runnerStart + runnerV * TM)} stroke="#ffd166" strokeWidth="4" strokeLinecap="round" />
        {/* pass */}
        <line x1={gx(0)} y1={gy(0)} x2={gx(TM)} y2={gy(pass * TM)} stroke="#ff6ec7" strokeWidth="4" strokeLinecap="round" />
        {meetPos != null && t <= TM && (
          <circle cx={gx(t)} cy={gy(meetPos)} r="6" fill={good ? '#36e07f' : '#ff7a90'} stroke="#1a2a52" strokeWidth="1.5" />
        )}
      </svg>
      <div className="kin-tool">
        <Slider label="pass speed" value={pass} min={3} max={20} step={0.5} suffix=" m/s" onChange={setPass} />
        <div className={`kin-verdict ${good ? 'is-good' : 'is-bad'}`}>
          {meetPos != null ? <>meet at <b>{meetPos.toFixed(1)} m</b> · {verdict}</> : verdict}
        </div>
      </div>
    </div>
  )
}

// --- Slide 4: ready ---
function ReadyStage() {
  return (
    <div className="kin-stage kin-stage--recap">
      <div className="kin-grass" />
      <div className="kin-ball kin-ball--spin">⚽</div>
      <div className="kin-whistle">Thread it through 🎯</div>
    </div>
  )
}

type Slide = {
  tag: string; title: string; body: React.ReactNode
  formulas?: { label: string; expr: string }[]
  hint?: string
  stage: React.ReactNode
}

const SLIDES: Slide[] = [
  {
    tag: 'Welcome', title: 'Read the run',
    body: <>A great pass is really a <b>graph problem</b>. Plot a player's position against time and you get a straight line whose <b>slope is their velocity</b>. Master that and you can lead any runner. The next slides are <b>interactive</b>.</>,
    formulas: [{ label: 'key idea', expr: 'slope = velocity' }],
    stage: <WelcomeStage />,
  },
  {
    tag: 'Big idea', title: 'Slope is velocity',
    body: <>On a position–time graph, a <b>steeper</b> line means the player is moving <b>faster</b>: covering more distance each second. Drag the slope and watch the speed change.</>,
    formulas: [{ label: 'distance', expr: 'x = v·t' }],
    hint: 'Drag the slope',
    stage: <SlopeStage />,
  },
  {
    tag: 'Where it starts', title: 'A head start lifts the line',
    body: <>If a teammate is already ahead when the clock starts, his line begins <b>higher up</b> but keeps the same slope. That starting position is <b>x₀</b>. Slide it and see.</>,
    formulas: [{ label: 'position', expr: 'x = x₀ + v·t' }],
    hint: 'Drag the head start',
    stage: <HeadStartStage />,
  },
  {
    tag: 'The skill', title: 'Lead the runner',
    body: <>A through-ball is two lines: the <b>runner</b> (starts ahead, his slope) and your <b>pass</b> (starts at you, its slope is the pass speed). They connect where the lines <b>cross</b>. Tune your pass so they meet inside the <b>space</b>.</>,
    formulas: [{ label: 'they meet when', expr: 'v_pass·t = x₀ + v_run·t' }],
    hint: 'Drag the pass speed',
    stage: <LeadStage />,
  },
  {
    tag: 'Your turn', title: 'Thread the pass',
    body: <>In the drill the runner's speed and head start are given. You pick the pass speed so your line crosses his in the green space. Read the slopes, do the math, slot it through.</>,
    formulas: [{ label: 'remember', expr: 'slope = velocity' }, { label: 'remember', expr: 'x = x₀ + v·t' }],
    stage: <ReadyStage />,
  },
]

export function MotionGraphsIntro({ accent, onPrev, canPrev, onNext }: Props) {
  const [i, setI] = useState(0)
  const slide = SLIDES[i]
  const last = i === SLIDES.length - 1
  const back = () => { if (i === 0) onPrev(); else setI((n) => n - 1) }
  const next = () => { if (last) onNext(); else setI((n) => n + 1) }

  return (
    <div className="card step kin kin--full" style={{ '--unit-accent': accent } as React.CSSProperties}>
      <div className="kin__grid" key={i}>
        <div className="kin__visual">
          {slide.hint && <span className="kin__hint">👆 {slide.hint}</span>}
          {slide.stage}
        </div>
        <div className="kin__main">
          <span className="kin__tag">{slide.tag}</span>
          <h2 className="kin__title">{slide.title}</h2>
          <p className="kin__body">{slide.body}</p>
          {slide.formulas && (
            <div className="kin__formulas">
              {slide.formulas.map((f, k) => (
                <div className="kin__formula" style={{ animationDelay: `${0.18 + k * 0.12}s` }} key={k}>
                  <span className="kin__formula-label">{f.label}</span>
                  <code className="kin__formula-expr">{f.expr}</code>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="kin__foot">
        <div className="kin__dots">
          {SLIDES.map((_, k) => (
            <span key={k} className={`kin__dot ${k === i ? 'is-current' : ''} ${k < i ? 'is-done' : ''}`} />
          ))}
        </div>
        <div className="kin__nav">
          <button className="btn btn--ghost" onClick={back} disabled={i === 0 && !canPrev}>Back</button>
          <button className="btn btn--primary" onClick={next}>{last ? 'Start the drill →' : 'Next'}</button>
        </div>
      </div>
    </div>
  )
}
