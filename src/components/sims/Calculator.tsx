import { useState } from 'react'

// A tiny, friendly scientific calculator. Trig works in DEGREES (angles here
// are in degrees), so students can plug θ straight in.

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'fn'; v: string } | { t: 'lp' } | { t: 'rp' }

const FNS = new Set(['sin', 'cos', 'tan', 'sqrt'])
const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }

function tokenize(src: string): Tok[] {
  const s = src
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/π/g, '(' + Math.PI + ')').replace(/√/g, 'sqrt')
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ') { i++; continue }
    if (/[0-9.]/.test(c)) {
      let j = i + 1
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      out.push({ t: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue
    }
    if (/[a-z]/i.test(c)) {
      let j = i + 1
      while (j < s.length && /[a-z]/i.test(s[j])) j++
      const word = s.slice(i, j).toLowerCase()
      if (FNS.has(word)) out.push({ t: 'fn', v: word })
      i = j; continue
    }
    if ('+-*/^'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue }
    if (c === '(') { out.push({ t: 'lp' }); i++; continue }
    if (c === ')') { out.push({ t: 'rp' }); i++; continue }
    i++
  }
  return out
}

function evaluate(src: string): number {
  const toks = tokenize(src)
  // shunting-yard to RPN (with unary minus handling)
  const output: Tok[] = []
  const stack: Tok[] = []
  let prev: Tok | null = null
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]
    if (tk.t === 'num') output.push(tk)
    else if (tk.t === 'fn') stack.push(tk)
    else if (tk.t === 'op') {
      let v = tk.v
      // unary minus → 0 - x
      if (v === '-' && (prev === null || prev.t === 'op' || prev.t === 'lp')) {
        output.push({ t: 'num', v: 0 })
      }
      while (stack.length) {
        const top = stack[stack.length - 1]
        if (top.t === 'op' && PREC[top.v] >= PREC[v]) output.push(stack.pop()!)
        else if (top.t === 'fn') output.push(stack.pop()!)
        else break
      }
      stack.push({ t: 'op', v })
    } else if (tk.t === 'lp') stack.push(tk)
    else if (tk.t === 'rp') {
      while (stack.length && stack[stack.length - 1].t !== 'lp') output.push(stack.pop()!)
      if (stack.length) stack.pop()
      if (stack.length && stack[stack.length - 1].t === 'fn') output.push(stack.pop()!)
    }
    prev = tk
  }
  while (stack.length) output.push(stack.pop()!)
  // eval RPN
  const num: number[] = []
  const d2r = Math.PI / 180
  for (const tk of output) {
    if (tk.t === 'num') num.push(tk.v)
    else if (tk.t === 'fn') {
      const a = num.pop() ?? 0
      if (tk.v === 'sin') num.push(Math.sin(a * d2r))
      else if (tk.v === 'cos') num.push(Math.cos(a * d2r))
      else if (tk.v === 'tan') num.push(Math.tan(a * d2r))
      else if (tk.v === 'sqrt') num.push(Math.sqrt(a))
    } else if (tk.t === 'op') {
      const b = num.pop() ?? 0, a = num.pop() ?? 0
      if (tk.v === '+') num.push(a + b)
      else if (tk.v === '-') num.push(a - b)
      else if (tk.v === '*') num.push(a * b)
      else if (tk.v === '/') num.push(a / b)
      else if (tk.v === '^') num.push(Math.pow(a, b))
    }
  }
  return num.length ? num[num.length - 1] : NaN
}

const KEYS: { label: string; ins?: string; kind?: string }[] = [
  { label: 'sin', ins: 'sin(', kind: 'fn' }, { label: 'cos', ins: 'cos(', kind: 'fn' }, { label: 'tan', ins: 'tan(', kind: 'fn' }, { label: '√', ins: '√(', kind: 'fn' },
  { label: '(', ins: '(' }, { label: ')', ins: ')' }, { label: 'π', ins: 'π', kind: 'fn' }, { label: '^', ins: '^', kind: 'op' },
  { label: '7', ins: '7' }, { label: '8', ins: '8' }, { label: '9', ins: '9' }, { label: '÷', ins: '÷', kind: 'op' },
  { label: '4', ins: '4' }, { label: '5', ins: '5' }, { label: '6', ins: '6' }, { label: '×', ins: '×', kind: 'op' },
  { label: '1', ins: '1' }, { label: '2', ins: '2' }, { label: '3', ins: '3' }, { label: '−', ins: '−', kind: 'op' },
  { label: '0', ins: '0' }, { label: '.', ins: '.' }, { label: '⌫', kind: 'del' }, { label: '+', ins: '+', kind: 'op' },
]

export function Calculator({ onClose }: { onClose: () => void }) {
  const [expr, setExpr] = useState('')
  const [result, setResult] = useState('')
  // After "=", the result becomes the running expression so the next op chains
  // from it (e.g. cos(15) = 0.966, then × 20 → 0.966 × 20, not cos(15) × 20).
  const [justEval, setJustEval] = useState(false)

  const press = (k: typeof KEYS[number]) => {
    if (k.kind === 'del') { setJustEval(false); setExpr((e) => e.slice(0, -1)); return }
    if (!k.ins) return
    const ins = k.ins
    if (justEval) {
      setJustEval(false)
      setResult('')
      // An operator keeps building on the just-computed value; anything else
      // (a digit, function, paren) starts a fresh calculation.
      setExpr((e) => (k.kind === 'op' ? e + ins : ins))
      return
    }
    setExpr((e) => e + ins)
  }
  const equals = () => {
    if (!expr.trim()) return
    const v = evaluate(expr)
    if (Number.isFinite(v)) {
      const s = (Math.round(v * 1e6) / 1e6).toString()
      setResult(s)
      setExpr(s)
      setJustEval(true)
    } else {
      setResult('oops!')
    }
  }

  return (
    <div className="calc">
      <div className="calc__bar">
        <span className="calc__title">🧮 Helper Calc</span>
        <span className="calc__deg">deg</span>
        <button type="button" className="calc__close" onClick={onClose} aria-label="Close calculator">✕</button>
      </div>
      <div className="calc__screen">
        <div className="calc__expr">{expr || '0'}</div>
        <div className="calc__result">{result !== '' ? `= ${result}` : ''}</div>
      </div>
      <div className="calc__pad">
        {KEYS.map((k) => (
          <button key={k.label} type="button" className={`calc__key${k.kind ? ' calc__key--' + k.kind : ''}`} onClick={() => press(k)}>{k.label}</button>
        ))}
        <button type="button" className="calc__key calc__key--clear" onClick={() => { setExpr(''); setResult(''); setJustEval(false) }}>C</button>
        <button type="button" className="calc__key calc__key--eq" onClick={equals}>=</button>
      </div>
    </div>
  )
}
