import { useMemo, useState, useEffect } from 'react'
import { useApp } from '../state/AppState'
import { usePlayer } from '../state/PlayerState'
import type { MatchSummary } from '../game/types'
import { kitFor } from './PlayerAvatar'
import { resolveTeamColor, clubCode, LEAGUE_TEAMS } from '../lib/teams'
import { ClubEmblem } from './ClubEmblem'
import { LearningFarm } from './LearningFarm'
import { CoinBurst } from './ui/CoinBurst'
import { sfxCash, sfxSoftFail, sfxTick } from '../game/sfx'
import { MatchGame3D as MatchGame } from '../game/MatchGame3D'
import { abbreviateClub, localAbbr } from '../lib/ai/abbreviateClient'

// Quick dopamine rounds: every match is a short 60-second burst.
const MATCH_DURATION = 60

// A fresh random opponent every time — no league, no ladder, just a new face.
const randomOpponent = () => LEAGUE_TEAMS[Math.floor(Math.random() * LEAGUE_TEAMS.length)]

export function Dashboard() {
  const { progress, logout, resetProgress, markTutorialSeen, consumeMatchUnlock } = useApp()
  const { profile: player, setClubAbbr } = usePlayer()

  const [opponent, setOpponent] = useState<string>(randomOpponent)

  const clubName = player.club.name
  const clubColors = kitFor(player.equipped.jersey)
  const oppColor = useMemo(() => resolveTeamColor(opponent, clubColors.primary), [opponent, clubColors.primary])
  const oppAbbr = useMemo(() => clubCode(opponent), [opponent])

  // A match is EARNED by mastering learning. `matchUnlocked` is the reward credit —
  // set when you master a session, spent to play a quick round.
  const matchUnlocked = progress.matchUnlocked ?? false
  const canPlay = matchUnlocked
  const farmIsHero = !matchUnlocked

  // Broadcast abbreviation for the scorecard (AI Edge Function w/ local fallback, cached on the club).
  const clubAbbr = player.club.abbr ?? localAbbr(player.club.name)
  useEffect(() => {
    if (player.club.abbr) return
    let cancelled = false
    void abbreviateClub(player.club.name).then((abbr) => { if (!cancelled) setClubAbbr(abbr) })
    return () => { cancelled = true }
  }, [player.club.abbr, player.club.name, setClubAbbr])

  const [farmOpen, setFarmOpen] = useState(false)
  const [matchOpen, setMatchOpen] = useState(false)
  const [settle, setSettle] = useState<{ won: boolean } | null>(null)
  const [tutorialOpen, setTutorialOpen] = useState(!progress.tutorialSeen)

  const dismissTutorial = () => {
    setTutorialOpen(false)
    markTutorialSeen()
    sfxTick()
  }

  const handlePlay = () => {
    if (!canPlay) return
    sfxTick()
    consumeMatchUnlock() // spend the match you earned by mastering learning
    setMatchOpen(true)
  }

  const handleMatchFinish = (summary: MatchSummary) => {
    const won = summary.scoreYou > summary.scoreOpp
    if (won) sfxCash(); else sfxSoftFail()
    setMatchOpen(false)
    setSettle({ won })
    setOpponent(randomOpponent()) // new opponent for the next match
  }

  return (
    <div className="dashboard gdash gdash--v2">
      {/* ============ PERSISTENT TOP BAR ============ */}
      <header className="gtop">
        <span className="brand">
          <img className="brand__logo" src="/physics-fc-trophy.png" alt="" aria-hidden />
          PHYSICS FC
        </span>

        <div className="gtop__right">
          <button className="btn btn--ghost btn--sm" onClick={logout}>Log out</button>
        </div>
      </header>

      {/* ============ TWO RAILS: LEARN → PLAY ============ */}
      <div className="rails rails--two">
        {/* ---- RAIL 1: TRAINING (learn to earn your match) ---- */}
        <section className={`rail rail--farm${farmIsHero ? ' is-hero' : ''}`}>
          <span className="rail__eyebrow rail__eyebrow--coin">Train to play</span>
          <div className="rail__head">
            <span className="rail__bigicon" aria-hidden>📚</span>
            <div>
              <h2 className="rail__title">Learning Farm</h2>
              <p className="rail__sub">Master a short physics session to unlock a quick match. The game is your reward for learning.</p>
            </div>
          </div>

          <div className="farmrail__stats">
            <div className="farmrail__stat">
              <span>Reward</span>
              <strong>⚽ A match</strong>
            </div>
          </div>

          <div className="farmrail__cta-wrap">
            {!progress.firstFarmDone && (
              <div className="earn-arrow" aria-hidden>
                <span className="earn-arrow__label">START HERE</span>
                <span className="earn-arrow__point">▾</span>
              </div>
            )}
            <button type="button" className={`rail__cta rail__cta--coin${!progress.firstFarmDone ? ' is-beckon' : ''}`} onClick={() => { sfxTick(); setFarmOpen(true) }}>
              {matchUnlocked ? 'Train again' : progress.firstFarmDone ? 'Train' : 'Start training'} <span aria-hidden>▶</span>
            </button>
          </div>
        </section>

        {/* ---- RAIL 2: THE QUICK MATCH (your reward) ---- */}
        <section className={`rail rail--match${canPlay ? ' is-hero' : ''}`}>
          <span className="rail__eyebrow rail__eyebrow--go">Your reward</span>
          <div className="matchup">
            <div className="matchup__team">
              <div className="matchup__crest">
                <ClubEmblem name={clubName} primary={clubColors.primary} secondary={clubColors.secondary} accent={clubColors.accent} config={player.club.emblem} size={56} />
              </div>
              <span className="matchup__name">{clubAbbr}</span>
            </div>
            <span className="matchup__vs">VS</span>
            <div className="matchup__team">
              <div className="matchup__crest matchup__crest--opp" style={{ background: oppColor }}><span>{oppAbbr}</span></div>
              <span className="matchup__name">{opponent}</span>
            </div>
          </div>

          <p className="matchgoal">A quick 60-second round against <strong>{opponent}</strong>.</p>

          {canPlay ? (
            <button className="rail__cta rail__cta--go" onClick={handlePlay}>Play your match <span aria-hidden>▶</span></button>
          ) : (
            <button className="rail__cta rail__cta--locked" onClick={() => { sfxTick(); setFarmOpen(true) }}>
              <span aria-hidden>🔒</span> Train to unlock a match →
            </button>
          )}
        </section>
      </div>

      <div className="dev-actions">
        <button className="btn btn--ghost btn--sm reset-link" onClick={resetProgress}>Reset career progress</button>
      </div>

      {farmOpen && (
        <div className="qtest-overlay qtest-overlay--dark" role="dialog" aria-modal="true">
          <LearningFarm
            onExit={() => setFarmOpen(false)}
            onRewardMatch={() => { setFarmOpen(false); consumeMatchUnlock(); setMatchOpen(true) }}
          />
        </div>
      )}

      {matchOpen && (
        <div className="matchgame-overlay" role="dialog" aria-modal="true">
          <MatchGame
            matchday={1}
            playerName={clubName}
            playerAbbr={clubAbbr}
            playerColors={clubColors}
            opponentName={opponent}
            playerIsHome
            appearance={player.appearance}
            durationSeconds={MATCH_DURATION}
            onFinish={handleMatchFinish}
            onExit={() => setMatchOpen(false)}
          />
        </div>
      )}

      {settle && (
        <div className="qtest-overlay qtest-overlay--dark" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setSettle(null) }}>
          <div className={`card qtest farm-result${settle.won ? ' farm-result--win' : ' farm-result--bust'}`}>
            {settle.won && <CoinBurst count={20} />}
            <span className={`eyebrow${settle.won ? '' : ' eyebrow--fail'}`}>Full time</span>
            <h1 className="qtest__h1">{settle.won ? 'Win! 🎉' : 'Tough one'}</h1>
            <p className="qtest__lede">
              {settle.won
                ? 'Nice finish. Master another session to play again.'
                : 'It happens. Master another session and run it back.'}
            </p>
            <div className="qtest__foot qtest__foot--end">
              <button className="btn btn--primary" onClick={() => setSettle(null)}>Continue →</button>
            </div>
          </div>
        </div>
      )}

      {tutorialOpen && <HowItWorks onDone={dismissTutorial} />}
    </div>
  )
}

