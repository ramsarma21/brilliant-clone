import { useApp } from '../state/AppState'
import { LESSONS, UNITS, UNIT_THEME } from '../content/lessons'
import type { UnitStatus } from '../types'

const STATUS_LABEL: Record<UnitStatus, string> = {
  locked: 'Locked',
  available: 'Start',
  in_progress: 'In progress',
  mastered: 'Mastered',
}

function lessonSubtitle(lessonId: string, fallback: string): string {
  return LESSONS[lessonId].title.split(': ')[1] ?? fallback
}

export function Dashboard({ onOpenLesson }: { onOpenLesson: (lessonId: string) => void }) {
  const { profile, progress, logout, resetProgress } = useApp()

  const masteredCount = UNITS.filter((u) => progress.unitStatus[u.id] === 'mastered').length
  const pct = Math.round((masteredCount / UNITS.length) * 100)
  const courseComplete = masteredCount === UNITS.length

  const nextUnit = UNITS.find((u) => progress.unitStatus[u.id] !== 'mastered') ?? UNITS[0]
  const nextTheme = UNIT_THEME[nextUnit.id]

  const R = 30
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
        <div className="hero-card__text">
          <span className="eyebrow">Intro Physics I · Course</span>
          <h1>Welcome back, {profile.displayName.split(' ')[0]}.</h1>
          <p>Algebra-based introductory college physics — learn by doing, not watching.</p>
        </div>
        <div className="hero-card__ring" aria-label={`${pct}% mastered`}>
          <svg viewBox="0 0 80 80" width="92" height="92">
            <circle cx="40" cy="40" r={R} className="ring__track" />
            <circle
              cx="40"
              cy="40"
              r={R}
              className="ring__value"
              strokeDasharray={`${dash} ${circ}`}
              transform="rotate(-90 40 40)"
            />
          </svg>
          <div className="ring__label">
            <strong>{pct}%</strong>
            <span>{masteredCount}/{UNITS.length}</span>
          </div>
        </div>
      </section>

      {courseComplete ? (
        <section className="card banner banner--success">
          <div className="banner__burst">🎓</div>
          <div>
            <h2>Course mastered!</h2>
            <p>You completed all five Physics I units with full mastery. Your progress stays saved across refresh and login.</p>
          </div>
        </section>
      ) : (
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
            {progress.unitStatus[nextUnit.id] === 'in_progress' ? 'Resume' : 'Start'} →
          </span>
        </button>
      )}

      <h3 className="section-title">Course path</h3>
      <ol className="path">
        {UNITS.map((unit, i) => {
          const status = progress.unitStatus[unit.id]
          const locked = status === 'locked'
          const theme = UNIT_THEME[unit.id]
          const checks = LESSONS[unit.lessonId].steps.filter(
            (s) => 'conceptTags' in s && progress.lessonState[unit.lessonId]?.masteryChecksCorrect[s.id],
          ).length
          return (
            <li
              key={unit.id}
              className={`path__item path__item--${status}`}
              style={{ '--unit-accent': theme.accent } as React.CSSProperties}
            >
              {i < UNITS.length - 1 && <span className="path__connector" />}
              <button className="unit-card" disabled={locked} onClick={() => onOpenLesson(unit.lessonId)}>
                <span className="unit-card__icon">
                  {status === 'mastered' ? '✓' : locked ? '🔒' : theme.icon}
                </span>
                <span className="unit-card__body">
                  <strong>{unit.name}</strong>
                  <span className="muted">{lessonSubtitle(unit.lessonId, unit.blurb)}</span>
                  {status !== 'mastered' && status !== 'locked' && checks > 0 && (
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
