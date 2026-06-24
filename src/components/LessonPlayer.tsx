import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state/AppState'
import { LESSONS, UNITS } from '../content/lessons'
import { Sim } from './sims/Sim'
import { Modal } from './ui/Modal'
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

function SandboxPeek({
  simKey,
  sandbox,
  setSandbox,
  prompt,
}: {
  simKey: SimKey
  sandbox: SimState
  setSandbox: (s: SimState) => void
  prompt: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="sandbox-peek" onClick={() => setOpen(true)}>
        🧪 Try it in the sandbox
      </button>
      <Modal
        open={open}
        title="Sandbox"
        subtitle="Experiment freely — your changes carry over. Close when you’re ready to try again."
        onClose={() => setOpen(false)}
      >
        <p className="modal__prompt">{prompt}</p>
        <Sim sim={simKey} state={sandbox} onChange={setSandbox} />
      </Modal>
    </>
  )
}

function ConceptView(props: StepViewProps & { body: string; prompt: string }) {
  return (
    <div className="card step">
      <span className="step__kind">Concept</span>
      <h2>{props.prompt}</h2>
      <p className="step__body">{props.body}</p>
      <NavButtons onPrev={props.onPrev} canPrev={props.canPrev} onNext={props.onNext} />
    </div>
  )
}

function SandboxView(props: StepViewProps & { body: string; prompt: string }) {
  // First run: score once to move on (shows the "Goals 0/1" pill, auto-advances).
  const [done, setDone] = useState(false)
  function onGoalScored() {
    if (done) return
    setDone(true)
    window.setTimeout(() => props.onNext(), 1900)
  }
  return (
    <div className="card step step--sim">
      <span className="step__kind">Sandbox</span>
      <h2>{props.prompt}</h2>
      <Sim sim={props.simKey} state={props.sandbox} onChange={props.setSandbox} showGoal onGoal={onGoalScored} />
      <p className="step__body">{props.body}</p>
      <NavButtons onPrev={props.onPrev} canPrev={props.canPrev} onNext={props.onNext} />
    </div>
  )
}

function PredictionView(props: StepViewProps & { step: PredictionStep }) {
  const { step } = props
  const [selected, setSelected] = useState<string | null>(null)
  const [fb, setFb] = useState<{ kind: FeedbackKind; message: string } | null>(null)
  const [solved, setSolved] = useState(props.masteryDone)

  function submit() {
    if (!selected) return
    const correct = selected === step.correctOptionId
    const message = correct
      ? step.feedbackCorrect
      : step.feedbackByOption[selected] ?? 'Not quite — review the concept and try again.'
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
    <div className="card step">
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
      {fb && fb.kind !== 'correct' && (
        <SandboxPeek
          simKey={props.simKey}
          sandbox={props.sandbox}
          setSandbox={props.setSandbox}
          prompt={step.prompt}
        />
      )}
      <div className="step__actions">
        <button className="btn btn--secondary" onClick={submit} disabled={!selected}>
          Check answer
        </button>
      </div>
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
    <div className="card step">
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
      {showHint && <Feedback kind="hint" message={step.hint!} />}
      {fb && <Feedback kind={fb.kind} message={fb.message} />}
      {fb && fb.kind !== 'correct' && (
        <SandboxPeek
          simKey={props.simKey}
          sandbox={props.sandbox}
          setSandbox={props.setSandbox}
          prompt={step.prompt}
        />
      )}
      <div className="step__actions">
        <button className="btn btn--secondary" onClick={submit}>
          Check answer
        </button>
      </div>
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

  function check() {
    const correct = props.challengeGoal(props.sandbox)
    const message = correct ? step.feedbackCorrect : step.feedbackIncorrect
    setFb({ kind: correct ? 'correct' : 'incorrect', message })
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

  const showHint = !solved && props.attempts >= 2 && step.hint

  return (
    <div className="card step step--sim">
      <span className="step__kind step__kind--check">Challenge</span>
      <h2>{step.prompt}</h2>
      <p className="goal-banner">🎯 {step.goalDescription}</p>
      <Sim sim={props.simKey} state={props.sandbox} onChange={props.setSandbox} />
      {showHint && <Feedback kind="hint" message={step.hint!} />}
      {fb && <Feedback kind={fb.kind} message={fb.message} />}
      <div className="step__actions">
        <button className="btn btn--secondary" onClick={check}>
          Check goal
        </button>
      </div>
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

  return (
    <div className="card step step--summary">
      <span className="step__kind">{mastered ? 'Mastered' : 'Almost there'}</span>
      <h2>{mastered ? '🎉 ' : ''}{props.prompt}</h2>
      <p className="step__body">{props.body}</p>

      {!mastered && (
        <Feedback
          kind="hint"
          message="You haven’t passed all 3 mastery checks yet. Go back and get the prediction, numerical, and challenge steps correct to master this unit."
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
            {lesson.steps.filter((s) => 'conceptTags' in s && progress.lessonState[props.lessonId]?.masteryChecksCorrect[s.id]).length}
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
  )
}
