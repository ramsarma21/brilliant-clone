import { useMemo, useState } from 'react'
import { useApp } from '../state/AppState'
import { usePlayer } from '../state/PlayerState'
import { LESSONS, UNITS, UNIT_THEME } from '../content/lessons'
import { SKILLS } from '../lib/skills'
import type { SkillId, UnitStatus, UserProgress, TestAttempt } from '../types'
import { CardFace, ATTR_ABBR, kitFor } from './PlayerAvatar'
import { faceColors } from '../lib/appearance'
import { SEASON_GAMES, simulateSeason, standingsAfter, ordinal, yourFixture, yourResult } from '../lib/league'
import { PlayerLocker } from './PlayerLocker'
import { DailyWheel } from './DailyWheel'
import { AttemptReview } from './TestScreen'
import { LeagueStandings } from './LeagueStandings'
import { LeagueSchedule } from './LeagueSchedule'
import { ClubEmblem } from './ClubEmblem'

const STATUS_LABEL: Record<UnitStatus, string> = {
  locked: 'Locked',
  available: 'Play',
  in_progress: 'In progress',
  mastered: 'Completed',
}

// Win the season to earn promotion to the top flight.
const TOP_FLIGHT = 'The Quantum League'

// Quantum League opponents — the physics-flavoured clubs live in lib/teams.ts, where each
// is also assigned a jersey colour (and a clash-guard vs your kit).
const MATCH_REWARD_COINS = 10
// End-of-season placement bonus, indexed by 1-based finishing position (1st/2nd/3rd).
const PLACEMENT_REWARD: Record<number, number> = { 1: 300, 2: 200, 3: 100 }
// TEMP (testing): force YOUR club to finish 1st on the next sim. Flip to false to ship.
const HARDCODE_PLAYER_FIRST = true

function fmtAttemptDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  )
}

// Each unit is an opponent club on the season schedule (varied suffixes, not all "FC").
const CLUB_NAME: Record<SkillId, string> = {
  kinematics: 'Kinematic FC',
  'motion-graphs': 'FC Motion',
  forces: 'Forces Athletic',
  energy: 'Energy Hotspur',
  momentum: 'Momentum United',
  impulse: 'Momentum City',
}

function unitChecksDone(lessonId: string, progress: UserProgress): number {
  const lp = progress.lessonState[lessonId]
  if (!lp) return 0
  if (lessonId === 'lesson-projectile') {
    const lessonDone = Boolean(lp.completedAt)
    const samplesAndSim =
      Boolean(lp.masteryChecksCorrect['proj-prediction']) &&
      Boolean(lp.masteryChecksCorrect['proj-numeric']) &&
      Boolean(lp.masteryChecksCorrect['proj-challenge']) &&
      lp.manipulationChallengeComplete
    const quiz = Boolean(lp.masteryChecksCorrect['proj-quiz'])
    return [lessonDone, samplesAndSim, quiz].filter(Boolean).length
  }
  return LESSONS[lessonId].steps.filter(
    (s) => 'conceptTags' in s && lp.masteryChecksCorrect[s.id],
  ).length
}

