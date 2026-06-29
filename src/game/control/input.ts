import type { Input } from '../types'
import { KEYS } from '../config'
import { norm, type Vec2 } from '../math'

const inSet = (set: string[], k: string) => set.includes(k)
const ARROWS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright']

/**
 * Keyboard input. Movement is WASD (camera-relative). Hold Shift = the "L2/LT" modifier
 * (jockey on defence / strafe while carrying / finesse on a shot). See config.KEYS for the
 * full mapping. Charged actions (pass/shoot) report both a held flag and a released edge so
 * the sim can build up power and fire on release; discrete verbs report keydown edges.
 */
export class InputState {
  private keys = new Set<string>()
  private edgeSkill = false
  private edgeSwitchL = false
  private edgeSwitchR = false
  private edgeShoot = false
  private edgeThrough = false
  private edgeF = false
  private edgeStepover = false
  private edgeBallRoll = false
  private edgeRoulette = false
  private edgeDragback = false
  private passReleased = false
  private shootReleased = false

  attach(target: Window = window): () => void {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (inSet(KEYS.up, k) || inSet(KEYS.down, k) || inSet(KEYS.left, k) ||
        inSet(KEYS.right, k) || inSet(KEYS.pass, k) || ARROWS.includes(k)) e.preventDefault()
      if (e.repeat) return
      if (!this.keys.has(k)) {
        if (inSet(KEYS.skill, k)) this.edgeSkill = true
        if (inSet(KEYS.switchLeft, k)) this.edgeSwitchL = true
        if (inSet(KEYS.switchRight, k)) this.edgeSwitchR = true
        if (inSet(KEYS.shoot, k)) this.edgeShoot = true
        if (inSet(KEYS.through, k)) this.edgeThrough = true
        if (inSet(KEYS.fAction, k)) this.edgeF = true
        if (inSet(KEYS.stepover, k)) this.edgeStepover = true
        if (inSet(KEYS.ballRoll, k)) this.edgeBallRoll = true
        if (inSet(KEYS.roulette, k)) this.edgeRoulette = true
        if (inSet(KEYS.dragback, k)) this.edgeDragback = true
      }
      this.keys.add(k)
    }
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (inSet(KEYS.pass, k)) this.passReleased = true
      if (inSet(KEYS.shoot, k)) this.shootReleased = true
      this.keys.delete(k)
    }
    const blur = () => this.keys.clear()
    target.addEventListener('keydown', down as EventListener)
    target.addEventListener('keyup', up as EventListener)
    target.addEventListener('blur', blur)
    return () => {
      target.removeEventListener('keydown', down as EventListener)
      target.removeEventListener('keyup', up as EventListener)
      target.removeEventListener('blur', blur)
    }
  }

  private held(set: string[]): boolean {
    for (const k of this.keys) if (inSet(set, k)) return true
    return false
  }

  build(youAttackDir: 1 | -1): Input {
    const fwd = (this.held(KEYS.up) ? 1 : 0) - (this.held(KEYS.down) ? 1 : 0)
    const right = (this.held(KEYS.right) ? 1 : 0) - (this.held(KEYS.left) ? 1 : 0)
    const move: Vec2 = norm({ x: -right * youAttackDir, z: fwd * youAttackDir })
    const input: Input = {
      move,
      aimX: right,
      sprint: this.held(KEYS.sprint),
      passHeld: this.held(KEYS.pass),
      passReleased: this.passReleased,
      skill: this.edgeSkill,
      shootHeld: this.held(KEYS.shoot),
      shootReleased: this.shootReleased,
      shootPressed: this.edgeShoot,
      clearPressed: this.edgeShoot,
      switchLeft: this.edgeSwitchL,
      switchRight: this.edgeSwitchR,
      jockey: this.held(KEYS.jockey),
      through: this.edgeThrough,
      cross: this.edgeF,
      slide: this.edgeF,
      stepover: this.edgeStepover,
      ballRoll: this.edgeBallRoll,
      roulette: this.edgeRoulette,
      dragback: this.edgeDragback,
    }
    this.edgeSkill = this.edgeSwitchL = this.edgeSwitchR = false
    this.edgeShoot = this.edgeThrough = this.edgeF = false
    this.edgeStepover = this.edgeBallRoll = this.edgeRoulette = this.edgeDragback = false
    this.passReleased = this.shootReleased = false
    return input
  }

  static idle(): Input {
    return {
      move: { x: 0, z: 0 }, aimX: 0, sprint: false,
      passHeld: false, passReleased: false, skill: false,
      shootHeld: false, shootReleased: false, shootPressed: false, clearPressed: false,
      switchLeft: false, switchRight: false,
      jockey: false, through: false, cross: false, slide: false,
      stepover: false, ballRoll: false, roulette: false, dragback: false,
    }
  }
}
