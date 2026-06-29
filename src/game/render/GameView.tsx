import { createRef, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Phase, TeamId, World } from '../types'
import { DT, FIELD, MAX_FRAME_DT } from '../config'
import { BALL, SLIDE, BARGE } from '../config'
import { InputState } from '../control/input'
import { stepWorld } from '../sim/step'
import { sfxKick } from '../sfx'
import { Pitch } from './Pitch'
import { PlayerRig, type Kit, type RigRefs } from './PlayerRig'

export type HudSnapshot = {
  scoreYou: number
  scoreOpp: number
  displayMin: number
  half: 1 | 2
  phase: Phase
  shotCharge: number
  message: string | null
  possession: TeamId | null
}

const CAM = { height: 11, dist: 17, lookAhead: 9, lateral: 0.5 }
const CONTROL_RING = '#ffd23f'
// assumed skill-move animation length (the sim owns skillT; this just scales the visual)
const SKILL_DUR = 0.6

export function GameView({
  worldRef,
  inputRef,
  kits,
  onHud,
}: {
  worldRef: React.RefObject<World | null>
  inputRef: React.RefObject<InputState | null>
  kits: Kit[]
  onHud: (s: HudSnapshot) => void
}) {
  const world0 = worldRef.current!
  const rigs = useMemo<RigRefs[]>(
    () =>
      world0.players.map(() => ({
        group: createRef<THREE.Group>(),
        body: createRef<THREE.Group>(),
        legL: createRef<THREE.Group>(),
        legR: createRef<THREE.Group>(),
        armL: createRef<THREE.Group>(),
        armR: createRef<THREE.Group>(),
        ring: createRef<THREE.Mesh>(),
        marker: createRef<THREE.Group>(),
        nameTag: createRef<THREE.Group>(),
        stam: createRef<THREE.Group>(),
        stamFill: createRef<THREE.Mesh>(),
      })),
    [world0],
  )
  const ballRef = useRef<THREE.Group>(null)
  const acc = useRef(0)
  const hudTimer = useRef(0)
  const camPos = useRef(new THREE.Vector3(0, CAM.height, -CAM.dist))
  const camLook = useRef(new THREE.Vector3(0, 1, 0))
  const lastEmit = useRef<{ phase: Phase; sy: number; so: number } | null>(null)
  const lastKick = useRef(0)

  useFrame((state, delta) => {
    const world = worldRef.current
    if (!world) return
    const input = inputRef.current

    // ---- step the fixed-timestep sim ----
    acc.current += Math.min(delta, MAX_FRAME_DT)
    let steps = 0
    while (acc.current >= DT && steps < 6) {
      const inp = input ? input.build(world.youAttackDir) : InputState.idle()
      stepWorld(world, inp, DT)
      acc.current -= DT
      steps++
    }

    // ---- apply player transforms + animation ----
    for (let i = 0; i < world.players.length; i++) {
      const p = world.players[i]
      const r = rigs[i]
      const g = r.group.current
      if (!g) continue
      g.position.set(p.pos.x, 0, p.pos.z)
      g.rotation.y = p.facing
      const sp = Math.hypot(p.vel.x, p.vel.z)
      // smoothing factor — lerp every joint toward its target so transitions glide, never snap
      const k = 1 - Math.exp(-delta * 16)
      const trapEnv = Math.min(1, p.trapT / 0.55)
      const headEnv = Math.min(1, p.headT / 0.5)
      // legs: high-cadence run swing, but a chest trap plants the feet (kill the swing briefly)
      const swing = Math.sin(p.runPhase) * Math.min(1.0, sp * 0.16) * (1 - trapEnv * 0.7)
      // a committed slide extends both legs forward (lead leg stretched into the tackle)
      const slideLegEnv = p.slideT > 0 ? Math.min(1, p.slideT / SLIDE.DURATION) : 0
      const legLTarget = slideLegEnv > 0 ? THREE.MathUtils.lerp(swing, 1.5, slideLegEnv) : swing
      const legRTarget = slideLegEnv > 0 ? THREE.MathUtils.lerp(-swing, 1.15, slideLegEnv) : -swing
      if (r.legL.current) r.legL.current.rotation.x = THREE.MathUtils.lerp(r.legL.current.rotation.x, legLTarget, k)
      if (r.legR.current) r.legR.current.rotation.x = THREE.MathUtils.lerp(r.legR.current.rotation.x, legRTarget, k)
      // arms: keeper cradle/throw/dive-reach; outfield counter-swing + flashy trap/header/dribble flair
      const armL = r.armL.current
      const armR = r.armR.current
      const celebrating = world.phase === 'goal'
      const scored = p.team === world.justScored
      const isThrowInTaker = world.phase === 'restart' && world.restart?.kind === 'throwin' && world.ball.owner === p.id
      if (armL && armR) {
        const holdingBall = p.isGK && world.ball.owner === p.id
        let lx = 0, lz = 0, rx = 0, rz = 0
        if (celebrating) {
          if (scored) {
            // arms thrown up, pumping to a beat (each player a little out of phase → a crowd of joy)
            const beat = Math.sin(state.clock.elapsedTime * 9 + i * 1.7)
            lx = -2.5; lz = 0.5 + beat * 0.35; rx = -2.5; rz = -0.5 - beat * 0.35
          } else {
            lx = -0.12; lz = 0.12; rx = -0.12; rz = -0.12 // dejected, arms hanging
          }
        } else if (isThrowInTaker || p.throwInT > 0) {
          // throw-in: both arms raised overhead (hold), swinging down through the release
          const rel = Math.min(1, p.throwInT / 0.4) // 1 just-released → 0
          const up = isThrowInTaker && p.throwInT <= 0 ? -2.7 : THREE.MathUtils.lerp(-0.5, -2.7, rel)
          lx = up; lz = 0.18; rx = up; rz = -0.18
        } else if (p.isGK && p.throwT > 0) {
          const tp = Math.min(1, p.throwT / 0.5)
          rx = THREE.MathUtils.lerp(-0.5, -2.7, tp); lx = -0.7
        } else if (p.isGK && p.scoopT > 0) {
          // scoop: arms reach down to the ball, then cradle it up into the chest as it completes
          const env = Math.min(1, Math.max(0, 1 - p.scoopT / 0.4))
          const cradle = THREE.MathUtils.lerp(-0.4, -1.3, env)
          lx = cradle; lz = 0.22; rx = cradle; rz = -0.22
        } else if (holdingBall) {
          lx = -1.3; lz = 0.18; rx = -1.3; rz = -0.18
        } else if (p.isGK && (Math.abs(p.dive) > 0.02 || p.lunge > 0.3)) {
          lx = -1.35; lz = p.dive * 0.5; rx = -1.35; rz = p.dive * 0.5
        } else if (p.isGK) {
          lx = -0.35; lz = 0.28; rx = -0.35; rz = -0.28
        } else if (p.slideT > 0) {
          // slide tackle: arms flung back/out for balance as the body lays out
          const se = Math.min(1, p.slideT / SLIDE.DURATION)
          lx = 0.6 * se; lz = 0.7 * se; rx = 0.6 * se; rz = -0.7 * se
        } else if (p.shield > 0) {
          // shielding: arms out wide to hold the defender off the ball
          lx = -0.2; lz = 1.0; rx = -0.2; rz = -1.0
        } else if (trapEnv > 0.02) {
          // chest trap: arms spread wide for balance as the ball drops
          lx = -0.2 * trapEnv; lz = 0.6 * trapEnv; rx = -0.2 * trapEnv; rz = -0.6 * trapEnv
        } else if (headEnv > 0.02) {
          // header: arms flung back/out for the leap
          lx = 0.5 * headEnv; lz = 0.5 * headEnv; rx = 0.5 * headEnv; rz = -0.5 * headEnv
        } else {
          // counter-swing to the legs, opened out a touch during a dribble flourish
          const flair = Math.abs(p.juke) * 0.6
          lx = -swing * 0.55; lz = flair; rx = swing * 0.55; rz = -flair
        }
        armL.rotation.set(
          THREE.MathUtils.lerp(armL.rotation.x, lx, k), 0, THREE.MathUtils.lerp(armL.rotation.z, lz, k),
        )
        armR.rotation.set(
          THREE.MathUtils.lerp(armR.rotation.x, rx, k), 0, THREE.MathUtils.lerp(armR.rotation.z, rz, k),
        )
      }
      const controlled = p.id === world.controlledId && p.team === 'you'
      const ring = r.ring.current
      if (ring) {
        const mat = ring.material as THREE.MeshBasicMaterial
        if (p.team !== 'you') {
          // opponents have no ring — keeps it obvious which side is yours
          ring.visible = false
        } else {
          ring.visible = true
          mat.color.set(controlled ? CONTROL_RING : '#cfe0ff')
          mat.opacity = controlled ? 1 : 0.28
          const s = controlled ? 1.3 : 0.8
          ring.scale.set(s, s, s)
        }
      }
      const marker = r.marker.current
      if (marker) {
        marker.visible = controlled
        if (controlled) {
          marker.position.y = 2.5 + Math.sin(state.clock.elapsedTime * 4) * 0.12
          marker.rotation.y += delta * 2.5
        }
      }
      // Player name tags are retired (no FIFA-style named roster); keep them hidden.
      const nameTag = r.nameTag.current
      if (nameTag) nameTag.visible = false
      // stamina bar: your outfield players only; counter the body yaw so it faces the camera
      const stam = r.stam.current
      if (stam) {
        const show = p.team === 'you' && !p.isGK
        stam.visible = show
        if (show) {
          // orient the bar to face the broadcast camera (cancels the rig's facing yaw)
          stam.rotation.y = (world.youAttackDir === 1 ? Math.PI : 0) - p.facing
          const fill = r.stamFill.current
          if (fill) {
            const s = Math.max(0.0001, Math.min(1, p.stamina))
            fill.scale.x = s
            fill.position.x = -0.62 * (1 - s)
            const mat = fill.material as THREE.MeshBasicMaterial
            // green (full) → amber → red (empty)
            mat.color.setRGB(THREE.MathUtils.lerp(0.92, 0.1, s), THREE.MathUtils.lerp(0.16, 0.76, s), THREE.MathUtils.lerp(0.16, 0.42, s))
          }
        }
      }
      // body pose: dives (GK), dribble-juke lean, tackle/slide lower, run lunge, trap/header
      const body = r.body.current
      if (body) {
        let bx = 0, by = 0, bz = 0, px = 0, py = 0
        const skillEnv = p.skillT > 0 ? Math.min(1, p.skillT / SKILL_DUR) : 0
        if (celebrating) {
          if (scored) {
            // bounce/jump and twist — a little goal dance, each player offset for variety
            const t2 = state.clock.elapsedTime
            py = Math.abs(Math.sin(t2 * 7 + i)) * 0.24
            by = Math.sin(t2 * 5 + i * 2.1) * 0.35
            bx = -0.12
          } else {
            bx = 0.34; py = -0.04 // head and shoulders dropped
          }
        } else if (isThrowInTaker || p.throwInT > 0) {
          bx = -0.28 // arched back for the overhead throw
        } else if (p.isGK && p.throwT > 0) {
          const tp = Math.min(1, p.throwT / 0.5)
          bx = (1 - tp) * 0.5
        } else if (p.isGK && p.scoopT > 0) {
          // bend down low to gather the ball, then straighten up with it in the hands
          const env = Math.min(1, Math.max(0, 1 - p.scoopT / 0.4))
          bx = THREE.MathUtils.lerp(0.75, 0.12, env)
          py = THREE.MathUtils.lerp(-0.35, -0.03, env)
        } else if (p.isGK && world.ball.owner === p.id) {
          bx = 0.12; py = -0.05
        } else if (p.isGK && (Math.abs(p.dive) > 0.02 || p.lunge > 0.3)) {
          const dk = Math.min(1, p.lunge)
          bx = p.lunge * 0.2; bz = -p.dive * 1.2 * dk
          px = p.dive * 0.7 * dk; py = -0.5 * dk
        } else if (p.slideT > 0) {
          // committed slide tackle: laid back, dropped low to the turf, legs extended forward
          const se = Math.min(1, p.slideT / SLIDE.DURATION)
          bx = -1.2 * se
          py = -0.6 * se
        } else if (p.skillKind === 4 && p.skillT > 0) {
          // roulette: spin the body through ~a full turn over the move, lands facing forward
          by = (1 - Math.min(1, p.skillT / SKILL_DUR)) * Math.PI * 2
          bz = -p.juke * 0.35
        } else if (p.stagger > 0) {
          // barge stumble: a brief off-balance side wobble (distinct from recover's dip)
          const st = Math.min(1, p.stagger / BARGE.STAGGER)
          bz = Math.sin(state.clock.elapsedTime * 22) * 0.42 * st
          bx = -0.18 * st
        } else {
          // run lunge + dribble lean, plus a header nod (forward) or chest-trap lean-back (cushion)
          bx = p.lunge * 0.75 + headEnv * 0.5 - trapEnv * 0.45
          bz = -p.juke * 0.45
          py = (p.recover > 0 ? -0.25 * Math.min(1, p.recover * 2) : 0) + headEnv * 0.12 + trapEnv * 0.06
          // skill-move flair (step-over / ball-roll / drag-back): expressive lateral juke lean
          if (skillEnv > 0) {
            bz += -p.juke * 0.5 * skillEnv
            bx += 0.12 * skillEnv
          }
          // jockey: slightly crouched, side-on containing shuffle
          if (p.jockey > 0) {
            py -= 0.08
            bz += 0.12
          }
          // shield: broad, back-to-defender lean
          if (p.shield > 0) {
            bx -= 0.18
          }
        }
        body.rotation.set(
          THREE.MathUtils.lerp(body.rotation.x, bx, k),
          THREE.MathUtils.lerp(body.rotation.y, by, k),
          THREE.MathUtils.lerp(body.rotation.z, bz, k),
        )
        body.position.set(
          THREE.MathUtils.lerp(body.position.x, px, k), THREE.MathUtils.lerp(body.position.y, py, k), 0,
        )
      }
    }

    // ---- kick SFX ----
    if (world.kickPulse !== lastKick.current) {
      lastKick.current = world.kickPulse
      sfxKick()
    }

    // ---- ball ----
    if (ballRef.current) {
      const b = world.ball
      ballRef.current.position.set(b.pos.x, b.pos.y, b.pos.z)
      // rolling rotation from travel speed
      ballRef.current.rotation.x += (Math.hypot(b.vel.x, b.vel.z) / BALL.R) * delta
      // yaw from sidespin + subtle tumble from the other spin axes
      ballRef.current.rotation.y += b.spin.y * delta * 0.12
      ballRef.current.rotation.x += b.spin.x * delta * 0.04
      ballRef.current.rotation.z += b.spin.z * delta * 0.04
    }

    // ---- broadcast follow-camera ----
    const dir = world.youAttackDir
    const bx = THREE.MathUtils.clamp(world.ball.pos.x, -FIELD.HALF_W, FIELD.HALF_W)
    const bz = THREE.MathUtils.clamp(world.ball.pos.z, -FIELD.HALF_L, FIELD.HALF_L)
    let desiredPos: THREE.Vector3
    let desiredLook: THREE.Vector3
    if (world.phase === 'goal') {
      // Goal celebration: pull the camera up and back off the goal line and look back
      // into the pitch so you can actually watch your players run around celebrating.
      desiredPos = new THREE.Vector3(bx * 0.3, CAM.height * 1.85, bz - CAM.dist * 1.7 * dir)
      desiredLook = new THREE.Vector3(bx * 0.3, 1.0, bz - 9 * dir)
    } else {
      desiredPos = new THREE.Vector3(bx * CAM.lateral, CAM.height, bz - CAM.dist * dir)
      desiredLook = new THREE.Vector3(bx * 0.4, 1.1, bz + CAM.lookAhead * dir)
    }
    // Snap a touch quicker into the celebration framing so it doesn't crawl.
    const a = 1 - Math.exp(-delta * (world.phase === 'goal' ? 2.6 : 3.6))
    camPos.current.lerp(desiredPos, a)
    camLook.current.lerp(desiredLook, a)
    state.camera.position.copy(camPos.current)
    // transient camera punch on power shots / blocks (sim owns the decay)
    if (world.camShake > 0.001) {
      const amp = world.camShake * 0.35
      state.camera.position.x += (Math.random() * 2 - 1) * amp
      state.camera.position.y += (Math.random() * 2 - 1) * amp
      state.camera.position.z += (Math.random() * 2 - 1) * amp
    }
    state.camera.lookAt(camLook.current)

    // ---- HUD (throttled + event-driven) ----
    hudTimer.current += delta
    const owner = world.ball.owner ? world.players.find((p) => p.id === world.ball.owner) : null
    const changed =
      !lastEmit.current ||
      lastEmit.current.phase !== world.phase ||
      lastEmit.current.sy !== world.scoreYou ||
      lastEmit.current.so !== world.scoreOpp
    if (hudTimer.current >= 0.1 || changed) {
      hudTimer.current = 0
      lastEmit.current = { phase: world.phase, sy: world.scoreYou, so: world.scoreOpp }
      onHud({
        scoreYou: world.scoreYou,
        scoreOpp: world.scoreOpp,
        displayMin: world.displayMin,
        half: world.half,
        phase: world.phase,
        shotCharge: world.shotCharge,
        message: world.message,
        possession: owner ? owner.team : null,
      })
    }
  })

  return (
    <group>
      <ambientLight intensity={0.72} />
      <hemisphereLight args={['#bfe3ff', '#2c5530', 0.5]} />
      <directionalLight
        position={[18, 30, 12]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-far={90}
      />
      <Pitch />
      {world0.players.map((p, i) => (
        <PlayerRig key={p.id} kit={kits[i]} refs={rigs[i]} />
      ))}
      <group ref={ballRef}>
        <mesh castShadow>
          <sphereGeometry args={[BALL.R, 20, 20]} />
          <meshStandardMaterial color="#ffffff" roughness={0.45} metalness={0.05} />
        </mesh>
        <mesh>
          <sphereGeometry args={[BALL.R * 1.02, 12, 8]} />
          <meshStandardMaterial color="#1a1a1a" wireframe transparent opacity={0.35} />
        </mesh>
      </group>
    </group>
  )
}
