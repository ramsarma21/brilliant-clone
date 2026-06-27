import { teamColor, clubCode } from '../lib/teams'
import { blankStandings, SEASON_GAMES } from '../lib/league'
import { ClubEmblem } from './ClubEmblem'
import type { ClubIdentity, LeagueStanding } from '../types'

// The Quantum League table. Standings are derived from the account's seed + matchdays played,
// so this fills in live as you play each week (and matches the final table once the season is
// done). YOUR club shows your name + crest.

export function LeagueStandings({
  table,
  matchesPlayed = 0,
  club,
  playerColors,
  onClose,
}: {
  table: LeagueStanding[] | null | undefined
  matchesPlayed?: number
  club: ClubIdentity
  playerColors: { primary: string; secondary: string; accent: string }
  onClose: () => void
}) {
  const rows = Array.isArray(table) && table.length > 0 ? table : blankStandings()
  const subtitle =
    matchesPlayed >= SEASON_GAMES
      ? 'Final table · 50 games'
      : matchesPlayed > 0
        ? `After ${matchesPlayed} matchday${matchesPlayed === 1 ? '' : 's'}`
        : 'Pre-season · matchday 1'

  return (
    <div
      className="standings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="League standings"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="standings">
        <header className="standings__head">
          <div className="standings__title">
            <span className="eyebrow">The Quantum League · {subtitle}</span>
            <h2>League Standings</h2>
          </div>
          <button className="standings__close" type="button" onClick={onClose} aria-label="Close standings">
            ✕
          </button>
        </header>

        <div className="standings__scroll">
          <div className="standings__row standings__row--head" aria-hidden>
            <span className="standings__pos">#</span>
            <span className="standings__club">Club</span>
            <span>Pl</span>
            <span>W</span>
            <span>D</span>
            <span>L</span>
            <span>GF</span>
            <span>GA</span>
            <span className="standings__gd">GD</span>
            <span className="standings__pts">Pts</span>
          </div>
          <ol className="standings__list">
            {rows.map((r, i) => {
              const gd = r.gf - r.ga
              const c = r.isPlayer ? playerColors : teamColor(r.name)
              const name = r.isPlayer ? club.name : r.name
              return (
                <li
                  key={r.name}
                  className={`standings__row${r.isPlayer ? ' standings__row--me' : ''}`}
                >
                  <span className="standings__pos">{i + 1}</span>
                  <span className="standings__club">
                    <ClubEmblem
                      name={name}
                      primary={c.primary}
                      secondary={c.secondary}
                      accent={c.accent}
                      config={r.isPlayer ? club.emblem : undefined}
                    />
                    <span className="standings__name">
                      <strong>{name}</strong>
                      <small>{clubCode(name)}</small>
                    </span>
                  </span>
                  <span>{r.pl}</span>
                  <span>{r.w}</span>
                  <span>{r.d}</span>
                  <span>{r.l}</span>
                  <span>{r.gf}</span>
                  <span>{r.ga}</span>
                  <span className="standings__gd">{gd > 0 ? `+${gd}` : gd}</span>
                  <span className="standings__pts">{r.pts}</span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </div>
  )
}
