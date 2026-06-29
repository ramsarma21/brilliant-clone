// Tiny vector helpers for the sim. The pitch lives on the X/Z ground plane (Y is up),
// so most gameplay math is 2D (x, z); the ball additionally tracks height y.

export type Vec2 = { x: number; z: number }
export type Vec3 = { x: number; y: number; z: number }

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : clamp((v - a) / (b - a), 0, 1))
export const mix = (a: number, b: number, t: number) => a + (b - a) * t

export const v2 = (x = 0, z = 0): Vec2 => ({ x, z })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z })
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s })
export const len = (a: Vec2): number => Math.hypot(a.x, a.z)
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z)
export const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x, dz = a.z - b.z
  return dx * dx + dz * dz
}
export function norm(a: Vec2): Vec2 {
  const l = len(a)
  return l < 1e-6 ? { x: 0, z: 0 } : { x: a.x / l, z: a.z / l }
}
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z
/** Clamp a vector's magnitude to `max`. */
export function limit(a: Vec2, max: number): Vec2 {
  const l = len(a)
  return l > max && l > 1e-6 ? { x: (a.x / l) * max, z: (a.z / l) * max } : a
}
/** Move `cur` toward `target` by at most `maxStep`. */
export function moveToward(cur: number, target: number, maxStep: number): number {
  if (cur < target) return Math.min(cur + maxStep, target)
  return Math.max(cur - maxStep, target)
}
/** Shortest signed angular difference b - a, wrapped to [-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}
export const headingOf = (dir: Vec2): number => Math.atan2(dir.x, dir.z)
export const dirFromHeading = (h: number): Vec2 => ({ x: Math.sin(h), z: Math.cos(h) })

/** Rotate a 2D vector by `rad` radians (CCW in the x/z plane). */
export function rot2(v: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad), s = Math.sin(rad)
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c }
}
/** Left-hand perpendicular of a 2D vector. */
export const perp = (v: Vec2): Vec2 => ({ x: -v.z, z: v.x })

// ---- Vec3 helpers (the ball lives in 3D: x/z ground + y height) ----
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
/** Cross product a × b (used for the Magnus force: spin × velocity). */
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

/** Deterministic 32-bit hash → [0,1), used to seed opponent strength from a club name. */
export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/** Small seeded RNG (mulberry32) for reproducible per-match variance. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
