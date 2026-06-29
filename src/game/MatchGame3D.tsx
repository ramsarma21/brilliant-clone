import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Canvas } from '@react-three/fiber'
import type { Appearance } from '../types'
import type { MatchSummary } from './types'
import { usePlayer } from '../state/PlayerState'
import { useBodyScrollLock } from '../lib/useBodyScrollLock'
import { faceColors } from '../lib/appearance'
import { cleatsFor } from '../components/PlayerAvatar'
import { clubCode, resolveTeamColor } from '../lib/teams'
import type { World } from './types'
import { createWorld } from './sim/world'
import { InputState } from './control/input'
import { GameView, type HudSnapshot } from './render/GameView'
import { Hud } from './hud/Hud'
import type { Kit } from './render/PlayerRig'
import { sfxCheer, sfxWhistle, unlockAudio } from './sfx'
import './game.css'

export type MatchGame3DProps = {
  matchday: number
  playerName: string
  playerAbbr: string
  playerColors: { primary: string; secondary: string; accent: string }
  opponentName: string
  playerIsHome: boolean
  appearance: Appearance
  /** The matchday objective the player is staking their entry coins on (shown as a banner). */
  challenge?: { title: string; detail: string; reward: number } | null
  /** Override total match length in seconds (split across two halves). Defaults to the standard match. */
  durationSeconds?: number
  /** Force the opponent's team overall (e.g. a trivially weak intro opponent). */
  opponentOverall?: number
  /** Build the opponent as a hapless "minnow" (single-digit attrs) for the underdog intro. */
  opponentMinnow?: boolean
  /** Rig the result: opponent can't score and you always finish ahead (intro match). */
  guaranteedWin?: boolean
  onFinish: (summary: MatchSummary) => void
  onExit: () => void
}

