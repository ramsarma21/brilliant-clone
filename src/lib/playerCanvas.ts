// Standardised canvas rendering for YOUR PLAYER's lower body.
//
// Every drill draws the SAME person from behind, so the legs + shorts must look identical
// in all of them. This module is the single source of truth for that look. The shorts are
// ALWAYS white, the skin tone + proportions are fixed here, and the ONLY things a sim
// passes in are the colours that actually change with the loadout:
//   • sock  — always the same colour as the jersey
//   • boot / bootDark — the equipped cleat colour
// A sim supplies the pose (hip centre + the two foot anchors + a leg width) and calls
// drawPlayerLegs() BEFORE its torso, then drawPlayerShorts() AFTER its torso.

import { shade } from './playerKit'

// Fixed, shared look (NOT loadout-driven) — keeps the player identical across sims.
const SKIN = '#e8b58c'
const SHORTS = '#f2f5fb'
const SHORTS_DARK = '#cdd6e6'

// =====================================================================
// CANONICAL ATHLETIC BUILD
// One set of proportions shared by the card model AND every drill, so the player is the
// same athletic footballer everywhere. All values are fractions of the standing height H
// (top-of-head anchor → feet): smaller head, broad shoulders tapering to a lean waist,
// and LONG legs (hips at mid-height) for a realistic soccer build.
// =====================================================================
export const BUILD = {
  headR: 0.072,     // head radius (small head ⇒ tall/athletic read)
  neck: 0.045,      // short neck stub between head + shoulders
  shoulderY: 0.205, // shoulder line (below the head-top anchor)
  hipY: 0.5,        // hips at mid-height → legs are ~half the body (athletic)
  shoulderW: 0.248, // shoulders — athletic but NOT American-football-pad wide
  waistW: 0.2,      // lean waist (subtle V-taper)
  legW: 0.052,      // leg thickness
  armW: 0.044,      // arm thickness
} as const

export type BodyMetrics = {
  H: number
  headR: number
  neckH: number
  shoulderY: number
  hipY: number
  headCY: number
  shoulderW: number
  waistW: number
  legW: number
  armW: number
}

/**
 * Derive the canonical athletic proportions for a figure spanning `topY` (top-of-head
 * anchor) to `footY` (feet). The head centre (`headCY`) is placed just above the shoulders
 * on a short neck so the figure never floats on a long stalk. A sim keeps its own pose /
 * animation (foot anchors, lean, swing) but should DRAW the body from these metrics so the
 * head/torso/leg ratios match every other drill and the card.
 */
export function bodyMetrics(topY: number, footY: number): BodyMetrics {
  const H = Math.max(1, footY - topY)
  const headR = H * BUILD.headR
  const neckH = H * BUILD.neck
  const shoulderY = topY + H * BUILD.shoulderY
  return {
    H,
    headR,
    neckH,
    shoulderY,
    hipY: topY + H * BUILD.hipY,
    headCY: shoulderY - neckH - headR,
    shoulderW: H * BUILD.shoulderW,
    waistW: H * BUILD.waistW,
    legW: H * BUILD.legW,
    armW: H * BUILD.armW,
  }
}

/** Hip half-spread is derived from the leg width so the inseam gap is consistent. */
const HIP_HALF = (legW: number) => legW * 1.15

export type LegPose = {
  hipX: number
  hipY: number
  lFootX: number
  lFootY: number
  rFootX: number
  rFootY: number
  /** thigh stroke width (the bare-leg thickness). */
  legW: number
  /** sock colour — pass the jersey colour (kit.sock from the loadout). */
  sock: string
  /** boot colours — pass the equipped cleat colour. */
  boot: string
  bootDark: string
  detail: boolean
}

