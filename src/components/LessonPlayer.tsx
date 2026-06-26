import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppState'
import { LESSONS, UNITS, UNIT_THEME } from '../content/lessons'
import { Sim } from './sims/Sim'
import { Calculator } from './sims/Calculator'
import { KinematicsIntro } from './KinematicsIntro'
import { KinematicsQuiz } from './KinematicsQuiz'
import { MotionGraphsIntro } from './MotionGraphsIntro'
import { MotionGraphsQuiz } from './MotionGraphsQuiz'
import { ForcesQuiz } from './ForcesQuiz'
import { EnergyQuiz } from './EnergyQuiz'
import { DefenseQuiz } from './DefenseQuiz'
import { GoalieQuiz } from './GoalieQuiz'
import { Feedback, type FeedbackKind } from './Feedback'
import type {
  ChallengeStep,
  LessonStep,
  NumericStep,
  PredictionStep,
  SimKey,
  SimState,
} from '../types'

type Props = {
  lessonId: string
  onExit: () => void
  onOpenLesson: (lessonId: string) => void
}

export function LessonPlayer({ lessonId, onExit, onOpenLesson }: Props) {
  const {
    progress,
    setCurrentStep,
    setSandboxState,
    recordAnswer,
    completeLesson,
  } = useApp()

  const lesson = LESSONS[lessonId]
  const lp = progress.lessonState[lessonId]
  const stepIndex = Math.min(lp?.currentStepIndex ?? 0, lesson.steps.length - 1)
  const step = lesson.steps[stepIndex]

  const [sandbox, setSandbox] = useState<SimState>(
    () => lp?.sandboxState ?? { ...lesson.defaultSimState },
  )

  // Debounced persistence of sandbox state.
  useEffect(() => {
    const id = setTimeout(() => setSandboxState(lessonId, sandbox), 400)
    return () => clearTimeout(id)
  }, [sandbox, lessonId, setSandboxState])

  // Mark lesson complete once the learner reaches the summary step.
  useEffect(() => {
    if (step.kind === 'summary') completeLesson(lessonId)
  }, [step.kind, lessonId, completeLesson])

  const goTo = (i: number) => setCurrentStep(lessonId, Math.max(0, Math.min(lesson.steps.length - 1, i)))

  return (
    <div className="player">
      <header className="topbar">
        <button className="btn btn--ghost btn--sm" onClick={onExit}>← Course</button>
        <span className="player__title">{lesson.title}</span>
        <span className="muted">{stepIndex + 1} / {lesson.steps.length}</span>
      </header>

      <div className="step-progress">
        {lesson.steps.map((s, i) => (
          <span
            key={s.id}
            className={`step-progress__dot ${i === stepIndex ? 'is-current' : ''} ${i < stepIndex ? 'is-done' : ''}`}
          />
        ))}
      </div>

      <StepView
        key={step.id}
        lessonId={lessonId}
        step={step}
        sandbox={sandbox}
        setSandbox={setSandbox}
        challengeGoal={lesson.challengeGoal}
        simKey={lesson.sim}
        masteryDone={Boolean(lp?.masteryChecksCorrect[step.id])}
        attempts={lp?.answers.filter((a) => a.stepId === step.id).length ?? 0}
        onRecord={recordAnswer}
        onNext={() => goTo(stepIndex + 1)}
        onPrev={() => goTo(stepIndex - 1)}
        canPrev={stepIndex > 0}
        isLast={stepIndex === lesson.steps.length - 1}
        onExit={onExit}
        onOpenLesson={onOpenLesson}
      />
    </div>
  )
}

type StepViewProps = {
  lessonId: string
  step: LessonStep
  sandbox: SimState
  setSandbox: (s: SimState) => void
  challengeGoal: (s: SimState) => boolean
  simKey: SimKey
  masteryDone: boolean
  attempts: number
  onRecord: ReturnType<typeof useApp>['recordAnswer']
  onNext: () => void
  onPrev: () => void
  canPrev: boolean
  isLast: boolean
  onExit: () => void
  onOpenLesson: (lessonId: string) => void
}