/** In-match tactics sliders — gives your team an identity by live-tuning the AI's shape/press/runs. */
function TacticsPanel({ worldRef }: { worldRef: MutableRefObject<World | null> }) {
  const [open, setOpen] = useState(false)
  const [line, setLine] = useState(50)
  const [press, setPress] = useState(50)
  const [mentality, setMentality] = useState(0)

  const apply = (next: { line?: number; press?: number; mentality?: number }) => {
    const t = worldRef.current?.tactics
    if (!t) return
    if (next.line !== undefined) { setLine(next.line); t.lineHeight = next.line / 100 }
    if (next.press !== undefined) { setPress(next.press); t.press = next.press / 100 }
    if (next.mentality !== undefined) { setMentality(next.mentality); t.mentality = next.mentality }
  }

  const MENTS: [number, string][] = [[-1, 'Defensive'], [0, 'Balanced'], [1, 'Attacking']]
  return (
    <div className="g3d-tactics">
      <button className="g3d-tactics-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▾ Tactics' : '▸ Tactics'}
      </button>
      {open && (
        <div className="g3d-tactics-body">
          <label>
            <span>Line height <em>{line < 34 ? 'Deep' : line > 66 ? 'High' : 'Standard'}</em></span>
            <input type="range" min={0} max={100} value={line} onChange={(e) => apply({ line: +e.target.value })} />
          </label>
          <label>
            <span>Press <em>{press < 34 ? 'Contain' : press > 66 ? 'Aggressive' : 'Balanced'}</em></span>
            <input type="range" min={0} max={100} value={press} onChange={(e) => apply({ press: +e.target.value })} />
          </label>
          <div className="g3d-tactics-ment">
            <span>Mentality</span>
            <div className="g3d-tactics-seg">
              {MENTS.map(([v, lbl]) => (
                <button key={v} className={mentality === v ? 'on' : ''} onClick={() => apply({ mentality: v })}>{lbl}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Darken a hex colour by factor f (0..1). */
function shade(hex: string, f: number): string {
  const c = hex.replace('#', '')
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c
  const n = parseInt(full, 16)
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const r = cl(((n >> 16) & 255) * f)
  const g = cl(((n >> 8) & 255) * f)
  const b = cl((n & 255) * f)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

export function MatchGame3D({
  matchday,
  playerAbbr,
  playerColors,
  opponentName,
  playerIsHome,
  challenge,
  durationSeconds,
  opponentOverall,
  opponentMinnow,
  guaranteedWin,
  onFinish,
  onExit,
}: MatchGame3DProps) {
  useBodyScrollLock()
  const { profile } = usePlayer()

  const worldRef = useRef<World | null>(null)
  if (!worldRef.current) {
    worldRef.current = createWorld({
      squad: profile.squad,
      matchday,
      opponentName,
      youAttackDir: 1,
      halfSeconds: durationSeconds != null ? Math.max(10, durationSeconds / 2) : undefined,
      opponentOverall,
      opponentMinnow,
      guaranteedWin,
    })
  }

  const inputRef = useRef<InputState | null>(null)
  if (!inputRef.current) inputRef.current = new InputState()

  const oppColor = useMemo(() => resolveTeamColor(opponentName, playerColors.primary), [opponentName, playerColors.primary])
  const oppAbbr = useMemo(() => clubCode(opponentName), [opponentName])

  const kits = useMemo<Kit[]>(() => {
    const w = worldRef.current!
    const squad = profile.squad
    const youAccent = playerColors.accent || playerColors.secondary || '#ffffff'
    const youShorts = shade(playerColors.secondary || playerColors.primary, 0.78)
    const oppAccent = shade(oppColor, 1.35)
    // Opponent variety palettes (your team's looks come from the squad).
    const OPP_SKINS = ['#f6d8bd', '#edbb90', '#d49a6a', '#ab7448', '#7c4a2c', '#54301a']
    const OPP_HAIRS = ['#211810', '#3a2616', '#5e2f1d', '#c9a154', '#a8501f', '#cfcabc']
    const OPP_STYLES = ['short', 'buzz', 'curly', 'afro', 'bald']
    const num = { you: 1, opp: 1 } // GK gets #1, outfield count up
    // YOUR players appear first and in FORMATION (= squad) order, so a simple counter maps them.
    let youSlot = -1
    let oppSlot = -1
    return w.players.map((p) => {
      const n = p.isGK ? 1 : ++num[p.team]
      if (p.team === 'you') {
        youSlot++
        const sp = squad[youSlot]
        const fc = faceColors(sp?.appearance)
        const boots = cleatsFor(sp?.cleats ?? '').primary
        const hairStyle = sp?.appearance.hairStyle ?? 'short'
        const name = sp?.name ?? ''
        if (p.isGK)
          return { shirt: '#19c37d', shorts: '#0c3b27', socks: '#19c37d', accent: '#0c3b27', skin: fc.skin, hair: fc.hair, hairStyle, boots, name, number: 1 }
        return {
          shirt: playerColors.primary,
          shorts: youShorts,
          socks: playerColors.primary,
          accent: youAccent,
          skin: fc.skin,
          hair: fc.hair,
          hairStyle,
          boots,
          name,
          number: n,
        }
      }
      oppSlot++
      const oSkin = OPP_SKINS[(oppSlot * 5 + 2) % OPP_SKINS.length]
      const oHair = OPP_HAIRS[(oppSlot * 3 + 1) % OPP_HAIRS.length]
      const oStyle = OPP_STYLES[(oppSlot * 2) % OPP_STYLES.length]
      if (p.isGK)
        return { shirt: '#f5a623', shorts: '#7a4d00', socks: '#f5a623', accent: '#7a4d00', skin: '#caa07a', hair: '#241c16', hairStyle: 'short', boots: '#15161a', name: '', number: 1 }
      return { shirt: oppColor, shorts: shade(oppColor, 0.7), socks: oppColor, accent: oppAccent, skin: oSkin, hair: oHair, hairStyle: oStyle, boots: '#15161a', name: '', number: n }
    })
    // worldRef is stable; only colours / the squad change the kits
  }, [oppColor, playerColors.primary, playerColors.secondary, playerColors.accent, profile.squad])

  const [snap, setSnap] = useState<HudSnapshot | null>(null)
  const onHud = useCallback((s: HudSnapshot) => setSnap(s), [])

  useEffect(() => {
    const detach = inputRef.current!.attach()
    // unlock + kickoff whistle once audio can play
    const unlock = () => unlockAudio()
    window.addEventListener('keydown', unlock, { once: true })
    window.addEventListener('pointerdown', unlock, { once: true })
    unlockAudio()
    const t = window.setTimeout(() => sfxWhistle(), 250)
    return () => {
      detach()
      window.removeEventListener('keydown', unlock)
      window.removeEventListener('pointerdown', unlock)
      window.clearTimeout(t)
    }
  }, [])

  // goal cheer + full-time whistle, fired off HUD snapshot transitions
  const prevTotal = useRef(0)
  const prevPhase = useRef<HudSnapshot['phase'] | null>(null)
  useEffect(() => {
    if (!snap) return
    const total = snap.scoreYou + snap.scoreOpp
    if (total > prevTotal.current) sfxCheer()
    prevTotal.current = total
    if (snap.phase === 'fulltime' && prevPhase.current !== 'fulltime') sfxWhistle()
    prevPhase.current = snap.phase
  }, [snap])

  const reported = useRef(false)
  const finish = useCallback(() => {
    if (reported.current) return
    reported.current = true
    const w = worldRef.current!
    onFinish({ scoreYou: w.scoreYou, scoreOpp: w.scoreOpp, events: w.events })
  }, [onFinish])

  const fulltime = snap?.phase === 'fulltime'

  return (
    <div className="g3d-root">
      <Canvas
        className="g3d-canvas"
        shadows
        dpr={[1, 1.75]}
        camera={{ fov: 46, near: 0.4, far: 280, position: [0, 11, -17] }}
        gl={{ antialias: true }}
        onCreated={({ camera }) => camera.lookAt(0, 1.1, 9)}
      >
        <color attach="background" args={['#0a1424']} />
        <fog attach="fog" args={['#0a1424', 90, 210]} />
        <GameView worldRef={worldRef} inputRef={inputRef} kits={kits} onHud={onHud} />
      </Canvas>

      <Hud
        snap={snap}
        youAbbr={playerAbbr}
        oppAbbr={oppAbbr}
        youColor={playerColors.primary}
        oppColor={oppColor}
        playerIsHome={playerIsHome}
        onExit={onExit}
      />

      <TacticsPanel worldRef={worldRef} />

      {challenge && !fulltime && (
        <div className="g3d-objective" title="Complete this to win your entry coins back (plus a bonus)">
          <span className="g3d-objective__eyebrow">Matchday objective</span>
          <strong className="g3d-objective__title">{challenge.title}</strong>
          <span className="g3d-objective__detail">{challenge.detail}</span>
          <span className="g3d-objective__reward">+{challenge.reward}<span className="coin-icon" aria-hidden /></span>
        </div>
      )}

      {fulltime && (
        <div className="g3d-result">
          {(() => {
            const won = snap!.scoreYou > snap!.scoreOpp
            const drew = snap!.scoreYou === snap!.scoreOpp
            return (
              <>
                <span className="g3d-result__eyebrow">Full time</span>
                <div className={`g3d-result__big${won ? ' is-win' : drew ? ' is-draw' : ' is-loss'}`}>
                  {snap!.scoreYou} <span>&ndash;</span> {snap!.scoreOpp}
                </div>
                <p className="g3d-result__line">
                  {won ? 'A win!' : drew ? 'A share of the spoils.' : 'Not your day.'}{' '}
                  {challenge ? 'Continue to settle your matchday objective.' : ''}
                </p>
                <button onClick={finish}>Continue →</button>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}

export default MatchGame3D