export function Dashboard({
  onOpenLesson,
  onOpenTest,
}: {
  onOpenLesson: (lessonId: string) => void
  onOpenTest: () => void
}) {
  const {
    profile,
    progress,
    logout,
    resetProgress,
    skipAllLessons,
    playQuantumMatch,
    setLeagueTable,
    wheelAvailable,
    claimDailyWheel,
    resetDailyWheel,
  } = useApp()
  const { overall, profile: player, testHistory, addCoins, simSeasonStats } = usePlayer()

  const masteredCount = UNITS.filter((u) => progress.unitStatus[u.id] === 'mastered').length
  const pct = Math.round((masteredCount / UNITS.length) * 100)
  const courseComplete = masteredCount === UNITS.length

  // Quantum League ladder: each assessment completed (a top-flight test) unlocks
  // exactly one more match. The test is only reachable once promoted, so the
  // number of test attempts == assessments completed.
  // Only PASSED attempts (≥70%) whose guided Skills review is finished count toward the
  // league ladder — a failed exam never unlocks a matchday. (Legacy attempts lacking the
  // review flag are treated as complete.)
  const assessmentsCompleted = testHistory.filter((a) => a.passed70 && a.reviewComplete !== false).length
  const matchesPlayed = progress.quantumMatchesPlayed ?? 0
  const leagueSeed = progress.leagueSeed ?? 0
  // `nextMatchNo` is the match index the 1:1 assessment gate keys off. Single 50-game season.
  const nextMatchNo = matchesPlayed + 1
  const nextMatchday = Math.min(SEASON_GAMES, matchesPlayed + 1)
  const nextFixture = yourFixture(nextMatchday, leagueSeed)
  const nextOpponent = nextFixture.opponent
  const clubName = player.club.name
  const clubColors = kitFor(player.equipped.jersey)
  const matchUnlocked = assessmentsCompleted >= nextMatchNo
  const firstAssessmentDone = assessmentsCompleted >= 1
  // Whole season done: all 50 assessments passed (the gate to unlock all 50 matchdays).
  const allAssessmentsDone = assessmentsCompleted >= SEASON_GAMES
  // Standings are derived from the seed + matchdays played, so they fill in live as you play.
  // A full sim stores a (forced-first, for testing) snapshot, which we prefer once present.
  const storedTable = progress.leagueTable ?? null
  const liveTable = useMemo(() => standingsAfter(leagueSeed, matchesPlayed), [leagueSeed, matchesPlayed])
  const displayTable = storedTable && storedTable.length > 0 ? storedTable : liveTable
  const seasonComplete = matchesPlayed >= SEASON_GAMES
  const playerPlace = seasonComplete ? displayTable.findIndex((r) => r.isPlayer) + 1 : 0
  const placeBonus = PLACEMENT_REWARD[playerPlace] ?? 0
  const [hubOpen, setHubOpen] = useState(false)
  const [assessOpen, setAssessOpen] = useState(false)
  const [assessPage, setAssessPage] = useState(0)
  const [viewAttempt, setViewAttempt] = useState<TestAttempt | null>(null)
  const [standingsOpen, setStandingsOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [wheelOpen, setWheelOpen] = useState(false)

  // "Promotion won!" banner can be dismissed; it disappears for good once the first
  // assessment is attempted anyway, so a local flag (no DB round-trip) is plenty.
  const legendKey = `legendDismissed:${profile.username}`
  const [legendDismissed, setLegendDismissed] = useState(() => {
    try { return localStorage.getItem(legendKey) === '1' } catch { return false }
  })
  const dismissLegend = () => {
    setLegendDismissed(true)
    try { localStorage.setItem(legendKey, '1') } catch { /* ignore */ }
  }

  // Playing an unlocked matchday sims THAT week for you and the whole league: your match counter
  // ticks up (which advances the seed-derived standings for every club) and persists to the
  // cloud. A win pays the match reward. We pop the standings so the update is visible.
  const handlePlayMatch = () => {
    if (!matchUnlocked || seasonComplete) return
    const result = yourResult(nextMatchday, leagueSeed)
    playQuantumMatch()
    if (result.gf > result.ga) addCoins(MATCH_REWARD_COINS)
    setStandingsOpen(true)
  }

  // Sim the whole 50-game season at once. Fresh randomness every time (so a re-sim after a
  // reset gives different results). Stores the final table + marks 50 matches played, and
  // fabricates a full season's player metadata (50 assessments, random skills/proficiency) —
  // all persisted to the cloud and wiped on reset. Coins = wins × 10 + placement bonus.
  const handleSimSeason = () => {
    const table = simulateSeason(leagueSeed, HARDCODE_PLAYER_FIRST)
    setLeagueTable(table)
    simSeasonStats(SEASON_GAMES)
    const me = table.find((r) => r.isPlayer)
    const place = table.findIndex((r) => r.isPlayer) + 1
    const wins = me?.w ?? 0
    const bonus = PLACEMENT_REWARD[place] ?? 0
    addCoins(wins * MATCH_REWARD_COINS + bonus)
    setStandingsOpen(true)
  }

  const nextIndex = UNITS.findIndex((u) => progress.unitStatus[u.id] !== 'mastered')
  const nextUnit = nextIndex >= 0 ? UNITS[nextIndex] : UNITS[0]
  const nextTheme = UNIT_THEME[nextUnit.id]

  // You're always a striker in this game — position never changes.
  const position = 'ST'
  const firstName = profile.displayName.split(' ')[0]
  const [lockerOpen, setLockerOpen] = useState(false)

  return (
    <div className="dashboard career">
      <header className="hud">
        {/* Game wordmark — STATIC (the name of the game), not the player's club. */}
        <span className="brand">
          <img className="brand__logo" src="/physics-fc-trophy.png" alt="" aria-hidden />
          PHYSICS FC
        </span>
        <div className="hud__right">
          <span className="hud__chip hud__chip--coin" title="Coins">
            <span className="coin-icon" aria-hidden />
            <strong>{player.coins}</strong>
            <span>Coins</span>
          </span>
          <button className="btn btn--ghost btn--sm hud__action" type="button">Settings</button>
          <button className="btn btn--ghost btn--sm hud__action" onClick={logout}>Log out</button>
        </div>
      </header>

      <div className="career__grid">
        {/* FUT-style player card — click to customize */}
        <button type="button" className="fut" onClick={() => setLockerOpen(true)} title="Customize your player">
          <span className="fut__shine" aria-hidden />
          {player.skillPoints > 0 && <span className="fut__pts">{player.skillPoints} pts</span>}
          <div className="fut__topline">
            <div className="fut__ovr">
              <b>{overall}</b>
              <span>OVR</span>
            </div>
            <div className="fut__posbadge">{position}</div>
            <div className="fut__crest" aria-hidden>
              <ClubEmblem
                name={clubName}
                primary={clubColors.primary}
                secondary={clubColors.secondary}
                accent={clubColors.accent}
                config={player.club.emblem}
                size={30}
              />
            </div>
          </div>

          <CardFace jersey={kitFor(player.equipped.jersey)} face={faceColors(player.appearance)} />

          <div className="fut__name">{profile.displayName.toUpperCase()}</div>
          <div className="fut__club">{clubName.toUpperCase()}</div>

          <div className="fut__attrs">
            {SKILLS.map((s) => (
              <div className="fut__attr" key={s.id}>
                <b>{player.skills[s.id] ?? 50}</b>
                <span>{ATTR_ABBR[s.id]}</span>
              </div>
            ))}
          </div>
          <span className="fut__edit" aria-hidden>Customize ✎</span>
        </button>

        {/* Career main column */}
        <section className="career__main">
          <div className="career__season">
            <div className="career__season-head">
              <div className="career__welcome">
              <h1>Welcome back, {firstName}.</h1>
              <p>{!courseComplete
                ? `Win all ${UNITS.length} fixtures to earn promotion to ${TOP_FLIGHT}.`
                : firstAssessmentDone
                  ? `You're in ${TOP_FLIGHT}. Pass assessments to unlock your next league match and earn skill points.`
                  : `Every fixture won — ${clubName} is promoted to ${TOP_FLIGHT}. Take your skills assessment to claim skill points.`}</p>
              </div>
              {courseComplete && wheelAvailable && (
                <button
                  type="button"
                  className="wheel-cta"
                  onClick={() => setWheelOpen(true)}
                  title="Spin today's daily wheel"
                >
                  <span className="wheel-cta__icon" aria-hidden>🎡</span>
                  <span className="wheel-cta__label">
                    <small>Daily reward · ready</small>
                    <strong>Spin the wheel</strong>
                  </span>
                </button>
              )}
            </div>
            {!courseComplete && (
              <div className="career__progress">
                <div className="career__bar">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="career__progress-meta">
                  <span><strong>{masteredCount}</strong>/{UNITS.length} units mastered</span>
                  <span>{pct}%</span>
                </div>
              </div>
            )}
          </div>

          {!courseComplete ? (
            <button
              className="fixture fixture--next"
              style={{ '--unit-accent': nextTheme.accent } as React.CSSProperties}
              onClick={() => onOpenLesson(nextUnit.lessonId)}
            >
              <span className="fixture__week">MW{(nextIndex < 0 ? 0 : nextIndex) + 1}</span>
              <span className="fixture__badge">{nextTheme.icon}</span>
              <span className="fixture__body">
                <span className="eyebrow">Next fixture · MW{(nextIndex < 0 ? 0 : nextIndex) + 1}</span>
                <strong>{clubName} <span className="fixture__vs">vs</span> {CLUB_NAME[nextUnit.id as SkillId]}</strong>
              </span>
              <span className="fixture__cta">
                {progress.unitStatus[nextUnit.id] === 'in_progress' ? 'Resume' : 'Kick off'} →
              </span>
            </button>
          ) : !firstAssessmentDone && !legendDismissed ? (
            <div className="career__legend">
              <span className="career__legend-burst">🏆</span>
              <div>
                <strong>Promotion won!</strong>
                <span>All {UNITS.length} fixtures won, onto {TOP_FLIGHT}!</span>
              </div>
              <button
                type="button"
                className="career__legend-close"
                onClick={dismissLegend}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          ) : null}

          {courseComplete ? (
            <button
              className={`combine-card${matchUnlocked || allAssessmentsDone ? ' combine-card--complete' : ''}`}
              onClick={
                matchUnlocked || allAssessmentsDone
                  ? () => setAssessOpen((o) => { if (!o) { setHubOpen(false); setAssessPage(0) } return !o })
                  : onOpenTest
              }
              aria-expanded={matchUnlocked || allAssessmentsDone ? assessOpen : undefined}
            >
              <span className="combine-card__icon">🏆</span>
              <span className="combine-card__body">
                <span className="eyebrow">
                  {allAssessmentsDone
                    ? `${TOP_FLIGHT} · Champion`
                    : matchUnlocked
                      ? 'Assessment complete'
                      : firstAssessmentDone
                        ? TOP_FLIGHT
                        : `${TOP_FLIGHT} · unlocked`}
                </span>
                <strong>
                  {allAssessmentsDone
                    ? 'All skills assessments passed!'
                    : matchUnlocked
                      ? 'Skills assessment complete'
                      : 'Skills assessment'}
                </strong>
                <span className="muted">
                  {allAssessmentsDone
                    ? `Every one of the ${SEASON_GAMES} assessments cleared — you've conquered ${TOP_FLIGHT}.`
                    : matchUnlocked
                      ? `Matchday ${nextMatchday} unlocked — play ${nextOpponent} below`
                      : `Pass to unlock Matchday ${nextMatchday} vs ${nextOpponent}`}
                </span>
              </span>
              <span className="combine-card__stats">
                {matchUnlocked || allAssessmentsDone ? (
                  <span className="combine-card__done">
                    View <span className={`combine-card__chev${assessOpen ? ' open' : ''}`} aria-hidden>▾</span>
                  </span>
                ) : (
                  <span><b>{overall}</b> OVR</span>
                )}
              </span>
            </button>
          ) : (
            <div className="combine-card combine-card--locked" aria-disabled="true">
              <span className="combine-card__icon">🔒</span>
              <span className="combine-card__body">
                <span className="eyebrow">{TOP_FLIGHT} · Locked</span>
                <strong>Win promotion to unlock</strong>
                <span className="muted">Win all {UNITS.length} fixtures</span>
              </span>
              <span className="combine-card__stats">
                <span className="combine-card__count"><b>{masteredCount}</b>/{UNITS.length}</span>
              </span>
            </div>
          )}

          {courseComplete && (matchUnlocked || allAssessmentsDone) && assessOpen && (
            <div className="qhub qhub--open assess-hist">
              {testHistory.length === 0 ? (
                <p className="assess-empty">No assessments recorded yet.</p>
              ) : (() => {
                const PER_PAGE = 5
                const totalPages = Math.ceil(testHistory.length / PER_PAGE)
                const page = Math.min(assessPage, totalPages - 1)
                const start = page * PER_PAGE
                const rows = testHistory.slice(start, start + PER_PAGE)
                return (
                  <>
                    <ol className="qhub__list">
                      {rows.map((a, i) => {
                        const idx = start + i
                        const pctScore = a.total > 0 ? Math.round((a.score / a.total) * 100) : 0
                        const bought = a.id.startsWith('autopass-')
                        return (
                          <li key={a.id} className="qdrill">
                            <button className="qdrill__btn assess-row" onClick={() => setViewAttempt(a)}>
                              <span className="assess-row__no">#{testHistory.length - idx}</span>
                              <span className="qdrill__main">
                                <strong>{pctScore}% · {a.score}/{a.total}</strong>
                                <span className="assess-row__date">{fmtAttemptDate(a.takenAt)}</span>
                              </span>
                              {bought && (
                                <span className="assess-row__bought" title="Auto-passed — bought for 200 coins">
                                  −200<span className="coin-icon" aria-hidden />
                                </span>
                              )}
                              <span className="qdrill__cta">View →</span>
                            </button>
                          </li>
                        )
                      })}
                    </ol>
                    {totalPages > 1 && (
                      <div className="assess-pager">
                        <button className="assess-pager__btn" type="button" onClick={() => setAssessPage(0)} disabled={page === 0} aria-label="First page">«</button>
                        <button className="assess-pager__btn" type="button" onClick={() => setAssessPage(page - 1)} disabled={page === 0} aria-label="Previous page">‹</button>
                        <span className="assess-pager__label">Page {page + 1} of {totalPages}</span>
                        <button className="assess-pager__btn" type="button" onClick={() => setAssessPage(page + 1)} disabled={page >= totalPages - 1} aria-label="Next page">›</button>
                        <button className="assess-pager__btn" type="button" onClick={() => setAssessPage(totalPages - 1)} disabled={page >= totalPages - 1} aria-label="Last page">»</button>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          {courseComplete && (
            <div className={`qhub qhub--training${hubOpen ? ' qhub--open' : ''}`}>
              <button
                type="button"
                className="qhub__head"
                onClick={() => setHubOpen((o) => { if (!o) setAssessOpen(false); return !o })}
                aria-expanded={hubOpen}
              >
                <span className="qhub__title">
                  <span className="eyebrow">Training ground</span>
                  <strong>Practice your skills</strong>
                </span>
                <span className="qhub__chev" aria-hidden>▾</span>
              </button>
              {hubOpen && (
                <ol className="qhub__list">
                  {UNITS.map((unit) => {
                    const theme = UNIT_THEME[unit.id]
                    const skill = SKILLS.find((s) => s.id === unit.id)
                    return (
                      <li
                        key={unit.id}
                        className="qdrill"
                        style={{ '--unit-accent': theme.accent } as React.CSSProperties}
                      >
                        <button className="qdrill__btn" onClick={() => onOpenLesson(unit.lessonId)}>
                          <span className="qdrill__badge">{theme.icon}</span>
                          <span className="qdrill__main">
                            <strong>{skill?.name ?? CLUB_NAME[unit.id as SkillId]}</strong>
                          </span>
                          <span className="qdrill__cta">Train →</span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          )}

        </section>
      </div>

      {courseComplete ? (
        <section className="schedule qleague">
          <header className="schedule__head">
            <div className="schedule__title">
              <span className="eyebrow">{TOP_FLIGHT}</span>
              <h3>League Fixtures</h3>
            </div>
            <div className="schedule__actions">
              <button
                type="button"
                className="sched-toggle"
                onClick={() => setScheduleOpen(true)}
                title="See the full season schedule"
              >
                Show schedule
              </button>
              <button
                type="button"
                className="sched-toggle"
                onClick={() => setStandingsOpen(true)}
                title="View the full league table"
              >
                League Standings
              </button>
            </div>
          </header>

          <div className="qleague__body">
            {seasonComplete ? (
              <button
                className={`fixture qmatch qmatch--done qmatch--${
                  playerPlace === 1 ? 'gold' : playerPlace === 2 ? 'silver' : playerPlace === 3 ? 'bronze' : 'none'
                }`}
                onClick={() => setStandingsOpen(true)}
                title="View the final league table"
              >
                <span className="fixture__week">🏆</span>
                <span className="fixture__body">
                  <span className="eyebrow">Season complete · final table</span>
                  <strong>
                    {clubName} finished {ordinal(playerPlace)}
                    {placeBonus > 0 && <> · +{placeBonus} bonus</>}
                  </strong>
                </span>
                <span className="fixture__cta">View standings →</span>
              </button>
            ) : matchUnlocked ? (
              <button
                className="fixture fixture--next qmatch"
                onClick={handlePlayMatch}
                title={`Play Matchday ${nextMatchday}`}
              >
                <span className="fixture__week">MD{nextMatchday}</span>
                <span className="fixture__badge">⚔️</span>
                <span className="fixture__body">
                  <span className="eyebrow">Matchday {nextMatchday} · {nextFixture.home ? 'home' : 'away'}</span>
                  <strong>{clubName} <span className="fixture__vs">vs</span> {nextOpponent}</strong>
                </span>
                <span className="fixture__cta">Play →</span>
              </button>
            ) : (
              <div className="fixture qmatch qmatch--locked" aria-disabled="true">
                <span className="fixture__week">MD{nextMatchday}</span>
                <span className="fixture__badge">🔒</span>
                <span className="fixture__body">
                  <span className="eyebrow">Matchday {nextMatchday} · locked</span>
                  <strong>{clubName} <span className="fixture__vs">vs</span> {nextOpponent}</strong>
                  <span className="qmatch__hint">
                    Pass assessment #{nextMatchNo} to unlock this match — tap the {TOP_FLIGHT} assessment above.
                  </span>
                </span>
                <span className="fixture__cta fixture__cta--locked">Assessment #{nextMatchNo} →</span>
              </div>
            )}

            <div className="qleague__stats">
              <div className="qstat">
                <b>{matchesPlayed}</b>
                <span>Matches played</span>
              </div>
              <div className="qstat">
                <b>{assessmentsCompleted}</b>
                <span>Assessments passed</span>
              </div>
              {seasonComplete ? (
                <div className="qstat qstat--reward">
                  <b>+{placeBonus}<span className="coin-icon qstat__coin" aria-hidden /></b>
                  <span>Placement bonus</span>
                </div>
              ) : (
                <div className="qstat qstat--reward">
                  <b>+{MATCH_REWARD_COINS}<span className="coin-icon qstat__coin" aria-hidden /></b>
                  <span>Win reward</span>
                </div>
              )}
            </div>

            {!seasonComplete && (
              <div className="qleague__sim">
                <button type="button" className="qleague__sim-btn" onClick={handleSimSeason}>
                  <span className="qleague__sim-badge" aria-hidden>⚡</span>
                  <span className="qleague__sim-body">
                    <strong>Sim to end of season</strong>
                    <small>Roll all 50 games · +10<span className="coin-icon" aria-hidden /> per win + placement bonus (1st 300 · 2nd 200 · 3rd 100)</small>
                  </span>
                  <span className="fixture__cta">Sim →</span>
                </button>
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="schedule">
          <header className="schedule__head">
            <div className="schedule__title">
              <span className="eyebrow">Fixtures</span>
              <h3>Match Schedule</h3>
            </div>
          </header>

          <div className="schedule__cols" aria-hidden>
          <span>Wk</span>
          <span>Fixture</span>
          <span className="schedule__col-prog">Progress</span>
          <span className="schedule__col-status">Status</span>
        </div>

        <ol className="schedule__list">
          {UNITS.map((unit, i) => {
            const status = progress.unitStatus[unit.id]
            const locked = status === 'locked'
            const mastered = status === 'mastered'
            const isNext = i === nextIndex
            const theme = UNIT_THEME[unit.id]
            const checks = unitChecksDone(unit.lessonId, progress)
            return (
              <li
                key={unit.id}
                className={`sfix sfix--${status}${isNext ? ' sfix--next' : ''}`}
                style={{ '--unit-accent': theme.accent } as React.CSSProperties}
              >
                <button className="sfix__btn" disabled={locked} onClick={() => onOpenLesson(unit.lessonId)}>
                  <span className="sfix__wk">
                    <small>MW</small>{i + 1}
                  </span>
                  <span className="sfix__badge">{mastered ? '✓' : locked ? '🔒' : theme.icon}</span>
                  <span className="sfix__main">
                    <strong>{CLUB_NAME[unit.id as SkillId]}</strong>
                    <span className="muted"><span className="sfix__vs">vs</span> {clubName}</span>
                  </span>
                  <span className="sfix__prog">
                    {mastered ? (
                      <span className="sfix__ft">FT</span>
                    ) : locked ? (
                      <span className="sfix__dash">—</span>
                    ) : (
                      <span className="sfix__pips" title={`${checks}/3 mastery checks`}>
                        {[0, 1, 2].map((n) => (
                          <i key={n} className={n < checks ? 'on' : ''} />
                        ))}
                      </span>
                    )}
                  </span>
                  <span className={`pill pill--${status}`}>
                    {isNext && !mastered ? 'Up next' : STATUS_LABEL[status]}
                  </span>
                </button>
              </li>
            )
          })}
          </ol>
        </section>
      )}

      <div className="dev-actions">
        <button className="btn btn--ghost btn--sm reset-link" onClick={resetProgress}>
          Reset career progress
        </button>
        <button className="btn btn--ghost btn--sm reset-link" onClick={skipAllLessons} disabled={courseComplete}>
          Skip all lessons (master &amp; unlock {TOP_FLIGHT})
        </button>
        <button
          className="btn btn--ghost btn--sm reset-link"
          onClick={resetDailyWheel}
          disabled={wheelAvailable}
          title="Testing only — make the daily wheel available again"
        >
          Bring back daily wheel (testing)
        </button>
      </div>

      {lockerOpen && (
        <PlayerLocker displayName={profile.displayName} onClose={() => setLockerOpen(false)} />
      )}

      {standingsOpen && (
        <LeagueStandings
          table={displayTable}
          matchesPlayed={matchesPlayed}
          club={player.club}
          playerColors={clubColors}
          onClose={() => setStandingsOpen(false)}
        />
      )}

      {scheduleOpen && (
        <LeagueSchedule
          seed={progress.leagueSeed ?? 0}
          matchesPlayed={matchesPlayed}
          onClose={() => setScheduleOpen(false)}
        />
      )}

      {viewAttempt && (
        <div
          className="qtest-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setViewAttempt(null) }}
        >
          <AttemptReview attempt={viewAttempt} onExit={() => setViewAttempt(null)} />
        </div>
      )}

      {wheelOpen && (
        <DailyWheel
          onCollect={(amount) => {
            if (amount > 0) addCoins(amount)
            claimDailyWheel()
          }}
          onClose={() => setWheelOpen(false)}
        />
      )}

    </div>
  )
}
