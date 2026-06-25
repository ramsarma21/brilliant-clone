import { useMemo, useState } from 'react'

// A full-page, INTERACTIVE intro to the Kinematics unit. It plays before the
// first penalty run. Instead of passive text, most slides let the learner drag
// sliders and watch the physics respond live (component vectors, spacing, apex
// height, and a full trajectory into the goal).

const G = 9.8

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

// --- Slide 0: welcome (animated) ---
function WelcomeStage() {
  return (
    <div className="kin-stage kin-stage--intro">
      <div className="kin-bubbles">
        <span className="kin-bubble kin-bubble--a">vₓ = v·cosθ</span>
        <span className="kin-bubble kin-bubble--b">½g·t²</span>
        <span className="kin-bubble kin-bubble--c">v_y = v·sinθ</span>
      </div>
      <div className="kin-ball kin-ball--bounce">⚽</div>
      <div className="kin-ball-shadow" />
      <div className="kin-grass" />
    </div>
  )
}

// --- Slide 1: split into components (interactive angle) ---
function AngleStage() {
  const [ang, setAng] = useState(35)
  const v = 20
  const a = (ang * Math.PI) / 180
  const vx = v * Math.cos(a)
  const vy = v * Math.sin(a)
  const ox = 46, oy = 176, k = 6.4
  const tx = ox + vx * k, ty = oy - vy * k
  return (
    <div className="kin-stage kin-stage--tool">
      <svg viewBox="0 0 260 200" className="kin-svg">
        <defs>
          <marker id="kx" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#ffd166" /></marker>
          <marker id="ky" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#7ef0a0" /></marker>
          <marker id="kv" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#ff6ec7" /></marker>
        </defs>
        <line x1={ox} y1={oy} x2={oy + 0} y2={oy} stroke="rgba(255,255,255,0.18)" />
        {/* component rectangle guides */}
        <line x1={tx} y1={oy} x2={tx} y2={ty} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />
        <line x1={ox} y1={ty} x2={tx} y2={ty} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />
        {/* vectors */}
        <line x1={ox} y1={oy} x2={tx} y2={oy} stroke="#ffd166" strokeWidth="4" markerEnd="url(#kx)" />
        <line x1={ox} y1={oy} x2={ox} y2={ty} stroke="#7ef0a0" strokeWidth="4" markerEnd="url(#ky)" />
        <line x1={ox} y1={oy} x2={tx} y2={ty} stroke="#ff6ec7" strokeWidth="4" markerEnd="url(#kv)" />
        <text x={(ox + tx) / 2} y={oy + 16} fill="#ffd166" fontSize="11" fontWeight="700" textAnchor="middle">vₓ</text>
        <text x={ox - 14} y={(oy + ty) / 2} fill="#7ef0a0" fontSize="11" fontWeight="700" textAnchor="middle">v_y</text>
        <circle cx={ox} cy={oy} r="6" fill="#fff" stroke="#1a2a52" strokeWidth="1.5" />
      </svg>
      <div className="kin-tool">
        <Slider label="angle θ" value={ang} min={5} max={80} suffix="°" onChange={setAng} />
        <div className="kin-readouts">
          <span className="kin-readout" style={{ '--c': '#ffd166' } as React.CSSProperties}>vₓ = 20·cos{ang}° = <b>{vx.toFixed(1)}</b></span>
          <span className="kin-readout" style={{ '--c': '#7ef0a0' } as React.CSSProperties}>v_y = 20·sin{ang}° = <b>{vy.toFixed(1)}</b></span>
        </div>
      </div>
    </div>
  )
}

// --- Slide 2: constant horizontal speed (interactive) ---
function SpeedStage() {
  const [v, setV] = useState(12)
  const ox = 18, baseY = 150, k = 320 / 30 // px per metre over ~30 m view
  const marks = [1, 2, 3, 4].map((t) => ({ t, x: ox + v * t * k }))
  return (
    <div className="kin-stage kin-stage--tool">
      <svg viewBox="0 0 360 190" className="kin-svg">
        <line x1={ox} y1={baseY} x2={350} y2={baseY} stroke="rgba(255,255,255,0.25)" />
        {marks.map((m) => (
          <g key={m.t}>
            <circle cx={Math.min(m.x, 348)} cy={baseY - 14} r={m.x > 348 ? 0 : 12} fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.45)" strokeDasharray="3 2" />
            {m.x <= 348 && <text x={m.x} y={baseY + 18} fill="rgba(255,255,255,0.8)" fontSize="10" textAnchor="middle">{m.t}s</text>}
          </g>
        ))}
        <circle cx={ox} cy={baseY - 14} r="13" fill="#fff" stroke="#1a2a52" strokeWidth="1.5" />
      </svg>
      <div className="kin-tool">
        <Slider label="horizontal speed vₓ" value={v} min={5} max={25} suffix=" m/s" onChange={setV} />
        <div className="kin-readouts">
          <span className="kin-readout" style={{ '--c': '#ffd166' } as React.CSSProperties}>each second the ball moves <b>{v} m</b></span>
          <span className="kin-readout" style={{ '--c': '#7ef0a0' } as React.CSSProperties}>after 3 s: x = vₓ·t = <b>{(v * 3).toFixed(0)} m</b></span>
        </div>
      </div>
    </div>
  )
}

