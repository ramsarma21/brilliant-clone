import { useMemo } from 'react'
import * as THREE from 'three'
import { FIELD } from '../config'

const W = FIELD.HALF_W * 2
const L = FIELD.HALF_L * 2

// Procedurally paint a mowed-stripe pitch with full markings onto a canvas texture.
function usePitchTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const PX = 24 // px per metre
    const cw = Math.round(W * PX)
    const ch = Math.round(L * PX)
    const cvs = document.createElement('canvas')
    cvs.width = cw
    cvs.height = ch
    const ctx = cvs.getContext('2d')!
    const m2px = (m: number) => m * PX
    const X = (x: number) => (x + FIELD.HALF_W) * PX // world x -> px
    const Z = (z: number) => (z + FIELD.HALF_L) * PX // world z -> px

    // mowed stripes
    const stripes = 14
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#2f8f3f' : '#2a8438'
      ctx.fillRect(0, (ch / stripes) * i, cw, ch / stripes + 1)
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = Math.max(2, m2px(0.18))
    const line = (x1: number, z1: number, x2: number, z2: number) => {
      ctx.beginPath(); ctx.moveTo(X(x1), Z(z1)); ctx.lineTo(X(x2), Z(z2)); ctx.stroke()
    }
    const rect = (x: number, z: number, w: number, l: number) => {
      ctx.strokeRect(X(x), Z(z), m2px(w), m2px(l))
    }
    const arc = (x: number, z: number, r: number, a0 = 0, a1 = Math.PI * 2) => {
      ctx.beginPath(); ctx.arc(X(x), Z(z), m2px(r), a0, a1); ctx.stroke()
    }

    // boundary + halfway
    rect(-FIELD.HALF_W + 0.4, -FIELD.HALF_L + 0.4, W - 0.8, L - 0.8)
    line(-FIELD.HALF_W + 0.4, 0, FIELD.HALF_W - 0.4, 0)
    arc(0, 0, 4.5) // centre circle
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath(); ctx.arc(X(0), Z(0), m2px(0.25), 0, Math.PI * 2); ctx.fill()

    // penalty + goal areas at both ends
    for (const dir of [-1, 1]) {
      const goalZ = dir * (FIELD.HALF_L - 0.4)
      const boxFront = goalZ - dir * FIELD.BOX_DEPTH
      ctx.strokeRect(X(-FIELD.BOX_HALF_W), Z(Math.min(goalZ, boxFront)), m2px(FIELD.BOX_HALF_W * 2), m2px(FIELD.BOX_DEPTH))
      const six = 3.2
      const sixDepth = 3
      ctx.strokeRect(X(-six), Z(Math.min(goalZ, goalZ - dir * sixDepth)), m2px(six * 2), m2px(sixDepth))
      // penalty spot + arc
      const spotZ = goalZ - dir * 6
      ctx.beginPath(); ctx.arc(X(0), Z(spotZ), m2px(0.22), 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(X(0), Z(spotZ), m2px(3), dir === 1 ? Math.PI * 1.15 : Math.PI * 0.15, dir === 1 ? Math.PI * 1.85 : Math.PI * 0.85); ctx.stroke()
    }

    const tex = new THREE.CanvasTexture(cvs)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  }, [])
}

function Net({ z, dir }: { z: number; dir: 1 | -1 }) {
  const d = FIELD.GOAL_DEPTH
  const h = FIELD.GOAL_H
  const w = FIELD.GOAL_HALF_W
  const mat = (
    <meshStandardMaterial color="#eef3ff" transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} />
  )
  return (
    <group position={[0, 0, z]}>
      {/* back */}
      <mesh position={[0, h / 2, dir * d]}>
        <planeGeometry args={[w * 2, h]} />
        {mat}
      </mesh>
      {/* sides */}
      <mesh position={[-w, h / 2, (dir * d) / 2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[d, h]} />
        {mat}
      </mesh>
      <mesh position={[w, h / 2, (dir * d) / 2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[d, h]} />
        {mat}
      </mesh>
      {/* roof */}
      <mesh position={[0, h, (dir * d) / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w * 2, d]} />
        {mat}
      </mesh>
    </group>
  )
}

function Goal({ dir }: { dir: 1 | -1 }) {
  const z = dir * FIELD.HALF_L
  const w = FIELD.GOAL_HALF_W
  const h = FIELD.GOAL_H
  const r = 0.1
  const white = <meshStandardMaterial color="#f7fbff" roughness={0.5} metalness={0.05} />
  return (
    <group>
      {/* posts */}
      <mesh position={[-w, h / 2, z]} castShadow>
        <cylinderGeometry args={[r, r, h, 12]} />
        {white}
      </mesh>
      <mesh position={[w, h / 2, z]} castShadow>
        <cylinderGeometry args={[r, r, h, 12]} />
        {white}
      </mesh>
      {/* crossbar */}
      <mesh position={[0, h, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[r, r, w * 2 + r * 2, 12]} />
        {white}
      </mesh>
      <Net z={z} dir={dir} />
    </group>
  )
}

export function Pitch() {
  const tex = usePitchTexture()
  return (
    <group>
      {/* surrounding ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[W + 40, L + 40]} />
        <meshStandardMaterial color="#1c5a28" />
      </mesh>
      {/* playing surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[W, L]} />
        <meshStandardMaterial map={tex} roughness={0.95} />
      </mesh>
      <Goal dir={1} />
      <Goal dir={-1} />
      {/* low stands ring for depth */}
      <mesh position={[0, 3, 0]}>
        <cylinderGeometry args={[Math.max(W, L) * 0.95, Math.max(W, L) * 1.05, 6, 48, 1, true]} />
        <meshStandardMaterial color="#0f1b2e" side={THREE.BackSide} />
      </mesh>
    </group>
  )
}
