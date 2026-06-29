// Shared third-person "behind the player" pitch renderer.
//
// Every drill (KinematicsSim, ForcesSim, MotionSim, EnergySim, DefenseSim, GoalieSim)
// draws the SAME world from the SAME camera: a lens pulled CAM_BACK metres behind the
// player and raised to EYE_Y, projecting metres → screen pixels on a fixed 900×560 stage.
// Each sim historically kept its OWN copy of this projection + player/ball/goal drawing.
// This module is the single, reusable source of that look so the MATCH transitions can be
// animated with the exact same visual language as the drills (same pitch, same kitted
// player from behind, same ball + goal), driven purely by scripted match-state plays.
//
// It reuses the canonical athletic build from playerCanvas.ts (legs / shorts / arms) so
// the figure is the identical footballer used everywhere else.

import { shade } from './playerKit'
import {
  drawPlayerLegs, drawPlayerShorts, bodyMetrics, drawPlayerArms, idleHands,
} from './playerCanvas'
import type { JerseyPattern } from '../types'

// ---- Camera / canvas (identical feel to every drill) ----
export const W = 900
export const H = 560
export const HORIZON = H * 0.4
export const EYE_Y = 2.4
export const FOCAL = 560
export const CAM_BACK = 6

// ---- World (metres) ----
export const BALL_R = 0.13
export const GOAL_W_HALF = 3.66 // regulation half-width (7.32 m goal)
export const CROSSBAR = 2.44 // regulation goal height

export type P2 = { sx: number; sy: number; scale: number }
export type V3 = { x: number; y: number; z: number }

// An optional pose that drives one foot to an exact screen point (the ball) and leans the
// body into the touch, so a kick/reach reads as real contact rather than a generic gait.
export type PlayerAction = { footX: number; footY: number; lean: number }

export type Kit = {
  jersey: string
  jerseyDark: string
  jerseyHi: string
  collar: string
  shorts: string
  shortsDark: string
  sock: string
  sockBand: string
  boot: string
  bootDark: string
  number: string
  num: number
  skin: string
  skinDark: string
  hair: string
  hairStyle: number
  face: 'back' | 'front'
  pattern?: JerseyPattern
  accent?: string
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const easeOut = (u: number) => 1 - (1 - u) * (1 - u)
export const easeIn = (u: number) => u * u
export const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)

// ============================================================================
// PROJECTION — metres → screen. `camX` pans the camera laterally (world metres),
// so a play can track the ball/action across the pitch while staying behind-view.
// ============================================================================
export function project(x: number, y: number, z: number, camX = 0): P2 {
  const cz = Math.max(0.05, z + CAM_BACK)
  const scale = FOCAL / cz
  return { sx: W / 2 + (x - camX) * scale, sy: HORIZON - (y - EYE_Y) * scale, scale }
}

export type Projector = (x: number, y: number, z: number) => P2
export const projectorFor = (camX = 0): Projector => (x, y, z) => project(x, y, z, camX)

// ============================================================================
// KITS
// ============================================================================
const SKIN = '#e8b48a'
const SKIN_DARK = '#c8895f'

// YOUR PLAYER base kit (faces away — runs up-pitch). usePlayerKit() injects the equipped
// jersey design (pattern + accent) + boots over this, so the match player matches the card.
export const BASE_YOU_KIT: Kit = {
  jersey: '#2f6df0', jerseyDark: '#1f4ec2', jerseyHi: '#6c9bff', collar: '#0d2f7a',
  shorts: '#eef2fb', shortsDark: '#c7d2e6', sock: '#2f6df0', sockBand: '#ffffff',
  boot: '#15171f', bootDark: '#05060a', number: '#ffffff', num: 9,
  skin: SKIN, skinDark: SKIN_DARK, hair: '#2c2016', hairStyle: 0, face: 'back',
}