// --- Slide 3: gravity / apex height (interactive) ---
function GravityStage() {
  const [vy, setVy] = useState(14)
  const apex = (vy * vy) / (2 * G)
  const hang = (2 * vy) / G
  const baseY = 168, k = 150 / 25 // px per metre, ~25 m view
  const topY = baseY - apex * k
  return (
    <div className="kin-stage kin-stage--tool">
      <svg viewBox="0 0 240 200" className="kin-svg">
        <line x1={40} y1={baseY} x2={210} y2={baseY} stroke="rgba(255,255,255,0.25)" />
        <line x1={120} y1={baseY} x2={120} y2={Math.max(topY, 14)} stroke="#7ef0a0" strokeWidth="4" strokeLinecap="round" />
        <line x1={104} y1={Math.max(topY, 14)} x2={136} y2={Math.max(topY, 14)} stroke="#ffd166" strokeWidth="3" strokeDasharray="4 3" />
        <text x={150} y={Math.max(topY, 14) + 4} fill="#ffd166" fontSize="11" fontWeight="700">apex</text>
        <circle cx={120} cy={Math.max(topY - 2, 12)} r="9" fill="#fff" stroke="#1a2a52" strokeWidth="1.5" />
        <text x={196} y={36} fill="#ff8fab" fontSize="12" fontWeight="800">g ↓</text>
      </svg>
      <div className="kin-tool">
        <Slider label="upward speed v_y" value={vy} min={5} max={24} suffix=" m/s" onChange={setVy} />
        <div className="kin-readouts">
          <span className="kin-readout" style={{ '--c': '#7ef0a0' } as React.CSSProperties}>apex height = v_y²⁄2g = <b>{apex.toFixed(1)} m</b></span>
          <span className="kin-readout" style={{ '--c': '#ffd166' } as React.CSSProperties}>hang time = 2v_y⁄g = <b>{hang.toFixed(1)} s</b></span>
        </div>
      </div>
    </div>
  )
}

// --- Slide 4: the full trajectory into the goal (interactive aim) ---
const D = 18, H0 = 0.2, BAR = 2.44
function AimStage() {
  const [ang, setAng] = useState(30)
  const [pow, setPow] = useState(16)
  const { path, yGoal, verdict, good } = useMemo(() => {
    const a = (ang * Math.PI) / 180
    const vx = pow * Math.cos(a), vy = pow * Math.sin(a)
    const padX = 22, baseY = 176, spanX = 300, spanY = 150, yView = 5
    const sx = (X: number) => padX + (X / D) * spanX
    const sy = (Y: number) => baseY - (Y / yView) * spanY
    const tEnd = vx > 0.1 ? D / vx : 4
    const pts: string[] = []
    let landedShort = false
    for (let i = 0; i <= 60; i++) {
      const t = (tEnd * i) / 60
      const x = vx * t
      const y = H0 + vy * t - 0.5 * G * t * t
      if (y < 0) { pts.push(`${sx(x).toFixed(1)} ${sy(0).toFixed(1)}`); landedShort = true; break }
      pts.push(`${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`)
    }
    const yGoal = H0 + vy * tEnd - 0.5 * G * tEnd * tEnd
    let verdict = 'GOAL — under the bar!'
    let good = true
    if (landedShort || yGoal < 0) { verdict = 'Drops short of the goal'; good = false }
    else if (yGoal > BAR) { verdict = 'Sails over the crossbar'; good = false }
    return { path: 'M ' + pts.join(' L '), yGoal, verdict, good }
  }, [ang, pow])

  const padX = 22, baseY = 176, spanX = 300, spanY = 150, yView = 5
  const goalX = padX + spanX
  const barY = baseY - (BAR / yView) * spanY
  return (
    <div className="kin-stage kin-stage--tool kin-stage--aim">
      <svg viewBox="0 0 340 200" className="kin-svg">
        <line x1={padX} y1={baseY} x2={330} y2={baseY} stroke="rgba(255,255,255,0.3)" />
        {/* goal */}
        <line x1={goalX} y1={baseY} x2={goalX} y2={barY} stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <line x1={goalX} y1={barY} x2={goalX + 16} y2={barY} stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <line x1={goalX + 16} y1={barY} x2={goalX + 16} y2={baseY} stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
        <text x={goalX - 4} y={barY - 6} fill="#ffd166" fontSize="10" fontWeight="700" textAnchor="end">2.44 m bar</text>
        {/* trajectory */}
        <path d={path} fill="none" stroke={good ? '#36e07f' : '#ff7a90'} strokeWidth="4" strokeLinecap="round" />
        <circle cx={padX} cy={baseY} r="6" fill="#fff" stroke="#1a2a52" strokeWidth="1.5" />
      </svg>
      <div className="kin-tool">
        <div className="kin-tool__sliders">
          <Slider label="angle θ" value={ang} min={8} max={60} suffix="°" onChange={setAng} />
          <Slider label="power v" value={pow} min={9} max={28} suffix=" m/s" onChange={setPow} />
        </div>
        <div className={`kin-verdict ${good ? 'is-good' : 'is-bad'}`}>
          height at goal = <b>{yGoal > 0 ? yGoal.toFixed(2) : '0.0'} m</b> · {verdict}
        </div>
      </div>
    </div>
  )
}

