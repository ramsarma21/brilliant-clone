import { useState } from 'react'
import { useApp } from '../state/AppState'
import { usePlayer } from '../state/PlayerState'
import { LESSONS, UNITS, UNIT_THEME } from '../content/lessons'
import { SKILLS } from '../lib/skills'
import type { SkillId, UnitStatus, UserProgress, TestAttempt } from '../types'
import { CardPlayer, ATTR_ABBR, POSITION, kitFor, cleatsFor } from './PlayerAvatar'
import { PlayerLocker } from './PlayerLocker'
import { AttemptReview } from './TestScreen'

const STATUS_LABEL: Record<UnitStatus, string> = {
  locked: 'Locked',
  available: 'Play',
  in_progress: 'In progress',
  mastered: 'Completed',
}

// Win the season to earn promotion to the top flight.
const TOP_FLIGHT = 'The Quantum League'

// Quantum League opponents — 50 physics-flavoured clubs (none reuse the five
// lesson units). The match ladder cycles through these in order.
const LEAGUE_TEAMS = [
  'Atlético Entropy', 'Real Relativity', 'Inertia City', 'Quantum Rovers', 'Photon FC',
  'Electron United', 'Sporting Gravitas', 'Dynamo Tesla', 'Inter Friction', 'Vector Wanderers',
  'Newton North End', 'Joule Town', 'Watt Albion', 'Plasma Rangers', 'Fusion Athletic',
  'Neutron County', 'Graviton FC', 'Boson Hotspur', 'Quark City', 'Terminal Velocity FC',
  'Torque United', 'Amplitude Athletic', 'Resonance Rovers', 'Pendulum FC', 'Vortex City',
  'Magnetar United', 'Ohm Town', 'Ampère Athletic', 'Hertz Hotspur', 'Kelvin Rangers',
  'Thermo Dynamo', 'Enthalpy FC', 'Spectrum Wanderers', 'Wavelength Albion', 'Frequency County',
  'Oscillator United', 'Isotope City', 'Nucleus FC', 'Orbital Rovers', 'Lepton Town',
  'Fermion Athletic', 'Neutrino Rangers', 'Gamma United', 'Ion City', 'Voltage FC',
  'Circuit Wanderers', 'Density Albion', 'Viscosity Town', 'Turbulence FC', 'Singularity United',
] as const