/** Build a recoloured outfield kit from one primary jersey colour. */
export function makeKit(primary: string, opts: Partial<Kit> = {}): Kit {
  return {
    jersey: primary,
    jerseyDark: shade(primary, -0.3),
    jerseyHi: shade(primary, 0.34),
    collar: shade(primary, -0.5),
    shorts: '#eef2fb', shortsDark: '#c7d2e6',
    sock: primary, sockBand: '#ffffff',
    boot: '#15171f', bootDark: '#05060a',
    number: '#ffffff', num: 4,
    skin: SKIN, skinDark: SKIN_DARK,
    hair: '#1a130c', hairStyle: 3,
    face: 'front',
    ...opts,
  }
}

// ============================================================================
// STADIUM BACKGROUND (static, cached) — sky + stand + floodlights, identical to the drills.
// ============================================================================
export function buildStaticBackground(): HTMLCanvasElement {
  const ss = 2
  const c = document.createElement('canvas'); c.width = W * ss; c.height = H * ss
  const x = c.getContext('2d')!
  x.scale(ss, ss)
  const sky = x.createLinearGradient(0, 0, 0, HORIZON)
  sky.addColorStop(0, '#091025'); sky.addColorStop(0.55, '#172a55'); sky.addColorStop(1, '#27406f')
  x.fillStyle = sky; x.fillRect(0, 0, W, HORIZON + 2)
  x.fillStyle = '#101a36'; x.fillRect(0, HORIZON - 60, W, 26)
  for (let r = 0; r < 5; r++) for (let cc = 0; cc < 92; cc++) {
    const light = 50 + ((cc * 13 + r * 29) % 28)
    x.fillStyle = `hsla(${220 + ((cc * 7) % 50)}, 42%, ${light}%, 0.6)`
    x.fillRect(2 + cc * 9.8, HORIZON - 56 + r * 9, 7, 6)
  }
  const edge = x.createLinearGradient(0, HORIZON - 12, 0, HORIZON + 10)
  edge.addColorStop(0, 'rgba(120,150,220,0.18)'); edge.addColorStop(1, 'rgba(120,150,220,0)')
  x.fillStyle = edge; x.fillRect(0, HORIZON - 12, W, 22)
  for (const lx of [0.16, 0.84]) {
    const gl = x.createRadialGradient(W * lx, 14, 4, W * lx, 14, 90)
    gl.addColorStop(0, 'rgba(255,255,238,0.62)'); gl.addColorStop(1, 'rgba(255,255,238,0)')
    x.fillStyle = gl; x.fillRect(W * lx - 100, -16, 200, 150)
    x.fillStyle = 'rgba(255,255,240,0.95)'
    x.beginPath(); x.arc(W * lx, 14, 4.5, 0, Math.PI * 2); x.fill()
  }
  return c
}

export type Gradients = { grass: CanvasGradient; vignette: CanvasGradient }
export function buildGradients(ctx: CanvasRenderingContext2D): Gradients {
  const grass = ctx.createLinearGradient(0, HORIZON, 0, H)
  grass.addColorStop(0, '#1f7a37'); grass.addColorStop(1, '#2fa64e')
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.8)
  vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,0.42)')
  return { grass, vignette }
}

/** Grass fill + mown stripe bands (the bands pan with the camera). */
export function drawPitch(ctx: CanvasRenderingContext2D, grad: Gradients, camX = 0) {
  ctx.fillStyle = grad.grass; ctx.fillRect(-30, HORIZON, W + 60, H - HORIZON + 30)
  for (let zz = 0; zz < 60; zz += 2) {
    if ((Math.floor(zz / 2)) % 2 === 0) continue
    const a2 = project(-40, 0, zz + 0.6, camX), b2 = project(40, 0, zz + 0.6, camX)
    const c2 = project(40, 0, zz + 2.6, camX), d2 = project(-40, 0, zz + 2.6, camX)
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    ctx.beginPath(); ctx.moveTo(a2.sx, a2.sy); ctx.lineTo(b2.sx, b2.sy); ctx.lineTo(c2.sx, c2.sy); ctx.lineTo(d2.sx, d2.sy); ctx.closePath(); ctx.fill()
  }
}