/** First-visit overlay that teaches the (coinless, roster-free) core loop. */
function HowItWorks({ onDone }: { onDone: () => void }) {
  const beats = [
    <>Here's the whole loop. It's simple.</>,
    <><strong>Master a physics session</strong> in the Learning Farm to unlock a match.</>,
    <>Playing a <strong>quick 60-second match</strong> is your reward for learning.</>,
    <>Master more, play more. That's it.</>,
  ]
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (shown >= beats.length) return
    const t = window.setTimeout(() => setShown((s) => s + 1), shown === 0 ? 350 : 1600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])
  const ready = shown >= beats.length
  return (
    <div className="tut" role="dialog" aria-modal="true" onClick={ready ? onDone : undefined}>
      <div className="tut__scrim" aria-hidden />
      <div className="tut__center">
        <span className="tut__eyebrow">How it works</span>
        <ul className="tut__beats">
          {beats.slice(0, shown).map((b, i) => (
            <li key={i} className="tut__beat">{b}</li>
          ))}
        </ul>
        <button
          className={`btn btn--primary tut__cta${ready ? ' is-ready' : ''}`}
          onClick={onDone}
          disabled={!ready}
        >
          {ready ? "Let's go ▶" : '…'}
        </button>
      </div>
    </div>
  )
}