function StepView(props: StepViewProps) {
  const { step } = props
  switch (step.kind) {
    case 'concept':
      return <ConceptView {...props} body={step.body} prompt={step.prompt} />
    case 'sandbox':
      return <SandboxView {...props} body={step.body} prompt={step.prompt} />
    case 'prediction':
      return <PredictionView {...props} step={step} />
    case 'numeric':
      return <NumericView {...props} step={step} />
    case 'challenge':
      return <ChallengeView {...props} step={step} />
    case 'quiz':
      return <QuizView {...props} />
    case 'summary':
      return <SummaryView {...props} body={step.body} prompt={step.prompt} />
    default:
      return null
  }
}

function NavButtons({
  onPrev,
  canPrev,
  onNext,
  nextLabel = 'Next',
  nextDisabled = false,
}: {
  onPrev: () => void
  canPrev: boolean
  onNext: () => void
  nextLabel?: string
  nextDisabled?: boolean
}) {
  return (
    <div className="step__nav">
      <button className="btn btn--ghost" onClick={onPrev} disabled={!canPrev}>
        Back
      </button>
      <button className="btn btn--primary" onClick={onNext} disabled={nextDisabled}>
        {nextLabel}
      </button>
    </div>
  )
}

function lessonTheme(lessonId: string) {
  return UNIT_THEME[LESSONS[lessonId].unitId]
}

function QuizView(props: StepViewProps) {
  const theme = lessonTheme(props.lessonId)
  const unitId = LESSONS[props.lessonId].unitId
  const Quiz =
    unitId === 'motion-graphs' ? MotionGraphsQuiz
    : unitId === 'forces' ? ForcesQuiz
    : unitId === 'energy' ? EnergyQuiz
    : unitId === 'momentum' ? DefenseQuiz
    : unitId === 'impulse' ? GoalieQuiz
    : KinematicsQuiz
  return (
    <Quiz
      accent={theme.accent}
      onPrev={props.onPrev}
      canPrev={props.canPrev}
      onNext={props.onNext}
      lessonId={props.lessonId}
      stepId={props.step.id}
      onRecord={props.onRecord}
    />
  )
}

function ConceptView(props: StepViewProps & { body: string; prompt: string }) {
  const theme = lessonTheme(props.lessonId)
  // The soccer-skill units open with an animated, multi-slide interactive intro
  // instead of a single static concept card.
  if (props.simKey === 'soccer') {
    return (
      <KinematicsIntro
        accent={theme.accent}
        onPrev={props.onPrev}
        canPrev={props.canPrev}
        onNext={props.onNext}
      />
    )
  }
  if (props.simKey === 'passing') {
    return (
      <MotionGraphsIntro
        accent={theme.accent}
        onPrev={props.onPrev}
        canPrev={props.canPrev}
        onNext={props.onNext}
      />
    )
  }
  return (
    <div className="card step step--split" style={{ '--unit-accent': theme.accent } as React.CSSProperties}>
      <aside className="step__aside">
        <span className="step__aside-icon">{theme.icon}</span>
        <span className="step__aside-tag">Concept</span>
        <span className="step__aside-note">{theme.tagline}</span>
      </aside>
      <div className="step__main">
        <h2>{props.prompt}</h2>
        <p className="step__body">{props.body}</p>
        <NavButtons onPrev={props.onPrev} canPrev={props.canPrev} onNext={props.onNext} />
      </div>
    </div>
  )
}

function SandboxView(props: StepViewProps & { body: string; prompt: string }) {
  // First run: score/connect once to move on.
  const [done, setDone] = useState(false)
  function onGoalScored() {
    if (done) return
    setDone(true)
    window.setTimeout(() => props.onNext(), 1900)
  }
  return (
    <div className="card step step--sim">
      <Sim sim={props.simKey} state={props.sandbox} onChange={props.setSandbox} showGoal onGoal={onGoalScored} />
      <NavButtons onPrev={props.onPrev} canPrev={props.canPrev} onNext={props.onNext} />
    </div>
  )
}

