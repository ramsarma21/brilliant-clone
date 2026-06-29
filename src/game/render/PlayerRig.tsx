import { useMemo, type RefObject } from 'react'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { hairRig } from '../../lib/appearance'

export type Kit = {
  shirt: string
  shorts: string
  socks: string
  accent: string // collar / sleeve trim
  skin: string
  hair: string
  hairStyle: string // silhouette: short / buzz / curly / afro / bald
  boots: string // boot colour (per-player cosmetic)
  name: string // shown on the ground tag when this player is the one you control
  number: number
}

export type RigRefs = {
  group: RefObject<THREE.Group | null>
  body: RefObject<THREE.Group | null>
  legL: RefObject<THREE.Group | null>
  legR: RefObject<THREE.Group | null>
  armL: RefObject<THREE.Group | null>
  armR: RefObject<THREE.Group | null>
  ring: RefObject<THREE.Mesh | null>
  marker: RefObject<THREE.Group | null>
  nameTag: RefObject<THREE.Group | null>
  stam: RefObject<THREE.Group | null>
  stamFill: RefObject<THREE.Mesh | null>
}

/** A canvas-drawn shirt number so the in-game kit reads like a real jersey, not a blank block. */
function useNumberTexture(n: number): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (typeof document === 'undefined') return null
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 128
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.clearRect(0, 0, 128, 128)
    ctx.font = 'bold 96px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const label = String(n)
    ctx.lineWidth = 10
    ctx.strokeStyle = 'rgba(8,12,20,0.85)'
    ctx.strokeText(label, 64, 70)
    ctx.fillStyle = '#f4f7ff'
    ctx.fillText(label, 64, 70)
    const tex = new THREE.CanvasTexture(c)
    tex.anisotropy = 4
    return tex
  }, [n])
}

/** A name plate texture (white text on a translucent dark pill) for the controlled player's tag. */
function useNameTexture(name: string): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (typeof document === 'undefined' || !name) return null
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 128
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.clearRect(0, 0, 512, 128)
    // rounded pill background
    const r = 40
    ctx.fillStyle = 'rgba(10,16,28,0.82)'
    ctx.beginPath()
    ctx.moveTo(r, 18)
    ctx.arcTo(494, 18, 494, 110, r)
    ctx.arcTo(494, 110, 18, 110, r)
    ctx.arcTo(18, 110, 18, 18, r)
    ctx.arcTo(18, 18, 494, 18, r)
    ctx.closePath()
    ctx.fill()
    ctx.font = "bold 56px 'Baloo 2', Arial, sans-serif"
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffd23f'
    ctx.fillText(name.toUpperCase(), 256, 66)
    const tex = new THREE.CanvasTexture(c)
    tex.anisotropy = 4
    return tex
  }, [name])
}