function strokeWorldLine(ctx: CanvasRenderingContext2D, a: P2, b: P2) {
  ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
}

/**
 * Optional white pitch markings projected on the turf. `halfwayZ` draws a halfway line +
 * centre circle there; `boxZ` draws a penalty box whose goal line sits at boxZ.
 */
export function drawPitchMarkings(
  ctx: CanvasRenderingContext2D,
  opts: { camX?: number; halfwayZ?: number; boxZ?: number; centerSpotZ?: number } = {},
) {
  const camX = opts.camX ?? 0
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  if (opts.halfwayZ != null) {
    const z = opts.halfwayZ
    strokeWorldLine(ctx, project(-40, 0, z, camX), project(40, 0, z, camX))
    // centre circle (radius ~9.15 m)
    ctx.beginPath()
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2
      const p = project(Math.cos(a) * 9.15, 0, z + Math.sin(a) * 9.15, camX)
      if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy)
    }
    ctx.stroke()
  }
  if (opts.centerSpotZ != null) {
    const p = project(0, 0, opts.centerSpotZ, camX)
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.beginPath(); ctx.ellipse(p.sx, p.sy, Math.max(2, p.scale * 0.12), Math.max(1, p.scale * 0.05), 0, 0, Math.PI * 2); ctx.fill()
  }
  if (opts.boxZ != null) {
    const gz = opts.boxZ
    const boxDepth = 16.5
    const boxHalf = 20.16
    const sixHalf = 9.16
    const sixDepth = 5.5
    // 18-yard box
    strokeWorldLine(ctx, project(-boxHalf, 0, gz, camX), project(-boxHalf, 0, gz + boxDepth, camX))
    strokeWorldLine(ctx, project(boxHalf, 0, gz, camX), project(boxHalf, 0, gz + boxDepth, camX))
    strokeWorldLine(ctx, project(-boxHalf, 0, gz + boxDepth, camX), project(boxHalf, 0, gz + boxDepth, camX))
    // 6-yard box
    strokeWorldLine(ctx, project(-sixHalf, 0, gz, camX), project(-sixHalf, 0, gz + sixDepth, camX))
    strokeWorldLine(ctx, project(sixHalf, 0, gz, camX), project(sixHalf, 0, gz + sixDepth, camX))
    strokeWorldLine(ctx, project(-sixHalf, 0, gz + sixDepth, camX), project(sixHalf, 0, gz + sixDepth, camX))
    // goal line
    strokeWorldLine(ctx, project(-40, 0, gz, camX), project(40, 0, gz, camX))
  }
  ctx.restore()
}

/** Full background pass: clear, stadium image, grass, stripes. Caller supplies cached bg+grad. */
export function drawWorld(
  ctx: CanvasRenderingContext2D,
  bg: HTMLCanvasElement,
  grad: Gradients,
  camX = 0,
) {
  ctx.fillStyle = '#08102a'; ctx.fillRect(-30, -30, W + 60, H + 60)
  ctx.drawImage(bg, 0, 0, W, H)
  drawPitch(ctx, grad, camX)
}

export function drawVignette(ctx: CanvasRenderingContext2D, grad: Gradients) {
  ctx.fillStyle = grad.vignette; ctx.fillRect(-30, -30, W + 60, H + 60)
}

