import type { ReactNode } from 'react'
import type { QuestionDiagram as Diagram } from '../types'

// Programmatic SVG diagrams for AP-style questions. NO raster images — every
// figure is drawn from parameters so it is physically accurate, responsive, and
// restyleable. Used by the test, the post-game review, and (later) the match.
//
// Param shapes per kind (all coordinates in the diagram's own units):
//  position-time / velocity-time / force-time:
//    { xLabel?, yLabel?, xMax?, yMax?, shade?, lines: [{ points:[[x,y]...], color?, label? }] }
//  free-body:
//    { bodyLabel?, forces: [{ dir:'up'|'down'|'left'|'right', label, mag? }] }
//  ramp:        { angleDeg, blockLabel?, showForces? }
//  projectile:  { angleDeg?, label?, vLabel? }
//  collision:   { left:{ m, v, label? }, right:{ m, v, label? } }

type Pt = [number, number]
type Line = { points: Pt[]; color?: string; label?: string }

const COLORS = ['#7c5cff', '#12b074', '#ff6ec7', '#d98306']
const AXIS = '#8388a8'
const INK = '#221f43'

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

// ---------- Generic XY line graph (position-time, velocity-time, force-time) ----------
function LineGraph({ params, yDefault }: { params: Record<string, unknown>; yDefault: string }) {
  const W = 280
  const H = 200
  const pad = { l: 40, r: 14, t: 14, b: 34 }
  const lines = (params.lines as Line[] | undefined) ?? []
  const xLabel = (params.xLabel as string) ?? 'time (s)'
  const yLabel = (params.yLabel as string) ?? yDefault
  const shade = Boolean(params.shade)

  const allPts = lines.flatMap((l) => l.points)
  const xMax = num(params.xMax, Math.max(1, ...allPts.map((p) => p[0])))
  const yMaxRaw = num(params.yMax, Math.max(1, ...allPts.map((p) => p[1])))
  const yMin = Math.min(0, ...allPts.map((p) => p[1]))
  const yMax = yMaxRaw <= yMin ? yMin + 1 : yMaxRaw

  const sx = (x: number) => pad.l + (x / xMax) * (W - pad.l - pad.r)
  const sy = (y: number) => H - pad.b - ((y - yMin) / (yMax - yMin)) * (H - pad.t - pad.b)

  const ticks = 4
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="qdiagram qdiagram--graph" role="img">
      {/* gridlines */}
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const gx = pad.l + (i / ticks) * (W - pad.l - pad.r)
        const gy = pad.t + (i / ticks) * (H - pad.t - pad.b)
        return (
          <g key={i}>
            <line x1={gx} y1={pad.t} x2={gx} y2={H - pad.b} stroke="#e9e7fb" strokeWidth={1} />
            <line x1={pad.l} y1={gy} x2={W - pad.r} y2={gy} stroke="#e9e7fb" strokeWidth={1} />
          </g>
        )
      })}
      {/* axes */}
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke={AXIS} strokeWidth={1.5} />
      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke={AXIS} strokeWidth={1.5} />
      {/* zero line if data goes negative */}
      {yMin < 0 && (
        <line x1={pad.l} y1={sy(0)} x2={W - pad.r} y2={sy(0)} stroke={AXIS} strokeWidth={1} strokeDasharray="3 3" />
      )}
      {/* shaded area under the first line (impulse = area under F-t) */}
      {shade && lines[0] && lines[0].points.length > 1 && (
        <polygon
          points={[
            `${sx(lines[0].points[0][0])},${sy(0)}`,
            ...lines[0].points.map((p) => `${sx(p[0])},${sy(p[1])}`),
            `${sx(lines[0].points[lines[0].points.length - 1][0])},${sy(0)}`,
          ].join(' ')}
          fill="rgba(124,92,255,0.16)"
        />
      )}
      {/* data lines */}
      {lines.map((l, i) => (
        <polyline
          key={i}
          points={l.points.map((p) => `${sx(p[0])},${sy(p[1])}`).join(' ')}
          fill="none"
          stroke={l.color ?? COLORS[i % COLORS.length]}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {/* labels */}
      <text x={(W + pad.l) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={INK}>{xLabel}</text>
      <text x={12} y={(H - pad.b + pad.t) / 2} textAnchor="middle" fontSize={11} fill={INK}
        transform={`rotate(-90 12 ${(H - pad.b + pad.t) / 2})`}>{yLabel}</text>
    </svg>
  )
}

// ---------- Free-body diagram ----------
function FreeBody({ params }: { params: Record<string, unknown> }) {
  const W = 240, H = 200, cx = W / 2, cy = H / 2, half = 26
  const forces = (params.forces as { dir: string; label: string; mag?: number }[] | undefined) ?? []
  const bodyLabel = (params.bodyLabel as string) ?? ''
  const maxMag = Math.max(1, ...forces.map((f) => num(f.mag, 1)))
  const L = 60
  const vec: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="qdiagram qdiagram--fbd" role="img">
      <rect x={cx - half} y={cy - half} width={half * 2} height={half * 2} rx={6}
        fill="#efebff" stroke="#7c5cff" strokeWidth={2} />
      {bodyLabel && <text x={cx} y={cy + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill={INK}>{bodyLabel}</text>}
      <defs>
        <marker id="fbdArrow" markerWidth={9} markerHeight={9} refX={6} refY={3} orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#d6314b" />
        </marker>
      </defs>
      {forces.map((f, i) => {
        const [dx, dy] = vec[f.dir] ?? [0, 0]
        const len = half + 8 + (num(f.mag, 1) / maxMag) * L
        const x2 = cx + dx * len, y2 = cy + dy * len
        const sx = cx + dx * (half + 6), sy = cy + dy * (half + 6)
        return (
          <g key={i}>
            <line x1={sx} y1={sy} x2={x2} y2={y2} stroke="#d6314b" strokeWidth={2.5} markerEnd="url(#fbdArrow)" />
            <text x={x2 + dx * 10} y={y2 + dy * 14 + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#d6314b">{f.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ---------- Inclined ramp ----------
function Ramp({ params }: { params: Record<string, unknown> }) {
  const W = 260, H = 180
  const angle = num(params.angleDeg, 30)
  const blockLabel = (params.blockLabel as string) ?? 'm'
  const x0 = 30, y0 = H - 28
  const base = 200
  const rise = base * Math.tan((angle * Math.PI) / 180)
  const topX = x0, topY = y0 - Math.min(rise, H - 50)
  const adj = (y0 - topY) / Math.tan((angle * Math.PI) / 180)
  const botX = x0 + adj
  // block sits partway up the incline
  const t = 0.55
  const bx = topX + (botX - topX) * t
  const by = topY + (y0 - topY) * t
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="qdiagram qdiagram--ramp" role="img">
      <polygon points={`${x0},${y0} ${botX},${y0} ${topX},${topY}`} fill="#efebff" stroke="#7c5cff" strokeWidth={2} />
      <line x1={x0} y1={y0} x2={botX + 24} y2={y0} stroke={AXIS} strokeWidth={1.5} />
      <rect x={bx - 12} y={by - 22} width={24} height={18} rx={3} fill="#12b074" stroke="#0c8f66" strokeWidth={1.5}
        transform={`rotate(${-angle} ${bx} ${by - 13})`} />
      <text x={bx + 4} y={by - 26} fontSize={12} fontWeight={700} fill={INK}>{blockLabel}</text>
      <text x={x0 + 26} y={y0 - 6} fontSize={11} fill={INK}>{angle}°</text>
      <path d={`M ${x0 + 22} ${y0} A 22 22 0 0 0 ${x0 + 22 * Math.cos((angle * Math.PI) / 180)} ${y0 - 22 * Math.sin((angle * Math.PI) / 180)}`}
        fill="none" stroke={AXIS} strokeWidth={1.2} />
    </svg>
  )
}

// ---------- Projectile launch ----------
function Projectile({ params }: { params: Record<string, unknown> }) {
  const W = 280, H = 180
  const angle = num(params.angleDeg, 40)
  const vLabel = (params.vLabel as string) ?? 'v'
  const x0 = 30, y0 = H - 28
  const rad = (angle * Math.PI) / 180
  // arc apex scales with angle
  const range = 210
  const apex = (range / 4) * Math.tan(rad)
  const midX = x0 + range / 2
  const apexY = y0 - Math.min(apex, H - 50)
  const endX = x0 + range
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="qdiagram qdiagram--proj" role="img">
      <line x1={10} y1={y0} x2={W - 10} y2={y0} stroke={AXIS} strokeWidth={1.5} />
      <path d={`M ${x0} ${y0} Q ${midX} ${apexY - (apexY - y0)} ${endX} ${y0}`} fill="none"
        stroke="#7c5cff" strokeWidth={2} strokeDasharray="5 4" />
      <defs>
        <marker id="projArrow" markerWidth={9} markerHeight={9} refX={6} refY={3} orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#d6314b" />
        </marker>
      </defs>
      <line x1={x0} y1={y0} x2={x0 + 46 * Math.cos(rad)} y2={y0 - 46 * Math.sin(rad)}
        stroke="#d6314b" strokeWidth={2.5} markerEnd="url(#projArrow)" />
      <text x={x0 + 50 * Math.cos(rad) + 6} y={y0 - 46 * Math.sin(rad)} fontSize={12} fontWeight={700} fill="#d6314b">{vLabel}</text>
      <text x={x0 + 24} y={y0 - 6} fontSize={11} fill={INK}>{angle}°</text>
      <circle cx={x0} cy={y0} r={4} fill="#221f43" />
    </svg>
  )
}

// ---------- Collision (two bodies + velocity arrows) ----------
function Collision({ params }: { params: Record<string, unknown> }) {
  const W = 280, H = 150, cy = 80
  const left = (params.left as { m: number; v: number; label?: string }) ?? { m: 1, v: 0 }
  const right = (params.right as { m: number; v: number; label?: string }) ?? { m: 1, v: 0 }
  const maxM = Math.max(1, num(left.m, 1), num(right.m, 1))
  const maxV = Math.max(1, Math.abs(num(left.v)), Math.abs(num(right.v)))
  const rOf = (m: number) => 14 + (num(m, 1) / maxM) * 18
  const arrow = (cx: number, v: number, color: string) => {
    if (!v) return null
    const dir = Math.sign(v)
    const len = 12 + (Math.abs(v) / maxV) * 34
    return (
      <line x1={cx} y1={cy - 34} x2={cx + dir * len} y2={cy - 34} stroke={color} strokeWidth={2.5} markerEnd="url(#colArrow)" />
    )
  }
  const lx = 80, rx = 200
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="qdiagram qdiagram--collision" role="img">
      <defs>
        <marker id="colArrow" markerWidth={9} markerHeight={9} refX={6} refY={3} orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#221f43" />
        </marker>
      </defs>
      <line x1={10} y1={cy + rOf(maxM)} x2={W - 10} y2={cy + rOf(maxM)} stroke={AXIS} strokeWidth={1.5} />
      <circle cx={lx} cy={cy} r={rOf(left.m)} fill="#efebff" stroke="#7c5cff" strokeWidth={2} />
      <text x={lx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>{left.label ?? 'A'}</text>
      {arrow(lx, num(left.v), '#d6314b')}
      <circle cx={rx} cy={cy} r={rOf(right.m)} fill="#d9fbec" stroke="#12b074" strokeWidth={2} />
      <text x={rx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>{right.label ?? 'B'}</text>
      {arrow(rx, num(right.v), '#0c8f66')}
    </svg>
  )
}

export function QuestionDiagram({ diagram }: { diagram: Diagram }) {
  const { kind, params, caption } = diagram
  let body: ReactNode = null
  switch (kind) {
    case 'position-time':
      body = <LineGraph params={params} yDefault="position (m)" />
      break
    case 'velocity-time':
      body = <LineGraph params={params} yDefault="velocity (m/s)" />
      break
    case 'force-time':
      body = <LineGraph params={{ ...params, shade: params.shade ?? true }} yDefault="force (N)" />
      break
    case 'free-body':
      body = <FreeBody params={params} />
      break
    case 'ramp':
      body = <Ramp params={params} />
      break
    case 'projectile':
      body = <Projectile params={params} />
      break
    case 'collision':
      body = <Collision params={params} />
      break
    default:
      body = null
  }
  if (!body) return null
  return (
    <figure className="qdiagram-wrap">
      {body}
      {caption && <figcaption className="qdiagram-caption">{caption}</figcaption>}
    </figure>
  )
}
