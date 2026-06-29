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
  | 'freekick'
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
  /**
   * Quantum League matches played after promotion. Each match is gated behind a
   * completed top-flight assessment (matches & assessments advance 1:1). Single
   * 50-game season, so this is capped at 50.
   */
  quantumMatchesPlayed?: number
  /**
   * Per-account random seed for the league simulation (legacy; the season is now
   * simulated with fresh randomness each time and the result is stored below).
   */
  leagueSeed?: number
  /**
   * Last calendar day (YYYY-MM-DD) the +coins "practice this concept" bonus was claimed. The
   * bonus is offered once per day on a missed question in the test-history
   * review; claiming it stamps today's date. Persisted in the cloud and cleared on reset.
   */
  lastPracticeBonusDate?: string
  /**
   * Career-long tracking for the 90+ "gamble your skill points" wheel (see lib/pointsWheel).
   * Persisted so the rigged odds (one guaranteed 10 early, a hard cap on 8+ results) hold
   * across sessions. Cleared on reset.
   */
  pointsWheel?: PointsWheelState
  /**
   * Results of matchdays the player has actually PLAYED in the interactive match game,
   * keyed by 1-based matchday. These are the ONLY results that count toward your record:
   * the live standings use them for your fixture (and your opponent's game vs you), while
   * every other fixture is rolled randomly off the seed. Cleared on a career reset.
   */
  matchResults?: Record<number, { gf: number; ga: number; challengeId?: string; challengeDone?: boolean }>
  // ---- Coin-farm economy (persisted in the progress jsonb) ----
  /** True once the free opening matchday has been consumed (the onboarding carrot). */
  firstMatchUsed?: boolean
  /** True once the rigged guaranteed first Coin Farm run has been completed. */
  firstFarmDone?: boolean
  /** True once the opening story + guaranteed first match (the underdog intro) is done. */
  introDone?: boolean
  /** True once the one-time dashboard economy tutorial overlay has been dismissed. */
  tutorialSeen?: boolean
  /** Running count of consecutively MASTERED learning sessions (the mastery streak). */
  perfectStreak?: number
  /** Coins paid out by the most recent PERFECT farm run (legacy; coins are retired). */
  lastFarmPayout?: number
  /**
   * True when the player has EARNED a match by mastering a learning session/lesson but
   * hasn't played it yet. The match is the reward for learning (coins are retired):
   * mastering learning sets this, playing the match consumes it. Cleared on reset.
   */
  matchUnlocked?: boolean
  /**
   * Training-ground drills the player has fully cleared (solved every scenario in the
   * mastery set) at least once, keyed by unit id. Drives "first clear" payouts and the
   * "Mastered" badge on the training cards. Persisted in the cloud, cleared on reset.
   */
  drillsMastered?: Record<string, boolean>
  /**
   * Lesson ids whose one-off mastery coin grant has been paid out, so a unit's
   * reward is claimed exactly once (revisiting a mastered lesson pays nothing).
   * Persisted in the cloud, cleared on reset.
   */
  lessonRewarded?: Record<string, boolean>
  /**
   * (unitId:difficulty) pairs the learner has answered correctly at least once in a
   * training session, e.g. "kinematics:2". Drives spaced-repetition REVIEW injection
   * (occasionally re-serve a mastered unit+difficulty with fresh questions) and the
   * harsher review-fail rule (miss a mastered one → no match this session). Cleared on reset.
   */
  masteredUnitDiff?: Record<string, boolean>
}

/** Career tracking for the 90+ skill-point gamble wheel. */
export type PointsWheelState = {
  /** Total spins taken so far. */
  spins: number
  /** How many 8+ results have been drawn (hard-capped). */
  highs: number
  /** The pre-chosen spin index (6–8) on which the one-and-only guaranteed 10 lands. */
  tenSpin: number
  /** Whether the guaranteed 10 has already been awarded. */
  tenDone: boolean
  /** Running surplus vs the safe baseline (points won minus 5 per spin). Drives the self-balancing odds. */
  net: number
  /** Consecutive cold spins (≤5). Drives a quiet pity nudge so a long cold run can't bleed them out. */
  lowStreak: number
}

