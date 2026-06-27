import { useState } from 'react'
import { teamColor, clubCode } from '../lib/teams'
import { SEASON_GAMES, yourResult } from '../lib/league'
import { ClubEmblem } from './ClubEmblem'

// The full 50-game season schedule for THIS account's seed, paginated 10 at a time.
// Played weeks show the (deterministic, seed-derived) scoreline; the current week is
// shaded gold; later weeks are upcoming fixtures. Opens on the current week's page.

const PER_PAGE = 10

export function LeagueSchedule({
  seed,
  matchesPlayed,
  onClose,
}: {
  seed: number
  /** Weeks 1..matchesPlayed are done; week matchesPlayed+1 is the current one. */
  matchesPlayed: number
  onClose: () => void
}) {
  const totalPages = Math.ceil(SEASON_GAMES / PER_PAGE)
  // The current matchday (the one you're about to play), clamped into the season.
  const currentWeek = Math.min(SEASON_GAMES, matchesPlayed + 1)
  const [page, setPage] = useState(Math.floor((currentWeek - 1) / PER_PAGE))

  const start = page * PER_PAGE
  const weeks = Array.from(
    { length: Math.min(PER_PAGE, SEASON_GAMES - start) },
    (_, i) => start + i + 1,
  )

  return (
    <div
      className="standings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Season schedule"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="standings sched-modal">
        <header className="standings__head">
          <div className="standings__title">
            <span className="eyebrow">The Quantum League · Fixtures</span>
            <h2>Season Schedule</h2>
          </div>
          <button className="standings__close" type="button" onClick={onClose} aria-label="Close schedule">
            ✕
          </button>
        </header>

        <ol className="sched-list">
          {weeks.map((wk) => {
            const played = wk <= matchesPlayed
            const isCurrent = wk === currentWeek && matchesPlayed < SEASON_GAMES
            const m = yourResult(wk, seed)
            const c = teamColor(m.opponent)
            const outcome = m.gf > m.ga ? 'W' : m.gf === m.ga ? 'D' : 'L'
            return (
              <li
                key={wk}
                className={`sched-row${isCurrent ? ' sched-row--current' : ''}${
                  played ? ' sched-row--played' : ''
                }`}
              >
                <span className="sched-row__wk">MD{wk}</span>
                <span className="sched-row__club">
                  <ClubEmblem name={m.opponent} primary={c.primary} secondary={c.secondary} accent={c.accent} />
                  <span className="sched-row__name">
                    <strong>{m.home ? 'vs' : '@'} {m.opponent}</strong>
                    <small>{clubCode(m.opponent)} · {m.home ? 'Home' : 'Away'}</small>
                  </span>
                </span>
                <span className="sched-row__res">
                  {played ? (
                    <>
                      <span className={`sched-pill sched-pill--${outcome.toLowerCase()}`}>{outcome}</span>
                      <b>{m.gf}–{m.ga}</b>
                    </>
                  ) : isCurrent ? (
                    <span className="sched-row__now">This week</span>
                  ) : (
                    <span className="sched-row__soon">Upcoming</span>
                  )}
                </span>
              </li>
            )
          })}
        </ol>

        <div className="assess-pager sched-pager">
          <button className="assess-pager__btn" type="button" onClick={() => setPage(0)} disabled={page === 0} aria-label="First page">«</button>
          <button className="assess-pager__btn" type="button" onClick={() => setPage(page - 1)} disabled={page === 0} aria-label="Previous page">‹</button>
          <span className="assess-pager__label">Matchdays {start + 1}–{start + weeks.length}</span>
          <button className="assess-pager__btn" type="button" onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1} aria-label="Next page">›</button>
          <button className="assess-pager__btn" type="button" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} aria-label="Last page">»</button>
        </div>
      </div>
    </div>
  )
}
