import { useState } from 'react'
import { MatchAnim } from './MatchAnim'
import { PLAYS, type PlayId } from './matchPlays'

// DEV-ONLY preview harness (open with #match-anim). Lets you cycle every bridging
// "soccer moment" in isolation — no need to unlock the Quantum League — so the
// behind-view animations can be tuned to look like a real match. Not linked from any UI.
const IDS = Object.keys(PLAYS) as PlayId[]

export function MatchAnimPreview() {
  const [i, setI] = useState(0)
  const [loop, setLoop] = useState(0) // bump to replay the same play
  const id = IDS[i]

  return (
    <div className="matchgame">
      <div className="matchgame__panel">
        <div className="matchgame__pitch" aria-hidden />
        <div className="manim">
          <MatchAnim key={`${id}-${loop}`} play={id} teamColor="#2f6df0" oppColor="#ef4444" onDone={() => setLoop((l) => l + 1)} />
        </div>
        <div style={{ position: 'fixed', top: 10, left: 10, zIndex: 60, display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: '70vw' }}>
          {IDS.map((p, idx) => (
            <button
              key={p}
              type="button"
              onClick={() => { setI(idx); setLoop((l) => l + 1) }}
              style={{
                padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12,
                border: '1px solid rgba(255,255,255,0.2)',
                background: idx === i ? '#ffd166' : 'rgba(8,12,28,0.8)',
                color: idx === i ? '#2a1c05' : '#fff',
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <div style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 60, color: '#fff', fontWeight: 700, fontSize: 13, background: 'rgba(8,12,28,0.8)', padding: '6px 12px', borderRadius: 8 }}>
          {id} · {PLAYS[id].ms} ms — click a name to replay
        </div>
      </div>
    </div>
  )
}
