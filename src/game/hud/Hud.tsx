import type { HudSnapshot } from '../render/GameView'

type Side = { abbr: string; color: string; score: number }

export function Hud({
  snap,
  youAbbr,
  oppAbbr,
  youColor,
  oppColor,
  playerIsHome,
  onExit,
}: {
  snap: HudSnapshot | null
  youAbbr: string
  oppAbbr: string
  youColor: string
  oppColor: string
  playerIsHome: boolean
  onExit: () => void
}) {
  const you: Side = { abbr: youAbbr, color: youColor, score: snap?.scoreYou ?? 0 }
  const opp: Side = { abbr: oppAbbr, color: oppColor, score: snap?.scoreOpp ?? 0 }
  const left = playerIsHome ? you : opp
  const right = playerIsHome ? opp : you
  const phase = snap?.phase ?? 'kickoff'
  const showBanner =
    snap?.message && phase !== 'play' && phase !== 'restart' && phase !== 'fulltime'
  const charge = snap?.shotCharge ?? 0
  const attacking = snap?.possession === 'you'

  return (
    <div className="g3d-hud">
      <div className="g3d-score">
        <div className="side">
          <span className="chip" style={{ background: left.color }} />
          <span className="abbr">{left.abbr}</span>
          <span className="num">{left.score}</span>
        </div>
        <div className="mid">
          <span className="clock">{snap?.displayMin ?? 0}&rsquo;</span>
          <span className="half">{(snap?.half ?? 1) === 1 ? '1ST HALF' : '2ND HALF'}</span>
        </div>
        <div className="side">
          <span className="num">{right.score}</span>
          <span className="abbr">{right.abbr}</span>
          <span className="chip" style={{ background: right.color }} />
        </div>
      </div>

      {showBanner && <div className="g3d-banner">{snap?.message}</div>}

      {charge > 0.02 && (
        <div className="g3d-power">
          <span style={{ width: `${Math.round(charge * 100)}%` }} />
        </div>
      )}

      <div className="g3d-help">
        <div className="row"><b>Move</b> WASD &nbsp;·&nbsp; <b>Sprint</b> hold &uarr; &nbsp;·&nbsp; <b>L2/LT</b> hold Shift</div>
        <div className={`mode ${attacking ? 'on' : ''}`}>
          <span className="tag">ATTACK</span> Space pass (hold loft) · E through · F cross · Q shoot (Shift+Q finesse) · &larr;/&rarr; dribble
        </div>
        <div className={`mode ${!attacking ? 'on' : ''}`}>
          <span className="tag">DEFEND</span> Space switch · Shift jockey · R tackle · F slide · hold Q press &nbsp;·&nbsp; <span className="tag">KEEPER</span> Space throw · Q punt
        </div>
      </div>

      <button className="g3d-exit" onClick={onExit}>Leave</button>
    </div>
  )
}
