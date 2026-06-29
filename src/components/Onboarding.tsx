import { useEffect, useState } from 'react'
import { useApp } from '../state/AppState'
import { usePlayer } from '../state/PlayerState'
import { kitFor } from './PlayerAvatar'
import { localAbbr } from '../lib/ai/abbreviateClient'
import { MatchGame3D as MatchGame } from '../game/MatchGame3D'
import { sfxCheer, sfxWhistle } from '../game/sfx'

// The underdog intro: a short story, a guaranteed-winnable 1-minute first match
// vs a trivially weak side, then a welcome sequence into the dashboard. Shown once
// per career (gated on progress.introDone) and re-triggered by a career reset.

const INTRO_OPPONENT = 'The Cadets'

type Phase = 'story' | 'match' | 'welcome'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { profile } = useApp()
  const { profile: player } = usePlayer()
  const [phase, setPhase] = useState<Phase>('story')

  const clubName = player.club.name
  const clubColors = kitFor(player.equipped.jersey)
  const clubAbbr = player.club.abbr ?? localAbbr(clubName)

  return (
    <div className="onb">
      <div className="onb__bg" aria-hidden />
      {phase === 'story' && (
        <StoryCard clubName={clubName} onKickoff={() => setPhase('match')} />
      )}

      {phase === 'match' && (
        <div className="matchgame-overlay" role="dialog" aria-modal="true">
          <MatchGame
            matchday={1}
            playerName={clubName}
            playerAbbr={clubAbbr}
            playerColors={clubColors}
            opponentName={INTRO_OPPONENT}
            playerIsHome
            appearance={player.appearance}
            durationSeconds={60}
            opponentMinnow
            guaranteedWin
            onFinish={() => setPhase('welcome')}
            onExit={() => setPhase('welcome')}
          />
        </div>
      )}

      {phase === 'welcome' && (
        <WelcomeSequence clubName={clubName} displayName={profile.displayName.split(' ')[0]} onDone={onDone} />
      )}
    </div>
  )
}

function StoryCard({ clubName, onKickoff }: { clubName: string; onKickoff: () => void }) {
  const lines = [
    { tag: 'The underdog', body: <>Nobody gave <strong>{clubName}</strong> a prayer. Time to change that.</> },
    { tag: 'How you rise', body: <>You don't buy your way up. You earn it by mastering physics. Nail a short session to unlock each match.</> },
    { tag: 'The reward', body: <>Get the concepts right, unlock a quick match, and let every game be your payoff for learning.</> },
  ]
  const [shown, setShown] = useState(0)

  // Reveal the story beats one at a time.
  useEffect(() => {
    if (shown >= lines.length) return
    const t = window.setTimeout(() => setShown((s) => s + 1), shown === 0 ? 400 : 1500)
    return () => window.clearTimeout(t)
  }, [shown, lines.length])

  const ready = shown >= lines.length
  return (
    <div className="onb-card">
      <span className="onb-card__eyebrow">Your story begins</span>
      <h1 className="onb-card__title">Master the Physics.<br />Play the Game.</h1>
      <ul className="onb-beats">
        {lines.slice(0, shown).map((l, i) => (
          <li key={i} className="onb-beat">
            <span className="onb-beat__tag">{l.tag}</span>
            <p>{l.body}</p>
          </li>
        ))}
      </ul>
      <button
        className={`btn btn--primary onb-card__cta${ready ? ' is-ready' : ''}`}
        onClick={onKickoff}
        disabled={!ready}
      >
        {ready ? 'Play your first match ▶' : '…'}
      </button>
    </div>
  )
}

function WelcomeSequence({ clubName, displayName, onDone }: { clubName: string; displayName: string; onDone: () => void }) {
  const lines = [
    <>Full time. <strong>Nice win</strong>, {displayName}.</>,
    <>From here, <strong>{clubName}</strong> earns every match by mastering physics.</>,
    <>Master a short session to unlock your next game. Let's get learning.</>,
  ]
  const [shown, setShown] = useState(0)

  useEffect(() => {
    sfxWhistle()
    const t = window.setTimeout(() => sfxCheer(), 250)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (shown >= lines.length) return
    const t = window.setTimeout(() => setShown((s) => s + 1), shown === 0 ? 300 : 1500)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])

  const ready = shown >= lines.length
  return (
    <div className="onb-card onb-card--welcome">
      <span className="onb-card__eyebrow">Matchday 1 · complete</span>
      <ul className="onb-msgs">
        {lines.slice(0, shown).map((l, i) => (
          <li key={i} className="onb-msg">{l}</li>
        ))}
      </ul>
      <button
        className={`btn btn--primary onb-card__cta${ready ? ' is-ready' : ''}`}
        onClick={onDone}
        disabled={!ready}
      >
        {ready ? 'Start training →' : '…'}
      </button>
    </div>
  )
}

export default Onboarding