// --- Slide 5: ready (animated) ---
function ReadyStage() {
  return (
    <div className="kin-stage kin-stage--recap">
      <div className="kin-grass" />
      <div className="kin-ball kin-ball--spin">⚽</div>
      <div className="kin-whistle">Ready? 📣</div>
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
    tag: 'Welcome', title: 'Penalty physics',
    body: <>Every penalty you take is <b>projectile motion</b>. Master a few ideas here and you will bend the ball under the bar on command, no luck required. The next slides are <b>interactive</b>, so drag the sliders and watch the physics react.</>,
    formulas: [{ label: 'gravity', expr: 'g = 9.8 m/s²' }],
    stage: <WelcomeStage />,
  },
  {
    tag: 'Big idea', title: 'One kick, two motions',
    body: <>The instant your boot leaves the ball, the strike splits into a <b>sideways</b> part and an <b>upward</b> part that act <b>independently</b>. Drag the angle and watch how the same kick divides between them.</>,
    hint: 'Drag the angle θ',
    stage: <AngleStage />,
  },
  {
    tag: 'Sideways', title: 'Horizontal: steady pace',
    body: <>Nothing pushes the ball sideways in the air, so <b>vₓ never changes</b>: it covers equal ground every second. Slide the speed and see the steps stretch.</>,
    formulas: [{ label: 'distance', expr: 'x = vₓ·t' }],
    hint: 'Drag the speed',
    stage: <SpeedStage />,
  },
  {
    tag: 'Up & down', title: 'Vertical: gravity wins',
    body: <>Gravity pulls down at <b>9.8 m/s²</b>, so the ball rises, slows, stops, then falls. A faster launch climbs higher and hangs longer. Try it.</>,
    formulas: [{ label: 'apex', expr: 'h = v_y²⁄2g' }],
    hint: 'Drag the upward speed',
    stage: <GravityStage />,
  },
  {
    tag: 'Together', title: 'The whole arc',
    body: <>Combine both and you get a <b>parabola</b>. At the goal (<b>{D} m</b> away) the ball must arrive below the <b>2.44 m</b> crossbar to score. Tune the angle and power until it reads <b>GOAL</b>.</>,
    formulas: [{ label: 'time to goal', expr: 't = d⁄vₓ' }, { label: 'height there', expr: 'y = h₀ + v_y·t − ½g·t²' }],
    hint: 'Drag both sliders',
    stage: <AimStage />,
  },
  {
    tag: 'Your turn', title: 'Take the shot',
    body: <>In the game a meter locks <b>one</b> value (your angle or your power). You solve for the <b>other</b> so the ball lands right where you aimed. You have got this, let us play.</>,
    formulas: [{ label: 'remember', expr: 'vₓ = v·cosθ' }, { label: 'remember', expr: 'v_y = v·sinθ' }, { label: 'remember', expr: 'y = h₀ + v_y·t − ½g·t²' }],
    stage: <ReadyStage />,
  },
]

export function KinematicsIntro({ accent, onPrev, canPrev, onNext }: Props) {
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
          <button className="btn btn--primary" onClick={next}>{last ? 'Take the shot →' : 'Next'}</button>
        </div>
      </div>
    </div>
  )
}