function PredictionView(props: StepViewProps & { step: PredictionStep }) {
  const { step } = props
  const [selected, setSelected] = useState<string | null>(null)
  const [fb, setFb] = useState<{ kind: FeedbackKind; message: string } | null>(null)
  const [solved, setSolved] = useState(props.masteryDone)
  const [showCalc, setShowCalc] = useState(false)

  function submit() {
    if (!selected) return
    const correct = selected === step.correctOptionId
    const message = correct
      ? step.feedbackCorrect
      : step.feedbackByOption[selected] ?? 'Not quite. Review the concept and try again.'
    setFb({ kind: correct ? 'correct' : 'incorrect', message })
    if (correct) setSolved(true)
    props.onRecord({
      lessonId: props.lessonId,
      stepId: step.id,
      answer: selected,
      isCorrect: correct,
      feedback: message,
      isMasteryCheck: true,
      conceptTags: step.conceptTags,
    })
  }

  const showHint = !fb && props.attempts >= 2 && step.hint

  return (
    <div className="card step step--check">
      <span className="step__kind step__kind--check">Mastery check</span>
      <h2>{step.prompt}</h2>
      <div className="options">
        {step.options.map((o) => (
          <button
            key={o.id}
            className={`option ${selected === o.id ? 'is-selected' : ''} ${solved && o.id === step.correctOptionId ? 'is-correct' : ''}`}
            onClick={() => setSelected(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {showHint && <Feedback kind="hint" message={step.hint!} />}
      {fb && <Feedback kind={fb.kind} message={fb.message} />}
      <div className="step__actions">
        <button className="btn btn--secondary" onClick={submit} disabled={!selected}>
          Check answer
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setShowCalc((open) => !open)}>
          🧮 {showCalc ? 'Hide calculator' : 'Calculator'}
        </button>
      </div>
      {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      <NavButtons
        onPrev={props.onPrev}
        canPrev={props.canPrev}
        onNext={props.onNext}
        nextDisabled={!solved}
      />
    </div>
  )
}

function NumericView(props: StepViewProps & { step: NumericStep }) {
  const { step } = props
  const [input, setInput] = useState('')
  const [fb, setFb] = useState<{ kind: FeedbackKind; message: string } | null>(null)
  const [solved, setSolved] = useState(props.masteryDone)
  const [showCalc, setShowCalc] = useState(false)

  function submit() {
    const value = Number.parseFloat(input)
    if (Number.isNaN(value)) {
      setFb({ kind: 'incorrect', message: 'Enter a number to check your answer.' })
      return
    }
    const diff = Math.abs(value - step.correctAnswer)
    const correct = diff <= step.tolerance
    const near = !correct && step.nearMissTolerance != null && diff <= step.nearMissTolerance
    const kind: FeedbackKind = correct ? 'correct' : near ? 'near' : 'incorrect'
    const message = correct
      ? step.feedbackCorrect
      : near
        ? step.feedbackNearMiss ?? step.feedbackIncorrect
        : step.feedbackIncorrect
    setFb({ kind, message })
    if (correct) setSolved(true)
    props.onRecord({
      lessonId: props.lessonId,
      stepId: step.id,
      answer: value,
      isCorrect: correct,
      feedback: message,
      isMasteryCheck: true,
      conceptTags: step.conceptTags,
    })
  }

  const showHint = !fb && props.attempts >= 2 && step.hint

  return (
    <div className="card step step--check">
      <span className="step__kind step__kind--check">Mastery check</span>
      <h2>{step.prompt}</h2>
      <div className="numeric-input">
        <input
          type="number"
          inputMode="decimal"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Your answer"
        />
        {step.unitLabel && <span className="numeric-input__unit">{step.unitLabel}</span>}
      </div>
      <p className="numeric-input__note muted">Round to the nearest whole number — up or down is fine.</p>
      {showHint && <Feedback kind="hint" message={step.hint!} />}
      {fb && <Feedback kind={fb.kind} message={fb.message} />}
      <div className="step__actions">
        <button className="btn btn--secondary" onClick={submit}>
          Check answer
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setShowCalc((open) => !open)}>
          🧮 {showCalc ? 'Hide calculator' : 'Calculator'}
        </button>
      </div>
      {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      <NavButtons
        onPrev={props.onPrev}
        canPrev={props.canPrev}
        onNext={props.onNext}
        nextDisabled={!solved}
      />
    </div>
  )
}

function ChallengeView(props: StepViewProps & { step: ChallengeStep }) {
  const { step } = props
  const [fb, setFb] = useState<{ kind: FeedbackKind; message: string } | null>(null)
  const [solved, setSolved] = useState(props.masteryDone)
  const isSoccerChallenge = props.simKey === 'soccer' || props.simKey === 'passing' || props.simKey === 'forces' || props.simKey === 'energy' || props.simKey === 'defense' || props.simKey === 'goalie'

  function recordChallenge(correct: boolean, message: string) {
    if (correct) setSolved(true)
    props.onRecord({
      lessonId: props.lessonId,
      stepId: step.id,
      answer: { ...props.sandbox },
      isCorrect: correct,
      feedback: message,
      isMasteryCheck: true,
      isChallenge: true,
      conceptTags: step.conceptTags,
    })
  }

  function check() {
    const correct = props.challengeGoal(props.sandbox)
    const message = correct ? step.feedbackCorrect : step.feedbackIncorrect
    setFb({ kind: correct ? 'correct' : 'incorrect', message })
    recordChallenge(correct, message)
  }

  function onGoalScored() {
    if (solved) return
    recordChallenge(true, step.feedbackCorrect)
  }

  const showHint = !solved && props.attempts >= 2 && step.hint

  return (
    <div className="card step step--sim">
      <Sim sim={props.simKey} state={props.sandbox} onChange={props.setSandbox} onGoal={isSoccerChallenge ? onGoalScored : undefined} />
      {!isSoccerChallenge && showHint && <Feedback kind="hint" message={step.hint!} />}
      {!isSoccerChallenge && fb && <Feedback kind={fb.kind} message={fb.message} />}
      {!isSoccerChallenge && (
        <div className="step__actions">
          <button className="btn btn--secondary" onClick={check}>
            Check goal
          </button>
        </div>
      )}
      <NavButtons
        onPrev={props.onPrev}
        canPrev={props.canPrev}
        onNext={props.onNext}
        nextDisabled={!solved}
      />
    </div>
  )
}

function SummaryView(props: StepViewProps & { body: string; prompt: string }) {
  const { progress, isUnitMastered } = useApp()
  const lesson = LESSONS[props.lessonId]
  const mastered = isUnitMastered(props.lessonId)

  const concepts = useMemo(() => {
    const tags = new Set<string>()
    for (const s of lesson.steps) {
      if ('conceptTags' in s) s.conceptTags.forEach((t) => tags.add(t))
    }
    return [...tags]
  }, [lesson])

  const currentUnitIndex = UNITS.findIndex((u) => u.lessonId === props.lessonId)
  const nextUnit = UNITS[currentUnitIndex + 1]

  const theme = lessonTheme(props.lessonId)
  const lp = progress.lessonState[props.lessonId]
  const masteryChecksPassed = props.lessonId === 'lesson-projectile'
    ? [
        Boolean(lp?.completedAt) || props.step.kind === 'summary',
        Boolean(lp?.masteryChecksCorrect['proj-prediction']) &&
          Boolean(lp?.masteryChecksCorrect['proj-numeric']) &&
          Boolean(lp?.masteryChecksCorrect['proj-challenge']),
        Boolean(lp?.masteryChecksCorrect['proj-quiz']),
      ].filter(Boolean).length
    : props.lessonId === 'lesson-motion-graphs'
    ? [
        Boolean(lp?.masteryChecksCorrect['mg-prediction']),
        Boolean(lp?.masteryChecksCorrect['mg-numeric']) &&
          Boolean(lp?.masteryChecksCorrect['mg-challenge']),
        Boolean(lp?.masteryChecksCorrect['mg-quiz']),
      ].filter(Boolean).length
    : props.lessonId === 'lesson-forces'
    ? [
        Boolean(lp?.masteryChecksCorrect['force-prediction']),
        Boolean(lp?.masteryChecksCorrect['force-numeric']) &&
          Boolean(lp?.masteryChecksCorrect['force-challenge']),
        Boolean(lp?.masteryChecksCorrect['force-quiz']),
      ].filter(Boolean).length
    : props.lessonId === 'lesson-energy'
    ? [
        Boolean(lp?.masteryChecksCorrect['energy-prediction']),
        Boolean(lp?.masteryChecksCorrect['energy-numeric']) &&
          Boolean(lp?.masteryChecksCorrect['energy-challenge']),
        Boolean(lp?.masteryChecksCorrect['energy-quiz']),
      ].filter(Boolean).length
    : props.lessonId === 'lesson-defense'
    ? [
        Boolean(lp?.masteryChecksCorrect['def-prediction']),
        Boolean(lp?.masteryChecksCorrect['def-numeric']) &&
          Boolean(lp?.masteryChecksCorrect['def-challenge']),
        Boolean(lp?.masteryChecksCorrect['def-quiz']),
      ].filter(Boolean).length
    : props.lessonId === 'lesson-goalie'
    ? [
        Boolean(lp?.masteryChecksCorrect['gk-prediction']),
        Boolean(lp?.masteryChecksCorrect['gk-numeric']) &&
          Boolean(lp?.masteryChecksCorrect['gk-challenge']),
        Boolean(lp?.masteryChecksCorrect['gk-quiz']),
      ].filter(Boolean).length
    : lesson.steps.filter((s) => 'conceptTags' in s && lp?.masteryChecksCorrect[s.id]).length

  return (
    <div className="card step step--split step--summary" style={{ '--unit-accent': theme.accent } as React.CSSProperties}>
      <aside className="step__aside">
        <span className="step__aside-icon">{mastered ? '🏆' : theme.icon}</span>
        <span className="step__aside-tag">{mastered ? 'Mastered' : 'Almost there'}</span>
        <span className="step__aside-note">{theme.tagline}</span>
      </aside>
      <div className="step__main">
      <h2>{props.prompt}</h2>
      <p className="step__body">{props.body}</p>

      {!mastered && (
        <Feedback
          kind="hint"
          message="Pass all 3 mastery checks to master this unit."
        />
      )}

      <div className="summary-grid">
        <div className="summary-card">
          <span className="muted">Streak</span>
          <strong>🔥 {progress.streakCount} day{progress.streakCount === 1 ? '' : 's'}</strong>
        </div>
        <div className="summary-card">
          <span className="muted">Mastery checks</span>
          <strong>
            {masteryChecksPassed}
            {' / 3'}
          </strong>
        </div>
      </div>

      <div className="concept-tags">
        {concepts.map((c) => (
          <span
            key={c}
            className={`tag ${progress.mastery[c] ? 'tag--mastered' : ''}`}
          >
            {c.replace(/-/g, ' ')}
          </span>
        ))}
      </div>

      <div className="step__nav">
        <button className="btn btn--ghost" onClick={props.onPrev}>Review steps</button>
        {nextUnit ? (
          <button
            className="btn btn--primary"
            onClick={() => props.onOpenLesson(nextUnit.lessonId)}
            disabled={!mastered}
            title={!mastered ? 'Master this unit to continue' : ''}
          >
            Next: {nextUnit.name}
          </button>
        ) : (
          <button className="btn btn--primary" onClick={props.onExit}>
            Back to course
          </button>
        )}
      </div>
      </div>
    </div>
  )
}
