import { useApp } from '../state/AppState'
import { LESSONS, UNITS, UNIT_THEME } from '../content/lessons'
import type { UnitStatus, UserProgress } from '../types'

const STATUS_LABEL: Record<UnitStatus, string> = {
  locked: 'Locked',
  available: 'Play',
  in_progress: 'In progress',
  mastered: 'Completed',
}

function lessonSubtitle(lessonId: string, fallback: string): string {
  return LESSONS[lessonId].title.split(': ')[1] ?? fallback
}

// How many of the 3 mastery gates a unit has cleared (kept in sync with the
// AppState mastery model so the dashboard never disagrees with the lesson).
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

export function Dashboard({ onOpenLesson }: { onOpenLesson: (lessonId: string) => void }) {
  const { profile, progress, logout, resetProgress } = useApp()

  const masteredCount = UNITS.filter((u) => progress.unitStatus[u.id] === 'mastered').length
  const pct = Math.round((masteredCount / UNITS.length) * 100)
  const courseComplete = masteredCount === UNITS.length

  const nextUnit = UNITS.find((u) => progress.unitStatus[u.id] !== 'mastered') ?? UNITS[0]
  const nextTheme = UNIT_THEME[nextUnit.id]

  const R = 52
  const circ = 2 * Math.PI * R
  const dash = (pct / 100) * circ

  return (
    <div className="dashboard">
      <header className="topbar glass">
        <span className="brand">
          <span className="brand__mark">⚡</span> Physics Lab
        </span>
        <div className="topbar__right">
          <span className="chip chip--streak" title="Daily streak">
            🔥 <strong>{progress.streakCount}</strong>
          </span>
          <span className="avatar" title={profile.displayName}>
            {profile.displayName.charAt(0)}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <section className="hero-card">
        <span className="hero-card__blob hero-card__blob--a" aria-hidden>⚽</span>
        <span className="hero-card__blob hero-card__blob--b" aria-hidden>⚡</span>
        <span className="hero-card__blob hero-card__blob--c" aria-hidden>📈</span>
        <span className="hero-card__blob hero-card__blob--d" aria-hidden>🎯</span>
        <div className="hero-card__text">
          <span className="eyebrow">Intro Physics I</span>
          <h1>Welcome back, {profile.displayName.split(' ')[0]}!</h1>
          <p>{courseComplete ? 'You mastered every unit. Legend.' : 'Pick up where you left off and beat the next level.'}</p>
        </div>
        <div className="hero-card__ring" aria-label={`${pct}% complete`}>
          <svg viewBox="0 0 120 120" width="128" height="128">
            <circle cx="60" cy="60" r={R} className="ring__track" />
            {pct > 0 && (
              <circle
                cx="60"
                cy="60"
                r={R}
                className="ring__value"
                strokeDasharray={`${dash} ${circ}`}
                transform="rotate(-90 60 60)"
              />
            )}
          </svg>
          <div className="ring__label">
            <strong>{pct}%</strong>
            <span>{masteredCount}/{UNITS.length} units</span>
          </div>
        </div>
      </section>

      {courseComplete && (
        <section className="card banner banner--success">
          <div className="banner__burst">🎓</div>
          <div>
            <h2>Course mastered</h2>
            <p>All five units complete. Nice work.</p>
          </div>
        </section>
      )}

      {!courseComplete && (
        <button
          className="next-card"
          style={{ '--unit-accent': nextTheme.accent } as React.CSSProperties}
          onClick={() => onOpenLesson(nextUnit.lessonId)}
        >
          <span className="next-card__icon">{nextTheme.icon}</span>
          <span className="next-card__body">
            <span className="eyebrow">Continue learning</span>
            <strong>{nextUnit.name}: {lessonSubtitle(nextUnit.lessonId, nextUnit.blurb)}</strong>
          </span>
          <span className="next-card__cta">
            {progress.unitStatus[nextUnit.id] === 'in_progress' ? 'Resume' : 'Play'} →
          </span>
        </button>
      )}

      <h3 className="section-title">Course path</h3>
      <ol className="path">
        {UNITS.map((unit, i) => {
          const status = progress.unitStatus[unit.id]
          const locked = status === 'locked'
          const mastered = status === 'mastered'
          const theme = UNIT_THEME[unit.id]
          const checks = unitChecksDone(unit.lessonId, progress)
          return (
            <li
              key={unit.id}
              className={`path__item path__item--${status}`}
              style={{ '--unit-accent': theme.accent } as React.CSSProperties}
            >
              {i < UNITS.length - 1 && <span className="path__connector" />}
              <span className="path__index">{mastered ? '★' : i + 1}</span>
              <button className="unit-card" disabled={locked} onClick={() => onOpenLesson(unit.lessonId)}>
                <span className="unit-card__icon">
                  {mastered ? '✓' : locked ? '🔒' : theme.icon}
                </span>
                <span className="unit-card__body">
                  <strong>{unit.name}</strong>
                  <span className="muted">{lessonSubtitle(unit.lessonId, unit.blurb)}</span>
                  {!mastered && !locked && checks > 0 && (
                    <span className="unit-card__mini">{checks}/3 mastery checks</span>
                  )}
                </span>
                <span className={`pill pill--${status}`}>{STATUS_LABEL[status]}</span>
              </button>
            </li>
          )
        })}
      </ol>

      <button className="btn btn--ghost btn--sm reset-link" onClick={resetProgress}>
        Reset demo progress
      </button>
    </div>
  )
}