// ============================================================================
// BALL
// ============================================================================
export function drawBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, spin: number, squash = 0) {
  ctx.save(); ctx.translate(cx, cy + r * squash * 0.5); ctx.rotate(spin * 0.2)
  ctx.scale(1 + squash * 0.5, 1 - squash * 0.5)
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r)
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#e9edf2'); g.addColorStop(1, '#b9c2cc')
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#1b1f2a'
  const pent = (px: number, py: number, sz: number) => {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const ang = (Math.PI * 2 * i) / 5 - Math.PI / 2 + spin * 0.2
      const vx = px + Math.cos(ang) * sz, vy = py + Math.sin(ang) * sz
      if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy)
    }
    ctx.closePath(); ctx.fill()
  }
  pent(0, 0, r * 0.32)
  for (let i = 0; i < 5; i++) {
    const ang = (Math.PI * 2 * i) / 5 - Math.PI / 2 + spin * 0.2
    pent(Math.cos(ang) * r * 0.62, Math.sin(ang) * r * 0.62, r * 0.16)
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

/** Draw the world ball at metres (x,y,z) with a ground shadow. */
export function drawWorldBall(ctx: CanvasRenderingContext2D, pos: V3, spin: number, squash = 0, camX = 0) {
  const bp = project(pos.x, pos.y, pos.z, camX)
  const sh = project(pos.x, 0, pos.z, camX)
  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  ctx.beginPath(); ctx.ellipse(sh.sx, sh.sy, Math.max(4, BALL_R * sh.scale * 1.3), Math.max(2, BALL_R * sh.scale * 0.5), 0, 0, Math.PI * 2); ctx.fill()
  drawBall(ctx, bp.sx, bp.sy, Math.max(3, Math.min(74, BALL_R * bp.scale)), spin, squash)
}

// ============================================================================
// PLAYER (kitted, canonical athletic build, faithful to the drills)
// ============================================================================
function drawHair(ctx: CanvasRenderingContext2D, cx: number, headY: number, headR: number, style: number, color: string, back = false) {
  ctx.fillStyle = color
  if (back) {
    ctx.beginPath(); ctx.arc(cx, headY + headR * 0.06, headR * 1.04, Math.PI * 0.86, Math.PI * 2.14); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cx, headY + headR * 0.1, headR * 0.95, headR * 1.0, 0, 0, Math.PI * 2); ctx.fill()
    if (style === 2) { ctx.beginPath(); ctx.arc(cx, headY - headR * 0.95, headR * 0.4, 0, Math.PI * 2); ctx.fill() }
    if (style === 3) {
      ctx.fillRect(cx - headR * 1.04, headY - headR * 0.1, headR * 0.32, headR * 1.0)
      ctx.fillRect(cx + headR * 0.72, headY - headR * 0.1, headR * 0.32, headR * 1.0)
    }
    return
  }
  if (style === 1) {
    ctx.beginPath(); ctx.arc(cx, headY - headR * 0.06, headR * 0.92, Math.PI * 1.02, Math.PI * 1.98); ctx.fill()
  } else if (style === 2) {
    ctx.beginPath(); ctx.arc(cx, headY - headR * 0.18, headR, Math.PI * 1.05, Math.PI * 1.95); ctx.fill()
    ctx.beginPath(); ctx.arc(cx, headY - headR * 1.05, headR * 0.42, 0, Math.PI * 2); ctx.fill()
  } else if (style === 3) {
    ctx.beginPath(); ctx.arc(cx, headY - headR * 0.12, headR * 1.06, Math.PI * 0.92, Math.PI * 2.08); ctx.fill()
    ctx.fillRect(cx - headR * 1.02, headY - headR * 0.2, headR * 0.34, headR * 1.1)
    ctx.fillRect(cx + headR * 0.68, headY - headR * 0.2, headR * 0.34, headR * 1.1)
  } else {
    ctx.beginPath(); ctx.arc(cx, headY - headR * 0.18, headR, Math.PI * 1.04, Math.PI * 1.96); ctx.fill()
  }
}

