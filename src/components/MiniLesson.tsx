import { useMemo, useState } from 'react'
import type { MiniLessonDef } from '../content/miniLessons'
import { MINI_LESSONS, lessonVariantIndex, computeReadout } from '../content/miniLessons'
import { sfxTick } from '../game/sfx'

// A short, INTERACTIVE concept teach: drag the slider and the output updates
// live through the unit's formula. Shown before each topic and, re-framed, as
// an immersive re-teach after a miss so the learner can actually grasp it.
export function MiniLesson({
  unitId, difficulty, reteach = 0, def: defProp, onDone,
}: {
  unitId?: string
  difficulty: number
  /** Explicit lesson to render (overrides the per-unit lookup). */
  def?: MiniLessonDef
  /** 0 for the first look; >0 cycles to a different explanation on a re-teach. */
  reteach?: number
  onDone: () => void
}) {
  const def = defProp ?? MINI_LESSONS[unitId ?? ''] ?? MINI_LESSONS.kinematics
  const model = def.model
  const variant = def.variants[lessonVariantIndex(def, difficulty, reteach)]

  const [x, setX] = useState(model.default)
  const readout = useMemo(() => computeReadout(model, x), [model, x])
  const pct = Math.round(((x - model.min) / (model.max - model.min)) * 100)
  // Output bar fills relative to the output's full-scale value.
  const outMax = model.compute(model.max) || 1
  const outPct = Math.max(0, Math.min(100, Math.round((model.compute(x) / outMax) * 100)))

  return (
    <div className="qtest-wrap">
      <div className="card qtest mini">
        <span className="eyebrow">{reteach > 0 ? 'Let\u2019s slow it down' : 'Concept'} · {def.formula}</span>
        <h1 className="qtest__h1 mini__title">{def.title}</h1>

        <div className="mini__lab">
          <div className="mini__relation">{model.relation}</div>

          <label className="mini__row">
            <span className="mini__rowlabel">{model.inputLabel}{model.constLabel ? ` · ${model.constLabel}` : ''}</span>
            <input
              className="mini__slider"
              type="range"
              min={model.min}
              max={model.max}
              step={model.step}
              value={x}
              onChange={(e) => { setX(parseFloat(e.target.value)); }}
            />
            <span className="mini__inval">{x} {model.inputUnit}</span>
            <span className="mini__track"><span className="mini__fill mini__fill--in" style={{ width: `${pct}%` }} /></span>
          </label>

          <div className="mini__out">
            <span className="mini__outlabel">{model.outputLabel}</span>
            <span className="mini__outval">{readout} <em>{model.outputUnit}</em></span>
            <span className="mini__track"><span className="mini__fill mini__fill--out" style={{ width: `${outPct}%` }} /></span>
          </div>
        </div>

        <div className="mini__explain">
          <strong>{variant.heading}</strong>
          <p>{variant.body}</p>
        </div>

        <div className="qtest__foot qtest__foot--end">
          <button className="btn btn--primary" onClick={() => { sfxTick(); onDone() }}>
            {reteach > 0 ? 'Got it — try again →' : 'Got it — my turn →'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default MiniLesson
