# MVP PRD: Brilliant-Style Algebra-Based Intro Physics

## Product summary

Build a Brilliant-style learning app for one subject: algebra-based introductory college physics. The MVP teaches five core Physics I units through direct manipulation, simulation, instant feedback, progress tracking, and a clear course path. It must work without AI.

The product is not a video course, textbook, or quiz bank. The core experience is: predict, manipulate, observe, answer, get specific feedback, and try again. Each unit should feel like a polished Brilliant lesson with a small physics sandbox, not a static worksheet.

> **Product evolution (active direction):** The MVP units below remain the foundation, but the product is evolving into **Soccer Mode** — every physics unit becomes a soccer skill, and a full match against the CPU is where the learner proves it. The lessons are the training camp; the match is the game. See [Product Evolution: Soccer Mode](#product-evolution-soccer-mode--train-then-play-the-match) for the full spec, mapping, match loop, difficulty rules, and phased build plan.

## Product Evolution: Soccer Mode — Train, then Play the Match

### Vision and hook

Soccer Mode reframes the entire course around a single, fresh idea: **your brain is the controller.** You do not push a button to shoot — you *solve the physics* of the shot under a countdown, and the better/faster you solve it, the better your team plays. This sidesteps FIFA entirely: nobody else makes a soccer game where the input is physical reasoning.

Two layers, tightly coupled:

1. **Training (the lesson):** Each unit teaches one soccer skill in calm, no-pressure conditions using the existing lesson engine and simulation. This is where the concept is introduced and the mechanic is learned.
2. **The Match (the payoff):** A fast sequence of game situations vs. a CPU opponent. At each decision point the learner picks an action (the *strategy*), then must *execute* it by solving a physics question of that skill's type before a countdown expires. Solve it well → the action fires with the values the learner chose. Fail or run out of time → heavy touch, weak attempt, or turnover.

The progression — **learn the skill in calm, then demand it under fire** — is the whole hook.

### Unit → soccer skill → match action mapping

| Unit (physics) | Soccer skill | In-match action | What the learner actually solves |
| --- | --- | --- | --- |
| **Kinematics** (projectile) | Shooting / free kicks | Take a shot | Angle + power so the ball lands in the target zone under the bar *(already built — `KinematicsSim.tsx`)* |
| **Motion Graphs** (velocity = slope) | Passing (leading a runner) | Through-ball to a moving teammate | Pass speed + timing so the ball *meets* the run (two motion lines intersect) |
| **Forces** (friction) | Pass weight / first touch | Ground pass at the right pace | Initial force so friction leaves the ball at the right arrival speed |
| **Energy** (conservation, √2gh) | Chip / lob / header | Chip the keeper or win a header | Launch height/energy to clear the keeper and drop it in |
| **Momentum / Collisions** (replaces Circuits) | Defense / tackling | Time a tackle or interception | Close the gap and time the intercept; momentum & collision reasoning |

**Circuits → Momentum swap:** Circuits → soccer is a forced fit. Defense/tackling is really momentum and collisions (closing distance, timing the intercept, what happens on contact). Swapping the Circuits unit for a **Momentum / Collisions** unit makes defense map cleanly while staying core algebra-based physics. Circuits content can be retired or parked for a non-soccer track.

### Training → Match progression

- A unit's lesson stays structured as today (concept → sandbox → prediction → numeric → manipulation challenge → summary) and teaches the skill in isolation.
- Mastering a unit **unlocks that skill in the Match.** Before a skill is unlocked, the CPU/match simply won't present decision points that require it (or auto-resolves them weakly for the player).
- The Match is the unifying meta-layer that sits above the course path: as more units are mastered, the learner's in-match toolkit grows from "only shooting" to the full set of actions.

### The full-match loop (vs. CPU)

1. A match is a fast sequence of **game situations**: you have the ball, a teammate makes a run, a defender closes, you're in the box, the opponent attacks, etc.
2. At each **decision point**, the learner chooses an **action**: pass / through-ball / dribble / shoot / chip / tackle. *Choosing is the strategy.*
3. Executing the chosen action triggers a **question of that skill's type** with a **countdown timer**.
   - Answer correctly in time → the action fires using the physics values the learner set (e.g., the chosen angle/power/lead).
   - Wrong answer or time-out → degraded outcome: heavy touch, turnover, weak/blocked attempt, or a foul.
4. The **CPU defends and attacks on its own.** The learner is racing both the clock on each decision and the scoreline.
5. Outcomes feed back into match state (possession, position, score) and the next situation is generated.

### Risk → difficulty / time scaling

Ambition costs you under pressure. The **risk of the chosen action scales the question**:

| Action ambition | Question difficulty | Countdown | Reward |
| --- | --- | --- | --- |
| Safe (e.g., square pass) | Easy | Long | Low risk, retains possession |
| Medium (e.g., diagonal through-ball) | Medium | Medium | Territory / chance creation |
| High (e.g., 40-yard killer ball, top-corner volley) | Hard | Short | High reward, high turnover risk |

This is the difficulty / time / gambling axis: the learner constantly trades safety for upside, and harder physics is the price of a higher-reward play. This single mechanic is what turns "answer questions" into "play a game."

### Per-skill question design (one per unit)

Each skill reuses its unit's existing simulation as the in-match question surface, so the match feels continuous with the training.

- **Shooting (Kinematics):** Set angle + power; ball must land in the target zone under the bar. *Already implemented in `KinematicsSim.tsx` (Madden-style meter + solve phase).*
- **Through-ball (Motion Graphs):** A teammate runs at a shown velocity. Pick pass speed/timing so the two motion lines intersect at the meeting point. Wrong slope/timing = pass behind or ahead of the runner.
- **Ground pass / first touch (Forces):** Choose initial force; friction decelerates the ball. Target an arrival speed (too hard = overruns the receiver, too soft = intercepted).
- **Chip / header (Energy):** Choose launch energy/height to clear the keeper using √(2gh)-style reasoning and drop the ball behind them.
- **Tackle / intercept (Momentum):** Time the closing run and contact so you meet the ball/carrier with the right momentum to win it cleanly without fouling.

### Scoring and win conditions (match)

- Match length: short, time-boxed periods suitable for a demo session (e.g., a few minutes of in-match clock).
- Goals scored vs. conceded determine the result.
- Per-decision feedback still uses the existing instant-feedback model (correct / incorrect / near-miss / hint), but framed as commentary.
- Track a **match high score / record** (extends the existing high-score persistence used by the soccer sim).

### Data model additions (sketch)

- Skill unlock state derived from `unitStatus` (a skill is available in-match when its unit is `mastered`).
- Match record: result, goals for/against, decisions attempted, accuracy, fastest correct solve, longest streak of successful actions.
- Persist alongside existing local progress and the Supabase `profiles` high-score fields.

### Phased build plan

**Phase A — Vertical slice (proof it's fun):**
1. Build the **match shell**: situation generator, decision-point UI, action picker, countdown, and outcome resolver.
2. Wire in **shooting** as the first and only skill (mechanic already exists in `KinematicsSim.tsx`).
3. Stub all other actions as auto-resolved/disabled so the loop is playable end-to-end with one real skill.
4. Tune feel: countdown lengths, risk tiers, what a "good enough" solve looks like.

**Phase B — Skill-by-skill expansion (one unit at a time):**
5. Motion Graphs → through-ball.
6. Forces → ground pass / first touch.
7. Energy → chip / header.
8. Swap Circuits → **Momentum / Collisions** unit, then add tackle / intercept.

**Phase C — Match depth and polish:**
9. CPU attacking/defending AI, possession/territory model, scoreline pressure.
10. Match scoring, records, commentary feedback, and persistence.
11. Responsive/mobile polish and deployment.

**Sequencing principle:** plan first (this spec), then ship Phase A as a playable 1-skill proof before expanding — an interconnected system like this is far cheaper to get right with the loop validated early.

### Open questions / risks

- **Match AI scope:** A believable CPU is the biggest unknown; keep the first version scripted/probabilistic, not a real tactical AI.
- **Countdown vs. solve UX:** Solving real physics under a timer can feel punishing; tune difficulty tiers and allow "safe" plays as a relief valve.
- **Skill reuse vs. rebuild:** Prefer extending each unit's existing sim as the in-match question surface rather than building parallel mechanics.
- **Circuits retirement:** Decide whether to fully replace Circuits with Momentum or keep Circuits as an optional non-soccer unit.

## Target audience

Primary user: students taking or preparing for algebra-based collegiate introductory physics.

Typical users include:

- First-year college students in algebra-based Physics I.
- Students who understand formulas mechanically but struggle to connect equations to physical intuition.
- Students preparing for homework, exams, labs, or placement review.
- Students who need short mobile-friendly practice sessions between classes.

Assumed baseline:

- Has seen basic algebra and graphs.
- May know some physics vocabulary, but does not reliably understand how variables interact.
- Learns better by experimenting than by reading long explanations.
- Does not need calculus to complete the MVP.

## MVP problem statement

Intro physics students often memorize equations without understanding what the variables mean. When asked to reason about a changing physical system, they guess, plug numbers blindly, or confuse related concepts like velocity, acceleration, force, and energy.

The MVP should help a student build intuition by letting them manipulate a physics scenario and see the result immediately.

## Goals

- Teach five intro physics units through interactive lessons.
- Give each unit a distinct manipulation or simulation mechanic.
- Make interactions feel clean, responsive, and satisfying enough for a polished demo.
- Let users experiment in sandbox simulations before and during problem solving.
- Give immediate, specific, hand-written feedback for correct and incorrect answers.
- Persist demo user identity, lesson progress, streaks, and completion state locally.
- Work well on both desktop and phone-sized screens.
- Provide a course path that makes the app feel built for college intro physics, not generic learning.

## Non-goals for MVP

- No AI features.
- No chatbot tutor.
- No generated lessons, generated hints, or model calls.
- No exhaustive physics course coverage.
- No multi-lesson depth per unit beyond the MVP lesson.
- No calculus-based derivations or calculus-required problems.
- No production-grade account system.
- No database-backed multi-user persistence.
- No video-first lessons.
- No large content-management system.
- No multiplayer, classroom admin, grading exports, or instructor dashboard.

## MVP unit scope

The MVP should include five units. Each unit needs one playable lesson with a different kind of problem and interaction.

Recommended MVP units:

| Unit | Playable lesson | Core interaction | Main learning goal |
| --- | --- | --- | --- |
| 1. Kinematics | Projectile Motion: Aim the Launcher | Adjust launch angle and speed to hit targets | Understand horizontal/vertical independence, range, time of flight, and max height |
| 2. Motion Graphs | Match the Motion | Drag/edit a position-time or velocity-time graph and see the object move | Connect graph shape, slope, velocity, and acceleration |
| 3. Forces | Push the Crate | Adjust force, mass, friction, and surface type to move an object | Understand net force, acceleration, friction, and Newton’s second law |
| 4. Energy | Build the Ramp | Change ramp height, mass, and friction to predict speed at the bottom | Understand energy conversion, work, kinetic energy, potential energy, and losses |
| 5. Circuits | Light the Bulb | Build simple series/parallel circuits by connecting batteries, bulbs, and resistors | Understand voltage, current, resistance, and why circuit structure matters |

The first unit, projectile motion, should be the most polished reference experience. The other four units should still be playable and complete, but can be smaller in content depth.

Overall MVP learning objective:

By the end of the MVP, the learner has practiced reasoning with five common Physics I systems by changing variables, seeing consequences immediately, answering targeted questions, and receiving specific feedback.

MVP completion definition:

A learner completes the MVP when they achieve mastery completion on all five units. “Mastery completion” means finishing each unit lesson, completing the direct manipulation challenge, and answering all 3 mastery checks correctly for that unit.

## Core user journey

1. Student logs in with the demo account.
2. Student sees the course path: “Intro Physics I” with five units.
3. Student starts “Projectile Motion: Aim the Launcher.”
4. Student enters a simulation sandbox with sliders for launch speed and angle.
5. Student changes variables and watches the trajectory update immediately.
6. Student makes predictions and answers interactive questions.
7. The app gives instant, specific feedback after every answer.
8. Student completes the lesson and sees progress, mastery, streak, and the recommended next unit.
9. Student leaves mid-lesson, returns later, and resumes from the saved step.

## MVP feature requirements

### 1. Demo authentication and user profile

Users can:

- Log in through a demo login screen.
- Use the fixed MVP credentials:
  - Username: `test`
  - Password: `test`
- See a demo display name.
- See their current progress and streak.
- Log out and return to the login screen.

The MVP should simulate account login to show the expected product flow. It does not need real signup, password reset, email verification, or backend auth. There should be no signup button in the MVP.

Auth behavior:

- Only `test` / `test` logs in successfully.
- Incorrect credentials show a clear inline error.
- Logging out clears the active session state but does not erase saved progress.
- Logging back in with `test` / `test` restores locally saved progress.

MVP profile fields:

- User id
- Display name
- Username
- Current streak count
- Last active date
- Created date

### 2. Course path

The MVP should show a small course map for algebra-based introductory college physics.

Each of the five units needs one fully playable lesson. The lessons can be compact, but each must include a real interaction, at least one problem, and saved completion state.

Required MVP path:

1. Kinematics
   - Projectile Motion: Aim the Launcher
2. Motion Graphs
   - Match the Motion
3. Forces
   - Push the Crate
4. Energy
   - Build the Ramp
5. Circuits
   - Light the Bulb

MVP behavior:

- All five unit lessons are visible in the course path.
- The first lesson is unlocked by default.
- Later lessons should unlock sequentially as the user completes previous units.
- If implementation time gets tight, all lessons can remain accessible, but the UI should still show the intended course order.
- Completing a lesson updates progress and recommends the next unit.
- Completing all five units with mastery shows full MVP completion.

Unit states:

- `locked`: unit is visible but not yet available.
- `available`: unit can be started.
- `in_progress`: unit has saved progress but is not mastered.
- `mastered`: unit lesson is finished, direct manipulation challenge is complete, and all 3 mastery checks are correct.

Course completion appears only when all five units are `mastered`.

### 3. Structured lesson model

Lessons should be represented as structured data, not hard-coded page text.

Minimum lesson shape:

```ts
type Lesson = {
  id: string
  title: string
  unitId: string
  estimatedMinutes: number
  steps: LessonStep[]
}

type LessonStep =
  | ConceptStep
  | SandboxStep
  | PredictionStep
  | NumericAnswerStep
  | MultipleChoiceStep
  | ReflectionStep
```

Each step should include:

- Prompt
- Interaction type
- Correct answer or evaluator
- Feedback for correct answers
- Feedback for common wrong answers
- Optional hint
- Mastery concept tags

This matters because future lessons and AI features should be able to use the same lesson structure later.

Required lesson structure:

Each unit lesson should have exactly 6 steps:

1. Concept intro: short explanation of the physical idea.
2. Sandbox explore: learner changes variables and observes the simulation.
3. Conceptual prediction: mastery check 1.
4. Numerical question: mastery check 2, algebra only.
5. Direct manipulation challenge: mastery check 3 plus required interaction goal.
6. Mastery summary: show unit status, feedback, and next recommendation.

The first five steps are interactive or instructional. Step 6 is a completion state and should not introduce new assessed content.

### 4. Interactive simulations and sandbox mechanics

Each unit needs one interactive sandbox. The simulations should be deterministic and conceptually accurate enough for algebra-based intro college physics. They do not need photorealistic animation, but they should feel clean, responsive, and intentionally designed.

Interaction quality requirements:

- Controls respond immediately while dragging or tapping.
- Visual changes are smooth, readable, and clearly tied to the learner’s action.
- Each sandbox has a clear goal state, not just free exploration.
- The UI should feel like a Brilliant clone: minimal, focused, friendly, and polished.
- Prefer direct manipulation over forms where possible.

Minimum interaction requirements by unit:

| Unit | Required minimum interaction |
| --- | --- |
| Projectile Motion | Sliders for launch angle and launch speed; learner must hit a target distance. |
| Motion Graphs | Draggable graph points; object motion updates from the graph. |
| Forces | Sliders for mass, applied force, and friction; crate acceleration updates immediately. |
| Energy | Ramp height and friction controls; energy bar chart updates immediately. |
| Circuits | Constrained circuit builder using predefined slots or tap-to-place components; learner must complete a working circuit. |

#### Unit 1: Projectile Motion: Aim the Launcher

Problem types:

- Hit a target by adjusting launch speed and angle.
- Predict which angle gives the largest range.
- Explain why complementary angles can land near the same range.
- Keep max height below a limit while still hitting the target.

Controls:

- Launch angle slider, e.g. 0–90 degrees.
- Initial speed slider, e.g. 5–50 m/s.
- Optional gravity selector for Earth/Moon/Jupiter if time allows.
- Optional reset button.

Visual output:

- Projectile path drawn on a responsive canvas or SVG.
- Launcher angle shown visually.
- Landing point shown on the ground.
- Labels for range, max height, and time of flight.

Required behavior:

- Visual updates immediately while sliders move.
- Works with mouse and touch.
- Maintains smooth interaction on mobile.
- Uses deterministic physics formulas, not animation-only approximations.

Physics model for MVP:

- Flat ground.
- No air resistance.
- Constant gravity.
- Initial and final height are equal.

Useful formulas:

```txt
vx = v0 * cos(theta)
vy = v0 * sin(theta)
timeOfFlight = 2 * vy / g
range = vx * timeOfFlight
maxHeight = vy^2 / (2 * g)
y(t) = vy * t - 0.5 * g * t^2
x(t) = vx * t
```

#### Unit 2: Motion Graphs: Match the Motion

Problem types:

- Given a moving object animation, choose or draw the matching position-time graph.
- Drag graph points to make an object move according to a target motion.
- Identify where velocity is positive, negative, zero, fast, or slow.
- Match a velocity-time graph to a position-time graph.

Controls:

- Draggable points on a graph.
- Play/pause scrubber for time.
- Toggle between position-time and velocity-time views.
- Optional “show slope” tool.

Visual output:

- Object moving along a one-dimensional track.
- Position-time graph.
- Velocity-time graph.
- Highlighted slope/area cues when relevant.

Required behavior:

- Editing the graph updates the object motion immediately.
- Scrubbing time highlights the object position and corresponding graph point.
- Feedback distinguishes graph-shape mistakes from slope/velocity mistakes.

#### Unit 3: Forces: Push the Crate

Problem types:

- Choose the minimum force needed to start moving a crate.
- Predict acceleration after changing mass or applied force.
- Explain why motion can continue after the push stops on a low-friction surface.
- Balance forces so the crate moves at constant velocity.

Controls:

- Applied force slider.
- Mass slider.
- Friction coefficient or surface selector, e.g. ice, wood, rubber.
- Optional free-body diagram toggle.

Visual output:

- Crate moving along a horizontal surface.
- Force arrows for applied force, friction, normal force, and weight.
- Net force and acceleration readouts.
- Optional velocity trace.

Required behavior:

- Changing force, mass, or friction updates acceleration and motion immediately.
- The simulation clearly distinguishes static friction threshold from kinetic friction if implemented.
- Feedback calls out common misconceptions like “force is needed to keep moving” versus “net force changes velocity.”

#### Unit 4: Energy: Build the Ramp

Problem types:

- Set ramp height to reach a target speed.
- Predict final speed from starting height.
- Compare frictionless and frictional ramps.
- Explain why mass cancels out in the frictionless case.

Controls:

- Ramp height slider.
- Ramp angle or length slider.
- Mass slider.
- Friction toggle or friction slider.

Visual output:

- Ball/block moving down a ramp.
- Energy bar chart showing gravitational potential, kinetic, and thermal energy.
- Final speed readout.
- Optional “pause at point” inspection.

Required behavior:

- Changing height or friction updates the energy bars and predicted final speed.
- The animation and chart stay in sync.
- Feedback explains whether the learner confused force, energy, speed, or mass dependence.

Useful formulas:

```txt
potentialEnergy = m * g * h
kineticEnergy = 0.5 * m * v^2
frictionlessFinalSpeed = sqrt(2 * g * h)
```

For MVP friction, a simplified energy-loss model is acceptable if it is clearly labeled.

#### Unit 5: Circuits: Light the Bulb

Problem types:

- Build a closed circuit that lights a bulb.
- Compare brightness in series versus parallel circuits.
- Predict what happens when one bulb is removed.
- Adjust resistance to reach a target current.

Controls:

- Drag-and-drop or tap-to-place components: battery, wire, bulb, resistor, switch.
- Component value controls for voltage and resistance.
- Open/close switch control.
- Reset circuit button.

Visual output:

- Simple circuit diagram.
- Bulb brightness.
- Current direction/flow indicator.
- Voltage/current/resistance readouts.

Required behavior:

- The circuit only works when a complete valid path exists.
- Series and parallel layouts produce visibly different brightness/current behavior.
- Feedback identifies open circuits, short circuits, and resistance/current misconceptions.

Useful formulas:

```txt
V = I * R
seriesResistance = R1 + R2 + ...
parallelResistance = 1 / (1/R1 + 1/R2 + ...)
power = I^2 * R
```

### 5. Interactive lesson steps

Each unit lesson should include exactly 6 short steps.

Problem mix requirement:

Each unit should include a mix of:

- Conceptual intuition questions.
- Short numerical questions using algebra only.
- Direct manipulation challenges inside the simulation.

Required step pattern per unit:

1. Concept intro.
2. Sandbox exploration.
3. Conceptual prediction.
4. Numerical question.
5. Direct manipulation challenge.
6. Mastery summary.

At least one step in every unit must require direct manipulation, not just selecting an answer.

Projectile motion example sequence:

1. Concept intro: “A projectile’s horizontal and vertical motion can be analyzed separately.”
2. Sandbox exploration: “Change speed and angle. What do you notice?”
3. Conceptual prediction: “If speed stays fixed, which launch angle gives the greatest range?”
4. Numerical question: “At 20 m/s and 45°, approximately how long is the projectile in the air?”
5. Direct manipulation challenge: “Hit a target 40 meters away while keeping max height below a limit.”
6. Mastery summary: show what was mastered and recommend Motion Graphs.

### 6. Instant feedback

Every answer or submitted interaction gives feedback in under 100ms.

Feedback requirements:

- Correct answer: explain why it is correct in one or two sentences.
- Incorrect answer: explain the misconception and give a next action.
- Near miss: acknowledge what is close and point to the specific variable to adjust.
- Repeated wrong answers: show a hint or simplify the task.

Projectile motion example feedback:

- Correct: “Yes. At the same speed, 45° balances horizontal speed and time in the air, which maximizes range on level ground.”
- Incorrect: “Not quite. A steeper angle gives more time in the air, but it also reduces horizontal speed. Try comparing 45° and 75° in the sandbox.”
- Near miss: “You are close to the target. Your angle is creating enough height, but the projectile is landing short. Increase launch speed slightly.”

Other required feedback examples:

- Motion graphs: “The object is moving forward the whole time, so the position graph should keep increasing. A flat line would mean it stopped.”
- Forces: “The crate is moving, but that does not mean the applied force is larger than friction. Constant velocity means the net force is zero.”
- Energy: “Changing mass changes both potential and kinetic energy by the same factor, so the frictionless final speed does not change.”
- Circuits: “The bulb is not lighting because the path is open. Current needs a complete loop from one side of the battery to the other.”

### 7. Progress persistence

Progress must persist across sessions.

For the MVP, persistence can be local-only. Store progress in browser local storage under the demo account. This is acceptable because the MVP only needs one demo account to show the product flow.

Track:

- Current lesson id
- Current step index
- Completed lessons
- Per-step answer history
- Sandbox state for the current lesson
- Mastery by concept tag
- Streak data

Acceptance behavior:

- If a user leaves on step 4 and returns, step 4 opens again.
- If a user finishes the lesson, it remains completed after refresh.
- Streak and progress survive logout/login.
- Progress does not need to sync across devices for the MVP.

### 8. Mastery and recommendations

MVP mastery must be simple, strict, and rule-based.

Suggested concept tags:

- projectile-horizontal-vertical-independence
- projectile-range
- projectile-time-of-flight
- projectile-max-height
- gravity-effect
- graph-slope-as-velocity
- graph-velocity-direction
- force-net-force
- force-friction
- energy-conservation
- energy-friction-loss
- circuits-closed-loop
- circuits-series-parallel
- circuits-ohms-law

Mastery rules:

- Each unit has exactly 3 mastery checks.
- Mastery check 1 is the conceptual prediction step.
- Mastery check 2 is the numerical question step.
- Mastery check 3 is the direct manipulation challenge.
- A unit is `mastered` only when the learner gets 3/3 mastery checks correct.
- The direct manipulation challenge must meet the target condition, not just be attempted.
- If the learner misses any mastery check, the unit remains `in_progress` and should offer retry/review.
- Full MVP completion requires all five units to be `mastered`.

MVP recommendation:

- If a lesson is mastered, recommend the next unit.
- If low mastery on a concept, recommend replaying the missed step or returning to that unit’s sandbox.
- If all five units meet mastery completion, show overall course completion.

### 9. Habit loop

MVP should include lightweight retention mechanics:

- Daily streak.
- Lesson completion milestone.
- Progress bar for the current lesson.
- Course path completion percentage.
- “Next up” card after lesson completion.

Avoid heavy gamification. The loop should support learning, not distract from it.

### 10. Responsive desktop and mobile support

The app must be usable on both desktop and phone-sized screens. Neither form factor should feel like an afterthought.

Requirements:

- Clean desktop layout with enough space for the simulation and lesson prompt side by side when possible.
- Responsive layout down to 375px width.
- Large touch targets for sliders and answers.
- Simulation readable on mobile.
- No horizontal page scrolling.
- Lesson step actions reachable without awkward scrolling.

Visual design requirements:

- Card-based lesson layout.
- Light neutral background.
- One clear accent color for active controls, selected answers, and progress.
- Large simulation panel as the visual center of each lesson.
- Feedback panel below or beside the simulation depending on screen width.
- Smooth state transitions for feedback, progress, and unit completion.
- No heavy animations that distract from the simulation.

## Data model

Minimum persisted entities:

```ts
type UserProfile = {
  id: string
  displayName: string
  username: string
  createdAt: string
}

type UserProgress = {
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

type UnitStatus = 'locked' | 'available' | 'in_progress' | 'mastered'

type LessonProgress = {
  lessonId: string
  currentStepIndex: number
  answers: StepAnswer[]
  masteryChecksCorrect: Record<string, boolean>
  manipulationChallengeComplete: boolean
  sandboxState?: Record<string, unknown>
  completedAt?: string
}

type StepAnswer = {
  stepId: string
  answer: unknown
  isCorrect: boolean
  attemptNumber: number
  feedbackShown: string
  answeredAt: string
}
```

Local storage keys:

```txt
physics-demo-session
physics-demo-progress
```

`physics-demo-session` stores whether the demo user is currently logged in. `physics-demo-progress` stores lesson progress, unit status, streak, mastery checks, and sandbox state for the `test` account.

## Suggested technical approach

Current frontend stack:

- React
- TypeScript
- Vite

Recommended MVP additions:

- Local demo auth using fixed credentials: `test` / `test`.
- Browser local storage for persisted progress.
- SVG or Canvas for the simulations.
- Local structured lesson JSON or TypeScript objects for all five MVP lessons.
- Deterministic TypeScript physics utility functions with unit tests for each unit.

For the first implementation, SVG is likely enough and simpler to keep responsive. Canvas is acceptable if smoother animation becomes necessary. Drag-and-drop for circuits can be simplified to tap-to-place components if full freeform dragging takes too long.

Backend services are not required for the MVP. The app should be architected so real auth and database persistence can replace local demo storage later.

MVP cutline:

- Circuits can use constrained tap-to-place component slots instead of freeform drag-and-drop.
- Energy friction can use a simplified energy-loss percentage if clearly labeled.
- Motion Graphs can use draggable control points instead of freehand drawing.
- No real backend.
- No generated question bank.
- No multi-account support.
- No calculus-based problems.

## Key screens

### Landing / auth

- Short product pitch: “Learn college physics by experimenting.”
- Demo login form.
- Accepts only `test` / `test`.
- Clear error state for incorrect credentials.

### Dashboard

- User name.
- Streak.
- Course path.
- Current lesson card.
- Progress summary.

### Lesson player

- Step prompt.
- Interactive simulation or question.
- Submit/check action when needed.
- Instant feedback panel.
- Progress indicator.
- Next step button.

### Completion screen

- Lesson complete confirmation.
- Concepts mastered.
- Streak update.
- Next recommended unit or review recommendation.
- Full course completion state after mastery completion on all five units.

## Required demo path

A successful MVP demo should show:

1. Log in as `test` / `test`.
2. Start from the dashboard course path.
3. Complete and master Projectile Motion.
4. Complete and master Motion Graphs.
5. Complete and master Forces.
6. Complete and master Energy.
7. Complete and master Circuits.
8. See a “Course mastered” completion screen.
9. Refresh the page and confirm mastered units remain saved.
10. Log out, log back in as `test` / `test`, and confirm progress remains saved.

## Acceptance criteria

The MVP is acceptable when:

- The README states the chosen subject: algebra-based introductory college physics.
- A user can log in with demo credentials `test` / `test` and see their demo name.
- Incorrect credentials show an error, and there is no signup flow.
- A user can complete five unit lessons end to end.
- Each unit lesson has exactly 6 steps.
- Each unit has exactly 3 mastery checks.
- Each unit requires 3/3 mastery checks correct to be marked mastered.
- The five playable units are Kinematics, Motion Graphs, Forces, Energy, and Circuits.
- Each unit includes a distinct interactive simulation or sandbox.
- Each unit includes a mix of conceptual, numerical, and direct manipulation problems.
- Projectile Motion includes adjustable launch speed and launch angle.
- Motion Graphs includes editable or selectable graphs tied to object motion.
- Forces includes adjustable force, mass, and friction.
- Energy includes ramp/height controls and an energy bar chart.
- Circuits includes building or modifying a simple circuit.
- Visual outputs update immediately as controls change.
- At least one task in every unit requires the learner to manipulate the simulation to reach a goal.
- Every answer gives specific hand-written feedback.
- Progress persists locally after refresh and demo logout/login.
- Progress is stored using `physics-demo-session` and `physics-demo-progress`.
- Finishing the lesson updates mastery, streak, and course path progress.
- Full MVP completion requires mastery completion on all five units.
- The app recommends a sensible next step.
- The app works well on both desktop and mobile screen sizes.
- The app is deployed publicly.
- No AI feature is present in the MVP.

## Performance targets

- Lesson loads to first interaction in under 2 seconds on a typical connection.
- Feedback appears in under 100ms.
- Simulation interaction remains smooth while dragging controls.
- Desktop interactions should feel precise with mouse input.
- Mobile interactions should feel natural with touch input.
- Mobile layout remains usable at 375px width.
- The demo account does not need multi-user isolation beyond local browser storage.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Five simulations take too long to build | Keep each simulation simple, deterministic, and 2D. Prioritize direct manipulation over animation polish. |
| Scope expands into a full physics course | Ship one compact lesson per unit, not a full chapter per unit. |
| Feedback becomes generic | Write feedback for known misconceptions in each unit before adding extra question variants. |
| Auth/persistence consumes too much time | Use fixed demo credentials and local storage instead of backend auth. |
| Simulations are hard to read across screen sizes | Design responsively with compact controls, clear desktop layouts, and resizable SVG viewports. |
| Physics calculations are wrong | Keep formulas simple and add utility tests for each unit’s core calculations. |
| Circuit builder becomes too complex | Use constrained tap-to-place slots before attempting freeform drag-and-drop. |
| Polish delays functionality | Prioritize complete playable flows first, then polish the highest-visibility interactions. |

## Implementation priority

1. Shared lesson engine, content model, and mastery model.
2. Demo auth, local storage session, and local progress persistence.
3. Course path with unit states.
4. Projectile motion sandbox and lesson.
5. Motion graphs sandbox and lesson.
6. Forces sandbox and lesson.
7. Energy ramp sandbox and lesson.
8. Circuits sandbox and lesson.
9. Mastery completion logic, streak, and next recommendation.
10. Responsive desktop/mobile polish and deployment.

## Post-MVP notes

Phase 2 can add AI only after this MVP works without it. Good future AI candidates:

- Generate extra practice values across all five units while checking answers with deterministic formulas.
- Give targeted hints based on the learner’s actual sandbox state.
- Recommend review based on mastery tags.

Phase 3 can add learning science:

- Spaced review for missed concepts.
- Interleaved practice between kinematics, graphs, forces, energy, and circuits.
- Faded scaffolding where hints become less explicit over time.