function drawJerseyPattern(
  ctx: CanvasRenderingContext2D, pattern: JerseyPattern, accent: string,
  cx: number, top: number, bot: number, shoulderW: number, waistW: number,
) {
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(cx - shoulderW / 2, top)
  ctx.lineTo(cx + shoulderW / 2, top)
  ctx.lineTo(cx + waistW / 2, bot)
  ctx.lineTo(cx - waistW / 2, bot)
  ctx.closePath(); ctx.clip()
  ctx.fillStyle = accent
  const w = shoulderW, h = bot - top, left = cx - w / 2
  switch (pattern) {
    case 'stripes': {
      const cols = 6
      const sw = w / (cols * 2 - 1)
      for (let i = 0; i < cols; i++) ctx.fillRect(left + i * sw * 2, top, sw, h)
      break
    }
    case 'hoops': {
      const rows = 5
      const hh = h / (rows * 2 - 1)
      for (let i = 0; i < rows; i++) ctx.fillRect(cx - w, top + i * hh * 2, w * 2, hh)
      break
    }
    case 'sash': {
      ctx.lineCap = 'butt'
      ctx.strokeStyle = accent
      ctx.lineWidth = Math.max(2, w * 0.3)
      ctx.beginPath()
      ctx.moveTo(cx - w * 0.7, bot + h * 0.12)
      ctx.lineTo(cx + w * 0.7, top - h * 0.12)
      ctx.stroke()
      break
    }
    case 'halves': {
      ctx.fillRect(cx, top - 1, w, h + 2)
      break
    }
    case 'galaxy': {
      const flecks: [number, number][] = [
        [0.28, 0.18], [0.62, 0.3], [0.42, 0.52], [0.72, 0.64], [0.24, 0.72],
        [0.78, 0.2], [0.5, 0.82], [0.36, 0.4], [0.66, 0.86],
      ]
      const r = Math.max(1, w * 0.055)
      for (const [fxp, fyp] of flecks) {
        ctx.beginPath(); ctx.arc(left + fxp * w, top + fyp * h, r, 0, Math.PI * 2); ctx.fill()
      }
      break
    }
    default: break
  }
  ctx.restore()
}