/** Legs (skin thigh → jersey-coloured sock shin) + sock cuffs + boots. Call BEFORE the torso. */
export function drawPlayerLegs(ctx: CanvasRenderingContext2D, p: LegPose): void {
  const { hipX, hipY, lFootX, lFootY, rFootX, rFootY, legW, sock, boot, bootDark, detail } = p
  const half = HIP_HALF(legW)
  const hipLx = hipX - half
  const hipRx = hipX + half
  const band = shade(sock, -0.2)

  const leg = (hx: number, fx: number, fy: number) => {
    const mx = (hx + fx) / 2, my = (hipY + fy) / 2
    const dx = fx - hx, dy = fy - hipY, len = Math.hypot(dx, dy) || 1
    const nx = -dy / len, ny = dx / len
    const bow = legW * 0.26
    const side = Math.sign(fx - hx) || 1
    let kx = mx + nx * bow, ky = my + ny * bow
    if ((kx - mx) * side < 0) { kx = mx - nx * bow; ky = my - ny * bow } // knee bows forward
    ctx.lineCap = 'round'
    ctx.strokeStyle = SKIN; ctx.lineWidth = legW * 1.06                 // thigh (skin)
    ctx.beginPath(); ctx.moveTo(hx, hipY); ctx.lineTo(kx, ky); ctx.stroke()
    ctx.strokeStyle = sock; ctx.lineWidth = legW * 0.92                 // shin (sock = jersey colour)
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke()
    if (detail) {                                                       // sock cuff band
      ctx.strokeStyle = band; ctx.lineWidth = legW * 0.92
      ctx.beginPath()
      ctx.moveTo(kx + (fx - kx) * 0.1, ky + (fy - ky) * 0.1)
      ctx.lineTo(kx + (fx - kx) * 0.24, ky + (fy - ky) * 0.24)
      ctx.stroke()
    }
  }
  leg(hipLx, lFootX, lFootY)
  leg(hipRx, rFootX, rFootY)

  const drawBoot = (fx: number, fy: number) => {
    const tilt = Math.max(-1, Math.min(1, (fx - hipX) / (half * 4 || 1))) * 0.32
    ctx.save(); ctx.translate(fx, fy); ctx.rotate(tilt)
    ctx.fillStyle = boot
    ctx.beginPath(); ctx.ellipse(0, 0, legW * 1.12, legW * 0.46, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = bootDark                                           // toe cap
    ctx.beginPath(); ctx.ellipse((Math.sign(tilt) || 1) * legW * 0.78, legW * 0.05, legW * 0.5, legW * 0.34, 0, 0, Math.PI * 2); ctx.fill()
    if (detail) {                                                      // sole shade
      ctx.fillStyle = bootDark
      ctx.beginPath(); ctx.ellipse(0, legW * 0.32, legW * 1.05, legW * 0.15, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }
  drawBoot(lFootX, lFootY)
  drawBoot(rFootX, rFootY)
}

/**
 * White football shorts seen from behind: a SHORT waistband across the hips that splits
 * into two NARROW thigh covers (top third of each thigh only) with a real inseam gap, so
 * the sock legs always show below. Always white — never loadout-driven. Call AFTER the torso.
 */
export function drawPlayerShorts(ctx: CanvasRenderingContext2D, p: LegPose): void {
  const { hipX, hipY, lFootX, lFootY, rFootX, rFootY, legW, detail } = p
  const half = HIP_HALF(legW)
  const hipLx = hipX - half
  const hipRx = hipX + half
  const coverW = legW * 1.1, thighFrac = 0.3, ch = coverW / 2
  const sLx = hipLx + (lFootX - hipLx) * thighFrac
  const sLy = hipY + (lFootY - hipY) * thighFrac
  const sRx = hipRx + (rFootX - hipRx) * thighFrac
  const sRy = hipY + (rFootY - hipY) * thighFrac
  const legSpanY = Math.max(Math.abs(lFootY - hipY), Math.abs(rFootY - hipY), legW * 4)
  const shortsH = Math.max(3, legSpanY * 0.2)
  const waistTopY = hipY - shortsH * 0.42
  const waistHalf = half + ch
  const wlx = hipX - waistHalf, wrx = hipX + waistHalf
  const apexY = hipY + shortsH * 0.16

  ctx.lineJoin = 'round'
  ctx.fillStyle = SHORTS
  ctx.beginPath()
  ctx.moveTo(wlx, waistTopY)                 // waistband, left
  ctx.lineTo(wrx, waistTopY)                 // waistband, right
  ctx.lineTo(sRx + ch, sRy)                  // right cover, outer hem
  ctx.lineTo(sRx - ch, sRy)                  // right cover, inner hem
  ctx.lineTo(hipX, apexY)                    // inseam V apex
  ctx.lineTo(sLx + ch, sLy)                  // left cover, inner hem
  ctx.lineTo(sLx - ch, sLy)                  // left cover, outer hem
  ctx.closePath()
  ctx.fill()
  if (detail) {
    ctx.strokeStyle = SHORTS_DARK; ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(1.5, coverW * 0.22)                       // hem cuffs
    ctx.beginPath(); ctx.moveTo(sLx - ch, sLy); ctx.lineTo(sLx + ch, sLy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(sRx - ch, sRy); ctx.lineTo(sRx + ch, sRy); ctx.stroke()
    ctx.lineWidth = Math.max(1, shortsH * 0.12)                        // waistband line
    ctx.beginPath(); ctx.moveTo(wlx + waistHalf * 0.1, waistTopY + ctx.lineWidth * 0.5); ctx.lineTo(wrx - waistHalf * 0.1, waistTopY + ctx.lineWidth * 0.5); ctx.stroke()
  }
  ctx.lineJoin = 'miter'
}

export type ArmPose = {
  /** torso centre x (shoulders are placed shoulderW/2 either side of this). */
  cx: number
  shoulderY: number
  shoulderW: number
  armW: number
  /** hand targets — sims supply these so the pose (idle / swing / reach / raise) is theirs. */
  lHandX: number
  lHandY: number
  rHandX: number
  rHandY: number
  /** jersey sleeve colour + its shade (upper arm), and the fixed skin tone for the forearm. */
  sleeve: string
  sleeveDark: string
}

/**
 * Default IDLE hand targets for an arms-at-the-side pose. Sims should use these for a
 * standing player (and add their own swing / reach / raise offsets on top) so every drill
 * starts from the SAME arm placement: hands hang to roughly hip height, just inside the
 * shoulder line.
 */
export function idleHands(cx: number, m: BodyMetrics): { lHandX: number; lHandY: number; rHandX: number; rHandY: number } {
  const handY = m.shoulderY + (m.hipY - m.shoulderY) * 1.02
  const reach = m.shoulderW * 0.42
  return { lHandX: cx - reach, lHandY: handY, rHandX: cx + reach, rHandY: handY }
}

function drawOneArm(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  hx: number,
  hy: number,
  armW: number,
  sleeve: string,
  sleeveDark: string,
): void {
  const dx = hx - sx
  const dy = hy - sy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // slight outward elbow bow so arms are not dead-straight sticks
  const bow = armW * 0.5
  const ex = sx + dx * 0.5 - uy * bow * Math.sign(dx || 1)
  const ey = sy + dy * 0.5 + ux * bow * Math.sign(dx || 1)

  ctx.lineCap = 'round'
  // skin arm (the forearm shows below the sleeve)
  ctx.strokeStyle = SKIN
  ctx.lineWidth = Math.max(1.6, armW)
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(ex, ey, hx, hy); ctx.stroke()
  // jersey sleeve over the upper arm (shoulder → ~elbow)
  const elbowFrac = 0.46
  const mx = sx + dx * elbowFrac
  const my = sy + dy * elbowFrac
  ctx.strokeStyle = sleeve
  ctx.lineWidth = Math.max(2, armW * 1.5)
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(mx, my); ctx.stroke()
  // sleeve hem shade at the cuff
  ctx.strokeStyle = sleeveDark
  ctx.lineWidth = Math.max(2, armW * 1.5)
  ctx.beginPath(); ctx.moveTo(mx - ux * armW * 0.3, my - uy * armW * 0.3); ctx.lineTo(mx, my); ctx.stroke()
  // hand
  ctx.fillStyle = SKIN
  ctx.beginPath(); ctx.arc(hx, hy, Math.max(1.4, armW * 0.6), 0, Math.PI * 2); ctx.fill()
  ctx.lineCap = 'butt'
}

/**
 * Both arms, drawn identically across every drill: a jersey sleeve over the upper arm, a
 * skin forearm, and a hand — matching the card model. Call AFTER the torso so the sleeves
 * sit over the shoulders. Shoulders are anchored at cx ± shoulderW/2 on the shoulder line.
 */
export function drawPlayerArms(ctx: CanvasRenderingContext2D, p: ArmPose): void {
  const shY = p.shoulderY + p.armW * 0.4
  const lShX = p.cx - p.shoulderW / 2
  const rShX = p.cx + p.shoulderW / 2
  drawOneArm(ctx, lShX, shY, p.lHandX, p.lHandY, p.armW, p.sleeve, p.sleeveDark)
  drawOneArm(ctx, rShX, shY, p.rHandX, p.rHandY, p.armW, p.sleeve, p.sleeveDark)
}
