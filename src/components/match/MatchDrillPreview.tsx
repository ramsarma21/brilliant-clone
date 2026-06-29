import { useState } from 'react'
import './drills' // registers the delivered match drills into MATCH_DRILLS
import { MATCH_DRILLS, DRILL_ENTRY, type DrillId } from './matchDrill'

const ALL: DrillId[] = ['dribble', 'pass', 'shoot', 'header', 'defend', 'goalie']
const TEAM = '#2f6df0'
const OPP = '#ef4444'

// DEV-ONLY harness (open with #match-drill) to view each seamless match-version drill in
// isolation, opening at its DRILL_ENTRY handoff state. Stripped from production builds.
function initialDrill(): DrillId {
  const d = new URLSearchParams(window.location.search).get('drill') as DrillId | null
  return d && ALL.includes(d) ? d : 'dribble'
}

export function MatchDrillPreview() {
  const [drill, setDrill] = useState<DrillId>(initialDrill)
  const [runKey, setRunKey] = useState(0)
  const [result, setResult] = useState<string | null>(null)

  const Comp = MATCH_DRILLS[drill]

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#06091a' }}>
      {Comp ? (
        <div className="mdrill mdrill--match" style={{ position: 'absolute', inset: 0 }}>
          <Comp
            key={`${drill}-${runKey}`}
            entry={DRILL_ENTRY[drill]}
            teamColor={TEAM}
            oppColor={OPP}
            onResolve={(ok) => setResult(ok ? 'RESOLVED ✓ success' : 'RESOLVED ✗ fail')}
          />
        </div>
      ) : (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#9fb3ff' }}>
          “{drill}” has no match-version yet — falls back to its sim in a real match.
        </div>
      )}

      <div style={{ position: 'fixed', top: 10, left: 10, zIndex: 100, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', background: 'rgba(6,9,26,0.82)', padding: 8, borderRadius: 12 }}>
        {ALL.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => { setDrill(d); setRunKey((k) => k + 1); setResult(null) }}
            style={{
              padding: '6px 11px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13,
              border: d === drill ? '2px solid #7ec8ff' : '2px solid transparent',
              background: d === drill ? '#7ec8ff' : 'rgba(255,255,255,0.08)',
              color: d === drill ? '#06223f' : '#dfe8ff',
              opacity: MATCH_DRILLS[d] ? 1 : 0.45,
            }}
          >
            {d}{MATCH_DRILLS[d] ? '' : ' (sim)'}
          </button>
        ))}
        <button type="button" onClick={() => { setRunKey((k) => k + 1); setResult(null) }}
          style={{ padding: '6px 11px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, border: 'none', background: '#2f6df0', color: '#fff' }}>
          ↻ replay
        </button>
        {result && <span style={{ color: '#bfe6c8', fontWeight: 700, fontSize: 13, marginLeft: 4 }}>{result}</span>}
      </div>
    </div>
  )
}
