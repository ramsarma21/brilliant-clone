import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, ContactShadows, Decal } from '@react-three/drei'
import * as THREE from 'three'
import type { JerseyPattern } from '../types'
import type { AvatarKit, AvatarCleats } from './PlayerAvatar'
import type { FaceColors } from '../lib/appearance'

// A genuinely 3D, fully-rotatable player — the "My Career" turntable. Built to mirror the
// 2D CardPlayer avatar: athletic build (broad shoulders → lean waist), jersey-coloured
// socks with an accent band, white shorts, secondary-colour sleeves, detailed boots, a
// collar, the real face (brows/eyes/nose/mouth) + swept hair, and the LIVE equipped jersey
// pattern painted onto the torso. Drag to orbit 360°, scroll to zoom.

type Colors = {
  primary: string
  secondary: string
  accent: string
  shorts: string
  shortsDark: string
  sock: string
  sockBand: string
  boot: string
  bootSole: string
  bootHi: string
  skin: string
  skinShade: string
  hair: string
  hairHi: string
  pattern: JerseyPattern
}

function mat(color: string, roughness = 0.62) {
  return <meshStandardMaterial color={color} roughness={roughness} metalness={0.04} />
}

// Paint the jersey (base colour + pattern) into a canvas texture so the kit reads exactly
// like the 2D card — stripes/hoops/sash/halves/galaxy all wrap around the torso.
function makeJerseyTexture(c: Colors): THREE.CanvasTexture {
  const W = 256
  const H = 256
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!

  if (c.pattern === 'galaxy') {
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, c.primary)
    g.addColorStop(1, c.secondary)
    ctx.fillStyle = g
  } else {
    ctx.fillStyle = c.primary
  }
  ctx.fillRect(0, 0, W, H)

  switch (c.pattern) {
    case 'stripes': {
      ctx.fillStyle = c.secondary
      const n = 8
      for (let i = 0; i < n; i++) ctx.fillRect((i + 0.28) * (W / n), 0, (W / n) * 0.46, H)
      break
    }
    case 'hoops': {
      ctx.fillStyle = c.secondary
      for (const y of [0.18, 0.44, 0.7]) ctx.fillRect(0, y * H, W, H * 0.1)
      break
    }
    case 'halves': {
      ctx.fillStyle = c.secondary
      ctx.fillRect(W / 2, 0, W / 2, H)
      break
    }
    case 'sash': {
      ctx.save()
      ctx.translate(W / 2, H / 2)
      ctx.rotate(-0.5)
      ctx.fillStyle = c.accent
      ctx.fillRect(-W, -H * 0.09, 2 * W, H * 0.18)
      ctx.restore()
      break
    }
    case 'galaxy': {
      ctx.fillStyle = c.accent
      for (let i = 0; i < 40; i++) {
        const x = (Math.sin(i * 12.9898) * 43758.5) % 1
        const y = (Math.sin(i * 78.233) * 12543.1) % 1
        ctx.beginPath()
        ctx.arc(Math.abs(x) * W, Math.abs(y) * H, i % 3 === 0 ? 2.4 : 1.4, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    default:
      break
  }

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

// The EXACT 2D CardFace artwork (handsome, detailed) rendered to an SVG so it can be
// projected onto the 3D head as a decal — no blocky primitives. Only the head/face is
// drawn (transparent elsewhere); the hair + skull are 3D meshes underneath.
function faceSvgDataUrl(f: FaceColors): string {
  const eyes = [44, 60]
    .map(
      (ex) => `
    <path d="M${ex - 4} 41.4 Q${ex} 37.8 ${ex + 4} 41.4 Q${ex} 44 ${ex - 4} 41.4 Z" fill="#ffffff"/>
    <circle cx="${ex}" cy="41.4" r="2.3" fill="#3b2a20"/>
    <circle cx="${ex}" cy="41.4" r="1.1" fill="#15110d"/>
    <circle cx="${ex + 0.8}" cy="40.5" r="0.7" fill="#ffffff"/>
    <path d="M${ex - 4} 41.2 Q${ex} 37.6 ${ex + 4} 41.2" stroke="#5b3d2b" stroke-width="0.9" fill="none" stroke-linecap="round"/>`,
    )
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="454" viewBox="27 16 50 54">
    <path d="M31 40 C31 25 40 18 52 18 C64 18 73 25 73 40 C73 50 69 57 61 62 C57 64.5 54.5 66 52 66 C49.5 66 47 64.5 43 62 C35 57 31 50 31 40 Z" fill="${f.skin}"/>
    <path d="M33 42 C36 55 44 62 52 62 C60 62 68 55 71 42 C67 50 60 55 52 55 C44 55 37 50 33 42 Z" fill="${f.skinShade}" opacity="0.16"/>
    <ellipse cx="40" cy="44" rx="5" ry="3.2" fill="${f.skinHi}" opacity="0.5"/>
    <ellipse cx="64" cy="44" rx="5" ry="3.2" fill="${f.skinHi}" opacity="0.5"/>
    <ellipse cx="52" cy="28" rx="13" ry="6" fill="${f.skinHi}" opacity="0.35"/>
    <path d="M38 34.5 C42 31.6 47 31.8 49.6 33.8 L49.2 36 C46.6 34.4 42 34.4 38.8 36.8 Z" fill="${f.hair}"/>
    <path d="M66 34.5 C62 31.6 57 31.8 54.4 33.8 L54.8 36 C57.4 34.4 62 34.4 65.2 36.8 Z" fill="${f.hair}"/>
    ${eyes}
    <rect x="51.2" y="38" width="1.6" height="11" rx="0.8" fill="${f.skinHi}" opacity="0.5"/>
    <path d="M52 49 C49 49 47.5 50.5 48.5 52 C50 53 54 53 55.5 52 C56.5 50.5 55 49 52 49 Z" fill="${f.skinShade}" opacity="0.45"/>
    <circle cx="49.3" cy="51.4" r="0.8" fill="${f.skinShade}" opacity="0.7"/>
    <circle cx="54.7" cy="51.4" r="0.8" fill="${f.skinShade}" opacity="0.7"/>
    <path d="M45.5 56.4 Q48.5 55 52 55.6 Q55.5 55 58.5 56.4 Q55 58.2 52 58.2 Q49 58.2 45.5 56.4 Z" fill="#b56a52"/>
    <path d="M45.5 56.4 Q52 57.4 58.5 56.4 Q52 60 45.5 56.4 Z" fill="#9c5340"/>
    <path d="M45.5 56.2 Q52 57.2 58.5 56.2" stroke="#7e4233" stroke-width="0.8" fill="none" stroke-linecap="round"/>
  </svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

function useFaceTexture(face: FaceColors): THREE.Texture | null {
  const url = useMemo(
    () => faceSvgDataUrl(face),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [face.skin, face.skinShade, face.skinHi, face.hair, face.hairHi],
  )
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      const t = new THREE.Texture(img)
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
      t.needsUpdate = true
      setTex(t)
    }
    img.src = url
    return () => {
      alive = false
    }
  }, [url])
  return tex
}

function PlayerFigure({
  c,
  jerseyTex,
  faceTex,
}: {
  c: Colors
  jerseyTex: THREE.CanvasTexture
  faceTex: THREE.Texture | null
}) {
  return (
    <group>
      {/* legs + boots (mirrored) */}
      {[-1, 1].map((s) => (
        <group key={`leg${s}`} position={[0.097 * s, 0, 0]}>
          {/* thigh (skin) */}
          <mesh position={[0, 0.72, 0]}>
            <capsuleGeometry args={[0.082, 0.2, 8, 20]} />
            {mat(c.skin, 0.72)}
          </mesh>
          {/* shin (sock = jersey colour) */}
          <mesh position={[0, 0.4, 0]}>
            <capsuleGeometry args={[0.074, 0.24, 8, 20]} />
            {mat(c.sock, 0.58)}
          </mesh>
          {/* accent sock band just below the knee */}
          <mesh position={[0, 0.56, 0]}>
            <cylinderGeometry args={[0.079, 0.079, 0.03, 20]} />
            {mat(c.sockBand, 0.5)}
          </mesh>
          {/* boot: cleat upper + sole + lace highlight, nudged forward at the toe */}
          <group position={[0, 0.055, 0.055]}>
            <mesh position={[0, 0.012, 0]}>
              <boxGeometry args={[0.11, 0.07, 0.25]} />
              {mat(c.boot, 0.34)}
            </mesh>
            <mesh position={[0, -0.028, 0.006]}>
              <boxGeometry args={[0.118, 0.03, 0.265]} />
              {mat(c.bootSole, 0.3)}
            </mesh>
            <mesh position={[0, 0.03, -0.02]}>
              <boxGeometry args={[0.055, 0.03, 0.12]} />
              {mat(c.bootHi, 0.4)}
            </mesh>
          </group>
        </group>
      ))}

      {/* white shorts: seat + two short thigh covers + a darker waistband */}
      <mesh position={[0, 0.95, 0]} scale={[1.04, 1, 0.72]}>
        <capsuleGeometry args={[0.17, 0.085, 8, 22]} />
        {mat(c.shorts, 0.58)}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`short${s}`} position={[0.097 * s, 0.86, 0.005]} scale={[1, 1, 0.8]}>
          <capsuleGeometry args={[0.086, 0.07, 6, 16]} />
          {mat(c.shorts, 0.58)}
        </mesh>
      ))}
      <mesh position={[0, 1.02, 0]} scale={[1.05, 1, 0.74]}>
        <cylinderGeometry args={[0.172, 0.172, 0.032, 24]} />
        {mat(c.shortsDark, 0.55)}
      </mesh>

      {/* torso (jersey + pattern): tapered shoulders→waist, flattened front-to-back */}
      <mesh position={[0, 1.27, 0]} scale={[1, 1, 0.6]}>
        <cylinderGeometry args={[0.205, 0.15, 0.46, 30, 1, false]} />
        <meshStandardMaterial map={jerseyTex} roughness={0.52} metalness={0.04} />
      </mesh>
      {/* rounded shoulder caps for an athletic top line */}
      {[-1, 1].map((s) => (
        <mesh key={`shoulder${s}`} position={[0.185 * s, 1.47, 0]} scale={[1, 0.8, 0.62]}>
          <sphereGeometry args={[0.075, 20, 20]} />
          {mat(c.primary, 0.52)}
        </mesh>
      ))}
      {/* upper-chest yoke to close the top of the torso under the collar */}
      <mesh position={[0, 1.48, 0]} scale={[1, 0.7, 0.6]}>
        <sphereGeometry args={[0.14, 24, 24]} />
        {mat(c.primary, 0.52)}
      </mesh>

      {/* collar (accent ring) */}
      <mesh position={[0, 1.52, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.62, 1]}>
        <torusGeometry args={[0.062, 0.016, 12, 24]} />
        {mat(c.accent, 0.5)}
      </mesh>

      {/* arms (mirrored): secondary-colour sleeve → skin forearm → hand, angled out */}
      {[-1, 1].map((s) => (
        <group key={`arm${s}`}>
          <mesh position={[0.247 * s, 1.31, 0]} rotation={[0, 0, 0.2 * s]}>
            <capsuleGeometry args={[0.054, 0.2, 8, 16]} />
            {mat(c.secondary, 0.52)}
          </mesh>
          <mesh position={[0.305 * s, 1.04, 0.01]} rotation={[0, 0, 0.13 * s]}>
            <capsuleGeometry args={[0.044, 0.18, 8, 16]} />
            {mat(c.skin, 0.72)}
          </mesh>
          <mesh position={[0.327 * s, 0.9, 0.012]}>
            <sphereGeometry args={[0.05, 18, 18]} />
            {mat(c.skin, 0.72)}
          </mesh>
        </group>
      ))}

      {/* neck */}
      <mesh position={[0, 1.56, 0]}>
        <cylinderGeometry args={[0.05, 0.058, 0.1, 18]} />
        {mat(c.skin, 0.72)}
      </mesh>

      {/* head — round skull; the exact 2D face is projected on as a decal (no primitives) */}
      <mesh position={[0, 1.68, 0]}>
        <sphereGeometry args={[0.125, 48, 48]} />
        {mat(c.skin, 0.62)}
        {faceTex && (
          <Decal position={[0, 0.006, 0.118]} rotation={[0, 0, 0]} scale={[0.205, 0.222, 0.22]}>
            <meshStandardMaterial
              map={faceTex}
              transparent
              roughness={0.62}
              metalness={0.02}
              polygonOffset
              polygonOffsetFactor={-12}
            />
          </Decal>
        )}
      </mesh>
      {/* ears */}
      {[-1, 1].map((s) => (
        <mesh key={`ear${s}`} position={[0.122 * s, 1.675, 0]} scale={[0.6, 1, 0.8]}>
          <sphereGeometry args={[0.026, 16, 16]} />
          {mat(c.skin, 0.7)}
        </mesh>
      ))}

      {/* hair — crown + back + temples (front edge sits at the hairline above the face) */}
      <mesh position={[0, 1.704, -0.012]} scale={[1.05, 1.04, 1.08]}>
        <sphereGeometry args={[0.123, 36, 36, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        {mat(c.hair, 0.82)}
      </mesh>
      {/* temple fades + sideburn hint down the sides/back */}
      <mesh position={[0, 1.668, -0.028]} scale={[1.03, 1.04, 0.92]}>
        <sphereGeometry args={[0.124, 32, 32, Math.PI * 0.42, Math.PI * 1.16, Math.PI * 0.16, Math.PI * 0.46]} />
        {mat(c.hair, 0.82)}
      </mesh>
      {/* swept-fringe highlight along the hairline */}
      <mesh position={[0, 1.742, 0.052]} rotation={[-0.62, 0, 0]} scale={[1, 1, 0.5]}>
        <torusGeometry args={[0.07, 0.016, 10, 24, Math.PI]} />
        {mat(c.hairHi, 0.8)}
      </mesh>

      {/* a ball at his feet for scale + flavour */}
      <mesh position={[0.34, 0.11, 0.18]}>
        <sphereGeometry args={[0.11, 28, 28]} />
        <meshStandardMaterial color="#f4f6fb" roughness={0.5} metalness={0.02} />
      </mesh>

      {/* static turntable ring */}
      <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.62, 64]} />
        <meshBasicMaterial color={c.accent} transparent opacity={0.2} />
      </mesh>
    </group>
  )
}

