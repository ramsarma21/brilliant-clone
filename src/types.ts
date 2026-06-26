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
  | 'defense'
  | 'goalie'

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
  impulseMastered?: boolean
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

// ===========================================================================
// Game / RPG layer (Phase 2+): player skills, economy, the gating test,
// proficiency tracking, and the question bank. All additive — independent of
// the lesson/mastery model above.
// ===========================================================================

/** The six trainable skills map 1:1 to the six physics units. */
export type SkillId =
  | 'kinematics'
  | 'motion-graphs'
  | 'forces'
  | 'energy'
  | 'momentum'
  | 'impulse'

export type SkillDef = {
  id: SkillId
  /** RPG-facing skill name (e.g. "Shooting"). */
  name: string
  /** In-match action this skill unlocks (e.g. "Take a shot"). */
  action: string
  /** Representative concept tag used when generating an in-match question. */
  primaryConceptTag: string
}

/** Player skill ratings, 50 (start) .. 99 (max). */
export type PlayerSkills = Record<SkillId, number>

export type CosmeticKind = 'jersey' | 'cleats'
export type CosmeticRarity = 'starter' | 'common' | 'rare' | 'epic'

export type Cosmetic = {
  id: string
  kind: CosmeticKind
  name: string
  rarity: CosmeticRarity
  /** Coin cost. Starter items are 0 and owned by default. */
  price: number
  /** Palette used by the in-sim character renderers. */
  colors: { primary: string; secondary: string; accent: string }
}

export type PlayerProfile = {
  skills: PlayerSkills
  coins: number
  /** Unspent skill points earned from passing the test. */
  skillPoints: number
  equipped: { jersey: string; cleats: string }
  /** Owned cosmetic ids (includes starter items). */
  inventory: string[]
}

/** Fine-grained, per-concept competence + spaced-repetition state. */
export type ConceptProficiency = {
  conceptTag: string
  unitId: SkillId
  attempts: number
  correct: number
  /** Recency-weighted score, 0..100. */
  proficiency: number
  avgTimeMs: number
  /** Consecutive misses — higher resurfaces sooner. */
  missStreak: number
  /** Leitner box index (0..SR_INTERVALS.length-1). */
  srBox: number
  /** ISO date this concept is next due for review. */
  nextDue: string
  lastSeen: string
}

export type ProficiencyMap = Record<string, ConceptProficiency>

export type UnitProficiency = {
  unitId: SkillId
  proficiency: number
  accuracy: number
  attempts: number
}

/** Where a recorded attempt came from (all feed the same proficiency model). */
export type AttemptSource = 'test' | 'match' | 'review' | 'lesson'

export type AttemptInput = {
  conceptTag: string
  unitId: SkillId
  isCorrect: boolean
  timeMs: number
  source: AttemptSource
}

export type TestAttempt = {
  id: string
  takenAt: string
  score: number
  total: number
  passed70: boolean
  passed90: boolean
  pointsAwarded: number
  perUnit: Record<string, { correct: number; total: number; avgTimeMs: number }>
}

/** A stored, pre-authored multiple-choice question from the 72-question bank. */
export type BankQuestion = {
  id: string
  unitId: SkillId
  conceptTag: string
  difficulty: 1 | 2 | 3
  prompt: string
  choices: { id: string; label: string }[]
  correctChoiceId: string
  /** Optional numeric truth (set when the concept is computable). */
  correctValue?: number
  given?: Record<string, number>
  explanation: string
}

/** A live, AI-generated review question (post-game weak-spot review). */
export type ReviewQuestion = BankQuestion & { source: 'ai-review' }

/**
 * A deterministic, sim-style numeric question generated locally for in-match
 * "execute the move" prompts. Answer is computed from the physics engine, never
 * from a model.
 */
export type SkillQuestion = {
  unitId: SkillId
  conceptTag: string
  prompt: string
  unitLabel: string
  answer: number
  tolerance: number
  given: Record<string, number>
}
