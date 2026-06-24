type SliderProps = {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}

export function Slider({ label, value, min, max, step = 1, unit, onChange }: SliderProps) {
  return (
    <label className="slider">
      <span className="slider__label">
        {label}
        <strong className="slider__value">
          {Number.isInteger(value) ? value : value.toFixed(1)}
          {unit ? ` ${unit}` : ''}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