/**
 * Draw a kitted player from already-projected feet + head anchors. Faithful to the drills'
 * figure: shared athletic build, jersey trapezoid + pattern, white shorts (or the player's
 * own), sock-coloured shins, boots, arms, head + hair (back of head when face='back').
 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D, feet: P2, head: P2, kit: Kit, now: number,
  running: boolean, hasBall: boolean, action?: PlayerAction,
) {
  const scale = feet.scale
  if (scale < 4 || scale > 360) return
  const ph = now / 80
  const bob = running ? Math.abs(Math.sin(ph)) * 0.055 * scale : 0
  const cx = feet.sx
  const footY = feet.sy - bob
  const headY = head.sy - bob
  const back = kit.face === 'back'
  const m = bodyMetrics(headY, footY)
  const wBody = Math.max(5, 0.4 * scale)
  const hipY = m.hipY
  const lw = m.legW
  const headR = m.headR
  const headCY = m.headCY
  const shoulderY = m.shoulderY
  const torsoH = hipY - shoulderY + 2
  const leanX = action ? clamp(action.lean, -1, 1) * wBody * 0.55 : 0
  const cxU = cx + leanX
  const hipX = cx + leanX
  const detail = scale > 24

  ctx.fillStyle = 'rgba(0,0,0,0.26)'
  ctx.beginPath(); ctx.ellipse(cx, feet.sy + 1, wBody * 0.95, wBody * 0.32, 0, 0, Math.PI * 2); ctx.fill()

  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  let footLx: number, footLy: number, footRx: number, footRy: number
  if (action) {
    const dir = Math.sign(action.footX - cx) || 1
    footRx = action.footX; footRy = action.footY
    footLx = cx - dir * wBody * 0.34; footLy = footY
  } else {
    const swing = running ? Math.sin(ph) * 0.28 * scale : wBody * 0.4
    const lift = running ? Math.max(0, Math.cos(ph)) * 0.15 * scale : 0
    footLx = cx - swing; footLy = footY - lift
    footRx = cx + swing; footRy = footY
  }

  const pose = {
    hipX, hipY,
    lFootX: footLx, lFootY: footLy,
    rFootX: footRx, rFootY: footRy,
    legW: lw,
    sock: kit.sock,
    boot: kit.boot,
    bootDark: kit.bootDark ?? kit.boot,
    skin: kit.skin,
    shorts: back ? kit.shorts : undefined,
    shortsDark: back ? kit.shortsDark : undefined,
    detail,
  }
  drawPlayerLegs(ctx, pose)

  const neckTop = headCY + headR * 0.9
  const neckW = headR * 0.8
  ctx.fillStyle = kit.skin
  ctx.beginPath()
  ctx.moveTo(cxU - neckW * 0.78, neckTop); ctx.lineTo(cxU + neckW * 0.78, neckTop)
  ctx.lineTo(cxU + neckW, shoulderY + 1); ctx.lineTo(cxU - neckW, shoulderY + 1)
  ctx.closePath(); ctx.fill()
  ctx.fillStyle = kit.skinDark
  ctx.fillRect(cxU + neckW * 0.12, neckTop, neckW * 0.62, shoulderY + 1 - neckTop)

  const shoulderW = m.shoulderW
  const waistW = m.waistW
  ctx.fillStyle = kit.jersey
  ctx.beginPath()
  ctx.moveTo(cxU - shoulderW / 2, shoulderY)
  ctx.lineTo(cxU + shoulderW / 2, shoulderY)
  ctx.lineTo(cxU + waistW / 2, hipY + 1)
  ctx.lineTo(cxU - waistW / 2, hipY + 1)
  ctx.closePath(); ctx.fill()
  ctx.save(); ctx.clip()
  ctx.fillStyle = kit.jerseyDark; ctx.fillRect(cxU + wBody * 0.12, shoulderY, wBody * 0.4, torsoH + 2)
  ctx.fillStyle = kit.jerseyHi; ctx.fillRect(cxU - shoulderW * 0.46, shoulderY + torsoH * 0.1, wBody * 0.12, torsoH * 0.62)
  ctx.restore()
  if (back && scale > 14 && kit.pattern && kit.pattern !== 'plain') {
    drawJerseyPattern(ctx, kit.pattern, kit.accent ?? kit.jerseyHi, cxU, shoulderY, hipY + 1, shoulderW, waistW)
  }

  drawPlayerShorts(ctx, pose)

  const armSwing = running ? Math.sin(ph + Math.PI) * 0.16 * scale : 0
  const armBal = action ? -leanX * 0.5 : 0
  const hands = idleHands(cxU, m)
  drawPlayerArms(ctx, {
    cx: cxU,
    shoulderY: m.shoulderY,
    shoulderW: m.shoulderW,
    armW: m.armW,
    lHandX: hands.lHandX - armSwing + armBal,
    lHandY: hands.lHandY,
    rHandX: hands.rHandX + armSwing + armBal,
    rHandY: hands.rHandY,
    sleeve: kit.jersey,
    sleeveDark: kit.jerseyDark,
    skin: kit.skin,
  })

  ctx.fillStyle = kit.collar; ctx.fillRect(cxU - wBody * 0.2, shoulderY, wBody * 0.4, Math.max(1.5, torsoH * 0.1))
  if (wBody > 9) {
    ctx.fillStyle = kit.number
    ctx.font = `800 ${Math.round(wBody * 0.5)}px Plus Jakarta Sans, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(kit.num), cxU, shoulderY + torsoH * 0.52)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }

  if (hasBall) {
    const br = Math.max(4, BALL_R * scale)
    const bx = cx + wBody * 0.5
    const by = feet.sy
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.ellipse(bx, by + 2, br * 1.2, br * 0.45, 0, 0, Math.PI * 2); ctx.fill()
    drawBall(ctx, bx, by - br * 0.7, br, now / 320, 0)
  }

  if (detail) {
    ctx.fillStyle = kit.skin
    ctx.beginPath(); ctx.arc(cxU - headR * 0.95, headCY + headR * 0.05, headR * 0.28, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(cxU + headR * 0.95, headCY + headR * 0.05, headR * 0.28, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = kit.skin; ctx.beginPath(); ctx.arc(cxU, headCY, headR, 0, Math.PI * 2); ctx.fill()
  if (!back) {
    ctx.save()
    ctx.beginPath(); ctx.arc(cxU, headCY, headR, 0, Math.PI * 2); ctx.clip()
    ctx.fillStyle = kit.skinDark
    ctx.beginPath(); ctx.ellipse(cxU + headR * 0.55, headCY + headR * 0.2, headR * 0.7, headR, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
  drawHair(ctx, cxU, headCY, headR, kit.hairStyle, kit.hair, back)
  if (detail && !back) {
    const eyeDX = headR * 0.4, eyeY = headCY + headR * 0.04, eyeR = Math.max(0.9, headR * 0.13)
    ctx.strokeStyle = 'rgba(40,28,18,0.6)'; ctx.lineWidth = Math.max(1, headR * 0.1)
    ctx.beginPath(); ctx.moveTo(cxU - eyeDX * 1.3, eyeY - headR * 0.28); ctx.lineTo(cxU - eyeDX * 0.4, eyeY - headR * 0.34); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cxU + eyeDX * 0.4, eyeY - headR * 0.34); ctx.lineTo(cxU + eyeDX * 1.3, eyeY - headR * 0.28); ctx.stroke()
    ctx.fillStyle = '#24180e'
    ctx.beginPath(); ctx.arc(cxU - eyeDX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(cxU + eyeDX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill()
  }
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'
}

/** Project world (x,z) feet + head and draw the player there. */
export function drawWorldPlayer(
  ctx: CanvasRenderingContext2D, pos: { x: number; z: number }, kit: Kit, now: number,
  running: boolean, hasBall: boolean, action?: PlayerAction, camX = 0,
) {
  drawPlayer(ctx, project(pos.x, 0, pos.z, camX), project(pos.x, 1.84, pos.z, camX), kit, now, running, hasBall, action)
}