/** One club's row in the league table (serializable; stored on UserProgress). */
export type LeagueStanding = {
  name: string
  index: number
  isPlayer: boolean
  pl: number
  w: number
  d: number
  l: number
  gf: number
  ga: number
  pts: number
}

// ===========================================================================
// Game / RPG layer (Phase 2+): player skills, economy, the gating test,
// proficiency tracking, and the question bank. All additive — independent of
// the lesson/mastery model above.
// ===========================================================================

/**
 * The six physics LEARNING UNITS. These power the lessons, the mini soccer
 * games (sims), the question bank, proficiency and the assessment — i.e. the
 * "learn in a soccer-related way" side of the app. They are intentionally
 * DECOUPLED from the 3D match attributes below (`SkillId`).
 */
export type UnitId =
  | 'kinematics'
  | 'motion-graphs'
  | 'forces'
  | 'energy'
  | 'momentum'
  | 'impulse'

export type UnitDef = {
  id: UnitId
  /** Soccer-flavoured unit name (e.g. "Shooting" for the kinematics drill). */
  name: string
  /** In-match action this drill is themed around (e.g. "Take a shot"). */
  action: string
  /** Representative concept tag used when generating an in-match question. */
  primaryConceptTag: string
}

/**
 * The six upgradable attributes of an OUTFIELD player in your 3D FIFA-style club.
 * These are their own statistic (stored per user, spent with skill points) and
 * have NOTHING to do with which learning unit earned the points.
 */
export type SkillId =
  | 'shooting'
  | 'passing'
  | 'dribbling'
  | 'heading'
  | 'defending'
  | 'stamina'

/** Outfield attribute ratings, 50 (start) .. 99 (max). */
export type PlayerSkills = Record<SkillId, number>

/** A goalkeeper has three of his own attributes instead of the six outfield ones. */
export type GkStatId = 'diving' | 'handling' | 'reflexes'
export type GkSkills = Record<GkStatId, number>

/** Squad positions on your 8-a-side club (1 GK, 2 DEF, 3 MID, 2 FWD). */
export type SquadRole = 'GK' | 'DEF' | 'MID' | 'FWD'

/**
 * One member of YOUR club. Like FIFA Ultimate Team, every player is rated
 * separately and those ratings drive how they play in the 3D match (whether
 * AI-controlled or the one you're steering). The GK is discriminated by role so
 * it carries its three keeper stats; everyone else carries the six outfield stats.
 */
export type OutfieldPlayerCard = {
  id: string
  role: 'DEF' | 'MID' | 'FWD'
  name: string
  num: number
  /** This player's physical look — reflected on the card AND in the 3D match. */
  appearance: Appearance
  /** Equipped boots cosmetic id (per player). */
  cleats: string
  stats: PlayerSkills
}
export type GkPlayerCard = {
  id: string
  role: 'GK'
  name: string
  num: number
  appearance: Appearance
  cleats: string
  gk: GkSkills
}
export type SquadPlayer = OutfieldPlayerCard | GkPlayerCard

/** Your full club: exactly 8 players, ordered GK, DEF×2, MID×3, FWD×2. */
export type Squad = SquadPlayer[]

export type CosmeticKind = 'jersey' | 'cleats'
export type CosmeticRarity = 'starter' | 'common' | 'rare' | 'epic'
/** Jersey artwork style rendered on the player card / locker preview. */
export type JerseyPattern = 'plain' | 'stripes' | 'sash' | 'hoops' | 'halves' | 'galaxy'

export type Cosmetic = {
  id: string
  kind: CosmeticKind
  name: string
  rarity: CosmeticRarity
  /** Coin cost. Starter items are 0 and owned by default. */
  price: number
  /** Palette used by the in-sim character renderers. */
  colors: { primary: string; secondary: string; accent: string }
  /** Jersey-only: artwork style + shorts colour for the detailed avatar. */
  pattern?: JerseyPattern
  shorts?: string
}

/** YOUR PLAYER's physical look. Palette ids resolved in lib/appearance.ts. Flows
 *  globally (card, locker model, every drill) just like the equipped loadout does. */
export type Appearance = { skin: string; hair: string; hairStyle: string }