export function PlayerModel3D({
  jersey,
  cleats,
  face,
}: {
  jersey: AvatarKit
  cleats: AvatarCleats
  face: FaceColors
}) {
  const c: Colors = {
    primary: jersey.primary,
    secondary: jersey.secondary,
    accent: jersey.accent ?? '#ffd166',
    shorts: jersey.shorts ?? '#f2f5fb',
    shortsDark: '#cdd6e6',
    sock: jersey.primary,
    sockBand: jersey.accent ?? '#ffd166',
    boot: cleats.primary,
    bootSole: cleats.secondary,
    bootHi: cleats.accent,
    skin: face.skin,
    skinShade: face.skinShade,
    hair: face.hair,
    hairHi: face.hairHi,
    pattern: jersey.pattern ?? 'plain',
  }

  // Rebuild the jersey texture only when the kit colours / pattern change; dispose the old
  // one so we don't leak GPU textures as the player swaps kits.
  const jerseyTex = useMemo(
    () => makeJerseyTexture(c),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c.primary, c.secondary, c.accent, c.pattern],
  )
  useEffect(() => () => jerseyTex.dispose(), [jerseyTex])

  const faceTex = useFaceTexture(face)

  return (
    <Canvas
      style={{ position: 'absolute', inset: 0 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 1.05, 3.4], fov: 36 }}
    >
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#bcd0ff', '#16142a', 0.6]} />
      <directionalLight position={[3, 6, 4]} intensity={1.2} />
      <directionalLight position={[-4, 2.5, -3]} intensity={0.55} color="#7e9bff" />
      <PlayerFigure c={c} jerseyTex={jerseyTex} faceTex={faceTex} />
      <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={3} blur={2.6} far={1.6} resolution={512} color="#000000" />
      <OrbitControls
        target={[0, 0.9, 0]}
        enablePan={false}
        minDistance={2.2}
        maxDistance={4.8}
        minPolarAngle={Math.PI * 0.25}
        maxPolarAngle={Math.PI * 0.6}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  )
}