// ============================================================================
// GOAL (white frame + net), faithful to KinematicsSim's drawGoal.
// ============================================================================
function lerpP(a: P2, b: P2, t: number): P2 {
  return { sx: lerp(a.sx, b.sx, t), sy: lerp(a.sy, b.sy, t), scale: lerp(a.scale, b.scale, t) }
}

export function drawGoal(ctx: CanvasRenderingContext2D, z: number, camX = 0, shake = 0) {
  const rel: Projector = (x, y, zz) => project(x, y, zz, camX)
  const back = z + 1.1
  const tl = rel(-GOAL_W_HALF, CROSSBAR, z), tr = rel(GOAL_W_HALF, CROSSBAR, z)
  const bl = rel(-GOAL_W_HALF, 0, z), br = rel(GOAL_W_HALF, 0, z)
  const tlB = rel(-GOAL_W_HALF, CROSSBAR, back), trB = rel(GOAL_W_HALF, CROSSBAR, back)
  const blB = rel(-GOAL_W_HALF, 0, back), brB = rel(GOAL_W_HALF, 0, back)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    strokeWorldLine(ctx, lerpP(tlB, trB, t), lerpP(blB, brB, t))
    strokeWorldLine(ctx, lerpP(tlB, blB, t), lerpP(trB, brB, t))
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  strokeWorldLine(ctx, tl, tlB); strokeWorldLine(ctx, tr, trB); strokeWorldLine(ctx, bl, blB); strokeWorldLine(ctx, br, brB)
  if (shake > 0.4) { ctx.strokeStyle = 'rgba(255,255,255,0.4)'; for (let i = 1; i < 5; i++) strokeWorldLine(ctx, lerpP(tlB, trB, i / 5), lerpP(blB, brB, i / 5)) }
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(4, 0.1 * tl.scale); ctx.lineCap = 'round'
  strokeWorldLine(ctx, bl, tl); strokeWorldLine(ctx, br, tr); strokeWorldLine(ctx, tl, tr)
  ctx.lineCap = 'butt'
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}