// A stylized footballer built from rounded shapes (less "Roblox"): sleeves, collar, shorts,
// socks and boots in the club colours, plus a shirt number. Transform + leg/arm swing + lean
// are driven imperatively by the parent (GameView) each frame via the passed refs.
export function PlayerRig({ kit, refs }: { kit: Kit; refs: RigRefs }) {
  const hip = 0.92
  const numTex = useNumberTexture(kit.number)
  const nameTex = useNameTexture(kit.name)
  const shirtMat = { color: kit.shirt, roughness: 0.55, metalness: 0.04 }
  const skinMat = { color: kit.skin, roughness: 0.7 }
  const hairS = hairRig(kit.hairStyle)
  return (
    <group ref={refs.group}>
      {/* ground ring (team / controlled indicator) */}
      <mesh ref={refs.ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.5, 0.7, 28]} />
        <meshBasicMaterial color={kit.shirt} transparent opacity={0.85} />
      </mesh>
      {/* floating "this is you" marker (only shown on the controlled player) */}
      <group ref={refs.marker} position={[0, 2.55, 0]} visible={false}>
        <mesh rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.26, 0.5, 4]} />
          <meshBasicMaterial color="#ffd23f" />
        </mesh>
      </group>
      {/* name tag near the selection ring — only shown on the controlled player (FIFA-style) */}
      <group ref={refs.nameTag} position={[0, 0.5, 0]} visible={false}>
        {nameTex && (
          <mesh>
            <planeGeometry args={[1.9, 0.475]} />
            <meshBasicMaterial map={nameTex} transparent depthTest={false} toneMapped={false} />
          </mesh>
        )}
      </group>
      {/* stamina bar (your outfield players only; GameView toggles + drives it) */}
      <group ref={refs.stam} position={[0, 2.1, 0]} visible={false}>
        <mesh position={[0, 0, -0.012]}>
          <planeGeometry args={[1.34, 0.26]} />
          <meshBasicMaterial color="#0a0f1a" transparent opacity={0.82} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={refs.stamFill} position={[0, 0, 0]}>
          <planeGeometry args={[1.24, 0.16]} />
          <meshBasicMaterial color="#19c37d" toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* soft blob shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.5, 18]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.22} />
      </mesh>

      <group ref={refs.body}>
        {/* torso (rounded) */}
        <RoundedBox args={[0.52, 0.64, 0.3]} radius={0.1} smoothness={3} position={[0, hip + 0.42, 0]} castShadow>
          <meshStandardMaterial {...shirtMat} />
        </RoundedBox>
        {/* shirt number on the back */}
        {numTex && (
          <mesh position={[0, hip + 0.46, -0.158]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[0.34, 0.4]} />
            <meshStandardMaterial map={numTex} transparent roughness={0.6} />
          </mesh>
        )}
        {/* collar trim */}
        <RoundedBox args={[0.28, 0.08, 0.24]} radius={0.03} smoothness={2} position={[0, hip + 0.76, 0]}>
          <meshStandardMaterial color={kit.accent} roughness={0.5} />
        </RoundedBox>
        {/* neck */}
        <mesh position={[0, hip + 0.82, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.1, 0.12, 10]} />
          <meshStandardMaterial {...skinMat} />
        </mesh>
        {/* head */}
        <mesh position={[0, hip + 1.0, 0]} castShadow>
          <sphereGeometry args={[0.17, 18, 18]} />
          <meshStandardMaterial {...skinMat} />
        </mesh>
        {/* hair cap — silhouette varies by style (bald hides it; afro/curly puff out) */}
        {hairS.show && (
          <mesh
            position={[0, hip + 1.06 + hairS.lift, -0.015]}
            rotation={[0.12, 0, 0]}
            scale={[hairS.scale, hairS.scale, hairS.scale]}
          >
            <sphereGeometry args={[0.182, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
            <meshStandardMaterial color={kit.hair} roughness={hairS.rough} />
          </mesh>
        )}

        {/* arms — pivot at the shoulder. Short sleeve (accent) + skin forearm. */}
        <group ref={refs.armL} position={[-0.33, hip + 0.7, 0]}>
          <RoundedBox args={[0.17, 0.18, 0.2]} radius={0.05} smoothness={2} position={[0, -0.05, 0]} castShadow>
            <meshStandardMaterial color={kit.accent} roughness={0.55} />
          </RoundedBox>
          <RoundedBox args={[0.12, 0.42, 0.13]} radius={0.05} smoothness={2} position={[0, -0.32, 0]} castShadow>
            <meshStandardMaterial {...skinMat} />
          </RoundedBox>
        </group>
        <group ref={refs.armR} position={[0.33, hip + 0.7, 0]}>
          <RoundedBox args={[0.17, 0.18, 0.2]} radius={0.05} smoothness={2} position={[0, -0.05, 0]} castShadow>
            <meshStandardMaterial color={kit.accent} roughness={0.55} />
          </RoundedBox>
          <RoundedBox args={[0.12, 0.42, 0.13]} radius={0.05} smoothness={2} position={[0, -0.32, 0]} castShadow>
            <meshStandardMaterial {...skinMat} />
          </RoundedBox>
        </group>

        {/* legs pivot at the hip: shorts thigh → skin shin → sock → boot */}
        <LegRig refs={refs.legL} x={-0.14} kit={kit} skinMat={skinMat} />
        <LegRig refs={refs.legR} x={0.14} kit={kit} skinMat={skinMat} />
      </group>
    </group>
  )
}

function LegRig({
  refs,
  x,
  kit,
  skinMat,
}: {
  refs: RefObject<THREE.Group | null>
  x: number
  kit: Kit
  skinMat: { color: string; roughness: number }
}) {
  return (
    <group ref={refs} position={[x, 0.92, 0]}>
      {/* thigh (shorts) */}
      <RoundedBox args={[0.18, 0.4, 0.19]} radius={0.06} smoothness={2} position={[0, -0.2, 0]} castShadow>
        <meshStandardMaterial color={kit.shorts} roughness={0.62} />
      </RoundedBox>
      {/* shin (skin) */}
      <RoundedBox args={[0.135, 0.3, 0.15]} radius={0.05} smoothness={2} position={[0, -0.52, 0]} castShadow>
        <meshStandardMaterial {...skinMat} />
      </RoundedBox>
      {/* sock (team colour) */}
      <RoundedBox args={[0.145, 0.18, 0.16]} radius={0.04} smoothness={2} position={[0, -0.72, 0]} castShadow>
        <meshStandardMaterial color={kit.socks} roughness={0.7} />
      </RoundedBox>
      {/* boot (per-player cleat colour) */}
      <RoundedBox args={[0.15, 0.11, 0.32]} radius={0.045} smoothness={2} position={[0, -0.82, 0.07]} castShadow>
        <meshStandardMaterial color={kit.boots} roughness={0.35} metalness={0.1} />
      </RoundedBox>
    </group>
  )
}