/** Badge silhouette + physics motif used by the procedural club emblem. */
export type EmblemShape = 'shield' | 'classic' | 'hex' | 'roundel'
export type EmblemMotif =
  | 'atom' | 'bolt' | 'ball' | 'wave' | 'orbit' | 'star'
  | 'flame' | 'arrow' | 'mountain' | 'pendulum' | 'torque' | 'spiral' | 'sun'

/**
 * A customizable club crest. `primary/secondary/accent` are optional overrides —
 * when omitted the emblem follows the player's equipped jersey colours so the badge
 * always matches the kit.
 */
export type EmblemConfig = {
  shape: EmblemShape
  motif: EmblemMotif
  primary?: string
  secondary?: string
  accent?: string
}

/** YOUR club's identity (FC name + crest). Editable and stored per user. */
export type ClubIdentity = {
  name: string
  emblem: EmblemConfig
  /**
   * Broadcast 3-letter abbreviation shown on the matchday scorecard (e.g. "PHY").
   * Generated once by the AI abbreviation Edge Function (cheapest model) from the
   * club name and cached here / persisted to the cloud. Falls back to a local
   * derivation (lib/teams clubCode) until the AI returns one.
   */
  abbr?: string
}

export type PlayerProfile = {
  /** Your whole club — 8 individually-rated players (FIFA-Ultimate-Team style). */
  squad: Squad
  coins: number
  /** Unspent skill points earned from passing the test. */
  skillPoints: number
  equipped: { jersey: string; cleats: string }
  /** Physical look (skin tone + hair colour) — applied everywhere the player is drawn. */
  appearance: Appearance
  /** Owned cosmetic ids (includes starter items). */
  inventory: string[]
  /** Customizable club name + crest (defaults to "Physics FC"). */
  club: ClubIdentity
}

/** Fine-grained, per-concept competence + spaced-repetition state. */
export type ConceptProficiency = {
  conceptTag: string
  unitId: UnitId
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
  unitId: UnitId
  proficiency: number
  accuracy: number
  attempts: number
}

/** Where a recorded attempt came from (all feed the same proficiency model). */
export type AttemptSource = 'test' | 'match' | 'review' | 'lesson'

export type AttemptInput = {
  conceptTag: string
  unitId: UnitId
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
  /**
   * Snapshot of the exact questions shown (in order) and the learner's chosen
   * choice id per question. Stored so a past attempt can be re-opened in the
   * same results/review view. Optional: attempts recorded before this feature
   * existed won't have it.
   */
  questions?: BankQuestion[]
  answers?: (string | null)[]
  /**
   * The guided "Skills review" remediation (explain-why + solve-it-again on every
   * missed question) must be finished before an attempt counts as a completed
   * assessment for the Quantum League. Undefined = legacy attempt → treat as done.
   */
  reviewComplete?: boolean
}

/** Kinds of programmatic SVG diagram a question can show (no raster images). */
export type DiagramKind =
  | 'position-time'
  | 'velocity-time'
  | 'force-time'
  | 'free-body'
  | 'ramp'
  | 'projectile'
  | 'collision'

/** A diagram reference: the renderer key + its parameters (drawn as SVG). */
export type QuestionDiagram = {
  kind: DiagramKind
  params: Record<string, unknown>
  /** Short caption / alt text. */
  caption?: string
}

/** A stored, pre-authored multiple-choice question from the 500-question bank
 * (5 units × 100, difficulty 1–5). */
export type BankQuestion = {
  id: string
  unitId: UnitId
  conceptTag: string
  difficulty: 1 | 2 | 3 | 4 | 5
  prompt: string
  choices: { id: string; label: string }[]
  correctChoiceId: string
  /** Optional numeric truth (set when the concept is computable). */
  correctValue?: number
  given?: Record<string, number>
  /** AP-style "equation sheet" freebies surfaced with the question. */
  formulas?: string[]
  /** Optional programmatic diagram (motion graph, free-body, ramp, etc.). */
  diagram?: QuestionDiagram
  /**
   * Verification relation key (authoring metadata, not shown to learners).
   * Maps to a formula in scripts/verify-bank.mjs so the numeric answer can be
   * recomputed from `given` and checked at author time.
   */
  check?: string
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
  unitId: UnitId
  conceptTag: string
  prompt: string
  unitLabel: string
  answer: number
  tolerance: number
  given: Record<string, number>
}