const MATCH_REWARD_COINS = 100

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
  const { profile, progress, logout, resetProgress, skipAllLessons, playQuantumMatch } = useApp()
  const { overall, profile: player, testHistory, addCoins } = usePlayer()

  const masteredCount = UNITS.filter((u) => progress.unitStatus[u.id] === 'mastered').length
  const pct = Math.round((masteredCount / UNITS.length) * 100)
  const courseComplete = masteredCount === UNITS.length

  // Quantum League ladder: each assessment completed (a top-flight test) unlocks
  // exactly one more match. The test is only reachable once promoted, so the
  // number of test attempts == assessments completed.
  // Only attempts whose guided Skills review is finished count toward the league
  // ladder. (Legacy attempts without the flag are treated as complete.)
  const assessmentsCompleted = testHistory.filter((a) => a.reviewComplete !== false).length
  const matchesPlayed = progress.quantumMatchesPlayed ?? 0
  const nextMatchNo = matchesPlayed + 1
  const nextOpponent = LEAGUE_TEAMS[(nextMatchNo - 1) % LEAGUE_TEAMS.length]
  const matchUnlocked = assessmentsCompleted >= nextMatchNo
  const firstAssessmentDone = assessmentsCompleted >= 1
  const [hubOpen, setHubOpen] = useState(false)
  const [assessOpen, setAssessOpen] = useState(false)
  const [viewAttempt, setViewAttempt] = useState<TestAttempt | null>(null)

  const handlePlayMatch = () => {
    if (!matchUnlocked) return
    playQuantumMatch()
    addCoins(MATCH_REWARD_COINS)
  }

  const nextIndex = UNITS.findIndex((u) => progress.unitStatus[u.id] !== 'mastered')
  const nextUnit = nextIndex >= 0 ? UNITS[nextIndex] : UNITS[0]
  const nextTheme = UNIT_THEME[nextUnit.id]

  // Signature position = the unit/skill the player rates highest in.
  const bestSkill = SKILLS.reduce((best, s) =>
    (player.skills[s.id] ?? 0) > (player.skills[best.id] ?? 0) ? s : best,
  )
  const position = POSITION[bestSkill.id]
  const firstName = profile.displayName.split(' ')[0]
  const [lockerOpen, setLockerOpen] = useState(false)

  return (
    <div className="dashboard career">
      <header className="hud">
        <span className="brand">
          <span className="brand__mark">⚽</span> PHYSICS&nbsp;FC
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
            <div className="fut__crest" aria-hidden>⚽</div>
          </div>

          <CardPlayer jersey={kitFor(player.equipped.jersey)} cleats={cleatsFor(player.equipped.cleats)} />

          <div className="fut__name">{profile.displayName.toUpperCase()}</div>
          <div className="fut__club">PHYSICS FC</div>

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
              <h1>Welcome back, {firstName}.</h1>
              <p>{!courseComplete
                ? `Win all ${UNITS.length} fixtures to earn promotion to ${TOP_FLIGHT}.`
                : firstAssessmentDone
                  ? `You're in ${TOP_FLIGHT}. Pass assessments to unlock your next league match and earn skill points.`
                  : `Every fixture won — Physics FC is promoted to ${TOP_FLIGHT}. Take your skills assessment to claim skill points.`}</p>
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
                <strong>Physics FC <span className="fixture__vs">vs</span> {CLUB_NAME[nextUnit.id as SkillId]}</strong>
              </span>
              <span className="fixture__cta">
                {progress.unitStatus[nextUnit.id] === 'in_progress' ? 'Resume' : 'Kick off'} →
              </span>
            </button>
          ) : !firstAssessmentDone ? (
            <div className="career__legend">
              <span className="career__legend-burst">🏆</span>
              <div>
                <strong>Promotion won!</strong>
                <span>All {UNITS.length} fixtures won — up to {TOP_FLIGHT}.</span>
              </div>
            </div>
          ) : null}

          {courseComplete ? (
            <button
              className={`combine-card${matchUnlocked ? ' combine-card--complete' : ''}`}
              onClick={matchUnlocked ? () => setAssessOpen((o) => !o) : onOpenTest}
              aria-expanded={matchUnlocked ? assessOpen : undefined}
            >
              <span className="combine-card__icon">🏆</span>
              <span className="combine-card__body">
                <span className="eyebrow">
                  {matchUnlocked ? 'Assessment complete' : firstAssessmentDone ? TOP_FLIGHT : `${TOP_FLIGHT} · unlocked`}
                </span>
                <strong>{matchUnlocked ? 'Skills assessment complete' : 'Skills assessment'}</strong>
                <span className="muted">
                  {matchUnlocked
                    ? `Matchday ${nextMatchNo} unlocked — play ${nextOpponent} below`
                    : `Pass to unlock Matchday ${nextMatchNo} vs ${nextOpponent}`}
                </span>
              </span>
              <span className="combine-card__stats">
                {matchUnlocked ? (
                  <span className="combine-card__done">
                    View <span className={`combine-card__chev${assessOpen ? ' open' : ''}`} aria-hidden>▾</span>
                  </span>
                ) : (
                  <span><b>{overall}</b> OVR</span>
                )}
                {player.skillPoints > 0 && <span className="combine-card__pts">{player.skillPoints} pts</span>}
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

          {courseComplete && matchUnlocked && assessOpen && (
            <div className="qhub qhub--open assess-hist">
              {testHistory.length === 0 ? (
                <p className="assess-empty">No assessments recorded yet.</p>
              ) : (
                <ol className="qhub__list">
                  {testHistory.map((a, i) => {
                    const pctScore = a.total > 0 ? Math.round((a.score / a.total) * 100) : 0
                    return (
                      <li key={a.id} className="qdrill">
                        <button className="qdrill__btn assess-row" onClick={() => setViewAttempt(a)}>
                          <span className="assess-row__no">#{testHistory.length - i}</span>
                          <span className="qdrill__main">
                            <strong>{pctScore}% · {a.score}/{a.total}</strong>
                            <span className="assess-row__date">{fmtAttemptDate(a.takenAt)}</span>
                          </span>
                          <span className="qdrill__cta">View →</span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          )}

          {courseComplete && (
            <div className={`qhub${hubOpen ? ' qhub--open' : ''}`}>
              <button
                type="button"
                className="qhub__head"
                onClick={() => setHubOpen((o) => !o)}
                aria-expanded={hubOpen}
              >
                <span className="qhub__title">
                  <span className="eyebrow">Training ground</span>
                  <strong>Practice your skills</strong>
                </span>
                <span className="qhub__meta">{UNITS.length} drills · replay any lesson</span>
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

          {/* Daily wheel spin — placeholder tab, no behaviour wired up yet. */}
          {courseComplete && (
            <div className="qhub qhub--wheel">
              <button type="button" className="qhub__head">
                <span className="qhub__title">
                  <span className="eyebrow">Daily reward</span>
                  <strong>Daily wheel spin</strong>
                </span>
                <span className="qhub__meta">Spin once a day for coins &amp; boosts</span>
                <span className="qhub__chev qhub__wheel" aria-hidden>🎡</span>
              </button>
            </div>
          )}
        </section>
      </div>

      {courseComplete ? (
        <section className="schedule qleague">
          <header className="schedule__head">
            <div className="schedule__title">
              <span className="eyebrow">{TOP_FLIGHT} · Season</span>
              <h3>League Fixtures</h3>
            </div>
            <div className="schedule__record">
              <span className="schedule__record-main">Played<b>{matchesPlayed}</b></span>
              <span className="schedule__record-sub">{assessmentsCompleted} assessments</span>
            </div>
          </header>

          <div className="qleague__body">
            {matchUnlocked ? (
              <button
                className="fixture fixture--next qmatch"
                onClick={handlePlayMatch}
                title={`Play Matchday ${nextMatchNo}`}
              >
                <span className="fixture__week">MD{nextMatchNo}</span>
                <span className="fixture__badge">⚔️</span>
                <span className="fixture__body">
                  <span className="eyebrow">Matchday {nextMatchNo} · ready</span>
                  <strong>Physics FC <span className="fixture__vs">vs</span> {nextOpponent}</strong>
                </span>
                <span className="fixture__cta">
                  Play · +{MATCH_REWARD_COINS} <span className="coin-icon qmatch__coin" aria-hidden />
                </span>
              </button>
            ) : (
              <div className="fixture qmatch qmatch--locked" aria-disabled="true">
                <span className="fixture__week">MD{nextMatchNo}</span>
                <span className="fixture__badge">🔒</span>
                <span className="fixture__body">
                  <span className="eyebrow">Matchday {nextMatchNo} · locked</span>
                  <strong>Physics FC <span className="fixture__vs">vs</span> {nextOpponent}</strong>
                  <span className="qmatch__hint">
                    Pass assessment #{nextMatchNo} to unlock this match — tap the {TOP_FLIGHT} assessment above.
                  </span>
                </span>
                <span className="fixture__cta fixture__cta--locked">Assessment #{nextMatchNo} →</span>
              </div>
            )}

          </div>
        </section>
      ) : (
        <section className="schedule">
          <header className="schedule__head">
            <div className="schedule__title">
              <span className="eyebrow">Season 1 · Fixtures</span>
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
                    <span className="muted"><span className="sfix__vs">vs</span> Physics FC</span>
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
      </div>

      {lockerOpen && (
        <PlayerLocker displayName={profile.displayName} onClose={() => setLockerOpen(false)} />
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
    </div>
  )
}
