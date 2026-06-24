// Deterministic physics utilities for algebra-based intro physics.
// All functions are pure so they can be reused and unit-tested.

export const G_EARTH = 9.8

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

// ----- Projectile motion (flat ground, no air resistance) -----

export type ProjectileResult = {
  vx: number
  vy: number
  timeOfFlight: number
  range: number
  maxHeight: number
}

export function projectile(
  speed: number,
  angleDeg: number,
  g: number = G_EARTH,
): ProjectileResult {
  const theta = degToRad(angleDeg)
  const vx = speed * Math.cos(theta)
  const vy = speed * Math.sin(theta)
  const timeOfFlight = g > 0 ? (2 * vy) / g : 0
  const range = vx * timeOfFlight
  const maxHeight = g > 0 ? (vy * vy) / (2 * g) : 0
  return { vx, vy, timeOfFlight, range, maxHeight }
}

/** Position of the projectile at time t (origin at launch point). */
export function projectilePoint(
  speed: number,
  angleDeg: number,
  t: number,
  g: number = G_EARTH,
): { x: number; y: number } {
  const theta = degToRad(angleDeg)
  const vx = speed * Math.cos(theta)
  const vy = speed * Math.sin(theta)
  return { x: vx * t, y: vy * t - 0.5 * g * t * t }
}

// ----- Forces (Newton's second law with simple friction) -----

export type ForcesResult = {
  weight: number
  normal: number
  maxStaticFriction: number
  kineticFriction: number
  netForce: number
  acceleration: number
  isMoving: boolean
}

export function forces(
  appliedForce: number,
  mass: number,
  frictionCoefficient: number,
  g: number = G_EARTH,
): ForcesResult {
  const weight = mass * g
  const normal = weight
  const maxStaticFriction = frictionCoefficient * normal
  const kineticFriction = frictionCoefficient * normal
  const isMoving = appliedForce > maxStaticFriction
  // While at rest, friction matches the applied force up to the static limit.
  const opposing = isMoving ? kineticFriction : Math.min(appliedForce, maxStaticFriction)
  const netForce = isMoving ? appliedForce - opposing : 0
  const acceleration = mass > 0 ? netForce / mass : 0
  return {
    weight,
    normal,
    maxStaticFriction,
    kineticFriction,
    netForce,
    acceleration,
    isMoving,
  }
}

// ----- Energy (ramp with simplified friction loss) -----

export type EnergyResult = {
  potentialEnergy: number
  thermalEnergy: number
  kineticEnergy: number
  finalSpeed: number
}

/**
 * Energy on a ramp. Friction loss is modeled as a simple fraction of the
 * potential energy converted to thermal energy (clearly simplified for MVP).
 */
export function energy(
  mass: number,
  height: number,
  frictionLossFraction: number,
  g: number = G_EARTH,
): EnergyResult {
  const potentialEnergy = mass * g * height
  const loss = Math.max(0, Math.min(1, frictionLossFraction))
  const thermalEnergy = potentialEnergy * loss
  const kineticEnergy = potentialEnergy - thermalEnergy
  const finalSpeed = mass > 0 ? Math.sqrt((2 * kineticEnergy) / mass) : 0
  return { potentialEnergy, thermalEnergy, kineticEnergy, finalSpeed }
}

export function frictionlessFinalSpeed(height: number, g: number = G_EARTH): number {
  return Math.sqrt(2 * g * height)
}

// ----- Circuits (series / parallel of identical bulbs) -----

export type CircuitResult = {
  totalResistance: number
  current: number
  bulbCurrent: number
  brightness: number
  lit: boolean
}

/**
 * Simple battery + N identical bulbs (each `bulbResistance` ohms) in either
 * series or parallel. Brightness is normalized power per bulb.
 */
export function circuit(
  voltage: number,
  bulbCount: number,
  bulbResistance: number,
  layout: 'series' | 'parallel',
  closed: boolean,
): CircuitResult {
  if (!closed || bulbCount <= 0 || bulbResistance <= 0) {
    return { totalResistance: Infinity, current: 0, bulbCurrent: 0, brightness: 0, lit: false }
  }
  const totalResistance =
    layout === 'series' ? bulbResistance * bulbCount : bulbResistance / bulbCount
  const current = voltage / totalResistance
  const bulbCurrent = layout === 'series' ? current : current / bulbCount
  const power = bulbCurrent * bulbCurrent * bulbResistance
  // Normalize so a single bulb directly across the battery reads ~1.0.
  const reference = (voltage / bulbResistance) ** 2 * bulbResistance
  const brightness = reference > 0 ? Math.min(1.2, power / reference) : 0
  return { totalResistance, current, bulbCurrent, brightness, lit: bulbCurrent > 0.001 }
}

export function round(value: number, decimals = 1): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}
