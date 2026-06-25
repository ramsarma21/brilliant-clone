// Core domain types for the Brilliant-style intro physics MVP.

export type UnitStatus = 'locked' | 'available' | 'in_progress' | 'mastered'

export type SimState = Record<string, number | string | boolean>

export type StepKind =
  | 'concept'
  | 'sandbox'
  | 'prediction'
  | 'numeric'
  | 'challenge'
  | 'quiz'
  | 'summary'

export type ConceptStep = {
  id: string
  kind: 'concept'
  prompt: string
  body: string
}

export type SandboxStep = {
  id: string
  kind: 'sandbox'
  prompt: string
  body: string
}

export type PredictionStep = {
  id: string
  kind: 'prediction'
  prompt: string
  options: { id: string; label: string }[]
  correctOptionId: string
  conceptTags: string[]
  feedbackCorrect: string
  /** Per-option feedback for wrong choices. */
  feedbackByOption: Record<string, string>
  hint?: string
}

export type NumericStep = {
  id: string
  kind: 'numeric'
  prompt: string
  unitLabel?: string
  correctAnswer: number
  /** Absolute tolerance for marking the answer correct. */
  tolerance: number
  conceptTags: string[]
  feedbackCorrect: string
  feedbackIncorrect: string
  /** Shown when the learner is close but outside tolerance. */
  feedbackNearMiss?: string
  nearMissTolerance?: number
  hint?: string
}

export type ChallengeStep = {
  id: string
  kind: 'challenge'
  prompt: string
  goalDescription: string
  conceptTags: string[]
  feedbackCorrect: string
  feedbackIncorrect: string
  hint?: string
}

export type QuizStep = {
  id: string
  kind: 'quiz'
  prompt: string
}

export type SummaryStep = {
  id: string
  kind: 'summary'
  prompt: string
  body: string
}

export type LessonStep =
  | ConceptStep
  | SandboxStep
  | PredictionStep
  | NumericStep
  | ChallengeStep
  | QuizStep
  | SummaryStep

export type Lesson = {
  id: string
  unitId: string
  title: string
  estimatedMinutes: number
  /** Component key selecting which simulation to render. */
  sim: SimKey
  /** Default sandbox state for the simulation. */
  defaultSimState: SimState
  /** Evaluates whether the manipulation challenge goal is met. */
  challengeGoal: (state: SimState) => boolean
  steps: LessonStep[]
}

export type Unit = {
  id: string
  index: number
  name: string
  blurb: string
  lessonId: string
}

export type SimKey =
  | 'projectile'
  | 'soccer'
  | 'passing'
  | 'forces'
  | 'energy'
  | 'circuits'

// ----- Persistence model -----

export type UserProfile = {
  id: string
  displayName: string
  username: string
  createdAt: string
  kinematicsMastered?: boolean
  motionGraphsMastered?: boolean
  forcesMastered?: boolean
  energyMastered?: boolean
  circuitsMastered?: boolean
  momentumMastered?: boolean
}

export type StepAnswer = {
  stepId: string
  answer: unknown
  isCorrect: boolean
  attemptNumber: number
  feedbackShown: string
  answeredAt: string
}

export type LessonProgress = {
  lessonId: string
  currentStepIndex: number
  answers: StepAnswer[]
  masteryChecksCorrect: Record<string, boolean>
  manipulationChallengeComplete: boolean
  sandboxState?: SimState
  completedAt?: string
}

export type UserProgress = {
  userId: string
  currentLessonId: string
  currentStepIndex: number
  completedLessonIds: string[]
  unitStatus: Record<string, UnitStatus>
  streakCount: number
  lastActiveDate: string
  mastery: Record<string, number>
  lessonState: Record<string, LessonProgress>
}
